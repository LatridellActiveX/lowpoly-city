/**
 * tools/regions.test.ts — V1.6 A6: big map, regions, save v9.
 */
import { setGridSize } from '../src/sim/mapsize';
import { GRID_SIZE } from '../src/sim/types';
import { b64 } from './b64shim';
import { REGION, regionOf, startRegion, allRegions, REGION_POP } from '../src/sim/regions';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { buildTown, tick, Simulation, World, rect } from './bench/town';

let fail = 0;
const ok = (c: boolean, m: string, extra?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); if (!c) fail++; };

// ---- new 192 map: start region, highway, unowned = inactive ----
setGridSize(192);
{
  const s = new Simulation(new World(undefined, 31337));
  const w = s.world;
  ok(w.regionsOwned === 1 << 4 && startRegion() === 4, 'new 192 map owns only the centre region (4)');
  // Highway: walk the road from the edge tile; it must reach region 4.
  const e = w.edgeIndex, seen = new Set([e]), q = [e];
  let reached = false;
  while (q.length) { const i = q.pop()!; if (regionOf(i % 192, Math.floor(i / 192)) === 4) { reached = true; break; }
    for (const j of [i + 1, i - 1, i + 192, i - 192]) if (j >= 0 && j < w.tiles.length && w.tiles[j].road && !seen.has(j)) { seen.add(j); q.push(j); } }
  ok(e >= 0 && reached, 'highway runs from the map edge into the start region');
  s.world.cash = 1e6;
  const r0 = s.apply('residential', rect(2, 2, 6, 2));
  ok(r0.changed === 0 && r0.region === true, 'zoning in an unowned region is refused (region flag)');
  const r1 = s.apply('road', rect(60, 100, 70, 100)); // crosses from region 3 into region 4
  ok(r1.changed > 0 && r1.region === true && !w.tiles[100 * 192 + 60].road && w.tiles[100 * 192 + 66].road, 'a road across the border is built only on owned tiles');
  for (let i = 0; i < 5; i++) s.step();
  const activeOutside = w.chunks.active.filter((c) => { const cx = (c % 12) * 16, cz = Math.floor(c / 12) * 16; return regionOf(cx, cz) !== 4; });
  ok(activeOutside.every((c) => { let road = false; for (let z = Math.floor(c / 12) * 16; z < Math.floor(c / 12) * 16 + 16; z++) for (let x = (c % 12) * 16; x < (c % 12) * 16 + 16; x++) if (w.tiles[z * 192 + x].road) road = true; return road; }), 'chunks outside owned land are active only where the highway runs', activeOutside.length);
  // ---- buying ----
  w.peakPop = 0; w.cash = 1e6;
  ok(s.buyRegion(0) === 'Must border a region you own', 'corner region cannot be bought (no shared border)');
  ok(/Needs/.test(s.buyRegion(1) ?? ''), 'neighbour needs the population threshold');
  w.peakPop = REGION_POP[1]; const cash0 = w.cash;
  ok(s.buyRegion(1) === null && (w.regionsOwned & 2) !== 0 && w.cash === cash0 - 15000, 'neighbour bought at threshold for $15,000');
  ok(s.buyRegion(0) !== null && /Needs/.test(s.buyRegion(0)!), 'second purchase needs the next threshold', s.buyRegion(0));
  const r2 = s.apply('residential', rect(70, 2, 72, 2));
  ok(r2.changed > 0 && !r2.region, 'bought region can be zoned');
}

// ---- save v9 round trip on a grown 192 city ----
{
  const s = new Simulation(new World(undefined, 4242));
  s.world.tiles.forEach((t) => { t.water = false; });
  buildTown(s, 64, 64);
  for (let i = 0; i < 800; i++) tick(s);
  s.world.regionsOwned = (1 << 4) | (1 << 5);
  const text = serializeWorld(s.world);
  ok(text.length < 1_500_000, `v9 save of a 192 city is compact (${(text.length / 1024).toFixed(0)} KB)`);
  const w2 = deserializeWorld(text)!;
  ok(!!w2 && GRID_SIZE === 192 && w2.tiles.length === 192 * 192, 'v9 loads as a 192 map');
  // res/jobs/units are rebuilt from the buildings on load (lots.aggregate: movers arrive, crew linger ticks down), exactly as for v8.
  const keys = Object.keys(s.world.tiles[0]).filter((k) => !['movingIn', 'res', 'jobs', 'units', 'crewLinger', 'crew'].includes(k));
  const bad = s.world.tiles.findIndex((t, i) => keys.some((k) => (t as any)[k] !== (w2.tiles[i] as any)[k]));
  ok(bad < 0, 'every tile field survives', bad < 0 ? bad : keys.filter((k) => (s.world.tiles[bad] as any)[k] !== (w2.tiles[bad] as any)[k]).map((k) => [k, (s.world.tiles[bad] as any)[k], (w2.tiles[bad] as any)[k]]));
  ok(s.world.cells.zone.every((v, i) => w2.cells.zone[i] === v) && s.world.cells.owner.every((v, i) => w2.cells.owner[i] === v) && s.world.cells.role.every((v, i) => w2.cells.role[i] === v), 'cell layer survives');
  ok(w2.regionsOwned === s.world.regionsOwned && w2.lots.buildings.size === s.world.lots.buildings.size, 'regions + buildings survive');
  const s2 = new Simulation(w2); for (let i = 0; i < 50; i++) s2.step();
  ok(s2.stats().population > 0, 'reloaded city keeps running', s2.stats().population);
}

// ---- v8 → v9 migration ----
setGridSize(64);
{
  const s = new Simulation(new World(undefined, 4242));
  s.world.tiles.forEach((t) => { t.water = false; });
  buildTown(s, 0, 0);
  for (let i = 0; i < 600; i++) tick(s);
  const w = s.world;
  // A v8 save exactly as V1.5b wrote it (tiles array, base64 cells).
  const v8 = JSON.stringify({ version: 8, size: 64, tick: w.tick, seed: w.seed, cash: w.cash, taxRates: w.taxRates, propertyRate: w.propertyRate, ledger: w.ledger, lastLedger: w.lastLedger, wind: w.wind, windDrift: w.windDrift, windDir: w.windDir, windDirVel: w.windDirVel, clock: w.clock, tier: w.tier, peakPop: w.peakPop, tiles: w.tiles,
    cells: { zone: b64(w.cells.zone), role: b64(w.cells.role), owner: b64(new Uint8Array(w.cells.owner.buffer)) },
    buildings: [...w.lots.buildings.values()], nextBuilding: w.lots.nextId, lots: [...w.parking.lots.values()], nextLot: w.parking.nextId });
  setGridSize(192); // a different size is active when the old save loads
  const m = deserializeWorld(v8)!;
  ok(!!m && GRID_SIZE === 64 && m.regionsOwned === allRegions(64), 'v8 save loads as a 64 map with its one region owned');
  ok(m.tiles.every((t, i) => t.level === w.tiles[i].level && t.zone === w.tiles[i].zone && t.road === w.tiles[i].road), 'v8 tiles intact');
  const again = deserializeWorld(serializeWorld(m))!;
  ok(again.tiles.every((t, i) => t.level === m.tiles[i].level && t.res === m.tiles[i].res) && again.lots.buildings.size === m.lots.buildings.size, 'migrated save re-saves as v9 and reloads identically');
  ok(JSON.parse(serializeWorld(m)).version === 9, 'new saves are v9');
}
void REGION;
setGridSize(64);
if (fail) { console.log(`${fail} failures`); process.exit(1); } console.log('regions: all ok');
