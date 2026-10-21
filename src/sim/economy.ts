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
import { sizeUnits } from './rules';
import { SERVICE_DEFS } from './services';
import { Tile, ToolId, ZoneType } from './types';

export const STARTING_CASH = 50_000;

/** Up-front cost. Per tile for line/area tools, per building for point tools. */
export const BUILD_COST: Record<Exclude<ToolId, 'inspect' | 'bulldoze'>, number> = {
  // $10 of asphalt + a $2 surcharge for the street-side power poles that are
  // built automatically along every road (PR 3 auto power lines).
  // PR 6: + $5 for the water main laid under every road automatically → $17.
  road: 17,
  // V1.6 B7: free roads are paid per rasterised tile at the road/avenue price (sim/freeroads.ts).
  freeRoad: 17,
  // PR 4 medium-density avenue: wider, faster for traffic. Upgrading a street costs the full price.
  avenue: 29, // PR 6: $24 + $5 water main
  // V1.5 2×2 roundabout: per tile (×4 = $260 incl. island landscaping and mains).
  roundabout: 65,
  powerLine: 5,
  waterPipe: 5,
  residential: 20,
  commercial: 25,
  industrial: 30,
  powerPlant: 4000, // V1.5: coal plant
  bigWaterTower: 12000, // V1.5b: 3,200 water (4× the basic tower)
  oilPlant: 15000, // V1.5: 8,000 power — cheaper per unit than coal, dearer upkeep
  // PR 4 high tier (unlock at 10,000 people). Priced PROPORTIONALLY to output:
  //   PR 5: coal plant 2,000 power (~2,000 people) for $4,000 + $250/mo; nuclear 8,000 (~8,000 people) = $20,000 + $1,250/mo;
  //   wind turbine 800 × wind (~400 people at average wind) = $1,500 + $60/mo
  //   water tower 800 water for $4,000 + $200/mo →  pump station 4,000 water (5×) = $16,000 + $850/mo
  //   (tower capacity raised 80 → 800 in PR 4 so one tower serves ~1,000 people at ~75% load;
  //   PR 5 re-priced it from $1,500/$80 since it now does 10× the work. The pump station keeps
  //   the same ratio with a 20% bulk discount — $4 per unit of water vs the tower's $5.)
  // (Same price per unit; you're paying for density: nuclear is 2×2 tiles but
  // makes no pollution and needs no fuel trucks; the pump station is 1 tile.)
  nuclearPlant: 60000, // V1.5: was $20,000 when it made 8,000; now 32,000 power
  pumpStation: 16000,
  windTurbine: 1500, // PR 5: was $600 when it made 15 power; now ~400 at average wind
  waterTower: 4000,
  park: 150,
  // PR 5 industry: farms and food plants are zones (per-tile like factories);
  // the Construction Yard is a one-off depot that houses YARD_FLEET crew trucks.
  farm: 30,
  foodPlant: 60,
  constructionYard: 2500,
  // PR 6 public parking (Roads flyout): a 2×2-cell surface lot (4 spaces) and
  // a 4×4-cell (one tile) three-deck garage (40 spaces). Priced per space:
  // $30 surface, $40 decked (you pay for the land you save).
  parkingLot: 480, // V1.5: whole tile (16 spaces) — was $120 for a 2×2-cell quarter
  parkingGarage: 1600,
  // V1.5b services (sim/services.ts SERVICE_DEFS has the same prices).
  garbageDump: 10000, // V1.6: 2×2 landfill (was a $6,000 1×1 dump)
  policeStation: 5000,
  clinic: 6000,
  hospital: 24000,
  elementarySchool: 4000,
  shippingDepot: 100000, // V1.5b stage C
  highSchool: 9000,
  college: 30000,
  recyclingCenter: 8000, // V1.6
  warehouse: 12000, // IND-7
  techCampus: 60000, // IND-9
};

/** PR 4: extra per-tile cost when a road crosses water (it becomes a bridge). */
export const BRIDGE_EXTRA = 48;

