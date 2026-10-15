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
 * at 1,000 people) owns `fleet` garbage trucks. Each tick a dump with a free truck sends it along
 * the roads to the fullest uncollected building within its radius (at
 * least G_PICKUP garbage). On arrival the truck empties that tile AND its
 * neighbours (one stop serves the street), then drives back; the truck is
 * free again when it gets home. Trucks are ordinary traffic (purpose
 * 'garbage', green), so they queue at lights like everybody else.
 *
 * LANDFILL CAPACITY (V1.6): each truck carries what it picked up back to its
 * landfill, which stores the total in its anchor tile's `stock`. A landfill
 * holds LANDFILL_MAX; once full it stops sending trucks (and its model
 * switches to the capped, grassed-over "full" stage) until you build a new
 * one. RECYCLING CENTERS (Svc.Recycling) cut how fast buildings in their
 * radius make garbage in the first place (RECYCLE_CUT), so landfills last longer.
 */
import { GRID_SIZE, Tile } from './types';
import type { World } from './grid';
import { roadNextTo, Traffic } from './traffic';
import { Coverage, SERVICE_DEFS, serviceAnchors, Svc } from './services';

export const GARBAGE_START = 800;
/** Parker tune: halved 0.01 → 0.005 (garbage piled up too often). */
export const GARBAGE_RATE = 0.005;
export const G_PICKUP = 6;
/** Piles + 🗑 warning from here (was 30). */
export const G_WARN = 42;
export const G_MAX = 60;
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
/** V1.6: a recycling center covering a building cuts its garbage build-up by up to this much (at full coverage). */
export const RECYCLE_CUT = 0.45;

export class Garbage {
  /** Trucks out per dump anchor. */
  private out = new Map<number, number>();
  /** Tiles a truck is already heading to. */
  private targeted = new Set<number>();
  stats = { collected: 0, trips: 0 };
  /** True when some landfill changed model stage this tick (the sim then bumps `version` so the renderer redraws it). */
  stageChanged = false;
  private notices: string[] = [];
  /** Messages for the notification log (landfill nearly full / full). */
  takeNotices(): string[] { const n = this.notices; this.notices = []; return n; }

  outOf(dump: number): number { return this.out.get(dump) ?? 0; }

  tick(world: World, traffic: Traffic, operating: (i: number) => boolean, cov: Coverage | null = null): void {
    const tiles = world.tiles, N = GRID_SIZE;
    if (world.peakPop < GARBAGE_START) return;
    // 1. Build-up (V1.6: recycling centers cut it where they cover).
    const rec = cov?.by[Svc.Recycling];
    world.chunks.activeTilesSorted().forEach((i) => { const t = tiles[i]; // V1.6 A2
      if (t.zone && t.level > 0 && t.units > 0 && operating(i)) t.garbage = Math.min(G_MAX, t.garbage + GARBAGE_RATE * t.units * (rec ? 1 - RECYCLE_CUT * rec[i] : 1));
    });
    // 2. Dispatch.
    const def = SERVICE_DEFS[Svc.Dump];
    for (const d of serviceAnchors(world, Svc.Dump)) {
      if (landfillFull(tiles[d])) continue; // V1.6: a full landfill sends no more trucks — build a new one
      if (this.outOf(d) >= def.fleet) continue;
      const home = roadNextTo(tiles, d);
      if (home < 0) continue;
      const dx0 = d % N, dz0 = Math.floor(d / N);
      let best = -1, bestG = G_PICKUP - 1e-6;
      for (let z = Math.max(0, dz0 - def.radius); z <= Math.min(N - 1, dz0 + def.radius); z++)
        for (let x = Math.max(0, dx0 - def.radius); x <= Math.min(N - 1, dx0 + def.radius); x++) {
          const i = z * N + x;
          if (tiles[i].garbage > bestG && !this.targeted.has(i)) { bestG = tiles[i].garbage; best = i; }
        }
      if (best < 0) continue;
      const stop = roadNextTo(tiles, best);
      if (stop < 0) continue;
      const target = best;
      let load = 0;
      const ok = traffic.spawn(world, 'truck', home, stop, `${GARBAGE_PURPOSE}: collecting`, GARBAGE_TRUCK_COLOR, () => {
        this.targeted.delete(target);
        load = this.collect(world, target);
        // Drive home; the truck is free once it's back (or if no route home), and unloads into the landfill.
        const back = () => { this.deposit(world, d, load); this.out.set(d, Math.max(0, this.outOf(d) - 1)); };
        if (!traffic.spawn(world, 'truck', stop, home, `${GARBAGE_PURPOSE}: returning`, GARBAGE_TRUCK_COLOR, back)) back();
      });
      if (ok) { this.out.set(d, this.outOf(d) + 1); this.targeted.add(target); this.stats.trips++; }
    }
  }

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

  /** Empty the tile and its 8 neighbours (one stop serves the street); returns the garbage picked up. */
  private collect(world: World, i: number): number {
    const N = GRID_SIZE, x = i % N, z = Math.floor(i / N);
    let total = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const a = x + dx, b = z + dz;
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const t = world.tiles[b * N + a];
      this.stats.collected += t.garbage;
      total += t.garbage;
      t.garbage = 0;
    }
    return total;
  }
}
