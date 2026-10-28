import {
  type EquipSlot,
  type Inventory,
  type ListName,
  EQUIP_SLOTS,
  addToList,
  addUnchecked,
  allItems,
  bagCapacity,
  cloneInventory,
  emptyInventory,
  equipFromList,
  fitAmount,
  listCapacity,
  slotForDef,
  slotsUsed,
  starterInventory,
  takeFromList,
} from './inventory';
import {
  type ItemStack,
  ammoForCaliber,
  createItem,
  hasItemDef,
  isArmor,
  isWeapon,
  itemDef,
  stackValue,
  weaponDef,
} from './items';
import { type BotType, botLoadout } from './loot';
import { Rng } from './rng';
import { type UpgradeId, MAX_LEVEL, UPGRADES, levelForXp, loyaltyFor, upgradeDef, upgradeValue } from './progression';
import { type QuestDef, QUESTS, objectiveGain, objectiveTarget } from './quests';
import type { RaidResult } from './sim/types';
import { type Offer, repairCost, sellPrice } from './trader';

export interface QuestState {
  progress: number[];
  claimed: boolean;
}

export interface ProfileStats {
  raids: number;
  extracts: number;
  deaths: number;
  mia: number;
  kills: Record<BotType, number>;
  lootValue: number;
  bestRaid: number;
  playTime: number;
  heliExtracts: number;
  headshots: number;
}

export interface Profile {
  v: 1;
  name: string;
  color: string;
  money: number;
  xp: number;
  vault: ItemStack[];
  char: Inventory;
  upgrades: Record<UpgradeId, number>;
  quests: Record<string, QuestState>;
  stats: ProfileStats;
  activeRaid: { mapId: string; started: number; coop: boolean; secure: ItemStack[]; insured?: ItemStack[]; scav?: boolean } | null;
  created: number;
  /** Zeitpunkt, ab dem der nächste Plünderer-Einsatz möglich ist */
  scavReadyAt: number;
}

export const SCAV_COOLDOWN_MS = 10 * 60 * 1000;
export const INSURABLE = new Set(['weapon', 'armor', 'helmet', 'backpack']);

export const PLAYER_COLORS = ['#7fb069', '#5aa9e6', '#e6b85a', '#e65a8a', '#a35ae6', '#5ae6c8'];

export function newProfile(name: string): Profile {
  const p: Profile = {
    v: 1,
    name: name || 'Operator',
    color: PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)],
    money: 25000,
    xp: 0,
    vault: [createItem('a9_fmj', 60), createItem('a12_buck', 30), createItem('bandage', 2), createItem('helm_work'), createItem('ai2', 1)],
    char: starterInventory(2),
    upgrades: { vault: 1, secure: 1, medbay: 1, trader: 1 },
    quests: {},
    stats: { raids: 0, extracts: 0, deaths: 0, mia: 0, kills: { scav: 0, pmc: 0, guard: 0, boss: 0 }, lootValue: 0, bestRaid: 0, playTime: 0, heliExtracts: 0, headshots: 0 },
    activeRaid: null,
    created: Date.now(),
    scavReadyAt: 0,
  };
  refreshQuests(p);
  return p;
}

/** Repariert/ergänzt geladene Profile (Migrationen, ungültige Gegenstände). */
export function normalizeProfile(raw: unknown): Profile {
  const base = newProfile('Operator');
  const p = { ...base, ...(raw as Partial<Profile>) } as Profile;
  p.upgrades = { ...base.upgrades, ...(p.upgrades ?? {}) };
  p.stats = { ...base.stats, ...(p.stats ?? {}), kills: { ...base.stats.kills, ...(p.stats?.kills ?? {}) } };
  p.quests = p.quests ?? {};
  const valid = (it: ItemStack | undefined) => !!it && typeof it.id === 'string' && hasItemDef(it.id) && it.n > 0;
  p.vault = (p.vault ?? []).filter(valid);
  const ch = p.char ?? emptyInventory();
  const equip: Inventory['equip'] = {};
  for (const s of EQUIP_SLOTS) if (valid(ch.equip?.[s])) equip[s] = ch.equip![s];
  p.char = { equip, bag: (ch.bag ?? []).filter(valid), secure: (ch.secure ?? []).filter(valid), secureCap: secureCap(p) };
  if (!Number.isFinite(p.money)) p.money = 0;
  if (!Number.isFinite(p.scavReadyAt)) p.scavReadyAt = 0;
  if (!Number.isFinite(p.xp)) p.xp = 0;
  refreshQuests(p);
  return p;
}

