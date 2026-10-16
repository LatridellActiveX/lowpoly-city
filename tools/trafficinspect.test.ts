/**
 * tools/trafficinspect.test.ts — OASIS: Inspect traffic diagnostics.
 *
 * Exercises the PURE data functions in src/sim/trafficInspect.ts (and the
 * HTML builders in src/ui/trafficPanel.ts) on a hand-built road graph:
 *   - a signalized 4-way: avenue east–west × road north–south
 *   - a T and dead ends (end vs. outside connection)
 * Checks junction shape / edges / lanes / connections, MISSING-connection
 * detection (we knock connectors out of a junction plan), the signal phase
 * mirroring GraphTraffic.green, queues + longest wait, road-edge stats,
 * vehicle info (route left, stuck), the stuck report, click picking and
 * that none of it mutates the sim state.
 */
import { lineCubic } from '../src/roads/bezier';
import { RoadGraph, ROAD_SPEC } from '../src/roads/graph';
import { GraphTraffic } from '../src/roads/gtraffic';
import { aheadNode, defaultOutside, edgeInfo, nodeInfo, nodeShape, pickGraph, signalInfo, stuckReport, STUCK_SECONDS, vehicleInfo } from '../src/sim/trafficInspect';
import { edgePanel, nodePanel, stuckPill, vehiclePanel } from '../src/ui/trafficPanel';

