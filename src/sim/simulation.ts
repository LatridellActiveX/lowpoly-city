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
import { DESIRE_FAST, DESIRE_FOR_DENSE, DESIRE_MIN, applyTool, canPlace, DEMAND, GROW_TICKS, JOBS_PER_LEVEL, MAX_LEVEL, MEDIUM_DENSITY, residentsOf, TICKS_PER_SECOND, CONSTRUCT_TICKS } from './rules';
import { Tile, ToolId, ZoneType } from './types';
import { hash2 } from './random';
import { stepWind } from './wind';
import { Traffic, roadNextTo, rushFactor, timeOfDay } from './traffic';
import { Shipping } from './goods';
import { isUnlocked, updateTier, upkeepFactor } from './progression';
import { computeDemand, Demand, demandGrowth } from './demand';
import { loadSettings, Settings } from './settings';
import { computeEnvironment, Environment } from './environment';
import { isUpkeepKind, bulldozeRefund, growthFactor, Ledger, MONTH_TICKS, monthlyTax, emptyLedger, placementCost, UPKEEP } from './economy';

/** Result of trying to apply a tool, so the UI can explain what happened. */
export interface ApplyResult {
  changed: number;
  spent: number;
  refunded: number;
  /** True if we stopped early because the money ran out. */
  broke: boolean;
  /** PR 4: true if the tool isn't unlocked yet. */
  locked?: boolean;
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

/** One snapshot for the graphs panel (PR 3). Plain numbers, cheap to keep. */
export interface HistoryPoint {
  tick: number;
  population: number;
  jobs: number;
  powerDemand: number;
  powerCapacity: number;
  waterDemand: number;
  waterCapacity: number;
}
/**
 * Take a snapshot every 20 ticks (10 s at 1×) and keep at most 500 (≈83 min
 * at 1×). The wiki proposal said every 60 ticks; 20 makes the graph useful
 * within the first couple of minutes of play.
 */
export const HISTORY_EVERY_TICKS = 20;
export const HISTORY_MAX = 500;
/** PR 4: about one car on the road per this many residents (before the Settings cap). */
export const COMMUTE_PEOPLE = 6;

export class Simulation {
  /** Session-only ring buffer of stats for the graphs (not saved). */
  history: HistoryPoint[] = [];
  world: World;
  net: NetworkResult;
  /** Pollution / parks / desirability per tile, recomputed every tick (environment.ts). */
  env: Environment;
  /** PR 4: cars and trucks currently on the map (not saved). */
  traffic = new Traffic();
  /** PR 4: current RCI demand (demand.ts), recomputed every tick. */
  demand: Demand;
  /** PR 4: goods production, deliveries, exports and plant fuel (goods.ts). */
  shipping = new Shipping();
  /** PR 4: player settings (vehicle caps, tick rate, day/night). main.ts loads them. */
  settings: Settings = loadSettings();
  /** 0 = paused, 1/2/3 = speed multiplier. */
  speed = 1;
  /** PR 4: messages for the UI (tier unlocks etc.); the HUD empties this list. */
  events: string[] = [];
  /** Tiles that finished a construction stage this tick (read by traffic for move-in cars). */
  completed: number[] = [];
  /** Increments whenever anything visible changes; the renderer compares it. */
  version = 0;
  private acc = 0;
  /** How far we are toward the next tick (0..1). Lets visuals move smoothly between ticks. */
  get subTick(): number {
    return this.acc;
  }

  constructor(world = new World()) {
    this.world = world;
    this.net = computeNetworks(world);
    this.env = computeEnvironment(world);
    this.demand = this.computeDemand();
  }

  /** RCI demand from the current city (average desirability over homes). */
  private computeDemand(): Demand {
    let sum = 0, n = 0;
    this.world.tiles.forEach((t, i) => {
      if (t.zone === 'residential') { sum += this.env.desirability[i]; n++; }
    });
    return computeDemand(this.world, n ? sum / n : 1, (i) => this.status(i).operating);
  }

