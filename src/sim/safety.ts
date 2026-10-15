/**
 * sim/safety.ts — V1.5b stage F: POLICE, CRIME AND HEALTH CARE.
 *
 * Plain TypeScript (no Three.js / DOM).
 *
 * CRIME (per tile, 0..1), recomputed with the environment:
 *   - none until the city first reaches CRIME_START people;
 *   - an occupied tile's base crime grows with its density
 *     (residents + ½·jobs) / CRIME_DENSITY, scaled up as the city grows
 *     (CRIME_CITY_MIN at CRIME_START → 1 at CRIME_CITY_FULL people);
 *   - police coverage (services.ts, Svc.Police) removes up to
 *     POLICE_EFFECT of it (85 % at full coverage).
 * HEALTH CARE: care = max(clinic, hospital) coverage, 0..1.
 *
 * EFFECTS
 *   land value  − LV_CRIME × crime, + LV_CARE × care   (applyServiceEffects)
 *   building health (redevelop.ts) × (1 − HEALTH_CRIME × crime) + HEALTH_CARE × care
 *
 * VEHICLES: every PATROL_TICKS a police station with a free car sends one
 * on a patrol to the most crime-ridden covered building and back (white
 * car, light bar). Clinics/hospitals send ambulances (white truck with a red
 * stripe) to a random occupied home in range every AMBULANCE_TICKS.
 */
import { due, PHASE } from './schedule';
import { GRID_SIZE } from './types';
import type { World } from './grid';
import type { Coverage } from './services';
import { POLICE_UNLOCK_POP, SERVICE_DEFS, serviceAnchors, serviceRoad, Svc } from './services';
import { roadNextTo, Traffic } from './traffic';

export const CRIME_START = POLICE_UNLOCK_POP; // crime starts exactly when the police station unlocks
export const CRIME_DENSITY = 40;
export const CRIME_CITY_MIN = 0.35, CRIME_CITY_FULL = 6000;
export const POLICE_EFFECT = 0.85;
export const LV_CRIME = 0.35, LV_CARE = 0.25;
export const HEALTH_CRIME = 0.35, HEALTH_CARE = 0.12;
export const PATROL_TICKS = 30, AMBULANCE_TICKS = 45;
export const POLICE_PURPOSE = 'police', AMBULANCE_PURPOSE = 'ambulance';
export const POLICE_COLOR = 0xf4f6f8, AMBULANCE_COLOR = 0xf7f7f7;

export interface Safety { crime: Float32Array; care: Float32Array }

export function computeSafety(world: World, cov: Coverage): Safety {
  const n = world.tiles.length, crime = new Float32Array(n), care = new Float32Array(n);
  const pop = world.peakPop;
  const city = pop < CRIME_START ? 0 : CRIME_CITY_MIN + (1 - CRIME_CITY_MIN) * Math.min(1, (pop - CRIME_START) / (CRIME_CITY_FULL - CRIME_START));
  const police = cov.by[Svc.Police], clinic = cov.by[Svc.Clinic], hosp = cov.by[Svc.Hospital];
  // V1.6 A4: care is a pure typed-array pass; crime only exists on
  // buildings, which live in active chunks (no tile objects read elsewhere).
  for (let i = 0; i < n; i++) care[i] = Math.max(clinic[i], hosp[i]);
  if (city) for (const i of world.chunks.activeTilesSorted()) {
    const t = world.tiles[i];
    if (!t.zone || t.level === 0) continue;
    const base = Math.min(1, (t.res + t.jobs * 0.5) / CRIME_DENSITY) * city;
    crime[i] = base * (1 - POLICE_EFFECT * police[i]);
  }
  return { crime, care };
}

/** Fold crime and care into the land value field (in place). */
/** V1.6 A3: applyServiceEffects for ONE tile (same formula), used by the garbage patch. */
export function serviceEffectOne(lv: number, crime: number, care: number, max: number): number {
  if (lv <= 0 && care === 0) return lv;
  return Math.max(0, Math.min(max, lv - LV_CRIME * crime + (lv > 0 ? LV_CARE * care : 0)));
}

export function applyServiceEffects(landValue: Float32Array, s: Safety, max: number): void {
  for (let i = 0; i < landValue.length; i++) {
    if (landValue[i] <= 0 && s.care[i] === 0) continue;
    landValue[i] = Math.max(0, Math.min(max, landValue[i] - LV_CRIME * s.crime[i] + (landValue[i] > 0 ? LV_CARE * s.care[i] : 0)));
  }
}

/** Building health adjustment (redevelop.ts). */
export const healthWithSafety = (h: number, crime: number, care: number) => Math.max(0, Math.min(1, h * (1 - HEALTH_CRIME * crime) + HEALTH_CARE * care));

/** Police patrols + ambulance runs. */
export class Responders {
  private out = new Map<number, number>();
  stats = { patrols: 0, ambulance: 0 };
  outOf(a: number): number { return this.out.get(a) ?? 0; }

  tick(world: World, traffic: Traffic, safety: Safety): void {
    const tiles = world.tiles, N = GRID_SIZE;
    const send = (a: number, svc: Svc, purpose: string, color: number, kind: 'car' | 'truck', pick: (i: number) => number) => {
      const def = SERVICE_DEFS[svc];
      if (this.outOf(a) >= def.fleet) return;
      const home = serviceRoad(tiles, a);
      if (home < 0) return;
      const ax = a % N, az = Math.floor(a / N);
      let best = -1, bestS = 0;
      for (let z = Math.max(0, az - def.radius); z <= Math.min(N - 1, az + def.radius); z++)
        for (let x = Math.max(0, ax - def.radius); x <= Math.min(N - 1, ax + def.radius); x++) {
          const sc = pick(z * N + x);
          if (sc > bestS) { bestS = sc; best = z * N + x; }
        }
      if (best < 0) return;
      const stop = roadNextTo(tiles, best);
      if (stop < 0) return;
      const back = () => this.out.set(a, Math.max(0, this.outOf(a) - 1));
      const ok = traffic.spawn(world, kind, home, stop, `${purpose}: responding`, color, () => {
        if (!traffic.spawn(world, kind, stop, home, `${purpose}: returning`, color, back)) back();
      });
      if (ok) { this.out.set(a, this.outOf(a) + 1); if (svc === Svc.Police) this.stats.patrols++; else this.stats.ambulance++; }
    };
    if (due(world.tick, PATROL_TICKS, PHASE.patrol)) // V1.6 A4: staggered (schedule.ts)
     
      for (const a of serviceAnchors(world, Svc.Police)) send(a, Svc.Police, POLICE_PURPOSE, POLICE_COLOR, 'car', (i) => safety.crime[i] * (0.5 + hash(i, world.tick)));
    if (due(world.tick, AMBULANCE_TICKS, PHASE.ambulance))
     
      for (const svc of [Svc.Clinic, Svc.Hospital])
        for (const a of serviceAnchors(world, svc)) send(a, svc, AMBULANCE_PURPOSE, AMBULANCE_COLOR, 'truck', (i) => (tiles[i].zone === 'residential' && tiles[i].res > 0 ? hash(i, world.tick) : 0));
  }
}
const hash = (i: number, t: number) => { const x = Math.sin(i * 12.9898 + t * 78.233) * 43758.5453; return x - Math.floor(x); };
