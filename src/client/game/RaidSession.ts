import { INTERACT_RANGE, PLAYER_RADIUS, STAMINA_DRAIN, STAMINA_MAX, STAMINA_REGEN, TILE, VIEW_FOV, VIEW_RANGE } from '../../shared/constants';
import { countItem, hasKey } from '../../shared/inventory';
import { type ArmorDef, ammoDef, ammoForCaliber, hasItemDef, isGrenade, itemDef, weaponDef } from '../../shared/items';
import { angleDiff, clamp, dist, lerpAngle } from '../../shared/math';
import { F_SIGHT, F_SLOW, T, TILE_FLAGS } from '../../shared/map/tiles';
import type { HostMsg } from '../../shared/net/protocol';
import { actorSpeed, activeWeapon, currentSpread, shotAngles } from '../../shared/sim/combat';
import type { GameEvent, PlayerAction, RaidResult } from '../../shared/sim/types';
import type { InputFrame } from '../input/Input';
import { Input } from '../input/Input';
import type { RaidLink } from '../net/links';
import type { Settings } from '../settings';
import { confirmDialog, h } from '../ui/dom';
import { audio } from './Audio';
import { Hud } from './Hud';
import { MapOverlay, RaidInventory } from './Overlays';
import { Renderer } from './Renderer';
import { ViewState } from './ViewState';

export interface RaidSessionOpts {
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  settings: Settings;
  touch: boolean;
  link: RaidLink;
  name: string;
  color: string;
  onFinish: (r: RaidResult) => void;
  onAbandon: () => void;
  firstRaid?: boolean;
}

interface InteractTarget {
  kind: 'container' | 'door' | 'radio' | 'revive';
  id: number | string;
  label: string;
  x: number;
  y: number;
  r: number;
}

const rngLocal = {
  gauss(sd: number) {
    const u = Math.max(1e-9, Math.random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()) * sd;
  },
};

/** Client-Seite eines Raids: Eingabe, Vorhersage, Darstellung, HUD. */
export class RaidSession {
  private view: ViewState | null = null;
  private renderer: Renderer | null = null;
  private hud: Hud | null = null;
  private input: Input;
  private invUi: RaidInventory | null = null;
  private mapUi: MapOverlay | null = null;
  private pauseUi: HTMLElement | null = null;
  private root: HTMLElement;
  private loading: HTMLElement;
  private raf = 0;
  private lastT = 0;
  private ready = false;
  private finished = false;
  // lokaler Spieler
  private x = 0;
  private y = 0;
  private aim = 0;
  private stamina = STAMINA_MAX;
  private moving = false;
  private sprint = false;
  private ads = false;
  private predMag = 0;
  private cooldown = 0;
  private bloom = 0;
  private lastShotT = -9;
  private shots: number[][] = [];
  private sendAcc = 0;
  private corrIgnoreUntil = 0;
  private stepAcc = 0;
  private lastAimInputT = -9;
  private sprintBlockT = 0;
  private hitmarker: { t: number; head: boolean; kill: boolean } | null = null;
  private shake = 0;
  private heartT = 0;
  private interact: InteractTarget | null = null;
  private otherBullets = new Set<number>();
  private semiQueued = false;
  private throwMode = false;
  private lastHp = 100;
  private aimAssistTarget: number | null = null;
  private lastAimDist = 300;
  private paused = false;
  private stallWarned = false;
  private onResize = () => this.renderer?.resize();
  private onVis = () => {
    if (document.hidden && !this.opts.link.coop && this.ready && !this.finished) this.openPause();
  };

