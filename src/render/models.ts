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
      // PR 5 detail: cooling-tower rims, boiler-house windows, a coal pile,
      // a conveyor up to the boiler house, pipe racks and a perimeter fence.
      part(new THREE.CylinderGeometry(0.155, 0.155, 0.03, 12, 1, true).translate(0, 0.72, 0), 0xc23b2f, [0.22, 0, -0.2]),
      part(new THREE.CylinderGeometry(0.125, 0.125, 0.03, 12, 1, true).translate(0, 0.6, 0), 0xc23b2f, [0.25, 0, 0.25]),
      ...[-0.32, -0.2, -0.08].flatMap((x) => [part(box(0.06, 0.07, 0.01), 0x3e5f7a, [x, 0.3, 0.405]), part(box(0.07, 0.01, 0.02), 0xf4f1ea, [x, 0.29, 0.41])]),
      part(new THREE.ConeGeometry(0.13, 0.1, 9).translate(0, 0.05, 0), 0x2b2724, [-0.3, 0.12, -0.05]),
      part(box(0.05, 0.02, 0.36), 0x55595e, [-0.3, 0.3, 0.02], [0.55, 0, 0]),
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8).rotateZ(Math.PI / 2), 0x8d8f91, [0.02, 0.35, 0.0]),
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 8).rotateX(Math.PI / 2), 0x8d8f91, [0.08, 0.28, 0.02]),
      ...[-0.45, -0.15, 0.15, 0.45].map((x) => part(box(0.014, 0.08, 0.014), 0x7d848b, [x, 0.12, 0.46])),
      part(box(0.92, 0.006, 0.006), 0x7d848b, [0, 0.19, 0.46]),
    ]),
  /** Wind turbine without blades (blades are separate so they can spin). */
  windTower: () =>
    merge([
      part(box(0.4, 0.06, 0.4), 0x9aa0a6),
      part(new THREE.CylinderGeometry(0.025, 0.05, 1.2, 12).translate(0, 0.6, 0), 0xf5f7fa, [0, 0.06, 0]),
      part(box(0.1, 0.08, 0.2), 0xf5f7fa, [0, 1.22, 0]),
      // PR 5 detail: tower door, flange rings, rounded nacelle tail, vents.
      part(box(0.04, 0.08, 0.02), 0x8a8f96, [0, 0.06, 0.045]),
      part(new THREE.CylinderGeometry(0.043, 0.043, 0.015, 12).translate(0, 0.0075, 0), 0xdde2e8, [0, 0.4, 0]),
      part(new THREE.CylinderGeometry(0.034, 0.034, 0.015, 12).translate(0, 0.0075, 0), 0xdde2e8, [0, 0.8, 0]),
      part(new THREE.SphereGeometry(0.05, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), 0xf5f7fa, [0, 1.26, -0.1]),
      part(box(0.06, 0.012, 0.08), 0xc9ced4, [0, 1.3, -0.02]),
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
      // PR 5 detail: X cross-braces between legs, a catwalk ring with rail,
      // a ladder, the riser pipe and a finial on the roof.
      // Each side: an X of two diagonal braces in the plane between two legs.
      // (Built facing +z at z = 0.18, then rotated to each side — rotation
      // happens BEFORE translation in part(), so we pre-rotate the geometry.)
      ...[0, Math.PI / 2, Math.PI, -Math.PI / 2].flatMap((a) =>
        [0.9, -0.9].map((tilt) => part(box(0.008, 0.42, 0.008).translate(0, -0.21, 0).rotateZ(tilt).translate(0, 0.51, 0.18).rotateY(a), 0x8a8f96)),
      ),
      part(new THREE.TorusGeometry(0.31, 0.012, 4, 20).rotateX(Math.PI / 2), 0x6b7078, [0, 0.6, 0]),
      part(new THREE.TorusGeometry(0.31, 0.006, 3, 20).rotateX(Math.PI / 2), 0x6b7078, [0, 0.68, 0]),
      part(box(0.008, 0.6, 0.008), 0x6b7078, [0.27, 0, 0.12]),
      part(box(0.008, 0.6, 0.008), 0x6b7078, [0.27, 0, 0.17]),
      part(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8).translate(0, 0.3, 0), 0x7d8288),
      part(new THREE.SphereGeometry(0.03, 8, 4), 0x3f7fa8, [0, 1.0, 0]),
    ]);
  },
  /** Water pipe junction + a 1-unit segment along +x (lies on the ground). */
  pipeJoint: () => merge([part(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), 0x2f7fbf, [0, 0.05, 0])]),
  pipe: () => merge([part(new THREE.CylinderGeometry(0.04, 0.04, 1, 8).rotateZ(Math.PI / 2).translate(0.5, 0, 0), 0x3d95d9, [0, 0.05, 0])]),
  /**
   * Park (PR 3): a lawn with a gravel cross-path, two little trees (cones on
   * cylinders), a flower bed and a bench. Parks raise nearby desirability.
   */
  park: () =>
    merge([
      part(box(0.94, 0.035, 0.94), 0x6fbf57),
      part(box(0.94, 0.012, 0.12), 0xd8c9a3, [0, 0.035, 0]),
      part(box(0.12, 0.012, 0.94), 0xd8c9a3, [0, 0.035, 0]),
      part(new THREE.CylinderGeometry(0.025, 0.03, 0.14, 5).translate(0, 0.07, 0), 0x7a5536, [-0.25, 0.035, -0.25]),
      part(new THREE.ConeGeometry(0.15, 0.3, 7).translate(0, 0.27, 0), 0x3f8f45, [-0.25, 0.035, -0.25]),
      part(new THREE.CylinderGeometry(0.025, 0.03, 0.12, 5).translate(0, 0.06, 0), 0x7a5536, [0.26, 0.035, 0.24]),
      part(new THREE.IcosahedronGeometry(0.14, 0).translate(0, 0.24, 0), 0x5fae46, [0.26, 0.035, 0.24]),
      part(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 8).translate(0, 0.02, 0), 0xe86a8a, [0.25, 0.035, -0.25]),
      part(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 8).translate(0, 0.025, 0), 0xffd166, [0.25, 0.04, -0.25]),
      part(box(0.2, 0.02, 0.06), 0x8a5a36, [-0.25, 0.08, 0.2]), // bench seat
      part(box(0.2, 0.06, 0.015), 0x8a5a36, [-0.25, 0.1, 0.23]), // bench back
      part(box(0.015, 0.05, 0.05), 0x444444, [-0.33, 0.035, 0.2]),
      part(box(0.015, 0.05, 0.05), 0x444444, [-0.17, 0.035, 0.2]),
      // PR 5 detail: lamp post with a globe, bin, stone path edging, extra flowers, low hedge.
      part(new THREE.CylinderGeometry(0.008, 0.01, 0.28, 8).translate(0, 0.14, 0), 0x2e3238, [0.08, 0.035, 0.08]),
      part(new THREE.SphereGeometry(0.025, 8, 6), 0xfff3c4, [0.08, 0.33, 0.08]),
      part(new THREE.CylinderGeometry(0.02, 0.018, 0.05, 10).translate(0, 0.025, 0), 0x3f6b3f, [-0.1, 0.035, 0.1]),
      ...[-1, 1].flatMap((sd) => [part(box(0.94, 0.016, 0.012), 0xb9ae94, [0, 0.035, sd * 0.066]), part(box(0.012, 0.016, 0.94), 0xb9ae94, [sd * 0.066, 0.035, 0])]),
      ...[[0.17, -0.33], [0.33, -0.17], [0.34, -0.33]].map(([x, z]) => part(new THREE.IcosahedronGeometry(0.03, 0), 0xc77dff, [x, 0.06, z])),
      part(box(0.3, 0.06, 0.06), 0x4f8f45, [0.27, 0.035, 0.42]),
    ]),
  /** Floating warning gem above buildings that aren't operating. */
  marker: () => merge([part(new THREE.OctahedronGeometry(0.12), 0xffffff)]),
  /** Flat square used for previews, overlays and hover. */
  tilePlane: () => new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2),
};

