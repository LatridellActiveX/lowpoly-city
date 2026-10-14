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
import { GRID_SIZE, TileService } from './types';
import { World } from './grid';
import { isFarmLot } from './industry';
import {
  DESIRE_BASE,
  PARK_BONUS,
  PARK_BONUS_MAX,
  PARK_RADIUS,
  PARK_AREA,
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
  /** V1.5 stage 11: noise per tile (traffic on avenues/rings, industry, plants). */
  noise: Float32Array;
  /** V1.5 stage 11: land value index per tile, 0..LV_MAX (see computeLandValue). */
  landValue: Float32Array;
}

/**
 * V1.5 STAGE 11 — LAND VALUE (per tile, 0 … LV_MAX ≈ 3)
 * ------------------------------------------------------
 *   access   + LV_ACCESS on a tile beside a road, fading by LV_ACCESS_FADE
 *              per tile further away (BFS over land, 4 tiles max);
 *              + LV_AVENUE extra beside an avenue or roundabout
 *   services + LV_SERVICE each for power and water (when `net` is known)
 *   parks    + LV_PARK × the park bonus (environment parks field)
 *   commerce + LV_COMMERCE × nearby shop jobs (radius 6, linear falloff),
 *              capped at LV_COMMERCE_MAX — shops nearby make land dearer
 *   minus      LV_POLLUTION × pollution and LV_NOISE × noise
 * Feeds the property tax (economy.ts propertyTax) and building health (stage 12).
 */
export const LV_MAX = 3;
export const LV_ACCESS = 0.8, LV_ACCESS_FADE = 0.2, LV_AVENUE = 0.15, LV_SERVICE = 0.2, LV_PARK = 0.8;
/** V1.5b: full garbage (G_MAX = 60) costs this much land value on its tile. */
export const LV_GARBAGE = 0.8;
export const LV_COMMERCE = 0.02, LV_COMMERCE_MAX = 0.9, LV_POLLUTION = 0.3, LV_NOISE = 0.35;
/** Noise sources: (strength, radius). */
const NOISE_AVENUE: [number, number] = [0.35, 1], NOISE_PLANT: [number, number] = [1.2, 3], NOISE_IND_PER_LEVEL: [number, number] = [0.25, 2];

export function computeLandValue(world: World, env: { pollution: Float32Array; parks: Float32Array }, service?: TileService[]): { noise: Float32Array; landValue: Float32Array } {
  const N = GRID_SIZE, n = world.tiles.length, tiles = world.tiles;
  const noise = new Float32Array(n), commerce = new Float32Array(n), dist = new Int8Array(n).fill(99), out = new Float32Array(n);
  const queue: number[] = [];
  tiles.forEach((t, i) => {
    const x = i % N, z = Math.floor(i / N);
    if (t.road) { if (t.roadType >= 1) spread(noise, x, z, NOISE_AVENUE[1], NOISE_AVENUE[0]); dist[i] = 0; queue.push(i); }
    if (t.structure === 'powerPlant') spread(noise, x, z, NOISE_PLANT[1], NOISE_PLANT[0]);
    if (t.zone === 'industrial' && t.level > 0) spread(noise, x, z, NOISE_IND_PER_LEVEL[1], NOISE_IND_PER_LEVEL[0] * t.level);
    if (t.zone === 'commercial' && t.jobs > 0) spread(commerce, x, z, 6, t.jobs);
  });
  // BFS distance from the road network (roads = 0, kerbside = 1, …).
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % N, z = Math.floor(i / N);
    if (dist[i] >= 4) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = x + dx, b = z + dz;
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const j = b * N + a;
      if (dist[j] > dist[i] + 1 && !tiles[j].water) { dist[j] = dist[i] + 1; queue.push(j); }
    }
  }
  const nearAvenue = (i: number) => { const x = i % N, z = Math.floor(i / N); return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => { const a = x + dx, b = z + dz; return a >= 0 && b >= 0 && a < N && b < N && tiles[b * N + a].road && tiles[b * N + a].roadType >= 1; }); };
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    if (t.water || t.road) continue; // no land value on roads/water
    let v = dist[i] <= 4 ? Math.max(0, LV_ACCESS - LV_ACCESS_FADE * (dist[i] - 1)) : 0;
    if (dist[i] === 1 && nearAvenue(i)) v += LV_AVENUE;
    if (service) v += (service[i].powered ? LV_SERVICE : 0) + (service[i].watered ? LV_SERVICE : 0);
    v += LV_PARK * env.parks[i] + Math.min(LV_COMMERCE_MAX, LV_COMMERCE * commerce[i]);
    v -= LV_POLLUTION * env.pollution[i] + LV_NOISE * noise[i];
    v -= LV_GARBAGE * Math.min(1, t.garbage / 60) * (world.peakPop < 1000 ? 0.3 : 1); // V1.5b stage E (mild before the dump unlocks)
    out[i] = Math.max(0, Math.min(LV_MAX, v));
  }
  return { noise, landValue: out };
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

/**
 * PR 6 park area: a 10 × 10-tile square (PARK_AREA) around the park, offsets
 * −5..+4 on each axis. Falloff by Chebyshev distance d (0..5):
 * bonus × (1 − 0.5 · (d / 5)²) → 100 % at the park, 98 % one tile away,
 * 50 % on the outer ring. Gentle, so the whole square clearly benefits.
 */
export const parkFalloff = (d: number) => 1 - 0.5 * (d / PARK_RADIUS) ** 2;
function spreadSquare(field: Float32Array, cx: number, cz: number, strength: number): void {
  const lo = -Math.floor(PARK_AREA / 2), hi = lo + PARK_AREA - 1;
  for (let dz = lo; dz <= hi; dz++) for (let dx = lo; dx <= hi; dx++) {
    const x = cx + dx, z = cz + dz;
    if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) continue;
    field[z * GRID_SIZE + x] += strength * parkFalloff(Math.max(Math.abs(dx), Math.abs(dz)));
  }
}

/** `service` (simulation net.service) lets land value count power/water. */
export function computeEnvironment(world: World, service?: TileService[]): Environment {
  const n = world.tiles.length;
  const pollution = new Float32Array(n);
  const parks = new Float32Array(n);
  world.tiles.forEach((t, i) => {
    const x = i % GRID_SIZE, z = Math.floor(i / GRID_SIZE);
    if (t.structure === 'powerPlant') spread(pollution, x, z, PLANT_POLLUTION_RADIUS, PLANT_POLLUTION);
    else if (t.zone === 'industrial' && t.level > 0) spread(pollution, x, z, FACTORY_POLLUTION_RADIUS, FACTORY_POLLUTION_PER_LEVEL * t.level * (isFarmLot(world, i) ? 0.25 : 1)); // PR 5: farms pollute ¼
    else if (t.structure === 'park') spreadSquare(parks, x, z, PARK_BONUS);
  });
  const desirability = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    parks[i] = Math.min(PARK_BONUS_MAX, parks[i]);
    desirability[i] = DESIRE_BASE - POLLUTION_WEIGHT * pollution[i] + parks[i];
  }
  return { pollution, parks, desirability, ...computeLandValue(world, { pollution, parks }, service) };
}
