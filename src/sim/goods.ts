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
 */
import { GRID_SIZE, Tile } from './types';
import { World } from './grid';
import { Resource } from './resources';
import { hash2 } from './random';
import { roadNextTo, Traffic } from './traffic';
import { FUEL_MAX } from './rules';

export type GoodType = 'goods' | 'food' | 'lumber' | 'stone' | 'oil' | 'coal';

export const GOOD_NAMES: Record<GoodType, string> = { goods: 'Manufactured goods', food: 'Food', lumber: 'Lumber', stone: 'Stone', oil: 'Oil', coal: 'Coal' };
/**
 * Units in one truckload. PR 5: 4 → 16 — each truck carries 4× more, so
 * deliveries/exports/imports/fuel runs are ~4× rarer while goods throughput
 * (PRODUCE_RATE / SELL_RATE) is unchanged. Stock caps, prices and the import
 * interval below are scaled ×4 to match.
 */
export const LOAD = 16;
export const PRODUCE_RATE = 0.12;
export const SELL_RATE = 0.06;
/** A shop orders more when below this. Factories stop producing at FACTORY_MAX. */
export const SHOP_LOW = 12;
export const SHOP_MAX = 40;
export const FACTORY_MAX = 48;
/** $ per truckload exported through the edge connection. */
export const EXPORT_PRICE: Record<GoodType, number> = { goods: 240, food: 180, lumber: 220, stone: 200, oil: 320, coal: 0 };
export const IMPORT_EVERY = 80;
/** Power plant fuel. One load = LOAD × FUEL_PER_UNIT fuel. */
export const FUEL_BURN = 0.2;
export const FUEL_ORDER = 22;
export const FUEL_PER_UNIT = 5;
export const COAL_PRICE = 600; // per (4× bigger) load — same $ per unit as PR 4

/** What an (industrial) tile produces. */
export function factoryGood(world: World, i: number): GoodType {
  if (world.tier < 2) return 'goods';
  switch (world.resourceAt(i)) {
    case Resource.Farmland: return 'food';
    case Resource.Logging: return 'lumber';
    case Resource.Quarry: return 'stone';
    case Resource.Oil: return 'oil';
    default: return 'goods';
  }
}

/** What a (commercial) tile sells. */
export function shopGood(world: World, i: number): GoodType {
  const r = hash2(i % GRID_SIZE, Math.floor(i / GRID_SIZE), world.seed + 321);
  return r < 0.5 ? 'goods' : r < 0.8 ? 'food' : 'lumber';
}

const manhattan = (a: number, b: number) => Math.abs((a % GRID_SIZE) - (b % GRID_SIZE)) + Math.abs(Math.floor(a / GRID_SIZE) - Math.floor(b / GRID_SIZE));

export class Shipping {
  /** Tiles with a truck already on its way TO them (don't double-order). */
  private incoming = new Set<number>();
  private lastImport = new Map<number, number>();
  /** Running totals for tests and the info panel. */
  stats = { delivered: 0, exported: 0, imported: 0, fuelLoads: 0 };

  isIncoming(i: number): boolean {
    return this.incoming.has(i);
  }

  /**
   * One tick of the goods economy. `operating(i)` says whether tile i has
   * road+power+water. Money is booked into world.ledger.trade.
   */
  tick(world: World, traffic: Traffic, operating: (i: number) => boolean, maxTrucks: number): void {
    const tiles = world.tiles;
    const edge = world.edgeIndex;
    const trucks = () => traffic.count('truck');
    const factories: number[] = [], shops: number[] = [], plants: number[] = [];
    tiles.forEach((t, i) => {
      if (t.structure === 'powerPlant') plants.push(i);
      if (!t.zone || t.level === 0 || t.construct > 0 || !operating(i)) return;
      if (t.zone === 'industrial') {
        factories.push(i);
        t.stock = Math.min(FACTORY_MAX, t.stock + t.level * PRODUCE_RATE);
      } else if (t.zone === 'commercial') {
        shops.push(i);
        t.stock = Math.max(0, t.stock - t.level * SELL_RATE);
      }
    });

    // ---- Power plants burn fuel and order more ----
    for (const p of plants) {
      const t = tiles[p];
      t.stock = Math.max(0, t.stock - FUEL_BURN);
      if (t.stock >= FUEL_ORDER || this.incoming.has(p) || trucks() >= maxTrucks) continue;
      const dest = roadNextTo(tiles, p);
      if (dest < 0) continue; // no road: can't be refuelled
      // Prefer local oil.
      const oilSrc = factories.find((f) => tiles[f].stock >= LOAD && factoryGood(world, f) === 'oil');
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
      const good = factoryGood(world, f);
      const from = roadNextTo(tiles, f);
      if (from < 0) continue;
      // Nearest needy shop selling this good.
      let best = -1, bestD = Infinity;
      for (const s of shops) {
        if (shopGood(world, s) !== good || tiles[s].stock >= SHOP_LOW || this.incoming.has(s)) continue;
        const d = manhattan(f, s);
        if (d < bestD) { bestD = d; best = s; }
      }
      if (best >= 0) {
        const shop = best;
        if (traffic.spawn(world, 'truck', from, roadNextTo(tiles, shop), `delivery: ${good}`, undefined, () => this.deliver(world, shop))) {
          t.stock -= LOAD;
          this.incoming.add(shop);
          continue;
        }
      }
      // Nobody local needs it: export (only once the factory is full, so shops get first dibs).
      if (t.stock >= FACTORY_MAX - 4 && edge >= 0) {
        const price = EXPORT_PRICE[good] * world.exportBonus;
        if (traffic.spawn(world, 'truck', from, edge, `export: ${good}`, undefined, () => {
          world.ledger.trade.exports += price;
          world.cash += price;
          this.stats.exported++;
        })) t.stock -= LOAD;
      }
    }

    // ---- Empty shops with no supplier on the way import from outside ----
    for (const s of shops) {
      const t = tiles[s];
      if (t.stock > 0.5 || this.incoming.has(s) || edge < 0 || trucks() >= maxTrucks) continue;
      if (world.tick - (this.lastImport.get(s) ?? -1e9) < IMPORT_EVERY) continue;
      const good = shopGood(world, s);
      if (factories.some((f) => factoryGood(world, f) === good)) continue; // a local factory will come
      this.lastImport.set(s, world.tick);
      if (traffic.spawn(world, 'truck', edge, roadNextTo(tiles, s), `import: ${good}`, undefined, () => this.deliver(world, s))) this.incoming.add(s);
    }
  }

  private deliver(world: World, shop: number): void {
    this.incoming.delete(shop);
    const t: Tile = world.tiles[shop];
    if (t.zone !== 'commercial') return; // bulldozed while the truck was driving
    t.stock = Math.min(SHOP_MAX, t.stock + LOAD);
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
