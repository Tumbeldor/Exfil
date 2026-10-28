import { TILE } from '../constants';
import type { GameMap } from './GameMap';
import { F_MOVE, F_SLOW, TILE_FLAGS } from './tiles';

/** Binärer Min-Heap über Knotenindizes. */
class Heap {
  private items: number[] = [];
  constructor(private score: Float32Array) {}
  get size() {
    return this.items.length;
  }
  clear() {
    this.items.length = 0;
  }
  push(n: number) {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    const s = this.score;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (s[a[p]] <= s[a[i]]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      const s = this.score;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && s[a[l]] < s[a[m]]) m = l;
        if (r < a.length && s[a[r]] < s[a[m]]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

export class Navigator {
  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private cur = 1;
  private heap: Heap;

  constructor(private map: GameMap) {
    const n = map.w * map.h;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Heap(this.f);
  }

  private passable(tx: number, ty: number) {
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return false;
    return (TILE_FLAGS[this.map.tiles[ty * this.map.w + tx]] & F_MOVE) === 0;
  }

  /**
   * A*-Suche zwischen Weltkoordinaten. Gibt Wegpunkte (Weltkoordinaten, Kachelmitten) zurück,
   * bereits geglättet. Bei Überschreitung des Budgets wird der Weg zum besten Zwischenknoten geliefert.
   */
  findPath(sx: number, sy: number, ex: number, ey: number, budget = 7000, radius = 11): { x: number; y: number }[] | null {
    const m = this.map;
    let stx = Math.floor(sx / TILE);
    let sty = Math.floor(sy / TILE);
    let etx = Math.floor(ex / TILE);
    let ety = Math.floor(ey / TILE);
    if (!this.passable(stx, sty)) {
      const n = m.nearestWalkable(stx, sty, 3);
      if (!n) return null;
      [stx, sty] = n;
    }
    if (!this.passable(etx, ety)) {
      const n = m.nearestWalkable(etx, ety, 4);
      if (!n) return null;
      [etx, ety] = n;
    }
    const W = m.w;
    const start = sty * W + stx;
    const goal = ety * W + etx;
    if (start === goal) return [{ x: ex, y: ey }];
    this.cur++;
    if (this.cur > 0xfffffff0) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.cur = 1;
    }
    const cur = this.cur;
    const g = this.g;
    const f = this.f;
    const heap = this.heap;
    heap.clear();
    const h = (n: number) => {
      const x = n % W;
      const y = (n - x) / W;
      const dx = Math.abs(x - etx);
      const dy = Math.abs(y - ety);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    g[start] = 0;
    f[start] = h(start);
    this.stamp[start] = cur;
    this.parent[start] = -1;
    heap.push(start);
    let best = start;
    let bestH = f[start];
    let expanded = 0;
    let found = false;
    while (heap.size) {
      const n = heap.pop();
      if (this.closed[n] === cur) continue;
      this.closed[n] = cur;
      if (n === goal) {
        found = true;
        break;
      }
      if (++expanded > budget) break;
      const x = n % W;
      const y = (n - x) / W;
      const hn = f[n] - g[n];
      if (hn < bestH) {
        bestH = hn;
        best = n;
      }
      for (const [dx, dy, cost] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.passable(nx, ny)) continue;
        if (dx && dy && (!this.passable(x + dx, y) || !this.passable(x, y + dy))) continue;
        const nn = ny * W + nx;
        if (this.closed[nn] === cur) continue;
        const slow = TILE_FLAGS[m.tiles[nn]] & F_SLOW ? 1.6 : 1;
        const ng = g[n] + cost * slow;
        if (this.stamp[nn] !== cur || ng < g[nn]) {
          this.stamp[nn] = cur;
          g[nn] = ng;
          f[nn] = ng + h(nn);
          this.parent[nn] = n;
          heap.push(nn);
        }
      }
    }
    const end = found ? goal : best;
    if (end === start) return null;
    const tiles: number[] = [];
    for (let n = end; n !== -1; n = this.parent[n]) tiles.push(n);
    tiles.reverse();
    const pts = tiles.map((n) => ({ x: ((n % W) + 0.5) * TILE, y: (Math.floor(n / W) + 0.5) * TILE }));
    if (found) pts[pts.length - 1] = { x: ex, y: ey };
    return this.smooth({ x: sx, y: sy }, pts, radius);
  }

  /** Prüft, ob ein Kreis mit Radius r geradlinig von a nach b kann. */
  clearPath(ax: number, ay: number, bx: number, by: number, r: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.hypot(dx, dy);
    if (d < 1) return true;
    const nx = -dy / d;
    const ny = dx / d;
    const m = this.map;
    for (const o of [0, r, -r]) {
      if (!m.clearLine(ax + nx * o, ay + ny * o, bx + nx * o, by + ny * o, F_MOVE)) return false;
    }
    return true;
  }

  private smooth(start: { x: number; y: number }, pts: { x: number; y: number }[], r: number) {
    const out: { x: number; y: number }[] = [];
    let from = start;
    let i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + 14);
      while (j > i && !this.clearPath(from.x, from.y, pts[j].x, pts[j].y, r + 1)) j--;
      out.push(pts[j]);
      from = pts[j];
      i = j + 1;
    }
    return out;
  }
}
