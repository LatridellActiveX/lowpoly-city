/**
 * sim/garbage.ts — V1.5b stage E: GARBAGE.
 *
 * Plain TypeScript (no Three.js / DOM).
 *
 * BUILD-UP: once the city first reaches GARBAGE_START people, every
 * operating building (host tile with size units) adds GARBAGE_RATE × units
 * to tile.garbage each tick, up to G_MAX. Above G_WARN the renderer draws
 * bin-bag piles and a 🗑 warning icon, and the tile loses land value
 * (environment.ts LV_GARBAGE) and building health (redevelop.ts).
 *
 * COLLECTION: a LANDFILL (services.ts Svc.Dump, a 2×2 building that unlocks
 * at 1,000 people) owns `fleet` garbage trucks. Its service area is its whole
 * ROAD NETWORK (roadnet.ts): every building whose street connects to the
 * landfill's is served, wherever it is on the map. Each tick a dump with a free
 * truck sends it along the roads to the best uncollected building (most garbage,
 * a little preference for nearer ones; at least G_PICKUP). On arrival the truck
 * empties that tile AND its neighbours (one stop serves the street) and, while it
 * still has room (TRUCK_CAPACITY), drives on to the next nearby pile — up to
 * MAX_STOPS stops per run — before driving back; the truck is free again when it gets home. Trucks are ordinary traffic (purpose
 * 'garbage', green), so they queue at lights like everybody else.
 *
 * LANDFILL CAPACITY (V1.6): each truck carries what it picked up back to its
 * landfill, which stores the total in its anchor tile's `stock`. A landfill
 * holds LANDFILL_MAX; once full it stops sending trucks (and its model
 * switches to the capped, grassed-over "full" stage) until you build a new
 * one. RECYCLING CENTERS (Svc.Recycling) cut how fast buildings in their
 * radius make garbage in the first place (RECYCLE_CUT), so landfills last longer.
 * They also run their own fleet (12 trucks, twice a landfill's 6) that collects garbage and
 * BURNS it (no storage, so they never fill up) — and that burning is what powers them (networks.ts
 * makes them a 5,000 power source like a coal plant). Landfill trucks help: with a recycling
 * center in range, every third landfill truck (or any idle one) hauls stored garbage over there to
 * be burned, which frees landfill space (even a FULL landfill keeps hauling).
 */
import { GRID_SIZE, Tile } from './types';
import type { World } from './grid';
import { roadNextTo, Traffic } from './traffic';
import { Coverage, SERVICE_DEFS, serviceAnchors, serviceRoad, Svc } from './services';
import { roadComponents } from './roadnet';
import { RECYCLE_STOCK_MAX, RECYCLE_YIELD, recycleMode } from './recycleMode';
import { G_MAX, G_WARN, garbageMax, garbageMult } from './garbageRules';
export { G_MAX, G_WARN };

export const GARBAGE_START = 800;
/** Parker tune: halved 0.01 → 0.005 (garbage piled up too often). */
export const GARBAGE_RATE = 0.005;
export const G_PICKUP = 6;
/** A garbage truck holds this much (it keeps visiting piles until it is nearly full) and makes at most MAX_STOPS stops per run. */
export const TRUCK_CAPACITY = 200, MAX_STOPS = 8;
/** Target choice: score = garbage − DIST_W × tiles away, so far piles still get served but near ones go first. */
const DIST_W = 0.15;
/** A follow-up stop must be within this many tiles of the truck's last stop. */
const NEXT_STOP_RANGE = 36;
/** After a pickup run fails to start, leave that pile alone for this many ticks. */
const RETRY_TICKS = 20;
/** Piles + 🗑 warning from here (was 30). */
export const GARBAGE_PURPOSE = 'garbage';
/** Before the dump unlocks (1,000 people) garbage penalties are scaled by this. */
export const EARLY_PENALTY = 0.3;
export const garbagePenalty = (peakPop: number) => (peakPop < 1000 ? EARLY_PENALTY : 1);
export const GARBAGE_TRUCK_COLOR = 0x3c8d40;

