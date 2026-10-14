/**
 * tools/v15.test.ts — Version 1.5 headless checks (one section per stage).
 * Run: npm run test:v15 (esbuild → node). Prints PASS/FAIL; exits 1 on failure.
 */
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };

import { Simulation } from '../src/sim/simulation';
import { World } from '../src/sim/grid';
import { loadWorld, saveWorld } from '../src/sim/save';
import { output } from '../src/sim/networks';
import { idx } from '../src/sim/grid';

let fails = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? '  ' + JSON.stringify(info) : ''}`); if (!ok) fails++; };
const fresh = () => { const s = new Simulation(new World(undefined, 4242)); s.world.cash = 1e7; s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; }); return s; };

// ---------------------------------------------------------------- stage 3: power tiers
{
  const s = fresh();
  s.world.tier = 3; // unlock everything
  s.apply('powerPlant', [[10, 10]]);
  s.apply('oilPlant', [[12, 10]]);
  s.apply('nuclearPlant', [[14, 10], [15, 10], [14, 11], [15, 11]]);
  const w = s.world;
  const out = (x: number, z: number) => output(w.tiles[idx(x, z)], 'power', w.wind);
  check('coal plant = 2,000', out(10, 10) === 2000, out(10, 10));
  check('oil plant = 8,000', out(12, 10) === 8000, out(12, 10));
  check('nuclear = 32,000 (4× oil)', out(14, 10) === 32000, out(14, 10));
  saveWorld(w);
  const l = loadWorld()!;
  check('oil plant survives save/load', output(l.tiles[idx(12, 10)], 'power', l.wind) === 8000);
  // A PR 5/6 save: plants have kind 0 → coal.
  const old = JSON.parse(store.get('lowpoly-city-save')!);
  old.tiles[idx(12, 10)].kind = 0;
  store.set('lowpoly-city-save', JSON.stringify(old));
  check('old-save plant loads as coal', output(loadWorld()!.tiles[idx(12, 10)], 'power', 0.5) === 2000);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
