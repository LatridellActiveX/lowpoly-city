import { prof } from '../../src/sim/prof';
import { GRID_SIZE } from '../../src/sim/types';
/**
 * tools/bench/town.ts — V1.6 A0: the deterministic BENCH TOWN.
 * The same grid town as tools/balance.ts (roads every 7 tiles, utilities,
 * yards, R/C/I rows and the services as they unlock), built at an offset
 * (ox, oz) so later stages can drop the identical city into the centre of a
 * bigger map. Everything is seeded → identical runs.
 */
import { Simulation } from '../../src/sim/simulation';
import { World } from '../../src/sim/grid';

export type XZ = [number, number];
export const rect = (x0: number, z0: number, x1: number, z1: number, ox = 0, oz = 0) => {
  const o: XZ[] = [];
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) o.push([x + ox, z + oz]);
  return o;
};

/** Build the town on `s` with its top-left offset by (ox, oz) tiles. */
export function buildTown(s: Simulation, ox = 0, oz = 0): void {
  const R = (x0: number, z0: number, x1: number, z1: number) => rect(x0, z0, x1, z1, ox, oz);
  const P = (x: number, z: number): XZ[] => [[x + ox, z + oz]];
  s.world.cash = 1e7;
  for (const z of [12, 19, 26, 33, 40]) s.apply('road', R(10, z, 50, z));
  for (const x of [10, 30, 50]) s.apply('road', R(x, 12, x, 40));
  // Highway link: from the town's east road to the map's edge connection.
  const N = GRID_SIZE, e = s.world.edgeIndex, ex = e % N, ez = Math.floor(e / N);
  s.apply('road', rect(50 + ox, Math.min(26 + oz, ez), 50 + ox, Math.max(26 + oz, ez)));
  s.apply('road', rect(Math.min(50 + ox, ex), ez, Math.max(50 + ox, ex), ez));
  s.apply('powerPlant', P(9, 12)); s.apply('powerPlant', P(51, 12));
  s.apply('waterTower', P(9, 13)); s.apply('waterTower', P(51, 13)); s.apply('waterTower', P(9, 41));
  s.apply('constructionYard', P(29, 11)); s.apply('constructionYard', P(31, 41));
  s.zoneOpt = { density: 0, depth: 3 };
  for (const z of [13, 27]) { s.apply('residential', R(11, z, 29, z)); s.apply('residential', R(31, z, 49, z)); }
  s.zoneOpt = { density: 1, depth: 3 };
  s.apply('commercial', R(11, 20, 29, 20)); s.apply('commercial', R(31, 20, 49, 20)); s.apply('commercial', R(31, 25, 49, 25));
  s.zoneOpt = { density: 0, depth: 2 }; s.apply('industrial', R(31, 34, 49, 34)); s.apply('industrial', R(11, 34, 29, 34));
  s.apply('elementarySchool', P(20, 17)); s.apply('garbageDump', P(31, 17)); s.apply('policeStation', P(40, 17));
}

/** One full tick the way the game runs it (sim + vehicles + clock). */
export function tick(s: Simulation): void {
  s.step(); prof.begin('traffic'); s.traffic.update(s.world, 1); prof.end(); s.world.clock += 1;
}
export { Simulation, World };
