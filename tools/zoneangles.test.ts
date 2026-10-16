/**
 * tools/zoneangles.test.ts — NEBULA: rectangle zoning on small cells, preview == result,
 * at EVERY camera angle.
 *
 * Map sizes 64 and 192, new (graph) game with a straight tile road crossed by a
 * second one (a junction), a curved free road and a road along the map edge.
 * Cases (anchor corner → opposite corner, in tiles): both sides of the straight
 * road and of the curve, in all 4 diagonal directions, starting ON the road
 * surface, on the kerb strip, just beside the road, at the junction and at the
 * map edge. For each case × 8 yaws (45° steps) × 4 pitches × 2 zooms:
 *  1. both corners are projected to screen with the real IsoCamera and picked
 *     back like ui/input.ts (ray vs. the y=0 ground) → the snapped small-cell box
 *     must be exactly the box of the aimed points (nothing offset);
 *  2. what the preview counts/draws (rectQuote keys: zone cells + kerb fill) must
 *     equal the grid cells mouse-up (paintRect) changes, then undo;
 *  3. nothing dropped: every grid cell inside the box is either zoned now or in
 *     the preview's red `skipped` list, and every bare tile cell in the box that
 *     touches the road side got zoned;
 *  4. each highlighted square, drawn at Y_PREVIEW, projects back into its own
 *     cell (the on-ground drawing from 235655a).
 * Parker's free-road save (tools/fixtures/parker-freeroads.lpc): drags beside his 30°
 * free road on both sides, 4 directions, from the road surface, the kerb, beside it and
 * back toward it, must use the road's frame.
 * Plus: small-cell granularity (a click zones exactly one cell, a 3×2 box six),
 * and the removed zoning modes (depth strips, brush, depth drag) are gone.
 */
import * as THREE from 'three';
import { readFileSync } from 'fs';
import { Simulation, World } from './bench/town';
import { migrateToGraph } from '../src/roads/persist';
import { allRegions } from '../src/sim/regions';
import { GRID_SIZE } from '../src/sim/types';
import { setGridSize } from '../src/sim/mapsize';
import { placeFreeRoad, undo } from '../src/sim/freeroads';
import { quadCubic } from '../src/roads/bezier';
import { IsoCamera } from '../src/render/camera';
import { Y_PREVIEW } from '../src/render/previewHeights';
import { paintRect, planRect, rectQuote, snapBox } from '../src/sim/zoneRect';
import * as FRT from '../src/ui/freeRoadTool';
import { loadCode } from './fixtures/loadCode';

let fail = 0, passed = 0;
const ok = (c: boolean, m: string, x?: unknown) => { if (c) { passed++; if (!process.env.VERBOSE) return; } console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fail++; };
type P = { x: number; z: number };
const CODE = 1; // residential low

/**
 * Frame checks. Grid tile roads / open land → 'grid' mode and the picked box equals the
 * aimed box. Free-form (curved / angled) roads → 'road' mode: the rectangle is in the
 * road's frame — every zoned cell is on the anchor's block (one edge, one side), the
 * col × row range is complete (each cell in it is zoned or shown red), and the picked
 * points give exactly the cells the aimed points give. Drags starting ON the road or
 * the kerb anchor at the road-side row 0.
 */
function checkFrame(s: Simulation, tag: string, name: string, plan: ReturnType<typeof planRect>, aimed: ReturnType<typeof planRect>): void {
  const want = /curve|angled/.test(name) ? 'road' : 'grid';
  ok(plan.mode === want, `${tag}: ${want} frame`, plan.mode);
  if (plan.mode === 'grid') { ok(sameBox(plan.box, aimed.box), `${tag}: snapped box == aimed box`, plan.box); return; }
  const keys = (p: typeof plan) => p.zone.map((c) => `${c.edge}/${c.side}/${c.col}/${c.row}`).sort().join();
  ok(keys(plan) === keys(aimed), `${tag}: picked road-frame cells == aimed`, [plan.zone.length, aimed.zone.length]);
  const all = [...plan.zone, ...plan.skippedCells];
  if (!all.length) { ok(false, `${tag}: road frame zones nothing`); return; }
  const e = all[0].edge, sd = all[0].side;
  ok(all.every((c) => c.edge === e && c.side === sd), `${tag}: one road, one side`);
  const c0 = Math.min(...all.map((c) => c.col)), c1 = Math.max(...all.map((c) => c.col)), r0 = Math.min(...all.map((c) => c.row)), r1 = Math.max(...all.map((c) => c.row));
  const inRange = s.world.blocks.cells.filter((c) => c.edge === e && c.side === sd && c.col >= c0 && c.col <= c1 && c.row >= r0 && c.row <= r1);
  ok(inRange.length === all.length, `${tag}: col×row range complete (nothing dropped)`, [inRange.length, all.length]);
  ok(plan.size[0] === c1 - c0 + 1 && plan.size[1] === r1 - r0 + 1, `${tag}: size = cols × rows`, plan.size);
  if (/from road|from kerb/.test(name)) ok(r0 === 0, `${tag}: road-side start anchors at row 0`, r0);
}
const sameBox = (a: ReturnType<typeof snapBox>, b: ReturnType<typeof snapBox>) => a.cx0 === b.cx0 && a.cx1 === b.cx1 && a.cz0 === b.cz0 && a.cz1 === b.cz1;

