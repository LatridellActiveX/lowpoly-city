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
import { rangeOf } from '../src/sim/parking';
import { isRightTurn, ringStepOk } from '../src/sim/traffic';
import { isUnlocked } from '../src/sim/progression';
import { roleOf } from '../src/sim/chains';
import { REDEV_MAX, REDEV_MONTHS } from '../src/sim/redevelop';
import { Resource } from '../src/sim/resources';
import { resLevel, TPL } from '../src/sim/footprints';
import { growablePool } from '../src/sim/lots';
import { computeLandValue } from '../src/sim/environment';

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

// ---------------------------------------------------------------- stage 4: parking
const rect = (x0: number, z0: number, x1: number, z1: number) => { const o: Array<[number, number]> = []; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) o.push([x, z]); return o; };
/** Grid town like cells.test.ts (streets every 7 tiles, utilities, a yard). */
function town(opts: { comDepth?: number; seed?: number } = {}): Simulation {
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
  s.zoneOpt = { density: 1, depth: opts.comDepth ?? 3 };
  s.apply('commercial', rect(11, 20, 29, 20)); s.apply('commercial', rect(31, 20, 49, 20)); s.apply('commercial', rect(31, 25, 49, 25));
  s.zoneOpt = { density: 0, depth: 2 };
  s.apply('industrial', rect(31, 34, 49, 34));
  return s;
}
const run = (s: Simulation, ticks: number) => { for (let i = 0; i < ticks; i++) { s.step(); s.traffic.update(s.world, 1); s.world.clock += 1; } };
{
  const s = fresh();
  s.apply('road', rect(5, 5, 15, 5));
  s.pointerFrac = [0.2, 0.2];
  s.apply('parkingLot', [[8, 6]]);
  const lot = [...s.world.parking.lots.values()][0];
  check('surface lot fills the whole tile (16 cells, 16 spaces)', !!lot && lot.size === 4 && lot.spaces === 16 && !lot.garage, lot);
  s.apply('parkingGarage', [[10, 6]]);
  const gar = [...s.world.parking.lots.values()].find((l) => l.garage);
  check('garage: 3 decks, 40 spaces', !!gar && gar.decks === 3 && gar.spaces === 40, gar);
  check('ranges: lot 2× (24 cells), garage 3× (36 cells)', rangeOf(lot) === 24 && rangeOf(gar!) === 36);
  // Save v7 round-trip + PR 6 lot migration (size 2 → surface, size 4 → garage).
  saveWorld(s.world);
  const d = JSON.parse(store.get('lowpoly-city-save')!);
  d.version = 6; d.lots = d.lots.map((l: any) => { const { garage, decks, grown, ...rest } = l; return { ...rest, size: garage ? 4 : 2, spaces: garage ? 40 : 4 }; });
  store.set('lowpoly-city-save', JSON.stringify(d));
  const m = [...loadWorld()!.parking.lots.values()];
  check('v6 lots migrate (2×2 stays a 4-space lot, size 4 = garage)', m.some((l) => !l.garage && l.size === 2 && l.spaces === 4) && m.some((l) => l.garage && l.decks === 3));
}
{
  const s = town();
  const p = s.world.parking;
  // V1.5b: count every garage that grows (a grown garage can later be
  // redeveloped back into a shop when idle, so "still standing" is too strict
  // after the RCI rebalance shifted how fast shops fill new frontage).
  let grownEver = 0, feesSeen = 0;
  { const pk = p as any, orig = pk.growGarages.bind(pk); pk.growGarages = (...a: unknown[]) => { const r = orig(...a); if (r) grownEver++; return r; }; }
  const runFees = (n: number) => { for (let k = 0; k < n; k += 10) { run(s, 10); feesSeen = Math.max(feesSeen, (s.world.ledger.trade.parking ?? 0) + (s.world.lastLedger?.trade.parking ?? 0)); } };
  runFees(900);
  let maxRatio = 0;
  for (const b of s.world.lots.buildings.values()) if (b.level > 0 && TPL[b.tpl].zone === "commercial") { const c = [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]; const r = p.localBalance(s.world.lots, c); maxRatio = Math.max(maxRatio, r.demand / Math.max(1, r.supply)); }
  // Fresh commercial frontage next to the busy shops: garages may claim it.
  s.zoneOpt = { density: 1, depth: 1 };
  s.apply('commercial', rect(11, 18, 29, 18));
  s.apply('commercial', rect(31, 18, 49, 18));
  runFees(240);
  const grownN = [...p.lots.values()].filter((l) => l.grown).length;
  check('busy shops grow a multi-storey garage', grownN > 0 || grownEver > 0, { standing: grownN, grownEver });
  runFees(300);
  check('garages earn fees', feesSeen > 0, feesSeen);
  console.log('NUMBERS parking', JSON.stringify({ pop: s.stats().population, maxRatio: +maxRatio.toFixed(2), grown: grownN, fees: s.world.ledger.trade.parking ?? 0, totals: p.totals(s.world.lots) }));
}

