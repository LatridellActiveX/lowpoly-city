/**
 * sim/parking.ts — PR 6 PARKING: supply, requirements, public lots and the
 * cars that actually park.
 *
 * SUPPLY
 *   own     = the template's surface stalls + garage spaces (footprints.ts)
 *   public  = player-placed lots (Roads ▸ Parking Lot 2×2 cells, 4 spaces;
 *             Roads ▸ Parking Garage 4×4 cells, 3 decks, 40 spaces) within
 *             PUBLIC_RANGE cells (3 tiles) of a building, Manhattan distance
 *             between centres. Every few ticks `allocate()` hands each lot's
 *             spaces to the buildings that are SHORT, nearest building first.
 * REQUIREMENT  footprints.parkingRequired (homes 1 / 0.7 / 0.5 per home,
 *             shops 1 per 3 jobs, factories 1 per 4 jobs).
 *   A building may only grow to a level whose requirement fits its own
 *   spaces + its public share + the unallocated public spaces in range
 *   (`canSupport`). While it is SHORT at its current level, it grows at half
 *   speed and counts toward shrinking (lots growth in simulation.ts).
 *
 * OCCUPANCY (what you see in the lots)
 *   Each tick every building WANTS `required × fraction(time of day)` cars
 *   parked — homes are full at night and emptier by day, workplaces the
 *   other way round, with the rush hours in between — PLUS the commuter cars
 *   that drove there (claims, below). Cars go into the building's own spaces
 *   first, overflow into public lots in range, and anything left is "street
 *   parking" that isn't drawn.
 *
 * COMMUTER CARS (traffic.ts trips)
 *   When a commuter arrives `claim()` looks for a free space: own building
 *   first, then public lots in range. Found → the car parks for a stay
 *   (work ≈ 8 h, shopping ≈ 1 h, home ≈ overnight, in game time) and leaves
 *   when it ends. None free → the driver circles the block once (a short
 *   extra trip) and GIVES UP; the destination's `gaveUp` counter rises and
 *   lowers its happiness. Counters decay so they describe recent history.
 */
import { CELL_GRID, CellRole, cidx, tileOfCell } from './cells';
import { parkingRequired, parkingSupply, TPL } from './footprints';
import { World } from './grid';
import type { Building, Lots } from './lots';
import { DAY_SECONDS, timeOfDay } from './traffic';
import { Tile } from './types';

export interface PublicLot {
  id: number;
  /**
   * Top-left cell and size in cells. V1.5: new surface lots and garages both
   * fill the whole tile (size 4 = 16 cells); PR 6 saves may still hold 2×2
   * surface lots (size 2), which keep working unchanged.
   */
  cx: number;
  cz: number;
  size: number;
  /** V1.5: multi-storey garage (vs surface lot). PR 6 saves: size 4 = garage. */
  garage: boolean;
  /** V1.5: garage decks (3 for a built garage, 3–5 for a grown one). */
  decks: number;
  /** V1.5: grown by commercial parking demand (growGarages), not placed by the player. */
  grown: boolean;
  spaces: number;
  /** Spaces handed to short buildings by allocate(). */
  allocated: number;
  /** Cars parked here right now (overflow + commuter claims). */
  parked: number;
}

export const PUBLIC_RANGE = 12;
/**
 * V1.5 service ranges (Manhattan, in cells): surface lots reach 2× the PR 6
 * range (24 cells = 6 tiles), garages 3× (36 cells = 9 tiles).
 */
export const LOT_RANGE = PUBLIC_RANGE * 2;
export const GARAGE_RANGE = PUBLIC_RANGE * 3;
export const rangeOf = (l: PublicLot) => (l.garage ? GARAGE_RANGE : LOT_RANGE);
/** V1.5: spaces per garage deck (3 decks = 40, the PR 6 garage). */
export const SPACES_PER_DECK = 40 / 3;
export const garageSpaces = (decks: number) => Math.round(SPACES_PER_DECK * decks);
/** V1.5: a surface lot holds 1 car per cell (whole tile = 16; PR 6 2×2 = 4). */
export const lotSpaces = (size: number) => size * size;
/** V1.5: garage fee per parked car per sim tick (≈ $1.50 per car per game day at 1×). */
export const GARAGE_FEE = 0.025;
/**
 * V1.5 grown garages: a commercial building whose surrounding parking demand
 * stays above GROW_RATIO × supply for GROW_CHECKS checks in a row (one check
 * every GROW_INTERVAL ticks) gets a garage on a free commercial tile nearby.
 */
