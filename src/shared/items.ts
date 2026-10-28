/**
 * Gegenstandskatalog: Waffen, Munition, Schutzausrüstung, Medizin, Beute.
 * Alle Werte sind bewusst an Tarkov/DMZ angelehnt, aber für Top-Down vereinfacht.
 */

export type Caliber = '9x19' | '5.56' | '7.62x39' | '7.62x51' | '12g';
export type WeaponClass = 'pistol' | 'smg' | 'ar' | 'shotgun' | 'dmr' | 'sniper' | 'lmg';
export type ItemCat =
  | 'weapon'
  | 'ammo'
  | 'armor'
  | 'helmet'
  | 'backpack'
  | 'med'
  | 'grenade'
  | 'valuable'
  | 'barter'
  | 'key'
  | 'cash';

export interface BaseItem {
  id: string;
  name: string;
  /** Kurzname für kleine Kacheln */
  short: string;
  cat: ItemCat;
  /** Platzbedarf in Inventareinheiten pro voll gefülltem Stapel */
  size: number;
  /** kg pro Stück */
  weight: number;
  /** Basiswert in € (pro Stück) */
  value: number;
  /** maximale Stückzahl pro Einheit */
  stack: number;
  /** Beute-Gewichtung (0 = taucht nie als Beute auf) */
  rarity: number;
  /** Beute-Stufe 1 (häufig) … 4 (sehr selten / militärisch) */
  tier: number;
  icon: string;
  desc?: string;
}

export interface WeaponDef extends BaseItem {
  cat: 'weapon';
  wclass: WeaponClass;
  caliber: Caliber;
  slot: 'primary' | 'secondary';
  mag: number;
  rpm: number;
  auto: boolean;
  /** Grundstreuung in Grad */
  spread: number;
  /** Streuungszuwachs pro Schuss (Grad) */
  bloom: number;
  bloomMax: number;
  /** Abbau der Streuung (Grad/s) */
  recover: number;
  /** Zusatzstreuung in Bewegung (Grad) */
  moveSpread: number;
  bulletSpeed: number;
  range: number;
  reload: number;
  equip: number;
  /** Hörweite des Schusses in Welteinheiten */
  noise: number;
  /** Multiplikator für Sichtweite beim Zielen (Optik) */
  adsRange: number;
  /** Kamera-Zoom beim Zielen (<1 = weiter raus) */
  adsZoom: number;
  dmgMult: number;
}

export interface AmmoDef extends BaseItem {
  cat: 'ammo';
  caliber: Caliber;
  dmg: number;
  pen: number;
  /** Anteil des Schadens, der an Panzerung geht */
  armorDmg: number;
  pellets: number;
  tracer: string;
}

export interface ArmorDef extends BaseItem {
  cat: 'armor' | 'helmet';
  cls: number;
  dur: number;
  /** Laufgeschwindigkeits-Malus (0..1) */
  speedPenalty: number;
  /** Sichtfeld-Malus in Grad (Helme) */
  fovPenalty: number;
}

export interface BackpackDef extends BaseItem {
  cat: 'backpack';
  cap: number;
}

export interface MedDef extends BaseItem {
  cat: 'med';
  heal: number;
  stopsBleed: boolean;
  useTime: number;
  uses: number;
  stim?: { speed: number; time: number };
  revive?: boolean;
}

export interface GrenadeDef extends BaseItem {
  cat: 'grenade';
  dmg: number;
  radius: number;
  fuse: number;
}

export interface KeyDef extends BaseItem {
  cat: 'key';
  keyId: string;
}

export type ItemDef =
  | WeaponDef
  | AmmoDef
  | ArmorDef
  | BackpackDef
  | MedDef
  | GrenadeDef
  | KeyDef
  | (BaseItem & { cat: 'valuable' | 'barter' | 'cash' });

/** Eine konkrete Gegenstands-Instanz (in Inventar, Lager, Behältern). */
export interface ItemStack {
  uid: string;
  id: string;
  n: number;
  /** Haltbarkeit (Panzerung) bzw. verbleibende Anwendungen (Medizin) */
  dur?: number;
  /** geladene Munitionssorte (Waffen) */
  ammo?: string;
  /** Patronen im Magazin (Waffen) */
  mag?: number;
}

const W = (d: Omit<WeaponDef, 'cat' | 'stack' | 'icon'> & { icon?: string }): WeaponDef => ({
  cat: 'weapon',
  stack: 1,
  icon: d.icon ?? 'w_' + d.wclass,
  ...d,
});

