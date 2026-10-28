import { TILE } from '../constants';
import { Rng } from '../rng';
import {
  type BossSpawn,
  type BotSpawn,
  type ContainerKind,
  type ContainerSpawn,
  type ExtractDef,
  GameMap,
  type LockDef,
  type MapMeta,
  type Prop,
  type Zone,
} from './GameMap';
import { F_MOVE, T, TILE_FLAGS } from './tiles';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = 'n' | 's' | 'e' | 'w';

export interface DoorSpec {
  side: Side;
  /** Position entlang der Wand: 0..1 relativ oder ≥1 absolut (Kacheln ab Ecke) */
  at?: number;
  width?: number;
}

export type BuildingKind =
  | 'house'
  | 'store'
  | 'pharmacy'
  | 'office'
  | 'warehouse'
  | 'barracks'
  | 'hq'
  | 'garage'
  | 'station'
  | 'cabin'
  | 'factory'
  | 'shed'
  | 'customs'
  | 'harboroffice'
  | 'container'
  | 'ship';

export type RoomKind =
  | 'living'
  | 'kitchen'
  | 'bedroom'
  | 'bath'
  | 'hall'
  | 'storage'
  | 'office'
  | 'archive'
  | 'sales'
  | 'armory'
  | 'bunk'
  | 'workshop'
  | 'vault'
  | 'server'
  | 'canteen'
  | 'machines'
  | 'cargo';

export interface BuildingSpec {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: BuildingKind;
  doors: DoorSpec[];
  tier?: number;
  locked?: { keyId: string; name: string; tier?: number };
  maxRoom?: number;
  minRoom?: number;
  wall?: number;
  floor?: number;
  windows?: number;
  patrol?: number;
  /** Anzahl Behälter-Multiplikator */
  loot?: number;
}

interface Room extends Rect {
  kind: RoomKind;
  tier: number;
  locked?: boolean;
}

const CARD_COLORS = ['#7d2b2b', '#2b4d7d', '#3d6b3a', '#c9c2b0', '#2d2d30', '#8a6d2b', '#5a5f66', '#6b2b5a', '#a33f2a', '#e0dcd0'];

export class MapBuilder {
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  /** Kacheln, auf denen nichts platziert werden darf */
  readonly reserved: Uint8Array;
  readonly rng: Rng;
  props: Prop[] = [];
  containers: ContainerSpawn[] = [];
  extracts: ExtractDef[] = [];
  playerSpawns: { x: number; y: number }[] = [];
  botSpawns: BotSpawn[] = [];
  zones: Zone[] = [];
  locks: LockDef[] = [];
  lootSpots: { tx: number; ty: number; tier: number }[] = [];
  boss?: BossSpawn;
  warnings: string[] = [];
  private doorTiles = new Set<number>();
  private containerTiles = new Set<number>();
  private nextContainerId = 1;

