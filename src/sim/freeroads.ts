/**
 * sim/freeroads.ts — V1.6 B6/B7: FREEFORM ROADS in the running game.
 *
 * The world keeps a RoadGraph of the roads drawn with the free road tool
 * (straight at any angle, curves, freeform drags) and the ZONE BLOCKS
 * generated off them. As explained in roads/bridge.ts the tile systems
 * keep running: every graph edge is RASTERISED onto road tiles (paid and
 * built with the ordinary road/avenue tool rules), which are remembered in
 * `world.graphTiles` so the tile renderer leaves them to the smooth graph
 * mesh (render/graphRoads.ts).
 *
 * Grid roads join up naturally: an end dropped on a tile road snaps to
 * that tile's centre, and rasterising puts the curve's tiles next to it.
 *
 * placeFreeRoad() is used twice per drag: dry-run every frame for the
 * preview (reason, cost, tiles, buildings it would demolish) and for real
 * on release. Every committed operation pushes an UNDO record (graph
 * snapshot + tiles it turned into road + cash), and zoning paints by
 * block push one too (old cell codes).
 */
import { Cubic, V2 } from '../roads/bezier';
import { PlaceOptions, RoadGraph, RoadType, TILE_M } from '../roads/graph';
import { ZoneBlocks, ZoneCell } from '../roads/blocks';
import { gridCellOf, rasterizeRoads, syncKerbFill } from '../roads/bridge';
import { canPlace } from './rules';
import { placementCost } from './economy';
import { tileHasCells } from './growth';
import { refreshTileZone } from './lots';
import { ownedAt } from './regions';
import { GRID_SIZE } from './types';
import type { Simulation } from './simulation';

export interface FreePlan {
  ok: boolean; reason?: string;
  /** New road tiles (index) the edge rasterises to. */
  tiles: number[];
  cost: number;
  /** Tiles with buildings that would be demolished (needs confirm). */
  demolish: number[];
  /** Snapped curve actually placed. */
  curve: Cubic;
}

/** Snap a point (metres) to the centre of a tile road it lies on, else keep it. */
export function snapToTileRoad(sim: Simulation, p: V2): V2 {
  const tx = Math.floor(p.x / TILE_M), tz = Math.floor(p.z / TILE_M);
  if (tx < 0 || tz < 0 || tx >= GRID_SIZE || tz >= GRID_SIZE) return p;
  const i = tz * GRID_SIZE + tx;
  if (sim.world.tiles[i].road && !sim.world.graphTiles.has(i)) return { x: (tx + 0.5) * TILE_M, z: (tz + 0.5) * TILE_M };
  return p;
}

/** Clone a graph (undo snapshots, dry runs). */
export function cloneGraph(g: RoadGraph): RoadGraph {
  const h = new RoadGraph();
  const map = new Map<number, number>();
  for (const n of g.liveNodes()) { const m = h.addNode(g.nodePos(n), g.nKind[n]); map.set(n, m); }
  for (const e of g.liveEdges().sort((a, b) => g.eBorn[a] - g.eBorn[b])) { const k = h.addEdge(map.get(g.eA[e])!, map.get(g.eB[e])!, g.eCurve[e], g.eType[e]); h.eBorn[k] = g.eBorn[e]; }
  return h;
}

/**
 * Plan (and with commit = true, build) a free road along cubic c.
 * `confirm` allows demolishing buildings in the way.
 */
