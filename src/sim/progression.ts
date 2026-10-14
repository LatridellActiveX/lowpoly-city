/**
 * sim/progression.ts — PR 4 population tiers and unlocks.
 *
 *   tier 0  Hamlet       0      the basics
 *   tier 1  Village      500    🛤️ Avenues (medium-density roads)
 *   tier 2  Town         2,000  🗺 Resources view + factories on resource
 *                               patches make food / lumber / stone / oil
 *   tier 3  City         10,000 ☢️ Nuclear plant, +25% export prices
 *   tier 4  Metropolis   20,000 −10% upkeep on all utilities
 *
 * `world.tier` stores the HIGHEST tier reached (saved), so shrinking below a
 * threshold later never re-locks anything. Simulation.step() calls
 * updateTier() every tick; a new tier pushes a message into `events`, which
 * the UI shows as a notification.
 */
import { SERVICE_BY_TOOL } from './services';
import { World } from './grid';
import { ToolId } from './types';

export interface Tier {
  pop: number;
  name: string;
  unlocks: string;
}

export const TIERS: Tier[] = [
  { pop: 0, name: 'Hamlet', unlocks: 'Roads, zones, power, water, parks, farms, food plants and the Construction Yard' },
  { pop: 500, name: 'Village', unlocks: 'Avenues if not already open (they unlock at 250 people)' },
  { pop: 2000, name: 'Town', unlocks: 'Oil power plant (8,000 power); level-6 homes (taller medium buildings); factories on forest, quarry or oil patches make raw goods' },
  { pop: 10000, name: 'City', unlocks: 'Nuclear power plant (2×2, 32,000 power), high-capacity pump station and +25% export prices' },
  { pop: 20000, name: 'Metropolis', unlocks: '10% cheaper upkeep on every utility' },
];

/** Minimum tier for tools that are locked at the start. */
// V1.5: avenues no longer wait for tier 1; they unlock at AVENUE_POP peak
// population (see isUnlocked), when the first real traffic shows up.
export const AVENUE_POP = 250;
export const TOOL_TIER: Partial<Record<ToolId, number>> = { oilPlant: 2, nuclearPlant: 3, pumpStation: 3 };
/** Tier that unlocks the Resources overlay. */
// PR 5: 0 — the Resources view (and farmland for farms) is available from the
// start; lumber/stone/oil factories still need the Town tier (goods.ts).
export const RESOURCES_TIER = 0;

/** Tier gate plus the V1.5 population gate for avenues (peakPop optional for old callers). */
export const isUnlocked = (tool: ToolId, tier: number, peakPop = Infinity) =>
  tier >= (TOOL_TIER[tool] ?? 0) && (tool !== 'avenue' || peakPop >= AVENUE_POP || tier >= 1) && peakPop >= (SERVICE_BY_TOOL[tool]?.unlockPop ?? 0);
/** V1.5b: the population a locked tool needs (for the 🔒 badge). */
export const unlockPop = (tool: ToolId): number => SERVICE_BY_TOOL[tool]?.unlockPop ?? (tool === 'avenue' ? AVENUE_POP : TIERS[TOOL_TIER[tool] ?? 0].pop);

/**
 * PR 6: the first MEDIUM-DENSITY housing (townhouses, duplex rows, small
 * walk-ups — templates with tier 2, and PR 5 level-4 homes) unlocks at
 * 1,000 people, between the Village (500) and Town (2,000) tiers. It's a
 * separate milestone instead of a new tier so the saved tier numbers (and
 * everything keyed off "tier 3 = City") stay the same. World.peakPop
 * remembers the best population ever reached, so the unlock never goes away.
 */
export const MEDIUM_HOUSING_POP = 1000;
export const mediumUnlocked = (world: World) => world.tier >= 2 || world.peakPop >= MEDIUM_HOUSING_POP;
/** Is a template / level gated at `tier` available? (tier 2 = medium housing, see above.) */
export const tierOk = (world: World, tier: number, zone: string = 'residential') => (tier === 2 && zone === 'residential' ? mediumUnlocked(world) : world.tier >= tier);

/** Raise world.tier if the population passed a threshold. Returns the messages to announce. */
export function updateTier(world: World, population: number): string[] {
  const out: string[] = [];
  if (population >= MEDIUM_HOUSING_POP && world.peakPop < MEDIUM_HOUSING_POP && world.tier < 2) out.push('🏘 1,000 people! Medium-density housing unlocked: level-3 houses now grow into townhouses and flats by themselves, and Residential · Medium zoning works (needs desirability 1.2). Levels 6 and 7 follow at 2,000 and 5,000 people.');
  if (population >= AVENUE_POP && world.peakPop < AVENUE_POP && world.tier < 1) out.push('🛣 250 people! Avenues unlocked: four lanes (two each way) where drivers pick a lane for their turn and change lanes to pass.');
  world.peakPop = Math.max(world.peakPop, population);
  while (world.tier + 1 < TIERS.length && population >= TIERS[world.tier + 1].pop) {
    world.tier++;
    const t = TIERS[world.tier];
    out.push(`🏆 ${t.name} reached (${t.pop.toLocaleString()} people)! Unlocked: ${t.unlocks}`);
  }
  return out;
}

/** Upkeep multiplier from tiers (Metropolis discount). */
export const upkeepFactor = (tier: number) => (tier >= 4 ? 0.9 : 1);
