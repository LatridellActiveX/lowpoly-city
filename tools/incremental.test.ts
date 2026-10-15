/**
 * tools/incremental.test.ts — V1.6 A3 EQUIVALENCE TESTS.
 *
 * The incremental systems (networks.ts computeNetworks, Simulation's cached
 * coverage / safety / land value) must give EXACTLY what a from-scratch
 * computation gives. For the 64 and the 192 map: grow a town, then run 500
 * random operations (player tools on random rectangles, ticks in between,
 * garbage and growth happening on their own). After every operation the
 * test refreshes the sim the way a tick starts (recompute()) and compares
 * every tile's network service, every network total, coverage, crime/care,
 * pollution, parks, desirability, noise and land value with the reference.
 */
import { setGridSize } from '../src/sim/mapsize';
import { GRID_SIZE, ToolId } from '../src/sim/types';
import { computeNetworksFull } from '../src/sim/networks';
import { computeCoverage } from '../src/sim/services';
import { computeEnvironment, LV_MAX } from '../src/sim/environment';
import { applyServiceEffects, computeSafety } from '../src/sim/safety';
import { buildTown, tick, Simulation, World, rect } from './bench/town';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail++; };
const TOOLS: ToolId[] = ['road', 'powerLine', 'waterPipe', 'residential', 'commercial', 'industrial', 'park', 'windTurbine', 'waterTower', 'policeStation', 'clinic', 'bulldoze', 'bulldoze'];

function same(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return false;
  return true;
}

function compare(s: Simulation): string | null {
  const w = s.world;
  const ref = computeNetworksFull(w);
  for (let i = 0; i < w.tiles.length; i++) {
    const a = s.net.service[i], b = ref.service[i];
    if (a.powerNet !== b.powerNet || a.waterNet !== b.waterNet || a.powered !== b.powered || a.watered !== b.watered || a.roadAccess !== b.roadAccess) return `service @${i}`;
  }
  if (JSON.stringify(s.net.power) !== JSON.stringify(ref.power)) return 'power networks';
  if (JSON.stringify(s.net.water) !== JSON.stringify(ref.water)) return 'water networks';
  const cov = computeCoverage(w);
  if (!cov.by.every((f, k) => same(f, s.cov.by[k])) || !same(cov.edu, s.cov.edu)) return 'coverage';
  const saf = computeSafety(w, cov);
  if (!same(saf.crime, s.safety.crime) || !same(saf.care, s.safety.care)) return 'safety';
  const env = computeEnvironment(w, ref.service);
  applyServiceEffects(env.landValue, saf, LV_MAX);
  for (const k of ['pollution', 'parks', 'desirability', 'noise', 'landValue'] as const) if (!same(env[k], s.env[k])) return `env.${k}`;
  return null;
}

for (const n of [64, 192]) {
  setGridSize(n);
  const s = new Simulation(new World(undefined, 99));
  s.world.cash = 1e9;
  s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; });
  const off = (n - 64) / 2;
  buildTown(s, off, off);
  for (let i = 0; i < 1200; i++) tick(s); // a real town: garbage, growth, outages
  let seed = 12345 + n; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let first: string | null = null, at = -1;
  for (let k = 0; k < 500 && !first; k++) {
    const r = rnd();
    if (r < 0.55) {
      const tool = TOOLS[Math.floor(rnd() * TOOLS.length)];
      const x = off + Math.floor(rnd() * 60), z = off + Math.floor(rnd() * 60), len = 1 + Math.floor(rnd() * 6);
      s.apply(tool, rnd() < 0.5 ? rect(x, z, Math.min(GRID_SIZE - 1, x + len), z) : rect(x, z, x, Math.min(GRID_SIZE - 1, z + len)));
    } else {
      const t = 1 + Math.floor(rnd() * 5); for (let i = 0; i < t; i++) tick(s);
    }
    s.recompute();
    const bad = compare(s);
    if (bad) { first = bad; at = k; }
  }
  ok(!first, `${n} map: 500 random ops, incremental == from scratch${first ? ` (first mismatch: ${first} after op ${at})` : ''}`);
}
setGridSize(64);
if (fail) { console.log(`${fail} failures`); process.exit(1); } console.log('incremental: all ok');
