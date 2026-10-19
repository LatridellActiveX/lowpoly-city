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
import { surfaceY } from './roads';
import { hash2 } from '../sim/random';
import { RING_LANE_R } from './roundaboutModel';

const LANE = 0.17;
const GLASS = 0x2a3440;
const cyl = (r: number, h: number, seg = 8) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);

export const VEHICLES = {
  /**
   * Car along +x. Body is white so the instance colour paints it; the dark
   * parts (bumpers, grille, glass, mirrors, door lines) stay dark under any colour.
   * V1.6: lower body with a separate hood, belt line and trunk, glass greenhouse with
   * slanted A/C pillars and a B pillar, door cut lines and handles, mirrors, bumpers,
   * grille, headlight pair, exhaust and a side sill.
   */
  car: () => {
    const W = 0xffffff, DARK = 0x2b2e33;
    const p: THREE.BufferGeometry[] = [
      part(box(0.24, 0.045, 0.12), W, [0, 0.025, 0]), // lower body
      part(box(0.08, 0.015, 0.112), W, [0.08, 0.07, 0]), // hood
      part(box(0.07, 0.015, 0.112), W, [-0.085, 0.07, 0]), // trunk deck
      part(box(0.1, 0.015, 0.116), W, [-0.005, 0.07, 0]), // belt line under the glass
      part(box(0.12, 0.05, 0.098), GLASS, [-0.02, 0.085, 0]), // greenhouse glass
      part(box(0.01, 0.054, 0.01), W, [0.045, 0.085, 0.052], [0, 0, 0.55]), part(box(0.01, 0.054, 0.01), W, [0.045, 0.085, -0.052], [0, 0, 0.55]), // A pillars
      part(box(0.01, 0.05, 0.01), W, [-0.02, 0.085, 0.052]), part(box(0.01, 0.05, 0.01), W, [-0.02, 0.085, -0.052]), // B pillars
      part(box(0.01, 0.054, 0.01), W, [-0.085, 0.085, 0.052], [0, 0, -0.55]), part(box(0.01, 0.054, 0.01), W, [-0.085, 0.085, -0.052], [0, 0, -0.55]), // C pillars
      part(box(0.014, 0.022, 0.126), DARK, [0.125, 0.04, 0]), part(box(0.014, 0.022, 0.126), DARK, [-0.125, 0.04, 0]), // bumpers
      part(box(0.004, 0.016, 0.064), DARK, [0.122, 0.055, 0]), // grille
      part(box(0.2, 0.008, 0.124), DARK, [0, 0.016, 0]), // sill / undertray
      part(box(0.02, 0.01, 0.01), DARK, [0.045, 0.092, 0.066]), part(box(0.02, 0.01, 0.01), DARK, [0.045, 0.092, -0.066]), // mirrors
      part(cyl(0.005, 0.016, 6).rotateZ(Math.PI / 2), DARK, [-0.13, 0.02, 0.04]), // exhaust tip
    ];
    for (const s of [-1, 1]) {
      p.push(part(box(0.002, 0.045, 0.002), DARK, [0.03, 0.05, s * 0.061]), part(box(0.002, 0.045, 0.002), DARK, [-0.05, 0.05, s * 0.061])); // door lines
      p.push(part(box(0.014, 0.004, 0.003), 0xc9ced4, [0.01, 0.065, s * 0.062]), part(box(0.014, 0.004, 0.003), 0xc9ced4, [-0.07, 0.065, s * 0.062])); // handles
      p.push(part(box(0.026, 0.02, 0.014), 0xfff3c4, [0.12, 0.045, s * 0.042])); // headlights
    }
    return merge(p);
  },
  /**
   * PR 5 wheel: tyre + alloy rim, five spokes and a hub, so the rotation is
   * visible. Axis along z; the renderer spins it about z by distance/radius.
   */
  wheel: () =>
    merge([
      part(new THREE.CylinderGeometry(0.025, 0.025, 0.022, 14).rotateX(Math.PI / 2), 0x1b1b1b),
      part(new THREE.CylinderGeometry(0.0175, 0.0175, 0.0235, 12).rotateX(Math.PI / 2), 0xc9ced4), // rim
      part(new THREE.CylinderGeometry(0.0065, 0.0065, 0.026, 8).rotateX(Math.PI / 2), 0x8d949c), // hub
      ...[0, 1, 2, 3, 4].map((k) => part(box(0.034, 0.004, 0.025).translate(0, -0.002, 0), 0xe3e6ea, [0, 0, 0], [0, 0, (k * Math.PI) / 5])),
    ]),
  /**
   * PR 5 car roof panel: sits on top of the glass cabin. White geometry so
   * the per-instance colour paints it (roofColor() picks it per car).
   * V1.6: plus a windscreen header, a rear spoiler lip, roof rails and a shark-fin antenna.
   */
  carRoof: () => merge([
    part(box(0.125, 0.014, 0.109), 0xffffff, [-0.02, 0.135, 0]), part(box(0.01, 0.01, 0.1), 0xffffff, [0.045, 0.128, 0], [0, 0, 0.5]),
    part(box(0.01, 0.01, 0.1), 0xffffff, [-0.085, 0.128, 0], [0, 0, -0.5]),
    part(box(0.09, 0.005, 0.005), 0x2b2e33, [-0.02, 0.149, 0.045]), part(box(0.09, 0.005, 0.005), 0x2b2e33, [-0.02, 0.149, -0.045]),
    part(box(0.016, 0.012, 0.004), 0x2b2e33, [-0.06, 0.149, 0]),
  ]),
  /** PR 5 rear light pair (red, coloured per frame: off / tail-light / brake). Car rear is −x. */
  tailLights: () => merge([part(box(0.008, 0.016, 0.026), 0xffffff, [-0.121, 0.045, -0.04]), part(box(0.008, 0.016, 0.026), 0xffffff, [-0.121, 0.045, 0.04]), part(box(0.006, 0.008, 0.05), 0xffffff, [-0.122, 0.06, 0])]),
  /**
   * Truck cab (fixed colours) along +x. V1.6: cab-over cab with a slanted windscreen, side
   * windows, grille, bumper, headlights, mirrors, roof lamp bar, exhaust stacks, fuel tanks,
   * mud flaps, a fifth-wheel plate and chassis rails.
   */
  truckCab: () => {
    const CAB = 0xe8e8e8, DK = 0x2b2e33;
    const p: THREE.BufferGeometry[] = [
      part(box(0.1, 0.11, 0.13), CAB, [0.15, 0.025, 0]),
      part(box(0.02, 0.05, 0.11), GLASS, [0.2, 0.08, 0]),
      part(box(0.01, 0.052, 0.112), GLASS, [0.196, 0.083, 0], [0, 0, 0.2]), // slanted windscreen
      part(box(0.36, 0.025, 0.1), 0x3a3a3a, [0.02, 0.02, 0]), // chassis
      part(box(0.1, 0.012, 0.134), 0xcfd2d6, [0.15, 0.135, 0]), // roof cap
      part(box(0.03, 0.01, 0.1), 0xf2a12e, [0.16, 0.147, 0]), // roof lamp bar
      part(box(0.006, 0.04, 0.09), DK, [0.2, 0.035, 0]), // grille
      part(box(0.016, 0.022, 0.138), DK, [0.208, 0.022, 0]), // bumper
      part(box(0.28, 0.012, 0.012), 0x55595e, [0.02, 0.015, 0.05]), part(box(0.28, 0.012, 0.012), 0x55595e, [0.02, 0.015, -0.05]), // chassis rails
      part(box(0.08, 0.008, 0.1), 0x6d757b, [0.0, 0.045, 0]), // fifth-wheel plate
    ];
    for (const s of [-1, 1]) {
      p.push(part(box(0.05, 0.04, 0.004), GLASS, [0.15, 0.085, s * 0.066])); // side window
      p.push(part(box(0.002, 0.1, 0.004), DK, [0.125, 0.03, s * 0.066])); // door line
      p.push(part(box(0.008, 0.016, 0.026), 0xfff3c4, [0.206, 0.04, s * 0.05])); // headlights
      p.push(part(box(0.012, 0.045, 0.012), DK, [0.19, 0.09, s * 0.076])); // mirror arms
      p.push(part(cyl(0.006, 0.12, 6), 0x9aa0a6, [0.098, 0.04, s * 0.06])); // exhaust stacks
      p.push(part(new THREE.CylinderGeometry(0.022, 0.022, 0.07, 10).rotateZ(Math.PI / 2), 0xb8bec4, [0.06, 0.03, s * 0.065])); // fuel tank
      p.push(part(box(0.002, 0.026, 0.022), DK, [-0.11, 0.0, s * 0.06])); // mud flap
    }
    return merge(p);
  },
  /**
   * V1.5b stage B: TANKER body (oil, fuel, plastics, chemicals) — a horizontal
   * cylinder with end caps, a top walkway + hatches, a rear valve cabinet and
   * hazard placard. White-ish so the instance colour can tint it (fuel = red, …).
   */
  tankerBody: () =>
    merge([
      part(new THREE.CylinderGeometry(0.06, 0.06, 0.25, 12).rotateZ(Math.PI / 2), 0xffffff, [-0.05, 0.11, 0]),
      part(new THREE.SphereGeometry(0.06, 10, 6).scale(0.35, 1, 1), 0xd8d8d8, [0.075, 0.11, 0]),
      part(new THREE.SphereGeometry(0.06, 10, 6).scale(0.35, 1, 1), 0xd8d8d8, [-0.175, 0.11, 0]),
      part(box(0.2, 0.008, 0.03), 0x8a8f96, [-0.05, 0.17, 0]),
      part(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 8), 0x6d757b, [-0.1, 0.17, 0]),
      part(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 8), 0x6d757b, [0, 0.17, 0]),
      part(box(0.03, 0.04, 0.1), 0x6d757b, [-0.19, 0.04, 0]),
      part(box(0.004, 0.03, 0.03), 0xf2a12e, [-0.202, 0.1, 0]),
    ]),
  /**
   * V1.5b stage B: DUMP truck body (quarry stone, coal) — a tapered steel
   * tipper bed with a cab-shield lip and a heap of the load showing on top.
   */
  dumpBody: () =>
    merge([
      part(box(0.24, 0.09, 0.13), 0xd29b2a, [-0.05, 0.045, 0]),
      part(box(0.04, 0.03, 0.13), 0xb27f1d, [0.085, 0.135, 0]),
      part(box(0.24, 0.012, 0.004), 0x8a6a1a, [-0.05, 0.09, 0.066]),
      part(box(0.24, 0.012, 0.004), 0x8a6a1a, [-0.05, 0.09, -0.066]),
      part(new THREE.ConeGeometry(0.06, 0.05, 6).scale(1.8, 1, 1), 0xffffff, [-0.05, 0.15, 0]),
    ]),
  /** Truck cargo box: white, tinted per cargo type by the instance colour. */
  truckBox: () => merge([
    part(box(0.24, 0.13, 0.13), 0xffffff, [-0.05, 0.045, 0]),
    ...[-0.14, -0.1, -0.06, -0.02, 0.02].flatMap((x) => [part(box(0.006, 0.12, 0.002), 0xe2e2e2, [x, 0.05, 0.066]), part(box(0.006, 0.12, 0.002), 0xe2e2e2, [x, 0.05, -0.066])]), // side ribs
    part(box(0.24, 0.012, 0.134), 0xd0d0d0, [-0.05, 0.175, 0]), // roof cap
    part(box(0.004, 0.11, 0.002), 0x3a3a3a, [-0.171, 0.055, 0]), // rear door seam
    part(box(0.012, 0.016, 0.13), 0x3a3a3a, [-0.172, 0.02, 0]), // rear bumper
    part(box(0.24, 0.012, 0.134), 0x3a3a3a, [-0.05, 0.03, 0]), // skirt
  ]),
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
      part(new THREE.CylinderGeometry(0.008, 0.012, 0.3, 8).rotateZ(Math.PI / 2).translate(0.15, 0, 0), DARKP, [0, 0.5, 0]),
      part(new THREE.CylinderGeometry(0.005, 0.005, 0.16, 6).rotateZ(Math.PI / 2 - 0.45).translate(0.072, 0, 0), DARKP, [0, 0.465, 0]),
      // Pedestrian push-button box and a little street-name sign on the arm.
      part(box(0.02, 0.03, 0.014), YEL, [0, 0.14, 0.02]),
      part(box(0.1, 0.028, 0.004), 0x1f7a3d, [0.12, 0.525, 0]),
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
    // PR 5 fix: ONE head per pole, hanging from the arm over the approach
    // lane and facing −z, i.e. back up the road at the oncoming drivers.
    // (The old pole had a second side head facing −x, which on two of the
    // four corners pointed away from the traffic it was showing.)
    head(0.26, 0.49, 0, 'z');
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
  SIGNAL_LAMPS.push({ head: 'arm', slot, pos: new THREE.Vector3(0.26, 0.49 - 0.03 - slot * 0.042, -0.024) });
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