const A = (
  d: Omit<AmmoDef, 'cat' | 'size' | 'weight' | 'icon' | 'pellets' | 'tier'> & {
    pellets?: number;
    tier?: number;
  },
): AmmoDef => ({
  cat: 'ammo',
  size: 1,
  weight: 0.012,
  icon: 'ammo',
  pellets: 1,
  tier: 1,
  ...d,
});

export const WEAPONS: WeaponDef[] = [
  W({
    id: 'pm9', name: 'PM-9 Pistole', short: 'PM-9', wclass: 'pistol', caliber: '9x19', slot: 'secondary',
    size: 1, weight: 0.8, value: 3200, rarity: 10, tier: 1, mag: 12, rpm: 380, auto: false,
    spread: 3.2, bloom: 1.6, bloomMax: 7, recover: 14, moveSpread: 2.5, bulletSpeed: 1450, range: 700,
    reload: 1.6, equip: 0.35, noise: 850, adsRange: 1, adsZoom: 1, dmgMult: 1,
    desc: 'Billige Dienstpistole. Zuverlässig, aber schwach.',
  }),
  W({
    id: 'p17', name: 'P-17 Pistole', short: 'P-17', wclass: 'pistol', caliber: '9x19', slot: 'secondary',
    size: 1, weight: 0.7, value: 7800, rarity: 6, tier: 2, mag: 17, rpm: 460, auto: false,
    spread: 2.4, bloom: 1.3, bloomMax: 6, recover: 16, moveSpread: 2, bulletSpeed: 1500, range: 750,
    reload: 1.5, equip: 0.3, noise: 850, adsRange: 1, adsZoom: 1, dmgMult: 1.05,
    desc: 'Moderne Polymerpistole mit großem Magazin.',
  }),
  W({
    id: 'mp9k', name: 'MP-9K Maschinenpistole', short: 'MP-9K', wclass: 'smg', caliber: '9x19', slot: 'primary',
    size: 3, weight: 2.4, value: 14500, rarity: 7, tier: 2, mag: 30, rpm: 850, auto: true,
    spread: 3.6, bloom: 0.55, bloomMax: 8, recover: 18, moveSpread: 1.8, bulletSpeed: 1500, range: 750,
    reload: 2.2, equip: 0.45, noise: 900, adsRange: 1.05, adsZoom: 0.97, dmgMult: 1,
    desc: 'Kompakte MP mit hoher Feuerrate. Gut für Häuserkampf.',
  }),
  W({
    id: 'vektor', name: 'Vektor-9 MP', short: 'Vektor', wclass: 'smg', caliber: '9x19', slot: 'primary',
    size: 3, weight: 2.7, value: 26000, rarity: 3, tier: 3, mag: 33, rpm: 1100, auto: true,
    spread: 2.8, bloom: 0.4, bloomMax: 7, recover: 22, moveSpread: 1.4, bulletSpeed: 1550, range: 780,
    reload: 2.1, equip: 0.45, noise: 900, adsRange: 1.05, adsZoom: 0.97, dmgMult: 1.05,
    desc: 'Rückstoßarme Hochleistungs-MP.',
  }),
  W({
    id: 'sks', name: 'SKS-45 Karabiner', short: 'SKS', wclass: 'dmr', caliber: '7.62x39', slot: 'primary',
    size: 4, weight: 3.8, value: 12500, rarity: 7, tier: 1, mag: 10, rpm: 320, auto: false,
    spread: 1.4, bloom: 1.6, bloomMax: 6, recover: 10, moveSpread: 3.5, bulletSpeed: 2100, range: 1300,
    reload: 2.6, equip: 0.6, noise: 1150, adsRange: 1.15, adsZoom: 0.9, dmgMult: 1.05,
    desc: 'Alter Halbautomat. Präzise und günstig.',
  }),
  W({
    id: 'akm', name: 'AKM Sturmgewehr', short: 'AKM', wclass: 'ar', caliber: '7.62x39', slot: 'primary',
    size: 4, weight: 3.6, value: 29000, rarity: 5, tier: 2, mag: 30, rpm: 600, auto: true,
    spread: 2.6, bloom: 0.9, bloomMax: 9, recover: 13, moveSpread: 2.6, bulletSpeed: 1900, range: 1100,
    reload: 2.6, equip: 0.6, noise: 1150, adsRange: 1.1, adsZoom: 0.92, dmgMult: 1,
    desc: 'Robustes Sturmgewehr mit starkem Rückstoß.',
  }),
  W({
    id: 'm4a1', name: 'M4A1 Karabiner', short: 'M4A1', wclass: 'ar', caliber: '5.56', slot: 'primary',
    size: 4, weight: 3.2, value: 44000, rarity: 3, tier: 3, mag: 30, rpm: 800, auto: true,
    spread: 2.1, bloom: 0.6, bloomMax: 7, recover: 15, moveSpread: 2.2, bulletSpeed: 2050, range: 1150,
    reload: 2.4, equip: 0.55, noise: 1150, adsRange: 1.15, adsZoom: 0.9, dmgMult: 1,
    desc: 'Präziser, modularer Karabiner.',
  }),
  W({
    id: 'sr25', name: 'SR-25 Präzisionsgewehr', short: 'SR-25', wclass: 'dmr', caliber: '7.62x51', slot: 'primary',
    size: 5, weight: 4.9, value: 68000, rarity: 2, tier: 4, mag: 20, rpm: 300, auto: false,
    spread: 0.8, bloom: 1.4, bloomMax: 5, recover: 11, moveSpread: 3.6, bulletSpeed: 2400, range: 1500,
    reload: 2.8, equip: 0.7, noise: 1300, adsRange: 1.35, adsZoom: 0.78, dmgMult: 1,
    desc: 'Halbautomatisches Präzisionsgewehr mit Zielfernrohr.',
  }),
  W({
    id: 'm700', name: 'M700 Repetierer', short: 'M700', wclass: 'sniper', caliber: '7.62x51', slot: 'primary',
    size: 5, weight: 4.3, value: 47000, rarity: 3, tier: 3, mag: 5, rpm: 48, auto: false,
    spread: 0.25, bloom: 2, bloomMax: 4, recover: 6, moveSpread: 5, bulletSpeed: 2800, range: 1800,
    reload: 3.4, equip: 0.8, noise: 1400, adsRange: 1.5, adsZoom: 0.7, dmgMult: 1.35,
    desc: 'Repetiergewehr. Ein Schuss, ein Treffer.',
  }),
  W({
    id: 'mp133', name: 'MP-133 Pumpflinte', short: 'MP-133', wclass: 'shotgun', caliber: '12g', slot: 'primary',
    size: 4, weight: 3.5, value: 9500, rarity: 9, tier: 1, mag: 6, rpm: 70, auto: false,
    spread: 6.5, bloom: 1, bloomMax: 4, recover: 8, moveSpread: 1.5, bulletSpeed: 1300, range: 480,
    reload: 3.1, equip: 0.6, noise: 1050, adsRange: 1, adsZoom: 1, dmgMult: 1,
    desc: 'Pumpflinte. Auf kurze Distanz verheerend.',
  }),
  W({
    id: 'saiga', name: 'Saiga-12K Flinte', short: 'Saiga', wclass: 'shotgun', caliber: '12g', slot: 'primary',
    size: 4, weight: 3.7, value: 34000, rarity: 3, tier: 3, mag: 8, rpm: 230, auto: false,
    spread: 6, bloom: 1.6, bloomMax: 7, recover: 9, moveSpread: 1.5, bulletSpeed: 1300, range: 480,
    reload: 3, equip: 0.6, noise: 1050, adsRange: 1, adsZoom: 1, dmgMult: 1,
    desc: 'Halbautomatische Flinte mit Kastenmagazin.',
  }),
  W({
    id: 'm249', name: 'M249 MG', short: 'M249', wclass: 'lmg', caliber: '5.56', slot: 'primary',
    size: 6, weight: 7.5, value: 98000, rarity: 1, tier: 4, mag: 100, rpm: 750, auto: true,
    spread: 3.2, bloom: 0.5, bloomMax: 10, recover: 10, moveSpread: 4.5, bulletSpeed: 2000, range: 1150,
    reload: 5.6, equip: 1, noise: 1250, adsRange: 1.1, adsZoom: 0.9, dmgMult: 1,
    desc: 'Leichtes Maschinengewehr. Schwer, aber unaufhaltsam.',
  }),
];

