/**
 * tools/powerjunctions.test.ts — NEBULA: POWER (and water) THROUGH JUNCTIONS.
 *
 * Regression for "the power network doesn't reach past the first junction
 * on the outside connection". For BOTH kinds of graph world —
 *   new   : migrateToGraph on the empty map first (a new game), then build;
 *   migrated: build with tile tools in a tile world, then migrateToGraph
 *             (what loading a v9 save does) —
 * we start at the map's OUTSIDE CONNECTION, put a power plant and a water
 * tower beside its first tiles, and run one road west with a chain of every
 * junction type hanging off it: T, crossroads (+), avenue crossing,
 * roundabout, a free-road Y, a curved free road, and a free road meeting a
 * tile road. One zoned lot sits beside every road piece BEYOND each junction.
 *
 * Checked after every build step, after edits (bulldoze a junction tile and
 * rebuild it, a new free road that SPLITS existing edges, undo/redo):
 *   1. every road tile and every lot beside a road is powered (and watered —
 *      the tower is wired through the same roads by a pipe along them);
 *   2. the incremental solver (computeNetworks: cached topology + graph pass)
 *      agrees with a from-scratch flood (computeNetworksFull) on every tile
 *      the flood reaches;
 *   3. what the renderer draws agrees with the sim: the street poles of all
 *      powered roads are wired into ONE pole network (graphPower), and every
 *      graph edge has poles.
 */
import { rect, tick, Simulation, World } from './bench/town';
import { migrateToGraph } from '../src/roads/persist';
import { allRegions } from '../src/sim/regions';
import { GRID_SIZE } from '../src/sim/types';
import { placeFreeRoad, undo, redo } from '../src/sim/freeroads';
import { setGridSize } from '../src/sim/mapsize';
import { lineCubic, quadCubic } from '../src/roads/bezier';
import { computeNetworks, computeNetworksFull } from '../src/sim/networks';
import { planAll, rings } from '../src/roads/junctions';
import { graphPower } from '../src/render/graphUtilities';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { edgeTiles } from '../src/roads/bridge';

let fail = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fail++; };

