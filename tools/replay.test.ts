/**
 * tools/replay.test.ts — V1.6 A4: DETERMINISTIC REPLAY.
 * The incremental caches and chunk scans must not make the simulation
 * depend on anything but its inputs. Two cities with the same seed and the
 * same scripted edits must be identical tick for tick — on the 192 map,
 * where the round-robin chunk scan and caches matter most — and a third run
 * that throws its caches away every tick (invalidate()) must match too.
 */
import { setGridSize } from '../src/sim/mapsize';
import { buildTown, tick, Simulation, World, rect } from './bench/town';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail++; };
/** FNV-1a over the tiles' saved fields + cash: a cheap fingerprint of the whole city. */
function fingerprint(s: Simulation): string {
  let h = 2166136261;
  const mix = (v: number) => { h ^= v & 0xffff; h = Math.imul(h, 16777619); h ^= v >>> 16; h = Math.imul(h, 16777619); };
  for (const t of s.world.tiles) { mix(t.level); mix(t.res); mix(t.jobs); mix(Math.round(t.garbage * 100)); mix(+t.road); mix(t.zone ? t.zone.length : 0); mix(t.construct); }
  mix(Math.round(s.world.cash)); mix(s.world.lots.buildings.size);
  return (h >>> 0).toString(16);
}
function run(seed: number, flush: boolean): string[] {
  setGridSize(192);
  const s = new Simulation(new World(undefined, seed));
  s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; });
  buildTown(s, 64, 64);
  const prints: string[] = [];
  for (let i = 0; i < 900; i++) {
    if (i === 300) s.apply('residential', rect(70, 120, 90, 121));
    if (i === 500) s.apply('bulldoze', rect(72, 72, 76, 72));
    if (flush) s.invalidate();
    tick(s);
    if (i % 50 === 49) prints.push(fingerprint(s));
  }
  return prints;
}
const a = run(77, false), b = run(77, false), c = run(77, true);
ok(a.join() === b.join(), `same seed + same edits → same city every 50 ticks (${a.at(-1)})`);
ok(a.join() === c.join(), 'cached run == run that drops every cache each tick');
setGridSize(64);
if (fail) { console.log(`${fail} failures`); process.exit(1); } console.log('replay: all ok');
