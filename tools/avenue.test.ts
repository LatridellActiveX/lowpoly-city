/**
 * tools/avenue.test.ts — OASIS-AVENUE regression: "I upgraded a road into an
 * avenue and traffic got stuck" (Parker, 2026-10-16).
 *
 * What was wrong (all in a GRAPH world, where cars drive roads/gtraffic.ts):
 *  1. The Avenue tool over an existing graph street only changed the tiles
 *     (absorbTileRoads skips tiles the graph owns): the edge stayed a 1-lane
 *     street. Fixed by roads/persist.ts upgradeGraphRoads (+ load repair).
 *  2. Nodes that lost an arm kept their traffic light (node 9 at (64,106) in
 *     his save, 32 m from the junction at (64,105)). markJunctionKinds now
 *     demotes them; demoteStaleJunctions repairs old saves on load.
 *  3. Every straight-through car used lane 0 (GraphTraffic.laneFor took the
 *     first connector), so an avenue carried no more through traffic.
 *  4. Signals ran one phase per approach (3 at a T); opposite approaches now
 *     share a phase, and close lights get a green-wave offset.
 *  +  A plain 2-road node used a full junction box, so a short avenue piece
 *     had a 0 m lane (cars pinned): nodeClear is 2 m there now.
 *  +  Lanes end at the painted STOP LINE (GraphTraffic.buildStopLines), every
 *     lane keeps ≥ MIN_LANE, spawns never cut in front of a car leaving the
 *     box, and plain/stop junctions let the longest waiter go (STARVE_WAIT).
 *
 * Checks:
 *  a. Parker's save: no stale lights, no 0 m lanes, every graph edge under
 *     avenue tiles is an avenue, and 1,200 s of traffic gives up < 5% (was 28%).
 *  b. Redoing his upgrade on column x=64 retypes the whole spine, still < 5%.
 *  c. Bench town: upgrading part of a street mid-simulation splits the edge
 *     at a tile centre, retypes only the dragged part, bumps the graph
 *     version (live trips complete, none lost), and no lane is < 10 m.
 *  e. STOP LINES (Parker): cars waiting at lights, stop signs, yields and
 *     roundabouts, on streets and avenues, hold with their FRONT on the rear
 *     edge of the painted stop line (± 0.3 m) — never on the crosswalk or in
 *     the box; and hardly anyone stands still inside a junction box.
 *  d. Signals: a T junction runs 2 phases, a cross 2 phases; a 2-lane
 *     avenue spreads straight traffic over both lanes.
 */
import { readFileSync } from 'node:fs';
import { loadCode } from './fixtures/loadCode';
import { buildTown, rect, tick, Simulation, World } from './bench/town';
import { migrateToGraph } from '../src/roads/persist';
import { CAR_LEN, GraphTraffic, STOP_LINE_BACK } from '../src/roads/gtraffic';
import { planAll, rings } from '../src/roads/junctions';
import { GRID_SIZE } from '../src/sim/types';
import { allRegions } from '../src/sim/regions';

let fails = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fails++; };

/** Structural invariants of a graph world after any edit / load. */
function invariants(s: Simulation, tag: string): void {
  const g = s.world.roads, gt = new GraphTraffic(g);
  const stale = g.liveNodes().filter((n) => (g.nKind[n] === 'signal' || g.nKind[n] === 'stop') && g.nEdges[n].length < 3);
  ok(stale.length === 0, `${tag}: no traffic light on a node with < 3 roads`, stale);
  const short = g.liveEdges().filter((e) => g.eLen[e] >= 32 && gt.laneLen(e) < 10).map((e) => [e, g.eLen[e], gt.laneLen(e)]);
  ok(short.length === 0, `${tag}: every edge ≥ 32 m keeps a drivable lane ≥ 10 m`, short);
}
function drive(s: Simulation, frames: number) {
  const tr = s.traffic, st0 = { ...tr.graph.stats };
  for (let k = 0; k < frames; k++) s.update(0.25);
  const st = tr.graph.stats, spawned = st.spawned - st0.spawned, gaveUp = st.gaveUp - st0.gaveUp;
  return { spawned, arrived: st.arrived - st0.arrived, gaveUp, rate: spawned ? gaveUp / spawned : 1 };
}
const x64Types = (s: Simulation) => { const g = s.world.roads; return g.liveEdges().filter((e) => Math.abs(g.eCurve[e][0] - 2064) < 1 && Math.abs(g.eCurve[e][6] - 2064) < 1).map((e) => g.eType[e]); };

