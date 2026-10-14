/**
 * tools/industry.test.ts — PR 5 headless tests for farms, food plants,
 * construction crews, wind direction and the v5 save migration.
 * Run: npm run test:industry   (bundles with esbuild, runs in node).
 * Each check prints PASS/FAIL; the process exits 1 on any failure.
 */
// Minimal localStorage for settings/save code (node has none).
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };

import { Simulation } from '../src/sim/simulation';
import { World } from '../src/sim/grid';
import { fieldCount, YARD_FLEET } from '../src/sim/industry';
import { loadWorld, saveWorld } from '../src/sim/save';

let fails = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? '  ' + JSON.stringify(info) : ''}`); if (!ok) fails++; };
const rect = (x0: number, z0: number, x1: number, z1: number) => { const o: Array<[number, number]> = []; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) o.push([x, z]); return o; };
const N = 64;

function town(withYard: boolean): Simulation {
  const s = new Simulation(new World(undefined, 4242));
  s.world.cash = 1e6; s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; });
  const e = s.world.edgeIndex, ex = e % N, ez = Math.floor(e / N);
  s.apply('road', rect(20, 30, 60, 30)); s.apply('road', rect(60, Math.min(30, ez), 60, Math.max(30, ez))); s.apply('road', rect(Math.min(60, ex), ez, Math.max(60, ex), ez));
  s.apply('waterPipe', rect(20, 30, 50, 30)); s.apply('powerPlant', [[19, 30]]); s.apply('waterTower', [[20, 31]]); s.apply('powerPlant', [[59, 31]]);
  s.apply('residential', rect(24, 29, 34, 29)); s.apply('commercial', rect(21, 31, 26, 31));
  if (withYard) s.apply('constructionYard', [[45, 29]]);
  return s;
}
const run = (s: Simulation, ticks: number) => { for (let i = 0; i < ticks; i++) { s.step(); s.traffic.update(s.world, 1); s.world.clock += 1; } };

// 1. Construction crews gate growth.
{
  const a = town(false); run(a, 120);
  const sites = a.world.tiles.filter((t) => t.construct > 0).length;
  check('no yard: nothing finishes building', a.world.tiles.every((t) => t.level === 0), { sites });
  check('no yard: hint posted', a.events.some((m) => m.includes('Construction Yard')));
  const b = town(true); run(b, 160);
  const built = b.world.tiles.filter((t) => t.zone && t.level > 0).length;
  check('with yard: buildings grow', built > 0, { built, crew: b.crews.stats });
  check('crew trucks dispatched and returned', b.crews.stats.dispatched > 0 && b.crews.stats.returned > 0, b.crews.stats);
  check('fleet limit respected', b.crews.out(29 * N + 45) <= YARD_FLEET);
}
// 2. Farms claim fields behind them; bulldozing a field shrinks; bulldozing the farm frees.
{
  const s = town(true);
  s.apply('farm', [[40, 29]]); // road (row 30) is SOUTH → fields go NORTH (z 28, 27, 26)
  run(s, 200);
  const f = 29 * N + 40, t = s.world.tiles[f];
  const n = fieldCount(s.world, f);
  check('farm grew', t.level > 0, { level: t.level });
  check('farm claims 2/4/6 fields by level', n === [0, 2, 4, 6][t.level], { level: t.level, fields: n });
  check('fields are behind the farm (north)', s.world.tiles.every((q, i) => q.farm !== f + 1 || Math.floor(i / N) < 29));
  check('owned field cannot be zoned', s.apply('residential', [[40, 28]]).changed === 0);
  const before = n; s.apply('bulldoze', [[40, 28]]); run(s, 3);
  check('bulldozed field turns fallow and is not reclaimed', s.world.tiles[28 * N + 40].farm < 0 && fieldCount(s.world, f) === before - 1, { now: fieldCount(s.world, f) });
  s.apply('bulldoze', [[40, 29]]); run(s, 2);
  check('bulldozing the farm frees all fields', s.world.tiles.every((q) => q.farm === 0));
}
// 3. Food chain: farm → food plant → packaged food.
{
  const s = town(true);
  s.apply('farm', rect(36, 29, 39, 29)); s.apply('foodPlant', [[42, 29]]);
  run(s, 600);
  const plant = s.world.tiles[29 * N + 42];
  check('food plant grew and received/processed food', plant.level > 0 && (plant.input > 0 || plant.stock > 0), { level: plant.level, input: plant.input, stock: plant.stock });
}
// 4. Wind direction drifts slowly.
{
  const s = new Simulation(new World(undefined, 7)); let maxStep = 0, prev = s.world.windDir;
  for (let i = 0; i < 3000; i++) { s.step(); const d = Math.abs(Math.atan2(Math.sin(s.world.windDir - prev), Math.cos(s.world.windDir - prev))); maxStep = Math.max(maxStep, d); prev = s.world.windDir; }
  check('wind heading never jumps (< 0.04° per tick)', maxStep <= 0.0006 + 1e-9, { maxStepDeg: +(maxStep * 180 / Math.PI).toFixed(4) });
}
// 5. Save round-trip + v4 migration.
{
  const s = town(true); s.apply('farm', [[40, 29]]); run(s, 100);
  saveWorld(s.world);
  const w = loadWorld()!;
  check('save keeps fields, kind and wind direction', w.tiles.filter((t) => t.farm > 0).length === s.world.tiles.filter((t) => t.farm > 0).length && Math.abs(w.windDir - s.world.windDir) < 1e-9 && w.tiles[29 * N + 40].kind === 1);
  const raw = JSON.parse(store.get('lowpoly-city-save')!); raw.version = 4; delete raw.windDir;
  raw.tiles.forEach((t: any) => { delete t.kind; delete t.farm; delete t.crew; delete t.input; });
  raw.tiles[29 * N + 30].construct = 5;
  store.set('lowpoly-city-save', JSON.stringify(raw));
  const old = loadWorld()!;
  check('v4 save migrates: sites keep their crew, defaults filled', old.tiles[29 * N + 30].crew === true && old.tiles.every((t) => typeof t.farm === 'number') && typeof old.windDir === 'number');
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
