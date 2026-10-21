/**
 * sim/goods.ts — PR 4 goods, shipping and power-plant fuel.
 *
 * GOOD TYPES
 * ----------
 *   goods  — manufactured goods: what an ordinary factory makes
 *   food   — from factories on FARMLAND patches
 *   lumber — from factories on LOGGING patches
 *   stone  — from factories on QUARRY patches
 *   oil    — from factories on OIL patches (also fuels power plants)
 *   coal   — never made here: always IMPORTED for power plants
 * Patch goods only start once the city reaches the 2,000-people tier
 * (progression.ts); before that every factory makes `goods`.
 *
 * Every shop SELLS one type (picked by a hash of its tile): general stores
 * sell goods, grocers food, hardware stores lumber.
 *
 * THE LOOP (every tick, see Shipping.tick)
 * ----------------------------------------
 *  1. Operating factories produce `level × PRODUCE_RATE` units into tile.stock.
 *  2. Operating shops sell `level × SELL_RATE` units off their shelves.
 *  3. A factory holding a full truck LOAD dispatches a truck (if under the
 *     Settings truck cap):
 *       a) to the nearest shop that sells its good, is low on stock and has no
 *          truck already coming, or
 *       b) to a power plant that's low on fuel (oil only), or
 *       c) otherwise to the out-of-city connection to EXPORT it for cash.
 *     The cargo only counts when the truck ARRIVES (traffic.ts onArrive).
 *  4. A shop that's empty and has no local supplier gets an IMPORT truck from
 *     the edge every IMPORT_EVERY ticks (merchants pay; free for the city).
 *  5. Power plants burn FUEL_BURN per tick. Below FUEL_ORDER they order fuel:
 *     local oil if a factory has some, else imported coal (the city pays
 *     COAL_PRICE). An empty plant drops to UNFUELLED_OUTPUT (networks.ts).
 *
 * WHY IT MATTERS: shops with empty shelves pay half tax (economy.ts), and
 * exports are a new income line in the budget.
 *
 * V1.5 STAGE 10 — RESOURCE INDUSTRIES + GOODS CHAINS (see chains.ts)
 * -------------------------------------------------------------------
 * Industry zoned on a resource patch becomes the matching EXTRACTOR from the
 * start (no tier gate any more): logging camp (wood), oil rig (oil), quarry
 * (stone), farm (food). Every other factory picks a PROCESSOR recipe for
 * whatever the city's extractors make:
 *
 *    wood ─▶ LUMBER MILL ─▶ lumber ─┬▶ FURNITURE FACTORY ─▶ furniture
 *                                   └▶ MATERIALS PLANT ──▶ building materials
 *    stone ───────────────────────────▶ MATERIALS PLANT
 *    oil ──▶ REFINERY ─▶ fuel + plastics ─▶ ELECTRONICS (+ imported chips)
 *    food ─▶ FOOD PLANT ─▶ packaged food
 *    ore ──▶ STEEL MILL ─▶ steel ─┬▶ VEHICLE PLANT (+ plastics) ─▶ vehicles ─▶ car dealerships
 *                                 └▶ MATERIALS PLANT (steel instead of stone; IND-5)
 *
 * Raw/intermediate loads go to the nearest processor that takes them (its
 * `input` hopper); finished goods go to shops that sell them; building
 * materials go to Construction Yards (crews use them on every site);
 * surplus is EXPORTED. A processor with no local supplier and shops with
 * no local factory IMPORT at IMPORT_PREMIUM × the export price — that cost
 * lands on the buyer's books (`costs`, read by stage 11 profit), and the
 * city itself pays for imported building materials.
 */
import { GRID_SIZE, Tile } from './types';
import { World } from './grid';
import { hash2 } from './random';
import { roadNextTo, Traffic } from './traffic';
import { FUEL_MAX } from './rules';
import { SERVICE_DEFS, serviceAnchors, Svc } from './services';
import { farmRate, fieldCount, isFarmLot } from './industry';
import { ChainFlow } from './chainFlow';
import { isNight, outputMult, runningCostShare } from './factoryCtl';
import { timeOfDay } from './traffic';
import { recycleMode } from './recycleMode';
import { RECIPES, refreshRoles, roleOf, roleOutput, ROLE_NAMES } from './chains';

/** Hopper size of a processor (raw input waiting). Also used by food plants. */
export const PLANT_INPUT_MAX = 48;
/** Input units a processor converts per tick per level (1 in → 1 out). */
export const PROCESS_RATE = 0.15;

