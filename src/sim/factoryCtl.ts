/**
 * sim/factoryCtl.ts — IND-1: the player's controls for a factory.
 *
 * Plain TypeScript (no Three.js/DOM). The factory panel (ui/hud.ts) calls
 * these; chains.ts and goods.ts read the tile fields they set.
 *
 * RECIPE PICKER
 * -------------
 * A plain factory normally picks its own recipe (chains.ts refreshRoles:
 * "make something nobody makes yet"). Clicking it lets the player choose
 * instead. The choice lives on the factory's host tile as `tile.recipe`
 * (a Role name, '' = Auto) and is SAVED with the tile, so it sticks after
 * a reload. chains.ts roleOf() answers the picked recipe first.
 *
 * Switching costs RECIPE_SWITCH_COST and RETOOLS the factory: its output
 * pauses for RETOOL_TICKS (`tile.pause` = the tick it resumes) and the
 * hopper is emptied (the old input doesn't fit the new recipe). That makes
 * flipping back and forth to chase prices a losing move.
 *
 * Going back to Auto is free and doesn't pause (the factory keeps making
 * what it makes now until the automatic rules pick again).
 *
 * Extractors (logging camp, oil rig, quarry), farms and food plants make
 * what their land / zone says, so they have no picker.
 */
import { World } from './grid';
import { ADOPTABLE, RECIPES, Role, roleOf, roleUnlocked, setAutoRole } from './chains';

/** $ per recipe switch (balance knob). */
export const RECIPE_SWITCH_COST = 500;
/** Ticks (= game seconds, rules.ts TICKS_PER_SECOND 1) a factory pauses while retooling. */
export const RETOOL_TICKS = 30;

/** Can the player pick a recipe for industrial tile i? (plain factories / processors only) */
export function canPickRecipe(world: World, i: number): boolean {
  const t = world.tiles[i];
  if (t.zone !== 'industrial' || t.level === 0) return false;
  const r = roleOf(world, i);
  // A processor or plain factory; extractors, farms and food plants decide by land/zone.
  return r === 'factory' || (ADOPTABLE as Role[]).includes(r);
}

/** The recipes the picker offers (the same ones the automatic rules may adopt; IND-5: only unlocked ones when a world is given). */
export const pickableRecipes = (world?: World): Role[] => ADOPTABLE.filter((r) => !world || roleUnlocked(world, r));

/** Is factory i retooling right now (no output)? */
export const isPaused = (world: World, i: number): boolean => world.tiles[i].pause > world.tick;

/**
 * Set factory i's recipe. `role` '' = back to Auto. Returns a message for
 * the UI: null when it worked, otherwise why not.
 */
export function setRecipe(world: World, i: number, role: Role | ''): string | null {
  if (!canPickRecipe(world, i)) return "This building's product is set by its land or zone";
  const t = world.tiles[i];
  if (role === '') {
    // Auto: free, no pause. Keep the current product as the automatic pick
    // so the factory doesn't suddenly change what it makes.
    const now = roleOf(world, i);
    t.recipe = '';
    if (now !== 'factory') setAutoRole(world, i, now);
    return null;
  }
  if (!RECIPES[role] || !(ADOPTABLE as Role[]).includes(role)) return 'Unknown recipe';
  if (!roleUnlocked(world, role)) return '🔒 The vehicle plant unlocks at the City tier (10,000 people)'; // IND-5
  if (t.recipe === role) return null; // already picked: nothing to pay
  const current = roleOf(world, i);
  if (current === role) { t.recipe = role; return null; } // pin what it already makes: free, no pause
  if (world.cash < RECIPE_SWITCH_COST) return 'Not enough money';
  world.cash -= RECIPE_SWITCH_COST;
  world.ledger.construction += RECIPE_SWITCH_COST; // shows as spending in the budget
  t.recipe = role;
  t.pause = world.tick + RETOOL_TICKS;
  t.input = 0; // old inputs don't fit the new line
  return null;
}

/**
 * Forget the player's settings on tiles that are no longer a built factory
 * (bulldozed or rezoned), so a new building there starts on Auto.
 * chains.ts refreshRoles calls it on its staggered pass.
 */
export function clearIfGone(world: World, i: number): void {
  const t = world.tiles[i];
  if (t.zone === 'industrial' && (t.level > 0 || t.construct > 0)) return;
  if (t.structure === 'service') return; // IND-6: a recycling center keeps its mode in tile.recipe
  if (t.recipe || t.pause || t.upg) { t.recipe = ''; t.pause = 0; t.upg = 0; }
}

// ============================================================================
// IND-3 — UPGRADES (bought in the factory panel)
// ============================================================================
/**
 * Each upgrade is one bit of `tile.upg` (saved with the tile). A building
 * can have all three. They are lost when the building is bulldozed
 * (clearIfGone above).
 *
 *   SHIFT  Second shift   $3,000          +50% output, +30% workers
 *   AUTO   Automation     $6,000, City    +30% output, −40% workers, +50% power use
 *   FILTER Filters        $2,000          −60% pollution, +10% running cost
 *
 * "Running cost" = 10% of the value of what the building makes, booked as
 * an input cost (goods.ts), so it shows in the building's profit.
 */
