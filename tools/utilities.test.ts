/**
 * tools/utilities.test.ts — V1.6 B5: power and water on the graph.
 * The bench town plus an off-road power line to a remote plant and a pipe
 * to a remote tower: the grid networks (sim/networks.ts) and the graph
 * UtilityNet must agree on WHO is connected and HOW the consumers are
 * partitioned into networks, and per-network source capacity (plants,
 * towers, pumps) must be unchanged.
 */
import { buildTown, rect, tick, Simulation, World } from './bench/town';
import { traceRoads, traceTiles, tileCentre } from '../src/roads/bridge';
import { UtilityNet, Footprint } from '../src/roads/utilities';
import { output } from '../src/sim/networks';
import { GRID_SIZE } from '../src/sim/types';

let fail = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fail++; };

const s = new Simulation(new World(undefined, 4242));
s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; });
buildTown(s);
// Remote plant on a power line, remote tower on a pipe; a second, separate grid in the corner.
s.apply('powerLine', rect(5, 20, 9, 20)); s.apply('powerPlant', [[4, 20]]);
s.apply('waterPipe', rect(5, 30, 9, 30)); s.apply('waterTower', [[4, 30]]);
s.apply('road', rect(56, 56, 62, 56)); s.apply('powerPlant', [[56, 57]]); s.apply('waterTower', [[58, 57]]);
s.apply('residential', rect(59, 57, 62, 57));
for (let i = 0; i < 300; i++) tick(s);
const w = s.world, N = GRID_SIZE, T = w.tiles;
const roads = traceRoads(w).g;
const sourcesOf = (kind: 'power' | 'water'): Array<Footprint & { i: number }> => {
  const out: Array<Footprint & { i: number }> = [];
  T.forEach((t, i) => {
    const src = kind === 'power' ? t.structure === 'powerPlant' || t.structure === 'windTurbine' || t.structure === 'nuclearPlant' : t.structure === 'waterTower' || t.structure === 'pumpStation';
    if (src) out.push({ i, pts: [tileCentre(i)], capacity: output(t, kind, w.wind) });
  });
  return out;
};
for (const kind of ['power', 'water'] as const) {
  const util = traceTiles(w, (t) => (kind === 'power' ? t.powerLine : t.waterPipe) && !t.road).g;
  const srcs = sourcesOf(kind);
  const net = new UtilityNet(roads, util, srcs);
  const svc = s.net.service;
  let agree = 0, total = 0;
  const map = new Map<number, number>(), back = new Map<number, number>();
  let partitionOk = true;
  T.forEach((t, i) => {
    if (!(t.zone || t.structure === 'service' || t.structure === 'building')) return;
    total++;
    const gnet = kind === 'power' ? svc[i].powerNet : svc[i].waterNet;
    const comp = net.componentOf({ pts: [tileCentre(i)] });
    if ((gnet >= 0) === (comp >= 0)) agree++;
    if (gnet >= 0 && comp >= 0) {
      if ((map.get(gnet) ?? comp) !== comp || (back.get(comp) ?? gnet) !== gnet) partitionOk = false;
      map.set(gnet, comp); back.set(comp, gnet);
    }
  });
  ok(total > 100 && agree === total, `${kind}: grid and graph agree on every consumer's connection`, { total, agree });
  ok(partitionOk && map.size >= 2, `${kind}: same partition into networks`, { networks: map.size });
  // capacity per network: compare raw source output sums (grid capacity may be
  // trimmed for unpowered pumps; compare like with like).
  const gridCap = new Map<number, number>();
  for (const sct of srcs) { const gnet = kind === 'power' ? svc[sct.i].powerNet : svc[sct.i].waterNet; if (gnet >= 0) gridCap.set(gnet, (gridCap.get(gnet) ?? 0) + (sct.capacity ?? 0)); }
  let capOk = true; for (const [gnet, comp] of map) if (Math.abs((gridCap.get(gnet) ?? 0) - (net.capacity.get(comp) ?? 0)) > 1e-9) capOk = false;
  ok(capOk, `${kind}: source capacity per network unchanged`, [...map].map(([gn, c]) => [gridCap.get(gn), net.capacity.get(c)]));
}
// incremental: adding a conduit edge joins two components without a rebuild
{
  const { g } = traceTiles(w, (t) => t.road);
  const util = traceTiles(w, () => false).g;
  const a = { pts: [{ x: 0.5 * 32, z: 0.5 * 32 }], capacity: 10 };
  const net = new UtilityNet(g, util, [a]);
  const far = { pts: [{ x: 3.5 * 32, z: 0.5 * 32 }] };
  ok(net.componentOf(far) < 0, 'incremental: unconnected consumer has no network');
  const n0 = util.addNode({ x: 1.5 * 32, z: 0.5 * 32 }), n1 = util.addNode({ x: 2.5 * 32, z: 0.5 * 32 });
  util.addEdge(n0, n1, Float64Array.of(48, 16, 58.67, 16, 69.33, 16, 80, 16), 'street');
  ok(net.componentOf(far) >= 0, 'a new line edge reaches the consumer (rebuilt on graph version change)');
}
if (fail) { console.log(`${fail} failures`); process.exit(1); } console.log('utilities: all ok');