/**
 * PR 4 construction site pieces. All are built at UNIT size and scaled per
 * building by the renderer:
 *  - scaffold: a frame filling the box x,z ∈ [−0.5, 0.5], y ∈ [0, 1]
 *    (corner posts, two levels of rails, a diagonal brace) — scaled to the
 *    footprint and height of the building being built.
 *  - craneMast: a lattice-ish tower 1 unit tall with a concrete foot; scaled in y.
 *  - craneJib: the horizontal arm + counterweight + cab, pivoting at the
 *    origin; the renderer puts it on top of the mast and spins it slowly.
 */
export const SITE = {
  scaffold: () => {
    const Y = 0xf0b43c; // safety yellow
    const parts: THREE.BufferGeometry[] = [];
    for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) parts.push(part(box(0.035, 1, 0.035), Y, [x, 0, z]));
    for (const y of [0.33, 0.66, 0.98]) {
      parts.push(part(box(1, 0.025, 0.025), Y, [0, y, -0.5]), part(box(1, 0.025, 0.025), Y, [0, y, 0.5]));
      parts.push(part(box(0.025, 0.025, 1), Y, [-0.5, y, 0]), part(box(0.025, 0.025, 1), Y, [0.5, y, 0]));
    }
    parts.push(part(box(0.02, 1.35, 0.02), 0xd9d2c3, [0, 0, 0.5], [0, 0, 0.78])); // diagonal brace on the front
    parts.push(part(box(1.04, 0.02, 1.04), 0xb7a58a)); // foundation slab
    return merge(parts);
  },
  craneMast: () =>
    merge([
      part(box(0.16, 0.05, 0.16), 0x9a9a9a),
      part(box(0.06, 1, 0.06), 0xf2a81d, [0, 0.05, 0]),
    ]),
  craneJib: () =>
    merge([
      part(box(0.75, 0.04, 0.045), 0xf2a81d, [0.27, 0, 0]),
      part(box(0.12, 0.07, 0.08), 0x7b7f86, [-0.14, -0.02, 0]), // counterweight
      part(box(0.07, 0.06, 0.07), 0xe8e8e8, [0.03, -0.06, 0.06]), // operator cab
      part(box(0.006, 0.3, 0.006), 0x333333, [0.55, -0.3, 0]), // hook cable
      part(box(0.04, 0.03, 0.04), 0x333333, [0.55, -0.33, 0]), // hook block
    ]),
};