/** Every case × 8 yaws × 4 pitches × 2 zooms: pick, plan, preview == zoned, nothing dropped, undo. */
function sweep(s: Simulation, label: string, cases: Array<[string, P, P]>): void {
  const w = s.world, N = GRID_SIZE, W = N * 4;
  const cam = new IsoCamera(); cam.resize(1280, 800);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(N, N).rotateX(-Math.PI / 2).translate(N / 2, 0, N / 2));
  ground.updateMatrixWorld();
  const ray = new THREE.Raycaster(), v = new THREE.Vector3(), ndc = new THREE.Vector2();
  const roundTrip = (x: number, y: number, z: number): P | null => {
    v.set(x, y, z).project(cam.camera);
    if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
    ndc.set(v.x, v.y); ray.setFromCamera(ndc, cam.camera);
    const h = ray.intersectObject(ground, false)[0];
    return h ? { x: h.point.x, z: h.point.z } : null;
  };
  let combos = 0, zonedAny = 0;
  for (let rot = 0; rot < 4; rot++) for (const fy of [0, Math.PI / 4]) for (const pitch of [0.38, 0.6155, 0.9, 1.13]) for (const zoom of [1, 3]) {
    cam.rotation = rot; cam.freeYaw = fy; cam.elevation = pitch; cam.zoomBy(zoom / cam.zoom);
    for (const [name, A, B] of cases) {
      const tag = `${label} ${name} yaw=${rot * 90 + (fy ? 45 : 0)} pitch=${pitch} zoom=${zoom}`;
      cam.target.set((A.x + B.x) / 2 + 0.3, 0, (A.z + B.z) / 2 - 0.2); cam.update(0);
      cam.camera.updateMatrixWorld(); cam.camera.updateProjectionMatrix();
      const a = roundTrip(A.x, 0, A.z), b = roundTrip(B.x, 0, B.z);
      if (!a || !b) { ok(false, `${tag}: corner off-screen`); continue; }
      const plan = planRect(s, 'residential', a, b);
      checkFrame(s, tag, name, plan, planRect(s, 'residential', A, B));
      // 2. preview == zoned
      const q = rectQuote(s, plan, CODE, 'residential');
      const before = Array.from(w.cells.zone);
      const r = paintRect(s, 'residential', plan, CODE);
      const changed: number[] = []; w.cells.zone.forEach((z, i) => { if (z !== before[i]) changed.push(i); });
      ok(JSON.stringify(q.keys) === JSON.stringify(changed) && r.changed === changed.length, `${tag}: preview == zoned`, { preview: q.keys.length, zoned: changed.length });
      // 3. nothing dropped inside the box (grid mode; road mode is checked by checkFrame)
      if (plan.mode === 'grid') {
      const skipped = new Set(plan.skipped);
      let dropped = 0, roadSideMissed = 0;
      for (let cz = plan.box.cz0; cz <= plan.box.cz1; cz++) for (let cx = plan.box.cx0; cx <= plan.box.cx1; cx++) {
        const k = cz * W + cx;
        if (w.cells.zone[k] !== CODE && !skipped.has(k) && w.cells.owner[k] === 0) dropped++;
        const tx = cx >> 2, tz = cz >> 2, t = w.tiles[tz * N + tx];
        const touchesRoad = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([ex, ez]) => { const nx = tx + ex, nz = tz + ez; return nx >= 0 && nz >= 0 && nx < N && nz < N && w.tiles[nz * N + nx].road; });
        if (touchesRoad && !t.road && !t.water && t.structure === 'none' && w.cells.owner[k] === 0 && w.cells.zone[k] !== CODE) roadSideMissed++;
      }
      ok(dropped === 0, `${tag}: no zonable cell in the box dropped`, dropped);
      ok(roadSideMissed === 0, `${tag}: road-side cells zoned`, roadSideMissed);
      }
      if (changed.length) zonedAny++;
      // 4. drawn highlight over its own cell
      let off = 0;
      for (const c of plan.zone) {
        const back = roundTrip(c.cx / 32, Y_PREVIEW, c.cz / 32);
        if (back && Math.hypot(back.x - c.cx / 32, back.z - c.cz / 32) > 0.01) off++; // < 1/25 of a small cell
      }
      ok(off === 0, `${tag}: drawn highlight over its cells`, off);
      if (r.changed) undo(s);
      ok(JSON.stringify(Array.from(w.cells.zone)) === JSON.stringify(before), `${tag}: undo restores`);
      combos++;
    }
  }
  ok(combos === 64 * cases.length, `${label} all ${combos} angle × case combos checked`);
  console.log(`${label} ${combos} angle × case combos (${cases.length} cases)`);
  ok(zonedAny >= combos * 0.8, `${label} cases actually zone something`, { zonedAny, combos });

}