/** V1.6: how much garbage one landfill can take before it is full (balance knob). */
export const LANDFILL_MAX = 12000;
/** Model stages: 0 = empty lined pit … 4 = nearly full … 5 = FULL (capped and grassed over). */
export const LANDFILL_STAGES = 6;
/** How full (0..1) the landfill whose anchor tile is `t` is. */
export const landfillFill = (t: Tile) => Math.min(1, Math.max(0, t.stock) / LANDFILL_MAX);
/** Which model stage the landfill is in; the last stage is reserved for a completely full one. */
export const landfillStage = (t: Tile) => { const f = landfillFill(t); return f >= 1 ? LANDFILL_STAGES - 1 : Math.min(LANDFILL_STAGES - 2, Math.floor(f * (LANDFILL_STAGES - 1))); };
export const landfillFull = (t: Tile) => t.stock >= LANDFILL_MAX;
/** V1.6: a landfill truck hauls up to this much stored garbage to a recycling center per trip (needs at least HAUL_MIN stored; center within HAUL_RANGE tiles). */
export const HAUL_LOAD = 200, HAUL_MIN = 150, HAUL_RANGE = 48;
/** V1.6: a recycling center covering a building cuts its garbage build-up by up to this much (at full coverage). */
export const RECYCLE_CUT = 0.45;

export class Garbage {
  /** Trucks out per dump anchor. */
  private out = new Map<number, number>();
  /** Tiles a truck is already heading to. */
  private targeted = new Set<number>();
  /** Tiles a truck could not reach, by tick they may be tried again. */
  private retryAt = new Map<number, number>();
  stats = { collected: 0, trips: 0, hauled: 0, burned: 0, maxLoad: 0, maxStops: 0, recycled: 0 };
  /** Pickup runs since each landfill's last haul to a recycling center. */
  private sinceHaul = new Map<number, number>();
  /** Garbage burned per recycling center anchor. */
  private burnedAt = new Map<number, number>();
  /** True when some landfill changed model stage this tick (the sim then bumps `version` so the renderer redraws it). */
  stageChanged = false;
  private notices: string[] = [];
  /** Messages for the notification log (landfill nearly full / full). */
  takeNotices(): string[] { const n = this.notices; this.notices = []; return n; }

  outOf(dump: number): number { return this.out.get(dump) ?? 0; }

  tick(world: World, traffic: Traffic, operating: (i: number) => boolean, cov: Coverage | null = null): void {
    const tiles = world.tiles;
    if (world.peakPop < GARBAGE_START) return;
    // 1. Build-up (V1.6: recycling centers cut it where they cover).
    const rec = cov?.by[Svc.Recycling];
    world.chunks.activeTilesSorted().forEach((i) => { const t = tiles[i]; // V1.6 A2
      if (t.zone && t.level > 0 && t.units > 0 && operating(i)) t.garbage = Math.min(garbageMax(t.zone), t.garbage + GARBAGE_RATE * garbageMult(t.zone) * t.units * (rec ? 1 - RECYCLE_CUT * rec[i] : 1));
    });
    // 2. Dispatch. Recycling centers first (they burn what they collect, so they never fill up), then landfills.
    for (const d of serviceAnchors(world, Svc.Recycling)) this.dispatch(world, traffic, d, true);
    for (const d of serviceAnchors(world, Svc.Dump)) this.dispatch(world, traffic, d, false);
  }

  /** The nearest road-connected recycling center to landfill d (within HAUL_RANGE tiles), or -1. */
  private nearestRecycler(world: World, d: number): number {
    const N = GRID_SIZE, dx = d % N, dz = Math.floor(d / N);
    let best = -1, bestD = HAUL_RANGE + 1;
    for (const r of serviceAnchors(world, Svc.Recycling)) {
      const dist = Math.abs((r % N) - dx) + Math.abs(Math.floor(r / N) - dz);
      if (dist < bestD && serviceRoad(world.tiles, r) >= 0) { bestD = dist; best = r; }
    }
    return best;
  }

