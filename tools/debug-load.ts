/**
 * tools/debug-load.ts — NEBULA: load a DEBUG CODE headlessly and report.
 *
 *   npm run debug:load -- LPC1:xxxx…          (the code itself)
 *   npm run debug:load -- /path/to/code.txt   (a file containing the code, or a raw save .json)
 *   npm run debug:load -- <code> --json       (machine-readable report)
 *
 * Decodes the code (sim/debugCode.ts), rebuilds the World with the game's own
 * loader (deserializeWorld: all migrations, graph repair on load), wraps it
 * in a Simulation, recomputes the networks once (NO ticks, so the city is
 * exactly as saved) and prints: map size/seed/cash/clock, the road graph size,
 * every POWER and WATER network (capacity, supplied, tiles), and every zoned
 * lot / building tile that is unpowered or unwatered — split into
 * "no connection" vs "outage: not enough capacity" just like the info panel.
 *
 * Tests can import loadDebugCode() for the same thing in code.
 */
import { readFileSync, existsSync } from 'node:fs';
import { decodeDebugCode } from '../src/sim/debugCode';
import { deserializeWorld } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { GRID_SIZE } from '../src/sim/types';
import { formatAmount } from '../src/ui/format';

/** Decode + load. Throws an Error with the user-facing reason on a bad code. */
export function loadDebugCode(codeOrJson: string): Simulation {
  const text = codeOrJson.trim();
  // A raw save JSON is accepted too (handy for Export-ed .json files).
  const json = text.startsWith('{') ? text : (() => { const r = decodeDebugCode(text); if (!r.ok) throw new Error(r.error); return r.saveJson; })();
  const w = deserializeWorld(json);
  if (!w) throw new Error('The save inside the code could not be loaded (unsupported map size or damaged).');
  const s = new Simulation(w);
  s.recompute();
  return s;
}

// ---- CLI ----
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const arg = args.find((a) => a !== '--json');
if (!arg) { console.error('usage: npm run debug:load -- <LPC1:code | file> [--json]'); process.exit(2); }
let sim: Simulation;
try {
  sim = loadDebugCode(existsSync(arg) ? readFileSync(arg, 'utf8') : arg);
} catch (e) {
  console.error(`Bad debug code: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
const w = sim.world, N = GRID_SIZE;
const xz = (i: number) => `(${i % N},${Math.floor(i / N)})`;
// Every tile that needs utilities: zoned lots and structures (status() knows which).
const off: Array<{ tile: string; what: string; missing: string[] }> = [];
w.tiles.forEach((t, i) => {
  if (t.zone === null && !t.structure) return;
  const st = sim.status(i);
  const miss = st.missing.filter((m) => /power|water/.test(m));
  if (miss.length) off.push({ tile: xz(i), what: t.zone ?? String(t.structure), missing: miss });
});
const nets = (k: 'power' | 'water') => sim.net[k].map((n, id) => ({ id, ...Object.fromEntries(Object.entries(n).filter(([, v]) => typeof v === 'number')) }));
const report = {
  size: N, seed: w.seed, tick: w.tick, cash: Math.round(w.cash), graphRoads: w.graphRoads,
  graph: { nodes: w.roads.nodeCount(), edges: w.roads.edgeCount() },
  power: nets('power'), water: nets('water'),
  unserved: off,
};
if (asJson) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`City ${N}×${N}, seed ${report.seed}, tick ${report.tick}, cash $${report.cash.toLocaleString()}, graph roads: ${report.graphRoads} (${report.graph.edges} edges)`);
  for (const k of ['power', 'water'] as const) {
    console.log(`${k.toUpperCase()} networks: ${report[k].length}`);
    // Human-readable: same formatter as the HUD so float demand never prints raw.
    // --json above still dumps the raw numbers for scripts.
    for (const n of report[k]) {
      const demand = Number(n.demand) || 0, capacity = Number(n.capacity) || 0, supplied = Number(n.supplied) || 0, outages = Number(n.outages) || 0;
      console.log(`  #${n.id}: demand ${formatAmount(demand)} / capacity ${formatAmount(capacity)} (supplied ${formatAmount(supplied)}, ${outages} outage${outages === 1 ? '' : 's'})`);
    }
  }
  console.log(`Tiles missing power/water: ${off.length}`);
  for (const o of off.slice(0, 200)) console.log(`   ${o.tile} ${o.what}: ${o.missing.join(', ')}`);
  if (off.length > 200) console.log(`   … ${off.length - 200} more (use --json)`);
}
