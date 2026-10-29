import { type WeaponClass, hasItemDef, weaponDef } from '../../shared/items';
import type { BotType } from '../../shared/loot';

/**
 * Zeichnet Figuren von oben: Schultern, Tarnmuster, Plattenträger, Rucksack, Arme an der Waffe, Helm.
 * Koordinaten im gedrehten System: +x = Blickrichtung, +y = rechte Seite.
 */

type CamoStyle = 'woodland' | 'multicam' | 'flora' | 'digital';

export interface Look {
  style: CamoStyle;
  /** Grundfarbe und Fleckenfarben */
  colors: string[];
  gear: string;
  glove: string;
  skin: string;
  hat: 'beanie' | 'cap' | 'balaclava' | 'beret';
  hatColor: string;
  /** Kennfarbe (Schulterabzeichen), nur Spieler */
  patch?: string;
}

export interface SoldierOpts {
  look: Look;
  weapon: string;
  helmet: string;
  armor: boolean;
  backpack: boolean;
  downed: boolean;
  hit: boolean;
  /** Variation (z. B. Akteur-ID) für Mütze und Musterversatz */
  seed: number;
}

const GUN_LEN: Record<WeaponClass, number> = { pistol: 9, smg: 15, ar: 21, shotgun: 20, dmr: 25, sniper: 29, lmg: 24 };
const BEANIES = ['#3a3a36', '#5a2e2a', '#2e3a4a', '#4a4a3a', '#5a5248'];

const BOT_LOOKS: Record<BotType, Look> = {
  scav: { style: 'woodland', colors: ['#6b5d44', '#857353', '#4f4532', '#2f2a22'], gear: '#4a4234', glove: '#3a3228', skin: '#c9a27e', hat: 'beanie', hatColor: BEANIES[0] },
  pmc: { style: 'digital', colors: ['#3a444d', '#4f5a64', '#262d33', '#66707a'], gear: '#1f2428', glove: '#1a1c1e', skin: '#c9a27e', hat: 'cap', hatColor: '#22282d' },
  guard: { style: 'flora', colors: ['#4a5a38', '#6b7a4a', '#2e3a24', '#8a8a5a'], gear: '#2e3626', glove: '#23281e', skin: '#c9a27e', hat: 'balaclava', hatColor: '#23281e' },
  boss: { style: 'woodland', colors: ['#3a2424', '#5e2424', '#1e1616', '#7a3a2e'], gear: '#1e1a1a', glove: '#161414', skin: '#c9a27e', hat: 'beret', hatColor: '#7a1e1e' },
};

export function botLook(t: BotType | undefined): Look {
  return BOT_LOOKS[t ?? 'scav'] ?? BOT_LOOKS.scav;
}

const playerLooks = new Map<string, Look>();
/** Spieler: Multicam, leicht in der eigenen Farbe eingefärbt, dazu Schulterabzeichen in Kennfarbe. */
export function playerLook(color: string): Look {
  let l = playerLooks.get(color);
  if (!l) {
    const base = ['#8a7d5e', '#5f6b45', '#6e5a40', '#3a3428', '#b0a27e'];
    l = {
      style: 'multicam',
      colors: base.map((c, i) => mix(c, color, i === 3 ? 0.05 : 0.12)),
      gear: mix('#4a4636', color, 0.22),
      glove: '#2a2822',
      skin: '#d8b894',
      hat: 'cap',
      hatColor: mix('#5a5440', color, 0.15),
      patch: color,
    };
    playerLooks.set(color, l);
  }
  return l;
}

// ---------------- Farben ----------------
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
function shade(hex: string, k: number): string {
  return k >= 0 ? mix(hex, '#ffffff', k) : mix(hex, '#000000', -k);
}

// ---------------- Tarnmuster ----------------
const TILE = 128; // Pixel der Kachel
const TILE_WORLD = 26; // Welteinheiten pro Kachel
const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern | null>>();

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zeichnet eine Form 9-mal versetzt, damit die Kachel nahtlos wiederholt. */
function wrapped(g: CanvasRenderingContext2D, draw: (ox: number, oy: number) => void) {
  for (let ox = -TILE; ox <= TILE; ox += TILE) for (let oy = -TILE; oy <= TILE; oy += TILE) draw(ox, oy);
}