// ---- a. Parker's save as saved (load repairs it) ----
const code = readFileSync('tools/fixtures/parker-avenue.lpc', 'utf8').trim();
{
  const s = loadCode(code), w = s.world, g = w.roads;
  invariants(s, 'parker load');
  // Every graph edge whose tiles are (mostly) avenue tiles is an avenue edge.
  const n9 = g.nearestNode({ x: 64.5 * 32, z: 106.5 * 32 }, 1);
  ok(n9 < 0 || g.nKind[n9] === 'plain', 'the stale light at (64,106) is gone', n9 >= 0 ? g.nKind[n9] : 'merged');
  ok(x64Types(s).includes('avenue'), 'his upgraded x=64 tiles are avenue edges in the graph', x64Types(s));
  const r = drive(s, 4800);
  ok(r.spawned > 1000 && r.rate < 0.05, "Parker's save: < 5% of trips give up over 1,200 s (was 28%)", r);
}
// ---- b. redo the x=64 upgrade ----
{
  const s = loadCode(code), w = s.world;
  w.regionsOwned = allRegions(); w.cash = 1e7;
  const t: Array<[number, number]> = [];
  for (let z = 100; z < GRID_SIZE; z++) if (w.tiles[z * GRID_SIZE + 64].road) t.push([64, z]);
  const res = s.apply('avenue', t);
  ok(res.changed > 0 && x64Types(s).every((ty) => ty === 'avenue'), 'avenue tool over x=64: the whole graph spine becomes avenue', x64Types(s));
  invariants(s, 'parker x=64 upgrade');
  const r = drive(s, 4800);
  ok(r.spawned > 1000 && r.rate < 0.05, 'after the upgrade: < 5% give up', r);
}
// ---- c. fresh: partial upgrade mid-simulation ----
{
  const s = new Simulation(new World(undefined, 4242)); migrateToGraph(s.world); buildTown(s);
  for (let i = 0; i < 500; i++) tick(s);
  const w = s.world, g = w.roads, v0 = g.version, live = s.traffic.graph.vehicles.filter((v) => !v.done).length;
  const before = { ...s.traffic.graph.stats };
  s.apply('avenue', rect(30, 20, 30, 25)); // part of the x=30 street between z=19 and z=26
  const on = (z: number) => g.liveEdges().filter((e) => { const c = g.eCurve[e]; return Math.abs(c[0] - 30.5 * 32) < 1 && Math.abs(c[6] - 30.5 * 32) < 1 && Math.min(c[1], c[7]) <= (z + 0.5) * 32 && Math.max(c[1], c[7]) >= (z + 0.5) * 32; });
  ok(on(22).length > 0 && on(22).every((e) => g.eType[e] === 'avenue'), 'dragged part of x=30 is an avenue edge', on(22).map((e) => g.eType[e]));
  ok(on(15).every((e) => g.eType[e] === 'street') && on(35).every((e) => g.eType[e] === 'street'), 'the rest of x=30 stays a street', [...on(15), ...on(35)].map((e) => g.eType[e]));
  ok(g.version !== v0, 'graph version bumped (traffic rebuilds lanes)');
  // Live trips on the old graph are completed, not lost, at the next update.
  s.traffic.update(w, 0.1);
  const done = s.traffic.graph.stats.finishedOnEdit - before.finishedOnEdit;
  ok(done >= live - 1, 'live trips completed on the edit (none lost)', { live, done });
  invariants(s, 'bench partial upgrade');
  for (let i = 0; i < 600; i++) tick(s);
  const st = s.traffic.graph.stats;
  ok((st.gaveUp - before.gaveUp) / Math.max(1, st.spawned - before.spawned) < 0.1, 'bench town keeps flowing after the upgrade (< 10% give up)', st);
}
// ---- d. signal phases + lane use ----
{
  const s = new Simulation(new World(undefined, 4242)); migrateToGraph(s.world); buildTown(s);
  const g = s.world.roads, gt = new GraphTraffic(g);
  const sig = g.liveNodes().filter((n) => g.nKind[n] === 'signal');
  const bad = sig.filter((n) => gt.junctions.get(n)!.phases.length > 2).map((n) => [n, g.nEdges[n].length, gt.junctions.get(n)!.phases.length]);
  ok(sig.length > 0 && bad.length === 0, 'grid T and + junctions run 2 phases (opposite approaches together)', bad);
  // Lane spread: upgrade a whole street, drive, and see both lanes used.
  for (let i = 0; i < 500; i++) tick(s);
  s.apply('avenue', rect(10, 26, 50, 26));
  let lanes = new Set<number>();
  for (let i = 0; i < 400; i++) { tick(s); for (const v of s.traffic.graph.vehicles) if (v.seg.kind === 'lane' && g.eType[v.seg.edge] === 'avenue') lanes.add(v.seg.lane); }
  ok(lanes.has(0) && lanes.has(1), 'cars use both avenue lanes', [...lanes]);
}

