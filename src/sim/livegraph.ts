/**
 * sim/livegraph.ts — OASIS: the ROAD GRAPH as the LIVE source of truth for traffic.
 *
 * WHAT CHANGED
 *   Up to 1.6 the city's real trips (commuters, moving-in cars, freight,
 *   garbage/service trucks...) all drove on the TILE grid (sim/traffic.ts),
 *   and roads/gtraffic.ts only moved DECORATIVE random cars over the free
 *   roads. Now every trip that starts AND ends on a graph road is handed to
 *   a GraphTraffic owned by the simulation: it pathfinds on the graph (A*),
 *   drives graph lanes, obeys graph junction control (signals with
 *   right-on-red, stop signs, roundabout yielding) and fires the trip's
 *   onArrive when it gets there. The cars you see on a free road ARE the
 *   city's trips.
 *
 * WHY "BOTH ENDS ON THE GRAPH"
 *   Tile-only roads still exist (old saves before they are migrated, tile
 *   roundabouts, a tile road the graph could not absorb). A trip touching
 *   one of those, or one the graph cannot route (no connection, entry lane
 *   full), FALLS BACK to the tile router, which still sees every road tile
 *   because graph roads are rasterised onto tiles (roads/bridge.ts). So no
 *   trip is ever lost by the switch, and worlds without graph roads (all
 *   the 1.5-style tests: parity, signals, right-on-red, roundabouts) behave
 *   exactly as before: this module is never consulted for them.
 *
 * TILE → ROAD POSITION
 *   Trip generators speak in road TILES. Each graph-road tile is mapped
 *   once per graph version to the point of the graph closest to the tile
 *   centre: (edge, arc length along it). Cars pull out there and stop there
 *   (GraphTraffic.spawnAt), mid-road at the building's frontage — so a home
 *   on a curved road really drives along that curve. Built lazily, cached by
 *   graph version (edges sampled every 4 m).
 *
 * SPEED
 *   Tile cars move SPEED.car = 1.5 tiles (48 m) per game-second; graph lanes
 *   use real metres per second (street 13 m/s). Graph time is scaled by
 *   TIME_SCALE so a trip takes about as long in game time on either system
 *   (economy, commute times and truck fleets stay balanced).
 *
 * GRAPH EDITS
 *   When the graph's version changes (a road placed, split, bulldozed or
 *   undone) edge and node ids may be invalid. Live trips are COMPLETED on
 *   the spot (GraphTraffic.finishAll) — the delivery lands, the commuter is
 *   at work — and a fresh GraphTraffic is built. Edits are rare and
 *   player-driven, so this is cheap and never strands a trip.
 */
import { GraphTraffic } from '../roads/gtraffic';
import { ROAD_SPEC, TILE_M } from '../roads/graph';
import { tileCentre } from '../roads/bridge';
import { at, tAtLength } from '../roads/bezier';
import { GRID_SIZE } from './types';
import type { World } from './grid';
import type { VehicleKind } from './traffic';

/** Game-seconds → graph-seconds: 1.5 tiles/s (tile car) ÷ street speed in m/s. */
export const TIME_SCALE = (1.5 * TILE_M) / ROAD_SPEC.street.speed;

export class LiveGraphTraffic {
  /** The live traffic on the current graph (null until the first trip). */
  gt: GraphTraffic | null = null;
  private version = -1;
  private roads: World['roads'] | null = null;
  /** Road tile → closest graph point (edge, arc metres a→b, distance²) (per graph version). */
  private tilePos = new Map<number, { e: number; arc: number; d2: number }>();
  /** Lifetime counters (survive graph rebuilds): for tests and the info panel. */
  stats = { spawned: 0, arrived: 0, gaveUp: 0, finishedOnEdit: 0, fellBack: 0, rightOnRed: 0, yields: 0 };

  /** Is world `w` a GRAPH world (has graph roads at all)? */
  static active(w: World): boolean { return w.graphTiles.size > 0 && w.roads.edgeCount() > 0; }

  /** Bring the live traffic in step with w.roads (new graph object or new version). */
  private sync(w: World): GraphTraffic {
    if (this.gt && this.roads === w.roads && this.version === w.roads.version) return this.gt;
    // Swap in the new traffic FIRST, then complete the old trips: their
    // onArrive callbacks often start the next trip (commute home, parking
    // search), and those must land on the NEW graph, not re-enter this sync.
    const old = this.gt;
    this.gt = new GraphTraffic(w.roads);
    this.roads = w.roads; this.version = w.roads.version;
    this.tilePos.clear();
    const g = w.roads;
    for (const e of g.liveEdges()) {
      const len = g.eLen[e], n = Math.max(1, Math.ceil(len / 4));
      for (let k = 0; k <= n; k++) {
        const arc = (k / n) * len, p = at(g.eCurve[e], tAtLength(g.eLut[e], arc));
        const tx = Math.floor(p.x / TILE_M), tz = Math.floor(p.z / TILE_M);
        if (tx < 0 || tz < 0 || tx >= GRID_SIZE || tz >= GRID_SIZE) continue;
        const i = tz * GRID_SIZE + tx, c = tileCentre(i), d2 = (p.x - c.x) ** 2 + (p.z - c.z) ** 2;
        const old = this.tilePos.get(i);
        if (!old || d2 < old.d2) this.tilePos.set(i, { e, arc, d2 });
      }
    }
    if (old) { this.absorb(old); this.stats.finishedOnEdit += old.finishAll(); }
    return this.gt;
  }
  /** Fold a retiring GraphTraffic's counters into the lifetime stats. */
  private absorb(gt: GraphTraffic): void {
    const a = this.stats, b = gt.stats;
    a.arrived += b.arrived; a.gaveUp += b.gaveUp; a.rightOnRed += b.rightOnRed; a.yields += b.yields;
    b.arrived = b.gaveUp = b.rightOnRed = b.yields = 0;
  }

  /**
   * Try to run a trip from road tile `from` to road tile `to` on the graph.
   * Returns true when the graph took it (or it was a zero-length trip that
   * arrived at once); false means "use the tile router instead".
   */
  spawn(w: World, kind: VehicleKind, from: number, to: number, purpose: string, color: number, onArrive?: () => void): boolean {
    if (!LiveGraphTraffic.active(w) || !w.graphTiles.has(from) || !w.graphTiles.has(to)) return false;
    const gt = this.sync(w);
    const a = this.tilePos.get(from), b = this.tilePos.get(to);
    if (!a || !b) { this.stats.fellBack++; return false; }
    if (from === to) {
      // Same tile: arrive at once, like a single-tile tile trip (Traffic.spawn path.length < 2).
      this.stats.spawned++; this.stats.arrived++; onArrive?.();
      return true;
    }
    const v = gt.spawnAt(a.e, a.arc, b.e, b.arc, { kind, color, purpose, onArrive });
    if (!v) { this.stats.fellBack++; return false; } // no graph route, or entry lane full: tile router
    this.stats.spawned++;
    return true;
  }

  /** Move the live graph vehicles by `dt` game-seconds. */
  update(w: World, dt: number): void {
    if (!this.gt) return;
    const gt = this.sync(w); // completes trips if the graph was edited since the last frame
    gt.update(dt * TIME_SCALE);
    this.absorb(gt);
  }

  /** Live graph vehicles of this kind (fleet caps and car limits count them too). */
  count(kind: VehicleKind): number {
    let n = 0;
    if (this.gt) for (const v of this.gt.vehicles) if (!v.done && v.trip?.kind === kind) n++;
    return n;
  }
  /** Vehicles currently on the graph (renderer). */
  get vehicles() { return this.gt?.vehicles ?? []; }
}
