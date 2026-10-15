/**
 * tools/zoneangles.test.ts — NEBULA: zoning highlight == zoned squares at EVERY camera angle.
 *
 * For 64 and 192 maps, in a new (graph) game with a straight tile-built road, a
 * curved free road and a road along the map edge, and for 8 yaws (45° steps)
 * × 4 pitches (low oblique .. steep) × 2 zooms, this test:
 *  1. projects known ground points (cell centres) to screen with the real IsoCamera,
 *     then picks them back exactly like ui/input.ts (ray vs. the y=0 ground mesh)
 *     → the picked cell must be the cell we aimed at;
 *  2. hover (click) and drag from those picked points: the highlighted squares
 *     (dragCells + zoneDryRun kerb fill, what main.ts shows and counts) must equal
 *     the grid cells mouse-up zones (paintDragged), then undo;
 *  3. where the highlight is DRAWN: every highlighted cell's quad, drawn at
 *     Y_PREVIEW, projected to screen and picked back, must land in that same cell
 *     (and the tile highlight at TILE_PREVIEW_Y in its tile). This is the bug
 *     Parker saw: the old lifted highlight (0.068 / 0.12 tiles) slid ~0.7 cell / 0.3
 *     tile off at low pitch. The test also asserts the OLD heights fail, so it
 *     really detects the regression.
 */
import * as THREE from 'three';
import { Simulation, World } from './bench/town';
import { migrateToGraph } from '../src/roads/persist';
import { allRegions } from '../src/sim/regions';
import { GRID_SIZE } from '../src/sim/types';
import { setGridSize } from '../src/sim/mapsize';
import { placeFreeRoad, undo, zoneDryRun } from '../src/sim/freeroads';
import { dragCells, paintDragged } from '../src/ui/freeRoadTool'; // exactly what main.ts previews / paints
import { quadCubic } from '../src/roads/bezier';
import { gridCellOf } from '../src/roads/bridge';
import { IsoCamera } from '../src/render/camera';
import { TILE_PREVIEW_Y, Y_PREVIEW } from '../src/render/previewHeights';

let fail = 0;
const ok = (c: boolean, m: string, x?: unknown) => { if (!c || process.env.VERBOSE) console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fail++; };
const TM = 32; // metres per tile
type V2 = { x: number; z: number };