  /** Called every frame with real elapsed seconds. Runs 0..n whole ticks. */
  update(dt: number): void {
    if (this.speed === 0) return;
    // Clamp dt so a backgrounded tab doesn't run thousands of ticks at once.
    const gameDt = Math.min(dt, 0.25) * this.speed;
    // PR 4: the game clock (day/night, traffic lights) and vehicles move
    // continuously every frame, independent of the tick rate.
    this.world.clock += gameDt;
    this.traffic.update(this.world, gameDt);
    this.acc += gameDt * (this.settings.tickRate || TICKS_PER_SECOND);
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
    this.demand = this.computeDemand();

    // Spare capacity per network, decremented as lots grow this tick so that
    // two lots can't both claim the last bit of supply.
    const sparePower = this.net.power.map((n) => n.capacity - n.supplied);
    const spareWater = this.net.water.map((n) => n.capacity - n.supplied);

    this.completed = [];
    w.tiles.forEach((t, i) => {
      if (t.zone === null) return;
      const s = this.net.service[i];
      const ok = s.roadAccess && s.powered && s.watered;
      // ---- PR 4 construction ----
      // A lot that has started building shows frames + a crane (renderer).
      // Work only progresses on ticks where road, power AND water are all
      // present; otherwise the site just waits (it doesn't reset).
      if (t.construct > 0) {
        if (ok) {
          t.construct--;
          if (t.construct === 0) {
            t.level++;
            t.structure = 'building';
            t.happyTicks = 0;
            this.completed.push(i); // traffic.ts sends new residents' cars here
            if (t.zone === 'commercial') t.stock = Math.max(t.stock, 4); // opening stock
          }
        }
        return;
      }
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
      // Higher taxes make the chance smaller (economy.ts growthFactor), and
      // PR 4 zone demand (demand.ts) scales it too: 0 demand = no growth.
      // SEEDED (PR 3): the "dice roll" is a hash of (tile, tick, city seed), so
      // the same city with the same actions grows exactly the same way every
      // time — handy for testing and for sharing seeds later.
      if (hash2(i, w.tick, w.seed + 777) > 0.35 * growthFactor(w.taxRates[t.zone]) * this.demandFactor(t.zone)) return;
      const extra = DEMAND[t.zone];
      if (sparePower[s.powerNet] < extra.power || spareWater[s.waterNet] < extra.water) return;
      sparePower[s.powerNet] -= extra.power;
      spareWater[s.waterNet] -= extra.water;
      // PR 4: instead of popping up instantly, the next level is BUILT over
      // CONSTRUCT_TICKS serviced ticks. The capacity is reserved now.
      t.construct = CONSTRUCT_TICKS;
      t.happyTicks = 0;
    });
    this.spawnTraffic();
    this.shipping.tick(w, this.traffic, (i) => this.status(i).operating, this.settings.maxTrucks);
    // PR 4 progression: announce new tiers (UI drains `events`).
    this.events.push(...updateTier(w, this.stats().population));
    if (w.tick % MONTH_TICKS === 0) this.bookMonth();
    if (w.tick % HISTORY_EVERY_TICKS === 0) this.record();
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
    const upkeep = l.upkeep.powerPlant + l.upkeep.windTurbine + l.upkeep.waterTower + l.upkeep.park + l.upkeep.nuclearPlant + l.upkeep.pumpStation;
    w.cash += Math.round(income - upkeep);
    w.lastLedger = l;
    w.ledger = emptyLedger();
  }

  /** Append a stats snapshot, dropping the oldest when the buffer is full. */
  private record(): void {
    const s = this.stats();
    this.history.push({
      tick: this.world.tick,
      population: s.population,
      jobs: s.jobs,
      powerDemand: s.power.demand,
      powerCapacity: s.power.capacity,
      waterDemand: s.water.demand,
      waterCapacity: s.water.capacity,
    });
    if (this.history.length > HISTORY_MAX) this.history.shift();
  }

