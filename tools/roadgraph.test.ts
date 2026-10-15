/**
 * tools/roadgraph.test.ts — V1.6 B1: road graph core (headless).
 * Split keeps the shape (< 1 cm), snapping priorities, angle / length /
 * curvature / degree rejection, crossings split both roads, T-junctions,
 * merging collinear degree-2 nodes on removal, and a 10,000-placement fuzz
 * that must keep every graph invariant (check()).
 */
import { RoadGraph, MIN_EDGE, isStraight } from '../src/roads/graph';
import { at, quadCubic, split, lineCubic, buildLut, tAtLength, nearest } from '../src/roads/bezier';

let fail = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fail++; };
const P = (x: number, z: number) => ({ x, z });

// ---- Bézier basics ----
{
  const c = quadCubic(P(0, 0), P(100, 0), P(100, 100));
  let worst = 0;
  for (const t of [0.13, 0.5, 0.77]) {
    const [a, b] = split(c, t);
    for (let k = 0; k <= 50; k++) {
      const u = k / 50;
      const pa = at(a, u), pb = at(b, u), qa = at(c, u * t), qb = at(c, t + u * (1 - t));
      worst = Math.max(worst, Math.hypot(pa.x - qa.x, pa.z - qa.z), Math.hypot(pb.x - qb.x, pb.z - qb.z));
    }
  }
  ok(worst < 0.01, 'split keeps the exact shape (max deviation < 1 cm)', +worst.toExponential(2));
  const lut = buildLut(lineCubic(P(0, 0), P(300, 400)));
  ok(Math.abs(lut[lut.length - 1] - 500) < 0.01, 'LUT length of a 500 m straight', lut[lut.length - 1]);
  const t = tAtLength(lut, 250); ok(Math.abs(at(lineCubic(P(0, 0), P(300, 400)), t).x - 150) < 0.5, 'tAtLength finds the middle');
  const nq = nearest(lineCubic(P(0, 0), P(100, 0)), P(40, 7)); ok(Math.abs(nq.t - 0.4) < 1e-4 && Math.abs(nq.d - 7) < 1e-6, 'nearest point on an edge');
}

