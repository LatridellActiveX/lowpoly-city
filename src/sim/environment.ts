/**
 * sim/environment.ts — pollution and desirability (PR 3).
 *
 * POLLUTION
 * ---------
 * Factories (grown industrial lots) and coal power plants pollute the tiles
 * around them. Each source has a STRENGTH and a RADIUS (rules.ts) and its
 * pollution fades linearly with distance:
 *
 *     pollution(tile) += strength × (1 − distance / (radius + 1))   if distance ≤ radius
 *
 * Wind turbines, water towers, homes and shops are clean. Pollution from
 * several sources simply adds up.
 *
 * DESIRABILITY (only matters for homes)
 * -------------------------------------
 *     desirability = DESIRE_BASE − POLLUTION_WEIGHT × pollution + parkBonus
 *
 * PARKS add a bonus with the same linear falloff, capped at PARK_BONUS_MAX so
 * you can't fix everything by carpeting the map in parks.
 * How desirability changes growth is in simulation.ts / rules.ts:
 *   below DESIRE_MIN       -> the home won't grow at all
 *   below DESIRE_FOR_DENSE -> it can't grow past level 1
 *   above DESIRE_FAST      -> it grows twice as fast
 *
 * COST: for each source we only visit the square of tiles within its radius,
 * so this is O(sources × radius²) — a few thousand additions per tick even in
 * a big city, about the same as the utility flood-fill.
 */
import { GRID_SIZE } from './types';
import { World } from './grid';
import {
  DESIRE_BASE,
  PARK_BONUS,
  PARK_BONUS_MAX,
  PARK_RADIUS,
  PLANT_POLLUTION,
  PLANT_POLLUTION_RADIUS,
  FACTORY_POLLUTION_PER_LEVEL,
  FACTORY_POLLUTION_RADIUS,
  POLLUTION_WEIGHT,
} from './rules';

export interface Environment {
  /** Pollution per tile (0 = clean; ~4+ = heavy). */
  pollution: Float32Array;
  /** Park bonus per tile (0..PARK_BONUS_MAX). */
  parks: Float32Array;
  /** Desirability per tile (only meaningful for homes). */
  desirability: Float32Array;
}

/** Add `strength` with linear falloff to every tile within `radius` of (cx, cz). */
function spread(field: Float32Array, cx: number, cz: number, radius: number, strength: number): void {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) continue;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue; // keep the area round, not square
      field[z * GRID_SIZE + x] += strength * (1 - d / (radius + 1));
    }
  }
}

export function computeEnvironment(world: World): Environment {
  const n = world.tiles.length;
  const pollution = new Float32Array(n);
  const parks = new Float32Array(n);
  world.tiles.forEach((t, i) => {
    const x = i % GRID_SIZE, z = Math.floor(i / GRID_SIZE);
    if (t.structure === 'powerPlant') spread(pollution, x, z, PLANT_POLLUTION_RADIUS, PLANT_POLLUTION);
    else if (t.zone === 'industrial' && t.level > 0) spread(pollution, x, z, FACTORY_POLLUTION_RADIUS, FACTORY_POLLUTION_PER_LEVEL * t.level);
    else if (t.structure === 'park') spread(parks, x, z, PARK_RADIUS, PARK_BONUS);
  });
  const desirability = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    parks[i] = Math.min(PARK_BONUS_MAX, parks[i]);
    desirability[i] = DESIRE_BASE - POLLUTION_WEIGHT * pollution[i] + parks[i];
  }
  return { pollution, parks, desirability };
}
