import { emptyInventory, type Inventory, addToList, bagCapacity } from './inventory';
import {
  ALL_ITEMS,
  type ItemCat,
  type ItemDef,
  type ItemStack,
  type WeaponDef,
  ammoForCaliber,
  createItem,
  isArmor,
  isWeapon,
  itemDef,
  weaponDef,
} from './items';
import type { ContainerKind } from './map/GameMap';
import type { Rng } from './rng';

interface Table {
  rolls: [number, number];
  cats: Partial<Record<ItemCat, number>>;
  /** Zusätzliche Gewichte für bestimmte Gegenstände */
  items?: Record<string, number>;
  /** nur diese Gegenstände erlauben */
  only?: string[];
}

const TABLES: Partial<Record<ContainerKind, Table>> = {
  crate: { rolls: [1, 3], cats: { barter: 5, ammo: 2, med: 1, valuable: 0.4, cash: 1, grenade: 0.3, armor: 0.25, helmet: 0.25, backpack: 0.35, weapon: 0.2 } },
  weaponbox: { rolls: [1, 3], cats: { weapon: 5, ammo: 3, armor: 0.8, helmet: 0.8, grenade: 1 } },
  ammobox: { rolls: [2, 4], cats: { ammo: 8, grenade: 1 } },
  medcase: { rolls: [1, 3], cats: { med: 8 }, items: { medsupply: 2, defib: 0.25, spectro: 0.05 } },
  toolbox: { rolls: [1, 3], cats: {}, only: ['toolset', 'bolts', 'wires', 'circuit', 'battery', 'fuel', 'radio', 'milbat'], items: { toolset: 3, bolts: 5, wires: 4, circuit: 3, battery: 1, fuel: 1, radio: 1, milbat: 0.2 } },
  filing: { rolls: [1, 3], cats: { cash: 3, key: 1, valuable: 0.8 }, items: { intel: 1.2, hdd: 1.5, cigs: 1 } },
  safe: { rolls: [2, 4], cats: { cash: 6, valuable: 4, key: 0.8 }, items: { intel: 1.5, goldbar: 0.6, wallet: 0.8 } },
  jacket: { rolls: [0, 2], cats: { cash: 3, key: 1, med: 1, ammo: 1 }, items: { cigs: 3, chain: 0.5 } },
  pc: { rolls: [1, 2], cats: {}, only: ['hdd', 'cpu', 'circuit', 'gpu', 'wires'], items: { hdd: 4, cpu: 2, circuit: 3, gpu: 0.35, wires: 2 } },
  shelf: { rolls: [1, 3], cats: { med: 0.8 }, items: { canned: 5, vodka: 3, cigs: 3, bolts: 1.5, wires: 1, gasmask: 1 } },
  desk: { rolls: [0, 2], cats: { cash: 2, key: 0.6, valuable: 0.6, ammo: 0.5 }, items: { cigs: 2, hdd: 1, intel: 0.3 } },
  register: { rolls: [1, 2], cats: { cash: 8, valuable: 0.5 } },
  duffle: { rolls: [1, 3], cats: { ammo: 2, med: 2, barter: 2, grenade: 0.5, armor: 0.4, helmet: 0.4, weapon: 0.35, cash: 1, backpack: 0.3 } },
  trunk: { rolls: [1, 2], cats: { ammo: 1, weapon: 0.2, cash: 1 }, items: { fuel: 3, battery: 2, toolset: 2, wires: 1 } },
  fridge: { rolls: [0, 2], cats: {}, only: ['canned', 'vodka', 'medsupply'], items: { canned: 5, vodka: 3, medsupply: 0.3 } },
};

/** Wahrscheinlichkeit, dass ein Behälter auf der Karte leer ist (nicht jeder Behälter lohnt sich). */
const EMPTY_CHANCE: Partial<Record<ContainerKind, number>> = {
  crate: 0.3,
  weaponbox: 0.25,
  ammobox: 0.25,
  medcase: 0.25,
  toolbox: 0.3,
  filing: 0.3,
  safe: 0.15,
  jacket: 0.25,
  pc: 0.3,
  shelf: 0.35,
  desk: 0.25,
  register: 0.35,
  duffle: 0.25,
  trunk: 0.35,
  fridge: 0.25,
};

function eligible(d: ItemDef, tier: number) {
  return d.rarity > 0 && d.tier <= tier + 1;
}

function weightFor(d: ItemDef, tier: number) {
  let w = d.rarity;
  if (d.tier > tier) w *= 0.2;
  if (d.tier >= 3) w *= 1 + (tier - 1) * 0.6;
  if (d.tier === 1 && tier >= 3) w *= 0.6;
  return w;
}