export type GoodType = 'goods' | 'food' | 'lumber' | 'stone' | 'oil' | 'coal' | 'packaged'
  | 'wood' | 'materials' | 'furniture' | 'fuel' | 'plastics' | 'electronics'
  | 'apparel' | 'medicine' | 'beverages' | 'books' | 'toys'
  | 'ore' | 'steel' | 'vehicles'; // IND-5

export const GOOD_NAMES: Record<GoodType, string> = {
  goods: 'Manufactured goods', food: 'Food', lumber: 'Lumber', stone: 'Stone', oil: 'Crude oil', coal: 'Coal', packaged: 'Packaged food',
  wood: 'Logs', materials: 'Building materials', furniture: 'Furniture', fuel: 'Fuel', plastics: 'Plastics', electronics: 'Electronics',
  apparel: 'Clothing', medicine: 'Medicine', beverages: 'Beverages', books: 'Books', toys: 'Toys',
  ore: 'Iron ore', steel: 'Steel', vehicles: 'Vehicles', // IND-5
};
/** Units in one truckload (PR 5: 16). */
export const LOAD = 16;
export const PRODUCE_RATE = 0.12;
export const SELL_RATE = 0.06;
/** A shop orders more when below this. Factories stop producing at FACTORY_MAX. */
export const SHOP_LOW = 12;
export const SHOP_MAX = 40;
export const FACTORY_MAX = 48;
/**
 * $ per truckload exported through the edge connection. Each step up a
 * chain is worth more than its inputs, so processing locally pays.
 */
export const EXPORT_PRICE: Record<GoodType, number> = {
  goods: 240, food: 180, lumber: 220, stone: 200, oil: 320, coal: 0, packaged: 420,
  wood: 140, materials: 360, furniture: 520, fuel: 400, plastics: 380, electronics: 760,
  apparel: 460, medicine: 640, beverages: 300, books: 340, toys: 420,
  ore: 180, steel: 480, vehicles: 900, // IND-5
};
/** V1.5: an imported load costs this × its export price (freight + middlemen). */
export const IMPORT_PREMIUM = 1.5;
/** V1.5: imported chips an electronics plant pays per unit it assembles. */
export const CHIP_COST = 12;
export const IMPORT_EVERY = 80;
/** Power plant fuel. One load = LOAD × FUEL_PER_UNIT fuel. */
export const FUEL_BURN = 0.2;
export const FUEL_ORDER = 22;
export const FUEL_PER_UNIT = 5;
export const COAL_PRICE = 600;
/** V1.5: building materials a crew uses per tick on an active construction site. */
export const MATERIAL_USE = 0.04;
/**
 * IND-5: Construction Yards stocked with STEEL-BASED building materials (made
 * by a materials plant fed with steel) build this much faster (growth.ts:
 * every 5th work tick counts twice = +20%).
 */
export const STEEL_BUILD_BONUS = 0.2;
/** IND-4: a working factory sends a night-shift truck about this often at night (ticks)… */
export const NIGHT_TRUCK_EVERY = 90;
/** …and forgets a truck that never arrived after this many ticks. */
export const NIGHT_TRUCK_TIMEOUT = 600;

/** Does a shop selling `sells` accept a load of `good`? Grocers take packaged food too. */
export const shopAccepts = (sells: GoodType, good: GoodType) => sells === good || (sells === 'food' && (good === 'packaged' || good === 'beverages'));

/** What an (industrial) tile produces right now (see chains.ts roleOf). */
export function factoryGood(world: World, i: number): GoodType {
  return roleOutput(world, i, roleOf(world, i));
}

/**
 * What a (commercial) tile sells. V1.5: shops buy FINISHED goods only —
 * general stores, grocers, hardware (building materials), furniture,
 * electronics and gas stations (fuel).
 */
export function shopGood(world: World, i: number): GoodType {
  // IND-5: a CAR DEALERSHIP (footprints.ts car_dealer) sells vehicles. Every
  // other shop keeps the type its tile hash gives it (unchanged).
  if (world.tiles[i].zone === 'commercial' && world.lots.hostedOn(i).some((b) => b.tpl === 'car_dealer')) return 'vehicles';
  const r = hash2(i % GRID_SIZE, Math.floor(i / GRID_SIZE), world.seed + 321);
  return r < 0.24 ? 'goods' : r < 0.40 ? 'food' : r < 0.47 ? 'materials' : r < 0.54 ? 'furniture' : r < 0.61 ? 'electronics' : r < 0.66 ? 'fuel' : r < 0.75 ? 'apparel' : r < 0.81 ? 'medicine' : r < 0.90 ? 'books' : 'toys';
}

