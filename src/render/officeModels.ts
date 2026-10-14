/**
 * render/officeModels.ts — V1.5b stage H: OFFICE zone buildings
 * (Commercial ▸ Office). One merged vertex-coloured geometry per template
 * (instanced like the industry role models). 1 unit ≈ the building body's
 * shorter side; the front faces +z. Windows go on all four faces.
 *   law     — stone law firm with columns, pediment and brass sign
 *   cable   — cable company: brick office + van bay + spool yard + mast
 *   isp     — internet company: glass office, rooftop antennas, fibre cabinets
 *   data    — large data centre: windowless halls, cooling units, generators, fence
 *   cell    — cell tower: lattice mast, panel antennas, equipment shelter
 *   radio   — radio station: studio, big satellite dish, guyed mast with red lights
 */
import * as THREE from 'three';
import { box, merge, part } from './models';

const cyl = (r: number, h: number, seg = 10) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);
const GL = 0x9fd7ff, WIN = 0x3e5f7a, CONC = 0xc8c3b8, STONE = 0xd9d2c3, METAL = 0x9aa1a8, DARK = 0x3a3f45, RED = 0xd23b2e;

/** Window rows on all 4 faces of a w × d box, floors from y0 every fh. */
function ring(w: number, d: number, floors: number, y0: number, fh: number, cx = 0, cz = 0, c = WIN): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let f = 0; f < floors; f++) {
    const y = y0 + f * fh;
    const nx = Math.max(2, Math.round(w / 0.12)), nz = Math.max(2, Math.round(d / 0.12));
    for (let k = 0; k < nx; k++) { const x = cx - w / 2 + (w * (k + 0.5)) / nx; out.push(part(box(0.05, 0.06, 0.008), c, [x, y, cz + d / 2 + 0.004]), part(box(0.05, 0.06, 0.008), c, [x, y, cz - d / 2 - 0.004])); }
    for (let k = 0; k < nz; k++) { const z = cz - d / 2 + (d * (k + 0.5)) / nz; out.push(part(box(0.008, 0.06, 0.05), c, [cx + w / 2 + 0.004, y, z]), part(box(0.008, 0.06, 0.05), c, [cx - w / 2 - 0.004, y, z])); }
  }
  return out;
}
const lattice = (h: number, s: number, x: number, z: number) => {
  const o: THREE.BufferGeometry[] = [];
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) o.push(part(box(0.012, h, 0.012), 0xb8bec4, [x + dx * s, 0, z + dz * s]));
  for (let y = 0.08; y < h; y += 0.08) { o.push(part(box(s * 2, 0.008, 0.008), 0xb8bec4, [x, y, z + s]), part(box(s * 2, 0.008, 0.008), 0xb8bec4, [x, y, z - s]), part(box(0.008, 0.008, s * 2), 0xb8bec4, [x + s, y, z]), part(box(0.008, 0.008, s * 2), 0xb8bec4, [x - s, y, z])); }
  return o;
};
const plot = (c = CONC) => part(box(0.98, 0.012, 0.98), c);
const shrubs = (pts: number[][]) => pts.map(([x, z]) => part(new THREE.IcosahedronGeometry(0.035, 0).translate(0, 0.03, 0), 0x5f8f4a, [x, 0.012, z]));

