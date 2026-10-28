import { TILE } from '../../shared/constants';
import type { GameMap, Prop } from '../../shared/map/GameMap';
import { F_MOVE, T, TILE_FLAGS } from '../../shared/map/tiles';

export const CHUNK = 16;
const CHUNK_PX = CHUNK * TILE;

/** Deterministisches Rauschen pro Kachel. */
function hash(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const FLOOR: Record<number, [string, string, string]> = {
  [T.GRASS]: ['#3b5131', '#33472b', '#46603a'],
  [T.DIRT]: ['#5a4a36', '#4e402f', '#66553f'],
  [T.ASPHALT]: ['#36383c', '#2f3134', '#3e4045'],
  [T.CONCRETE]: ['#6a6b66', '#5f605b', '#75766f'],
  [T.GRAVEL]: ['#615a50', '#544e45', '#6d665b'],
  [T.SAND]: ['#a3936a', '#958660', '#b1a175'],
  [T.WOOD]: ['#6b4f34', '#5e452d', '#775a3c'],
  [T.TILEFLOOR]: ['#83857e', '#777972', '#8f918a'],
  [T.INDOOR]: ['#585a56', '#4f514d', '#62645f'],
  [T.CARPET]: ['#563131', '#4b2a2a', '#613838'],
  [T.METALFLOOR]: ['#47505a', '#3f474f', '#515a64'],
  [T.DOCK]: ['#634f3c', '#574533', '#6f5a45'],
  [T.RAIL]: ['#4f4840', '#463f38', '#5a5249'],
  [T.WATER]: ['#22425f', '#1e3b55', '#28496a'],
};

const WALLC: Record<number, [string, string]> = {
  [T.WALL]: ['#2b2522', '#4f433b'],
  [T.WALL_CONCRETE]: ['#26292d', '#4a4f56'],
  [T.WALL_METAL]: ['#283039', '#46525e'],
  [T.DOOR_LOCKED]: ['#4a3622', '#7a5a38'],
  [T.BORDER]: ['#0f170c', '#1c2a16'],
  [T.ROCK]: ['#4a4a48', '#6a6a66'],
};

const isWallish = (t: number) => t === T.WALL || t === T.WALL_CONCRETE || t === T.WALL_METAL || t === T.DOOR_LOCKED || t === T.BORDER;
const isPlainFloor = (t: number) => !!FLOOR[t] && (TILE_FLAGS[t] & F_MOVE) === 0;

export class MapPainter {
  private chunks = new Map<number, { canvas: HTMLCanvasElement; scale: number; used: number; version: number }>();
  private dirty = new Set<number>();
  private propIndex = new Map<number, Prop[]>();
  private frame = 0;
  readonly cw: number;
  readonly ch: number;
  /** Requisiten, die über Akteuren gezeichnet werden */
  overProps: Prop[] = [];
  private floorUnder: Uint8Array;
  private overview: HTMLCanvasElement | null = null;

  constructor(private map: GameMap) {
    this.cw = Math.ceil(map.w / CHUNK);
    this.ch = Math.ceil(map.h / CHUNK);
    for (const p of map.props) {
      if (p.type === 'tree' || p.type === 'bush' || p.type === 'crane' || p.type === 'canopy' || p.type === 'tower') {
        this.overProps.push(p);
        if (p.type !== 'tree' && p.type !== 'bush') continue;
      }
      const bx = propBounds(p);
      for (let cy = Math.floor(bx.y0 / CHUNK_PX); cy <= Math.floor(bx.y1 / CHUNK_PX); cy++)
        for (let cx = Math.floor(bx.x0 / CHUNK_PX); cx <= Math.floor(bx.x1 / CHUNK_PX); cx++) {
          const k = cy * this.cw + cx;
          let l = this.propIndex.get(k);
          if (!l) this.propIndex.set(k, (l = []));
          l.push(p);
        }
    }
    // Bodenart unter blockierenden Kacheln aus Nachbarn ableiten
    this.floorUnder = new Uint8Array(map.w * map.h);
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const t = map.get(x, y);
        if (isPlainFloor(t)) {
          this.floorUnder[y * map.w + x] = t;
          continue;
        }
        const counts = new Map<number, number>();
        for (let r = 1; r <= 3; r++) {
          for (const [dx, dy] of [
            [r, 0],
            [-r, 0],
            [0, r],
            [0, -r],
            [r, r],
            [-r, -r],
            [r, -r],
            [-r, r],
          ]) {
            const n = map.get(x + dx, y + dy);
            if (isPlainFloor(n) && n !== T.WATER) counts.set(n, (counts.get(n) ?? 0) + 1);
          }
          if (counts.size) break;
        }
        let best: number = T.GRASS;
        let bc = -1;
        for (const [k, v] of counts) if (v > bc) [best, bc] = [k, v];
        this.floorUnder[y * map.w + x] = best;
      }
  }

  invalidateTile(tx: number, ty: number) {
    const cx = Math.floor(tx / CHUNK);
    const cy = Math.floor(ty / CHUNK);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) this.dirty.add(y * this.cw + x);
    this.overview = null;
  }

  /** Zeichnet alle sichtbaren Chunks in Welt-Koordinaten (ctx ist bereits transformiert). */
  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, pxPerUnit: number) {
    this.frame++;
    const scale = pxPerUnit > 1.6 ? 2 : pxPerUnit > 1.05 ? 1.5 : 1;
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK_PX));
    const cy0 = Math.max(0, Math.floor(y0 / CHUNK_PX));
    const cx1 = Math.min(this.cw - 1, Math.floor(x1 / CHUNK_PX));
    const cy1 = Math.min(this.ch - 1, Math.floor(y1 / CHUNK_PX));
    let baked = 0;
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = cy * this.cw + cx;
        let c = this.chunks.get(k);
        if (!c || c.scale !== scale || this.dirty.has(k)) {
          // pro Frame begrenzt neu backen, notfalls alte Auflösung weiterverwenden
          if (!c || this.dirty.has(k) || baked < 2) {
            const canvas = c && c.canvas.width === Math.ceil(CHUNK_PX * scale) ? c.canvas : document.createElement('canvas');
            this.bake(canvas, cx, cy, scale);
            c = { canvas, scale, used: this.frame, version: 0 };
            this.chunks.set(k, c);
            this.dirty.delete(k);
            baked++;
          }
        }
        c!.used = this.frame;
        ctx.drawImage(c!.canvas, cx * CHUNK_PX, cy * CHUNK_PX, CHUNK_PX, CHUNK_PX);
      }
    // LRU
    if (this.chunks.size > 36) {
      const arr = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < arr.length - 30; i++) {
        arr[i][1].canvas.width = 0;
        this.chunks.delete(arr[i][0]);
      }
    }
  }

  private bake(canvas: HTMLCanvasElement, cx: number, cy: number, scale: number) {
    const px = Math.ceil(CHUNK_PX * scale);
    canvas.width = px;
    canvas.height = px;
    const g = canvas.getContext('2d')!;
    g.setTransform(scale, 0, 0, scale, -cx * CHUNK_PX * scale, -cy * CHUNK_PX * scale);
    const m = this.map;
    const tx0 = cx * CHUNK;
    const ty0 = cy * CHUNK;
    // Böden (inkl. Rand für Überlappung)
    for (let ty = ty0 - 1; ty < ty0 + CHUNK + 1; ty++)
      for (let tx = tx0 - 1; tx < tx0 + CHUNK + 1; tx++) {
        if (!m.inBounds(tx, ty)) continue;
        const t = m.get(tx, ty);
        const f = t === T.WATER ? T.WATER : isPlainFloor(t) ? t : this.floorUnder[ty * m.w + tx];
        this.drawFloor(g, f, tx, ty);
      }
    // Wasserkanten
    for (let ty = ty0; ty < ty0 + CHUNK; ty++)
      for (let tx = tx0; tx < tx0 + CHUNK; tx++) {
        if (m.get(tx, ty) !== T.WATER) continue;
        g.strokeStyle = 'rgba(200,225,240,0.35)';
        g.lineWidth = 2;
        const X = tx * TILE;
        const Y = ty * TILE;
        g.beginPath();
        if (m.get(tx, ty - 1) !== T.WATER) (g.moveTo(X, Y + 1), g.lineTo(X + TILE, Y + 1));
        if (m.get(tx, ty + 1) !== T.WATER) (g.moveTo(X, Y + TILE - 1), g.lineTo(X + TILE, Y + TILE - 1));
        if (m.get(tx - 1, ty) !== T.WATER) (g.moveTo(X + 1, Y), g.lineTo(X + 1, Y + TILE));
        if (m.get(tx + 1, ty) !== T.WATER) (g.moveTo(X + TILE - 1, Y), g.lineTo(X + TILE - 1, Y + TILE));
        g.stroke();
      }
    // Bodenrequisiten (Teppiche, Markierungen)
    const props = this.propIndex.get(cy * this.cw + cx) ?? [];
    for (const p of props) if (p.type === 'rug' || p.type === 'lane' || p.type === 'rails' || p.type === 'rails_v' || p.type === 'helipad' || p.type === 'manhole') drawProp(g, p);
    // Schatten der Wände
    g.fillStyle = 'rgba(0,0,0,0.32)';
    for (let ty = ty0 - 1; ty < ty0 + CHUNK + 1; ty++)
      for (let tx = tx0 - 1; tx < tx0 + CHUNK + 1; tx++) {
        const t = m.get(tx, ty);
        if (isWallish(t) && t !== T.BORDER) g.fillRect(tx * TILE + 5, ty * TILE + 6, TILE, TILE);
      }
    // Hindernisse & Wände
    for (let ty = ty0 - 1; ty < ty0 + CHUNK + 1; ty++)
      for (let tx = tx0 - 1; tx < tx0 + CHUNK + 1; tx++) {
        if (!m.inBounds(tx, ty)) continue;
        this.drawSolid(g, m.get(tx, ty), tx, ty);
      }
    // Requisiten
    for (const p of props) {
      if (p.type === 'rug' || p.type === 'lane' || p.type === 'rails' || p.type === 'rails_v' || p.type === 'helipad' || p.type === 'manhole') continue;
      if (p.type === 'bush') continue;
      drawProp(g, p);
    }
  }

  private drawFloor(g: CanvasRenderingContext2D, t: number, tx: number, ty: number) {
    const c = FLOOR[t] ?? FLOOR[T.GRASS];
    const X = tx * TILE;
    const Y = ty * TILE;
    const r = hash(tx, ty);
    g.fillStyle = r < 0.33 ? c[0] : r < 0.66 ? c[0] : c[0];
    g.fillRect(X, Y, TILE + 0.5, TILE + 0.5);
    switch (t) {
      case T.GRASS:
      case T.DIRT:
      case T.SAND:
      case T.GRAVEL: {
        const n = t === T.GRAVEL ? 9 : 6;
        for (let i = 0; i < n; i++) {
          const a = hash(tx, ty, i + 1);
          const b = hash(tx, ty, i + 50);
          g.fillStyle = hash(tx, ty, i + 99) < 0.5 ? c[1] : c[2];
          const s = t === T.GRAVEL ? 2 : 3 + hash(tx, ty, i + 7) * 4;
          g.fillRect(X + a * TILE, Y + b * TILE, s, t === T.GRASS ? s * 0.6 : s);
        }
        if (t === T.GRASS && r > 0.93) {
          g.fillStyle = hash(tx, ty, 5) > 0.5 ? '#8a8a3a' : '#7a5a8a';
          g.fillRect(X + hash(tx, ty, 3) * 26, Y + hash(tx, ty, 4) * 26, 3, 3);
        }
        break;
      }
      case T.ASPHALT:
        for (let i = 0; i < 5; i++) {
          g.fillStyle = i % 2 ? c[1] : c[2];
          g.fillRect(X + hash(tx, ty, i) * TILE, Y + hash(tx, ty, i + 9) * TILE, 2, 2);
        }
        if (r > 0.97) {
          g.strokeStyle = c[1];
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(X + 4, Y + 10);
          g.lineTo(X + 16, Y + 18);
          g.lineTo(X + 26, Y + 14);
          g.stroke();
        }
        break;
      case T.CONCRETE:
      case T.INDOOR:
        g.strokeStyle = c[1];
        g.lineWidth = 1;
        g.strokeRect(X + 0.5, Y + 0.5, TILE, TILE);
        if (r > 0.85) {
          g.fillStyle = c[2];
          g.fillRect(X + 6 + r * 10, Y + 8, 6, 4);
        }
        break;
      case T.TILEFLOOR:
        g.strokeStyle = c[1];
        g.lineWidth = 1;
        g.strokeRect(X + 0.5, Y + 0.5, TILE / 2, TILE / 2);
        g.strokeRect(X + TILE / 2 + 0.5, Y + TILE / 2 + 0.5, TILE / 2, TILE / 2);
        g.strokeRect(X + TILE / 2 + 0.5, Y + 0.5, TILE / 2, TILE / 2);
        g.strokeRect(X + 0.5, Y + TILE / 2 + 0.5, TILE / 2, TILE / 2);
        break;
      case T.WOOD:
      case T.DOCK: {
        g.strokeStyle = c[1];
        g.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const yy = Y + i * 8 + 0.5;
          g.beginPath();
          g.moveTo(X, yy);
          g.lineTo(X + TILE, yy);
          g.stroke();
          const off = ((hash(tx, ty, i) * TILE) | 0) + 0.5;
          g.beginPath();
          g.moveTo(X + off, yy);
          g.lineTo(X + off, yy + 8);
          g.stroke();
        }
        break;
      }
      case T.METALFLOOR:
        g.strokeStyle = c[2];
        g.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.moveTo(X + i * 8 + 2, Y + 4);
          g.lineTo(X + i * 8 + 6, Y + 8);
          g.moveTo(X + i * 8 + 2, Y + 20);
          g.lineTo(X + i * 8 + 6, Y + 24);
          g.stroke();
        }
        break;
      case T.CARPET:
        g.fillStyle = c[1];
        g.fillRect(X + 2, Y + 2, 4, 4);
        break;
      case T.WATER: {
        g.strokeStyle = c[2];
        g.lineWidth = 1.5;
        const o = hash(tx, ty) * 10;
        g.beginPath();
        g.moveTo(X + 3 + o, Y + 10);
        g.quadraticCurveTo(X + 8 + o, Y + 7, X + 13 + o, Y + 10);
        g.moveTo(X + 6, Y + 22 + o / 3);
        g.quadraticCurveTo(X + 11, Y + 19 + o / 3, X + 16, Y + 22 + o / 3);
        g.stroke();
        break;
      }
      case T.RAIL:
        for (let i = 0; i < 8; i++) {
          g.fillStyle = i % 2 ? c[1] : c[2];
          g.fillRect(X + hash(tx, ty, i) * TILE, Y + hash(tx, ty, i + 9) * TILE, 3, 3);
        }
        break;
    }
  }

  private drawSolid(g: CanvasRenderingContext2D, t: number, tx: number, ty: number) {
    const X = tx * TILE;
    const Y = ty * TILE;
    const m = this.map;
    if (isWallish(t)) {
      const [base, edge] = WALLC[t];
      g.fillStyle = base;
      g.fillRect(X, Y, TILE + 0.5, TILE + 0.5);
      if (t === T.BORDER) {
        // dichter Wald als Kartengrenze
        for (let i = 0; i < 3; i++) {
          g.fillStyle = i % 2 ? '#1a2814' : '#14200f';
          g.beginPath();
          g.arc(X + hash(tx, ty, i) * TILE, Y + hash(tx, ty, i + 4) * TILE, 10 + hash(tx, ty, i + 8) * 10, 0, Math.PI * 2);
          g.fill();
        }
        return;
      }
      // Kanten zu Böden hervorheben
      g.fillStyle = edge;
      const open = (dx: number, dy: number) => !isWallish(m.get(tx + dx, ty + dy)) && m.get(tx + dx, ty + dy) !== T.WINDOW;
      if (open(0, -1)) g.fillRect(X, Y, TILE, 3);
      if (open(0, 1)) g.fillRect(X, Y + TILE - 3, TILE, 3);
      if (open(-1, 0)) g.fillRect(X, Y, 3, TILE);
      if (open(1, 0)) g.fillRect(X + TILE - 3, Y, 3, TILE);
      if (t === T.DOOR_LOCKED) {
        g.fillStyle = '#8a6a40';
        g.fillRect(X + 4, Y + 4, TILE - 8, TILE - 8);
        g.fillStyle = '#d2ac4e';
        g.beginPath();
        g.arc(X + TILE / 2, Y + TILE / 2 - 2, 5, Math.PI, 0);
        g.fill();
        g.fillRect(X + TILE / 2 - 6, Y + TILE / 2 - 2, 12, 9);
      } else if (t === T.WALL) {
        g.strokeStyle = 'rgba(0,0,0,0.25)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(X, Y + TILE / 2);
        g.lineTo(X + TILE, Y + TILE / 2);
        g.stroke();
      }
      return;
    }
    switch (t) {
      case T.WINDOW: {
        const vert = isWallish(m.get(tx, ty - 1)) || m.get(tx, ty - 1) === T.WINDOW;
        g.fillStyle = '#2f3438';
        if (vert) g.fillRect(X + 10, Y, 12, TILE);
        else g.fillRect(X, Y + 10, TILE, 12);
        g.fillStyle = 'rgba(150,210,240,0.55)';
        if (vert) g.fillRect(X + 14, Y, 4, TILE);
        else g.fillRect(X, Y + 14, TILE, 4);
        break;
      }
      case T.FENCE: {
        const vert = m.get(tx, ty - 1) === T.FENCE || m.get(tx, ty + 1) === T.FENCE;
        g.strokeStyle = 'rgba(190,195,190,0.75)';
        g.lineWidth = 1;
        g.beginPath();
        if (vert) {
          for (let i = 0; i < 4; i++) {
            g.moveTo(X + 12, Y + i * 8);
            g.lineTo(X + 20, Y + i * 8 + 8);
            g.moveTo(X + 20, Y + i * 8);
            g.lineTo(X + 12, Y + i * 8 + 8);
          }
        } else {
          for (let i = 0; i < 4; i++) {
            g.moveTo(X + i * 8, Y + 12);
            g.lineTo(X + i * 8 + 8, Y + 20);
            g.moveTo(X + i * 8, Y + 20);
            g.lineTo(X + i * 8 + 8, Y + 12);
          }
        }
        g.stroke();
        g.fillStyle = '#9a9e98';
        g.fillRect(X + 13, Y + 13, 6, 6);
        break;
      }
      case T.TREE:
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.beginPath();
        g.ellipse(X + 20, Y + 22, 13, 9, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#4a3523';
        g.beginPath();
        g.arc(X + 16, Y + 16, 7, 0, Math.PI * 2);
        g.fill();
        break;
      case T.ROCK: {
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.beginPath();
        g.ellipse(X + 19, Y + 20, 15, 11, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#6b6a64';
        g.beginPath();
        g.moveTo(X + 3, Y + 18);
        g.lineTo(X + 9, Y + 4);
        g.lineTo(X + 24, Y + 3);
        g.lineTo(X + 30, Y + 16);
        g.lineTo(X + 22, Y + 29);
        g.lineTo(X + 8, Y + 28);
        g.closePath();
        g.fill();
        g.fillStyle = '#85847c';
        g.beginPath();
        g.moveTo(X + 9, Y + 6);
        g.lineTo(X + 23, Y + 5);
        g.lineTo(X + 18, Y + 14);
        g.closePath();
        g.fill();
        break;
      }
    }
  }

  /** Kleine Übersichtskarte (2 px pro Kachel) für Minimap und Kartenansicht. */
  overviewCanvas(): HTMLCanvasElement {
    if (this.overview) return this.overview;
    const m = this.map;
    const S = 3;
    const c = document.createElement('canvas');
    c.width = m.w * S;
    c.height = m.h * S;
    const g = c.getContext('2d')!;
    const col = (t: number): string => {
      if (t === T.WATER) return '#24486a';
      if (t === T.BORDER) return '#0c140a';
      if (isWallish(t)) return '#15181b';
      if (t === T.WINDOW) return '#3a6a80';
      if (t === T.TREE) return '#1e3418';
      if (t === T.BUSH) return '#2e4a26';
      if (t === T.LOW) return '#5a4a36';
      if (t === T.FENCE) return '#8a8e8a';
      if (t === T.ROCK) return '#555';
      const f = FLOOR[t];
      return f ? f[0] : '#3b5131';
    };
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        g.fillStyle = col(m.get(x, y));
        g.fillRect(x * S, y * S, S, S);
      }
    this.overview = c;
    return c;
  }
}

