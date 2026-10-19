/**
 * sim/garbageRules.ts — how much garbage a building makes and holds, by zone.
 * Dependency-free so environment.ts / redevelop.ts / the renderer can share it.
 * Industry makes 3× the garbage of housing and commerce 2×, and their buildings
 * also hold proportionally more before they are full (so the same pickup
 * "urgency" applies to every zone).
 */
import type { Tile } from './types';

/** Garbage a building makes (and can hold), relative to housing. */
export const GARBAGE_ZONE_MULT = { residential: 1, commercial: 2, industrial: 3 } as const;
/** Per-building storage for housing and the level at which piles show; other zones scale by GARBAGE_ZONE_MULT. */
export const G_MAX = 60;
export const G_WARN = 42;
export const garbageMult = (zone: Tile['zone']) => (zone ? GARBAGE_ZONE_MULT[zone] : 1);
/** The most garbage a building of this zone can hold. */
export const garbageMax = (zone: Tile['zone']) => G_MAX * garbageMult(zone);
/** From here the building shows bin-bag piles, a 🗑 warning and starts hurting its land value. */
export const garbageWarn = (zone: Tile['zone']) => G_WARN * garbageMult(zone);
/** The tile's garbage on the housing scale (0..60), so land value / health penalties treat a full building of any zone alike. */
export const garbageNorm = (t: Tile) => (t.garbage * G_MAX) / garbageMax(t.zone);
