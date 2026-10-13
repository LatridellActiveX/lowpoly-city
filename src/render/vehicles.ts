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
  /**
   * PR 5 traffic signal pole (replaces PR 4's stick + cube). Local frame:
   * the pole stands at the origin, the MAST ARM reaches along +x over the
   * road and carries one signal head facing −z; a second head is bolted to
   * the pole itself facing −x. Each head is a dark housing with a back plate
   * and three hooded lamp openings (red top, amber middle, green bottom).
   * The lamps themselves are a separate instanced pool (signalLamp) so each
   * can be lit or dark every frame — see SIGNAL_LAMPS for their positions.
   */
  lightPole: () => {
    const DARKP = 0x2e3238, HOUSING = 0x22262b, PLATE = 0x111316, YEL = 0xc9a227;
    const p: THREE.BufferGeometry[] = [
      part(new THREE.CylinderGeometry(0.035, 0.04, 0.03, 10).translate(0, 0.015, 0), 0x8b8f94), // concrete footing
      part(new THREE.CylinderGeometry(0.016, 0.021, 0.54, 10).translate(0, 0.27, 0), DARKP), // tapered pole
      part(new THREE.SphereGeometry(0.018, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), DARKP, [0, 0.54, 0]), // pole cap
      // Mast arm: a slim tube along +x plus a diagonal brace for strength.
      part(new THREE.CylinderGeometry(0.008, 0.012, 0.42, 8).rotateZ(Math.PI / 2).translate(0.21, 0, 0), DARKP, [0, 0.5, 0]),
      part(new THREE.CylinderGeometry(0.005, 0.005, 0.16, 6).rotateZ(Math.PI / 2 - 0.45).translate(0.072, 0, 0), DARKP, [0, 0.465, 0]),
      // Pedestrian push-button box and a little street-name sign on the arm.
      part(box(0.02, 0.03, 0.014), YEL, [0, 0.14, 0.02]),
      part(box(0.12, 0.028, 0.004), 0x1f7a3d, [0.15, 0.525, 0]),
    ];
    // Signal head: housing + back plate + three visors over the lamp openings.
    const head = (cx: number, cy: number, cz: number, facing: 'z' | 'x') => {
      const rot: [number, number, number] = facing === 'z' ? [0, 0, 0] : [0, Math.PI / 2, 0];
      const at = (lx: number, ly: number, lz: number): [number, number, number] =>
        facing === 'z' ? [cx + lx, cy + ly, cz + lz] : [cx + lz, cy + ly, cz - lx];
      p.push(part(box(0.05, 0.15, 0.04), HOUSING, at(0, -0.075, 0), rot));
      p.push(part(box(0.075, 0.175, 0.006), PLATE, at(0, -0.0875, 0.023), rot)); // back plate (behind the lamps)
      p.push(part(box(0.075, 0.006, 0.006), YEL, at(0, -0.0875 - 0.0005, 0.0265), rot)); // reflective border hint
      for (let k = 0; k < 3; k++) {
        // Visor: a short hood over each lamp, sticking out toward the driver.
        p.push(part(new THREE.CylinderGeometry(0.017, 0.017, 0.025, 8, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), HOUSING, at(0, -0.03 - k * 0.042, -0.032), rot));
      }
      p.push(part(box(0.012, 0.03, 0.012), DARKP, at(0, 0, 0), rot)); // bracket
    };
    head(0.36, 0.49, 0, 'z'); // on the arm, facing −z
    head(-0.04, 0.4, 0, 'x'); // on the pole, facing −x
    return merge(p);
  },
  /** One signal lamp lens (coloured + lit per frame by the renderer). */
  lightHead: () => merge([part(new THREE.SphereGeometry(0.014, 10, 6), 0xffffff)]),
  /** Concrete driveway strip, 1 unit long along z (scaled per building). */
  driveway: () => merge([part(box(0.13, 0.012, 1), 0xbdb8ae)]),
  /** Small single garage with a roll-up door facing +z. */
  garage: () => merge([part(box(0.15, 0.12, 0.16), 0xd9d3c7), part(box(0.17, 0.02, 0.18), 0x6d6158, [0, 0.12, 0]), part(box(0.11, 0.09, 0.005), 0xa5a9ad, [0, 0, 0.081])]),
  /** Industrial loading apron with a dock door, along +z. */
  loadingDock: () => merge([part(box(0.3, 0.012, 0.22), 0x9c9890), part(box(0.18, 0.012, 0.03), 0xf2c14e, [0, 0.012, 0.09])]),
};

/**
 * PR 5: lamp lens positions in the lightPole's local frame. `head` says which
 * head the lamp is in ('arm' faces −z = traffic on the arm's road axis,
 * 'pole' faces −x), `slot` 0 = red, 1 = amber, 2 = green.
 */
export const SIGNAL_LAMPS: Array<{ head: 'arm' | 'pole'; slot: 0 | 1 | 2; pos: THREE.Vector3 }> = [];
for (const slot of [0, 1, 2] as const) {
  SIGNAL_LAMPS.push({ head: 'arm', slot, pos: new THREE.Vector3(0.36, 0.49 - 0.03 - slot * 0.042, -0.024) });
  SIGNAL_LAMPS.push({ head: 'pole', slot, pos: new THREE.Vector3(-0.04 - 0.024, 0.4 - 0.03 - slot * 0.042, 0) });
}
/** Lit lamp colours (red, amber, green) — dark lamps are drawn at ~12%. */
export const SIGNAL_COLORS = [0xff3b30, 0xffb020, 0x35e06a];

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
  // PR 5: each driver sits slightly off the lane centre (traits.wobble).
  const lane = LANE + (v.traits?.wobble ?? 0);
  pos.x += (-hz / len) * lane;
  pos.z += (hx / len) * lane;
  return Math.atan2(-hz, hx);
}