/** Erzeugt eine einzelne Beute-Instanz mit zufälligen Eigenschaften. */
export function rollItemInstance(d: ItemDef, rng: Rng, tier: number): ItemStack {
  if (d.cat === 'cash') {
    const n = Math.round(rng.range(150, 1400) * (1 + tier * 0.9) / 50) * 50;
    return createItem('cash', Math.max(50, n));
  }
  if (d.cat === 'ammo') {
    return createItem(d.id, rng.int(Math.ceil(d.stack * 0.2), d.stack));
  }
  if (isWeapon(d)) {
    const ammos = ammoForCaliber(d.caliber);
    const ammo = rng.chance(0.7) ? ammos[0] : rng.pick(ammos);
    const it = createItem(d.id, 1, { ammo: ammo.id });
    it.mag = rng.chance(0.4) ? 0 : rng.int(0, d.mag);
    return it;
  }
  if (isArmor(d)) {
    const it = createItem(d.id);
    it.dur = Math.max(1, Math.round(d.dur * rng.range(0.35, 1)));
    return it;
  }
  if (d.stack > 1) return createItem(d.id, rng.chance(0.75) ? 1 : rng.int(1, Math.min(3, d.stack)));
  return createItem(d.id);
}

const catTotals = new Map<string, number>();
function catWeight(cat: ItemCat, tier: number): number {
  const k = cat + tier;
  let v = catTotals.get(k);
  if (v === undefined) {
    v = ALL_ITEMS.filter((x) => x.cat === cat && eligible(x, tier)).reduce((s, x) => s + weightFor(x, tier), 0) || 1;
    catTotals.set(k, v);
  }
  return v;
}

export function rollContainer(kind: ContainerKind, tier: number, rng: Rng): ItemStack[] {
  const tb = TABLES[kind];
  if (!tb) return [];
  const out: ItemStack[] = [];
  let rolls = rng.int(tb.rolls[0], tb.rolls[1]);
  if (tier >= 3) rolls += rng.int(0, 1);
  if (tier >= 4) rolls += 1;
  const pool: { d: ItemDef; w: number }[] = [];
  for (const d of ALL_ITEMS) {
    if (tb.only && !tb.only.includes(d.id)) continue;
    if (!eligible(d, tier) && !(tb.items && tb.items[d.id])) continue;
    let w = 0;
    const cw = tb.cats[d.cat];
    if (cw) {
      // Kategoriegewicht auf Gegenstände der Kategorie verteilen
      const catTotal = catWeight(d.cat, tier);
      w += (cw * weightFor(d, tier)) / catTotal;
    }
    if (tb.items && tb.items[d.id]) w += tb.items[d.id] / 4;
    if (w > 0) pool.push({ d, w });
  }
  for (let i = 0; i < rolls; i++) {
    const p = rng.weighted(pool, (x) => x.w);
    if (!p) break;
    const it = rollItemInstance(p.d, rng, tier);
    const same = out.find((x) => x.id === it.id && itemDef(it.id).stack > 1);
    if (same) same.n += it.n;
    else out.push(it);
  }
  return out;
}

/** Behälter auf der Karte: kann leer sein, in gefährlichen Zonen (hohe Stufe) seltener. */
export function rollMapContainer(kind: ContainerKind, tier: number, rng: Rng): ItemStack[] {
  const empty = (EMPTY_CHANCE[kind] ?? 0) * (tier >= 3 ? 0.6 : 1);
  if (rng.chance(empty)) return [];
  return rollContainer(kind, tier, rng);
}

/** Lose Bodenbeute */
export function rollLooseLoot(tier: number, rng: Rng): ItemStack | undefined {
  const cats: Partial<Record<ItemCat, number>> = { barter: 5, ammo: 2, med: 2, valuable: 1, weapon: 0.4, grenade: 0.4, key: 0.4 };
  const pool = ALL_ITEMS.filter((d) => cats[d.cat] && eligible(d, tier));
  const d = rng.weighted(pool, (x) => (cats[x.cat] ?? 0) * weightFor(x, tier));
  return d ? rollItemInstance(d, rng, tier) : undefined;
}

export type BotType = 'scav' | 'pmc' | 'guard' | 'boss';

function wpick(rng: Rng, opts: Record<string, number>): string {
  const keys = Object.keys(opts);
  return rng.weighted(keys, (k) => opts[k]) ?? keys[0];
}

