/**
 * sim/rules.ts — game balance numbers and the placement rules for each tool.
 *
 * "Can I put X here?" is answered in exactly one place (canPlace) so the
 * green/red preview tint and the actual placement can never disagree.
 */
import { SERVICE_BY_TOOL } from './services';
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
 *   coal 5,000 → ~5,000 people; oil 8,000
 *   nuclear       8,000 → ~8,000 people (2×2, no fuel, no pollution)
 */
/**
 * V1.5 POWER TIERS (Parker): "coal and oil power plants are in a tier below
 * nuclear, oil can power what nuclear could power and nuclear 4× that".
 *   coal (powerPlant, kind 0)  5,000  — from the start (V1.6; was 2,000)
 *   oil  (powerPlant, kind 1)  8,000  — Town tier (2,000 people)
 *   nuclear (2×2)             32,000  — City tier (10,000 people)
 * Coal and oil share the 'powerPlant' structure; Tile.kind tells them apart.
 * Old saves have kind 0 on every plant, so they load as coal (no migration needed).
 */
export const PLANT_COAL = 0;
export const PLANT_OIL = 1;
export const OIL_PLANT_OUTPUT = 8000;
export const OIL_PLANT_UPKEEP = 1000; // charged instead of the coal plant's 250

export const POWER_OUTPUT: Partial<Record<StructureType, number>> = {
  powerPlant: 5000, // V1.6: the COAL plant powers about 5,000 people (V1.5 had 2,000; was 120)
  windTurbine: 1000, // at full wind; output = 1,000 × wind (V1.6; was 800, originally 15)
  nuclearPlant: 32000, // V1.5: 4× the oil plant (PR 5 had 8,000; PR 4 600)
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
/** V1.5b: large elevated (spheroid) water tower — 4× the basic tower, still below the pump station. kind = 1. */
export const BIG_TOWER_OUTPUT = 3200;
export const BIG_TOWER_UPKEEP = 600;
export const BIG_TOWER_POP = 5000;

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
  // PR 6: buildings are entities on the cell grid; their host tile carries
  // the sum of its buildings' residents (lots.ts aggregate), already net of
  // anyone still driving in.
  // V1.5: mixed-use (commercial) hosts also carry residents in t.res.
  return t.res;
}
/**
 * "Size units" of a building for power/water/tax: residents ÷ 5 for homes
 * (so a level-5 block uses 14× a cottage), the level for shops/factories.
 */
