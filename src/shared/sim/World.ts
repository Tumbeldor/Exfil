import {
  DOWNED_TIME,
  EXTRACT_TIME,
  HEAD_CHANCE,
  INTERACT_RANGE,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  REVIVE_TIME,
  STAMINA_DRAIN,
  STAMINA_MAX,
  STAMINA_REGEN,
  TILE,
} from '../constants';
import {
  type EquipSlot,
  type Inventory,
  type ListName,
  addToList,
  addUnchecked,
  allItems,
  bagCapacity,
  cloneInventory,
  consumeItem,
  countItem,
  emptyInventory,
  equipFromList,
  findItem,
  hasKey,
  inventoryValue,
  listCapacity,
  slotForDef,
  takeFromInventory,
  takeFromList,
  unequipToBag,
} from '../inventory';
import {
  type ItemStack,
  type MedDef,
  ammoDef,
  ammoForCaliber,
  createItem,
  isAmmo,
  isGrenade,
  isMed,
  itemDef,
  weaponDef,
  GRENADES,
} from '../items';
import { type BotType, botLoadout, rollContainer, rollLooseLoot } from '../loot';
import { clamp, dist, dist2, segmentCircle } from '../math';
import { CONTAINER_NAMES, F_BULLET, F_MOVE, type GameMap } from '../map/GameMap';
import { buildMap } from '../map/maps';
import { Navigator } from '../map/nav';
import { T } from '../map/tiles';
import { Rng } from '../rng';
import { onBotDamaged, makeBrain, updateBot, alertNoise } from './ai';
import { actorSpeed, activeWeapon, computeHit, currentSpread, shotAngles } from './combat';
import type {
  Actor,
  Bullet,
  Container,
  ContainerInfo,
  ExtractState,
  GameEvent,
  Grenade,
  PlayerAction,
  PlayerInput,
  RaidResult,
  RaidStats,
  XpBreakdown,
} from './types';

export interface WorldConfig {
  mapId: string;
  seed: number;
  /** 0 leicht, 1 normal, 2 schwer */
  difficulty: number;
  players: number;
  friendlyFire: boolean;
}

export interface PlayerJoin {
  name: string;
  inv: Inventory;
  level: number;
  color: string;
  regen: number;
  /** Plünderer-Einsatz */
  scav?: boolean;
}

export const XP_KILL: Record<BotType | 'player', number> = { scav: 150, pmc: 400, guard: 450, boss: 2000, player: 0 };
const BOT_HP: Record<BotType, number> = { scav: 100, pmc: 110, guard: 130, boss: 320 };
const BOT_NAMES: Record<BotType, string> = { scav: 'Plünderer', pmc: 'Söldner', guard: 'Wache', boss: 'Boss' };

const emptyStats = (): RaidStats => ({
  kills: { scav: 0, pmc: 0, guard: 0, boss: 0 },
  killLog: [],
  searched: {},
  bodies: 0,
  visited: [],
  damage: 0,
  shots: 0,
  hits: 0,
  heliCalls: 0,
  revives: 0,
  startValue: 0,
});

export class World {
  readonly cfg: WorldConfig;
  readonly map: GameMap;
  readonly nav: Navigator;
  readonly rng: Rng;
  t = 0;
  timeLeft: number;
  actors = new Map<number, Actor>();
  bullets: Bullet[] = [];
  grenades: Grenade[] = [];
  containers = new Map<number, Container>();
  extracts: ExtractState[] = [];
  events: GameEvent[] = [];
  results = new Map<number, RaidResult>();
  ended = false;
  extractsDirty = true;
  pathBudget = 0;
  private nextActor = 1;
  private nextBullet = 1;
  private nextGrenade = 1;
  private nextContainer = 10000;
  private nextSquad = 1;
  private waveT: number;
  private spawnIndex: number;
  private spawnCount = 0;

  constructor(cfg: WorldConfig) {
    this.cfg = cfg;
    this.map = buildMap(cfg.mapId);
    this.nav = new Navigator(this.map);
    this.rng = new Rng(cfg.seed);
    this.timeLeft = this.map.meta.raidTime;
    this.waveT = 150 + this.rng.range(0, 60);
    this.spawnIndex = this.rng.int(0, this.map.playerSpawns.length - 1);

    // Extraktionen für diesen Raid würfeln
    for (const def of this.map.extracts) {
      let open = true;
      if (def.kind === 'chance') open = this.rng.next() < (def.chance ?? 0.5);
      if (def.kind === 'timed') open = false;
      this.extracts.push({ def, open, heli: def.kind === 'heli' ? { phase: 'idle', t: 0 } : null });
    }

    // Behälter befüllen
    for (const s of this.map.containers) {
      if (s.chance !== undefined && this.rng.next() > s.chance) continue;
      const c: Container = {
        id: s.id,
        kind: s.kind,
        name: CONTAINER_NAMES[s.kind],
        x: (s.tx + 0.5) * TILE,
        y: (s.ty + 0.5) * TILE,
        tier: s.tier,
        items: rollContainer(s.kind, s.tier, this.rng),
        searched: [],
        version: 0,
      };
      this.containers.set(c.id, c);
    }
    for (const l of this.map.lootSpots) {
      if (this.rng.chance(0.4)) continue;
      const it = rollLooseLoot(l.tier, this.rng);
      if (!it) continue;
      const id = this.nextContainer++;
      this.containers.set(id, {
        id,
        kind: 'drop',
        name: itemDef(it.id).name,
        x: (l.tx + 0.5) * TILE + this.rng.range(-6, 6),
        y: (l.ty + 0.5) * TILE + this.rng.range(-6, 6),
        tier: l.tier,
        items: [it],
        searched: [],
        version: 0,
      });
    }
    this.spawnInitialBots();
  }

  // ------------------------------------------------------------------
  // Hilfsfunktionen
  // ------------------------------------------------------------------
  emit(ev: GameEvent) {
    ev.t = this.t;
    this.events.push(ev);
  }
  msg(to: number | undefined, text: string, kind: 'info' | 'warn' | 'good' | 'quest' = 'info') {
    this.emit({ e: 'msg', text, kind, to });
  }

  players(): Actor[] {
    const out: Actor[] = [];
    for (const a of this.actors.values()) if (a.kind === 'player') out.push(a);
    return out;
  }

  /** Feindschaft unter Berücksichtigung des Plünderer-Einsatzes. */
  hostile(a: Actor, b: Actor) {
    if (a.team === b.team) return false;
    const p = a.kind === 'player' ? a : b;
    const bot = a.kind === 'player' ? b : a;
    if (p.scav && !p.scavAngry && bot.botType === 'scav') return false;
    return true;
  }

  containerInfos(): ContainerInfo[] {
    return [...this.containers.values()].map((c) => this.containerInfo(c));
  }
  containerInfo(c: Container): ContainerInfo {
    return { id: c.id, kind: c.kind, name: c.name, x: c.x, y: c.y, rot: c.rot, owner: c.owner };
  }