function run(size: number): void {
  setGridSize(size);
  const N = GRID_SIZE, W = N * 4, s = new Simulation(new World(undefined, 4242)), w = s.world;
  migrateToGraph(w);
  w.regionsOwned = allRegions(); w.cash = 1e12; w.peakPop = 5000; w.tier = 3;
  const m = Math.floor(N / 2), line = (pts: Array<[number, number]>) => s.apply('road', pts);
  const row: Array<[number, number]> = [], col: Array<[number, number]> = [], edge: Array<[number, number]> = [];
  for (let x = m - 12; x <= m + 12; x++) row.push([x, m]);
  for (let z = m - 8; z <= m - 1; z++) col.push([m + 6, z]); // T junction at (m+6, m)
  for (let x = 1; x <= 12; x++) edge.push([x, 1]);
  line(row); line(col); line(edge);
  const M = (x: number, z: number) => ({ x: (x + 0.5) * 32, z: (z + 0.5) * 32 });
  ok(placeFreeRoad(s, quadCubic(M(m - 10, m + 5), M(m, m + 15), M(m + 10, m + 5)), 'street', {}, true, true).ok, `[${N}] curved free road placed`);
  // curve apex point (tiles) and its outward normal (+z = outside, −z = inside the bend)
  const apex = { x: m + 0.5, z: (m + 5.5 + m + 15.5) / 2 + 0 };
  // ground truth curve apex: midpoint of quadratic = 0.25 P0 + 0.5 P1 + 0.25 P2
  apex.z = 0.25 * (m + 5.5) + 0.5 * (m + 15.5) + 0.25 * (m + 5.5);

  const cases: Array<[string, P, P]> = [];
  // (aim points are nudged off exact small-cell boundaries: a point ON a boundary has no single 'right' cell)
  const nudge = (p: P): P => ({ x: p.x + 0.061, z: p.z + 0.057 });
  const dirs: Array<[number, number]> = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [dx, dz] of dirs) {
    const side = dz > 0 ? 'south' : 'north', y0 = m + 0.5; // straight road centre line
    cases.push([`straight ${side} from road surface (${dx},${dz})`, { x: m - 4.3, z: y0 }, { x: m - 4.3 + dx * 2.7, z: y0 + dz * 2.6 }]);
    cases.push([`straight ${side} from kerb (${dx},${dz})`, { x: m - 2.2, z: y0 + dz * 0.45 }, { x: m - 2.2 + dx * 2.1, z: y0 + dz * 2.9 }]);
    cases.push([`straight ${side} beside road (${dx},${dz})`, { x: m + 1.1, z: y0 + dz * 0.6 }, { x: m + 1.1 + dx * 1.7, z: y0 + dz * 2.2 }]);
    cases.push([`junction (${dx},${dz})`, { x: m + 6.5, z: m + 0.5 }, { x: m + 6.5 + dx * 2.3, z: m + 0.5 + dz * 2.4 }]);
    const cside = dz > 0 ? 'outside' : 'inside';
    cases.push([`curve ${cside} from road (${dx},${dz})`, { x: apex.x, z: apex.z }, { x: apex.x + dx * 1.9, z: apex.z + dz * 2.2 }]);
    cases.push([`map edge (${dx},${dz})`, { x: 6.3 + (dx < 0 ? 3 : 0), z: dz > 0 ? 1.5 : 1.5 }, { x: 6.3 + (dx < 0 ? 3 : 0) + dx * 3.1, z: dz > 0 ? 3.9 : 0.02 }]);
  }

  for (const c of cases) { c[1] = nudge(c[1]); c[2] = nudge(c[2]); }
  sweep(s, `[${N}]`, cases);

  // small-cell granularity: a click = 1 cell, a 3×2 box = 6 cells (bare land 2 tiles from the road)
  const t0 = { x: m - 6 + 0.13, z: m + 2 + 0.13 };
  const one = planRect(s, 'residential', t0, t0);
  ok(one.zone.length === 1 && rectQuote(s, one, CODE, 'residential').keys.length === 1, `[${N}] click zones exactly one small cell`, one.zone.length);
  const six = planRect(s, 'residential', t0, { x: t0.x + 0.5, z: t0.z + 0.25 });
  ok(six.zone.length === 6, `[${N}] 3×2 small-cell box zones 6 cells`, six.zone.length);
  const far = planRect(s, 'residential', { x: m + 14.1, z: m - 10.1 }, { x: m + 14.6, z: m - 9.6 });
  ok(far.zone.length === 0 && far.skipped.length > 0, `[${N}] too far from a road: skipped`, far.zone.length);
}

