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
    variant: Math.random(),
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

  constructor(tiles?: Tile[]) {
    this.tiles = tiles ?? Array.from({ length: GRID_SIZE * GRID_SIZE }, emptyTile);
  }

  /** Get the tile at (x, z). Callers must check inBounds first. */
  at(x: number, z: number): Tile {
    return this.tiles[idx(x, z)];
  }
}