function scenario(kind: 'new' | 'migrated'): void {
  const s = new Simulation(new World(undefined, 4242));
  const w = s.world;
  if (kind === 'new') migrateToGraph(w);
  w.regionsOwned = allRegions(); w.cash = 1e9; w.peakPop = 5000; w.tier = 3;
  const N = GRID_SIZE, e = w.edgeIndex, ex = e % N, ez = Math.floor(e / N);
  const T = (n = 8) => { for (let i = 0; i < n; i++) tick(s); };
  const M = (x: number, z: number) => ({ x: (x + 0.5) * 32, z: (z + 0.5) * 32 });
  const tag = `[${kind}]`;
  const zones: number[] = [];
  const zone = (x0: number, z0: number, x1: number, z1: number) => {
    s.zoneOpt = { density: 0, depth: 1 } as never;
    s.apply('residential', rect(x0, z0, x1, z1));
    for (const [x, z] of rect(x0, z0, x1, z1)) if (w.tiles[z * N + x].zone) zones.push(z * N + x);
  };

  // Plant + tower beside the outside connection's first tiles; the main road west.
  s.apply('powerPlant', [[ex - 3, ez - 1]]);
  s.apply('waterTower', [[ex - 4, ez - 1]]);
  s.apply('road', rect(14, ez, ex, ez));
  // A water pipe along the main road's north kerb (tower → town), so water
  // has a tile conduit too and the check covers both utilities.
  s.apply('waterPipe', rect(14, ez - 1, ex - 5, ez - 1).filter(([x]) => ![50, 40, 30, 22, 23].includes(x)));
  T();
  // Junction chain (each beyond the previous one, walking west).
  s.apply('road', rect(50, ez + 1, 50, ez + 8));            // T (south)
  s.apply('road', rect(40, ez - 8, 40, ez + 8));            // + crossroads
  s.apply('avenue', rect(30, ez - 8, 30, ez + 8));          // avenue crossing
  s.apply('roundabout', [[22, ez - 1], [23, ez - 1], [22, ez], [23, ez]]); // roundabout on the main road
  T();
  let r = placeFreeRoad(s, lineCubic(M(45, ez), M(45, ez + 5)), 'street', {}, true, true);           // free T off the main road
  ok(r.ok, `${tag} free road off the main road`, r.reason);
  r = placeFreeRoad(s, lineCubic(M(45, ez + 5), M(42, ez + 9)), 'street', {}, true, true);           // Y arm 1
  ok(r.ok, `${tag} free Y arm 1`, r.reason);
  r = placeFreeRoad(s, lineCubic(M(45, ez + 5), M(48, ez + 9)), 'street', {}, true, true);           // Y arm 2
  ok(r.ok, `${tag} free Y arm 2`, r.reason);
  r = placeFreeRoad(s, quadCubic(M(50, ez + 8), M(56, ez + 8), M(57, ez + 13)), 'street', {}, true, true); // curve off the tile T
  ok(r.ok, `${tag} curved free road meeting a tile road`, r.reason);
  T();
  if (kind === 'migrated') { migrateToGraph(w); s.version++; T(); }
  ok(w.graphRoads && w.roads.edgeCount() > 15, `${tag} graph world with the junction chain`, w.roads.edgeCount());

  // A lot beside every piece beyond each junction.
  zone(52, ez + 1, 56, ez + 1);    // between edge and T
  zone(51, ez + 2, 51, ez + 7);    // down the T
  zone(41, ez - 7, 41, ez - 2);    // + north arm
  zone(39, ez + 2, 39, ez + 7);    // + south arm
  zone(31, ez - 7, 31, ez - 2);    // avenue north
  zone(29, ez + 2, 29, ez + 7);    // avenue south
  zone(15, ez + 1, 20, ez + 1);    // beyond the roundabout
  zone(32, ez + 1, 38, ez + 1);    // between + and avenue
  T(30);

  const check = (when: string) => {
    let roadOff = 0, lotOff = 0, waterOff = 0;
    w.tiles.forEach((t, i) => { if (t.road && !s.status(i).powered) roadOff++; });
    for (const i of zones) { const st = s.status(i); if (!st.powered) lotOff++; if (!st.watered) waterOff++; }
    ok(roadOff === 0 && lotOff === 0, `${tag} ${when}: every road tile and lot past every junction is powered`, { roadOff, lotOff, lots: zones.length });
    ok(waterOff === 0, `${tag} ${when}: every lot is watered`, { waterOff });
    // Incremental vs full recompute.
    const inc = computeNetworks(w), full = computeNetworksFull(w);
    let diff = 0;
    w.tiles.forEach((_, i) => {
      const a = inc.service[i], b = full.service[i];
      if (b.powerNet >= 0 && (a.powered !== b.powered || a.powerNet < 0)) diff++;
      if (b.waterNet >= 0 && (a.watered !== b.watered || a.waterNet < 0)) diff++;
    });
    ok(diff === 0, `${tag} ${when}: incremental == full recompute`, diff);
    // Render agrees: one pole network over the (single) powered road network, poles on every edge.
    const rs = rings(w.roads), plans = planAll(w.roads, rs), pw = graphPower(w.roads, plans, rs);
    const par = pw.poles.map((_, i) => i), f = (a: number): number => (par[a] === a ? a : (par[a] = f(par[a])));
    for (const [a, b] of pw.spans) par[f(a)] = f(b);
    const comps = new Set(pw.poles.map((_, i) => f(i))).size;
    // graph connectivity (edges joined through shared nodes)
    const gp = new Map<number, number>(); const gf = (a: number): number => { const v = gp.get(a) ?? a; if (v === a) return a; const r2 = gf(v); gp.set(a, r2); return r2; };
    for (const ed of w.roads.liveEdges()) gp.set(gf(w.roads.eA[ed]), gf(w.roads.eB[ed]));
    const gcomps = new Set(w.roads.liveNodes().filter((n) => w.roads.nEdges[n].length).map(gf)).size;
    if (process.env.DBG) console.log('graph comps', gcomps, 'pole comps', comps);
    ok(comps === 1, `${tag} ${when}: the drawn wires form one network like the sim's`, comps);
    ok(pw.poles.length >= w.roads.edgeCount() - rs.reduce((n, q) => n + q.edges.length, 0), `${tag} ${when}: poles on every road`, pw.poles.length);
  };
  check('built');

  // Edits: bulldoze the + junction tile (splits power there) and rebuild it.
  s.apply('bulldoze', [[40, ez]]); T();
  const cut = zones.filter((i) => !s.status(i).powered).length;
  ok(cut > 0, `${tag} bulldozing a junction does cut the lots that hung off it (sanity)`, cut);
  s.apply('road', [[39, ez], [40, ez], [41, ez]]); s.apply('road', rect(40, ez - 1, 40, ez + 1)); T();
  check('junction rebuilt');
  // A new free road crossing existing edges (splits them into new junctions).
  r = placeFreeRoad(s, lineCubic(M(36, ez - 6), M(36, ez + 6)), 'street', {}, true, true); T();
  ok(r.ok, `${tag} crossing free road placed`, r.reason);
  zone(37, ez - 5, 37, ez - 2);
  T(10);
  check('after a splitting crossing');
  undo(s); T(); redo(s); T();
  check('after undo/redo');
}

/**
 * Parker's narrowed case: junctions created ON the outside-connection road
 * itself (splitting that edge), tile T and +, free-road T and +, several
 * splits in a row, then undo/redo — on the 64 map (4-tile outside road) and
 * the 192 map (65-tile outside road, chunk watch set active).
 */