  private newActor(p: Partial<Actor> & Pick<Actor, 'kind' | 'team' | 'name' | 'x' | 'y' | 'inv' | 'maxHp'>): Actor {
    const a: Actor = {
      id: this.nextActor++,
      r: PLAYER_RADIUS,
      aim: 0,
      vx: 0,
      vy: 0,
      hp: p.maxHp,
      alive: true,
      downed: false,
      downedT: 0,
      bleeding: false,
      stamina: STAMINA_MAX,
      invVersion: 1,
      active: p.inv.equip.primary ? 'primary' : 'secondary',
      ws: { cooldown: 0, reloadT: 0, reloadTotal: 0, bloom: 0, equipT: 0 },
      action: null,
      stimT: 0,
      sprint: false,
      ads: false,
      moving: false,
      lastDamageT: -99,
      lastAttacker: null,
      extracted: false,
      extractT: 0,
      extractId: null,
      viewing: null,
      stats: null,
      brain: null,
      color: '#7fb069',
      level: 1,
      regen: 0,
      lastInputT: 0,
      connected: true,
      scav: false,
      scavAngry: false,
      ...p,
    };
    this.actors.set(a.id, a);
    return a;
  }

  // ------------------------------------------------------------------
  // Spieler
  // ------------------------------------------------------------------
  addPlayer(join: PlayerJoin): Actor {
    const sp = this.map.playerSpawns[this.spawnIndex];
    const k = this.spawnCount++;
    const ang = k * 2.1;
    let x = sp.x + (k ? Math.cos(ang) * 40 : 0);
    let y = sp.y + (k ? Math.sin(ang) * 40 : 0);
    if (this.map.circleBlocked(x, y, PLAYER_RADIUS)) {
      x = sp.x;
      y = sp.y;
    }
    const a = this.newActor({
      kind: 'player',
      team: 'player',
      name: join.name,
      x,
      y,
      inv: cloneInventory(join.inv),
      maxHp: PLAYER_MAX_HP,
      color: join.color,
      level: join.level,
      regen: join.regen,
      lastInputT: this.t,
      scav: !!join.scav,
    });
    a.aim = Math.atan2(this.map.pixelH / 2 - y, this.map.pixelW / 2 - x);
    a.stats = emptyStats();
    a.stats.startValue = inventoryValue(a.inv);
    return a;
  }

  /** Spielerbewegung (Client-autoritativ, aber plausibilisiert). Gibt Korrekturposition zurück, falls abgelehnt. */
  applyInput(id: number, inp: PlayerInput): { x: number; y: number } | undefined {
    const a = this.actors.get(id);
    if (!a || !a.alive || a.extracted) return;
    const elapsed = clamp(this.t - a.lastInputT, 1 / 30, 0.6);
    a.lastInputT = this.t;
    const speed = actorSpeed({
      inv: a.inv,
      sprint: true,
      ads: false,
      stim: a.stimT > 0,
      downed: a.downed,
      acting: false,
      stamina: STAMINA_MAX,
    });
    let corr: { x: number; y: number } | undefined;
    if (Number.isFinite(inp.x) && Number.isFinite(inp.y)) {
      const d = dist(a.x, a.y, inp.x, inp.y);
      const allowed = speed * elapsed * 1.6 + 26;
      if (d > allowed || this.map.circleBlocked(inp.x, inp.y, a.r - 2)) {
        corr = { x: a.x, y: a.y };
      } else {
        a.vx = (inp.x - a.x) / elapsed;
        a.vy = (inp.y - a.y) / elapsed;
        a.x = inp.x;
        a.y = inp.y;
      }
    }
    if (Number.isFinite(inp.aim)) a.aim = inp.aim;
    a.sprint = !!inp.sprint && !a.downed;
    a.ads = !!inp.ads && !a.downed;
    a.moving = !!inp.moving;
    if (inp.shots && inp.shots.length) {
      for (const angles of inp.shots.slice(0, 6)) this.playerFire(a, angles);
    }
    return corr;
  }

  private canFire(a: Actor): boolean {
    if (!a.alive || a.downed || a.extracted) return false;
    if (a.ws.reloadT > 0 || a.ws.equipT > 0) return false;
    return a.action === null;
  }

