import type { Inventory } from '../../shared/inventory';
import { lerp, lerpAngle } from '../../shared/math';
import type { GameMap } from '../../shared/map/GameMap';
import { buildMap } from '../../shared/map/maps';
import type { ContainerView, RaidStartInfo } from '../../shared/net/protocol';
import type { ActorSnap, ContainerInfo, ExtractSnap, GameEvent, MeSnap, RaidResult, Snapshot } from '../../shared/sim/types';

export interface RenderActor extends ActorSnap {
  vis: number;
  stepAcc: number;
  px: number;
  py: number;
  hitT: number;
  seenAt: number;
}

export interface ClientContainer extends ContainerInfo {
  searched?: boolean;
  empty?: boolean;
}

interface BufferedSnap {
  t: number;
  actors: Map<number, ActorSnap>;
}

/** Client-seitiger Spielzustand: Snapshot-Puffer, Interpolation, Behälter, Extraktionen. */
export class ViewState {
  readonly map: GameMap;
  readonly info: RaidStartInfo;
  you: number;
  containers = new Map<number, ClientContainer>();
  extracts: ExtractSnap[];
  me: MeSnap | null = null;
  inv: Inventory | null = null;
  cview: ContainerView | null = null;
  result: RaidResult | null = null;
  ended = false;
  timeLeft: number;
  private snaps: BufferedSnap[] = [];
  actors = new Map<number, RenderActor>();
  private offset: number | null = null;
  private events: GameEvent[] = [];
  delay: number;
  lastSnapAt = 0;
  latestT = 0;

  constructor(info: RaidStartInfo, delay: number) {
    this.info = info;
    this.you = info.you;
    this.map = buildMap(info.mapId);
    for (const [tx, ty, v] of info.tiles) this.map.set(tx, ty, v);
    for (const c of info.containers) this.containers.set(c.id, { ...c });
    this.extracts = info.extracts;
    this.timeLeft = info.timeLeft;
    this.delay = delay;
  }

  /** Erneuter Start (Reconnect) – Zustand übernehmen. */
  reset(info: RaidStartInfo) {
    this.you = info.you;
    for (const [tx, ty, v] of info.tiles) this.map.set(tx, ty, v);
    const prev = this.containers;
    this.containers = new Map();
    for (const c of info.containers) this.containers.set(c.id, { ...c, searched: prev.get(c.id)?.searched, empty: prev.get(c.id)?.empty });
    this.extracts = info.extracts;
    this.timeLeft = info.timeLeft;
    this.snaps = [];
    this.offset = null;
  }

  onSnap(s: Snapshot, now: number) {
    const m = new Map<number, ActorSnap>();
    for (const a of s.a) m.set(a.i, a);
    this.snaps.push({ t: s.t, actors: m });
    if (this.snaps.length > 40) this.snaps.splice(0, this.snaps.length - 40);
    this.me = s.me;
    this.timeLeft = s.tl;
    if (s.ex) this.extracts = s.ex;
    const est = s.t - now;
    // Maximum-Filter gegen Jitter; großer Rücksprung (Pause, Hänger) wird sofort übernommen
    if (this.offset === null || est > this.offset || est < this.offset - 0.3) this.offset = est;
    else this.offset += (est - this.offset) * 0.03;
    this.lastSnapAt = now;
    this.latestT = s.t;
  }

  pushEvents(list: GameEvent[]) {
    for (const e of list) this.events.push(e);
  }

  renderTime(now: number) {
    return now + (this.offset ?? 0) - this.delay;
  }

  /** Liefert alle Ereignisse, deren Zeit erreicht ist. */
  takeEvents(now: number, immediate: (e: GameEvent) => boolean): GameEvent[] {
    const rt = this.renderTime(now);
    const out: GameEvent[] = [];
    const keep: GameEvent[] = [];
    for (const e of this.events) {
      if (immediate(e) || (e.t ?? 0) <= rt || this.offset === null) out.push(e);
      else keep.push(e);
    }
    this.events = keep;
    return out;
  }

  interpolate(now: number, dt: number) {
    if (!this.snaps.length) return;
    const rt = this.renderTime(now);
    let i1 = this.snaps.findIndex((s) => s.t >= rt);
    let alpha = 1;
    let s0: BufferedSnap;
    let s1: BufferedSnap;
    if (i1 === -1) {
      s1 = this.snaps[this.snaps.length - 1];
      s0 = this.snaps[this.snaps.length - 2] ?? s1;
      alpha = s1.t > s0.t ? Math.min(1.4, (rt - s0.t) / (s1.t - s0.t)) : 1;
    } else if (i1 === 0) {
      s0 = s1 = this.snaps[0];
    } else {
      s1 = this.snaps[i1];
      s0 = this.snaps[i1 - 1];
      alpha = s1.t > s0.t ? (rt - s0.t) / (s1.t - s0.t) : 1;
    }
    const seen = new Set<number>();
    for (const [id, a1] of s1.actors) {
      const a0 = s0.actors.get(id) ?? a1;
      seen.add(id);
      let ra = this.actors.get(id);
      const x = lerp(a0.x, a1.x, alpha);
      const y = lerp(a0.y, a1.y, alpha);
      if (!ra) {
        ra = { ...a1, x, y, vis: 0, stepAcc: 0, px: x, py: y, hitT: -1, seenAt: -1 };
        this.actors.set(id, ra);
      } else {
        ra.px = ra.x;
        ra.py = ra.y;
        Object.assign(ra, a1);
        ra.x = x;
        ra.y = y;
      }
      ra.a = lerpAngle(a0.a, a1.a, Math.min(1, alpha));
      if (ra.hitT >= 0) ra.hitT += dt;
    }
    for (const id of [...this.actors.keys()]) if (!seen.has(id)) this.actors.delete(id);
    // alte Snapshots verwerfen
    while (this.snaps.length > 3 && this.snaps[1].t < rt - 0.5) this.snaps.shift();
  }

  extractState(id: string) {
    return this.extracts.find((e) => e.id === id);
  }
}
