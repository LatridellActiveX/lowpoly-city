/**
 * render/powerLines.ts — realistic-ish overhead power lines.
 *
 * WHAT IT LOOKS LIKE
 * ------------------
 *   - Wooden POLES with a crossarm, two glass insulators and a diagonal brace.
 *   - Between neighbouring poles, two wires that SAG in the middle (a
 *     "catenary"; we use a parabola, which looks the same at this scale).
 *   - From the nearest pole, a thin DROP WIRE to the front of every powered
 *     building, the way a real house is fed from the street.
 *
 * WHERE THE POLES GO (the important bit)
 * --------------------------------------
 * Poles stand on the STREET EDGE, in front of houses, never behind them:
 *   - A power line laid over a ROAD tile puts its pole on the curb. For an
 *     east-west road the curb is the north or south edge; we pick the side
 *     that has buildings/zones (south if both), so the pole is in the front
 *     yard of the houses it feeds. North-south roads work the same with
 *     east/west curbs.
 *   - A line tile that is NOT a road but touches one leans its pole toward that
 *     road (the street edge of the tile).
 *   - A line out in the countryside, nowhere near a road, keeps its pole in
 *     the middle of the tile (a cross-country line).
 * Buildings also prefer to FACE a road that carries a power line (see
 * cityRenderer.roadFacing), so the drop wire comes in at the front door.
 *
 * Everything here is geometry + maths; cityRenderer.ts owns the instance
 * pools and calls these helpers during its rebuild.
 */
import * as THREE from 'three';
import { idx, inBounds } from '../sim/grid';
import { Tile } from '../sim/types';
import { box, merge, part } from './models';

/** Height (y) at which the wires leave the insulators. */
export const WIRE_Y = 0.775;
/** Half the spacing between the two wires (they hang off the crossarm ends). */
export const WIRE_HALF = 0.1;
/** How far from the tile centre a curb pole stands (0.5 = the tile edge). */
const CURB = 0.43;

const WOOD = 0x6e4f33;
const GLASS = 0xa8d5c2;
const STEEL = 0x7d8288;

/** Pole model. The crossarm runs along local z, so wires leave along local x. */
export function poleGeometry(): THREE.BufferGeometry {
  return merge([
    // Tapered wooden pole.
    part(new THREE.CylinderGeometry(0.017, 0.024, 0.82, 6).translate(0, 0.41, 0), WOOD),
    // Crossarm near the top.
    part(box(0.028, 0.026, 0.27), WOOD, [0, 0.72, 0]),
    // Diagonal braces from pole to crossarm (rotated about x).
    part(box(0.01, 0.12, 0.01), STEEL, [0, 0.64, 0.045], [-0.75, 0, 0]),
    part(box(0.01, 0.12, 0.01), STEEL, [0, 0.64, -0.045], [0.75, 0, 0]),
    // Two pin insulators the wires sit on.
    part(new THREE.CylinderGeometry(0.009, 0.014, 0.03, 6).translate(0, 0.015, 0), GLASS, [0, 0.746, WIRE_HALF]),
    part(new THREE.CylinderGeometry(0.009, 0.014, 0.03, 6).translate(0, 0.015, 0), GLASS, [0, 0.746, -WIRE_HALF]),
    // Little pole-top cap.
    part(new THREE.ConeGeometry(0.02, 0.02, 6).translate(0, 0.83, 0), 0x4e3a28),
  ]);
}

/**
 * A sagging cable from (0,0,0) to (1,0,0). Points are sampled from the
 * parabola y = -4·sag·t·(1−t), which is 0 at both ends and −sag in the
 * middle. A thin tube is swept along those points.
 */
function sagCable(sag: number, offsetZ = 0, radius = 0.0045): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    pts.push(new THREE.Vector3(t, -4 * sag * t * (1 - t), offsetZ));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, radius, 3, false);
}

/** Two parallel sagging wires spanning one unit along +x (scaled per span). */
export function spanGeometry(): THREE.BufferGeometry {
  return merge([part(sagCable(0.07, WIRE_HALF), 0x26282b), part(sagCable(0.07, -WIRE_HALF), 0x26282b)]);
}

/** A single thinner wire with a gentle sag, for pole-to-house drops. */
export function dropGeometry(): THREE.BufferGeometry {
  return merge([part(sagCable(0.035, 0, 0.0032), 0x2e3033)]);
}

/** Result of the pole layout for one line tile. */
export interface PoleSpot {
  /** World position of the pole base. */
  pos: THREE.Vector3;
  /** Rotation around y. 0 = crossarm along z (wires heading east-west). */
  rotY: number;
}

