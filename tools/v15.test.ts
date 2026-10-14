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
import { TPL } from '../src/sim/footprints';

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
  run(s, 900);
  const p = s.world.parking;
  let maxRatio = 0;
  for (const b of s.world.lots.buildings.values()) if (b.level > 0 && TPL[b.tpl].zone === "commercial") { const c = [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]; const r = p.localBalance(s.world.lots, c); maxRatio = Math.max(maxRatio, r.demand / Math.max(1, r.supply)); }
  // Fresh commercial frontage next to the busy shops: garages may claim it.
  s.zoneOpt = { density: 1, depth: 1 };
  s.apply('commercial', rect(11, 18, 29, 18));
  s.apply('commercial', rect(31, 18, 49, 18));
  run(s, 240);
  const grownN = [...p.lots.values()].filter((l) => l.grown).length;
  check('busy shops grow a multi-storey garage', grownN > 0, grownN);
  run(s, 300);
  check('garages earn fees', (s.world.ledger.trade.parking ?? 0) + (s.world.lastLedger?.trade.parking ?? 0) > 0);
  console.log('NUMBERS parking', JSON.stringify({ pop: s.stats().population, maxRatio: +maxRatio.toFixed(2), grown: grownN, fees: s.world.ledger.trade.parking ?? 0, totals: p.totals(s.world.lots) }));
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
