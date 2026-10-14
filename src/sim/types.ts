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
export type StructureType = 'none' | 'powerPlant' | 'windTurbine' | 'waterTower' | 'building' | 'park' | 'nuclearPlant' | 'pumpStation' | 'constructionYard'
  /** V1.5b: every city service (garbage, police, health, schools); tile.kind = services.ts Svc. */
  | 'service';

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
  /**
   * PR 4 multi-tile buildings (the 2×2 nuclear plant). 0 = a normal tile or
   * the ANCHOR (top-left) tile of a big building. For the other tiles of the
   * footprint it's anchorIndex + 1, so they know which tile "owns" them.
   * Only the anchor produces power, pays upkeep and gets drawn.
   */
  part: number;
  /**
   * PR 5: a home that just finished a construction stage is waiting for its
   * new residents' car (driving in from the highway). While true, the newest
   * level's residents aren't counted yet — they move in when the car ARRIVES.
   * Vehicles aren't saved, so loading a save moves everyone in at once.
   */
  movingIn: boolean;
  /**
   * PR 5 industry kind for INDUSTRIAL lots (see industry.ts):
   *   0 = ordinary factory (or a farm, automatically, on a farmland patch)
   *   1 = farm (painted with the Farm tool, anywhere)
   *   2 = food processing plant
   */
  kind: number;
  /**
   * PR 5 farm FIELD ownership. 0 = not a field. > 0: this tile is a crop
   * field owned by the farm at index farm − 1 (like `part` for 2×2
   * buildings). < 0: a field you bulldozed — "fallow" — which its farm
   * (index −farm − 1) won't reclaim, so bulldozing a field shrinks the farm.
   * Fields can't be built on while owned; anything may be built on fallow.
   */
  farm: number;
  /** PR 5 food processing plant: units of raw food delivered and waiting to be processed. */
  input: number;
  /**
   * PR 5 construction crews: true once a construction truck from a
   * Construction Yard has reached this site. A site (construct > 0) only
   * makes progress while `crew` is true. Reset when the next stage starts.
   */
  crew: boolean;
  /**
   * PR 6 HOST-TILE AGGREGATES (written every tick by lots.ts aggregate()).
   * Buildings are now entities on the cell grid; the tile under a building's
   * kerb-side front is its HOST and carries these sums so the per-tile
   * systems (networks, goods, taxes, demand) keep working unchanged:
   *   res   = residents living here now, jobs = jobs here,
   *   units = "size units" for power / water / tax (residents ÷ 5, or jobs ÷ 4 shops / ÷ 8 factories / ÷ 3 farms).
   */
  res: number;
  jobs: number;
  units: number;
  /** PR 6: ticks a construction crew stays on this site after its last stage (one visit covers the whole site). */
  crewLinger: number;
  /** V1.5b stage E: garbage waiting for collection at this building (0..G_MAX). */
  garbage: number;
}

/** The tools on the toolbar. 'inspect' is the default "just click and look" tool. */
export type ToolId =
  | 'inspect'
  | 'road'
  | 'avenue'
  | 'roundabout' // V1.5: 2×2 ring (roadType 2)
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'powerPlant'
  | 'bigWaterTower' // V1.5b: places a waterTower structure with kind = 1 (3,200 water)
  | 'oilPlant' // V1.5: places a powerPlant structure with kind = PLANT_OIL
  | 'nuclearPlant'
  | 'windTurbine'
  | 'powerLine'
  | 'waterTower'
  | 'pumpStation'
  | 'farm'
  | 'foodPlant'
  | 'constructionYard'
  | 'waterPipe'
  | 'park'
  | 'parkingLot'
  | 'parkingGarage'
  // V1.5b services (sim/services.ts)
  | 'garbageDump'
  | 'policeStation'
  | 'clinic'
  | 'hospital'
  | 'elementarySchool'
  | 'highSchool'
  | 'college'
  | 'shippingDepot' // V1.5b stage C
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
