/**
 * render/vehicles.ts — PR 4 vehicle, traffic light and driveway models, plus
 * the maths that turns a sim Vehicle (path + progress) into a world position.
 *
 * LANES: we drive on the right. For a heading (dx, dz) on the ground, the
 * right-hand side is (−dz, dx) (check: heading north (0,−1) → right is east
 * (1,0)). Each vehicle is pushed LANE metres to its right.
 * CORNERS: near the end of a segment we blend the lane offset and heading of
 * this segment into those of the next one (smoothstep over the last 40%), so
 * cars swing round corners instead of snapping 90°.
 */
import * as THREE from 'three';
import { box, merge, part } from './models';
import { GRID_SIZE, Tile } from '../sim/types';
import { Vehicle } from '../sim/traffic';
import { BRIDGE_Y } from './roads';

const LANE = 0.17;
const GLASS = 0x2a3440;

export const VEHICLES = {
  /** Car along +x. Body is white so the instance colour paints it. */
  car: () =>
    merge([
      part(box(0.24, 0.06, 0.12), 0xffffff, [0, 0.025, 0]),
      part(box(0.12, 0.05, 0.105), GLASS, [-0.02, 0.085, 0]),
      part(box(0.02, 0.02, 0.1), 0xfff3c4, [0.12, 0.045, 0]), // headlights
      ...[[-0.08, -0.055], [0.08, -0.055], [-0.08, 0.055], [0.08, 0.055]].map(([x, z]) => part(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 8).rotateX(Math.PI / 2), 0x1b1b1b, [x, 0.024, z])),
    ]),
  /** Truck cab (fixed colours) along +x. */
  truckCab: () =>
    merge([
      part(box(0.1, 0.11, 0.13), 0xe8e8e8, [0.15, 0.025, 0]),
      part(box(0.02, 0.05, 0.11), GLASS, [0.2, 0.08, 0]),
      part(box(0.36, 0.025, 0.1), 0x3a3a3a, [0.02, 0.02, 0]), // chassis
      ...[[-0.11, -0.06], [0.0, -0.06], [0.15, -0.06], [-0.11, 0.06], [0.0, 0.06], [0.15, 0.06]].map(([x, z]) => part(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 8).rotateX(Math.PI / 2), 0x1b1b1b, [x, 0.026, z])),
    ]),
  /** Truck cargo box: white, tinted per cargo type by the instance colour. */
  truckBox: () => merge([part(box(0.24, 0.13, 0.13), 0xffffff, [-0.05, 0.045, 0])]),
  /** Traffic light pole with an arm (the heads are separate so they can change colour). */
  lightPole: () => merge([part(box(0.025, 0.42, 0.025), 0x3b3f45), part(box(0.16, 0.02, 0.02), 0x3b3f45, [-0.07, 0.4, 0])]),
  /** One signal lamp (coloured per frame). */
  lightHead: () => merge([part(box(0.045, 0.045, 0.045), 0xffffff)]),
  /** Concrete driveway strip, 1 unit long along z (scaled per building). */
  driveway: () => merge([part(box(0.13, 0.012, 1), 0xbdb8ae)]),
  /** Small single garage with a roll-up door facing +z. */
  garage: () => merge([part(box(0.15, 0.12, 0.16), 0xd9d3c7), part(box(0.17, 0.02, 0.18), 0x6d6158, [0, 0.12, 0]), part(box(0.11, 0.09, 0.005), 0xa5a9ad, [0, 0, 0.081])]),
  /** Industrial loading apron with a dock door, along +z. */
  loadingDock: () => merge([part(box(0.3, 0.012, 0.22), 0x9c9890), part(box(0.18, 0.012, 0.03), 0xf2c14e, [0, 0.012, 0.09])]),
};

/** Cargo colours for truck boxes (goods.ts types). */
export const CARGO_COLORS: Record<string, number> = { goods: 0x5b8def, food: 0x6cc551, lumber: 0xb07a45, stone: 0xa9a9a9, oil: 0x2b2b2b, coal: 0x4a4038, residents: 0xffffff };

const centre = (i: number, tiles: Tile[], out: THREE.Vector3) =>
  out.set((i % GRID_SIZE) + 0.5, tiles[i].water ? BRIDGE_Y + 0.02 : 0.04, Math.floor(i / GRID_SIZE) + 0.5);

const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Write a vehicle's world position into `pos` and return its yaw (rotateY angle for a +x model). */
export function vehiclePose(v: Vehicle, tiles: Tile[], pos: THREE.Vector3): number {
  const i0 = v.path[v.seg], i1 = v.path[v.seg + 1];
  const i2 = v.path[v.seg + 2] ?? i1;
  centre(i0, tiles, A);
  centre(i1, tiles, B);
  centre(i2, tiles, C);
  const d1x = B.x - A.x, d1z = B.z - A.z;
  let d2x = C.x - B.x, d2z = C.z - B.z;
  if (d2x === 0 && d2z === 0) { d2x = d1x; d2z = d1z; }
  // Blend from this segment's direction to the next one over the last 40%.
  const b = smooth(0.6, 1.0, v.t) * 0.5; // reach the half-way blend at the tile edge
  const hx = d1x * (1 - b) + d2x * b, hz = d1z * (1 - b) + d2z * b;
  pos.lerpVectors(A, B, v.t);
  // Right-hand lane offset (−dz, dx) of the blended heading.
  const len = Math.hypot(hx, hz) || 1;
  pos.x += (-hz / len) * LANE;
  pos.z += (hx / len) * LANE;
  return Math.atan2(-hz, hx);
}
