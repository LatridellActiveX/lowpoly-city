/**
 * tools/v15b-res.test.ts — V1.5b residential push (stage A + residential RCI
 * rebalance). Run: npm run test:v15b-res. Prints PASS/FAIL; exits 1 on failure.
 *
 * Covers:
 *   - zoned-but-empty residential land lowers residential demand
 *   - homes without jobs raise industrial (strongly) and commercial demand
 *   - medium homes merge more readily (L6+ at cap) into the new large footprints
 *   - medium L6/L7 use the mid-rise apartment model (model level 7)
 *   - new templates were appended (old template indices unchanged)
 */
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };

import { Simulation } from '../src/sim/simulation';
import { World, idx } from '../src/sim/grid';
import { computeDemand, HOMES_TO_IND } from '../src/sim/demand';
import { resLevel, TEMPLATES, TPL } from '../src/sim/footprints';
import { mergeReady } from '../src/sim/growth';
import { buildDesigns } from '../src/render/buildings';

let fails = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? '  ' + JSON.stringify(info) : ''}`); if (!ok) fails++; };
const fresh = () => { const s = new Simulation(new World(undefined, 4242)); s.world.cash = 1e7; s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; }); return s; };
const rect = (x0: number, z0: number, x1: number, z1: number) => { const o: Array<[number, number]> = []; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) o.push([x, z]); return o; };
const run = (s: Simulation, ticks: number) => { for (let i = 0; i < ticks; i++) { s.step(); s.traffic.update(s.world, 1); s.world.clock += 1; } };
/** Same grid town as v15.test.ts. */
function town(): Simulation {
  const s = fresh();
  const N = 64, e = s.world.edgeIndex, ex = e % N, ez = Math.floor(e / N);
  for (const z of [12, 19, 26, 33, 40]) s.apply('road', rect(10, z, 50, z));
  for (const x of [10, 30, 50]) s.apply('road', rect(x, 12, x, 40));
  s.apply('road', rect(50, Math.min(26, ez), 50, Math.max(26, ez))); s.apply('road', rect(Math.min(50, ex), ez, Math.max(50, ex), ez));
  s.apply('powerPlant', [[9, 12]]); s.apply('powerPlant', [[51, 12]]); s.apply('waterTower', [[9, 13]]); s.apply('waterTower', [[51, 13]]); s.apply('waterTower', [[9, 41]]);
  s.apply('constructionYard', [[29, 11]]); s.apply('constructionYard', [[31, 41]]);
  s.zoneOpt = { density: 0, depth: 3 };
  s.apply('residential', rect(11, 13, 29, 13)); s.apply('residential', rect(31, 13, 49, 13));
  s.apply('residential', rect(11, 27, 29, 27)); s.apply('residential', rect(31, 27, 49, 27));
  s.zoneOpt = { density: 1, depth: 3 };
  s.apply('commercial', rect(11, 20, 29, 20)); s.apply('commercial', rect(31, 20, 49, 20)); s.apply('commercial', rect(31, 25, 49, 25));
  s.zoneOpt = { density: 0, depth: 2 };
  s.apply('industrial', rect(31, 34, 49, 34));
  return s;
}

// ---------------------------------------------------------------- RCI: zoned-but-empty residential
{
  const s = town();
  run(s, 300);
  const before = computeDemand(s.world, 1, () => true).residential.value;
  s.zoneOpt = { density: 0, depth: 3 };
  s.apply('residential', rect(11, 39, 29, 39)); s.apply('residential', rect(31, 39, 49, 39));
  const after = computeDemand(s.world, 1, () => true);
  check('zoning more empty residential lowers residential demand (≥ 0.05)', before - after.residential.value >= 0.05, { before: +before.toFixed(3), after: +after.residential.value.toFixed(3), driver: after.residential.driver });
}

// ---------------------------------------------------------------- RCI: homes raise job demand
{
  const w = fresh().world;
  const base = computeDemand(w, 1, () => true);
  // 20 level-3 homes (≈ 400 residents) and no jobs at all.
  for (let k = 0; k < 20; k++) { const t = w.tiles[idx(5 + k, 5)]; t.zone = 'residential'; t.level = 3; t.res = 20; }
  const d = computeDemand(w, 1, () => true);
  check('homes with no jobs raise industrial demand strongly', d.industrial.value - base.industrial.value >= HOMES_TO_IND, { base: base.industrial.value, now: d.industrial.value });
  check('homes raise commercial demand too', d.commercial.value > base.commercial.value, { base: base.commercial.value, now: d.commercial.value });
}

// ---------------------------------------------------------------- stage A: templates + models
{
  const ids = ['apt_complex', 'twin_midrise', 'perimeter'];
  check('large medium footprints exist and were appended last', ids.every((id) => TPL[id] && TEMPLATES.indexOf(TPL[id]) >= TEMPLATES.length - ids.length));
  check('large footprints are bigger than every older medium template', ids.every((id) => TPL[id].w * TPL[id].d >= 60));
  const med = TEMPLATES.filter((t) => t.zone === 'residential' && t.density === 1);
  check('every medium template uses the mid-rise model (7) at L6/L7', med.every((t) => t.model.level[2] === 7 && t.model.level[3] === 7));
  const d = buildDesigns('high').residential;
  check('residential designs include model level 7 (mid-rise) for 4 variants', d.slice(0, 4).every((lv) => lv.length >= 7 && lv[6].walls !== undefined));
  const fake = { level: 3 } as any;
  check('mergeReady: medium L6 at its cap is ready; below cap is not', mergeReady(TPL['apartment'], fake, 3) && !mergeReady(TPL['apartment'], fake, 4));
  check('mergeReady: low-density keeps the max-level rule', !mergeReady(TPL['villa'], { level: 2 } as any, 2) && mergeReady(TPL['villa'], { level: 3 } as any, 3));
}

// ---------------------------------------------------------------- stage A: merges in a growing city
{
  const s = town();
  s.world.peakPop = 6000;
  for (let x = 12; x < 50; x += 3) { s.apply('park', [[x, 16]]); s.apply('park', [[x, 30]]); }
  s.zoneOpt = { density: 0, depth: 4 }; s.apply('industrial', rect(11, 41, 29, 41));
  run(s, 3500);
  const bs = [...s.world.lots.buildings.values()].filter((b) => TPL[b.tpl].zone === 'residential');
  const med = bs.filter((b) => TPL[b.tpl].density === 1);
  const maxLv = Math.max(0, ...bs.map((b) => resLevel(TPL[b.tpl], b.level)));
  const big = med.filter((b) => ['apt_complex', 'twin_midrise', 'perimeter'].includes(b.tpl) || TPL[b.tpl].w * TPL[b.tpl].d >= 48);
  check('medium homes reach L6+', maxLv >= 6, maxLv);
  check('neighbourhoods merge into large (≥ 6×8) medium footprints', big.length > 0, { big: big.map((b) => b.tpl), merged: s.world.lots.stats.merged, medium: med.length });
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
