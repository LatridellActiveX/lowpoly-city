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
 *
 * Merging over defaults: each tile is spread over emptyTile(), and the ledger
 * is merged section by section, so a field added later (like the park upkeep
 * line) gets its default instead of `undefined`.
 */
import { World, emptyTile } from './grid';
import { defaultTaxRates, emptyLedger, Ledger, STARTING_CASH } from './economy';
import { scatterDecorations } from './terrain';
import { GRID_SIZE, Tile } from './types';

const KEY = 'lowpoly-city-save';
export const SAVE_VERSION = 3;

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
    tiles: world.tiles,
  };
  localStorage.setItem(KEY, JSON.stringify(data));
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
    const tiles: Tile[] = data.tiles.map((t: Partial<Tile>) => ({ ...emptyTile(), ...t }));
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
    return w;
  } catch {
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
  };
}

export function clearSave(): void {
  localStorage.removeItem(KEY);
}
