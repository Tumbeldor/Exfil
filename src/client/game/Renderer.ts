import { NEAR_SENSE } from '../../shared/constants';
import { type WeaponClass, hasItemDef, itemDef, weaponDef } from '../../shared/items';
import type { BotType } from '../../shared/loot';
import { clamp } from '../../shared/math';
import type { ContainerKind, GameMap } from '../../shared/map/GameMap';
import type { Settings } from '../settings';
import { Effects } from './Effects';
import { MapPainter, drawOverProp, roundRect } from './MapPainter';
import type { ClientContainer, RenderActor, ViewState } from './ViewState';
import { type VisPoly, Visibility, pointVisible } from './Visibility';

export interface LocalView {
  id: number;
  x: number;
  y: number;
  aim: number;
  alive: boolean;
  downed: boolean;
  color: string;
  name: string;
  weapon: string;
  helmet: string;
  armor: boolean;
  backpack: boolean;
  ads: boolean;
  sprint: boolean;
  reloading: boolean;
  acting: boolean;
  fov: number;
  range: number;
}

export interface FrameData {
  view: ViewState;
  me: LocalView;
  interact: { x: number; y: number; r: number } | null;
  spreadDeg: number;
  aimDist: number;
  throwPreview: boolean;
  hitmarker: { t: number; head: boolean; kill: boolean } | null;
  touch: boolean;
  mouse: { x: number; y: number } | null;
  camOffset: { x: number; y: number };
  zoomMul: number;
  shake: number;
  dt: number;
  aimAssistTarget: number | null;
}

const BODY: Record<BotType, string> = { scav: '#6b5d44', pmc: '#2e3a44', guard: '#3b4a30', boss: '#5e2424' };
const HEAD: Record<BotType, string> = { scav: '#4e4a42', pmc: '#1f262c', guard: '#2a3322', boss: '#8a2a2a' };