  private playerFire(a: Actor, angles: number[]) {
    if (!this.canFire(a)) return;
    const w = activeWeapon(a.inv, a.active);
    if (!w) return;
    const wd = weaponDef(w.id);
    const interval = 60 / wd.rpm;
    if (a.ws.cooldown > interval * 0.35) return;
    if ((w.mag ?? 0) <= 0) {
      this.emit({ e: 'dry', id: a.id, to: a.id });
      return;
    }
    const ammo = ammoDef(w.ammo!);
    const valid = angles.filter((x) => Number.isFinite(x) && Math.abs(((x - a.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.6);
    if (!valid.length) return;
    this.fireWeapon(a, w, valid.slice(0, ammo.pellets));
    a.ws.cooldown += interval * 0.9;
    if (a.stats) a.stats.shots++;
  }

  /** Erzeugt Projektile für einen Schuss. */
  fireWeapon(a: Actor, w: ItemStack, angles: number[]) {
    const wd = weaponDef(w.id);
    const ammo = ammoDef(w.ammo!);
    w.mag = (w.mag ?? 0) - 1;
    a.ws.bloom = Math.min(wd.bloomMax, a.ws.bloom + wd.bloom);
    const muzzle = a.r + 10;
    const mx = a.x + Math.cos(a.aim) * muzzle;
    const my = a.y + Math.sin(a.aim) * muzzle;
    // Mündung in der Wand? Dann vom Körper aus schießen
    const sx = this.map.clearLine(a.x, a.y, mx, my, F_BULLET) ? mx : a.x;
    const sy = sx === mx ? my : a.y;
    this.emit({ e: 'shot', id: a.id, x: sx, y: sy, a: a.aim, w: w.id });
    for (const ang of angles) {
      const b: Bullet = {
        id: this.nextBullet++,
        owner: a.id,
        team: a.team,
        x: sx,
        y: sy,
        dx: Math.cos(ang),
        dy: Math.sin(ang),
        speed: wd.bulletSpeed,
        range: wd.range,
        traveled: 0,
        dmg: ammo.dmg * wd.dmgMult,
        pen: ammo.pen,
        armorDmg: ammo.armorDmg,
        weapon: w.id,
        ignoreLow: 46,
      };
      this.bullets.push(b);
      this.emit({ e: 'bullet', b: b.id, id: a.id, x: sx, y: sy, a: ang, s: b.speed, r: b.range, tr: ammo.tracer });
    }
    alertNoise(this, a.x, a.y, wd.noise, a);
  }

  /** Bot schießt mit berechneter Streuung. */
  botFire(a: Actor, aimError: number) {
    const w = activeWeapon(a.inv, a.active);
    if (!w || !this.canFire(a)) return false;
    const wd = weaponDef(w.id);
    if ((w.mag ?? 0) <= 0) {
      this.startReload(a);
      return false;
    }
    if (a.ws.cooldown > 0) return false;
    const ammo = ammoDef(w.ammo!);
    const base = a.aim + this.rng.gauss(aimError);
    const angles = shotAngles(base, currentSpread(wd, a.ws.bloom, a.moving, false, false), ammo.pellets, this.rng);
    this.fireWeapon(a, w, angles);
    a.ws.cooldown += 60 / wd.rpm;
    return true;
  }

  invChanged(a: Actor) {
    a.invVersion++;
  }

  // ------------------------------------------------------------------
  // Aktionen
  // ------------------------------------------------------------------
  doAction(id: number, act: PlayerAction) {
    const a = this.actors.get(id);
    if (!a || !a.alive || a.extracted) return;
    if (a.downed && act.a !== 'ping' && act.a !== 'close') return;
    switch (act.a) {
      case 'reload':
        this.startReload(a, act.ammo);
        break;
      case 'swap':
        this.swapWeapon(a, act.slot);
        break;
      case 'use':
        this.useItem(a, act.uid);
        break;
      case 'quickheal':
        this.quickHeal(a);
        break;
      case 'interact':
        this.interact(a, act.kind, act.id);
        break;
      case 'take':
        this.take(a, act.c, act.uid, act.n, act.to);
        break;
      case 'takeAll':
        this.takeAll(a, act.c);
        break;
      case 'put':
        this.put(a, act.c, act.uid, act.n);
        break;
      case 'move':
        this.moveItem(a, act.uid, act.to);
        break;
      case 'equip': {
        const r = equipFromList(a.inv, act.uid);
        if (!r.ok) this.msg(a.id, r.reason ?? 'Nicht möglich', 'warn');
        else this.afterEquipChange(a);
        break;
      }
      case 'unequip': {
        const r = unequipToBag(a.inv, act.slot);
        if (!r.ok) this.msg(a.id, r.reason ?? 'Kein Platz', 'warn');
        else this.afterEquipChange(a);
        break;
      }
      case 'drop':
        this.drop(a, act.uid, act.n);
        break;
      case 'throw':
        this.throwGrenade(a, act.x, act.y);
        break;
      case 'ping':
        this.emit({ e: 'ping', x: act.x, y: act.y, by: a.id, name: a.name });
        break;
      case 'close':
        a.viewing = null;
        break;
      case 'cancel':
        if (a.action && a.action.type !== 'selfrevive') a.action = null;
        break;
    }
  }

  private afterEquipChange(a: Actor) {
    if (!a.inv.equip[a.active]) a.active = a.inv.equip.primary ? 'primary' : 'secondary';
    a.ws.reloadT = 0;
    this.invChanged(a);
  }

  startReload(a: Actor, ammoId?: string) {
    if (a.ws.reloadT > 0 || a.downed) return;
    const w = activeWeapon(a.inv, a.active);
    if (!w) return;
    const wd = weaponDef(w.id);
    if (a.kind === 'player') {
      const wanted = ammoId && isAmmo(itemDef(ammoId)) && ammoDef(ammoId).caliber === wd.caliber ? ammoId : undefined;
      const options = ammoForCaliber(wd.caliber).map((x) => x.id);
      const have = (id: string) => countItem(a.inv, id) > 0;
      const pick = wanted && have(wanted) ? wanted : w.ammo && have(w.ammo) ? w.ammo : options.find(have);
      if (!pick) {
        this.msg(a.id, 'Keine passende Munition (' + wd.caliber + ')', 'warn');
        return;
      }
      if (pick === w.ammo && (w.mag ?? 0) >= wd.mag) return;
      a.ws.reloadAmmo = pick;
    } else if ((w.mag ?? 0) >= wd.mag) return;
    a.ws.reloadT = wd.reload * (a.kind === 'bot' ? 1.15 : 1);
    a.ws.reloadTotal = a.ws.reloadT;
    if (a.action?.type === 'heal') a.action = null;
    this.emit({ e: 'reload', id: a.id, w: w.id, x: a.x, y: a.y });
  }

  private finishReload(a: Actor) {
    const w = activeWeapon(a.inv, a.active);
    if (!w) return;
    const wd = weaponDef(w.id);
    if (a.kind === 'bot') {
      w.mag = wd.mag;
      return;
    }
    const pick = a.ws.reloadAmmo ?? w.ammo!;
    if (pick !== w.ammo && (w.mag ?? 0) > 0) {
      addUnchecked(a.inv.bag, createItem(w.ammo!, w.mag!));
      w.mag = 0;
    }
    w.ammo = pick;
    const need = wd.mag - (w.mag ?? 0);
    const got = consumeItem(a.inv, pick, need);
    w.mag = (w.mag ?? 0) + got;
    a.ws.reloadAmmo = undefined;
    this.invChanged(a);
  }

  swapWeapon(a: Actor, slot?: 'primary' | 'secondary') {
    const target = slot ?? (a.active === 'primary' ? 'secondary' : 'primary');
    if (!a.inv.equip[target] || target === a.active) return;
    a.active = target;
    a.ws.reloadT = 0;
    a.ws.bloom = 0;
    const wd = weaponDef(a.inv.equip[target]!.id);
    a.ws.equipT = wd.equip;
    this.emit({ e: 'swap', id: a.id, w: wd.id });
    this.invChanged(a);
  }

  useItem(a: Actor, uid: string) {
    const f = findItem(a.inv, uid);
    if (!f || f.where === 'equip') return;
    const d = itemDef(f.item.id);
    if (isMed(d)) {
      if (d.revive) {
        this.msg(a.id, 'Wird automatisch eingesetzt, wenn du zu Boden gehst.', 'info');
        return;
      }
      if (a.action) return;
      if (!d.stim && d.heal > 0 && a.hp >= a.maxHp && !(d.stopsBleed && a.bleeding)) {
        this.msg(a.id, 'Du bist nicht verletzt.', 'info');
        return;
      }
      if (!d.stim && d.heal === 0 && d.stopsBleed && !a.bleeding) {
        this.msg(a.id, 'Du blutest nicht.', 'info');
        return;
      }
      a.ws.reloadT = 0;
      a.action = { type: 'heal', t: 0, total: d.useTime, item: uid };
      this.emit({ e: 'heal', id: a.id, item: d.id });
    } else if (isGrenade(d)) {
      this.throwGrenade(a, a.x + Math.cos(a.aim) * 320, a.y + Math.sin(a.aim) * 320);
    } else if (isAmmo(d)) {
      this.startReload(a, d.id);
    } else if (slotForDef(d)) {
      const r = equipFromList(a.inv, uid);
      if (r.ok) this.afterEquipChange(a);
      else this.msg(a.id, r.reason ?? 'Nicht möglich', 'warn');
    }
  }

  quickHeal(a: Actor) {
    if (a.action) return;
    const meds = [...a.inv.bag, ...a.inv.secure].filter((it) => isMed(itemDef(it.id)));
    const def = (it: ItemStack) => itemDef(it.id) as MedDef;
    let pick: ItemStack | undefined;
    if (a.bleeding) pick = meds.find((m) => m.id === 'bandage') ?? meds.find((m) => def(m).stopsBleed && !def(m).revive);
    if (!pick && a.hp < a.maxHp) {
      const missing = a.maxHp - a.hp;
      const healers = meds.filter((m) => def(m).heal > 0 && !def(m).stim && !def(m).revive).sort((x, y) => def(x).heal - def(y).heal);
      pick = healers.find((m) => def(m).heal >= missing * 0.8) ?? healers[healers.length - 1];
    }
    if (!pick) {
      this.msg(a.id, a.hp >= a.maxHp && !a.bleeding ? 'Keine Heilung nötig.' : 'Keine passende Medizin!', 'warn');
      return;
    }
    this.useItem(a, pick.uid);
  }

  private finishHeal(a: Actor) {
    const uid = a.action?.item;
    if (!uid) return;
    const f = findItem(a.inv, uid);
    if (!f) return;
    const d = itemDef(f.item.id) as MedDef;
    a.hp = Math.min(a.maxHp, a.hp + d.heal);
    if (d.stopsBleed) a.bleeding = false;
    if (d.stim) a.stimT = d.stim.time;
    if (d.uses > 1) {
      f.item.dur = (f.item.dur ?? d.uses) - 1;
      if (f.item.dur <= 0) takeFromInventory(a.inv, uid);
    } else {
      takeFromInventory(a.inv, uid, 1);
    }
    this.invChanged(a);
  }

  private interact(a: Actor, kind: 'container' | 'door' | 'radio' | 'revive', id: number | string) {
    if (a.action) return;
    if (kind === 'container') {
      const c = this.containers.get(Number(id));
      if (!c || dist(a.x, a.y, c.x, c.y) > INTERACT_RANGE + 14) return;
      if (c.searched.includes(a.id) || c.kind === 'corpse' || c.kind === 'drop') {
        this.openContainer(a, c);
      } else {
        const total = clamp(0.7 + c.items.length * 0.35, 0.9, 3.4);
        a.action = { type: 'search', t: 0, total, target: c.id, x: a.x, y: a.y };
      }
    } else if (kind === 'door') {
      const lock = this.map.locks.find((l) => l.id === id);
      if (!lock) return;
      const near = lock.tiles.some(([tx, ty]) => dist(a.x, a.y, (tx + 0.5) * TILE, (ty + 0.5) * TILE) < INTERACT_RANGE + 20);
      if (!near || this.map.get(lock.tiles[0][0], lock.tiles[0][1]) !== T.DOOR_LOCKED) return;
      if (!hasKey(a.inv, lock.keyId)) {
        this.msg(a.id, `Verschlossen: ${lock.name} – Schlüssel benötigt.`, 'warn');
        return;
      }
      a.action = { type: 'unlock', t: 0, total: 1.6, x: a.x, y: a.y, item: lock.id };
    } else if (kind === 'radio') {
      const ex = this.extracts.find((e) => e.def.id === id);
      if (!ex || !ex.heli || dist(a.x, a.y, ex.def.x, ex.def.y) > ex.def.r + 20) return;
      if (ex.heli.phase !== 'idle') {
        this.msg(a.id, ex.heli.phase === 'cooldown' ? 'Der Heli ist noch nicht wieder verfügbar.' : 'Der Heli ist bereits unterwegs.', 'info');
        return;
      }
      a.action = { type: 'radio', t: 0, total: 2.5, x: a.x, y: a.y, item: ex.def.id };
    } else if (kind === 'revive') {
      const target = this.actors.get(Number(id));
      if (!target || !target.downed || !target.alive || target.team !== a.team) return;
      if (dist(a.x, a.y, target.x, target.y) > INTERACT_RANGE + 10) return;
      a.action = { type: 'revive', t: 0, total: REVIVE_TIME, target: target.id, x: a.x, y: a.y };
    }
  }

  private openContainer(a: Actor, c: Container) {
    if (!c.searched.includes(a.id)) c.searched.push(a.id);
    a.viewing = c.id;
    if (c.kind === 'corpse') {
      c.lootedBy ??= [];
      if (!c.lootedBy.includes(a.id) && a.stats) {
        c.lootedBy.push(a.id);
        a.stats.bodies++;
      }
    }
    c.version++;
  }

  private finishAction(a: Actor) {
    const act = a.action!;
    a.action = null;
    switch (act.type) {
      case 'heal':
        a.action = act;
        this.finishHeal(a);
        a.action = null;
        break;
      case 'search': {
        const c = this.containers.get(act.target!);
        if (!c) return;
        if (a.stats && !c.searched.includes(a.id)) a.stats.searched[c.kind] = (a.stats.searched[c.kind] ?? 0) + 1;
        this.openContainer(a, c);
        this.emit({ e: 'searched', c: c.id, empty: c.items.length === 0, to: a.id });
        break;
      }
      case 'unlock': {
        const lock = this.map.locks.find((l) => l.id === act.item);
        if (!lock) return;
        for (const [tx, ty] of lock.tiles) {
          this.map.set(tx, ty, T.INDOOR);
          this.emit({ e: 'tile', tx, ty, v: T.INDOOR });
        }
        this.msg(a.id, `${lock.name} aufgeschlossen.`, 'good');
        alertNoise(this, a.x, a.y, 260, a);
        break;
      }
      case 'radio': {
        const ex = this.extracts.find((e) => e.def.id === act.item);
        if (!ex?.heli || ex.heli.phase !== 'idle') return;
        ex.heli.phase = 'inbound';
        ex.heli.t = 45;
        this.extractsDirty = true;
        if (a.stats) a.stats.heliCalls++;
        this.emit({ e: 'heli', ex: ex.def.id, phase: 'inbound', t: 45 });
        this.msg(undefined, `${a.name} hat den Evakuierungs-Heli gerufen (45 s). Gegner sind alarmiert!`, 'warn');
        alertNoise(this, ex.def.x, ex.def.y, 1500, a, true);
        this.spawnWave(ex.def.x, ex.def.y, 2);
        break;
      }
      case 'revive': {
        const target = this.actors.get(act.target!);
        if (!target || !target.downed || !target.alive) return;
        target.downed = false;
        target.hp = 35;
        target.bleeding = false;
        if (a.stats) a.stats.revives++;
        this.emit({ e: 'revived', id: target.id, by: a.id });
        this.msg(undefined, `${a.name} hat ${target.name} wiederbelebt.`, 'good');
        break;
      }
      case 'selfrevive': {
        const f = allItems(a.inv).find((x) => x.id === 'selfrevive');
        if (f) takeFromInventory(a.inv, f.uid, 1);
        a.downed = false;
        a.hp = (itemDef('selfrevive') as MedDef).heal;
        a.bleeding = false;
        this.invChanged(a);
        this.emit({ e: 'revived', id: a.id, by: a.id });
        break;
      }
    }
  }

  // ------------------------------------------------------------------
  // Inventar & Behälter
  // ------------------------------------------------------------------
  private viewable(a: Actor, cid: number): Container | undefined {
    const c = this.containers.get(cid);
    if (!c || a.viewing !== cid) return;
    if (dist(a.x, a.y, c.x, c.y) > INTERACT_RANGE + 40) {
      a.viewing = null;
      return;
    }
    return c;
  }

  private take(a: Actor, cid: number, uid: string, n?: number, to?: ListName | 'equip') {
    const c = this.viewable(a, cid);
    if (!c) return;
    const idx = c.items.findIndex((x) => x.uid === uid);
    if (idx < 0) return;
    const it = c.items[idx];
    const d = itemDef(it.id);
    const slot = slotForDef(d);
    if (to === 'equip' || (to === undefined && slot && !a.inv.equip[slot] && d.cat !== 'backpack')) {
      if (slot && !a.inv.equip[slot]) {
        c.items.splice(idx, 1);
        a.inv.equip[slot] = it;
        this.afterEquipChange(a);
        c.version++;
        return;
      }
      if (to === 'equip') {
        this.msg(a.id, 'Slot belegt.', 'warn');
        return;
      }
    }
    const list: ListName = to === 'secure' ? 'secure' : 'bag';
    const want = n === undefined ? it.n : Math.min(n, it.n);
    const part = { ...it, n: want };
    const left = addToList(a.inv[list], listCapacity(a.inv, list), part);
    const moved = want - left;
    if (moved <= 0) {
      this.msg(a.id, list === 'secure' ? 'Sicherer Behälter ist voll.' : 'Kein Platz im Rucksack.', 'warn');
      return;
    }
    if (moved >= it.n) c.items.splice(idx, 1);
    else it.n -= moved;
    c.version++;
    this.invChanged(a);
    this.cleanupDrop(c);
  }

  private takeAll(a: Actor, cid: number) {
    const c = this.viewable(a, cid);
    if (!c) return;
    let full = false;
    for (const it of [...c.items]) {
      const left = addToList(a.inv.bag, bagCapacity(a.inv), { ...it });
      if (left === 0) c.items.splice(c.items.indexOf(it), 1);
      else {
        if (left < it.n) it.n = left;
        full = true;
      }
    }
    if (full) this.msg(a.id, 'Rucksack voll – nicht alles passte hinein.', 'warn');
    c.version++;
    this.invChanged(a);
    this.cleanupDrop(c);
  }

  private put(a: Actor, cid: number, uid: string, n?: number) {
    const c = this.viewable(a, cid);
    if (!c) return;
    const it = takeFromInventory(a.inv, uid, n);
    if (!it) {
      this.msg(a.id, 'Rucksack erst leeren.', 'warn');
      return;
    }
    addUnchecked(c.items, it);
    c.version++;
    this.afterEquipChange(a);
  }

  private moveItem(a: Actor, uid: string, to: ListName) {
    const f = findItem(a.inv, uid);
    if (!f) return;
    if (f.where === to) return;
    const it = f.where === 'equip' ? undefined : takeFromList(a.inv[f.where], uid);
    if (!it) {
      // ausgerüstet -> in Tasche
      if (f.where === 'equip' && to === 'bag') {
        const r = unequipToBag(a.inv, f.slot!);
        if (!r.ok) this.msg(a.id, r.reason ?? 'Kein Platz', 'warn');
        this.afterEquipChange(a);
      }
      return;
    }
    const left = addToList(a.inv[to], listCapacity(a.inv, to), it);
    if (left > 0) {
      addUnchecked(a.inv[f.where as ListName], { ...it, n: left });
      this.msg(a.id, to === 'secure' ? 'Sicherer Behälter ist voll.' : 'Kein Platz.', 'warn');
    }
    this.invChanged(a);
  }

  private drop(a: Actor, uid: string, n?: number) {
    const it = takeFromInventory(a.inv, uid, n);
    if (!it) {
      this.msg(a.id, 'Rucksack erst leeren.', 'warn');
      return;
    }
    this.afterEquipChange(a);
    let c = [...this.containers.values()].find((x) => x.kind === 'drop' && x.dynamic && dist(x.x, x.y, a.x, a.y) < 30);
    if (!c) {
      c = this.addDynamicContainer('drop', a.x + Math.cos(a.aim) * 14, a.y + Math.sin(a.aim) * 14, [], itemDef(it.id).name);
    }
    addUnchecked(c.items, it);
    c.searched.push(a.id);
    c.version++;
  }

  addDynamicContainer(kind: 'drop' | 'corpse', x: number, y: number, items: ItemStack[], name: string, owner?: BotType | 'player'): Container {
    const id = this.nextContainer++;
    const c: Container = { id, kind, name, x, y, tier: 1, items, searched: [], version: 0, owner, dynamic: true, rot: this.rng.range(0, Math.PI * 2) };
    this.containers.set(id, c);
    this.emit({ e: 'container', c: this.containerInfo(c) });
    return c;
  }

  private cleanupDrop(c: Container) {
    if (c.kind === 'drop' && c.items.length === 0) {
      this.containers.delete(c.id);
      this.emit({ e: 'cremove', c: c.id });
      for (const a of this.actors.values()) if (a.viewing === c.id) a.viewing = null;
    }
  }

  // ------------------------------------------------------------------
  // Granaten
  // ------------------------------------------------------------------
  throwGrenade(a: Actor, tx: number, ty: number) {
    if (a.downed || a.action) return;
    let gDef = GRENADES[0];
    if (a.kind === 'player') {
      const g = [...a.inv.bag, ...a.inv.secure].find((x) => isGrenade(itemDef(x.id)));
      if (!g) {
        this.msg(a.id, 'Keine Granate dabei.', 'warn');
        return;
      }
      gDef = itemDef(g.id) as typeof gDef;
      consumeItem(a.inv, g.id, 1);
      this.invChanged(a);
    }
    let dx = tx - a.x;
    let dy = ty - a.y;
    let d = Math.hypot(dx, dy) || 1;
    const maxD = 420;
    if (d > maxD) {
      dx = (dx / d) * maxD;
      dy = (dy / d) * maxD;
      d = maxD;
    }
    const flyT = clamp(d / 520, 0.25, 0.85);
    const g: Grenade = {
      id: this.nextGrenade++,
      owner: a.id,
      team: a.team,
      x: a.x + (dx / d) * (a.r + 4),
      y: a.y + (dy / d) * (a.r + 4),
      vx: dx / flyT,
      vy: dy / flyT,
      flyT,
      t: 0,
      fuse: gDef.fuse,
      dmg: gDef.dmg,
      radius: gDef.radius,
    };
    this.grenades.push(g);
    this.emit({ e: 'throw', g: g.id, id: a.id, x: g.x, y: g.y, vx: g.vx, vy: g.vy, ft: flyT, fuse: g.fuse });
  }

  private updateGrenades(dt: number) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.t += dt;
      if (g.t <= g.flyT) {
        const nx = g.x + g.vx * dt;
        const ny = g.y + g.vy * dt;
        if (this.map.circleBlocked(nx, ny, 4, F_MOVE) && this.map.flagsAtWorld(nx, ny) & F_BULLET) {
          g.vx *= -0.3;
          g.vy *= -0.3;
        } else {
          g.x = nx;
          g.y = ny;
        }
      }
      if (g.t >= g.fuse) {
        this.grenades.splice(i, 1);
        this.explode(g);
      }
    }
  }

  private explode(g: Grenade) {
    this.emit({ e: 'explode', g: g.id, x: g.x, y: g.y, r: g.radius });
    const owner = this.actors.get(g.owner) ?? null;
    alertNoise(this, g.x, g.y, 1400, owner ?? undefined, true);
    for (const a of [...this.actors.values()]) {
      if (!a.alive || a.extracted) continue;
      const d = dist(a.x, a.y, g.x, g.y);
      if (d > g.radius) continue;
      if (!this.map.clearLine(g.x, g.y, a.x, a.y, F_BULLET)) continue;
      if (owner && a !== owner && owner.team === a.team && !this.cfg.friendlyFire) continue;
      const fall = 1 - d / g.radius;
      let dmg = g.dmg * (0.25 + 0.75 * fall * fall);
      const armor = a.inv.equip.armor;
      if (armor && (armor.dur ?? 0) > 0) {
        dmg *= 0.75;
        armor.dur = Math.max(0, (armor.dur ?? 0) - dmg * 0.3);
      }
      this.damage(a, dmg, owner, 'frag', false);
      if (a.alive && this.rng.chance(0.5)) a.bleeding = true;
    }
  }

  // ------------------------------------------------------------------
  // Schaden & Tod
  // ------------------------------------------------------------------
  damage(target: Actor, amount: number, attacker: Actor | null, weapon: string, head: boolean) {
    if (!target.alive || target.extracted || amount <= 0) return;
    if (attacker && attacker.stats && attacker !== target) attacker.stats.damage += amount;
    target.lastDamageT = this.t;
    target.lastAttacker = attacker?.id ?? null;
    if (target.downed) {
      target.downedT -= amount * 0.06;
      if (target.downedT <= 0) this.kill(target, attacker, weapon, head);
      return;
    }
    target.hp -= amount;
    if (attacker && attacker.scav && !attacker.scavAngry && target.botType === 'scav') {
      attacker.scavAngry = true;
      this.msg(attacker.id, 'Du hast auf Plünderer geschossen – sie sind jetzt feindlich!', 'warn');
    }
    if (target.action && target.action.type !== 'heal' && target.action.type !== 'selfrevive') target.action = null;
    if (target.kind === 'bot' && attacker) onBotDamaged(this, target, attacker);
    if (target.hp <= 0) {
      target.hp = 0;
      if (target.kind === 'player') this.downOrKill(target, attacker, weapon, head);
      else this.kill(target, attacker, weapon, head);
    }
  }

  private downOrKill(p: Actor, attacker: Actor | null, weapon: string, head: boolean) {
    const hasSelf = countItem(p.inv, 'selfrevive') > 0;
    const mates = this.players().filter((x) => x !== p && x.alive && !x.extracted && !x.downed);
    if (!hasSelf && mates.length === 0) return this.kill(p, attacker, weapon, head);
    p.downed = true;
    p.downedT = DOWNED_TIME;
    p.bleeding = false;
    p.ws.reloadT = 0;
    p.viewing = null;
    p.action = hasSelf ? { type: 'selfrevive', t: 0, total: 4 } : null;
    this.emit({ e: 'downed', id: p.id, name: p.name });
    if (!hasSelf) this.msg(undefined, `${p.name} ist am Boden! Wiederbeleben!`, 'warn');
  }

  kill(v: Actor, killer: Actor | null, weapon: string, head: boolean) {
    if (!v.alive) return;
    v.alive = false;
    v.action = null;
    const victimType: BotType | 'player' = v.kind === 'player' ? 'player' : v.botType!;
    // Leiche mit Ausrüstung
    const items: ItemStack[] = [];
    for (const s of ['primary', 'secondary', 'helmet', 'armor', 'backpack'] as EquipSlot[]) if (v.inv.equip[s]) items.push(v.inv.equip[s]!);
    items.push(...v.inv.bag);
    const corpse = this.addDynamicContainer('corpse', v.x, v.y, items, v.kind === 'player' ? v.name : v.name, victimType);
    corpse.rot = v.aim;
    let wname = weapon === 'frag' ? 'Granate' : weapon;
    try {
      if (weapon !== 'frag') wname = itemDef(weapon).short;
    } catch {
      /* unbekannt */
    }
    this.emit({ e: 'death', id: v.id, by: killer?.id ?? null, x: v.x, y: v.y, name: v.name, victim: victimType, killer: killer?.name ?? 'Unbekannt', w: wname, hd: head });
    if (killer && killer.stats && killer !== v && v.kind === 'bot') {
      killer.stats.kills[v.botType!]++;
      let wclass = 'frag';
      try {
        if (weapon !== 'frag') wclass = weaponDef(weapon).wclass;
      } catch {
        /* */
      }
      killer.stats.killLog.push({ type: v.botType!, wclass, map: this.cfg.mapId, head });
      this.emit({ e: 'xp', amount: XP_KILL[v.botType!], reason: `${v.name} eliminiert`, to: killer.id });
    }
    if (v.kind === 'player') {
      const inv = emptyInventory(v.inv.secureCap);
      inv.secure = v.inv.secure;
      this.finishPlayer(v, 'killed', inv, { killedBy: killer ? killer.name : 'Unbekannt' });
    }
    this.actors.delete(v.id);
    for (const a of this.actors.values()) if (a.brain && a.brain.target === v.id) a.brain.target = null;
  }

  private finishPlayer(p: Actor, status: RaidResult['status'], inv: Inventory, extra: Partial<RaidResult> = {}) {
    const stats = p.stats ?? emptyStats();
    const xp = this.computeXp(stats, status);
    const res: RaidResult = {
      status,
      mapId: this.cfg.mapId,
      inventory: inv,
      stats,
      time: this.t,
      xp,
      endValue: inventoryValue(inv),
      scav: p.scav,
      ...extra,
    };
    this.results.set(p.id, res);
  }

  computeXp(s: RaidStats, status: RaidResult['status']): XpBreakdown {
    let kills = 0;
    for (const k of s.killLog) kills += XP_KILL[k.type] * (k.head ? 1.2 : 1);
    let searched = 0;
    for (const v of Object.values(s.searched)) searched += v ?? 0;
    const search = searched * 20 + s.bodies * 40;
    const extract = status === 'extracted' ? 600 : 0;
    const survival = status === 'extracted' ? Math.round(Math.min(25, this.t / 60) * 25) : 0;
    kills = Math.round(kills);
    return { kills, search, extract, survival, total: kills + search + extract + survival };
  }

  /** Spieler verlässt das Spiel (Verbindung weg) – zählt als vermisst. */
  removePlayer(id: number) {
    const p = this.actors.get(id);
    if (!p || p.kind !== 'player') return;
    if (this.results.has(id)) return;
    this.kill(p, null, 'frag', false);
  }

  // ------------------------------------------------------------------
  // Bots
  // ------------------------------------------------------------------
  spawnBot(type: BotType, x: number, y: number, squad: number, leader: number | null, opts: { name?: string; weapon?: string; home?: { x: number; y: number }; leash?: number; zone?: string } = {}): Actor {
    const inv = botLoadout(type, this.rng, opts.weapon);
    const a = this.newActor({
      kind: 'bot',
      team: 'bot',
      botType: type,
      name: opts.name ?? BOT_NAMES[type],
      x,
      y,
      inv,
      maxHp: BOT_HP[type],
    });
    a.aim = this.rng.range(-Math.PI, Math.PI);
    a.brain = makeBrain(this, a, squad, leader, opts.home ?? { x, y }, opts.leash ?? 0, opts.zone ?? null);
    return a;
  }

  private spawnGroup(type: 'scav' | 'pmc', x: number, y: number, count: number) {
    const squad = this.nextSquad++;
    let leader: number | null = null;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      let px = x + (i ? Math.cos(ang) * 34 : 0);
      let py = y + (i ? Math.sin(ang) * 34 : 0);
      if (this.map.circleBlocked(px, py, PLAYER_RADIUS)) {
        px = x;
        py = y;
      }
      const b = this.spawnBot(type, px, py, squad, leader);
      if (i === 0) leader = b.id;
    }
  }

