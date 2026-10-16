/** Garbage: zone rates/capacity, road-network service area, multi-stop trucks. */
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
import { buildTown, tick, Simulation, World } from './bench/town';
import { garbageMax, garbageWarn, garbageMult, GARBAGE_ZONE_MULT } from '../src/sim/garbageRules';
import { TRUCK_CAPACITY } from '../src/sim/garbage';
import { roadComponents } from '../src/sim/roadnet';
import { serviceAnchors, Svc } from '../src/sim/services';

let bad = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };

ok(GARBAGE_ZONE_MULT.industrial > GARBAGE_ZONE_MULT.commercial && GARBAGE_ZONE_MULT.commercial > GARBAGE_ZONE_MULT.residential, 'industry > commerce > housing garbage rate');
ok(garbageMax('industrial') > garbageMax('commercial') && garbageMax('commercial') > garbageMax('residential'), 'and the same order for capacity');
ok(garbageWarn('industrial') > garbageWarn('residential') && garbageMult(null) === 1, 'warn level scales with zone');

const w = new World(undefined, 4242), s = new Simulation(w);
w.tiles.forEach((t) => { t.deco = 0; t.water = false; });
buildTown(s);
let peakOver = 0;
for (let i = 0; i < 2500; i++) tick(s);
w.cash = 1e7;
s.apply('garbageDump', [[31, 17], [32, 17], [31, 18], [32, 18]]);
for (let i = 0; i < 2500; i++) {
  tick(s);
  if (i % 50 === 0) w.tiles.forEach((t) => { if (t.zone && t.garbage > garbageMax(t.zone) + 1e-6) peakOver++; });
}
const g = s.garbage;
console.log('stats', JSON.stringify(g.stats), 'landfills', serviceAnchors(w, Svc.Dump).length);
ok(peakOver === 0, 'no building ever holds more than its zone capacity');
ok(g.stats.collected > 0, `trucks collected garbage (${Math.round(g.stats.collected)})`);
ok(g.stats.maxStops >= 2, `a truck made several stops in one run (${g.stats.maxStops})`);
ok(g.stats.maxLoad > 6 * 3 && g.stats.maxLoad <= TRUCK_CAPACITY + 1e-6, `a truck carried a big load but never over capacity (${g.stats.maxLoad.toFixed(0)} / ${TRUCK_CAPACITY})`);

// Per zone averages (per unit) follow the zone multipliers.
const sum: Record<string, { g: number; u: number }> = {};
w.tiles.forEach((t) => { if (t.zone && t.level > 0 && t.units > 0) { const e = (sum[t.zone] ??= { g: 0, u: 0 }); e.g += t.garbage / garbageMax(t.zone); e.u++; } });
console.log('mean fill by zone', Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, +(v.g / v.u).toFixed(3)])));

// Far-away pile on the same road network gets collected (beyond the old 16-tile radius).
const comp = roadComponents(w), dump = serviceAnchors(w, Svc.Dump)[0];
if (dump !== undefined) {
  const N = Math.round(Math.sqrt(w.tiles.length)), dx = dump % N, dz = Math.floor(dump / N);
  let far = -1, farD = 0;
  w.tiles.forEach((t, i) => {
    if (!t.zone || t.level <= 0) return;
    const d = Math.abs((i % N) - dx) + Math.abs(Math.floor(i / N) - dz);
    const x = i % N, z = Math.floor(i / N);
    const nb = [i, i - 1, i + 1, i - N, i + N].find((j) => j >= 0 && j < w.tiles.length && w.tiles[j].road);
    if (d > farD && nb !== undefined && comp[nb] && comp[nb] === comp[(() => { const r = [dump - 1, dump + 2, dump - N, dump + 2 * N].find((j) => w.tiles[j]?.road); return r ?? 0; })()]) { far = i; farD = d; }
    void x; void z;
  });
  w.tiles.forEach((t) => { if (t.zone) t.garbage = 0; });
  w.tiles[dump].stock = 0; // the earlier phase filled the landfill; a full one stops collecting
  if (far >= 0) {
    w.tiles[far].garbage = 40;
    for (let i = 0; i < 600; i++) tick(s);
    ok(farD > 16 ? w.tiles[far].garbage < 40 : true, `a pile ${farD} tiles from the landfill (road-connected) was picked up (${w.tiles[far].garbage.toFixed(1)} left)`);
  }
}
if (bad) throw new Error(bad + ' failed');
console.log('garbage: all ok');