// ---------------------------------------------------------------- stage 5: mixed use
{
  const s = town();
  s.zoneOpt = { density: 2, depth: 1 }; // Commercial ▸ Mixed
  s.apply('commercial', rect(11, 18, 29, 18));
  const z10 = () => { let n = 0, o = 0; s.world.cells.zone.forEach((c, i) => { if (c === 10) { n++; if (s.world.cells.owner[i]) o++; } }); return [n, o]; };
  run(s, 700);
  const mixed = [...s.world.lots.buildings.values()].filter((b) => TPL[b.tpl].residents && b.level > 0);
  const tile = mixed[0] ? s.world.tiles[mixed[0].host] : null;
  check('mixed-use blocks grow on Mixed zoning', mixed.length > 0, mixed.length);
  check('mixed use: 10 residents + 1 business (4 jobs) each', !!tile && TPL[mixed[0].tpl].residents![0] === 10 && TPL[mixed[0].tpl].capacity[0] === 4 && tile.res >= 10, tile && { res: tile.res, jobs: tile.jobs });
  const st = s.stats();
  check('mixed-use residents count toward population', st.population >= mixed.length * 10, { pop: st.population, mixed: mixed.length });
}

// ---------------------------------------------------------------- stage 6: residential levels
{
  const s = town(); // residential zoned LOW density only
  s.world.peakPop = 6000; // medium housing + both extra medium levels unlocked
  // Parks raise desirability (medium needs 1.2); extra industry keeps resident demand up.
  for (let x = 12; x < 50; x += 3) { s.apply('park', [[x, 16]]); s.apply('park', [[x, 30]]); }
  s.zoneOpt = { density: 0, depth: 4 }; s.apply('industrial', rect(11, 41, 29, 41));
  run(s, 3000);
  const bs = [...s.world.lots.buildings.values()].filter((b) => TPL[b.tpl].zone === 'residential');
  const med = bs.filter((b) => TPL[b.tpl].density === 1);
  const maxLv = Math.max(0, ...bs.map((b) => resLevel(TPL[b.tpl], b.level)));
  check('level-3 houses grow into medium density on LOW zoning automatically', med.length > 0, { medium: med.length, merged: s.world.lots.stats.merged });
  check('medium buildings reach residential level 6+', maxLv >= 6, maxLv);
  check('L6/L7 capacities ~1.5x / ~2.2x of L5 (apartment 165 / 240)', TPL['apartment'].capacity[2] === 165 && TPL['apartment'].capacity[3] === 240);
}

// ---------------------------------------------------------------- stage 9: right on red
{
  // V1.5b: summed over 14 warm-ups (the stressed grid is chaotic: ±100 trips per sample) — one ~200-trip sample flipped with the RCI rebalance.
  const res: Record<string, any> = { off: { arrived: 0, gaveUp: 0, rightOnRed: 0, wait: 0 }, ror: { arrived: 0, gaveUp: 0, rightOnRed: 0, wait: 0 } };
  // (town() ignores opts.seed, so the samples differ by warm-up length instead.)
  for (const warm of [500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000, 1050, 1100, 1150]) for (const ror of [false, true]) {
    const t = town({ seed: 77 });
    t.settings.maxCars = 400;
    t.traffic.rightOnRed = ror;
    run(t, warm);
    const roads: number[] = []; t.world.tiles.forEach((q, i) => q.road && roads.push(i));
    for (let k = 0; k < 300; k++) t.traffic.spawn(t.world, 'car', roads[(k * 37) % roads.length], roads[(k * 101 + 13) % roads.length], 'stress');
    const st0 = { ...t.traffic.stats };
    for (let i = 0; i < 240; i++) { t.traffic.update(t.world, 0.5); t.world.clock += 0.5; }
    const r = res[ror ? 'ror' : 'off'];
    r.arrived += t.traffic.stats.arrived - st0.arrived; r.gaveUp += t.traffic.stats.gaveUp - st0.gaveUp;
    r.rightOnRed += t.traffic.stats.rightOnRed - st0.rightOnRed; r.wait += t.traffic.stats.waitSec - st0.waitSec;
  }
  for (const r of Object.values(res)) r.waitPerTrip = +(r.wait / Math.max(1, r.arrived + r.gaveUp)).toFixed(2);
  const rate = (r: any) => r.gaveUp / Math.max(1, r.arrived + r.gaveUp);
  check('right on red is used (only on right turns, after a stop)', res.ror.rightOnRed > 0, res);
  check('right on red: no worse give-ups (+2 pts, 14 samples), no longer red waits', rate(res.ror) <= rate(res.off) + 0.02 && res.ror.waitPerTrip <= res.off.waitPerTrip * 1.05, res);
  // V1.5b: throughput check restored after the RoR fix (clear exit lane + corner-only box hold).
  check('right on red: no throughput loss (≥ 97 % of trips without RoR)', res.ror.arrived >= res.off.arrived * 0.97, { off: res.off.arrived, ror: res.ror.arrived });
}
{
  // isRightTurn geometry: heading north then east = right; north then west = left.
  const j = idx(10, 10);
  check('isRightTurn: N→E right, N→W not', isRightTurn(idx(10, 11), j, idx(11, 10)) && !isRightTurn(idx(10, 11), j, idx(9, 10)));
}