  constructor(
    readonly meta: MapMeta,
    w: number,
    h: number,
    seed: number,
  ) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.reserved = new Uint8Array(w * h);
    this.rng = new Rng(seed);
  }

  // ---------- Grundoperationen ----------
  inB(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x: number, y: number) {
    return this.inB(x, y) ? this.tiles[y * this.w + x] : T.BORDER;
  }
  set(x: number, y: number, t: number) {
    if (this.inB(x, y)) this.tiles[y * this.w + x] = t;
  }
  isReserved(x: number, y: number) {
    return !this.inB(x, y) || this.reserved[y * this.w + x] === 1;
  }
  reserve(r: Rect) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (this.inB(x, y)) this.reserved[y * this.w + x] = 1;
  }
  fill(r: Rect, t: number) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) this.set(x, y, t);
  }
  outline(r: Rect, t: number) {
    for (let x = r.x; x < r.x + r.w; x++) {
      this.set(x, r.y, t);
      this.set(x, r.y + r.h - 1, t);
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      this.set(r.x, y, t);
      this.set(r.x + r.w - 1, y, t);
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, t: number, noise = 0) {
    for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) {
      for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const n = noise ? (Math.sin(x * 0.9 + y * 0.4) + Math.cos(y * 0.7 - x * 0.3)) * noise : 0;
        if (dx * dx + dy * dy <= 1 + n) this.set(x, y, t);
      }
    }
  }
  isFloor(x: number, y: number) {
    return (TILE_FLAGS[this.get(x, y)] & F_MOVE) === 0;
  }
  addZone(z: Omit<Zone, 'tier' | 'indoor' | 'patrol'> & Partial<Pick<Zone, 'tier' | 'indoor' | 'patrol'>>) {
    this.zones.push({ tier: 1, indoor: false, patrol: 1, ...z });
  }

  border(thick = 2) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) if (x < thick || y < thick || x >= this.w - thick || y >= this.h - thick) this.set(x, y, T.BORDER);
  }

  // ---------- Außenbereich ----------
  road(r: Rect, opts: { markings?: boolean; sidewalk?: boolean } = {}) {
    const { markings = true, sidewalk = true } = opts;
    if (sidewalk) {
      const s = r.w > r.h ? { x: r.x, y: r.y - 1, w: r.w, h: r.h + 2 } : { x: r.x - 1, y: r.y, w: r.w + 2, h: r.h };
      for (let y = s.y; y < s.y + s.h; y++)
        for (let x = s.x; x < s.x + s.w; x++) {
          const t = this.get(x, y);
          if (t === T.GRASS || t === T.DIRT || t === T.GRAVEL) this.set(x, y, T.CONCRETE);
        }
    }
    this.fill(r, T.ASPHALT);
    if (markings && Math.min(r.w, r.h) >= 3) {
      const horiz = r.w > r.h;
      this.props.push({
        type: 'lane',
        x: horiz ? r.x * TILE : (r.x + r.w / 2) * TILE,
        y: horiz ? (r.y + r.h / 2) * TILE : r.y * TILE,
        w: horiz ? r.w * TILE : 0,
        h: horiz ? 0 : r.h * TILE,
      });
    }
  }

  car(tx: number, ty: number, horizontal: boolean, opts: { wreck?: boolean; trunk?: number; tier?: number } = {}) {
    const w = horizontal ? 4 : 2;
    const h = horizontal ? 2 : 4;
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (this.isReserved(x, y)) return false;
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) this.set(x, y, T.LOW);
    const wreck = opts.wreck ?? this.rng.chance(0.35);
    this.props.push({
      type: wreck ? 'wreck' : 'car',
      x: tx * TILE,
      y: ty * TILE,
      w: w * TILE,
      h: h * TILE,
      rot: horizontal ? (this.rng.chance(0.5) ? 0 : Math.PI) : this.rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2,
      color: wreck ? '#5b4a3e' : this.rng.pick(CARD_COLORS),
      v: this.rng.int(0, 3),
    });
    this.reserve({ x: tx - 1, y: ty - 1, w: w + 2, h: h + 2 });
    if (this.rng.chance(opts.trunk ?? 0.4)) {
      const cx = horizontal ? tx : tx;
      const cy = horizontal ? ty : ty;
      this.placeContainer('trunk', cx, cy, opts.tier ?? 1, false);
    }
    return true;
  }

  scatter(r: Rect, t: number, density: number, opts: { on?: number[]; prop?: string; minDist?: number } = {}) {
    const on = opts.on ?? [T.GRASS, T.DIRT];
    const count = Math.round(r.w * r.h * density);
    for (let i = 0; i < count; i++) {
      const x = this.rng.int(r.x, r.x + r.w - 1);
      const y = this.rng.int(r.y, r.y + r.h - 1);
      if (this.isReserved(x, y)) continue;
      if (!on.includes(this.get(x, y))) continue;
      if (opts.minDist) {
        let bad = false;
        for (let dy = -opts.minDist; dy <= opts.minDist && !bad; dy++)
          for (let dx = -opts.minDist; dx <= opts.minDist; dx++)
            if ((dx || dy) && this.get(x + dx, y + dy) === t) {
              bad = true;
              break;
            }
        if (bad) continue;
      }
      this.set(x, y, t);
      if (opts.prop) {
        this.props.push({
          type: opts.prop,
          x: (x + 0.5) * TILE,
          y: (y + 0.5) * TILE,
          w: TILE * this.rng.range(0.9, 1.5),
          h: 0,
          v: this.rng.int(0, 5),
          rot: this.rng.range(0, Math.PI * 2),
        });
      }
    }
  }

  forest(r: Rect, density = 0.07, bushes = 0.05) {
    this.scatter(r, T.TREE, density, { prop: 'tree', minDist: 1 });
    this.scatter(r, T.BUSH, bushes, { prop: 'bush' });
  }

  fence(r: Rect, gates: { side: Side; at: number; width: number }[]) {
    this.outline(r, T.FENCE);
    for (const g of gates) {
      for (let i = 0; i < g.width; i++) {
        const p = g.at + i;
        let x = 0;
        let y = 0;
        if (g.side === 'n') [x, y] = [r.x + p, r.y];
        if (g.side === 's') [x, y] = [r.x + p, r.y + r.h - 1];
        if (g.side === 'w') [x, y] = [r.x, r.y + p];
        if (g.side === 'e') [x, y] = [r.x + r.w - 1, r.y + p];
        this.set(x, y, T.GRAVEL);
        this.reserve({ x: x - 1, y: y - 1, w: 3, h: 3 });
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, t: number, prop?: string) {
    const horiz = y0 === y1;
    const n = horiz ? x1 - x0 + 1 : y1 - y0 + 1;
    for (let i = 0; i < n; i++) {
      const x = horiz ? x0 + i : x0;
      const y = horiz ? y0 : y0 + i;
      if (this.isReserved(x, y)) continue;
      this.set(x, y, t);
      if (prop) this.props.push({ type: prop, x: x * TILE, y: y * TILE, w: TILE, h: TILE, rot: horiz ? 0 : Math.PI / 2, v: i });
    }
  }

  sandbags(x: number, y: number, len: number, horizontal: boolean) {
    if (horizontal) this.line(x, y, x + len - 1, y, T.LOW, 'sandbag');
    else this.line(x, y, x, y + len - 1, T.LOW, 'sandbag');
  }

  /** Kistenstapel (LOW) mit optionalem Behälter. */
  crates(x: number, y: number, w: number, h: number, opts: { container?: ContainerKind; tier?: number; prop?: string } = {}) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        if (this.isReserved(xx, yy) || !this.isFloor(xx, yy)) continue;
        this.set(xx, yy, T.LOW);
        this.props.push({ type: opts.prop ?? 'crate', x: xx * TILE, y: yy * TILE, w: TILE, h: TILE, v: this.rng.int(0, 3) });
      }
    if (opts.container) this.placeContainer(opts.container, x, y, opts.tier ?? 1, false);
  }

  /** Großer Prop mit blockierender Grundfläche (Container, Waggons, Kräne). */
  solidProp(type: string, x: number, y: number, w: number, h: number, tile: number = T.LOW, color?: string) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, tile);
    this.props.push({ type, x: x * TILE, y: y * TILE, w: w * TILE, h: h * TILE, color, v: this.rng.int(0, 3) });
    this.reserve({ x, y, w, h });
  }

  placeContainer(kind: ContainerKind, tx: number, ty: number, tier: number, setLow = true, chance?: number) {
    const k = ty * this.w + tx;
    if (this.containerTiles.has(k)) return;
    this.containerTiles.add(k);
    if (setLow && kind !== 'jacket' && kind !== 'duffle') this.set(tx, ty, T.LOW);
    this.containers.push({ id: this.nextContainerId++, kind, tx, ty, tier, chance });
  }

  extract(d: ExtractDef) {
    this.extracts.push(d);
  }

  // ---------- Gebäude ----------
  building(spec: BuildingSpec) {
    const rng = this.rng;
    const wallT = spec.wall ?? (spec.kind === 'container' || spec.kind === 'ship' ? T.WALL_METAL : spec.kind === 'hq' || spec.kind === 'barracks' || spec.kind === 'warehouse' || spec.kind === 'factory' || spec.kind === 'customs' ? T.WALL_CONCRETE : T.WALL);
    const floorT = spec.floor ?? defaultFloor(spec.kind);
    const tier = spec.tier ?? 1;
    const minRoom = spec.minRoom ?? 3;
    const maxRoom = spec.maxRoom ?? defaultMaxRoom(spec.kind);
    const r: Rect = { x: spec.x, y: spec.y, w: spec.w, h: spec.h };

    this.fill(r, floorT);
    this.outline(r, wallT);
    this.reserve({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 });

    // Außentüren
    const extDoors: number[] = [];
    for (const d of spec.doors) {
      const width = d.width ?? 2;
      const len = d.side === 'n' || d.side === 's' ? r.w : r.h;
      let at = d.at === undefined ? 0.5 : d.at;
      let off = at < 1 ? Math.round((len - width) * at) : Math.round(at);
      off = Math.max(1, Math.min(len - 1 - width, off));
      for (let i = 0; i < width; i++) {
        let x = 0;
        let y = 0;
        if (d.side === 'n') [x, y] = [r.x + off + i, r.y];
        if (d.side === 's') [x, y] = [r.x + off + i, r.y + r.h - 1];
        if (d.side === 'w') [x, y] = [r.x, r.y + off + i];
        if (d.side === 'e') [x, y] = [r.x + r.w - 1, r.y + off + i];
        this.set(x, y, floorT);
        this.doorTiles.add(y * this.w + x);
        extDoors.push(y * this.w + x);
        // Vorplatz frei halten
        const ox = d.side === 'e' ? 1 : d.side === 'w' ? -1 : 0;
        const oy = d.side === 's' ? 1 : d.side === 'n' ? -1 : 0;
        for (let s = 1; s <= 2; s++) {
          const fx = x + ox * s;
          const fy = y + oy * s;
          const ft = this.get(fx, fy);
          if (ft === T.TREE || ft === T.BUSH || ft === T.LOW || ft === T.ROCK || ft === T.FENCE) this.set(fx, fy, T.GRASS);
        }
      }
    }

    // BSP-Raumaufteilung
    const leaves: Rect[] = [];
    const inner: Rect = { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 };
    const bigDoors = spec.kind === 'warehouse' || spec.kind === 'factory' || spec.kind === 'station';
    const split = (reg: Rect, depth: number) => {
      const canV = reg.w >= minRoom * 2 + 1;
      const canH = reg.h >= minRoom * 2 + 1;
      const big = reg.w > maxRoom || reg.h > maxRoom;
      if (!canV && !canH) return leaves.push(reg);
      if (!big && (depth >= 4 || rng.chance(0.5))) return leaves.push(reg);
      let vertical = reg.w > reg.h ? true : reg.h > reg.w ? false : rng.chance(0.5);
      if (vertical && !canV) vertical = false;
      if (!vertical && !canH) vertical = true;
      const tryOrient = (vert: boolean): boolean => {
        const cands: number[] = [];
        if (vert) {
          for (let c = reg.x + minRoom; c <= reg.x + reg.w - 1 - minRoom; c++) {
            if (this.doorTiles.has((reg.y - 1) * this.w + c) || this.doorTiles.has((reg.y + reg.h) * this.w + c)) continue;
            cands.push(c);
          }
        } else {
          for (let rr = reg.y + minRoom; rr <= reg.y + reg.h - 1 - minRoom; rr++) {
            if (this.doorTiles.has(rr * this.w + reg.x - 1) || this.doorTiles.has(rr * this.w + reg.x + reg.w)) continue;
            cands.push(rr);
          }
        }
        if (!cands.length) return false;
        // eher mittig teilen
        cands.sort((a, b) => Math.abs(a - (vert ? reg.x + reg.w / 2 : reg.y + reg.h / 2)) - Math.abs(b - (vert ? reg.x + reg.w / 2 : reg.y + reg.h / 2)));
        const pos = cands[Math.min(cands.length - 1, Math.floor(rng.next() * Math.min(3, cands.length)))];
        const span = vert ? reg.h : reg.w;
        const dw = bigDoors && span >= 8 ? 2 : 1;
        const doorOff = rng.int(0, Math.max(0, span - dw));
        for (let i = 0; i < span; i++) {
          const x = vert ? pos : reg.x + i;
          const y = vert ? reg.y + i : pos;
          if (i >= doorOff && i < doorOff + dw) {
            this.doorTiles.add(y * this.w + x);
          } else {
            this.set(x, y, wallT);
          }
        }
        if (vert) {
          split({ x: reg.x, y: reg.y, w: pos - reg.x, h: reg.h }, depth + 1);
          split({ x: pos + 1, y: reg.y, w: reg.x + reg.w - pos - 1, h: reg.h }, depth + 1);
        } else {
          split({ x: reg.x, y: reg.y, w: reg.w, h: pos - reg.y }, depth + 1);
          split({ x: reg.x, y: pos + 1, w: reg.w, h: reg.y + reg.h - pos - 1 }, depth + 1);
        }
        return true;
      };
      if (!tryOrient(vertical) && !tryOrient(!vertical)) leaves.push(reg);
    };
    split(inner, 0);

    // Fenster
    const winP = spec.windows ?? (spec.kind === 'container' || spec.kind === 'hq' || spec.kind === 'ship' ? 0 : spec.kind === 'warehouse' || spec.kind === 'factory' ? 0.12 : 0.3);
    if (winP > 0) this.addWindows(r, wallT, winP);

    // Räume typisieren
    const rooms = this.assignRooms(spec, leaves, tier);

    // verschlossener Raum
    if (spec.locked) {
      const cand = rooms
        .map((room) => ({ room, doors: this.roomDoors(room) }))
        .filter((c) => c.doors.length === 1 && !c.doors[0].some((k) => extDoors.includes(k)) && c.room.w * c.room.h >= 9)
        .sort((a, b) => a.room.w * a.room.h - b.room.w * b.room.h);
      const pick = cand[0];
      if (pick) {
        const lockTiles: [number, number][] = [];
        for (const k of pick.doors[0]) {
          const x = k % this.w;
          const y = Math.floor(k / this.w);
          this.set(x, y, T.DOOR_LOCKED);
          lockTiles.push([x, y]);
        }
        pick.room.locked = true;
        pick.room.kind = spec.kind === 'pharmacy' ? 'storage' : spec.kind === 'office' ? 'archive' : 'vault';
        pick.room.tier = spec.locked.tier ?? Math.min(4, tier + 2);
        this.locks.push({ id: spec.id + '_lock', keyId: spec.locked.keyId, name: spec.locked.name, tiles: lockTiles });
      } else {
        this.warnings.push('Kein abschließbarer Raum in ' + spec.id);
      }
    }

    for (const room of rooms) this.furnish(room, spec, wallT);

    this.addZone({ id: spec.id, name: spec.name, x: r.x, y: r.y, w: r.w, h: r.h, tier, indoor: true, patrol: spec.patrol ?? 1 });
    return rooms;
  }

  private addWindows(r: Rect, wallT: number, p: number) {
    const sides: { x: number; y: number; dx: number; dy: number; len: number; nx: number; ny: number }[] = [
      { x: r.x, y: r.y, dx: 1, dy: 0, len: r.w, nx: 0, ny: 1 },
      { x: r.x, y: r.y + r.h - 1, dx: 1, dy: 0, len: r.w, nx: 0, ny: -1 },
      { x: r.x, y: r.y, dx: 0, dy: 1, len: r.h, nx: 1, ny: 0 },
      { x: r.x + r.w - 1, y: r.y, dx: 0, dy: 1, len: r.h, nx: -1, ny: 0 },
    ];
    for (const s of sides) {
      let i = 2;
      while (i < s.len - 2) {
        const x = s.x + s.dx * i;
        const y = s.y + s.dy * i;
        const ok = (k: number) => {
          const xx = s.x + s.dx * k;
          const yy = s.y + s.dy * k;
          if (this.get(xx, yy) !== wallT) return false;
          if (this.doorTiles.has(yy * this.w + xx)) return false;
          // keine Fenster an Innenwand-Anschlüssen
          const ix = xx + s.nx;
          const iy = yy + s.ny;
          if (!this.isFloor(ix, iy)) return false;
          // nicht direkt neben Türen
          const ax = xx - s.dx;
          const ay = yy - s.dy;
          const bx = xx + s.dx;
          const by = yy + s.dy;
          if (this.doorTiles.has(ay * this.w + ax) || this.doorTiles.has(by * this.w + bx)) return false;
          return true;
        };
        if (this.rng.chance(p) && ok(i)) {
          const len = ok(i + 1) && this.rng.chance(0.6) ? 2 : 1;
          for (let k = 0; k < len; k++) this.set(x + s.dx * k, y + s.dy * k, T.WINDOW);
          i += len + this.rng.int(2, 4);
        } else i++;
      }
    }
  }

  /** Türgruppen (zusammenhängende Türkacheln) am Rand eines Raums. */
  private roomDoors(room: Rect): number[][] {
    const found: number[] = [];
    for (let x = room.x; x < room.x + room.w; x++) {
      for (const y of [room.y - 1, room.y + room.h]) if (this.doorTiles.has(y * this.w + x)) found.push(y * this.w + x);
    }
    for (let y = room.y; y < room.y + room.h; y++) {
      for (const x of [room.x - 1, room.x + room.w]) if (this.doorTiles.has(y * this.w + x)) found.push(y * this.w + x);
    }
    const groups: number[][] = [];
    const used = new Set<number>();
    for (const k of found) {
      if (used.has(k)) continue;
      const g = [k];
      used.add(k);
      for (let i = 0; i < g.length; i++) {
        const c = g[i];
        for (const n of [c - 1, c + 1, c - this.w, c + this.w]) if (!used.has(n) && found.includes(n)) {
          used.add(n);
          g.push(n);
        }
      }
      groups.push(g);
    }
    return groups;
  }

  private assignRooms(spec: BuildingSpec, leaves: Rect[], tier: number): Room[] {
    const sorted = [...leaves].sort((a, b) => b.w * b.h - a.w * a.h);
    const rooms: Room[] = sorted.map((l) => ({ ...l, kind: 'hall' as RoomKind, tier }));
    const k = spec.kind;
    const rng = this.rng;
    rooms.forEach((room, i) => {
      const last = i === rooms.length - 1 && rooms.length > 2;
      switch (k) {
        case 'house':
          room.kind = i === 0 ? 'living' : i === 1 ? 'kitchen' : last ? 'bath' : 'bedroom';
          break;
        case 'store':
          room.kind = i === 0 ? 'sales' : rng.chance(0.5) ? 'storage' : 'office';
          break;
        case 'pharmacy':
          room.kind = i === 0 ? 'sales' : 'storage';
          break;
        case 'office':
        case 'harboroffice':
          room.kind = i === 0 ? 'hall' : rng.chance(0.25) ? 'archive' : 'office';
          break;
        case 'customs':
          room.kind = i === 0 ? 'hall' : rng.chance(0.3) ? 'archive' : rng.chance(0.4) ? 'storage' : 'office';
          break;
        case 'warehouse':
          room.kind = i === 0 ? 'storage' : rng.chance(0.5) ? 'office' : 'workshop';
          break;
        case 'factory':
          room.kind = i === 0 ? 'machines' : rng.chance(0.5) ? 'workshop' : 'office';
          break;
        case 'barracks':
          room.kind = i === rooms.length - 1 ? 'armory' : i === 0 ? 'canteen' : 'bunk';
          break;
        case 'hq':
          room.kind = i === 0 ? 'hall' : i === 1 ? 'armory' : i === 2 ? 'server' : 'office';
          break;
        case 'garage':
          room.kind = i === 0 ? 'workshop' : 'storage';
          break;
        case 'station':
          room.kind = i === 0 ? 'hall' : rng.chance(0.5) ? 'office' : 'storage';
          break;
        case 'cabin':
          room.kind = i === 0 ? 'living' : 'storage';
          break;
        case 'shed':
          room.kind = 'storage';
          break;
        case 'container':
        case 'ship':
          room.kind = 'cargo';
          break;
      }
    });
    return rooms;
  }

  /** Möbel & Behälter entlang der Wände platzieren, Türwege frei halten. */
  private furnish(room: Room, spec: BuildingSpec, _wallT: number) {
    const rng = this.rng;
    const blocked = new Set<number>();
    // Bereich um Türen sperren
    for (const g of this.roomDoors(room)) {
      for (const k of g) {
        const dx = k % this.w;
        const dy = Math.floor(k / this.w);
        for (const [nx, ny] of [
          [dx - 1, dy],
          [dx + 1, dy],
          [dx, dy - 1],
          [dx, dy + 1],
        ]) {
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) blocked.add((ny + oy) * this.w + nx + ox);
        }
      }
    }
    // Wandnahe Kacheln; Ecken nur für Möbel, damit jeder Behälter einen freien Nachbarn im Raum hat
    const wallTiles: [number, number][] = [];
    const cornerTiles: [number, number][] = [];
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++) {
        const ex = x === room.x || x === room.x + room.w - 1;
        const ey = y === room.y || y === room.y + room.h - 1;
        if ((!ex && !ey) || blocked.has(y * this.w + x)) continue;
        (ex && ey ? cornerTiles : wallTiles).push([x, y]);
      }
    rng.shuffle(wallTiles);
    rng.shuffle(cornerTiles);
    const take = (list: [number, number][]): [number, number] | undefined => {
      while (list.length) {
        const t = list.pop()!;
        const k = t[1] * this.w + t[0];
        if (this.containerTiles.has(k) || blocked.has(k) || !this.isFloor(t[0], t[1])) continue;
        return t;
      }
      return undefined;
    };
    const area = room.w * room.h;
    const lootMul = spec.loot ?? 1;
    const plan = roomPlan(room.kind, area, rng, lootMul);
    for (const c of plan.containers) {
      const t = take(wallTiles);
      if (!t) break;
      this.placeContainer(c, t[0], t[1], room.tier, true, room.locked ? undefined : plan.chance);
    }
    for (const f of plan.furniture) {
      const t = take(cornerTiles) ?? take(wallTiles);
      if (!t) break;
      this.set(t[0], t[1], T.LOW);
      this.props.push({ type: f, x: t[0] * TILE, y: t[1] * TILE, w: TILE, h: TILE, v: rng.int(0, 3), rot: wallRot(room, t[0], t[1]) });
    }
    // Deko ohne Kollision
    if (plan.rug && room.w >= 5 && room.h >= 5) {
      this.props.push({ type: 'rug', x: (room.x + 1.5) * TILE, y: (room.y + 1.5) * TILE, w: (room.w - 3) * TILE, h: (room.h - 3) * TILE, color: rng.pick(['#5a2f2f', '#2f3f5a', '#4a4a2f', '#3d2f4a']) });
    }
    // Regalreihen in Verkaufsräumen / Lagern
    if ((room.kind === 'sales' || room.kind === 'storage' || room.kind === 'machines') && room.w >= 8 && room.h >= 7) {
      const vertical = room.h > room.w;
      const prop = room.kind === 'machines' ? 'machine' : room.kind === 'sales' ? 'shelfrow' : 'crate';
      const x0 = room.x + 2;
      const y0 = room.y + 2;
      const x1 = room.x + room.w - 3;
      const y1 = room.y + room.h - 3;
      if (!vertical) {
        for (let y = y0; y <= y1; y += 3) {
          const gap = Math.floor((x0 + x1) / 2);
          for (let x = x0; x <= x1; x++) {
            if (Math.abs(x - gap) <= 0 || this.containerTiles.has(y * this.w + x)) continue;
            this.set(x, y, T.LOW);
            this.props.push({ type: prop, x: x * TILE, y: y * TILE, w: TILE, h: TILE, v: rng.int(0, 3) });
            if (rng.chance(room.kind === 'sales' ? 0.12 : 0.08)) this.placeContainer(room.kind === 'sales' ? (spec.kind === 'pharmacy' ? 'medcase' : 'shelf') : 'crate', x, y, room.tier, true, 0.8);
          }
        }
      } else {
        for (let x = x0; x <= x1; x += 3) {
          const gap = Math.floor((y0 + y1) / 2);
          for (let y = y0; y <= y1; y++) {
            if (Math.abs(y - gap) <= 0 || this.containerTiles.has(y * this.w + x)) continue;
            this.set(x, y, T.LOW);
            this.props.push({ type: prop, x: x * TILE, y: y * TILE, w: TILE, h: TILE, v: rng.int(0, 3) });
            if (rng.chance(room.kind === 'sales' ? 0.12 : 0.08)) this.placeContainer(room.kind === 'sales' ? (spec.kind === 'pharmacy' ? 'medcase' : 'shelf') : 'crate', x, y, room.tier, true, 0.8);
          }
        }
      }
    }
    // lose Beute auf dem Boden
    if (rng.chance(0.55) && area >= 9) {
      const x = rng.int(room.x + 1, room.x + room.w - 2);
      const y = rng.int(room.y + 1, room.y + room.h - 2);
      if (this.isFloor(x, y)) this.lootSpots.push({ tx: x, ty: y, tier: room.tier });
    }
  }

  // ---------- Abschluss ----------
  build(): GameMap {
    const m = new GameMap(this.meta, this.w, this.h, this.tiles);
    m.props = this.props;
    m.extracts = this.extracts;
    m.playerSpawns = this.playerSpawns;
    m.zones = this.zones;
    m.locks = this.locks;
    m.boss = this.boss;

    // Erreichbarkeit prüfen (verschlossene Türen gelten als passierbar)
    const reach = new Uint8Array(this.w * this.h);
    const start = this.playerSpawns[0];
    if (start) {
      const sx = Math.floor(start.x / TILE);
      const sy = Math.floor(start.y / TILE);
      const q: number[] = [sy * this.w + sx];
      reach[q[0]] = 1;
      while (q.length) {
        const k = q.pop()!;
        const x = k % this.w;
        const y = (k - x) / this.w;
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ]) {
          if (!this.inB(nx, ny)) continue;
          const nk = ny * this.w + nx;
          if (reach[nk]) continue;
          const t = this.tiles[nk];
          if (TILE_FLAGS[t] & F_MOVE && t !== T.DOOR_LOCKED) continue;
          reach[nk] = 1;
          q.push(nk);
        }
      }
    }
    const reachable = (tx: number, ty: number) => this.inB(tx, ty) && reach[ty * this.w + tx] === 1;
    const reachAround = (tx: number, ty: number) =>
      reachable(tx, ty) || reachable(tx + 1, ty) || reachable(tx - 1, ty) || reachable(tx, ty + 1) || reachable(tx, ty - 1);

    m.containers = this.containers.filter((c) => reachAround(c.tx, c.ty));
    m.lootSpots = this.lootSpots.filter((l) => reachable(l.tx, l.ty));
    // Punkte auf die nächste erreichbare, freie Kachel schieben
    const snap = (p: { x: number; y: number }, what: string) => {
      const tx = Math.floor(p.x / TILE);
      const ty = Math.floor(p.y / TILE);
      if (reachable(tx, ty) && this.tiles[ty * this.w + tx] !== T.DOOR_LOCKED) return true;
      for (let r = 1; r <= 8; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (reachable(tx + dx, ty + dy) && this.tiles[(ty + dy) * this.w + tx + dx] !== T.DOOR_LOCKED) {
              p.x = (tx + dx + 0.5) * TILE;
              p.y = (ty + dy + 0.5) * TILE;
              return true;
            }
          }
      this.warnings.push(`${what} unerreichbar (${tx},${ty})`);
      return false;
    };
    m.botSpawns = this.botSpawns.filter((b) => snap(b, 'Bot-Spawn'));
    for (const p of this.playerSpawns) snap(p, 'Spieler-Spawn');
    for (const e of this.extracts) snap(e, 'Extraktion ' + e.id);
    if (this.boss) {
      snap(this.boss, 'Boss');
      for (const g of this.boss.guards) snap(g, 'Wache');
    }
    const lostContainers = this.containers.length - m.containers.length;
    if (lostContainers > 0) this.warnings.push(`${lostContainers} Behälter unerreichbar entfernt`);
    (m as GameMap & { warnings?: string[] }).warnings = this.warnings;
    return m;
  }
}

