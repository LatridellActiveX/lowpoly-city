/**
 * NEBULA — rectangle zoning on the small cells (the ONLY way to zone).
 *
 * Parker's rules:
 *  1. Zoning is a rectangle dragged from one corner (mouse-down point) to the
 *     opposite corner (current / mouse-up point). A single click is a 1×1 box.
 *  2. There are no other zoning modes: no road-following depth strips, no
 *     brushes, no alternate drags or modifier keys.
 *  3. The box snaps to the SMALL-cell grid (quarter tiles, 8 m, axis-aligned
 *     with the world grid) and zones every zonable small cell inside it — on
 *     tile roads and along curved graph-road blocks alike.
 *
 * Which cells a box zones (planRect):
 *  - grid cells inside the snapped box whose tile is zonable (canPlace: bare
 *    land or an existing zone, not road / water / structure / farm field) and
 *    within ZONE_REACH tiles of a road tile ("too far from a road" is skipped);
 *  - graph block cells (curved roads' zone cells) whose CENTRE falls inside the
 *    box, via the grid cell under that centre (the cell the sim grows on);
 *  - never a cell owned by a building / lot (owner != 0).
 * Everything else inside the box is reported as `skipped` so the preview can
 * paint it red. paintRect then paints exactly `zone` through paintCells (same
 * undo, kerb-row fill and re-tagging as before); zoneDryRun returns exactly the
 * squares mouse-up will change — the preview draws and counts those.
 *
 * TWO FRAMES (Parker, after 235655a on his free-road save): on a FREE-FORM road
 * (curved or angled graph edge) the rectangle lives in that road's own frame —
 * columns ALONG the road × rows AWAY from it — and snaps to the road's block
 * cells, so a drag beside a 30° road zones a strip parallel to it, not a
 * world-axis staircase. The anchor (mouse-down) picks the frame: the block cell
 * under it, or — when it is on the road surface / kerb — the nearest block cell
 * on the side the drag goes to (within ANCHOR_SNAP_M). World-axis small-cell
 * boxes are used only for grid (axis-aligned) tile roads and open land.
 *
 * Coordinates: a, b are fractional TILE coordinates of the ground pick
 * (ui/input.ts `pointer`), the same at every camera angle.
 */
import type { ZoneCell } from '../roads/blocks';
import { gridCellOf } from '../roads/bridge';
import { BUILD_COST } from './economy';
import { paintCells, zoneDryRun } from './freeroads';
import { canPlace } from './rules';
import { isStraight } from '../roads/graph';
import type { Simulation } from './simulation';
import { GRID_SIZE, ToolId } from './types';

/** Small cells per tile side. */
export const CPT = 4;
/** Metres per small cell (TILE_M 32 / 4). */
const CELL_M = 8;
/** A tile is zonable only if a road tile is within this many tiles (Chebyshev). */
export const ZONE_REACH = 3;

/** The snapped box, inclusive small-cell coordinates. */
export interface CellBox { cx0: number; cz0: number; cx1: number; cz1: number }

/** Snap the two corner points (tile units) to the small-cell grid, clamped to the map. */
export function snapBox(a: { x: number; z: number }, b: { x: number; z: number }): CellBox {
  const n = GRID_SIZE * CPT, c = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v * CPT)));
  const ax = c(a.x), az = c(a.z), bx = c(b.x), bz = c(b.z);
  return { cx0: Math.min(ax, bx), cz0: Math.min(az, bz), cx1: Math.max(ax, bx), cz1: Math.max(az, bz) };
}

/** How far (m) from the mouse-down point a road-frame anchor cell may be (≈ avenue half-width + kerb + setback + a cell; 20 m missed starts on the road centre). */
export const ANCHOR_SNAP_M = 28;

export interface RectPlan {
  box: CellBox;
  /** 'road' = in a free-form road's frame (cols along × rows away); 'grid' = world-axis small cells. */
  mode: 'road' | 'grid';
  /** Size of the box in cells: cols × rows ('road') or x × z ('grid'). */
  size: [number, number];
  /** Cells to paint (real block cells where one sits on the grid cell, else a grid-cell stand-in). */
  zone: ZoneCell[];
  /** Grid keys inside the box that will NOT be zoned (road, water, building, too far…). */
  skipped: number[];
  /** Road mode: the skipped block cells themselves (drawn red in the road's frame). */
  skippedCells: ZoneCell[];
}

/** Is a road tile within ZONE_REACH of tile (x, z)? Cached per call via `memo`. */
function nearRoad(sim: Simulation, x: number, z: number, memo: Map<number, boolean>): boolean {
  const i = z * GRID_SIZE + x, m = memo.get(i);
  if (m !== undefined) return m;
  let r = false;
  for (let dz = -ZONE_REACH; dz <= ZONE_REACH && !r; dz++) for (let dx = -ZONE_REACH; dx <= ZONE_REACH && !r; dx++) {
    const nx = x + dx, nz = z + dz;
    if (nx >= 0 && nz >= 0 && nx < GRID_SIZE && nz < GRID_SIZE && sim.world.tiles[nz * GRID_SIZE + nx].road) r = true;
  }
  memo.set(i, r);
  return r;
}