export const AMMO: AmmoDef[] = [
  A({ id: 'a9_fmj', name: '9x19 FMJ', short: '9 FMJ', caliber: '9x19', dmg: 36, pen: 18, armorDmg: 0.35, value: 35, stack: 60, rarity: 12, tracer: '#ffd27a' }),
  A({ id: 'a9_hp', name: '9x19 Hohlspitz', short: '9 HP', caliber: '9x19', dmg: 50, pen: 7, armorDmg: 0.25, value: 55, stack: 60, rarity: 6, tier: 2, tracer: '#ffb36a' }),
  A({ id: 'a9_ap', name: '9x19 AP 6.3', short: '9 AP', caliber: '9x19', dmg: 33, pen: 33, armorDmg: 0.5, value: 120, stack: 60, rarity: 3, tier: 3, tracer: '#9fe8ff' }),
  A({ id: 'a556_fmj', name: '5.56x45 FMJ', short: '5.56 FMJ', caliber: '5.56', dmg: 44, pen: 28, armorDmg: 0.45, value: 80, stack: 60, rarity: 7, tier: 2, tracer: '#ffd27a' }),
  A({ id: 'a556_sp', name: '5.56x45 Teilmantel', short: '5.56 SP', caliber: '5.56', dmg: 58, pen: 12, armorDmg: 0.3, value: 70, stack: 60, rarity: 5, tier: 2, tracer: '#ffb36a' }),
  A({ id: 'a556_ap', name: '5.56x45 M995 AP', short: 'M995', caliber: '5.56', dmg: 40, pen: 52, armorDmg: 0.6, value: 260, stack: 60, rarity: 2, tier: 4, tracer: '#9fe8ff' }),
  A({ id: 'a762_ps', name: '7.62x39 PS', short: '7.62 PS', caliber: '7.62x39', dmg: 50, pen: 32, armorDmg: 0.5, value: 75, stack: 60, rarity: 8, tracer: '#ffd27a' }),
  A({ id: 'a762_hp', name: '7.62x39 Hohlspitz', short: '7.62 HP', caliber: '7.62x39', dmg: 64, pen: 15, armorDmg: 0.3, value: 70, stack: 60, rarity: 4, tier: 2, tracer: '#ffb36a' }),
  A({ id: 'a762_bp', name: '7.62x39 BP', short: '7.62 BP', caliber: '7.62x39', dmg: 48, pen: 47, armorDmg: 0.6, value: 210, stack: 60, rarity: 2, tier: 3, tracer: '#9fe8ff' }),
  A({ id: 'a308_fmj', name: '7.62x51 FMJ', short: '.308 FMJ', caliber: '7.62x51', dmg: 72, pen: 42, armorDmg: 0.6, value: 160, stack: 40, rarity: 4, tier: 3, tracer: '#ffd27a' }),
  A({ id: 'a308_ap', name: '7.62x51 M61 AP', short: 'M61', caliber: '7.62x51', dmg: 68, pen: 62, armorDmg: 0.75, value: 420, stack: 40, rarity: 1, tier: 4, tracer: '#9fe8ff' }),
  A({ id: 'a12_buck', name: '12/70 Schrot 00', short: 'Schrot', caliber: '12g', dmg: 18, pen: 4, armorDmg: 0.25, value: 40, stack: 30, rarity: 10, pellets: 8, tracer: '#ffcc88' }),
  A({ id: 'a12_slug', name: '12/70 Flintenlaufgeschoss', short: 'Slug', caliber: '12g', dmg: 105, pen: 22, armorDmg: 0.55, value: 90, stack: 30, rarity: 4, tier: 2, tracer: '#ffd27a' }),
  A({ id: 'a12_ap', name: '12/70 AP-20 Slug', short: 'AP-20', caliber: '12g', dmg: 88, pen: 40, armorDmg: 0.65, value: 240, stack: 30, rarity: 2, tier: 3, tracer: '#9fe8ff' }),
];

