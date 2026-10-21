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
import { ADOPTABLE, RECIPES, Role, roleOf, setAutoRole } from './chains';

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

/** The recipes the picker offers (the same ones the automatic rules may adopt). */
export const pickableRecipes = (): Role[] => [...ADOPTABLE];

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

/** Output multiplier of an industrial tile from its upgrades (IND-4 adds the night-shift policy). */
export function outputMult(world: World, t: { upg: number }): number {
  let m = 1;
  if (hasUpg(t, 'SHIFT')) m *= 1.5;
  if (hasUpg(t, 'AUTO')) m *= 1.3;
  return m;
}
/** Workers multiplier (jobs offered) from upgrades. */
export const workerMult = (t: { upg: number }): number => (hasUpg(t, 'SHIFT') ? 1.3 : 1) * (hasUpg(t, 'AUTO') ? 0.6 : 1);
/** Power use multiplier from upgrades. */
export const powerMult = (t: { upg: number }): number => (hasUpg(t, 'AUTO') ? 1.5 : 1);
/** Pollution multiplier of an industrial tile (IND-4 adds eco standards). */
export function pollutionMult(world: World, t: { upg: number }): number {
  return hasUpg(t, 'FILTER') ? 0.4 : 1;
}
/** Extra running cost as a share of output value (filters +10%; IND-4 eco standards add more). */
export function runningCostShare(world: World, t: { upg: number }): number {
  return hasUpg(t, 'FILTER') ? 0.1 : 0;
}
