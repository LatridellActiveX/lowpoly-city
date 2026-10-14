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
import { applyTool, canPlace, residentsOf, TICKS_PER_SECOND } from './rules';
import { GRID_SIZE, Tile, ToolId, ZoneType } from './types';
import { industryMix, bulldozeCells, buildingRequirements, codeForTool, growLots, paintableCells, paintTile, parkingSpot, tileHasCells, ZoneOptions, zoneTiles } from './growth';
import { Building } from './lots';
import { TPL, isFiller } from './footprints';
import { BUILD_COST } from './economy';
import { hash2 } from './random';
import { stepWind } from './wind';
import { Traffic, roadNextTo, rushFactor, timeOfDay } from './traffic';
import { Shipping } from './goods';
import { Crews, jobsOf, updateFarms } from './industry';
import { isUnlocked, updateTier, upkeepFactor } from './progression';
import { computeDemand, Demand, demandGrowth } from './demand';
import { loadSettings, Settings } from './settings';
import { computeEnvironment, Environment } from './environment';
import { isUpkeepKind, bulldozeRefund, Ledger, MONTH_TICKS, monthlyTax, emptyLedger, placementCost, UPKEEP } from './economy';

/** PR 5: one "Next level" requirement row (Simulation.requirements). */
export interface Requirement {
  label: string;
  current: number;
  target: number;
  met: boolean;
  /** What to do when it isn't met (shown on the main blocker). */
  hint: string;
}

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
/** PR 5: 6 → 12 — half as many commuter cars (rush-hour curve unchanged). */
export const COMMUTE_PEOPLE = 12;

