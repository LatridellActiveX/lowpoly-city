/**
 * sim/settings.ts — PR 4 player settings (Settings panel, ui/settings.ts).
 *
 * Settings belong to the PLAYER, not the city, so they're stored under their
 * own localStorage key and survive "New city". They're plain numbers the
 * simulation reads every tick:
 *   - maxCars / maxTrucks: caps on vehicles on the map at once. Traffic is
 *     the most expensive thing to draw, so lowering these helps slow PCs.
 *   - tickRate: simulation ticks per real second at 1× (0.5, 1 or 2). Higher
 *     = the city grows and books months faster. It does NOT change the length
 *     of a day, which runs on the game clock (see World.clock).
 *   - dayNight: false freezes the sky at noon.
 *   - detail (PR 5): 'high' = detailed buildings/roads when zoomed in,
 *     'low' = always the simple models (faster on slow PCs).
 */
import { TICKS_PER_SECOND } from './rules';

export interface Settings {
  maxCars: number;
  maxTrucks: number;
  tickRate: number;
  dayNight: boolean;
  detail: 'high' | 'low';
  /** PR 5: camera sensitivity multipliers (0.25–2). Rotation = middle-drag orbit; pan = drag + WASD. */
  camRotate: number;
  camPan: number;
  /** Show a frames-per-second counter on the HUD. */
  showFps: boolean;
  /**
   * Admin mode. Admin-only buildings (the Trade Spire) stay out of the
   * build menu and refuse placement while this is off. It is a player
   * setting, not a save field: turn it on with ?admin=1 in the URL and
   * off again with ?admin=0; the choice persists in localStorage.
   */
  admin: boolean;
}

const KEY = 'lowpoly-city-settings';
// PR 5: maxCars default 150 → 75 (half the commuters; see COMMUTE_PEOPLE).
export const defaultSettings = (): Settings => ({ maxCars: 75, maxTrucks: 40, tickRate: TICKS_PER_SECOND, dayNight: true, detail: 'high', camRotate: 1, camPan: 1, showFps: false, admin: false });

export function loadSettings(): Settings {
  let out: Settings;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    out = { ...defaultSettings(), ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    out = defaultSettings();
  }
  // ?admin=1 / ?admin=0 in the page URL flips admin mode (and it sticks,
  // because every saveSettings() call persists the whole object).
  try {
    if (typeof location !== 'undefined') {
      const a = new URLSearchParams(location.search).get('admin');
      if (a === '1') out.admin = true;
      else if (a === '0') out.admin = false;
    }
  } catch { /* no URL (tests) — keep the stored value */ }
  return out;
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