function blob(g: CanvasRenderingContext2D, r: () => number, cx: number, cy: number, rad: number, stretch = 1, rot = 0) {
  const n = 9;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = rad * (0.6 + r() * 0.6);
    const px = Math.cos(a) * rr * stretch;
    const py = Math.sin(a) * rr;
    pts.push([cx + px * Math.cos(rot) - py * Math.sin(rot), cy + px * Math.sin(rot) + py * Math.cos(rot)]);
  }
  g.beginPath();
  const mid = (i: number) => [(pts[i][0] + pts[(i + 1) % n][0]) / 2, (pts[i][1] + pts[(i + 1) % n][1]) / 2];
  const m0 = mid(n - 1);
  g.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(i);
    g.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  g.closePath();
  g.fill();
}

function paintCamo(g: CanvasRenderingContext2D, style: CamoStyle, colors: string[], seed: number) {
  const r = rand(seed);
  g.fillStyle = colors[0];
  g.fillRect(0, 0, TILE, TILE);
  const layer = (col: string, count: number, min: number, max: number, stretch = 1, rotSpread = 0) => {
    g.fillStyle = col;
    for (let i = 0; i < count; i++) {
      const cx = r() * TILE;
      const cy = r() * TILE;
      const rad = min + r() * (max - min);
      const rot = (r() - 0.5) * rotSpread;
      const s = r() * 1e9;
      wrapped(g, (ox, oy) => blob(g, rand(s), cx + ox, cy + oy, rad, stretch, rot));
    }
  };
  if (style === 'woodland') {
    layer(colors[1], 7, 16, 26);
    layer(colors[2], 8, 12, 20);
    layer(colors[3], 10, 5, 10);
  } else if (style === 'multicam') {
    g.globalAlpha = 0.85;
    layer(colors[1], 9, 12, 20);
    layer(colors[2], 10, 8, 14);
    g.globalAlpha = 1;
    layer(colors[3], 14, 3, 6);
    layer(colors[4] ?? colors[1], 10, 2, 5);
  } else if (style === 'flora') {
    layer(colors[1], 9, 9, 14, 2.6, 0.5);
    layer(colors[2], 9, 6, 10, 2.8, 0.5);
    layer(colors[3], 12, 3, 5, 1.6, 0.8);
  } else {
    const cell = 8;
    const cells = TILE / cell;
    for (const col of [colors[1], colors[2], colors[3]]) {
      g.fillStyle = col;
      for (let i = 0; i < 26; i++) {
        let cx = Math.floor(r() * cells);
        let cy = Math.floor(r() * cells);
        const len = 3 + Math.floor(r() * 5);
        for (let k = 0; k < len; k++) {
          g.fillRect(((cx % cells) + cells) % cells * cell, ((cy % cells) + cells) % cells * cell, cell, cell);
          if (r() < 0.5) cx += r() < 0.5 ? 1 : -1;
          else cy += r() < 0.5 ? 1 : -1;
        }
      }
    }
  }
}

function camo(ctx: CanvasRenderingContext2D, look: Look): CanvasPattern | string {
  let m = patterns.get(ctx);
  if (!m) {
    m = new Map();
    patterns.set(ctx, m);
  }
  const key = look.style + look.colors.join();
  if (!m.has(key)) {
    let p: CanvasPattern | null = null;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = TILE;
      const g = c.getContext('2d');
      if (g) {
        paintCamo(g, look.style, look.colors, hashStr(key));
        p = ctx.createPattern(c, 'repeat');
        p?.setTransform?.(new DOMMatrix().scale(TILE_WORLD / TILE));
      }
    } catch {
      p = null;
    }
    m.set(key, p);
  }
  return m.get(key) ?? look.colors[0];
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------- Figur ----------------
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

function limb(ctx: CanvasRenderingContext2D, pts: [number, number][], fill: CanvasPattern | string, w: number) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = w + 1.6;
  ctx.stroke();
  ctx.strokeStyle = fill;
  ctx.lineWidth = w;
  ctx.stroke();
}

