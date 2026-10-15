import { RoadGraph } from '../roads/graph';
import { ZoneBlocks } from '../roads/blocks';
/**
 * sim/grid.ts — the World: the tile array plus small coordinate helpers.
 *
 * Tiles are stored in a flat array (fast, compact, easy to save). These helpers
 * convert between the (x, z) tile coordinate a human thinks in and the array
 * index the computer uses:
 *
 *     index = z * GRID_SIZE + x        x = index % GRID_SIZE
 *                                      z = floor(index / GRID_SIZE)
 */
import { GRID_SIZE, Tile } from './types';
import { defaultTaxRates, emptyLedger, Ledger, MONTH_TICKS, STARTING_CASH, TaxRates } from './economy';
import { scatterDecorations } from './terrain';
import { generateWater, placeEdgeConnection } from './mapgen';
import { computeResources, Resource } from './resources';
import { hash2 } from './random';
import { CellLayer } from './cells';
import { Lots } from './lots';
import { Parking } from './parking';
import { ChunkIndex } from './chunks';
import { allRegions, extendHighway, startRegion } from './regions';

/** Make a brand-new empty tile. */
export function emptyTile(): Tile {
  return {
    road: false,
    powerLine: false,
    waterPipe: false,
    zone: null,
    structure: 'none',
    level: 0,
    happyTicks: 0,
    variant: 0,
    deco: 0,
    water: false,
    edge: false,
    roadType: 0,
    construct: 0,
    stock: 0,
    part: 0,
    movingIn: false,
    kind: 0,
    farm: 0,
    input: 0,
    crew: false,
    res: 0,
    jobs: 0,
    units: 0,
    crewLinger: 0,
    garbage: 0,
  };
}

/** Is (x, z) inside the map? */
export function inBounds(x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < GRID_SIZE && z < GRID_SIZE;
}

/** (x, z) -> flat array index. */
export function idx(x: number, z: number): number {
  return z * GRID_SIZE + x;
}

/** Flat array index -> [x, z]. */
export function coords(i: number): [number, number] {
  return [i % GRID_SIZE, Math.floor(i / GRID_SIZE)];
}

/**
 * The four "orthogonal" neighbours (north, east, south, west). We never use
 * diagonals: roads, lines and pipes only connect edge-to-edge, like in most
 * classic city builders.
 */
