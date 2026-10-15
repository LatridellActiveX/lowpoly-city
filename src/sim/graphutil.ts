/**
 * sim/graphutil.ts — OASIS: GRAPH UTILITIES wired into the live sim.
 *
 * Power and water still flood-fill over tiles (sim/networks.ts): graph roads
 * are rasterised onto road tiles, which carry power and water, so a building
 * 4-next to a rasterised tile is connected exactly as in 1.5. What the tile
 * fill MISSES is the geometry of a free road: on a curve, zone-block cells
 * sit along the true centreline, and a building can be well within reach of
 * the curved road while its tile is not 4-adjacent to any tile the curve was
 * rasterised onto (it touches only diagonally, or one tile further out).
 *
 * roads/utilities.ts UtilityNet answers connectivity on the real geometry:
 * road edges + power-line / pipe conduits + sources, with REACH (32 m, one
 * tile) around every sampled point. This pass, run after every network
 * solve in a GRAPH WORLD (world.graphRoads), gives each such
 * "graph-only connected" consumer:
 *   - the tile network its graph component belongs to (found through the
 *     source tiles, whose tile network ids are known), and
 *   - power / water from that network's SPARE capacity, in a stable order
 *     (ascending tile index), so it never steals from tile-connected users.
 *
 * COST: the UtilityNet and the list of graph-only consumers are rebuilt only
 * when the road graph or the tile topology changes (graph version +
 * chunks.topoRev). Per tick it is one pass over that (usually short) list.
 * Pure tile worlds (all tests before OASIS) never run it.
 */
import { UtilityNet, Footprint } from '../roads/utilities';
import { tileCentre, traceTiles } from '../roads/bridge';
import { demandOf, isSource, output, NetworkResult } from './networks';
import type { World } from './grid';

type Kind = 'power' | 'water';
interface Cache { key: string; tiles: Set<number>; /** last served flag per extra (power then water), to report only CHANGES */ last: Map<string, boolean>; extra: Record<Kind, Array<{ i: number; comp: number }>>; srcOf: Record<Kind, Map<number, number[]>> }
const caches = new WeakMap<World, Cache>();
/**
 * Tiles this pass serves (graph-only consumers). networks.ts skips them in
 * its "served flag flipped?" watch loop: the tile fill would always see them
 * as unserved and this pass as served, which would look like a flip every
 * tick and needlessly bust served-dependent caches.
 */
export function graphOnly(w: World): Set<number> | undefined { return caches.get(w)?.tiles; }

/** Rebuild the graph-only consumer lists (topology changed). */
function build(w: World, res: NetworkResult, key: string): Cache {
  const c: Cache = { key, tiles: new Set(), last: new Map(), extra: { power: [], water: [] }, srcOf: { power: new Map(), water: new Map() } };
  const active = w.chunks.activeTilesSorted(); // V1.6 A2: built-up chunks only
  for (const kind of ['power', 'water'] as const) {
    const util = traceTiles(w, (t) => (kind === 'power' ? t.powerLine : t.waterPipe) && !t.road).g;
    const sources: Array<Footprint & { i: number }> = [];
    for (const i of active) if (isSource(w.tiles[i], kind)) sources.push({ i, pts: [tileCentre(i)], capacity: Math.max(1, output(w.tiles[i], kind, 1)) });
    const net = new UtilityNet(w.roads, util, sources);
    // Which graph component feeds which TILE networks (via the source tiles).
    const srcOf = c.srcOf[kind];
    for (const s of sources) {
      const comp = net.componentOf({ pts: s.pts }), gnet = kind === 'power' ? res.service[s.i].powerNet : res.service[s.i].waterNet;
      if (comp >= 0 && gnet >= 0) { const l = srcOf.get(comp) ?? []; if (!l.includes(gnet)) l.push(gnet); srcOf.set(comp, l); }
    }
    for (const i of active) {
      const t = w.tiles[i];
      if (t.zone === null || t.part) continue; // consumers: zoned tiles (multi-tile parts go through their anchor)
      const sv = res.service[i];
      if ((kind === 'power' ? sv.powerNet : sv.waterNet) >= 0) continue; // the tile fill already connects it
      const comp = net.componentOf({ pts: [tileCentre(i)] });
      if (comp >= 0 && srcOf.has(comp)) { c.extra[kind].push({ i, comp }); c.tiles.add(i); }
    }
  }
  return c;
}

/**
 * Patch a fresh network result in place: connect graph-only consumers and
 * serve them from spare capacity. Returns how many of them CHANGED served
 * state since the last call (the caller bumps servedRev only then, so a
 * stable city does not invalidate served-dependent caches every tick).
 */
export function applyGraphUtilities(w: World, res: NetworkResult): number {
  if (!w.graphRoads) return 0;
  const key = `${w.roads.version}|${w.chunks.topoRev}`;
  let c = caches.get(w);
  if (!c || c.key !== key) { c = build(w, res, key); caches.set(w, c); }
  let n = 0;
  for (const kind of ['power', 'water'] as const) {
    const nets = kind === 'power' ? res.power : res.water;
    for (const { i, comp } of c.extra[kind]) {
      const sv = res.service[i], t = w.tiles[i];
      const gnet = c.srcOf[kind].get(comp)![0];
      const net = nets[gnet]; if (!net) continue;
      const want = demandOf(t, kind);
      const ok = net.capacity - net.supplied >= want;
      if (ok) { net.supplied += want; } else net.outages++;
      net.demand += want;
      if (kind === 'power') { sv.powerNet = gnet; sv.powered = ok; } else { sv.waterNet = gnet; sv.watered = ok; }
      const k = kind + i;
      if (c.last.get(k) !== ok) { c.last.set(k, ok); n++; }
    }
  }
  return n;
}
