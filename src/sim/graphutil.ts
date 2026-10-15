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
interface Cache { key: string;
  /**
   * NEBULA fix (Parker's "not enough capacity" with 629 spare): graph-only
   * tiles PER UTILITY. This used to be ONE set for power and water, and
   * networks.ts skipped BOTH flags of every tile in it. A lot that the tile
   * flood connects for POWER (roads carry power) but reaches WATER only
   * through the graph (in the tile flood only pipes carry water) sat in the
   * set because of water, so its power flag was never written: it kept the
   * `powered: false` a fresh topology starts with while its powerNet was a
   * real network — status() then said "outage: not enough capacity".
   * Now each utility only skips the tiles THIS pass serves for THAT utility.
   */
  tiles: Record<Kind, Set<number>>; /** last served flag per extra (power then water), to report only CHANGES */ last: Map<string, boolean>; extra: Record<Kind, Array<{ i: number; comp: number }>>; srcOf: Record<Kind, Map<number, number[]>> }
const caches = new WeakMap<World, Cache>();
/**
 * Tiles this pass serves (graph-only consumers). networks.ts skips them in
 * its "served flag flipped?" watch loop: the tile fill would always see them
 * as unserved and this pass as served, which would look like a flip every
 * tick and needlessly bust served-dependent caches.
 */
export function graphOnly(w: World, kind: Kind): Set<number> | undefined { return caches.get(w)?.tiles[kind]; }

/**
 * NEBULA fix: make the graph-only lists match the CURRENT topology BEFORE
 * networks.ts runs its served-flag loop (it used to read the previous tick's
 * lists, then this pass rebuilt them afterwards — one tick late).
 *
 * `tileNet` is the TILE FLOOD's own network ids per utility (networks.ts
 * topo.powerNet / topo.waterNet). We decide "already connected by the tile
 * fill?" from those, NOT from res.service: this pass writes powerNet /
 * waterNet into the shared service objects, so after one tick they no longer
 * tell the two apart (that made a rebuild without a topology change drop
 * graph-only tiles and leave their flags stale).
 *
 * Returns the tiles that WERE graph-only for a utility but are not any more,
 * so the caller can hand them back to the tile result.
 */
export function prepareGraphUtilities(w: World, res: NetworkResult, tileNet: Record<Kind, Int32Array>): Record<Kind, number[]> {
  const dropped: Record<Kind, number[]> = { power: [], water: [] };
  if (!w.graphRoads) return dropped;
  const key = `${w.roads.version}|${w.chunks.topoRev}`;
  const old = caches.get(w);
  if (old && old.key === key) return dropped;
  const c = build(w, res, key, tileNet);
  caches.set(w, c);
  if (old) for (const kind of ['power', 'water'] as const) for (const i of old.tiles[kind]) if (!c.tiles[kind].has(i)) dropped[kind].push(i);
  return dropped;
}

/** Rebuild the graph-only consumer lists (topology changed). */
function build(w: World, res: NetworkResult, key: string, tileNet?: Record<Kind, Int32Array>): Cache {
  const c: Cache = { key, tiles: { power: new Set(), water: new Set() }, last: new Map(), extra: { power: [], water: [] }, srcOf: { power: new Map(), water: new Map() } };
  const active = w.chunks.activeTilesSorted(); // V1.6 A2: built-up chunks only
  for (const kind of ['power', 'water'] as const) {
    const util = traceTiles(w, (t) => (kind === 'power' ? t.powerLine : t.waterPipe) && !t.road).g;
    const sources: Array<Footprint & { i: number }> = [];
    for (const i of active) if (isSource(w.tiles[i], kind)) sources.push({ i, pts: [tileCentre(i)], capacity: Math.max(1, output(w.tiles[i], kind, 1)) });
    const net = new UtilityNet(w.roads, util, sources);
    // Which graph component feeds which TILE networks (via the source tiles).
    const srcOf = c.srcOf[kind];
    for (const s of sources) {
      // source tiles are always in their own tile network: read it from the tile flood when we have it
      const comp = net.componentOf({ pts: s.pts }), gnet = tileNet ? tileNet[kind][s.i] : kind === 'power' ? res.service[s.i].powerNet : res.service[s.i].waterNet;
      if (comp >= 0 && gnet >= 0) { const l = srcOf.get(comp) ?? []; if (!l.includes(gnet)) l.push(gnet); srcOf.set(comp, l); }
    }
    for (const i of active) {
      const t = w.tiles[i];
      if (t.zone === null || t.part) continue; // consumers: zoned tiles (multi-tile parts go through their anchor)
      const sv = res.service[i];
      // the tile fill already connects it (tile-flood ids, see prepareGraphUtilities)
      if ((tileNet ? tileNet[kind][i] : kind === 'power' ? sv.powerNet : sv.waterNet) >= 0) continue;
      const comp = net.componentOf({ pts: [tileCentre(i)] });
      if (comp >= 0 && srcOf.has(comp)) { c.extra[kind].push({ i, comp }); c.tiles[kind].add(i); }
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
  if (!c || c.key !== key) { c = build(w, res, key); caches.set(w, c); } // normally prepared already by networks.ts
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