  /** One dispatch decision for the service at anchor d: a pickup run, or (landfills) a haul to a recycling center. */
  private dispatch(world: World, traffic: Traffic, d: number, recycler: boolean): void {
    const tiles = world.tiles, N = GRID_SIZE;
    const def = SERVICE_DEFS[recycler ? Svc.Recycling : Svc.Dump];
    if (this.outOf(d) >= def.fleet) return;
    const home = serviceRoad(tiles, d);
    if (home < 0) return;
    const full = !recycler && landfillFull(tiles[d]);
    // Landfills with a recycling center in range send every third truck (or any idle one) hauling stored garbage there to be burned.
    const rc = recycler ? -1 : this.nearestRecycler(world, d);
    // The player can turn the automatic haul off per landfill (world.noAutoHaul) and send it by hand (world.haulNow).
    const manual = !recycler && world.haulNow.has(d);
    if (manual && (rc < 0 || tiles[d].stock < HAUL_MIN)) world.haulNow.delete(d);
    const auto = !world.noAutoHaul.has(d);
    const canHaul = rc >= 0 && tiles[d].stock >= HAUL_MIN && (auto || world.haulNow.has(d));
    let best = -1;
    if (!full) best = this.pickTarget(world, home, N, tiles);
    if (canHaul && (best < 0 || world.haulNow.has(d) || (this.sinceHaul.get(d) ?? 0) >= 2) && this.haul(world, traffic, d, rc, home)) { this.sinceHaul.set(d, 0); return; }
    if (best < 0) return;
    const stop = roadNextTo(tiles, best);
    if (stop < 0) { this.retryAt.set(best, world.tick + RETRY_TICKS); return; }
    if (this.run(world, traffic, d, recycler, home, home, stop, best, 0, 1)) {
      this.out.set(d, this.outOf(d) + 1); this.stats.trips++; this.sinceHaul.set(d, (this.sinceHaul.get(d) ?? 0) + 1);
    } else this.retryAt.set(best, world.tick + RETRY_TICKS);
  }

  /** The best uncollected pile reachable from `home` on the same road network (score = garbage − DIST_W × distance), or -1. */
  private pickTarget(world: World, home: number, N: number, tiles: Tile[], from = home, maxDist = Infinity): number {
    const comp = roadComponents(world), hc = comp[home];
    if (!hc) return -1;
    const fx = from % N, fz = Math.floor(from / N);
    let best = -1, bestScore = -Infinity;
    world.chunks.activeTilesSorted().forEach((i) => {
      const g = tiles[i].garbage;
      if (g < G_PICKUP || this.targeted.has(i) || (this.retryAt.get(i) ?? 0) > world.tick) return;
      const dist = Math.abs((i % N) - fx) + Math.abs(Math.floor(i / N) - fz);
      if (dist > maxDist) return;
      const score = g - DIST_W * dist;
      if (score <= bestScore) return;
      const stop = roadNextTo(tiles, i);
      if (stop < 0 || comp[stop] !== hc) return;
      bestScore = score; best = i;
    });
    return best;
  }

  /**
   * One leg of a pickup run: a truck drives `from` → `stop`, empties `target` (and its
   * neighbours) into its remaining room, then either continues to the next nearby pile or
   * drives home and unloads. `load` is what it carries on arrival, `stops` how many it has made.
   * Returns false when the first leg could not start.
   */
  private run(world: World, traffic: Traffic, d: number, recycler: boolean, home: number, from: number, stop: number, target: number, load: number, stops: number): boolean {
    const tiles = world.tiles, N = GRID_SIZE;
    const ok = traffic.spawn(world, 'truck', from, stop, `${GARBAGE_PURPOSE}: collecting`, GARBAGE_TRUCK_COLOR, () => {
      this.targeted.delete(target);
      const got = load + this.collect(world, target, TRUCK_CAPACITY - load);
      this.stats.maxLoad = Math.max(this.stats.maxLoad, got); this.stats.maxStops = Math.max(this.stats.maxStops, stops);
      const back = () => { if (recycler) this.burn(world, d, got); else this.deposit(world, d, got); this.out.set(d, Math.max(0, this.outOf(d) - 1)); };
      if (got < TRUCK_CAPACITY * 0.85 && stops < MAX_STOPS) {
        const next = this.pickTarget(world, home, N, tiles, stop, NEXT_STOP_RANGE);
        const nstop = next >= 0 ? roadNextTo(tiles, next) : -1;
        if (next >= 0 && nstop >= 0 && nstop !== stop) {
          this.targeted.add(next);
          if (this.run(world, traffic, d, recycler, home, stop, nstop, next, got, stops + 1)) return;
          this.targeted.delete(next);
          this.retryAt.set(next, world.tick + RETRY_TICKS);
        }
      }
      // Drive home; the truck is free once it's back (or if no route home), then unloads (landfill: stores it, recycler: burns it).
      if (!traffic.spawn(world, 'truck', stop, home, `${GARBAGE_PURPOSE}: returning`, GARBAGE_TRUCK_COLOR, back)) back();
    });
    if (ok && stops === 1) this.targeted.add(target);
    return ok;
  }