const AR = (d: Omit<ArmorDef, 'stack' | 'icon' | 'fovPenalty'> & { fovPenalty?: number }): ArmorDef => ({
  stack: 1,
  icon: d.cat === 'armor' ? 'armor' : 'helmet',
  fovPenalty: 0,
  ...d,
});

export const ARMORS: ArmorDef[] = [
  AR({ id: 'vest_police', cat: 'armor', name: 'Polizeiweste (Kl. 2)', short: 'Weste 2', cls: 2, dur: 40, speedPenalty: 0.02, size: 3, weight: 2.5, value: 9000, rarity: 8, tier: 1 }),
  AR({ id: 'vest_light', cat: 'armor', name: 'Leichte Schutzweste (Kl. 3)', short: 'Weste 3', cls: 3, dur: 50, speedPenalty: 0.03, size: 3, weight: 3.6, value: 19000, rarity: 6, tier: 2 }),
  AR({ id: 'vest_plate', cat: 'armor', name: 'Plattenträger (Kl. 4)', short: 'Platte 4', cls: 4, dur: 60, speedPenalty: 0.05, size: 4, weight: 7, value: 39000, rarity: 3, tier: 3 }),
  AR({ id: 'vest_gen4', cat: 'armor', name: 'Gen4 Vollschutz (Kl. 5)', short: 'Gen4 5', cls: 5, dur: 75, speedPenalty: 0.08, size: 4, weight: 10, value: 78000, rarity: 1, tier: 4 }),
  AR({ id: 'vest_heavy', cat: 'armor', name: 'Schwere Panzerweste (Kl. 6)', short: 'Schwer 6', cls: 6, dur: 90, speedPenalty: 0.13, size: 5, weight: 14, value: 145000, rarity: 0.4, tier: 4 }),
  AR({ id: 'helm_work', cat: 'helmet', name: 'Bauhelm (Kl. 1)', short: 'Bauhelm', cls: 1, dur: 15, speedPenalty: 0, size: 2, weight: 0.5, value: 2200, rarity: 8, tier: 1 }),
  AR({ id: 'helm_ssh', cat: 'helmet', name: 'Stahlhelm SSh (Kl. 3)', short: 'SSh-68', cls: 3, dur: 30, speedPenalty: 0.01, size: 2, weight: 1.5, value: 12500, rarity: 6, tier: 2 }),
  AR({ id: 'helm_ops', cat: 'helmet', name: 'Kevlarhelm OPS (Kl. 4)', short: 'OPS', cls: 4, dur: 40, speedPenalty: 0.01, size: 2, weight: 1.2, value: 31000, rarity: 3, tier: 3 }),
  AR({ id: 'helm_altyn', cat: 'helmet', name: 'Altyn Schwerhelm (Kl. 5)', short: 'Altyn', cls: 5, dur: 50, speedPenalty: 0.02, fovPenalty: 14, size: 3, weight: 4, value: 66000, rarity: 0.8, tier: 4 }),
];

