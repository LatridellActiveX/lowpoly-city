/**
 * render/serviceModels.ts — V1.5b models for city services (garbage dump,
 * police station, clinic, hospital, schools, college), the garbage pile,
 * and the service vehicles' add-on parts (garbage-truck body, police light
 * bar, ambulance body).
 *
 * Same conventions as models.ts: 1 unit = 1 tile, y up, the FRONT faces +z
 * (the renderer turns it toward the road). 2×2 buildings are modelled 2
 * units wide, centred on the block. Each model is one merged vertex-coloured
 * geometry → one instanced draw call however many are built.
 */
import * as THREE from 'three';
import { box, gable, merge, part } from './models';

const cyl = (r: number, h: number, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);
const WIN = 0x9fc4e8, CONC = 0xc8c3b8, BRICK = 0xb5543c, ROOFD = 0x4d5560, GRASS = 0x6fb54f, WHITE = 0xf2f2ee;

/** A row of windows on the +z face of a box of width w at height y. */
const windows = (n: number, w: number, y: number, z: number, x0 = 0, c = WIN) =>
  Array.from({ length: n }, (_, k) => part(box(w / (n * 1.8), 0.05, 0.008), c, [x0 - w / 2 + (w * (k + 0.5)) / n, y, z]));

export function serviceModels(): Record<string, THREE.BufferGeometry> {
  return {
    // Garbage dump: fenced yard, two big waste mounds, a compactor shed and a parked truck.
    svc0: merge([
      part(box(0.96, 0.012, 0.96), 0x8f8676),
      ...[[-0.47, 0, 0.94, 0.02], [0.47, 0, 0.94, 0.02], [0, -0.47, 0.02, 0.94]].map(([x, z, w, d]) => part(box(w, 0.1, d), 0x6d7177, [x, 0.012, z])),
      part(new THREE.ConeGeometry(0.28, 0.24, 9).translate(0, 0.12, 0), 0x6b6450, [-0.18, 0.012, -0.18]),
      part(new THREE.ConeGeometry(0.2, 0.17, 8).translate(0, 0.085, 0), 0x7d7558, [0.2, 0.012, -0.22]),
      ...[[-0.25, -0.12, 0x3d7a3a], [-0.1, -0.25, 0x2c5f8a], [0.15, -0.1, 0xb33b2e], [0.28, -0.3, 0xd9c23a]].map(([x, z, c]) => part(box(0.05, 0.04, 0.04), c, [x, 0.1, z])),
      part(box(0.3, 0.2, 0.22), 0x9aa0a6, [0.22, 0.012, 0.2]), part(box(0.32, 0.03, 0.24), 0x3d7a3a, [0.22, 0.212, 0.2]),
      part(box(0.26, 0.1, 0.12), 0x3c8d40, [-0.2, 0.012, 0.3]), part(box(0.08, 0.1, 0.12), 0xe8e8e8, [-0.05, 0.012, 0.3]),
    ]),
    // Police station: two-storey white/blue block, flag pole, blue lamp, parked patrol cars.
    svc1: merge([
      part(box(0.96, 0.012, 0.96), CONC),
      part(box(0.66, 0.36, 0.42), 0xeef1f5, [0, 0.012, -0.12]), part(box(0.68, 0.06, 0.44), 0x24529e, [0, 0.33, -0.12]),
      ...windows(5, 0.6, 0.12, 0.095), ...windows(5, 0.6, 0.24, 0.095),
      part(box(0.16, 0.14, 0.03), 0x24529e, [0, 0.012, 0.1]), part(box(0.1, 0.04, 0.012), 0xffffff, [0, 0.16, 0.118]),
      part(new THREE.SphereGeometry(0.025, 8, 6), 0x3f7fff, [0.1, 0.2, 0.12]),
      part(cyl(0.008, 0.5, 6), 0xd0d0d0, [-0.38, 0.012, 0.25]), part(box(0.12, 0.07, 0.004), 0x2a62c9, [-0.32, 0.43, 0.25]),
      ...[0.05, 0.25].map((x) => part(box(0.14, 0.05, 0.08), 0x1e2a44, [x, 0.012, 0.32])),
      ...[0.05, 0.25].map((x) => part(box(0.05, 0.015, 0.06), 0xff3b30, [x, 0.062, 0.32])),
    ]),
    // Health clinic: white single storey, green cross sign, ramp and planters.
    svc2: merge([
      part(box(0.96, 0.012, 0.96), CONC),
      part(box(0.7, 0.22, 0.44), WHITE, [0, 0.012, -0.1]), part(box(0.72, 0.03, 0.46), 0x7fb5a3, [0, 0.232, -0.1]),
      ...windows(4, 0.6, 0.11, 0.125),
      part(box(0.16, 0.05, 0.012), 0x2e9e5b, [0, 0.27, 0.13]), part(box(0.05, 0.16, 0.012), 0x2e9e5b, [0, 0.215, 0.13]),
      part(box(0.2, 0.02, 0.18), 0xbdb8ae, [0.25, 0.012, 0.25]),
      ...[-0.35, -0.15].map((x) => part(cyl(0.05, 0.08, 8), GRASS, [x, 0.012, 0.3])),
    ]),
    // Hospital (2×2): tall main tower, low wings, red cross, rooftop helipad, ambulance bay.
    svc3: merge([
      part(box(1.94, 0.012, 1.94), CONC),
      part(box(0.9, 0.9, 0.6), WHITE, [0, 0.012, -0.3]),
      ...[0.15, 0.3, 0.45, 0.6, 0.75].flatMap((y) => windows(7, 0.84, y, 0.005)),
      part(box(1.7, 0.3, 0.5), 0xe7eaee, [0, 0.012, 0.35]), ...windows(10, 1.6, 0.15, 0.605),
      part(cyl(0.22, 0.02, 16), 0x3a3f46, [0, 0.912, -0.3]), part(box(0.2, 0.004, 0.04), 0xffffff, [0, 0.935, -0.3]), part(box(0.04, 0.004, 0.2), 0xffffff, [0.07, 0.935, -0.3]),
      part(box(0.3, 0.08, 0.012), 0xd63a3a, [0, 0.7, 0.006]), part(box(0.08, 0.3, 0.012), 0xd63a3a, [0, 0.59, 0.006]),
      part(box(0.5, 0.18, 0.012), 0xd63a3a, [0.55, 0.012, 0.6]), part(box(0.4, 0.02, 0.3), 0x7d8288, [0.55, 0.012, 0.8]),
      ...[-0.8, -0.6, 0.8].map((x) => part(cyl(0.07, 0.18, 7), 0x3f8f3a, [x, 0.012, 0.85])),
    ]),
    // Elementary school: brick, gable roof, bell tower, playground with a slide.
    svc4: merge([
      part(box(0.96, 0.012, 0.96), 0xa8c486),
      part(box(0.62, 0.22, 0.34), BRICK, [-0.08, 0.012, -0.2]), part(gable(0.66, 0.12, 0.38), ROOFD, [-0.08, 0.232, -0.2]),
      ...windows(5, 0.56, 0.12, -0.025, -0.08, 0xfff1c4),
      part(box(0.08, 0.12, 0.08), 0xe8dcc4, [-0.08, 0.3, -0.2]), part(new THREE.ConeGeometry(0.07, 0.1, 4).translate(0, 0.05, 0), ROOFD, [-0.08, 0.42, -0.2]),
      part(box(0.4, 0.008, 0.3), 0xd8b47a, [0.2, 0.012, 0.25]),
      part(box(0.03, 0.12, 0.03), 0xe04a3f, [0.1, 0.012, 0.2]), part(box(0.03, 0.03, 0.18), 0xffd84a, [0.1, 0.08, 0.3], [0.5, 0, 0]),
      part(box(0.16, 0.012, 0.012), 0x666666, [0.3, 0.14, 0.22]), ...[0.23, 0.37].map((x) => part(box(0.01, 0.14, 0.01), 0x666666, [x, 0.012, 0.22])),
    ]),
    // High school: bigger two-storey block, gym hall, running track + field.
    svc5: merge([
      part(box(0.96, 0.012, 0.96), 0x9fbf7c),
      part(box(0.8, 0.34, 0.3), 0xd8c8a8, [0, 0.012, -0.28]), part(box(0.82, 0.03, 0.32), ROOFD, [0, 0.352, -0.28]),
      ...windows(7, 0.74, 0.12, -0.125, 0, 0xfff1c4), ...windows(7, 0.74, 0.24, -0.125, 0, 0xfff1c4),
      part(box(0.26, 0.24, 0.22), 0x8a9aa8, [0.3, 0.012, 0.0]),
      part(box(0.6, 0.008, 0.32), 0xb5543c, [-0.12, 0.012, 0.27]), part(box(0.5, 0.01, 0.22), 0x5fae4a, [-0.12, 0.014, 0.27]),
      part(box(0.02, 0.1, 0.12), 0xffffff, [-0.35, 0.012, 0.27]), part(box(0.02, 0.1, 0.12), 0xffffff, [0.11, 0.012, 0.27]),
      part(cyl(0.008, 0.4, 6), 0xd0d0d0, [0.42, 0.012, 0.35]), part(box(0.1, 0.06, 0.004), 0x2b6fd6, [0.47, 0.35, 0.35]),
    ]),
    // College (2×2): domed main hall with columns, two wings, a quad with trees and paths.
    svc6: merge([
      part(box(1.94, 0.012, 1.94), 0x8fbf6a),
      part(box(1.2, 0.012, 0.08), 0xd8d0bf, [0, 0.014, 0.4]), part(box(0.08, 0.012, 1.1), 0xd8d0bf, [0, 0.014, 0.35]),
      part(box(0.8, 0.45, 0.5), 0xe8dcc4, [0, 0.012, -0.55]), part(new THREE.SphereGeometry(0.22, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0x6a8faf, [0, 0.46, -0.55]),
      part(box(0.82, 0.04, 0.06), 0xf4efe4, [0, 0.42, -0.28]),
      ...[-0.3, -0.15, 0, 0.15, 0.3].map((x) => part(cyl(0.025, 0.4, 8), 0xf4efe4, [x, 0.012, -0.27])),
      ...[-0.75, 0.75].flatMap((x) => [part(box(0.4, 0.3, 0.9), BRICK, [x, 0.012, 0.05]), part(gable(0.44, 0.12, 0.94), ROOFD, [x, 0.312, 0.05]), ...[-0.25, 0, 0.25].map((z) => part(box(0.008, 0.06, 0.12), WIN, [x + (x > 0 ? -0.205 : 0.205), 0.15, z + 0.05]))]),
      ...[[-0.4, 0.3], [0.4, 0.3], [-0.4, 0.7], [0.4, 0.7]].flatMap(([x, z]) => [part(cyl(0.02, 0.12, 6), 0x6b4a2b, [x, 0.012, z]), part(new THREE.IcosahedronGeometry(0.1, 0).translate(0, 0.2, 0), 0x3f8f3a, [x, 0, z])]),
    ]),
    /** Bin bags + a tipped can: drawn on host tiles with too much garbage. */
    garbagePile: merge([
      ...[[-0.06, 0, 0x2b2b2b], [0.05, 0.03, 0x3a3a3a], [0, -0.05, 0x1f3b1f], [0.08, -0.04, 0x2b2b2b]].map(([x, z, c]) => part(new THREE.SphereGeometry(0.045, 7, 5).scale(1, 0.8, 1).translate(0, 0.035, 0), c, [x, 0, z])),
      part(cyl(0.03, 0.08, 8), 0x7d8790, [-0.1, 0, -0.06]),
    ]),
    /** Garbage-truck body: green compactor with a rear hopper (on the truck chassis, +x forward). */
    garbageBody: merge([part(box(0.24, 0.14, 0.13), 0x3c8d40, [-0.05, 0.045, 0]), part(box(0.05, 0.11, 0.12), 0x2e6e31, [-0.19, 0.045, 0]), part(box(0.24, 0.012, 0.135), 0xe8e8e8, [-0.05, 0.1, 0])]),
    /** Police light bar on a car roof (red + blue). */
    lightBar: merge([part(box(0.03, 0.018, 0.04), 0xff3b30, [-0.02, 0.15, -0.025]), part(box(0.03, 0.018, 0.04), 0x2f6bff, [-0.02, 0.15, 0.025])]),
    /** Ambulance body: white box with a red stripe and a beacon. */
    ambulanceBody: merge([part(box(0.24, 0.14, 0.13), 0xf5f5f5, [-0.05, 0.045, 0]), part(box(0.245, 0.02, 0.132), 0xd63a3a, [-0.05, 0.1, 0]), part(box(0.03, 0.02, 0.05), 0xff3b30, [0.04, 0.195, 0])]),
  };
}
