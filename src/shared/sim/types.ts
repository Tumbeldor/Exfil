import type { Inventory, ListName, EquipSlot } from '../inventory';
import type { ItemStack } from '../items';
import type { BotType } from '../loot';
import type { ContainerKind, ExtractDef } from '../map/GameMap';

export type Team = 'player' | 'bot';

export interface WeaponState {
  cooldown: number;
  reloadT: number;
  reloadTotal: number;
  bloom: number;
  equipT: number;
  reloadAmmo?: string;
}

export type ActionType = 'heal' | 'revive' | 'search' | 'unlock' | 'radio' | 'selfrevive';

export interface ActionState {
  type: ActionType;
  t: number;
  total: number;
  item?: string;
  target?: number;
  x?: number;
  y?: number;
}

export interface KillRecord {
  type: BotType | 'player';
  wclass: string;
  map: string;
  head: boolean;
}

export interface RaidStats {
  kills: Record<BotType, number>;
  killLog: KillRecord[];
  searched: Partial<Record<ContainerKind, number>>;
  bodies: number;
  visited: string[];
  damage: number;
  shots: number;
  hits: number;
  heliCalls: number;
  revives: number;
  startValue: number;
}

export interface Brain {
  state: 'patrol' | 'idle' | 'investigate' | 'combat' | 'search' | 'retreat' | 'guard';
  stateT: number;
  path: { x: number; y: number }[] | null;
  pathI: number;
  goal: { x: number; y: number } | null;
  repathT: number;
  target: number | null;
  lastSeen: { x: number; y: number; t: number } | null;
  awareness: number;
  reactT: number;
  trackT: number;
  burst: number;
  burstPause: number;
  strafeDir: number;
  strafeT: number;
  idleT: number;
  thinkT: number;
  home: { x: number; y: number };
  leash: number;
  leader: number | null;
  squad: number;
  grenadeCd: number;
  stuckT: number;
  lastX: number;
  lastY: number;
  lookA: number;
  lookT: number;
  healCd: number;
  heard: { x: number; y: number; t: number } | null;
  visible: boolean;
  lod: number;
  skill: BotSkill;
  zone: string | null;
}

export interface BotSkill {
  view: number;
  fov: number;
  react: number;
  aimErr: number;
  turn: number;
  speed: number;
  burstMin: number;
  burstMax: number;
  aggression: number;
  hearing: number;
}

export interface Actor {
  id: number;
  kind: 'player' | 'bot';
  team: Team;
  name: string;
  botType?: BotType;
  x: number;
  y: number;
  r: number;
  aim: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  downed: boolean;
  downedT: number;
  bleeding: boolean;
  stamina: number;
  inv: Inventory;
  invVersion: number;
  active: 'primary' | 'secondary';
  ws: WeaponState;
  action: ActionState | null;
  stimT: number;
  sprint: boolean;
  ads: boolean;
  moving: boolean;
  lastDamageT: number;
  lastAttacker: number | null;
  extracted: boolean;
  extractT: number;
  extractId: string | null;
  viewing: number | null;
  stats: RaidStats | null;
  brain: Brain | null;
  color: string;
  level: number;
  regen: number;
  /** letzte vom Client bestätigte Position (Validierung) */
  lastInputT: number;
  connected: boolean;
}

export interface Bullet {
  id: number;
  owner: number;
  team: Team;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  range: number;
  traveled: number;
  dmg: number;
  pen: number;
  armorDmg: number;
  weapon: string;
  ignoreLow: number;
}

export interface Grenade {
  id: number;
  owner: number;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  flyT: number;
  t: number;
  fuse: number;
  dmg: number;
  radius: number;
}

export interface Container {
  id: number;
  kind: ContainerKind;
  name: string;
  x: number;
  y: number;
  tier: number;
  items: ItemStack[];
  searched: number[];
  version: number;
  /** Leichen: Typ des Toten */
  owner?: BotType | 'player';
  /** wurde der Körper bereits von jemandem geöffnet (für XP) */
  lootedBy?: number[];
  dynamic?: boolean;
  rot?: number;
}

export type HeliPhase = 'idle' | 'inbound' | 'landed' | 'cooldown';

export interface ExtractState {
  def: ExtractDef;
  open: boolean;
  heli: { phase: HeliPhase; t: number } | null;
}

/** Eingabe pro Client-Frame (gebündelt ~30 Hz). */
export interface PlayerInput {
  x: number;
  y: number;
  aim: number;
  sprint: boolean;
  ads: boolean;
  moving: boolean;
  /** abgegebene Schüsse: je Schuss die Winkel aller Projektile */
  shots?: number[][];
}