export const profileLevel = (p: Profile) => levelForXp(p.xp);
export const vaultCap = (p: Profile) => upgradeValue('vault', p.upgrades.vault);
export const secureCap = (p: Profile) => upgradeValue('secure', p.upgrades.secure);
export const regenRate = (p: Profile) => upgradeValue('medbay', p.upgrades.medbay);
export const sellBonus = (p: Profile) => upgradeValue('trader', p.upgrades.trader);
export const loyalty = (p: Profile) => loyaltyFor(profileLevel(p));

// ------------------------------------------------------------------
// Aufträge
// ------------------------------------------------------------------
export type QuestStatus = 'locked' | 'active' | 'complete' | 'claimed';

export function questStatus(p: Profile, q: QuestDef): QuestStatus {
  const st = p.quests[q.id];
  if (st?.claimed) return 'claimed';
  if (!st) return 'locked';
  return q.objectives.every((o, i) => (st.progress[i] ?? 0) >= objectiveTarget(o)) ? 'complete' : 'active';
}

export function questAvailable(p: Profile, q: QuestDef): boolean {
  if (profileLevel(p) < q.level) return false;
  return (q.prereq ?? []).every((id) => p.quests[id]?.claimed);
}

/** Schaltet verfügbare Aufträge frei. */
export function refreshQuests(p: Profile) {
  for (const q of QUESTS) {
    if (!p.quests[q.id] && questAvailable(p, q)) p.quests[q.id] = { progress: q.objectives.map(() => 0), claimed: false };
  }
}

export function questDone(p: Profile, id: string) {
  return !!p.quests[id]?.claimed;
}

export function claimQuest(p: Profile, id: string): { ok: boolean; text: string } {
  const q = QUESTS.find((x) => x.id === id);
  if (!q || questStatus(p, q) !== 'complete') return { ok: false, text: 'Auftrag nicht abgeschlossen.' };
  const st = p.quests[id];
  st.claimed = true;
  p.money += q.rewards.money;
  p.xp += q.rewards.xp;
  for (const r of q.rewards.items ?? []) addUnchecked(p.vault, createItem(r.id, r.n));
  refreshQuests(p);
  return { ok: true, text: `${q.title} abgeschlossen: +${q.rewards.money.toLocaleString('de-DE')} €, +${q.rewards.xp} XP` };
}

/** Übergabe von Gegenständen aus Lager/Tasche für ein Auftragsziel. */
export function handover(p: Profile, id: string, objIndex: number): { ok: boolean; text: string } {
  const q = QUESTS.find((x) => x.id === id);
  const st = p.quests[id];
  if (!q || !st || st.claimed) return { ok: false, text: 'Nicht verfügbar.' };
  const o = q.objectives[objIndex];
  if (!o || o.type !== 'handover') return { ok: false, text: 'Kein Übergabeziel.' };
  const need = o.count - (st.progress[objIndex] ?? 0);
  if (need <= 0) return { ok: false, text: 'Bereits erfüllt.' };
  let given = 0;
  for (const list of [p.vault, p.char.bag, p.char.secure]) {
    for (let i = list.length - 1; i >= 0 && given < need; i--) {
      const it = list[i];
      if (it.id !== o.item) continue;
      const take = Math.min(it.n, need - given);
      it.n -= take;
      given += take;
      if (it.n <= 0) list.splice(i, 1);
    }
  }
  if (!given) return { ok: false, text: `Du hast kein(e) ${itemDef(o.item).name}.` };
  st.progress[objIndex] = (st.progress[objIndex] ?? 0) + given;
  return { ok: true, text: `${given}× ${itemDef(o.item).name} übergeben.` };
}

