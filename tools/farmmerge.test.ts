/** Neighbouring maxed-out farms merge into one large farm that shares a bigger field. */
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
import { buildTown, tick, Simulation, World, rect } from './bench/town';
import { TPL } from '../src/sim/footprints';
import { fieldMult } from '../src/sim/industry';

let bad = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const w = new World(undefined, 4242), s = new Simulation(w);
w.tiles.forEach((t) => { t.deco = 0; t.water = false; });
buildTown(s);
for (let i = 0; i < 1500; i++) tick(s);
w.cash = 1e7;
// A row of farms along the east road's free frontage.
s.zoneOpt = { density: 0, depth: 3 };
s.apply('farm', rect(12, 41, 28, 41));
let farms = 0;
for (let i = 0; i < 4000; i++) {
  tick(s);
  if (i % 20 === 0) for (const b of w.lots.buildings.values()) if (TPL[b.tpl].kind === 1 && TPL[b.tpl].zone === 'industrial' && b.tpl === 'farm') { b.level = Math.max(b.level, 3); b.happy = Math.max(b.happy, 400); }
}
for (const b of w.lots.buildings.values()) if (b.tpl === 'farm') farms++;
const big = [...w.lots.buildings.values()].filter((b) => b.tpl === 'big_farm');
console.log('farms', farms, 'large farms', big.length);
ok(fieldMult(6) === 2 && fieldMult(3) === 1, 'large farm has a double field quota');
ok(big.length > 0, 'neighbouring farms merged into a large farm');
if (big.length) {
  for (let i = 0; i < 400; i++) tick(s);
  const b = big[0];
  ok(b.fields > 0, `the large farm claimed shared field cells (${b.fields})`);
}
if (bad) throw new Error(bad + ' failed');
console.log('farmmerge: all ok');