export function sizeUnits(t: Tile): number {
  // PR 6: host-tile aggregate (lots.ts): residents ÷ 5 for homes, jobs ÷ 4
  // for shops, ÷ 8 for factories, ÷ 3 for farms — the PR 5 scales, so a PR 5
  // level-3 factory tile and a PR 6 factory with 24 jobs use the same power.
  return t.units;
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
/** PR 5: 40 → 100 so one 4× fuel load (LOAD × FUEL_PER_UNIT = 80) fits. */
export const FUEL_MAX = 100;

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
/**
 * PR 6 (superseded by OASIS-S4 below, kept for old notes): a park used to lift
 * desirability over a 10 × 10-tile SQUARE centred on it.
 */
export const PARK_RADIUS = 5;
/** PR 6: old park area side in tiles (no longer used by the simulation). */
export const PARK_AREA = 10;
/**
 * OASIS-S4 (Parker, 2026-10-19): "Parks serve an area based on connected roads
 * instead of base tiles around them, similar to the new garbage system."
 * A park now reaches along the ROAD network: starting at the road tiles next
 * to it, up to PARK_ROAD_REACH road tiles away (counted along the roads, so a
 * river or a dead end with no bridge stops it). Every lot fronting a reached
 * road, up to PARK_FRONT_DEPTH tiles deep (the deepest zoning drag, 4), gets
 * the bonus, fading with the road distance (environment.ts parkRoadFalloff).
 * The park's own block (the same depth, over land) counts as distance 0 and
 * the streets that block fronts onto are where the road walk starts, so a
 * park tucked behind houses in the middle of a block still works.
 */
export const PARK_ROAD_REACH = 12;
/** OASIS-S4: how deep into a block (tiles from the road, over land) a reached road lifts lots. */
export const PARK_FRONT_DEPTH = 4;
export const PARK_BONUS_MAX = 1.5;
/** Homes below this desirability don't grow at all ("too polluted"). */
export const DESIRE_MIN = 0.2;
/** Homes below this can't grow past level 1. */
export const DESIRE_FOR_DENSE = 0.6;
/** Homes at or above this grow twice as fast. */
export const DESIRE_FAST = 1.5;

/** PR 5: the zone a zoning tool paints (farm/food plant are industrial lots). */
export function zoneOf(tool: ToolId): ZoneType {
  return tool === 'farm' || tool === 'foodPlant' ? 'industrial' : (tool as ZoneType);
}

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
  // PR 5: a farm's field (owned) can only be bulldozed (→ fallow) or inspected.
  if (t.farm > 0 && tool !== 'bulldoze' && tool !== 'inspect') return false;
  const noBuilding = t.zone === null && t.structure === 'none';
  // PR 4: water only takes roads (bridges). Nothing else may be built on it.
  if (t.water && tool !== 'road' && tool !== 'avenue' && tool !== 'bulldoze' && tool !== 'inspect') return false;
  switch (tool) {
    case 'freeRoad': // V1.6 B7: validated by sim/freeroads.ts per rasterised tile
    case 'road':
      return noBuilding && !t.road;
    case 'roundabout':
      // V1.5: on empty land or over existing streets/avenues (a junction
      // becomes a roundabout); never on water (no ring bridges).
      return noBuilding && !t.water && t.roadType !== 2;
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
    case 'farm':
    case 'foodPlant': {
      // PR 6: zoning paints CELLS (simulation.zoneCells). A tile may be
      // (re)zoned if it is bare or already zoned; cells under buildings keep
      // their zone, only the free cells are repainted.
      return t.zone !== null ? t.structure === 'none' || t.structure === 'building' : isBare(t);
    }
    case 'powerPlant':
    case 'oilPlant':
    case 'bigWaterTower':
    case 'nuclearPlant':
    case 'windTurbine':
    case 'waterTower':
    case 'pumpStation':
    case 'constructionYard':
    case 'park':
    // V1.5b services
    case 'garbageDump':
    case 'policeStation':
    case 'clinic':
    case 'hospital':
    case 'elementarySchool':
    case 'highSchool':
    case 'college':
    case 'shippingDepot':
    case 'recyclingCenter':
      return isBare(t);
    case 'parkingLot':
    case 'parkingGarage':
      // PR 6 public parking: on bare land or zoned cells (cells checked by the sim).
      return !t.road && !t.water && !t.edge && !t.powerLine && !t.waterPipe && (t.structure === 'none' || t.structure === 'building');
    case 'bulldoze':
      // The highway connection at the map edge is permanent.
      if (t.edge) return false;
      return !isBare(t) || t.deco !== 0 || t.farm > 0;
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
      // PR 6: every road carries a water main under it (like the PR 3 street
      // power poles), so connected roads form one water network and anything
      // beside a road gets water. The pipe is part of the road's price.
      t.waterPipe = true;
      break;
    case 'roundabout':
      // V1.5: a ring tile. Like every road it carries power poles (PR 3
      // auto lines are drawn for any road) and a water main (PR 6), so the
      // roads, pipes and lines on all four sides join up automatically.
      t.road = true;
      t.roadType = 2;
      t.waterPipe = true;
      t.deco = 0;
      break;
    case 'avenue':
      t.road = true;
      t.roadType = 1;
      t.waterPipe = true; // PR 6 auto water main (see 'road')
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
    case 'farm':
    case 'foodPlant':
      // PR 6: the cells are painted by Simulation.zoneCells; the tile just
      // records a zone (lots.refreshTileZone / aggregate keep it accurate).
      if (t.zone === null) {
        t.zone = zoneOf(tool);
        t.kind = tool === 'farm' ? 1 : tool === 'foodPlant' ? 2 : 0;
        t.farm = 0;
        t.input = 0;
        t.stock = 0;
      }
      break;
    case 'parkingLot':
    case 'parkingGarage':
      break; // cells only (Simulation.placeParking)
    case 'powerPlant':
    case 'nuclearPlant':
    case 'windTurbine':
    case 'waterTower':
    case 'pumpStation':
    case 'constructionYard': // PR 5: built instantly, no crew needed (it IS the crews)
    case 'park':
      t.structure = tool;
      t.farm = 0;
      // New power plants arrive with a full fuel bunker (goods.ts).
      t.stock = tool === 'powerPlant' ? FUEL_MAX : 0;
      t.kind = PLANT_COAL;
      break;
    case 'garbageDump':
    case 'policeStation':
    case 'clinic':
    case 'hospital':
    case 'elementarySchool':
    case 'highSchool':
    case 'college':
    case 'shippingDepot':
    case 'recyclingCenter':
      // V1.5b: one 'service' structure; kind says which (services.ts Svc).
      t.structure = 'service';
      t.kind = SERVICE_BY_TOOL[tool]!.svc;
      t.farm = 0;
      t.stock = 0;
      break;
    case 'bigWaterTower':
      // V1.5b: same 'waterTower' structure (pipes, pump power, overlays all
      // keep working); kind 1 = the large spheroid tower (BIG_TOWER_OUTPUT).
      t.structure = 'waterTower';
      t.kind = 1;
      t.farm = 0;
      t.stock = 0;
      break;
    case 'oilPlant':
      // V1.5: an oil-fired plant is the same 'powerPlant' structure (so fuel
      // trucks, pollution, smoke and upkeep all keep working) with kind = OIL,
      // which networks.output() turns into 8,000 power instead of coal's 5,000.
      t.structure = 'powerPlant';
      t.kind = PLANT_OIL;
      t.farm = 0;
      t.stock = FUEL_MAX;
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
      t.kind = 0;
      t.input = 0;
      t.crew = false;
      t.res = t.jobs = t.units = 0;
      t.crewLinger = 0;
      t.garbage = 0;
      // PR 5: bulldozing a farm FIELD leaves it fallow so its farm shrinks.
      if (t.farm > 0) t.farm = -t.farm;
      break;
    case 'inspect':
      break;
  }
}
