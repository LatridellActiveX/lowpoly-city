/**
 * tools/keeptraffic.test.ts — OASIS-S2 regression (Parker, 2026-10-19):
 *   "make it so that building roads that connect to existing roads doesn't
 *    clear traffic on the existing road".
 *
 * Bench town on the road graph, 500 ticks of traffic, then:
 *  a. a TILE road is built off the x=50 street (a new T junction splits
 *     that street's edge). At the next traffic update:
 *       - no trip is lost: kept + moved + finished = the live cars before;
 *       - most cars stay (finished ≤ 10 % of them, was 100 %);
 *       - every car on an edge the edit did not touch is the same car
 *         (same id) at the same map point (≤ 0.05 m);
 *       - cars that were on the split edge are still on the road (moved, not
 *         finished) when there were any;
 *       - no two cars in one lane / connector overlap (real lengths).
 *  b. a FREE road connected to an existing road, then UNDO (undo swaps in a
 *     cloned graph object): cars survive both.
 *  c. traffic keeps flowing for 600 more ticks (< 10 % of new trips give up).
 */
import { buildTown, rect, tick, Simulation, World } from './bench/town';
import { migrateToGraph } from '../src/roads/persist';
import { minSpacing } from '../src/roads/gtraffic';
import { placeFreeRoad, undo } from '../src/sim/freeroads';
import { lineCubic } from '../src/roads/bezier';

let fails = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fails++; };

const s = new Simulation(new World(undefined, 4242)); migrateToGraph(s.world); buildTown(s);
for (let i = 0; i < 500; i++) tick(s);
const w = s.world, lg = s.traffic.graph;
type Rec = { id: number; x: number; z: number; key: string };
const key = (e: number) => { const g = w.roads, c = g.eCurve[e]; return `${g.eBorn[e]}|${g.eLen[e].toFixed(3)}|${c[0].toFixed(2)},${c[1].toFixed(2)}`; };
/** Every live car: id, map point, and the identity of the edge it is on (lanes only). */
const record = (): Rec[] => lg.vehicles.filter((v) => !v.done).map((v) => { const p = lg.gt!.position(v); return { id: v.id, x: p.x, z: p.z, key: v.seg.kind === 'lane' ? key(v.seg.edge) : '' }; });
/** No overlap anywhere (centre distance ≥ half of each body + MIN_GAP). */
const overlaps = () => {
  const by = new Map<string, typeof lg.vehicles>();
  for (const v of lg.vehicles) if (!v.done) { const k = v.seg.kind === 'lane' ? `${v.seg.edge}:${v.seg.dir}:${v.seg.lane}` : `c${v.seg.node}:${v.seg.idx}`; (by.get(k) ?? by.set(k, []).get(k)!).push(v); }
  let bad = 0;
  for (const l of by.values()) { l.sort((a, b) => a.s - b.s); for (let k = 0; k + 1 < l.length; k++) if (l[k + 1].s - l[k].s < minSpacing(l[k], l[k + 1]) - 1e-6) bad++; }
  return bad;
};
const st0 = () => ({ ...lg.stats });
/** Bring the live traffic in step with the edited graph (LiveGraphTraffic.sync, run by every update/spawn). */
const adopt = () => (lg as unknown as { sync(w: World): void }).sync(w);

