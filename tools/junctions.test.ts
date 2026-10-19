/**
 * tools/junctions.test.ts — NEBULA: junction planning (headless).
 * For T, +, Y, 5-arm and bend nodes: every arm is trimmed back (> 0) but never
 * past 45 % of its edge, the two trims of an edge never overlap, a k-arm
 * junction gets k rounded kerb corners whose ends sit on the arms' kerb lines,
 * and a ring of roundabout nodes is detected with an island inside its rim.
 */
import { RoadGraph } from '../src/roads/graph';
import { planAll, edgeTrims, edgeTapers, rings, TAPER_M } from '../src/roads/junctions';
import { roadHalf, ROAD_SPEC, TILE_M } from '../src/roads/graph';
import { extrude, Mesher } from '../src/render/graphRoads';
import { GraphTraffic } from '../src/roads/gtraffic';

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

// ---- OASIS-S5: avenue → street taper ----
{
  const g = new RoadGraph(); g.placeLine(P(0, 100), P(200, 100), 'avenue'); g.placeLine(P(200, 100), P(400, 100), 'street');
  const plans = planAll(g), mid = g.nearestNode(P(200, 100), 0.5), pl = plans.get(mid)!;
  const av = g.nEdges[mid].find((e) => g.eType[e] === 'avenue')!, st = g.nEdges[mid].find((e) => g.eType[e] === 'street')!;
  ok(!!pl.taper && pl.arms[pl.taper.arm].edge === av && pl.taper.narrow === 'street' && pl.taper.len === TAPER_M && !pl.plate, 'straight avenue→street: the avenue arm tapers 30 m into the street (no plate)', pl.taper);
  const [ta, tb] = edgeTapers(g, av);
  ok(!ta && !!tb && tb.len === TAPER_M && edgeTapers(g, st).every((t) => !t), 'edgeTapers: only the avenue end at the street tapers');
  // Geometry: extrude the avenue with its taper; the outer sidewalk edge (max |z|) per slice.
  const m = new Mesher();
  extrude(m, g.eCurve[av], g.eLut[av], g.eLen[av], 'avenue', 1, 0, 0, false, 0, 0, edgeTapers(g, av));
  const widthAt = (X: number) => { let w = 0; for (let i = 0; i < m.pos.length; i += 3) if (Math.abs(m.pos[i] * TILE_M - X) < 0.02) w = Math.max(w, Math.abs(m.pos[i + 2] * TILE_M - 100)); return w; };
  const atNode = widthAt(200), atFull = widthAt(200 - TAPER_M), halfway = widthAt(200 - TAPER_M / 2);
  ok(Math.abs(atNode - roadHalf('street')) < 0.05, 'at the node the avenue is exactly street-wide (sidewalks join, no step)', { atNode: +atNode.toFixed(2), street: roadHalf('street') });
  ok(Math.abs(atFull - roadHalf('avenue')) < 0.05 && Math.abs(widthAt(100) - roadHalf('avenue')) < 0.05, '30 m back (and beyond) it has its full avenue width', { atFull: +atFull.toFixed(2), avenue: roadHalf('avenue') });
  ok(halfway > atNode + 1 && halfway < atFull - 1, 'halfway it is in between', +halfway.toFixed(2));
  let mono = true, prev = Infinity, maxJump = 0;
  for (let X = 200 - TAPER_M; X <= 200; X += 1) { const w = widthAt(X); if (w > prev + 1e-6) mono = false; if (prev < Infinity) maxJump = Math.max(maxJump, prev - w); prev = w; }
  ok(mono && maxJump < 0.6, 'it narrows smoothly in 1 m slices (monotone, no slice narrows > 0.6 m)', { maxJump: +maxJump.toFixed(3) });
  // Traffic lanes bend the same way: the avenue's lanes end on the street lane.
  const gt = new GraphTraffic(g); gt.build();
  const dIn: 0 | 1 = g.eB[av] === mid ? 0 : 1, sIn: 0 | 1 = g.eA[st] === mid ? 0 : 1;
  const end0 = gt.lanePoint(av, dIn, 0, gt.laneLen(av)), end1 = gt.lanePoint(av, dIn, 1, gt.laneLen(av)), stStart = gt.lanePoint(st, sIn, 0, 0);
  // (lanes stop a couple of metres short of the node — the node clearance — so compare the sideways offset)
  ok(Math.abs(end0.z - stStart.z) < 0.2 && Math.abs(end1.z - stStart.z) < 0.2, 'both avenue lanes end in line with the street lane (cars follow the taper)', { end0: +end0.z.toFixed(2), end1: +end1.z.toFixed(2), street: +stStart.z.toFixed(2) });
  const back = gt.lanePoint(av, dIn, 1, gt.laneLen(av) - TAPER_M - 1);
  ok(Math.abs(Math.abs(back.z - 100) - (ROAD_SPEC.avenue.median / 2 + 1.5 * 6)) < 0.05, 'beyond the taper the outer lane is back at its normal offset', +Math.abs(back.z - 100).toFixed(2));
}
{
  // No taper: same type; T-junction; a bend; a short avenue gets 45 % of its length.
  const same = new RoadGraph(); same.placeLine(P(0, 0), P(200, 0), 'avenue'); same.placeLine(P(200, 0), P(400, 0), 'avenue');
  ok([...planAll(same).values()].every((p) => !p.taper), 'avenue → avenue: no taper');
  const T = new RoadGraph(); T.placeLine(P(0, 0), P(400, 0), 'avenue'); T.placeLine(P(200, 0), P(200, 200), 'street');
  ok([...planAll(T).values()].every((p) => !p.taper), 'T-junction avenue/street: no taper (keeps its plate)');
  const bend = new RoadGraph(); bend.placeLine(P(0, 0), P(200, 0), 'avenue'); bend.placeLine(P(200, 0), P(380, 100), 'street');
  ok([...planAll(bend).values()].every((p) => !p.taper), 'a 29° bend avenue/street: no taper (bend plate)');
  const short = new RoadGraph(); short.placeLine(P(0, 0), P(40, 0), 'avenue'); short.placeLine(P(40, 0), P(240, 0), 'street');
  const t = [...planAll(short).values()].find((p) => p.taper)?.taper;
  ok(!!t && Math.abs(t.len - 18) < 0.01, 'a 40 m avenue tapers over 45 % of it (18 m)', t?.len);
  const hw = new RoadGraph(); hw.placeLine(P(0, 0), P(300, 0), 'highway'); hw.placeLine(P(300, 0), P(600, 0), 'avenue');
  const th = [...planAll(hw).values()].find((p) => p.taper)?.taper;
  ok(!!th && th.narrow === 'avenue', 'highway → avenue tapers too (any wider → narrower)', th);
}
console.log(fail ? `${fail} FAILED` : 'all passed'); if (fail) process.exit(1);
