import { TILE } from '../constants';
import { F_BULLET, F_LOW, F_MOVE, F_SIGHT, T, TILE_FLAGS } from './tiles';

export type ContainerKind =
  | 'crate'
  | 'weaponbox'
  | 'ammobox'
  | 'medcase'
  | 'toolbox'
  | 'filing'
  | 'safe'
  | 'jacket'
  | 'pc'
  | 'shelf'
  | 'desk'
  | 'register'
  | 'duffle'
  | 'trunk'
  | 'fridge'
  | 'corpse'
  | 'drop';

export const CONTAINER_NAMES: Record<ContainerKind, string> = {
  crate: 'Holzkiste',
  weaponbox: 'Waffenkiste',
  ammobox: 'Munitionskiste',
  medcase: 'Medizinschrank',
  toolbox: 'Werkzeugkiste',
  filing: 'Aktenschrank',
  safe: 'Tresor',
  jacket: 'Jacke',
  pc: 'Computer',
  shelf: 'Regal',
  desk: 'Schreibtisch',
  register: 'Kasse',
  duffle: 'Seesack',
  trunk: 'Kofferraum',
  fridge: 'Kühlschrank',
  corpse: 'Leiche',
  drop: 'Abgelegte Gegenstände',
};

export interface ContainerSpawn {
  id: number;
  kind: ContainerKind;
  tx: number;
  ty: number;
  tier: number;
  /** Erscheint nur mit dieser Wahrscheinlichkeit */
  chance?: number;
}

export interface Prop {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  color?: string;
  v?: number;
}

export type ExtractKind = 'open' | 'chance' | 'timed' | 'paid' | 'key' | 'heli';

export interface ExtractDef {
  id: string;
  name: string;
  x: number;
  y: number;
  r: number;
  kind: ExtractKind;
  chance?: number;
  openAt?: number;
  cost?: number;
  keyId?: string;
  desc: string;
}

export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Beute-Stufe der Zone */
  tier: number;
  indoor: boolean;
  /** Patrouillen-Gewicht für Bots */
  patrol: number;
}

export interface LockDef {
  id: string;
  keyId: string;
  name: string;
  tiles: [number, number][];
}

export interface BotSpawn {
  x: number;
  y: number;
  kind: 'scav' | 'pmc';
}

export interface BossSpawn {
  x: number;
  y: number;
  name: string;
  guards: { x: number; y: number }[];
  chance: number;
  weapon: string;
  zone: string;
}

export interface MapMeta {
  id: string;
  name: string;
  desc: string;
  raidTime: number;
  minLevel: number;
  scavGroups: number;
  pmcGroups: number;
  ambient: string;
}

const BORDER_FLAGS = TILE_FLAGS[T.BORDER];

export class GameMap {
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  props: Prop[] = [];
  containers: ContainerSpawn[] = [];
  extracts: ExtractDef[] = [];
  playerSpawns: { x: number; y: number }[] = [];
  botSpawns: BotSpawn[] = [];
  zones: Zone[] = [];
  locks: LockDef[] = [];
  lootSpots: { tx: number; ty: number; tier: number }[] = [];
  boss?: BossSpawn;
  /** Wird bei jeder Kachel-Änderung erhöht (Cache-Invalidierung). */
  version = 0;

  constructor(
    readonly meta: MapMeta,
    w: number,
    h: number,
    tiles?: Uint8Array,
  ) {
    this.w = w;
    this.h = h;
    this.tiles = tiles ?? new Uint8Array(w * h);
  }

  get id() {
    return this.meta.id;
  }
  get pixelW() {
    return this.w * TILE;
  }
  get pixelH() {
    return this.h * TILE;
  }