// ---- e. stop lines ----
/**
 * Independent geometry: where is the painted stop line (render/graphRoads.ts
 * crossing(): rear edge at arm.trim + 4.8 m from the node) or, at a
 * roundabout entry / unpainted arm, the hold point (trim + 0.3 m)? Then for
 * every car STANDING at the head of its lane, measure its FRONT bumper's
 * distance from the node it is waiting for.
 */
function stopLineCheck(s: Simulation, tag: string, frames: number) {
  const g = s.world.roads, rs = rings(g), ringNode = new Set(rs.flatMap((r) => r.nodes));
  let held = 0, bad: unknown[] = [], inBox = 0, boxSamples = 0, kinds = new Set<string>(), types = new Set<string>();
  for (let f = 0; f < frames; f++) {
    s.update(0.25);
    if (f % 10) continue;
    const gt = s.traffic.graph.gt as any; if (!gt) continue;
    const plans = planAll(g, rs);
    for (const v of gt.vehicles) {
      if (v.done || v.v > 0.05) continue;
      if (v.seg.kind === 'conn') { inBox++; continue; }
      const e = v.seg.edge, dir = v.seg.dir, node = dir === 0 ? g.eB[e] : g.eA[e];
      const plan = plans.get(node), ring = ringNode.has(node);
      if (!plan || (!plan.junction && !ring) || v.i + 1 >= v.path.length) continue;
      const l = gt.list(v.seg); if (l[l.length - 1] !== v) continue; // only the head of the queue
      const arm = plan.arms.find((a: any) => a.edge === e && a.atA === (dir === 1));
      if (!arm) continue;
      if (ring && ringNode.has(g.other(e, node))) continue; // circulating on the ring itself: no entry line
      const len = g.eLen[e], [s0, s1] = gt.span(e);
      const centre = dir === 0 ? len - (s0 + v.s) : s1 - v.s; // arc distance from the node
      const front = centre - CAR_LEN / 2;
      const painted = plan.junction && !ring && arm.trim + 5.5 <= len / 2;
      const line = painted ? arm.trim + STOP_LINE_BACK : arm.trim + 0.3;
      if (gt.laneLen(e) - v.s > 0.01) continue; // queued behind nothing but not at the line yet (braking)
      held++; kinds.add(ring ? 'roundabout' : g.nKind[node]); types.add(g.eType[e]);
      if (Math.abs(front - line) > 0.3) bad.push({ e, node, kind: g.nKind[node], type: g.eType[e], front: +front.toFixed(2), line: +line.toFixed(2) });
    }
    boxSamples += gt.vehicles.filter((v: any) => !v.done).length;
  }
  ok(held > 20 && bad.length === 0, `${tag}: cars waiting at junctions hold with their front on the stop line (±0.3 m)`, { held, bad: bad.slice(0, 5) });
  return { kinds, types, boxShare: inBox / Math.max(1, boxSamples) };
}
{
  const s = new Simulation(new World(undefined, 4242)); migrateToGraph(s.world); buildTown(s);
  s.world.peakPop = 3000; // avenues unlock at 250 people
  s.apply('avenue', rect(10, 26, 50, 26)); // avenue approaches too
  s.apply('roundabout', [[30, 18], [31, 18], [30, 19], [31, 19]]);
  // Two junctions become all-way STOP signs.
  const g = s.world.roads;
  const sigs = g.liveNodes().filter((n) => g.nKind[n] === 'signal');
  for (const n of sigs.slice(0, 2)) g.nKind[n] = 'stop';
  g.version++;
  console.log('     avenue edges:', g.liveEdges().filter((e) => g.eType[e] === 'avenue').length, 'stop nodes:', sigs.slice(0, 2));
  for (let i = 0; i < 400; i++) tick(s);
  const r = stopLineCheck(s, 'bench town (lights, stops, roundabout, streets + avenues)', 3200);
  ok(['signal', 'stop', 'roundabout'].every((k) => r.kinds.has(k)) && r.types.has('street') && r.types.has('avenue'), 'stop-line check covered lights, stop signs, roundabout entries, streets and avenues', { kinds: [...r.kinds], types: [...r.types] });
  ok(r.boxShare < 0.05, 'cars rarely stand still inside a junction box (< 5% of samples)', r.boxShare);
}
{
  const s = loadCode(code);
  const r = stopLineCheck(s, "Parker's save", 2400);
  ok(r.boxShare < 0.05, "Parker's save: cars rarely stand still inside a junction box", r.boxShare);
}

console.log(fails ? `\n${fails} FAILED` : '\nall avenue checks passed');
process.exit(fails ? 1 : 0);