// ------------------------------------------------------------------
// Raids
// ------------------------------------------------------------------
export function beginRaid(p: Profile, mapId: string, coop: boolean, scav = false): Inventory {
  if (scav) {
    p.activeRaid = { mapId, started: Date.now(), coop, secure: [], scav: true };
    p.scavReadyAt = Date.now() + SCAV_COOLDOWN_MS;
    return scavKit();
  }
  p.char.secureCap = secureCap(p);
  const insured = [...Object.values(p.char.equip), ...p.char.bag].filter((x): x is ItemStack => !!x && !!x.ins).map((x) => ({ ...x }));
  p.activeRaid = { mapId, started: Date.now(), coop, secure: p.char.secure.map((x) => ({ ...x })), insured };
  return cloneInventory(p.char);
}

/** Zufällige Gratis-Ausrüstung für einen Plünderer-Einsatz. */
export function scavKit(seed = Math.floor(Math.random() * 2 ** 31)): Inventory {
  const rng = new Rng(seed);
  const inv = botLoadout('scav', rng);
  inv.secureCap = 0;
  if (!inv.equip.secondary && !inv.equip.primary) inv.equip.secondary = createItem('pm9');
  // genug Reservemunition für alle Waffen
  for (const s of ['primary', 'secondary'] as const) {
    const w = inv.equip[s];
    if (w) addUnchecked(inv.bag, createItem(w.ammo ?? ammoForCaliber(weaponDef(w.id).caliber)[0].id, weaponDef(w.id).mag * 2));
  }
  if (!inv.bag.some((x) => itemDef(x.id).cat === 'med')) addUnchecked(inv.bag, createItem('bandage', 1));
  return inv;
}

export function scavReadyIn(p: Profile): number {
  return Math.max(0, p.scavReadyAt - Date.now());
}

export function insuranceCost(it: ItemStack): number {
  return Math.max(300, Math.round((stackValue(it) * 0.18) / 10) * 10);
}

export function insureItem(p: Profile, uid: string): { ok: boolean; text?: string } {
  const loc = locate(p, uid);
  if (!loc) return { ok: false };
  if (!INSURABLE.has(itemDef(loc.item.id).cat)) return { ok: false, text: 'Nur Waffen und Schutzausrüstung sind versicherbar.' };
  if (loc.item.ins) return { ok: false, text: 'Bereits versichert.' };
  const cost = insuranceCost(loc.item);
  if (p.money < cost) return { ok: false, text: 'Nicht genug Geld.' };
  p.money -= cost;
  loc.item.ins = true;
  return { ok: true, text: `Versichert für ${cost.toLocaleString('de-DE')} €. Geht beim Tod nicht verloren (einmalig).` };
}

function returnInsured(p: Profile, items: ItemStack[] | undefined): number {
  let n = 0;
  for (const it of items ?? []) {
    const back = { ...it, ins: false };
    if (back.mag) back.mag = 0;
    addUnchecked(p.vault, back);
    n++;
  }
  return n;
}

/** Raid wurde abgebrochen (Seite neu geladen, Verbindung verloren): wie Tod, nur sicherer Behälter bleibt. */
export function abandonRaid(p: Profile): boolean {
  if (!p.activeRaid) return false;
  const ar = p.activeRaid;
  p.stats.raids++;
  p.stats.mia++;
  p.activeRaid = null;
  if (ar.scav) return true;
  const inv = emptyInventory(secureCap(p));
  inv.secure = ar.secure;
  p.char = inv;
  returnInsured(p, ar.insured);
  return true;
}

export interface QuestProgressNote {
  quest: string;
  text: string;
  from: number;
  to: number;
  target: number;
}

export interface RaidReport {
  status: RaidResult['status'];
  scav: boolean;
  insured: number;
  xp: number;
  levelBefore: number;
  levelAfter: number;
  cash: number;
  quests: QuestProgressNote[];
  lootValue: number;
  kitLost: number;
}

