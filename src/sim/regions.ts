/**
 * sim/regions.ts — V1.6 A6: REGIONS ON THE BIG MAP.
 *
 * The 128 and 192 maps are split into REGION × REGION (64 × 64) regions:
 * 2 × 2 or 3 × 3 of them. The classic 64 map is one region, always owned.
 *
 *   - At the start the player owns ONE region: the centre one (on a 2 × 2
 *     map, the one holding the map centre tile).
 *   - Building is only allowed in owned regions (Simulation.apply drops
 *     tiles elsewhere and says so in ApplyResult.region).
 *   - More regions are bought next to an owned one, once the city's peak
 *     population passes a threshold, for a price (both grow with each buy).
 *   - Unowned regions are not simulated: nothing can be built there, so
 *     their chunks hold nothing and never become active (sim/chunks.ts).
 *     The one exception is the HIGHWAY: on a big map the edge connection
 *     is extended from the map border to the start region (extendHighway),
 *     so the first town can export from day one. The trip end point (the
 *     `edge` tile) sits where the highway enters the start region.
 *
 * Ownership is a bitmask (`World.regionsOwned`, bit r = region r owned,
 * regions numbered row by row), saved in save v9.
 */
import { GRID_SIZE, Tile } from './types';

export const REGION = 64;
/** Peak population needed for the k-th purchase (k = regions already owned). */
export const REGION_POP = [0, 1500, 4000, 8000, 12000, 16000, 20000, 25000, 30000];
/** Price of the k-th purchase is REGION_PRICE × k. */
export const REGION_PRICE = 15000;

/** Regions per side for the current map size (1, 2 or 3). */
export const regionSide = (n = GRID_SIZE) => Math.max(1, Math.round(n / REGION));
/** Region index of tile (x, z). */
export const regionOf = (x: number, z: number) => Math.floor(z / REGION) * regionSide() + Math.floor(x / REGION);
/** The region a new city starts with. */
export function startRegion(n = GRID_SIZE): number {
  const s = regionSide(n), c = Math.floor(n / 2);
  return Math.floor(c / REGION) * s + Math.floor(c / REGION);
}
/** Bitmask with every region owned (the 64 map, old saves). */
export const allRegions = (n = GRID_SIZE) => (1 << (regionSide(n) ** 2)) - 1;

export interface RegionHolder { regionsOwned: number }
export const owns = (w: RegionHolder, r: number) => (w.regionsOwned & (1 << r)) !== 0;
export const ownedAt = (w: RegionHolder, x: number, z: number) => owns(w, regionOf(x, z));
export const ownedCount = (w: RegionHolder) => { let n = 0; for (let m = w.regionsOwned; m; m &= m - 1) n++; return n; };

/** Why region r can't be bought right now, or null if it can. */
export function buyBlocker(w: RegionHolder & { peakPop: number; cash: number }, r: number): string | null {
  const s = regionSide();
  if (r < 0 || r >= s * s) return 'No such region';
  if (owns(w, r)) return 'Already owned';
  const rx = r % s, rz = Math.floor(r / s);
  const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
    const x = rx + dx, z = rz + dz;
    return x >= 0 && z >= 0 && x < s && z < s && owns(w, z * s + x);
  });
  if (!next) return 'Must border a region you own';
  const k = ownedCount(w);
  if (w.peakPop < (REGION_POP[k] ?? Infinity)) return `Needs ${(REGION_POP[k] ?? 0).toLocaleString()} people`;
  if (w.cash < REGION_PRICE * k) return `Costs $${(REGION_PRICE * k).toLocaleString()}`;
  return null;
}
export const regionPrice = (w: RegionHolder) => REGION_PRICE * ownedCount(w);

/**
 * Big maps: continue the edge connection (mapgen placeEdgeConnection lays
 * EDGE_ROAD_LEN road tiles at the border) straight inward until it reaches
 * the start region, so the highway arrives where the player can build.
 * Water is bridged (a road tile over water is a bridge, as for player roads).
 */
export function extendHighway(tiles: Tile[], edge: number, n = GRID_SIZE): void {
  if (edge < 0 || regionSide(n) === 1) return;
  const ex = edge % n, ez = Math.floor(edge / n);
  const [dx, dz] = ex === 0 ? [1, 0] : ex === n - 1 ? [-1, 0] : ez === 0 ? [0, 1] : [0, -1];
  const start = startRegion(n), s = regionSide(n);
  const inStart = (x: number, z: number) => Math.floor(z / REGION) * s + Math.floor(x / REGION) === start;
  // Lay road up to AND including the first tile inside the start region.
  for (let x = ex, z = ez; x >= 0 && z >= 0 && x < n && z < n; x += dx, z += dz) {
    const t = tiles[z * n + x];
    t.road = true; t.deco = 0;
    if (inStart(x, z)) {
      // The trip end point ("edge" tile: exports leave, imports and
      // commuters arrive) moves to where the highway enters the player's
      // land. The road beyond stands for the regional highway; trips don't
      // drive its 64 tiles, so a town costs the same on any map size (T1).
      tiles[edge].edge = false;
      t.edge = true;
      break;
    }
  }
}