export function officeModels(): Record<string, THREE.BufferGeometry> {
  return {
    law: merge([
      plot(STONE),
      part(box(0.72, 0.42, 0.5), 0xe6dfcf, [0, 0.012, -0.08]),
      part(box(0.76, 0.04, 0.54), 0xbfb6a3, [0, 0.43, -0.08]),
      part(new THREE.CylinderGeometry(0, 0.42, 0.12, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.35).translate(0, 0.53, 0.16), 0xe6dfcf), // pediment
      ...[-0.24, -0.08, 0.08, 0.24].map((x) => part(cyl(0.025, 0.36), 0xf4efe2, [x, 0.06, 0.2])),
      part(box(0.62, 0.05, 0.14), 0xd9d2c3, [0, 0.012, 0.22]), part(box(0.66, 0.03, 0.18), 0xcfc8bb, [0, 0.012, 0.26]), // steps
      part(box(0.12, 0.17, 0.01), 0x5a3a22, [0, 0.06, 0.171]), part(box(0.2, 0.04, 0.01), 0xc9a646, [0, 0.36, 0.25]), // door + brass sign
      ...ring(0.72, 0.5, 2, 0.12, 0.16, 0, -0.08),
      part(box(0.1, 0.08, 0.1), METAL, [0.2, 0.47, -0.2]), part(box(0.08, 0.06, 0.08), METAL, [-0.2, 0.47, -0.25]),
      ...shrubs([[-0.38, 0.35], [0.38, 0.35], [-0.42, -0.4], [0.42, -0.4]]),
    ]),
    cable: merge([
      plot(),
      part(box(0.5, 0.34, 0.4), 0xb5543c, [-0.2, 0.012, -0.2]), ...ring(0.5, 0.4, 2, 0.1, 0.14, -0.2, -0.2),
      part(box(0.52, 0.03, 0.42), 0x4d5560, [-0.2, 0.35, -0.2]), part(box(0.3, 0.06, 0.01), 0x2c7be5, [-0.2, 0.26, 0.006]),
      part(box(0.36, 0.22, 0.36), 0xd0d4d8, [0.28, 0.012, -0.24]), part(box(0.28, 0.17, 0.01), 0x6d747b, [0.28, 0.012, -0.055]), // van bay
      ...[[0.2, 0.25], [0.36, 0.25]].map(([x, z]) => part(box(0.12, 0.08, 0.2), 0xf2f2ee, [x, 0.012, z])), // vans
      ...[[-0.3, 0.3], [-0.12, 0.3], [-0.21, 0.18]].map(([x, z]) => part(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12).rotateX(Math.PI / 2).translate(0, 0.06, 0), 0x8a5a33, [x, 0.012, z])), // cable spools
      ...lattice(0.8, 0.03, 0.4, -0.42), part(box(0.05, 0.08, 0.02), 0xe8e8e8, [0.4, 0.7, -0.4]),
    ]),
    isp: merge([
      plot(),
      part(box(0.7, 0.5, 0.46), 0x5a7894, [0, 0.012, -0.1]), part(box(0.72, 0.03, 0.48), 0xdfe4ea, [0, 0.51, -0.1]),
      ...ring(0.7, 0.46, 3, 0.08, 0.15, 0, -0.1, GL),
      ...Array.from({ length: 4 }, (_, k) => part(box(0.71, 0.012, 0.47), 0xdfe4ea, [0, 0.16 + k * 0.15, -0.1])), // floor bands
      part(box(0.26, 0.06, 0.01), 0x7ad1ff, [0, 0.42, 0.135]),
      ...[[-0.2, -0.2], [0.05, -0.25], [0.22, -0.05]].map(([x, z]) => part(cyl(0.008, 0.18), METAL, [x, 0.52, z])),
      part(new THREE.SphereGeometry(0.06, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-1), 0xf0f0f0, [-0.15, 0.56, 0.0]),
      ...[-0.3, -0.18, -0.06].map((x) => part(box(0.08, 0.1, 0.05), 0x6d747b, [x, 0.012, 0.32])), // fibre cabinets
      ...shrubs([[0.25, 0.32], [0.38, 0.32]]),
    ]),
    data: merge([
      plot(0x9a9a92),
      part(box(0.8, 0.26, 0.56), 0xd8dade, [0, 0.012, -0.14]), part(box(0.82, 0.02, 0.58), 0x8a9096, [0, 0.27, -0.14]),
      ...Array.from({ length: 6 }, (_, k) => part(box(0.006, 0.24, 0.57), 0xa9aeb4, [-0.39 + k * 0.156, 0.012, -0.14])), // panel seams
      ...Array.from({ length: 8 }, (_, k) => part(cyl(0.035, 0.03), 0x6a7077, [-0.33 + (k % 4) * 0.22, 0.29, -0.3 + Math.floor(k / 4) * 0.25])), // rooftop chillers
      ...Array.from({ length: 8 }, (_, k) => part(cyl(0.028, 0.006), 0x2b2f33, [-0.33 + (k % 4) * 0.22, 0.32, -0.3 + Math.floor(k / 4) * 0.25])),
      part(box(0.16, 0.18, 0.01), GL, [-0.25, 0.012, 0.142]), part(box(0.3, 0.05, 0.01), 0x2c7be5, [0.15, 0.18, 0.142]),
      ...[-0.25, 0.0, 0.25].map((x) => part(box(0.16, 0.12, 0.1), 0x4f6b3a, [x, 0.012, 0.3])), // generators
      ...[-0.25, 0.0, 0.25].map((x) => part(cyl(0.012, 0.08), DARK, [x + 0.05, 0.13, 0.3])),
      ...[[-0.48, 0, 0.012, 0.96], [0.48, 0, 0.012, 0.96], [0, 0.48, 0.96, 0.012]].map(([x, z, w, d]) => part(box(w, 0.1, d), 0x7d8288, [x, 0.012, z])), // fence
      part(box(0.2, 0.06, 0.012), 0xf2d22e, [0.3, 0.07, 0.49]), // hazard sign on the gate
    ]),
    cell: merge([
      plot(0x9a9a92),
      ...lattice(1.4, 0.05, 0, -0.1),
      ...[[0.08, 0], [-0.08, 0], [0, 0.08], [0, -0.08]].map(([dx, dz]) => part(box(dz ? 0.06 : 0.015, 0.14, dz ? 0.015 : 0.06), 0xeeeeee, [dx, 1.22, -0.1 + dz])),
      ...[[0.08, 0], [-0.08, 0], [0, 0.08], [0, -0.08]].map(([dx, dz]) => part(box(dz ? 0.06 : 0.015, 0.12, dz ? 0.015 : 0.06), 0xeeeeee, [dx, 1.0, -0.1 + dz])),
      part(new THREE.SphereGeometry(0.02, 6, 4), RED, [0, 1.42, -0.1]),
      part(box(0.26, 0.16, 0.2), 0xc9ccd0, [0.25, 0.012, 0.25]), part(box(0.28, 0.02, 0.22), 0x6d747b, [0.25, 0.17, 0.25]),
      part(box(0.08, 0.06, 0.06), METAL, [0.1, 0.012, 0.32]),
      ...[[-0.48, 0, 0.012, 0.96], [0.48, 0, 0.012, 0.96], [0, 0.48, 0.96, 0.012], [0, -0.48, 0.96, 0.012]].map(([x, z, w, d]) => part(box(w, 0.08, d), 0x7d8288, [x, 0.012, z])),
    ]),
    radio: merge([
      plot(),
      part(box(0.42, 0.24, 0.32), 0xeae4d8, [-0.22, 0.012, 0.1]), ...ring(0.42, 0.32, 1, 0.1, 0.14, -0.22, 0.1),
      part(box(0.44, 0.03, 0.34), 0xb03a2e, [-0.22, 0.25, 0.1]), part(box(0.24, 0.05, 0.01), RED, [-0.22, 0.19, 0.262]), // ON AIR sign
      // Big satellite dish on a pedestal.
      part(cyl(0.03, 0.14), METAL, [0.22, 0.012, 0.18]),
      part(new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3).rotateX(-0.9).scale(1, 1, 0.6), 0xf2f2f2, [0.22, 0.22, 0.14]),
      part(cyl(0.006, 0.16), METAL, [0.22, 0.24, 0.2]),
      // Guyed mast with red aircraft lights.
      ...lattice(1.5, 0.025, -0.2, -0.3),
      ...[0.5, 1.0, 1.48].map((y) => part(new THREE.SphereGeometry(0.018, 6, 4), RED, [-0.2, y, -0.3])),
      ...[[0.25, -0.45], [-0.45, -0.45], [-0.2, 0.0]].map(([x, z]) => part(box(0.006, 1.2, 0.006).translate(0, 0.6, 0).rotateZ((x + 0.2) * -0.8).rotateX((z + 0.3) * 0.8), 0x555a60, [x, 0, z])),
    ]),
  };
}