  /** What taxes and upkeep would be if the month ended right now. */
  projectMonth(): Ledger {
    const w = this.world;
    const l = emptyLedger();
    w.tiles.forEach((t, i) => {
      if (t.zone) l.taxes[t.zone] += monthlyTax(t, t.level > 0 && this.status(i).operating, w.taxRates);
      if (isUpkeepKind(t.structure) && !t.part) l.upkeep[t.structure] += Math.round(UPKEEP[t.structure] * upkeepFactor(w.tier));
    });
    for (const k of ['residential', 'commercial', 'industrial'] as const) l.taxes[k] = Math.round(l.taxes[k]);
    return l;
  }

  /** Add the rest of every 2×2 footprint touched by `tiles` (for bulldozing). */
  private expandFootprints(tiles: Array<[number, number]>): Array<[number, number]> {
    const seen = new Set(tiles.map(([x, z]) => z * 64 + x));
    const out = [...tiles];
    for (const [x, z] of tiles) {
      const t = this.world.at(x, z);
      if (t.structure !== 'nuclearPlant') continue;
      const a = t.part ? t.part - 1 : z * 64 + x;
      const ax = a % 64, az = Math.floor(a / 64);
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const k = (az + dz) * 64 + ax + dx;
        if (!seen.has(k)) { seen.add(k); out.push([ax + dx, az + dz]); }
      }
    }
    return out;
  }

  /** Place a 2×2 building whose top-left tile is the first of `tiles`. */
  private applyBig(tool: ToolId, tiles: Array<[number, number]>, res: ApplyResult): ApplyResult {
    const w = this.world;
    if (tiles.length !== 4 || !tiles.every(([x, z]) => canPlace(tool, w.at(x, z)))) return res;
    // The building's price once, plus clearing fees for trees on any of its tiles.
    const cost = placementCost(tool, w.at(tiles[0][0], tiles[0][1])) + tiles.slice(1).reduce((a, [x, z]) => a + (w.at(x, z).deco ? 3 : 0), 0);
    if (cost > w.cash) return { ...res, broke: true };
    w.cash -= cost;
    w.ledger.construction += cost;
    const anchor = tiles[0][1] * 64 + tiles[0][0];
    tiles.forEach(([x, z], k) => {
      const t = w.at(x, z);
      applyTool(tool, t);
      t.part = k === 0 ? 0 : anchor + 1;
    });
    this.net = computeNetworks(w);
    this.env = computeEnvironment(w);
    this.version++;
    return { ...res, changed: 4, spent: cost };
  }

