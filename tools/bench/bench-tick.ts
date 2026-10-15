/**
 * tools/bench/bench-tick.ts — V1.6 A0: TICK BENCHMARK.
 *
 *   npm run bench            → prints a table, writes bench/results/latest.json
 *   npm run bench:check      → also compares with bench/results/baseline.json
 *                              and the PLAN-1.6 targets; exits 1 on failure
 *
 * Scenarios (fixed seed 4242, deterministic):
 *   empty<N>  — a fresh map of size N, nothing built (pure overhead)
 *   city<N>   — the bench town grown for GROW ticks, placed in the CENTRE of
 *               an N map (64 → offset 0; bigger maps → offset (N−64)/2)
 * For each: WARM ticks warm-up, then RUN timed ticks; mean / p50 / p95 / p99
 * ms per tick, month-boundary p99, and a per-phase breakdown (sim/prof.ts).
 * Map sizes other than 64 need V1.6 A1 (runtime map size); before that only
 * 64 runs and the bigger sizes are reported as "n/a".
 */
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { buildTown, tick, Simulation, World } from './town';
import { prof } from '../../src/sim/prof';
import { setGridSize } from '../../src/sim/mapsize';

const GROW = Number(process.env.GROW ?? 2500), WARM = 200, RUN = Number(process.env.RUN ?? 1500);
const SIZES = (process.env.SIZES ?? '64,192').split(',').map(Number);
const setSize: ((n: number) => void) | undefined = setGridSize;

function makeWorld(n: number): World | null {
  // T1 fairness: the big map gets the 64 map's resource patches in its
  // centre (resources are seeded by position, so otherwise farms and
  // industry — and with them the whole town — would grow differently).
  setSize?.(64);
  const res64 = new World(undefined, 4242).resources;
  if (n !== 64) { if (!setSize) return null; setSize(n); }
  const w = new World(undefined, 4242);
  if (n !== 64) {
    const off = (n - 64) / 2, res = new Uint8Array(n * n);
    for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) res[(z + off) * n + x + off] = res64[z * 64 + x];
    (w as unknown as { resourceCache: Uint8Array }).resourceCache = res;
  }
  return w;
}
const pct = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor((a.length * p) / 100))];

interface Row { scenario: string; buildings: number; pop: number; mean: number; p50: number; p95: number; p99: number; monthP99: number; heapKBPerTick: number; phases: Record<string, number> }
function bench(scenario: string, n: number, city: boolean): Row | null {
  const w = makeWorld(n);
  if (!w) return null;
  const s = new Simulation(w);
  s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; });
  if (city) { const off = (n - 64) / 2; buildTown(s, off, off); for (let i = 0; i < GROW; i++) tick(s); }
  for (let i = 0; i < WARM; i++) tick(s);
  prof.reset(); prof.on = true;
  const times: number[] = [], month: number[] = [];
  (globalThis as any).gc?.();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < RUN; i++) {
    const t0 = performance.now(); tick(s); const dt = performance.now() - t0;
    times.push(dt); if (s.world.tick % 30 === 0) month.push(dt);
  }
  const heap = (process.memoryUsage().heapUsed - h0) / 1024 / RUN;
  prof.on = false;
  const phases: Record<string, number> = {};
  for (const [k, v] of prof.totals) phases[k] = +(v / RUN).toFixed(4);
  const mean = times.reduce((a, b) => a + b, 0) / RUN;
  const sorted = [...times].sort((a, b) => a - b), ms = [...month].sort((a, b) => a - b);
  return { scenario, buildings: s.world.lots.buildings.size, pop: s.stats().population, mean: +mean.toFixed(3), p50: +pct(sorted, 50).toFixed(3), p95: +pct(sorted, 95).toFixed(3), p99: +pct(sorted, 99).toFixed(3), monthP99: +(ms.length ? pct(ms, 99) : 0).toFixed(3), heapKBPerTick: +heap.toFixed(1), phases };
}

