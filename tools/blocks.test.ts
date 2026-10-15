/**
 * tools/blocks.test.ts — V1.6 B2: zone blocks off the road graph.
 * Golden: straight road → MAX_ROWS×n exact squares; T and + junctions; S-curve;
 * parallel roads 48/64/80 m apart (nearer road wins, no overlap);
 * roundabout. Properties after every case (ZoneBlocks.check): no two cells
 * share a 2 m mask square, no cell on a road, columns contiguous. Zoning
 * and owners survive an unrelated edit and an edge split.
 */
import { RoadGraph } from '../src/roads/graph';
import { ZoneBlocks, MAX_ROWS } from '../src/roads/blocks';
import { quadCubic } from '../src/roads/bezier';

let fail = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fail++; };
const P = (x: number, z: number) => ({ x, z });
const make = (f: (g: RoadGraph) => void) => { const g = new RoadGraph(); f(g); const zb = new ZoneBlocks(); zb.regenerate(g); try { zb.check(g); return { g, zb, err: '' }; } catch (e) { return { g, zb, err: (e as Error).message }; } };

// Straight 320 m road on tile centres: 40 columns × 4 rows × 2 sides, exact 8 m squares on the 8 m grid.
{
  const { zb, err } = make((g) => g.placeLine(P(16, 400), P(336, 400)));
  ok(!err, 'straight: invariants', err || undefined);
  ok(zb.cells.length === 2 * MAX_ROWS * 40, 'straight: 2 sides × MAX_ROWS rows × 40 columns', zb.cells.length);
  const exact = zb.cells.every((c) => { const q = c.quad; const xs = [q[0], q[2], q[4], q[6]], zs = [q[1], q[3], q[5], q[7]]; return Math.abs(Math.max(...xs) - Math.min(...xs) - 8) < 1e-6 && Math.abs(Math.max(...zs) - Math.min(...zs) - 8) < 1e-6 && xs.every((x) => Math.abs(x / 8 - Math.round(x / 8)) < 1e-6) && zs.every((z) => Math.abs(z / 8 - Math.round(z / 8)) < 1e-6); });
  ok(exact, 'straight: every cell an axis-aligned 8×8 m square on the 1.5 cell grid');
  const near = zb.cells.filter((c) => c.row === 0).every((c) => Math.abs(Math.abs(c.cz - 400) - 20) < 1e-6);
  ok(near, 'straight: row 0 centres 20 m from the centreline (16 m setback + 4)');
}
// T junction and + junction
{
  const t = make((g) => { g.placeLine(P(0, 400), P(400, 400)); g.placeLine(P(200, 400), P(200, 700)); });
  ok(!t.err, 'T junction: invariants', t.err || undefined);
  const stub = t.zb.cells.filter((c) => c.row === 0 && c.cz > 400 && Math.abs(c.cx - 200) < 16);
  ok(stub.length === 0, 'T junction: no cells on the side road\'s mouth');
  const plus = make((g) => { g.placeLine(P(0, 400), P(400, 400)); g.placeLine(P(200, 200), P(200, 600)); });
  ok(!plus.err, '+ junction: invariants', plus.err || undefined);
  const q = plus.zb.cells.filter((c) => c.cx > 200 && c.cz > 400 && c.cx < 248 && c.cz < 448);
  ok(q.length > 0 && q.length <= 16, '+ junction: corner quadrant is shared, not doubled', q.length);
}
// S-curve
{
  const s = make((g) => { g.placeRoad(quadCubic(P(100, 300), P(200, 200), P(300, 300))); g.placeRoad(quadCubic(P(300, 300), P(400, 400), P(500, 300))); });
  ok(!s.err, 'S-curve: invariants', s.err || undefined);
  const trap = s.zb.cells.filter((c) => { const q = c.quad; const back = Math.hypot(q[4] - q[6], q[5] - q[7]); return back < 6 - 1e-6 || back > 10 + 1e-6; });
  ok(trap.length === 0, 'S-curve: every back edge between 6 and 10 m');
  ok(s.zb.cells.length > 60, 'S-curve: has zoning on both sides', s.zb.cells.length);
}
// Parallel roads: centre distances 48 / 64 / 80 m → depth 1 / 2 / 3 per road between them.
for (const [gap, want] of [[48, 1], [64, 2], [80, 3]] as const) {
  const r = make((g) => { g.placeLine(P(0, 400), P(320, 400)); g.placeLine(P(0, 400 + gap), P(320, 400 + gap)); });
  ok(!r.err, `parallel ${gap} m: invariants`, r.err || undefined);
  const between = r.zb.cells.filter((c) => c.cz > 400 && c.cz < 400 + gap);
  const fromA = between.filter((c) => c.cz < 400 + gap / 2), fromB = between.filter((c) => c.cz > 400 + gap / 2);
  const dA = Math.max(...fromA.map((c) => c.row)) + 1, dB = Math.max(...fromB.map((c) => c.row)) + 1;
  ok(dA === want && dB === want, `parallel ${gap} m: each road keeps ${want} row(s) between them (nearer road wins)`, [dA, dB]);
  const outside = r.zb.cells.filter((c) => c.cz < 400).every((c) => c.row < MAX_ROWS);
  ok(outside && r.zb.cells.filter((c) => c.cz < 400).length === MAX_ROWS * 40, `parallel ${gap} m: outer sides keep full depth`);
}
// Roundabout: 4 arcs of radius 48 m with 4 spokes
{
  const rb = make((g) => {
    const c = P(1000, 1000), R = 48, k = 0.5523 * R;
    const pts = [P(c.x + R, c.z), P(c.x, c.z + R), P(c.x - R, c.z), P(c.x, c.z - R)];
    const ctl = [[P(c.x + R, c.z + k), P(c.x + k, c.z + R)], [P(c.x - k, c.z + R), P(c.x - R, c.z + k)], [P(c.x - R, c.z - k), P(c.x - k, c.z - R)], [P(c.x + k, c.z - R), P(c.x + R, c.z - k)]];
    for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; const r = g.placeRoad(Float64Array.of(a.x, a.z, ctl[i][0].x, ctl[i][0].z, ctl[i][1].x, ctl[i][1].z, b.x, b.z)); if (!r.ok) throw new Error('ring: ' + r.reason); }
    for (const p of pts) { const r = g.placeLine(p, P(c.x + (p.x - c.x) * 4, c.z + (p.z - c.z) * 4)); if (!r.ok) throw new Error('spoke: ' + r.reason); }
  });
  ok(!rb.err, 'roundabout: invariants', rb.err || undefined);
  ok(rb.zb.cells.length > 100, 'roundabout: zoned', rb.zb.cells.length);
}
// Stability: zoning survives an unrelated edit, and an edge split
{
  const g = new RoadGraph(); g.placeLine(P(0, 400), P(400, 400));
  const zb = new ZoneBlocks(); zb.regenerate(g);
  zb.cells.forEach((c, i) => { c.code = 1 + (i % 3); c.owner = c.row < 2 ? 100 + c.col : 0; });
  const snap = (z: ZoneBlocks) => z.cells.map((c) => `${c.cx.toFixed(3)},${c.cz.toFixed(3)}:${c.code}:${c.owner}`).sort().join('|');
  const before = snap(zb);
  g.placeLine(P(1200, 1200), P(1500, 1300)); zb.regenerate(g);
  const after = zb.cells.filter((c) => c.cz < 600 && c.cx < 600);
  ok(after.map((c) => `${c.cx.toFixed(3)},${c.cz.toFixed(3)}:${c.code}:${c.owner}`).sort().join('|') === before, 'unrelated edit: cells, codes and owners unchanged');
  // Split the road with a T far from cells' identity: codes follow the land.
  g.placeLine(P(200, 400), P(200, 100)); zb.regenerate(g); zb.check(g);
  const southBefore = before.split('|').filter((s) => +s.split(',')[1].split(':')[0] > 400).join('|');
  const south = zb.cells.filter((c) => c.cz > 400 && c.cx < 600).map((c) => `${c.cx.toFixed(3)},${c.cz.toFixed(3)}:${c.code}:${c.owner}`).sort().join('|');
  ok(south === southBefore, 'edge split by a T on the other side: the far side keeps every cell, code and owner');
  ok(zb.lost.length === 0 || zb.lost.every((o) => o >= 100), 'lost owners are reported', zb.lost);
}
// Fuzz: random graphs keep the invariants
{
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let bad = '';
  for (let k = 0; k < 20 && !bad; k++) {
    const g = new RoadGraph();
    for (let i = 0; i < 25; i++) { const a = P(rnd() * 1200, rnd() * 1200), ang = rnd() * 6.283, l = 60 + rnd() * 300; rnd() < 0.3 ? g.placeRoad(quadCubic(a, P(a.x + Math.cos(ang + 0.4) * l / 2, a.z + Math.sin(ang + 0.4) * l / 2), P(a.x + Math.cos(ang) * l, a.z + Math.sin(ang) * l))) : g.placeLine(a, P(a.x + Math.cos(ang) * l, a.z + Math.sin(ang) * l), rnd() < 0.2 ? 'avenue' : 'street'); }
    const zb = new ZoneBlocks(); zb.regenerate(g);
    try { zb.check(g); } catch (e) { bad = `graph ${k}: ${(e as Error).message}`; }
  }
  ok(!bad, 'fuzz: 20 random graphs keep the invariants', bad || undefined);
}
if (fail) { console.log(`${fail} failures`); process.exit(1); } console.log('blocks: all ok');
