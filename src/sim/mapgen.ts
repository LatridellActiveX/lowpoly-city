/**
 * sim/mapgen.ts — PR 4 map generation: a river or a lake on every map, and
 * the out-of-city road connection at the map edge.
 *
 * WATER
 * -----
 * A coin flip (a hash of the city seed, so it's the same every reload)
 * chooses a RIVER or a LAKE.
 *
 *  - RIVER: runs from one map edge to the opposite one. For every row we
 *    compute where the river's centre is:
 *        centre(r) = base + 6·sin(r / 9 + phase) + (noise − 0.5) · 6
 *    i.e. a gentle meander (the sine) plus some irregular wobble (noise).
 *    `base` is pushed 9–17 tiles off the map centre so the starting area
 *    stays dry. The river is 2–3 tiles wide.
 *  - LAKE: a blob centred 15–21 tiles from the map centre. A tile is water
 *    if its distance to the lake centre is below radius × (0.75 + 0.5·noise),
 *    so the shore is wobbly instead of a perfect circle.
 *
 * `onlyBare` is for migrating old saves: water is only added on tiles with
 * nothing built on them, so a player's town never ends up underwater.
 *
 * EDGE CONNECTION
 * ---------------
 * Traffic needs a way in and out of the city. We pick a map side (seeded),
 * then the row/column on that side closest to the middle whose first
 * EDGE_ROAD_LEN tiles are dry land, and lay a short road there. The outermost
 * tile is flagged `edge` (can't be bulldozed). See traffic.ts.
 */
import { GRID_SIZE, Tile } from './types';
import { fbm, hash2 } from './random';

/** How many road tiles the highway stub reaches into the map. */
export const EDGE_ROAD_LEN = 4;

export function generateWater(tiles: Tile[], seed: number, onlyBare: boolean): void {
  const N = GRID_SIZE;
  const c = N / 2;
  const isWater = new Uint8Array(N * N);
  if (hash2(1, 2, seed + 500) < 0.55) {
    // ---- River ----
    const vertical = hash2(3, 4, seed + 501) < 0.5; // flows north-south or east-west
    const side = hash2(5, 6, seed + 502) < 0.5 ? -1 : 1;
    const base = c + side * (9 + hash2(7, 8, seed + 503) * 8);
    const phase = hash2(9, 10, seed + 504) * Math.PI * 2;
    for (let r = 0; r < N; r++) {
      const centre = base + 6 * Math.sin(r / 9 + phase) + (fbm(r, 0, 6, seed + 505) - 0.5) * 6;
      const width = 2 + (fbm(r, 3, 8, seed + 506) > 0.5 ? 1 : 0);
      for (let k = 0; k < N; k++) {
        if (Math.abs(k - centre) <= width / 2) {
          const [x, z] = vertical ? [k, r] : [r, k];
          isWater[z * N + x] = 1;
        }
      }
    }
  } else {
    // ---- Lake ----
    const ang = hash2(11, 12, seed + 510) * Math.PI * 2;
    const dist = 15 + hash2(13, 14, seed + 511) * 6;
    const lx = c + Math.cos(ang) * dist;
    const lz = c + Math.sin(ang) * dist;
    const radius = 5 + hash2(15, 16, seed + 512) * 3;
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const wobble = 0.75 + 0.5 * fbm(x, z, 5, seed + 513);
        if (Math.hypot(x - lx, z - lz) < radius * wobble) isWater[z * N + x] = 1;
      }
  }
  tiles.forEach((t, i) => {
    if (!isWater[i]) return;
    const bare = !t.road && !t.powerLine && !t.waterPipe && t.zone === null && t.structure === 'none';
    if (onlyBare && !bare) return;
    t.water = true;
    t.deco = 0;
  });
}

/**
 * Lay the highway stub at a map edge. Returns the edge tile index, or -1 if
 * every candidate was blocked (only possible on migrated saves).
 * `allowBuilt` lets migration reuse an existing road at the edge.
 */
export function placeEdgeConnection(tiles: Tile[], seed: number): number {
  const N = GRID_SIZE;
  // Each side: map (along, inward) -> tile (x, z).
  const sides: Array<(a: number, k: number) => [number, number]> = [
    (a, k) => [k, a], // west edge, road heads east
    (a, k) => [N - 1 - k, a], // east edge
    (a, k) => [a, k], // north edge
    (a, k) => [a, N - 1 - k], // south edge
  ];
  const first = Math.floor(hash2(17, 18, seed + 520) * 4);
  for (let s = 0; s < 4; s++) {
    const toXZ = sides[(first + s) % 4];
    // Candidates ordered by distance from the middle: 32, 31, 33, 30, 34...
    for (let off = 0; off < N / 2 - 2; off++) {
      for (const a of [N / 2 - off, N / 2 + off + 1]) {
        let ok = true;
        for (let k = 0; k < EDGE_ROAD_LEN && ok; k++) {
          const [x, z] = toXZ(a, k);
          const t = tiles[z * N + x];
          // Free land, or a road that's already there (old saves).
          ok = !t.water && t.zone === null && t.structure === 'none';
        }
        if (!ok) continue;
        for (let k = 0; k < EDGE_ROAD_LEN; k++) {
          const [x, z] = toXZ(a, k);
          const t = tiles[z * N + x];
          t.road = true;
          t.deco = 0;
          t.edge = k === 0;
        }
        const [ex, ez] = toXZ(a, 0);
        return ez * N + ex;
      }
    }
  }
  return -1;
}
