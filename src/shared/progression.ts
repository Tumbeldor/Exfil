/** Level, Erfahrung, Händler-Loyalität und Versteck-Ausbau. */

export const MAX_LEVEL = 40;

/** Kumulierte XP, die für Level n benötigt werden (Index = Level). */
export const XP_TABLE: number[] = (() => {
  const t = [0, 0];
  for (let n = 2; n <= MAX_LEVEL; n++) t[n] = t[n - 1] + Math.round((1000 * Math.pow(1.14, n - 2)) / 50) * 50;
  return t;
})();

export function levelForXp(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= XP_TABLE[l + 1]) l++;
  return l;
}

export function levelProgress(xp: number): { level: number; cur: number; need: number; frac: number } {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return { level, cur: 0, need: 0, frac: 1 };
  const cur = xp - XP_TABLE[level];
  const need = XP_TABLE[level + 1] - XP_TABLE[level];
  return { level, cur, need, frac: cur / need };
}

export type TraderId = 'brandt' | 'weiss' | 'kowalski';

export interface TraderDef {
  id: TraderId;
  name: string;
  title: string;
  desc: string;
  color: string;
}

export const TRADERS: TraderDef[] = [
  { id: 'brandt', name: 'Major Brandt', title: 'Waffen & Schutzausrüstung', desc: 'Ex-Offizier mit Zugang zu Militärdepots. Verkauft Waffen, Munition und Panzerung.', color: '#7a8f5a' },
  { id: 'weiss', name: 'Dr. Weiss', title: 'Medizin', desc: 'Ärztin im Feldlazarett. Medizin, Stimulanzien und Notfallausrüstung.', color: '#5a8f8a' },
  { id: 'kowalski', name: 'Kowalski', title: 'Hehler', desc: 'Kauft alles, verkauft Rucksäcke und Schlüssel. Keine Fragen.', color: '#8f6f5a' },
];

/** Loyalitätsstufe abhängig vom Spielerlevel. */
export const LL_LEVELS = [0, 1, 5, 10, 16];
export function loyaltyFor(level: number): number {
  let ll = 1;
  for (let i = 1; i < LL_LEVELS.length; i++) if (level >= LL_LEVELS[i]) ll = i;
  return ll;
}

export type UpgradeId = 'vault' | 'secure' | 'medbay' | 'trader';

export interface UpgradeLevel {
  level: number;
  cost: number;
  items: { id: string; n: number }[];
  value: number;
  text: string;
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: string;
  levels: UpgradeLevel[];
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'vault',
    name: 'Lagerraum',
    desc: 'Mehr Platz für Beute und Ausrüstung im Lager.',
    levels: [
      { level: 1, cost: 0, items: [], value: 120, text: '120 Einheiten' },
      { level: 3, cost: 35000, items: [{ id: 'toolset', n: 1 }, { id: 'bolts', n: 2 }], value: 180, text: '180 Einheiten' },
      { level: 7, cost: 110000, items: [{ id: 'toolset', n: 2 }, { id: 'wires', n: 3 }], value: 260, text: '260 Einheiten' },
      { level: 12, cost: 280000, items: [{ id: 'battery', n: 1 }, { id: 'circuit', n: 2 }], value: 360, text: '360 Einheiten' },
      { level: 18, cost: 600000, items: [{ id: 'gpu', n: 1 }], value: 480, text: '480 Einheiten' },
    ],
  },
  {
    id: 'secure',
    name: 'Sicherer Behälter',
    desc: 'Inhalt bleibt beim Tod erhalten.',
    levels: [
      { level: 1, cost: 0, items: [], value: 2, text: '2 Einheiten' },
      { level: 4, cost: 60000, items: [{ id: 'intel', n: 1 }], value: 4, text: '4 Einheiten' },
      { level: 9, cost: 175000, items: [{ id: 'intel', n: 2 }, { id: 'chain', n: 2 }], value: 6, text: '6 Einheiten' },
      { level: 15, cost: 450000, items: [{ id: 'milbat', n: 1 }, { id: 'wallet', n: 1 }], value: 9, text: '9 Einheiten' },
      { level: 22, cost: 900000, items: [{ id: 'goldbar', n: 1 }, { id: 'spectro', n: 1 }], value: 12, text: '12 Einheiten' },
    ],
  },
  {
    id: 'medbay',
    name: 'Sanitätsraum',
    desc: 'Natürliche Regeneration im Raid, wenn du 8 s keinen Schaden nimmst.',
    levels: [
      { level: 1, cost: 0, items: [], value: 0, text: 'Keine Regeneration' },
      { level: 3, cost: 30000, items: [{ id: 'medsupply', n: 2 }], value: 0.25, text: '+0,25 HP/s' },
      { level: 8, cost: 95000, items: [{ id: 'medsupply', n: 3 }, { id: 'defib', n: 1 }], value: 0.5, text: '+0,5 HP/s' },
      { level: 14, cost: 250000, items: [{ id: 'defib', n: 2 }], value: 0.8, text: '+0,8 HP/s' },
    ],
  },
  {
    id: 'trader',
    name: 'Händlernetz',
    desc: 'Bessere Verkaufspreise bei allen Händlern.',
    levels: [
      { level: 1, cost: 0, items: [], value: 0, text: '50 % des Werts' },
      { level: 2, cost: 20000, items: [{ id: 'cigs', n: 3 }, { id: 'vodka', n: 2 }], value: 0.05, text: '55 % des Werts' },
      { level: 6, cost: 70000, items: [{ id: 'chain', n: 1 }, { id: 'watch', n: 1 }], value: 0.1, text: '60 % des Werts' },
      { level: 11, cost: 200000, items: [{ id: 'wallet', n: 1 }], value: 0.15, text: '65 % des Werts' },
    ],
  },
];

export function upgradeDef(id: UpgradeId) {
  return UPGRADES.find((u) => u.id === id)!;
}

export function upgradeValue(id: UpgradeId, lvl: number): number {
  const d = upgradeDef(id);
  return d.levels[Math.max(0, Math.min(d.levels.length - 1, lvl - 1))].value;
}
