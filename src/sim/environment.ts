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
 * PARKS add a bonus that spreads ALONG THE ROADS (OASIS-S4, parkReach below):
 * lots on a street within PARK_ROAD_REACH road tiles of the park benefit,
 * fading with road distance, capped at PARK_BONUS_MAX so you can't fix
 * everything by carpeting the map in parks.
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
import { pollutionMult } from './factoryCtl';
import { World } from './grid';
import { garbageNorm } from './garbageRules';
import { isFarmLot } from './industry';
import {
  DESIRE_BASE,
  PARK_BONUS,
  PARK_BONUS_MAX,
  PARK_ROAD_REACH,
  PARK_FRONT_DEPTH,
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

/**
 * `pre` (V1.6 A3, optional): receives each tile's land value BEFORE the
 * garbage penalty and the clamp (NaN on roads/water). Garbage changes almost
 * every tick, so the incremental path (lvGarbagePatch) re-applies just that
 * last step to the tiles whose garbage moved, instead of redoing the
 * road-distance flood and every spread.
 */
export function computeLandValue(world: World, env: { pollution: Float32Array; parks: Float32Array }, service?: TileService[], pre?: Float64Array): { noise: Float32Array; landValue: Float32Array } {
  const N = GRID_SIZE, n = world.tiles.length, tiles = world.tiles;
  const noise = new Float32Array(n), commerce = new Float32Array(n), dist = new Int8Array(n).fill(99), out = new Float32Array(n);
  const queue: number[] = [];
  world.chunks.activeTilesSorted().forEach((i) => { const t = tiles[i]; // V1.6 A2: sources live in active chunks
    const x = i % N, z = Math.floor(i / N);
    if (t.road) { if (t.roadType >= 1) spread(noise, x, z, NOISE_AVENUE[1], NOISE_AVENUE[0]); dist[i] = 0; queue.push(i); }
    if (t.structure === 'powerPlant' && !t.part) spread(noise, x, z, NOISE_PLANT[1], NOISE_PLANT[0]);
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
  // V1.6 A4: beyond the ring around active chunks every input below is 0,
  // so land value is 0 there (out[] starts at 0). pre[] is only written in
  // the ring: it is read solely for tiles with garbage, and a tile with
  // garbage is never bare, so it is always inside the ring.
  for (const i of world.chunks.ringTilesSorted()) {
    const t = tiles[i];
    if (t.water || t.road) { if (pre) pre[i] = NaN; continue; } // no land value on roads/water
    let v = dist[i] <= 4 ? Math.max(0, LV_ACCESS - LV_ACCESS_FADE * (dist[i] - 1)) : 0;
    if (dist[i] === 1 && nearAvenue(i)) v += LV_AVENUE;
    if (service) v += (service[i].powered ? LV_SERVICE : 0) + (service[i].watered ? LV_SERVICE : 0);
    v += LV_PARK * env.parks[i] + Math.min(LV_COMMERCE_MAX, LV_COMMERCE * commerce[i]);
    v -= LV_POLLUTION * env.pollution[i] + LV_NOISE * noise[i];
    if (pre) pre[i] = v;
    v -= LV_GARBAGE * Math.min(1, garbageNorm(t) / 60) * (world.peakPop < 1000 ? 0.3 : 1); // V1.5b stage E (mild before the dump unlocks)
    out[i] = Math.max(0, Math.min(LV_MAX, v));
  }
  return { noise, landValue: out };
}

/** Add `strength` with linear falloff to every tile within `radius` of (cx, cz). */
function spread(field: Float32Array, cx: number, cz: number, radius: number, strength: number): void {
  // V1.6 A4: the falloff weights per offset come from a cached kernel
  // (same numbers as computing Math.hypot every time, just once per radius).
  const ker = kernel(radius), side = 2 * radius + 1;
  for (let dz = -radius; dz <= radius; dz++) {
    const z = cz + dz;
    if (z < 0 || z >= GRID_SIZE) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= GRID_SIZE) continue;
      const k = ker[(dz + radius) * side + dx + radius];
      if (k < 0) continue; // outside the circle: keep the area round, not square
      field[z * GRID_SIZE + x] += strength * k;
    }
  }
}
/** Falloff weight (1 - d/(r+1)) per offset of a (2r+1)² square; -1 outside the circle. */
const kernels = new Map<number, Float64Array>();
function kernel(r: number): Float64Array {
  let k = kernels.get(r);
  if (k) return k;
  const side = 2 * r + 1;
  k = new Float64Array(side * side);
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const d = Math.hypot(dx, dz);
    k[(dz + r) * side + dx + r] = d > r ? -1 : 1 - d / (r + 1);
  }
  kernels.set(r, k);
  return k;
}

