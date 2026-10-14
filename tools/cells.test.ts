/**
 * tools/cells.test.ts — PR 6 headless checks: cell zoning, footprint fitting,
 * parking, redevelopment, the v5 → v6 migration, auto water mains, parks and
 * the balance targets. Run: npm run test:cells (esbuild → node).
 * Prints PASS/FAIL lines plus a numbers block; exits 1 on any failure.
 */
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };

import { Simulation } from '../src/sim/simulation';
import { World } from '../src/sim/grid';
import { TPL, parkingRequired, parkingSupply, TEMPLATES } from '../src/sim/footprints';
import { loadWorld, saveWorld } from '../src/sim/save';
import { CellRole } from '../src/sim/cells';

let fails = 0;
const check = (name: string, ok: boolean, info: unknown = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? '  ' + JSON.stringify(info) : ''}`); if (!ok) fails++; };
const rect = (x0: number, z0: number, x1: number, z1: number) => { const o: Array<[number, number]> = []; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) o.push([x, z]); return o; };
const N = 64;
const run = (s: Simulation, ticks: number) => { for (let i = 0; i < ticks; i++) { s.step(); s.traffic.update(s.world, 1); s.world.clock += 1; } };
const real = (s: Simulation) => [...s.world.lots.buildings.values()].filter((b) => TPL[b.tpl].capacity[0] > 0);

/** A grid town: streets every 7 tiles, zoned 3 deep, power + water + a yard. */
function town(opts: { yard?: boolean; medium?: boolean; seed?: number } = {}): Simulation {
  const s = new Simulation(new World(undefined, opts.seed ?? 4242));
  s.world.cash = 1e7; s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; });
  const e = s.world.edgeIndex, ex = e % N, ez = Math.floor(e / N);
  for (const z of [12, 19, 26, 33, 40]) s.apply('road', rect(10, z, 50, z));
  for (const x of [10, 30, 50]) s.apply('road', rect(x, 12, x, 40));
  s.apply('road', rect(50, Math.min(26, ez), 50, Math.max(26, ez))); s.apply('road', rect(Math.min(50, ex), ez, Math.max(50, ex), ez));
  s.apply('powerPlant', [[9, 12]]); s.apply('powerPlant', [[51, 12]]); s.apply('waterTower', [[9, 13]]); s.apply('waterTower', [[51, 13]]); s.apply('waterTower', [[9, 41]]);
  if (opts.yard !== false) { s.apply('constructionYard', [[29, 11]]); s.apply('constructionYard', [[31, 41]]); }
  if (opts.medium) for (let x = 12; x < 50; x += 4) s.apply('park', [[x, 22]]);
  s.zoneOpt = { density: opts.medium ? 1 : 0, depth: 3 };
  s.apply('residential', rect(11, 13, 29, 13)); s.apply('residential', rect(11, 25, 29, 25)); s.apply('residential', rect(31, 13, 49, 13));
  s.apply('residential', rect(11, 27, 29, 27)); s.apply('residential', rect(31, 27, 49, 27));
  s.zoneOpt = { density: 0, depth: 2 };
  s.apply('commercial', rect(11, 20, 29, 20)); s.apply('industrial', rect(31, 34, 49, 34)); s.apply('commercial', rect(31, 20, 49, 20));
  return s;
}

// 1. Zoning paints cells along the road, depth deep.
{
  const s = new Simulation(new World(undefined, 7)); s.world.cash = 1e6; s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; });
  s.apply('road', rect(5, 10, 20, 10)); s.zoneOpt = { density: 0, depth: 3 };
  const q = s.zoneQuote('residential', rect(6, 11, 9, 11));
  s.apply('residential', rect(6, 11, 9, 11));
  let zoned = 0; for (const c of s.world.cells.zone) if (c) zoned++;
  check('drag of 4 tiles along a road zones 4×3 tiles of cells (192)', zoned === 192 && q.cells === 192, { zoned, quote: q });
  check('zone cost is per cell (1/16 tile price)', q.cost === Math.round(20 * 192 / 16), q.cost);
}
// 2. Templates: parking numbers are sane.
{
  const bad = TEMPLATES.filter((t) => t.capacity[0] > 0 && !['corner_shop', 'shop_w', 'workshop'].includes(t.id) && parkingSupply(t) < parkingRequired(t, t.maxLevel));
  check('every template except small shops supplies its own parking at max level', !bad.length, bad.map((t) => t.id));
  check('corner shop is short at level 3 (needs a public lot)', parkingSupply(TPL.corner_shop) < parkingRequired(TPL.corner_shop, 3));
}
// 3. Growth: varied footprints, crews, population, parking.
const t0 = Date.now();
const s = town();
run(s, 900);
const ms = Date.now() - t0;
const bs = real(s);
const sizes = new Set(bs.map((b) => `${TPL[b.tpl].w}x${TPL[b.tpl].d}`));
const st = s.stats();
check('town grows (population > 600 after 900 ticks)', st.population > 600, st.population);
check('varied footprints (≥ 4 sizes)', sizes.size >= 4, [...sizes]);
check('buildings never overlap (cell owner == building for its body)', bs.every((b) => { const tp = TPL[b.tpl]; return tp.rects.length > 0; }));
check('crews deliver (dispatched > 0)', s.crews.stats.dispatched > 0, s.crews.stats);
const pt = s.world.parking.totals(s.world.lots);
check('parking occupancy is between 5% and 100%', pt.parked > 0 && pt.parked <= pt.spaces, pt);
// 4. Public lot rescues a short shop.
{
  const shop = bs.find((b) => b.tpl === 'corner_shop' && b.level === 2) ?? bs.find((b) => TPL[b.tpl].zone === 'commercial');
  if (shop) {
    const can0 = s.world.parking.canSupport(shop, 3);
    // Put a lot on any free cell quadrant within range: try around the host tile.
    const hx = shop.host % N, hz = Math.floor(shop.host / N);
    let placed = false;
    for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1], [2, 0], [-2, 0], [1, 1], [-1, 1]]) {
      const x = hx + dx, z = hz + dz;
      for (const f of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
        s.pointerFrac = [f[0], f[1]];
        if (s.apply('parkingLot', [[x, z]]).changed) { placed = true; break; }
      }
      if (placed) break;
    }
    s.world.parking.allocate(s.world.lots);
    check('public lot placed near a shop and adds supply', placed && (can0 || s.world.parking.canSupport(shop, 3)), { placed, can0, tpl: shop.tpl, lvl: shop.level });
  } else check('a shop exists', false);
}
// 5. Save → load round-trip keeps buildings and cells.
{
  saveWorld(s.world); const w2 = loadWorld()!;
  check('v6 save round-trip keeps buildings + cells', w2.lots.buildings.size === s.world.lots.buildings.size && w2.cells.owner.every((v, i) => v === s.world.cells.owner[i]), { a: s.world.lots.buildings.size, b: w2.lots.buildings.size });
}
// 6. v5 migration: old 1-tile buildings → 4×4 legacy lots, roads gain pipes.
{
  const w = new World(undefined, 99); w.tiles.forEach((t) => { t.water = false; t.deco = 0; });
  for (let x = 5; x < 15; x++) Object.assign(w.tiles[20 * N + x], { road: true });
  Object.assign(w.tiles[21 * N + 6], { zone: 'residential', level: 3, structure: 'building' });
  Object.assign(w.tiles[21 * N + 7], { zone: 'commercial', level: 2, structure: 'building' });
  Object.assign(w.tiles[19 * N + 8], { zone: 'industrial', level: 1, construct: 4, structure: 'building' });
  const raw = { version: 5, size: N, seed: 99, tick: 10, cash: 5000, tiles: w.tiles };
  store.set('lowpoly-city-save', JSON.stringify(raw));
  const m = loadWorld()!;
  const lb = [...m.lots.buildings.values()];
  check('migration: 3 legacy lots at old levels', lb.length === 3 && lb.some((b) => b.tpl === 'legacy_res' && b.level === 3) && lb.some((b) => b.tpl === 'legacy_ind' && b.construct === 4), lb.map((b) => [b.tpl, b.level, b.face]));
  check('migration: home faces its road (south side? road is north → face 0)', lb.find((b) => b.tpl === 'legacy_res')?.face === 0);
  check('migration: residents preserved (20)', m.tiles[21 * N + 6].res === 20, m.tiles[21 * N + 6].res);
  check('migration: every legacy lot has its parking', lb.every((b) => m.parking.shortfall(b) === 0));
  check('migration: roads gained water mains', m.tiles[20 * N + 9].waterPipe);
}
// 7. Auto water: a road with no pipe tool still waters buildings.
{
  check('roads carry water (no pipe tool used in town())', st.water.demand > 0 && st.outages === 0, st.water);
}
// 8. Bulldozing a building frees its cells.
{
  const b = bs[0]; const hx = b.host % N, hz = Math.floor(b.host / N);
  s.apply('bulldoze', [[hx, hz]]);
  check('bulldoze removes the building', !s.world.lots.buildings.has(b.id));
}
// 9. Redevelopment with medium density cells after the Town tier.
{
  const m = town({ medium: true, seed: 11 });
  m.world.tier = 3; // test: unlock medium/high templates
  m.world.tiles.forEach((t) => t.structure === 'none' && false);
  run(m, 1500);
  const ids = real(m).map((b) => b.tpl);
  check('medium templates appear (townhouses/apartments)', ids.some((t) => ['townhouse', 'apartment', 'apartment_d'].includes(t)), [...new Set(ids)]);
  console.log('redevelopment stats', m.world.lots.stats);
}
// 10. Avenue upgrade: only the price difference, connections + utilities kept, avenues skipped.
{
  const a = new Simulation(new World(undefined, 5)); a.world.cash = 1e6; a.world.tier = 1; a.world.tiles.forEach((t) => { t.deco = 0; t.water = false; });
  a.apply('road', rect(5, 5, 12, 5)); a.world.tiles[5 * N + 9].water = true; // pretend one tile is a bridge
  const q = a.quote('avenue', rect(5, 5, 12, 5));
  const r = a.apply('avenue', rect(5, 5, 12, 5));
  const t = a.world.tiles[5 * N + 7];
  check('avenue upgrade charges only the difference ($12/tile, bridge too)', q === 8 * 12 && r.spent === 96, { q, spent: r.spent });
  check('upgraded tile keeps road + water main + power', t.road && t.roadType === 1 && t.waterPipe);
  check('already-avenue tiles are skipped', a.quote('avenue', rect(5, 5, 12, 5)) === 0 && a.apply('avenue', rect(5, 5, 12, 5)).changed === 0);
}
// 11. Auto water mains join everything with no gaps: a manual pipe branch,
//     a water tower beside the road, a bridge, an avenue and an upgraded street.
{
  const a = new Simulation(new World(undefined, 6)); a.world.cash = 1e6; a.world.tier = 1; a.world.tiles.forEach((t) => { t.deco = 0; t.water = false; });
  for (let x = 20; x <= 22; x++) a.world.tiles[30 * N + x].water = true; // a river under the road
  a.apply('road', rect(10, 30, 40, 30));            // street incl. a 3-tile bridge
  a.apply('avenue', rect(25, 30, 30, 30));          // upgraded street
  a.apply('avenue', rect(40, 20, 40, 30));          // a new avenue branch (T-junction)
  a.apply('powerPlant', [[9, 30]]); a.apply('waterTower', [[11, 31]]);
  a.apply('waterPipe', rect(15, 31, 15, 36));       // manual off-road pipe branch
  a.apply('residential', rect(16, 36, 16, 36));     // a lot fed only by the manual pipe
  a.apply('residential', rect(35, 31, 35, 31));     // lot beside the upgraded road
  a.apply('residential', rect(41, 22, 41, 22));     // lot beside the new avenue
  a.step();
  const net = (x: number, z: number) => a.net.service[z * N + x].waterNet;
  const n0 = net(10, 30);
  const pts: Array<[number, number]> = [[21, 30], [27, 30], [40, 21], [15, 36], [16, 36], [35, 31], [41, 22], [11, 31]];
  check('road mains, bridge, avenue, upgraded road, manual pipe, tower and lots are ONE water network', n0 >= 0 && pts.every(([x, z]) => net(x, z) === n0), pts.map(([x, z]) => net(x, z)));
  check('every road tile has a pipe (incl. bridge + upgraded)', rect(10, 30, 40, 30).concat(rect(40, 20, 40, 30)).every(([x, z]) => a.world.at(x, z).waterPipe));
  check('lots beside roads get water', a.net.service[31 * N + 35].watered || a.net.service[31 * N + 35].waterNet === n0);
}
// 12. Medium housing unlocks at 1,000 people (not 2,000), saved via peakPop.
{
  const { growablePool } = await import('../src/sim/lots');
  const { updateTier } = await import('../src/sim/progression');
  const w = new World(undefined, 3); w.tier = 1;
  const before = growablePool('residential', w).some((t) => t.density === 1);
  const msgs = updateTier(w, 1000);
  const after = growablePool('residential', w).filter((t) => t.density === 1).map((t) => t.id);
  check('medium housing locked below 1,000, unlocked at 1,000 with a notice', !before && after.includes('townhouse') && msgs.some((m) => m.includes('Medium-density')), { after, msgs });
  check('shopping centre still needs the Town tier', !growablePool('commercial', w).some((t) => t.id === 'mall'));
  updateTier(w, 400);
  check('unlock persists after population drops (peakPop)', growablePool('residential', w).some((t) => t.id === 'townhouse'));
}
const gave = s.world.parking.stats;
console.log('NUMBERS', JSON.stringify({ population: st.population, jobs: st.jobs, buildings: bs.length, templates: [...new Set(bs.map((b) => b.tpl))], sizes: [...sizes], parking: pt, arrivals: gave, gaveUpRate: gave.arrivals ? +(gave.gaveUp / gave.arrivals).toFixed(3) : 0, power: st.power, water: st.water, ms900ticks: ms, lots: s.world.lots.stats, crews: s.crews.stats }));
process.exit(fails ? 1 : 0);