// ---- placing, crossing, T-junction ----
{
  const g = new RoadGraph();
  const r1 = g.placeLine(P(0, 100), P(400, 100));
  ok(r1.ok && g.edgeCount() === 1 && g.nodeCount() === 2, 'a straight road: 1 edge, 2 nodes');
  const r2 = g.placeLine(P(200, 0), P(200, 300));
  ok(r2.ok && g.edgeCount() === 4 && g.nodeCount() === 5, 'a crossing road splits both: 4 edges, 5 nodes', [g.edgeCount(), g.nodeCount()]);
  const mid = g.nearestNode(P(200, 100), 0.01);
  ok(mid >= 0 && g.nEdges[mid].length === 4, 'crossing node has 4 roads');
  const r3 = g.placeLine(P(300, 250), P(300, 103)); // ends 3 m from road 1 → T-junction
  ok(r3.ok && g.nEdges[g.nearestNode(P(300, 100), 0.01)]?.length === 3, 'end within 6 m of a road snaps into a T-junction');
  g.check();
  // snapping priority: node beats edge
  const s = g.snap(P(203, 104));
  ok(s.kind === 'node' && s.node === mid, 'snap: node (≤ 8 m) wins over a nearby edge');
  const se = g.snap(P(100, 104));
  ok(se.kind === 'edge' && Math.abs(se.p.z - 100) < 1e-6, 'snap: point on an edge (≤ 6 m)');
  ok(g.snap(P(100, 120)).kind === 'free', 'snap: nothing near → free');
  const sa = g.snap(P(57, 31), { angleSnap: true }, P(0, 0));
  ok(sa.kind === 'angle' && Math.abs(Math.atan2(sa.p.z, sa.p.x) - Math.PI / 6) < 1e-9, 'snap: 15° angle steps', sa.p);
  ok(g.snap(P(13, 299), { gridSnap: true }).p.x === 16, 'snap: optional 8 m grid');
  // rejections
  ok(!g.placeLine(P(500, 500), P(510, 500)).ok, 'reject: shorter than 16 m');
  const sharp = g.placeLine(P(0, 100), P(300, 160)); // 11° from road 1 at node (0,100)
  ok(!sharp.ok && /angle/.test(sharp.reason!), 'reject: roads meeting at < 30°', sharp.reason);
  const tight = g.placeRoad(quadCubic(P(600, 0), P(640, 0), P(600, 10)));
  ok(!tight.ok && /tight/.test(tight.reason!), 'reject: curve tighter than the street radius', tight.reason);
  const nearJ = g.placeLine(P(205, 0 + 50), P(205, 200)); // parallel 5 m from road 2: too sharp / too close
  ok(!nearJ.ok, 'reject: crossing too close to a junction or too sharp', nearJ.reason);
  // degree limit: 6 roads at one node, the 7th is refused (spokes 45°+ apart)
  const h = new RoadGraph();
  const c = P(1000, 1000);
  const angs = [0, 60, 120, 180, 240, 300];
  for (const a of angs) h.placeLine(c, P(1000 + 100 * Math.cos(a * Math.PI / 180), 1000 + 100 * Math.sin(a * Math.PI / 180)));
  const hub = h.nearestNode(c, 0.01);
  ok(h.nEdges[hub].length === 6, '6 roads at a junction');
  const seventh = h.placeLine(c, P(1000 + 100 * Math.cos(Math.PI / 6), 1000 + 100 * Math.sin(Math.PI / 6)));
  ok(!seventh.ok && /(Too many|angle)/.test(seventh.reason!), 'reject: a 7th road', seventh.reason);
  // merge on removal
  const m = new RoadGraph();
  m.placeLine(P(0, 0), P(200, 0)); m.placeLine(P(100, -100), P(100, 100));
  ok(m.edgeCount() === 4, 'plus junction: 4 edges');
  const cross = m.nearestNode(P(100, 0), 0.01);
  const vert = m.nEdges[cross].filter((e) => Math.abs(m.dirAt(e, cross).z) > 0.9);
  for (const e of vert) m.removeRoad(e);
  ok(m.edgeCount() === 1 && m.nodeCount() === 2 && isStraight(m.eCurve[m.liveEdges()[0]]), 'removing the side roads merges the straight back into one edge', [m.edgeCount(), m.nodeCount()]);
  m.check();
  // curved road crossing a straight
  const k = new RoadGraph();
  k.placeLine(P(0, 50), P(300, 50));
  const cr = k.placeRoad(quadCubic(P(50, 0), P(150, 200), P(250, 0)));
  ok(cr.ok && cr.edges.length === 3 && k.edgeCount() === 6, 'a curve crossing a straight twice: 3 curve pieces, straight in 3', [cr.edges.length, k.edgeCount()]);
  k.check();
}

// ---- fuzz: 10,000 random placements / removals keep the invariants ----
{
  const g = new RoadGraph();
  let seed = 2024; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let lastOp = ''; let placed = 0, refused = 0, removed = 0, err: string | null = null;
  for (let i = 0; i < 10000 && !err; i++) {
    try {
      if (rnd() < 0.08 && g.edgeCount()) { lastOp = 'remove'; const live = g.liveEdges(); g.removeRoad(live[Math.floor(rnd() * live.length)]); removed++; }
      else {
        const a = P(rnd() * 2048, rnd() * 2048), ang = rnd() * Math.PI * 2, len = 20 + rnd() * 300;
        const b = P(a.x + Math.cos(ang) * len, a.z + Math.sin(ang) * len);
        const r = rnd() < 0.3 ? g.placeRoad(quadCubic(a, P((a.x + b.x) / 2 + (rnd() - 0.5) * len * 0.5, (a.z + b.z) / 2 + (rnd() - 0.5) * len * 0.5), b), rnd() < 0.2 ? 'avenue' : 'street', { angleSnap: rnd() < 0.3 }) : g.placeLine(a, b);
        lastOp = 'place ' + JSON.stringify([a, b]) + ' ' + r.ok; if (r.ok) placed++; else refused++;
      }
      if (process.env.RG_EVERY || i % 500 === 499) g.check();
    } catch (e) { err = `step ${i} after ${lastOp}: ${(e as Error).message}`; }
  }
  if (!err) try { g.check(); } catch (e) { err = (e as Error).message; }
  ok(!err, `fuzz 10k ops: ${placed} placed, ${refused} refused, ${removed} removed, ${g.edgeCount()} edges — invariants hold`, err ?? undefined);
  ok(g.liveEdges().every((e) => g.eLen[e] >= MIN_EDGE - 1e-6), 'fuzz: every edge ≥ 16 m');
}
if (fail) { console.log(`${fail} failures`); process.exit(1); } console.log('roadgraph: all ok');