export const GROW_RATIO = 1.2;
export const GROW_CHECKS = 4;
export const GROW_INTERVAL = 30;
/** Demand/supply is measured within this many cells of the shop (= lot range). */
export const DEMAND_RADIUS = LOT_RANGE;
/** Share of the required spaces filled by the time-of-day baseline (see tick). */
export const BASELINE_SHARE = 0.7;
export const LOT_SPACES = 4;
export const GARAGE_SPACES = 40;
/** Build costs (economy.ts reads these for the Roads flyout tools). */
export const LOT_COST = 480; // V1.5: whole-tile lot
export const GARAGE_COST = 1600;

interface Claim {
  /** > 0 building id, < 0 public lot id. */
  where: number;
  until: number;
}

const centre = (b: Building) => [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];
const lotCentre = (l: PublicLot) => [l.cx + l.size / 2, l.cz + l.size / 2];
const manhattan = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/** Fraction of a home's required spaces wanted at time t (0..1 of a day). */
export function homeFraction(t: number): number {
  const h = t * 24;
  // Out at work 08:30–17:00 (≈ 35 % stay home), everyone back overnight.
  const away = Math.exp(-(((h - 12.75) / 4.2) ** 4));
  return 0.92 - 0.57 * away;
}
/** Fraction of a workplace's required spaces wanted at time t. */
export function workFraction(t: number): number {
  const h = t * 24;
  const day = Math.exp(-(((h - 12.75) / 4.6) ** 4)); // a flat-topped working day
  return 0.06 + 0.9 * day;
}

export class Parking {
  lots = new Map<number, PublicLot>();
  nextId = 1;
  private claims: Claim[] = [];
  /** Session totals (tests + Inspect). */
  stats = { arrivals: 0, parked: 0, publicParked: 0, gaveUp: 0, street: 0 };

  /** Remove a public lot and free its cells. */
  removeLot(world: World, l: PublicLot): void {
    for (let z = l.cz; z < l.cz + l.size; z++) for (let x = l.cx; x < l.cx + l.size; x++) {
      const c = cidx(x, z);
      if (world.cells.owner[c] === -l.id) { world.cells.owner[c] = 0; world.cells.role[c] = CellRole.None; }
    }
    this.lots.delete(l.id);
  }

  /** Add a lot whose cells the caller already checked are free. */
  addLot(world: World, cx: number, cz: number, size: number, garage = false, decks = 3, grown = false): PublicLot {
    const spaces = garage ? garageSpaces(decks) : lotSpaces(size);
    const l: PublicLot = { id: this.nextId++, cx, cz, size, garage, decks, grown, spaces, allocated: 0, parked: 0 };
    for (let z = cz; z < cz + size; z++) for (let x = cx; x < cx + size; x++) {
      world.cells.owner[cidx(x, z)] = -l.id;
      world.cells.role[cidx(x, z)] = CellRole.Public;
      world.tiles[tileOfCell(x, z)].deco = 0;
    }
    this.lots.set(l.id, l);
    return l;
  }

  /** Public lots within walking range of building b, nearest first. */
  inRange(b: Building): PublicLot[] {
    const c = centre(b);
    // V1.5: each lot has its own reach (rangeOf: lots 2×, garages 3× PR 6).
    return [...this.lots.values()].filter((l) => manhattan(c, lotCentre(l)) <= rangeOf(l) + (b.x1 - b.x0 + b.z1 - b.z0) / 2).sort((p, q) => manhattan(c, lotCentre(p)) - manhattan(c, lotCentre(q)));
  }

  own(b: Building): number {
    return parkingSupply(TPL[b.tpl]);
  }
  required(b: Building, level = b.level): number {
    return parkingRequired(TPL[b.tpl], level);
  }
  /** Spaces available to b right now: own + granted public share. */
  available(b: Building): number {
    return this.own(b) + b.publicShare;
  }
  /** Could b's parking support `level` (own + share + unallocated public spaces nearby)? */
  canSupport(b: Building, level: number): boolean {
    const need = this.required(b, level);
    let have = this.available(b);
    if (have >= need) return true;
    for (const l of this.inRange(b)) have += Math.max(0, l.spaces - l.allocated);
    return have >= need;
  }
  shortfall(b: Building): number {
    return Math.max(0, this.required(b) - this.available(b));
  }

