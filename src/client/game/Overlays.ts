import { TILE } from '../../shared/constants';
import { type EquipSlot, EQUIP_SLOTS, SLOT_NAMES, bagCapacity, inventoryWeight, slotsUsed, type Inventory } from '../../shared/inventory';
import { type ItemStack, isAmmo, isGrenade, isMed, itemDef, isWeapon, weaponDef } from '../../shared/items';
import type { ContainerView } from '../../shared/net/protocol';
import type { PlayerAction } from '../../shared/sim/types';
import { slotForDef } from '../../shared/inventory';
import { clear, h } from '../ui/dom';
import { contextMenu, emptySlot, itemTile } from '../ui/itemUi';
import type { Effects, Ping } from './Effects';
import { exText } from './Hud';
import type { ViewState } from './ViewState';

type Send = (a: PlayerAction) => void;

function longPress(el: HTMLElement, fn: (x: number, y: number) => void) {
  let timer: number | null = null;
  let fired = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    fired = false;
    const x = e.clientX;
    const y = e.clientY;
    timer = window.setTimeout(() => {
      fired = true;
      fn(x, y);
    }, 420);
  });
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointermove', (e) => {
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancel();
  });
  el.addEventListener(
    'click',
    (e) => {
      if (fired) {
        e.stopImmediatePropagation();
        e.preventDefault();
        fired = false;
      }
    },
    true,
  );
}

/** Inventar & Beute-Ansicht im Raid. */
export class RaidInventory {
  root: HTMLElement;
  private inner: HTMLElement;
  private left: HTMLElement;
  private right: HTMLElement;
  open = false;
  private inv: Inventory | null = null;
  private cview: ContainerView | null = null;

  constructor(
    parent: HTMLElement,
    private send: Send,
    private onClose: () => void,
  ) {
    this.left = h('div', { class: 'side' });
    this.right = h('div', { class: 'side' });
    this.inner = h('div', { class: 'inner' }, this.left, this.right);
    this.root = h('div', { class: 'overlay inv-overlay hidden' }, this.inner);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    parent.appendChild(this.root);
  }

  show() {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    document.querySelectorAll('.ctx').forEach((e) => e.remove());
    if (this.cview) this.send({ a: 'close' });
    this.onClose();
  }

  setData(inv: Inventory | null, cview: ContainerView | null) {
    const hadView = !!this.cview;
    this.inv = inv;
    this.cview = cview;
    if (cview && !this.open) this.show();
    else if (!cview && hadView && this.open) this.close();
    else if (this.open) this.render();
  }

  private render() {
    clear(this.left);
    clear(this.right);
    const inv = this.inv;
    if (!inv) return;
    const cv = this.cview;
    // ---- Spieler
    this.left.appendChild(
      h('div', { class: 'close-row' }, h('h2', null, 'Ausrüstung'), h('span', { class: 'small muted' }, `${inventoryWeight(inv).toFixed(1)} kg`), h('button', { class: 'btn small', onclick: () => this.close() }, 'Schließen ✕')),
    );
    const eq = h('div', { class: 'equip-grid' });
    for (const s of EQUIP_SLOTS) {
      const it = inv.equip[s];
      const cell = h('div', { class: 'slot' }, h('div', { class: 'lbl' }, SLOT_NAMES[s]), it ? this.ownTile(it, s) : emptySlot('leer'));
      eq.appendChild(cell);
    }
    this.left.appendChild(eq);
    const used = slotsUsed(inv.bag);
    const cap = bagCapacity(inv);
    this.left.appendChild(capRow('Tasche & Rucksack', used, cap));
    const bag = h('div', { class: 'item-grid scroll', style: { flex: '1' } });
    for (const it of inv.bag) bag.appendChild(this.ownTile(it));
    if (!inv.bag.length) bag.appendChild(h('div', { class: 'muted small' }, 'Leer'));
    this.left.appendChild(bag);
    if (inv.secureCap > 0) {
      this.left.appendChild(capRow('Sicherer Behälter', slotsUsed(inv.secure), inv.secureCap));
      const sec = h('div', { class: 'item-grid' });
      for (const it of inv.secure) sec.appendChild(this.ownTile(it));
      this.left.appendChild(sec);
      if (!inv.secure.length) this.left.appendChild(h('div', { class: 'muted small' }, 'Leer – Inhalt bleibt beim Tod erhalten.'));
    }

    // ---- Behälter
    this.inner.classList.toggle('solo', !cv);
    if (cv) {
      this.right.classList.remove('hidden');
      this.right.appendChild(
        h(
          'div',
          { class: 'close-row' },
          h('h2', null, cv.name),
          cv.items.length ? h('button', { class: 'btn small primary', onclick: () => this.send({ a: 'takeAll', c: cv.id }) }, 'Alles nehmen') : null,
        ),
      );
      const grid = h('div', { class: 'item-grid scroll', style: { flex: '1' } });
      for (const it of cv.items) {
        const t = itemTile(it, {
          onClick: () => this.send({ a: 'take', c: cv.id, uid: it.uid }),
          onContext: (e) => this.containerMenu(it, e.clientX, e.clientY),
        });
        longPress(t, (x, y) => this.containerMenu(it, x, y));
        grid.appendChild(t);
      }
      if (!cv.items.length) grid.appendChild(h('div', { class: 'muted' }, 'Leer.'));
      this.right.appendChild(grid);
      this.right.appendChild(h('div', { class: 'tiny muted' }, 'Tippen/Klicken: nehmen · Lang drücken/Rechtsklick: Optionen'));
    } else {
      this.right.classList.add('hidden');
    }
  }

