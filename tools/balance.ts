/**
 * tools/balance.ts — V1.5b REBALANCE probe (not a pass/fail suite).
 * Grows the standard grid town with every service and prints a per-period
 * table: population, cash change, R/C/I demand, jobs vs workers, avg
 * building health, garbage/crime averages and trade. Used to tune the
 * constants in the V1.5b rebalance pass. Run: npm run balance
 */
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
import { Simulation } from '../src/sim/simulation';
import { World } from '../src/sim/grid';

const rect = (x0: number, z0: number, x1: number, z1: number) => { const o: Array<[number, number]> = []; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) o.push([x, z]); return o; };
const s = new Simulation(new World(undefined, 4242));
s.world.cash = 60000; s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; });
const N = 64, e = s.world.edgeIndex, ex = e % N, ez = Math.floor(e / N);
for (const z of [12, 19, 26, 33, 40]) s.apply('road', rect(10, z, 50, z));
for (const x of [10, 30, 50]) s.apply('road', rect(x, 12, x, 40));
s.apply('road', rect(50, Math.min(26, ez), 50, Math.max(26, ez))); s.apply('road', rect(Math.min(50, ex), ez, Math.max(50, ex), ez));
s.apply('powerPlant', [[9, 12]]); s.apply('powerPlant', [[51, 12]]); s.apply('waterTower', [[9, 13]]); s.apply('waterTower', [[51, 13]]); s.apply('waterTower', [[9, 41]]);
s.apply('constructionYard', [[29, 11]]); s.apply('constructionYard', [[31, 41]]);
s.zoneOpt = { density: 0, depth: 3 };
for (const z of [13, 27]) { s.apply('residential', rect(11, z, 29, z)); s.apply('residential', rect(31, z, 49, z)); }
s.zoneOpt = { density: 1, depth: 3 };
s.apply('commercial', rect(11, 20, 29, 20)); s.apply('commercial', rect(31, 20, 49, 20)); s.apply('commercial', rect(31, 25, 49, 25));
s.zoneOpt = { density: 0, depth: 2 }; s.apply('industrial', rect(31, 34, 49, 34)); s.apply('industrial', rect(11, 34, 29, 34));
s.apply('elementarySchool', [[20, 17], [21, 17], [20, 18], [21, 18]]);
const later: Array<[number, () => void]> = [
  [1000, () => { s.apply('garbageDump', [[31, 17], [32, 17], [31, 18], [32, 18]]); }], // V1.6: 2×2 landfill
  [2000, () => { s.apply('shippingDepot', [[24, 38], [25, 38], [24, 39], [25, 39]]); }],
  [2500, () => { s.apply('clinic', [[40, 30]]); s.apply('policeStation', [[40, 17]]); s.apply('highSchool', [[20, 30]]); s.apply('recyclingCenter', [[24, 17]]); }], // V1.6: police + high school + recycling unlock at 2,500
];
let lastCash = s.world.cash;
console.log('tick   pop   cash/1k-ticks   R      C      I     jobs  workers health garbage crime  exports');
for (let tk = 1; tk <= 8000; tk++) {
  s.step(); s.traffic.update(s.world, 1); s.world.clock += 1;
  for (const [pop, f] of later) if (s.world.peakPop >= pop && !(f as any).done) { (f as any).done = true; f(); }
  if (tk % 1000 === 0) {
    let jobs = 0, res = 0, g = 0, n = 0, h = 0, hn = 0;
    s.world.tiles.forEach((t) => { jobs += t.jobs; res += t.res; if (t.zone && t.level > 0) { g += t.garbage; n++; } });
    for (const b of s.world.lots.buildings.values()) if (b.health !== undefined) { h += b.health; hn++; }
    const cr = s.safety.crime.reduce((a, v) => a + v, 0) / Math.max(1, n);
    const d = s.demand;
    console.log([tk, s.stats().population, Math.round(s.world.cash - lastCash), d.residential.value.toFixed(2), d.commercial.value.toFixed(2), d.industrial.value.toFixed(2), jobs, res, (h / Math.max(1, hn)).toFixed(2), (g / Math.max(1, n)).toFixed(1), cr.toFixed(2), s.shipping.stats.exported].join('\t'));
    lastCash = s.world.cash;
  }
}
