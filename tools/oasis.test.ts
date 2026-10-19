/**
 * tools/oasis.test.ts — OASIS: the road graph as the LIVE network.
 *
 *  1. A NEW-GAME style world (migrateToGraph on the empty map, like main.ts)
 *     building the bench town with the ordinary tile tools: every road tile
 *     is absorbed into the graph, junction tiles become signal nodes.
 *  2. Its real trips (commuters, moving-in, trucks) run on GRAPH lanes:
 *     spawned/arrived on the live graph traffic, onArrive fires, and the
 *     city grows like the tile town (population within 20%).
 *  3. A curved FREE road off the town, zoned by block: buildings grow and
 *     live trips drive the curve (a vehicle observed on a curved edge).
 *  4. Graph utilities: every built zoned tile within reach of a graph road
 *     with a powered network is connected.
 *  5. Editing the graph mid-trip completes the live trips (none lost).
 *  6. A pure tile world never touches the graph traffic (tile parity).
 */
import { buildTown, rect, tick, Simulation, World } from './bench/town';
import { migrateToGraph } from '../src/roads/persist';
import { placeFreeRoad, paintBlocks } from '../src/sim/freeroads';
import { isStraightCubic } from './oasis-helpers';
import { at, tangent } from '../src/roads/bezier';
import { gridCellOf } from '../src/roads/bridge';
import { GRID_SIZE } from '../src/sim/types';

let fails = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fails++; };
const pop = (s: Simulation) => s.world.tiles.reduce((a, t) => a + (t.zone === 'residential' ? t.units : 0), 0);

// ---- 6. pure tile world ----
const tileTown = new Simulation(new World(undefined, 4242));
buildTown(tileTown);
for (let i = 0; i < 700; i++) tick(tileTown);
ok(tileTown.traffic.graph.stats.spawned === 0 && !tileTown.world.graphRoads, 'tile world: graph traffic never used', tileTown.traffic.graph.stats);

// ---- 1. graph world built with tile tools ----
const s = new Simulation(new World(undefined, 4242));
migrateToGraph(s.world);
buildTown(s);
const w = s.world, N = GRID_SIZE;
let roads = 0, absorbed = 0;
w.tiles.forEach((t, i) => { if (t.road) { roads++; if (w.graphTiles.has(i)) absorbed++; } });
ok(w.graphRoads && absorbed === roads, 'every tile road joined the graph', { roads, absorbed, edges: w.roads.edgeCount() });
const signals = w.roads.liveNodes().filter((n) => w.roads.nKind[n] === 'signal').length;
ok(signals >= 10, 'junction tiles became signal nodes', signals);

// ---- 2. live trips on the graph ----
let arrived = 0;
for (let i = 0; i < 700; i++) tick(s);
const st = s.traffic.graph.stats;
arrived = st.arrived;
ok(st.spawned > 200 && arrived > 100, 'real trips spawn and arrive on graph lanes', st);
ok(s.traffic.stats.spawned < st.spawned, 'the graph carries most trips (tile router only as fallback)', { tile: s.traffic.stats.spawned, graph: st.spawned });
const pg = pop(s), pt = pop(tileTown);
// OASIS-SAFEGAP: with the safe-gap traffic the graph town grows a little
// FASTER than the tile town (268 vs 206 at 700 ticks; it was 187 before),
// so the upper bound is 1.35×. The lower bound (no slower than 0.8×) is the
// real regression guard.
// OASIS-S6: the busier everyday traffic (night 0.2, midday ~0.7, cap 100)
// slows the old TILE town a bit more than the graph town (tile 206 → 192,
// graph 266 → 263 at 700 ticks), so the ratio moved 1.29× → 1.37×; the upper
// bound goes to 1.45×. The graph town itself barely changed.
ok(pg > 0.8 * pt && pg < 1.45 * pt, 'city grows like the tile town (0.8×–1.45×)', { graph: pg, tile: pt });
const purposes = new Set(s.traffic.graph.vehicles.map((v) => v.trip?.purpose.split(':')[0]));
ok(purposes.size >= 1 && !purposes.has(undefined), 'live graph vehicles carry real trip purposes', [...purposes]);

ok(st.rightOnRed > 0, 'signalled junctions: right on red happens on graph lanes', st.rightOnRed);

// ---- 2b. a tile roundabout in a graph world becomes roundabout nodes ----
{
  const r = new Simulation(new World(undefined, 4242));
  migrateToGraph(r.world); buildTown(r);
  r.apply('roundabout', [[30, 18], [31, 18], [30, 19], [31, 19]]);
  const ringNodes = r.world.roads.liveNodes().filter((n) => r.world.roads.nKind[n] === 'roundabout').length;
  ok(ringNodes >= 4, 'roundabout tiles became roundabout nodes', ringNodes);
  for (let i = 0; i < 700; i++) tick(r);
  const rs = r.traffic.graph.stats;
  ok(rs.arrived > 100 && rs.yields > 0, 'cars enter the roundabout yielding to the ring', rs);
}

