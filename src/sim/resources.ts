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
}

export const RESOURCE_NAMES: Record<Resource, string> = {
  [Resource.None]: 'None',
  [Resource.Farmland]: 'Farmland',
  [Resource.Logging]: 'Logging',
  [Resource.Quarry]: 'Quarry',
  [Resource.Oil]: 'Oil',
};

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
    }
  return out;
}