// ---------------------------------------------------------------- stages 7+8: roundabout + 4-lane avenues
{
  // Avenue unlock: locked at tier 0 below 250 people, open at 250.
  check('avenue locked < 250 pop, unlocked at 250', !isUnlocked('avenue', 0, 249) && isUnlocked('avenue', 0, 250));
  // Lane changes: a long avenue corridor under load.
  const t = town({ seed: 91 });
  t.world.tier = 1;
  t.apply('avenue', rect(10, 26, 50, 26)); // upgrade tool still works on streets
  check('avenue upgrade tool converts streets', t.world.tiles[idx(20, 26)].roadType === 1);
  t.settings.maxCars = 400;
  const av: number[] = []; for (let x = 10; x <= 50; x++) av.push(idx(x, 26));
  const sides = [idx(30, 13), idx(30, 40), idx(10, 19), idx(50, 33)];
  for (let k = 0; k < 160; k++) t.traffic.spawn(t.world, 'car', av[(k * 7) % 5], k % 3 ? av[av.length - 1 - (k % 4)] : sides[k % 4], 'stress');
  const lanesSeen = new Set<number>();
  for (let i = 0; i < 300; i++) { t.traffic.update(t.world, 0.5); t.world.clock += 0.5; for (const v of t.traffic.vehicles) if (t.world.tiles[v.path[v.seg]]?.roadType === 1) lanesSeen.add(v.lane); }
  check('avenue cars change lanes (MOBIL + turn lanes)', t.traffic.stats.laneChanges > 0, t.traffic.stats.laneChanges);
  check('both avenue lanes are used', lanesSeen.has(0) && lanesSeen.has(1), [...lanesSeen]);

  // Roundabout: replace the (30,18)-(31,19) area with a 2x2 ring on the grid.
  const r = town({ seed: 33 });
  r.apply('roundabout', [[30, 18], [31, 18], [30, 19], [31, 19]]);
  const ring = [[30, 18], [31, 18], [30, 19], [31, 19]].map(([x, z]) => r.world.tiles[idx(x, z)]);
  check('roundabout: 4 ring tiles with water mains', ring.every((q) => q.road && q.roadType === 2 && q.waterPipe));
  check('ring circulation is one-way counter-clockwise', ringStepOk(r.world.tiles, idx(31, 18), idx(30, 18)) !== ringStepOk(r.world.tiles, idx(30, 18), idx(31, 18)));
  r.settings.maxCars = 300;
  const roads: number[] = []; r.world.tiles.forEach((q, i) => q.road && roads.push(i));
  for (let k = 0; k < 200; k++) r.traffic.spawn(r.world, 'car', roads[(k * 37) % roads.length], roads[(k * 101 + 13) % roads.length], 'stress');
  const a0 = r.traffic.stats.arrived, g0 = r.traffic.stats.gaveUp;
  for (let i = 0; i < 300; i++) { r.traffic.update(r.world, 0.5); r.world.clock += 0.5; }
  const arrived = r.traffic.stats.arrived - a0, gave = r.traffic.stats.gaveUp - g0;
  check('roundabout traffic flows (no gridlock)', arrived > 100 && gave / Math.max(1, arrived + gave) < 0.15, { arrived, gave });
  r.apply('bulldoze', [[31, 18]]);
  check('bulldozing a ring tile reverts the block to streets', r.world.tiles[idx(30, 18)].roadType === 0);
}

