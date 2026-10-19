/**
 * roads/bezier.ts — V1.6 B1: cubic Bézier maths for the road graph.
 *
 * Every road edge is ONE cubic Bézier curve in metres on the ground plane
 * (x east, z south): P(t) = (1−t)³p0 + 3(1−t)²t p1 + 3(1−t)t² p2 + t³p3.
 * A straight road is a "degenerate" cubic whose control points lie on the
 * line (at ⅓ and ⅔), so straight and curved roads share all the code.
 *
 * ARC-LENGTH LUT: t is not proportional to distance along a curve. Cars
 * must move at constant speed and zone cells must be 8 m apart, so each
 * edge keeps a table of cumulative length at evenly spaced t values
 * (`buildLut`), and `tAtLength` inverts it by binary search + linear
 * interpolation.
 */
export type V2 = { x: number; z: number };
/** p0, p1, p2, p3 as [x0, z0, x1, z1, x2, z2, x3, z3]. */
export type Cubic = Float64Array;

export const v2 = (x: number, z: number): V2 => ({ x, z });
export const dist = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z);

/** A straight cubic from a to b (controls at ⅓ and ⅔). */
export function lineCubic(a: V2, b: V2): Cubic {
  return Float64Array.of(a.x, a.z, a.x + (b.x - a.x) / 3, a.z + (b.z - a.z) / 3, a.x + (2 * (b.x - a.x)) / 3, a.z + (2 * (b.z - a.z)) / 3, b.x, b.z);
}
/** Quadratic (a, control q, b) raised to an exact cubic (the 3-click curve tool). */
export function quadCubic(a: V2, q: V2, b: V2): Cubic {
  return Float64Array.of(a.x, a.z, a.x + (2 / 3) * (q.x - a.x), a.z + (2 / 3) * (q.z - a.z), b.x + (2 / 3) * (q.x - b.x), b.z + (2 / 3) * (q.z - b.z), b.x, b.z);
}

/** Point at t. */
export function at(c: Cubic, t: number, out: V2 = { x: 0, z: 0 }): V2 {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  out.x = a * c[0] + b * c[2] + d * c[4] + e * c[6];
  out.z = a * c[1] + b * c[3] + d * c[5] + e * c[7];
  return out;
}
/** Derivative (velocity) at t. */
export function deriv(c: Cubic, t: number, out: V2 = { x: 0, z: 0 }): V2 {
  const u = 1 - t;
  out.x = 3 * u * u * (c[2] - c[0]) + 6 * u * t * (c[4] - c[2]) + 3 * t * t * (c[6] - c[4]);
  out.z = 3 * u * u * (c[3] - c[1]) + 6 * u * t * (c[5] - c[3]) + 3 * t * t * (c[7] - c[5]);
  return out;
}
/** Unit tangent at t (falls back to the chord for degenerate ends). */
export function tangent(c: Cubic, t: number): V2 {
  const d = deriv(c, t), l = Math.hypot(d.x, d.z);
  if (l > 1e-9) return { x: d.x / l, z: d.z / l };
  const cx = c[6] - c[0], cz = c[7] - c[1], cl = Math.hypot(cx, cz) || 1;
  return { x: cx / cl, z: cz / cl };
}
/** Signed curvature at t (1 / radius; 0 on a straight). */
export function curvature(c: Cubic, t: number): number {
  const u = 1 - t, d = deriv(c, t);
  const ddx = 6 * u * (c[4] - 2 * c[2] + c[0]) + 6 * t * (c[6] - 2 * c[4] + c[2]);
  const ddz = 6 * u * (c[5] - 2 * c[3] + c[1]) + 6 * t * (c[7] - 2 * c[5] + c[3]);
  const s = Math.hypot(d.x, d.z);
  return s < 1e-9 ? 0 : (d.x * ddz - d.z * ddx) / (s * s * s);
}

/** Split at t with de Casteljau: two cubics that trace exactly the same curve. */
export function split(c: Cubic, t: number): [Cubic, Cubic] {
  const l = (a: number, b: number) => a + (b - a) * t;
  const x01 = l(c[0], c[2]), z01 = l(c[1], c[3]), x12 = l(c[2], c[4]), z12 = l(c[3], c[5]), x23 = l(c[4], c[6]), z23 = l(c[5], c[7]);
  const xa = l(x01, x12), za = l(z01, z12), xb = l(x12, x23), zb = l(z12, z23);
  const xm = l(xa, xb), zm = l(za, zb);
  return [Float64Array.of(c[0], c[1], x01, z01, xa, za, xm, zm), Float64Array.of(xm, zm, xb, zb, x23, z23, c[6], c[7])];
}
/** The same curve traced backwards. */
export const reverse = (c: Cubic): Cubic => Float64Array.of(c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]);

