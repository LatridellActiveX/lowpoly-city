/**
 * tools/everyday.test.ts — OASIS-S6 regression (Parker, 2026-10-19):
 *   "There is more occasional traffic on the roads."
 *
 *  a. rushFactor: nights are no longer almost empty (≥ 0.2 at 03:00, was
 *     0.12), midday carries ~0.7 (was ~0.58), rush hours peak at 1 (08:00 was 0.86),
 *     and the curve never exceeds 1 or drops below the night floor.
 *  b. Settings: the default car cap is 100 (was 75); a saved settings blob
 *     still on the OLD default 75 is moved up once; a custom value is kept.
 *  c. Parker's avenue save at midday and at night: more cars on the road
 *     than the old curve's figures recorded below, with the give-up rate
 *     still under 1 % and trips completed not lower than before.
 */
import { readFileSync } from 'node:fs';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
import { loadCode } from './fixtures/loadCode';
import { DAY_SECONDS, DAY_START, rushFactor } from '../src/sim/traffic';
import { defaultSettings, loadSettings } from '../src/sim/settings';

let fails = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fails++; };
const at = (h: number) => rushFactor(h / 24);

// a. the curve
{
  let lo = Infinity, hi = 0; for (let h = 0; h < 24; h += 0.1) { lo = Math.min(lo, at(h)); hi = Math.max(hi, at(h)); }
  ok(at(3) >= 0.2 - 1e-9 && lo >= 0.2 - 1e-9, 'nights: at least 0.2 of the commuter target (was 0.12)', { '03:00': +at(3).toFixed(3), min: +lo.toFixed(3) });
  ok(at(12) >= 0.65 && at(12) <= 0.8, 'midday: about 0.7 (was ~0.58)', +at(12).toFixed(3));
  ok(at(8) >= 0.99 && at(17.5) >= 0.99 && hi <= 1, 'rush hours still peak at 1 and nothing goes above', { '08:00': +at(8).toFixed(3), '17:30': +at(17.5).toFixed(3) });
}
// b. settings
{
  ok(defaultSettings().maxCars === 100, 'default car cap is 100', defaultSettings().maxCars);
  store.set('lowpoly-city-settings', JSON.stringify({ ...defaultSettings(), maxCars: 75, trafficRev: undefined }));
  ok(loadSettings().maxCars === 100, 'saved settings still on the old default 75 move up to 100', loadSettings().maxCars);
  store.set('lowpoly-city-settings', JSON.stringify({ ...defaultSettings(), maxCars: 60, trafficRev: undefined }));
  ok(loadSettings().maxCars === 60, 'a custom cap (60) is kept', loadSettings().maxCars);
  store.set('lowpoly-city-settings', JSON.stringify({ ...defaultSettings(), maxCars: 75 }));
  ok(loadSettings().maxCars === 75, 'a cap of 75 chosen after this update is kept', loadSettings().maxCars);
  store.clear();
}
// c. Parker's avenue save
/**
 * BEFORE (commit e8c61e8, old curve + cap 75), measured with run() below:
 *   midday 12:00, 1,200 s: mean 69.8 cars on the road (cap 75), 3,083 trips completed, give-up 0.18 %
 *   night  02:00,   600 s: mean 14.3 cars, 895 trips, give-up 0 %
 */
const BEFORE = { midCars: 69.8, midTrips: 3083, nightCars: 14.3 };
function run(hour: number, secs: number) {
  const s = loadCode(readFileSync('tools/fixtures/parker-avenue.lpc', 'utf8').trim());
  s.settings.maxCars = defaultSettings().maxCars;
  s.world.clock = (((hour / 24 - DAY_START) % 1 + 1) % 1) * DAY_SECONDS;
  const st0 = { ...s.traffic.graph.stats }, tile0 = (s.traffic as any).stats.arrived;
  let sum = 0, n = 0;
  for (let t = 0; t < secs; t += 0.25) { s.update(0.25); if (Math.round(t * 4) % 20 === 0) { sum += s.traffic.count('car'); n++; } }
  const st = s.traffic.graph.stats, spawned = st.spawned - st0.spawned, gaveUp = st.gaveUp - st0.gaveUp;
  return { cars: +(sum / n).toFixed(1), trips: st.arrived - st0.arrived + (s.traffic as any).stats.arrived - tile0, spawned, gaveUp, rate: spawned ? +(gaveUp / spawned).toFixed(4) : 0 };
}
{
  const mid = run(12, 1200), night = run(2, 600);
  console.log('     midday', JSON.stringify(mid), 'night', JSON.stringify(night), 'before', JSON.stringify(BEFORE));
  ok(mid.cars > BEFORE.midCars * 1.1, 'midday: noticeably more cars on the road than before', { now: mid.cars, before: BEFORE.midCars });
  ok(night.cars > BEFORE.nightCars * 1.3, 'night: more of an occasional trickle than before', { now: night.cars, before: BEFORE.nightCars });
  ok(mid.rate < 0.01 && night.rate < 0.01, 'give-up rate still under 1 %', { midday: mid.rate, night: night.rate });
  ok(mid.trips >= BEFORE.midTrips, 'trips completed at midday not lower than before', { now: mid.trips, before: BEFORE.midTrips });
}
console.log(fails ? `${fails} FAILED` : 'all everyday-traffic checks passed');
if (fails) process.exit(1);