const BP = (d: Omit<BackpackDef, 'cat' | 'stack' | 'icon'>): BackpackDef => ({ cat: 'backpack', stack: 1, icon: 'backpack', ...d });

export const BACKPACKS: BackpackDef[] = [
  BP({ id: 'bp_sling', name: 'Brotbeutel', short: 'Beutel', cap: 6, size: 2, weight: 0.4, value: 3500, rarity: 8, tier: 1 }),
  BP({ id: 'bp_tac', name: 'Taktischer Rucksack', short: 'Taktisch', cap: 12, size: 3, weight: 1, value: 13000, rarity: 5, tier: 2 }),
  BP({ id: 'bp_assault', name: 'Sturmrucksack', short: 'Sturm', cap: 18, size: 4, weight: 1.4, value: 26000, rarity: 3, tier: 3 }),
  BP({ id: 'bp_expedition', name: 'Expeditionsrucksack', short: 'Expedition', cap: 28, size: 5, weight: 2.2, value: 54000, rarity: 1, tier: 4 }),
];

const MD = (d: Omit<MedDef, 'cat' | 'stack' | 'stopsBleed'> & { stopsBleed?: boolean; stack?: number }): MedDef => ({
  cat: 'med',
  stack: 1,
  stopsBleed: false,
  ...d,
});

export const MEDS: MedDef[] = [
  MD({ id: 'bandage', name: 'Verband', short: 'Verband', icon: 'bandage', heal: 0, stopsBleed: true, useTime: 1.5, uses: 1, stack: 4, size: 1, weight: 0.05, value: 700, rarity: 12, tier: 1, desc: 'Stoppt Blutungen.' }),
  MD({ id: 'ai2', name: 'Erste-Hilfe-Set AI-2', short: 'AI-2', icon: 'medkit_s', heal: 40, useTime: 2.5, uses: 1, stack: 2, size: 1, weight: 0.15, value: 2600, rarity: 9, tier: 1, desc: 'Heilt 40 HP.' }),
  MD({ id: 'ifak', name: 'IFAK Notfallset', short: 'IFAK', icon: 'medkit', heal: 70, stopsBleed: true, useTime: 3.2, uses: 2, size: 1, weight: 0.3, value: 7200, rarity: 4, tier: 2, desc: 'Heilt 70 HP und stoppt Blutungen. 2 Anwendungen.' }),
  MD({ id: 'surgkit', name: 'Feldchirurgie-Set', short: 'Chirurgie', icon: 'surgkit', heal: 100, stopsBleed: true, useTime: 6, uses: 1, size: 2, weight: 0.8, value: 18500, rarity: 1.5, tier: 3, desc: 'Vollständige Heilung. Lange Anwendung.' }),
  MD({ id: 'stim', name: 'Adrenalin-Spritze', short: 'Adrenalin', icon: 'syringe', heal: 15, useTime: 1, uses: 1, stim: { speed: 0.18, time: 25 }, size: 1, weight: 0.05, value: 9500, rarity: 2.5, tier: 3, desc: '+18% Tempo, unbegrenzte Ausdauer für 25 s, +15 HP.' }),
  MD({ id: 'selfrevive', name: 'Selbstwiederbelebung', short: 'Revive', icon: 'revive', heal: 45, useTime: 4, uses: 1, revive: true, size: 1, weight: 0.4, value: 26000, rarity: 0.8, tier: 4, desc: 'Wird automatisch eingesetzt, wenn du zu Boden gehst.' }),
];