function drawGun(ctx: CanvasRenderingContext2D, wclass: WeaponClass, len: number) {
  const y = 2.6;
  if (wclass === 'pistol') {
    ctx.fillStyle = '#17191b';
    rr(ctx, 6, y - 1.7, len, 3.4, 1);
    ctx.fill();
    ctx.fillStyle = '#2c3034';
    ctx.fillRect(7, y - 0.6, len - 3, 1.2);
    return;
  }
  const rec = 4 + len * 0.45;
  // Schaft
  ctx.fillStyle = '#1d2022';
  rr(ctx, 1, y - 2, 5, 4, 1.2);
  ctx.fill();
  // Gehäuse
  ctx.fillStyle = '#17191b';
  rr(ctx, 5, y - 2.4, rec - 5, 4.8, 1);
  ctx.fill();
  // Handschutz und Lauf
  ctx.fillStyle = wclass === 'shotgun' ? '#3a2e22' : '#22262a';
  rr(ctx, rec, y - 2, len * 0.32, 4, 1);
  ctx.fill();
  ctx.fillStyle = '#121416';
  ctx.fillRect(rec + len * 0.32, y - 0.9, 4 + len * 0.23, 1.8);
  // Optik
  if (wclass !== 'shotgun') {
    const long = wclass === 'sniper' || wclass === 'dmr';
    ctx.fillStyle = '#0d0f10';
    rr(ctx, rec - (long ? 9 : 6), y - 1.5, long ? 10 : 5, 3, 1.2);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,170,200,0.55)';
    ctx.fillRect(rec - (long ? 0 : 1.6), y - 0.9, 1.2, 1.8);
  }
  if (wclass === 'lmg') {
    ctx.fillStyle = '#2b2f22';
    rr(ctx, rec - 5, y + 2, 6, 4, 1.5);
    ctx.fill();
  }
}

