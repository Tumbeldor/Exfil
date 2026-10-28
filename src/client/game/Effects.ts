import type { GameMap } from '../../shared/map/GameMap';
import { F_BULLET } from '../../shared/map/tiles';

interface Tracer {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  max: number;
  traveled: number;
  color: string;
  own: boolean;
  dead: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
  kind: 'dot' | 'spark' | 'smoke' | 'shell';
  rot?: number;
}

interface Decal {
  x: number;
  y: number;
  r: number;
  color: string;
  kind: 'blood' | 'scorch' | 'hole';
  rot: number;
}

interface Flash {
  x: number;
  y: number;
  a: number;
  t: number;
  big: boolean;
}

interface Nade {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ft: number;
  t: number;
  fuse: number;
}

export interface Ping {
  x: number;
  y: number;
  t: number;
  name: string;
  color: string;
}

export class Effects {
  tracers: Tracer[] = [];
  particles: Particle[] = [];
  decals: Decal[] = [];
  flashes: Flash[] = [];
  nades: Nade[] = [];
  pings: Ping[] = [];
  explosions: { x: number; y: number; r: number; t: number }[] = [];
  private localId = -1;
  quality: 'low' | 'high' = 'high';

  constructor(private map: GameMap) {}

  tracer(id: number | null, x: number, y: number, a: number, speed: number, range: number, color: string, own: boolean) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const max = this.map.raycast(x, y, dx, dy, range, F_BULLET, 46);
    this.tracers.push({ id: id ?? this.localId--, x, y, dx, dy, speed, max, traveled: 0, color, own, dead: false });
    if (this.tracers.length > 220) this.tracers.splice(0, this.tracers.length - 220);
  }

  killTracer(id: number) {
    for (const t of this.tracers) if (t.id === id) t.dead = true;
  }

  /** Kürzt die eigene vorhergesagte Leuchtspur, die einem Trefferpunkt am nächsten liegt. */
  killNearestOwn(x: number, y: number) {
    let best: Tracer | null = null;
    let bestAlong = 0;
    let bd = 40 * 40;
    for (const t of this.tracers) {
      if (!t.own || t.dead) continue;
      const along = (x - t.x) * t.dx + (y - t.y) * t.dy;
      if (along < 0 || along > t.traveled + 200) continue;
      const cx = t.x + t.dx * along;
      const cy = t.y + t.dy * along;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) {
        bd = d;
        best = t;
        bestAlong = along;
      }
    }
    if (best) best.max = Math.min(best.max, bestAlong);
  }

  muzzle(x: number, y: number, a: number, big: boolean) {
    this.flashes.push({ x, y, a, t: 0, big });
    // Hülse
    if (this.quality === 'high') {
      const side = a + Math.PI / 2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(side) * 90 + (Math.random() - 0.5) * 40,
        vy: Math.sin(side) * 90 + (Math.random() - 0.5) * 40,
        life: 0,
        max: 1.4,
        size: 3,
        color: '#c8a050',
        drag: 5,
        kind: 'shell',
        rot: Math.random() * 6,
      });
    }
  }

  blood(x: number, y: number, a: number, n = 8) {
    const count = this.quality === 'high' ? n : Math.ceil(n / 2);
    for (let i = 0; i < count; i++) {
      const s = 60 + Math.random() * 160;
      const aa = a + (Math.random() - 0.5) * 1.2;
      this.particles.push({ x, y, vx: Math.cos(aa) * s, vy: Math.sin(aa) * s, life: 0, max: 0.35 + Math.random() * 0.3, size: 2 + Math.random() * 2.5, color: '#8a1010', drag: 6, kind: 'dot' });
    }
    if (Math.random() < 0.6) this.decal(x + Math.cos(a) * 14, y + Math.sin(a) * 14, 4 + Math.random() * 6, 'blood');
  }

  sparks(x: number, y: number, n = 6, color = '#ffd27a') {
    const count = this.quality === 'high' ? n : Math.ceil(n / 2);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 220;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.15 + Math.random() * 0.2, size: 1.6, color, drag: 4, kind: 'spark' });
    }
  }

  dust(x: number, y: number) {
    const n = this.quality === 'high' ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ x, y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, life: 0, max: 0.5 + Math.random() * 0.4, size: 4 + Math.random() * 4, color: 'rgba(160,150,130,0.5)', drag: 3, kind: 'smoke' });
    }
  }

  decal(x: number, y: number, r: number, kind: Decal['kind']) {
    this.decals.push({ x, y, r, kind, rot: Math.random() * Math.PI * 2, color: kind === 'blood' ? 'rgba(90,8,8,0.7)' : kind === 'scorch' ? 'rgba(10,10,10,0.6)' : 'rgba(20,20,20,0.8)' });
    if (this.decals.length > 400) this.decals.splice(0, this.decals.length - 400);
  }

  explosion(x: number, y: number, r: number) {
    this.explosions.push({ x, y, r, t: 0 });
    this.decal(x, y, r * 0.35, 'scorch');
    const n = this.quality === 'high' ? 26 : 12;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 260;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.6 + Math.random() * 0.8, size: 8 + Math.random() * 14, color: 'rgba(70,65,60,0.55)', drag: 2.5, kind: 'smoke' });
    }
    this.sparks(x, y, 18, '#ffb050');
  }

  nade(id: number, x: number, y: number, vx: number, vy: number, ft: number, fuse: number) {
    this.nades.push({ id, x, y, vx, vy, ft, t: 0, fuse });
  }

  removeNade(id: number) {
    this.nades = this.nades.filter((n) => n.id !== id);
  }

  update(dt: number) {
    for (const t of this.tracers) {
      t.traveled += t.speed * dt;
      if (t.traveled - 60 > t.max) t.dead = true;
    }
    this.tracers = this.tracers.filter((t) => !t.dead);
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter((f) => f.t < 0.06);
    for (const n of this.nades) {
      n.t += dt;
      if (n.t < n.ft) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
      }
    }
    this.nades = this.nades.filter((n) => n.t < n.fuse + 0.2);
    for (const e of this.explosions) e.t += dt;
    this.explosions = this.explosions.filter((e) => e.t < 0.5);
    const now = performance.now() / 1000;
    this.pings = this.pings.filter((p) => now - p.t < 8);
  }

  drawDecals(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    for (const d of this.decals) {
      if (d.x < x0 - 40 || d.x > x1 + 40 || d.y < y0 - 40 || d.y > y1 + 40) continue;
      g.fillStyle = d.color;
      g.beginPath();
      if (d.kind === 'blood') {
        g.ellipse(d.x, d.y, d.r, d.r * 0.7, d.rot, 0, Math.PI * 2);
        g.ellipse(d.x + Math.cos(d.rot) * d.r, d.y + Math.sin(d.rot) * d.r, d.r * 0.4, d.r * 0.3, d.rot, 0, Math.PI * 2);
      } else g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      g.fill();
    }
  }

  drawWorld(g: CanvasRenderingContext2D) {
    // Leuchtspuren
    g.lineCap = 'round';
    for (const t of this.tracers) {
      const head = Math.min(t.traveled, t.max);
      const tail = Math.max(0, t.traveled - 70);
      if (head <= tail) continue;
      const hx = t.x + t.dx * head;
      const hy = t.y + t.dy * head;
      const tx = t.x + t.dx * tail;
      const ty = t.y + t.dy * tail;
      const grad = g.createLinearGradient(tx, ty, hx, hy);
      grad.addColorStop(0, 'rgba(255,220,150,0)');
      grad.addColorStop(1, t.color);
      g.strokeStyle = grad;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(hx, hy);
      g.stroke();
    }
    // Granaten
    for (const n of this.nades) {
      g.fillStyle = '#3a4a2a';
      g.beginPath();
      g.arc(n.x, n.y, 4.5, 0, Math.PI * 2);
      g.fill();
      const blink = Math.floor(n.t * (n.fuse - n.t < 1 ? 10 : 4)) % 2 === 0;
      if (blink) {
        g.fillStyle = '#ff4030';
        g.beginPath();
        g.arc(n.x, n.y, 2, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = 'rgba(255,80,60,0.35)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(n.x, n.y, 175, 0, Math.PI * 2);
      g.stroke();
    }
    // Partikel
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      if (p.kind === 'smoke') {
        g.globalAlpha = a * 0.8;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1.5 - a * 0.5), 0, Math.PI * 2);
        g.fill();
      } else if (p.kind === 'shell') {
        g.globalAlpha = Math.min(1, a * 2);
        g.fillStyle = p.color;
        g.save();
        g.translate(p.x, p.y);
        g.rotate((p.rot ?? 0) + p.life * 12 * a);
        g.fillRect(-2, -1, 4, 2);
        g.restore();
      } else {
        g.globalAlpha = a;
        g.fillStyle = p.color;
        g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    g.globalAlpha = 1;
    // Mündungsfeuer & Explosionen (additiv)
    g.globalCompositeOperation = 'lighter';
    for (const f of this.flashes) {
      const s = f.big ? 1.4 : 1;
      const grd = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, 46 * s);
      grd.addColorStop(0, 'rgba(255,220,140,0.55)');
      grd.addColorStop(1, 'rgba(255,160,60,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(f.x, f.y, 46 * s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,240,180,0.95)';
      g.save();
      g.translate(f.x, f.y);
      g.rotate(f.a);
      g.beginPath();
      g.moveTo(0, -4 * s);
      g.lineTo(16 * s, 0);
      g.lineTo(0, 4 * s);
      g.closePath();
      g.fill();
      g.restore();
    }
    for (const e of this.explosions) {
      const k = e.t / 0.5;
      const grd = g.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * (0.5 + k));
      grd.addColorStop(0, `rgba(255,220,150,${0.9 * (1 - k)})`);
      grd.addColorStop(0.4, `rgba(255,120,40,${0.6 * (1 - k)})`);
      grd.addColorStop(1, 'rgba(120,40,10,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(e.x, e.y, e.r * (0.5 + k), 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
}