/**
 * OASIS-S4 park falloff by ROAD distance d (0..PARK_ROAD_REACH road tiles):
 * bonus × (1 − 0.5 · (d / 12)²) → 100 % on the park's own street, ~90 % five
 * tiles down the road, 50 % at the far end of the reach. Same gentle shape
 * as the old square so existing towns feel the same next to their parks.
 */
export const parkRoadFalloff = (d: number) => 1 - 0.5 * (d / PARK_ROAD_REACH) ** 2;

// Scratch buffers reused by parkReach (one allocation per map size, not per park).
let roadD = new Int16Array(0), landD = new Int16Array(0), seen = new Int32Array(0), stamp = 0;
/** OASIS-S4: a park's own neighbourhood (land steps, any direction) that counts as distance 0. */
const PARK_NEIGHBOUR = 2;
const touchedRoad: number[] = [], touchedLand: number[] = [];

/**
 * OASIS-S4: everything one park tile (index `p`) reaches, as tile → road
 * distance (0..PARK_ROAD_REACH). Modelled on garbage's "served by road
 * network" idea, but with a distance limit:
 *
 *  0. THE PARK'S BLOCK: lots within 2 land steps of the park get distance
 *     0; the first road straight out from the park (≤ PARK_FRONT_DEPTH land
 *     tiles) in each direction is where the road walk starts.
 *  1. ROAD BFS: start at those road tiles (distance 0)
 *     and walk road tiles (4-neighbour, bridges are road tiles too) up to
 *     PARK_ROAD_REACH steps. Water without a bridge, or a gap in the road,
 *     stops it — a park does not serve the far bank of a river.
 *  2. FRONTING LOTS: from every reached road tile, walk straight back into
 *     LAND (not road, not water) up to PARK_FRONT_DEPTH tiles in each
 *     direction — the lots of that street. A lot takes the SMALLEST road distance of
 *     any source that reaches it. Road tiles are included too (with their own
 *     distance) so the coverage overlay shows the reach along the street.
 *
 * A reached tile can be up to 4 + 12 + 4 tiles from the park, a little past
 * the active-chunk ring (chunks.ts A4) in the worst straight-line case; that
 * is harmless because tiles outside the ring hold no buildings (they are in
 * inactive chunks) and desirability there is DESIRE_BASE regardless.
 * Deterministic: BFS distances do not depend on visiting order.
 */