const GUN_LEN: Record<WeaponClass, number> = { pistol: 10, smg: 16, ar: 22, shotgun: 21, dmr: 26, sniper: 30, lmg: 25 };

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly painter: MapPainter;
  readonly effects: Effects;
  private visCalc = new Visibility();
  private fog: HTMLCanvasElement;
  private fctx: CanvasRenderingContext2D;
  vis: VisPoly | null = null;
  cam = { x: 0, y: 0, zoom: 1 };
  private W = 0;
  private H = 0;
  dpr = 1;
  private baseZoom = 1;
  private smoothCam: { x: number; y: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private map: GameMap,
    private settings: Settings,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.painter = new MapPainter(map);
    this.effects = new Effects(map);
    this.effects.quality = settings.quality;
    this.fog = document.createElement('canvas');
    this.fctx = this.fog.getContext('2d')!;
    this.resize();
  }

  resize() {
    const maxDpr = this.settings.quality === 'high' ? 2 : 1.25;
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    const fs = this.settings.quality === 'high' ? 0.5 : 0.33;
    this.fog.width = Math.max(1, Math.round(this.W * fs));
    this.fog.height = Math.max(1, Math.round(this.H * fs));
    this.baseZoom = clamp(Math.sqrt(this.W * this.H) / 800, 0.55, 3) * this.settings.zoom;
  }

  worldToScreen(x: number, y: number) {
    return { x: (x - this.cam.x) * this.cam.zoom + this.W / 2, y: (y - this.cam.y) * this.cam.zoom + this.H / 2 };
  }

  visibleActor(a: { x: number; y: number }) {
    return this.vis ? pointVisible(this.map, this.vis, a.x, a.y, 8) : false;
  }

  draw(f: FrameData) {
    const { ctx } = this;
    const me = f.me;
    // Kamera
    const zoom = this.baseZoom * f.zoomMul;
    const target = { x: me.x + f.camOffset.x, y: me.y + f.camOffset.y };
    if (!this.smoothCam) this.smoothCam = { ...target };
    const k = 1 - Math.exp(-f.dt * 9);
    this.smoothCam.x += (target.x - this.smoothCam.x) * k;
    this.smoothCam.y += (target.y - this.smoothCam.y) * k;
    const sh = f.shake;
    this.cam.x = this.smoothCam.x + (sh ? (Math.random() - 0.5) * sh : 0);
    this.cam.y = this.smoothCam.y + (sh ? (Math.random() - 0.5) * sh : 0);
    this.cam.zoom += (zoom - this.cam.zoom) * Math.min(1, f.dt * 6);
    const z = this.cam.zoom;
    const halfW = this.W / 2 / z;
    const halfH = this.H / 2 / z;
    const x0 = this.cam.x - halfW;
    const y0 = this.cam.y - halfH;
    const x1 = this.cam.x + halfW;
    const y1 = this.cam.y + halfH;

    // Sichtfeld
    this.vis = me.alive ? this.visCalc.compute(this.map, me.x, me.y, me.aim, me.fov, me.range, NEAR_SENSE, this.settings.quality === 'high' ? 340 : 200) : null;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.W / 2 - this.cam.x * z), this.dpr * (this.H / 2 - this.cam.y * z));
    ctx.imageSmoothingEnabled = true;
    this.painter.draw(ctx, x0, y0, x1, y1, z * this.dpr);
    this.effects.drawDecals(ctx, x0, y0, x1, y1);

    const view = f.view;
    // Extraktionszonen
    for (const ex of view.map.extracts) {
      if (ex.x < x0 - 200 || ex.x > x1 + 200 || ex.y < y0 - 200 || ex.y > y1 + 200) continue;
      const st = view.extractState(ex.id);
      const open = st?.open && ex.kind !== 'paid' && ex.kind !== 'key' && (ex.kind !== 'heli' || st.heli?.phase === 'landed');
      ctx.save();
      ctx.strokeStyle = open ? 'rgba(120,230,120,0.7)' : st?.open ? 'rgba(232,208,112,0.55)' : 'rgba(224,122,96,0.45)';
      ctx.fillStyle = open ? 'rgba(80,200,80,0.08)' : 'rgba(200,150,60,0.05)';
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, ex.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (ex.kind === 'heli' && st?.heli?.phase === 'landed') this.drawHeli(ctx, ex.x, ex.y);
    }

    // Behälter
    for (const c of view.containers.values()) {
      if (c.x < x0 - 40 || c.x > x1 + 40 || c.y < y0 - 40 || c.y > y1 + 40) continue;
      drawContainer(ctx, c);
    }
    if (f.interact) {
      ctx.strokeStyle = 'rgba(240,200,96,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.interact.x, f.interact.y, f.interact.r + 4 + Math.sin(performance.now() / 150) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Akteure
    const now = performance.now() / 1000;
    for (const a of view.actors.values()) {
      if (a.i === me.id) continue;
      if (a.x < x0 - 60 || a.x > x1 + 60 || a.y < y0 - 60 || a.y > y1 + 60) {
        a.vis = 0;
        continue;
      }
      const mate = a.k === 'p';
      const visible = mate || this.visibleActor(a);
      a.vis = clamp(a.vis + (visible ? f.dt * 8 : -f.dt * 5), 0, 1);
      if (visible) a.seenAt = now;
      if (a.vis <= 0.01) continue;
      ctx.globalAlpha = a.vis;
      this.drawActor(ctx, a.x, a.y, a.a, {
        body: mate ? (a.c ?? '#7fb069') : BODY[a.bt ?? 'scav'],
        head: mate ? '#d8b894' : HEAD[a.bt ?? 'scav'],
        weapon: a.w,
        helmet: a.h,
        armor: a.ar > 0,
        backpack: (a.f & 64) !== 0,
        downed: (a.f & 16) !== 0,
        hit: a.hitT >= 0 && a.hitT < 0.12,
        sprint: (a.f & 1) !== 0,
      });
      ctx.globalAlpha = 1;
      if (f.aimAssistTarget === a.i && f.touch) {
        ctx.strokeStyle = 'rgba(255,90,70,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 18, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // eigener Spieler
    if (me.alive) {
      this.drawActor(ctx, me.x, me.y, me.aim, {
        body: me.color,
        head: '#d8b894',
        weapon: me.weapon,
        helmet: me.helmet,
        armor: me.armor,
        backpack: me.backpack,
        downed: me.downed,
        hit: false,
        sprint: me.sprint,
      });
    }

    this.effects.drawWorld(ctx);

    // über Akteuren: Baumkronen, Büsche, Kräne
    for (const p of this.painter.overProps) {
      const r = p.type === 'tree' ? p.w * 1.4 : p.type === 'bush' ? p.w : Math.max(p.w, p.h);
      const cx = p.type === 'tree' || p.type === 'bush' || p.type === 'tower' ? p.x : p.x + p.w / 2;
      const cy = p.type === 'tree' || p.type === 'bush' || p.type === 'tower' ? p.y : p.y + p.h / 2;
      if (cx < x0 - r || cx > x1 + r || cy < y0 - r || cy > y1 + r) continue;
      const near = Math.abs(me.x - cx) < r * 0.9 && Math.abs(me.y - cy) < r * 0.9;
      drawOverProp(ctx, p, near);
    }

    // Wurfvorschau
    if (f.throwPreview && me.alive) {
      const d = Math.min(420, f.aimDist);
      const tx = me.x + Math.cos(me.aim) * d;
      const ty = me.y + Math.sin(me.aim) * d;
      ctx.strokeStyle = 'rgba(255,200,120,0.7)';
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(me.x, me.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(tx, ty, 175, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,120,80,0.4)';
      ctx.stroke();
    }

    // Nebel des Krieges
    this.drawFog(x0, y0);

    // über dem Nebel: Teamkameraden, Pings, Beschriftungen
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.W / 2 - this.cam.x * z), this.dpr * (this.H / 2 - this.cam.y * z));
    for (const a of view.actors.values()) {
      if (a.k !== 'p' || a.i === me.id) continue;
      this.drawNameplate(ctx, a, z);
    }
    for (const a of view.actors.values()) {
      if (a.bt === 'boss' && a.vis > 0.5) {
        ctx.font = `bold ${12 / z}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff7a6a';
        ctx.fillText(a.n ?? 'Boss', a.x, a.y - 22);
      }
    }
    for (const ex of view.map.extracts) {
      if (ex.x < x0 - 300 || ex.x > x1 + 300 || ex.y < y0 - 300 || ex.y > y1 + 300) continue;
      const st = view.extractState(ex.id);
      const conditional = ex.kind === 'paid' || ex.kind === 'key' || (ex.kind === 'heli' && st?.heli?.phase !== 'landed');
      ctx.font = `bold ${13 / z}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = !st?.open ? '#e07a60' : conditional ? '#e8d070' : '#9af08a';
      ctx.fillText('⇱ ' + ex.name, ex.x, ex.y - ex.r - 6 / z);
    }
    const tnow = performance.now() / 1000;
    for (const p of this.effects.pings) {
      const age = tnow - p.t;
      const a = clamp(1 - (age - 6) / 2, 0, 1);
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 / z;
      const pulse = 10 + ((age * 30) % 30);
      ctx.beginPath();
      ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 8, p.y - 18);
      ctx.lineTo(p.x + 8, p.y - 18);
      ctx.closePath();
      ctx.fill();
      ctx.font = `bold ${12 / z}px sans-serif`;
      ctx.fillText(p.name, p.x, p.y - 24);
      ctx.globalAlpha = 1;
    }

    // Bildschirm-Ebene
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawOffscreenMarkers(ctx, view, me);
    if (me.alive && !f.touch && f.mouse) this.drawCrosshair(ctx, f.mouse.x, f.mouse.y, f.spreadDeg, f.aimDist, z, f.hitmarker);
    else if (me.alive && f.touch) {
      const p = this.worldToScreen(me.x + Math.cos(me.aim) * 90, me.y + Math.sin(me.aim) * 90);
      this.drawCrosshair(ctx, p.x, p.y, f.spreadDeg, 90, z, f.hitmarker, true);
    }
  }

  private drawFog(x0: number, y0: number) {
    const fc = this.fctx;
    const fs = this.fog.width / this.W;
    const z = this.cam.zoom;
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.globalCompositeOperation = 'source-over';
    fc.clearRect(0, 0, this.fog.width, this.fog.height);
    fc.fillStyle = 'rgba(4,7,10,0.84)';
    fc.fillRect(0, 0, this.fog.width, this.fog.height);
    const v = this.vis;
    if (v) {
      fc.globalCompositeOperation = 'destination-out';
      fc.setTransform(fs * z, 0, 0, fs * z, -x0 * fs * z, -y0 * fs * z);
      const g1 = fc.createRadialGradient(v.x, v.y, v.range * 0.45, v.x, v.y, v.range);
      g1.addColorStop(0, 'rgba(0,0,0,1)');
      g1.addColorStop(1, 'rgba(0,0,0,0)');
      fc.fillStyle = g1;
      fc.beginPath();
      fc.moveTo(v.x, v.y);
      for (let i = 0; i < v.coneN; i++) fc.lineTo(v.cone[i * 2], v.cone[i * 2 + 1]);
      fc.closePath();
      fc.fill();
      const g2 = fc.createRadialGradient(v.x, v.y, v.nearR * 0.5, v.x, v.y, v.nearR);
      g2.addColorStop(0, 'rgba(0,0,0,0.85)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      fc.fillStyle = g2;
      fc.beginPath();
      for (let i = 0; i < v.nearN; i++) {
        if (i === 0) fc.moveTo(v.near[0], v.near[1]);
        else fc.lineTo(v.near[i * 2], v.near[i * 2 + 1]);
      }
      fc.closePath();
      fc.fill();
    }
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.drawImage(this.fog, 0, 0, this.W, this.H);
    // leichte Vignette
    const vg = ctx.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.35, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  private drawActor(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    aim: number,
    o: { body: string; head: string; weapon: string; helmet: string; armor: boolean; backpack: boolean; downed: boolean; hit: boolean; sprint: boolean },
  ) {
    const r = 11;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(3, 4, r + 2, r, 0, 0, Math.PI * 2);
    ctx.fill();
    if (o.downed) {
      ctx.strokeStyle = `rgba(255,70,60,${0.5 + Math.sin(performance.now() / 160) * 0.3})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.rotate(aim);
    let wclass: WeaponClass = 'pistol';
    if (o.weapon && hasItemDef(o.weapon)) wclass = weaponDef(o.weapon).wclass;
    const len = GUN_LEN[wclass];
    if (!o.downed) {
      // Waffe
      ctx.fillStyle = '#16181a';
      const gw = wclass === 'pistol' ? 4 : 5;
      ctx.fillRect(r - 4, -gw / 2 + 2, len + 4, gw);
      if (wclass !== 'pistol') {
        ctx.fillStyle = '#26292c';
        ctx.fillRect(r + 2, 2 + gw / 2 - 1, 4, 5);
      }
      // Arme
      ctx.fillStyle = o.head === '#d8b894' ? '#3a3a32' : '#2a2a26';
      ctx.beginPath();
      ctx.arc(r - 1, 5, 3.6, 0, Math.PI * 2);
      ctx.arc(wclass === 'pistol' ? r + 2 : r + 9, 2.5, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Rucksack
    if (o.backpack) {
      ctx.fillStyle = '#3d3628';
      roundRect(ctx, -r - 4, -r * 0.62, 9, r * 1.24, 3);
      ctx.fill();
    }
    // Körper
    ctx.fillStyle = o.hit ? '#e8d0c0' : o.body;
    ctx.beginPath();
    if (o.downed) ctx.ellipse(0, 0, r * 1.2, r * 0.8, 0, 0, Math.PI * 2);
    else ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (o.armor) {
      ctx.fillStyle = 'rgba(30,34,30,0.55)';
      roundRect(ctx, -7, -8, 12, 16, 3);
      ctx.fill();
    }
    // Kopf / Helm
    let headCol = o.head;
    if (o.helmet && hasItemDef(o.helmet)) {
      const hd = itemDef(o.helmet);
      headCol = hd.id === 'helm_work' ? '#d8b43a' : hd.id === 'helm_altyn' ? '#4a5a3a' : '#3e4a38';
    }
    ctx.fillStyle = headCol;
    ctx.beginPath();
    ctx.arc(1, 0, 6.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (o.helmet === 'helm_altyn') {
      ctx.fillStyle = '#20281a';
      ctx.fillRect(4, -4, 3, 8);
    }
    ctx.restore();
  }

  private drawHeli(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const t = performance.now() / 1000;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(10, 14, 60, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3d4a3a';
    roundRect(ctx, -46, -18, 72, 36, 16);
    ctx.fill();
    ctx.fillRect(20, -5, 50, 10);
    ctx.fillStyle = 'rgba(150,200,220,0.6)';
    roundRect(ctx, -44, -12, 18, 24, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,30,30,0.6)';
    ctx.lineWidth = 6;
    for (let i = 0; i < 4; i++) {
      const a = t * 18 + (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 80, Math.sin(a) * 80);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawNameplate(ctx: CanvasRenderingContext2D, a: RenderActor, z: number) {
    const fsz = 12 / z;
    ctx.font = `bold ${fsz}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = a.c ?? '#fff';
    ctx.fillText(a.n ?? '', a.x, a.y - 22);
    const hp = (a.hp ?? 100) / 100;
    const w = 30;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(a.x - w / 2, a.y - 19, w, 4);
    ctx.fillStyle = hp < 0.35 ? '#e0574f' : '#7cc45f';
    ctx.fillRect(a.x - w / 2, a.y - 19, w * hp, 4);
    if (a.f & 16) {
      ctx.fillStyle = '#ff6a5e';
      ctx.fillText('AM BODEN', a.x, a.y + 28);
    }
    // Umriss durch Nebel
    if (a.vis < 1) {
      ctx.strokeStyle = a.c ?? '#fff';
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawOffscreenMarkers(ctx: CanvasRenderingContext2D, view: ViewState, me: LocalView) {
    const marks: { x: number; y: number; color: string; label: string }[] = [];
    for (const a of view.actors.values()) if (a.k === 'p' && a.i !== me.id) marks.push({ x: a.x, y: a.y, color: a.c ?? '#fff', label: a.n ?? '' });
    for (const p of this.effects.pings) marks.push({ x: p.x, y: p.y, color: p.color, label: '!' });
    const pad = 40;
    for (const m of marks) {
      const s = this.worldToScreen(m.x, m.y);
      if (s.x > pad && s.x < this.W - pad && s.y > pad && s.y < this.H - pad) continue;
      const cx = this.W / 2;
      const cy = this.H / 2;
      const ang = Math.atan2(s.y - cy, s.x - cx);
      const ex = clamp(cx + Math.cos(ang) * this.W, pad, this.W - pad);
      const ey = clamp(cy + Math.sin(ang) * this.H, pad + 30, this.H - pad);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-6, -8);
      ctx.lineTo(-6, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = m.color;
      ctx.textAlign = 'center';
      ctx.fillText(m.label, ex - Math.cos(ang) * 18, ey - Math.sin(ang) * 18 + 4);
    }
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, spreadDeg: number, dist: number, z: number, hm: FrameData['hitmarker'], small = false) {
    const gap = Math.max(5, Math.tan((spreadDeg * Math.PI) / 180) * dist * z);
    const len = small ? 6 : 8;
    ctx.strokeStyle = 'rgba(240,240,230,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - gap - len, y);
    ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y);
    ctx.lineTo(x + gap + len, y);
    ctx.moveTo(x, y - gap - len);
    ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap);
    ctx.lineTo(x, y + gap + len);
    ctx.stroke();
    ctx.fillStyle = 'rgba(240,240,230,0.9)';
    ctx.fillRect(x - 1, y - 1, 2, 2);
    if (hm && hm.t < 0.25) {
      const a = 1 - hm.t / 0.25;
      ctx.strokeStyle = hm.kill ? `rgba(255,70,60,${a})` : hm.head ? `rgba(255,220,80,${a})` : `rgba(255,255,255,${a})`;
      ctx.lineWidth = hm.kill ? 3 : 2;
      const s = 6;
      const o = 5;
      ctx.beginPath();
      ctx.moveTo(x - o - s, y - o - s);
      ctx.lineTo(x - o, y - o);
      ctx.moveTo(x + o + s, y - o - s);
      ctx.lineTo(x + o, y - o);
      ctx.moveTo(x - o - s, y + o + s);
      ctx.lineTo(x - o, y + o);
      ctx.moveTo(x + o + s, y + o + s);
      ctx.lineTo(x + o, y + o);
      ctx.stroke();
    }
  }
}

/** Behälter-Sprites */
function drawContainer(g: CanvasRenderingContext2D, c: ClientContainer) {
  const { x, y } = c;
  const dim = c.searched && c.empty;
  g.save();
  g.translate(x, y);
  if (dim) g.globalAlpha = 0.55;
  const box = (w: number, h: number, fill: string, stroke = 'rgba(0,0,0,0.5)') => {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(-w / 2 + 3, -h / 2 + 4, w, h);
    g.fillStyle = fill;
    g.fillRect(-w / 2, -h / 2, w, h);
    g.strokeStyle = stroke;
    g.lineWidth = 1.5;
    g.strokeRect(-w / 2 + 0.75, -h / 2 + 0.75, w - 1.5, h - 1.5);
  };
  const kind: ContainerKind = c.kind;
  switch (kind) {
    case 'crate':
      box(26, 24, '#7a5a35');
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.moveTo(-11, -10);
      g.lineTo(11, 10);
      g.moveTo(11, -10);
      g.lineTo(-11, 10);
      g.stroke();
      break;
    case 'weaponbox':
      box(30, 14, '#3e4a30');
      g.fillStyle = '#c8b060';
      g.fillRect(-4, -2, 8, 4);
      break;
    case 'ammobox':
      box(20, 14, '#4f5a32');
      g.fillStyle = '#d8c070';
      g.font = 'bold 8px sans-serif';
      g.textAlign = 'center';
      g.fillText('MUN', 0, 3);
      break;
    case 'medcase':
      box(22, 20, '#e0e0da');
      g.fillStyle = '#c83030';
      g.fillRect(-2.5, -7, 5, 14);
      g.fillRect(-7, -2.5, 14, 5);
      break;
    case 'toolbox':
      box(24, 14, '#a8342a');
      g.fillStyle = '#333';
      g.fillRect(-6, -9, 12, 3);
      break;
    case 'filing':
      box(22, 24, '#6a7078');
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      for (const yy of [-4, 4]) {
        g.beginPath();
        g.moveTo(-9, yy);
        g.lineTo(9, yy);
        g.stroke();
      }
      break;
    case 'safe':
      box(24, 24, '#2c3238', '#5a6068');
      g.strokeStyle = '#a0a8b0';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 6, 0, Math.PI * 2);
      g.stroke();
      break;
    case 'jacket':
      g.fillStyle = '#4a4436';
      g.beginPath();
      g.moveTo(-10, -10);
      g.lineTo(10, -10);
      g.lineTo(12, 10);
      g.lineTo(-12, 10);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.beginPath();
      g.moveTo(0, -10);
      g.lineTo(0, 10);
      g.stroke();
      break;
    case 'pc':
      box(22, 16, '#1e2226');
      g.fillStyle = '#3a6a8a';
      g.fillRect(-8, -5, 16, 9);
      break;
    case 'shelf':
      box(26, 18, '#8a8a7a');
      g.fillStyle = '#a05a40';
      g.fillRect(-10, -5, 6, 4);
      g.fillStyle = '#4a7aa0';
      g.fillRect(-2, -5, 5, 4);
      g.fillStyle = '#a0a050';
      g.fillRect(5, 1, 6, 4);
      break;
    case 'desk':
      box(28, 18, '#6a4a2a');
      g.fillStyle = '#ddd';
      g.fillRect(-6, -4, 9, 7);
      break;
    case 'register':
      box(20, 16, '#3a3a3a');
      g.fillStyle = '#7ac07a';
      g.fillRect(-6, -5, 12, 4);
      break;
    case 'duffle':
      g.fillStyle = '#3a4a3a';
      g.beginPath();
      g.ellipse(0, 0, 14, 8, 0.3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.stroke();
      break;
    case 'trunk':
      g.strokeStyle = 'rgba(240,200,96,0.5)';
      g.lineWidth = 1.5;
      g.strokeRect(-12, -12, 24, 24);
      break;
    case 'fridge':
      box(22, 22, '#d8dad6');
      g.fillStyle = '#999';
      g.fillRect(6, -6, 2, 8);
      break;
    case 'corpse': {
      g.rotate(c.rot ?? 0);
      g.fillStyle = 'rgba(90,8,8,0.55)';
      g.beginPath();
      g.ellipse(-4, 2, 20, 14, 0.4, 0, Math.PI * 2);
      g.fill();
      const col = c.owner === 'player' ? '#5a6a4a' : BODY[(c.owner as BotType) ?? 'scav'] ?? '#555';
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(0, 0, 13, 9, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.beginPath();
      g.arc(10, 0, 6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#222';
      g.fillRect(-4, 9, 18, 4);
      break;
    }
    case 'drop':
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(2, 3, 10, 7, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#c8b070';
      g.beginPath();
      g.moveTo(0, -9);
      g.lineTo(9, 0);
      g.lineTo(0, 9);
      g.lineTo(-9, 0);
      g.closePath();
      g.fill();
      g.strokeStyle = '#4a3a10';
      g.stroke();
      g.fillStyle = `rgba(255,240,180,${0.4 + Math.sin(performance.now() / 300 + x) * 0.3})`;
      g.beginPath();
      g.arc(-2, -3, 2, 0, Math.PI * 2);
      g.fill();
      break;
  }
  if (c.searched && !c.empty && kind !== 'corpse' && kind !== 'drop') {
    g.fillStyle = '#e8c860';
    g.beginPath();
    g.arc(10, -10, 3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

