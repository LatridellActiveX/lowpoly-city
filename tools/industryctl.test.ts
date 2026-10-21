/**
 * tools/industryctl.test.ts — the industry interactivity stages (Parker,
 * 2026-10-20, plan IND-1 … IND-5). Each stage adds its block below.
 *
 * IND-1 factory panel + recipe picker:
 *  a. old saves (all fixtures + Parker's avenue save) load, every tile on
 *     Auto ('' recipe, no pause) — old saves behave exactly as before;
 *  b. a plain factory / processor can be given a recipe; it costs $500,
 *     pauses output for 30 s and empties the hopper; roleOf answers it;
 *  c. extractors (quarry / oil / logging), farms and food plants refuse;
 *  d. while retooling the factory books no output; after it, it works;
 *  e. the pick survives a save → load round trip;
 *  f. back to Auto is free; bulldozing forgets the pick.
 *
 * IND-2 supply chain view (sim/chainFlow.ts):
 *  g. every producer → customer truck is recorded once (link totals =
 *     chain loads + shop/yard loads) on Parker's avenue save;
 *  h. a link's "loads lately" halves every HALF_LIFE ticks; colours band right;
 *  i. at most MAX_LINKS links come back, busiest first;
 *  j. an empty shop with nothing on the way is a shortage.
 *
 * IND-3 upgrades (factoryCtl.ts UPG):
 *  k. prices charged; Automation locked below the City tier; no double buy;
 *  l. output (+50% shift, +30% automation), workers (+30% / −40%), power
 *     (+50% automation), pollution (−60% filters) and running cost (+10%)
 *     change as listed;
 *  m. upgrades survive save → load and are lost when the building goes.
 */
import { existsSync, readFileSync } from 'node:fs';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
import { loadCode } from './fixtures/loadCode';
import { deserializeWorld, serializeWorld } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { RECIPES, roleOf } from '../src/sim/chains';
import { band, ChainFlow, FLOW_GOOD, FLOW_WEAK, HALF_LIFE, MAX_LINKS, shortages } from '../src/sim/chainFlow';
import { buyUpgrade, hasUpg, outputMult, pollutionMult, powerMult, runningCostShare, UPG, UPGRADES, workerMult } from '../src/sim/factoryCtl';
import { jobsOf } from '../src/sim/industry';
import { demandOf } from '../src/sim/networks';
import { computeEnvironment } from '../src/sim/environment';
import { canPickRecipe, clearIfGone, RECIPE_SWITCH_COST, RETOOL_TICKS, setRecipe } from '../src/sim/factoryCtl';

let fails = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fails++; };
// Parker's own copy of the avenue save is checked too when it is on this machine.
const FIX = ['/workspace/parker-avenue.lpc', 'tools/fixtures/parker-avenue.lpc', 'tools/fixtures/parker-freeroads.lpc', 'tools/fixtures/parker-power-graphonly.lpc'].filter((f) => existsSync(f));
const load = (f: string) => loadCode(readFileSync(f, 'utf8').trim());
const factories = (s: Simulation) => s.world.tiles.map((t, i) => (t.zone === 'industrial' && t.level > 0 ? i : -1)).filter((i) => i >= 0);

// ---- IND-1 ----
{
  // a. old saves
  for (const f of FIX) {
    const s = load(f);
    ok(s.world.tiles.every((t) => t.recipe === '' && t.pause === 0 && t.upg === 0), `${f}: loads, every factory on Auto`);
  }
  const s = load('tools/fixtures/parker-avenue.lpc');
  for (let k = 0; k < 60; k++) s.update(1); // let roles settle
  const w = s.world, fs = factories(s);
  ok(fs.length > 0, 'avenue save has factories', fs.length);
  const pickable = fs.filter((i) => canPickRecipe(w, i));
  const fixed = fs.filter((i) => !canPickRecipe(w, i));
  ok(pickable.length > 0, 'some factories have a recipe picker', pickable.length);
  // c. extractors / farms refuse
  ok(fixed.every((i) => ['logging', 'oilRig', 'quarry', 'farm', 'foodPlant'].includes(roleOf(w, i))), 'only extractors / farms / food plants have no picker', [...new Set(fixed.map((i) => roleOf(w, i)))]);
  if (fixed.length) ok(setRecipe(w, fixed[0], 'toymaker') !== null, 'setRecipe refuses an extractor / farm');
  // b. switch a factory
  const i = pickable[0], t = w.tiles[i];
  const target = roleOf(w, i) === 'toymaker' ? 'printer' : 'toymaker';
  w.cash = 10000; t.input = 10;
  const cash0 = w.cash;
  ok(setRecipe(w, i, target) === null, 'switching works');
  ok(roleOf(w, i) === target && t.recipe === target, 'roleOf answers the pick', roleOf(w, i));
  ok(w.cash === cash0 - RECIPE_SWITCH_COST, `costs $${RECIPE_SWITCH_COST}`, cash0 - w.cash);
  ok(t.pause === w.tick + RETOOL_TICKS && t.input === 0, `pauses ${RETOOL_TICKS} s and empties the hopper`);
  ok(setRecipe(w, i, target) === null && w.cash === cash0 - RECIPE_SWITCH_COST, 'picking the same recipe again is free');
  // d. paused: no output booked; afterwards it processes again.
  t.input = 20; const st0 = t.stock;
  const runTicks = (n: number) => { const end = w.tick + n; while (w.tick < end) s.update(0.5); }; // the sim speed decides ticks per update
  runTicks(RETOOL_TICKS - 2);
  ok(t.stock <= st0 + 1e-9, 'no output while retooling', { before: st0, after: t.stock });
  runTicks(10);
  ok(t.pause <= w.tick && (t.input < 20 || t.stock > st0 || !s.status(i).operating), 'processes again after retooling', { input: t.input, stock: t.stock });
  // e. save → load
  const w2 = deserializeWorld(serializeWorld(w))!;
  ok(w2.tiles[i].recipe === target && roleOf(w2, i) === target, 'the pick survives save → load');
  // f. Auto is free; bulldozing forgets
  const c1 = w.cash; ok(setRecipe(w, i, '') === null && w.cash === c1 && w.tiles[i].recipe === '', 'back to Auto is free');
  setRecipe(w, i, target); t.zone = null; clearIfGone(w, i);
  ok(t.recipe === '' && t.pause === 0, 'bulldozed / rezoned tile forgets the pick');
  ok(Object.keys(RECIPES).length >= 11, 'recipes table intact');
}