export function placeFreeRoad(sim: Simulation, c0: Cubic, type: RoadType, opts: PlaceOptions = {}, commit = false, confirm = false): FreePlan {
  const w = sim.world;
  const c = Float64Array.from(c0);
  if (!opts.noSnap) {
    const a = snapToTileRoad(sim, { x: c[0], z: c[1] }), b = snapToTileRoad(sim, { x: c[6], z: c[7] });
    c[2] += a.x - c[0]; c[3] += a.z - c[1]; c[0] = a.x; c[1] = a.z;
    c[4] += b.x - c[6]; c[5] += b.z - c[7]; c[6] = b.x; c[7] = b.z;
  }
  const fail = (reason: string): FreePlan => ({ ok: false, reason, tiles: [], cost: 0, demolish: [], curve: c });
  // Validate on a scratch copy so the dry run never touches the world.
  const trial = cloneGraph(w.roads);
  const r = trial.placeRoad(c, type, opts);
  if (!r.ok) return fail(r.reason!);
  const before = new Set(rasterizeRoads(w.roads).keys());
  const tool = type === 'avenue' ? 'avenue' : 'road';
  const tiles: number[] = [], demolish: number[] = [];
  let cost = 0;
  for (const [i] of rasterizeRoads(trial)) {
    if (before.has(i)) continue;
    const t = w.tiles[i], x = i % GRID_SIZE, z = Math.floor(i / GRID_SIZE);
    if (!ownedAt(w, x, z)) return fail('Outside the land you own');
    if (t.road) continue; // joins an existing grid road
    if (tileHasCells(sim, x, z)) { demolish.push(i); }
    else if (!canPlace(tool, t)) return fail(t.water ? 'Free roads cannot bridge water yet' : 'Blocked by a structure');
    tiles.push(i); cost += placementCost(tool, t);
  }
  if (cost > w.cash) return { ok: false, reason: 'Not enough money', tiles, cost, demolish, curve: c };
  if (demolish.length && !confirm) return { ok: false, reason: `Will demolish ${demolish.length} building tile${demolish.length > 1 ? 's' : ''} — release to confirm`, tiles, cost, demolish, curve: c };
  if (commit) {
    pushUndo(sim, { kind: 'road', graph: cloneGraph(w.roads), tiles, cash: w.cash, graphTiles: new Set(w.graphTiles) });
    if (demolish.length) sim.apply('bulldoze', demolish.map((i) => [i % GRID_SIZE, Math.floor(i / GRID_SIZE)]));
    w.roads.placeRoad(c, type, opts);
    w.graphRoads = true; // OASIS: a free road makes this a graph world (tile roads join the graph from now on)
    // OASIS: these tiles are the RASTER of the free road just placed — they must
    // not be re-absorbed as straight tile-road runs (absorbTileRoads), which
    // would lay a staircase of tiny edges over the curve.
    sim.noAbsorb = true;
    try { sim.apply(tool, tiles.map((i) => [i % GRID_SIZE, Math.floor(i / GRID_SIZE)])); } finally { sim.noAbsorb = false; }
    for (const i of tiles) if (w.tiles[i].road) w.graphTiles.add(i);
    w.blocks.regenerate(w.roads);
  }
  return { ok: true, tiles, cost, demolish, curve: c };
}

/* ---------------- zoning by block (B7 brush) ---------------- */

/**
 * Paint zone code `code` (0 = erase) on block cells around point p: the
 * cells within `brush` cells (8 m each) of p, `depth` rows deep from the
 * road (fill-to-depth). Writes the grid cells the sim grows on. Returns the
 * number of cells changed.
 */
export function paintBlocks(sim: Simulation, p: V2, code: number, brush = 1, depth = 4): number {
  const w = sim.world, zb = w.blocks;
  const hit = zb.cellAt(p);
  if (!hit) return 0;
  const old: Array<[number, number]> = [];
  let n = 0;
  for (const c of zb.cells) {
    if (c.edge !== hit.edge || c.side !== hit.side) continue;
    if (Math.abs(c.col - hit.col) >= brush || c.row >= depth) continue;
    const k = gridCellOf(c);
    if (k < 0 || w.cells.owner[k] !== 0) continue;
    if (w.cells.zone[k] === code) continue;
    old.push([k, w.cells.zone[k]]);
    c.code = code; w.cells.zone[k] = code; n++;
    const cx = k % (GRID_SIZE * 4), cz = Math.floor(k / (GRID_SIZE * 4));
    w.lots.markAround(Math.floor(cx / 4), Math.floor(cz / 4));
  }
  if (n) { fillKerb(sim, old); pushUndo(sim, { kind: 'zone', cells: old }); sim.version++; }
  return n;
}

/** Close the kerb-row gaps next to the cells just painted (roads/bridge.ts syncKerbFill); adds them to the undo list. */
function fillKerb(sim: Simulation, old: Array<[number, number]>): void {
  const tiles = new Set<number>();
  const W = GRID_SIZE * 4;
  for (const [k] of old) tiles.add(Math.floor(Math.floor(k / W) / 4) * GRID_SIZE + Math.floor((k % W) / 4));
  const seen = new Set(old.map(([k]) => k));
  for (const ch of syncKerbFill(sim.world, sim.world.blocks, tiles)) if (!seen.has(ch[0])) { seen.add(ch[0]); old.push(ch); }
  retag(sim, old.map(([k]) => k));
}

/**
 * A tile only joins the growth, power and water systems once tile.zone says
 * it is zoned (the tile zoning tools set it; block painting writes only the
 * cell grid). Without this, cells painted on a freeform road's blocks never
 * grew buildings and never showed up as consumers on the power / water grids
 * ("zoned but nothing happens", "not enough capacity"). Re-derive tile.zone
 * from the cells for every tile the cells touch, wake the growth queue and
 * re-solve the networks.
 */
export function retag(sim: Simulation, cells: number[]): void {
  const w = sim.world, W = GRID_SIZE * 4, tiles = new Set<number>();
  for (const k of cells) tiles.add(Math.floor(Math.floor(k / W) / 4) * GRID_SIZE + Math.floor((k % W) / 4));
  for (const i of tiles) {
    const t = w.tiles[i];
    if (!t.road && !t.water && !w.lots.hostedOn(i).length) refreshTileZone(w, i);
    w.chunks.touch(i);
    w.lots.markAround(i % GRID_SIZE, Math.floor(i / GRID_SIZE));
  }
  if (tiles.size) { sim.net = sim.refreshNet(); sim.version++; }
}

