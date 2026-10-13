/**
 * sim/types.ts — the shared vocabulary of the simulation.
 *
 * Everything in src/sim/ is plain TypeScript with NO Three.js and NO DOM code.
 * That separation matters: the simulation can be unit-tested, saved to JSON,
 * and later extended (traffic in milestone 2, trucks/economy in milestone 3)
 * without touching how things are drawn.
 *
 * GRID COORDINATES
 * ----------------
 * The map is a square of GRID_SIZE x GRID_SIZE tiles. A tile is addressed by
 * (x, z): x grows to the "east", z grows to the "south". We use z (not y)
 * because in Three.js the y axis points UP, and the ground is the x/z plane.
 * Internally tiles live in one flat array; tile (x, z) is at index
 * `z * GRID_SIZE + x`. Helpers for that live in grid.ts.
 */

/** Width and height of the map in tiles. */
export const GRID_SIZE = 64;

/** The three zone types the player can paint. */
export type ZoneType = 'residential' | 'commercial' | 'industrial';

/**
 * Single-tile "structures". A tile holds at most one structure.
 * 'building' means a zone lot that has grown a house/shop/factory.
 */
/** 'park' (PR 3) is a small green space that makes nearby homes more desirable. */
export type StructureType = 'none' | 'powerPlant' | 'windTurbine' | 'waterTower' | 'building' | 'park';

/** One tile of the map. Kept as a plain object so it serialises to JSON trivially. */
export interface Tile {
  /** A road runs over this tile. */
  road: boolean;
  /** A power line runs over this tile (can share a tile with a road and/or a pipe). */
  powerLine: boolean;
  /** A water pipe runs under this tile (can share a tile with a road and/or a line). */
  waterPipe: boolean;
  /** The zone painted on this tile, or null if unzoned. */
  zone: ZoneType | null;
  /** What is built here. */
  structure: StructureType;
  /** Building size 0..3. 0 = empty zoned lot, 1..3 = grown building (bigger = more people/jobs). */
  level: number;
  /**
   * How many ticks this building has been continuously serviced (road+power+water).
   * Growth only happens after a building has been "happy" for a while, so towns
   * fill in gradually instead of instantly.
   */
  happyTicks: number;
  /**
   * Legacy (M1) per-tile random number. Building variety now comes from a
   * deterministic hash of the coordinates (random.ts), so this is unused but
   * kept so old saves round-trip.
   */
  variant: number;
  /** Natural decoration on this tile (see terrain.ts `Deco`): 0 = none. */
  deco: number;
  /**
   * PR 4: river/lake water (generated once per map, see mapgen.ts). Water is
   * unbuildable except for ROADS, which become bridges. Bulldozing a bridge
   * leaves the water in place.
   */
  water: boolean;
  /**
   * PR 4: this road tile is the OUT-OF-CITY CONNECTION at the map edge. Cars
   * and trucks enter and leave the map here. It can't be bulldozed.
   */
  edge: boolean;
  /** PR 4: road type when `road` is true. 0 = street, 1 = medium-density avenue (faster, more lanes). */
  roadType: number;
  /**
   * PR 4 construction: ticks of building work left before this lot reaches
   * its next level (0 = not under construction). Work only progresses while
   * the lot has road, power and water. See simulation.ts.
   */
  construct: number;
  /**
   * PR 4 goods: what's in stock. Factories: units of their good waiting for
   * a truck. Shops: units on the shelves. Power plants: fuel. See goods.ts.
   */
  stock: number;
}

/** The tools on the toolbar. 'inspect' is the default "just click and look" tool. */
export type ToolId =
  | 'inspect'
  | 'road'
  | 'avenue'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'powerPlant'
  | 'windTurbine'
  | 'powerLine'
  | 'waterTower'
  | 'waterPipe'
  | 'park'
  | 'bulldoze';

/** Per-tile result of the most recent utility calculation (see networks.ts). */
export interface TileService {
  /** Index of the power network this tile touches, or -1 if none. */
  powerNet: number;
  /** Index of the water network this tile touches, or -1 if none. */
  waterNet: number;
  /** True if this tile's building is actually receiving power this tick. */
  powered: boolean;
  /** True if this tile's building is actually receiving water this tick. */
  watered: boolean;
  /** True if one of the four neighbouring tiles is a road. */
  roadAccess: boolean;
}

/** Summary of one connected utility network. */
export interface Network {
  id: number;
  /** Total units the sources in this network can produce. */
  capacity: number;
  /** Total units the consumers in this network want. */
  demand: number;
  /** Units actually delivered (min(capacity, demand)). */
  supplied: number;
  /** Number of consumer tiles that are being cut off because demand > capacity. */
  outages: number;
}
