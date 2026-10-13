/**
 * render/dayNight.ts — the day/night cycle (PR 3). Pure visuals: the
 * simulation doesn't know or care what time of day it is.
 *
 * TIME OF DAY
 * -----------
 * timeOfDay = ((tick + fraction of the next tick) / DAY_TICKS) mod 1
 *   0.00 = midnight, 0.25 = 6 am, 0.50 = noon, 0.75 = 6 pm.
 * Because it's derived from the sim's tick counter, pausing the game freezes
 * the sky, and 2×/3× speed makes days pass faster — for free.
 * DAY_TICKS = 240 ticks = 2 minutes per day at 1× speed.
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

export const DAY_TICKS = 240;

interface Key {
  t: number;
  sky: number;
  sun: number;
  sunI: number;
  hemiI: number;
}
// prettier-ignore
const KEYS: Key[] = [
  { t: 0.0,  sky: 0x0f1a33, sun: 0x8fa8ff, sunI: 0.35, hemiI: 0.45 }, // midnight: moonlight
  { t: 0.2,  sky: 0x1b2747, sun: 0x9fb2ff, sunI: 0.35, hemiI: 0.5 },
  { t: 0.27, sky: 0xf2a774, sun: 0xffb27a, sunI: 1.2,  hemiI: 0.95 }, // dawn: warm orange
  { t: 0.35, sky: 0x9fd3e8, sun: 0xfff1d6, sunI: 2.2,  hemiI: 1.6 },  // morning: normal day
  { t: 0.65, sky: 0x9fd3e8, sun: 0xfff1d6, sunI: 2.2,  hemiI: 1.6 },
  { t: 0.73, sky: 0xf08a5d, sun: 0xff9a5c, sunI: 1.2,  hemiI: 0.95 }, // dusk: warm red-orange
  { t: 0.8,  sky: 0x1b2747, sun: 0x9fb2ff, sunI: 0.35, hemiI: 0.5 },
  { t: 1.0,  sky: 0x0f1a33, sun: 0x8fa8ff, sunI: 0.35, hemiI: 0.45 },
];

export function timeOfDay(sim: Simulation): number {
  return (((sim.world.tick + sim.subTick) / DAY_TICKS) % 1 + 1) % 1;
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
    this.night = Math.min(1, Math.max(0, (0.15 - height) / 0.3));
  }
}
