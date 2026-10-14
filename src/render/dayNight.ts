/**
 * render/dayNight.ts — the day/night cycle (PR 3). Pure visuals: the
 * simulation doesn't know or care what time of day it is.
 *
 * TIME OF DAY
 * -----------
 * PR 4: timeOfDay = (world.clock / DAY_SECONDS + START) mod 1
 *   0.00 = midnight, 0.25 = 6 am, 0.50 = noon, 0.75 = 6 pm.
 * world.clock is game-seconds at 1× (it stops when paused and runs 2×/3×
 * faster at higher speeds). DAY_SECONDS = 3600: a full day is ONE HOUR of
 * real time at 1× — 30 minutes of daylight (6 am–6 pm) and 30 of night.
 * It uses the clock, not ticks, so the Settings tick-rate doesn't change it.
 * A new city starts at START = 0.3 (about 7 am). Settings can switch the
 * cycle off, which pins the sky at noon.
 *
 * LIGHTING
 * --------
 * A small table of KEYFRAMES (midnight, dawn, morning, noon, ...) holds the
 * sky colour, sun colour/intensity and fill-light intensity. Each frame we
 * find the two keyframes around the current time and linearly blend (lerp)
 * between them. The sun also travels across the sky: its height follows a
 * sine wave so shadows lengthen at dusk. At night the same light becomes a
 * dim blue "moon" so the city is still readable.
 *
 * `night` (0 = full day, 1 = full night) drives the lit windows and street
 * lamps (cityRenderer.setNight).
 */
import * as THREE from 'three';
import { Simulation } from '../sim/simulation';
import { GRID_SIZE } from '../sim/types';

// PR 5: day length + start time now live in sim/traffic.ts (traffic volume
// follows the clock too), re-exported here for existing imports.
import { DAY_SECONDS, DAY_START as START } from '../sim/traffic';
export { DAY_SECONDS };

interface Key {
  t: number;
  sky: number;
  sun: number;
  sunI: number;
  hemiI: number;
}
// prettier-ignore
const KEYS: Key[] = [
  { t: 0.0,  sky: 0x16244a, sun: 0x9fb4ff, sunI: 0.55, hemiI: 0.7 }, // midnight: moonlight
  { t: 0.2,  sky: 0x1e2c52, sun: 0x9fb2ff, sunI: 0.55, hemiI: 0.72 },
  { t: 0.27, sky: 0xf2a774, sun: 0xffb27a, sunI: 1.2,  hemiI: 0.95 }, // dawn: warm orange
  { t: 0.35, sky: 0x9fd3e8, sun: 0xfff1d6, sunI: 2.2,  hemiI: 1.6 },  // morning: normal day
  { t: 0.65, sky: 0x9fd3e8, sun: 0xfff1d6, sunI: 2.2,  hemiI: 1.6 },
  { t: 0.73, sky: 0xf08a5d, sun: 0xff9a5c, sunI: 1.2,  hemiI: 0.95 }, // dusk: warm red-orange
  { t: 0.8,  sky: 0x1e2c52, sun: 0x9fb2ff, sunI: 0.55, hemiI: 0.72 },
  { t: 1.0,  sky: 0x16244a, sun: 0x9fb4ff, sunI: 0.55, hemiI: 0.7 },
];

export function timeOfDay(sim: Simulation): number {
  if (!sim.settings.dayNight) return 0.5;
  return ((sim.world.clock / DAY_SECONDS + START) % 1 + 1) % 1;
}

/** "14:30" style clock for the HUD. */
export function clockText(t: number): string {
  const mins = Math.floor(t * 24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export class DayNight {
  /** For screenshots/debugging: force a time of day (null = follow the sim). */
  override: number | null = null;
  /** Last computed values, read by main.ts. */
  time = 0.5;
  night = 0;
  private readonly a = new THREE.Color();
  private readonly b = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sun: THREE.DirectionalLight,
    private readonly hemi: THREE.HemisphereLight,
  ) {}

  update(sim: Simulation): void {
    const t = this.override ?? timeOfDay(sim);
    this.time = t;
    // Find the keyframes on either side of t and how far we are between them.
    let k = 0;
    while (k < KEYS.length - 2 && KEYS[k + 1].t <= t) k++;
    const k0 = KEYS[k], k1 = KEYS[k + 1];
    const f = (t - k0.t) / (k1.t - k0.t);
    const bg = this.scene.background as THREE.Color;
    bg.copy(this.a.setHex(k0.sky)).lerp(this.b.setHex(k1.sky), f);
    this.sun.color.copy(this.a.setHex(k0.sun)).lerp(this.b.setHex(k1.sun), f);
    this.sun.intensity = k0.sunI + (k1.sunI - k0.sunI) * f;
    this.hemi.intensity = k0.hemiI + (k1.hemiI - k0.hemiI) * f;

    // Sun path: rises in the east at 6 am, highest at noon, sets at 6 pm.
    // At night we mirror it so the "moon" is also above the map.
    const angle = (t - 0.25) * Math.PI * 2; // 0 at dawn, π/2 at noon
    const height = Math.sin(angle);
    const c = GRID_SIZE / 2;
    const h = Math.max(0.35, Math.abs(height)); // never quite flat: avoids endless shadows
    this.sun.position.set(c + Math.cos(angle) * 55 * (height < 0 ? -1 : 1), 20 + h * 50, c + 20);

    // 0 in daylight, 1 at night, with a soft ramp through dusk and dawn.
    // PR 4: centred on the horizon so night is exactly half the day (6 pm–6 am).
    this.night = Math.min(1, Math.max(0, (0.08 - height) / 0.16));
  }
}