export const GRENADES: GrenadeDef[] = [
  { id: 'frag', name: 'Splittergranate F-1', short: 'F-1', cat: 'grenade', icon: 'grenade', dmg: 135, radius: 175, fuse: 2.6, size: 1, weight: 0.6, value: 4800, stack: 2, rarity: 3, tier: 2, desc: 'Wurfweite bis ~420. Explodiert nach 2,6 s.' },
];

type Misc = BaseItem & { cat: 'valuable' | 'barter' | 'cash' };
const V = (d: Omit<Misc, 'stack'> & { stack?: number }): Misc => ({ stack: 1, ...d });

export const MISC: Misc[] = [
  V({ id: 'cash', name: 'Bargeld', short: 'Bargeld', cat: 'cash', icon: 'cash', size: 1, weight: 0, value: 1, stack: 50000, rarity: 10, tier: 1, desc: 'Wird bei Extraktion automatisch gutgeschrieben.' }),
  V({ id: 'cigs', name: 'Zigaretten', short: 'Zigaretten', cat: 'barter', icon: 'cigs', size: 1, weight: 0.1, value: 1600, rarity: 12, tier: 1 }),
  V({ id: 'vodka', name: 'Wodka', short: 'Wodka', cat: 'barter', icon: 'bottle', size: 1, weight: 0.8, value: 2300, rarity: 9, tier: 1 }),
  V({ id: 'canned', name: 'Konserve', short: 'Konserve', cat: 'barter', icon: 'can', size: 1, weight: 0.4, value: 950, rarity: 12, tier: 1 }),
  V({ id: 'bolts', name: 'Schrauben', short: 'Schrauben', cat: 'barter', icon: 'bolts', size: 1, weight: 0.3, value: 1100, rarity: 11, tier: 1 }),
  V({ id: 'wires', name: 'Kabelbündel', short: 'Kabel', cat: 'barter', icon: 'wires', size: 1, weight: 0.3, value: 1900, rarity: 10, tier: 1 }),
  V({ id: 'circuit', name: 'Leiterplatte', short: 'Platine', cat: 'barter', icon: 'circuit', size: 1, weight: 0.2, value: 4200, rarity: 7, tier: 2 }),
  V({ id: 'hdd', name: 'Festplatte', short: 'HDD', cat: 'barter', icon: 'hdd', size: 1, weight: 0.4, value: 6200, rarity: 6, tier: 2 }),
  V({ id: 'cpu', name: 'Prozessor', short: 'CPU', cat: 'barter', icon: 'cpu', size: 1, weight: 0.1, value: 11500, rarity: 4, tier: 2 }),
  V({ id: 'gpu', name: 'Grafikkarte', short: 'GPU', cat: 'valuable', icon: 'gpu', size: 2, weight: 0.9, value: 62000, rarity: 0.8, tier: 4 }),
  V({ id: 'toolset', name: 'Werkzeugset', short: 'Werkzeug', cat: 'barter', icon: 'tools', size: 2, weight: 2, value: 7200, rarity: 6, tier: 1 }),
  V({ id: 'battery', name: 'Autobatterie', short: 'Batterie', cat: 'barter', icon: 'battery', size: 3, weight: 9, value: 8500, rarity: 4, tier: 1 }),
  V({ id: 'fuel', name: 'Benzinkanister', short: 'Benzin', cat: 'barter', icon: 'fuel', size: 3, weight: 6, value: 6800, rarity: 4, tier: 1 }),
  V({ id: 'radio', name: 'Funkgerät', short: 'Funk', cat: 'barter', icon: 'radio', size: 2, weight: 1, value: 9800, rarity: 3, tier: 2 }),
  V({ id: 'gasmask', name: 'Gasmaske', short: 'Gasmaske', cat: 'barter', icon: 'gasmask', size: 2, weight: 0.9, value: 5200, rarity: 5, tier: 1 }),
  V({ id: 'medsupply', name: 'Medizinische Vorräte', short: 'Med-Vorrat', cat: 'barter', icon: 'medsupply', size: 2, weight: 1, value: 8800, rarity: 5, tier: 2 }),
  V({ id: 'defib', name: 'Defibrillator', short: 'Defi', cat: 'valuable', icon: 'defib', size: 2, weight: 2.5, value: 38000, rarity: 1, tier: 3 }),
  V({ id: 'spectro', name: 'Spektral-Analysator', short: 'Spektro', cat: 'valuable', icon: 'spectro', size: 1, weight: 0.3, value: 125000, rarity: 0.25, tier: 4 }),
  V({ id: 'milbat', name: 'Militärakku', short: 'Mil-Akku', cat: 'valuable', icon: 'milbat', size: 2, weight: 3, value: 32000, rarity: 1, tier: 3 }),
  V({ id: 'intel', name: 'Geheimdokumente', short: 'Dokumente', cat: 'valuable', icon: 'intel', size: 1, weight: 0.2, value: 19000, rarity: 2, tier: 3 }),
  V({ id: 'chain', name: 'Goldkette', short: 'Goldkette', cat: 'valuable', icon: 'chain', size: 1, weight: 0.1, value: 9500, rarity: 5, tier: 2 }),
  V({ id: 'watch', name: 'Luxusuhr', short: 'Uhr', cat: 'valuable', icon: 'watch', size: 1, weight: 0.2, value: 15000, rarity: 3, tier: 2 }),
  V({ id: 'wallet', name: 'Krypto-Wallet', short: 'Krypto', cat: 'valuable', icon: 'crypto', size: 1, weight: 0.05, value: 48000, rarity: 0.9, tier: 3 }),
  V({ id: 'goldbar', name: 'Goldbarren', short: 'Gold', cat: 'valuable', icon: 'goldbar', size: 1, weight: 1, value: 85000, rarity: 0.3, tier: 4 }),
];