/**
 * PR 4 nuclear power plant (tier 3): a big curved cooling tower (a LATHE —
 * a 2D outline spun around the y axis; the outline pinches in at the waist
 * like a real hyperboloid tower), a domed reactor building and a turbine hall.
 */
export function nuclearPlantModel(): THREE.BufferGeometry {
  const outline = [
    new THREE.Vector2(0.3, 0), new THREE.Vector2(0.24, 0.3), new THREE.Vector2(0.2, 0.62),
    new THREE.Vector2(0.21, 0.82), new THREE.Vector2(0.24, 0.95),
  ];
  return merge([
    part(box(0.96, 0.08, 0.96), 0xa3a7ab),
    part(new THREE.LatheGeometry(outline, 14).translate(0, 0.08, 0), 0xe3e1dc, [-0.18, 0, -0.16]),
    part(new THREE.CylinderGeometry(0.235, 0.235, 0.04, 14, 1, true).translate(0, 1.01, 0), 0xc23b2f, [-0.18, 0, -0.16]), // red band
    part(new THREE.CylinderGeometry(0.17, 0.17, 0.26, 12).translate(0, 0.21, 0), 0xd4d8dc, [0.24, 0, 0.18]),
    part(new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.34, 0), 0xd4d8dc, [0.24, 0, 0.18]), // dome
    part(box(0.3, 0.22, 0.2), 0x5e7f9e, [0.22, 0.08, -0.25]), // turbine hall
    part(box(0.32, 0.03, 0.22), 0x3d556b, [0.22, 0.3, -0.25]),
    // PR 5 detail: second, smaller cooling tower ring, reactor hatch + vent,
    // turbine-hall windows, transformer yard, fence and switchyard pylons.
    part(new THREE.TorusGeometry(0.235, 0.012, 4, 24).rotateX(Math.PI / 2), 0xbcb9b2, [-0.18, 0.33, -0.16]),
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 10).translate(0, 0.04, 0), 0xb0b4b8, [0.24, 0.48, 0.18]),
    part(box(0.07, 0.09, 0.02), 0x55595e, [0.24, 0.08, 0.355]),
    ...[0.12, 0.2, 0.28, 0.36].map((x) => part(box(0.05, 0.06, 0.01), 0x9fd7ff, [x, 0.17, -0.145])),
    ...[[-0.36, 0.3], [-0.24, 0.3], [-0.36, 0.4]].flatMap(([x, z]) => [part(box(0.07, 0.07, 0.06), 0x6c7a86, [x, 0.08, z]), part(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6).translate(0, 0.025, 0), 0xd9c7a0, [x, 0.15, z])]),
    ...[-0.47, -0.235, 0, 0.235, 0.47].flatMap((x) => [part(box(0.012, 0.09, 0.012), 0x7d848b, [x, 0.08, 0.47]), part(box(0.012, 0.09, 0.012), 0x7d848b, [0.47, 0.08, x])]),
    part(box(0.95, 0.006, 0.006), 0x7d848b, [0, 0.16, 0.47]),
    part(box(0.006, 0.006, 0.95), 0x7d848b, [0.47, 0.16, 0]),
  ]);
}

