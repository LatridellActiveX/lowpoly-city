/**
 * tools/parkroads.test.ts — OASIS-S4 regression (Parker, 2026-10-19):
 *   "Parks serve an area based on connected roads instead of base tiles
 *    around them similar to the new garbage system."
 *
 * Hand-built map (no randomness):
 *
 *   z=20  ═══════ street A (x 10..50) ═══════
 *   z=21  P(12)  ……… homes at x 22 (10 road tiles away) and x 26 (14 away)
 *   z=22-23 ~~~~~~~~~ river ~~~~~~~~~~~~~~~
 *   z=24  ═══════ street B (x 10..30), NOT connected to A ═══════
 *   z=25  home at x 12 (4 tiles from the park as the crow flies)
 *
 *  a. a home 10 road tiles down the park's own street is served (the old
 *     10×10 square stopped 4–5 tiles away), with the road-distance falloff;
 *  b. a home 14 road tiles away is not (reach is 12);
 *  c. the home across the river on an unconnected street is NOT served,
 *     although the old square covered it;
 *  d. a bridge street linking A and B too far round does not help; one
 *     within reach does → now it is served;
 *  e. a park with no road still lifts its direct neighbours only;
 *  f. computeEnvironment uses this, caps at PARK_BONUS_MAX; deterministic.
 */
import { World } from '../src/sim/grid';
import { computeEnvironment, parkReach, parkRoadFalloff } from '../src/sim/environment';
import { PARK_BONUS, PARK_BONUS_MAX, PARK_FRONT_DEPTH, PARK_ROAD_REACH } from '../src/sim/rules';
import { GRID_SIZE } from '../src/sim/types';

let fails = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fails++; };
const N = GRID_SIZE, I = (x: number, z: number) => z * N + x;

const w = new World(undefined, 4242);
w.tiles.forEach((t) => { t.deco = 0; t.water = false; t.road = false; t.structure = 'none'; t.zone = null; });
for (let x = 10; x <= 50; x++) w.tiles[I(x, 20)].road = true;
for (let x = 0; x < 60; x++) { w.tiles[I(x, 22)].water = true; w.tiles[I(x, 23)].water = true; }
for (let x = 10; x <= 30; x++) w.tiles[I(x, 24)].road = true;
const park = I(12, 21); w.tiles[park].structure = 'park';
const reach = () => { const m = new Map<number, number>(); parkReach(w, park, (j, d) => m.set(j, d)); return m; };

let m = reach();
const dNear = m.get(I(22, 21))!;
ok(dNear === 10, 'a home 10 tiles down the same street is served', { d: dNear, bonus: +(PARK_BONUS * parkRoadFalloff(dNear)).toFixed(3) });
ok(!m.has(I(26, 21)), 'a home 14 road tiles away is not (reach = 12)', { reach: PARK_ROAD_REACH });
ok(m.get(I(12, 21)) === 0 && m.get(I(13, 21)) === 0, 'the park and its next-door lot get the full bonus (distance 0)');
ok(!m.has(I(12, 25)) && !m.has(I(12, 24)), 'across the river on an UNCONNECTED street: not served (old square covered it)');
ok([...m.keys()].every((j) => Math.abs((j % N) - 12) + Math.abs(Math.floor(j / N) - 21) <= PARK_FRONT_DEPTH + PARK_ROAD_REACH + PARK_FRONT_DEPTH), 'everything reached is within 4 + 12 + 4 tiles of the park');

// d. a bridge street at x=20 joins A and B: 8 along A + 4 down + 4 back
//    along B = 16 > 12 → still not served; at x=16: 4 + 4 + 4 = 12 → served.
//    (At x=16 the park itself sits 4 lots from the bridge street, so it
//    fronts onto it directly: distance 0 at (16,21), 3 + 4 = 7 at (12,24).)
for (let z = 21; z <= 23; z++) w.tiles[I(20, z)].road = true;
m = reach();
ok(!m.has(I(12, 25)), 'a bridge 16 road tiles round is too far: still not served', { d: m.get(I(12, 25)) });
for (let z = 21; z <= 23; z++) { w.tiles[I(20, z)].road = false; w.tiles[I(16, z)].road = true; }
m = reach();
ok(m.get(I(12, 24)) === 7 && m.get(I(12, 25)) === 7, 'after a bridge links the streets the far-bank home is served (within 12 road tiles)', { d: m.get(I(12, 25)) });
for (let z = 21; z <= 23; z++) w.tiles[I(16, z)].road = false;

// e. a park with no road at all
const lone = I(40, 40); w.tiles[lone].structure = 'park';
const ml = new Map<number, number>(); parkReach(w, lone, (j, d) => ml.set(j, d));
ok(ml.get(I(41, 40)) === 0 && ml.get(I(42, 40)) === 0 && !ml.has(I(43, 40)), 'a park with no road lifts only its direct neighbours (2 tiles)', { n: ml.size });

// f. full environment
for (const [x, z] of [[22, 21], [26, 21], [12, 25]]) { w.tiles[I(x, z)].zone = 'residential'; }
w.chunks.touchAll(); w.chunks.sync(w.tiles);
let env = computeEnvironment(w);
ok(Math.abs(env.parks[I(22, 21)] - PARK_BONUS * parkRoadFalloff(dNear)) < 1e-5 && env.parks[I(26, 21)] === 0 && env.parks[I(12, 25)] === 0, 'computeEnvironment: park bonus follows the roads', { near: env.parks[I(22, 21)], far: env.parks[I(26, 21)], river: env.parks[I(12, 25)] });
for (let x = 13; x <= 18; x++) w.tiles[I(x, 21)].structure = 'park';
w.chunks.touchAll(); w.chunks.sync(w.tiles); env = computeEnvironment(w);
ok(Math.abs(env.parks[I(15, 21)] - PARK_BONUS_MAX) < 1e-6, 'many parks still cap at PARK_BONUS_MAX', env.parks[I(15, 21)]);
// determinism
const a = computeEnvironment(w).parks, b = computeEnvironment(w).parks;
ok(a.every((v, i) => v === b[i]), 'deterministic');

console.log(fails ? `${fails} FAILED` : 'all park-by-road checks passed');
if (fails) process.exit(1);