  /** Total cost to apply `tool` to these tiles (only tiles where it's valid). */
  quote(tool: ToolId, tiles: Array<[number, number]>): number {
    let cost = 0;
    // 2×2 plant: one price for the whole footprint.
    if (tool === 'nuclearPlant') return tiles.every(([x, z]) => canPlace(tool, this.world.at(x, z))) ? placementCost(tool, this.world.at(tiles[0][0], tiles[0][1])) : 0;
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
    // (tiles is reassigned for bulldozing 2×2 footprints)
    const w = this.world;
    const res: ApplyResult = { changed: 0, spent: 0, refunded: 0, broke: false };
    // PR 4: tools above the city's tier are locked (progression.ts).
    if (!isUnlocked(tool, w.tier)) return { ...res, locked: true };
    // PR 4 2×2 nuclear plant: all four tiles must be free, paid once, built together.
    if (tool === 'nuclearPlant') return this.applyBig(tool, tiles, res);
    // Bulldozing any tile of a 2×2 building removes the whole footprint.
    if (tool === 'bulldoze') tiles = this.expandFootprints(tiles);
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
  /**
   * PR 4 traffic generation, once per tick:
   *  - MOVE-INS: every home that just finished a construction stage gets a car
   *    driving in from the out-of-city connection with its new residents.
   *  - COMMUTERS: the city wants about one car per COMMUTE_PEOPLE residents on
   *    the road (capped by Settings.maxCars). Up to 3 new trips start per tick
   *    between a random home and a random workplace (either direction), and
   *    some visitors drive in from the edge to a shop.
   * "Random" picks are hashes of (tick, slot, seed), so they're repeatable.
   */
  private spawnTraffic(): void {
    const w = this.world;
    const tiles = w.tiles;
    const edgeTile = w.edgeIndex;
    const cars = () => this.traffic.count('car');
    for (const i of this.completed) {
      if (tiles[i].zone !== 'residential' || edgeTile < 0 || cars() >= this.settings.maxCars) continue;
      const home = roadNextTo(tiles, i);
      // PR 5: the residents only count once their car pulls up (onArrive).
      // If the trip can't start (no route), spawn() returns false and they
      // move in straight away so a disconnected town still grows.
      if (home >= 0) {
        const t = tiles[i];
        t.movingIn = true;
        if (!this.traffic.spawn(w, 'car', edgeTile, home, 'moving in', undefined, () => (t.movingIn = false))) t.movingIn = false;
      }
    }
    const homes: number[] = [];
    const work: number[] = [];
    let pop = 0;
    tiles.forEach((t, i) => {
      if (!t.zone || t.level === 0) return;
      if (t.zone === 'residential') {
        homes.push(i);
        pop += residentsOf(t);
      } else work.push(i);
    });
    // PR 5: commuter volume follows the clock — rush hours full, nights quiet.
    const target = Math.min(this.settings.maxCars, Math.floor((pop / COMMUTE_PEOPLE) * rushFactor(timeOfDay(w.clock))));
    for (let k = 0; k < 3 && cars() < target && homes.length; k++) {
      const r = (n: number) => hash2(w.tick, k * 13 + n, w.seed + 4100);
      const home = roadNextTo(tiles, homes[Math.floor(r(1) * homes.length)]);
      let other: number;
      if ((r(2) < 0.15 || !work.length) && edgeTile >= 0) other = edgeTile; // out-of-town trip / visitor
      else if (work.length) other = roadNextTo(tiles, work[Math.floor(r(3) * work.length)]);
      else break;
      if (home < 0 || other < 0 || home === other) continue;
      const toWork = r(4) < 0.5;
      this.traffic.spawn(w, 'car', toWork ? home : other, toWork ? other : home, 'commute');
    }
  }

  /** Growth multiplier from RCI zone demand (demand.ts): 0 at demand ≤ −0.6, up to 1.6 at +1. */
  demandFactor(zone: ZoneType): number {
    return demandGrowth(this.demand[zone].value);
  }

  maxLevel(i: number): number {
    const t = this.world.tiles[i];
    if (t.zone !== 'residential') return MAX_LEVEL;
    const d = this.env.desirability[i];
    if (d < DESIRE_MIN) return 0;
    if (d < DESIRE_FOR_DENSE) return 1;
    // PR 5 medium density: level 4 (townhouses) at the Town tier, level 5
    // (apartments) at the City tier — each also needs high desirability
    // (parks, no pollution) and positive residential demand.
    let cap = MAX_LEVEL;
    for (const lv of [4, 5] as const) {
      const g = MEDIUM_DENSITY[lv];
      if (this.world.tier >= g.tier && d >= g.desire && this.demand.residential.value > 0) cap = lv;
    }
    return cap;
  }

  status(i: number): TileStatus {
    const s = this.net.service[i];
    const t = this.world.tiles[i];
    const needsPower = t.zone !== null || t.structure === 'waterTower' || t.structure === 'pumpStation';
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
      if (t.zone === 'residential') population += residentsOf(t); // PR 5: per-level table; not until their car arrives
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