export function applyRaidResult(p: Profile, r: RaidResult): RaidReport {
  const levelBefore = profileLevel(p);
  const inv = cloneInventory(r.inventory);
  let cash = 0;
  for (const l of ['bag', 'secure'] as ListName[]) {
    inv[l] = inv[l].filter((it) => {
      if (it.id === 'cash') {
        cash += it.n;
        return false;
      }
      return hasItemDef(it.id);
    });
  }
  inv.secureCap = secureCap(p);
  const scav = !!r.scav || !!p.activeRaid?.scav;
  const kitLost = r.status === 'extracted' || scav ? 0 : r.stats.startValue;
  let insured = 0;
  if (scav) {
    // Plünderer-Beute wandert direkt ins Lager, die eigene Ausrüstung bleibt unberührt
    if (r.status === 'extracted') for (const it of [...Object.values(inv.equip), ...inv.bag, ...inv.secure]) if (it) addUnchecked(p.vault, { ...it, ins: false });
  } else {
    p.char = inv;
    if (r.status !== 'extracted') insured = returnInsured(p, p.activeRaid?.insured);
  }
  p.money += cash;
  p.xp += r.xp.total;
  const s = p.stats;
  s.raids++;
  s.playTime += r.time;
  if (r.status === 'extracted') {
    s.extracts++;
    const gained = Math.max(0, r.endValue + cash - r.stats.startValue);
    s.lootValue += gained;
    s.bestRaid = Math.max(s.bestRaid, gained);
    if (r.extractId === 'heli') s.heliExtracts++;
  } else if (r.status === 'killed') s.deaths++;
  else s.mia++;
  for (const k of r.stats.killLog) {
    s.kills[k.type as BotType] = (s.kills[k.type as BotType] ?? 0) + 1;
    if (k.head) s.headshots++;
  }
  // Aufträge
  const notes: QuestProgressNote[] = [];
  for (const q of QUESTS) {
    const st = p.quests[q.id];
    if (!st || st.claimed) continue;
    q.objectives.forEach((o, i) => {
      const target = objectiveTarget(o);
      const from = st.progress[i] ?? 0;
      if (from >= target) return;
      const gain = objectiveGain(o, r);
      if (gain <= 0) return;
      const to = Math.min(target, from + gain);
      st.progress[i] = to;
      notes.push({ quest: q.title, text: o.text, from, to, target });
    });
  }
  p.activeRaid = null;
  refreshQuests(p);
  return {
    status: r.status,
    scav,
    insured,
    xp: r.xp.total,
    levelBefore,
    levelAfter: profileLevel(p),
    cash,
    quests: notes,
    lootValue: r.endValue + cash,
    kitLost,
  };
}

// ------------------------------------------------------------------
// Lager & Ausrüstung
// ------------------------------------------------------------------
export type Where = 'vault' | 'equip' | 'bag' | 'secure';

export interface Located {
  where: Where;
  item: ItemStack;
  slot?: EquipSlot;
}

export function locate(p: Profile, uid: string): Located | undefined {
  for (const s of EQUIP_SLOTS) {
    const it = p.char.equip[s];
    if (it?.uid === uid) return { where: 'equip', item: it, slot: s };
  }
  for (const w of ['bag', 'secure'] as const) {
    const it = p.char[w].find((x) => x.uid === uid);
    if (it) return { where: w, item: it };
  }
  const it = p.vault.find((x) => x.uid === uid);
  if (it) return { where: 'vault', item: it };
  return undefined;
}

type R = { ok: boolean; text?: string };

function removeLocated(p: Profile, loc: Located, n?: number): ItemStack | undefined {
  if (loc.where === 'equip') {
    if (loc.slot === 'backpack' && slotsUsed(p.char.bag) > bagCapacity({ ...p.char, equip: { ...p.char.equip, backpack: undefined } })) return undefined;
    delete p.char.equip[loc.slot!];
    return loc.item;
  }
  const list = loc.where === 'vault' ? p.vault : p.char[loc.where];
  return takeFromList(list, loc.item.uid, n);
}

