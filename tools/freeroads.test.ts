/**
 * B6/B7 tests: road cross-section, lane offsets and the free-road tool's
 * place / undo / redo round trip on the bench town.
 */
import { buildTown, Simulation, World } from './bench/town';
import { placeFreeRoad, undo, redo, undoDepth } from '../src/sim/freeroads';
import { quadCubic } from '../src/roads/bezier';
import { ROAD_SPEC, roadHalf, LANE_M } from '../src/roads/graph';
import { setGridSize } from '../src/sim/mapsize';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.log('FAIL', m); } };

// Cross-section: a car (about 2 m wide) must fit in a lane; sidewalks outside.
for (const t of ['street', 'avenue', 'highway'] as const) {
  const s = ROAD_SPEC[t];
  ok(LANE_M >= 3 * 2, `${t} lane wide enough for a car with margins`);
  ok(roadHalf(t) > s.width / 2, `${t} half-width includes kerb and sidewalk`);
}
ok(roadHalf('avenue') > roadHalf('street'), 'avenue wider than street');

setGridSize(192);
const sim = new Simulation(new World(undefined, 4242));
buildTown(sim, 64, 64);
const M = (x: number, z: number) => ({ x: x * 32, z: z * 32 });
const before = sim.world.graphTiles.size;
const c = quadCubic(M(100, 140), M(110, 160), M(120, 145));
const dry = placeFreeRoad(sim, c, 'street', {}, false);
ok(sim.world.graphTiles.size === before, 'dry run leaves world untouched');
const p = placeFreeRoad(sim, c, 'street', {}, true, true);
ok(!!p && sim.world.graphTiles.size > before, 'commit adds graph tiles');
const after = sim.world.graphTiles.size;
ok(undoDepth(sim)[0] === 1, 'one undo entry');
ok(undo(sim) && sim.world.graphTiles.size === before, 'undo restores');
ok(redo(sim) && sim.world.graphTiles.size === after, 'redo reapplies');
void dry;
console.log(fails ? `freeroads: ${fails} failed` : 'freeroads: all ok');
process.exit(fails ? 1 : 0);
