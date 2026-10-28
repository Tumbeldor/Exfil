import { TICK_DT } from '../constants';
import { dist2 } from '../math';
import { activeWeapon } from '../sim/combat';
import type { Actor, ActorSnap, GameEvent, MeSnap, Snapshot } from '../sim/types';
import { type PlayerJoin, World, type WorldConfig } from '../sim/World';
import type { HostMsg, RaidClientMsg } from './protocol';

const VIEW_R2 = 1600 * 1600;
const BULLET_R2 = 2000 * 2000;
const DISCONNECT_GRACE = 90;

interface HostClient {
  key: string;
  send: (m: HostMsg) => void;
  actorId: number;
  name: string;
  color: string;
  lastInv: number;
  lastView: number | null;
  lastViewVersion: number;
  resultSent: boolean;
  connected: boolean;
  disconnectedAt: number;
  corr?: { x: number; y: number };
  lastPos: { x: number; y: number };
}

/**
 * Betreibt eine Raid-Instanz (World) und verteilt Zustände an verbundene Clients.
 * Wird identisch im Browser (Solo) und auf dem Server (Coop) verwendet.
 */
export class RaidHost {
  readonly world: World;
  private clients = new Map<string, HostClient>();
  private tick = 0;
  private acc = 0;
  private changedTiles: [number, number, number][] = [];
  ended = false;
  onEnd?: () => void;

  constructor(
    readonly cfg: WorldConfig,
    private opts: { snapshotEvery: number; coop: boolean },
  ) {
    this.world = new World(cfg);
  }

  join(key: string, send: (m: HostMsg) => void, join: PlayerJoin): number {
    const a = this.world.addPlayer(join);
    const c: HostClient = {
      key,
      send,
      actorId: a.id,
      name: join.name,
      color: join.color,
      lastInv: -1,
      lastView: null,
      lastViewVersion: -1,
      resultSent: false,
      connected: true,
      disconnectedAt: 0,
      lastPos: { x: a.x, y: a.y },
    };
    this.clients.set(key, c);
    return a.id;
  }

  /** Sendet allen Clients die Startinformationen (nach dem Beitritt aller). */
  startAll() {
    for (const c of this.clients.values()) this.sendStart(c);
  }

  private sendStart(c: HostClient) {
    const w = this.world;
    c.lastInv = -1;
    c.lastView = null;
    c.lastViewVersion = -1;
    c.send({
      type: 'raidStart',
      info: {
        mapId: this.cfg.mapId,
        seed: this.cfg.seed,
        you: c.actorId,
        t: w.t,
        timeLeft: w.timeLeft,
        extracts: w.extractSnaps(),
        containers: w.containerInfos(),
        tiles: this.changedTiles,
        squad: [...this.clients.values()].map((x) => ({ id: x.actorId, name: x.name, color: x.color })),
        difficulty: this.cfg.difficulty,
        coop: this.opts.coop,
      },
    });
    this.sendPrivate(c, true);
  }

  /** Erneute Verbindung eines Clients während des Raids. */
  reconnect(key: string, send: (m: HostMsg) => void): boolean {
    const c = this.clients.get(key);
    if (!c || c.resultSent) return false;
    c.send = send;
    c.connected = true;
    const res = this.world.results.get(c.actorId);
    if (res) {
      // Ergebnis entstand während der Trennung
      c.resultSent = true;
      send({ type: 'result', r: res });
      return true;
    }
    const a = this.world.actors.get(c.actorId);
    if (a) a.connected = true;
    this.sendStart(c);
    return true;
  }

  disconnect(key: string) {
    const c = this.clients.get(key);
    if (!c) return;
    c.connected = false;
    c.disconnectedAt = this.world.t;
    const a = this.world.actors.get(c.actorId);
    if (a) {
      a.connected = false;
      a.sprint = false;
      a.moving = false;
      a.ads = false;
    }
  }

  /** Spieler verlässt den Raid freiwillig: zählt sofort als tot. */
  abandon(key: string) {
    const c = this.clients.get(key);
    if (!c || c.resultSent) return;
    this.disconnect(key);
    this.world.removePlayer(c.actorId);
  }

  hasClient(key: string) {
    return this.clients.has(key);
  }
  /** Hat der Spieler den Raid bereits beendet (extrahiert/tot/vermisst)? */
  clientDone(key: string) {
    const c = this.clients.get(key);
    return !c || this.world.results.has(c.actorId);
  }

  handle(key: string, msg: RaidClientMsg) {
    const c = this.clients.get(key);
    if (!c || this.ended) return;
    if (msg.type === 'in') {
      const corr = this.world.applyInput(c.actorId, msg.i);
      if (corr) c.corr = corr;
    } else if (msg.type === 'act') {
      this.world.doAction(c.actorId, msg.a);
    }
  }

