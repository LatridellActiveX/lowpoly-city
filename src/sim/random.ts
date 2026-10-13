/**
 * sim/random.ts — deterministic "random" numbers from coordinates.
 *
 * WHY HASHES INSTEAD OF Math.random()?
 * ------------------------------------
 * If we picked a house design with Math.random(), it would change every time
 * you reload. Instead we feed the tile coordinates (and a per-city seed) into
 * a HASH function: a recipe that scrambles the input bits so neighbouring
 * inputs give wildly different outputs, but the SAME input always gives the
 * SAME output. So tile (12, 40) always gets the same house, and the house
 * next door almost always gets a different one.
 *
 * VALUE NOISE
 * -----------
 * Raw hashes are "white noise": every tile is unrelated to its neighbour.
 * For terrain we want smooth blobs (a meadow here, a forest there). Value
 * noise gives that: put a hashed random value on a coarse lattice (say every
 * 8 tiles), then blend smoothly between the four surrounding lattice points.
 * Adding a couple of these at different scales ("octaves") looks natural.
 */

/** Hash two integers + a seed to a float in [0, 1). */
export function hash2(x: number, z: number, seed = 0): number {
  // Multiply by large odd constants and mix with xor/shift: a classic
  // integer hash. Math.imul does 32-bit integer multiplication.
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1] with features roughly `scale` tiles wide. */
export function valueNoise(x: number, z: number, scale: number, seed: number): number {
  const gx = x / scale;
  const gz = z / scale;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  // Fractional position inside the lattice cell, eased with smoothstep so
  // there are no visible creases at cell edges.
  const fx = gx - x0;
  const fz = gz - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sz;
}

/** Two octaves of value noise: big blobs plus some smaller wiggle. */
export function fbm(x: number, z: number, scale: number, seed: number): number {
  return valueNoise(x, z, scale, seed) * 0.7 + valueNoise(x, z, scale / 2.5, seed + 101) * 0.3;
}
