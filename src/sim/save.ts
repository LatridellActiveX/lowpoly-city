/**
 * sim/save.ts — saving and loading the city to the browser's localStorage.
 *
 * A save is JSON:
 *   { version, size, tick, seed, cash, taxRates, ledger, lastLedger, tiles: [...] }
 *
 * MIGRATIONS: `version` says which format a save uses. When we load an older
 * one we upgrade it step by step:
 *   v1 (milestone 1) had no money, seed or decorations. We give it the
 *   starting cash and default taxes, pick a seed, and scatter trees only on
 *   tiles that are still completely empty, so nothing the player built moves.
 *   v2 (PR 2) had no wind. v1 and v2 saves start with a moderate wind (0.5)
 *   and no drift. v3 (PR 3) stores `wind` and `windDrift`.
 *   v4 (PR 4) adds per-tile `water`, `edge`, `roadType`, `construct`, `stock`,
 *   `part` (2×2 buildings) and world `clock` + `tier`. Migrating a v1–v3 save:
 *   a river/lake is generated ONLY on empty tiles (your town never floods),
 *   the highway connection is laid at the first free edge spot, existing
 *   power plants get a full fuel bunker, the clock starts at 0 and the tier
 *   is worked out from the current population on the first tick.
 *
 * Merging over defaults: each tile is spread over emptyTile(), and the ledger
 * is merged section by section, so a field added later (like the park upkeep
 * line) gets its default instead of `undefined`.
 */
import { initialWindDir } from './wind';
import { World, emptyTile } from './grid';
import { defaultTaxRates, emptyLedger, Ledger, STARTING_CASH } from './economy';
import { scatterDecorations } from './terrain';
import { generateWater, placeEdgeConnection } from './mapgen';
import { FUEL_MAX } from './rules';
import { GRID_SIZE, Tile } from './types';

const KEY = 'lowpoly-city-save';
/** v5 (PR 5): tile kind/farm/input/crew + windDir/windDirVel. */
export const SAVE_VERSION = 5;

export function saveWorld(world: World): void {
  const data = {
    version: SAVE_VERSION,
    size: GRID_SIZE,
    tick: world.tick,
    seed: world.seed,
    cash: world.cash,
    taxRates: world.taxRates,
    ledger: world.ledger,
    lastLedger: world.lastLedger,
    wind: world.wind,
    windDrift: world.windDrift,
    windDir: world.windDir,
    windDirVel: world.windDirVel,
    clock: world.clock,
    tier: world.tier,
    tiles: world.tiles,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    // Storage full or blocked (private mode). console.warn is captured by the Game Log.
    console.warn('Save failed:', e instanceof Error ? e.message : e);
  }
}

export function hasSave(): boolean {
  return localStorage.getItem(KEY) !== null;
}

/** Returns a World, or null if there's no save or it's unreadable. */
export function loadWorld(): World | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data.size !== GRID_SIZE || !Array.isArray(data.tiles)) return null;
    const version: number = data.version ?? 1;
    // Merge each saved tile over a default tile so fields added later get defaults.
    // PR 5: movingIn is reset — cars in transit aren't saved, so anyone who
    // was still driving in simply arrives when the save loads.
    const tiles: Tile[] = data.tiles.map((t: Partial<Tile>) => ({ ...emptyTile(), ...t, movingIn: false }));
    const seed: number = data.seed ?? Math.floor(Math.random() * 1e9);
    const w = new World(tiles, seed);
    w.tick = data.tick ?? 0;
    if (version < 2) {
      // ---- v1 -> v2 migration ----
      w.cash = STARTING_CASH;
      w.taxRates = defaultTaxRates();
      scatterDecorations(w.tiles, seed);
    } else {
      w.cash = data.cash ?? STARTING_CASH;
      w.taxRates = { ...defaultTaxRates(), ...data.taxRates };
      w.ledger = mergeLedger(data.ledger) ?? emptyLedger();
      w.lastLedger = mergeLedger(data.lastLedger);
    }
    if (version < 3) {
      // ---- v1/v2 -> v3 migration: no weather yet, start with a moderate breeze ----
      w.wind = 0.5;
      w.windDrift = 0;
    } else {
      w.wind = typeof data.wind === 'number' ? data.wind : 0.5;
      w.windDrift = typeof data.windDrift === 'number' ? data.windDrift : 0;
    }
    if (version < 4) {
      // ---- v1-v3 -> v4 migration (PR 4) ----
      generateWater(w.tiles, seed, true);
      if (w.edgeIndex < 0) placeEdgeConnection(w.tiles, seed);
      w.tiles.forEach((t) => t.structure === 'powerPlant' && (t.stock = FUEL_MAX));
    } else {
      w.clock = typeof data.clock === 'number' ? data.clock : 0;
      w.tier = typeof data.tier === 'number' ? data.tier : 0;
    }
    if (version < 5) {
      // ---- v4 -> v5 migration (PR 5 industry) ----
      // Old cities have no Construction Yard, so treat sites that were already
      // underway as having their crew on site (they finish normally). New
      // sites need a yard; the sim posts a hint until one is built.
      // kind / farm / input default to 0 via emptyTile(), i.e. ordinary
      // factories and no fields — farms on farmland claim fields next tick.
      w.tiles.forEach((t) => { if (t.construct > 0) t.crew = true; });
    }
    // PR 5 wind direction: older saves get the seeded default heading.
    w.windDir = typeof data.windDir === 'number' ? data.windDir : initialWindDir(seed);
    w.windDirVel = typeof data.windDirVel === 'number' ? data.windDirVel : 0;
    return w;
  } catch (e) {
    console.warn('Load failed: save data unreadable —', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Merge a saved ledger over an empty one, section by section (null stays null). */
function mergeLedger(l: Partial<Ledger> | null | undefined): Ledger | null {
  if (!l) return null;
  const e = emptyLedger();
  return {
    taxes: { ...e.taxes, ...l.taxes },
    upkeep: { ...e.upkeep, ...l.upkeep },
    construction: l.construction ?? 0,
    refunds: l.refunds ?? 0,
    trade: { ...e.trade, ...l.trade },
  };
}

export function clearSave(): void {
  localStorage.removeItem(KEY);
}