export const KEYS: KeyDef[] = [
  { id: 'key_pharmacy', name: 'Schlüssel: Apotheken-Lager', short: 'Apotheke', cat: 'key', keyId: 'pharmacy', icon: 'key', size: 1, weight: 0.05, value: 14000, stack: 1, rarity: 1.4, tier: 2, desc: 'Öffnet das Lager der Apotheke in Grenzstadt.' },
  { id: 'key_office', name: 'Schlüssel: Rathaus-Archiv', short: 'Archiv', cat: 'key', keyId: 'archive', icon: 'key', size: 1, weight: 0.05, value: 17000, stack: 1, rarity: 1.2, tier: 2, desc: 'Öffnet das Archiv im Rathaus von Grenzstadt.' },
  { id: 'key_sewer', name: 'Kanalschacht-Schlüssel', short: 'Kanal', cat: 'key', keyId: 'sewer', icon: 'key', size: 1, weight: 0.05, value: 21000, stack: 1, rarity: 1, tier: 2, desc: 'Ermöglicht die Extraktion durch die Kanalisation (Grenzstadt).' },
  { id: 'card_bunker', name: 'Schlüsselkarte: Bunker', short: 'Karte Rot', cat: 'key', keyId: 'bunker', icon: 'keycard', size: 1, weight: 0.02, value: 65000, stack: 1, rarity: 0.25, tier: 4, desc: 'Öffnet den Kommandobunker der Militärbasis.' },
  { id: 'key_harbor', name: 'Schlüssel: Hafenmeisterei', short: 'Hafenbüro', cat: 'key', keyId: 'harboroffice', icon: 'key', size: 1, weight: 0.05, value: 19000, stack: 1, rarity: 1.1, tier: 2, desc: 'Öffnet das Büro des Hafenmeisters.' },
  { id: 'card_vault', name: 'Schlüsselkarte: Zolltresor', short: 'Karte Blau', cat: 'key', keyId: 'customs', icon: 'keycard', size: 1, weight: 0.02, value: 72000, stack: 1, rarity: 0.25, tier: 4, desc: 'Öffnet den Tresorraum im Zollgebäude (Hafen).' },
];

export const ALL_ITEMS: ItemDef[] = [...WEAPONS, ...AMMO, ...ARMORS, ...BACKPACKS, ...MEDS, ...GRENADES, ...MISC, ...KEYS];

const BY_ID = new Map<string, ItemDef>(ALL_ITEMS.map((d) => [d.id, d]));

export function itemDef(id: string): ItemDef {
  const d = BY_ID.get(id);
  if (!d) throw new Error('Unbekannter Gegenstand: ' + id);
  return d;
}
export const hasItemDef = (id: string) => BY_ID.has(id);

