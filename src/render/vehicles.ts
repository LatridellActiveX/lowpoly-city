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
import { hash2 } from '../sim/random';

const LANE = 0.17;
const GLASS = 0x2a3440;

export const VEHICLES = {
  /** Car along +x. Body is white so the instance colour paints it. */
  car: () =>
    merge([
      part(box(0.24, 0.06, 0.12), 0xffffff, [0, 0.025, 0]),
      part(box(0.12, 0.05, 0.105), GLASS, [-0.02, 0.085, 0]),
      part(box(0.02, 0.02, 0.1), 0xfff3c4, [0.12, 0.045, 0]), // headlights
      // (PR 5: wheels are a separate instanced pool so they can spin — see WHEELS.)
    ]),
  /**
   * PR 5 wheel: tyre + a light hub bar across it, so the rotation is
   * visible. Axis along z; the renderer spins it about z by distance/radius.
   */
  wheel: () =>
    merge([
      part(new THREE.CylinderGeometry(0.025, 0.025, 0.022, 10).rotateX(Math.PI / 2), 0x1b1b1b),
      part(box(0.03, 0.008, 0.024).translate(0, -0.004, 0), 0xb9bec4),
    ]),
  /**
   * PR 5 car roof panel: sits on top of the glass cabin. White geometry so
   * the per-instance colour paints it (roofColor() picks it per car).
   */
  carRoof: () => merge([part(box(0.125, 0.014, 0.109), 0xffffff, [-0.02, 0.135, 0]), part(box(0.01, 0.01, 0.1), 0xffffff, [0.045, 0.128, 0], [0, 0, 0.5])]),
  /** PR 5 rear light pair (red, coloured per frame: off / tail-light / brake). Car rear is −x. */
  tailLights: () => merge([part(box(0.008, 0.016, 0.026), 0xffffff, [-0.121, 0.045, -0.04]), part(box(0.008, 0.016, 0.026), 0xffffff, [-0.121, 0.045, 0.04])]),
  /** Truck cab (fixed colours) along +x. */
  truckCab: () =>
    merge([
      part(box(0.1, 0.11, 0.13), 0xe8e8e8, [0.15, 0.025, 0]),
      part(box(0.02, 0.05, 0.11), GLASS, [0.2, 0.08, 0]),
      part(box(0.36, 0.025, 0.1), 0x3a3a3a, [0.02, 0.02, 0]), // chassis
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

/** PR 5: wheel hub positions (vehicle-local, +x forward) and radius. */
export const WHEELS = {
  car: [[-0.08, -0.055], [0.08, -0.055], [-0.08, 0.055], [0.08, 0.055]] as Array<[number, number]>,
  truck: [[-0.11, -0.06], [0.0, -0.06], [0.15, -0.06], [-0.11, 0.06], [0.0, 0.06], [0.15, 0.06]] as Array<[number, number]>,
  radius: 0.025,
};

/**
 * PR 5: seeded roof colour for a car, separate from its body. Mix:
 * 35% same as the body, 25% white, 20% black (two-tone "contrast" roofs),
 * 20% from a varied palette. Deterministic: depends only on the vehicle id.
 */
const ROOF_PALETTE = [0xc0392b, 0x2e86de, 0xf1c40f, 0x27ae60, 0x8e44ad, 0xe67e22, 0x95a5a6, 0x1abc9c];
export function roofColor(id: number, body: number): number {
  const r = hash2(id, 3, 9100);
  if (r < 0.35) return body;
  if (r < 0.6) return 0xf4f4f4;
  if (r < 0.8) return 0x1e1f22;
  return ROOF_PALETTE[Math.floor(hash2(id, 4, 9100) * ROOF_PALETTE.length)];
}

/** Cargo colours for truck boxes (goods.ts types). */
export const CARGO_COLORS: Record<string, number> = { goods: 0x5b8def, food: 0x6cc551, lumber: 0xb07a45, stone: 0xa9a9a9, oil: 0x2b2b2b, coal: 0x4a4038, residents: 0xffffff };

// ---------------------------------------------------------------------------
// PR 5 SMOOTH DRIVING PATHS
// ---------------------------------------------------------------------------
// The sim says "vehicle is on segment k (tile centre A → tile centre B) at
// progress t". Instead of sliding along the line between centres, we think
// of the trip TILE BY TILE: a vehicle crosses each tile from the middle of
// the edge it entered by to the middle of the edge it leaves by, always in
// its RIGHT-HAND lane. Within a tile the path is a CUBIC BÉZIER curve:
//     P0 = entry point (edge middle + right-hand lane offset)
//     P1 = P0 pushed forward along the entry heading
//     P2 = P3 pulled back along the exit heading
//     P3 = exit point
// Straight on → a straight line. A turn → a smooth quarter curve (tighter
// for right turns, wider for left turns, because the lane offsets differ).
// A dead-end U-turn → a smooth hairpin. Consecutive tiles share their edge
// points AND headings, so the whole route is one continuous, kink-free
// curve: no 90° snapping. The heading is the curve's derivative.
// Lane offset blends from the entry road type to the exit road type, so
// turning from a street onto an avenue drifts smoothly into the wider lane.

const LANE_AVENUE = 0.24;
const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const dirIdx = (a: number, b: number) => { const d = b - a; return d === 1 ? 0 : d === -1 ? 1 : d === GRID_SIZE ? 2 : 3; };
const groundY = (t: Tile) => (t.water ? BRIDGE_Y + 0.02 : 0.04);

/** Pose output: position + yaw + body roll/pitch (radians) + speed for wheel spin. */
export interface Pose { yaw: number; roll: number; pitch: number }

const P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), P2 = new THREE.Vector3(), P3 = new THREE.Vector3();

/** Evaluate a vehicle's spot on its route at (seg, t); writes pos, returns heading (dx, dz) via out. */
function routePoint(v: Vehicle, tiles: Tile[], seg: number, t: number, pos: THREE.Vector3, head: { x: number; z: number }): void {
  const path = v.path;
  // Which tile are we crossing, and how far through it (u = 0..1)?
  let tile: number, u: number, din: number, dout: number;
  if (t >= 0.5) {
    tile = path[seg + 1];
    u = t - 0.5;
    din = dirIdx(path[seg], path[seg + 1]);
    dout = seg + 2 < path.length ? dirIdx(path[seg + 1], path[seg + 2]) : din;
  } else {
    tile = path[seg];
    u = t + 0.5;
    dout = dirIdx(path[seg], path[seg + 1]);
    din = seg > 0 ? dirIdx(path[seg - 1], path[seg]) : dout;
  }
  const T = tiles[tile];
  const cx = (tile % GRID_SIZE) + 0.5, cz = Math.floor(tile / GRID_SIZE) + 0.5;
  const [ix, iz] = DIRS[din], [ox, oz] = DIRS[dout];
  // Lane offset for this tile's road type (blend with neighbours via the edge points).
  const laneIn = (seg > 0 || t >= 0.5) && tiles[t >= 0.5 ? path[seg] : path[seg - 1] ?? tile]?.roadType === 1 && T.roadType === 1 ? LANE_AVENUE : T.roadType === 1 ? (LANE + LANE_AVENUE) / 2 : LANE;
  const nextT = tiles[t >= 0.5 ? path[seg + 2] ?? tile : path[seg + 1]];
  const laneOut = nextT?.roadType === 1 && T.roadType === 1 ? LANE_AVENUE : T.roadType === 1 ? (LANE + LANE_AVENUE) / 2 : LANE;
  const wob = v.traits?.wobble ?? 0;
  // Right of heading (dx, dz) is (−dz, dx).
  P0.set(cx - ix * 0.5 - iz * (laneIn + wob), 0, cz - iz * 0.5 + ix * (laneIn + wob));
  P3.set(cx + ox * 0.5 - oz * (laneOut + wob), 0, cz + oz * 0.5 + ox * (laneOut + wob));
  const uturn = din !== dout && (din >> 1) === (dout >> 1);
  const h = din === dout ? 0.33 : uturn ? 0.45 : 0.28;
  P1.set(P0.x + ix * h, 0, P0.z + iz * h);
  P2.set(P3.x - ox * h, 0, P3.z - oz * h);
  // Cubic Bézier B(u) and its derivative B'(u).
  const m = 1 - u;
  const b0 = m * m * m, b1 = 3 * m * m * u, b2 = 3 * m * u * u, b3 = u * u * u;
  pos.set(P0.x * b0 + P1.x * b1 + P2.x * b2 + P3.x * b3, 0, P0.z * b0 + P1.z * b1 + P2.z * b2 + P3.z * b3);
  const d0 = 3 * m * m, d1 = 6 * m * u, d2 = 3 * u * u;
  head.x = (P1.x - P0.x) * d0 + (P2.x - P1.x) * d1 + (P3.x - P2.x) * d2;
  head.z = (P1.z - P0.z) * d0 + (P2.z - P1.z) * d1 + (P3.z - P2.z) * d2;
  if (Math.abs(head.x) + Math.abs(head.z) < 1e-6) { head.x = ix; head.z = iz; }
  // Height: blend between this tile's deck/road height and the next tile's (bridge ramps).
  const yA = groundY(tiles[path[seg]]), yB = groundY(tiles[path[seg + 1]]);
  pos.y = yA + (yB - yA) * Math.min(1, Math.max(0, (t - 0.3) / 0.4));
}

const H1 = { x: 0, z: 0 }, H2 = { x: 0, z: 0 };
const Q = new THREE.Vector3();

/**
 * Write a vehicle's world position into `pos` and its pose into `out`.
 * Roll leans the body OUT of a turn in proportion to v²·curvature (we
 * measure the heading change a short way ahead); pitch noses the body down
 * under braking and up under acceleration. Both are small and clamped.
 */
export function vehiclePose(v: Vehicle, tiles: Tile[], pos: THREE.Vector3, out?: Pose): number {
  routePoint(v, tiles, v.seg, v.t, pos, H1);
  const yaw = Math.atan2(-H1.z, H1.x);
  if (out) {
    out.yaw = yaw;
    // Heading a little further along (same segment math, clamped to the route).
    let t2 = v.t + 0.08, s2 = v.seg;
    if (t2 >= 1 && s2 + 2 < v.path.length) { t2 -= 1; s2++; } else t2 = Math.min(t2, 0.999);
    routePoint(v, tiles, s2, t2, Q, H2);
    let dy = Math.atan2(-H2.z, H2.x) - yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const curvature = dy / 0.08; // radians per tile
    const speed = v.v ?? 1;
    out.roll = Math.max(-0.12, Math.min(0.12, -curvature * speed * speed * 0.02));
    out.pitch = Math.max(-0.07, Math.min(0.07, -(v.acc ?? 0) * 0.025));
  }
  return yaw;
}
