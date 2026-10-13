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
 *   3. Every MONTH_TICKS ticks, book the month: collect taxes from operating
 *      buildings, pay upkeep on utility buildings (economy.ts).
 *   4. Bump `version` so the renderer knows to rebuild its instances.
 *
 * Milestone 2 (traffic) and 3 (economy) will add their own steps here.
 */
import { coords, World } from './grid';
import { computeNetworks, NetworkResult } from './networks';
import { DESIRE_FAST, DESIRE_FOR_DENSE, DESIRE_MIN, applyTool, canPlace, DEMAND, GROW_TICKS, JOBS_PER_LEVEL, MAX_LEVEL, RESIDENTS_PER_LEVEL, TICKS_PER_SECOND } from './rules';
import { Tile, ToolId } from './types';
import { hash2 } from './random';
import { stepWind } from './wind';
import { computeEnvironment, Environment } from './environment';
import { isUpkeepKind, bulldozeRefund, growthFactor, Ledger, MONTH_TICKS, monthlyTax, emptyLedger, placementCost, UPKEEP } from './economy';

/** Result of trying to apply a tool, so the UI can explain what happened. */
export interface ApplyResult {
  changed: number;
  spent: number;
  refunded: number;
  /** True if we stopped early because the money ran out. */
  broke: boolean;
}

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
  /** Pollution / parks / desirability per tile, recomputed every tick (environment.ts). */
  env: Environment;
  /** 0 = paused, 1/2/3 = speed multiplier. */
  speed = 1;
  /** Increments whenever anything visible changes; the renderer compares it. */
  version = 0;
  private acc = 0;

  constructor(world = new World()) {
    this.world = world;
    this.net = computeNetworks(world);
    this.env = computeEnvironment(world);
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
    stepWind(w); // weather first, so this tick's turbine output uses the new wind
    this.net = computeNetworks(w);
    this.env = computeEnvironment(w);

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
      // Homes care about pollution and parks (PR 3). Shops and factories don't.
      const cap = this.maxLevel(i);
      const need = t.zone === 'residential' && this.env.desirability[i] >= DESIRE_FAST ? GROW_TICKS / 2 : GROW_TICKS;
      if (t.happyTicks < need || t.level >= cap) return;
      // Small random delay so a freshly zoned block doesn't pop up all at once.
      // Higher taxes make the chance smaller (economy.ts growthFactor).
      // SEEDED (PR 3): the "dice roll" is a hash of (tile, tick, city seed), so
      // the same city with the same actions grows exactly the same way every
      // time — handy for testing and for sharing seeds later.
      if (hash2(i, w.tick, w.seed + 777) > 0.35 * growthFactor(w.taxRates[t.zone])) return;
      const extra = DEMAND[t.zone];
      if (sparePower[s.powerNet] < extra.power || spareWater[s.waterNet] < extra.water) return;
      sparePower[s.powerNet] -= extra.power;
      spareWater[s.waterNet] -= extra.water;
      t.level++;
      t.structure = 'building';
      t.happyTicks = 0;
    });
    if (w.tick % MONTH_TICKS === 0) this.bookMonth();
    this.version++;
  }

  /**
   * End of month: collect taxes, pay upkeep, archive the ledger.
   * Construction spending was already recorded live as it happened.
   */
  private bookMonth(): void {
    const w = this.world;
    const l = w.ledger;
    const m = this.projectMonth();
    l.taxes = m.taxes;
    l.upkeep = m.upkeep;
    const income = l.taxes.residential + l.taxes.commercial + l.taxes.industrial;
    const upkeep = l.upkeep.powerPlant + l.upkeep.windTurbine + l.upkeep.waterTower + l.upkeep.park;
    w.cash += Math.round(income - upkeep);
    w.lastLedger = l;
    w.ledger = emptyLedger();
  }

  /** What taxes and upkeep would be if the month ended right now. */
  projectMonth(): Ledger {
    const w = this.world;
    const l = emptyLedger();
    w.tiles.forEach((t, i) => {
      if (t.zone) l.taxes[t.zone] += monthlyTax(t, t.level > 0 && this.status(i).operating, w.taxRates);
      if (isUpkeepKind(t.structure)) l.upkeep[t.structure] += UPKEEP[t.structure];
    });
    for (const k of ['residential', 'commercial', 'industrial'] as const) l.taxes[k] = Math.round(l.taxes[k]);
    return l;
  }

  /** Total cost to apply `tool` to these tiles (only tiles where it's valid). */
  quote(tool: ToolId, tiles: Array<[number, number]>): number {
    let cost = 0;
    for (const [x, z] of tiles) {
      const t = this.world.at(x, z);
      if (canPlace(tool, t)) cost += placementCost(tool, t);
    }
    return cost;
  }

  /** Can we start building with this tool at all? (Bulldoze always allowed.) */
  canAfford(tool: ToolId, cost: number): boolean {
    if (tool === 'bulldoze' || tool === 'inspect') return true;
    return this.world.cash >= cost && this.world.cash > 0;
  }

  /**
   * Apply a tool to many tiles at once (a drag), paying as we go.
   * Tiles are built in drag order until the money runs out, so a road you
   * can only half afford gets built halfway rather than not at all.
   */
  apply(tool: ToolId, tiles: Array<[number, number]>): ApplyResult {
    const w = this.world;
    const res: ApplyResult = { changed: 0, spent: 0, refunded: 0, broke: false };
    for (const [x, z] of tiles) {
      const t = w.at(x, z);
      if (!canPlace(tool, t)) continue;
      const cost = placementCost(tool, t);
      if (tool !== 'bulldoze' && cost > w.cash) {
        res.broke = true;
        break;
      }
      if (tool === 'bulldoze') {
        const refund = bulldozeRefund(t);
        w.cash += refund - cost;
        res.refunded += refund;
        w.ledger.refunds += refund;
      }
      w.cash -= tool === 'bulldoze' ? 0 : cost;
      res.spent += cost;
      w.ledger.construction += cost;
      applyTool(tool, t);
      res.changed++;
    }
    const changed = res.changed;
    if (changed) {
      // Recompute utilities right away so overlays/info update without waiting a tick.
      this.net = computeNetworks(this.world);
      this.env = computeEnvironment(this.world);
      this.version++;
    }
    return res;
  }

  /**
   * Highest level this lot may grow to right now. Homes are limited by
   * desirability: too polluted = can't even build (0), a bit polluted = small
   * houses only (1). Everything else can reach MAX_LEVEL.
   */
  maxLevel(i: number): number {
    const t = this.world.tiles[i];
    if (t.zone !== 'residential') return MAX_LEVEL;
    const d = this.env.desirability[i];
    if (d < DESIRE_MIN) return 0;
    if (d < DESIRE_FOR_DENSE) return 1;
    return MAX_LEVEL;
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