/** Is graph edge e an axis-aligned straight (a grid tile road)? Those keep world-axis boxes. */
export function axisEdge(sim: Simulation, e: number): boolean {
  const c = sim.world.roads.eCurve[e];
  if (!isStraight(c, 1e-3)) return false;
  return Math.abs(c[6] - c[0]) < 0.5 || Math.abs(c[7] - c[1]) < 0.5;
}

/** Cells of block (edge, side) — the road-frame grid. */
function blockCells(sim: Simulation, edge: number, side: number): ZoneCell[] {
  return sim.world.blocks.cells.filter((c) => c.edge === edge && c.side === side);
}

function nearest(cells: ZoneCell[], p: { x: number; z: number }): { c: ZoneCell | null; d: number } {
  let best: ZoneCell | null = null, bd = Infinity;
  for (const c of cells) { const d = Math.hypot(c.cx - p.x, c.cz - p.z); if (d < bd) { bd = d; best = c; } }
  return { c: best, d: bd };
}

/**
 * The road-frame anchor for a drag from a to b (tile units), or null for a world-axis box.
 * a on a free-form road's block cell → that cell. a on the road / kerb → the nearest
 * cell (≤ ANCHOR_SNAP_M) of the block on the side b lies on (the side being dragged to).
 */
export function roadAnchor(sim: Simulation, a: { x: number; z: number }, b: { x: number; z: number }): ZoneCell | null {
  const zb = sim.world.blocks, am = { x: a.x * 32, z: a.z * 32 }, bm = { x: b.x * 32, z: b.z * 32 };
  const under = zb.cellAt(am);
  if (under) return axisEdge(sim, under.edge) ? null : under;
  // On the road / kerb: which block? the one the far corner points into (or, for a
  // click, the nearest one), whose nearest cell must be close to the anchor.
  // The road under / nearest the anchor decides the frame (not merely the nearest
  // cell, which near a junction can belong to the crossing grid road's block).
  const g = sim.world.roads;
  let e = -1, ed = Infinity;
  for (const id of g.liveEdges()) {
    const c = g.eCurve[id];
    for (let i = 0; i <= 32; i++) {
      const t = i / 32, u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
      const d = Math.hypot(b0 * c[0] + b1 * c[2] + b2 * c[4] + b3 * c[6] - am.x, b0 * c[1] + b1 * c[3] + b2 * c[5] + b3 * c[7] - am.z);
      if (d < ed) { ed = d; e = id; }
    }
  }
  const near = e >= 0 ? nearest(sim.world.blocks.cells.filter((c) => c.edge === e), am) : nearest(zb.cells, am);
  if (!near.c || near.d > ANCHOR_SNAP_M) return null;
  let pick = near.c;
  if (Math.hypot(bm.x - am.x, bm.z - am.z) > 4) {
    const sides = [0, 1].map((sd) => nearest(blockCells(sim, e, sd), am));
    // the side whose anchor cell lies on b's side of the anchor point
    const dot = (c: ZoneCell) => (c.cx - am.x) * (bm.x - am.x) + (c.cz - am.z) * (bm.z - am.z);
    const ok = sides.filter((s) => s.c && s.d <= ANCHOR_SNAP_M && dot(s.c) > 0).sort((p, q) => p.d - q.d)[0];
    if (ok?.c) pick = ok.c;
  }
  return axisEdge(sim, pick.edge) ? null : pick;
}

/** Shared zonability test for a block cell (grid cell under its centre). */
function blockZonable(sim: Simulation, c: ZoneCell): number {
  const w = sim.world, W = GRID_SIZE * CPT, k = gridCellOf(c);
  if (k < 0 || w.cells.owner[k] !== 0) return -1;
  const t = w.tiles[Math.floor(Math.floor(k / W) / CPT) * GRID_SIZE + Math.floor((k % W) / CPT)];
  if (t.water || t.farm > 0 || (t.structure !== 'none' && t.structure !== 'building')) return -1;
  return k;
}

