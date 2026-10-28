import type { GameMap } from '../../shared/map/GameMap';
import { F_SIGHT } from '../../shared/map/tiles';

export interface VisPoly {
  x: number;
  y: number;
  /** Sichtkegel: Punkte [x0,y0,x1,y1,...] (ohne Zentrum) */
  cone: Float32Array;
  coneN: number;
  /** Nahbereich rundum */
  near: Float32Array;
  nearN: number;
  range: number;
  nearR: number;
  facing: number;
  fov: number;
}

/** Berechnet das Sichtfeld per Strahlverfolgung durch das Kachelraster. */
export class Visibility {
  private cone = new Float32Array(2048);
  private near = new Float32Array(512);

  compute(map: GameMap, x: number, y: number, facing: number, fov: number, range: number, nearR: number, rays = 320): VisPoly {
    const n = Math.min(1000, Math.max(60, rays));
    const a0 = facing - fov / 2;
    const step = fov / (n - 1);
    for (let i = 0; i < n; i++) {
      const a = a0 + step * i;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const d = map.raycast(x, y, dx, dy, range, F_SIGHT);
      this.cone[i * 2] = x + dx * d;
      this.cone[i * 2 + 1] = y + dy * d;
    }
    const m = 96;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const d = map.raycast(x, y, dx, dy, nearR, F_SIGHT);
      this.near[i * 2] = x + dx * d;
      this.near[i * 2 + 1] = y + dy * d;
    }
    return { x, y, cone: this.cone, coneN: n, near: this.near, nearN: m, range, nearR, facing, fov };
  }
}

/** Liegt ein Punkt im Sichtbereich (Kegel oder Nahbereich) und ist frei sichtbar? */
export function pointVisible(map: GameMap, v: VisPoly, px: number, py: number, pad = 0): boolean {
  const dx = px - v.x;
  const dy = py - v.y;
  const d = Math.hypot(dx, dy);
  if (d <= v.nearR + pad) return map.canSee(v.x, v.y, px, py) || d < 20;
  if (d > v.range + pad) return false;
  const ang = Math.atan2(dy, dx);
  let diff = ang - v.facing;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) > v.fov / 2 + Math.atan2(pad, Math.max(1, d))) return false;
  // Sichtprüfung auf Mittelpunkt und Ränder
  if (map.canSee(v.x, v.y, px, py)) return true;
  if (pad > 0) {
    const nx = (-dy / d) * pad;
    const ny = (dx / d) * pad;
    return map.canSee(v.x, v.y, px + nx, py + ny) || map.canSee(v.x, v.y, px - nx, py - ny);
  }
  return false;
}