const manhattan = (a: number, b: number) => Math.abs((a % GRID_SIZE) - (b % GRID_SIZE)) + Math.abs(Math.floor(a / GRID_SIZE) - Math.floor(b / GRID_SIZE));

/** V1.5b stage C: export bonus for loads consolidated at a shipping depot. */
export const DEPOT_BONUS = 0.15;
/** V1.5b stage C: factories in a depot catchment ship once they hold this much (vs nearly full). */
export const DEPOT_SHIP_AT = 24;
/**
 * V1.5b stage C: the depot (anchor index) whose catchment holds tile i —
 * the nearest one within its radius (Chebyshev from the 2×2 centre) — or −1.
 */
export function depotOf(depots: number[], i: number): number {
  const N = GRID_SIZE, x = i % N, z = Math.floor(i / N), r = SERVICE_DEFS[Svc.Depot].radius;
  let best = -1, bd = Infinity;
  for (const a of depots) {
    const d = Math.max(Math.abs(x - ((a % N) + 0.5)), Math.abs(z - (Math.floor(a / N) + 0.5))) - 0.5;
    if (d <= r && d < bd) { bd = d; best = a; }
  }
  return best;
}

/** A road tile next to any of a 2×2 depot's tiles (anchor a), or −1. */
export function depotRoad(tiles: Tile[], a: number): number {
  for (const d of [0, 1, GRID_SIZE, GRID_SIZE + 1]) { const r = roadNextTo(tiles, a + d); if (r >= 0) return r; }
  return -1;
}

/**
 * IND-7 — WAREHOUSES (services.ts Svc.Warehouse, stock in world.warehouses).
 *
 *  - A warehouse holds up to WAREHOUSE_CAP units of EACH good.
 *  - DROP-OFF: a factory within WAREHOUSE_REACH tiles (Manhattan distance)
 *    whose full load has no processor or needy shop to go to drops it at the
 *    warehouse instead of waiting / exporting.
 *  - PICK-UP FIRST: every tick, before factories ship, needy shops, Construction
 *    Yards (materials) and processors (their input) within reach are restocked
 *    from a warehouse that holds a full LOAD of what they need.
 *  - Shops whose good sits in a warehouse in reach don't import it.
 * Stock is booked when the truck ARRIVES at the warehouse and taken out when
 * the truck LEAVES it (like factories).
 */
export const WAREHOUSE_CAP = 400;
export const WAREHOUSE_REACH = 20;
/** Units of good g in warehouse a. */
export const whHas = (world: World, a: number, g: GoodType): number => world.warehouses[a]?.[g] ?? 0;

/** IND-5: `incoming` key of a plant's SECOND hopper (main hopper is −1 − p, shops are p). */
const secondKey = (p: number) => -2e7 - p;
/** IND-7: `incoming` key of "a truck is bringing good g to warehouse a" (one per good). */
const whKey = (a: number, g: GoodType) => 3e7 + a * 64 + Object.keys(EXPORT_PRICE).indexOf(g);

export class Shipping {
  /** Tiles with a truck already on its way TO them (negative key = a processor's input side). */
  private incoming = new Set<number>();
  private lastImport = new Map<number, number>();
  /** Refinery output toggle (fuel / plastics loads alternate). */
  private flip = new Map<number, boolean>();
  /**
   * V1.5: money each building spent on inputs THIS month (local purchases at
   * the export price, imports at the premium, chips). Stage 11 profit reads
   * it; `sales` is the matching revenue. Both reset every month.
   */
  costs = new Map<number, number>();
  sales = new Map<number, number>();
  /**
   * Was a building's last delivery IMPORTED? Its goods then cost the
   * IMPORT_PREMIUM. Profit is booked as goods FLOW (units sold / processed /
   * produced × unit price), not per truck, so a month isn't swung by when a
   * 16-unit load happened to arrive.
   */
  private importedSupply = new Set<number>();
  private unit = (g: GoodType) => EXPORT_PRICE[g] / LOAD;
  /** Running totals for tests and the info panel. */
  /**
   * V1.5b stage C — SHIPPING DEPOTS. Loads handled per depot anchor
   * (exports received + imports sent), for Inspect. Not saved (a running count).
   */
  depotLoads = new Map<number, number>();
  /** IND-2: producer → customer links for the Supply chain view (chainFlow.ts). Not saved. */
  flow = new ChainFlow();
  /**
   * IND-5: the SECOND hopper of recipes with a `needs` ingredient (vehicle
   * plant: plastics), plant tile → units. Not saved: after a reload it
   * refills with the next delivery (the main hopper tile.input is saved).
   */
  second = new Map<number, number>();
  /** IND-5: materials plants whose last hopper load was steel (their materials are steel-based). */
  private steelFed = new Set<number>();
  /** IND-5: Construction Yards whose current materials are steel-based. Not saved. */
  steelYards = new Set<number>();
  /** IND-5: does any yard hold steel-based materials right now? (growth.ts builds 20% faster.) */
  steelBoost(world: World): boolean {
    for (const y of this.steelYards) { const t = world.tiles[y]; if (t.structure === 'constructionYard' && t.stock > 0) return true; }
    return false;
  }
  stats = { depotExports: 0, depotImports: 0, delivered: 0, exported: 0, imported: 0, fuelLoads: 0, processed: 0, materialsUsed: 0, chainLoads: 0, shopLoads: 0, nightTrucks: 0, warehouseIn: 0, warehouseOut: 0 };

