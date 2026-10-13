/**
 * sim/economy.ts — money: every balance number lives in this one file.
 *
 * HOW THE MONEY WORKS
 * -------------------
 *  - You start with STARTING_CASH.
 *  - Building costs money up front (BUILD_COST). Lines, pipes, roads and
 *    zones are charged per tile; plants, turbines and towers per building.
 *    Clearing a tree/bush/rock that's in the way adds CLEAR_COST.
 *  - Bulldozing refunds REFUND_RATE (25%) of what the removed things cost.
 *  - Every MONTH (MONTH_TICKS simulation ticks) the city books its budget:
 *      income   = taxes from every OPERATING zoned building
 *      expenses = upkeep of every power plant, wind turbine and water tower
 *  - A building's monthly tax = TAX_BASE[zone] x level x occupancy x rate.
 *    Occupancy is 1 when the building is operating (has road, power and
 *    water) and 0 when it isn't — dark buildings pay nothing.
 *  - Tax rates are adjustable per zone from 0% to 20% (default 9%). Higher
 *    taxes slow growth a little (growthFactor).
 *  - Going below $0 doesn't end the game. It just blocks new construction
 *    until income brings you back up. Bulldozing is always allowed.
 */
import { Tile, ToolId, ZoneType } from './types';

export const STARTING_CASH = 50_000;

/** Up-front cost. Per tile for line/area tools, per building for point tools. */
export const BUILD_COST: Record<Exclude<ToolId, 'inspect' | 'bulldoze'>, number> = {
  road: 10,
  powerLine: 5,
  waterPipe: 5,
  residential: 20,
  commercial: 25,
  industrial: 30,
  powerPlant: 4000,
  windTurbine: 600,
  waterTower: 1500,
};

/** Fee for automatically clearing a tree, bush or rock when you build on it. */
export const CLEAR_COST = 3;

/** Share of the original price you get back when bulldozing. */
export const REFUND_RATE = 0.25;

/** Monthly running costs. */
export const UPKEEP = { powerPlant: 250, windTurbine: 30, waterTower: 80 } as const;

/** Simulation ticks per in-game month (2 ticks/s at 1x => a month is 15 s). */
export const MONTH_TICKS = 30;

/**
 * Monthly tax base per building level at a 100% rate. At the default 9% a
 * level-1 house pays $27/month, a level-3 factory $162/month.
 */
export const TAX_BASE: Record<ZoneType, number> = { residential: 300, commercial: 450, industrial: 600 };

export const DEFAULT_TAX = 0.09;
export const MAX_TAX = 0.2;

/**
 * Growth speed multiplier from the tax rate: 1.0 at the default 9%, up to
 * 1.3 at 0% and down to ~0.63 at 20%. Linear, so it's easy to reason about.
 */
export function growthFactor(rate: number): number {
  return Math.max(0.2, 1.3 - (rate * 0.3) / DEFAULT_TAX);
}

/** Per-zone tax rates (0..MAX_TAX). */
export type TaxRates = Record<ZoneType, number>;
export const defaultTaxRates = (): TaxRates => ({ residential: DEFAULT_TAX, commercial: DEFAULT_TAX, industrial: DEFAULT_TAX });

/** One month's books, broken down by category for the budget panel. */
export interface Ledger {
  taxes: Record<ZoneType, number>;
  upkeep: Record<keyof typeof UPKEEP, number>;
  construction: number;
  refunds: number;
}
export const emptyLedger = (): Ledger => ({
  taxes: { residential: 0, commercial: 0, industrial: 0 },
  upkeep: { powerPlant: 0, windTurbine: 0, waterTower: 0 },
  construction: 0,
  refunds: 0,
});

/** Net of a ledger (income minus all spending). */
export function ledgerNet(l: Ledger): number {
  const tax = l.taxes.residential + l.taxes.commercial + l.taxes.industrial;
  const up = l.upkeep.powerPlant + l.upkeep.windTurbine + l.upkeep.waterTower;
  return tax + l.refunds - up - l.construction;
}

/** What placing `tool` on tile `t` costs (including clearing a decoration). */
export function placementCost(tool: ToolId, t: Tile): number {
  if (tool === 'inspect') return 0;
  if (tool === 'bulldoze') return t.deco ? CLEAR_COST : 0; // removing a lone tree
  return BUILD_COST[tool] + (t.deco ? CLEAR_COST : 0);
}

/** What bulldozing tile `t` refunds: 25% of the value of everything on it. */
export function bulldozeRefund(t: Tile): number {
  let value = 0;
  if (t.road) value += BUILD_COST.road;
  if (t.powerLine) value += BUILD_COST.powerLine;
  if (t.waterPipe) value += BUILD_COST.waterPipe;
  if (t.zone) value += BUILD_COST[t.zone];
  if (t.structure === 'powerPlant' || t.structure === 'windTurbine' || t.structure === 'waterTower') value += BUILD_COST[t.structure];
  return Math.round(value * REFUND_RATE);
}

/** Monthly tax this tile pays right now (0 if not operating). */
export function monthlyTax(t: Tile, operating: boolean, rates: TaxRates): number {
  if (!t.zone || t.level === 0 || !operating) return 0;
  return TAX_BASE[t.zone] * t.level * rates[t.zone];
}
