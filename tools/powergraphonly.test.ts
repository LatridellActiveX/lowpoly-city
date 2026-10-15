/**
 * tools/powergraphonly.test.ts — NEBULA: "NOT ENOUGH CAPACITY" WITH POWER TO SPARE.
 *
 * PARKER'S BUG
 * ------------
 * Seed "random", 64×64 dry land: a main road across the outside connection
 * (a T junction), a wind turbine and a water tower on one side, lots on
 * both. The lots beyond the junction showed the no-power icon and said
 * "power (outage: not enough capacity)", while the turbine read 16/645 and
 * both were on network #1.
 *
 * ROOT CAUSE (fixed in sim/networks.ts computeNetworks + sim/graphutil.ts)
 * ----------
 * In the TILE flood, roads carry power but only pipes carry water. So a lot
 * beside a road is tile-connected for POWER but reaches WATER only through
 * the road graph (graphutil.ts "graph-only" consumers). graphutil kept ONE
 * graph-only set for both utilities, and computeNetworks skipped BOTH flags
 * of every tile in it. After any topology rebuild (a building growing),
 * such a lot's power flag stayed at the fresh default `false` for good while
 * its powerNet was the turbine's network -> "not enough capacity".
 * The lists were also one tick stale (read before graphutil rebuilt them).
 *
 * WHAT THIS CHECKS (every tick, for several hundred ticks of growth):
 *   1. NO "CONNECTED BUT UNSERVED" TILE without a real outage: if a zoned
 *      tile has powerNet >= 0 and is not powered, that network must have
 *      outages (same for water). And status() never says "not enough
 *      capacity" for a network that isn't short.
 *   2. INCREMENTAL == FULL: wherever the from-scratch tile flood
 *      (computeNetworksFull) reaches a tile, the incremental solver agrees
 *      on power (water too where the full flood connects it).
 * SCENARIOS:
 *   a. Parker's own city (tools/fixtures/parker-power-graphonly.lpc, his
 *      debug code), loaded and stepped 400 ticks — this failed before.
 *   b. Fresh seed "random" city, T junction at the outside connection, power
 *      and water on the RIGHT (south) side, lots on the LEFT (north) + south.
 *   c. Same but power on the LEFT and lots on the right (Parker's layout).
 *   d. A 4-WAY junction at the outside connection (the outside road carried
 *      straight on past the main road), sources on one arm, lots on all.
 */
import { readFileSync } from 'node:fs';
import { rect, tick, Simulation, World } from './bench/town';
import { migrateToGraph } from '../src/roads/persist';
import { allRegions } from '../src/sim/regions';
import { setGridSize } from '../src/sim/mapsize';
import { GRID_SIZE } from '../src/sim/types';
import { decodeDebugCode } from '../src/sim/debugCode';
import { deserializeWorld } from '../src/sim/save';
import { computeNetworks, computeNetworksFull } from '../src/sim/networks';

let fail = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fail++; };

/** Step `n` ticks; check invariants 1 and 2 after EVERY tick. Returns counts for the report. */
function run(s: Simulation, n: number, tag: string): void {
  const w = s.world, N = GRID_SIZE;
  let bad = 0, wrongMsg = 0, diff = 0, firstBad = '';
  for (let k = 0; k < n; k++) {
    tick(s);
    const net = s.net;
    w.tiles.forEach((t, i) => {
      if (t.zone === null) return;
      const sv = net.service[i];
      // 1. connected + unserved => that network really is in outage
      for (const kind of ['power', 'water'] as const) {
        const id = kind === 'power' ? sv.powerNet : sv.waterNet, served = kind === 'power' ? sv.powered : sv.watered;
        if (id >= 0 && !served && !(net[kind][id]?.outages > 0)) { bad++; if (!firstBad) firstBad = `tick+${k} (${i % N},${(i / N) | 0}) ${kind}`; }
      }
      for (const m of s.status(i).missing) if (m.includes('not enough capacity')) {
        const kind = m.startsWith('power') ? 'power' : 'water', id = kind === 'power' ? sv.powerNet : sv.waterNet, nn = net[kind][id];
        if (!nn || !(nn.outages > 0 || nn.demand > nn.capacity)) wrongMsg++;
      }
    });
    // 2. incremental vs full (every 10 ticks: the full flood is the slow reference)
    if (k % 10 === 9) {
      const inc = computeNetworks(w), full = computeNetworksFull(w);
      w.tiles.forEach((_, i) => {
        const a = inc.service[i], b = full.service[i];
        if (b.powerNet >= 0 && a.powered !== b.powered) diff++;
        if (b.waterNet >= 0 && a.watered !== b.watered) diff++;
      });
    }
  }
  ok(bad === 0, `${tag}: no connected-but-unserved lot without a real outage (${n} ticks)`, bad ? { bad, firstBad } : undefined);
  ok(wrongMsg === 0, `${tag}: "not enough capacity" only when the network is short`, wrongMsg || undefined);
  ok(diff === 0, `${tag}: incremental == full recompute on every tile the full flood reaches`, diff || undefined);
  const zonedNextToRoad = w.tiles.filter((t, i) => t.zone && s.status(i).roadAccess && s.net.service[i].powerNet >= 0).length;
  ok(zonedNextToRoad > 0, `${tag}: (sanity) the scenario has connected lots`, zonedNextToRoad);
}

