/**
 * tools/mapsize.test.ts — V1.6 A1: runtime map size.
 * For each supported size: set it, build a World, check that tile and cell
 * arrays match, grow a town in the CENTRE (so code that still assumes 64 would
 * touch the wrong tiles), and check it actually grows and does not crash.
 */
import { setGridSize, MAP_SIZES } from '../src/sim/mapsize';
import { GRID_SIZE } from '../src/sim/types';
import { CELL_GRID } from '../src/sim/cells';
import { buildTown, tick, Simulation, World } from './bench/town';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail++; };
for (const n of MAP_SIZES) {
  setGridSize(n);
  ok(GRID_SIZE === n && CELL_GRID === n * 4, `${n}: live bindings GRID_SIZE=${GRID_SIZE} CELL_GRID=${CELL_GRID}`);
  const w = new World(undefined, 4242);
  ok(w.tiles.length === n * n, `${n}: tiles ${w.tiles.length}`);
  const s = new Simulation(w);
  s.world.tiles.forEach((t: any) => { t.deco = 0; t.water = false; });
  const off = (n - 64) / 2; buildTown(s, off, off);
  for (let i = 0; i < 600; i++) tick(s);
  const pop = s.stats().population;
  ok(pop > 0, `${n}: centred town grows (pop ${pop})`);
}
let threw = false; try { setGridSize(100); } catch { threw = true; }
ok(threw, 'unsupported size rejected');
setGridSize(64);
if (fail) { console.log(`${fail} failures`); process.exit(1); } console.log('mapsize: all ok');