  /** Hand public spaces to short buildings, nearest first (see header). Cheap: O(short buildings × lots). */
  allocate(lots: Lots): void {
    for (const l of this.lots.values()) l.allocated = 0;
    const short: Building[] = [];
    for (const b of lots.buildings.values()) {
      b.publicShare = 0;
      if (b.level > 0 && this.required(b) > this.own(b)) short.push(b);
    }
    if (!this.lots.size) return;
    for (const b of short) {
      let need = this.required(b) - this.own(b);
      for (const l of this.inRange(b)) {
        const take = Math.min(need, l.spaces - l.allocated);
        if (take <= 0) continue;
        l.allocated += take;
        b.publicShare += take;
        need -= take;
        if (!need) break;
      }
    }
  }

  /** Per-tick occupancy (see header). */
  tick(world: World, lots: Lots): void {
    const tod = timeOfDay(world.clock);
    // Expire commuter stays.
    this.claims = this.claims.filter((c) => c.until > world.clock);
    const claimed = new Map<number, number>();
    for (const c of this.claims) claimed.set(c.where, (claimed.get(c.where) ?? 0) + 1);
    for (const l of this.lots.values()) l.parked = claimed.get(-l.id) ?? 0;
    this.chargeFees(world);
    for (const b of lots.buildings.values()) {
      b.arrivals *= 0.995; // decay: "recent" history (≈ 200 ticks half-life)
      b.gaveUp *= 0.995;
      if (b.level <= 0) { b.parked = 0; continue; }
      const tpl = TPL[b.tpl];
      const frac = tpl.zone === 'residential' ? homeFraction(tod) : workFraction(tod);
      // Wanted cars: baseline for the time of day + commuters who parked here.
      // The baseline already stands for "the cars that are here at this hour",
      // and the commuters we simulate are some of those cars — so they are
      // not added on top: wanted = max(baseline, commuter claims). A claim
      // still needs a free space at the moment it arrives (claim()).
      const want = Math.max(Math.round(this.required(b) * frac * BASELINE_SHARE), claimed.get(b.id) ?? 0);
      const own = this.own(b);
      b.parked = Math.min(own, want);
      let over = want - b.parked;
      if (over > 0) for (const l of this.inRange(b)) {
        const take = Math.min(over, l.spaces - l.parked);
        if (take <= 0) continue;
        l.parked += take;
        over -= take;
        if (!over) break;
      }
    }
  }

  /**
   * A commuter arrived at building b. Park (own → public) or give up.
   * Returns true if it parked. `stayHours` in game hours.
   */
  claim(world: World, b: Building, stayHours: number): boolean {
    this.stats.arrivals++;
    b.arrivals++;
    const until = world.clock + (stayHours / 24) * DAY_SECONDS;
    if (b.parked < this.own(b)) {
      b.parked++;
      this.claims.push({ where: b.id, until });
      this.stats.parked++;
      return true;
    }
    for (const l of this.inRange(b)) {
      if (l.parked >= l.spaces) continue;
      l.parked++;
      this.claims.push({ where: -l.id, until });
      this.stats.publicParked++;
      return true;
    }
    // Homes: residents always find somewhere — the kerb outside (not drawn,
    // not a "give up"). Shops / workplaces: the driver gives up.
    if (TPL[b.tpl].zone === 'residential') { this.stats.street++; return true; }
    b.gaveUp++;
    this.stats.gaveUp++;
    return false;
  }

  /**
   * V1.5: garages charge drivers. Called each tick with the PREVIOUS tick's
   * occupancy (lots only refill further down); booked as trade income.
   */
  private feeCarry = 0;
  private chargeFees(world: World): void {
    let cars = 0;
    for (const l of this.lots.values()) if (l.garage) cars += l.parked;
    this.feeCarry += cars * GARAGE_FEE;
    if (this.feeCarry >= 1) {
      const whole = Math.floor(this.feeCarry);
      this.feeCarry -= whole;
      world.cash += whole;
      world.ledger.trade.parking = (world.ledger.trade.parking ?? 0) + whole;
    }
  }

  /** V1.5: parking demand (required spaces) and supply (own + public) within `radius` cells of a point. */
  localBalance(lots: Lots, c: number[], radius = DEMAND_RADIUS): { demand: number; supply: number } {
    let demand = 0, supply = 0;
    for (const b of lots.buildings.values()) {
      if (b.level <= 0 || manhattan(c, centre(b)) > radius) continue;
      // Demand is what the area WANTS, not just what's built: a building
      // whose next level is blocked by parking counts its next-level need,
      // and drivers who recently gave up (no space) count on top. (Built
      // levels always fit their parking, so "required" alone never exceeds
      // supply.)
      const tpl = TPL[b.tpl];
      const blocked = b.level < tpl.maxLevel && !this.canSupport(b, b.level + 1);
      demand += (blocked ? this.required(b, b.level + 1) : this.required(b)) + b.gaveUp;
      supply += this.own(b);
    }
    for (const l of this.lots.values()) if (manhattan(c, lotCentre(l)) <= Math.max(radius, rangeOf(l))) supply += l.spaces;
    return { demand, supply };
  }