  constructor(private opts: RaidSessionOpts) {
    this.root = h('div', { class: 'raid-ui', style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
    this.root.classList.toggle('touch', opts.touch);
    opts.ui.appendChild(this.root);
    this.loading = h('div', { class: 'overlay', style: { alignItems: 'center', pointerEvents: 'auto' } }, h('div', { class: 'center' }, h('h2', null, 'Raid wird geladen …'), h('p', { class: 'muted' }, opts.link.coop ? 'Warte auf Server' : 'Generiere Zone')));
    this.root.appendChild(this.loading);
    this.input = new Input(opts.canvas, this.root, opts.settings, opts.touch);
    this.input.setTouchVisible(false);
    document.body.classList.add('in-raid');
    audio.unlock();
    audio.setVolume(opts.settings.volume);
    opts.link.onMessage = (m) => this.onMsg(m);
    opts.link.onLost = () => {
      if (this.finished) return;
      this.hud?.message('Verbindung zum Raid verloren – du giltst als vermisst.', 'warn', 6000);
      setTimeout(() => !this.finished && this.abandon(), 2500);
    };
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVis);
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------
  private onMsg(m: HostMsg) {
    const now = performance.now() / 1000;
    switch (m.type) {
      case 'raidStart': {
        if (!this.view) {
          this.view = new ViewState(m.info, m.info.coop ? 0.11 : 0.045);
          this.setupUi();
        } else this.view.reset(m.info);
        break;
      }
      case 'snap': {
        const v = this.view;
        if (!v) return;
        v.onSnap(m.s, now);
        if (!this.ready) {
          const mine = m.s.a.find((a) => a.i === v.you);
          if (mine) {
            this.x = mine.x;
            this.y = mine.y;
            this.aim = mine.a;
            this.ready = true;
            this.loading.remove();
            this.input.setTouchVisible(true);
            this.renderer!.cam.x = mine.x;
            this.renderer!.cam.y = mine.y;
            audio.startAmbient();
            this.hud!.message(`${v.map.meta.name} – finde Beute und extrahiere! (O: Extraktionen)`, 'info', 6000);
            if (this.opts.firstRaid) this.showControlsHint();
          }
        }
        const me = m.s.me;
        if (me) {
          if (me.corr && now > this.corrIgnoreUntil) {
            this.x = me.corr.x;
            this.y = me.corr.y;
            this.corrIgnoreUntil = now + 0.4;
          }
          if (now - this.lastShotT > 0.35) this.predMag = me.mag;
          if (me.hp < this.lastHp - 0.5) {
            const dmg = this.lastHp - me.hp;
            this.hud?.damageFlash(Math.min(1, dmg / 40));
            if (dmg > 3) audio.hurt();
            this.shake = Math.max(this.shake, Math.min(10, dmg / 3));
          }
          this.lastHp = me.hp;
        }
        break;
      }
      case 'ev':
        this.view?.pushEvents(m.list);
        break;
      case 'inv':
        if (this.view) {
          this.view.inv = m.inv;
          this.invUi?.setData(m.inv, this.view.cview);
        }
        break;
      case 'cview':
        if (this.view) {
          const opened = m.c && (!this.view.cview || this.view.cview.id !== m.c.id);
          this.view.cview = m.c;
          if (opened) audio.ui('open');
          this.invUi?.setData(this.view.inv, m.c);
          this.input.blocked = !!this.invUi?.open;
        }
        break;
      case 'result':
        if (this.view) {
          this.view.result = m.r;
          this.finish(m.r);
        }
        break;
      case 'raidEnd':
        if (this.view && !this.view.result) this.hud?.message('Raid beendet.', 'warn');
        break;
    }
  }

  private setupUi() {
    const v = this.view!;
    this.renderer = new Renderer(this.opts.canvas, v.map, this.opts.settings);
    this.hud = new Hud(this.root, v.map.meta.name, v.map.extracts);
    this.hud.setTouch(this.opts.touch);
    this.hud.setOverview(this.renderer.painter.overviewCanvas());
    this.hud.setMinimapVisible(this.opts.settings.minimap);
    this.hud.onMapClick = () => this.toggleMap();
    // Overlays vor dem Touch-UI einfügen, damit sie darüber liegen
    this.invUi = new RaidInventory(
      this.root,
      (a) => this.opts.link.send({ type: 'act', a }),
      () => {
        this.input.blocked = false;
      },
    );
    this.mapUi = new MapOverlay(
      this.root,
      v,
      this.renderer.painter.overviewCanvas(),
      (x, y) => {
        this.opts.link.send({ type: 'act', a: { a: 'ping', x, y } });
      },
      () => {
        this.input.blocked = false;
      },
    );
    this.root.appendChild(h('div', { class: 'rotate-hint' }, h('div', { style: { fontSize: '48px' } }, '⟳'), h('h2', null, 'Bitte Gerät drehen'), h('p', { class: 'muted' }, 'Der Raid wird im Querformat gespielt.')));
  }

  // ------------------------------------------------------------------
  private frame = (tMs: number) => {
    if (this.finished && !this.view) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0.0005, (tMs - this.lastT) / 1000));
    this.lastT = tMs;
    try {
      this.tick(dt);
    } catch (e) {
      console.error(e);
    }
  };