  isIncoming(i: number): boolean {
    return this.incoming.has(i);
  }

  private book(m: Map<number, number>, i: number, v: number) { m.set(i, (m.get(i) ?? 0) + v); }

  /** Called by the simulation at each month boundary (after profit is read). */
  resetMonth(): void { this.costs.clear(); this.sales.clear(); }

  /**
   * One tick of the goods economy. `operating(i)` says whether tile i has
   * road+power+water. Money is booked into world.ledger.trade.
   */
  tick(world: World, traffic: Traffic, operating: (i: number) => boolean, maxTrucks: number): void {
    const tiles = world.tiles;
    const edge = world.edgeIndex;
    const trucks = () => traffic.count('truck');
    const factories: number[] = [], shops: number[] = [], plants: number[] = [], yards: number[] = [];
    let sites = 0;
    refreshRoles(world, operating);
    // V1.5b stage C: road-connected depots and who is inside their catchment.
    // IND-7: one scan for every service anchor (depots, warehouses, recyclers) instead of one per kind.
    const svcs = serviceAnchors(world);
    const depots = svcs.filter((a) => tiles[a].kind === Svc.Depot);
    const depotFor = (i: number): number => depotOf(depots, i);
    world.chunks.activeTilesSorted().forEach((i) => { const t = tiles[i]; // V1.6 A2: active chunks only
      if (t.structure === 'powerPlant' && !t.part) plants.push(i); // V1.5b: a 2×2 coal plant is fuelled at its anchor
      if (t.structure === 'constructionYard') yards.push(i);
      if (t.zone && t.construct > 0 && t.crew) sites++;
      if (!t.zone || t.level === 0 || t.construct > 0 || !operating(i)) return;
      if (t.zone === 'industrial') {
        factories.push(i);
        const role = roleOf(world, i);
        const rec = RECIPES[role];
        if (t.pause > world.tick) return; // IND-1: retooling after a recipe switch (factoryCtl.ts): no output
        if (rec) {
          // PROCESSOR: convert hopper input 1:1 into output.
          // IND-3: upgrades (second shift, automation) raise the rate (factoryCtl.ts).
          // IND-5: a recipe with a second ingredient (`needs`) is also limited by that hopper.
          const sec = rec.needs ? (this.second.get(i) ?? 0) : Infinity;
          const r = Math.min(t.input, t.level * PROCESS_RATE * outputMult(world, t), FACTORY_MAX - t.stock, sec);
          if (r > 0) {
            t.input -= r; t.stock += r; this.stats.processed += r;
            if (rec.needs) { this.second.set(i, sec - r); this.book(this.costs, i, r * this.unit(rec.needs)); } // second ingredient used up and paid for
            // Inputs consumed at the wholesale price (premium if imported) + chips.
            this.book(this.costs, i, r * this.unit(rec.inputs[0]) * (this.importedSupply.has(i) ? IMPORT_PREMIUM : 1) + (role === 'electronics' ? r * CHIP_COST : 0));
            this.book(this.sales, i, r * this.unit(rec.outputs[0]));
            this.book(this.costs, i, r * this.unit(rec.outputs[0]) * runningCostShare(world, t)); // IND-3 filters
          }
        } else {
          // Extractors / farms / plain factories: value of what they produced.
          const before = t.stock;
          t.stock = Math.min(FACTORY_MAX, t.stock + (isFarmLot(world, i) ? farmRate(PRODUCE_RATE, fieldCount(world, i)) : t.level * PRODUCE_RATE) * outputMult(world, t)); // IND-3 upgrades
          const made = (t.stock - before) * this.unit(roleOutput(world, i, role));
          this.book(this.sales, i, made);
          this.book(this.costs, i, made * runningCostShare(world, t)); // IND-3 filters
        }
      } else if (t.zone === 'commercial') {
        shops.push(i);
        const sold = Math.min(t.stock, t.level * SELL_RATE);
        t.stock -= sold;
        // Retail sells at twice the wholesale (export) price per unit; the
        // goods themselves cost the wholesale price (× premium if imported).
        const u = this.unit(shopGood(world, i));
        this.book(this.sales, i, sold * u * 2);
        this.book(this.costs, i, sold * u * (this.importedSupply.has(i) ? IMPORT_PREMIUM : 1));
      }
    });

    // ---- Construction sites use building materials from the yards ----
    let need = sites * MATERIAL_USE;
    for (const y of yards) {
      const take = Math.min(need, tiles[y].stock);
      tiles[y].stock -= take; need -= take; this.stats.materialsUsed += take;
    }

    // ---- Power plants burn fuel and order more ----
    for (const p of plants) {
      const t = tiles[p];
      t.stock = Math.max(0, t.stock - FUEL_BURN);
      if (t.stock >= FUEL_ORDER || this.incoming.has(p) || trucks() >= maxTrucks) continue;
      const dest = roadNextTo(tiles, p);
      if (dest < 0) continue; // no road: can't be refuelled
      // Prefer local crude or refined fuel.
      const oilSrc = factories.find((f) => tiles[f].stock >= LOAD && (factoryGood(world, f) === 'oil' || factoryGood(world, f) === 'fuel'));
      if (oilSrc !== undefined) {
        const from = roadNextTo(tiles, oilSrc);
        if (traffic.spawn(world, 'truck', from, dest, 'fuel: oil', 0x2b2b2b, () => this.refuel(world, p))) {
          tiles[oilSrc].stock -= LOAD;
          this.incoming.add(p);
        }
      } else if (edge >= 0) {
        if (traffic.spawn(world, 'truck', edge, dest, 'fuel: imported coal', 0x4a4038, () => this.refuel(world, p))) {
          world.ledger.trade.fuel += COAL_PRICE;
          world.cash -= COAL_PRICE;
          this.incoming.add(p);
        }
      }
    }

    // ---- IND-7: warehouses restock needy customers first ----
    const whs = svcs.filter((a) => tiles[a].kind === Svc.Warehouse);
    for (const k of Object.keys(world.warehouses)) { const a = Number(k), t = tiles[a]; if (t.structure !== 'service' || t.kind !== Svc.Warehouse) delete world.warehouses[a]; } // bulldozed
    if (whs.length) this.warehousePickups(world, traffic, whs, shops, yards, factories, maxTrucks);

    // ---- Factories ship full loads ----
    // IND-6: recycling centers in a product mode ship their plastics /
    // materials through the same loop, like any other supplier.
    const recyclers = svcs.filter((a) => tiles[a].kind === Svc.Recycling && recycleMode(tiles[a]) !== '');
    for (const f of [...factories, ...recyclers]) {
      const t = tiles[f];
      if (t.stock < LOAD || trucks() >= maxTrucks) continue;
      const rmode = recycleMode(t);
      const role = rmode ? 'factory' : roleOf(world, f);
      let good: GoodType = rmode || factoryGood(world, f);
      if (role === 'refinery') { const fl = !this.flip.get(f); this.flip.set(f, fl); good = fl ? 'fuel' : 'plastics'; }
      const from = roadNextTo(tiles, f);
      if (from < 0) continue;
      const price = EXPORT_PRICE[good];
      // 1) A processor that takes this good, with room in its hopper (nearest).
      let plant = -1, pd = Infinity, toSecond = false;
      for (const p of factories) {
        const rec = RECIPES[roleOf(world, p)];
        if (!rec) continue;
        // Main hopper (any of `inputs`) or, IND-5, the second-ingredient hopper (`needs`).
        const main = rec.inputs.includes(good) && tiles[p].input <= PLANT_INPUT_MAX - LOAD && !this.incoming.has(-1 - p);
        const sec = !main && rec.needs === good && (this.second.get(p) ?? 0) <= PLANT_INPUT_MAX - LOAD && !this.incoming.has(secondKey(p));
        if (!main && !sec) continue;
        const d = manhattan(f, p);
        if (d < pd) { pd = d; plant = p; toSecond = sec; }
      }
      if (plant >= 0) {
        const p = plant, second = toSecond, steel = good === 'steel';
        if (traffic.spawn(world, 'truck', from, roadNextTo(tiles, p), `delivery: ${good} to ${ROLE_NAMES[roleOf(world, p)]}`, good === 'food' ? 0x6e9e3a : undefined, () => (second ? this.feedSecond(world, p) : this.feedPlant(world, p, steel)))) {
          t.stock -= LOAD; this.incoming.add(second ? secondKey(p) : -1 - p); if (!second) this.importedSupply.delete(p);
          this.stats.chainLoads++;
          this.flow.add(world.tick, f, p, good); // IND-2
          continue;
        }
      }
      // 2) Nearest needy shop selling it, or a Construction Yard for materials.
      let best = -1, bestD = Infinity;
      for (const s of shops) {
        if (!shopAccepts(shopGood(world, s), good) || tiles[s].stock >= SHOP_LOW || this.incoming.has(s)) continue;
        const d = manhattan(f, s);
        if (d < bestD) { bestD = d; best = s; }
      }
      if (good === 'materials') for (const y of yards) {
        if (tiles[y].stock >= SHOP_LOW || this.incoming.has(y)) continue;
        const d = manhattan(f, y);
        if (d < bestD) { bestD = d; best = y; }
      }
      if (best >= 0) {
        const shop = best;
        // IND-5: materials from a steel-fed plant are steel-based (yards build faster with them).
        const steelMat = good === 'materials' ? this.steelFed.has(f) : undefined;
        if (traffic.spawn(world, 'truck', from, roadNextTo(tiles, shop), `delivery: ${good}`, undefined, () => this.deliver(world, shop, steelMat))) {
          t.stock -= LOAD; this.incoming.add(shop); this.importedSupply.delete(shop);
          this.flow.add(world.tick, f, shop, good); this.stats.shopLoads++; // IND-2
          continue;
        }
      }
      // 2b) IND-7: a warehouse in reach with room takes the load (nearest).
      if (whs.length) {
        let wh = -1, wd = Infinity;
        for (const a of whs) { const d = manhattan(f, a); if (d <= WAREHOUSE_REACH && d < wd && whHas(world, a, good) <= WAREHOUSE_CAP - LOAD && !this.incoming.has(whKey(a, good))) { wd = d; wh = a; } }
        const to = wh >= 0 ? roadNextTo(tiles, wh) : -1;
        if (to >= 0) {
          const a = wh, g = good;
          if (traffic.spawn(world, 'truck', from, to, `to warehouse: ${good}`, undefined, () => this.storeAt(world, a, g))) {
            t.stock -= LOAD; this.incoming.add(whKey(a, g)); this.stats.warehouseIn++;
            this.flow.add(world.tick, f, a, good);
            continue;
          }
        }
      }
      // 3a) V1.5b stage C: inside a depot's catchment the surplus ships via
      //     the depot — sooner (half-full is enough), a short trip, and the
      //     depot's consolidated freight pays DEPOT_BONUS more.
      const dep = depotFor(f);
      if (dep >= 0 && t.stock >= DEPOT_SHIP_AT) {
        const pay = price * world.exportBonus * (1 + DEPOT_BONUS);
        const to = depotRoad(tiles, dep);
        if (to >= 0 && traffic.spawn(world, 'truck', from, to, `export via depot: ${good}`, undefined, () => {
          world.ledger.trade.exports += pay;
          world.cash += pay;
          this.stats.exported++; this.stats.depotExports++;
          this.book(this.depotLoads, dep, 1);
        })) { t.stock -= LOAD; continue; }
      }
      // 3) Nobody local needs it: export once the factory is full (local buyers get first dibs).
      if (t.stock >= FACTORY_MAX - 4 && edge >= 0) {
        const pay = price * world.exportBonus;
        if (traffic.spawn(world, 'truck', from, edge, `export: ${good}`, undefined, () => {
          world.ledger.trade.exports += pay;
          world.cash += pay;
          this.stats.exported++;
        })) t.stock -= LOAD;
      }
    }

    // ---- IND-4 NIGHT SHIFTS: night-shift trucks ----
    this.nightShiftTrucks(world, traffic, factories, maxTrucks);

    // ---- Imports: empty shops, starving processors and yards with no local supplier ----
    const localMakes = new Set(factories.map((f) => factoryGood(world, f)));
    for (const a of recyclers) localMakes.add(recycleMode(tiles[a]) as GoodType); // IND-6
    if (factories.some((f) => roleOf(world, f) === 'refinery')) { localMakes.add('fuel'); localMakes.add('plastics'); }
    const imp = (dest: number, good: GoodType, key: number, onArrive: () => void): boolean => {
      if (edge < 0 || trucks() >= maxTrucks || this.incoming.has(key)) return false;
      if (world.tick - (this.lastImport.get(key) ?? -1e9) < IMPORT_EVERY) return false;
      this.lastImport.set(key, world.tick);
      // V1.5b stage C: inside a depot's catchment the import comes from the depot.
      const dep = depotFor(dest), depRoad = dep >= 0 ? depotRoad(tiles, dep) : -1;
      const src = depRoad >= 0 ? depRoad : edge;
      if (!traffic.spawn(world, 'truck', src, roadNextTo(tiles, dest), depRoad >= 0 ? `import via depot: ${good}` : `import: ${good}`, undefined, onArrive)) return false;
      this.incoming.add(key); this.stats.imported++;
      if (depRoad >= 0) { this.stats.depotImports++; this.book(this.depotLoads, dep, 1); }
      return true;
    };
    for (const s of shops) {
      const good = shopGood(world, s);
      if (tiles[s].stock > 0.5 || [...localMakes].some((g) => shopAccepts(good, g))) continue; // a local factory will come
      if (whs.some((a) => manhattan(s, a) <= WAREHOUSE_REACH && whHas(world, a, good) >= LOAD)) continue; // IND-7: the warehouse will restock it
      if (imp(s, good, s, () => this.deliver(world, s))) this.importedSupply.add(s);
    }
    for (const p of factories) {
      const rec = RECIPES[roleOf(world, p)];
      if (!rec || tiles[p].input > 0.5 || rec.inputs.some((g) => localMakes.has(g))) continue;
      const good = rec.inputs[0];
      if (imp(p, good, -1 - p, () => this.feedPlant(world, p, false))) this.importedSupply.add(p);
    }
    // IND-5: second ingredient (vehicle plant plastics) with no local maker → import it.
    for (const p of factories) {
      const rec = RECIPES[roleOf(world, p)];
      if (!rec?.needs || (this.second.get(p) ?? 0) > 0.5 || localMakes.has(rec.needs)) continue;
      const need = rec.needs;
      if (imp(p, need, secondKey(p), () => this.feedSecond(world, p))) this.book(this.costs, p, LOAD * this.unit(need) * (IMPORT_PREMIUM - 1)); // premium on top of the unit cost booked when used
    }
    for (const y of yards) {
      if (tiles[y].stock > 2 || localMakes.has('materials') || sites === 0) continue;
      const cost = EXPORT_PRICE.materials * IMPORT_PREMIUM;
      if (imp(y, 'materials', y, () => this.deliver(world, y))) {
        // The CITY pays for imported building materials.
        world.ledger.trade.materials = (world.ledger.trade.materials ?? 0) + cost;
        world.cash -= cost;
      }
    }
  }