/** PR 6: the tools that paint zone cells. */
export const ZONE_TOOLS = new Set<ToolId>(['residential', 'commercial', 'industrial', 'farm', 'foodPlant']);

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
  /** PR 5: construction-truck dispatcher (industry.ts). Not saved: trucks in flight are re-sent after a load. */
  crews = new Crews();
  /** PR 4: player settings (vehicle caps, tick rate, day/night). main.ts loads them. */
  settings: Settings = loadSettings();
  /** 0 = paused, 1/2/3 = speed multiplier. */
  speed = 1;
  /** PR 4: messages for the UI (tier unlocks etc.); the HUD empties this list. */
  events: string[] = [];
  /** PR 6: ids of BUILDINGS that finished a construction stage this tick (move-in cars, sounds). */
  completed: number[] = [];
  /** PR 6 zoning tool options (density + depth), set by the UI. */
  zoneOpt: ZoneOptions = { density: 0, depth: 3 };
  /** PR 6: fractional position inside the clicked tile (public parking quadrant). */
  pointerFrac: [number, number] = [0.25, 0.25];
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
    const d = computeDemand(this.world, n ? sum / n : 1, (i) => this.status(i).operating);
    // PR 6: say what new industry will turn into (farm / food plant / factory).
    d.industrial.driver += ` · ${industryMix(this).driver}`;
    return d;
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

    // PR 6: growth is per BUILDING on the cell grid (growth.ts / lots.ts).
    growLots(this, sparePower, spareWater);
    // Cars park (parking.ts): occupancy for the time of day + commuter claims.
    w.parking.tick(w, w.lots);
    this.spawnTraffic();
    // PR 5: farms claim/free their fields, then crews are dispatched.
    updateFarms(w);
    this.crews.tick(w, this.traffic, (i) => this.status(i).operating);
    // New-game hint: nothing grows without a Construction Yard.
    if ((w.tick === 3 || w.tick % 240 === 0) && !w.tiles.some((t) => t.structure === 'constructionYard') && w.tiles.some((t) => t.zone !== null))
      this.events.push('🏗 Build a Construction Yard first (Industry menu): new buildings wait for a construction crew to arrive by road.');
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
    const upkeep = l.upkeep.powerPlant + l.upkeep.windTurbine + l.upkeep.waterTower + l.upkeep.park + l.upkeep.nuclearPlant + l.upkeep.pumpStation + (l.upkeep.constructionYard ?? 0);
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
    if (ZONE_TOOLS.has(tool)) return this.zoneQuote(tool, tiles).cost;
    if (tool === 'parkingLot' || tool === 'parkingGarage') return BUILD_COST[tool];
    for (const [x, z] of tiles) {
      const t = this.world.at(x, z);
      if (canPlace(tool, t)) cost += placementCost(tool, t);
    }
    return cost;
  }

  /**
   * PR 6 zoning quote: tiles covered (drag + depth), cells that would be
   * painted and the price — BUILD_COST is per TILE, so a cell costs 1/16.
   */
  zoneQuote(tool: ToolId, tiles: Array<[number, number]>): { tiles: Array<[number, number]>; cells: number; cost: number } {
    const all = zoneTiles(this, tiles, this.zoneOpt.depth).filter(([x, z]) => canPlace(tool, this.world.at(x, z)));
    let cells = 0, cost = 0;
    for (const [x, z] of all) {
      const n = paintableCells(this, x, z, codeForTool(this, tool, z * GRID_SIZE + x, this.zoneOpt));
      cells += n;
      cost += (BUILD_COST[tool as 'residential'] * n) / 16 + (n && this.world.at(x, z).deco ? 3 : 0);
    }
    return { tiles: all, cells, cost: Math.round(cost) };
  }

  private applyZone(tool: ToolId, tiles: Array<[number, number]>, res: ApplyResult): ApplyResult {
    const w = this.world;
    if (tool === 'residential' && this.zoneOpt.density >= 2 && w.tier < 3) return { ...res, locked: true };
    for (const [x, z] of this.zoneQuote(tool, tiles).tiles) {
      const t = w.at(x, z);
      const code = codeForTool(this, tool, z * GRID_SIZE + x, this.zoneOpt);
      const n = paintableCells(this, x, z, code);
      if (!n) continue;
      const cost = Math.round((BUILD_COST[tool as 'residential'] * n) / 16 + (t.deco ? 3 : 0));
      if (cost > w.cash) { res.broke = true; break; }
      w.cash -= cost;
      w.ledger.construction += cost;
      res.spent += cost;
      applyTool(tool, t);
      paintTile(this, x, z, code);
      res.changed += n;
    }
    if (res.changed) { this.net = computeNetworks(w); this.env = computeEnvironment(w); this.version++; }
    return res;
  }

  private applyParking(tool: ToolId, tiles: Array<[number, number]>, res: ApplyResult): ApplyResult {
    const w = this.world;
    const [x, z] = tiles[tiles.length - 1] ?? [0, 0];
    if (!canPlace(tool, w.at(x, z))) return res;
    const size = tool === 'parkingGarage' ? 4 : 2;
    const spot = parkingSpot(this, x, z, this.pointerFrac[0], this.pointerFrac[1], size);
    const cost = BUILD_COST[tool as 'parkingLot'];
    if (!spot) return res;
    if (cost > w.cash) return { ...res, broke: true };
    w.cash -= cost;
    w.ledger.construction += cost;
    w.parking.addLot(w, spot[0], spot[1], size);
    w.parking.allocate(w.lots);
    this.version++;
    return { ...res, changed: 1, spent: cost };
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
    // PR 6: zoning paints cells, public parking places a cell lot.
    if (ZONE_TOOLS.has(tool)) return this.applyZone(tool, tiles, res);
    if (tool === 'parkingLot' || tool === 'parkingGarage') return this.applyParking(tool, tiles, res);
    // Bulldozing any tile of a 2×2 building removes the whole footprint.
    if (tool === 'bulldoze') tiles = this.expandFootprints(tiles);
    for (const [x, z] of tiles) {
      const t = w.at(x, z);
      if (!canPlace(tool, t) && !(tool === 'bulldoze' && tileHasCells(this, x, z))) continue;
      // PR 6: nothing tile-sized may go over cells that hold buildings / lots / fields.
      if (tool !== 'bulldoze' && tileHasCells(this, x, z)) continue;
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
      if (tool === 'bulldoze') bulldozeCells(this, x, z);
      applyTool(tool, t);
      if (tool === 'bulldoze') { t.zone = null; w.lots.markAround(x, z); }
      if (tool === 'road' || tool === 'avenue') w.lots.markAround(x, z); // new kerbs to build along
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
    const lots = w.lots;
    const cars = () => this.traffic.count('car');
    // Move-ins: new residents drive in from the highway; they PARK at home on arrival.
    for (const id of this.completed) {
      const b = lots.buildings.get(id);
      if (!b || TPL[b.tpl].zone !== 'residential' || edgeTile < 0 || cars() >= this.settings.maxCars) continue;
      const home = roadNextTo(tiles, b.host);
      if (home < 0) continue;
      b.movingIn = true;
      if (!this.traffic.spawn(w, 'car', edgeTile, home, 'moving in', undefined, () => { b.movingIn = false; w.parking.claim(w, b, 14); })) b.movingIn = false;
    }
    const homes: Building[] = [];
    const work: Building[] = [];
    let pop = 0;
    for (const b of lots.buildings.values()) {
      const tpl = TPL[b.tpl];
      if (b.level <= 0 || isFiller(tpl)) continue;
      if (tpl.zone === 'residential') { homes.push(b); pop += tpl.capacity[Math.min(b.level, tpl.maxLevel) - 1]; } else work.push(b);
    }
    // PR 5: commuter volume follows the clock — rush hours full, nights quiet.
    const tod = timeOfDay(w.clock);
    const target = Math.min(this.settings.maxCars, Math.floor((pop / COMMUTE_PEOPLE) * rushFactor(tod)));
    const morning = tod * 24 < 13; // before ~13:00 commuters drive TO work, after it home
    for (let k = 0; k < 3 && cars() < target && homes.length; k++) {
      const r = (n: number) => hash2(w.tick, k * 13 + n, w.seed + 4100);
      const hb = homes[Math.floor(r(1) * homes.length)];
      const home = roadNextTo(tiles, hb.host);
      let other: number, ob: Building | null = null;
      if ((r(2) < 0.15 || !work.length) && edgeTile >= 0) other = edgeTile; // out-of-town trip / visitor
      else if (work.length) { ob = work[Math.floor(r(3) * work.length)]; other = roadNextTo(tiles, ob.host); }
      else break;
      if (home < 0 || other < 0 || home === other) continue;
      const toWork = r(4) < (morning ? 0.8 : 0.2);
      // PR 6: on arrival the car looks for a space at its destination (parking.ts).
      const dest = toWork ? ob : hb;
      const stay = dest === hb ? 6 : TPL[ob?.tpl ?? 'corner_shop'].zone === 'commercial' ? 1.5 : 7;
      const destRoad = toWork ? other : home;
      this.traffic.spawn(w, 'car', toWork ? home : other, destRoad, 'commute', undefined, dest ? () => {
        if (w.parking.claim(w, dest, stay)) return;
        // No space: circle the block once (to a nearby road tile), then give up.
        const x = destRoad % GRID_SIZE, z = Math.floor(destRoad / GRID_SIZE);
        for (const [dx, dz] of [[2, 0], [0, 2], [-2, 0], [0, -2], [1, 1], [-1, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= GRID_SIZE || nz >= GRID_SIZE || !tiles[nz * GRID_SIZE + nx].road) continue;
          if (this.traffic.spawn(w, 'car', destRoad, nz * GRID_SIZE + nx, 'looking for parking')) break;
        }
      } : undefined);
    }
  }

  /** Growth multiplier from RCI zone demand (demand.ts): 0 at demand ≤ −0.6, up to 1.6 at +1. */
  /**
   * PR 5 "Next level" requirements for the Inspect panel. SINGLE SOURCE OF
   * TRUTH: every row mirrors a check in step()/maxLevel()/industry.ts, so the
   * bars can't drift from the real growth rules. Rows marked `hint` explain
   * what to do; the first unmet row is the "main blocker" (UI highlights it).
   * Returns null at max level (or for tiles that don't grow).
   */
  requirements(i: number): Requirement[] | null {
    // PR 6: per BUILDING (growth.ts buildingRequirements). For a tile we use
    // its first hosted real building; Inspect passes the clicked building.
    const b = this.world.lots.hostedOn(i).find((q) => !isFiller(TPL[q.tpl]));
    return b ? buildingRequirements(this, b) : null;
  }

  /** PR 6: requirement bars of one building. */
  buildingRequirements(b: Building): Requirement[] | null {
    return buildingRequirements(this, b);
  }

  demandFactor(zone: ZoneType): number {
    return demandGrowth(this.demand[zone].value);
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
      jobs += jobsOf(this.world, i); // PR 5: farms have fewer jobs
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