// ---- a. Parker's city from his debug code ----
{
  setGridSize(64);
  const code = readFileSync('tools/fixtures/parker-power-graphonly.lpc', 'utf8') /* npm runs from the repo root */.trim();
  const d = decodeDebugCode(code);
  ok(d.ok, "Parker's debug code decodes", d.ok ? undefined : d.error);
  if (d.ok) {
    const w = deserializeWorld(d.saveJson)!; const s = new Simulation(w); s.recompute();
    run(s, 400, "[Parker's city]");
    // His exact symptom: the commercial strip beside the main road (x=2, z 26..31) powered.
    const strip = rect(2, 26, 2, 31).map(([x, z]) => z * GRID_SIZE + x).filter((i) => w.tiles[i].zone && s.net.service[i].powerNet >= 0);
    ok(strip.every((i) => s.net.service[i].powered), "[Parker's city] the lots beside the road past the junction are powered", strip.filter((i) => !s.net.service[i].powered).length);
  }
}

// ---- b/c/d. Fresh seed "random" cities ----
const SEED = [...'random'].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7); // titleScreen.ts hashing
function fresh(tag: string, sourcesSouth: boolean, fourWay: boolean): void {
  setGridSize(64);
  const s = new Simulation(new World(undefined, SEED, { dry: true })); const w = s.world; migrateToGraph(w);
  w.regionsOwned = allRegions(); w.cash = 1e7;
  const N = GRID_SIZE, ez = (w.edgeIndex / N) | 0; // outside road: x 0..3 on row ez (32)
  const T = (n = 8) => { for (let i = 0; i < n; i++) tick(s); };
  // Main road across the end of the outside road, drawn as two drags FROM the junction (Parker's way).
  s.apply('road', rect(4, ez - 20, 4, ez)); T(); s.apply('road', rect(4, ez, 4, ez + 20)); T();
  if (fourWay) { s.apply('road', rect(5, ez, 20, ez)); T(); } // carry the outside road straight on: a + junction
  // Turbine + tower beside the main road on one side of the junction.
  const sz = sourcesSouth ? ez + 3 : ez - 3;
  s.apply('windTurbine', [[3, sz]]); s.apply('waterTower', [[3, sz + (sourcesSouth ? 3 : -3)]]); T();
  s.zoneOpt = { density: 0, depth: 2 } as never;
  s.apply('residential', rect(2, sourcesSouth ? ez + 8 : ez - 18, 3, sourcesSouth ? ez + 18 : ez - 8)); // same side as the sources
  s.apply('industrial', rect(2, sourcesSouth ? ez - 18 : ez + 2, 3, sourcesSouth ? ez - 2 : ez + 18));   // the OTHER side of the junction
  s.apply('commercial', rect(5, ez - 12, 6, ez - 2));                                                   // the far side of the main road
  if (fourWay) s.apply('commercial', rect(8, ez + 1, 18, ez + 2));                                      // along the new east arm
  T();
  run(s, 400, tag);
}
fresh('[T, power right / lots left]', true, false);
fresh('[T, power left / lots right]', false, false);
fresh('[4-way junction]', false, true);

console.log(fail ? `powergraphonly: ${fail} failed` : 'powergraphonly: all ok');
process.exit(fail ? 1 : 0);
