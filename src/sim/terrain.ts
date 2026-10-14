/**
 * sim/terrain.ts — ground type and natural decorations (trees, bushes, rocks).
 *
 * The GROUND TYPE (grass / meadow / dirt / rocky) is never stored: it's
 * recomputed from seeded noise whenever it's needed, so it costs nothing in
 * the save file and is identical after every reload.
 *
 * DECORATIONS are stored on each tile (`tile.deco`) because the player can
 * remove them. They are generated once when a city is founded:
 *   - a "forest" noise field decides where trees cluster,
 *   - a per-tile hash decides whether this particular tile gets one, and which.
 *
 * Decorations never block anything. Building, zoning or laying a road on a
 * tile clears its decoration automatically for a small fee (see economy.ts).
 */
import { GRID_SIZE, Tile } from './types';
import { fbm, hash2 } from './random';

export type GroundType = 'grass' | 'meadow' | 'dirt' | 'rocky';

/** 0 = nothing. Numbers (not strings) keep the save file small. */
export enum Deco {
  None = 0,
  Pine = 1,
  Oak = 2,
  Birch = 3,
  Bush = 4,
  Rock = 5,
}

export function groundType(x: number, z: number, seed: number): GroundType {
  const patch = fbm(x, z, 9, seed + 7);
  if (patch > 0.78) return 'rocky';
  if (patch > 0.7) return 'dirt';
  return fbm(x, z, 14, seed + 3) > 0.55 ? 'meadow' : 'grass';
}

/** A small extra per-tile brightness wobble so grass isn't one flat colour. */
export function grassShade(x: number, z: number, seed: number): number {
  return fbm(x, z, 6, seed + 11) * 0.07 + hash2(x, z, seed + 13) * 0.015;
}

/** Choose the decoration for a tile in a brand-new city. */
export function decoFor(x: number, z: number, seed: number): Deco {
  const ground = groundType(x, z, seed);
  const forest = fbm(x, z, 11, seed + 23); // where woods cluster
  const r = hash2(x, z, seed + 29);
  if (ground === 'rocky') return r < 0.35 ? Deco.Rock : r < 0.45 ? Deco.Bush : Deco.None;
  if (ground === 'dirt') return r < 0.08 ? Deco.Rock : Deco.None;
  // Keep the middle of the map a little clearer so a first town fits easily.
  const c = GRID_SIZE / 2;
  const centre = Math.max(0, 1 - Math.hypot(x - c, z - c) / 14);
  const density = Math.max(0, forest - 0.45) * 2.2 - centre * 0.5;
  if (r < density) {
    const kind = hash2(x, z, seed + 31);
    // Pines on higher "forest" values, oaks and birches elsewhere.
    if (forest > 0.65) return kind < 0.75 ? Deco.Pine : Deco.Birch;
    return kind < 0.55 ? Deco.Oak : kind < 0.8 ? Deco.Birch : Deco.Pine;
  }
  if (r > 0.975) return Deco.Bush;
  if (r > 0.965) return Deco.Rock;
  return Deco.None;
}

/** Fill decorations on every completely empty tile (new city or v1 save). */
export function scatterDecorations(tiles: Tile[], seed: number): void {
  tiles.forEach((t, i) => {
    const bare = !t.water && !t.road && !t.powerLine && !t.waterPipe && t.zone === null && t.structure === 'none';
    t.deco = bare ? decoFor(i % GRID_SIZE, Math.floor(i / GRID_SIZE), seed) : Deco.None;
  });
}
