/**
 * sim/rules.ts — game balance numbers and the placement rules for each tool.
 *
 * "Can I put X here?" is answered in exactly one place (canPlace) so the
 * green/red preview tint and the actual placement can never disagree.
 */
import { StructureType, Tile, ToolId, ZoneType } from './types';

/** How many power units each source produces per tick. */
/*
 * PR 5 POWER REBALANCE (Parker: "a turbine ≈ 400 people, a coal plant ≈
 * 2,000, nuclear ≈ 8,000, including their shops and factories").
 * A typical town per 1,000 residents: 200 home levels × 2 = 400 power,
 * ~85 shop levels × 3 ≈ 255 (SHOP_JOBS_PER_RESIDENT 0.35 ÷ 4 jobs/level),
 * ~25–40 factory levels × 6 ≈ 150–240 → about 0.8–0.9 power per resident.
 * Sizing each source so its rated population runs at ~85% load:
 *   wind turbine  800 at FULL wind (wind = 1) → 400 at average wind 0.5
 *                 → ~400 people at average wind, ~800 in a full gale, 0 when calm
 *   coal/oil      2,000 → ~2,000 people
 *   nuclear       8,000 → ~8,000 people (2×2, no fuel, no pollution)
 */
export const POWER_OUTPUT: Partial<Record<StructureType, number>> = {
  powerPlant: 2000, // the backbone of the grid (was 120)
  windTurbine: 800, // at full wind; output = 800 × wind (was 15)
  nuclearPlant: 8000, // PR 4 high tier, 2×2 (was 600)
};

/** PR 4: a power plant out of fuel still makes this much (backup generators) — PR 5: 25% of rated. */
export const UNFUELLED_OUTPUT = 500;

/**
 * How many water units each water tower supplies per tick.
 * PR 4 rebalance (was 80): ONE tower should comfortably serve a 1,000-person
 * town. Such a town has ~200 home levels (5 residents each) × 2 water = 400,
 * plus the shops and factories it supports: ~55 shop levels × 1 + ~41 factory
 * levels × 3 ≈ 180. Total ≈ 580, i.e. ~73% of 800 — leaving ~25% headroom.
 */
export const WATER_OUTPUT = 800;
/** PR 4 high-capacity pump station (10,000 people): 5× a tower = 4,000 water (enough for ~7,000 people). */
export const PUMP_STATION_OUTPUT = 4000;

/**
 * Consumption per building LEVEL. A level-2 house uses twice what a level-1
 * house does. Empty lots (level 0) use nothing.
 */
export const DEMAND: Record<ZoneType, { power: number; water: number }> = {
  residential: { power: 2, water: 2 },
  commercial: { power: 3, water: 1 },
  industrial: { power: 6, water: 3 },
};

/**
 * People living in a house per level, and jobs per level for shops/factories.
 * RESIDENTS_PER_LEVEL (5) is now the per-resident UNIT: power, water, tax
 * and pollution-free "size" of a home scale with residents ÷ 5.
 */
export const RESIDENTS_PER_LEVEL = 5;
/**
 * PR 5 residential capacity per level (index = level):
 *   1 cottage 5 · 2 house 10 · 3 large house / small block 20
 *   4 townhouses / rowhouses 40 (medium density)
 *   5 small apartment block 70 (medium density)
 */
export const RESIDENTS_AT = [0, 5, 10, 20, 40, 70];
/** Highest residential level (medium density goes past MAX_LEVEL). */
export const MAX_RES_LEVEL = 5;
/** PR 5 medium density gates: population tier (progression.ts) + desirability. */
export const MEDIUM_DENSITY = { 4: { tier: 2, desire: 1.2 }, 5: { tier: 3, desire: 1.5 } } as const;
/** Residents living in a home tile right now (the newest level's people only count once their car arrives). */
export function residentsOf(t: Tile): number {
  if (t.zone !== 'residential' || t.level <= 0) return 0;
  const lv = Math.min(t.level, MAX_RES_LEVEL);
  return t.movingIn ? RESIDENTS_AT[lv - 1] : RESIDENTS_AT[lv];
}
/**
 * "Size units" of a building for power/water/tax: residents ÷ 5 for homes
 * (so a level-5 block uses 14× a cottage), the level for shops/factories.
 */
export function sizeUnits(t: Tile): number {
  if (t.zone === 'residential') return RESIDENTS_AT[Math.min(t.level, MAX_RES_LEVEL)] / RESIDENTS_PER_LEVEL;
  return t.level;
}
export const JOBS_PER_LEVEL: Record<ZoneType, number> = { residential: 0, commercial: 4, industrial: 8 };

/** Highest level a zoned building can grow to. */
export const MAX_LEVEL = 3;

/** Ticks of continuous service needed before a lot grows one level. */
export const GROW_TICKS = 6;

/**
 * Simulation ticks per real second at 1x speed (the DEFAULT; Settings can
 * change it to 0.5 or 2). PR 4 halved it from 2 to 1 so 1× plays at a calmer
 * pace: a month (30 ticks) now takes 30 s.
 */
