import { BASE_POCKET_CAP } from './constants';
import {
  type ItemDef,
  type ItemStack,
  type WeaponDef,
  createItem,
  isArmor,
  isBackpack,
  isWeapon,
  itemDef,
  makeUid,
  stackSlots,
  stackValue,
  stackWeight,
} from './items';

export type EquipSlot = 'primary' | 'secondary' | 'helmet' | 'armor' | 'backpack';
export const EQUIP_SLOTS: EquipSlot[] = ['primary', 'secondary', 'helmet', 'armor', 'backpack'];
export const SLOT_NAMES: Record<EquipSlot, string> = {
  primary: 'Hauptwaffe',
  secondary: 'Seitenwaffe',
  helmet: 'Helm',
  armor: 'Schutzweste',
  backpack: 'Rucksack',
};

export interface Inventory {
  equip: Partial<Record<EquipSlot, ItemStack>>;
  /** Taschen + Rucksack */
  bag: ItemStack[];
  /** Sicherer Behälter – bleibt beim Tod erhalten */
  secure: ItemStack[];
  secureCap: number;
}

export type ListName = 'bag' | 'secure';

export function emptyInventory(secureCap = 2): Inventory {
  return { equip: {}, bag: [], secure: [], secureCap };
}

export function cloneItem(it: ItemStack): ItemStack {
  return { ...it };
}
export function cloneInventory(inv: Inventory): Inventory {
  const equip: Inventory['equip'] = {};
  for (const s of EQUIP_SLOTS) if (inv.equip[s]) equip[s] = cloneItem(inv.equip[s]!);
  return { equip, bag: inv.bag.map(cloneItem), secure: inv.secure.map(cloneItem), secureCap: inv.secureCap };
}

export function slotsUsed(list: readonly ItemStack[]): number {
  let s = 0;
  for (const it of list) s += stackSlots(it);
  return s;
}

export function bagCapacity(inv: Inventory): number {
  const bp = inv.equip.backpack;
  let cap = BASE_POCKET_CAP;
  if (bp) {
    const d = itemDef(bp.id);
    if (isBackpack(d)) cap += d.cap;
  }
  return cap;
}

export function listCapacity(inv: Inventory, list: ListName): number {
  return list === 'bag' ? bagCapacity(inv) : inv.secureCap;
}

const isStackable = (d: ItemDef) => d.stack > 1;

/**
 * Wie viele Stück eines Stapels passen zusätzlich in eine Liste?
 * Berücksichtigt das Zusammenführen mit vorhandenen Stapeln.
 */
export function fitAmount(list: readonly ItemStack[], cap: number, item: ItemStack): number {
  const d = itemDef(item.id);
  const used = slotsUsed(list);
  const free = cap - used;
  if (!isStackable(d)) return stackSlots(item) <= free ? item.n : 0;
  const existing = list.find((x) => x.id === item.id);
  const cur = existing ? existing.n : 0;
  const curSlots = existing ? stackSlots(existing) : 0;
  // maximal zulässige Gesamtmenge für (curSlots + free) Einheiten
  const maxUnits = Math.floor((curSlots + free) / d.size);
  const maxTotal = maxUnits * d.stack;
  return Math.max(0, Math.min(item.n, maxTotal - cur));
}

/** Fügt (Teile) eines Stapels hinzu. Gibt die Anzahl zurück, die NICHT gepasst hat. */
export function addToList(list: ItemStack[], cap: number, item: ItemStack): number {
  const fit = fitAmount(list, cap, item);
  if (fit <= 0) return item.n;
  const d = itemDef(item.id);
  if (isStackable(d)) {
    const existing = list.find((x) => x.id === item.id);
    if (existing) existing.n += fit;
    else list.push({ ...item, n: fit, uid: fit === item.n ? item.uid : makeUid() });
  } else {
    list.push(item);
  }
  return item.n - fit;
}

/** Fügt ohne Kapazitätsprüfung hinzu (für Lager-Import etc.). */
export function addUnchecked(list: ItemStack[], item: ItemStack): void {
  const d = itemDef(item.id);
  if (isStackable(d)) {
    const existing = list.find((x) => x.id === item.id);
    if (existing) {
      existing.n += item.n;
      return;
    }
  }
  list.push(item);
}

export interface FoundItem {
  item: ItemStack;
  where: 'equip' | ListName;
  slot?: EquipSlot;
  index?: number;
}

export function findItem(inv: Inventory, uid: string): FoundItem | undefined {
  for (const s of EQUIP_SLOTS) {
    const it = inv.equip[s];
    if (it && it.uid === uid) return { item: it, where: 'equip', slot: s };
  }
  for (const where of ['bag', 'secure'] as const) {
    const i = inv[where].findIndex((x) => x.uid === uid);
    if (i >= 0) return { item: inv[where][i], where, index: i };
  }
  return undefined;
}

/** Entfernt (Teile) eines Gegenstands. Gibt die entnommene Instanz zurück. */
export function takeFromInventory(inv: Inventory, uid: string, n?: number): ItemStack | undefined {
  const f = findItem(inv, uid);
  if (!f) return undefined;
  if (f.where === 'equip') {
    if (f.slot === 'backpack' && slotsUsed(inv.bag) > BASE_POCKET_CAP) return undefined;
    delete inv.equip[f.slot!];
    return f.item;
  }
  return takeFromList(inv[f.where], uid, n);
}

export function takeFromList(list: ItemStack[], uid: string, n?: number): ItemStack | undefined {
  const i = list.findIndex((x) => x.uid === uid);
  if (i < 0) return undefined;
  const it = list[i];
  if (n === undefined || n >= it.n) {
    list.splice(i, 1);
    return it;
  }
  if (n <= 0) return undefined;
  it.n -= n;
  return { ...it, n, uid: makeUid() };
}