/**
 * PR 4 high-capacity pump station (tier 3, 1 tile): a big squat storage
 * tank on a concrete base, a pump house and blue pipework.
 */
export function pumpStationModel(): THREE.BufferGeometry {
  return merge([
    part(box(0.94, 0.06, 0.94), 0xa3a7ab),
    part(new THREE.CylinderGeometry(0.3, 0.32, 0.5, 14).translate(0, 0.25, 0), 0x5fa8d3, [-0.12, 0.06, -0.1]),
    part(new THREE.CylinderGeometry(0.31, 0.31, 0.04, 14).translate(0, 0.02, 0), 0x3f7fa8, [-0.12, 0.56, -0.1]),
    part(box(0.26, 0.24, 0.22), 0xd9d3c7, [0.26, 0.06, 0.26]),
    part(box(0.28, 0.03, 0.24), 0x6d6158, [0.26, 0.3, 0.26]),
    part(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8).rotateZ(Math.PI / 2), 0x2f7fbf, [0.05, 0.12, 0.32]),
    // PR 5 detail: tank bands, ladder, valve wheels, pump-house door/windows, roof vents.
    part(new THREE.CylinderGeometry(0.315, 0.315, 0.015, 16, 1, true).translate(0, 0.2, 0), 0x3f7fa8, [-0.12, 0.06, -0.1]),
    part(new THREE.CylinderGeometry(0.315, 0.315, 0.015, 16, 1, true).translate(0, 0.38, 0), 0x3f7fa8, [-0.12, 0.06, -0.1]),
    part(box(0.008, 0.5, 0.008), 0x6b7078, [0.17, 0.06, -0.06]),
    part(box(0.008, 0.5, 0.008), 0x6b7078, [0.17, 0.06, -0.12]),
    ...[-0.12, 0.2].map((x) => part(new THREE.TorusGeometry(0.03, 0.006, 4, 12), 0xc23b2f, [x, 0.19, 0.36])),
    part(box(0.07, 0.13, 0.01), 0x6d6158, [0.22, 0.06, 0.375]),
    part(box(0.05, 0.05, 0.01), 0x3e5f7a, [0.33, 0.17, 0.375]),
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8).translate(0, 0.025, 0), 0x9aa1a8, [0.3, 0.33, 0.22]),
  ]);
}