/** Ausrüstung für einen Bot. */
export function botLoadout(type: BotType, rng: Rng, bossWeapon?: string): Inventory {
  const inv = emptyInventory(0);
  const give = (id: string) => addToList(inv.bag, bagCapacity(inv) + 10, createItem(id));
  const loadWeapon = (id: string, better: number) => {
    const d = weaponDef(id);
    const ammos = ammoForCaliber(d.caliber);
    const ammo = rng.chance(better) ? ammos[Math.min(ammos.length - 1, rng.int(1, 2))] : ammos[0];
    const it = createItem(id, 1, { ammo: ammo.id });
    return { it, ammo: ammo.id, d };
  };
  const armor = (id: string | undefined, slot: 'armor' | 'helmet', worn: [number, number]) => {
    if (!id) return;
    const it = createItem(id);
    const d = itemDef(id);
    if (isArmor(d)) it.dur = Math.max(1, Math.round(d.dur * rng.range(worn[0], worn[1])));
    inv.equip[slot] = it;
  };
  let primary: { it: ItemStack; ammo: string; d: WeaponDef } | undefined;
  switch (type) {
    case 'scav': {
      if (rng.chance(0.8)) primary = loadWeapon(wpick(rng, { mp133: 3, sks: 3, mp9k: 2.5, akm: 1.2, saiga: 0.2 }), 0.15);
      inv.equip.secondary = loadWeapon(rng.chance(0.85) ? 'pm9' : 'p17', 0.1).it;
      if (rng.chance(0.4)) armor(wpick(rng, { vest_police: 3, vest_light: 1 }), 'armor', [0.3, 0.9]);
      if (rng.chance(0.45)) armor(wpick(rng, { helm_work: 3, helm_ssh: 1.5 }), 'helmet', [0.4, 1]);
      if (rng.chance(0.4)) inv.equip.backpack = createItem(wpick(rng, { bp_sling: 3, bp_tac: 1 }));
      if (rng.chance(0.45)) give(wpick(rng, { bandage: 3, ai2: 2 }));
      for (let i = rng.int(0, 2); i > 0; i--) {
        const l = rollContainer(rng.chance(0.5) ? 'jacket' : 'duffle', 1, rng);
        for (const it of l) addToList(inv.bag, bagCapacity(inv) + 10, it);
      }
      break;
    }
    case 'pmc':
    case 'guard': {
      const g = type === 'guard';
      primary = loadWeapon(wpick(rng, g ? { akm: 3, m4a1: 3, saiga: 1.5, sr25: 1, m249: 0.4 } : { m4a1: 2.5, akm: 3, vektor: 2, sr25: 1, saiga: 1, m700: 0.6, mp9k: 1.5, sks: 1 }), g ? 0.5 : 0.3);
      if (rng.chance(0.5)) inv.equip.secondary = loadWeapon('p17', 0.3).it;
      armor(wpick(rng, g ? { vest_plate: 4, vest_gen4: 1 } : { vest_police: 1.5, vest_light: 4, vest_plate: 2.5, vest_gen4: 0.4 }), 'armor', [0.45, 1]);
      if (rng.chance(0.8)) armor(wpick(rng, g ? { helm_ops: 3, helm_altyn: 0.6 } : { helm_ssh: 2, helm_ops: 3, helm_altyn: 0.3 }), 'helmet', [0.6, 1]);
      inv.equip.backpack = createItem(wpick(rng, { bp_tac: 3, bp_assault: 2, bp_expedition: 0.4 }));
      give(wpick(rng, { ifak: 2, ai2: 3 }));
      if (rng.chance(0.6)) give('bandage');
      if (rng.chance(0.5)) give('frag');
      if (rng.chance(0.15)) give('stim');
      for (let i = rng.int(1, 3); i > 0; i--) {
        const l = rollContainer(wpick(rng, { duffle: 3, safe: 0.4, filing: 1 }) as ContainerKind, 2, rng);
        for (const it of l) addToList(inv.bag, bagCapacity(inv) + 10, it);
      }
      break;
    }
    case 'boss': {
      primary = loadWeapon(bossWeapon ?? 'm249', 0.8);
      inv.equip.secondary = loadWeapon('p17', 0.5).it;
      armor(wpick(rng, { vest_gen4: 3, vest_heavy: 1 }), 'armor', [0.8, 1]);
      armor('helm_altyn', 'helmet', [0.8, 1]);
      inv.equip.backpack = createItem('bp_assault');
      give('ifak');
      give('surgkit');
      give('frag');
      if (rng.chance(0.65)) give(bossWeapon === 'saiga' ? 'card_vault' : 'card_bunker');
      for (let i = 0; i < 3; i++) for (const it of rollContainer('safe', 3, rng)) addToList(inv.bag, bagCapacity(inv) + 10, it);
      break;
    }
  }
  if (primary) {
    inv.equip.primary = primary.it;
    // Reservemunition für die Leiche
    addToList(inv.bag, bagCapacity(inv) + 10, createItem(primary.ammo, Math.round(primary.d.mag * rng.range(0.5, 1.5))));
  }
  const sec = inv.equip.secondary;
  if (sec && rng.chance(0.5)) addToList(inv.bag, bagCapacity(inv) + 10, createItem(sec.ammo!, rng.int(6, 20)));
  return inv;
}