  /**
   * IND-4: factory → tick its night-shift truck left (or is due back by).
   * Each factory has AT MOST ONE night-shift truck out at a time; the entry
   * is cleared when the truck arrives, or after NIGHT_TRUCK_TIMEOUT ticks in
   * case the truck gave up and never arrived. Not saved (a reload just lets
   * the next truck go a little early).
   */
  private nightOut = new Map<number, number>();
  /**
   * While the Night shifts policy is on and it is night (22:00–06:00), every
   * working factory sends a night-shift truck (staff and supplies run to the
   * city edge) about every NIGHT_TRUCK_EVERY ticks, staggered per building,
   * never more than one per building and never past the Settings truck cap.
   */
  private nightShiftTrucks(world: World, traffic: Traffic, factories: number[], maxTrucks: number): void {
    if (!world.policies.night) { if (this.nightOut.size) this.nightOut.clear(); return; }
    if (!isNight(timeOfDay(world.clock)) || world.edgeIndex < 0) return;
    for (const f of factories) {
      if (traffic.count('truck') >= maxTrucks) return;
      const out = this.nightOut.get(f);
      if (out !== undefined && world.tick - out < NIGHT_TRUCK_TIMEOUT) continue; // one per building
      if ((world.tick + f) % NIGHT_TRUCK_EVERY !== 0) continue; // staggered so they don't all leave at once
      const from = roadNextTo(world.tiles, f);
      if (from < 0) continue;
      if (traffic.spawn(world, 'truck', from, world.edgeIndex, 'night shift', undefined, () => this.nightOut.delete(f))) {
        this.nightOut.set(f, world.tick); this.stats.nightTrucks++;
      }
    }
  }

