/**
 * sim/recycleMode.ts — IND-6: RECYCLING CENTERS MAKE PRODUCTS.
 *
 * Plain TypeScript (no Three.js/DOM). A recycling center (services.ts
 * Svc.Recycling) always burned the garbage its trucks bring in for power
 * (networks.ts, 5,000 like a coal plant). Now the player can pick a MODE in
 * its Inspect panel:
 *
 *   ''          Power only (the default, so every old save is unchanged)
 *   'plastics'  every 100 garbage burned also yields 8 plastics
 *   'materials' every 100 garbage burned also yields 8 building materials
 *
 * In a product mode part of the garbage is sorted out instead of burned, so
 * the center makes 20% less power (×0.8).
 *
 * WHERE THINGS LIVE
 *  - the mode is the center's anchor tile `recipe` field (already saved per
 *    tile since IND-1, so no save-version bump; '' = power only);
 *  - the products pile up in the anchor tile's `stock` (also saved), capped
 *    at RECYCLE_STOCK_MAX;
 *  - garbage.ts burn() adds the products; goods.ts ships full loads (LOAD)
 *    to processors / yards / shops exactly like a factory would, or exports
 *    them.
 */
import type { Tile } from './types';
import { Svc } from './services';

export type RecycleMode = '' | 'plastics' | 'materials';
export const RECYCLE_MODES: Array<{ mode: RecycleMode; label: string }> = [
  { mode: '', label: 'Power only' },
  { mode: 'plastics', label: 'Plastics' },
  { mode: 'materials', label: 'Building materials' },
];
/** Product units per garbage unit burned (8 per 100). */
export const RECYCLE_YIELD = 0.08;
/** Power multiplier while making products (20% less). */
export const RECYCLE_POWER = 0.8;
/** Most products a center stores before it stops adding more. */
export const RECYCLE_STOCK_MAX = 48;

/** Is tile t a recycling center (anchor)? */
export const isRecyclingCenter = (t: Tile): boolean => t.structure === 'service' && t.kind === Svc.Recycling && !t.part;
/** The center's product mode ('' = power only, also for anything that isn't a center). */
export function recycleMode(t: Tile): RecycleMode {
  return isRecyclingCenter(t) && (t.recipe === 'plastics' || t.recipe === 'materials') ? t.recipe : '';
}
/** Switch a center's mode. Switching is free; stock of the old product is kept until shipped only if it matches, else dropped. */
export function setRecycleMode(t: Tile, mode: RecycleMode): void {
  if (!isRecyclingCenter(t)) return;
  if (recycleMode(t) !== mode) t.stock = 0; // a pile of plastics can't turn into materials
  t.recipe = mode;
}