export const TICKS_PER_SECOND = 1;

/** PR 4: ticks of (serviced) building work to finish one construction stage. */
export const CONSTRUCT_TICKS = 10;
/** PR 4: a power plant's full fuel bunker, in fuel units (goods.ts). */
export const FUEL_MAX = 40;

// ---- Pollution, desirability and parks (PR 3, see environment.ts) ----
/** A coal power plant's pollution strength next door, and how far it reaches. */
export const PLANT_POLLUTION = 5;
export const PLANT_POLLUTION_RADIUS = 5;
/** A factory pollutes this much per building level, within this radius. */
export const FACTORY_POLLUTION_PER_LEVEL = 1.2;
export const FACTORY_POLLUTION_RADIUS = 4;
/** Desirability with no pollution and no parks. */
export const DESIRE_BASE = 1;
/** How much each unit of pollution lowers desirability. */
export const POLLUTION_WEIGHT = 0.25;
/** A park's bonus right next to it, its radius, and the cap from many parks. */
export const PARK_BONUS = 0.8;
export const PARK_RADIUS = 3;
export const PARK_BONUS_MAX = 1.5;
/** Homes below this desirability don't grow at all ("too polluted"). */
export const DESIRE_MIN = 0.2;
/** Homes below this can't grow past level 1. */
export const DESIRE_FOR_DENSE = 0.6;
/** Homes at or above this grow twice as fast. */
export const DESIRE_FAST = 1.5;

/** True if this tile has nothing on it at all. */
export function isBare(t: Tile): boolean {
  return !t.road && !t.powerLine && !t.waterPipe && t.zone === null && t.structure === 'none';
}

/**
 * The single source of truth for placement.
 *  - Roads, power lines and pipes are "linear" and may share a tile with each
 *    other (a road can have a line above it and a pipe under it), but never
 *    with a building or zone.
 *  - Zones and utility buildings need a completely bare tile... except that a
 *    zone can be repainted over a different zone's EMPTY lot.
 */
export function canPlace(tool: ToolId, t: Tile): boolean {
  const noBuilding = t.zone === null && t.structure === 'none';
  // PR 4: water only takes roads (bridges). Nothing else may be built on it.
  if (t.water && tool !== 'road' && tool !== 'avenue' && tool !== 'bulldoze' && tool !== 'inspect') return false;
  switch (tool) {
    case 'road':
      return noBuilding && !t.road;
    case 'avenue':
      // A new avenue on empty land, or an upgrade of an existing street.
      return noBuilding && (!t.road || t.roadType === 0);
    case 'powerLine':
      // Roads already carry power (auto street lines), so the manual tool is
      // only for running lines across land without a road.
      return noBuilding && !t.powerLine && !t.road;
    case 'waterPipe':
      return noBuilding && !t.waterPipe;
    case 'residential':
    case 'commercial':
    case 'industrial':
      if (t.zone !== null) return t.zone !== tool && t.level === 0 && t.construct === 0; // re-zone an empty lot
      return isBare(t);
    case 'powerPlant':
    case 'nuclearPlant':
    case 'windTurbine':
    case 'waterTower':
    case 'pumpStation':
    case 'park':
      return isBare(t);
    case 'bulldoze':
      // The highway connection at the map edge is permanent.
      if (t.edge) return false;
      return !isBare(t) || t.deco !== 0;
    case 'inspect':
      return true;
  }
}

/** Apply a tool to a tile (assumes canPlace returned true). */
export function applyTool(tool: ToolId, t: Tile): void {
  // Anything you build (or bulldoze) clears the tree/bush/rock on the tile.
  if (tool !== 'inspect') t.deco = 0;
  switch (tool) {
    case 'road':
      t.road = true;
      t.roadType = 0;
      break;
    case 'avenue':
      t.road = true;
      t.roadType = 1;
      break;
    case 'powerLine':
      t.powerLine = true;
      break;
    case 'waterPipe':
      t.waterPipe = true;
      break;
    case 'residential':
    case 'commercial':
    case 'industrial':
      t.zone = tool;
      t.structure = 'none';
      t.level = 0;
      t.happyTicks = 0;
      t.construct = 0;
      t.stock = 0;
      break;
    case 'powerPlant':
    case 'nuclearPlant':
    case 'windTurbine':
    case 'waterTower':
    case 'pumpStation':
    case 'park':
      t.structure = tool;
      // New power plants arrive with a full fuel bunker (goods.ts).
      t.stock = tool === 'powerPlant' ? FUEL_MAX : 0;
      break;
    case 'bulldoze':
      // Note: `water` is terrain and stays; bulldozing a bridge leaves the river.
      t.road = t.powerLine = t.waterPipe = false;
      t.roadType = 0;
      t.zone = null;
      t.structure = 'none';
      t.level = 0;
      t.happyTicks = 0;
      t.construct = 0;
      t.stock = 0;
      t.part = 0;
      break;
    case 'inspect':
      break;
  }
}
