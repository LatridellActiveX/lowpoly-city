/**
 * sim/simulation.ts — the heartbeat of the city.
 *
 * THE SIMULATION TICK
 * -------------------
 * The game runs on a fixed "tick" (TICKS_PER_SECOND ticks per real second at
 * 1x speed). The renderer draws as fast as the screen allows (60+ fps), but the
 * city only changes on ticks. Decoupling the two keeps the simulation
 * deterministic and independent of frame rate: a slow laptop and a fast one
 * grow the same city.
 *
 * `update(dtSeconds)` is called every animation frame. It adds the elapsed
 * time (times the speed multiplier) to an accumulator and runs as many whole
 * ticks as fit. Each tick:
 *   1. Recompute the power and water networks (networks.ts).
 *   2. For each zoned tile, check road access + power + water.
 *      - Fully serviced: count up `happyTicks`; after GROW_TICKS, grow one
 *        level (empty lot -> small building -> bigger building), but only if
 *        the networks have spare capacity for the extra demand.
 *      - Not serviced: the building stops operating (no residents/jobs count)
 *        and its happy counter resets.
 *   3. Bump `version` so the renderer knows to rebuild its instances.
 *
 * Milestone 2 (traffic) and 3 (economy) will add their own steps here.
 */
import { coords, World } from './grid';
import { computeNetworks, NetworkResult } from './networks';
import { applyTool, canPlace, DEMAND, GROW_TICKS, JOBS_PER_LEVEL, MAX_LEVEL, RESIDENTS_PER_LEVEL, TICKS_PER_SECOND } from './rules';
import { Tile, ToolId } from './types';

export interface CityStats {
  population: number;
  jobs: number;
  buildings: number;
  /** Buildings that exist but aren't operating (missing road, power or water). */
  inactive: number;
  power: { capacity: number; demand: number };
  water: { capacity: number; demand: number };
  outages: number;
}

/** Why a tile isn't operating — used by the info panel and the warning icons. */
export interface TileStatus {
  roadAccess: boolean;
  powered: boolean;
  watered: boolean;
  operating: boolean;
  missing: string[];
}

export class Simulation {
  world: World;
  net: NetworkResult;
  /** 0 = paused, 1/2/3 = speed multiplier. */
  speed = 1;
  /** Increments whenever anything visible changes; the renderer compares it. */
  version = 0;
  private acc = 0;

  constructor(world = new World()) {
    this.world = world;
    this.net = computeNetworks(world);
  }

  /** Called every frame with real elapsed seconds. Runs 0..n whole ticks. */
  update(dt: number): void {
    if (this.speed === 0) return;
    // Clamp dt so a backgrounded tab doesn't run thousands of ticks at once.
    this.acc += Math.min(dt, 0.25) * this.speed * TICKS_PER_SECOND;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.step();
    }
  }

  /** One simulation tick. Public so tests/screenshots can fast-forward. */
  step(): void {
    const w = this.world;
    w.tick++;
    this.net = computeNetworks(w);

    // Spare capacity per network, decremented as lots grow this tick so that
    // two lots can't both claim the last bit of supply.
    const sparePower = this.net.power.map((n) => n.capacity - n.supplied);
    const spareWater = this.net.water.map((n) => n.capacity - n.supplied);

    w.tiles.forEach((t, i) => {
      if (t.zone === null) return;
      const s = this.net.service[i];
      const ok = s.roadAccess && s.powered && s.watered;
      if (!ok) {
        t.happyTicks = 0;
        return;
      }
      t.happyTicks++;
      if (t.happyTicks < GROW_TICKS || t.level >= MAX_LEVEL) return;
      // Small random delay so a freshly zoned block doesn't pop up all at once.
      if (Math.random() > 0.35) return;
      const extra = DEMAND[t.zone];
      if (sparePower[s.powerNet] < extra.power || spareWater[s.waterNet] < extra.water) return;
      sparePower[s.powerNet] -= extra.power;
      spareWater[s.waterNet] -= extra.water;
      t.level++;
      t.structure = 'building';
      t.happyTicks = 0;
    });
    this.version++;
  }

  /** Try to apply a tool to many tiles at once (a drag). Returns tiles changed. */
  apply(tool: ToolId, tiles: Array<[number, number]>): number {
    let changed = 0;
    for (const [x, z] of tiles) {
      const t = this.world.at(x, z);
      if (canPlace(tool, t)) {
        applyTool(tool, t);
        changed++;
      }
    }
    if (changed) {
      // Recompute utilities right away so overlays/info update without waiting a tick.
      this.net = computeNetworks(this.world);
      this.version++;
    }
    return changed;
  }

  status(i: number): TileStatus {
    const s = this.net.service[i];
    const t = this.world.tiles[i];
    const needsPower = t.zone !== null || t.structure === 'waterTower';
    const needsWater = t.zone !== null;
    const needsRoad = t.zone !== null;
    const missing: string[] = [];
    if (needsRoad && !s.roadAccess) missing.push('road access');
    if (needsPower && !s.powered) missing.push(s.powerNet < 0 ? 'power connection' : 'power (outage: not enough capacity)');
    if (needsWater && !s.watered) missing.push(s.waterNet < 0 ? 'water connection' : 'water (outage: not enough capacity)');
    return {
      roadAccess: s.roadAccess,
      powered: s.powered,
      watered: s.watered,
      operating: missing.length === 0,
      missing,
    };
  }

  stats(): CityStats {
    let population = 0, jobs = 0, buildings = 0, inactive = 0;
    this.world.tiles.forEach((t: Tile, i) => {
      if (t.zone === null || t.level === 0) return;
      buildings++;
      if (!this.status(i).operating) {
        inactive++;
        return;
      }
      if (t.zone === 'residential') population += RESIDENTS_PER_LEVEL * t.level;
      jobs += JOBS_PER_LEVEL[t.zone] * t.level;
    });
    const sum = (ns: { capacity: number; demand: number; outages: number }[]) =>
      ns.reduce((a, n) => ({ capacity: a.capacity + n.capacity, demand: a.demand + n.demand, outages: a.outages + n.outages }), { capacity: 0, demand: 0, outages: 0 });
    const p = sum(this.net.power);
    const wt = sum(this.net.water);
    return {
      population, jobs, buildings, inactive,
      power: { capacity: p.capacity, demand: p.demand },
      water: { capacity: wt.capacity, demand: wt.demand },
      outages: p.outages + wt.outages,
    };
  }

  /** Convenience for debugging: tile coordinates of every tile matching a predicate. */
  find(pred: (t: Tile) => boolean): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    this.world.tiles.forEach((t, i) => pred(t) && out.push(coords(i)));
    return out;
  }
}
