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
   * OASIS-S6: settings revision for the traffic defaults. Absent (older
   * saves) = before the car cap went 75 → 100; loadSettings then moves a cap
   * still sitting on the old default up once. A cap the player picks later
   * (even 75) is saved with trafficRev 1 and kept.
   */
  trafficRev?: number;
}

const KEY = 'lowpoly-city-settings';
// PR 5: maxCars default 150 → 75 (half the commuters; see COMMUTE_PEOPLE).
// OASIS-S6: 75 → 100 so the busier everyday traffic (traffic.ts rushFactor) is not capped away in mid-size towns.
export const TRAFFIC_REV = 1;
const OLD_DEFAULT_CARS = 75;
export const defaultSettings = (): Settings => ({ trafficRev: TRAFFIC_REV, maxCars: 100, maxTrucks: 40, tickRate: TICKS_PER_SECOND, dayNight: true, detail: 'high', camRotate: 1, camPan: 1, showFps: false });

export function loadSettings(): Settings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const saved = raw ? JSON.parse(raw) : {};
    // OASIS-S6 one-time migration: an untouched old default cap follows the new default.
    if (raw && (saved.trafficRev ?? 0) < TRAFFIC_REV) {
      if (saved.maxCars === OLD_DEFAULT_CARS) saved.maxCars = defaultSettings().maxCars;
      saved.trafficRev = TRAFFIC_REV;
    }
    return { ...defaultSettings(), ...saved };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
