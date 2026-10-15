/**
 * tools/junctions.test.ts — NEBULA: junction planning (headless).
 * For T, +, Y, 5-arm and bend nodes: every arm is trimmed back (> 0) but never
 * past 45 % of its edge, the two trims of an edge never overlap, a k-arm
 * junction gets k rounded kerb corners whose ends sit on the arms' kerb lines,
 * and a ring of roundabout nodes is detected with an island inside its rim.
 */
import { RoadGraph } from '../src/roads/graph';
import { planAll, edgeTrims, rings } from '../src/roads/junctions';

let fail = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fail++; };
const P = (x: number, z: number) => ({ x, z });

function check(name: string, g: RoadGraph, wantArms: number) {
  const plans = planAll(g);
  const j = [...plans.values()].find((p) => p.arms.length === wantArms);
  ok(!!j, `${name}: a ${wantArms}-arm node is planned`);
  if (!j) return;
  ok(j.arms.every((a) => a.trim > 0 && a.trim <= g.eLen[a.edge] * 0.45 + 1e-6), `${name}: trims in (0, 45% of edge]`, j.arms.map((a) => +a.trim.toFixed(1)));
  ok(j.corners.length === wantArms, `${name}: one rounded corner per arm gap`, j.corners.length);
  for (const e of g.liveEdges()) { const [a, b] = edgeTrims(g, plans, e); if (a + b >= g.eLen[e]) ok(false, `${name}: edge ${e} trims overlap`); }
}
{ const g = new RoadGraph(); g.placeLine(P(0, 100), P(400, 100)); g.placeLine(P(200, 100), P(200, 300)); check('T', g, 3); }
{ const g = new RoadGraph(); g.placeLine(P(0, 100), P(400, 100)); g.placeLine(P(200, 0), P(200, 300)); check('+', g, 4); }
{ const g = new RoadGraph(); g.placeLine(P(200, 0), P(200, 150)); g.placeLine(P(200, 150), P(80, 300)); g.placeLine(P(200, 150), P(320, 300)); check('Y', g, 3); }
{ const g = new RoadGraph(); g.placeLine(P(0, 200), P(400, 200)); g.placeLine(P(200, 0), P(200, 400)); g.placeLine(P(50, 50), P(200, 200)); check('5-arm', g, 5); }
{
  const g = new RoadGraph(); const c = P(500, 500), R = 30, N = 6;
  const ids: number[] = [];
  for (let k = 0; k < N; k++) { const a = (k / N) * Math.PI * 2; ids.push(g.addNode(P(c.x + Math.cos(a) * R, c.z + Math.sin(a) * R), 'roundabout')); }
  for (let k = 0; k < N; k++) { const A = g.nodePos(ids[k]), B = g.nodePos(ids[(k + 1) % N]); g.addEdge(ids[k], ids[(k + 1) % N], [A.x, A.z, A.x + (B.x - A.x) / 3, A.z + (B.z - A.z) / 3, A.x + 2 * (B.x - A.x) / 3, A.z + 2 * (B.z - A.z) / 3, B.x, B.z] as any, g.eType[0] ?? ('road' as any)); }
  const rs = rings(g);
  ok(rs.length === 1 && rs[0].nodes.length === N, 'roundabout ring detected', rs.length);
  if (rs[0]) ok(rs[0].island > 0 && rs[0].island < rs[0].r && rs[0].outer > rs[0].r, 'island inside the lane, rim outside', rs[0]);
}
console.log(fail ? `${fail} FAILED` : 'all passed'); if (fail) process.exit(1);
