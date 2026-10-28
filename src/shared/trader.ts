import { type ItemStack, itemDef, stackValue } from './items';
import type { TraderId } from './progression';

export interface Offer {
  item: string;
  trader: TraderId;
  ll: number;
  /** Stückzahl pro Kauf (Munition) */
  n: number;
  price: number;
  quest?: string;
}

const MARKUP = 1.15;

function o(item: string, trader: TraderId, ll: number, n = 1, opts: { mult?: number; quest?: string } = {}): Offer {
  const d = itemDef(item);
  const price = Math.round((d.value * n * MARKUP * (opts.mult ?? 1)) / 10) * 10;
  return { item, trader, ll, n, price, quest: opts.quest };
}

export const OFFERS: Offer[] = [
  // Major Brandt – Waffen
  o('pm9', 'brandt', 1),
  o('mp133', 'brandt', 1),
  o('sks', 'brandt', 1),
  o('p17', 'brandt', 2),
  o('mp9k', 'brandt', 2),
  o('akm', 'brandt', 2),
  o('m700', 'brandt', 3),
  o('m4a1', 'brandt', 3, 1, { quest: 'q_pmc1' }),
  o('saiga', 'brandt', 3),
  o('vektor', 'brandt', 3),
  o('sr25', 'brandt', 4),
  o('m249', 'brandt', 4, 1, { quest: 'q_boss1' }),
  // Munition
  o('a9_fmj', 'brandt', 1, 60),
  o('a9_hp', 'brandt', 1, 60),
  o('a9_ap', 'brandt', 3, 60),
  o('a762_ps', 'brandt', 1, 60),
  o('a762_hp', 'brandt', 2, 60),
  o('a762_bp', 'brandt', 3, 60),
  o('a556_fmj', 'brandt', 2, 60),
  o('a556_sp', 'brandt', 2, 60),
  o('a556_ap', 'brandt', 4, 60),
  o('a308_fmj', 'brandt', 2, 40),
  o('a308_ap', 'brandt', 4, 40),
  o('a12_buck', 'brandt', 1, 30),
  o('a12_slug', 'brandt', 2, 30),
  o('a12_ap', 'brandt', 3, 30),
  // Schutz
  o('vest_police', 'brandt', 1),
  o('vest_light', 'brandt', 2),
  o('vest_plate', 'brandt', 3),
  o('vest_gen4', 'brandt', 4),
  o('helm_work', 'brandt', 1),
  o('helm_ssh', 'brandt', 2),
  o('helm_ops', 'brandt', 3),
  o('helm_altyn', 'brandt', 4),
  o('frag', 'brandt', 2),
  // Dr. Weiss
  o('bandage', 'weiss', 1),
  o('ai2', 'weiss', 1),
  o('ifak', 'weiss', 2, 1, { quest: 'q_med1' }),
  o('stim', 'weiss', 3),
  o('surgkit', 'weiss', 3),
  o('selfrevive', 'weiss', 4),
  // Kowalski
  o('bp_sling', 'kowalski', 1),
  o('bp_tac', 'kowalski', 2),
  o('bp_assault', 'kowalski', 3),
  o('bp_expedition', 'kowalski', 4),
  o('key_sewer', 'kowalski', 3, 1, { mult: 1.6 }),
  o('key_pharmacy', 'kowalski', 3, 1, { mult: 1.6 }),
  o('key_office', 'kowalski', 3, 1, { mult: 1.6 }),
  o('key_harbor', 'kowalski', 3, 1, { mult: 1.6 }),
];

/** Verkaufspreis eines Gegenstands (Händler-Basisquote 50 % + Bonus). */
export function sellPrice(it: ItemStack, bonus: number): number {
  const d = itemDef(it.id);
  if (d.cat === 'cash') return it.n;
  const rate = 0.5 + bonus + (d.cat === 'valuable' || d.cat === 'barter' ? 0.05 : 0);
  return Math.max(1, Math.round(stackValue(it) * rate));
}

/** Reparaturkosten für Panzerung (pro fehlendem Haltbarkeitspunkt). */
export function repairCost(it: ItemStack): number {
  const d = itemDef(it.id) as { dur?: number; value: number };
  if (!d.dur || it.dur === undefined) return 0;
  const missing = d.dur - it.dur;
  if (missing <= 0.5) return 0;
  return Math.round(((missing / d.dur) * d.value * 0.4) / 10) * 10;
}
