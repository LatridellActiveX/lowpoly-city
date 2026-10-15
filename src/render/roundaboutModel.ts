/**
 * render/roundaboutModel.ts — V1.6: the 2×2 ROUNDABOUT's models.
 *
 *  ringIsland   the landscaped central island (authored around the block centre, scale 1):
 *               a cobbled truck apron, a ring of kerb stones, a lawn with a bed of flowers,
 *               hedge bushes and a big tree, and four yellow/black chevron boards that face
 *               the four entries (so the island is NOT rotated when placed).
 *  ringArrow    a white painted arrow lying on the ring road (model +x = direction of travel);
 *               one per ring tile, laid along the counter-clockwise lane.
 *  ringYield    "give way" markings for ONE entry (authored for the tile's NORTH edge, where a
 *               car heading south enters in the west half): a row of white triangles, a dashed
 *               line and a roundabout sign (blue disc with three white arrows) on a pole.
 *
 * Asphalt top is y = 0.04, paint sits at 0.04–0.05 (same as roads.ts).
 */
import * as THREE from 'three';
import { box, merge, part } from './models';

const PAINT = 0xf4f4f4;

/** Radius (from the block centre) of the lane cars follow around the island. */
export const RING_LANE_R = 0.67;

export function ringIslandModel(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [];
  // Cobbled truck apron + stepped kerb.
  p.push(part(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 32).translate(0, 0.025, 0), 0xcfc9bd));
  for (let k = 0; k < 16; k++) { // cobble rings in two shades
    const a = (k / 16) * Math.PI * 2;
    p.push(part(box(0.09, 0.014, 0.05), k % 2 ? 0xbdb6a8 : 0xd8d2c6, [Math.cos(a) * 0.475, 0.05, Math.sin(a) * 0.475], [0, -a, 0]));
  }
  // Kerb stones around the lawn.
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    p.push(part(box(0.075, 0.03, 0.03), k % 2 ? 0xe9e6df : 0xc9c6bf, [Math.cos(a) * 0.435, 0.05, Math.sin(a) * 0.435], [0, -a, 0]));
  }
  p.push(part(new THREE.CylinderGeometry(0.42, 0.43, 0.04, 32).translate(0, 0.045, 0), 0x6fb54f)); // lawn
  p.push(part(new THREE.CylinderGeometry(0.3, 0.38, 0.05, 20).translate(0, 0.05, 0), 0x5fa545)); // raised mound
  // Flower beds: three clusters of coloured blooms on a soil ring.
  p.push(part(new THREE.CylinderGeometry(0.25, 0.25, 0.012, 20).translate(0, 0.098, 0), 0x6b4a2b));
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2 + 0.2, r = 0.2 + (k % 2) * 0.03;
    p.push(part(new THREE.IcosahedronGeometry(0.022, 0).translate(0, 0.02, 0), [0xe84a5f, 0xffd166, 0xf8f8ff, 0xb06be0][k % 4], [Math.cos(a) * r, 0.1, Math.sin(a) * r]));
    p.push(part(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 4).translate(0, 0.01, 0), 0x3f8f3a, [Math.cos(a) * r, 0.1, Math.sin(a) * r]));
  }
  // Hedge bushes around the mound.
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.3;
    p.push(part(new THREE.IcosahedronGeometry(0.05, 0).translate(0, 0.045, 0), k % 3 ? 0x3f8f3a : 0x4f9e45, [Math.cos(a) * 0.33, 0.09, Math.sin(a) * 0.33]));
  }
  // Central tree: trunk, root flare and a three-lobed crown.
  p.push(part(new THREE.CylinderGeometry(0.022, 0.034, 0.3, 7).translate(0, 0.15, 0), 0x6b4a2b, [0, 0.1, 0]));
  p.push(part(new THREE.CylinderGeometry(0.045, 0.05, 0.02, 7).translate(0, 0.01, 0), 0x5c4128, [0, 0.1, 0]));
  p.push(part(new THREE.IcosahedronGeometry(0.15, 1).translate(0, 0.46, 0), 0x3f8f3a, [0, 0, 0]));
  p.push(part(new THREE.IcosahedronGeometry(0.1, 0).translate(0.1, 0.4, 0.04), 0x4f9e45, [0, 0, 0]));
  p.push(part(new THREE.IcosahedronGeometry(0.09, 0).translate(-0.09, 0.42, -0.06), 0x358a3a, [0, 0, 0]));
  // Little rocks.
  for (const [x, z, s] of [[0.1, 0.28, 0.035], [-0.2, 0.22, 0.03], [0.26, -0.16, 0.028]] as const) p.push(part(new THREE.IcosahedronGeometry(s, 0).translate(0, s * 0.6, 0), 0x9a968c, [x, 0.09, z]));
  // Chevron boards facing the four entries (north, east, south, west): yellow plate, black chevrons, post.
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2; // 0 = east
    const nx = Math.cos(a), nz = Math.sin(a), yaw = -a - Math.PI / 2;
    const at = (r: number, y: number): [number, number, number] => [nx * r, y, nz * r];
    p.push(part(box(0.2, 0.11, 0.012), 0xf2c230, at(0.4, 0.1), [0, yaw, 0]));
    p.push(part(box(0.012, 0.08, 0.012), 0x555c63, at(0.4, 0.05), [0, yaw, 0]));
    for (const dx of [-0.05, 0.05]) {
      const ox = -nz * dx, oz = nx * dx;
      p.push(part(box(0.012, 0.075, 0.004), 0x1f1f1f, [nx * 0.408 + ox, 0.14, nz * 0.408 + oz], [0, yaw, 0.7]));
      p.push(part(box(0.012, 0.075, 0.004), 0x1f1f1f, [nx * 0.408 + ox, 0.14, nz * 0.408 + oz], [0, yaw, -0.7]));
    }
  }
  return merge(p);
}

