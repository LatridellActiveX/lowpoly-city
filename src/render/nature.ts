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