  private difficultyScale() {
    return [0.7, 1, 1.25][this.cfg.difficulty] ?? 1;
  }

  private spawnInitialBots() {
    const m = this.map;
    const playerSpawn = m.playerSpawns[this.spawnIndex];
    const scale = this.difficultyScale() * (1 + 0.35 * (this.cfg.players - 1));
    const scavSpawns = this.rng.shuffle(m.botSpawns.filter((s) => s.kind === 'scav' && dist(s.x, s.y, playerSpawn.x, playerSpawn.y) > 750));
    const groups = Math.round(m.meta.scavGroups * scale);
    for (let i = 0; i < groups && scavSpawns.length; i++) {
      const s = scavSpawns[i % scavSpawns.length];
      this.spawnGroup('scav', s.x, s.y, this.rng.int(1, 3));
    }
    const pmcSpawns = this.rng.shuffle(m.botSpawns.filter((s) => s.kind === 'pmc' && dist(s.x, s.y, playerSpawn.x, playerSpawn.y) > 1300));
    const pmcGroups = Math.round(m.meta.pmcGroups * (this.cfg.difficulty === 0 ? 0.5 : 1) * (1 + 0.25 * (this.cfg.players - 1)));
    for (let i = 0; i < pmcGroups && pmcSpawns.length; i++) {
      const s = pmcSpawns[i % pmcSpawns.length];
      this.spawnGroup('pmc', s.x, s.y, this.rng.int(2, 3));
    }
    const boss = m.boss;
    if (boss && this.rng.next() < boss.chance) {
      const squad = this.nextSquad++;
      const zone = m.zones.find((z) => z.id === boss.zone);
      const leash = zone ? Math.max(zone.w, zone.h) * TILE * 0.6 : 400;
      const bb = this.spawnBot('boss', boss.x, boss.y, squad, null, { name: boss.name, weapon: boss.weapon, leash, zone: boss.zone });
      for (const g of boss.guards) this.spawnBot('guard', g.x, g.y, squad, bb.id, { home: g, leash, zone: boss.zone });
    }
  }