run(64);
run(192);

// ---- Parker's free-road save (debug code, 128 map): the 30° free road, edge (84.5,64.5)→(92.6,69.2) ----
{
  const s = loadCode(readFileSync('tools/fixtures/parker-freeroads.lpc', 'utf8'));
  s.world.cash = 1e12;
  const dir = { x: 0.866, z: 0.5 }, nrm = { x: -0.5, z: 0.866 }; // along the road, and its south-west side
  const at = (t: number, d: number): P => ({ x: 84.5 + dir.x * t + nrm.x * d, z: 64.5 + dir.z * t + nrm.z * d });
  const cases: Array<[string, P, P]> = [];
  for (const sd of [1, -1]) for (const [da, dd] of [[1, 1], [-1, 1], [1, 0.5], [-1, 0.6]] as Array<[number, number]>) {
    const side = sd > 0 ? 'SW' : 'NE', t0 = 4.2;
    cases.push([`angled ${side} from road (${da},${dd})`, at(t0, 0.03 * sd), at(t0 + da * 2.4, sd * (0.6 + dd * 1.8))]);
    cases.push([`angled ${side} from kerb (${da},${dd})`, at(t0, sd * 0.42), at(t0 + da * 1.9, sd * (0.6 + dd * 2.2))]);
    cases.push([`angled ${side} beside road (${da},${dd})`, at(t0 + 0.5, sd * 0.75), at(t0 + 0.5 + da * 1.6, sd * (0.75 + dd * 1.5))]);
    // dragging back toward the road from far out (the anchor is the far corner)
    cases.push([`angled ${side} from road near junction (${da},${dd})`, at(2, 0.02 * sd), at(2 + da * 1.5, sd * (0.6 + dd * 1.9))]);
    cases.push([`angled ${side} toward road (${da},${dd})`, at(t0, sd * 2.4), at(t0 + da * 2.1, sd * 0.1)]);
  }
  setGridSize(s.world.tiles.length === 128 * 128 ? 128 : GRID_SIZE);
  sweep(s, '[parker]', cases);
  // the zoned strip is PARALLEL to the road: every zoned cell of a long drag is on edge 5's block
  const plan = planRect(s, 'industrial', at(1.2, 0.8), at(7.5, 1.9));
  ok(plan.mode === 'road' && plan.zone.length > 0 && plan.zone.every((c) => c.edge === plan.zone[0].edge && c.side === plan.zone[0].side) && plan.size[0] >= 6, '[parker] long drag beside the 30° road = one road-frame strip', { mode: plan.mode, n: plan.zone.length, size: plan.size });
}
setGridSize(64);

// removed zoning modes are gone
const main = readFileSync('src/main.ts', 'utf8'), tools = readFileSync('src/ui/tools.ts', 'utf8');
ok(!('brushBlocks' in FRT) && !('dragCells' in FRT) && !('paintDragged' in FRT), 'zoning brush / depth drag removed from the UI tool module');
ok(!/data-depth|zoneOpt\.depth|blockDragFrom|shiftKey|altKey/.test(main), 'no depth buttons, alternate block drag or modifier-key zoning in main.ts');
ok(!/Drag along a road to zone/.test(tools) && /Drag a box from corner to corner/.test(tools), 'zone tool hints describe the rectangle');
ok(/planRect\(sim, tool, zoneFrom/.test(main), 'main.ts zones only through planRect / paintRect');

if (fail) { console.log(`${fail} failures (${passed} passed)`); process.exit(1); } console.log(`zoneangles: all ok (${passed} checks)`);