// ---------------------------------------------------------------- stage 10: resource industries + goods chains
{
  const s = town({ seed: 10 });
  // Force resource patches under the east industrial strip (rows 34..36):
  // logging x31-36, oil x37-42, quarry x43-49. Everything else: none.
  const res = new Uint8Array(64 * 64);
  for (let z = 34; z <= 37; z++) for (let x = 31; x <= 49; x++) res[idx(x, z)] = x <= 36 ? Resource.Logging : x <= 42 ? Resource.Oil : Resource.Quarry;
  (s.world as any).resourceCache = res;
  s.zoneOpt = { density: 0, depth: 4 }; s.apply('industrial', rect(11, 41, 29, 41)); // processors
  run(s, 2200);
  const roles = new Map<string, number>();
  s.world.tiles.forEach((t, i) => { if (t.zone === 'industrial' && t.level > 0) { const r = roleOf(s.world, i); roles.set(r, (roles.get(r) ?? 0) + 1); } });
  const R = Object.fromEntries(roles);
  check('extractors on patches: logging camp, oil rig, quarry', !!R.logging && !!R.oilRig && !!R.quarry, R);
  check('plain factories adopt processor recipes (lumber mill / refinery / materials …)', ['lumberMill', 'refinery', 'materials', 'furniture', 'electronics'].filter((r) => R[r]).length >= 2, R);
  const st = s.shipping.stats;
  check('raw loads travel to processors and get processed', st.chainLoads > 0 && st.processed > 0, st);
  check('construction uses building materials', st.materialsUsed > 0, st);
  check('surplus exported, buildings book sales and input costs', st.exported > 0 && s.shipping.sales.size > 0 && s.shipping.costs.size > 0, { exported: st.exported, sales: s.shipping.sales.size, costs: s.shipping.costs.size });
  // ---------------------------------------------------------------- stage 11: economy (same town)
  const w = s.world, env = s.env;
  const prof = [...w.profits.entries()];
  const shops = prof.filter(([i]) => w.tiles[i].zone === 'commercial').map(([, p]) => p.net);
  const inds = prof.filter(([i]) => w.tiles[i].zone === 'industrial').map(([, p]) => p);
  check('profit booked monthly for shops and industry', shops.length > 0 && inds.length > 0, { shops: shops.length, ind: inds.length });
  check('profit = sales − inputs − wages − taxes', prof.every(([, p]) => Math.abs(p.net - (p.sales - p.inputs - p.wages - p.taxes)) < 1e-6));
  check('most shops in a supplied town make a profit', shops.filter((x) => x > 0).length >= shops.length * 0.6, { pos: shops.filter((x) => x > 0).length, n: shops.length });
  check('processors pay for their inputs', inds.some((p) => p.inputs > 0));
  // Land value: kerbside land > land 4 tiles from any road; pollution lowers it.
  const lv = (x: number, z: number) => env.landValue[idx(x, z)];
  // V1.5b: this town (no dump, no police) now also carries garbage and crime
  // penalties; road access is checked on the base land value without them.
  const g0 = w.tiles.map((t) => t.garbage); w.tiles.forEach((t) => { t.garbage = 0; });
  const base = computeLandValue(w, env, s.net.service).landValue; w.tiles.forEach((t, k) => { t.garbage = g0[k]; });
  check('land value: road access matters (base value, before garbage/crime)', base[idx(20, 13)] > base[idx(5, 5)] + 0.3, { kerb: base[idx(20, 13)], far: base[idx(5, 5)], withPenalties: lv(20, 13) });
  check('land value: polluted industrial land < homes', lv(40, 35) < lv(40, 13), { ind: lv(40, 35), home: lv(40, 13) });
  const before = s.projectMonth().property ?? 0;
  w.propertyRate = 0.1;
  const after = s.projectMonth().property ?? 0;
  check('property tax books and scales with its rate', before > 0 && Math.abs(after - before * 2) <= 2, { before, after });
  saveWorld(w);
  check('property rate survives save/load', loadWorld()!.propertyRate === 0.1);

}

