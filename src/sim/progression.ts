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
import { World } from './grid';
import { ToolId } from './types';

export interface Tier {
  pop: number;
  name: string;
  unlocks: string;
}

export const TIERS: Tier[] = [
  { pop: 0, name: 'Hamlet', unlocks: 'Roads, zones, power, water, parks, farms, food plants and the Construction Yard' },
  { pop: 500, name: 'Village', unlocks: 'Avenues (medium-density roads)' },
  { pop: 2000, name: 'Town', unlocks: 'Factories on forest, quarry or oil patches make raw goods (farms work from the start)' },
  { pop: 10000, name: 'City', unlocks: 'Nuclear power plant (2×2), high-capacity pump station and +25% export prices' },
  { pop: 20000, name: 'Metropolis', unlocks: '10% cheaper upkeep on every utility' },
];

/** Minimum tier for tools that are locked at the start. */
export const TOOL_TIER: Partial<Record<ToolId, number>> = { avenue: 1, nuclearPlant: 3, pumpStation: 3 };
/** Tier that unlocks the Resources overlay. */
// PR 5: 0 — the Resources view (and farmland for farms) is available from the
// start; lumber/stone/oil factories still need the Town tier (goods.ts).
export const RESOURCES_TIER = 0;

export const isUnlocked = (tool: ToolId, tier: number) => tier >= (TOOL_TIER[tool] ?? 0);

/** Raise world.tier if the population passed a threshold. Returns the messages to announce. */
export function updateTier(world: World, population: number): string[] {
  const out: string[] = [];
  while (world.tier + 1 < TIERS.length && population >= TIERS[world.tier + 1].pop) {
    world.tier++;
    const t = TIERS[world.tier];
    out.push(`🏆 ${t.name} reached (${t.pop.toLocaleString()} people)! Unlocked: ${t.unlocks}`);
  }
  return out;
}

/** Upkeep multiplier from tiers (Metropolis discount). */
export const upkeepFactor = (tier: number) => (tier >= 4 ? 0.9 : 1);