export function drawSoldier(ctx: CanvasRenderingContext2D, x: number, y: number, aim: number, o: SoldierOpts) {
  const look = o.look;
  const cloth = o.hit ? '#e8d0c0' : camo(ctx, look);
  ctx.save();
  ctx.translate(x, y);
  // Schatten
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(3, 4, 13, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  if (o.downed) {
    ctx.strokeStyle = `rgba(255,70,60,${0.5 + Math.sin(performance.now() / 160) * 0.3})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.rotate(aim);
  if (o.downed) {
    drawLying(ctx, o, cloth);
    ctx.restore();
    return;
  }
  let wclass: WeaponClass = 'pistol';
  if (o.weapon && hasItemDef(o.weapon)) wclass = weaponDef(o.weapon).wclass;
  const len = GUN_LEN[wclass];

  // Rucksack hinter dem Rücken
  if (o.backpack) {
    ctx.fillStyle = o.hit ? cloth : look.gear;
    rr(ctx, -14, -7, 9, 14, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-13, -1, 7, 2);
  }
  // Rumpf mit Schultern
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.ellipse(-0.5, 0, 6.4, 10.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // Plattenträger mit Magazintaschen
  if (o.armor) {
    ctx.fillStyle = o.hit ? cloth : look.gear;
    rr(ctx, -5, -6.8, 10, 13.6, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = shade(look.gear, -0.25);
    for (let i = -1; i <= 1; i++) ctx.fillRect(2.8, i * 3.6 - 1.4, 2.4, 2.8);
  }
  // Rucksackgurte über den Schultern
  if (o.backpack) {
    ctx.strokeStyle = shade(look.gear, -0.3);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-6, -5.5);
    ctx.lineTo(2, -6.5);
    ctx.moveTo(-6, 5.5);
    ctx.lineTo(2, 6.5);
    ctx.stroke();
  }
  // Kennabzeichen auf den Schultern
  if (look.patch && !o.hit) {
    ctx.fillStyle = look.patch;
    ctx.fillRect(-3, -10.6, 5, 3);
    ctx.fillRect(-3, 7.6, 5, 3);
  }
  // Arme unter der Waffe, Hände darauf
  const pistol = wclass === 'pistol';
  const grip: [number, number] = pistol ? [7, 3.2] : [7.5, 3.6];
  const fore: [number, number] = pistol ? [8.5, 1.4] : [4 + len * 0.6, 1.6];
  limb(ctx, [[-1, 8.6], [4, 9.2], grip], cloth, 3.4);
  limb(ctx, [[-1, -8.6], [pistol ? 4 : 6, -6], fore], cloth, 3.4);
  drawGun(ctx, wclass, len);
  ctx.fillStyle = look.glove;
  for (const [hx, hy] of [grip, fore]) {
    ctx.beginPath();
    ctx.arc(hx, hy, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
  drawHead(ctx, o);
  ctx.restore();
}

function drawHead(ctx: CanvasRenderingContext2D, o: SoldierOpts) {
  const look = o.look;
  const hx = 0.6;
  const helmet = o.helmet;
  const outline = () => {
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  };
  const circle = (x: number, y: number, r: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  if (helmet === 'helm_work') {
    circle(hx, 0, 6.6, '#b8952c');
    outline();
    circle(hx + 0.4, 0, 5, '#d8b43a');
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(hx - 4.4, -0.7, 8.8, 1.4);
  } else if (helmet === 'helm_ssh') {
    circle(hx, 0, 6, '#4a5640');
    outline();
    circle(hx - 1.4, -1.4, 3, 'rgba(255,255,255,0.12)');
  } else if (helmet === 'helm_ops') {
    circle(hx, 0, 5.8, '#7a6c4e');
    outline();
    ctx.fillStyle = '#2a2a26';
    ctx.fillRect(hx - 3, -6.1, 6, 1.4);
    ctx.fillRect(hx - 3, 4.7, 6, 1.4);
    ctx.fillStyle = '#1a1a1a';
    rr(ctx, hx + 3.8, -1.5, 3, 3, 1);
    ctx.fill();
    circle(hx - 1.6, -1.6, 2.6, 'rgba(255,255,255,0.1)');
  } else if (helmet === 'helm_altyn') {
    circle(hx, 0, 6.6, '#4a5a3a');
    outline();
    ctx.fillStyle = '#1c2216';
    ctx.beginPath();
    ctx.ellipse(hx + 4.3, 0, 2.6, 4.9, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    circle(hx - 1.8, -1.8, 3, 'rgba(255,255,255,0.1)');
  } else if (helmet && hasItemDef(helmet)) {
    circle(hx, 0, 6, '#3e4a38');
    outline();
  } else {
    // ohne Helm: Kopf mit Mütze, Kappe, Sturmhaube oder Barett
    circle(hx, 0, 5, look.hat === 'balaclava' ? look.hatColor : look.skin);
    outline();
    if (look.hat === 'beanie') {
      circle(hx - 0.8, 0, 4.5, BEANIES[Math.abs(o.seed) % BEANIES.length]);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      for (let i = -2; i <= 2; i++) ctx.fillRect(hx - 4, i * 1.6 - 0.35, 5.6, 0.7);
    } else if (look.hat === 'cap') {
      ctx.fillStyle = look.hatColor;
      ctx.beginPath();
      ctx.ellipse(hx + 4.2, 0, 3, 4, 0, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
      circle(hx - 0.6, 0, 4.7, look.hatColor);
      circle(hx - 1.6, -1.4, 2.2, 'rgba(255,255,255,0.1)');
    } else if (look.hat === 'balaclava') {
      ctx.fillStyle = look.skin;
      rr(ctx, hx + 2.6, -2.2, 2, 4.4, 1);
      ctx.fill();
    } else if (look.hat === 'beret') {
      ctx.fillStyle = look.hatColor;
      ctx.beginPath();
      ctx.ellipse(hx - 1, -0.7, 4.7, 5, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawLying(ctx: CanvasRenderingContext2D, o: SoldierOpts, cloth: CanvasPattern | string) {
  // liegend: Kopf vorn, Beine hinten, ein Arm ausgestreckt
  limb(ctx, [[-6, 3.2], [-14, 4.2], [-22, 6.5]], cloth, 4.4);
  limb(ctx, [[-6, -3.2], [-14, -4.8], [-21, -9]], cloth, 4.4);
  limb(ctx, [[3, 6.5], [9, 11], [15, 12]], cloth, 3.6);
  limb(ctx, [[3, -6.5], [-2, -10], [-7, -9.5]], cloth, 3.6);
  ctx.fillStyle = o.look.glove;
  for (const [hx, hy] of [[15, 12], [-7, -9.5]]) {
    ctx.beginPath();
    ctx.arc(hx, hy, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#1c1e1a';
  for (const [fx, fy] of [[-23, 6.8], [-22, -9.6]]) {
    ctx.beginPath();
    ctx.ellipse(fx, fy, 2.6, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.ellipse(-1, 0, 8.4, 7.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  if (o.armor) {
    ctx.fillStyle = o.look.gear;
    rr(ctx, -6.5, -5.2, 11, 10.4, 3);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(9.5, 0);
  drawHead(ctx, o);
  ctx.restore();
}

/** Leiche als Beutebehälter: liegende Figur im Stil ihrer Fraktion. */
export function drawCorpse(ctx: CanvasRenderingContext2D, owner: BotType | 'player' | undefined, seed: number) {
  ctx.fillStyle = 'rgba(90,8,8,0.55)';
  ctx.beginPath();
  ctx.ellipse(-4, 2, 20, 14, 0.4, 0, Math.PI * 2);
  ctx.fill();
  const look = owner === 'player' || !owner ? playerLook('#7a7a6a') : botLook(owner);
  drawLying(ctx, { look, weapon: '', helmet: '', armor: owner !== 'scav', backpack: false, downed: true, hit: false, seed }, camo(ctx, look));
}
