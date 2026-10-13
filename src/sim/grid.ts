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
  /** Simulation clock: number of ticks since the city was founded. */
  tick = 0;
  /** Per-city seed for terrain noise and building variety. */
  seed: number;
  /** Money in the bank. Can go negative (that just blocks building). */
  cash = STARTING_CASH;
  /** Tax rate per zone, 0..0.2. */
  taxRates: TaxRates = defaultTaxRates();
  /** Books for the month in progress, and the last finished month. */
  ledger: Ledger = emptyLedger();
  lastLedger: Ledger | null = null;
  /** Current wind strength 0..1 (see wind.ts). Turbines make 15 × wind power. */
  wind = 0.5;
  /** The random-walk part of the wind, kept so the weather continues smoothly after a reload. */
  windDrift = 0;
  /**
   * PR 4: game-clock seconds since founding, at 1× speed. Drives the
   * day/night cycle (dayNight.ts) and traffic. Kept separate from `tick` so
   * changing the sim update rate in Settings doesn't change how long a day is.
   */
  clock = 0;
  /** PR 4: highest population tier reached (progression.ts). Never goes down. */
  tier = 0;
  private resourceCache: Uint8Array | null = null;

  /**
   * Pass `tiles` + `seed` when loading a save. With no arguments a fresh city
   * is created: a random seed is chosen and trees/rocks are scattered.
   */
  constructor(tiles?: Tile[], seed?: number) {
    this.seed = seed ?? Math.floor(Math.random() * 1e9);
    this.tiles = tiles ?? Array.from({ length: GRID_SIZE * GRID_SIZE }, emptyTile);
    if (!tiles) {
      // A brand-new map: water first (so trees don't grow in the river),
      // then the highway connection, then trees/rocks on what's left.
      generateWater(this.tiles, this.seed, false);
      placeEdgeConnection(this.tiles, this.seed);
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
    return this.tiles.findIndex((t) => t.edge);
  }

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
