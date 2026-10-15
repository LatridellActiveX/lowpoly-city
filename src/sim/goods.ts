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
import { RECIPES, refreshRoles, roleOf, roleOutput, ROLE_NAMES } from './chains';

/** Hopper size of a processor (raw input waiting). Also used by food plants. */
export const PLANT_INPUT_MAX = 48;
/** Input units a processor converts per tick per level (1 in → 1 out). */
export const PROCESS_RATE = 0.15;

export type GoodType = 'goods' | 'food' | 'lumber' | 'stone' | 'oil' | 'coal' | 'packaged'
  | 'wood' | 'materials' | 'furniture' | 'fuel' | 'plastics' | 'electronics'
  | 'apparel' | 'medicine' | 'beverages';

export const GOOD_NAMES: Record<GoodType, string> = {
  goods: 'Manufactured goods', food: 'Food', lumber: 'Lumber', stone: 'Stone', oil: 'Crude oil', coal: 'Coal', packaged: 'Packaged food',
  wood: 'Logs', materials: 'Building materials', furniture: 'Furniture', fuel: 'Fuel', plastics: 'Plastics', electronics: 'Electronics',
  apparel: 'Clothing', medicine: 'Medicine', beverages: 'Beverages',
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
  apparel: 460, medicine: 640, beverages: 300,
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
  const r = hash2(i % GRID_SIZE, Math.floor(i / GRID_SIZE), world.seed + 321);
  return r < 0.27 ? 'goods' : r < 0.45 ? 'food' : r < 0.53 ? 'materials' : r < 0.61 ? 'furniture' : r < 0.69 ? 'electronics' : r < 0.75 ? 'fuel' : r < 0.86 ? 'apparel' : 'medicine';
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
  stats = { depotExports: 0, depotImports: 0, delivered: 0, exported: 0, imported: 0, fuelLoads: 0, processed: 0, materialsUsed: 0, chainLoads: 0 };

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
    const depots = serviceAnchors(world, Svc.Depot);
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
        if (rec) {
          // PROCESSOR: convert hopper input 1:1 into output.
          const r = Math.min(t.input, t.level * PROCESS_RATE, FACTORY_MAX - t.stock);
          if (r > 0) {
            t.input -= r; t.stock += r; this.stats.processed += r;
            // Inputs consumed at the wholesale price (premium if imported) + chips.
            this.book(this.costs, i, r * this.unit(rec.inputs[0]) * (this.importedSupply.has(i) ? IMPORT_PREMIUM : 1) + (role === 'electronics' ? r * CHIP_COST : 0));
            this.book(this.sales, i, r * this.unit(rec.outputs[0]));
          }
        } else {
          // Extractors / farms / plain factories: value of what they produced.
          const before = t.stock;
          t.stock = Math.min(FACTORY_MAX, t.stock + (isFarmLot(world, i) ? farmRate(PRODUCE_RATE, fieldCount(world, i)) : t.level * PRODUCE_RATE));
          this.book(this.sales, i, (t.stock - before) * this.unit(roleOutput(world, i, role)));
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

    // ---- Factories ship full loads ----
    for (const f of factories) {
      const t = tiles[f];
      if (t.stock < LOAD || trucks() >= maxTrucks) continue;
      const role = roleOf(world, f);
      let good = factoryGood(world, f);
      if (role === 'refinery') { const fl = !this.flip.get(f); this.flip.set(f, fl); good = fl ? 'fuel' : 'plastics'; }
      const from = roadNextTo(tiles, f);
      if (from < 0) continue;
      const price = EXPORT_PRICE[good];
      // 1) A processor that takes this good, with room in its hopper (nearest).
      let plant = -1, pd = Infinity;
      for (const p of factories) {
        const rec = RECIPES[roleOf(world, p)];
        if (!rec || !rec.inputs.includes(good) || tiles[p].input > PLANT_INPUT_MAX - LOAD || this.incoming.has(-1 - p)) continue;
        const d = manhattan(f, p);
        if (d < pd) { pd = d; plant = p; }
      }
      if (plant >= 0) {
        const p = plant;
        if (traffic.spawn(world, 'truck', from, roadNextTo(tiles, p), `delivery: ${good} to ${ROLE_NAMES[roleOf(world, p)]}`, good === 'food' ? 0x6e9e3a : undefined, () => this.feedPlant(world, p))) {
          t.stock -= LOAD; this.incoming.add(-1 - p); this.importedSupply.delete(p);
          this.stats.chainLoads++;
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
        if (traffic.spawn(world, 'truck', from, roadNextTo(tiles, shop), `delivery: ${good}`, undefined, () => this.deliver(world, shop))) {
          t.stock -= LOAD; this.incoming.add(shop); this.importedSupply.delete(shop);
          continue;
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

    // ---- Imports: empty shops, starving processors and yards with no local supplier ----
    const localMakes = new Set(factories.map((f) => factoryGood(world, f)));
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
      if (imp(s, good, s, () => this.deliver(world, s))) this.importedSupply.add(s);
    }
    for (const p of factories) {
      const rec = RECIPES[roleOf(world, p)];
      if (!rec || tiles[p].input > 0.5 || rec.inputs.some((g) => localMakes.has(g))) continue;
      const good = rec.inputs[0];
      if (imp(p, good, -1 - p, () => this.feedPlant(world, p))) this.importedSupply.add(p);
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

  private deliver(world: World, shop: number): void {
    this.incoming.delete(shop);
    const t: Tile = world.tiles[shop];
    if (t.zone !== 'commercial' && t.structure !== 'constructionYard') return; // bulldozed while the truck was driving
    t.stock = Math.min(SHOP_MAX, t.stock + LOAD);
    this.stats.delivered++;
  }

  private feedPlant(world: World, plant: number): void {
    this.incoming.delete(-1 - plant);
    const t = world.tiles[plant];
    if (t.zone !== 'industrial' || !RECIPES[roleOf(world, plant)]) return; // bulldozed / changed meanwhile
    t.input = Math.min(PLANT_INPUT_MAX, t.input + LOAD);
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