/** Work out what a box from a to b zones with `tool` (no side effects). */
export function planRect(sim: Simulation, tool: ToolId, a: { x: number; z: number }, b: { x: number; z: number }): RectPlan {
  const w = sim.world, box = snapBox(a, b), W = GRID_SIZE * CPT;
  const zone = new Map<number, ZoneCell>();
  const anc = roadAnchor(sim, a, b);
  if (anc) {
    // ---- road frame: cols along × rows away, on the anchor's block ----
    const cells = blockCells(sim, anc.edge, anc.side);
    const far = nearest(cells, { x: b.x * 32, z: b.z * 32 }).c ?? anc;
    const c0 = Math.min(anc.col, far.col), c1 = Math.max(anc.col, far.col), r0 = Math.min(anc.row, far.row), r1 = Math.max(anc.row, far.row);
    // Every block cell in the range is listed (two block cells can share one grid cell
    // on a tight curve: both must get the code so the road-frame drawing stays whole).
    const skipped: number[] = [], inZone: ZoneCell[] = [];
    for (const c of cells) {
      if (c.col < c0 || c.col > c1 || c.row < r0 || c.row > r1) continue;
      const k = blockZonable(sim, c);
      if (k >= 0) inZone.push(c); else if (gridCellOf(c) >= 0) skipped.push(gridCellOf(c));
    }
    return { box, mode: 'road', size: [c1 - c0 + 1, r1 - r0 + 1], zone: inZone, skipped, skippedCells: cells.filter((c) => c.col >= c0 && c.col <= c1 && c.row >= r0 && c.row <= r1 && blockZonable(sim, c) < 0) };
  }
  // 1. curved / graph block cells whose centre is inside the box
  const x0 = box.cx0 * CELL_M, x1 = (box.cx1 + 1) * CELL_M, z0 = box.cz0 * CELL_M, z1 = (box.cz1 + 1) * CELL_M;
  for (const c of w.blocks.cells) {
    if (c.cx < x0 || c.cx >= x1 || c.cz < z0 || c.cz >= z1) continue;
    const k = blockZonable(sim, c);
    if (k >= 0) zone.set(k, c);
  }
  // 2. plain grid cells of zonable tiles near a road
  const memo = new Map<number, boolean>(), skipped: number[] = [];
  for (let cz = box.cz0; cz <= box.cz1; cz++) for (let cx = box.cx0; cx <= box.cx1; cx++) {
    const k = cz * W + cx;
    if (zone.has(k)) continue;
    const tx = Math.floor(cx / CPT), tz = Math.floor(cz / CPT), t = w.tiles[tz * GRID_SIZE + tx];
    if (w.cells.owner[k] === 0 && canPlace(tool, t) && nearRoad(sim, tx, tz, memo)) {
      zone.set(k, { cx: (cx + 0.5) * CELL_M, cz: (cz + 0.5) * CELL_M, quad: square(cx, cz), code: 0 } as unknown as ZoneCell);
    } else skipped.push(k);
  }
  // Cells the kerb sync would immediately clear again (grid cells beside a graph road
  // that no block cell covers) are not really zonable: dry-run the paint and move any
  // candidate that would not end up zoned to `skipped`, so the preview shows it red
  // and nothing in the box is silently dropped.
  let cand = [...zone.values()];
  if (cand.length) {
    const dry = new Set(zoneDryRun(sim, cand, PROBE).keys), keep: ZoneCell[] = [];
    for (const c of cand) { const k = gridCellOf(c); if (dry.has(k) || w.cells.zone[k] === PROBE) keep.push(c); else if (k % W >= box.cx0 && k % W <= box.cx1 && Math.floor(k / W) >= box.cz0 && Math.floor(k / W) <= box.cz1) skipped.push(k); }
    cand = keep;
  }
  return { box, mode: 'grid', size: [box.cx1 - box.cx0 + 1, box.cz1 - box.cz0 + 1], zone: cand, skipped, skippedCells: [] };
}
/** Any zone code works for the "does it stick" probe (fills/clears don't depend on it). */
const PROBE = 1;

/** The axis-aligned quad of small grid cell (cx, cz), metres, corner order like ZoneCell.quad. */
export function square(cx: number, cz: number): Float64Array {
  const x = cx * CELL_M, z = cz * CELL_M;
  return new Float64Array([x, z, x + CELL_M, z, x + CELL_M, z + CELL_M, x, z + CELL_M]);
}

/** Exactly what mouse-up will change (grid keys) and its price. */
export function rectQuote(sim: Simulation, plan: RectPlan, code: number, tool: ToolId): { keys: number[]; fill: Float64Array[]; cost: number } {
  const dry = zoneDryRun(sim, plan.zone, code);
  return { ...dry, cost: Math.round((BUILD_COST[tool as 'residential'] ?? 0) * dry.keys.length / 16) };
}

/** Paint the box. Returns cells changed, or why nothing happened. */
export function paintRect(sim: Simulation, tool: ToolId, plan: RectPlan, code: number): { changed: number; spent: number; broke?: boolean; locked?: boolean } {
  if (tool === 'residential' && sim.zoneOpt.density >= 2 && sim.world.tier < 3) return { changed: 0, spent: 0, locked: true };
  const q = rectQuote(sim, plan, code, tool);
  if (!q.keys.length) return { changed: 0, spent: 0 };
  if (q.cost > sim.world.cash) return { changed: 0, spent: 0, broke: true };
  const n = paintCells(sim, plan.zone, code);
  sim.world.cash -= q.cost; sim.world.ledger.construction += q.cost;
  return { changed: n ? q.keys.length : 0, spent: q.cost };
}
