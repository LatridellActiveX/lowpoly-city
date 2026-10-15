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
import { edgeTiles, gridCellOf, readBlockCodes, tileCentre, traceRoads } from './bridge';
import { isIntersection } from '../sim/traffic';
import { GRID_SIZE } from '../sim/types';
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
  w.graphRoads = true; // OASIS: from now on the graph is the live network
  w.tiles.forEach((t, i) => t.road && w.graphTiles.add(i));
  markJunctionKinds(w);
  rebuildBlocks(w);
}

/**
 * OASIS: give traced junctions the SAME control the tile game had, so live
 * graph traffic behaves like the tile traffic it replaces:
 *  - a node on a roundabout tile (roadType 2) is a 'roundabout' node (ring
 *    edges between two such nodes have priority; entering cars yield);
 *  - a node on a tile the tile game signals (isIntersection: 3+ road
 *    neighbours, not a ring) is a 'signal' node (one approach green at a
 *    time, right on red after a stop — gtraffic.ts mayEnter).
 * Nodes that are not on a road tile's centre (free-road junctions) are left
 * as they are ('plain' unless the player set them). Only nodes listed in
 * `only` are touched when given (incremental absorb below).
 */
export function markJunctionKinds(w: World, only?: Iterable<number>): void {
  const g = w.roads, N = GRID_SIZE;
  for (const n of only ?? g.liveNodes()) {
    if (!g.nAlive[n]) continue;
    const tx = Math.floor(g.nx[n] / 32), tz = Math.floor(g.nz[n] / 32);
    if (tx < 0 || tz < 0 || tx >= N || tz >= N) continue;
    const i = tz * N + tx, c = tileCentre(i);
    if (Math.hypot(c.x - g.nx[n], c.z - g.nz[n]) > 0.5) continue; // not a traced (tile-centre) node
    const t = w.tiles[i];
    if (t.roadType === 2) g.nKind[n] = 'roundabout';
    else if (g.nEdges[n].length >= 3 && isIntersection(w.tiles, i)) g.nKind[n] = 'signal';
  }
}

/**
 * OASIS: NEW TILE ROADS IN A GRAPH WORLD. The ordinary Road / Avenue /
 * Roundabout tools still lay tiles; in a graph world (new games, migrated
 * saves, any city with free roads) those tiles are absorbed into the graph
 * right away so the graph stays the complete live network:
 *  - new road tiles are grouped into maximal straight RUNS along x and z;
 *  - each run becomes ONE straight graph road from tile centre to tile
 *    centre, extended one tile onto any road it touches at either end, so
 *    it snaps to that road's node (or splits its edge into a T) — the
 *    graph's own placeRoad does the snapping, crossing splits and
 *    validation;
 *  - every tile an accepted road covers joins graphTiles (drawn by the
 *    graph renderer, routed by graph traffic).
 * A run the graph refuses (too short next to a free-road junction, too
 * sharp an angle...) simply stays a TILE road: it still works through the
 * tile router's fallback, so nothing breaks — it just is not graph-drawn.
 * Returns how many tiles were absorbed.
 */
export function absorbTileRoads(w: World, tiles: number[]): number {
  const N = GRID_SIZE, T = w.tiles, g = w.roads;
  const fresh = new Set(tiles.filter((i) => T[i].road && !w.graphTiles.has(i)));
  if (!fresh.size && !tiles.some((i) => T[i].road && T[i].roadType === 2)) return 0; // (ring tiles over old roads still need corner nodes)
  const road = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N && T[z * N + x].road;
  const touched = new Set<number>();
  let n = 0;
  for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
    for (const i of fresh) {
      const x = i % N, z = Math.floor(i / N);
      if (fresh.has(i - (dz * N + dx)) && road(x - dx, z - dz)) continue; // not the start of a run
      // Walk the run of fresh tiles.
      let ex = x, ez = z;
      while (fresh.has((ez + dz) * N + ex + dx)) { ex += dx; ez += dz; }
      // Extend onto touching roads at either end (that is where it connects).
      let sx = x, sz = z;
      if (road(x - dx, z - dz)) { sx -= dx; sz -= dz; }
      if (road(ex + dx, ez + dz)) { ex += dx; ez += dz; }
      if (sx === ex && sz === ez) continue; // a lone tile with nothing along this axis
      const a = tileCentre(sz * N + sx), b = tileCentre(ez * N + ex);
      const type = T[i].roadType === 1 ? 'avenue' : 'street';
      const r = g.placeLine(a, b, type);
      if (!r.ok) continue; // stays a tile road (tile-router fallback)
      for (const e of r.edges) for (const k of edgeTiles(g, e).keys()) if (T[k].road && !w.graphTiles.has(k)) { w.graphTiles.add(k); n++; }
      for (const m of r.nodes) touched.add(m);
    }
  }
  // ROUNDABOUTS: every ring tile's centre must be a graph node (the corners
  // of the ring), even where the ring was laid over an existing road whose
  // edge just runs straight through it: split that edge there. The four
  // 32 m ring sides then join two 'roundabout' nodes each, which is what
  // gtraffic.ts treats as the priority ring.
  for (const i of tiles) {
    if (!T[i].road || T[i].roadType !== 2) continue;
    const c = tileCentre(i);
    let m = g.nearestNode(c, 0.5);
    if (m < 0) {
      const ep = g.nearestEdgePoint(c, 0.5);
      if (!ep) continue;
      // Only split where both pieces stay at least a junction-to-junction length.
      const arc = ep.t * g.eLen[ep.edge];
      if (arc < 16 || g.eLen[ep.edge] - arc < 16) continue;
      m = g.splitEdge(ep.edge, ep.t);
    }
    touched.add(m); n++;
  }
  if (n) { markJunctionKinds(w, touched); rebuildBlocks(w); }
  return n;
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
