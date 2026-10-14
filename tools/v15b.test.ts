/**
 * tools/v15b.test.ts — Version 1.5b headless checks (one section per stage).
 * Run: npm run test:v15b. Prints PASS/FAIL; exits 1 on failure.
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

import { SERVICE_DEFS, Svc } from '../src/sim/services';
import { G_WARN, GARBAGE_START } from '../src/sim/garbage';
import { isUnlocked } from '../src/sim/progression';

// ---------------------------------------------------------------- stage E: garbage
{
  check('garbage dump locked < 1,000 people, unlocked at 1,000', !isUnlocked('garbageDump', 0, 999) && isUnlocked('garbageDump', 0, 1000));
  const res: Record<string, any> = {};
  for (const dump of [false, true]) {
    const s = town({ seed: 21 });
    s.world.peakPop = 1000;
    if (dump) s.apply('garbageDump', [[31, 17]]);
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

// ---------------------------------------------------------------- stage F: police + health care
import { CRIME_START } from '../src/sim/safety';
{
  check('police locked < 1,000, clinic/hospital locked < 2,500', !isUnlocked('policeStation', 0, 999) && isUnlocked('policeStation', 0, 1000) && !isUnlocked('clinic', 0, 2499) && isUnlocked('hospital', 0, 2500));
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
  check('elementary unlocked from the start; high school 1,000; college 2,500', isUnlocked('elementarySchool', 0, 0) && !isUnlocked('highSchool', 0, 999) && isUnlocked('highSchool', 0, 1000) && !isUnlocked('college', 0, 2499) && isUnlocked('college', 0, 2500));
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
  const sc = town({ seed: 32 }); sc.apply('elementarySchool', [[31, 17]]); run(sc, 3);
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
  s.apply('elementarySchool', [[20, 17]]);
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

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