  private tick(dt: number) {
    const link = this.opts.link;
    link.update(dt);
    const v = this.view;
    if (!v || !this.renderer || !this.hud) return;
    const now = performance.now() / 1000;
    const f = this.input.poll();
    const me = v.me;
    const alive = this.ready && !!me && me.alive && !this.finished;

    this.handleActions(f, alive);

    if (alive && !this.paused) this.updateLocal(f, dt, now);
    // Eingabe senden (~30 Hz)
    this.sendAcc += dt;
    if (alive && this.sendAcc >= 1 / 30) {
      this.sendAcc = 0;
      link.send({ type: 'in', i: { x: Math.round(this.x * 10) / 10, y: Math.round(this.y * 10) / 10, aim: Math.round(this.aim * 1000) / 1000, sprint: this.sprint, ads: this.ads, moving: this.moving, shots: this.shots.length ? this.shots : undefined } });
      this.shots = [];
    }

    // Coop: keine Daten mehr vom Host?
    if (link.coop && this.ready && !this.finished) {
      const silent = now - v.lastSnapAt;
      if (silent > 6 && !this.stallWarned) {
        this.stallWarned = true;
        this.hud.message('Verbindung zum Host unterbrochen – versuche erneut …', 'warn', 6000);
      } else if (silent < 1) this.stallWarned = false;
    }
    v.interpolate(now, dt);
    const evs = v.takeEvents(now, (e) => e.to === v.you || e.e === 'msg' || e.e === 'xp' || e.e === 'searched' || e.e === 'tile' || e.e === 'container' || e.e === 'cremove' || e.e === 'ping');
    for (const e of evs) this.applyEvent(e, now);

    this.renderer.effects.update(dt);
    this.footsteps(dt);
    audio.listener.x = this.x;
    audio.listener.y = this.y;
    this.updateHeliAudio();

    // Darstellung
    const inv = v.inv;
    const wpn = inv && me ? activeWeapon(inv, me.active) : undefined;
    const wd = wpn ? weaponDef(wpn.id) : undefined;
    const helmet = inv?.equip.helmet;
    const fovPen = helmet && hasItemDef(helmet.id) ? (itemDef(helmet.id) as ArmorDef).fovPenalty ?? 0 : 0;
    const range = VIEW_RANGE * (this.ads && wd ? wd.adsRange : 1);
    const mo = this.input.mouseOffset();
    const z = this.renderer.cam.zoom || 1;
    let camOff = { x: 0, y: 0 };
    if (mo) {
      const lim = this.ads ? 380 : 210;
      camOff = { x: clamp((mo.x / z) * 0.38, -lim, lim), y: clamp((mo.y / z) * 0.38, -lim, lim) };
    } else {
      const lead = this.ads ? 300 : f.aimActive ? 130 : 70;
      camOff = { x: Math.cos(this.aim) * lead, y: Math.sin(this.aim) * lead };
    }
    if (this.hitmarker) this.hitmarker.t += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.renderer.draw({
      view: v,
      me: {
        id: v.you,
        x: this.x,
        y: this.y,
        aim: this.aim,
        alive,
        downed: !!me?.dn,
        color: this.opts.color,
        name: this.opts.name,
        weapon: wpn?.id ?? '',
        helmet: helmet?.id ?? '',
        armor: !!inv?.equip.armor,
        backpack: !!inv?.equip.backpack,
        ads: this.ads,
        sprint: this.sprint,
        reloading: (me?.rl ?? 0) > 0,
        acting: !!me?.act,
        fov: VIEW_FOV * (this.ads ? 0.72 : 1) - (fovPen * Math.PI) / 180,
        range,
      },
      interact: this.interact ? { x: this.interact.x, y: this.interact.y, r: this.interact.r } : null,
      spreadDeg: wd ? currentSpread(wd, this.bloom, this.moving, this.sprint, this.ads) : 2,
      aimDist: this.lastAimDist,
      throwPreview: this.throwMode,
      hitmarker: this.hitmarker,
      touch: this.opts.touch,
      mouse: mo ? { x: mo.x + window.innerWidth / 2, y: mo.y + window.innerHeight / 2 } : null,
      camOffset: camOff,
      zoomMul: this.ads && wd ? wd.adsZoom : 1,
      shake: this.shake,
      dt,
      aimAssistTarget: this.aimAssistTarget,
    });
    const ps = this.renderer.worldToScreen(this.x, this.y);
    this.input.setView(ps.x, ps.y, this.renderer.cam.zoom, this.renderer.cam.x, this.renderer.cam.y);
    const reserve = wd && inv ? ammoForCaliber(wd.caliber).reduce((s, a) => s + countItem(inv, a.id), 0) : 0;
    this.hud.update({ me, x: this.x, y: this.y, aim: this.aim, weapon: wpn?.id ?? null, mag: this.predMag, reserve, timeLeft: v.timeLeft, prompt: this.interact?.label ?? null, view: v, meId: v.you, touch: this.opts.touch });
    if (this.opts.touch) {
      this.input.setInteract(this.interact && alive ? this.interact.label : null);
      if (inv) {
        const g = [...inv.bag, ...inv.secure].filter((x) => isGrenade(itemDef(x.id))).reduce((s, x) => s + x.n, 0);
        this.input.setButtonCount('grenade', g);
      }
    }
    this.mapUi?.draw(this.x, this.y, this.aim, this.renderer.effects.pings);
    // Herzschlag bei wenig HP
    if (alive && me && me.hp / me.mhp < 0.3) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.95;
        audio.heartbeat();
      }
    }
  }

  private handleActions(f: InputFrame, alive: boolean) {
    const send = (a: PlayerAction) => this.opts.link.send({ type: 'act', a });
    for (const act of f.actions) {
      if (act === 'escape') {
        if (this.invUi?.open) this.invUi.close();
        else if (this.mapUi?.open) this.mapUi.close();
        else if (this.pauseUi) this.closePause();
        else this.openPause();
        continue;
      }
      if (act === 'pause') {
        if (this.pauseUi) this.closePause();
        else this.openPause();
        continue;
      }
      if (act === 'map') {
        this.toggleMap();
        continue;
      }
      if (act === 'extracts') {
        this.hud?.toggleExtracts();
        continue;
      }
      if (!alive) continue;
      switch (act) {
        case 'inventory':
          if (this.invUi?.open) this.invUi.close();
          else {
            this.mapUi?.close();
            this.invUi?.show();
            this.input.blocked = true;
          }
          break;
        case 'reload':
          send({ a: 'reload' });
          break;
        case 'swap':
          send({ a: 'swap' });
          break;
        case 'slot1':
          send({ a: 'swap', slot: 'primary' });
          break;
        case 'slot2':
          send({ a: 'swap', slot: 'secondary' });
          break;
        case 'heal':
          send({ a: 'quickheal' });
          break;
        case 'bandage':
        case 'stim': {
          const inv = this.view?.inv;
          const id = act === 'bandage' ? 'bandage' : 'stim';
          const it = inv && [...inv.bag, ...inv.secure].find((x) => x.id === id);
          if (it) send({ a: 'use', uid: it.uid });
          else this.hud?.message(act === 'bandage' ? 'Kein Verband dabei.' : 'Keine Adrenalin-Spritze dabei.', 'warn');
          break;
        }
        case 'grenade': {
          const d = Math.min(420, this.lastAimDist);
          send({ a: 'throw', x: this.x + Math.cos(this.aim) * d, y: this.y + Math.sin(this.aim) * d });
          break;
        }
        case 'ping': {
          const d = Math.min(600, this.lastAimDist);
          send({ a: 'ping', x: this.x + Math.cos(this.aim) * d, y: this.y + Math.sin(this.aim) * d });
          break;
        }
        case 'interact':
          if (this.invUi?.open) {
            this.invUi.close();
            break;
          }
          if (this.interact) send({ a: 'interact', kind: this.interact.kind, id: this.interact.id });
          break;
        case 'cancel':
          send({ a: 'cancel' });
          break;
      }
    }
  }

  private toggleMap() {
    if (!this.mapUi) return;
    if (this.mapUi.open) this.mapUi.close();
    else {
      this.invUi?.close();
      this.mapUi.show();
      this.input.blocked = true;
    }
  }

  private updateLocal(f: InputFrame, dt: number, now: number) {
    const v = this.view!;
    const me = v.me!;
    const inv = v.inv;
    const map = v.map;
    // Zielen
    if (f.aim !== null) {
      if (f.aimActive) this.lastAimInputT = now;
      this.aim = f.aim;
      this.lastAimDist = f.aimDist;
    } else if (this.opts.touch && (f.moveX || f.moveY) && now - this.lastAimInputT > 0.6) {
      this.aim = lerpAngle(this.aim, Math.atan2(f.moveY, f.moveX), Math.min(1, dt * 10));
    }
    // Zielhilfe (Touch/Gamepad)
    this.aimAssistTarget = null;
    if (this.opts.settings.aimAssist && (this.opts.touch || !this.input.mouseOffset()) && f.aimActive && this.renderer) {
      let best: { id: number; da: number; ang: number } | null = null;
      for (const a of v.actors.values()) {
        if (a.k !== 'b' || a.vis < 0.5 || a.f & 16) continue;
        const d = dist(this.x, this.y, a.x, a.y);
        if (d > 800) continue;
        const ang = Math.atan2(a.y - this.y, a.x - this.x);
        const da = Math.abs(angleDiff(this.aim, ang));
        if (da < 0.22 && (!best || da < best.da)) best = { id: a.i, da, ang };
      }
      if (best) {
        this.aim = lerpAngle(this.aim, best.ang, 0.65);
        this.aimAssistTarget = best.id;
      }
    }
    this.ads = f.ads && !me.dn;
    // Bewegung
    const wantMove = Math.hypot(f.moveX, f.moveY) > 0.05;
    this.sprintBlockT -= dt;
    this.sprint = f.sprint && wantMove && !this.ads && this.sprintBlockT <= 0 && !me.dn && (this.stamina > 1 || me.stim > 0);
    const speed = inv
      ? actorSpeed({ inv, sprint: this.sprint, ads: this.ads, stim: me.stim > 0, downed: me.dn, acting: !!me.act, stamina: this.stamina })
      : 150;
    const slow = TILE_FLAGS[map.tileAtWorld(this.x, this.y)] & F_SLOW ? 0.8 : 1;
    const mag = Math.min(1, Math.hypot(f.moveX, f.moveY));
    let nx = this.x;
    let ny = this.y;
    if (wantMove) {
      const p = map.moveCircle(this.x, this.y, f.moveX * speed * slow * dt, f.moveY * speed * slow * dt, PLAYER_RADIUS);
      nx = p.x;
      ny = p.y;
    }
    // weiche Kollision mit anderen
    for (const a of v.actors.values()) {
      if (a.i === v.you) continue;
      const dx = nx - a.x;
      const dy = ny - a.y;
      const d = Math.hypot(dx, dy);
      const rr = PLAYER_RADIUS * 2 - 2;
      if (d < rr && d > 0.01) {
        const p = map.moveCircle(nx, ny, (dx / d) * (rr - d) * 0.6, (dy / d) * (rr - d) * 0.6, PLAYER_RADIUS);
        nx = p.x;
        ny = p.y;
      }
    }
    const moved = Math.hypot(nx - this.x, ny - this.y);
    this.moving = moved > 0.2 && mag > 0.05;
    this.x = nx;
    this.y = ny;
    if (this.sprint && this.moving && me.stim <= 0) this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
    else this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN * dt * (me.stim > 0 ? 3 : 1));
    // eigene Schritte
    this.stepAcc += moved;
    if (this.stepAcc > (this.sprint ? 62 : 46)) {
      this.stepAcc = 0;
      audio.footstep(this.x, this.y, true, !this.sprint);
    }
    // Schießen (vorhergesagt)
    this.cooldown = Math.max(-0.05, this.cooldown - dt);
    const w = inv ? activeWeapon(inv, me.active) : undefined;
    const wd = w ? weaponDef(w.id) : undefined;
    if (wd) this.bloom = Math.max(0, this.bloom - wd.recover * dt);
    this.throwMode = false;
    const blocked = this.input.blocked || this.paused;
    const canFire = !!wd && !me.dn && !me.act && me.rl <= 0 && me.eq <= 0 && !blocked;
    if (wd && w) {
      const touchSemi = (this.opts.touch || !this.input.mouseOffset()) && f.fire;
      if (f.firePressed && !wd.auto) this.semiQueued = true;
      const want = wd.auto ? f.fire : this.semiQueued || touchSemi;
      if (want && canFire) {
        if (this.sprint) {
          this.sprint = false;
          this.sprintBlockT = 0.25;
        }
        if (this.predMag <= 0) {
          if (f.firePressed || (wd.auto && f.fire && now - this.lastShotT > 0.4)) {
            audio.dry();
            this.lastShotT = now;
            if (this.opts.settings.autoReload) this.opts.link.send({ type: 'act', a: { a: 'reload' } });
          }
          this.semiQueued = false;
        } else if (this.cooldown <= 0) {
          const ammo = ammoDef(w.ammo ?? ammoForCaliber(wd.caliber)[0].id);
          const spread = currentSpread(wd, this.bloom, this.moving, false, this.ads);
          const angles = shotAngles(this.aim, spread, ammo.pellets, rngLocal);
          this.shots.push(angles.map((a) => Math.round(a * 10000) / 10000));
          this.predMag--;
          this.cooldown += 60 / wd.rpm;
          if (this.cooldown < 0) this.cooldown = 0;
          this.bloom = Math.min(wd.bloomMax, this.bloom + wd.bloom);
          this.lastShotT = now;
          this.semiQueued = false;
          const mx = this.x + Math.cos(this.aim) * (PLAYER_RADIUS + 12);
          const my = this.y + Math.sin(this.aim) * (PLAYER_RADIUS + 12);
          const fx = map.canSee(this.x, this.y, mx, my) ? mx : this.x;
          const fy = fx === mx ? my : this.y;
          const fxr = this.renderer!.effects;
          fxr.muzzle(fx, fy, this.aim, wd.wclass === 'shotgun' || wd.wclass === 'sniper');
          for (const a of angles) fxr.tracer(null, fx, fy, a, wd.bulletSpeed, wd.range, ammo.tracer, true);
          audio.gunshot(wd.wclass, this.x, this.y, true);
          this.shake = Math.max(this.shake, wd.wclass === 'sniper' || wd.wclass === 'shotgun' ? 6 : 2.5);
          if (this.opts.touch) this.input.vibrate(wd.wclass === 'shotgun' || wd.wclass === 'sniper' ? 25 : 8);
        }
      }
      if (!f.fire && wd.auto) this.semiQueued = false;
    }
    // Interaktionsziel
    this.interact = this.findInteract();
  }

  private findInteract(): InteractTarget | null {
    const v = this.view!;
    const me = v.me;
    if (!me || me.dn) return null;
    const map = v.map;
    // Wiederbeleben
    for (const a of v.actors.values()) {
      if (a.k !== 'p' || a.i === v.you || !(a.f & 16)) continue;
      if (dist(this.x, this.y, a.x, a.y) < INTERACT_RANGE) return { kind: 'revive', id: a.i, label: `Wiederbeleben: ${a.n}`, x: a.x, y: a.y, r: 14 };
    }
    // Behälter
    let best: InteractTarget | null = null;
    let bd = INTERACT_RANGE;
    for (const c of v.containers.values()) {
      const d = dist(this.x, this.y, c.x, c.y);
      if (d >= bd) continue;
      if (!map.clearLine(this.x, this.y, c.x, c.y, F_SIGHT)) continue;
      bd = d;
      const verb = c.kind === 'corpse' ? 'Plündern' : c.kind === 'drop' ? 'Aufheben' : c.searched ? 'Öffnen' : 'Durchsuchen';
      best = { kind: 'container', id: c.id, label: `${verb}: ${c.name}${c.searched && c.empty ? ' (leer)' : ''}`, x: c.x, y: c.y, r: 14 };
    }
    if (best) return best;
    // Verschlossene Türen
    for (const lock of map.locks) {
      const [tx, ty] = lock.tiles[0];
      if (map.get(tx, ty) !== T.DOOR_LOCKED) continue;
      for (const [lx, ly] of lock.tiles) {
        const cx = (lx + 0.5) * TILE;
        const cy = (ly + 0.5) * TILE;
        if (dist(this.x, this.y, cx, cy) < INTERACT_RANGE + 14) {
          const has = v.inv ? hasKey(v.inv, lock.keyId) : false;
          return { kind: 'door', id: lock.id, label: `Aufschließen: ${lock.name}${has ? '' : ' (Schlüssel fehlt)'}`, x: cx, y: cy, r: 18 };
        }
      }
    }
    // Heli-Funk
    for (const ex of map.extracts) {
      if (ex.kind !== 'heli') continue;
      if (dist(this.x, this.y, ex.x, ex.y) > ex.r) continue;
      const st = v.extractState(ex.id);
      if (st?.heli?.phase === 'idle') return { kind: 'radio', id: ex.id, label: 'Heli per Funk rufen', x: ex.x, y: ex.y, r: 30 };
    }
    return null;
  }

  private applyEvent(e: GameEvent, now: number) {
    const v = this.view!;
    const fx = this.renderer!.effects;
    const hud = this.hud!;
    const you = v.you;
    switch (e.e) {
      case 'shot': {
        if (e.id === you) break;
        let wclass: ReturnType<typeof weaponDef>['wclass'] = 'ar';
        if (hasItemDef(e.w)) wclass = weaponDef(e.w).wclass;
        fx.muzzle(e.x, e.y, e.a, wclass === 'shotgun' || wclass === 'sniper');
        audio.gunshot(wclass, e.x, e.y);
        break;
      }
      case 'bullet':
        if (e.id === you) break;
        this.otherBullets.add(e.b);
        if (this.otherBullets.size > 600) this.otherBullets = new Set([...this.otherBullets].slice(-300));
        fx.tracer(e.b, e.x, e.y, e.a, e.s, e.r, e.tr, false);
        break;
      case 'hit': {
        const target = v.actors.get(e.id);
        if (target) target.hitT = 0;
        const ang = Math.atan2(e.y - (target?.y ?? e.y), e.x - (target?.x ?? e.x)) + Math.PI;
        if (e.ar) fx.sparks(e.x, e.y, 7, '#cfe8ff');
        else fx.blood(e.x, e.y, ang + Math.PI);
        if (e.by === you) {
          fx.killNearestOwn(e.x, e.y);
          this.hitmarker = { t: 0, head: e.hd, kill: e.k };
          audio.hitmarker(e.hd, e.k);
          if (e.ar) audio.armorHit();
        } else {
          fx.killTracer(e.b);
          if (e.id !== you) audio.flesh(e.x, e.y);
        }
        break;
      }
      case 'impact': {
        const metal = e.m === T.WALL_METAL || e.m === T.LOW;
        if (this.otherBullets.has(e.b)) fx.killTracer(e.b);
        fx.dust(e.x, e.y);
        if (metal) fx.sparks(e.x, e.y, 4);
        fx.decal(e.x, e.y, 1.6, 'hole');
        if (dist(e.x, e.y, this.x, this.y) < 500) audio.impact(e.x, e.y, metal);
        break;
      }
      case 'death': {
        fx.decal(e.x, e.y, 16, 'blood');
        const mine = e.by === you;
        hud.kill(e.killer, e.name, e.w, mine, e.hd);
        break;
      }
      case 'reload':
        audio.reload(e.x, e.y, e.id === you);
        break;
      case 'dry':
        audio.dry();
        break;
      case 'swap':
        if (e.id === you) audio.ui('click');
        break;
      case 'heal':
        if (e.id === you) audio.ui('pickup');
        break;
      case 'throw':
        fx.nade(e.g, e.x, e.y, e.vx, e.vy, e.ft, e.fuse);
        break;
      case 'explode': {
        fx.removeNade(e.g);
        fx.explosion(e.x, e.y, e.r);
        audio.explosion(e.x, e.y);
        const d = dist(e.x, e.y, this.x, this.y);
        if (d < 600) this.shake = Math.max(this.shake, 16 * (1 - d / 600));
        break;
      }
      case 'extracted':
        if (e.id !== you) hud.message(`${e.name} ist extrahiert (${e.ex}).`, 'good');
        break;
      case 'downed':
        if (e.id === you) hud.message('Du bist am Boden! Ein Teamkamerad kann dich wiederbeleben.', 'warn', 6000);
        break;
      case 'revived':
        if (e.id === you) {
          hud.message('Du wurdest wiederbelebt!', 'good');
          audio.ui('good');
        }
        break;
      case 'tile':
        v.map.set(e.tx, e.ty, e.v);
        this.renderer!.painter.invalidateTile(e.tx, e.ty);
        break;
      case 'msg':
        hud.message(e.text, e.kind ?? 'info');
        if (e.kind === 'warn') audio.ui('beep');
        break;
      case 'ping': {
        const sq = v.info.squad.find((s) => s.id === e.by);
        fx.pings.push({ x: e.x, y: e.y, t: now, name: e.name, color: sq?.color ?? '#f0c860' });
        audio.ui('beep');
        break;
      }
      case 'container':
        v.containers.set(e.c.id, { ...e.c });
        break;
      case 'cremove':
        v.containers.delete(e.c);
        break;
      case 'xp':
        hud.message(`+${e.amount} XP · ${e.reason}`, 'xp', 2500);
        break;
      case 'searched': {
        const c = v.containers.get(e.c);
        if (c) {
          c.searched = true;
          c.empty = e.empty;
        }
        break;
      }
      case 'heli':
        break;
      case 'noise':
        break;
    }
  }

  private footsteps(_dt: number) {
    const v = this.view!;
    for (const a of v.actors.values()) {
      if (a.i === v.you) continue;
      const d = dist(a.x, a.y, this.x, this.y);
      if (d > 480) continue;
      a.stepAcc += Math.hypot(a.x - a.px, a.y - a.py);
      const sprint = (a.f & 1) !== 0;
      if (a.stepAcc > (sprint ? 60 : 44)) {
        a.stepAcc = 0;
        audio.footstep(a.x, a.y, false, !sprint);
      }
    }
  }

  private updateHeliAudio() {
    const v = this.view!;
    let active = false;
    for (const ex of v.map.extracts) {
      if (ex.kind !== 'heli') continue;
      const st = v.extractState(ex.id);
      if (st?.heli && (st.heli.phase === 'landed' || (st.heli.phase === 'inbound' && st.heli.t < 15))) {
        active = true;
        audio.setHeli(true, ex.x, ex.y);
      }
    }
    if (!active) audio.setHeli(false);
  }

  private showControlsHint() {
    const rows = this.opts.touch
      ? [
          ['Linker Daumen', 'Bewegen – über den Rand ziehen zum Sprinten'],
          ['Rechter Daumen', 'Zielen – weit auslenken zum Schießen'],
          ['Gelber Knopf', 'Durchsuchen, Plündern, Türen, Heli-Funk'],
          ['Tasche / Karte', 'oben rechts · Timer antippen = Extraktionen'],
        ]
      : [
          ['WASD · Shift', 'Bewegen · Sprinten'],
          ['Maus · Rechtsklick', 'Zielen/Feuern · genau zielen'],
          ['E · Tab', 'Durchsuchen/Interagieren · Inventar'],
          ['R · H · G', 'Nachladen · Heilen · Granate'],
          ['M · O', 'Karte · Extraktionen'],
        ];
    const box = h(
      'div',
      { class: 'panel', style: { position: 'absolute', left: '50%', top: '22%', transform: 'translateX(-50%)', padding: '12px 16px', pointerEvents: 'auto', maxWidth: '92vw', zIndex: '15' } },
      h('h2', { style: { marginBottom: '6px' } }, 'Steuerung'),
      h('div', { class: 'kv small' }, rows.flatMap(([k, v]) => [h('div', { class: 'accent' }, k), h('div', null, v)])),
      h('div', { class: 'tiny muted', style: { marginTop: '6px' } }, 'Ziel: Beute finden und lebend eine Extraktion erreichen. Tippen zum Schließen.'),
    );
    box.addEventListener('pointerdown', () => box.remove());
    this.root.appendChild(box);
    setTimeout(() => box.remove(), 12000);
  }

  // ---- Debug-Hilfen für automatisierte Tests ----
  get debugInfo() {
    const v = this.view;
    return {
      ready: this.ready,
      finished: this.finished,
      x: this.x,
      y: this.y,
      you: v?.you,
      hp: v?.me?.hp,
      actors: v ? [...v.actors.values()].map((a) => ({ i: a.i, k: a.k, x: Math.round(a.x), y: Math.round(a.y), n: a.n })) : [],
      containers: v?.containers.size ?? 0,
    };
  }

  debugTeleport(x: number, y: number) {
    this.x = x;
    this.y = y;
    const world = (this.opts.link as { world?: { actors: Map<number, { x: number; y: number }> } }).world;
    const a = world && this.view ? world.actors.get(this.view.you) : undefined;
    if (a) {
      a.x = x;
      a.y = y;
    }
  }

  // ------------------------------------------------------------------
  private openPause() {
    if (this.pauseUi || this.finished) return;
    const coop = this.opts.link.coop;
    if (!coop) {
      this.opts.link.paused = true;
      this.paused = true;
    }
    this.input.blocked = true;
    const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(this.opts.settings.volume) }) as HTMLInputElement;
    vol.addEventListener('input', () => {
      this.opts.settings.volume = Number(vol.value);
      audio.setVolume(this.opts.settings.volume);
    });
    const box = h(
      'div',
      { class: 'box panel', style: { padding: '18px' } },
      h('h2', null, coop ? 'Menü (Coop läuft weiter!)' : 'Pausiert'),
      h('button', { class: 'btn primary big', onclick: () => this.closePause() }, 'Weiter'),
      h('div', { class: 'form-row' }, h('label', null, 'Lautstärke'), vol),
      h('div', { class: 'small muted' }, this.opts.touch ? 'Linker Stick: Bewegen (über den Rand = Sprinten) · Rechter Stick: Zielen (weit = Feuer)' : 'WASD Bewegen · Shift Sprinten · Maus Zielen/Feuern · Rechtsklick Zielen · R Nachladen · E Interagieren · Tab Inventar · H Heilen · G Granate · M Karte · O Extraktionen · Z Markieren'),
      h(
        'button',
        {
          class: 'btn danger',
          onclick: async () => {
            const ok = await confirmDialog('Raid wirklich verlassen? Deine gesamte Ausrüstung geht verloren (außer dem sicheren Behälter).', 'Verlassen');
            if (ok) this.abandon();
          },
        },
        'Raid verlassen',
      ),
    );
    this.pauseUi = h('div', { class: 'overlay pause-menu', style: { pointerEvents: 'auto' } }, box);
    this.root.appendChild(this.pauseUi);
  }

  private closePause() {
    if (!this.pauseUi) return;
    this.pauseUi.remove();
    this.pauseUi = null;
    this.opts.link.paused = false;
    this.paused = false;
    this.input.blocked = !!(this.invUi?.open || this.mapUi?.open);
    this.lastT = performance.now();
  }

  private finish(r: RaidResult) {
    if (this.finished) return;
    this.finished = true;
    this.input.setTouchVisible(false);
    this.invUi?.close();
    this.mapUi?.close();
    const text = r.status === 'extracted' ? 'EXTRAHIERT' : r.status === 'killed' ? 'GEFALLEN' : 'VERMISST';
    const banner = h('div', { class: 'overlay', style: { alignItems: 'center', background: 'rgba(0,0,0,0.45)' } }, h('div', { class: 'result-banner ' + r.status }, text));
    this.root.appendChild(banner);
    audio.ui(r.status === 'extracted' ? 'good' : 'bad');
    setTimeout(() => {
      this.dispose();
      this.opts.onFinish(r);
    }, 1800);
  }

  private abandon() {
    this.finished = true;
    this.dispose();
    this.opts.onAbandon();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.view = null;
    this.opts.link.close();
    this.input.dispose();
    this.hud?.destroy();
    this.root.remove();
    audio.stopAll();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVis);
    document.body.classList.remove('in-raid');
    const g = this.opts.canvas.getContext('2d');
    g?.setTransform(1, 0, 0, 1, 0, 0);
    g?.clearRect(0, 0, this.opts.canvas.width, this.opts.canvas.height);
  }
}