  /** IND-7: a truck unloads `g` at warehouse a (it may have been bulldozed meanwhile: the load is lost). */
  private storeAt(world: World, a: number, g: GoodType): void {
    this.incoming.delete(whKey(a, g));
    const t = world.tiles[a];
    if (t.structure !== 'service' || t.kind !== Svc.Warehouse) return;
    const m = (world.warehouses[a] ??= {});
    m[g] = Math.min(WAREHOUSE_CAP, (m[g] ?? 0) + LOAD);
  }

  /**
   * IND-7: restock from warehouses. For every customer that needs something
   * (shop below SHOP_LOW, yard below SHOP_LOW while sites need materials,
   * processor with hopper room), the nearest warehouse in reach holding a
   * full LOAD of a good it takes sends a truck. One truck per customer at a
   * time (the usual `incoming` keys).
   */
  private warehousePickups(world: World, traffic: Traffic, whs: number[], shops: number[], yards: number[], factories: number[], maxTrucks: number): void {
    const tiles = world.tiles;
    const send = (cust: number, key: number, goods: GoodType[], arrive: (g: GoodType) => () => void): void => {
      if (traffic.count('truck') >= maxTrucks || this.incoming.has(key)) return;
      let best = -1, bd = Infinity, bg: GoodType | null = null;
      for (const a of whs) {
        const d = manhattan(cust, a); if (d > WAREHOUSE_REACH || d >= bd) continue;
        const g = goods.find((x) => whHas(world, a, x) >= LOAD);
        if (g) { best = a; bd = d; bg = g; }
      }
      if (best < 0 || !bg) return;
      const from = roadNextTo(tiles, best), to = roadNextTo(tiles, cust);
      if (from < 0 || to < 0) return;
      if (traffic.spawn(world, 'truck', from, to, `from warehouse: ${bg}`, undefined, arrive(bg))) {
        world.warehouses[best][bg]! -= LOAD; this.incoming.add(key); this.importedSupply.delete(cust);
        this.stats.warehouseOut++; this.flow.add(world.tick, best, cust, bg);
      }
    };
    const ALL = Object.keys(EXPORT_PRICE) as GoodType[];
    for (const s of shops) {
      if (tiles[s].stock >= SHOP_LOW) continue;
      const sells = shopGood(world, s);
      send(s, s, ALL.filter((g) => shopAccepts(sells, g)), () => () => this.deliver(world, s));
    }
    for (const y of yards) if (tiles[y].stock < SHOP_LOW) send(y, y, ['materials'], () => () => this.deliver(world, y));
    for (const p of factories) {
      const rec = RECIPES[roleOf(world, p)];
      if (!rec || tiles[p].input > PLANT_INPUT_MAX - LOAD) continue;
      send(p, -1 - p, rec.inputs, (g) => () => this.feedPlant(world, p, g === 'steel'));
    }
  }