  /** Mit Echtzeit aufrufen; führt feste Ticks aus. */
  update(dt: number) {
    if (this.ended) return;
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= TICK_DT && n < 8) {
      this.acc -= TICK_DT;
      this.stepOnce();
      n++;
    }
  }

  stepOnce() {
    if (this.ended) return;
    const w = this.world;
    w.step(TICK_DT);
    this.tick++;
    const events = w.events;
    w.events = [];
    for (const ev of events) if (ev.e === 'tile') this.changedTiles.push([ev.tx, ev.ty, ev.v]);

    // getrennte Spieler nach Kulanzzeit entfernen
    for (const c of this.clients.values()) {
      if (!c.connected && !c.resultSent && w.t - c.disconnectedAt > DISCONNECT_GRACE) w.removePlayer(c.actorId);
    }

    const sendSnap = this.tick % this.opts.snapshotEvery === 0;
    const exDirty = w.extractsDirty || this.tick % 60 === 0;
    for (const c of this.clients.values()) {
      if (c.resultSent) continue;
      const me = w.actors.get(c.actorId);
      if (me) c.lastPos = { x: me.x, y: me.y };
      const evs = this.filterEvents(events, c);
      if (c.connected && evs.length) c.send({ type: 'ev', list: evs });
      if (c.connected && sendSnap) c.send({ type: 'snap', s: this.buildSnapshot(c, me, exDirty) });
      if (c.connected) this.sendPrivate(c, false);
      const res = w.results.get(c.actorId);
      if (res && c.connected) {
        c.resultSent = true;
        c.send({ type: 'result', r: res });
      }
    }
    if (exDirty) w.extractsDirty = false;

    if (w.ended || [...this.clients.values()].every((c) => w.results.has(c.actorId))) {
      this.ended = true;
      for (const c of this.clients.values()) if (c.connected) c.send({ type: 'raidEnd' });
      this.onEnd?.();
    }
  }

  private sendPrivate(c: HostClient, force: boolean) {
    const a = this.world.actors.get(c.actorId);
    if (!a) return;
    if (force || a.invVersion !== c.lastInv) {
      c.lastInv = a.invVersion;
      c.send({ type: 'inv', inv: a.inv });
    }
    const viewing = a.viewing;
    if (viewing === null) {
      if (c.lastView !== null || force) {
        c.lastView = null;
        c.send({ type: 'cview', c: null });
      }
      return;
    }
    const cont = this.world.containers.get(viewing);
    if (!cont) return;
    if (force || viewing !== c.lastView || cont.version !== c.lastViewVersion) {
      c.lastView = viewing;
      c.lastViewVersion = cont.version;
      c.send({ type: 'cview', c: { id: cont.id, kind: cont.kind, name: cont.name, items: cont.items } });
    }
  }

  private filterEvents(events: GameEvent[], c: HostClient): GameEvent[] {
    const out: GameEvent[] = [];
    const px = c.lastPos.x;
    const py = c.lastPos.y;
    for (const ev of events) {
      if (ev.to !== undefined && ev.to !== c.actorId) continue;
      if (ev.e === 'bullet' && ev.id !== c.actorId && dist2(px, py, ev.x, ev.y) > BULLET_R2) continue;
      if ((ev.e === 'impact' || ev.e === 'hit') && dist2(px, py, ev.x, ev.y) > BULLET_R2) continue;
      out.push(ev);
    }
    return out;
  }

  private buildSnapshot(c: HostClient, me: Actor | undefined, withEx: boolean): Snapshot {
    const w = this.world;
    const px = c.lastPos.x;
    const py = c.lastPos.y;
    const list: ActorSnap[] = [];
    for (const a of w.actors.values()) {
      if (!a.alive) continue;
      if (a.kind !== 'player' && dist2(px, py, a.x, a.y) > VIEW_R2) continue;
      const wpn = activeWeapon(a.inv, a.active);
      let f = 0;
      if (a.sprint) f |= 1;
      if (a.ads) f |= 2;
      if (a.ws.reloadT > 0) f |= 4;
      if (a.action) f |= 8;
      if (a.downed) f |= 16;
      if (a.moving || Math.abs(a.vx) + Math.abs(a.vy) > 5) f |= 32;
      if (a.inv.equip.backpack) f |= 64;
      const s: ActorSnap = {
        i: a.id,
        k: a.kind === 'player' ? 'p' : 'b',
        x: a.kind === 'player' ? Math.round(a.x * 10) / 10 : Math.round(a.x),
        y: a.kind === 'player' ? Math.round(a.y * 10) / 10 : Math.round(a.y),
        a: Math.round(a.aim * 100) / 100,
        f,
        w: wpn?.id ?? '',
        h: a.inv.equip.helmet?.id ?? '',
        ar: a.inv.equip.armor ? 1 : 0,
      };
      if (a.kind === 'bot') {
        s.bt = a.botType;
        if (a.botType === 'boss') s.n = a.name;
      } else {
        s.n = a.name;
        s.c = a.color;
        s.hp = Math.round((a.hp / a.maxHp) * 100);
      }
      list.push(s);
    }
    let meSnap: MeSnap | null = null;
    if (me) {
      const wpn = activeWeapon(me.inv, me.active);
      let ex: MeSnap['ex'] = null;
      if (me.extractId) {
        const st = w.extracts.find((e) => e.def.id === me.extractId)!;
        ex = { id: me.extractId, t: me.extractT, need: w.extractNeed(me, st) };
      }
      meSnap = {
        hp: Math.round(me.hp * 10) / 10,
        mhp: me.maxHp,
        st: Math.round(me.stamina),
        bl: me.bleeding,
        dn: me.downed,
        dt: Math.round(me.downedT * 10) / 10,
        act: me.action ? { type: me.action.type, t: me.action.t, total: me.action.total } : null,
        mag: wpn?.mag ?? 0,
        ammo: wpn?.ammo ?? '',
        rl: me.ws.reloadT,
        rlt: me.ws.reloadTotal,
        eq: me.ws.equipT,
        active: me.active,
        stim: me.stimT,
        ex,
        view: me.viewing,
        alive: me.alive,
      };
      if (c.corr) {
        meSnap.corr = c.corr;
        c.corr = undefined;
      }
    }
    const snap: Snapshot = { t: Math.round(w.t * 1000) / 1000, tl: Math.max(0, w.timeLeft), a: list, me: meSnap };
    if (withEx) snap.ex = w.extractSnaps();
    return snap;
  }
}
