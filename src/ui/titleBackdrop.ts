/**
 * V1.5 title screen backdrop: a small, fully-serviced demo town built with
 * the real simulation tools, so the title screen shows actual buildings,
 * traffic and day/night instead of a static picture.
 *
 * It is NEVER saved (main.ts skips autosave while the title is open) and is
 * thrown away when the player starts or continues a game.
 */
import { Simulation } from '../sim/simulation';
import { World } from '../sim/grid';
import { GRID_SIZE } from '../sim/types';

/** Fixed seed so the backdrop looks the same every time the title opens. */
export const BACKDROP_SEED = 151515;

/** Inclusive rectangle of tile coordinates (same helper the tests use). */
function rect(x0: number, z0: number, x1: number, z1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push([x, z]);
  return out;
}

/**
 * Build the demo town and pre-run `warmTicks` simulation ticks so houses
 * have grown and cars are driving by the time the title appears.
 */
export function buildBackdrop(warmTicks = 600): Simulation {
  const s = new Simulation(new World(undefined, BACKDROP_SEED));
  const w = s.world;
  w.cash = 1e7; // the demo town ignores money
  // Same layout idea as the PR 6 test town: east-west streets every 7 tiles,
  // three north-south streets, all tied to the highway edge connection.
  const e = w.edgeIndex, ex = e % GRID_SIZE, ez = Math.floor(e / GRID_SIZE);
  for (const z of [19, 26, 33]) s.apply('road', rect(18, z, 44, z));
  for (const x of [18, 31, 44]) s.apply('road', rect(x, 19, x, 33));
  s.apply('road', rect(44, 26, 44, ez));
  s.apply('road', rect(44, ez, ex, ez));
  // Utilities (roads already carry power and water mains since PR 3 / PR 6).
  s.apply('powerPlant', [[17, 19]]);
  s.apply('waterTower', [[17, 20]]);
  s.apply('waterTower', [[45, 33]]);
  s.apply('constructionYard', [[30, 18]]);
  for (const x of [22, 36]) s.apply('park', [[x, 29]]);
  // Zoning is dragged along a road side; `depth` = tiles back from the road.
  s.zoneOpt = { density: 0, depth: 3 };
  s.apply('residential', rect(19, 20, 30, 20));
  s.apply('residential', rect(32, 20, 43, 20));
  s.apply('residential', rect(19, 27, 30, 27));
  s.zoneOpt = { density: 0, depth: 2 };
  s.apply('commercial', rect(19, 25, 30, 25));
  s.apply('commercial', rect(32, 25, 43, 25));
  s.apply('industrial', rect(32, 32, 43, 32));
  s.zoneOpt = { density: 0, depth: 3 };
  // Pre-run: sim ticks plus traffic so crews/move-in cars actually arrive.
  for (let i = 0; i < warmTicks; i++) {
    s.step();
    for (let k = 0; k < 2; k++) {
      s.traffic.update(w, 0.5);
      w.clock += 0.5;
    }
  }
  s.speed = 1;
  return s;
}
