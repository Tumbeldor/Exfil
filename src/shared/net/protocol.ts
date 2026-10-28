import type { Inventory } from '../inventory';
import type { ItemStack } from '../items';
import type { ContainerKind } from '../map/GameMap';
import type { ContainerInfo, ExtractSnap, GameEvent, PlayerAction, PlayerInput, RaidResult, Snapshot } from '../sim/types';

export interface ContainerView {
  id: number;
  kind: ContainerKind;
  name: string;
  items: ItemStack[];
}

export interface RaidStartInfo {
  mapId: string;
  seed: number;
  you: number;
  t: number;
  timeLeft: number;
  extracts: ExtractSnap[];
  containers: ContainerInfo[];
  tiles: [number, number, number][];
  squad: { id: number; name: string; color: string }[];
  difficulty: number;
  coop: boolean;
}

/** Nachrichten vom Raid-Host an einen Client. */
export type HostMsg =
  | { type: 'raidStart'; info: RaidStartInfo }
  | { type: 'snap'; s: Snapshot }
  | { type: 'ev'; list: GameEvent[] }
  | { type: 'inv'; inv: Inventory }
  | { type: 'cview'; c: ContainerView | null }
  | { type: 'result'; r: RaidResult }
  | { type: 'raidEnd' };

/** Nachrichten eines Clients an den Raid-Host. */
export type RaidClientMsg = { type: 'in'; i: PlayerInput } | { type: 'act'; a: PlayerAction };

// ---------------- Lobby (nur Server) ----------------

export interface LobbyPlayer {
  id: string;
  name: string;
  level: number;
  ready: boolean;
  kitValue: number;
  color: string;
  inRaid: boolean;
  connected: boolean;
}

export interface LobbyState {
  code: string;
  hostId: string;
  mapId: string;
  difficulty: number;
  friendlyFire: boolean;
  players: LobbyPlayer[];
  raidActive: boolean;
}

export interface JoinPayload {
  name: string;
  level: number;
  color: string;
  regen: number;
  inv: Inventory;
  kitValue: number;
}

export type ClientMsg =
  | { type: 'hello'; v: number; token?: string; name: string }
  | { type: 'create'; name: string }
  | { type: 'join'; code: string; name: string }
  | { type: 'leave' }
  | { type: 'ready'; ready: boolean; kit?: JoinPayload }
  | { type: 'settings'; mapId?: string; difficulty?: number; friendlyFire?: boolean }
  | { type: 'start' }
  | { type: 'chat'; text: string }
  | { type: 'ping'; t: number }
  | RaidClientMsg;

export type ServerMsg =
  | { type: 'welcome'; id: string; token: string; resumed: boolean }
  | { type: 'lobby'; lobby: LobbyState | null }
  | { type: 'error'; text: string }
  | { type: 'chat'; from: string; text: string }
  | { type: 'pong'; t: number }
  | HostMsg;