  private ownTile(it: ItemStack, slot?: EquipSlot) {
    const t = itemTile(it, {
      onClick: (e) => {
        if (this.cview && !slot && e.shiftKey) {
          this.send({ a: 'put', c: this.cview.id, uid: it.uid });
          return;
        }
        this.ownMenu(it, slot, e.clientX, e.clientY);
      },
      onContext: (e) => this.ownMenu(it, slot, e.clientX, e.clientY),
    });
    return t;
  }

  private ownMenu(it: ItemStack, slot: EquipSlot | undefined, x: number, y: number) {
    const d = itemDef(it.id);
    const acts: { label: string; run: () => void; cls?: string }[] = [];
    const inSecure = this.inv?.secure.some((s) => s.uid === it.uid);
    if (isMed(d) && !slot) acts.push({ label: 'Benutzen', run: () => this.send({ a: 'use', uid: it.uid }) });
    if (isGrenade(d)) acts.push({ label: 'Werfen (Blickrichtung)', run: () => this.send({ a: 'use', uid: it.uid }) });
    if (isAmmo(d)) acts.push({ label: 'In aktive Waffe laden', run: () => this.send({ a: 'reload', ammo: it.id }) });
    if (!slot && slotForDef(d)) acts.push({ label: 'Ausrüsten', run: () => this.send({ a: 'equip', uid: it.uid }) });
    if (slot) acts.push({ label: 'In die Tasche', run: () => this.send({ a: 'unequip', slot }) });
    if (!slot && (inSecure || (this.inv?.secureCap ?? 0) > 0)) acts.push({ label: inSecure ? 'In die Tasche' : 'In sicheren Behälter', run: () => this.send({ a: 'move', uid: it.uid, to: inSecure ? 'bag' : 'secure' }) });
    if (this.cview) acts.push({ label: `In ${this.cview.name} legen`, run: () => this.send({ a: 'put', c: this.cview!.id, uid: it.uid }) });
    if (d.stack > 1 && it.n > 1) acts.push({ label: 'Hälfte fallen lassen', run: () => this.send({ a: 'drop', uid: it.uid, n: Math.ceil(it.n / 2) }) });
    acts.push({ label: 'Fallen lassen', run: () => this.send({ a: 'drop', uid: it.uid }), cls: 'bad' });
    let title = d.name;
    if (isWeapon(d)) title += ` (${it.mag ?? 0}/${weaponDef(it.id).mag})`;
    contextMenu(x, y, title, acts);
  }

  private containerMenu(it: ItemStack, x: number, y: number) {
    const cv = this.cview;
    if (!cv) return;
    const d = itemDef(it.id);
    const acts = [
      { label: 'Nehmen', run: () => this.send({ a: 'take', c: cv.id, uid: it.uid }) },
      { label: 'In sicheren Behälter', run: () => this.send({ a: 'take', c: cv.id, uid: it.uid, to: 'secure' }) },
    ];
    if (slotForDef(d)) acts.push({ label: 'Direkt ausrüsten', run: () => this.send({ a: 'take', c: cv.id, uid: it.uid, to: 'equip' }) });
    if (d.stack > 1 && it.n > 1) acts.push({ label: 'Hälfte nehmen', run: () => this.send({ a: 'take', c: cv.id, uid: it.uid, n: Math.ceil(it.n / 2) }) });
    contextMenu(x, y, d.name, acts);
  }
}

function capRow(label: string, used: number, cap: number) {
  return h(
    'div',
    { class: 'row gap-s' },
    h('h3', null, label),
    h('div', { class: 'capbar' + (used >= cap ? ' full' : '') }, h('div', { style: { width: Math.min(100, (used / Math.max(1, cap)) * 100) + '%' } })),
    h('span', { class: 'small mono' }, `${used}/${cap}`),
  );
}

/** Vollbild-Karte. */
export class MapOverlay {
  root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private legend: HTMLElement;
  private legendBody: HTMLElement;
  private clearBtn: HTMLElement;
  private fx: Effects | null = null;
  open = false;