/**
 * Zone cells a drag from a to b (metres) would paint: every free block cell
 * whose centre lies in the axis-aligned rectangle between the two points
 * (plus the cells under the two points themselves, so a plain click still
 * takes one cell), at most `depthRows` rows deep from the road.
 */
export function cellsInRect(sim: Simulation, a: V2, b: V2, depthRows = 16): ZoneCell[] {
  const w = sim.world, x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  const out = new Set<ZoneCell>();
  for (const c of w.blocks.cells) {
    if (c.row >= depthRows || c.cx < x0 || c.cx > x1 || c.cz < z0 || c.cz > z1) continue;
    out.add(c);
  }
  for (const p of [a, b]) { const c = w.blocks.cellAt(p); if (c && c.row < depthRows) out.add(c); }
  return [...out].filter((c) => { const k = gridCellOf(c); return k >= 0 && w.cells.owner[k] === 0; });
}

/** Paint zone code on exactly these cells (one undo step). Returns how many changed. */
export function paintCells(sim: Simulation, cells: ZoneCell[], code: number): number {
  const w = sim.world, old: Array<[number, number]> = [];
  for (const c of cells) {
    const k = gridCellOf(c);
    if (k < 0 || w.cells.owner[k] !== 0 || w.cells.zone[k] === code) continue;
    old.push([k, w.cells.zone[k]]);
    c.code = code; w.cells.zone[k] = code;
    const cx = k % (GRID_SIZE * 4), cz = Math.floor(k / (GRID_SIZE * 4));
    w.lots.markAround(Math.floor(cx / 4), Math.floor(cz / 4));
  }
  const painted = old.length;
  if (painted) { fillKerb(sim, old); pushUndo(sim, { kind: 'zone', cells: old }); sim.version++; }
  return painted;
}

/* ---------------- undo / redo ---------------- */
type UndoRec =
  | { kind: 'road'; graph: RoadGraph; tiles: number[]; cash: number; graphTiles: Set<number> }
  | { kind: 'zone'; cells: Array<[number, number]> };
const undoStacks = new WeakMap<Simulation, { undo: UndoRec[]; redo: UndoRec[] }>();
const stacks = (sim: Simulation) => { let s = undoStacks.get(sim); if (!s) { s = { undo: [], redo: [] }; undoStacks.set(sim, s); } return s; };
function pushUndo(sim: Simulation, r: UndoRec): void { const s = stacks(sim); s.undo.push(r); if (s.undo.length > 50) s.undo.shift(); s.redo.length = 0; }
/** Swap the world with a record, returning the inverse record. */
function swap(sim: Simulation, r: UndoRec): UndoRec {
  const w = sim.world;
  if (r.kind === 'zone') {
    const inv: Array<[number, number]> = r.cells.map(([k]) => [k, w.cells.zone[k]]);
    for (const [k, code] of r.cells) if (w.cells.owner[k] === 0) w.cells.zone[k] = code;
    retag(sim, r.cells.map(([k]) => k));
    sim.version++;
    return { kind: 'zone', cells: inv };
  }
  const inv: UndoRec = { kind: 'road', graph: cloneGraph(w.roads), tiles: r.tiles, cash: w.cash, graphTiles: new Set(w.graphTiles) };
  // Road tiles that the record did not have become plain land again, and back.
  const nowRoad = new Set(r.tiles.filter((i) => w.tiles[i].road));
  for (const i of r.tiles) {
    const t = w.tiles[i];
    const want = r.graphTiles.has(i);
    if (want && !t.road) { t.road = true; t.waterPipe = true; t.roadType = 0; }
    else if (!want && nowRoad.has(i) && w.graphTiles.has(i)) { t.road = false; t.waterPipe = false; t.roadType = 0; }
  }
  w.roads = r.graph; w.graphTiles = r.graphTiles; w.cash = r.cash;
  w.blocks.regenerate(w.roads);
  for (const i of r.tiles) w.lots.markAround(i % GRID_SIZE, Math.floor(i / GRID_SIZE));
  sim.net = sim.refreshNet(); sim.version++;
  return inv;
}
export function undo(sim: Simulation): boolean { const s = stacks(sim); const r = s.undo.pop(); if (!r) return false; s.redo.push(swap(sim, r)); return true; }
export function redo(sim: Simulation): boolean { const s = stacks(sim); const r = s.redo.pop(); if (!r) return false; s.undo.push(swap(sim, r)); return true; }
export function undoDepth(sim: Simulation): [number, number] { const s = stacks(sim); return [s.undo.length, s.redo.length]; }
export { ZoneBlocks };
