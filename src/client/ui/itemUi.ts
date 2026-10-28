import {
  type ItemStack,
  CALIBER_NAMES,
  CAT_NAMES,
  WEAPON_CLASS_NAMES,
  ammoDef,
  isAmmo,
  isArmor,
  isBackpack,
  isGrenade,
  isMed,
  isWeapon,
  itemDef,
  stackSlots,
  stackValue,
  stackWeight,
} from '../../shared/items';
import { formatMoney } from '../../shared/math';
import { h, svgEl } from './dom';
import { iconSvg } from './icons';

export interface TileOpts {
  onClick?: (e: MouseEvent) => void;
  onContext?: (e: MouseEvent) => void;
  selected?: boolean;
  locked?: boolean;
  priceTag?: string;
  small?: boolean;
}

export function itemTile(it: ItemStack, o: TileOpts = {}): HTMLElement {
  const d = itemDef(it.id);
  const cls = ['item', 't' + Math.min(4, Math.max(1, d.tier))];
  if (o.selected) cls.push('selected');
  if (o.locked) cls.push('locked');
  const el = h('div', { class: cls.join(' '), title: d.name });
  el.appendChild(h('div', { class: 'ico' }, svgEl(iconSvg(d.icon))));
  el.appendChild(h('div', { class: 'nm' }, d.short));
  const slots = stackSlots(it);
  if (slots > 1 || d.size > 1) el.appendChild(h('div', { class: 'size' }, '▪' + slots));
  if (d.stack > 1 && (it.n > 1 || d.cat === 'ammo' || d.cat === 'cash')) el.appendChild(h('div', { class: 'qty' }, d.cat === 'cash' ? formatShort(it.n) : String(it.n)));
  if (isWeapon(d)) el.appendChild(h('div', { class: 'qty' }, `${it.mag ?? 0}/${d.mag}`));
  if (isArmor(d) && it.dur !== undefined) {
    const f = Math.max(0, it.dur / d.dur);
    el.appendChild(h('div', { class: 'dur' }, h('div', { style: { width: f * 100 + '%', background: f < 0.3 ? 'var(--bad)' : f < 0.6 ? 'var(--warn)' : 'var(--good)' } })));
    el.appendChild(h('div', { class: 'tag' }, 'K' + d.cls));
  }
  if (isMed(d) && d.uses > 1) el.appendChild(h('div', { class: 'qty' }, `${it.dur ?? d.uses}/${d.uses}`));
  if (isBackpack(d)) el.appendChild(h('div', { class: 'tag' }, '+' + d.cap));
  if (o.priceTag) el.appendChild(h('div', { class: 'tag', style: { color: 'var(--accent2)' } }, o.priceTag));
  if (o.onClick) el.addEventListener('click', o.onClick);
  if (o.onContext)
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      o.onContext!(e);
    });
  return el;
}

export function emptySlot(label: string): HTMLElement {
  return h('div', { class: 'item empty' }, h('div', { class: 'nm dim' }, label));
}

export function formatShort(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 10_000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
  return String(n);
}

/** Detailinformationen (Werte) zu einem Gegenstand. */
export function itemStats(it: ItemStack): HTMLElement {
  const d = itemDef(it.id);
  const rows: [string, string][] = [['Kategorie', CAT_NAMES[d.cat]]];
  if (isWeapon(d)) {
    rows.push(['Typ', WEAPON_CLASS_NAMES[d.wclass]], ['Kaliber', CALIBER_NAMES[d.caliber]], ['Magazin', `${it.mag ?? 0} / ${d.mag}`]);
    if (it.ammo) rows.push(['Geladen', ammoDef(it.ammo).name]);
    rows.push(
      ['Feuerrate', `${d.rpm} Schuss/min ${d.auto ? '(Auto)' : '(Einzel)'}`],
      ['Präzision', `${(10 / (d.spread + 0.5)).toFixed(1)}`],
      ['Rückstoß', `${(d.bloom * 10).toFixed(0)}`],
      ['Reichweite', `${Math.round(d.range / 32)} m`],
      ['Nachladen', `${d.reload.toFixed(1)} s`],
      ['Platz', `${d.slot === 'primary' ? 'Hauptwaffe' : 'Seitenwaffe'}`],
    );
  }
  if (isAmmo(d)) rows.push(['Kaliber', CALIBER_NAMES[d.caliber]], ['Schaden', d.pellets > 1 ? `${d.dmg} × ${d.pellets}` : String(d.dmg)], ['Durchschlag', String(d.pen)], ['Rüstungsschaden', `${Math.round(d.armorDmg * 100)} %`]);
  if (isArmor(d)) rows.push(['Schutzklasse', String(d.cls)], ['Haltbarkeit', `${Math.round(it.dur ?? d.dur)} / ${d.dur}`], ['Tempo-Malus', `${Math.round(d.speedPenalty * 100)} %`]);
  if (isArmor(d) && d.fovPenalty) rows.push(['Sichtfeld', `-${d.fovPenalty}°`]);
  if (isBackpack(d)) rows.push(['Kapazität', `+${d.cap} Einheiten`]);
  if (isMed(d)) {
    if (d.heal) rows.push(['Heilung', `+${d.heal} HP`]);
    if (d.stopsBleed) rows.push(['Blutung', 'stoppt']);
    rows.push(['Anwendung', `${d.useTime} s`]);
    if (d.uses > 1) rows.push(['Anwendungen', `${it.dur ?? d.uses} / ${d.uses}`]);
  }
  if (isGrenade(d)) rows.push(['Schaden', String(d.dmg)], ['Radius', `${Math.round(d.radius / 32)} m`], ['Zünder', `${d.fuse} s`]);
  rows.push(['Größe', `${stackSlots(it)} Einh.`], ['Gewicht', `${stackWeight(it).toFixed(2)} kg`], ['Wert', formatMoney(stackValue(it))]);
  const grid = h('div', { class: 'stats' });
  for (const [k, v] of rows) grid.append(h('div', { class: 'k' }, k), h('div', null, v));
  return grid;
}

export function itemHeader(it: ItemStack): HTMLElement {
  const d = itemDef(it.id);
  return h(
    'div',
    { class: 'head' },
    itemTile(it),
    h('div', null, h('div', { style: { fontWeight: '800', fontSize: '16px' } }, d.name + (d.stack > 1 && it.n > 1 ? ` ×${it.n}` : '')), d.desc ? h('div', { class: 'muted small' }, d.desc) : null),
  );
}

/** Kontextmenü an Position. */
export function contextMenu(x: number, y: number, title: string, actions: { label: string; run: () => void; cls?: string }[]) {
  document.querySelectorAll('.ctx').forEach((e) => e.remove());
  const menu = h('div', { class: 'ctx' }, h('div', { class: 'ctx-title' }, title));
  for (const a of actions) {
    menu.appendChild(
      h(
        'button',
        {
          class: a.cls ?? '',
          onclick: (e: Event) => {
            e.stopPropagation();
            menu.remove();
            a.run();
          },
        },
        a.label,
      ),
    );
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(6, Math.min(window.innerWidth - r.width - 6, x)) + 'px';
  menu.style.top = Math.max(6, Math.min(window.innerHeight - r.height - 6, y)) + 'px';
  const close = (e: Event) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      window.removeEventListener('pointerdown', close, true);
    }
  };
  setTimeout(() => window.addEventListener('pointerdown', close, true), 0);
}