let fail = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' → ' + JSON.stringify(x) : ''}`); if (!c) fail++; };
const P = (x: number, z: number) => ({ x, z });

/** 4-way at (400,400): avenue W–E (edges w, e), road N–S (edges n, s); a T further east. */
function town() {
  const g = new RoadGraph();
  const c = g.addNode(P(400, 400), 'signal');
  const W = g.addNode(P(200, 400)), E = g.addNode(P(600, 400)), N = g.addNode(P(400, 200)), S = g.addNode(P(400, 600));
  const w = g.addEdge(W, c, lineCubic(P(200, 400), P(400, 400)), 'avenue');
  const e = g.addEdge(c, E, lineCubic(P(400, 400), P(600, 400)), 'avenue');
  const n = g.addEdge(N, c, lineCubic(P(400, 200), P(400, 400)), 'street');
  const s = g.addEdge(c, S, lineCubic(P(400, 400), P(400, 600)), 'street');
  // T at E: a stub going south, ending at the map border (outside connection).
  const B = g.addNode(P(600, 2040));
  const t = g.addEdge(E, B, lineCubic(P(600, 400), P(600, 2040)), 'street');
  return { g, c, W, E, N, S, B, w, e, n, s, t };
}

// ---- shapes ----
{
  const T = town();
  ok(nodeShape(T.g, T.c) === '4-way', 'centre is a 4-way');
  ok(nodeShape(T.g, T.E) === 'bend' || nodeShape(T.g, T.E) === 'T', 'east node (avenue + stub) has its degree shape', nodeShape(T.g, T.E));
  ok(nodeShape(T.g, T.W) === 'end', 'west leaf is an end');
  ok(defaultOutside(T.g, T.B, 2048) && nodeShape(T.g, T.B, true) === 'outside connection', 'leaf at the map border = outside connection');
  ok(!defaultOutside(T.g, T.W, 2048), 'interior leaf is not an outside connection');
}

// ---- junction info: edges, lanes, connections, no missing ----
{
  const T = town(), gt = new GraphTraffic(T.g);
  const ni = nodeInfo(gt, T.c);
  ok(ni.id === T.c && ni.control === 'signal' && ni.edges.length === 4, 'junction lists its 4 edges and control', ni.edges.map((r) => r.edge));
  const av = ni.edges.find((r) => r.edge === T.w)!, st = ni.edges.find((r) => r.edge === T.n)!;
  ok(av.lanesIn === ROAD_SPEC.avenue.lanes && av.lanesOut === ROAD_SPEC.avenue.lanes && av.type === 'avenue' && av.other === T.W, 'avenue approach: lanes in/out, type, far node', av);
  ok(st.lanesIn === ROAD_SPEC.street.lanes && st.type === 'street', 'road approach lane counts', st);
  ok(ni.conns.length === gt.junctions.get(T.c)!.conns.length && ni.conns.every((c) => ['left', 'straight', 'right'].includes(c.turn)), 'connections mirror the junction plan', ni.conns.length);
  ok(ni.missing.length === 0, 'a healthy 4-way reports no missing connections', ni.missing);
  ok(ni.signal !== null && ni.signal.phases === 4, 'signal has one phase per approach', ni.signal);
}

// ---- missing connections ----
{
  const T = town(), gt = new GraphTraffic(T.g);
  const J = gt.junctions.get(T.c)!;
  // Knock out every connector from avenue lane 1 (the outer lane) and every w → n turn.
  J.conns = J.conns.filter((c) => !(c.inEdge === T.w && c.inLane === 1) && !(c.inEdge === T.w && c.outEdge === T.n));
  const ni = nodeInfo(gt, T.c);
  ok(ni.missing.some((m) => m.kind === 'lane' && m.inEdge === T.w && m.inLane === 1), 'dead lane flagged (lane 1 of the avenue has no exit)', ni.missing);
  ok(ni.missing.some((m) => m.kind === 'turn' && m.inEdge === T.w && m.outEdge === T.n), 'missing turn flagged (avenue → road)', ni.missing);
  const html = nodePanel(ni)[1].join('');
  ok(html.includes('Missing connections') && html.includes('has no exit'), 'panel shows the missing connections');
}

// ---- signal phase mirrors GraphTraffic.green ----
{
  const T = town(), gt = new GraphTraffic(T.g);
  let agree = 0, total = 0;
  for (let t = 0; t < 120; t += 0.7) {
    gt.time = t; const s = signalInfo(gt, T.c)!;
    for (const e of [T.w, T.e, T.n, T.s]) { total++; if (gt.green(T.c, e) === (s.state === 'green' && s.greenEdge === e)) agree++; }
    if (!(s.remaining > 0 && s.remaining <= 12)) { ok(false, 'remaining within the phase', s); break; }
  }
  ok(agree === total, 'signal state matches GraphTraffic.green at every sampled time', { agree, total });
  ok(signalInfo(gt, T.E) === null, 'non-signal node has no signal info');
}

// ---- queues, wait, edge + vehicle info, stuck report ----
{
  const T = town(), gt = new GraphTraffic(T.g);
  // Cars from the north end through the centre heading south.
  for (let k = 0; k < 12; k++) { gt.spawn(T.N, T.S); gt.update(0.5); }
  // Run until a car is waiting at the (red) road approach, so there is a queue.
  for (let k = 0; k < 400 && !gt.vehicles.some((v) => v.seg.kind === 'lane' && v.seg.edge === T.n && v.v < 0.1); k++) gt.update(0.25);
  for (let k = 0; k < 8; k++) gt.update(0.25); // let the wait build up (2 s)
  let ni = nodeInfo(gt, T.c); const ei = edgeInfo(gt, T.n);
  ok(ei.id === T.n && ei.from === T.N && ei.to === T.c && ei.label === 'road' && Math.abs(ei.length - 200) < 0.5, 'edge: id, from/to, road label, length', ei);
  ok(ei.lanesAB === 1 && ei.lanesBA === 1, 'edge: lanes per direction', ei);
  const onN = gt.vehicles.filter((v) => v.seg.kind === 'lane' && v.seg.edge === T.n);
  ok(ei.vehicles === onN.length, 'edge: vehicle count', ei.vehicles);
  ok(Math.abs(ei.avgSpeed - (onN.reduce((a, v) => a + v.v, 0) / Math.max(1, onN.length))) < 1e-9, 'edge: average speed');
  const q = ni.queues.find((r) => r.edge === T.n)!;
  const expectQ = onN.filter((v) => v.v < 0.1 && gt.laneLen(T.n) - v.s <= 60 && aheadNode(v) === T.c).length;
  ok(q.queued === expectQ && q.queued > 0 && q.longestWait > 0, 'junction: queue on the road approach counts stationary cars near the line', { q, expectQ });
  ok(ni.longestWait >= q.longestWait, 'junction: longest wait covers every approach');

  // Force a jam: freeze the lead car.
  const v = gt.vehicles[0]; v.v = 0; v.wait = STUCK_SECONDS + 5;
  const before = JSON.stringify(gt.vehicles.map((x) => [x.id, x.s, x.v, x.wait, x.seg]));
  const vi = vehicleInfo(gt, v); ni = nodeInfo(gt, T.c);
  ok(ni.stuck >= 1, 'junction: counts the stuck car waiting for it', ni.stuck);
  ok(vi.id === v.id && vi.stuck && vi.wait === v.wait && vi.blockedAt === aheadNode(v), 'vehicle: stuck with its blocking node', vi);
  ok(vi.edgesLeft === v.path.length - v.i - 1 && vi.metresLeft > 0, 'vehicle: route remaining', { edgesLeft: vi.edgesLeft, m: vi.metresLeft });
  ok(vi.trip === 'decorative' && vi.kind === 'car', 'vehicle: decorative car has no trip');
  const rep = stuckReport(gt);
  ok(rep.vehicles.length === gt.vehicles.filter((x) => x.wait > STUCK_SECONDS).length && rep.vehicles.some((x) => x.id === v.id), 'stuck report lists stuck cars', rep.vehicles.length);
  ok(rep.nodes.length >= 1 && rep.nodes[0].count >= 1, 'stuck report lists the blocking junction', rep.nodes);
  ok(stuckReport(gt, 1e9).vehicles.length === 0, 'threshold respected');
  const html = vehiclePanel(vi)[1].join('') + edgePanel(ei)[1].join('') + nodePanel(ni)[1].join('');
  ok(html.includes(`<code class="cid" title="Click to copy">car ${v.id}</code>`) && html.includes(`node ${T.c}</code>`) && html.includes(`edge ${T.n}</code>`), 'panels print copyable ids');
  ok(!/\d\.\d{3,}/.test(html), 'panels have no float leftovers (formatAmount)');
  ok(stuckPill(true, 3, 1).includes('3') && stuckPill(false, 0, 0).includes('Show'), 'stuck pill text');

  // ---- picking ----
  const pv = gt.position(v);
  ok(JSON.stringify(pickGraph(gt, pv)) === JSON.stringify({ kind: 'vehicle', id: v.id }), 'pick: car under the cursor');
  ok(JSON.stringify(pickGraph(gt, P(402, 398))) === JSON.stringify({ kind: 'node', id: T.c }) || pickGraph(gt, P(402, 398))?.kind === 'vehicle', 'pick: junction box');
  ok(JSON.stringify(pickGraph(gt, P(300, 401))) === JSON.stringify({ kind: 'edge', id: T.w }), 'pick: middle of the avenue', pickGraph(gt, P(300, 401)));
  ok(pickGraph(gt, P(300, 300)) === null, 'pick: open ground → nothing');

  const after = JSON.stringify(gt.vehicles.map((x) => [x.id, x.s, x.v, x.wait, x.seg]));
  ok(before === after, 'inspect functions are read-only (no car moved / changed)');
}

console.log(fail ? `${fail} FAILED` : 'all passed');
if (fail) process.exit(1);