function propBounds(p: Prop) {
  if (p.type === 'tree' || p.type === 'bush') {
    const r = p.w * 1.4;
    return { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r };
  }
  if (p.type === 'lane') return { x0: p.x, y0: p.y - 4, x1: p.x + Math.max(p.w, 4), y1: p.y + Math.max(p.h, 4) };
  if (p.type === 'rails') return { x0: p.x, y0: p.y - 24, x1: p.x + p.w, y1: p.y + 24 };
  if (p.type === 'rails_v') return { x0: p.x - 24, y0: p.y, x1: p.x + 24, y1: p.y + p.h };
  return { x0: p.x - 8, y0: p.y - 8, x1: p.x + p.w + 8, y1: p.y + p.h + 8 };
}

/** Zeichnet eine statische Requisite (in Weltkoordinaten). */
export function drawProp(g: CanvasRenderingContext2D, p: Prop) {
  const { x, y, w, h } = p;
  const v = p.v ?? 0;
  switch (p.type) {
    case 'lane': {
      g.strokeStyle = 'rgba(220,210,150,0.55)';
      g.lineWidth = 2;
      g.setLineDash([18, 16]);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + w, y + h);
      g.stroke();
      g.setLineDash([]);
      break;
    }
    case 'rails':
    case 'rails_v': {
      const horiz = p.type === 'rails';
      const len = horiz ? w : h;
      g.fillStyle = '#4a3a2a';
      for (let i = 0; i < len; i += 14) {
        if (horiz) g.fillRect(x + i, y - 16, 6, 32);
        else g.fillRect(x - 16, y + i, 32, 6);
      }
      g.fillStyle = '#8a8a8a';
      if (horiz) {
        g.fillRect(x, y - 11, w, 3);
        g.fillRect(x, y + 8, w, 3);
      } else {
        g.fillRect(x - 11, y, 3, h);
        g.fillRect(x + 8, y, 3, h);
      }
      break;
    }
    case 'rug':
      g.fillStyle = p.color ?? '#4a3030';
      g.globalAlpha = 0.85;
      g.fillRect(x, y, w, h);
      g.globalAlpha = 1;
      g.strokeStyle = 'rgba(220,200,150,0.35)';
      g.lineWidth = 2;
      g.strokeRect(x + 4, y + 4, w - 8, h - 8);
      break;
    case 'helipad':
      g.fillStyle = 'rgba(30,30,30,0.6)';
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, w * 0.75, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#d8d0a0';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, w * 0.68, 0, Math.PI * 2);
      g.stroke();
      g.font = `bold ${w * 0.7}px sans-serif`;
      g.fillStyle = '#d8d0a0';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('H', x + w / 2, y + h / 2 + 2);
      break;
    case 'manhole':
      g.fillStyle = '#2a2a2a';
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, 13, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#555';
      g.lineWidth = 2;
      g.stroke();
      g.beginPath();
      g.moveTo(x + w / 2 - 8, y + h / 2);
      g.lineTo(x + w / 2 + 8, y + h / 2);
      g.moveTo(x + w / 2, y + h / 2 - 8);
      g.lineTo(x + w / 2, y + h / 2 + 8);
      g.stroke();
      break;
    case 'car':
    case 'wreck':
    case 'truck':
      drawVehicle(g, p);
      break;
    case 'wagon':
    case 'wagon_v': {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + 5, y + 6, w, h);
      g.fillStyle = p.color ?? '#5d3b2a';
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 2;
      const horiz = w > h;
      for (let i = 1; i < 6; i++) {
        g.beginPath();
        if (horiz) (g.moveTo(x + (w / 6) * i, y + 3), g.lineTo(x + (w / 6) * i, y + h - 3));
        else (g.moveTo(x + 3, y + (h / 6) * i), g.lineTo(x + w - 3, y + (h / 6) * i));
        g.stroke();
      }
      g.strokeStyle = 'rgba(255,255,255,0.15)';
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
      break;
    }
    case 'shipcont': {
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(x + 6, y + 7, w, h);
      g.fillStyle = p.color ?? '#8a3b2b';
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.lineWidth = 2;
      const horiz = w >= h;
      const n = Math.floor((horiz ? w : h) / 8);
      for (let i = 1; i < n; i++) {
        g.beginPath();
        if (horiz) (g.moveTo(x + i * 8, y + 2), g.lineTo(x + i * 8, y + h - 2));
        else (g.moveTo(x + 2, y + i * 8), g.lineTo(x + w - 2, y + i * 8));
        g.stroke();
      }
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(x, y, w, 3);
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
      break;
    }
    case 'crate':
    case 'milcrate':
    case 'hay': {
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x + 4, y + 5, w - 2, h - 2);
      g.fillStyle = p.type === 'milcrate' ? '#4a5536' : p.type === 'hay' ? '#b09a50' : ['#7a5a35', '#6e5030', '#856238', '#73552f'][v % 4];
      g.fillRect(x + 1, y + 1, w - 3, h - 3);
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1.5;
      g.strokeRect(x + 2.5, y + 2.5, w - 6, h - 6);
      if (p.type !== 'hay') {
        g.beginPath();
        g.moveTo(x + 3, y + 3);
        g.lineTo(x + w - 4, y + h - 4);
        g.stroke();
      }
      break;
    }
    case 'barrel':
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.arc(x + 19, y + 19, 12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = ['#3a5a7a', '#7a3a2a', '#4a6a3a', '#7a6a2a'][v % 4];
      g.beginPath();
      g.arc(x + 16, y + 16, 12, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x + 16, y + 16, 8, 0, Math.PI * 2);
      g.stroke();
      break;
    case 'sandbag':
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x + 3, y + 5, w, h - 6);
      g.fillStyle = '#8a7a5a';
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          g.beginPath();
          g.ellipse(x + 8 + i * 16, y + 9 + j * 13, 8, 6, 0, 0, Math.PI * 2);
          g.fill();
        }
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.stroke();
      break;
    case 'bench':
      g.fillStyle = '#5a4128';
      g.fillRect(x + 2, y + 9, w - 4, 14);
      g.fillStyle = '#2a2a2a';
      g.fillRect(x + 4, y + 7, 3, 18);
      g.fillRect(x + w - 7, y + 7, 3, 18);
      break;
    case 'fountain':
      g.fillStyle = '#5a5e60';
      g.beginPath();
      g.arc(x, y, w * 0.55, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2e5878';
      g.beginPath();
      g.arc(x, y, w * 0.45, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#6a6e70';
      g.beginPath();
      g.arc(x, y, 10, 0, Math.PI * 2);
      g.fill();
      break;
    case 'pump':
      g.fillStyle = '#b03a2a';
      g.fillRect(x + 6, y + 4, 20, 24);
      g.fillStyle = '#ddd';
      g.fillRect(x + 9, y + 7, 14, 7);
      break;
    case 'crane_leg':
      g.fillStyle = '#c89a2a';
      g.fillRect(x + 4, y + 4, 24, 24);
      g.strokeStyle = '#6a5014';
      g.lineWidth = 2;
      g.strokeRect(x + 6, y + 6, 20, 20);
      break;
    default:
      drawFurniture(g, p);
  }
}

