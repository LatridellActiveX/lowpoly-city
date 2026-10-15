/**
 * V1.6 B8: save / load of the freeform road layer (save v10).
 *
 * What is stored:
 *  - the road graph: live nodes (x, z, kind) and live edges (node indices
 *    into the stored node list, type, the 8 cubic control values), edges in
 *    creation order so tie-breaks (eBorn) replay identically;
 *  - graphTiles: the road tiles that belong to the graph (the tile renderer
 *    skips them, the graph renderer draws them).
 *
 * What is NOT stored: zone blocks. They are a pure function of the graph
 * (ZoneBlocks.regenerate is deterministic) and their codes / owners are
 * re-read from the grid cells the sim actually grows on (bridge
 * architecture, B3), so the cell layer stays the single source of truth.
 */
import { RoadGraph, NodeKind, RoadType } from './graph';
import { ZoneBlocks } from './blocks';
import { edgeTiles, gridCellOf, readBlockCodes, traceRoads } from './bridge';
import type { World } from '../sim/grid';

export interface SavedGraph {
  /** [x, z, kind] per node. */
  nodes: Array<[number, number, NodeKind]>;
  /** [a, b, type, c0..c7] per edge (a, b index `nodes`). */
  edges: Array<[number, number, RoadType, ...number[]]>;
}

/** Graph → plain JSON (rounded to mm so saves stay small and stable). */
export function saveGraph(g: RoadGraph): SavedGraph {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const idx = new Map<number, number>();
  const nodes: SavedGraph['nodes'] = [];
  for (const n of g.liveNodes()) { idx.set(n, nodes.length); nodes.push([r(g.nx[n]), r(g.nz[n]), g.nKind[n]]); }
  const edges: SavedGraph['edges'] = g.liveEdges().sort((a, b) => g.eBorn[a] - g.eBorn[b])
    .map((e) => [idx.get(g.eA[e])!, idx.get(g.eB[e])!, g.eType[e], ...Array.from(g.eCurve[e], r)]);
  return { nodes, edges };
}

/** Plain JSON → graph. Bad records are skipped rather than failing the load. */
export function loadGraph(s: SavedGraph | undefined): RoadGraph {
  const g = new RoadGraph();
  if (!s) return g;
  const ids = (s.nodes ?? []).map(([x, z, k]) => g.addNode({ x, z }, k));
  for (const [a, b, type, ...c] of s.edges ?? []) {
    if (ids[a] === undefined || ids[b] === undefined || c.length !== 8) continue;
    g.addEdge(ids[a], ids[b], Float64Array.from(c), type);
  }
  return g;
}

/** Rebuild blocks for the world's graph and copy codes + owners from the grid cells. */
export function rebuildBlocks(w: World): void {
  w.blocks = new ZoneBlocks();
  w.blocks.regenerate(w.roads);
  readBlockCodes(w, w.blocks);
  for (const c of w.blocks.cells) { const k = gridCellOf(c); c.owner = k >= 0 ? w.cells.owner[k] : 0; }
}

/**
 * ---- v9 → v10 migration (B8) ----
 * Every tile road is traced into the graph (straight edges between junction,
 * bend, end and type-change tiles), every road tile becomes a graph tile,
 * and blocks are generated with the grid's zone codes. The grid itself is
 * NOT touched — population, jobs, buildings and connectivity stay exactly
 * what the v9 save had ("legacy-anchored": old lots keep their tile anchors).
 */
export function migrateToGraph(w: World): void {
  w.roads = traceRoads(w).g;
  w.graphTiles = new Set();
  w.tiles.forEach((t, i) => t.road && w.graphTiles.add(i));
  rebuildBlocks(w);
}

/**
 * B8: keep the graph in step with tile edits. When a tile tool (bulldoze,
 * a destroyed road, …) removes a road tile the graph owns, every graph
 * edge running over that tile is removed too, the tile leaves graphTiles,
 * and the blocks are regenerated (zoning carried over). Returns how many
 * edges went. Cheap when nothing changed (one pass over graphTiles).
 */
export function syncGraphToTiles(w: World): number {
  const dead = new Set<number>();
  for (const i of w.graphTiles) if (!w.tiles[i].road) dead.add(i);
  if (!dead.size) return 0;
  let n = 0;
  for (const e of w.roads.liveEdges()) for (const i of edgeTiles(w.roads, e).keys()) if (dead.has(i)) { w.roads.removeEdge(e); n++; break; }
  for (const i of dead) w.graphTiles.delete(i);
  // Tiles only those edges covered are no longer drawn by the graph: hand them back to the tile renderer.
  const live = new Set<number>();
  for (const e of w.roads.liveEdges()) for (const i of edgeTiles(w.roads, e).keys()) live.add(i);
  for (const i of [...w.graphTiles]) if (!live.has(i)) w.graphTiles.delete(i);
  w.blocks.regenerate(w.roads);
  return n;
}
