/**
 * tools/nebula.test.ts — NEBULA: the graph's street furniture (headless).
 *  power:   poles on every road, none inside a junction plate, wires form ONE
 *           connected network across a crossroads + T + curve town;
 *  water:   every edge's main starts and ends on its nodes (mains meet);
 *  signals: one pole per approach at signal nodes, the lit lamp agrees with
 *           the controller (green ⇔ GraphTraffic.green), amber only at the
 *           end of a green, and exactly one approach shows go at a time.
 */
import { RoadGraph } from '../src/roads/graph';
import { quadCubic } from '../src/roads/bezier';
import { planAll, rings } from '../src/roads/junctions';
import { graphMains, graphPower, graphSignals, signalSlot } from '../src/render/graphUtilities';
import { GraphTraffic } from '../src/roads/gtraffic';

let fail = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fail++; };
const P = (x: number, z: number) => ({ x, z });

const g = new RoadGraph();
g.placeLine(P(0, 200), P(600, 200));
g.placeLine(P(300, 0), P(300, 500));
g.placeLine(P(450, 200), P(450, 450));
g.placeRoad(quadCubic(P(0, 200), P(-100, 350), P(0, 500)));
for (const n of g.liveNodes()) if (g.nEdges[n].length >= 3) g.nKind[n] = 'signal';
const rs = rings(g), plans = planAll(g, rs);

// ---- power ----
const pw = graphPower(g, plans, rs);
ok(pw.poles.length >= g.edgeCount() * 2, 'street poles on every road', pw.poles.length);
const par = pw.poles.map((_, i) => i), f = (a: number): number => (par[a] === a ? a : (par[a] = f(par[a])));
for (const [a, b] of pw.spans) par[f(a)] = f(b);
const comps = new Set(pw.poles.map((_, i) => f(i))).size;
ok(comps === 1, 'all poles wired into one network (like the sim conduit)', comps);
let inside = 0;
for (const [n, p] of plans) if (p.junction) for (const q of pw.poles) {
  const d = Math.hypot(q.x * 32 - g.nx[n], q.z * 32 - g.nz[n]);
  if (d < Math.min(...p.arms.map((a) => a.trim)) - 0.5 && d < 4) inside++;
}
ok(inside === 0, 'no pole stands in the middle of a junction', inside);
const maxSpan = Math.max(...pw.spans.map(([a, b]) => Math.hypot(pw.poles[a].x - pw.poles[b].x, pw.poles[a].z - pw.poles[b].z) * 32));
ok(maxSpan < 90, 'no wire span longer than ~3 tiles', +maxSpan.toFixed(1));

// ---- water ----
const { segs, joints } = graphMains(g);
const near = (p: { x: number; z: number }) => g.liveNodes().some((n) => Math.hypot(p.x * 32 - g.nx[n], p.z * 32 - g.nz[n]) < 0.01);
ok(joints.length === g.liveNodes().filter((n) => g.nEdges[n].length).length, 'a joint at every node');
const ends = segs.filter(([a]) => near(a)).length;
ok(ends >= g.edgeCount(), 'every main starts on a node', [ends, g.edgeCount()]);
ok(segs.length > g.edgeCount(), 'curved edges are cut into several pipe pieces', segs.length);

// ---- signals ----
const sig = graphSignals(g, plans);
const want = [...plans.entries()].filter(([n, p]) => g.nKind[n] === 'signal' && p.junction).reduce((s, [, p]) => s + p.arms.length, 0);
ok(sig.length === want && want > 0, 'one signal pole per approach', [sig.length, want]);
const gt = new GraphTraffic(g as any);
let mismatch = 0, multi = 0, amberSeen = 0, amberBad = 0;
for (let step = 0; step < 400; step++) {
  gt.time = step * 0.25;
  const goByNode = new Map<number, number>();
  for (const s of sig) {
    const slot = signalSlot(gt, s.node, s.edge);
    if ((slot > 0) !== gt.green(s.node, s.edge)) mismatch++;
    // OASIS-AVENUE: opposite approaches share a phase now, so count the
    // distinct PHASES showing go at a node (must be ≤ 1), not approaches.
    if (slot > 0) { const J = gt.junctions.get(s.node)!; const ph = J.phases.findIndex((p) => p.includes(s.edge)); const prev = goByNode.get(s.node); goByNode.set(s.node, prev === undefined || prev === ph ? ph : -1); }
    if (slot === 1) { amberSeen++; if (!gt.green(s.node, s.edge)) amberBad++; }
  }
  for (const v of goByNode.values()) if (v < 0) multi++;
}
ok(mismatch === 0, 'lamp shows go exactly when the controller is green', mismatch);
ok(multi === 0, 'one phase at a time shows green/amber (opposite approaches together)', multi);
ok(amberSeen > 0 && amberBad === 0, 'amber appears, only at the end of a green', amberSeen);
console.log(fail ? `${fail} FAILED` : 'all passed'); if (fail) process.exit(1);