export function parkReach(world: World, p: number, out: (i: number, d: number) => void): void {
  const N = GRID_SIZE, tiles = world.tiles, n = tiles.length;
  if (roadD.length !== n) { roadD = new Int16Array(n).fill(-1); landD = new Int16Array(n).fill(-1); seen = new Int32Array(n); stamp = 0; }
  const nb = (i: number, f: (j: number) => void) => {
    const x = i % N, z = (i - x) / N;
    if (x > 0) f(i - 1); if (x < N - 1) f(i + 1); if (z > 0) f(i - N); if (z < N - 1) f(i + N);
  };
  // Straight walk from `i` in direction (dx, dz) over LAND for up to
  // PARK_FRONT_DEPTH tiles; calls `f` for each land tile, and returns the
  // road tile it bumps into (or -1). Lots on a tile road are laid out
  // straight back from the street, so "fronting" = straight behind the road.
  const ray = (i: number, dx: number, dz: number, f: ((j: number) => void) | null): number => {
    let x = i % N, z = (i - x) / N;
    for (let k = 1; k <= PARK_FRONT_DEPTH + 1; k++) {
      x += dx; z += dz;
      if (x < 0 || z < 0 || x >= N || z >= N) return -1;
      const j = z * N + x, t = tiles[j];
      if (t.road) return j;
      if (t.water || k > PARK_FRONT_DEPTH) return -1;
      f?.(j);
    }
    return -1;
  };
  const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const lot = (j: number, d: number) => {
    if (landD[j] < 0) { touchedLand.push(j); landD[j] = d; } else if (d < landD[j]) landD[j] = d;
  };
  // 0. The park's own block. Its direct neighbourhood (PARK_NEIGHBOUR land
  //    steps, any direction) counts as distance 0. The streets it fronts
  //    onto — the first road straight out from the park within
  //    PARK_FRONT_DEPTH land tiles, in each of the 4 directions, just like a
  //    lot that deep belongs to its street — start the road walk at 0, so a
  //    park in the middle of a block still reaches that block's streets.
  if (++stamp > 0x7ffffffe) { seen.fill(0); stamp = 1; }
  seen[p] = stamp; lot(p, 0);
  let blk = [p];
  for (let depth = 1; depth <= PARK_NEIGHBOUR && blk.length; depth++) {
    const nxt: number[] = [];
    for (const i of blk) nb(i, (j) => {
      const t = tiles[j];
      if (t.road || t.water || seen[j] === stamp) return;
      seen[j] = stamp; nxt.push(j); lot(j, 0);
    });
    blk = nxt;
  }
  for (const [dx, dz] of DIRS) {
    const r = ray(p, dx, dz, null);
    if (r >= 0 && roadD[r] < 0) { roadD[r] = 0; touchedRoad.push(r); }
  }
  // 1. road BFS (queue = touchedRoad, in distance order)
  for (let q = 0; q < touchedRoad.length; q++) {
    const i = touchedRoad[q], d = roadD[i];
    if (d >= PARK_ROAD_REACH) continue;
    nb(i, (j) => { if (tiles[j].road && roadD[j] < 0) { roadD[j] = d + 1; touchedRoad.push(j); } });
  }
  // 2. fronting lots: straight back from every reached road tile, each lot
  //    keeping the smallest road distance that reaches it.
  for (const r of touchedRoad) { const d = roadD[r]; for (const [dx, dz] of DIRS) ray(r, dx, dz, (j) => lot(j, d)); }
  // report and reset the scratch buffers
  for (const r of touchedRoad) { out(r, roadD[r]); roadD[r] = -1; }
  for (const j of touchedLand) { out(j, landD[j]); landD[j] = -1; }
  touchedRoad.length = 0; touchedLand.length = 0;
}

/** `service` (simulation net.service) lets land value count power/water. */
/** V1.6 A3: one tile's final step of computeLandValue (garbage + clamp), bit-identical. */
export function lvFinish(world: World, pre: number, garbage: number): number {
  if (Number.isNaN(pre)) return 0;
  const v = pre - LV_GARBAGE * Math.min(1, garbage / 60) * (world.peakPop < 1000 ? 0.3 : 1);
  return Math.max(0, Math.min(LV_MAX, v));
}

export function computeEnvironment(world: World, service?: TileService[], pre?: Float64Array): Environment {
  const n = world.tiles.length;
  const pollution = new Float32Array(n);
  const parks = new Float32Array(n);
  world.chunks.activeTilesSorted().forEach((i) => { const t = world.tiles[i]; // V1.6 A2: sources live in active chunks
    const x = i % GRID_SIZE, z = Math.floor(i / GRID_SIZE);
    if (t.structure === 'powerPlant' && !t.part) spread(pollution, x, z, PLANT_POLLUTION_RADIUS, PLANT_POLLUTION);
    else if (t.zone === 'industrial' && t.level > 0) spread(pollution, x, z, FACTORY_POLLUTION_RADIUS, FACTORY_POLLUTION_PER_LEVEL * t.level * (isFarmLot(world, i) ? 0.25 : 1) * pollutionMult(world, t)); // PR 5: farms pollute ¼; IND-3 filters
    else if (t.structure === 'park') parkReach(world, i, (j, d) => { parks[j] += PARK_BONUS * parkRoadFalloff(d); }); // OASIS-S4: along the roads
  });
  // V1.6 A4: outside the ring pollution and parks are 0 → desirability = DESIRE_BASE.
  const desirability = new Float32Array(n).fill(DESIRE_BASE);
  for (const i of world.chunks.ringTilesSorted()) {
    parks[i] = Math.min(PARK_BONUS_MAX, parks[i]);
    desirability[i] = DESIRE_BASE - POLLUTION_WEIGHT * pollution[i] + parks[i];
  }
  return { pollution, parks, desirability, ...computeLandValue(world, { pollution, parks }, service, pre) };
}
