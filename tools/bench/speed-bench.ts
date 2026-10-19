/**
 * tools/bench/speed-bench.ts — frame cost of Simulation.update at each speed
 * button (1× / 2× / 3× = 4× game time) at 60 fps and at a laggy 15 fps, on the
 * bench town. Reports ms of simulation work per real second (budget: 1000).
 * Also checks the calendar: a day is 10 s / 5 s / 2.5 s of real time.
 */
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
import { buildTown, tick, Simulation, World } from './town';
import { DAY_TICKS } from '../../src/sim/economy';

const w = new World(undefined, 4242);
const s = new Simulation(w);
w.tiles.forEach((t) => { t.deco = 0; t.water = false; });
buildTown(s);
for (let i = 0; i < 2500; i++) tick(s);
for (let i = 0; i < 300; i++) tick(s);
console.log(`town: ${s.world.lots.buildings.size} buildings, pop ${s.stats().population}, ${s.traffic.count('car')} cars`);
let bad = 0;
for (const fps of [60, 15]) for (const speed of [1, 2, 3]) {
  s.speed = speed;
  const frames = fps * 20, dt = 1 / fps;
  const t0 = performance.now(), tick0 = s.world.tick, clock0 = s.world.clock;
  for (let i = 0; i < frames; i++) s.update(dt);
  const ms = performance.now() - t0, ticks = s.world.tick - tick0;
  const real = 20, dayReal = DAY_TICKS / (ticks / real);
  console.log(`${String(fps).padStart(2)} fps  speed ${speed}×: ${(ms / real).toFixed(1)} ms of sim per real second, ${(ticks / real).toFixed(2)} ticks/s, game clock ×${((s.world.clock - clock0) / real).toFixed(2)}, calendar day = ${dayReal.toFixed(2)} s, cars ${s.traffic.count('car')}`);
  if (fps === 60) { const want = [0, 10, 5, 2.5][speed]; if (Math.abs(dayReal - want) > 0.3) { console.log('  !! day length off, want', want); bad++; } }
}
if (bad) throw new Error("day length mismatch");
