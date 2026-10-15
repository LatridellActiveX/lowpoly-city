/**
 * tools/v15b.test.ts — Version 1.5b headless checks (one section per stage).
 * Run: npm run test:v15b. Prints PASS/FAIL; exits 1 on failure.
 */
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };

import { Simulation } from '../src/sim/simulation';
import { World } from '../src/sim/grid';
import { loadWorld, migrateLandfills, saveWorld } from '../src/sim/save';
import { output } from '../src/sim/networks';
import { idx } from '../src/sim/grid';
import { rangeOf } from '../src/sim/parking';
import { isRightTurn, ringStepOk } from '../src/sim/traffic';
import { isUnlocked } from '../src/sim/progression';
import { roleOf } from '../src/sim/chains';
import { REDEV_MAX, REDEV_MONTHS } from '../src/sim/redevelop';
import { Resource } from '../src/sim/resources';
import { resLevel, TPL } from '../src/sim/footprints';
import { growablePool, parkingRequired as parkingRequiredOf } from '../src/sim/lots';

let fails = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? '  ' + JSON.stringify(info) : ''}`); if (!ok) fails++; };
const fresh = () => { const s = new Simulation(new World(undefined, 4242)); s.world.cash = 1e7; s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; }); return s; };

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

import { SERVICE_DEFS, serviceSize, Svc } from '../src/sim/services';
import { G_WARN, GARBAGE_START, LANDFILL_MAX, landfillStage } from '../src/sim/garbage';
import { isUnlocked } from '../src/sim/progression';

// ---------------------------------------------------------------- stage E: garbage
{
  check('landfill (garbage dump) locked < 1,000 people, unlocked at 1,000', !isUnlocked('garbageDump', 0, 999) && isUnlocked('garbageDump', 0, 1000));
  const res: Record<string, any> = {};
  for (const dump of [false, true]) {
    const s = town({ seed: 21 });
    s.world.peakPop = 1000;
    if (dump) s.apply('garbageDump', [[31, 17], [32, 17], [31, 18], [32, 18]]); // V1.6: the dump is a 2×2 landfill
    run(s, 2200); // longer since the halved GARBAGE_RATE / higher G_WARN tune
    let g = 0, n = 0, piles = 0, lv = 0;
    s.world.tiles.forEach((t, i) => { if (t.zone && t.level > 0) { g += t.garbage; n++; lv += s.env.landValue[i]; if (t.garbage >= G_WARN) piles++; } });
    res[dump ? 'dump' : 'none'] = { avg: +(g / n).toFixed(1), piles, lv: +(lv / n).toFixed(2), trips: s.garbage.stats.trips, collected: Math.round(s.garbage.stats.collected), dumpTile: s.world.at(31, 17).structure };
    if (dump) {
      saveWorld(s.world);
      const l = loadWorld()!;
      check('dump + garbage survive save/load', l.at(31, 17).structure === 'service' && l.at(31, 17).kind === Svc.Dump && l.tiles.some((t) => t.garbage > 0));
      const p = s.projectMonth();
      check('dump upkeep is booked under services', p.upkeep.service === SERVICE_DEFS[Svc.Dump].upkeep, p.upkeep);
    }
  }
  check('without a dump, garbage piles up at buildings (warnings)', res.none.piles > 5, res);
  check('dump trucks drive out and collect', res.dump.trips > 5 && res.dump.collected > 100, res.dump);
  check('collection keeps garbage low and land value higher', res.dump.avg < res.none.avg * 0.6 && res.dump.lv > res.none.lv, res);
  const s2 = town({ seed: 22 });
  run(s2, 50);
  check(`no garbage before ${GARBAGE_START} people`, s2.world.tiles.every((t) => t.garbage === 0));
}

// ---------------------------------------------------------------- V1.6: landfill capacity, recycling center, unlocks
{
  const big = (x: number, z: number): Array<[number, number]> => [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]];
  check('recycling center unlocks at 2,500 people with police and the high school', !isUnlocked('recyclingCenter', 0, 2499) && isUnlocked('recyclingCenter', 0, 2500));

  const s = town({ seed: 21 });
  s.world.peakPop = 2500;
  s.apply('garbageDump', big(31, 17));
  const a = idx(31, 17), t = s.world.tiles[a];
  check('the landfill is a 2×2 building (three part tiles link to the anchor)', t.structure === 'service' && t.kind === Svc.Dump && t.part === 0 && s.world.tiles[a + 1].part === a + 1 && s.world.tiles[a + 64].part === a + 1 && s.world.tiles[a + 65].part === a + 1 && serviceSize(s.world.tiles, a) === 2);
  check('a new landfill is empty (stage 0)', t.stock === 0 && landfillStage(t) === 0);
  const stages = [0, 0.19, 0.21, 0.51, 0.79, 0.81, 0.999, 1].map((f) => { t.stock = f * LANDFILL_MAX; return landfillStage(t); });
  check('landfill model stage follows the fill; the last stage is only for a FULL one', JSON.stringify(stages) === '[0,0,1,2,3,4,4,5]', stages);
  t.stock = 0;
  run(s, 2200);
  check('trucks unload into the landfill, so it fills up', t.stock > 0 && t.stock <= LANDFILL_MAX, t.stock);
  // A full landfill sends no more trucks.
  t.stock = LANDFILL_MAX;
  const trips = s.garbage.stats.trips;
  run(s, 500);
  check('a full landfill sends no more trucks and stays full', s.garbage.stats.trips === trips && t.stock === LANDFILL_MAX, { trips: s.garbage.stats.trips - trips, stock: t.stock });
  // Bulldozing the landfill clears the fill, so a new one starts empty.
  s.apply('bulldoze', big(31, 17));
  check('bulldozing a landfill removes all four tiles and its fill', [a, a + 1, a + 64, a + 65].every((i) => s.world.tiles[i].structure === 'none' && s.world.tiles[i].stock === 0));

  // Recycling centers cut garbage build-up where they cover (no landfill, so nothing is collected).
  const near = (sim: Simulation) => { let g = 0; sim.world.tiles.forEach((q, i) => { if (q.zone && q.level > 0 && Math.abs((i % 64) - 31) <= 5 && Math.abs(Math.floor(i / 64) - 17) <= 5) g += q.garbage; }); return g; };
  const base = town({ seed: 24 }), rec = town({ seed: 24 });
  base.world.peakPop = rec.world.peakPop = 2500;
  rec.apply('recyclingCenter', [[31, 17]]);
  run(base, 1500); run(rec, 1500);
  const gBase = near(base), gRec = near(rec);
  check('a recycling center cuts garbage build-up nearby by a lot', gBase > 0 && gRec < gBase * 0.75, { gBase: +gBase.toFixed(1), gRec: +gRec.toFixed(1) });

  // Old saves: a 1×1 dump grows into a 2×2 landfill when the three tiles are free, and the migration is idempotent.
  const old = town({ seed: 25 });
  const o = old.world.tiles[a];
  o.structure = 'service'; o.kind = Svc.Dump; o.part = 0;
  check('a legacy 1×1 dump reports size 1', serviceSize(old.world.tiles, a) === 1);
  check('the migration grows a legacy dump to 2×2', migrateLandfills(old.world) === 1 && serviceSize(old.world.tiles, a) === 2 && old.world.tiles[a + 65].part === a + 1);
  check('the landfill migration is idempotent', migrateLandfills(old.world) === 0);
}

// ---------------------------------------------------------------- stage F: police + health care
import { CRIME_START } from '../src/sim/safety';
{
  check('police locked < 2,500 (V1.6), clinic/hospital locked < 2,500', !isUnlocked('policeStation', 0, 2499) && isUnlocked('policeStation', 0, 2500) && !isUnlocked('clinic', 0, 2499) && isUnlocked('hospital', 0, 2500));
  const res: Record<string, any> = {};
  for (const mode of ['none', 'police', 'clinic']) {
    const s = town({ seed: 23 });
    s.world.peakPop = 3000;
    if (mode === 'police') s.apply('policeStation', [[31, 17]]);
    if (mode === 'clinic') s.apply('clinic', [[31, 17]]);
    run(s, 700);
    let cr = 0, n = 0, lv = 0, h = 0, hn = 0;
    s.world.tiles.forEach((t, i) => { if (t.zone && t.level > 0 && Math.abs((i % 64) - 31) <= 5 && Math.abs(Math.floor(i / 64) - 17) <= 5) { cr += s.safety.crime[i]; lv += s.env.landValue[i]; n++; } });
    for (const b of s.world.lots.buildings.values()) { const x = b.host % 64, z = Math.floor(b.host / 64); if (Math.abs(x - 31) <= 5 && Math.abs(z - 17) <= 5) { h += s.redevelop.health(s, b, 1); hn++; } }
    res[mode] = { crime: +(cr / n).toFixed(3), lv: +(lv / n).toFixed(2), health: +(h / Math.max(1, hn)).toFixed(3), patrols: s.responders.stats.patrols, amb: s.responders.stats.ambulance, svc: s.world.at(31, 17).structure };
  }
  check('crime appears in a city of 3,000 without police', res.none.crime > 0.05, res.none);
  check('police coverage cuts crime ≥ 60 % near the station and raises land value', res.police.crime < res.none.crime * 0.4 && res.police.lv > res.none.lv, res);
  check('police cars patrol', res.police.patrols > 3, res.police);
  check('clinic coverage raises building health and land value', res.clinic.health > res.none.health && res.clinic.lv > res.none.lv, res);
  check('ambulances run from the clinic', res.clinic.amb > 3, res.clinic);
  const s = town(); s.world.peakPop = CRIME_START - 1; run(s, 5);
  check(`no crime before ${CRIME_START} people`, s.safety.crime.every((c) => c === 0));
}

// ---------------------------------------------------------------- stage G: education + workforce
import { computeDemand, EDU_BASELINE } from '../src/sim/demand';
import { eduSlow, EDU_SLOW_ELEM } from '../src/sim/growth';
{
  check('elementary unlocked from the start; high school 2,500 (V1.6); college 2,500', isUnlocked('elementarySchool', 0, 0) && !isUnlocked('highSchool', 0, 2499) && isUnlocked('highSchool', 0, 2500) && !isUnlocked('college', 0, 2499) && isUnlocked('college', 0, 2500));
  // Workforce: shops with no educated workers lose commercial demand; school coverage restores it.
  const w = fresh().world;
  for (let k = 0; k < 20; k++) { const t = w.tiles[idx(5 + k, 5)]; t.zone = 'residential'; t.level = 3; t.res = 20; }
  for (let k = 0; k < 20; k++) { const t = w.tiles[idx(5 + k, 7)]; t.zone = 'commercial'; t.level = 3; t.stock = 5; }
  const none = computeDemand(w, 1, () => true, new Uint8Array(64 * 64));
  const all = computeDemand(w, 1, () => true, new Uint8Array(64 * 64).fill(1));
  check('workforce split reported (educated + uneducated = workers)', !!none.workforce && Math.abs(none.workforce.educated + none.workforce.uneducated - 400 * 0.55) < 1e-6 && Math.abs(none.workforce.educated - 400 * 0.55 * EDU_BASELINE) < 1e-6, none.workforce);
  check('lack of educated workers limits commercial demand (tooltip says so)', all.commercial.value > none.commercial.value + 0.1 && /educated workers/.test(none.commercial.driver), { none: none.commercial, all: all.commercial.value });
  check('industrial demand is not hit by the education gap', all.industrial.value === none.industrial.value);
  // Home levels: slower without schools.
  const s = town({ seed: 31 }); run(s, 5);
  const b = [...s.world.lots.buildings.values()].find((q) => TPL[q.tpl].zone === 'residential')!;
  const fake = { ...b, tpl: 'house_s', level: 3 } as any;
  s.cov.edu.fill(0);
  check('L4 grows slower without elementary coverage', eduSlow(s, fake) === EDU_SLOW_ELEM);
  s.cov.edu.fill(1);
  check('L4 normal speed with elementary coverage', eduSlow(s, fake) === 1);
  const sc = town({ seed: 32 }); sc.apply('elementarySchool', [[31, 17], [32, 17], [31, 18], [32, 18]]); run(sc, 3);
  check('an elementary school covers nearby homes (edu ≥ 1)', sc.world.at(31, 17).structure === 'service' && sc.cov.edu[idx(31, 13)] >= 1, sc.cov.edu[idx(31, 13)]);
}

// ---------------------------------------------------------------- stage H: offices
import { ZoneCode, zoneCode } from '../src/sim/cells';
{
  check('Commercial ▸ Office paints the office zone code', zoneCode('commercial', 3) === ZoneCode.ComOffice);
  const ids = ['law_firm', 'cable_co', 'internet_co', 'data_center', 'cell_tower', 'radio_station'];
  check('six office building types exist (kind 4)', ids.every((id) => TPL[id] && TPL[id].kind === 4 && TPL[id].zone === 'commercial'));
  const s = town({ seed: 41 });
  s.zoneOpt = { density: 3, depth: 2 }; s.apply('commercial', rect(11, 25, 29, 25));
  s.apply('elementarySchool', [[20, 17], [21, 17], [20, 18], [21, 18]]);
  run(s, 1200);
  const offices = [...s.world.lots.buildings.values()].filter((b) => TPL[b.tpl].kind === 4 && TPL[b.tpl].zone === 'commercial');
  let officeJobs = 0; s.world.tiles.forEach((t) => { if (t.zone === 'commercial' && t.kind === 4) officeJobs += t.jobs; });
  check('offices grow on office zoning', offices.length > 0, { n: offices.length, kinds: [...new Set(offices.map((b) => b.tpl))] });
  check('office jobs counted (and in the educated-worker need)', officeJobs > 0 && (s.demand.workforce?.needEducated ?? 0) > 0, { officeJobs, wf: s.demand.workforce });
  // Office jobs count toward BOTH commercial and industrial jobs: adding office jobs lowers both demands.
  const w = fresh().world;
  for (let k = 0; k < 5; k++) { const t = w.tiles[idx(5 + k, 5)]; t.zone = 'residential'; t.level = 2; t.res = 8; }
  const d0 = computeDemand(w, 1, () => true);
  for (let k = 0; k < 2; k++) { const t = w.tiles[idx(5 + k, 9)]; t.zone = 'commercial'; t.kind = 4; t.level = 2; t.jobs = 10; }
  const d1 = computeDemand(w, 1, () => true);
  check('office jobs lower both commercial and industrial demand', d1.commercial.value < d0.commercial.value && d1.industrial.value < d0.industrial.value, { c: [d0.commercial.value, d1.commercial.value], i: [d0.industrial.value, d1.industrial.value] });
}

// ---------------------------------------------------------------- large water tower tier
import { WATER_OUTPUT, PUMP_STATION_OUTPUT, BIG_TOWER_OUTPUT } from '../src/sim/rules';
import { BUILD_COST } from '../src/sim/economy';
{
  check('large tower is 4× the basic tower and below the pump station', BIG_TOWER_OUTPUT === 4 * WATER_OUTPUT && BIG_TOWER_OUTPUT < PUMP_STATION_OUTPUT);
  check('large tower locked < 5,000 people', !isUnlocked('bigWaterTower', 0, 4999) && isUnlocked('bigWaterTower', 0, 5000));
  check('large tower costs $12k, between tower and pump station', BUILD_COST.bigWaterTower === 12000 && BUILD_COST.waterTower < 12000 && BUILD_COST.pumpStation >= 12000, [BUILD_COST.waterTower, BUILD_COST.pumpStation]);
  const w = fresh().world; const t = w.tiles[idx(10, 10)];
  t.structure = 'waterTower'; t.kind = 1;
  check('kind-1 water tower outputs BIG_TOWER_OUTPUT', output(t, 'water', 1) === BIG_TOWER_OUTPUT);
  t.kind = 0; check('basic tower still WATER_OUTPUT', output(t, 'water', 1) === WATER_OUTPUT);
  t.kind = 1; const w2 = (saveWorld(w), loadWorld()!); check('large tower survives save/load', w2.tiles[idx(10, 10)].kind === 1 && w2.tiles[idx(10, 10)].structure === 'waterTower');
}

// ---------------------------------------------------------------- demand-driven densification
import { DENSIFY_MAX } from '../src/sim/redevelop';
import { ZoneCode as ZC2 } from '../src/sim/cells';
{
  const s = town({ seed: 61 }); run(s, 900);
  const homes = () => [...s.world.lots.buildings.values()].filter((b) => TPL[b.tpl].zone === 'residential' && b.level > 0 && TPL[b.tpl].capacity[0] > 0);
  const before = homes().length;
  const hot = (v: number, months: number) => { for (let m = 0; m < months; m++) { s.demand.residential.value = v; s.redevelop.month(s); } };
  // Locked: below 1,000 people (tier 0) nothing densifies even at max demand.
  s.world.peakPop = 500; s.world.tier = 0; hot(1, 3);
  check('densify respects the medium unlock (< 1,000 people: none)', s.redevelop.stats.densified === 0, { before });
  // Unlocked, demand 0.55 for one month only: not sustained yet.
  s.world.peakPop = 1500; s.redevelop.hotMonths = 0; hot(0.55, 1);
  check('one hot month is not "sustained"', s.redevelop.stats.densified === 0);
  hot(0.55, 1); const low = s.redevelop.stats.densified;
  check('sustained demand 0.55 densifies 1 lot/month', low === 1, low);
  hot(0.95, 1); const high = s.redevelop.stats.densified - low;
  check('frequency scales with demand (0.95 → more per month)', high > 1 && high <= DENSIFY_MAX, high);
  const d = [...s.world.lots.buildings.values()].filter((b) => b.densified);
  check('densified sites are medium-density construction sites (crews build them)', d.length === low + high && d.every((b) => TPL[b.tpl].density === 1 && b.construct > 0 && b.redev), d.map((b) => [b.tpl, b.densified, b.construct]));
  const own = d[0]; let med = 0;
  for (let cz = own.z0; cz < own.z1; cz++) for (let cx = own.x0; cx < own.x1; cx++) if (s.world.cells.zone[cz * 256 + cx] === ZC2.ResMed) med++;
  check('zoning cells upgraded to medium under the new building', med > 0, med);
  check('player notified', s.events.some((e) => e.includes('Densifying')));
  const n0 = s.redevelop.stats.densified; s.demand.residential.value = 0.3; s.redevelop.month(s);
  check('demand ≤ 0.5 stops densification', s.redevelop.stats.densified === n0);
  const w2 = (saveWorld(s.world), loadWorld()!);
  check('densified tag survives save/load', [...w2.lots.buildings.values()].some((b) => b.densified === own.densified));
}

// ---------------------------------------------------------------- stage B: industry revamp + growth
import { truckBody } from '../src/sim/truckBodies';
import { IND_MERGE_RATE } from '../src/sim/growth';
import { IND_REDEV_MONTHS } from '../src/sim/redevelop';
import { isBigCoal } from '../src/sim/networks';
import { skinForColor, Skin } from '../src/render/textures';
import * as THREE from 'three';
{
  const ids = ['warehouse', 'chemical_plant', 'steel_mill', 'textile_mill', 'bottling_plant', 'assembly_plant'];
  check('six new industry types (kind 0 industrial)', ids.every((id) => TPL[id]?.zone === 'industrial' && TPL[id].kind === 0));
  check('industry reaches level 5 with bigger footprints and more workers', TPL.factory.maxLevel === 5 && TPL.steel_mill.maxLevel === 5 && TPL.steel_mill.w * TPL.steel_mill.d > TPL.factory.w * TPL.factory.d && TPL.assembly_plant.capacity[4] > TPL.factory.capacity[2]);
  check('every template capacity/model array matches its maxLevel', Object.values(TPL).every((t) => t.capacity.length === t.maxLevel && t.model.level.length === t.maxLevel), Object.values(TPL).filter((t) => t.capacity.length !== t.maxLevel).map((t) => t.id));
  check('L5 industry can park its workforce', ids.concat('factory').every((id) => { const t = TPL[id]; return parkingRequiredOf(t, t.maxLevel) <= t.rects.reduce((a, r) => a + (r.role === 2 ? r.w * r.d : 0), 0) + t.garage; }));
  check('industry merges/redevelops ~1.5× more often', IND_MERGE_RATE === 1.5 && IND_REDEV_MONTHS === 2);
  check('tankers for oil/fuel/plastics, dump trucks for stone/coal, boxes otherwise', truckBody('fuel: oil') === 'tanker' && truckBody('delivery: plastics to Electronics plant') === 'tanker' && truckBody('export: stone') === 'dump' && truckBody('fuel: imported coal') === 'dump' && truckBody('delivery: goods') === 'box' && truckBody('garbage: collecting') === 'box');
  check('texture skins by colour (brick / hazard / metal / roof)', skinForColor(new THREE.Color(0x9a4a35)) === Skin.Brick && skinForColor(new THREE.Color(0xf2c230)) === Skin.Hazard && skinForColor(new THREE.Color(0x8f989f)) === Skin.Metal && skinForColor(new THREE.Color(0x4b535b)) === Skin.Roof);
  // 2×2 coal via the 4-tile tool; single-tile keeps the legacy 1×1.
  const s = fresh(); s.apply('powerPlant', [[20, 20], [21, 20], [20, 21], [21, 21]]); s.apply('powerPlant', [[30, 30]]);
  const w = s.world;
  check('2×2 coal plant: anchor + 3 parts, output on the anchor only', isBigCoal(w.tiles, idx(20, 20)) && w.at(21, 21).part === idx(20, 20) + 1 && output(w.tiles[idx(20, 20)], 'power', 1) === 5000 && output(w.tiles[idx(21, 21)], 'power', 1) === 0);
  check('single-tile coal stays a legacy 1×1 plant', w.at(30, 30).structure === 'powerPlant' && !isBigCoal(w.tiles, idx(30, 30)) && w.at(31, 30).structure !== 'powerPlant');
  s.apply('bulldoze', [[21, 21]]);
  check('bulldozing one tile removes the whole 2×2 coal plant', [[20, 20], [21, 20], [20, 21], [21, 21]].every(([x, z]) => w.at(x, z).structure !== 'powerPlant'));
  // Migration: an old 1×1 coal plant with free room expands; a boxed-in one stays 1×1.
  const m = fresh(); m.world.at(10, 10).structure = 'powerPlant'; m.world.at(40, 40).structure = 'powerPlant'; m.world.at(41, 40).structure = 'park';
  saveWorld(m.world);
  const raw = JSON.parse(localStorage.getItem('lowpoly-city-save')!); raw.version = 7; localStorage.setItem('lowpoly-city-save', JSON.stringify(raw));
  const mw = loadWorld()!;
  check('save v7 → v8: 1×1 coal with room becomes 2×2, boxed-in stays 1×1', isBigCoal(mw.tiles, idx(10, 10)) && !isBigCoal(mw.tiles, idx(40, 40)) && mw.at(40, 40).structure === 'powerPlant');
}

// ---------------------------------------------------------------- stage C: shipping depot
import { depotOf, DEPOT_BONUS } from '../src/sim/goods';
{
  check('shipping depot locked < 2,000 people', !isUnlocked('shippingDepot', 0, 1999) && isUnlocked('shippingDepot', 0, 2000));
  const run2 = (withDepot: boolean) => {
    const s = town({ seed: 71 });
    s.world.peakPop = 3000;
    s.zoneOpt = { density: 1, depth: 3 }; s.apply('industrial', rect(11, 34, 29, 34));
    if (withDepot) s.apply('shippingDepot', [[24, 38], [25, 38], [24, 39], [25, 39]]);
    run(s, 2400);
    const st = s.shipping.stats;
    return { s, depotExports: st.depotExports, depotImports: st.depotImports, exported: st.exported, trade: Math.round(s.world.ledger.trade.exports), svc: s.world.at(24, 38).structure };
  };
  const a = run2(false), b = run2(true);
  check('depot built as a 2×2 service', b.svc === 'service' && b.s.world.at(25, 39).part === idx(24, 38) + 1, b.svc);
  check('industry in the catchment ships via the depot', b.depotExports > 0, { a: { e: a.exported, t: a.trade }, b: { e: b.exported, de: b.depotExports, di: b.depotImports, t: b.trade } });
  check('no depot → no depot shipping', a.depotExports === 0 && a.depotImports === 0);
  check('depot loads counted per depot (Inspect)', (b.s.shipping.depotLoads.get(idx(24, 38)) ?? 0) === b.depotExports + b.depotImports);
  check('catchment: near tiles in, far tiles out', depotOf([idx(30, 36)], idx(40, 40)) === idx(30, 36) && depotOf([idx(30, 36)], idx(5, 5)) === -1 && DEPOT_BONUS > 0);
}

// ---------------------------------------------------------------- V1.6: 2×2 oil plant + elementary school, output bumps, crime start
import { isBigOil } from '../src/sim/networks';
import { migrateOil, migrateLandfills as migrateGrown } from '../src/sim/save';
import { POWER_OUTPUT, PLANT_OIL } from '../src/sim/rules';
import { POLICE_UNLOCK_POP } from '../src/sim/services';
{
  check('coal plant powers 5,000 and a wind turbine up to 1,000', POWER_OUTPUT.powerPlant === 5000 && POWER_OUTPUT.windTurbine === 1000);
  check('crime starts exactly when police unlock', CRIME_START === POLICE_UNLOCK_POP && isUnlocked('policeStation', 0, CRIME_START));
  const s = fresh();
  s.apply('oilPlant', [[20, 20], [21, 20], [20, 21], [21, 21]]); s.apply('oilPlant', [[30, 30]]);
  const w = s.world;
  check('2×2 oil plant: anchor + 3 parts, 8,000 on the anchor only', isBigOil(w.tiles, idx(20, 20)) && w.at(21, 21).part === idx(20, 20) + 1 && output(w.tiles[idx(20, 20)], 'power', 1) === 8000 && output(w.tiles[idx(21, 21)], 'power', 1) === 0);
  check('single-tile oil stays a legacy 1×1 plant', w.at(30, 30).kind === PLANT_OIL && !isBigOil(w.tiles, idx(30, 30)) && w.at(31, 30).structure !== 'powerPlant');
  s.apply('bulldoze', [[21, 21]]);
  check('bulldozing one tile removes the whole 2×2 oil plant', [[20, 20], [21, 20], [20, 21], [21, 21]].every(([x, z]) => w.at(x, z).structure !== 'powerPlant'));
  const m = fresh(); m.world.at(10, 10).structure = 'powerPlant'; m.world.at(10, 10).kind = PLANT_OIL;
  check('a legacy 1×1 oil plant grows to 2×2 (and only once)', migrateOil(m.world) === 1 && isBigOil(m.world.tiles, idx(10, 10)) && migrateOil(m.world) === 0);
  const e = fresh(); e.apply('elementarySchool', [[20, 17], [21, 17], [20, 18], [21, 18]]);
  check('elementary school is 2×2', serviceSize(e.world.tiles, idx(20, 17)) === 2 && e.world.at(21, 18).part === idx(20, 17) + 1);
  const o = fresh(); const oa = idx(12, 12); o.world.tiles[oa].structure = 'service'; o.world.tiles[oa].kind = Svc.Elementary;
  check('a legacy 1×1 school grows to 2×2', serviceSize(o.world.tiles, oa) === 1 && migrateGrown(o.world) === 1 && serviceSize(o.world.tiles, oa) === 2);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