/** Fee for automatically clearing a tree, bush or rock when you build on it. */
export const CLEAR_COST = 3;

/** Share of the original price you get back when bulldozing. */
export const REFUND_RATE = 0.25;

/** Monthly running costs. */
export const UPKEEP = { powerPlant: 250, windTurbine: 60, waterTower: 200, park: 10, nuclearPlant: 3000, pumpStation: 850, constructionYard: 120, service: 0 } as const; // V1.5b: 'service' upkeep is per kind (services.ts), booked in projectMonth
/** Structures that cost upkeep every month. */
export type UpkeepKind = keyof typeof UPKEEP;
export const isUpkeepKind = (s: string): s is UpkeepKind => s in UPKEEP;

/** Simulation ticks per in-game month (2 ticks/s at 1x => a month is 15 s). */
export const MONTH_TICKS = 30;

/**
 * CALENDAR (display only): one in-game day is DAY_TICKS simulation ticks, i.e.
 * 10 s at 1× (5 s at 2×, 2.5 s at 3×), a calendar month is 30 days and a year
 * 12 months. The budget cycle above (MONTH_TICKS) and everything else that
 * runs per tick — growth, traffic spawning, goods — is unchanged.
 */
export const DAY_TICKS = 10;
export const MONTH_DAYS = 30;
export const CALENDAR_MONTH_TICKS = DAY_TICKS * MONTH_DAYS;

/**
 * Monthly tax base per building level at a 100% rate. At the default 9% a
 * level-1 house pays $18/month, a level-3 factory $108/month.
 * PR 3 retune: cut by a third (was 300/450/600). PR 2's test city netted
 * +$2.4k/month, which made money meaningless after a few minutes. Parks
 * and pollution also make dense, high-tax housing harder to reach now.
 */
export const TAX_BASE: Record<ZoneType, number> = { residential: 200, commercial: 300, industrial: 400 };

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
  /** PR 4 trade: export income (+) and imported power-plant coal (−). */
  trade: { exports: number; fuel: number; parking?: number; materials?: number; chips?: number }; // IND-9: chips = imported chips for tech campuses
  /** V1.5 stage 11: land-value property tax (all zoned buildings). */
  property?: number;
  // V1.5 stage 10: trade.materials = imported building materials for construction (goods.ts).
  // V1.5: trade.parking = garage fees (parking.ts chargeFees).
}
export const emptyLedger = (): Ledger => ({
  taxes: { residential: 0, commercial: 0, industrial: 0 },
  upkeep: { powerPlant: 0, windTurbine: 0, waterTower: 0, park: 0, nuclearPlant: 0, pumpStation: 0, constructionYard: 0, service: 0 },
  construction: 0,
  refunds: 0,
  trade: { exports: 0, fuel: 0 },
});

/** Net of a ledger (income minus all spending). */
export function ledgerNet(l: Ledger): number {
  const tax = l.taxes.residential + l.taxes.commercial + l.taxes.industrial;
  const up = l.upkeep.powerPlant + l.upkeep.windTurbine + l.upkeep.waterTower + l.upkeep.park + l.upkeep.nuclearPlant + l.upkeep.pumpStation + (l.upkeep.constructionYard ?? 0) + (l.upkeep.service ?? 0);
  return tax + (l.property ?? 0) + l.refunds - up - l.construction + l.trade.exports - l.trade.fuel + (l.trade.parking ?? 0) - (l.trade.materials ?? 0) - (l.trade.chips ?? 0);
}

// ============================================================================
// V1.5 STAGE 11 — PROPERTY TAX + PER-BUILDING PROFIT
// ============================================================================
/**
 * PROPERTY TAX: every operating zoned building pays, per month,
 *     PROPERTY_BASE × landValue(host tile) × size units × propertyRate
 * on top of its R/C/I tax. Default rate 5% → a one-unit house on land
 * value 1.0 pays $1.25; a shop on prime land (2.5) with 6 units pays $18.75.
 * The rate also nudges growth a little (propertyGrowth), like R/C/I rates.
 */
