/** Kacheltypen. Plain-Objekt statt enum, damit es mit isolatedModules funktioniert. */
export const T = {
  GRASS: 0,
  DIRT: 1,
  ASPHALT: 2,
  CONCRETE: 3,
  WOOD: 4,
  TILEFLOOR: 5,
  INDOOR: 6,
  SAND: 7,
  WATER: 8,
  GRAVEL: 9,
  WALL: 10,
  WALL_CONCRETE: 11,
  WALL_METAL: 12,
  FENCE: 13,
  WINDOW: 14,
  LOW: 15,
  TREE: 16,
  BUSH: 17,
  DOOR_LOCKED: 18,
  ROCK: 19,
  BORDER: 20,
  RAIL: 21,
  CARPET: 22,
  METALFLOOR: 23,
  DOCK: 24,
} as const;
export type TileType = (typeof T)[keyof typeof T];

export const F_MOVE = 1;
export const F_SIGHT = 2;
export const F_BULLET = 4;
export const F_LOW = 8;
export const F_INDOOR = 16;
export const F_SLOW = 32;
export const F_WALL = 64;

export const TILE_FLAGS = new Uint8Array(32);
const set = (t: number, f: number) => (TILE_FLAGS[t] = f);
set(T.GRASS, 0);
set(T.DIRT, 0);
set(T.ASPHALT, 0);
set(T.CONCRETE, 0);
set(T.GRAVEL, 0);
set(T.SAND, 0);
set(T.RAIL, 0);
set(T.DOCK, 0);
set(T.WOOD, F_INDOOR);
set(T.TILEFLOOR, F_INDOOR);
set(T.INDOOR, F_INDOOR);
set(T.CARPET, F_INDOOR);
set(T.METALFLOOR, F_INDOOR);
set(T.WATER, F_MOVE);
set(T.WALL, F_MOVE | F_SIGHT | F_BULLET | F_WALL);
set(T.WALL_CONCRETE, F_MOVE | F_SIGHT | F_BULLET | F_WALL);
set(T.WALL_METAL, F_MOVE | F_SIGHT | F_BULLET | F_WALL);
set(T.DOOR_LOCKED, F_MOVE | F_SIGHT | F_BULLET | F_WALL);
set(T.BORDER, F_MOVE | F_SIGHT | F_BULLET | F_WALL);
set(T.ROCK, F_MOVE | F_SIGHT | F_BULLET);
set(T.FENCE, F_MOVE);
set(T.WINDOW, F_MOVE);
set(T.LOW, F_MOVE | F_BULLET | F_LOW);
set(T.TREE, F_MOVE | F_BULLET);
set(T.BUSH, F_SLOW);

export const isFloorTile = (t: number) => (TILE_FLAGS[t] & F_MOVE) === 0;
