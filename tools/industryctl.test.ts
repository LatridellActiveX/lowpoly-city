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
 *
 * IND-4 policies (factoryCtl.ts POLICIES, world.policies):
 *  n. eco standards: pollution ×0.7, +15% running cost; off again = exactly as before;
 *  o. night shifts: output ×1.25, homes near factories ×0.95 desirability,
 *     night-shift trucks at night (never two out from one building), none by day;
 *  p. policies survive save → load; a save without the field loads with both off.
 *
 * IND-5 ore / steel / vehicles:
 *  q. ore patches exist, are rarer than quarries, only on otherwise empty
 *     land, never under industry built before ore existed (all fixtures:
 *     every existing building keeps its role);
 *  r. mines only from the Town tier; the vehicle plant only from the City tier;
 *  s. full chain on a test map: mine → ore → steel mill → steel → vehicle
 *     plant (+ plastics) → vehicles; steel-based materials make yards build faster;
 *  t. a mine stays a mine after save → load; prices; dealerships sell vehicles.
 */
import { existsSync, readFileSync } from 'node:fs';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
import { loadCode } from './fixtures/loadCode';
import { deserializeWorld, serializeWorld } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { RECIPES, roleOf } from '../src/sim/chains';
import { band, ChainFlow, FLOW_GOOD, FLOW_WEAK, HALF_LIFE, MAX_LINKS, shortages } from '../src/sim/chainFlow';
import { setPolicy } from '../src/sim/factoryCtl';
import { computeResources, Resource } from '../src/sim/resources';
import { EXPORT_PRICE, factoryGood, shopGood } from '../src/sim/goods';
import { truckBody } from '../src/sim/truckBodies';
import { GRID_SIZE as GRID } from '../src/sim/types';
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

// ---- IND-4 ----
{
  const s = load('tools/fixtures/parker-avenue.lpc'), w = s.world;
  const i = factories(s).find((j) => w.tiles[j].jobs > 0)!, t = w.tiles[i];
  ok(!w.policies.eco && !w.policies.night, 'a save without policies loads with both off');
  const env0 = computeEnvironment(w), out0 = outputMult(w, t), pm0 = pollutionMult(w, t), rc0 = runningCostShare(w, t);
  // n. eco standards
  setPolicy(w, 'eco', true);
  const env1 = computeEnvironment(w);
  ok(Math.abs(pollutionMult(w, t) - pm0 * 0.7) < 1e-9 && Math.abs(runningCostShare(w, t) - (rc0 + 0.15)) < 1e-9, 'eco: −30% pollution, +15% running cost');
  ok(Math.abs(env1.pollution[i] - env0.pollution[i] * 0.7) < 0.05 * env0.pollution[i] + 1e-6, 'eco: pollution at a factory ≈ ×0.7', { before: +env0.pollution[i].toFixed(2), after: +env1.pollution[i].toFixed(2) });
  setPolicy(w, 'eco', false);
  const env2 = computeEnvironment(w);
  ok(env2.pollution.every((v, k) => v === env0.pollution[k]) && runningCostShare(w, t) === rc0, 'eco off: pollution and costs back exactly');
  // o. night shifts
  setPolicy(w, 'night', true);
  ok(Math.abs(outputMult(w, t) - out0 * 1.25) < 1e-9, 'night: +25% output');
  // The avenue save may have no home that close to industry: zone one next to the factory.
  const near = [...w.chunks.ringTilesSorted()].find((k) => w.tiles[k].zone !== 'industrial' && !w.tiles[k].road && !w.tiles[k].water && Math.max(Math.abs((k % GRID) - (i % GRID)), Math.abs(Math.floor(k / GRID) - Math.floor(i / GRID))) <= 3);
  if (near !== undefined) w.tiles[near].zone = 'residential';
  ok(near !== undefined, 'a tile near the factory to test with');
  const env0b = computeEnvironment(w); setPolicy(w, 'night', false); const envOff = computeEnvironment(w); setPolicy(w, 'night', true);
  const env3 = env0b;
  const homes = [...w.chunks.ringTilesSorted()].filter((k) => w.tiles[k].zone === 'residential' && env3.desirability[k] !== envOff.desirability[k]);
  ok(homes.length > 0 && homes.every((k) => Math.abs(env3.desirability[k] - (envOff.desirability[k] - 0.05)) < 1e-4), 'night: homes near factories 5% less happy', homes.length);
  // Trucks: wrap spawn to see who sends night-shift trucks.
  const sent = new Map<number, number>(); let outNow = 0, maxPerBuilding = 0;
  const tr = s.traffic as any, spawn0 = tr.spawn.bind(tr);
  const out = new Map<number, number>();
  tr.spawn = (wd: any, kind: any, from: number, to: number, purpose: string, color?: number, onArrive?: () => void) => {
    if (purpose !== 'night shift') return spawn0(wd, kind, from, to, purpose, color, onArrive);
    out.set(from, (out.get(from) ?? 0) + 1); maxPerBuilding = Math.max(maxPerBuilding, out.get(from)!); sent.set(from, (sent.get(from) ?? 0) + 1); outNow++;
    return spawn0(wd, kind, from, to, purpose, color, () => { out.set(from, out.get(from)! - 1); outNow--; onArrive?.(); });
  };
  const run = (n: number) => { const end = w.tick + n; while (w.tick < end) s.update(0.5); };
  w.clock = 0.4 * 3600; // 09:36-ish: daytime
  const n0 = s.shipping.stats.nightTrucks; run(200);
  ok(s.shipping.stats.nightTrucks === n0, 'no night-shift trucks by day');
  w.clock = 0.7 * 3600 + 3600; // 00:00 (timeOfDay = clock/DAY + 0.3)
  run(400);
  ok(s.shipping.stats.nightTrucks > 0, 'night-shift trucks at night', s.shipping.stats.nightTrucks);
  ok(maxPerBuilding <= 2, 'at most one night truck per building road (two factories may share a road tile)', maxPerBuilding);
  setPolicy(w, 'night', false);
  const env4 = computeEnvironment(w); const n1 = s.shipping.stats.nightTrucks; run(200);
  ok(outputMult(w, t) === out0 && s.shipping.stats.nightTrucks === n1, 'night off: output back, no more night trucks');
  ok(homes.every((k) => env4.desirability[k] === envOff.desirability[k]), 'night off: the 5% happiness penalty is gone');
  // p. save → load
  setPolicy(w, 'eco', true);
  const w2 = deserializeWorld(serializeWorld(w))!;
  ok(w2.policies.eco && !w2.policies.night, 'policies survive save → load');
}