// ---- IND-2 ----
{
  const s = load('tools/fixtures/parker-avenue.lpc'), w = s.world;
  const end = w.tick + 600; while (w.tick < end) s.update(0.5);
  const st = s.shipping.stats, fl = s.shipping.flow;
  ok(fl.loads > 0 && fl.loads === st.chainLoads + st.shopLoads, 'every producer → customer truck is one link load', { links: fl.links.size, loads: fl.loads, chain: st.chainLoads, shops: st.shopLoads });
  const f = new ChainFlow(); f.add(0, 1, 2, 'wood');
  const l = [...f.links.values()][0];
  ok(Math.abs(f.rate(l, HALF_LIFE) - 0.5) < 1e-9 && Math.abs(f.rate(l, 2 * HALF_LIFE) - 0.25) < 1e-9, 'loads lately halve every HALF_LIFE ticks');
  ok(band(FLOW_GOOD) === 'good' && band(FLOW_WEAK) === 'weak' && band(FLOW_WEAK - 0.01) === 'low', 'colour bands');
  const g = new ChainFlow(); for (let k = 0; k < 300; k++) for (let r = 0; r <= k % 5; r++) g.add(10, k, k + 1000, 'goods');
  const top = g.top(10);
  ok(top.length === MAX_LINKS && top.every((x, k) => k === 0 || top[k - 1].rate >= x.rate), `at most ${MAX_LINKS} links, busiest first`, top.length);
  ok(g.top(10 + HALF_LIFE * 30).length === 0 && g.links.size === 0, 'long-dead links are forgotten');
  const shop = w.tiles.findIndex((t) => t.zone === 'commercial' && t.level > 0 && t.kind !== 4);
  w.tiles[shop].stock = 0;
  ok(shop >= 0 && shortages(w, () => false, () => false).includes(shop), 'an empty shop with nothing on the way is a shortage');
}

// ---- IND-3 ----
{
  const s = load('tools/fixtures/parker-avenue.lpc'), w = s.world;
  const i = factories(s).find((j) => w.tiles[j].jobs > 0)!, t = w.tiles[i];
  w.cash = 20000; w.tier = 2;
  const jobs0 = jobsOf(w, i), pow0 = demandOf(t, 'power');
  const env0 = computeEnvironment(w);
  ok(buyUpgrade(w, i, 'AUTO') !== null && !hasUpg(t, 'AUTO'), 'Automation is locked below the City tier');
  ok(buyUpgrade(w, i, 'SHIFT') === null && w.cash === 20000 - UPGRADES.SHIFT.cost, `Second shift costs $${UPGRADES.SHIFT.cost}`);
  ok(buyUpgrade(w, i, 'SHIFT') !== null && w.cash === 20000 - UPGRADES.SHIFT.cost, 'cannot buy it twice');
  ok(Math.abs(outputMult(w, t) - 1.5) < 1e-9 && jobsOf(w, i) === Math.round(jobs0 * 1.3), 'shift: +50% output, +30% workers', { jobs0, jobs: jobsOf(w, i) });
  w.tier = 3;
  ok(buyUpgrade(w, i, 'AUTO') === null && Math.abs(outputMult(w, t) - 1.95) < 1e-9, 'automation at City tier: ×1.3 more output');
  ok(jobsOf(w, i) === Math.round(jobs0 * 1.3 * 0.6) && Math.abs(demandOf(t, 'power') - pow0 * 1.5) < 1e-9, 'automation: −40% workers, +50% power', { pow0, pow: demandOf(t, 'power') });
  ok(buyUpgrade(w, i, 'FILTER') === null && pollutionMult(w, t) === 0.4 && runningCostShare(w, t) === 0.1, 'filters: −60% pollution, +10% running cost');
  const env1 = computeEnvironment(w);
  ok(env1.pollution[i] < env0.pollution[i], 'pollution at the factory drops', { before: +env0.pollution[i].toFixed(2), after: +env1.pollution[i].toFixed(2) });
  ok(workerMult(t) === 1.3 * 0.6 && powerMult(t) === 1.5, 'multipliers');
  const w2 = deserializeWorld(serializeWorld(w))!;
  ok(w2.tiles[i].upg === (UPG.SHIFT | UPG.AUTO | UPG.FILTER), 'upgrades survive save → load');
  t.zone = null; clearIfGone(w, i);
  ok(t.upg === 0, 'bulldozing loses the upgrades');
}

console.log(fails ? `\n${fails} FAILED` : '\nall industry-control checks passed');
process.exit(fails ? 1 : 0);
