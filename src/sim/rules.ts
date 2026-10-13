/**
 * sim/rules.ts — game balance numbers and the placement rules for each tool.
 *
 * "Can I put X here?" is answered in exactly one place (canPlace) so the
 * green/red preview tint and the actual placement can never disagree.
 */
import { StructureType, Tile, ToolId, ZoneType } from './types';

/** How many power units each source produces per tick. */
export const POWER_OUTPUT: Partial<Record<StructureType, number>> = {
  powerPlant: 120, // high output, the backbone of the grid
  windTurbine: 15, // low output, cheap and clean
};

/** PR 4: a power plant out of fuel still makes this much (backup generators). */
export const UNFUELLED_OUTPUT = 30;

/** How many water units each water tower supplies per tick. */
export const WATER_OUTPUT = 80;

/**
 * Consumption per building LEVEL. A level-2 house uses twice what a level-1
 * house does. Empty lots (level 0) use nothing.
 */
export const DEMAND: Record<ZoneType, { power: number; water: number }> = {
  residential: { power: 2, water: 2 },
  commercial: { power: 3, water: 1 },
  industrial: { power: 6, water: 3 },
};

/** People living in a house per level, and jobs per level for shops/factories. */
export const RESIDENTS_PER_LEVEL = 5;
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
    case 'windTurbine':
    case 'waterTower':
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
    case 'windTurbine':
    case 'waterTower':
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
      break;
    case 'inspect':
      break;
  }
}