  inBounds(tx: number, ty: number) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }
  get(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return T.BORDER;
    return this.tiles[ty * this.w + tx];
  }
  set(tx: number, ty: number, t: number) {
    if (!this.inBounds(tx, ty)) return;
    this.tiles[ty * this.w + tx] = t;
    this.version++;
  }
  flags(tx: number, ty: number): number {
    return TILE_FLAGS[this.get(tx, ty)];
  }
  blocksMove(tx: number, ty: number) {
    return (this.flags(tx, ty) & F_MOVE) !== 0;
  }
  walkable(tx: number, ty: number) {
    return (this.flags(tx, ty) & F_MOVE) === 0;
  }
  tileAtWorld(x: number, y: number) {
    return this.get(Math.floor(x / TILE), Math.floor(y / TILE));
  }
  flagsAtWorld(x: number, y: number) {
    return TILE_FLAGS[this.tileAtWorld(x, y)];
  }

  /**
   * DDA-Strahlverfolgung. (dx,dy) muss normiert sein.
   * Gibt die Distanz bis zur ersten blockierenden Kachel zurück (max. maxDist).
   * `ignoreLowWithin`: niedrige Deckung in dieser Nähe zum Startpunkt wird ignoriert (über Deckung schießen).
   */
  raycast(x0: number, y0: number, dx: number, dy: number, maxDist: number, mask: number, ignoreLowWithin = 0): number {
    let tx = Math.floor(x0 / TILE);
    let ty = Math.floor(y0 / TILE);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
    let tMaxX = dx > 0 ? ((tx + 1) * TILE - x0) / dx : dx < 0 ? (tx * TILE - x0) / dx : Infinity;
    let tMaxY = dy > 0 ? ((ty + 1) * TILE - y0) / dy : dy < 0 ? (ty * TILE - y0) / dy : Infinity;
    const w = this.w;
    const h = this.h;
    const tiles = this.tiles;
    for (let guard = 0; guard < 4096; guard++) {
      let t: number;
      if (tMaxX < tMaxY) {
        t = tMaxX;
        tMaxX += tDeltaX;
        tx += stepX;
      } else {
        t = tMaxY;
        tMaxY += tDeltaY;
        ty += stepY;
      }
      if (t >= maxDist) return maxDist;
      const f = tx < 0 || ty < 0 || tx >= w || ty >= h ? BORDER_FLAGS : TILE_FLAGS[tiles[ty * w + tx]];
      if (f & mask) {
        // über niedrige Deckung direkt vor dem Schützen hinwegschießen
        if (ignoreLowWithin > 0 && f & F_LOW && t < ignoreLowWithin) continue;
        return t;
      }
    }
    return maxDist;
  }

  /** Sichtlinie / Schusslinie zwischen zwei Punkten frei? */
  clearLine(x0: number, y0: number, x1: number, y1: number, mask: number, ignoreLowWithin = 0): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    return this.raycast(x0, y0, dx / d, dy / d, d, mask, ignoreLowWithin) >= d - 0.01;
  }

  canSee(x0: number, y0: number, x1: number, y1: number) {
    return this.clearLine(x0, y0, x1, y1, F_SIGHT);
  }

  /** Prüft, ob ein Kreis mit blockierenden Kacheln überlappt. */
  circleBlocked(x: number, y: number, r: number, mask = F_MOVE): boolean {
    const x0 = Math.floor((x - r) / TILE);
    const x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE);
    const y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!(this.flags(tx, ty) & mask)) continue;
        const cx = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE));
        const cy = Math.max(ty * TILE, Math.min(y, (ty + 1) * TILE));
        const ddx = x - cx;
        const ddy = y - cy;
        if (ddx * ddx + ddy * ddy < r * r - 0.01) return true;
      }
    }
    return false;
  }

  /** Schiebt einen Kreis aus blockierenden Kacheln heraus. */
  private resolve(p: { x: number; y: number }, r: number) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const x0 = Math.floor((p.x - r) / TILE);
      const x1 = Math.floor((p.x + r) / TILE);
      const y0 = Math.floor((p.y - r) / TILE);
      const y1 = Math.floor((p.y + r) / TILE);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (!this.blocksMove(tx, ty)) continue;
          const rx = tx * TILE;
          const ry = ty * TILE;
          const cx = Math.max(rx, Math.min(p.x, rx + TILE));
          const cy = Math.max(ry, Math.min(p.y, ry + TILE));
          let ddx = p.x - cx;
          let ddy = p.y - cy;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 >= r * r) continue;
          if (d2 < 1e-6) {
            // Mittelpunkt in der Kachel: zur nächsten Kante schieben
            const l = p.x - rx;
            const rr = rx + TILE - p.x;
            const t = p.y - ry;
            const b = ry + TILE - p.y;
            const m = Math.min(l, rr, t, b);
            if (m === l) p.x = rx - r;
            else if (m === rr) p.x = rx + TILE + r;
            else if (m === t) p.y = ry - r;
            else p.y = ry + TILE + r;
          } else {
            const d = Math.sqrt(d2);
            ddx /= d;
            ddy /= d;
            p.x = cx + ddx * r;
            p.y = cy + ddy * r;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /** Bewegt einen Kreis mit Kollision (gleitet an Wänden entlang). */
  moveCircle(x: number, y: number, dx: number, dy: number, r: number): { x: number; y: number } {
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / 8));
    const p = { x, y };
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      p.x += sx;
      this.resolve(p, r);
      p.y += sy;
      this.resolve(p, r);
    }
    p.x = Math.max(r, Math.min(this.pixelW - r, p.x));
    p.y = Math.max(r, Math.min(this.pixelH - r, p.y));
    return p;
  }

  zoneAt(x: number, y: number): Zone | undefined {
    const tx = x / TILE;
    const ty = y / TILE;
    let best: Zone | undefined;
    for (const z of this.zones) {
      if (tx >= z.x && ty >= z.y && tx < z.x + z.w && ty < z.y + z.h) {
        if (!best || z.w * z.h < best.w * best.h) best = z;
      }
    }
    return best;
  }

  /** Nächstgelegene begehbare Kachel (Spiralsuche). */
  nearestWalkable(tx: number, ty: number, maxR = 12): [number, number] | undefined {
    if (this.walkable(tx, ty)) return [tx, ty];
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.walkable(tx + dx, ty + dy)) return [tx + dx, ty + dy];
        }
      }
    }
    return undefined;
  }
}

export const tileCenter = (t: number) => t * TILE + TILE / 2;
export { F_BULLET, F_LOW, F_MOVE, F_SIGHT };