/** Verschiebt einen Gegenstand an ein Ziel (Lager, Tasche, sicherer Behälter oder ausrüsten). */
export function moveItem(p: Profile, uid: string, to: Where, n?: number): R {
  const loc = locate(p, uid);
  if (!loc) return { ok: false, text: 'Nicht gefunden.' };
  if (loc.where === to && to !== 'equip') return { ok: true };
  if (to === 'equip') {
    const d = itemDef(loc.item.id);
    const slot = slotForDef(d);
    if (!slot) return { ok: false, text: 'Nicht ausrüstbar.' };
    if (loc.where === 'bag' || loc.where === 'secure') {
      const r = equipFromList(p.char, uid);
      return { ok: r.ok, text: r.reason };
    }
    if (loc.where !== 'vault') return { ok: true };
    // aus dem Lager: alten Gegenstand ins Lager
    const old = p.char.equip[slot];
    const trialEquip = { ...p.char.equip, [slot]: loc.item };
    if (slot === 'backpack' && slotsUsed(p.char.bag) > bagCapacity({ ...p.char, equip: trialEquip })) return { ok: false, text: 'Neuer Rucksack ist zu klein für den Inhalt.' };
    if (old && fitAmount(p.vault.filter((x) => x.uid !== uid), vaultCap(p), old) < old.n) return { ok: false, text: 'Lager voll.' };
    takeFromList(p.vault, uid);
    p.char.equip[slot] = loc.item;
    if (old) addUnchecked(p.vault, old);
    return { ok: true };
  }
  const targetList = to === 'vault' ? p.vault : p.char[to];
  const cap = to === 'vault' ? vaultCap(p) : listCapacity(p.char, to);
  const amount = n ?? loc.item.n;
  const fit = fitAmount(targetList, cap, { ...loc.item, n: amount });
  if (fit <= 0) return { ok: false, text: to === 'vault' ? 'Lager voll.' : to === 'secure' ? 'Sicherer Behälter voll.' : 'Kein Platz in der Tasche.' };
  const it = removeLocated(p, loc, Math.min(fit, amount));
  if (!it) return { ok: false, text: 'Rucksack zuerst leeren.' };
  const left = addToList(targetList, cap, it);
  if (left > 0) addUnchecked(loc.where === 'vault' || loc.where === 'equip' ? p.vault : p.char[loc.where], { ...it, n: left, uid: it.uid + 'r' });
  return { ok: true, text: fit < amount ? 'Nur teilweise verschoben (Platz).' : undefined };
}

export function sellItem(p: Profile, uid: string, n?: number): R & { money?: number } {
  const loc = locate(p, uid);
  if (!loc) return { ok: false, text: 'Nicht gefunden.' };
  const it = removeLocated(p, loc, n);
  if (!it) return { ok: false, text: 'Rucksack zuerst leeren.' };
  const total = sellPrice(it, sellBonus(p));
  p.money += total;
  return { ok: true, money: total, text: `Verkauft für ${total.toLocaleString('de-DE')} €` };
}

export function offerUnlocked(p: Profile, o: Offer): boolean {
  return loyalty(p) >= o.ll && (!o.quest || questDone(p, o.quest));
}

export function buyOffer(p: Profile, o: Offer, count = 1): R {
  if (!offerUnlocked(p, o)) return { ok: false, text: 'Noch nicht freigeschaltet.' };
  const cost = o.price * count;
  if (p.money < cost) return { ok: false, text: 'Nicht genug Geld.' };
  const d = itemDef(o.item);
  const items: ItemStack[] = [];
  if (d.stack > 1) items.push(createItem(o.item, o.n * count));
  else for (let i = 0; i < count; i++) items.push(createItem(o.item, 1, { loaded: false }));
  const trial = p.vault.map((x) => ({ ...x }));
  for (const it of items) if (addToList(trial, vaultCap(p), { ...it }) > 0) return { ok: false, text: 'Lager voll.' };
  for (const it of items) addToList(p.vault, vaultCap(p), it);
  p.money -= cost;
  return { ok: true, text: `${d.name}${o.n > 1 ? ' ×' + o.n * count : count > 1 ? ' ×' + count : ''} gekauft.` };
}