type Has = (x: number, z: number, f: (t: Tile) => boolean) => boolean;
/** "Something a pole should stand in front of": a zone lot or a utility building. */
const isFrontage = (n: Tile) => n.zone !== null || (n.structure !== 'none' && !n.road);

/** Where to put the pole for the power line on tile (x, z). */
export function poleSpot(tiles: Tile[], x: number, z: number): PoleSpot {
  const has: Has = (a, b, f) => inBounds(a, b) && f(tiles[idx(a, b)]);
  const t = tiles[idx(x, z)];
  const pos = new THREE.Vector3(x + 0.5, 0, z + 0.5);

  // Crossarm orientation: perpendicular to the direction the line runs.
  const lineEW = has(x - 1, z, (n) => n.powerLine) || has(x + 1, z, (n) => n.powerLine);
  const lineNS = has(x, z - 1, (n) => n.powerLine) || has(x, z + 1, (n) => n.powerLine);
  const rotY = lineNS && !lineEW ? Math.PI / 2 : 0;

  if (t.road) {
    const roadEW = has(x - 1, z, (n) => n.road) || has(x + 1, z, (n) => n.road);
    const roadNS = has(x, z - 1, (n) => n.road) || has(x, z + 1, (n) => n.road);
    if (roadEW && !roadNS) {
      // East-west street: pick the north or south curb, whichever has houses (south wins ties).
      const south = has(x, z + 1, isFrontage) || !has(x, z - 1, isFrontage);
      pos.z += south ? CURB : -CURB;
    } else if (roadNS && !roadEW) {
      const east = has(x + 1, z, isFrontage) || !has(x - 1, z, isFrontage);
      pos.x += east ? CURB : -CURB;
    } else {
      // Junction or lone tile: stand on the corner so we don't block the crossing.
      pos.x += CURB;
      pos.z += CURB;
    }
    return { pos, rotY };
  }
  // Not a road: lean toward a neighbouring road if there is one (street edge).
  for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    if (has(x + dx, z + dz, (n) => n.road)) {
      pos.x += dx * CURB;
      pos.z += dz * CURB;
      break;
    }
  }
  return { pos, rotY };
}

const _yaw = new THREE.Quaternion();
const _pitch = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);

/**
 * Matrix that stretches a unit cable (0,0,0)->(1,0,0) so it runs from `a` to `b`.
 * We turn it in two steps instead of one "shortest rotation", so the sag
 * always points DOWN (a single shortest-arc rotation can flip it upside down
 * for cables that point along −x):
 *   yaw   around y:  atan2(−dz, dx)   (rotateY(θ) maps +x to (cosθ, 0, −sinθ))
 *   pitch around z:  atan2(dy, horizontal length)
 */
export function cableMatrix(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const horiz = Math.hypot(dx, dz);
  _yaw.setFromAxisAngle(UP, Math.atan2(-dz, dx));
  _pitch.setFromAxisAngle(FWD, Math.atan2(dy, horiz));
  _q.copy(_yaw).multiply(_pitch);
  return out.compose(a, _q, _s.set(Math.hypot(horiz, dy), 1, 1));
}

/**
 * Street lamp parts (PR 3), mounted on curb-side poles of power lines that run
 * along a road. Model space: the arm points along +x (toward the middle of
 * the road); the renderer turns it with lampYaw().
 */
export const LAMP_REACH = 0.2;
export function lampArmGeometry(): THREE.BufferGeometry {
  return merge([
    part(box(LAMP_REACH, 0.014, 0.014).translate(LAMP_REACH / 2, 0, 0), STEEL, [0, 0.62, 0]),
    part(box(0.012, 0.05, 0.012), STEEL, [0.03, 0.575, 0], [0, 0, -0.7]), // small brace
    part(box(0.07, 0.022, 0.045), 0x3a3d42, [LAMP_REACH, 0.605, 0]), // lamp head
  ]);
}
/** The bulb under the lamp head: glows at night. */
export function lampBulbGeometry(): THREE.BufferGeometry {
  return merge([part(box(0.05, 0.012, 0.032), 0xffffff, [LAMP_REACH, 0.595, 0])]);
}
/** A soft pool of light on the road under the lamp (additive disc). */
export function lampPoolGeometry(): THREE.BufferGeometry {
  return merge([part(new THREE.CircleGeometry(0.26, 16).rotateX(-Math.PI / 2), 0xffffff, [LAMP_REACH, 0.05, 0])]);
}
/** Yaw that points a lamp at (x,z)'s tile centre from a pole at `pos`, or null if the pole is centred. */
export function lampYaw(pos: THREE.Vector3, x: number, z: number): number | null {
  const dx = x + 0.5 - pos.x, dz = z + 0.5 - pos.z;
  if (Math.hypot(dx, dz) < 0.05) return null;
  return Math.atan2(-dz, dx);
}
