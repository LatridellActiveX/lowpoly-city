/**
 * sim/trade.ts — IND-8: RAIL YARD upgrade for the shipping depot, and
 * DRIFTING EXPORT PRICES.
 *
 * Plain TypeScript (no Three.js/DOM).
 *
 * RAIL YARD
 * ---------
 * A Shipping Depot (services.ts Svc.Depot) can be upgraded with a rail yard
 * for RAIL_COST. The upgrade is bit RAIL of the depot's anchor tile `upg`
 * (saved with the tile, like factory upgrades). A rail depot ships by TRAIN:
 *  - its catchment grows from 20 to RAIL_REACH tiles (goods.ts depotOf), so
 *    more factories send their exports to the depot instead of trucking them
 *    to the highway at the map edge, and more imports arrive at the depot;
 *  - exports through it pay RAIL_BONUS on top of the usual depot bonus
 *    (bulk freight by train is cheaper than trucks);
 *  - the depot model gets tracks and a train (render).
 * A harbor version is planned later.
 *
 * DRIFTING EXPORT PRICES
 * ----------------------
 * Every calendar month (economy.ts CALENDAR_MONTH_TICKS) each good's export
 * price multiplier takes a small random step (±DRIFT_STEP), pulled gently
 * back towards 1, and clamped to 1 ± DRIFT_MAX (±30%). The steps come from
 * a hash of (good, month, city seed), so a city replays the same prices.
 * Multipliers live in world.priceDrift (saved; missing = all 1). Only
 * EXPORT income uses them; import costs stay on the base price.
 */
import type { World } from './grid';
import { hash2 } from './random';

export const RAIL = 8; // tile.upg bit on a depot anchor (factoryCtl UPG uses 1, 2, 4)
export const RAIL_COST = 40000;
export const RAIL_REACH = 30;
export const RAIL_BONUS = 0.1;
export const DRIFT_MAX = 0.3;
export const DRIFT_STEP = 0.08;

/** Does the depot anchored at tile a have a rail yard? */
export const hasRail = (world: World, a: number): boolean => (world.tiles[a].upg & RAIL) !== 0;

/** Buy the rail yard for depot a. null = bought; otherwise why not. */
export function buyRailYard(world: World, a: number): string | null {
  const t = world.tiles[a];
  if (t.structure !== 'service' || t.kind !== 7 /* Svc.Depot */ || t.part) return 'Only a shipping depot can get a rail yard';
  if (t.upg & RAIL) return 'Already has a rail yard';
  if (world.cash < RAIL_COST) return 'Not enough money';
  world.cash -= RAIL_COST;
  world.ledger.construction += RAIL_COST;
  t.upg |= RAIL;
  return null;
}

/** Export price multiplier of good g right now (1 when it has never drifted). */
export const priceMult = (world: World, g: string): number => world.priceDrift[g] ?? 1;

/**
 * One drift step for every good (Simulation calls it once per calendar month).
 * `goods` is the list of tradeable goods; `month` is the month number.
 */
export function driftPrices(world: World, goods: string[], month: number): void {
  goods.forEach((g, k) => {
    const cur = world.priceDrift[g] ?? 1;
    const r = hash2(k * 7 + 3, month, world.seed + 4242) * 2 - 1; // −1..1
    const next = cur + r * DRIFT_STEP - (cur - 1) * 0.15; // random step, a gentle pull back to 1
    world.priceDrift[g] = Math.round(Math.min(1 + DRIFT_MAX, Math.max(1 - DRIFT_MAX, next)) * 1000) / 1000;
  });
}