function defaultFloor(k: BuildingKind): number {
  switch (k) {
    case 'house':
    case 'cabin':
      return T.WOOD;
    case 'store':
    case 'pharmacy':
    case 'office':
    case 'station':
    case 'harboroffice':
    case 'customs':
      return T.TILEFLOOR;
    case 'container':
    case 'ship':
      return T.METALFLOOR;
    default:
      return T.INDOOR;
  }
}

function defaultMaxRoom(k: BuildingKind): number {
  switch (k) {
    case 'warehouse':
    case 'factory':
    case 'station':
      return 16;
    case 'store':
    case 'pharmacy':
      return 11;
    case 'container':
    case 'shed':
      return 40;
    default:
      return 7;
  }
}

function wallRot(room: Rect, x: number, y: number): number {
  if (y === room.y) return Math.PI / 2;
  if (y === room.y + room.h - 1) return -Math.PI / 2;
  if (x === room.x) return 0;
  return Math.PI;
}

interface RoomPlan {
  containers: ContainerKind[];
  furniture: string[];
  rug?: boolean;
  chance?: number;
}

function roomPlan(kind: RoomKind, area: number, rng: Rng, mul: number): RoomPlan {
  const n = (base: number) => Math.max(0, Math.round((base + area / 30) * mul * rng.range(0.6, 1.3)));
  const pickN = (list: ContainerKind[], count: number) => Array.from({ length: count }, () => rng.pick(list));
  switch (kind) {
    case 'living':
      return { containers: pickN(['jacket', 'crate', 'desk'], n(1)), furniture: ['sofa', 'table', 'tv'].slice(0, rng.int(1, 3)), rug: true, chance: 0.8 };
    case 'kitchen':
      return { containers: pickN(['fridge', 'crate'], n(1)), furniture: ['counter', 'counter', 'stove'].slice(0, rng.int(1, 3)), chance: 0.8 };
    case 'bedroom':
      return { containers: pickN(['jacket', 'desk', 'duffle'], n(1)), furniture: ['bed', 'wardrobe'].slice(0, rng.int(1, 2)), rug: rng.chance(0.4), chance: 0.8 };
    case 'bath':
      return { containers: ['medcase'], furniture: ['sink'], chance: 0.7 };
    case 'hall':
      return { containers: pickN(['jacket', 'desk', 'crate'], Math.min(2, n(0))), furniture: ['bench', 'plant'].slice(0, rng.int(0, 2)), chance: 0.7 };
    case 'storage':
      return { containers: pickN(['crate', 'crate', 'toolbox', 'shelf'], n(2)), furniture: ['barrel'].slice(0, rng.int(0, 1)), chance: 0.85 };
    case 'office':
      return { containers: pickN(['desk', 'filing', 'pc', 'jacket'], n(1.5)), furniture: ['plant', 'printer'].slice(0, rng.int(0, 2)), chance: 0.8 };
    case 'archive':
      return { containers: pickN(['filing', 'filing', 'safe', 'pc'], n(2)), furniture: [], chance: 0.9 };
    case 'sales':
      return { containers: pickN(['register', 'shelf'], n(0.5)), furniture: ['counter'], chance: 0.8 };
    case 'armory':
      return { containers: pickN(['weaponbox', 'ammobox', 'ammobox', 'crate'], n(2)), furniture: ['rack'], chance: 0.85 };
    case 'bunk':
      return { containers: pickN(['duffle', 'jacket', 'ammobox'], n(1.5)), furniture: ['bunk', 'bunk', 'locker'].slice(0, rng.int(1, 3)), chance: 0.8 };
    case 'workshop':
      return { containers: pickN(['toolbox', 'toolbox', 'crate'], n(1.5)), furniture: ['workbench', 'barrel'].slice(0, rng.int(1, 2)), chance: 0.85 };
    case 'vault':
      return { containers: ['safe', 'weaponbox', ...pickN(['safe', 'filing', 'weaponbox', 'medcase', 'ammobox'], 2 + Math.round(mul))], furniture: [] };
    case 'server':
      return { containers: pickN(['pc', 'pc', 'filing'], n(2)), furniture: ['serverrack', 'serverrack'], chance: 0.9 };
    case 'canteen':
      return { containers: pickN(['fridge', 'crate', 'jacket'], n(1)), furniture: ['table', 'table', 'counter'].slice(0, rng.int(1, 3)), chance: 0.8 };
    case 'machines':
      return { containers: pickN(['toolbox', 'crate'], n(1)), furniture: ['barrel'], chance: 0.8 };
    case 'cargo':
      return { containers: pickN(['crate', 'crate', 'weaponbox', 'toolbox', 'duffle'], n(1)), furniture: [], chance: 0.75 };
  }
}