  private deliver(world: World, shop: number, steelMat?: boolean): void {
    this.incoming.delete(shop);
    const t: Tile = world.tiles[shop];
    if (t.zone !== 'commercial' && t.structure !== 'constructionYard') return; // bulldozed while the truck was driving
    // IND-5: remember whether a yard's materials are steel-based (undefined = imported / not materials: unchanged).
    if (t.structure === 'constructionYard' && steelMat !== undefined) { if (steelMat) this.steelYards.add(shop); else this.steelYards.delete(shop); }
    t.stock = Math.min(SHOP_MAX, t.stock + LOAD);
    this.stats.delivered++;
  }

  private feedPlant(world: World, plant: number, steel = false): void {
    this.incoming.delete(-1 - plant);
    const t = world.tiles[plant];
    if (t.zone !== 'industrial' || !RECIPES[roleOf(world, plant)]) return; // bulldozed / changed meanwhile
    t.input = Math.min(PLANT_INPUT_MAX, t.input + LOAD);
    this.stats.delivered++;
    // IND-5: a materials plant's output counts as steel-based while its last load was steel.
    if (steel) this.steelFed.add(plant); else this.steelFed.delete(plant);
  }

  /** IND-5: a load of the second ingredient (e.g. plastics for a vehicle plant) arrives. */
  private feedSecond(world: World, plant: number): void {
    this.incoming.delete(secondKey(plant));
    const t = world.tiles[plant];
    if (t.zone !== 'industrial' || !RECIPES[roleOf(world, plant)]?.needs) return;
    this.second.set(plant, Math.min(PLANT_INPUT_MAX, (this.second.get(plant) ?? 0) + LOAD));
    this.stats.delivered++;
  }

  private refuel(world: World, plant: number): void {
    this.incoming.delete(plant);
    const t = world.tiles[plant];
    if (t.structure !== 'powerPlant') return;
    t.stock = Math.min(FUEL_MAX, t.stock + LOAD * FUEL_PER_UNIT);
    this.stats.fuelLoads++;
  }
}