export function buyUpgrade(p: Profile, id: UpgradeId): R {
  const d = upgradeDef(id);
  const cur = p.upgrades[id];
  const next = d.levels[cur];
  if (!next) return { ok: false, text: 'Maximal ausgebaut.' };
  if (profileLevel(p) < next.level) return { ok: false, text: `Benötigt Level ${next.level}.` };
  if (p.money < next.cost) return { ok: false, text: 'Nicht genug Geld.' };
  for (const req of next.items) if (countOwned(p, req.id) < req.n) return { ok: false, text: `Benötigt ${req.n}× ${itemDef(req.id).name}.` };
  for (const req of next.items) consumeOwned(p, req.id, req.n);
  p.money -= next.cost;
  p.upgrades[id] = cur + 1;
  if (id === 'secure') p.char.secureCap = secureCap(p);
  return { ok: true, text: `${d.name} auf Stufe ${cur + 1} ausgebaut.` };
}

export function countOwned(p: Profile, id: string): number {
  let n = 0;
  for (const it of [...p.vault, ...p.char.bag, ...p.char.secure]) if (it.id === id) n += it.n;
  return n;
}

function consumeOwned(p: Profile, id: string, n: number) {
  let left = n;
  for (const list of [p.vault, p.char.bag, p.char.secure]) {
    for (let i = list.length - 1; i >= 0 && left > 0; i--) {
      if (list[i].id !== id) continue;
      const take = Math.min(left, list[i].n);
      list[i].n -= take;
      left -= take;
      if (list[i].n <= 0) list.splice(i, 1);
    }
  }
}

export function repairItem(p: Profile, uid: string): R {
  const loc = locate(p, uid);
  if (!loc) return { ok: false };
  const d = itemDef(loc.item.id);
  if (!isArmor(d)) return { ok: false, text: 'Nicht reparierbar.' };
  const cost = repairCost(loc.item);
  if (cost <= 0) return { ok: false, text: 'Bereits in gutem Zustand.' };
  if (p.money < cost) return { ok: false, text: 'Nicht genug Geld.' };
  p.money -= cost;
  // Reparatur kostet etwas maximale Haltbarkeit nicht – vereinfachte Variante
  loc.item.dur = d.dur;
  return { ok: true, text: `Repariert für ${cost.toLocaleString('de-DE')} €.` };
}

/** Lädt eine Waffe mit Munition aus Lager/Tasche. */
export function loadWeapon(p: Profile, uid: string, ammoId?: string): R {
  const loc = locate(p, uid);
  if (!loc) return { ok: false };
  const d = itemDef(loc.item.id);
  if (!isWeapon(d)) return { ok: false };
  const w = loc.item;
  const options = ammoForCaliber(d.caliber).map((a) => a.id);
  const avail = (id: string) => countOwned(p, id);
  const pick = ammoId ?? (w.ammo && avail(w.ammo) > 0 ? w.ammo : options.find((id) => avail(id) > 0));
  if (!pick || avail(pick) <= 0) return { ok: false, text: `Keine Munition (${d.caliber}) vorhanden.` };
  if (pick !== w.ammo && (w.mag ?? 0) > 0) {
    addUnchecked(p.vault, createItem(w.ammo!, w.mag!));
    w.mag = 0;
  }
  w.ammo = pick;
  const need = d.mag - (w.mag ?? 0);
  if (need <= 0) return { ok: true, text: 'Bereits voll geladen.' };
  const take = Math.min(need, avail(pick));
  consumeOwned(p, pick, take);
  w.mag = (w.mag ?? 0) + take;
  return { ok: true, text: `${take} Patronen geladen.` };
}

export function unloadWeapon(p: Profile, uid: string): R {
  const loc = locate(p, uid);
  if (!loc) return { ok: false };
  const w = loc.item;
  if (!isWeapon(itemDef(w.id)) || !w.mag || !w.ammo) return { ok: false, text: 'Leer.' };
  addUnchecked(p.vault, createItem(w.ammo, w.mag));
  w.mag = 0;
  return { ok: true, text: 'Entladen.' };
}