// ---- a. a tile road off the x=50 street ----
{
  const before = record(), b0 = st0(), v0 = w.roads.version;
  const live = before.length;
  // Which edges will survive? (all except the one split by the new junction at z=30)
  const ar = s.apply('road', rect(51, 30, 55, 30));
  ok(ar.changed > 0 && w.roads.version !== v0, 'new road built and joined to the x=50 street', { changed: ar.changed });
  const alive = new Set(w.roads.liveEdges().map(key));
  adopt(); // what the next traffic update does first (without moving anyone, so positions compare exactly)
  const st = lg.stats, kept = st.keptOnEdit - b0.keptOnEdit, moved = st.movedOnEdit - b0.movedOnEdit, fin = st.finishedOnEdit - b0.finishedOnEdit;
  ok(live > 20, 'plenty of live cars before the edit', live);
  ok(kept + moved + fin === live, 'no trip lost (kept + moved + finished = live)', { live, kept, moved, fin });
  ok(fin <= live * 0.1, 'traffic is NOT cleared: ≤ 10 % of cars finish on the edit (was 100 %)', { fin, live });
  const now = new Map(record().map((r) => [r.id, r]));
  const untouched = before.filter((r) => r.key && alive.has(r.key));
  const stayed = untouched.filter((r) => { const n = now.get(r.id); return n && Math.hypot(n.x - r.x, n.z - r.z) <= 0.05; });
  if (process.env.DBG) for (const r of untouched) { const n = now.get(r.id); const v = lg.vehicles.find((q) => q.id === r.id); console.log('U', r.id, n ? Math.hypot(n.x - r.x, n.z - r.z).toFixed(2) : 'gone', v?.seg, v?.s.toFixed(1), v?.v.toFixed(1)); }
  ok(untouched.length > 10 && stayed.length === untouched.length, 'every car on an untouched road stays exactly where it was', { untouched: untouched.length, stayed: stayed.length });
  const onSplit = before.filter((r) => r.key && !alive.has(r.key));
  if (process.env.DBG) for (const r of onSplit) { const n = now.get(r.id); console.log('S', r.id, n ? Math.hypot(n.x - r.x, n.z - r.z).toFixed(2) : 'gone'); }
  // The split street gets a new junction (with stop lines) in its middle, so
  // a queue there may have to shuffle up a few metres to keep safe gaps.
  const splitKept = onSplit.filter((r) => { const n = now.get(r.id); return n && Math.hypot(n.x - r.x, n.z - r.z) <= 8; });
  ok(onSplit.length > 0 && splitKept.length >= onSplit.length - 1, 'cars on the split street stay on it (≤ 8 m; at most one finishes)', { onSplit: onSplit.length, kept: splitKept.length });
  ok(overlaps() === 0, 'no overlapping cars after the edit', overlaps());
}
// ---- b. a free road off an existing road, then undo ----
{
  for (let i = 0; i < 60; i++) tick(s);
  const live = record().length, b0 = st0();
  // A free road starting ON an existing street and running out into open land
  // (first candidate that is buildable: the town's edges are lined with zones).
  const T = 32;
  let p = { ok: false, reason: 'no candidate' } as ReturnType<typeof placeFreeRoad>;
  for (const [x0, z0, x1, z1] of [[10.5, 37.5, 4.5, 37.5], [10.5, 23.5, 4.5, 23.5], [30.5, 40.5, 30.5, 46.5], [20.5, 40.5, 20.5, 46.5], [50.5, 37.5, 56.5, 37.5]]) {
    p = placeFreeRoad(s, lineCubic({ x: x0 * T, z: z0 * T }, { x: x1 * T, z: z1 * T }), 'street', {}, true, true);
    if (p.ok) { console.log('free road at', [x0, z0, x1, z1]); break; }
  }
  ok(p.ok, 'free road placed off an existing street', p.reason);
  adopt();
  const d1 = { kept: lg.stats.keptOnEdit - b0.keptOnEdit, moved: lg.stats.movedOnEdit - b0.movedOnEdit, fin: lg.stats.finishedOnEdit - b0.finishedOnEdit };
  ok(d1.kept + d1.moved + d1.fin === live && d1.fin <= live * 0.1, 'free road: traffic kept', { live, ...d1 });
  const live2 = record().length, b1 = st0(), before = new Map(record().map((r) => [r.id, r]));
  ok(undo(s), 'undo the free road');
  adopt();
  const d2 = { kept: lg.stats.keptOnEdit - b1.keptOnEdit, moved: lg.stats.movedOnEdit - b1.movedOnEdit, fin: lg.stats.finishedOnEdit - b1.finishedOnEdit };
  ok(d2.kept + d2.moved + d2.fin === live2 && d2.fin <= live2 * 0.1, 'undo (new graph object): traffic kept', { live2, ...d2 });
  const same = record().filter((r) => { const o = before.get(r.id); return o && Math.hypot(o.x - r.x, o.z - r.z) <= 0.05; }).length;
  ok(same >= live2 * 0.8, 'after undo most cars are exactly where they were', { same, live2 });
  ok(overlaps() === 0, 'no overlapping cars after undo', overlaps());
}
// ---- c. still flowing ----
{
  const b0 = st0();
  for (let i = 0; i < 600; i++) tick(s);
  const sp = lg.stats.spawned - b0.spawned, gu = lg.stats.gaveUp - b0.gaveUp;
  ok(sp > 300 && gu / sp < 0.1, 'traffic keeps flowing after the edits (< 10 % give up)', { spawned: sp, gaveUp: gu, rate: +(gu / sp).toFixed(4) });
  ok(overlaps() === 0, 'no overlaps after 600 more ticks', overlaps());
}
console.log(fails ? `${fails} FAILED` : 'all keep-traffic checks passed');
if (fails) process.exit(1);