function run(size: number): void {
  setGridSize(size);
  const N = GRID_SIZE, s = new Simulation(new World(undefined, 4242)), w = s.world;
  migrateToGraph(w);
  w.regionsOwned = allRegions(); w.cash = 1e9; w.peakPop = 5000; w.tier = 3;
  const m = Math.floor(N / 2), row: Array<[number, number]> = [], edge: Array<[number, number]> = [];
  for (let x = m - 10; x <= m + 10; x++) row.push([x, m]);
  for (let x = 1; x <= 12; x++) edge.push([x, 2]);
  s.apply('road', row); s.apply('road', edge);
  const M = (x: number, z: number) => ({ x: (x + 0.5) * TM, z: (z + 0.5) * TM });
  ok(placeFreeRoad(s, quadCubic(M(m - 10, m + 4), M(m, m + 14), M(m + 10, m + 4)), 'street', {}, true, true).ok, `[${N}] curved free road placed`);
  const depth = 2;
  // Aim points (metres): a cell on the straight road's block, near the curve apex,
  // and at the map edge (row 0 of the edge road's north side).
  const near = (p: V2) => { let b = null, d = 1e9; for (const c of w.blocks.cells) { const e = Math.hypot(c.cx - p.x, c.cz - p.z); if (e < d) { d = e; b = c; } } return b!; };
  const aims = { straight: near(M(m + 3, m + 1)), curve: near(M(m, m + 9)), edge: near({ x: 6 * TM, z: 2 * TM }) };
  for (const [k, c] of Object.entries(aims)) ok(!!c && w.blocks.cellAt({ x: c.cx, z: c.cz }) === c, `[${N}] aim cell ${k} exists`);

  // The real camera and a ground mesh like the game's (y=0 plane over the map).
  const cam = new IsoCamera(); cam.resize(1280, 800);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(N, N).rotateX(-Math.PI / 2).translate(N / 2, 0, N / 2));
  ground.updateMatrixWorld();
  const ray = new THREE.Raycaster(), v = new THREE.Vector3(), ndc = new THREE.Vector2();
  /** world (tiles, height y) → screen → ui/input.ts pick → ground point (tiles), or null off-map / off-screen. */
  const roundTrip = (x: number, y: number, z: number): V2 | null => {
    v.set(x, y, z).project(cam.camera);
    if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
    ndc.set(v.x, v.y); ray.setFromCamera(ndc, cam.camera);
    const h = ray.intersectObject(ground, false)[0];
    return h ? { x: h.point.x, z: h.point.z } : null;
  };
  const key = (c: { cx: number; cz: number }) => gridCellOf(c as never);
  let checked = 0, oldBad = 0, oldTileBad = 0;
  for (let rot = 0; rot < 4; rot++) for (const fy of [0, Math.PI / 4]) for (const pitch of [0.38, 0.6155, 0.9, 1.13]) for (const zoom of [1, 3]) {
    for (const [name, c] of Object.entries(aims)) {
      const tag = `[${N}] ${name} yaw=${rot * 90 + (fy ? 45 : 0)} pitch=${pitch} zoom=${zoom}`;
      cam.rotation = rot; cam.freeYaw = fy; cam.elevation = pitch; cam.zoomBy(zoom / cam.zoom);
      // Aim off-centre so the point is not always the middle pixel.
      cam.target.set(c.cx / TM + 1.3, 0, c.cz / TM - 0.7); cam.update(0);
      cam.camera.updateMatrixWorld(); cam.camera.updateProjectionMatrix();
      // 1. pick
      const a = roundTrip(c.cx / TM, 0, c.cz / TM);
      if (!a) { ok(false, `${tag}: aim point off-screen`); continue; }
      const am = { x: a.x * TM, z: a.z * TM };
      ok(w.blocks.cellAt(am) === c, `${tag}: picked cell == aimed cell`, am);
      // 2. hover/click and drag: highlight == zoned
      const far = roundTrip(c.cx / TM + 1.6, 0, c.cz / TM + 0.4);
      for (const [what, b] of [['click', am], ['drag', far ? { x: far.x * TM, z: far.z * TM } : am]] as Array<[string, V2]>) {
        // What main.ts highlights: the block cells + zoneDryRun's kerb-fill squares.
        const cells = dragCells(s, am, b, depth), dry = zoneDryRun(s, cells, 1);
        const shown = dry.keys;
        const drawn = new Set([...cells.map(key), ...dry.keys]);
        const before = Array.from(w.cells.zone);
        const n = paintDragged(s, am, b, 1, depth);
        const zoned: number[] = []; w.cells.zone.forEach((z, i) => { if (z !== before[i]) zoned.push(i); });
        ok(shown.length > 0 && zoned.every((k) => drawn.has(k)) && JSON.stringify(shown) === JSON.stringify(zoned), `${tag}: ${what} highlight == zoned`, { shown: shown.length, zoned: zoned.length });
        // 3. where the highlight is drawn: each quad centre at Y_PREVIEW must pick back into its cell
        for (const q of dragCells(s, am, b, depth)) {
          const back = roundTrip(q.cx / TM, Y_PREVIEW, q.cz / TM);
          if (back) ok(w.blocks.cellAt({ x: back.x * TM, z: back.z * TM }) === q, `${tag}: ${what} drawn highlight over its cell`);
          const old = roundTrip(q.cx / TM, 0.068, q.cz / TM);
          if (old && w.blocks.cellAt({ x: old.x * TM, z: old.z * TM }) !== q) oldBad++;
        }
        if (n) undo(s);
      }
      // tile highlight: a tile centre drawn at TILE_PREVIEW_Y picks back into that tile
      const tx = Math.floor(c.cx / TM), tz = Math.floor(c.cz / TM);
      // (corner points just inside the tile: a centre point can't reveal a 0.3-tile slide)
      let tb: V2 | null = null, to: V2 | null = null;
      for (const [ox, oz] of [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]) {
        const t1 = roundTrip(tx + ox, TILE_PREVIEW_Y, tz + oz), t0 = roundTrip(tx + ox, 0.12, tz + oz);
        if (t1 && (Math.floor(t1.x) !== tx || Math.floor(t1.z) !== tz)) tb = t1;
        if (t0 && (Math.floor(t0.x) !== tx || Math.floor(t0.z) !== tz)) to = t0;
      }
      ok(!tb, `${tag}: tile highlight over its tile`, tb);
      if (to) oldTileBad++;
      checked++;
    }
  }
  ok(checked === 8 * 4 * 2 * 3, `[${N}] all ${checked} angle × case combos checked`);
  // Regression guard: the pre-fix heights must be caught by check 3.
  ok(oldBad > 0 && oldTileBad > 0, `[${N}] old lifted highlight heights are detected as misplaced`, { oldBad, oldTileBad });
  console.log(`[${N}] ${checked} angle × case combos; old-height misplacements: cells ${oldBad}, tiles ${oldTileBad}`);
}

run(64);
run(192);
setGridSize(64);
if (fail) { console.log(`${fail} failures`); process.exit(1); } console.log('zoneangles: all ok');
