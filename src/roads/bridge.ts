/**
 * roads/bridge.ts — V1.6 B3/B8: between the ROAD GRAPH and the TILE world.
 *
 * The plan has the graph and zone blocks replace the tile/cell grid. The
 * simulation (networks, traffic, growth, lots, services…) is ~10k lines of
 * tile/cell code, so 1.6 does it in two steps:
 *   1. the graph is the SOURCE OF TRUTH for roads and the zone blocks for
 *      where zoning may go;
 *   2. both are RASTERISED back onto the tile/cell grid the systems read
 *      (rasterizeRoads, writeBlockCodes), and grid saves/towns are traced
 *      INTO a graph (traceRoads, readBlockCodes).
 * Grid-aligned roads round-trip exactly (tile centres × 32 m; blocks land on
 * the 8 m cell grid with the 16 m setback), so 1.5 towns behave identically
 * (tools/blockbridge.test.ts runs both side by side). Curved roads
 * rasterise to the tiles their centreline crosses (4-connected).
 *
 * This file also has the BLOCK-SPACE LOT helpers (B3): runs of columns a
 * template fits in, the curved-run rule and the frame (position + heading)
 * a building on a curve is drawn with.
 */
import { at, tAtLength, V2 } from './bezier';
import { isStraight, RoadGraph, RoadType, TILE_M, CELL_M } from './graph';
import { ZoneBlock, ZoneBlocks, ZoneCell } from './blocks';
import { CELLS_PER_TILE, CELL_GRID, cidx } from '../sim/cells';
import { GRID_SIZE } from '../sim/types';
import type { World } from '../sim/grid';

const ROAD_OF: Record<number, RoadType> = { 0: 'street', 1: 'avenue', 2: 'street' };
/** Tile centre in metres. */
export const tileCentre = (i: number): V2 => ({ x: ((i % GRID_SIZE) + 0.5) * TILE_M, z: (Math.floor(i / GRID_SIZE) + 0.5) * TILE_M });

/**
 * B8: TRACE tile roads into a graph. A road tile is a NODE when it is not a
 * straight pass-through (dead end, bend, T, +, the map-edge connection or a
 * change of road type); the straight runs between nodes become one edge
 * each (a degenerate cubic between the tile centres). Returns the graph and
 * the node of every node tile.
 */
export function traceRoads(world: World): { g: RoadGraph; nodeOf: Map<number, number> } {
  return traceTiles(world, (t) => t.road);
}
/**
 * B5: the same tracing for any tile set — power lines and pipes become a
 * UTILITY graph with traceTiles(world, t => t.powerLine && !t.road).
 */
export function traceTiles(world: World, on: (t: World['tiles'][number]) => boolean): { g: RoadGraph; nodeOf: Map<number, number> } {
  const N = GRID_SIZE, t = world.tiles, g = new RoadGraph();
  const road = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N && on(t[z * N + x]);
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
  const isNode = (i: number): boolean => {
    const x = i % N, z = Math.floor(i / N);
    const nb = dirs.map(([dx, dz]) => road(x + dx, z + dz));
    const k = nb.filter(Boolean).length;
    if (k !== 2 || t[i].edge) return true;
    if (!((nb[0] && nb[2]) || (nb[1] && nb[3]))) return true; // bend
    // Change of type along the run ends an edge.
    const [dx, dz] = nb[0] ? dirs[0] : dirs[1];
    return t[(z + dz) * N + x + dx].roadType !== t[i].roadType || t[(z - dz) * N + x - dx].roadType !== t[i].roadType;
  };
  const nodeOf = new Map<number, number>();
  for (let i = 0; i < N * N; i++) if (on(t[i]) && isNode(i)) nodeOf.set(i, g.addNode(tileCentre(i)));
  // Walk from every node in each direction to the next node.
  for (const [i, a] of nodeOf) {
    const x = i % N, z = Math.floor(i / N);
    for (const [dx, dz] of dirs.slice(0, 2)) { // +x and +z only: each run once
      if (!road(x + dx, z + dz)) continue;
      let cx = x + dx, cz = z + dz;
      while (!nodeOf.has(cz * N + cx)) { cx += dx; cz += dz; }
      const j = cz * N + cx, b = nodeOf.get(j)!;
      const type = ROAD_OF[t[i + (dz * N + dx)].roadType] ?? 'street';
      const pa = tileCentre(i), pb = tileCentre(j);
      g.addEdge(a, b, Float64Array.of(pa.x, pa.z, pa.x + (pb.x - pa.x) / 3, pa.z + (pb.z - pa.z) / 3, pa.x + (2 * (pb.x - pa.x)) / 3, pa.z + (2 * (pb.z - pa.z)) / 3, pb.x, pb.z), type);
    }
  }
  return { g, nodeOf };
}