/** Samples per LUT: one every ~2 m, at least 16. */
export const lutSamples = (approxLen: number) => Math.max(16, Math.min(512, Math.ceil(approxLen / 2)));
/** Cumulative arc length at t = k / (n − 1), k = 0..n−1 (lut[0] = 0, last = total length). */
export function buildLut(c: Cubic, n = lutSamples(Math.hypot(c[6] - c[0], c[7] - c[1]) * 1.3)): Float32Array {
  const lut = new Float32Array(n);
  const p = { x: c[0], z: c[1] }, q = { x: 0, z: 0 };
  let acc = 0;
  for (let k = 1; k < n; k++) { at(c, k / (n - 1), q); acc += Math.hypot(q.x - p.x, q.z - p.z); lut[k] = acc; p.x = q.x; p.z = q.z; }
  return lut;
}
/** t at arc length s (clamped), from the LUT. */
export function tAtLength(lut: Float32Array, s: number): number {
  const n = lut.length, total = lut[n - 1];
  if (s <= 0) return 0;
  if (s >= total) return 1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lut[mid] < s) lo = mid; else hi = mid; }
  const f = (s - lut[lo]) / Math.max(1e-9, lut[hi] - lut[lo]);
  return (lo + f) / (n - 1);
}

/** OASIS-S2: arc length at parameter t (inverse of tAtLength), from the LUT. */
export function lengthAtT(lut: Float32Array, t: number): number {
  const n = lut.length, f = Math.max(0, Math.min(1, t)) * (n - 1), k = Math.min(n - 2, Math.floor(f));
  return n < 2 ? 0 : lut[k] + (lut[k + 1] - lut[k]) * (f - k);
}

/** Closest point on the curve to p: t, point and distance (coarse LUT scan + refinement). */
export function nearest(c: Cubic, p: V2, n = 32): { t: number; pt: V2; d: number } {
  let bt = 0, bd = Infinity;
  const q = { x: 0, z: 0 };
  for (let k = 0; k <= n; k++) { at(c, k / n, q); const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2; if (d < bd) { bd = d; bt = k / n; } }
  // Golden-section refinement in the bracketing interval.
  let lo = Math.max(0, bt - 1 / n), hi = Math.min(1, bt + 1 / n);
  const f = (t: number) => { at(c, t, q); return (q.x - p.x) ** 2 + (q.z - p.z) ** 2; };
  for (let k = 0; k < 40; k++) {
    const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
    if (f(m1) < f(m2)) hi = m2; else lo = m1;
  }
  const t = (lo + hi) / 2, pt = at(c, t);
  return { t, pt, d: Math.hypot(pt.x - p.x, pt.z - p.z) };
}

/** Polyline of the curve (n segments), for intersection tests and meshes. */
export function polyline(c: Cubic, n: number): Float64Array {
  const out = new Float64Array((n + 1) * 2), q = { x: 0, z: 0 };
  for (let k = 0; k <= n; k++) { at(c, k / n, q); out[2 * k] = q.x; out[2 * k + 1] = q.z; }
  return out;
}

/** Segment–segment intersection: parameters (s on ab, u on cd) or null. Excludes touching ends by eps. */
export function segX(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): [number, number] | null {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = cx - ax, qz = cz - az;
  const s = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
  return s >= 0 && s <= 1 && u >= 0 && u <= 1 ? [s, u] : null;
}

/**
 * All crossings of two cubics as (tA, tB) pairs: polyline segment tests,
 * then Newton refinement on the real curves. Used to split edges where a
 * new road crosses an old one.
 */
export function intersect(a: Cubic, b: Cubic, n = 48): Array<[number, number]> {
  const pa = polyline(a, n), pb = polyline(b, n), out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const hit = segX(pa[2 * i], pa[2 * i + 1], pa[2 * i + 2], pa[2 * i + 3], pb[2 * j], pb[2 * j + 1], pb[2 * j + 2], pb[2 * j + 3]);
    if (!hit) continue;
    let ta = (i + hit[0]) / n, tb = (j + hit[1]) / n;
    // Newton on F(ta, tb) = A(ta) − B(tb) = 0.
    for (let k = 0; k < 12; k++) {
      const A = at(a, ta), B = at(b, tb), dA = deriv(a, ta), dB = deriv(b, tb);
      const fx = A.x - B.x, fz = A.z - B.z;
      const det = dA.x * -dB.z - -dB.x * dA.z;
      if (Math.abs(det) < 1e-12) break;
      const dta = (fx * -dB.z - -dB.x * fz) / det, dtb = (dA.x * fz - dA.z * fx) / det;
      ta = Math.min(1, Math.max(0, ta - dta)); tb = Math.min(1, Math.max(0, tb - dtb));
      if (Math.abs(dta) + Math.abs(dtb) < 1e-12) break;
    }
    if (!out.some(([x, y]) => Math.abs(x - ta) < 1e-4 && Math.abs(y - tb) < 1e-4)) out.push([ta, tb]);
  }
  return out;
}
