/** tools/oasis-helpers.ts — small curve helpers for oasis.test.ts. */
import { V2 } from '../src/roads/bezier';
export { quadCubic } from '../src/roads/bezier';
/** Is a cubic a straight segment (control points on the chord)? */
export const isStraightCubic = (c: Float64Array): boolean => {
  const a: V2 = { x: c[0], z: c[1] }, b: V2 = { x: c[6], z: c[7] };
  const cross = (p: V2) => Math.abs((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) / (Math.hypot(b.x - a.x, b.z - a.z) || 1);
  return cross({ x: c[2], z: c[3] }) < 0.5 && cross({ x: c[4], z: c[5] }) < 0.5;
};
