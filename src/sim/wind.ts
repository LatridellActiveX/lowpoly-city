/**
 * sim/wind.ts — one global wind strength (0..1) that changes over time.
 *
 * Wind turbines now produce `800 × wind` power (PR 5; was 15) (rounded), so a city that relies
 * only on turbines browns out during calm spells. Power plants don't care.
 *
 * HOW THE WIND MOVES
 * ------------------
 *   wind = clamp( 0.5 + drift + 0.25·sin(2π·tick / WIND_PERIOD), 0, 1 )
 *
 *   - `drift` is a slow RANDOM WALK: every tick it takes a small random step
 *     and is gently pulled back toward 0 (multiplying by 0.985 each tick), so
 *     it wanders but never runs away. The "random" step is a hash of the tick
 *     and the city seed (random.ts), so a given city always gets the same
 *     weather — reloading can't re-roll a calm spell into a gale.
 *   - The SINE adds long calm/gusty spells: one full cycle every WIND_PERIOD
 *     ticks (4 minutes at 1×).
 * The average is about 0.5, so on average a turbine makes ~7–8 power
 * (half of its 15 maximum); the swings are the gameplay.
 */
import { World } from './grid';
import { hash2 } from './random';

/** Ticks for one full calm → gusty → calm sine cycle (480 ticks = 4 min at 1×). */
export const WIND_PERIOD = 480;
/** Largest random step per tick. */
const STEP = 0.05;
/** Pull back toward zero each tick (1 = no pull). */
const REVERT = 0.985;
/** The random walk is kept inside ±DRIFT_MAX. */
const DRIFT_MAX = 0.35;

/** Advance the wind by one tick. Called from Simulation.step(). */
export function stepWind(w: World): void {
  const r = hash2(w.tick, 4242, w.seed + 91) - 0.5; // −0.5..0.5, deterministic
  w.windDrift = Math.max(-DRIFT_MAX, Math.min(DRIFT_MAX, w.windDrift * REVERT + r * STEP));
  const sine = 0.25 * Math.sin((2 * Math.PI * w.tick) / WIND_PERIOD);
  w.wind = Math.max(0, Math.min(1, 0.5 + w.windDrift + sine));
}

/** Human label for the HUD gauge. */
export function windLabel(wind: number): string {
  if (wind < 0.15) return 'Calm';
  if (wind < 0.4) return 'Light';
  if (wind < 0.7) return 'Breezy';
  return 'Gusty';
}
