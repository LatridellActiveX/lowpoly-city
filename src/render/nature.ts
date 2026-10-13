/**
 * render/nature.ts — low-poly trees, bushes and rocks, plus ground colours.
 *
 * Trees use the same trick as buildings: one merged, vertex-coloured
 * geometry per kind, drawn as an InstancedMesh. Each tree gets a small
 * deterministic offset, rotation, size and tint from a hash of its tile, so a
 * forest looks natural but never "shuffles" between reloads.
 */
import * as THREE from 'three';
import { GroundType } from '../sim/terrain';
import { fbm } from '../sim/random';
import { GRID_SIZE } from '../sim/types';
import { box, merge, part } from './models';

const TRUNK = 0x7a5536;

export const NATURE = {
  pine: () =>
    merge([
      part(new THREE.CylinderGeometry(0.03, 0.04, 0.16, 5).translate(0, 0.08, 0), TRUNK),
      part(new THREE.ConeGeometry(0.2, 0.3, 6).translate(0, 0.27, 0), 0x2f6b3a),
      part(new THREE.ConeGeometry(0.15, 0.26, 6).translate(0, 0.43, 0), 0x3a7d44),
      part(new THREE.ConeGeometry(0.09, 0.18, 6).translate(0, 0.58, 0), 0x46904f),
    ]),
  oak: () =>
    merge([
      part(new THREE.CylinderGeometry(0.035, 0.05, 0.22, 5).translate(0, 0.11, 0), TRUNK),
      part(new THREE.IcosahedronGeometry(0.2, 0).translate(0, 0.36, 0), 0x5c9e3f),
      part(new THREE.IcosahedronGeometry(0.13, 0).translate(0.1, 0.46, 0.04), 0x6fb04a),
    ]),
  birch: () =>
    merge([
      part(new THREE.CylinderGeometry(0.02, 0.028, 0.34, 5).translate(0, 0.17, 0), 0xeeeae0),
      part(box(0.042, 0.02, 0.042), 0x333333, [0, 0.12, 0]),
      part(new THREE.IcosahedronGeometry(0.13, 0).scale(1, 1.6, 1).translate(0, 0.44, 0), 0x9cc95a),
    ]),
  bush: () =>
    merge([
      part(new THREE.IcosahedronGeometry(0.1, 0).translate(0, 0.07, 0), 0x4e8a3a),
      part(new THREE.IcosahedronGeometry(0.075, 0).translate(0.09, 0.05, 0.03), 0x5d9c44),
    ]),
  rock: () =>
    merge([
      part(new THREE.DodecahedronGeometry(0.12, 0).scale(1.2, 0.65, 1).translate(0, 0.05, 0), 0x9a9c9e),
      part(new THREE.DodecahedronGeometry(0.06, 0).translate(0.12, 0.03, 0.05), 0x8a8c8e),
    ]),
};

/** Base colour per ground type; grassShade() then brightens it slightly. */
export const GROUND_COLORS: Record<GroundType, number> = {
  grass: 0x84c05a,
  meadow: 0x8fc35c,
  dirt: 0xb19466,
  rocky: 0x9fa38f,
};

/** Hermite smoothstep: 0 below a, 1 above b, an S-curve in between. */
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * SMOOTH GROUND (PR 3)
 * --------------------
 * PR 2 coloured each tile as one flat square, so dirt and rocky patches had
 * hard, blocky staircase edges. Now the ground is ONE plane with two vertices
 * per tile edge, and each vertex gets a colour from the same noise fields
 * terrain.ts uses — but blended with smoothstep instead of hard thresholds.
 * The GPU interpolates colours between vertices, so patches fade softly into
 * the grass. (Decorations still use the per-tile `groundType`, whose
 * thresholds sit in the middle of these blend bands, so rocks still land on
 * rocky-looking ground.)
 */
export function buildGroundMesh(seed: number): THREE.Mesh {
  const RES = 2; // vertices per tile edge
  const seg = GRID_SIZE * RES;
  const geo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE, seg, seg).rotateX(-Math.PI / 2);
  geo.translate(GRID_SIZE / 2, 0.002, GRID_SIZE / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Sample noise at the tile-space point; −0.5 lines vertex samples up with
    // the tile-centre samples used by groundType().
    const x = pos.getX(i) - 0.5;
    const z = pos.getZ(i) - 0.5;
    const patch = fbm(x, z, 9, seed + 7);
    const meadow = fbm(x, z, 14, seed + 3);
    c.setHex(GROUND_COLORS.grass).lerp(tmp.setHex(GROUND_COLORS.meadow), smooth(0.48, 0.62, meadow));
    c.lerp(tmp.setHex(GROUND_COLORS.dirt), smooth(0.64, 0.73, patch));
    c.lerp(tmp.setHex(GROUND_COLORS.rocky), smooth(0.74, 0.82, patch));
    // Gentle large-scale brightness wobble so grass isn't one flat colour.
    c.multiplyScalar(0.92 + fbm(x, z, 6, seed + 11) * 0.07);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}