/**
 * RASTERISE the graph's roads onto tiles: every tile the centreline of an
 * edge passes through, 4-connected (a diagonal step adds the tile on the
 * inside of the turn). Returns tile index → road type (0 street, 1 avenue).
 */
export function rasterizeRoads(g: RoadGraph): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of g.liveEdges()) for (const [i, type] of edgeTiles(g, e)) out.set(i, Math.max(out.get(i) ?? 0, type));
  return out;
}
/** B8: the tiles one edge rasterises onto (tile index → 0 street / 1 avenue). */
export function edgeTiles(g: RoadGraph, e: number): Map<number, number> {
  const N = GRID_SIZE, out = new Map<number, number>();
  const put = (tx: number, tz: number, type: number) => { if (tx >= 0 && tz >= 0 && tx < N && tz < N) { const i = tz * N + tx; out.set(i, Math.max(out.get(i) ?? 0, type)); } };
  const type = g.eType[e] === 'avenue' || g.eType[e] === 'highway' ? 1 : 0, c = g.eCurve[e], lut = g.eLut[e], len = g.eLen[e];
  let px = -1, pz = -1;
  for (let s = 0; s <= len + 4; s += 4) {
    const p = isStraight(c) ? { x: c[0] + (c[6] - c[0]) * Math.min(1, s / len), z: c[1] + (c[7] - c[1]) * Math.min(1, s / len) } : at(c, tAtLength(lut, Math.min(s, len)));
    const tx = Math.floor(p.x / TILE_M), tz = Math.floor(p.z / TILE_M);
    if (px >= 0 && tx !== px && tz !== pz) put(tx, pz, type); // keep 4-connectivity
    put(tx, tz, type); px = tx; pz = tz;
  }
  return out;
}

/** Grid cell under a block cell's centre. */
export const gridCellOf = (c: ZoneCell): number => {
  const cx = Math.floor(c.cx / CELL_M), cz = Math.floor(c.cz / CELL_M);
  return cx >= 0 && cz >= 0 && cx < CELL_GRID && cz < CELL_GRID ? cidx(cx, cz) : -1;
};
/** B8 zones: copy the grid zone codes into the block cells (nearest = the cell under the centre). */
export function readBlockCodes(world: World, zb: ZoneBlocks): void {
  for (const c of zb.cells) { const k = gridCellOf(c); c.code = k >= 0 ? world.cells.zone[k] : 0; }
}
/**
 * B3 bridge: write block zone codes onto the grid cells the sim grows on.
 * Grid cells that are not under any block cell are cleared: land the roads
 * no longer give access to can't stay zoned (same as 1.5 unzoning cells
 * when a road is removed).
 */
export function writeBlockCodes(world: World, zb: ZoneBlocks): void {
  const keep = new Uint8Array(world.cells.zone.length);
  for (const c of zb.cells) { const k = gridCellOf(c); if (k >= 0) { world.cells.zone[k] = c.code; keep[k] = 1; } }
  for (let k = 0; k < keep.length; k++) if (!keep[k] && world.cells.owner[k] === 0) world.cells.zone[k] = 0;
}

/* ---------------- block-space lots (B3) ---------------- */