export type PlayerAction =
  | { a: 'reload'; ammo?: string }
  | { a: 'swap'; slot?: 'primary' | 'secondary' }
  | { a: 'use'; uid: string }
  | { a: 'quickheal' }
  | { a: 'interact'; kind: 'container' | 'door' | 'radio' | 'revive'; id: number | string }
  | { a: 'take'; c: number; uid: string; n?: number; to?: ListName | 'equip' }
  | { a: 'takeAll'; c: number }
  | { a: 'put'; c: number; uid: string; n?: number }
  | { a: 'move'; uid: string; to: ListName }
  | { a: 'equip'; uid: string }
  | { a: 'unequip'; slot: EquipSlot }
  | { a: 'drop'; uid: string; n?: number }
  | { a: 'throw'; x: number; y: number }
  | { a: 'ping'; x: number; y: number }
  | { a: 'close' }
  | { a: 'cancel' };

export type GameEvent = { t?: number; to?: number } & (
  | { e: 'shot'; id: number; x: number; y: number; a: number; w: string }
  | { e: 'bullet'; b: number; id: number; x: number; y: number; a: number; s: number; r: number; tr: string }
  | { e: 'hit'; b: number; x: number; y: number; id: number; by: number; d: number; ar: boolean; hd: boolean; k: boolean }
  | { e: 'impact'; b: number; x: number; y: number; m: number }
  | { e: 'death'; id: number; by: number | null; x: number; y: number; name: string; victim: BotType | 'player'; killer: string; w: string; hd: boolean }
  | { e: 'reload'; id: number; w: string; x: number; y: number }
  | { e: 'dry'; id: number }
  | { e: 'swap'; id: number; w: string }
  | { e: 'heal'; id: number; item: string }
  | { e: 'throw'; g: number; id: number; x: number; y: number; vx: number; vy: number; ft: number; fuse: number }
  | { e: 'explode'; g: number; x: number; y: number; r: number }
  | { e: 'extracted'; id: number; name: string; ex: string }
  | { e: 'heli'; ex: string; phase: HeliPhase; t: number }
  | { e: 'downed'; id: number; name: string }
  | { e: 'revived'; id: number; by: number }
  | { e: 'tile'; tx: number; ty: number; v: number }
  | { e: 'msg'; text: string; kind?: 'info' | 'warn' | 'good' | 'quest' }
  | { e: 'ping'; x: number; y: number; by: number; name: string }
  | { e: 'container'; c: ContainerInfo }
  | { e: 'cremove'; c: number }
  | { e: 'noise'; x: number; y: number }
  | { e: 'xp'; amount: number; reason: string }
  | { e: 'searched'; c: number; empty: boolean }
);

export interface ContainerInfo {
  id: number;
  kind: ContainerKind;
  name: string;
  x: number;
  y: number;
  rot?: number;
  owner?: BotType | 'player';
}

export interface ActorSnap {
  i: number;
  k: 'p' | 'b';
  bt?: BotType;
  n?: string;
  x: number;
  y: number;
  a: number;
  /** Bitfeld: 1 sprint, 2 ads, 4 reload, 8 heal/action, 16 downed, 32 moving, 64 backpack */
  f: number;
  w: string;
  h: string;
  ar: number;
  hp?: number;
  c?: string;
}

export interface MeSnap {
  hp: number;
  mhp: number;
  st: number;
  bl: boolean;
  dn: boolean;
  dt: number;
  act: { type: ActionType; t: number; total: number } | null;
  mag: number;
  ammo: string;
  rl: number;
  rlt: number;
  eq: number;
  active: 'primary' | 'secondary';
  stim: number;
  ex: { id: string; t: number; need?: string } | null;
  corr?: { x: number; y: number };
  view: number | null;
  alive: boolean;
}

export interface ExtractSnap {
  id: string;
  open: boolean;
  heli?: { phase: HeliPhase; t: number };
}

export interface Snapshot {
  t: number;
  tl: number;
  a: ActorSnap[];
  me: MeSnap | null;
  ex?: ExtractSnap[];
}

export interface XpBreakdown {
  kills: number;
  search: number;
  extract: number;
  survival: number;
  total: number;
}

export interface RaidResult {
  status: 'extracted' | 'killed' | 'mia';
  mapId: string;
  extractId?: string;
  extractName?: string;
  killedBy?: string;
  inventory: Inventory;
  stats: RaidStats;
  time: number;
  xp: XpBreakdown;
  endValue: number;
}
