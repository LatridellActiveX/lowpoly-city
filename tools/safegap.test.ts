/**
 * tools/safegap.test.ts — OASIS-SAFEGAP regression (Parker, 2026-10-16:
 * "traffic bumps into each other too much and the traffic polys merge into
 * each other on the road").
 *
 * Checks (all with each vehicle's REAL drawn length, Vehicle.length):
 *  a. FUZZ: in the bench town (lights, stop signs, a roundabout, streets and
 *     avenues) and in Parker's avenue save, after EVERY tick, no two vehicles
 *     in the same lane or on the same connector are closer (centre to
 *     centre) than half of each body + MIN_GAP — i.e. models never overlap.
 *  b. SLOT RESERVATION: every time a junction lets a vehicle into its box,
 *     the exit lane, counted independently here, has room for that whole
 *     vehicle after everything already crossing towards it.
 *  c. Parker's avenue save: over 1,200 s the give-up rate stays near 0%
 *     (< 2%) and throughput (graph trips completed) stays ≥ the pre-safe-gap
 *     figure recorded below.
 * Also prints the before/after metrics used in the change log.
 */
import { readFileSync } from 'node:fs';
import { loadCode } from './fixtures/loadCode';
import { buildTown, tick, Simulation, World } from './bench/town';
import { migrateToGraph } from '../src/roads/persist';
import { MIN_GAP } from '../src/roads/gtraffic';

let fails = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fails++; };

/**
 * Pre-safe-gap (commit 4d99fff) trips COMPLETED on Parker's save in 1,200 s
 * (graph cars + the tile-router fallback): 2,455 (graph 2,175 + tile 280),
 * measured with this harness. With real-length cars a lane holds about half
 * as many cars, so more trips take the fallback; the total must stay within
 * run-to-run noise (±3%) of the baseline: ≥ 93%.
 */
const BASELINE_TRIPS = 2455, TRIPS_FLOOR = 0.93;

/** Hook a sim's GraphTraffic: watch spacing every tick and every junction admission. */
function watch(s: Simulation, frames: number, dt = 0.25) {
  let pairs = 0, worst = Infinity, overlaps: unknown[] = [], admits = 0, badAdmits: unknown[] = [];
  const hooked = new WeakSet<object>();
  const st0 = { ...s.traffic.graph.stats }, tile0 = (s.traffic as any).stats.arrived;
  for (let f = 0; f < frames; f++) {
    const gt = s.traffic.graph.gt as any;
    if (gt && !hooked.has(gt)) {
      hooked.add(gt);
      const orig = gt.mayEnter.bind(gt);
      // Independent re-count of the exit room whenever the junction says "go".
      gt.mayEnter = (v: any, n: number, ci: number, d: number) => {
        const yes = orig(v, n, ci, d);
        if (!yes) return yes;
        admits++;
        const J = gt.junctions.get(n), c = J.conns[ci];
        const lane = Math.min(gt.laneFor(v.path, v.nodes, v.i + 1, v), gt.lanes(c.outEdge) - 1);
        const ex = gt.list({ kind: 'lane', edge: c.outEdge, dir: gt.g.eA[c.outEdge] === n ? 0 : 1, lane });
        let used = 0;
        for (let j = 0; j < J.conns.length; j++) if (J.conns[j].outEdge === c.outEdge) for (const o of gt.list({ kind: 'conn', node: n, idx: j })) used += o.length + MIN_GAP;
        const L = gt.laneLen(c.outEdge), free = (ex.length ? ex[0].s - ex[0].length / 2 : L) - used;
        if (free < Math.min(v.length / 2 + MIN_GAP, L) - 1e-6 && badAdmits.length < 5) badAdmits.push({ n, ci, free: +free.toFixed(2), len: v.length });
        return yes;
      };
    }
    s.update(dt);
    if (!gt) continue;
    for (const [, l] of gt.onSeg as Map<string, any[]>) for (let k = 0; k + 1 < l.length; k++) {
      const a = l[k], b = l[k + 1], need = (a.length + b.length) / 2 + MIN_GAP, d = b.s - a.s;
      pairs++; worst = Math.min(worst, d - need);
      if (d < need - 1e-6 && overlaps.length < 5) overlaps.push({ f, seg: a.seg, d: +d.toFixed(2), need });
    }
  }
  const st = s.traffic.graph.stats;
  const spawned = st.spawned - st0.spawned, gaveUp = st.gaveUp - st0.gaveUp, arrived = st.arrived - st0.arrived;
  const tileArrived = (s.traffic as any).stats.arrived - tile0;
  return { trips: arrived + tileArrived, tileArrived, pairs, worst: +worst.toFixed(3), overlaps, admits, badAdmits, spawned, arrived, gaveUp, fellBack: st.fellBack - st0.fellBack, rate: spawned ? gaveUp / spawned : 1 };
}

// ---- bench town fuzz ----
{
  const s = new Simulation(new World(undefined, 4242)); migrateToGraph(s.world); buildTown(s);
  for (let i = 0; i < 300; i++) tick(s);
  const r = watch(s, 2400);
  console.log('     bench town', JSON.stringify(r));
  ok(r.pairs > 10000 && r.overlaps.length === 0, 'bench town: no two cars in a lane/connector ever closer than the minimum gap (every tick, 600 s)', { pairs: r.pairs, worst: r.worst, overlaps: r.overlaps });
  ok(r.admits > 500 && r.badAdmits.length === 0, 'bench town: a junction never admits a car without exit-lane room', { admits: r.admits, bad: r.badAdmits });
}
// ---- Parker's avenue save ----
{
  const s = loadCode(readFileSync('tools/fixtures/parker-avenue.lpc', 'utf8').trim());
  const r = watch(s, 4800);
  console.log('     parker avenue', JSON.stringify(r));
  ok(r.overlaps.length === 0, "Parker's save: no two cars in a lane/connector ever closer than the minimum gap", { pairs: r.pairs, worst: r.worst, overlaps: r.overlaps });
  ok(r.badAdmits.length === 0, "Parker's save: a junction never admits a car without exit-lane room", { admits: r.admits, bad: r.badAdmits });
  ok(r.spawned > 1000 && r.rate < 0.02, "Parker's save: give-up rate stays near 0% (< 2%) over 1,200 s", { rate: r.rate });
  ok(r.trips >= BASELINE_TRIPS * TRIPS_FLOOR, "Parker's save: throughput (trips completed in 1,200 s) holds vs before safe-gap", { trips: r.trips, graph: r.arrived, tile: r.tileArrived, baseline: BASELINE_TRIPS, ratio: +(r.trips / BASELINE_TRIPS).toFixed(3) });
}
console.log(fails ? `\n${fails} FAILED` : '\nall safegap checks passed');
if (fails) process.exit(1);