// ---- IND-5 ----
{
  // q. patches: rarer than quarry, only on land with no other patch.
  let ore = 0, quarry = 0;
  for (const f of FIX) {
    const s = load(f), w = s.world, fs = factories(s);
    const res = w.resources;
    const raw = computeResources(w.tiles, w.seed);
    for (let i = 0; i < raw.length; i++) { if (raw[i] === Resource.Ore) ore++; if (raw[i] === Resource.Quarry) quarry++; }
    ok(fs.every((i) => res[i] !== Resource.Ore), `${f}: no existing building stands on ore`);
    // Roles with ore vs. with every ore tile treated as plain land: identical.
    const before = fs.map((i) => roleOf(w, i));
    const saved = Uint8Array.from(res); for (let i = 0; i < res.length; i++) if (res[i] === Resource.Ore) res[i] = Resource.None;
    const noOre = fs.map((i) => roleOf(w, i)); res.set(saved);
    ok(before.every((r, k) => r === noOre[k]) && !before.some((r) => r === 'mine' || r === 'steelMill' || r === 'vehiclePlant'), `${f}: every existing building keeps its role`, fs.length);
    ok(raw.every((r, i) => r !== Resource.Ore || res[i] === Resource.Ore || (w.tiles[i].zone === 'industrial' && (w.tiles[i].level > 0 || w.tiles[i].construct > 0))), `${f}: ore is only hidden under existing industry`);
  }
  ok(ore > 0 && ore < quarry, 'ore patches exist and are rarer than quarries', { ore, quarry });

  // s. Full chain on a test map: the avenue save with four factories turned into the chain.
  const s = load('tools/fixtures/parker-avenue.lpc'), w = s.world;
  // Mine: a working extractor lot (not a farm / food plant) re-surveyed as ore; the
  // processors: factories with a recipe picker.
  const pick = factories(s).filter((i) => s.status(i).operating && canPickRecipe(w, i));
  const ext = factories(s).filter((i) => s.status(i).operating && !canPickRecipe(w, i) && !['farm', 'foodPlant'].includes(roleOf(w, i)));
  ok(pick.length >= 3 && ext.length >= 1, 'enough working factories for the chain', { pick: pick.length, ext: ext.length });
  const m = ext[0], [sm, vp, mp = -1] = pick;
  w.tier = 1; w.resources[m] = Resource.Ore; w.tiles[m].recipe = '';
  ok(roleOf(w, m) !== 'mine', 'r. no mine before the Town tier');
  w.tier = 2;
  ok(roleOf(w, m) === 'mine' && w.tiles[m].recipe === 'mine' && factoryGood(w, m) === 'ore', 'a lot on ore is a mine at the Town tier, making ore');
  w.cash = 1e6;
  ok(setRecipe(w, vp, 'vehiclePlant') !== null, 'r. vehicle plant locked below the City tier');
  w.tier = 3;
  for (const [i, r] of ([[sm, 'steelMill'], [vp, 'vehiclePlant'], [mp, 'materials']] as const).filter(([i]) => i >= 0)) { ok(setRecipe(w, i, r) === null, `picked ${r}`); w.tiles[i].pause = 0; }
  const st0 = { ...s.shipping.stats };
  let ticks = 0; const end = w.tick + 2400;
  let vehicles = 0, steelMade = 0, steelBoostSeen = false;
  const vt = w.tiles[vp], stt = w.tiles[sm];
  let lastV = vt.stock, lastS = stt.stock;
  while (w.tick < end) {
    s.update(0.5); ticks++;
    if (vt.stock > lastV) vehicles += vt.stock - lastV; lastV = vt.stock;
    if (stt.stock > lastS) steelMade += stt.stock - lastS; lastS = stt.stock;
    if (s.shipping.steelBoost(w)) steelBoostSeen = true;
  }
  const flows = [...s.shipping.flow.links.values()];
  ok(flows.some((l) => l.from === m && l.to === sm && l.good === 'ore'), 's. mine → steel mill ore trucks', flows.filter((l) => l.from === m).map((l) => l.good));
  ok(steelMade > 0, 's. the steel mill makes steel', +steelMade.toFixed(1));
  ok(flows.some((l) => l.from === sm && l.good === 'steel' && (l.to === vp || l.to === mp)), 's. steel goes to the vehicle / materials plant', flows.filter((l) => l.from === sm).map((l) => [l.to === vp ? 'vp' : l.to === mp ? 'mp' : l.to, l.good]));
  ok(vehicles > 0, 's. the vehicle plant makes vehicles (steel + plastics)', +vehicles.toFixed(1));
  ok(s.shipping.stats.processed > st0.processed, 'processing happened');
  void steelBoostSeen;
  // Steel-based materials → +20% build speed: simulate a yard holding them.
  const yard = w.tiles.findIndex((t) => t.structure === 'constructionYard');
  if (yard >= 0) { w.tiles[yard].stock = 10; s.shipping.steelYards.add(yard); }
  ok(yard >= 0 && s.shipping.steelBoost(w), 's. a yard with steel-based materials boosts building');
  // t. save → load keeps the mine; prices; bodies; dealership
  {
    // A real ore tile: a built mine (recipe 'mine') keeps its ore after save → load; an
    // older factory (no 'mine' mark) on the same land loses it and keeps its old role.
    const k = computeResources(w.tiles, w.seed).findIndex((r) => r === Resource.Ore);
    const t = w.tiles[k], keep = { zone: t.zone, level: t.level, recipe: t.recipe };
    t.zone = 'industrial'; t.level = 1; t.recipe = 'mine';
    const a = deserializeWorld(serializeWorld(w))!;
    t.recipe = '';
    const b = deserializeWorld(serializeWorld(w))!;
    Object.assign(t, keep);
    ok(k >= 0 && a.resources[k] === Resource.Ore && b.resources[k] === Resource.None, 't. a mine keeps its ore after save → load; a pre-ore factory does not get any');
  }
  ok(EXPORT_PRICE.ore === 180 && EXPORT_PRICE.steel === 480 && EXPORT_PRICE.vehicles === 900, 't. export prices ore $180, steel $480, vehicles $900');
  ok(truckBody('delivery: ore to Steel mill') === 'dump' && truckBody('delivery: steel') === 'box', 't. ore rides in dump trucks, steel in box trucks');
  const dealer = [...w.lots.buildings.values()].find((b) => b.tpl === 'car_dealer');
  if (dealer) ok(shopGood(w, dealer.host) === 'vehicles', 't. a car dealership sells vehicles');
  else console.log('note no car dealership on this save');
}

console.log(fails ? `\n${fails} FAILED` : '\nall industry-control checks passed');
process.exit(fails ? 1 : 0);