  private botCount() {
    let n = 0;
    for (const a of this.actors.values()) if (a.kind === 'bot') n++;
    return n;
  }

  /** Neue Gegnerwelle (fern von Spielern bzw. nahe eines Ziels). */
  spawnWave(nearX?: number, nearY?: number, groups = 1) {
    if (this.botCount() > 34) return;
    const players = this.players().filter((p) => p.alive && !p.extracted);
    const cands = this.map.botSpawns.filter((s) => {
      for (const p of players) {
        const d = dist(s.x, s.y, p.x, p.y);
        if (d < 800) return false;
        if (d < 1300 && this.map.canSee(p.x, p.y, s.x, s.y)) return false;
      }
      if (nearX !== undefined && nearY !== undefined) return dist(s.x, s.y, nearX, nearY) < 2400;
      return true;
    });
    if (!cands.length) return;
    cands.sort((a, b) => (nearX !== undefined ? dist(a.x, a.y, nearX, nearY!) - dist(b.x, b.y, nearX, nearY!) : this.rng.next() - 0.5));
    for (let i = 0; i < groups; i++) {
      const s = cands[Math.min(cands.length - 1, i)];
      const type = s.kind === 'pmc' && this.rng.chance(0.5) ? 'pmc' : 'scav';
      this.spawnGroup(type, s.x, s.y, this.rng.int(1, type === 'pmc' ? 3 : 2));
      if (nearX !== undefined) {
        // Welle läuft direkt zum Ziel
        for (const a of this.actors.values()) {
          if (a.brain && a.brain.stateT === 0 && a.brain.state === 'patrol') {
            a.brain.state = 'investigate';
            a.brain.heard = { x: nearX + this.rng.range(-120, 120), y: nearY! + this.rng.range(-120, 120), t: this.t };
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Simulationsschritt
  // ------------------------------------------------------------------
  step(dt: number) {
    if (this.ended) return;
    this.t += dt;
    this.timeLeft -= dt;
    this.pathBudget = 5;

    this.updateExtracts(dt);
    for (const a of [...this.actors.values()]) {
      if (!a.alive) continue;
      this.updateActorCommon(a, dt);
      if (!a.alive) continue;
      if (a.kind === 'bot') updateBot(this, a, dt);
      else this.updatePlayer(a, dt);
    }
    this.separateBots();
    this.updateBullets(dt);
    this.updateGrenades(dt);

    this.waveT -= dt;
    if (this.waveT <= 0) {
      this.waveT = this.rng.range(140, 210) / Math.max(0.8, this.difficultyScale());
      if (this.timeLeft > 120) this.spawnWave(undefined, undefined, this.rng.int(1, 2));
    }

    if (this.timeLeft <= 0) {
      for (const p of this.players()) {
        if (this.results.has(p.id)) continue;
        const inv = emptyInventory(p.inv.secureCap);
        inv.secure = p.inv.secure;
        this.finishPlayer(p, 'mia', inv);
        this.actors.delete(p.id);
      }
    }
    if (this.timeLeft <= 0 || (this.players().length === 0 && this.results.size > 0)) this.ended = true;
  }

  private updateExtracts(dt: number) {
    for (const ex of this.extracts) {
      if (ex.def.kind === 'timed' && !ex.open && this.t >= (ex.def.openAt ?? 0)) {
        ex.open = true;
        this.extractsDirty = true;
        this.msg(undefined, `Extraktion „${ex.def.name}“ ist jetzt offen.`, 'good');
      }
      const h = ex.heli;
      if (!h || h.phase === 'idle') continue;
      h.t -= dt;
      if (h.t > 0) continue;
      if (h.phase === 'inbound') {
        h.phase = 'landed';
        h.t = 50;
        this.msg(undefined, `Der Heli ist gelandet: ${ex.def.name}. 50 Sekunden zum Einsteigen!`, 'good');
      } else if (h.phase === 'landed') {
        h.phase = 'cooldown';
        h.t = 120;
        this.msg(undefined, 'Der Heli ist abgeflogen.', 'warn');
      } else if (h.phase === 'cooldown') {
        h.phase = 'idle';
        h.t = 0;
      }
      this.extractsDirty = true;
      this.emit({ e: 'heli', ex: ex.def.id, phase: h.phase, t: h.t });
    }
  }

  private updateActorCommon(a: Actor, dt: number) {
    const ws = a.ws;
    ws.cooldown = Math.max(0, ws.cooldown - dt);
    if (ws.equipT > 0) ws.equipT = Math.max(0, ws.equipT - dt);
    const w = activeWeapon(a.inv, a.active);
    if (w) ws.bloom = Math.max(0, ws.bloom - weaponDef(w.id).recover * dt);
    if (ws.reloadT > 0) {
      ws.reloadT -= dt;
      if (ws.reloadT <= 0) {
        ws.reloadT = 0;
        this.finishReload(a);
      }
    }
    if (a.stimT > 0) a.stimT = Math.max(0, a.stimT - dt);
    if (a.bleeding && !a.downed) {
      this.damage(a, 1.15 * dt, a.lastAttacker !== null ? (this.actors.get(a.lastAttacker) ?? null) : null, 'bleed', false);
      if (!a.alive) return;
    }
    if (a.regen > 0 && !a.downed && this.t - a.lastDamageT > 8 && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + a.regen * dt);
    if (a.downed) {
      if (a.action?.type !== 'selfrevive') {
        a.downedT -= dt;
        if (a.downedT <= 0) {
          this.kill(a, a.lastAttacker !== null ? (this.actors.get(a.lastAttacker) ?? null) : null, 'bleed', false);
          return;
        }
      }
    }
    // Stamina
    if (a.sprint && a.moving && a.stimT <= 0) a.stamina = Math.max(0, a.stamina - STAMINA_DRAIN * dt);
    else a.stamina = Math.min(STAMINA_MAX, a.stamina + STAMINA_REGEN * dt * (a.stimT > 0 ? 3 : 1));
    // Aktionen
    if (a.action) {
      const act = a.action;
      if (act.x !== undefined && act.y !== undefined && dist2(a.x, a.y, act.x, act.y) > 44 * 44) {
        a.action = null;
      } else {
        if (act.type === 'revive') {
          const target = this.actors.get(act.target!);
          if (!target || !target.downed || dist(a.x, a.y, target.x, target.y) > INTERACT_RANGE + 20) {
            a.action = null;
            return;
          }
        }
        act.t += dt;
        if (act.t >= act.total) this.finishAction(a);
      }
    }
  }

  private updatePlayer(p: Actor, dt: number) {
    // Gesehene Zonen
    if (p.stats) {
      const z = this.map.zoneAt(p.x, p.y);
      if (z && !p.stats.visited.includes(z.id)) p.stats.visited.push(z.id);
    }
    if (p.viewing !== null) {
      const c = this.containers.get(p.viewing);
      if (!c || dist(p.x, p.y, c.x, c.y) > INTERACT_RANGE + 40) p.viewing = null;
    }
    // Extraktion
    p.extractId = null;
    if (p.downed) {
      p.extractT = 0;
      return;
    }
    const ex = this.extracts.find((e) => dist2(p.x, p.y, e.def.x, e.def.y) <= e.def.r * e.def.r);
    if (!ex) {
      p.extractT = 0;
      return;
    }
    p.extractId = ex.def.id;
    if (!this.extractAvailable(p, ex)) {
      p.extractT = 0;
      return;
    }
    p.extractT += dt;
    const need = ex.def.kind === 'heli' ? 4 : EXTRACT_TIME;
    if (p.extractT >= need) {
      if (ex.def.kind === 'paid') consumeItem(p.inv, 'cash', ex.def.cost ?? 0);
      p.extracted = true;
      p.alive = false;
      this.emit({ e: 'extracted', id: p.id, name: p.name, ex: ex.def.name });
      this.finishPlayer(p, 'extracted', cloneInventory(p.inv), { extractId: ex.def.id, extractName: ex.def.name });
      this.actors.delete(p.id);
      for (const a of this.actors.values()) if (a.brain && a.brain.target === p.id) a.brain.target = null;
    }
  }

  extractNeed(p: Actor, ex: ExtractState): string | undefined {
    if (!ex.open) return ex.def.kind === 'timed' ? 'Noch geschlossen' : 'Nicht verfügbar';
    if (ex.def.kind === 'paid' && countItem(p.inv, 'cash') < (ex.def.cost ?? 0)) return `${(ex.def.cost ?? 0).toLocaleString('de-DE')} € Bargeld nötig`;
    if (ex.def.kind === 'key' && !hasKey(p.inv, ex.def.keyId ?? '')) return 'Schlüssel nötig';
    if (ex.def.kind === 'heli' && ex.heli?.phase !== 'landed') return ex.heli?.phase === 'inbound' ? 'Heli im Anflug' : 'Heli per Funk rufen';
    return undefined;
  }

  extractAvailable(p: Actor, ex: ExtractState) {
    return this.extractNeed(p, ex) === undefined;
  }

  private separateBots() {
    const list = [...this.actors.values()].filter((a) => a.alive);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.kind !== 'bot') continue;
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const b = list[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-4) continue;
        const d = Math.sqrt(d2);
        const push = (rr - d) * (b.kind === 'bot' ? 0.5 : 1);
        const p = this.map.moveCircle(a.x, a.y, (dx / d) * push, (dy / d) * push, a.r);
        a.x = p.x;
        a.y = p.y;
      }
    }
  }

  private updateBullets(dt: number) {
    const actors = [...this.actors.values()];
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const remaining = Math.min(b.speed * dt, b.range - b.traveled);
      const wall = this.map.raycast(b.x, b.y, b.dx, b.dy, remaining, F_BULLET, Math.max(0, b.ignoreLow - b.traveled));
      let best: Actor | null = null;
      let bestT = 2;
      const owner = this.actors.get(b.owner);
      for (const a of actors) {
        if (!a.alive || a.extracted || a.id === b.owner) continue;
        if (a.team === b.team && !(this.cfg.friendlyFire && a.kind === 'player')) continue;
        const r = a.downed ? a.r * 0.8 : a.r;
        const t = segmentCircle(b.x, b.y, b.dx * wall, b.dy * wall, a.x, a.y, r);
        if (t >= 0 && t < bestT) {
          bestT = t;
          best = a;
        }
      }
      if (best) {
        const hx = b.x + b.dx * wall * bestT;
        const hy = b.y + b.dy * wall * bestT;
        this.bullets.splice(i, 1);
        const headChance = HEAD_CHANCE * (best.kind === 'player' ? 0.8 : 1);
        const res = computeHit(best.inv, b.dmg, b.pen, b.armorDmg, headChance, this.rng);
        // Distanzabfall
        const falloff = 1 - clamp((b.traveled - b.range * 0.6) / (b.range * 0.8), 0, 0.35);
        const dmg = res.dmg * falloff;
        if (owner?.stats) owner.stats.hits++;
        const wasAlive = best.alive && !best.downed;
        this.damage(best, dmg, owner ?? null, b.weapon, res.head);
        if (res.bleed && best.alive && !best.downed) best.bleeding = true;
        if (res.armorHit) this.invChanged(best);
        this.emit({ e: 'hit', b: b.id, x: hx, y: hy, id: best.id, by: b.owner, d: Math.round(dmg), ar: res.armorHit && !res.penetrated, hd: res.head, k: wasAlive && (!best.alive || best.downed) });
        continue;
      }
      if (wall < remaining - 0.01) {
        const hx = b.x + b.dx * wall;
        const hy = b.y + b.dy * wall;
        this.bullets.splice(i, 1);
        this.emit({ e: 'impact', b: b.id, x: hx, y: hy, m: this.map.tileAtWorld(hx + b.dx * 2, hy + b.dy * 2) });
        continue;
      }
      b.x += b.dx * remaining;
      b.y += b.dy * remaining;
      b.traveled += remaining;
      if (b.traveled >= b.range - 0.01) this.bullets.splice(i, 1);
    }
  }

  /** Für den Host: Sichtbare Extraktionen inkl. Zustand */
  extractSnaps() {
    return this.extracts.map((e) => ({ id: e.def.id, open: e.open, heli: e.heli ? { phase: e.heli.phase, t: Math.round(e.heli.t) } : undefined }));
  }
}