export const PROPERTY_BASE = 25; // tuned so property tax is ~20% of R/C/I tax in a typical town
export const DEFAULT_PROPERTY = 0.05;
export const MAX_PROPERTY = 0.15;
export function propertyTax(t: Tile, operating: boolean, landValue: number, rate: number): number {
  if (!t.zone || t.level === 0 || !operating) return 0;
  return PROPERTY_BASE * landValue * Math.max(1, sizeUnits(t)) * rate;
}
/** Growth multiplier from the property rate: 1.0 at the default, 1.1 at 0%, ~0.8 at the max. */
export const propertyGrowth = (rate: number) => Math.max(0.5, 1.1 - (rate / DEFAULT_PROPERTY) * 0.1);

/**
 * PER-BUILDING PROFIT (shops and industry), booked monthly by simulation.ts:
 *     profit = sales − inputs − wages − taxes
 *   sales  = goods.ts Shipping.sales  (shops: retail sales; factories: loads sold/exported)
 *            + SALES_FLOOR × jobs for a business that's operating (services, walk-ins)
 *   inputs = goods.ts Shipping.costs  (wholesale buys, premium imports, chips)
 *   wages  = WAGE × jobs
 *   taxes  = its zone tax + property tax
 * Profit feeds building health (stage 12) and the Inspect / budget panels.
 */
export const WAGE = 4;
export const SALES_FLOOR = 12;
export interface Profit { sales: number; inputs: number; wages: number; taxes: number; net: number }

/** What placing `tool` on tile `t` costs (including clearing a decoration). */
export function placementCost(tool: ToolId, t: Tile): number {
  if (tool === 'inspect') return 0;
  if (tool === 'bulldoze') return t.deco ? CLEAR_COST : 0; // removing a lone tree
  // PR 6 AVENUE UPGRADE: dragging the avenue tool over an existing STREET
  // converts it in place (rules.canPlace allows roadType 0 → 1; applyTool
  // keeps the tile's connections, pole line and water main). You pay only
  // the difference ($29 − $17 = $12). A street BRIDGE upgrades the same way
  // with no second bridge surcharge — its deck is already paid for.
  // Tiles that are already avenues are skipped by canPlace.
  if (tool === 'avenue' && t.road && t.roadType === 0) return BUILD_COST.avenue - BUILD_COST.road;
  const bridge = (tool === 'road' || tool === 'avenue') && t.water && !t.road ? BRIDGE_EXTRA : 0;
  return BUILD_COST[tool] + bridge + (t.deco ? CLEAR_COST : 0);
}

/** What bulldozing tile `t` refunds: 25% of the value of everything on it. */
export function bulldozeRefund(t: Tile): number {
  let value = 0;
  if (t.road) value += t.roadType === 1 ? BUILD_COST.avenue : BUILD_COST.road; // (includes the auto water main)
  if (t.road && t.water) value += BRIDGE_EXTRA;
  if (t.powerLine) value += BUILD_COST.powerLine;
  if (t.waterPipe && !t.road) value += BUILD_COST.waterPipe; // PR 6: a road's pipe is in the road price
  if (t.zone) value += BUILD_COST[t.zone];
  if (t.structure === 'service' && !t.part) value += SERVICE_DEFS[t.kind]?.cost ?? 0; // V1.5b
  else if (isUpkeepKind(t.structure) && !t.part) value += BUILD_COST[t.structure as Exclude<typeof t.structure, 'service'>];
  return Math.round(value * REFUND_RATE);
}

/** Monthly tax this tile pays right now (0 if not operating). */
export function monthlyTax(t: Tile, operating: boolean, rates: TaxRates): number {
  if (!t.zone || t.level === 0 || !operating) return 0;
  // PR 4: a shop with empty shelves (goods.ts) only pays half.
  const shelves = t.zone === 'commercial' && t.stock <= 0 ? 0.5 : 1;
  return TAX_BASE[t.zone] * sizeUnits(t) * rates[t.zone] * shelves; // PR 5: homes pay per resident (÷5)
}