export const NEIGHBOURS: ReadonlyArray<[number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Indices of the in-bounds orthogonal neighbours of tile i. */
export function neighbourIndices(i: number): number[] {
  const [x, z] = coords(i);
  const out: number[] = [];
  for (const [dx, dz] of NEIGHBOURS) {
    if (inBounds(x + dx, z + dz)) out.push(idx(x + dx, z + dz));
  }
  return out;
}

/** The whole map. */
export class World {
  tiles: Tile[];
  /**
   * V1.6 B6: freeform roads (roads/graph.ts) drawn with the free road tool,
   * their zone blocks, and the road tiles they were rasterised onto (the
   * tile renderer skips those; sim/freeroads.ts).
   */
  roads = new RoadGraph();
  blocks = new ZoneBlocks();
  graphTiles = new Set<number>();
  /** Simulation clock: number of ticks since the city was founded. */
  tick = 0;
  /** Per-city seed for terrain noise and building variety. */
  seed: number;
  /** Money in the bank. Can go negative (that just blocks building). */
  cash = STARTING_CASH;
  /** Tax rate per zone, 0..0.2. */
  taxRates: TaxRates = defaultTaxRates();
  /** V1.5 stage 11: land-value property tax rate (0..MAX_PROPERTY), saved. */
  propertyRate = 0.05;
  /** V1.5 stage 11: last month's profit per business host tile (not saved; rebuilt in a month). */
  profits = new Map<number, import('./economy').Profit>();
  /** Books for the month in progress, and the last finished month. */
  ledger: Ledger = emptyLedger();
  lastLedger: Ledger | null = null;
  /** Current wind strength 0..1 (see wind.ts). Turbines make 800 × wind power (PR 5). */
  wind = 0.5;
  /** The random-walk part of the wind, kept so the weather continues smoothly after a reload. */
  windDrift = 0;
  /** PR 5: heading the wind blows FROM (radians, see wind.ts) and its slow turn rate. */
  windDir = 0;
  windDirVel = 0;
  /**
   * PR 4: game-clock seconds since founding, at 1× speed. Drives the
   * day/night cycle (dayNight.ts) and traffic. Kept separate from `tick` so
   * changing the sim update rate in Settings doesn't change how long a day is.
   */
  clock = 0;
  /** PR 4: export price multiplier (the 10,000 tier raises it, progression.ts). */
  get exportBonus(): number {
    return this.tier >= 3 ? 1.25 : 1;
  }
  /** PR 4: highest population tier reached (progression.ts). Never goes down. */
  tier = 0;
  /** PR 6: highest population ever reached (medium housing unlock at 1,000, progression.ts). */
  peakPop = 0;
  private resourceCache: Uint8Array | null = null;
  /**
   * PR 6 cell grid (cells.ts): per-cell zone codes, owners and roles; the
   * building entities (lots.ts) and public parking lots (parking.ts). All
   * three are saved (save.ts v6).
   */
  /**
   * V1.6 A6: owned regions bitmask (regions.ts). A new 64 map owns its one
   * region; a new big map owns only the start region. Saves restore it.
   */
  regionsOwned = GRID_SIZE > 64 ? 1 << startRegion() : allRegions();
  cells = new CellLayer();
  lots = new Lots();
  parking = new Parking();

  /**
   * Pass `tiles` + `seed` when loading a save. With no arguments a fresh city
   * is created: a random seed is chosen and trees/rocks are scattered.
   */
  /**
   * V1.5: `opts.dry` (title screen "Dry land" map) skips river/lake
   * generation for a brand-new map. Ignored when loading a save.
   */
  constructor(tiles?: Tile[], seed?: number, opts: { dry?: boolean } = {}) {
    this.seed = seed ?? Math.floor(Math.random() * 1e9);
    this.windDir = hash2(17, 29, this.seed + 5) * Math.PI * 2; // PR 5: same formula as wind.initialWindDir
    this.tiles = tiles ?? Array.from({ length: GRID_SIZE * GRID_SIZE }, emptyTile);
    if (!tiles) {
      // A brand-new map: water first (so trees don't grow in the river),
      // then the highway connection, then trees/rocks on what's left.
      if (!opts.dry) generateWater(this.tiles, this.seed, false);
      const edge = placeEdgeConnection(this.tiles, this.seed);
      extendHighway(this.tiles, edge); // V1.6 A6: big maps — highway reaches the start region
      scatterDecorations(this.tiles, this.seed);
    }
  }

  /** PR 4: seeded resource patches per tile (resources.ts). Computed once, never saved. */
  get resources(): Uint8Array {
    if (!this.resourceCache) this.resourceCache = computeResources(this.tiles, this.seed);
    return this.resourceCache;
  }
  /** Resource under tile i. */
  resourceAt(i: number): Resource {
    return this.resources[i] as Resource;
  }

  /** PR 4: index of the out-of-city road tile, or -1 if this map has none. */
  get edgeIndex(): number {
    // V1.6 A2: cached. The cached tile is re-checked on every call (cheap);
    // a "no edge" answer is re-checked whenever the topology revision moves.
    const c = this.edgeCache;
    if (c >= 0 && this.tiles[c]?.edge) return c;
    if (c === -1 && this.edgeRev === this.chunks.topoRev) return -1;
    this.edgeCache = this.tiles.findIndex((t) => t.edge);
    this.edgeRev = this.chunks.topoRev;
    return this.edgeCache;
  }
  private edgeCache = -2;
  private edgeRev = 0;

  /**
   * V1.6 A2: 16×16 chunk index + change detection (chunks.ts). Built on
   * first use; Simulation calls chunks.sync() at the start of every tick.
   */
  get chunks(): ChunkIndex {
    return (this.chunkIndex ??= new ChunkIndex(this.tiles, Math.round(Math.sqrt(this.tiles.length))));
  }
  private chunkIndex: ChunkIndex | null = null;

  /** Current month number (1-based), for the clock. */
  get month(): number {
    return Math.floor(this.tick / MONTH_TICKS) + 1;
  }

  /** Day within the month (1..30), for the clock. */
  get day(): number {
    return Math.floor(((this.tick % MONTH_TICKS) / MONTH_TICKS) * 30) + 1;
  }

  /** Get the tile at (x, z). Callers must check inBounds first. */
  at(x: number, z: number): Tile {
    return this.tiles[idx(x, z)];
  }
}