export const isWeapon = (d: ItemDef): d is WeaponDef => d.cat === 'weapon';
export const isAmmo = (d: ItemDef): d is AmmoDef => d.cat === 'ammo';
export const isArmor = (d: ItemDef): d is ArmorDef => d.cat === 'armor' || d.cat === 'helmet';
export const isMed = (d: ItemDef): d is MedDef => d.cat === 'med';
export const isBackpack = (d: ItemDef): d is BackpackDef => d.cat === 'backpack';
export const isGrenade = (d: ItemDef): d is GrenadeDef => d.cat === 'grenade';
export const isKey = (d: ItemDef): d is KeyDef => d.cat === 'key';

export function weaponDef(id: string): WeaponDef {
  const d = itemDef(id);
  if (!isWeapon(d)) throw new Error(id + ' ist keine Waffe');
  return d;
}
export function ammoDef(id: string): AmmoDef {
  const d = itemDef(id);
  if (!isAmmo(d)) throw new Error(id + ' ist keine Munition');
  return d;
}
export const ammoForCaliber = (c: Caliber) => AMMO.filter((a) => a.caliber === c);

export const CALIBER_NAMES: Record<Caliber, string> = {
  '9x19': '9x19 mm',
  '5.56': '5.56x45',
  '7.62x39': '7.62x39',
  '7.62x51': '7.62x51',
  '12g': '12/70',
};

export const WEAPON_CLASS_NAMES: Record<WeaponClass, string> = {
  pistol: 'Pistole',
  smg: 'Maschinenpistole',
  ar: 'Sturmgewehr',
  shotgun: 'Flinte',
  dmr: 'Präzisionsgewehr',
  sniper: 'Scharfschützengewehr',
  lmg: 'Maschinengewehr',
};

export const CAT_NAMES: Record<ItemCat, string> = {
  weapon: 'Waffe',
  ammo: 'Munition',
  armor: 'Schutzweste',
  helmet: 'Helm',
  backpack: 'Rucksack',
  med: 'Medizin',
  grenade: 'Granate',
  valuable: 'Wertsache',
  barter: 'Tauschware',
  key: 'Schlüssel',
  cash: 'Bargeld',
};

let uidCounter = 0;
const uidBase = Math.floor(Math.random() * 1e9).toString(36);
/** Eindeutige ID für Gegenstandsinstanzen. */
export function makeUid(): string {
  uidCounter = (uidCounter + 1) % 1e9;
  return uidBase + '-' + Date.now().toString(36) + '-' + uidCounter.toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

/** Erzeugt eine frische Gegenstandsinstanz mit sinnvollen Standardwerten. */
export function createItem(id: string, n = 1, opts: { loaded?: boolean; ammo?: string } = {}): ItemStack {
  const d = itemDef(id);
  const it: ItemStack = { uid: makeUid(), id, n: Math.max(1, Math.min(n, d.stack * 99)) };
  if (isArmor(d)) it.dur = d.dur;
  if (isMed(d) && d.uses > 1) it.dur = d.uses;
  if (isWeapon(d)) {
    const ammo = opts.ammo ?? ammoForCaliber(d.caliber)[0].id;
    it.ammo = ammo;
    it.mag = opts.loaded === false ? 0 : d.mag;
  }
  return it;
}

/** Wert einer Instanz (inkl. geladener Munition, Haltbarkeit). */
export function stackValue(it: ItemStack): number {
  const d = itemDef(it.id);
  let v = d.value * it.n;
  if (isArmor(d) && it.dur !== undefined) v *= 0.35 + 0.65 * (it.dur / d.dur);
  if (isMed(d) && d.uses > 1 && it.dur !== undefined) v *= it.dur / d.uses;
  if (isWeapon(d) && it.ammo && it.mag) v += itemDef(it.ammo).value * it.mag;
  return Math.round(v);
}

export function stackWeight(it: ItemStack): number {
  const d = itemDef(it.id);
  let w = d.weight * it.n;
  if (isWeapon(d) && it.mag) w += 0.012 * it.mag;
  return w;
}

/** Benötigte Inventareinheiten für eine Instanz. */
export function stackSlots(it: ItemStack): number {
  const d = itemDef(it.id);
  return d.size * Math.max(1, Math.ceil(it.n / d.stack));
}

export function itemLabel(it: ItemStack): string {
  const d = itemDef(it.id);
  if (d.stack > 1 && it.n > 1) return `${d.name} ×${it.n}`;
  return d.name;
}