const rows: Row[] = [];
for (const n of SIZES) for (const city of [false, true]) {
  const r = bench(`${city ? 'city' : 'empty'}${n}`, n, city);
  if (r) rows.push(r); else console.log(`${city ? 'city' : 'empty'}${n}: n/a (needs runtime map size, V1.6 A1)`);
}
console.log('scenario   bldgs   pop   mean   p50    p95    p99   month99  KB/tick');
for (const r of rows) console.log([r.scenario.padEnd(9), r.buildings, r.pop, r.mean, r.p50, r.p95, r.p99, r.monthP99, r.heapKBPerTick].join('\t'));
for (const r of rows) console.log(r.scenario, JSON.stringify(r.phases));
mkdirSync('bench/results', { recursive: true });
writeFileSync('bench/results/latest.json', JSON.stringify(rows, null, 1));

// ---- targets (PLAN-1.6 A.1) ----
if (process.argv.includes('--check')) {
  let fail = 0;
  const get = (k: string) => rows.find((r) => r.scenario === k);
  const c64 = get('city64'), c192 = get('city192');
  if (c64 && c192) {
    const ratio = c192.mean / c64.mean;
    console.log(`T1 city192/city64 = ${ratio.toFixed(3)} (target ≤ 1.10)`);
    if (ratio > 1.1) fail++;
  }
  // T4 allocation, T5 absolute budget on the big city.
  for (const r of rows) if (r.scenario.startsWith('city') && r.heapKBPerTick > 50) { console.log(`T4 ${r.scenario}: ${r.heapKBPerTick} KB/tick > 50`); fail++; }
  if (c192) { console.log(`T5 city192 mean ${c192.mean} ms (target ≤ 4)`); if (c192.mean > 4) fail++; }
  // T2: tick time vs building count on a 192 map with 1, 2, 3, 4 and 6 towns.
  if (!process.argv.includes('--no-scale')) {
    const pts: Array<[number, number]> = [];
    const spots = [[64, 64], [0, 64], [128, 64], [64, 0], [64, 128], [0, 0]];
    for (const k of [1, 2, 3, 4, 6]) {
      setGridSize(192);
      const s = new Simulation(new World(undefined, 4242));
      s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; });
      for (let j = 0; j < k; j++) buildTown(s, spots[j][0], spots[j][1]);
      for (let i = 0; i < Math.min(GROW, 1500); i++) tick(s);
      const t0 = performance.now(); for (let i = 0; i < 400; i++) tick(s);
      pts.push([s.world.lots.buildings.size, (performance.now() - t0) / 400]);
    }
    const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    const sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0), sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0), syy = pts.reduce((a, p) => a + (p[1] - my) ** 2, 0);
    const r2 = sxy * sxy / (sxx * syy);
    const dbl = pts[3][1] / pts[1][1]; // 4 towns vs 2 towns
    console.log(`T2 scale series ${JSON.stringify(pts.map(([b, t]) => [b, +t.toFixed(2)]))}  R²=${r2.toFixed(3)} (≥ 0.95)  2×city cost ×${dbl.toFixed(2)} (≤ 2.2)`);
    if (r2 < 0.95 || dbl > 2.2) fail++;
  }
  // T3: month ticks must not be spikier than ticks in general. With ~50 month
  // samples their p99 is really the max, which a GC pause can hit on any
  // tick, so the bound is max(2 × p50, overall p99).
  for (const r of rows) if (r.scenario.startsWith('city') && r.monthP99 > Math.max(2 * r.p50, r.p99) + 0.05) { console.log(`T3 ${r.scenario}: month p99 ${r.monthP99} > 2× p50 ${r.p50}`); fail++; }
  if (existsSync('bench/results/baseline.json')) {
    const base: Row[] = JSON.parse(readFileSync('bench/results/baseline.json', 'utf8'));
    for (const r of rows) { const b = base.find((q) => q.scenario === r.scenario); if (b && r.mean > b.mean * 1.15) { console.log(`regression ${r.scenario}: ${r.mean} vs baseline ${b.mean}`); fail++; } }
  }
  console.log(fail ? `${fail} BENCH CHECK(S) FAILED` : 'BENCH CHECKS PASS');
  process.exit(fail ? 1 : 0);
}
