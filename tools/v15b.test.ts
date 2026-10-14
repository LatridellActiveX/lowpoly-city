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
    run(s, 900);
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
  check('without a dump, garbage piles up at buildings (warnings)', res.none.piles > 10, res);
  check('dump trucks drive out and collect', res.dump.trips > 5 && res.dump.collected > 100, res.dump);
  check('collection keeps garbage low and land value higher', res.dump.avg < res.none.avg * 0.6 && res.dump.lv > res.none.lv, res);
  const s2 = town({ seed: 22 });
  run(s2, 50);
  check(`no garbage before ${GARBAGE_START} people`, s2.world.tiles.every((t) => t.garbage === 0));
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
