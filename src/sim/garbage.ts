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
 * COLLECTION: a Garbage Dump (services.ts, unlocks at 1,000 people) owns
 * `fleet` garbage trucks. Each tick a dump with a free truck sends it along
 * the roads to the fullest uncollected building within its radius (at
 * least G_PICKUP garbage). On arrival the truck empties that tile AND its
 * neighbours (one stop serves the street), then drives back; the truck is
 * free again when it gets home. Trucks are ordinary traffic (purpose
 * 'garbage', green), so they queue at lights like everybody else.
 */
import { GRID_SIZE } from './types';
import type { World } from './grid';
import { roadNextTo, Traffic } from './traffic';
import { SERVICE_DEFS, serviceAnchors, Svc } from './services';

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

export class Garbage {
  /** Trucks out per dump anchor. */
  private out = new Map<number, number>();
  /** Tiles a truck is already heading to. */
  private targeted = new Set<number>();
  stats = { collected: 0, trips: 0 };

  outOf(dump: number): number { return this.out.get(dump) ?? 0; }

  tick(world: World, traffic: Traffic, operating: (i: number) => boolean): void {
    const tiles = world.tiles, N = GRID_SIZE;
    if (world.peakPop < GARBAGE_START) return;
    // 1. Build-up.
    world.chunks.activeTilesSorted().forEach((i) => { const t = tiles[i]; // V1.6 A2
      if (t.zone && t.level > 0 && t.units > 0 && operating(i)) t.garbage = Math.min(G_MAX, t.garbage + GARBAGE_RATE * t.units);
    });
    // 2. Dispatch.
    const def = SERVICE_DEFS[Svc.Dump];
    for (const d of serviceAnchors(world, Svc.Dump)) {
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
      const ok = traffic.spawn(world, 'truck', home, stop, `${GARBAGE_PURPOSE}: collecting`, GARBAGE_TRUCK_COLOR, () => {
        this.targeted.delete(target);
        this.collect(world, target);
        // Drive home; the truck is free once it's back (or if no route home).
        const back = () => this.out.set(d, Math.max(0, this.outOf(d) - 1));
        if (!traffic.spawn(world, 'truck', stop, home, `${GARBAGE_PURPOSE}: returning`, GARBAGE_TRUCK_COLOR, back)) back();
      });
      if (ok) { this.out.set(d, this.outOf(d) + 1); this.targeted.add(target); this.stats.trips++; }
    }
  }

  /** Empty the tile and its 8 neighbours (one stop serves the street). */
  private collect(world: World, i: number): void {
    const N = GRID_SIZE, x = i % N, z = Math.floor(i / N);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const a = x + dx, b = z + dz;
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const t = world.tiles[b * N + a];
      this.stats.collected += t.garbage;
      t.garbage = 0;
    }
  }
}