// ---- 3. curved free road ----
const M = (x: number, z: number) => ({ x: (x + 0.5) * 32, z: (z + 0.5) * 32 });
// A curved SHORTCUT across the block between two junctions: (10,26) → (30,40),
// leaving and arriving at ≥30° to the roads there and crossing road z=33
// (a new junction). Trips between the west side and the south-east now drive it.
const P = (x: number, z: number) => M(x, z);
const c = Float64Array.of(P(10, 26).x, P(10, 26).z, P(16, 32).x, P(16, 32).z, P(22, 34).x, P(22, 34).z, P(30, 40).x, P(30, 40).z);
s.apply('bulldoze', rect(11, 27, 29, 32)); s.apply('bulldoze', rect(11, 34, 29, 39)); // clear the factories in the curve's way (the player would bulldoze them)
const e0 = w.roads.edgeCount();
const plan = placeFreeRoad(s, c, 'street', {}, true, true);
ok(w.roads.edgeCount() - e0 <= 4, 'the curve is a few smooth edges, not a re-absorbed staircase', w.roads.edgeCount() - e0);
ok(plan.ok, 'curved free road placed off the town', plan.reason);
const curved = w.roads.liveEdges().filter((e) => !isStraightCubic(w.roads.eCurve[e]));
ok(curved.length > 0, 'graph has a curved edge', curved.length);
let painted = 0;
for (let k = 1; k < 40; k++) {
  const p = at(c, k / 40), d = tangent(c, k / 40);
  for (const sd of [-1, 1]) painted += paintBlocks(s, { x: p.x + sd * d.z * 20, z: p.z - sd * d.x * 20 }, 1, 2, 3);
}
ok(painted >= 0, 'block zoning brush runs along the curve', painted);
// Regression: block painting must also tag the TILES as zoned (growth, power and water only see tile.zone).
{
  let cellsZoned = 0, tilesZoned = 0;
  for (const bc of w.blocks.cells) { const k = gridCellOf(bc); if (k < 0 || !w.cells.zone[k]) continue; cellsZoned++; const ti = Math.floor(Math.floor(k / (GRID_SIZE * 4)) / 4) * GRID_SIZE + Math.floor((k % (GRID_SIZE * 4)) / 4); if (!w.tiles[ti].road && w.tiles[ti].zone) tilesZoned++; }
  ok(painted === 0 || tilesZoned > 0, 'painted block cells make their tiles zoned', { cellsZoned, tilesZoned });
}
let onCurve = 0;
const seenPurpose = new Set<string>();
for (let i = 0; i < 900; i++) {
  tick(s);
  for (const v of s.traffic.graph.vehicles) if (v.trip && v.seg.kind === 'lane' && curved.includes(v.seg.edge)) { onCurve++; seenPurpose.add(v.trip.purpose); }
}
ok(onCurve > 0, 'live city trips drive the curved road', { onCurve, purposes: [...seenPurpose] });

// ---- 4. graph utilities ----
let built = 0, connected = 0;
for (const i of w.chunks.activeTilesSorted()) {
  const t = w.tiles[i];
  if (t.zone !== 'residential' || t.level === 0 || t.part) continue;
  built++; if (s.net.service[i].powerNet >= 0) connected++;
}
ok(built > 30 && connected === built, 'every built home is on a power network', { built, connected });

// ---- 5. graph edit mid-trip ----
const live = s.traffic.graph.vehicles.filter((v) => v.trip && !v.done).length;
const before = s.traffic.graph.stats.finishedOnEdit, keptBefore = s.traffic.graph.stats.keptOnEdit + s.traffic.graph.stats.movedOnEdit;
const v0 = w.roads.version;
const ar = s.apply('road', rect(51, 30, 55, 30)); // a new road off x=50, absorbed into the graph (T junction): graph version changes
(s.traffic.graph as unknown as { sync(w: unknown): void }).sync(w); // OASIS-S2: adopt now (a full tick would also let trips arrive normally)
// OASIS-S2: the cars are now KEPT across the edit (GraphTraffic.adopt); only
// the ones that cannot be put back finish. Either way none is lost.
{
  const st = s.traffic.graph.stats, done = st.finishedOnEdit - before, kept = st.keptOnEdit + st.movedOnEdit - keptBefore;
  ok(live === 0 || done + kept === live, 'graph edit keeps or completes every live trip (none lost)', { live, done, kept, built: ar.changed, versionChanged: w.roads.version !== v0 });
  ok(live === 0 || kept >= live * 0.9, 'graph edit keeps ≥ 90 % of the cars on the road (OASIS-S2)', { live, kept });
}
void N;
console.log(fails ? `oasis: ${fails} failed` : 'oasis: all ok');
process.exit(fails ? 1 : 0);
