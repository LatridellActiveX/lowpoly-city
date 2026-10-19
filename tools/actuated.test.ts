/**
 * tools/actuated.test.ts — OASIS-S3 regression (Parker, 2026-10-19):
 *   "traffic lights are green for cars waiting if there are no cars in the
 *    other roads instead of it being timed".
 *
 * A plus-shaped signal junction (four 500 m arms):
 *  a. REST ON GREEN: with no cars at all the light never changes (200 s).
 *  b. LONE CAR: the light rests green on the cross road; a single car comes
 *     from W on an empty junction — it waits at most ~3 s at its stop line
 *     (the 2 s all-red), never the old fixed ~14 s.
 *  c. FAIRNESS: a steady stream on the cross road keeps its green, but a car
 *     waiting on W still gets green within MAX_GREEN + amber + all-red.
 *  d. MIN GREEN: every green lasts at least MIN_GREEN s.
 *  e. The lamp (signalSlot) shows go exactly when cars may go.
 */
import { RoadGraph } from '../src/roads/graph';
import { AMBER_S, GraphTraffic, MAX_GREEN, MIN_GREEN, SIGNAL_CLEAR } from '../src/roads/gtraffic';
import { signalSlot } from '../src/render/graphUtilities';

let fails = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fails++; };
const P = (x: number, z: number) => ({ x, z });
const plus = () => {
  const g = new RoadGraph();
  g.placeLine(P(0, 500), P(1000, 500), 'street'); g.placeLine(P(500, 0), P(500, 1000), 'street');
  const node = (x: number, z: number) => g.nearestNode(P(x, z), 0.5);
  const c = node(500, 500); g.nKind[c] = 'signal'; g.version++;
  return { g, c, W: node(0, 500), E: node(1000, 500), N: node(500, 0), S: node(500, 1000) };
};

// a. rest on green
{
  const { g, c } = plus(), gt = new GraphTraffic(g);
  const st0 = { ...gt.signalState(c) };
  let changed = 0;
  for (let t = 0; t < 200; t += 0.1) { gt.update(0.1); if (gt.signalState(c).ph !== st0.ph || gt.signalState(c).mode !== 'green') changed++; }
  ok(changed === 0, 'no cars: the light rests on green and never cycles', { changed });
}
// b. lone car on an empty junction
{
  const { g, c, W, E } = plus(), gt = new GraphTraffic(g);
  const eW = g.nEdges[c].find((e) => g.other(e, c) === W)!, J = gt.junctions.get(c)!;
  const phW = J.phases.findIndex((p) => p.includes(eW)), phX = (phW + 1) % J.phases.length;
  gt.forcePhase(c, phX); for (let t = 0; t < 10; t += 0.1) gt.update(0.1); // cross green for a while, empty
  const v = gt.spawn(W, E)!;
  // "wait" = seconds spent (nearly) standing within 60 m of the stop line.
  let wait = 0, entered = -1;
  for (let t = 0; t < 120 && entered < 0; t += 0.1) {
    gt.update(0.1);
    if (v.seg.kind === 'lane' && gt.laneLen(v.seg.edge) - v.s < 60 && v.v < 0.5) wait += 0.1;
    if (v.seg.kind === 'conn') entered = t;
  }
  ok(entered > 0 && wait <= SIGNAL_CLEAR + 1, 'a lone car on an empty junction waits ≤ ~3 s at the line (was up to 14 s)', { wait: +wait.toFixed(1), red: gt.green(c, eW) ? 'turned green' : 'red' });
}
// c + d + e. fairness, min green, lamp
{
  const { g, c, W, E, N, S } = plus(), gt = new GraphTraffic(g);
  const eW = g.nEdges[c].find((e) => g.other(e, c) === W)!, J = gt.junctions.get(c)!;
  const phW = J.phases.findIndex((p) => p.includes(eW)), phX = (phW + 1) % J.phases.length;
  gt.forcePhase(c, phX);
  let wv: ReturnType<GraphTraffic['spawn']> = null, forced = false, wait = 0, entered = -1, shortGreen = 0, lampBad = 0;
  let lastMode = 'green', greenLen = 0;
  for (let t = 0; t < 300; t += 0.1) {
    if (Math.round(t * 10) % 25 === 0) { gt.spawn(N, S); gt.spawn(S, N); } // steady cross stream both ways
    if (!wv && t > 20) wv = gt.spawn(W, E);
    gt.update(0.1);
    const st = gt.signalState(c);
    if (st.mode === 'green') greenLen = st.t; else if (lastMode === 'green' && greenLen < MIN_GREEN - 1e-6) shortGreen++;
    lastMode = st.mode;
    for (const e of g.nEdges[c]) if ((signalSlot(gt, c, e) > 0) !== gt.green(c, e)) lampBad++;
    if (wv && entered < 0) {
      // Worst case: the cross road gets a FRESH green just as the W car arrives.
      if (!forced && wv.seg.kind === 'lane' && gt.laneLen(wv.seg.edge) - wv.s < 40) { gt.forcePhase(c, phX); forced = true; }
      if (wv.seg.kind === 'lane' && gt.laneLen(wv.seg.edge) - wv.s < 60 && wv.v < 0.5) wait += 0.1;
      if (wv.seg.kind === 'conn') entered = t;
    }
  }
  const limit = MAX_GREEN + AMBER_S + SIGNAL_CLEAR + 1;
  ok(entered > 0 && forced && wait > MIN_GREEN - 1 && wait <= limit, 'busy cross road keeps its green a while, but the waiting W car gets green within MAX_GREEN + amber + all-red', { wait: +wait.toFixed(1), limit });
  ok(shortGreen === 0, 'every green lasts at least MIN_GREEN', { shortGreen, MIN_GREEN });
  ok(lampBad === 0, 'lamp shows go exactly when the controller lets cars go', lampBad);
}
console.log(fails ? `${fails} FAILED` : 'all actuated-signal checks passed');
if (fails) process.exit(1);