export const UPG = { SHIFT: 1, AUTO: 2, FILTER: 4 } as const;
export type UpgKey = keyof typeof UPG;
export const UPGRADES: Record<UpgKey, { label: string; cost: number; tier: number; text: string }> = {
  SHIFT: { label: 'Second shift', cost: 3000, tier: 0, text: '+50% output, +30% workers' },
  AUTO: { label: 'Automation', cost: 6000, tier: 3, text: '+30% output, −40% workers, +50% power' },
  FILTER: { label: 'Filters', cost: 2000, tier: 0, text: '−60% pollution, +10% running cost' },
};
/** Does tile t have upgrade k? */
export const hasUpg = (t: { upg: number }, k: UpgKey): boolean => (t.upg & UPG[k]) !== 0;

/** Buy upgrade k for factory i. null = bought; otherwise why not. */
export function buyUpgrade(world: World, i: number, k: UpgKey): string | null {
  const t = world.tiles[i], u = UPGRADES[k];
  if (t.zone !== 'industrial' || t.level === 0) return 'Only a working factory can be upgraded';
  if (hasUpg(t, k)) return 'Already bought';
  if (world.tier < u.tier) return '🔒 Automation unlocks at the City tier (10,000 people)';
  if (world.cash < u.cost) return 'Not enough money';
  world.cash -= u.cost;
  world.ledger.construction += u.cost;
  t.upg |= UPG[k];
  return null;
}

/** Output multiplier of an industrial tile from its upgrades and the night-shift policy (IND-4). */
export function outputMult(world: World, t: { upg: number }): number {
  let m = 1;
  if (hasUpg(t, 'SHIFT')) m *= 1.5;
  if (hasUpg(t, 'AUTO')) m *= 1.3;
  if (world.policies.night) m *= NIGHT_OUTPUT; // IND-4: every factory, stacks with its upgrades
  return m;
}
/** Workers multiplier (jobs offered) from upgrades. */
export const workerMult = (t: { upg: number }): number => (hasUpg(t, 'SHIFT') ? 1.3 : 1) * (hasUpg(t, 'AUTO') ? 0.6 : 1);
/** Power use multiplier from upgrades. */
export const powerMult = (t: { upg: number }): number => (hasUpg(t, 'AUTO') ? 1.5 : 1);
/** Pollution multiplier of an industrial tile: filters ×0.4, eco standards ×0.7 (IND-4), they stack. */
export function pollutionMult(world: World, t: { upg: number }): number {
  return (hasUpg(t, 'FILTER') ? 0.4 : 1) * (world.policies.eco ? ECO_POLLUTION : 1);
}
/** Extra running cost as a share of output value (filters +10%; eco standards +15%, IND-4). */
export function runningCostShare(world: World, t: { upg: number }): number {
  return (hasUpg(t, 'FILTER') ? 0.1 : 0) + (world.policies.eco ? ECO_PROFIT_CUT : 0);
}

// ============================================================================
// IND-4 — CITY-WIDE INDUSTRIAL POLICIES (toggled in the Budget panel)
// ============================================================================
/**
 * Two switches that affect EVERY industrial building at once. They live on
 * `world.policies` and are saved with the city (save.ts `policies`; an older
 * save without the field loads with both OFF). Turning one off undoes its
 * effect straight away: nothing is "baked in" — every effect below is read
 * fresh from the flag each tick.
 *
 *  ECO STANDARDS (`eco`)
 *    − industrial pollution ×0.7 (−30%)                   pollutionMult above
 *    − 15% of what each factory makes is booked as an
 *      extra running cost, so factory profit drops        runningCostShare above
 *
 *  NIGHT SHIFTS (`night`)
 *    + every factory makes 25% more                        outputMult above
 *    + at night (22:00–06:00) each working factory sends
 *      a night-shift truck — at most ONE extra truck per
 *      building on the road at a time                      goods.ts nightShiftTrucks
 *    − homes near a working factory are 5% less happy
 *      (desirability − 5% of base)                          environment.ts
 */
export interface Policies { eco: boolean; night: boolean }
export const defaultPolicies = (): Policies => ({ eco: false, night: false });
export const POLICIES: Record<keyof Policies, { label: string; text: string }> = {
  eco: { label: '🌿 Eco standards', text: 'Industry pollutes 30% less, but factories earn 15% less profit.' },
  night: { label: '🌙 Night shifts', text: 'Every factory makes 25% more and runs trucks at night; homes near factories are 5% less happy.' },
};
/** Eco standards: pollution multiplier and the share of output value added as running cost. */
export const ECO_POLLUTION = 0.7, ECO_PROFIT_CUT = 0.15;
/** Night shifts: output multiplier and the desirability multiplier for nearby homes. */
/**
 * Night shifts: output multiplier, and how much desirability nearby homes
 * lose: 5% of the base desirability (DESIRE_BASE 1 → 0.05). Subtracted, not
 * multiplied, so it also hurts homes that are already below zero.
 */
export const NIGHT_OUTPUT = 1.25, NIGHT_HAPPY_DROP = 0.05;
/** Night = before 06:00 or from 22:00 (time of day 0..1, traffic.ts timeOfDay). */
export const isNight = (tod: number): boolean => tod < 6 / 24 || tod >= 22 / 24;
/** Turn a policy on or off. */
export function setPolicy(world: World, k: keyof Policies, on: boolean): void { world.policies[k] = on; }