  constructor(
    parent: HTMLElement,
    private view: ViewState,
    private overview: HTMLCanvasElement,
    private onAction: (a: Extract<PlayerAction, { a: 'ping' | 'unping' }>) => void,
    private onClose: () => void,
  ) {
    this.canvas = h('canvas');
    this.legendBody = h('div', { class: 'legend-body' });
    // auf kleinen Bildschirmen eingeklappt, damit die Liste die Karte nicht verdeckt
    this.legend = h(
      'div',
      { class: 'legend' + (window.innerHeight < 560 ? ' collapsed' : '') },
      h('button', { class: 'legend-toggle', onclick: () => this.legend.classList.toggle('collapsed') }, 'Extraktionen'),
      this.legendBody,
      h('div', { class: 'muted tiny legend-hint' }, 'Tippen = Markierung setzen · eigene Markierung antippen = löschen'),
    );
    this.clearBtn = h('button', { class: 'btn small', onclick: () => this.onAction({ a: 'unping' }) }, 'Markierungen löschen');
    this.root = h(
      'div',
      { class: 'overlay map-overlay hidden', style: { alignItems: 'center' } },
      this.canvas,
      this.legend,
      h('div', { class: 'row gap map-buttons' }, this.clearBtn, h('button', { class: 'btn small', onclick: () => this.close() }, 'Schließen ✕')),
    );
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.view.map.pixelW;
      const y = ((e.clientY - r.top) / r.height) * this.view.map.pixelH;
      // eigene Markierung antippen = löschen, sonst neue setzen
      const near = this.fx?.pingNear(this.view.you, x, y, 22 / (r.width / this.view.map.pixelW));
      if (near) this.onAction({ a: 'unping', x: near.x, y: near.y });
      else this.onAction({ a: 'ping', x, y, keep: true });
    });
    parent.appendChild(this.root);
  }

  show() {
    this.open = true;
    this.root.classList.remove('hidden');
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.onClose();
  }

  draw(meX: number, meY: number, aim: number, fx: Effects) {
    this.fx = fx;
    if (!this.open) return;
    const pings = fx.pings;
    const m = this.view.map;
    const maxW = window.innerWidth - 24;
    const maxH = window.innerHeight - 24;
    const scale = Math.min(maxW / m.pixelW, maxH / m.pixelH);
    const W = Math.round(m.pixelW * scale);
    const H = Math.round(m.pixelH * scale);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== W * dpr) {
      this.canvas.width = W * dpr;
      this.canvas.height = H * dpr;
      this.canvas.style.width = W + 'px';
      this.canvas.style.height = H + 'px';
    }
    const g = this.canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.overview, 0, 0, W, H);
    g.imageSmoothingEnabled = true;
    const s = scale;
    // Zonen
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'center';
    for (const z of m.zones) {
      if (z.w * z.h < 60 || z.id.startsWith('haus') || z.id.startsWith('cont_')) continue;
      g.fillStyle = 'rgba(240,235,210,0.75)';
      g.fillText(z.name, (z.x + z.w / 2) * TILE * s, (z.y + z.h / 2) * TILE * s);
    }
    // Extraktionen
    const legend: string[] = [];
    for (const def of m.extracts) {
      const st = this.view.extractState(def.id);
      const open = !!st?.open;
      g.fillStyle = open ? '#7cf06a' : '#e0b060';
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(def.x * s, def.y * s, 7, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#fff';
      g.font = 'bold 12px sans-serif';
      const tw = g.measureText(def.name).width / 2 + 4;
      g.fillText(def.name, Math.max(tw, Math.min(W - tw, def.x * s)), Math.max(14, def.y * s - 11));
      legend.push(`<div>${def.name}: <span class="${open ? 'good' : 'warn'}">${exText(def, st)}</span></div>`);
    }
    const own = pings.some((p) => p.by === this.view.you);
    this.clearBtn.classList.toggle('hidden', !own);
    const lh = legend.join('');
    if (this.legendBody.innerHTML !== lh) this.legendBody.innerHTML = lh;
    // Squad
    for (const a of this.view.actors.values()) {
      if (a.k !== 'p' || a.i === this.view.you) continue;
      g.fillStyle = a.c ?? '#fff';
      g.beginPath();
      g.arc(a.x * s, a.y * s, 5, 0, Math.PI * 2);
      g.fill();
    }
    for (const p of pings) drawMapPing(g, p, s, p.by === this.view.you);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(meX * s, meY * s, 6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(meX * s, meY * s);
    g.lineTo(meX * s + Math.cos(aim) * 18, meY * s + Math.sin(aim) * 18);
    g.stroke();
  }
}

/** Markierung auf der Karte: Stecknadel für bleibende, Ring für kurze Markierungen. */
function drawMapPing(g: CanvasRenderingContext2D, p: Ping, s: number, own: boolean) {
  const x = p.x * s;
  const y = p.y * s;
  if (!p.keep) {
    g.strokeStyle = p.color;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, 9, 0, Math.PI * 2);
    g.stroke();
    return;
  }
  g.fillStyle = p.color;
  g.strokeStyle = '#000';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x, y);
  g.bezierCurveTo(x - 10, y - 12, x - 8, y - 22, x, y - 22);
  g.bezierCurveTo(x + 8, y - 22, x + 10, y - 12, x, y);
  g.closePath();
  g.stroke();
  g.fill();
  g.fillStyle = '#000';
  g.beginPath();
  g.arc(x, y - 15, 3, 0, Math.PI * 2);
  g.fill();
  if (own) {
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, 3.5, 0, Math.PI * 2);
    g.stroke();
  }
}