  /** A truck takes stored garbage from landfill d to recycling center rc, burns it there and drives home. False if it could not start. */
  private haul(world: World, traffic: Traffic, d: number, rc: number, home: number): boolean {
    const tiles = world.tiles, lf = tiles[d];
    const dest = serviceRoad(tiles, rc);
    if (dest < 0) return false;
    const load = Math.min(lf.stock, HAUL_LOAD);
    const ok = traffic.spawn(world, 'truck', home, dest, `${GARBAGE_PURPOSE}: hauling to recycling`, GARBAGE_TRUCK_COLOR, () => {
      this.burn(world, rc, load);
      const free = () => this.out.set(d, Math.max(0, this.outOf(d) - 1));
      if (!traffic.spawn(world, 'truck', dest, home, `${GARBAGE_PURPOSE}: returning`, GARBAGE_TRUCK_COLOR, free)) free();
    });
    if (!ok) return false;
    const before = landfillStage(lf);
    lf.stock = Math.max(0, lf.stock - load); // the truck is loaded at the landfill gate
    if (landfillStage(lf) !== before) this.stageChanged = true;
    this.out.set(d, this.outOf(d) + 1);
    this.stats.hauled += load;
    return true;
  }

  /** Garbage burned at the recycling center anchored at rc (powers the city; see networks.ts). */
  private burn(world: World, rc: number, amount: number): void {
    this.burnedAt.set(rc, (this.burnedAt.get(rc) ?? 0) + amount);
    this.stats.burned += amount;
    // IND-6: in a product mode every 100 garbage also yields 8 plastics / materials
    // into the center's stock (recycleMode.ts); goods.ts ships them.
    const t = world.tiles[rc];
    if (t && recycleMode(t)) { const add = amount * RECYCLE_YIELD; t.stock = Math.min(RECYCLE_STOCK_MAX, t.stock + add); this.stats.recycled += add; }
  }
  /** Total garbage burned so far by the recycling center anchored at rc (this session). */
  burnedBy(rc: number): number { return this.burnedAt.get(rc) ?? 0; }

  /** Unload a truck into the landfill anchored at tile d (it may have been bulldozed meanwhile). */
  private deposit(world: World, d: number, amount: number): void {
    const t = world.tiles[d];
    if (t.structure !== 'service' || t.kind !== Svc.Dump || t.part) return;
    const before = landfillStage(t);
    t.stock = Math.min(LANDFILL_MAX, t.stock + amount);
    const after = landfillStage(t);
    if (after === before) return;
    this.stageChanged = true;
    if (after === LANDFILL_STAGES - 1) this.notices.push('🗑 A landfill is FULL: it stops taking garbage, so piles will build up in the streets. Build a new landfill (and recycling centers to slow the flow).');
    else if (after === LANDFILL_STAGES - 2) this.notices.push('🗑 A landfill is almost full. Plan a new one — and recycling centers help.');
  }

  /** Empty the tile and its 8 neighbours into a truck with `room` left (one stop serves the street); returns the garbage picked up. */
  private collect(world: World, i: number, room: number): number {
    const N = GRID_SIZE, x = i % N, z = Math.floor(i / N);
    let total = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const a = x + dx, b = z + dz;
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const t = world.tiles[b * N + a];
      const take = Math.min(t.garbage, room - total);
      if (take <= 0) continue;
      this.stats.collected += take;
      total += take;
      t.garbage -= take;
    }
    return total;
  }
}