/** Max heading change (radians) across a run wider than CURVE_W columns. */
export const CURVE_MAX = (10 * Math.PI) / 180;
export const CURVE_W = 3;

/** Heading of block column `col`'s frontage (direction along the road, a→b). */
function colHeading(b: ZoneBlock, col: number): number | null {
  const c = b.cells.find((q) => q.col === col && q.row === 0);
  if (!c) return null;
  return Math.atan2(c.quad[3] - c.quad[1], c.quad[2] - c.quad[0]);
}
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/**
 * Column runs [c0, c0 + w) of block b where a w × d lot fits: every column
 * at least d deep with zoned (code ≠ 0, or any code if `code` < 0) free
 * cells, not filler-only (unless `filler`), and — for w > CURVE_W — a
 * heading change under CURVE_MAX across the run.
 */
export function blockRuns(b: ZoneBlock, w: number, d: number, opts: { code?: number; filler?: boolean } = {}): number[] {
  const free = (col: number) => {
    if (b.depth[col] < d) return false;
    for (const c of b.cells) if (c.col === col && c.row < d) {
      if (c.owner !== 0 || (c.filler && !opts.filler)) return false;
      if (opts.code !== undefined ? c.code !== opts.code : c.code === 0) return false;
    }
    return true;
  };
  const out: number[] = [];
  for (let c0 = 0; c0 + w <= b.n; c0++) {
    let okRun = true;
    for (let k = 0; k < w && okRun; k++) okRun = free(c0 + k);
    if (!okRun) continue;
    if (w > CURVE_W) { const h0 = colHeading(b, c0), h1 = colHeading(b, c0 + w - 1); if (h0 === null || h1 === null || angDiff(h0, h1) >= CURVE_MAX) continue; }
    out.push(c0);
  }
  return out;
}

/**
 * Frame of a lot on columns [c0, c0 + w): the frontage midpoint, the
 * heading along the road and the FRONT direction (unit vector from the lot
 * towards its road) — buildings are drawn facing `front`.
 */
export function lotFrame(b: ZoneBlock, c0: number, w: number): { pos: V2; heading: number; front: V2 } {
  const first = b.cells.find((q) => q.col === c0 && q.row === 0)!, last = b.cells.find((q) => q.col === c0 + w - 1 && q.row === 0)!;
  const pos = { x: (first.quad[0] + last.quad[2]) / 2, z: (first.quad[1] + last.quad[3]) / 2 };
  const heading = Math.atan2(last.quad[3] - first.quad[1], last.quad[2] - first.quad[0]);
  // Front = from the back corners towards the frontage.
  const bx = (first.quad[6] + last.quad[4]) / 2, bz = (first.quad[7] + last.quad[5]) / 2;
  const fx = pos.x - bx, fz = pos.z - bz, l = Math.hypot(fx, fz) || 1;
  return { pos, heading, front: { x: fx / l, z: fz / l } };
}

/** Claim the cells of a lot (owner id) — the block-space version of lots.stamp. */
export function claimLot(b: ZoneBlock, c0: number, w: number, d: number, owner: number): void {
  for (const c of b.cells) if (c.col >= c0 && c.col < c0 + w && c.row < d) c.owner = owner;
}

/**
 * Merge within a block (B3): the run covering every column of `ids` plus
 * free columns between them, if contiguous. Cross-block merges are not
 * allowed in 1.6. Returns [c0, w] or null.
 */
export function mergeRun(b: ZoneBlock, ids: number[]): [number, number] | null {
  const cols = b.cells.filter((c) => ids.includes(c.owner)).map((c) => c.col);
  if (!cols.length) return null;
  const c0 = Math.min(...cols), c1 = Math.max(...cols);
  for (let k = c0; k <= c1; k++) if (!b.cells.some((c) => c.col === k && c.row === 0 && (c.owner === 0 || ids.includes(c.owner)))) return null;
  return [c0, c1 - c0 + 1];
}

/** Cells per tile edge, re-exported for tests. */
export { CELLS_PER_TILE };