  /** Per-building streak of "parking demand > 120 % of supply" checks (not saved; rebuilt in minutes). */
  pressure = new Map<number, number>();

  /**
   * V1.5 GROWN GARAGES. Every GROW_INTERVAL ticks, each commercial building
   * measures the parking balance around it. After GROW_CHECKS checks in a
   * row above GROW_RATIO, the free commercial-zoned tile nearest to it (all
   * 16 cells zoned commercial and unowned, next to a road) grows a garage
   * — 3 decks, 4 if demand is > 1.6× supply, 5 if > 2×. At most one garage
   * grows per check so a whole district doesn't turn to concrete at once.
   * `freeTile(x, z)` comes from the sim (it knows roads/zones/buildability).
   */
  growGarages(world: World, lots: Lots, freeTile: (x: number, z: number) => boolean): PublicLot | null {
    // Measuring is every GROW_INTERVAL ticks; looking for a free tile for the
    // hot list is every tick, and the sim calls this BEFORE lots grow, so a
    // freshly zoned commercial tile can become a garage before a shop claims it.
    if (world.tick % GROW_INTERVAL === 0) this.hot = this.measure(lots);
    const hot = this.hot.filter((h) => lots.buildings.has(h.b.id));
    if (!hot.length) return null;
    let best: { b: Building; ratio: number } | null = null;
    let spot: [number, number] | null = null;
    for (const h of hot) {
      const [bx, bz] = centre(h.b).map((v) => Math.floor(v / 4)); // cells → tiles
      let d0 = Infinity;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const x = bx + dx, z = bz + dz, d = Math.abs(dx) + Math.abs(dz);
        if (d < d0 && freeTile(x, z)) { spot = [x, z]; d0 = d; }
      }
      if (spot) { best = h; break; }
    }
    if (!best || !spot) return null;
    const decks = best.ratio > 2 ? 5 : best.ratio > 1.6 ? 4 : 3;
    const l = this.addLot(world, spot[0] * 4, spot[1] * 4, 4, true, decks, true);
    this.pressure.clear(); // everyone re-measures with the new supply
    this.hot = [];
    this.allocate(lots);
    return l;
  }

  /** Buildings whose pressure streak reached GROW_CHECKS, worst first. */
  private hot: Array<{ b: Building; ratio: number }> = [];
  private measure(lots: Lots): Array<{ b: Building; ratio: number }> {
    const hot: Array<{ b: Building; ratio: number }> = [];
    for (const b of lots.buildings.values()) {
      if (b.level <= 0 || TPL[b.tpl].zone !== 'commercial') continue;
      const { demand, supply } = this.localBalance(lots, centre(b));
      const ratio = demand / Math.max(1, supply);
      const streak = ratio > GROW_RATIO ? (this.pressure.get(b.id) ?? 0) + 1 : 0;
      this.pressure.set(b.id, streak);
      if (streak >= GROW_CHECKS) hot.push({ b, ratio });
    }
    return hot.sort((p, q) => q.ratio - p.ratio);
  }

  /** Occupancy summary for the HUD / tests. */
  totals(lots: Lots): { spaces: number; parked: number; publicSpaces: number; publicParked: number; short: number } {
    let spaces = 0, parked = 0, short = 0, publicSpaces = 0, publicParked = 0;
    for (const b of lots.buildings.values()) {
      if (b.level <= 0) continue;
      spaces += this.own(b);
      parked += b.parked;
      if (this.shortfall(b) > 0) short++;
    }
    for (const l of this.lots.values()) { publicSpaces += l.spaces; publicParked += l.parked; }
    return { spaces, parked, publicSpaces, publicParked, short };
  }
}

/** Can a public lot of `size` cells go at (cx, cz)? Free cells on buildable, non-road land (zoned or not). */
export function lotFits(world: World, cx: number, cz: number, size: number, buildable: (t: Tile) => boolean): boolean {
  if (cx < 0 || cz < 0 || cx + size > CELL_GRID || cz + size > CELL_GRID) return false;
  for (let z = cz; z < cz + size; z++) for (let x = cx; x < cx + size; x++) {
    if (world.cells.owner[cidx(x, z)] !== 0) return false;
    if (!buildable(world.tiles[tileOfCell(x, z)])) return false;
  }
  return true;
}