function outsideRoad(size: number, free: boolean): void {
  setGridSize(size);
  const s = new Simulation(new World(undefined, 4242)); const w = s.world; migrateToGraph(w);
  w.regionsOwned = allRegions(); w.cash = 1e9; w.peakPop = 5000; w.tier = 3;
  const N = GRID_SIZE, ez = Math.floor(w.edgeIndex / N);
  // The generated outside road: its tiles along row ez.
  const xs: number[] = []; w.tiles.forEach((t, i) => { if (t.road && Math.floor(i / N) === ez) xs.push(i % N); });
  const xa = Math.min(...xs), xb = Math.max(...xs), tag = `[outside ${size}${free ? ' free' : ' tile'}]`;
  const T = (n = 8) => { for (let i = 0; i < n; i++) tick(s); };
  const M = (x: number, z: number) => ({ x: (x + 0.5) * 32, z: (z + 0.5) * 32 });
  // Extend the outside road inward so there is room, plant at the far (inner) end.
  s.apply('road', rect(xa - 20, ez, xa - 1, ez)); s.apply('powerPlant', [[xa - 20, ez - 1]]); T();
  // Junction x positions ON the original outside road (or near its middle on the 4-tile one).
  const js = xb - xa >= 30 ? [xa + 8, xa + 16, xa + 24] : [xa + 1, xa + 3];
  const zones: number[] = [];
  s.zoneOpt = { density: 0, depth: 1 } as never;
  js.forEach((x, k) => {
    const plus = k % 2 === 1, z0 = plus ? ez - 6 : ez + 1;
    if (free) ok(placeFreeRoad(s, lineCubic(M(x, plus ? ez - 6 : ez), M(x, ez + 6)), 'street', {}, true, true).ok, `${tag} free ${plus ? '+' : 'T'} on the outside road at x=${x}`);
    else s.apply('road', rect(x, z0, x, ez + 6));
    T();
    s.apply('residential', rect(x + (x < N - 1 && x + 1 !== js[k + 1] ? 1 : -1), ez + 2, x + (x < N - 1 && x + 1 !== js[k + 1] ? 1 : -1), ez + 5));
    for (const [zx, zz] of rect(x + (x < N - 1 && x + 1 !== js[k + 1] ? 1 : -1), ez + 2, x + (x < N - 1 && x + 1 !== js[k + 1] ? 1 : -1), ez + 5)) if (w.tiles[zz * N + zx].zone) zones.push(zz * N + zx);
    T();
  });
  const check = (when: string) => {
    let roadOff = 0, lotOff = 0;
    w.tiles.forEach((t, i) => { if (t.road && !s.status(i).powered) roadOff++; });
    // (lots whose road was undone are legitimately cut off: only lots that still touch a road count)
    const touchesRoad = (i: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => w.tiles[i + dz * N + dx]?.road);
    for (const i of zones) if (w.tiles[i].zone && touchesRoad(i) && !s.status(i).powered) lotOff++;
    ok(roadOff === 0 && lotOff === 0, `${tag} ${when}: power past every junction on the outside road`, { roadOff, lotOff, lots: zones.length });
    const inc = computeNetworks(w), full = computeNetworksFull(w);
    let diff = 0; w.tiles.forEach((_, i) => { const a = inc.service[i], b = full.service[i]; if (b.powerNet >= 0 && (a.powered !== b.powered || a.powerNet < 0)) diff++; });
    ok(diff === 0, `${tag} ${when}: incremental == full`, diff);
    const g = w.roads, p = new Map<number, number>(); const f = (a: number): number => { const v = p.get(a) ?? a; if (v === a) return a; const r = f(v); p.set(a, r); return r; };
    for (const e of g.liveEdges()) p.set(f(g.eA[e]), f(g.eB[e]));
    const nc = new Set(g.liveNodes().filter((n) => g.nEdges[n].length).map(f)).size;
    if (nc !== 1 && process.env.DBG) console.log(g.liveEdges().map((e) => `[${(g.nx[g.eA[e]] / 32 - .5).toFixed(1)},${(g.nz[g.eA[e]] / 32 - .5).toFixed(1)}]-[${(g.nx[g.eB[e]] / 32 - .5).toFixed(1)},${(g.nz[g.eB[e]] / 32 - .5).toFixed(1)}]`).join(' '), [...w.tiles.keys()].filter((i) => w.tiles[i].road && !w.graphTiles.has(i)).map((i) => `${i % N},${(i / N) | 0}`).join(' '));
    ok(nc === 1, `${tag} ${when}: graph still one network`, nc);
  };
  check('after the splits');
  if (free) { undo(s); T(); check('after undo'); undo(s); T(); check('after a second undo'); redo(s); T(); check('after redo'); }
  else { s.apply('bulldoze', [[js[0], ez]]); T(); s.apply('road', [[js[0], ez]]); T(); check('after bulldozing + rebuilding the first junction'); }
  setGridSize(64);
}

for (const size of [64, 192]) for (const free of [false, true]) outsideRoad(size, free);
scenario('new');
scenario('migrated');
console.log(fail ? `powerjunctions: ${fail} failed` : 'powerjunctions: all ok');
process.exit(fail ? 1 : 0);
