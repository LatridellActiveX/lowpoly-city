/**
 * sim/mapsize.ts — V1.6 A1: RUNTIME MAP SIZE.
 *
 * The map used to be a compile-time 64 × 64. GRID_SIZE (types.ts) and
 * CELL_GRID (cells.ts) are now `export let` live bindings, set here before a
 * World is created. Supported sizes: 64 (the classic map), 128 and 192
 * (V1.6 A6 regions: 64 × 64 regions, 2×2 or 3×3 of them).
 */
import { _setGridSize, GRID_SIZE } from './types';
import { _setCellGrid } from './cells';

export const MAP_SIZES = [64, 128, 192] as const;
export type MapSize = (typeof MAP_SIZES)[number];

/** Set the map size for the NEXT World. */
export function setGridSize(n: number): void {
  if (!(MAP_SIZES as readonly number[]).includes(n)) throw new Error(`unsupported map size ${n}`);
  _setGridSize(n);
  _setCellGrid(n);
}
export const gridSize = () => GRID_SIZE;
