/**
 * sim/resources.ts — PR 4 natural resource patches (farmland, oil, quarry,
 * logging), revealed by the Resources view once the city reaches 2,000
 * people (progression.ts).
 *
 * Like the ground type, patches are NOT saved: they are recomputed from the
 * city seed with noise (random.ts), so they're identical after every reload.
 * Each patch type uses its own noise field and threshold; where several
 * overlap, the rarer one wins (oil > quarry > logging > farmland).
 *
 * The map centre (radius 8) is kept free so the starting town isn't sitting
 * on an oil field, and water tiles never have resources.
 *
 * GAMEPLAY: a factory built on a patch (after the 2,000 tier) produces that
 * patch's raw good instead of generic manufactured goods (goods.ts).
 */
import { GRID_SIZE, Tile } from './types';
import { fbm, valueNoise } from './random';

export enum Resource {
  None = 0,
  Farmland = 1,
  Logging = 2,
  Quarry = 3,
  Oil = 4,
  /**
   * IND-5: iron ORE. Rarer than quarry stone. Only placed on land that has
   * NO other patch, so adding ore never turns an existing logging camp,
   * quarry, oil rig or farm into something else. World.resources (grid.ts)
   * also drops ore under industry that was already built before ore existed
   * (oreMask below), so old factories keep their role.
   */
  Ore = 5,
}

export const RESOURCE_NAMES: Record<Resource, string> = {
  [Resource.None]: 'None',
  [Resource.Farmland]: 'Farmland',
  [Resource.Logging]: 'Logging',
  [Resource.Quarry]: 'Quarry',
  [Resource.Oil]: 'Oil',
  [Resource.Ore]: 'Ore',
};
/** IND-5: noise threshold for ore patches (higher = rarer). */
export const ORE_THRESHOLD = 0.84;

/**
 * IND-5: ORE MASK. Built industry standing on an ore tile that is NOT a mine
 * (its tile.recipe isn't 'mine', chains.ts marks mines) was there before ore
 * existed — e.g. a factory in a save from before IND-5. Clear the ore under
 * it so that building keeps the role it had. A tile is "built industry"
 * when it is industrial with a level or a construction site.
 */
export function oreMask(tiles: Tile[], out: Uint8Array): void {
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== Resource.Ore) continue;
    const t = tiles[i];
    if (t.zone === 'industrial' && (t.level > 0 || t.construct > 0) && t.recipe !== 'mine') out[i] = Resource.None;
  }
}

export function computeResources(tiles: Tile[], seed: number): Uint8Array {
  const N = GRID_SIZE;
  const out = new Uint8Array(N * N);
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (tiles[i].water || Math.hypot(x - N / 2, z - N / 2) < 8) continue;
      if (valueNoise(x, z, 7, seed + 900) > 0.8) out[i] = Resource.Oil;
      else if (fbm(x, z, 9, seed + 7) > 0.72) out[i] = Resource.Quarry; // same field as rocky ground
      else if (fbm(x, z, 11, seed + 23) > 0.66) out[i] = Resource.Logging; // same field as forests
      else if (fbm(x, z, 10, seed + 930) > 0.64) out[i] = Resource.Farmland;
      // IND-5: ore only where nothing else is (last in the chain), its own noise field.
      else if (valueNoise(x, z, 6, seed + 1300) > ORE_THRESHOLD) out[i] = Resource.Ore;
    }
  return out;
}
