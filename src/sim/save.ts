/**
 * sim/save.ts — saving and loading the city to the browser's localStorage.
 *
 * The world is just an array of plain tile objects, so a save is simply JSON:
 *   { version, tick, tiles: [...] }
 * The `version` number lets future milestones migrate old saves (e.g. add car
 * or goods data) instead of breaking them.
 */
import { World, emptyTile } from './grid';
import { GRID_SIZE, Tile } from './types';

const KEY = 'lowpoly-city-save';
export const SAVE_VERSION = 1;

export function saveWorld(world: World): void {
  const data = { version: SAVE_VERSION, tick: world.tick, size: GRID_SIZE, tiles: world.tiles };
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
    // Merge each saved tile over a default tile so fields added later get defaults.
    const tiles: Tile[] = data.tiles.map((t: Partial<Tile>) => ({ ...emptyTile(), ...t }));
    const w = new World(tiles);
    w.tick = data.tick ?? 0;
    return w;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  localStorage.removeItem(KEY);
}
