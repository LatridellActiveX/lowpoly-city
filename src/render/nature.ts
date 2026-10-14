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
/**
 * PR 5 smooth water field: 1 at the centre of a water tile, 0 at the centre
 * of a dry one, BILINEARLY interpolated in between. Contouring this at 0.5
 * gives a shoreline that runs diagonally across corners and bulges smoothly
 * instead of following the square tile edges (PR 4's "blocky rivers").
 * (x, z) are continuous map coordinates (tile (3,4) spans 3..4, 4..5).
 */
export function waterField(water: (x: number, z: number) => boolean, x: number, z: number): number {
  const fx = x - 0.5, fz = z - 0.5;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = fx - x0, tz = fz - z0;
  // Off-map tiles copy their nearest on-map neighbour so rivers run off the edge.
  const w = (ix: number, iz: number) => (water(Math.min(GRID_SIZE - 1, Math.max(0, ix)), Math.min(GRID_SIZE - 1, Math.max(0, iz))) ? 1 : 0);
  const a = w(x0, z0) * (1 - tx) + w(x0 + 1, z0) * tx;
  const b = w(x0, z0 + 1) * (1 - tx) + w(x0 + 1, z0 + 1) * tx;
  // Smoothstep the interpolation weight a little so the contour rounds off.
  return a * (1 - tz) + b * tz;
}

/**
 * PR 5 water surface: ONE mesh for all rivers and lakes (replaces the per-tile
 * water boxes). It's a fine grid (RES vertices per tile) covering only cells
 * near water. Vertices where the field ≥ 0.5 sit just ABOVE the ground; dry
 * ones dip BELOW it. The ground plane therefore slices each shore triangle
 * where the field crosses ~0.5 — a smooth, interpolated shoreline (the
 * same idea as "marching squares", done for free by the depth buffer).
 */
export function buildWaterMesh(seed: number, water: (x: number, z: number) => boolean): THREE.Mesh | null {
  const RES = 4;
  const N = GRID_SIZE * RES;
  const verts: number[] = [];
  const cols: number[] = [];
  const index: number[] = [];
  const vid = new Map<number, number>();
  const c = new THREE.Color();
  const vertex = (gx: number, gz: number): number => {
    const key = gz * (N + 1) + gx;
    let id = vid.get(key);
    if (id !== undefined) return id;
    const x = gx / RES, z = gz / RES;
    const f = waterField(water, x, z);
    // Height: +0.044 when wet, −0.04 when dry; crosses the ground (y≈0) at f = 0.5.
    verts.push(x, -0.04 + f * 0.084, z);
    // Deeper water (f→1) is darker; a little noise breaks up the surface.
    c.setHex(0x4a9ad6).lerp(new THREE.Color(0x2f78b8), f).multiplyScalar(0.94 + fbm(x, z, 5, seed + 19) * 0.12);
    cols.push(c.r, c.g, c.b);
    id = verts.length / 3 - 1;
    vid.set(key, id);
    return id;
  };
  for (let gz = 0; gz < N; gz++)
    for (let gx = 0; gx < N; gx++) {
      // Only cells within reach of a water tile.
      const tx = Math.floor(gx / RES), tz = Math.floor(gz / RES);
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1 && !near; dx++) {
        const nx = tx + dx, nz = tz + dz;
        if (nx >= 0 && nz >= 0 && nx < GRID_SIZE && nz < GRID_SIZE && water(nx, nz)) near = true;
      }
      if (!near) continue;
      const a = vertex(gx, gz), b = vertex(gx + 1, gz), cc = vertex(gx, gz + 1), d = vertex(gx + 1, gz + 1);
      index.push(a, cc, b, b, cc, d);
    }
  if (!index.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
  mesh.receiveShadow = true;
  return mesh;
}

export function buildGroundMesh(seed: number, water?: (x: number, z: number) => boolean): THREE.Mesh {
  const RES = 4; // vertices per tile edge (PR 5: 2 → 4 so sandy banks curve smoothly)
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
    // PR 4: sandy banks + a dark riverbed. A vertex sits on the corner of up
    // to four tiles; if ANY of them is water, the vertex is shore sand, and if
    // ALL are water it's riverbed (seen faintly through the water surface).
    // PR 5: banks from the same smooth field as the water surface: riverbed
    // under deep water, sand on a band either side of the shoreline.
    if (water) {
      const f = waterField(water, pos.getX(i), pos.getZ(i));
      if (f > 0.7) c.setHex(0x2c5f7c);
      else if (f > 0.2) c.lerp(tmp.setHex(0xd9c79a), Math.min(1, (f - 0.2) / 0.15));
    }
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}