export function allItems(inv: Inventory): ItemStack[] {
  const out: ItemStack[] = [];
  for (const s of EQUIP_SLOTS) if (inv.equip[s]) out.push(inv.equip[s]!);
  out.push(...inv.bag, ...inv.secure);
  return out;
}

export function inventoryWeight(inv: Inventory): number {
  let w = 0;
  for (const it of allItems(inv)) w += stackWeight(it);
  return w;
}

export function inventoryValue(inv: Inventory): number {
  let v = 0;
  for (const it of allItems(inv)) v += stackValue(it);
  return v;
}

export function listValue(list: readonly ItemStack[]): number {
  let v = 0;
  for (const it of list) v += stackValue(it);
  return v;
}

export function countItem(inv: Inventory, id: string, lists: ListName[] = ['bag', 'secure']): number {
  let n = 0;
  for (const l of lists) for (const it of inv[l]) if (it.id === id) n += it.n;
  return n;
}

export function hasKey(inv: Inventory, keyId: string): boolean {
  return allItems(inv).some((it) => {
    const d = itemDef(it.id);
    return d.cat === 'key' && (d as { keyId: string }).keyId === keyId;
  });
}

/** Verbraucht n Stück einer Sorte aus Tasche/Behälter. Gibt verbrauchte Menge zurück. */
export function consumeItem(inv: Inventory, id: string, n: number, lists: ListName[] = ['bag', 'secure']): number {
  let left = n;
  for (const l of lists) {
    const list = inv[l];
    for (let i = list.length - 1; i >= 0 && left > 0; i--) {
      const it = list[i];
      if (it.id !== id) continue;
      const take = Math.min(left, it.n);
      it.n -= take;
      left -= take;
      if (it.n <= 0) list.splice(i, 1);
    }
  }
  return n - left;
}

export function slotForDef(d: ItemDef): EquipSlot | undefined {
  if (isWeapon(d)) return (d as WeaponDef).slot;
  if (d.cat === 'armor') return 'armor';
  if (d.cat === 'helmet') return 'helmet';
  if (isBackpack(d)) return 'backpack';
  return undefined;
}

/**
 * Rüstet einen Gegenstand aus der Tasche/dem Behälter aus.
 * Bereits ausgerüstetes wandert in die Tasche (falls Platz).
 */
export function equipFromList(inv: Inventory, uid: string): { ok: boolean; reason?: string } {
  const f = findItem(inv, uid);
  if (!f || f.where === 'equip') return { ok: false, reason: 'Nicht gefunden' };
  const d = itemDef(f.item.id);
  const slot = slotForDef(d);
  if (!slot) return { ok: false, reason: 'Nicht ausrüstbar' };
  const old = inv.equip[slot];
  // Probe: Gegenstand aus Liste nehmen, alten hineinlegen
  const trial = cloneInventory(inv);
  takeFromList(trial[f.where], uid);
  trial.equip[slot] = f.item;
  if (old) {
    if (slot === 'backpack') {
      // alter Rucksack muss in neue Tasche passen
      if (addToList(trial.bag, bagCapacity(trial), old) > 0) return { ok: false, reason: 'Kein Platz für alten Rucksack' };
    } else if (addToList(trial[f.where], listCapacity(trial, f.where), old) > 0 && addToList(trial.bag, bagCapacity(trial), old) > 0) {
      return { ok: false, reason: 'Kein Platz für ' + itemDef(old.id).name };
    }
  }
  if (slotsUsed(trial.bag) > bagCapacity(trial)) return { ok: false, reason: 'Rucksack zu klein für Inhalt' };
  inv.equip = trial.equip;
  inv.bag = trial.bag;
  inv.secure = trial.secure;
  return { ok: true };
}

/** Legt einen ausgerüsteten Gegenstand in die Tasche. */
export function unequipToBag(inv: Inventory, slot: EquipSlot): { ok: boolean; reason?: string } {
  const it = inv.equip[slot];
  if (!it) return { ok: false };
  const trial = cloneInventory(inv);
  delete trial.equip[slot];
  if (slotsUsed(trial.bag) > bagCapacity(trial)) return { ok: false, reason: 'Rucksack ist nicht leer genug' };
  if (addToList(trial.bag, bagCapacity(trial), cloneItem(it)) > 0) return { ok: false, reason: 'Kein Platz' };
  inv.equip = trial.equip;
  inv.bag = trial.bag;
  return { ok: true };
}

/** Prüft, ob ein Gegenstand von außen in ein Inventar passt (Ausrüsten bevorzugt, falls frei). */
export function autoPlace(inv: Inventory, item: ItemStack, preferEquip = true): number {
  const d = itemDef(item.id);
  const slot = slotForDef(d);
  if (preferEquip && slot && !inv.equip[slot]) {
    inv.equip[slot] = item;
    return 0;
  }
  return addToList(inv.bag, bagCapacity(inv), item);
}

/** Startausrüstung für neue Profile. */
export function starterInventory(secureCap: number): Inventory {
  const inv = emptyInventory(secureCap);
  inv.equip.secondary = createItem('pm9');
  inv.equip.primary = createItem('mp133', 1, { ammo: 'a12_buck' });
  inv.equip.backpack = createItem('bp_sling');
  inv.bag.push(createItem('a9_fmj', 36), createItem('a12_buck', 18), createItem('bandage', 2), createItem('ai2', 1));
  return inv;
}

export function armorClassOf(it: ItemStack | undefined): number {
  if (!it) return 0;
  const d = itemDef(it.id);
  return isArmor(d) ? d.cls : 0;
}