/** Alles aus Tasche (nicht ausgerüstet) ins Lager. */
export function stashAll(p: Profile): R {
  let moved = 0;
  let failed = 0;
  for (const it of [...p.char.bag]) {
    const r = moveItem(p, it.uid, 'vault');
    if (r.ok) moved++;
    else failed++;
  }
  return { ok: moved > 0, text: failed ? `${moved} verstaut, ${failed} passten nicht (Lager voll).` : `${moved} Gegenstände verstaut.` };
}

/** Verkauft alle Tausch- und Wertgegenstände im Lager. */
export function sellJunk(p: Profile, cats: string[] = ['barter', 'valuable']): R {
  let total = 0;
  let n = 0;
  const questNeeds = new Set<string>();
  for (const q of QUESTS) {
    const st = p.quests[q.id];
    if (!st || st.claimed) continue;
    q.objectives.forEach((o, i) => {
      if (o.type === 'handover' && (st.progress[i] ?? 0) < o.count) questNeeds.add(o.item);
    });
  }
  for (const u of UPGRADES) {
    const next = u.levels[p.upgrades[u.id]];
    if (next) for (const req of next.items) questNeeds.add(req.id);
  }
  for (const it of [...p.vault]) {
    const d = itemDef(it.id);
    if (!cats.includes(d.cat) || questNeeds.has(it.id)) continue;
    const r = sellItem(p, it.uid);
    if (r.ok) {
      total += r.money ?? 0;
      n++;
    }
  }
  return { ok: n > 0, text: n ? `${n} Gegenstände für ${total.toLocaleString('de-DE')} € verkauft (Auftrags-/Ausbaugegenstände behalten).` : 'Nichts zu verkaufen.' };
}

export function hasAnyWeapon(p: Profile): boolean {
  return [...allItems(p.char), ...p.vault].some((it) => isWeapon(itemDef(it.id)));
}

/** Notfallausrüstung, damit niemand ohne Waffe festsitzt. */
export function claimFreeKit(p: Profile): R {
  if (hasAnyWeapon(p)) return { ok: false, text: 'Du besitzt noch eine Waffe.' };
  if (p.money >= 15000) return { ok: false, text: 'Du kannst dir selbst eine Waffe leisten.' };
  const w = createItem('pm9', 1, { ammo: 'a9_fmj' });
  p.char.equip.secondary = w;
  addUnchecked(p.char.bag, createItem('a9_fmj', 36));
  addUnchecked(p.char.bag, createItem('bandage', 1));
  addUnchecked(p.char.bag, createItem('ai2', 1));
  return { ok: true, text: 'Notfallausrüstung erhalten: PM-9 mit Munition und Verbandszeug.' };
}

export function kitWarnings(p: Profile): string[] {
  const w: string[] = [];
  const e = p.char.equip;
  if (!e.primary && !e.secondary) w.push('Keine Waffe ausgerüstet!');
  for (const s of ['primary', 'secondary'] as const) {
    const it = e[s];
    if (!it) continue;
    const d = weaponDef(it.id);
    const reserve = p.char.bag.concat(p.char.secure).filter((x) => itemDef(x.id).cat === 'ammo' && (itemDef(x.id) as { caliber: string }).caliber === d.caliber).reduce((sum, x) => sum + x.n, 0);
    if ((it.mag ?? 0) === 0 && reserve === 0) w.push(`${d.short}: kein Magazin und keine Reservemunition.`);
    else if (reserve === 0) w.push(`${d.short}: keine Reservemunition dabei.`);
  }
  if (!p.char.bag.some((x) => itemDef(x.id).cat === 'med')) w.push('Keine Medizin dabei.');
  return w;
}

export function vaultUsed(p: Profile) {
  return slotsUsed(p.vault);
}

export const levelCapReached = (p: Profile) => profileLevel(p) >= MAX_LEVEL;

export function exportProfile(p: Profile): string {
  const json = JSON.stringify(p);
  return btoa(unescape(encodeURIComponent(json)));
}

export function importProfile(code: string): Profile {
  const json = decodeURIComponent(escape(atob(code.trim())));
  return normalizeProfile(JSON.parse(json));
}

export function itemValueTotal(list: ItemStack[]) {
  return list.reduce((s, it) => s + stackValue(it), 0);
}