/** A painted arrow (model +x = direction of travel), about 0.34 long. */
export function ringArrowModel(): THREE.BufferGeometry {
  const y = 0.04, h = 0.009;
  return merge([
    part(box(0.2, h, 0.04), PAINT, [-0.04, y, 0]), // shaft
    part(box(0.13, h, 0.034), PAINT, [0.1, y, 0.04], [0, -0.75, 0]), // head, left barb
    part(box(0.13, h, 0.034), PAINT, [0.1, y, -0.04], [0, 0.75, 0]), // head, right barb
  ]);
}

/** Give-way markings + roundabout sign for the entry on a tile's NORTH edge (cars arrive heading south, in the west half). */
export function ringYieldModel(): THREE.BufferGeometry {
  const y = 0.04, h = 0.008;
  const p: THREE.BufferGeometry[] = [];
  // Shark-teeth row across the approach lane (triangles point at the oncoming driver, −z).
  for (let k = 0; k < 4; k++) p.push(part(new THREE.CylinderGeometry(0.05, 0.05, h, 3).rotateY(Math.PI), PAINT, [-0.4 + k * 0.1, y + h / 2, -0.43]));
  p.push(part(box(0.4, h, 0.014), PAINT, [-0.25, y, -0.485])); // line at the edge of the ring road
  // Roundabout sign on the east verge of the entry: pole, blue disc, three white arrows chasing each other.
  const sx = 0.46, sz = -0.45;
  p.push(part(new THREE.CylinderGeometry(0.006, 0.006, 0.34, 6).translate(0, 0.17, 0), 0x555c63, [sx, 0.04, sz]));
  p.push(part(new THREE.CylinderGeometry(0.06, 0.06, 0.008, 18).rotateX(Math.PI / 2), 0x2b6fd6, [sx, 0.36, sz - 0.004]));
  p.push(part(new THREE.CylinderGeometry(0.062, 0.062, 0.006, 18).rotateX(Math.PI / 2), 0xffffff, [sx, 0.36, sz - 0.001]));
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    p.push(part(box(0.034, 0.012, 0.004), 0xffffff, [sx + Math.cos(a) * 0.032, 0.36 + Math.sin(a) * 0.032, sz - 0.009], [0, 0, a + Math.PI / 2 + 0.2]));
    p.push(part(box(0.016, 0.012, 0.004), 0xffffff, [sx + Math.cos(a + 0.5) * 0.034, 0.36 + Math.sin(a + 0.5) * 0.034, sz - 0.009], [0, 0, a + Math.PI / 2 + 1.0]));
  }
  return merge(p);
}
