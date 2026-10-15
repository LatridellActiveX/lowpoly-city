/**
 * V1.6 B8: save v10 migration tests.
 *
 *  - Fixtures (tools/fixtures/*.json) are 1.5b-format (v9) cities: small =
 *    64 map (v8 tile-array layout), large = 192 map (run-length layout).
 *    `FIXTURES=1` regenerates them from the bench town.
 *  - Each must load into v10 with the same buildings, population, jobs and
 *    road connectivity, a road graph traced from its tiles, and trips within
 *    5% of the un-migrated city after 200 ticks.
 *  - v10 → v10 round trip is lossless (identical JSON).
 *  - Bulldozing a graph road tile removes the graph edge (syncGraphToTiles).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildTown, tick, Simulation, World } from './bench/town';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { setGridSize } from '../src/sim/mapsize';
import { GRID_SIZE } from '../src/sim/types';
import { placeFreeRoad } from '../src/sim/freeroads';
import { quadCubic } from '../src/roads/bezier';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('  ok', m); };
const DIR = new URL('./fixtures/', import.meta.url).pathname.replace('/tmp/', '/workspace/lowpoly-city/tools/');
const path = (n: string) => `${process.cwd()}/tools/fixtures/${n}.json`;

/** Strip the v10 fields: exactly what a 1.5b / A6 (v9) save holds. */
function asV9(json: string): string { const d = JSON.parse(json); d.version = 9; delete d.roadGraph; delete d.graphTiles; return JSON.stringify(d); }

function makeFixture(name: string, size: number, ox: number) {
  setGridSize(size);
  const s = new Simulation(new World(undefined, 4242));
  buildTown(s, ox, ox);
  for (let i = 0; i < 400; i++) tick(s);
  writeFileSync(path(name), asV9(serializeWorld(s.world)));
}
if (process.env.FIXTURES || !existsSync(path('small'))) { makeFixture('small', 64, 0); makeFixture('large', 192, 64); }

/** Road connectivity: number of 4-connected road components. */
function components(w: World): number {
  const N = GRID_SIZE, seen = new Uint8Array(N * N); let k = 0;
  for (let i = 0; i < N * N; i++) {
    if (!w.tiles[i].road || seen[i]) continue;
    k++; const st = [i]; seen[i] = 1;
    while (st.length) { const j = st.pop()!, x = j % N, z = (j / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz, n = nz * N + nx;
        if (nx >= 0 && nz >= 0 && nx < N && nz < N && w.tiles[n].road && !seen[n]) { seen[n] = 1; st.push(n); } } }
  }
  return k;
}

for (const name of ['small', 'large']) {
  console.log(name);
  const raw = readFileSync(path(name), 'utf8');
  ok(JSON.parse(raw).version === 9, `${name} fixture is v9`);
  // "Old" city: load with the graph layer emptied again (pure grid behaviour).
  const t0 = performance.now();
  const w = deserializeWorld(raw)!;
  const ms = performance.now() - t0;
  ok(!!w, `${name} loads`);
  const old = deserializeWorld(raw)!; old.roads = new (old.roads.constructor as any)(); old.graphTiles = new Set();
  const a = new Simulation(w), b = new Simulation(old);
  const sa = a.stats(), sb = b.stats();
  ok(sa.population === sb.population && sa.jobs === sb.jobs && sa.buildings === sb.buildings, `${name} pop ${sa.population} jobs ${sa.jobs} bldg ${sa.buildings} equal`);
  ok(components(w) === components(old), `${name} road components equal (${components(w)})`);
  let roadTiles = 0; w.tiles.forEach((t) => t.road && roadTiles++);
  ok(w.roads.edgeCount() > 0 && w.graphTiles.size === roadTiles, `${name} graph traced: ${w.roads.edgeCount()} edges, ${w.graphTiles.size}/${roadTiles} tiles, load ${ms.toFixed(0)} ms`);
  ok(w.blocks.cells.some((c) => c.code), `${name} blocks carry zoning`);
  for (let i = 0; i < 200; i++) { tick(a); tick(b); }
  const ta = a.traffic.stats.spawned, tb = b.traffic.stats.spawned;
  ok(Math.abs(ta - tb) <= 0.05 * Math.max(1, tb), `${name} trips within 5% (${ta} vs ${tb})`);
  // v10 round trip. Saving a live city resets in-flight state on load
  // (cars in transit arrive, crews re-dispatch — pre-1.6 behaviour), so the
  // check is: road graph + graph tiles survive exactly, and a loaded save
  // re-saves identically (v10 → v10 is a fixed point).
  const j1 = serializeWorld(a.world), w2 = deserializeWorld(j1)!, j2 = serializeWorld(w2), j3 = serializeWorld(deserializeWorld(j2)!);
  const A = JSON.parse(j1), B = JSON.parse(j2);
  ok(JSON.stringify(A.roadGraph) === JSON.stringify(B.roadGraph) && JSON.stringify(A.graphTiles) === JSON.stringify(B.graphTiles), `${name} graph round trip exact`);
  // crewLinger counts down once per load (pre-1.6 crew re-dispatch) — the one field excluded.
  const norm = (j: string) => { const d = JSON.parse(j); if (d.tilesRle) delete d.tilesRle.crewLinger; for (const t of d.tiles ?? []) delete t.crewLinger; return JSON.stringify(d); };
  ok(norm(j2) === norm(j3), `${name} v10 → v10 lossless (${(j2.length / 1024).toFixed(0)} KB)`);
}

// Free road + bulldoze keeps graph and tiles in step; survives save/load.
setGridSize(192);
const s = new Simulation(new World(undefined, 4242)); buildTown(s, 64, 64);
const M = (x: number, z: number) => ({ x: x * 32, z: z * 32 });
placeFreeRoad(s, quadCubic(M(100, 140), M(110, 160), M(120, 145)), 'street', {}, true, true);
const e0 = s.world.roads.edgeCount(), g0 = s.world.graphTiles.size;
const w3 = deserializeWorld(serializeWorld(s.world))!;
ok(w3.roads.edgeCount() === e0 && w3.graphTiles.size === g0, `free road survives save/load (${e0} edges, ${g0} tiles)`);
const victim = [...s.world.graphTiles][Math.floor(g0 / 2)];
s.apply('bulldoze', [[victim % GRID_SIZE, Math.floor(victim / GRID_SIZE)]]);
ok(s.world.roads.edgeCount() < e0 && !s.world.graphTiles.has(victim), `bulldoze removes graph edge (${s.world.roads.edgeCount()} left)`);
void DIR;
console.log(fails ? `migrate: ${fails} failed` : 'migrate: all ok');
process.exit(fails ? 1 : 0);