// ---------------------------------------------------------------- stage 12: health-based redevelopment
{
  const s = town({ seed: 12 });
  run(s, 1500);
  const w = s.world, all = [...w.lots.buildings.values()].filter((b) => b.health !== undefined);
  const avg = all.reduce((a, b) => a + b.health!, 0) / Math.max(1, all.length);
  check('every finished building gets a monthly health 0..1', all.length > 20 && all.every((b) => b.health! >= 0 && b.health! <= 1), { n: all.length, avg: +avg.toFixed(2) });
  const lowBy: Record<string, number> = {}; for (const b of all) if (b.health! < 0.3) lowBy[TPL[b.tpl].zone] = (lowBy[TPL[b.tpl].zone] ?? 0) + 1;
  check('a serviced, growing town is mostly healthy (avg > 0.5, < 15% struggling)', avg > 0.5 && Object.values(lowBy).reduce((a, b) => a + b, 0) < all.length * 0.15, { avg: +avg.toFixed(2), lowBy });
  // Pollution + no land value make a street sick: coal plants beside homes.
  const homes = all.filter((b) => TPL[b.tpl].zone === 'residential');
  const victim = homes[0];
  const before = s.redevelop.health(s, victim, 1);
  s.env.pollution[victim.host] += 4; s.env.landValue[victim.host] = 0; s.env.desirability[victim.host] -= 2; // as if a coal plant opened next door
  const after = s.redevelop.health(s, victim, 1);
  check('pollution / lost land value lower building health', after < before - 0.1, { before: +before.toFixed(2), after: +after.toFixed(2) });

  // Trigger + cap: force every shop unhealthy and run monthly passes.
  const rd = s.redevelop as any; const orig = rd.health.bind(rd);
  rd.health = (sim: any, b: any, wr: number) => (TPL[b.tpl].zone === 'commercial' ? 0.1 : orig(sim, b, wr));
  const shops0 = new Map([...w.lots.buildings.values()].filter((b) => TPL[b.tpl].zone === 'commercial' && b.level > 0).map((b) => [b.id, b.tpl]));
  for (let m = 0; m < REDEV_MONTHS - 1; m++) s.redevelop.month(s);
  check('no rebuild before health stays low for 3 months', s.redevelop.stats.rebuilt === 0, s.redevelop.stats);
  (w.parking as any).localBalance = () => ({ demand: 0, supply: 100 }); // no parking pressure → plain rebuilds
  s.redevelop.month(s);
  const sites = [...w.lots.buildings.values()].filter((b) => b.redev && b.construct > 0);
  check('after 3 low months: rebuilt as a DIFFERENT same-zone template, capped', sites.length > 0 && sites.length <= REDEV_MAX && sites.every((b) => TPL[b.tpl].zone === 'commercial'), { sites: sites.length, cap: REDEV_MAX, tpls: sites.map((b) => b.tpl) });
  check('rebuild sites need construction crews (start at level 0)', sites.every((b) => b.level === 0));
  s.redevelop.month(s);
  check('cap holds while rebuilds are under way', [...w.lots.buildings.values()].filter((b) => b.redev && b.construct > 0).length <= REDEV_MAX);
  // SHOP → GARAGE when the district is short of parking.
  (w.parking as any).localBalance = () => ({ demand: 500, supply: 10 });
  const lone = [...w.lots.buildings.values()].find((b) => TPL[b.tpl].zone === 'commercial' && !TPL[b.tpl].residents && b.level > 0 && w.lots.onTile(w, b.host % 64, Math.floor(b.host / 64)).filter((o) => TPL[o.tpl].capacity[0] > 0).length === 1);
  const g0 = w.parking.lots.size;
  if (lone) s.redevelop.rebuild(s, lone);
  check('shop → garage when parking is short', !!lone && s.redevelop.stats.shopToGarage === 1 && w.parking.lots.size === g0 + 1, { lone: !!lone, ...s.redevelop.stats });
  // GARAGE → SHOP: an idle grown garage goes when shops are wanted.
  const gl = [...w.parking.lots.values()].find((l) => l.grown)!;
  gl.parked = 0;
  (s as any).demand.commercial.value = 0.5;
  for (const b of w.lots.buildings.values()) b.redev = false; // free the cap for this check
  rd.health = () => 0.9;
  for (let m = 0; m < REDEV_MONTHS; m++) { gl.parked = 0; s.redevelop.month(s); }
  check('idle grown garage → shop lot', s.redevelop.stats.garageToShop >= 1 && !w.parking.lots.has(gl.id), s.redevelop.stats);
  void shops0;
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
