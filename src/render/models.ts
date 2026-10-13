/**
 * render/models.ts — every low-poly model in the game, built from code.
 *
 * There are no 3D model files. Each model is a handful of simple shapes
 * (boxes, cylinders, cones) that we colour, position, and then MERGE into a
 * single geometry. Colours are stored per-vertex ("vertex colours"), so one
 * merged geometry can be red-roofed and white-walled at the same time while
 * still being one mesh — which is what lets us instance it (instancing.ts).
 *
 * Units: one tile is 1 x 1 world units. A model is centred on (0, 0, 0) with
 * its base at y = 0, and fits inside -0.5..0.5 on x and z.
 *
 * `flatShading` on the material gives each triangle a single flat colour —
 * the signature "low-poly" look.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** One coloured, positioned part of a model. */
export function part(
  geo: THREE.BufferGeometry,
  color: number,
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  // toNonIndexed so every part has the same attribute layout and can be merged.
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.rotateX(rot[0]);
  g.rotateY(rot[1]);
  g.rotateZ(rot[2]);
  g.translate(pos[0], pos[1], pos[2]);
  const c = new THREE.Color(color);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

/** A box whose BASE (not centre) sits at y. */
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);

/** Pyramid roof: a 4-sided cone rotated 45 degrees so its edges line up with the walls. */
export const pyramid = (w: number, h: number) =>
  new THREE.ConeGeometry(w * Math.SQRT1_2, h, 4).rotateY(Math.PI / 4).translate(0, h / 2, 0);

/**
 * Gable roof: a triangular prism. The ridge runs along x; the slopes face
 * +z and -z. `w` = length along x, `d` = depth, `h` = ridge height.
 * `ridge` (0..1) moves the ridge off-centre for a lopsided "saltbox" roof.
 */
export function gable(w: number, h: number, d: number, ridge = 0.5): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo(d / 2, 0);
  shape.lineTo(-d / 2 + d * ridge, h);
  shape.closePath();
  // The shape is drawn in the x/y plane and extruded along z, then rotated so
  // the extrusion runs along x.
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

export const MODELS = {
  /** Road surface (instance colour is white; the slab is asphalt grey). */
  road: () => merge([part(box(1, 0.04, 1), 0x50555e)]),
  /** Dashed centre line, drawn along the x axis; rotated for north-south roads. */
  roadDash: () => merge([part(box(0.22, 0.012, 0.05), 0xf2e6a0, [-0.25, 0.04, 0]), part(box(0.22, 0.012, 0.05), 0xf2e6a0, [0.25, 0.04, 0])]),
  /** Zoned lot: a flat white slab; the instance colour tints it per zone. */
  lot: () => merge([part(box(0.94, 0.03, 0.94), 0xffffff)]),

  powerPlant: () =>
    merge([
      part(box(0.94, 0.12, 0.94), 0x9aa0a6),
      part(box(0.42, 0.42, 0.5), 0xb5543c, [-0.2, 0.12, 0.15]),
      part(new THREE.CylinderGeometry(0.15, 0.21, 0.6, 8).translate(0, 0.3, 0), 0xe1e4e8, [0.22, 0.12, -0.2]),
      part(new THREE.CylinderGeometry(0.12, 0.17, 0.5, 8).translate(0, 0.25, 0), 0xe1e4e8, [0.25, 0.12, 0.25]),
      part(new THREE.CylinderGeometry(0.04, 0.05, 0.9, 6).translate(0, 0.45, 0), 0x55595e, [-0.32, 0.12, -0.3]),
      part(box(0.06, 0.05, 0.06), 0xffcc33, [-0.2, 0.54, 0.15]),
    ]),
  /** Wind turbine without blades (blades are separate so they can spin). */
  windTower: () =>
    merge([
      part(box(0.4, 0.06, 0.4), 0x9aa0a6),
      part(new THREE.CylinderGeometry(0.025, 0.05, 1.2, 6).translate(0, 0.6, 0), 0xf5f7fa, [0, 0.06, 0]),
      part(box(0.1, 0.08, 0.2), 0xf5f7fa, [0, 1.22, 0]),
    ]),
  /** Three blades around the origin in the x/y plane; spun around z by the renderer. */
  windBlades: () => {
    const blades: THREE.BufferGeometry[] = [part(new THREE.SphereGeometry(0.035, 6, 4), 0xdde2e8)];
    for (let k = 0; k < 3; k++) {
      blades.push(part(box(0.045, 0.48, 0.012).translate(0, 0.02, 0), 0xf5f7fa, [0, 0, 0], [0, 0, (k * Math.PI * 2) / 3]));
    }
    return merge(blades);
  },
  waterTower: () => {
    const legs: THREE.BufferGeometry[] = [];
    for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
      legs.push(part(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 5).translate(0, 0.3, 0), 0x8a8f96, [x, 0, z]));
    }
    return merge([
      ...legs,
      part(new THREE.CylinderGeometry(0.3, 0.26, 0.34, 10).translate(0, 0.17, 0), 0x5fa8d3, [0, 0.58, 0]),
      part(new THREE.ConeGeometry(0.32, 0.16, 10).translate(0, 0.08, 0), 0x3f7fa8, [0, 0.92, 0]),
      part(box(0.2, 0.06, 0.2), 0x8a8f96),
    ]);
  },
  /** Water pipe junction + a 1-unit segment along +x (lies on the ground). */
  pipeJoint: () => merge([part(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), 0x2f7fbf, [0, 0.05, 0])]),
  pipe: () => merge([part(new THREE.CylinderGeometry(0.04, 0.04, 1, 8).rotateZ(Math.PI / 2).translate(0.5, 0, 0), 0x3d95d9, [0, 0.05, 0])]),
  /** Floating warning gem above buildings that aren't operating. */
  marker: () => merge([part(new THREE.OctahedronGeometry(0.12), 0xffffff)]),
  /** Flat square used for previews, overlays and hover. */
  tilePlane: () => new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2),
};
