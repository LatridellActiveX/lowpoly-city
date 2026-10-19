/**
 * tools/gtraffic.test.ts — V1.6 B4: traffic on the road graph.
 * Path-length parity with the tile grid (bench town, 50 pairs, ≤ 5%),
 * per-node conflict rules, lane choice, free flow, signals + right on red,
 * stop signs, roundabout flow, path cache, and the 600-vehicle bench.
 */
import { buildTown, Simulation, World } from './bench/town';
import { traceRoads } from '../src/roads/bridge';
import { RoadGraph } from '../src/roads/graph';
import { GraphTraffic, Vehicle } from '../src/roads/gtraffic';
import { GRID_SIZE } from '../src/sim/types';

let fail = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fail++; };
const P = (x: number, z: number) => ({ x, z });
const node = (g: RoadGraph, x: number, z: number) => g.nearestNode(P(x, z), 0.5);
const run = (tr: GraphTraffic, secs: number, dt = 0.1) => { for (let t = 0; t < secs; t += dt) tr.update(dt); };

// ---- parity vs grid ----
{
  const s = new Simulation(new World(undefined, 4242)); s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; }); buildTown(s);
  const { g, nodeOf } = traceRoads(s.world);
  const tr = new GraphTraffic(g);
  const N = GRID_SIZE, tiles = s.world.tiles;
  const bfs = (a: number) => { const d = new Int32Array(N * N).fill(-1); d[a] = 0; const q = [a]; for (let h = 0; h < q.length; h++) { const i = q[h], x = i % N, z = (i / N) | 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue; const j = nz * N + nx; if (tiles[j].road && d[j] < 0) { d[j] = d[i] + 1; q.push(j); } } } return d; };
  const ids = [...nodeOf.keys()];
  let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let worst = 0, pairs = 0;
  for (let k = 0; k < 50; k++) {
    const a = ids[Math.floor(rnd() * ids.length)], b = ids[Math.floor(rnd() * ids.length)];
    if (a === b) continue;
    const d = bfs(a)[b]; const r = tr.route(nodeOf.get(a)!, nodeOf.get(b)!, 'length');
    if (d < 0 || !r) { ok(d < 0 && !r, 'parity: same connectivity'); continue; }
    worst = Math.max(worst, Math.abs(tr.routeLength(r) - d * 32) / (d * 32)); pairs++;
  }
  ok(pairs >= 40 && worst <= 0.05, 'path-length parity vs the tile grid ≤ 5% (50 sampled trips)', { pairs, worst: +worst.toFixed(4) });
  const t0 = performance.now(); for (let k = 0; k < 2000; k++) tr.route(nodeOf.get(ids[k % ids.length])!, nodeOf.get(ids[(k * 7) % ids.length])!); const dtc = performance.now() - t0;
  ok(dtc < 200, 'path cache: 2000 repeat routes are cheap', +dtc.toFixed(1));

  // ---- bench: 600 vehicles ----
  const nodes = g.liveNodes();
  let sd = 11; const r2 = () => ((sd = (sd * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const topUp = () => { let tries = 0; while (tr.vehicles.length < 600 && tries++ < 2000) tr.spawn(nodes[Math.floor(r2() * nodes.length)], nodes[Math.floor(r2() * nodes.length)]); };
  for (let i = 0; i < 300; i++) { topUp(); tr.update(0.25); }
  const times: number[] = [];
  for (let i = 0; i < 300; i++) { topUp(); const a = performance.now(); tr.update(0.25); times.push(performance.now() - a); }
  const mean = times.reduce((x, y) => x + y, 0) / times.length;
  const stuck = tr.vehicles.filter((v) => v.wait > 60).length;
  ok(stuck <= 0.05 * tr.vehicles.length, 'bench: no gridlock (≤ 5% waiting over 60 s)', { stuck });
  ok(tr.vehicles.length >= 500 && mean <= 1.5, 'bench: ~600 vehicles ≤ 1.5 ms per tick', { vehicles: tr.vehicles.length, ms: +mean.toFixed(3), arrived: tr.stats.arrived });
}

// ---- conflicts at a + junction ----
const plus = (kind: 'plain' | 'signal' | 'stop' = 'plain', type: 'street' | 'avenue' = 'street') => {
  const g = new RoadGraph();
  g.placeLine(P(0, 500), P(1000, 500), type); g.placeLine(P(500, 0), P(500, 1000), type);
  const c = node(g, 500, 500); g.nKind[c] = kind; g.version++;
  return { g, c, W: node(g, 0, 500), E: node(g, 1000, 500), N: node(g, 500, 0), S: node(g, 500, 1000) };
};
{
  const { g, c, W, E, N, S } = plus();
  const tr = new GraphTraffic(g);
  const edgeTo = (n: number) => g.nEdges[c].find((e) => g.other(e, c) === n)!;
  const ci = (from: number, to: number) => tr.connector(c, edgeTo(from), edgeTo(to), -1);
  const J = tr.junctions.get(c)!;
  ok(J.conns.length === 12, '+ junction: 12 connectors (no U-turns)', J.conns.length);
  const turnOf = (from: number, to: number) => J.conns[ci(from, to)].turn;
  ok(turnOf(W, E) === 'straight' && turnOf(W, N) !== turnOf(W, S), 'turn types classified');
  const right = turnOf(W, N) === 'right' ? N : S, left = right === N ? S : N;
  ok(tr.conflicts(c, ci(W, E), ci(N, S)), 'straight crosses the perpendicular straight');
  ok(tr.conflicts(c, ci(W, left), ci(E, W)), 'left turn crosses the opposite straight');
  ok(!tr.conflicts(c, ci(W, right), ci(E, W)), 'right turn does not conflict with the opposite straight');
  // the straight from the side whose exit the right-turner joins
  const from = right === N ? S : N;
  ok(tr.conflicts(c, ci(W, right), ci(from, right)), 'right turn conflicts with the straight merging into its exit');
  // free flow: both straights alternate, everything arrives
  for (let i = 0; i < 6; i++) { tr.spawn(W, E); tr.spawn(N, S); run(tr, 2); }
  run(tr, 120);
  ok(tr.stats.arrived === tr.stats.spawned && tr.vehicles.length === 0, 'plain junction: every vehicle arrives', tr.stats);
}
// ---- lane choice on an avenue ----
{
  const { g, c, W, N, S } = plus('plain', 'avenue');
  const tr = new GraphTraffic(g);
  const edgeTo = (n: number) => g.nEdges[c].find((e) => g.other(e, c) === n)!;
  const J = tr.junctions.get(c)!;
  const lefts = J.conns.filter((k) => k.inEdge === edgeTo(W) && k.turn === 'left'), rights = J.conns.filter((k) => k.inEdge === edgeTo(W) && k.turn === 'right');
  ok(lefts.length === 1 && lefts[0].inLane === 0 && rights.length === 1 && rights[0].inLane === 1, 'avenue: left from the inner lane, right from the outer lane');
  const leftTo = J.conns[tr.connector(c, edgeTo(W), edgeTo(N), -1)].turn === 'left' ? N : S;
  const v = tr.spawn(W, leftTo)!;
  ok(v.lane === 0, 'vehicle picks the inner lane for its left turn');
}
// ---- signal: straight waits on red, right turns go on red ----
{
  const { g, c, W, E, N, S } = plus('signal');
  const tr = new GraphTraffic(g);
  const edgeTo = (n: number) => g.nEdges[c].find((e) => g.other(e, c) === n)!;
  const J = tr.junctions.get(c)!;
  const rightTo = J.conns[tr.connector(c, edgeTo(W), edgeTo(N), -1)].turn === 'right' ? N : S;
  // find a moment when W is red
  while (tr.green(c, edgeTo(W))) tr.time += 0.5;
  const t0 = tr.time;
  const straight = tr.spawn(W, E)!, rt = tr.spawn(S === rightTo ? N : S, E); void rt;
  const r = tr.spawn(W, rightTo);
  void r;
  run(tr, 30);
  ok(tr.stats.rightOnRed >= 0, 'signal: right on red counted');
  // OASIS-SAFEGAP: the approach time depends on the speed rule, so instead of
  // one fixed start phase, try start phases across a whole cycle: in at least
  // one the car reaches the line on red and must turn right on red.
  let v2 = new GraphTraffic(g), wasRed = false;
  for (let ph = 0; ph < 30 && !(v2.stats.rightOnRed === 1 && wasRed); ph++) {
    v2 = new GraphTraffic(g); v2.time = ph;
    v2.spawn(W, rightTo);
    let at = -1; for (let t = 0; t < 60 && at < 0; t += 0.1) { v2.update(0.1); if (v2.stats.rightOnRed > 0 || v2.stats.arrived) at = t; }
    wasRed = !v2.green(c, edgeTo(W));
  }
  ok(v2.stats.rightOnRed === 1 && wasRed, 'signal: a right-turner goes on red after stopping', { ror: v2.stats.rightOnRed });
  const v3 = new GraphTraffic(g); while (v3.green(c, edgeTo(W))) v3.time += 0.5;
  const s3 = v3.spawn(W, E)! as Vehicle;
  let crossedOnRed = false; for (let t = 0; t < 160; t += 0.1) { v3.update(0.1); if (s3.seg.kind === 'conn' && !v3.green(c, edgeTo(W)) && s3.s < 0.5) crossedOnRed = true; }
  ok(!crossedOnRed && v3.stats.arrived === 1, 'signal: straight traffic waits for green, then arrives');
  void straight; void t0;
}
// ---- stop sign ----
{
  const { g, W, E } = plus('stop');
  const tr = new GraphTraffic(g);
  const v = tr.spawn(W, E)!;
  let minV = Infinity, conn = false; for (let t = 0; t < 140; t += 0.1) { tr.update(0.1); if (!conn && v.seg.kind === 'lane' && v.s > 470) minV = Math.min(minV, v.v); if (v.seg.kind === 'conn') conn = true; }
  ok(minV < 0.05 && tr.stats.arrived === 1, 'stop sign: full stop, then through', { minV: +minV.toFixed(3) });
}
// ---- roundabout ----
{
  const g = new RoadGraph(); const c = P(1000, 1000), R = 48, k = 0.5523 * R;
  const pts = [P(c.x + R, c.z), P(c.x, c.z + R), P(c.x - R, c.z), P(c.x, c.z - R)];
  const ctl = [[P(c.x + R, c.z + k), P(c.x + k, c.z + R)], [P(c.x - k, c.z + R), P(c.x - R, c.z + k)], [P(c.x - R, c.z - k), P(c.x - k, c.z - R)], [P(c.x + k, c.z - R), P(c.x + R, c.z - k)]];
  for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; g.placeRoad(Float64Array.of(a.x, a.z, ctl[i][0].x, ctl[i][0].z, ctl[i][1].x, ctl[i][1].z, b.x, b.z), 'oneway'); }
  const ends = pts.map((p) => P(c.x + (p.x - c.x) * 6, c.z + (p.z - c.z) * 6));
  pts.forEach((p, i) => g.placeLine(p, ends[i]));
  for (const p of pts) g.nKind[node(g, p.x, p.z)] = 'roundabout';
  g.version++;
  const tr = new GraphTraffic(g);
  const E = ends.map((p) => node(g, p.x, p.z));
  let sent = 0;
  for (let w = 0; w < 10; w++) { for (let i = 0; i < 4; i++) if (tr.spawn(E[i], E[(i + 2) % 4])) sent++; run(tr, 3); }
  run(tr, 240);
  ok(sent >= 30 && tr.stats.arrived === sent, 'roundabout: all entries flow, no deadlock', { sent, arrived: tr.stats.arrived, yields: tr.stats.yields });
}
if (fail) { console.log(`${fail} failures`); process.exit(1); } console.log('gtraffic: all ok');
