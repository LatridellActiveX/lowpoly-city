/**
 * tools/blockbridge.test.ts — V1.6 B3: lots on blocks + the graph↔grid bridge.
 *   1. The bench town's tile roads trace into a graph that rasterises back
 *      to exactly the same road tiles (types included).
 *   2. Its zone blocks sit exactly on the 1.5 cell grid and cover every
 *      zoned cell; codes go grid → blocks → grid unchanged.
 *   3. A "graph town" (roads + zoning re-derived through graph and blocks)
 *      runs the same 1,200 ticks as the grid town: population, jobs and
 *      building count within 1% (they are in fact identical).
 *   4. Curve town: lots placed greedily in block space face their road,
 *      never share a cell, and wide lots only sit on gentle stretches.
 */
import { buildTown, tick, Simulation, World } from './bench/town';
import { traceRoads, rasterizeRoads, readBlockCodes, writeBlockCodes, gridCellOf, blockRuns, lotFrame, claimLot, mergeRun, CURVE_MAX, CURVE_W } from '../src/roads/bridge';
import { ZoneBlocks } from '../src/roads/blocks';
import { RoadGraph } from '../src/roads/graph';
import { quadCubic } from '../src/roads/bezier';
import { CELL_GRID } from '../src/sim/cells';

let fail = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fail++; };
const P = (x: number, z: number) => ({ x, z });

const town = () => { const s = new Simulation(new World(undefined, 4242)); s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; }); buildTown(s); return s; };

// 1 + 2
const A = town();
const { g } = traceRoads(A.world);
const ras = rasterizeRoads(g);
let roadDiff = 0;
A.world.tiles.forEach((t, i) => { const r = ras.get(i); if (t.road !== (r !== undefined) || (t.road && (t.roadType === 1 ? 1 : 0) !== r)) roadDiff++; });
ok(roadDiff === 0, 'grid roads → graph → tiles: identical road tiles and types', { edges: g.edgeCount(), nodes: g.nodeCount(), roadDiff });
const zb = new ZoneBlocks(); zb.regenerate(g); zb.check(g);
const aligned = zb.cells.every((c) => Math.abs((c.cx - 4) / 8 - Math.round((c.cx - 4) / 8)) < 1e-6 && Math.abs((c.cz - 4) / 8 - Math.round((c.cz - 4) / 8)) < 1e-6);
ok(aligned, 'blocks of a grid town sit exactly on the 8 m cell grid', zb.cells.length);
readBlockCodes(A.world, zb);
const covered = new Set(zb.cells.map(gridCellOf));
let zoned = 0, missed = 0;
for (let k = 0; k < CELL_GRID * CELL_GRID; k++) if (A.world.cells.zone[k]) { zoned++; if (!covered.has(k)) missed++; }
ok(zoned > 0 && missed === 0, 'every zoned grid cell is a block cell', { zoned, missed });

// 3: graph town vs grid town
{
  const B = town();
  const { g: gb } = traceRoads(B.world);
  const zbb = new ZoneBlocks(); zbb.regenerate(gb); readBlockCodes(B.world, zbb);
  const r = rasterizeRoads(gb);
  B.world.tiles.forEach((t, i) => { const v = r.get(i); t.road = v !== undefined || t.edge; if (v !== undefined && t.roadType !== 2) t.roadType = v; });
  B.world.cells.zone.fill(0); writeBlockCodes(B.world, zbb);
  let same = 0; for (let k = 0; k < A.world.cells.zone.length; k++) if (A.world.cells.zone[k] === B.world.cells.zone[k]) same++;
  ok(same === A.world.cells.zone.length, 'grid → blocks → grid zone codes identical');
  for (let i = 0; i < 1200; i++) { tick(A); tick(B); }
  const a = A.stats(), b = B.stats();
  const near = (x: number, y: number) => Math.abs(x - y) <= Math.max(1, 0.01 * Math.max(x, y));
  ok(near(a.population, b.population) && near(a.jobs, b.jobs) && near(A.world.lots.buildings.size, B.world.lots.buildings.size), 'graph town reproduces the grid town (pop, jobs, buildings within 1%)', { grid: [a.population, a.jobs, A.world.lots.buildings.size], graph: [b.population, b.jobs, B.world.lots.buildings.size] });
}

// 4: curve town, block-space lots
{
  const cg = new RoadGraph();
  cg.placeRoad(quadCubic(P(200, 600), P(400, 300), P(600, 600)));
  cg.placeLine(P(600, 600), P(900, 600));
  const cz = new ZoneBlocks(); cz.regenerate(cg);
  for (const c of cz.cells) c.code = 1;
  let id = 1, placed = 0, facing = 0, wideOk = 0, wide = 0;
  for (const b of cz.blocks.values()) for (const [w, d] of [[6, 6], [4, 5], [2, 2]] as const) {
    for (;;) {
      const runs = blockRuns(b, w, d);
      if (!runs.length) break;
      const c0 = runs[0];
      claimLot(b, c0, w, d, id++); placed++;
      const f = lotFrame(b, c0, w);
      // Front points at the road: moving from pos along front gets closer to the edge.
      const e = b.edge, curve = cg.eCurve[e];
      const dist = (p: { x: number; z: number }) => { let m = Infinity; for (let k = 0; k <= 200; k++) { const t = k / 200; const u = 1 - t; const x = u * u * u * curve[0] + 3 * u * u * t * curve[2] + 3 * u * t * t * curve[4] + t * t * t * curve[6], z = u * u * u * curve[1] + 3 * u * u * t * curve[3] + 3 * u * t * t * curve[5] + t * t * t * curve[7]; m = Math.min(m, Math.hypot(x - p.x, z - p.z)); } return m; };
      if (dist({ x: f.pos.x + f.front.x * 4, z: f.pos.z + f.front.z * 4 }) < dist(f.pos)) facing++;
      if (w > CURVE_W) { wide++; const h0 = b.cells.find((q) => q.col === c0 && q.row === 0)!, h1 = b.cells.find((q) => q.col === c0 + w - 1 && q.row === 0)!; const a0 = Math.atan2(h0.quad[3] - h0.quad[1], h0.quad[2] - h0.quad[0]), a1 = Math.atan2(h1.quad[3] - h1.quad[1], h1.quad[2] - h1.quad[0]); if (Math.abs(Math.atan2(Math.sin(a0 - a1), Math.cos(a0 - a1))) < CURVE_MAX) wideOk++; }
    }
  }
  const owners = new Map<string, number>();
  let clash = 0; for (const c of cz.cells) if (c.owner) { const k = `${c.edge}:${c.side}:${c.col}:${c.row}`; if (owners.has(k)) clash++; owners.set(k, c.owner); }
  ok(placed > 20 && facing === placed, 'curve town: every lot faces its road', { placed, facing });
  ok(clash === 0, 'curve town: no two lots share a cell');
  ok(wide > 0 && wideOk === wide, 'curve town: wide lots only where the road turns < 10° across them', { wide, wideOk });
  // merge within a block
  const b0 = [...cz.blocks.values()].find((b) => b.cells.some((c) => c.owner))!;
  const ids = [...new Set(b0.cells.filter((c) => c.owner).map((c) => c.owner))].slice(0, 2);
  const m = mergeRun(b0, ids);
  ok(m !== null && m[1] >= 2, 'merge: neighbouring lots on one block give one contiguous run', m);
}
if (fail) { console.log(`${fail} failures`); process.exit(1); } console.log('blockbridge: all ok');