function drawVehicle(g: CanvasRenderingContext2D, p: Prop) {
  const { x, y, w, h } = p;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const horiz = w > h;
  const L = horiz ? w : h;
  const W = horiz ? h : w;
  g.save();
  g.translate(cx, cy);
  g.rotate(p.rot ?? (horiz ? 0 : Math.PI / 2));
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fillRect(-L / 2 + 5, -W / 2 + 6, L - 2, W - 2);
  const wreck = p.type === 'wreck';
  const truck = p.type === 'truck';
  const body = p.color ?? '#555';
  // Räder
  g.fillStyle = '#151515';
  for (const sx of [-L * 0.32, L * 0.3]) for (const sy of [-W / 2 + 1, W / 2 - 6]) g.fillRect(sx - 6, sy, 12, 5);
  g.fillStyle = body;
  roundRect(g, -L / 2 + 2, -W / 2 + 3, L - 4, W - 6, 7);
  g.fill();
  if (truck) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(-L / 2 + 4, -W / 2 + 5, L * 0.62, W - 10);
    g.fillStyle = 'rgba(160,200,220,0.5)';
    g.fillRect(L / 2 - 16, -W / 2 + 6, 6, W - 12);
  } else {
    // Dach & Scheiben
    g.fillStyle = wreck ? '#3a2e26' : 'rgba(0,0,0,0.22)';
    roundRect(g, -L * 0.22, -W / 2 + 6, L * 0.48, W - 12, 5);
    g.fill();
    if (!wreck) {
      g.fillStyle = 'rgba(150,200,225,0.55)';
      g.fillRect(L * 0.2, -W / 2 + 7, 6, W - 14);
      g.fillRect(-L * 0.26, -W / 2 + 7, 5, W - 14);
    } else {
      g.fillStyle = 'rgba(20,15,10,0.6)';
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.arc(-L * 0.3 + i * L * 0.18, (i % 2 ? -1 : 1) * W * 0.15, 5 + i, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = 'rgba(255,240,180,0.7)';
    g.fillRect(L / 2 - 5, -W / 2 + 5, 3, 5);
    g.fillRect(L / 2 - 5, W / 2 - 10, 3, 5);
  }
  g.restore();
}

function drawFurniture(g: CanvasRenderingContext2D, p: Prop) {
  const { x, y, w, h } = p;
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.rotate(p.rot ?? 0);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-w / 2 + 4, -h / 2 + 5, w - 4, h - 4);
  const box = (c: string, ww = w - 4, hh = h - 4) => {
    g.fillStyle = c;
    g.fillRect(-ww / 2, -hh / 2, ww, hh);
  };
  switch (p.type) {
    case 'sofa':
      box('#5a3a3a');
      g.fillStyle = '#6e4848';
      g.fillRect(-w / 2 + 2, -h / 2 + 2, 7, h - 4);
      break;
    case 'table':
      box('#7a5a3a', w - 6, h - 6);
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.strokeRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
      break;
    case 'tv':
      box('#222', 10, h - 6);
      g.fillStyle = '#3a4a5a';
      g.fillRect(-3, -h / 2 + 5, 4, h - 10);
      break;
    case 'counter':
    case 'workbench':
      box(p.type === 'workbench' ? '#6a5a40' : '#8a8a84');
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, 4);
      break;
    case 'stove':
      box('#bbb');
      g.fillStyle = '#333';
      for (const [a, b] of [
        [-6, -6],
        [6, -6],
        [-6, 6],
        [6, 6],
      ]) {
        g.beginPath();
        g.arc(a, b, 4, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'bed':
    case 'bunk':
      box(p.type === 'bunk' ? '#4a5a3a' : '#8a8aa0');
      g.fillStyle = '#ddd';
      g.fillRect(-w / 2 + 3, -h / 2 + 4, 9, h - 8);
      break;
    case 'wardrobe':
    case 'locker':
      box(p.type === 'locker' ? '#5a6a5a' : '#5a4028');
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.beginPath();
      g.moveTo(0, -h / 2 + 2);
      g.lineTo(0, h / 2 - 2);
      g.stroke();
      break;
    case 'sink':
      box('#c8c8c8', w - 10, h - 10);
      g.fillStyle = '#8a9aa8';
      g.beginPath();
      g.arc(0, 0, 6, 0, Math.PI * 2);
      g.fill();
      break;
    case 'plant':
      g.fillStyle = '#6a4a2a';
      g.beginPath();
      g.arc(0, 0, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3a6a2a';
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.arc(Math.cos(i * 1.3) * 6, Math.sin(i * 1.3) * 6, 6, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'printer':
    case 'serverrack':
      box(p.type === 'serverrack' ? '#1e2328' : '#ccc');
      if (p.type === 'serverrack') {
        g.fillStyle = '#4aff8a';
        for (let i = 0; i < 4; i++) g.fillRect(-8, -10 + i * 6, 2, 2);
      }
      break;
    case 'rack':
      box('#3a3f3a');
      g.fillStyle = '#1a1a1a';
      for (let i = 0; i < 3; i++) g.fillRect(-10 + i * 8, -h / 2 + 4, 3, h - 8);
      break;
    case 'machine':
      box('#5a6066');
      g.fillStyle = '#c89a2a';
      g.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, 3);
      g.fillStyle = '#333';
      g.beginPath();
      g.arc(0, 2, 6, 0, Math.PI * 2);
      g.fill();
      break;
    case 'shelfrow':
      box('#7a7a70', w - 2, h - 10);
      g.fillStyle = ['#a04040', '#4080a0', '#a0a040', '#60a060'][(p.v ?? 0) % 4];
      g.fillRect(-w / 2 + 3, -4, w - 6, 3);
      g.fillStyle = ['#d0a040', '#a060a0', '#40a0a0', '#c07040'][(p.v ?? 0) % 4];
      g.fillRect(-w / 2 + 3, 1, w - 6, 3);
      break;
    default:
      box('#666');
  }
  g.restore();
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** Baumkronen, Büsche, Kräne – über Akteuren. */
export function drawOverProp(g: CanvasRenderingContext2D, p: Prop, nearPlayer: boolean) {
  switch (p.type) {
    case 'tree': {
      const r = p.w * 0.95;
      g.globalAlpha = nearPlayer ? 0.45 : 0.92;
      const shades = ['#2a4a22', '#2f5326', '#26421f', '#345a2a', '#2c4b24', '#3a5e2c'];
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.arc(p.x + 8, p.y + 10, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = shades[(p.v ?? 0) % shades.length];
      g.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + (p.rot ?? 0);
        g.moveTo(p.x + Math.cos(a) * r * 0.5 + r * 0.55, p.y + Math.sin(a) * r * 0.5);
        g.arc(p.x + Math.cos(a) * r * 0.5, p.y + Math.sin(a) * r * 0.5, r * 0.55, 0, Math.PI * 2);
      }
      g.fill();
      g.fillStyle = 'rgba(255,255,200,0.07)';
      g.beginPath();
      g.arc(p.x - r * 0.25, p.y - r * 0.25, r * 0.5, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      break;
    }
    case 'bush': {
      const r = p.w * 0.55;
      g.globalAlpha = nearPlayer ? 0.55 : 0.9;
      g.fillStyle = ['#3a5e2a', '#41662e', '#365628'][(p.v ?? 0) % 3];
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + (p.rot ?? 0);
        g.moveTo(p.x + Math.cos(a) * r * 0.45 + r * 0.6, p.y + Math.sin(a) * r * 0.45);
        g.arc(p.x + Math.cos(a) * r * 0.45, p.y + Math.sin(a) * r * 0.45, r * 0.6, 0, Math.PI * 2);
      }
      g.fill();
      g.globalAlpha = 1;
      break;
    }
    case 'crane':
      g.globalAlpha = nearPlayer ? 0.35 : 0.8;
      g.fillStyle = '#c89a2a';
      g.fillRect(p.x, p.y + 2 * TILE + 8, p.w, 14);
      g.fillRect(p.x + p.w / 2 - 8, p.y - p.h * 0.3, 16, p.h);
      g.strokeStyle = '#6a5014';
      g.lineWidth = 2;
      g.strokeRect(p.x + p.w / 2 - 8, p.y - p.h * 0.3, 16, p.h);
      g.globalAlpha = 1;
      break;
    case 'canopy':
      g.globalAlpha = nearPlayer ? 0.2 : 0.75;
      g.fillStyle = '#c8c4b8';
      g.fillRect(p.x, p.y, p.w, p.h);
      g.fillStyle = '#b03a2a';
      g.fillRect(p.x, p.y, p.w, 6);
      g.globalAlpha = 1;
      break;
    case 'tower':
      g.globalAlpha = nearPlayer ? 0.4 : 0.85;
      g.strokeStyle = '#9aa0a4';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(p.x - p.w / 2, p.y - p.h / 2);
      g.lineTo(p.x + p.w / 2, p.y + p.h / 2);
      g.moveTo(p.x + p.w / 2, p.y - p.h / 2);
      g.lineTo(p.x - p.w / 2, p.y + p.h / 2);
      g.stroke();
      g.strokeRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
      g.fillStyle = '#e04040';
      g.beginPath();
      g.arc(p.x, p.y, 5, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      break;
  }
}