// V1.5 true 4-lane avenues: two lanes each way. Lane centres sit between
// the markings (median ±0.025, lane dash ±0.24, edge line ±0.36): kerb
// lane 0 at 0.30, median lane 1 at 0.13. v.laneX (0..1) slides between
// them during a lane change, so the car drifts across smoothly.
const LANE_OUTER = 0.30, LANE_INNER = 0.13;
let LANE_AVENUE = LANE_OUTER; // set per vehicle in routePoint
const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const dirIdx = (a: number, b: number) => { const d = b - a; return d === 1 ? 0 : d === -1 ? 1 : d === GRID_SIZE ? 2 : 3; };

/** Pose output: position + yaw + body roll/pitch (radians) + speed for wheel spin. */
export interface Pose { yaw: number; roll: number; pitch: number }

const P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), P2 = new THREE.Vector3(), P3 = new THREE.Vector3();

/** Evaluate a vehicle's spot on its route at (seg, t); writes pos, returns heading (dx, dz) via out. */
function routePoint(v: Vehicle, tiles: Tile[], seg: number, t: number, pos: THREE.Vector3, head: { x: number; z: number }): void {
  const path = v.path;
  LANE_AVENUE = LANE_OUTER - (LANE_OUTER - LANE_INNER) * (v.laneX ?? 0);
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
  // V1.6: between two ring tiles the car follows a true circle round the island (a quarter-circle Bézier needs handles of 0.552·r).
  const prevT = tiles[t >= 0.5 ? path[seg] : path[seg - 1] ?? tile], nextR = tiles[t >= 0.5 ? path[seg + 2] ?? tile : path[seg + 1]];
  const onRing = T.roadType === 2 && prevT?.roadType === 2 && nextR?.roadType === 2 && din !== dout;
  const h = onRing ? 0.552 * RING_LANE_R : din === dout ? 0.33 : uturn ? 0.45 : 0.28;
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
  // Height (PR 5 bridge rebuild): sample the actual driving surface under
  // the car — flat road, bridge deck, or the slope of an approach ramp — so
  // wheels follow the ramp exactly and ride on the raised deck.
  pos.y = surfaceY(tiles, GRID_SIZE, pos.x, pos.z);
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
    // PR 5: tilt with the road on bridge ramps. Pitch is a rotation about the
    // car's local z, and a positive angle lifts local +x (the nose), so a
    // climb (Q higher than pos) gives a positive pitch.
    const run = Math.hypot(Q.x - pos.x, Q.z - pos.z);
    if (run > 1e-4) out.pitch += Math.atan2(Q.y - pos.y, run);
  }
  return yaw;
}
