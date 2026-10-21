/**
 * render/serviceModels.ts — V1.5b models for city services (garbage dump / V1.6 landfill, recycling center,
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
import { landfillStageModel, slab, V3 } from './landfillModel';
import { newIndustryModels } from './industryModels';

const cyl = (r: number, h: number, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);
const WIN = 0x9fc4e8, CONC = 0xc8c3b8, BRICK = 0xb5543c, ROOFD = 0x4d5560, GRASS = 0x6fb54f, WHITE = 0xf2f2ee;

/** A row of windows on the +z face of a box of width w at height y. */
const windows = (n: number, w: number, y: number, z: number, x0 = 0, c = WIN) =>
  Array.from({ length: n }, (_, k) => part(box(w / (n * 1.8), 0.05, 0.008), c, [x0 - w / 2 + (w * (k + 0.5)) / n, y, z]));

/**
 * V1.5b stage C: SHIPPING DEPOT (2×2, svc7). Concrete yard with a
 * cross-dock warehouse (truck doors on both long sides), a rail-mounted
 * gantry crane over stacked shipping containers, a reach stacker, a gate
 * house with a barrier, light masts and a company sign.
 */
function depotModel(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [part(box(1.96, 0.012, 1.96), 0xa9a69e)];
  // Warehouse (north half), corrugated metal + dark roof, dock doors.
  p.push(part(box(1.5, 0.32, 0.6), 0x8f989f, [-0.1, 0.012, -0.55]));
  p.push(part(box(1.54, 0.025, 0.64), 0x4b535b, [-0.1, 0.332, -0.55]));
  for (let k = 0; k < 7; k++) {
    p.push(part(box(0.12, 0.2, 0.008), 0xd0d4d8, [-0.7 + k * 0.2, 0.03, -0.246]));
    p.push(part(box(0.14, 0.012, 0.06), 0x4a525a, [-0.7 + k * 0.2, 0.25, -0.22]));
    p.push(part(box(0.13, 0.012, 0.02), 0xf2c230, [-0.7 + k * 0.2, 0.012, -0.2]));
  }
  for (let k = 0; k < 4; k++) p.push(part(box(0.1, 0.05, 0.07), 0xb8bec4, [-0.6 + k * 0.35, 0.357, -0.6]));
  p.push(part(box(0.5, 0.09, 0.012), 0x2f6fb0, [0.3, 0.2, -0.246]));
  p.push(part(box(0.36, 0.025, 0.014), 0xffffff, [0.3, 0.23, -0.24]));
  // Container stacks (south half) in shipping-line colours.
  const cols = [0xc23b2e, 0x2f6fb0, 0x2f9a4c, 0xe0a32a, 0x6d757b, 0xd8d8d8];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) for (let h = 0; h < 1 + ((r + c) % 3); h++)
    p.push(part(box(0.3, 0.1, 0.12), cols[(r * 5 + c * 3 + h) % cols.length], [-0.55 + c * 0.34, 0.012 + h * 0.105, 0.2 + r * 0.17]));
  // Rail-mounted gantry crane spanning the stacks.
  for (const x of [-0.82, 0.62]) {
    p.push(part(box(0.012, 0.012, 0.75), 0x5a524a, [x, 0.012, 0.37]));
    for (const z of [0.05, 0.7]) p.push(part(box(0.04, 0.55, 0.04), 0xe0a32a, [x, 0.012, z]));
  }
  for (const z of [0.05, 0.7]) p.push(part(box(1.5, 0.05, 0.05), 0xe0a32a, [-0.1, 0.56, z]));
  p.push(part(box(0.16, 0.08, 0.7), 0xd9952a, [0.1, 0.52, 0.37]));
  p.push(part(box(0.1, 0.08, 0.1), 0x4b535b, [0.1, 0.44, 0.37]));
  p.push(part(box(0.006, 0.2, 0.006), 0x3a3a3a, [0.1, 0.25, 0.37]));
  // Reach stacker + gate house + barrier + light masts.
  p.push(part(box(0.16, 0.06, 0.08), 0xe0c22a, [0.8, 0.012, 0.15]));
  p.push(part(box(0.2, 0.012, 0.012), 0x3a3a3a, [0.7, 0.1, 0.15], [0, 0, 0.5]));
  p.push(part(box(0.14, 0.12, 0.12), 0xe8e4da, [0.85, 0.012, 0.85]));
  p.push(part(box(0.14, 0.012, 0.012), 0xd02c2c, [0.7, 0.07, 0.92]));
  for (const [x, z] of [[-0.9, -0.15], [0.9, -0.15], [-0.9, 0.9]]) {
    p.push(part(new THREE.CylinderGeometry(0.01, 0.014, 0.7, 6).translate(0, 0.35, 0), 0x7b8288, [x, 0.012, z]));
    p.push(part(box(0.08, 0.02, 0.04), 0xf2f2ee, [x, 0.71, z]));
  }
  return merge(p);
}


/**
 * V1.6: RECYCLING CENTER (1×1, svc8). A green sorting hall with a rooftop
 * solar array and a big recycling sign, an inclined conveyor feeding it, bale
 * stacks of cardboard / plastic / paper / cans, a row of colour-coded
 * drop-off bins, a shipping container, a forklift, hedges and a light mast.
 */
function recyclingModel(): THREE.BufferGeometry {
  const GREEN = 0x3f8f6a;
  const p: THREE.BufferGeometry[] = [part(box(0.96, 0.012, 0.96), 0xb4b2aa)];
  // Sorting hall: corrugated green walls (with ribs), dark roof, skylights, solar panels.
  p.push(part(box(0.62, 0.24, 0.4), GREEN, [-0.12, 0.012, -0.22]));
  for (let k = 0; k < 8; k++) p.push(part(box(0.008, 0.24, 0.008), 0x2f7455, [-0.4 + k * 0.08, 0.012, -0.016]));
  p.push(part(gable(0.66, 0.08, 0.44), 0x2f3d44, [-0.12, 0.252, -0.22]));
  for (let k = 0; k < 3; k++) {
    p.push(part(box(0.16, 0.008, 0.1), 0x1f3b66, [-0.28 + k * 0.17, 0.3, -0.31], [-0.3, 0, 0]));
    p.push(part(box(0.16, 0.008, 0.1), 0x1f3b66, [-0.28 + k * 0.17, 0.3, -0.16], [0.3, 0, 0]));
  }
  p.push(part(box(0.14, 0.15, 0.006), 0xc9cdd1, [-0.12, 0.012, -0.014])); // roll-up door
  for (let k = 1; k < 5; k++) p.push(part(box(0.14, 0.004, 0.008), 0x9aa0a6, [-0.12, 0.012 + k * 0.03, -0.012]));
  p.push(part(box(0.22, 0.012, 0.06), 0x4a525a, [-0.12, 0.17, 0.014])); // canopy over the door
  // The recycling sign: green plate on the wall with a white triangle of three bars.
  p.push(part(box(0.2, 0.1, 0.01), 0x2f9a4c, [-0.36, 0.14, -0.012]));
  p.push(part(box(0.066, 0.012, 0.006), 0xffffff, [-0.36, 0.158, -0.004]));
  p.push(part(box(0.066, 0.012, 0.006), 0xffffff, [-0.378, 0.18, -0.004], [0, 0, Math.PI / 3]));
  p.push(part(box(0.066, 0.012, 0.006), 0xffffff, [-0.342, 0.18, -0.004], [0, 0, -Math.PI / 3]));
  // Inclined conveyor from the yard up into the hall's side, on legs.
  const a: V3 = [0.3, 0.05, 0.12], b: V3 = [0.3, 0.2, -0.12];
  p.push(slab(a, b, 0.05, 0.03, 0x4d555d), slab([a[0], a[1] + 0.02, a[2]], [b[0], b[1] + 0.02, b[2]], 0.056, 0.01, 0x2b3035));
  for (const f of [0.3, 0.7]) p.push(part(box(0.012, a[1] + (b[1] - a[1]) * f, 0.012), 0x7b8288, [0.3, 0, a[2] + (b[2] - a[2]) * f]));
  p.push(part(box(0.1, 0.06, 0.1), 0x8a8f94, [0.3, 0.012, 0.18])); // feed hopper
  // Bale stacks: cardboard, plastic, paper, cans.
  const bales: Array<[number, number, number, number]> = [[0.34, -0.36, 0, 0xc39a62], [0.34, -0.36, 1, 0xc39a62], [0.2, -0.38, 0, 0x3d7cc9], [0.2, -0.38, 1, 0xe9e6dc], [0.46, -0.3, 0, 0xb8bec4], [0.08, -0.46, 0, 0x3d7cc9]];
  for (const [x, z, h, c] of bales) p.push(part(box(0.1, 0.07, 0.08), c, [x - 0.02, 0.012 + h * 0.072, z]));
  // Colour-coded drop-off bins along the front, each with a lid.
  [0x2f6fb0, 0x2f9a4c, 0xe0b52a, 0xc23b2e, 0x7d8790].forEach((c, k) => {
    p.push(part(box(0.12, 0.1, 0.1), c, [-0.38 + k * 0.14, 0.012, 0.3]));
    p.push(part(box(0.126, 0.012, 0.106), 0x2b2b2b, [-0.38 + k * 0.14, 0.112, 0.3]));
    p.push(part(box(0.05, 0.02, 0.006), 0xffffff, [-0.38 + k * 0.14, 0.07, 0.352]));
  });
  // Shipping container with ribs, back right.
  p.push(part(box(0.22, 0.1, 0.1), 0x2f6fb0, [0.34, 0.012, -0.12 - 0.1]));
  for (let k = 0; k < 5; k++) p.push(part(box(0.006, 0.1, 0.104), 0x245a86, [0.25 + k * 0.045, 0.012, -0.22]));
  // Forklift: body, mast, forks, overhead guard.
  p.push(part(box(0.07, 0.04, 0.05), 0xe0b52a, [0.05, 0.02, 0.42]));
  p.push(part(box(0.012, 0.09, 0.04), 0x555c63, [0.09, 0.02, 0.42]));
  for (const z of [-0.012, 0.012]) p.push(part(box(0.05, 0.006, 0.008), 0x555c63, [0.12, 0.022, 0.42 + z]));
  for (const [x, z] of [[0.03, 0.4], [0.03, 0.44], [0.065, 0.4], [0.065, 0.44]]) p.push(part(box(0.005, 0.05, 0.005), 0x333333, [x, 0.06, z]));
  p.push(part(box(0.05, 0.005, 0.05), 0x333333, [0.047, 0.11, 0.42]));
  for (const [x, z] of [[0.03, 0.4], [0.03, 0.44], [0.07, 0.4], [0.07, 0.44]]) p.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 8).rotateX(Math.PI / 2), 0x222222, [x, 0.012, z]));
  // Hedges along the front corners and a light mast.
  for (const s of [-1, 1]) p.push(part(box(0.2, 0.05, 0.05), 0x4f7a3a, [s * 0.36, 0.012, 0.45]));
  p.push(part(new THREE.CylinderGeometry(0.008, 0.012, 0.4, 6).translate(0, 0.2, 0), 0x7b8288, [0.4, 0.012, 0.36]));
  p.push(part(box(0.07, 0.016, 0.04), 0xf2f2ee, [0.4, 0.41, 0.36]));
  return merge(p);
}
/**
 * V1.6: ELEMENTARY SCHOOL (2×2, svc4). Two-storey brick school with a gabled
 * roof, dormers, a columned entrance portico, a clock tower with a weather
 * vane, a perpendicular classroom wing, a gym annex, a chimney; out front a
 * flag pole, school bus, basketball court and a playground (slide, swings,
 * seesaw, climbing dome, sandbox), hedges, trees, a bike rack and a sign.
 * Front faces +z. (Old 1×1 schools from early saves are drawn with this model at half size.)
 */
function elementaryModel(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [part(box(1.96, 0.012, 1.96), 0x9cc47a)];
  const STONE = 0xe3dccb, YEL = 0xf2c230;
  // ---- Main block (back), roof, dormers, chimney ----
  p.push(part(box(1.3, 0.3, 0.42), BRICK, [-0.2, 0.012, -0.6]));
  p.push(part(box(1.34, 0.012, 0.44), STONE, [-0.2, 0.152, -0.6])); // floor band
  p.push(part(box(1.34, 0.014, 0.44), STONE, [-0.2, 0.3, -0.6])); // eaves band
  p.push(part(gable(1.38, 0.17, 0.48), ROOFD, [-0.2, 0.314, -0.6]));
  p.push(...windows(7, 1.18, 0.05, -0.386, -0.2, 0xfff1c4), ...windows(7, 1.18, 0.19, -0.386, -0.2, 0xfff1c4));
  p.push(...windows(7, 1.18, 0.05, -0.814, -0.2), ...windows(7, 1.18, 0.19, -0.814, -0.2));
  for (const x of [-0.65, 0.2]) {
    p.push(part(box(0.08, 0.06, 0.07), BRICK, [x, 0.34, -0.5]));
    p.push(part(gable(0.1, 0.04, 0.09), ROOFD, [x, 0.4, -0.5]));
    p.push(part(box(0.04, 0.03, 0.006), 0xfff1c4, [x, 0.355, -0.463]));
  }
  p.push(part(box(0.05, 0.16, 0.05), 0x8a4331, [0.15, 0.32, -0.72])); // chimney
  p.push(part(box(0.06, 0.012, 0.06), 0x3a3a3a, [0.15, 0.48, -0.72]));
  // ---- Entrance portico + steps + door ----
  p.push(part(box(0.34, 0.012, 0.16), STONE, [-0.2, 0.012, -0.31]));
  p.push(part(box(0.28, 0.012, 0.05), STONE, [-0.2, 0.012, -0.21])); // steps
  p.push(part(box(0.22, 0.008, 0.03), STONE, [-0.2, 0.012, -0.17]));
  for (const x of [-0.34, -0.26, -0.14, -0.06]) p.push(part(cyl(0.014, 0.2, 8), 0xf4efe4, [x, 0.024, -0.26]));
  p.push(part(box(0.36, 0.024, 0.2), STONE, [-0.2, 0.224, -0.31]));
  p.push(part(gable(0.38, 0.08, 0.2), 0xd9d1bf, [-0.2, 0.248, -0.31]));
  p.push(part(box(0.09, 0.13, 0.008), 0x3f6fb0, [-0.2, 0.024, -0.382]));
  p.push(part(box(0.1, 0.012, 0.012), 0xffffff, [-0.2, 0.17, -0.38]));
  // ---- Clock tower, cupola and weather vane ----
  p.push(part(box(0.17, 0.27, 0.17), BRICK, [-0.2, 0.3, -0.6]));
  p.push(part(box(0.19, 0.012, 0.19), STONE, [-0.2, 0.57, -0.6]));
  p.push(part(new THREE.CylinderGeometry(0.034, 0.034, 0.008, 14).rotateX(Math.PI / 2), 0xffffff, [-0.2, 0.47, -0.511]));
  p.push(part(box(0.004, 0.026, 0.004), 0x222222, [-0.2, 0.47, -0.505]), part(box(0.02, 0.004, 0.004), 0x222222, [-0.19, 0.47, -0.505]));
  p.push(part(new THREE.ConeGeometry(0.14, 0.15, 4).rotateY(Math.PI / 4).translate(0, 0.075, 0), ROOFD, [-0.2, 0.582, -0.6]));
  p.push(part(cyl(0.004, 0.1, 5), 0x555555, [-0.2, 0.72, -0.6]), part(box(0.05, 0.016, 0.004), 0xc9971a, [-0.2, 0.8, -0.6]));
  // ---- East classroom wing (perpendicular) ----
  p.push(part(box(0.42, 0.24, 0.92), BRICK, [0.62, 0.012, -0.27]));
  p.push(part(box(0.44, 0.012, 0.94), STONE, [0.62, 0.24, -0.27]));
  p.push(part(gable(0.96, 0.15, 0.46), ROOFD, [0.62, 0.252, -0.27], [0, Math.PI / 2, 0]));
  p.push(...windows(3, 0.32, 0.06, 0.196, 0.62, 0xfff1c4), ...windows(3, 0.32, 0.15, 0.196, 0.62, 0xfff1c4));
  for (let k = 0; k < 4; k++) for (const y of [0.06, 0.15]) {
    p.push(part(box(0.008, 0.05, 0.08), WIN, [0.411, y, -0.6 + k * 0.22]));
    p.push(part(box(0.008, 0.05, 0.08), WIN, [0.829, y, -0.6 + k * 0.22]));
  }
  // ---- Gym / cafeteria annex (west) ----
  p.push(part(box(0.4, 0.18, 0.5), 0xe8dcc4, [-0.72, 0.012, -0.12]));
  p.push(part(box(0.43, 0.02, 0.53), 0x6d7a86, [-0.72, 0.192, -0.12]));
  p.push(part(box(0.1, 0.02, 0.1), 0x9aa0a6, [-0.78, 0.212, -0.1]));
  p.push(part(box(0.2, 0.09, 0.008), 0xd0d4d8, [-0.72, 0.03, 0.132])); // roll-up door
  p.push(part(box(0.2, 0.012, 0.01), 0x2f6fb0, [-0.72, 0.13, 0.134]));
  p.push(...windows(2, 0.28, 0.13, 0.133, -0.72));
  // ---- Forecourt + path ----
  p.push(part(box(0.5, 0.006, 0.34), CONC, [-0.2, 0.012, 0.0]));
  p.push(part(box(0.1, 0.006, 0.58), 0xd8cfb8, [-0.2, 0.012, 0.35]));
  p.push(part(box(0.5, 0.006, 0.26), 0x55595e, [-0.4, 0.012, 0.86])); // bus lay-by
  // ---- Flag pole ----
  p.push(part(cyl(0.007, 0.5, 6), 0xd0d0d0, [0.06, 0.012, 0.12]), part(new THREE.SphereGeometry(0.014, 6, 4), 0xc9971a, [0.06, 0.52, 0.12]));
  p.push(part(box(0.1, 0.06, 0.004), 0xd63a3a, [0.11, 0.43, 0.12]), part(box(0.1, 0.012, 0.004), 0xffffff, [0.11, 0.46, 0.12]), part(box(0.035, 0.03, 0.004), 0x2b4fa6, [0.077, 0.45, 0.12]));
  // ---- School bus ----
  p.push(part(box(0.34, 0.09, 0.1), YEL, [-0.4, 0.03, 0.86]));
  p.push(part(box(0.34, 0.012, 0.102), 0x222222, [-0.4, 0.07, 0.86]));
  p.push(part(box(0.1, 0.06, 0.098), YEL, [-0.2, 0.03, 0.86]));
  for (let k = 0; k < 6; k++) p.push(part(box(0.034, 0.03, 0.104), 0x9fd7ff, [-0.54 + k * 0.045, 0.09, 0.86]));
  for (const wx of [-0.52, -0.26]) for (const s of [-1, 1]) p.push(part(new THREE.CylinderGeometry(0.025, 0.025, 0.014, 10).rotateX(Math.PI / 2), 0x23262a, [wx, 0.027, 0.86 + s * 0.05]));
  p.push(part(box(0.01, 0.012, 0.1), 0xd02c2c, [-0.24, 0.125, 0.86]));
  // ---- Basketball court (front-left) ----
  p.push(part(box(0.46, 0.008, 0.28), 0x4a7fb0, [-0.62, 0.012, 0.5]));
  p.push(part(box(0.44, 0.002, 0.008), 0xffffff, [-0.62, 0.02, 0.5]), part(box(0.008, 0.002, 0.26), 0xffffff, [-0.62, 0.02, 0.5]));
  p.push(part(new THREE.TorusGeometry(0.04, 0.003, 4, 14).rotateX(Math.PI / 2), 0xffffff, [-0.62, 0.02, 0.5]));
  for (const x of [-0.84, -0.4]) {
    p.push(part(cyl(0.007, 0.2, 6), 0x555c63, [x, 0.012, 0.5]));
    p.push(part(box(0.006, 0.07, 0.1), 0xffffff, [x + (x < -0.6 ? 0.012 : -0.012), 0.16, 0.5]));
    p.push(part(new THREE.TorusGeometry(0.02, 0.0025, 4, 10).rotateY(Math.PI / 2), 0xe0601a, [x + (x < -0.6 ? 0.03 : -0.03), 0.16, 0.5]));
  }
  // ---- Playground (front-right): rubber surface, slide, swings, seesaw, dome, sandbox ----
  p.push(part(box(0.74, 0.008, 0.62), 0xc9553f, [0.5, 0.012, 0.58]));
  for (const [dx, dz] of [[-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04], [0.04, 0.04]]) p.push(part(box(0.008, 0.14, 0.008), 0x2f6fb0, [0.82 + dx, 0.02, 0.4 + dz]));
  p.push(part(box(0.1, 0.01, 0.1), 0xe04a3f, [0.82, 0.16, 0.4]), part(box(0.11, 0.05, 0.11), 0x2f6fb0, [0.82, 0.17, 0.4]));
  p.push(part(gable(0.12, 0.04, 0.12), 0xf2c230, [0.82, 0.22, 0.4]));
  p.push(slab([0.82, 0.16, 0.45], [0.82, 0.02, 0.65], 0.06, 0.008, 0xffd84a)); // slide
  p.push(slab([0.75, 0.15, 0.36], [0.75, 0.02, 0.3], 0.025, 0.006, 0x8a6440)); // ladder rail
  for (let k = 0; k < 4; k++) p.push(part(box(0.04, 0.006, 0.006), 0x8a6440, [0.77, 0.03 + k * 0.03, 0.33 - k * 0.012]));
  for (const x of [0.28, 0.5]) { // swings: two A-frames and a top bar
    for (const dz of [-0.07, 0.07]) p.push(slab([x, 0.012, 0.58 + dz * 1.8], [x, 0.2, 0.58], 0.01, 0.01, 0x2f6fb0));
  }
  p.push(part(box(0.24, 0.012, 0.012), 0x2f6fb0, [0.39, 0.2, 0.58]));
  for (const x of [0.33, 0.45]) { p.push(part(box(0.003, 0.15, 0.003), 0x555c63, [x, 0.05, 0.58])); p.push(part(box(0.04, 0.008, 0.02), 0x2b2b2b, [x, 0.042, 0.58])); }
  p.push(part(cyl(0.012, 0.03, 6), 0x555c63, [0.4, 0.012, 0.8]), part(box(0.2, 0.01, 0.03), 0xffd84a, [0.4, 0.04, 0.8], [0, 0, 0.14])); // seesaw
  p.push(part(new THREE.IcosahedronGeometry(0.065, 1).translate(0, 0.0, 0), 0xe04a3f, [0.66, 0.065, 0.8])); // climbing dome
  p.push(part(box(0.2, 0.03, 0.2), 0x8a6440, [0.18, 0.012, 0.8]), part(box(0.18, 0.025, 0.18), 0xe7d3a0, [0.18, 0.022, 0.8])); // sandbox
  p.push(part(cyl(0.012, 0.02, 6), 0xd63a3a, [0.14, 0.047, 0.78]), part(cyl(0.01, 0.015, 6), 0x2f6fb0, [0.22, 0.047, 0.83]));
  for (let k = 0; k < 5; k++) p.push(part(box(0.012, 0.07, 0.012), 0x8d949c, [0.12 + k * 0.17, 0.012, 0.9])); // fence posts
  p.push(part(box(0.7, 0.006, 0.006), 0xb8bec4, [0.46, 0.06, 0.9]));
  // ---- Hedges, trees, bike rack, sign ----
  for (const [x, z, w, d] of [[-0.2, -0.88, 1.3, 0.05], [-0.92, 0.2, 0.05, 0.4], [0.97, 0.2, 0.05, 0.8]]) p.push(part(box(w, 0.045, d), 0x3f8f3a, [x, 0.012, z]));
  for (const [x, z, r] of [[-0.9, -0.82, 0.12], [0.9, -0.84, 0.13], [0.9, 0.0, 0.1], [-0.9, 0.82, 0.11]]) {
    p.push(part(cyl(0.014, 0.12, 6), 0x6b4a2b, [x, 0.012, z]));
    p.push(part(new THREE.IcosahedronGeometry(r, 0).translate(0, 0.2, 0), 0x3f8f3a, [x, 0, z]));
  }
  p.push(part(box(0.1, 0.006, 0.03), 0x8d949c, [0.02, 0.012, 0.36]));
  for (let k = 0; k < 3; k++) p.push(part(new THREE.TorusGeometry(0.014, 0.002, 4, 8), 0x8d949c, [-0.02 + k * 0.04, 0.03, 0.36]));
  p.push(part(box(0.3, 0.09, 0.008), 0x2b6fd6, [-0.2, 0.06, 0.93]), part(box(0.28, 0.014, 0.01), 0xffffff, [-0.2, 0.1, 0.93]));
  for (const x of [-0.34, -0.06]) p.push(part(box(0.01, 0.07, 0.01), 0x6b4a2b, [x, 0.012, 0.93]));
  return merge(p);
}

/**
 * V1.6: POLICE STATION (2×2, svc1). A precinct house with a blue band, columned
 * entrance and sign, a three-bay patrol garage on the left, a holding block with
 * a helipad roof on the right, radio mast and dish, a front car park with patrol
 * cars and a motorcycle, flag poles, lamp posts, bollards, planters and a fence.
 * Front faces +z. (Old 1×1 stations from early saves are drawn with this model at half size.)
 */
function policeModel(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [part(box(1.96, 0.012, 1.96), 0xb9b6ad)];
  const BLUE_P = 0x24529e, PALE = 0xeef1f5, STONE = 0xd9d6cc;
  /** Patrol car (white body, blue stripe, light bar) at (x, z) turned by yaw. */
  const car = (x: number, z: number, yaw: number) => {
    const c: THREE.BufferGeometry[] = [
      part(box(0.2, 0.04, 0.09), 0xf4f6f8, [0, 0.02, 0]),
      part(box(0.11, 0.035, 0.08), 0xf4f6f8, [-0.01, 0.06, 0]),
      part(box(0.112, 0.012, 0.082), 0x2b2e31, [-0.01, 0.07, 0]),
      part(box(0.205, 0.012, 0.092), BLUE_P, [0, 0.032, 0]),
      part(box(0.03, 0.01, 0.07), 0xff3b30, [-0.02, 0.098, -0.016]), part(box(0.03, 0.01, 0.07), 0x2f6bff, [-0.02, 0.098, 0.016]),
    ];
    for (const wx of [-0.065, 0.065]) for (const s of [-1, 1]) c.push(part(new THREE.CylinderGeometry(0.02, 0.02, 0.014, 8).rotateX(Math.PI / 2), 0x222222, [wx, 0.02, s * 0.047]));
    c.push(part(box(0.004, 0.015, 0.02), 0xfff3b0, [0.101, 0.03, 0.028]), part(box(0.004, 0.015, 0.02), 0xfff3b0, [0.101, 0.03, -0.028]));
    for (const g of c) g.rotateY(yaw).translate(x, 0.012, z);
    return c;
  };
  // ---- Precinct house (back centre) ----
  p.push(part(box(0.84, 0.4, 0.5), PALE, [0, 0.012, -0.62]));
  p.push(part(box(0.88, 0.05, 0.54), BLUE_P, [0, 0.38, -0.62])); // blue cornice band
  p.push(part(box(0.9, 0.02, 0.56), 0x4d555d, [0, 0.43, -0.62])); // roof slab
  p.push(part(box(0.86, 0.03, 0.02), STONE, [0, 0.45, -0.88]), part(box(0.86, 0.03, 0.02), STONE, [0, 0.45, -0.36])); // parapet
  p.push(...windows(6, 0.74, 0.1, -0.366, 0, 0xcfe6ff), ...windows(6, 0.74, 0.25, -0.366, 0, 0xcfe6ff));
  p.push(...windows(6, 0.74, 0.1, -0.874, 0), ...windows(6, 0.74, 0.25, -0.874, 0));
  for (let k = 0; k < 4; k++) p.push(part(box(0.012, 0.36, 0.012), STONE, [-0.4 + k * 0.267, 0.02, -0.366])); // pilasters
  // Entrance portico
  p.push(part(box(0.3, 0.012, 0.14), STONE, [0, 0.012, -0.3]));
  p.push(part(box(0.26, 0.012, 0.04), STONE, [0, 0.012, -0.22]));
  for (const x of [-0.12, 0.12]) p.push(part(cyl(0.014, 0.2, 8), 0xf4efe4, [x, 0.024, -0.27]));
  p.push(part(box(0.3, 0.03, 0.15), BLUE_P, [0, 0.224, -0.3]));
  p.push(part(box(0.12, 0.17, 0.008), 0x3a5a7a, [0, 0.024, -0.366])); // glass doors
  p.push(part(box(0.004, 0.17, 0.01), 0xffffff, [0, 0.024, -0.364]));
  p.push(part(box(0.34, 0.07, 0.01), BLUE_P, [0, 0.28, -0.356]), part(box(0.28, 0.02, 0.012), 0xffffff, [0, 0.305, -0.352])); // POLICE sign
  for (const x of [-0.19, 0.19]) { p.push(part(cyl(0.008, 0.1, 6), 0x555c63, [x, 0.024, -0.3])); p.push(part(new THREE.SphereGeometry(0.02, 8, 6), 0x3f7fff, [x, 0.13, -0.3])); } // blue lamps
  // Roof: mast, dish, AC units
  p.push(part(cyl(0.006, 0.34, 5), 0x555c63, [0.3, 0.45, -0.7]), part(box(0.06, 0.004, 0.004), 0x555c63, [0.3, 0.72, -0.7]), part(box(0.004, 0.004, 0.06), 0x555c63, [0.3, 0.7, -0.7]));
  p.push(part(new THREE.SphereGeometry(0.04, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-1.2), 0xdadde0, [-0.28, 0.5, -0.72]));
  p.push(part(box(0.1, 0.05, 0.08), 0x9aa0a6, [-0.05, 0.45, -0.78]), part(box(0.1, 0.05, 0.08), 0x9aa0a6, [0.1, 0.45, -0.78]));
  // ---- Patrol garage (left wing): three roller doors ----
  p.push(part(box(0.5, 0.22, 0.5), 0xcfd5db, [-0.7, 0.012, -0.62]));
  p.push(part(box(0.54, 0.02, 0.54), 0x4d555d, [-0.7, 0.232, -0.62]));
  for (let k = 0; k < 3; k++) {
    p.push(part(box(0.12, 0.15, 0.008), 0xb8bec4, [-0.84 + k * 0.14, 0.012, -0.366]));
    for (let r = 0; r < 4; r++) p.push(part(box(0.12, 0.004, 0.01), 0x8d949c, [-0.84 + k * 0.14, 0.04 + r * 0.035, -0.364]));
  }
  p.push(part(box(0.5, 0.025, 0.012), BLUE_P, [-0.7, 0.19, -0.366]));
  // ---- Holding block (right wing) with helipad ----
  p.push(part(box(0.5, 0.3, 0.5), 0xbfc4ca, [0.7, 0.012, -0.62]));
  p.push(part(box(0.54, 0.02, 0.54), 0x4d555d, [0.7, 0.312, -0.62]));
  for (let k = 0; k < 4; k++) for (const y of [0.1, 0.22]) p.push(part(box(0.03, 0.05, 0.008), 0x2b2e31, [0.55 + k * 0.1, y, -0.366])); // barred slit windows
  p.push(part(new THREE.CylinderGeometry(0.2, 0.2, 0.01, 18), 0x6d757b, [0.7, 0.33, -0.62])); // helipad
  p.push(part(new THREE.TorusGeometry(0.17, 0.006, 4, 18).rotateX(Math.PI / 2), 0xf2c230, [0.7, 0.34, -0.62]));
  p.push(part(box(0.016, 0.003, 0.1), 0xffffff, [0.65, 0.341, -0.62]), part(box(0.016, 0.003, 0.1), 0xffffff, [0.75, 0.341, -0.62]), part(box(0.1, 0.003, 0.016), 0xffffff, [0.7, 0.341, -0.62]));
  // ---- Car park, cars, motorcycle ----
  p.push(part(box(1.6, 0.006, 0.55), 0x55575a, [0, 0.012, 0.02]));
  for (let k = 0; k <= 6; k++) p.push(part(box(0.006, 0.002, 0.15), 0xffffff, [-0.6 + k * 0.2, 0.019, -0.04]));
  p.push(...car(-0.5, -0.04, Math.PI / 2), ...car(-0.1, -0.04, -Math.PI / 2), ...car(0.3, 0.3, 0.0));
  p.push(part(box(0.1, 0.03, 0.03), 0x23262a, [0.58, 0.012, -0.02]), part(box(0.035, 0.03, 0.03), 0xf4f6f8, [0.62, 0.03, -0.02]));
  for (const x of [0.54, 0.62]) p.push(part(new THREE.CylinderGeometry(0.016, 0.016, 0.01, 8).rotateX(Math.PI / 2), 0x222222, [x, 0.028, -0.02]));
  // ---- Front yard: flag poles, lamp posts, bollards, planters, hedge, fence ----
  for (const [x, c] of [[-0.2, 0xd63a3a], [0.2, BLUE_P]] as const) {
    p.push(part(cyl(0.006, 0.42, 6), 0xd0d0d0, [x, 0.012, 0.5]), part(new THREE.SphereGeometry(0.012, 6, 4), 0xc9971a, [x, 0.44, 0.5]));
    p.push(part(box(0.1, 0.06, 0.004), c, [x + 0.05, 0.36, 0.5]));
  }
  for (const [x, z] of [[-0.9, 0.3], [0.9, 0.3], [-0.9, 0.85], [0.9, 0.85]] as const) {
    p.push(part(cyl(0.006, 0.3, 6), 0x555c63, [x, 0.012, z]), part(box(0.05, 0.012, 0.03), 0xfff3c4, [x, 0.31, z]));
  }
  for (let k = 0; k < 9; k++) p.push(part(cyl(0.012, 0.045, 6), 0xf2c230, [-0.4 + k * 0.1, 0.012, 0.3])); // bollards
  for (const x of [-0.45, 0.45]) { p.push(part(box(0.2, 0.05, 0.07), 0x8a8f94, [x, 0.012, 0.58])); p.push(part(new THREE.IcosahedronGeometry(0.05, 0).translate(0, 0.08, 0), 0x3f8f3a, [x, 0.012, 0.58])); }
  p.push(part(box(0.44, 0.05, 0.05), 0x3f8f3a, [0.6, 0.012, 0.95]), part(box(0.44, 0.05, 0.05), 0x3f8f3a, [-0.6, 0.012, 0.95]));
  for (let k = 0; k < 8; k++) p.push(part(box(0.008, 0.07, 0.008), 0x3a3f46, [-0.95 + k * 0.27, 0.012, -0.96]));
  p.push(part(box(1.9, 0.006, 0.006), 0x3a3f46, [0, 0.06, -0.96]));
  p.push(part(box(0.3, 0.1, 0.008), BLUE_P, [0, 0.07, 0.96]), part(box(0.26, 0.014, 0.01), 0xffffff, [0, 0.12, 0.96])); // street sign
  for (const x of [-0.12, 0.12]) p.push(part(box(0.01, 0.07, 0.01), 0x6b4a2b, [x, 0.012, 0.96]));
  return merge(p);
}

/**
 * IND-8: RAIL YARD add-on for the 2×2 depot (centred on the block): two
 * tracks on ballast along the south edge (sleepers + rails) with a short
 * freight train — locomotive and three container wagons — and buffer stops.
 */
function railAddon(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [];
  for (const z of [0.62, 0.84]) {
    p.push(part(box(1.94, 0.016, 0.16), 0x8a8478, [0, 0.012, z])); // ballast
    for (let k = 0; k < 24; k++) p.push(part(box(0.025, 0.008, 0.13), 0x5c4a3a, [-0.92 + k * 0.08, 0.028, z])); // sleepers
    for (const dz of [-0.04, 0.04]) p.push(part(box(1.94, 0.01, 0.01), 0xb8bec4, [0, 0.036, z + dz])); // rails
    for (const x of [-0.95, 0.95]) p.push(part(box(0.03, 0.05, 0.12), 0xc23b2e, [x, 0.028, z])); // buffer stops
  }
  // Train on the outer track: loco + three container wagons.
  p.push(part(box(0.32, 0.14, 0.11), 0xf2c230, [-0.55, 0.046, 0.84]), part(box(0.12, 0.05, 0.1), 0x2b2e31, [-0.62, 0.186, 0.84]));
  const C = [0x2f6db5, 0xc23b2e, 0x3f8f3a];
  for (let k = 0; k < 3; k++) { p.push(part(box(0.3, 0.02, 0.1), 0x3a3f46, [-0.18 + k * 0.34, 0.046, 0.84]), part(box(0.28, 0.11, 0.1), C[k], [-0.18 + k * 0.34, 0.066, 0.84])); }
  return merge(p);
}

/**
 * IND-9: TECH CAMPUS (1×1, front = +z). Two glass office blocks linked by a
 * sky bridge, a rooftop solar array and a dish, a green courtyard with
 * trees, bike racks and a sign. Glass is a light blue so the texture skinner
 * reads it as windows.
 */
function techCampusModel(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [part(box(0.96, 0.012, 0.96), 0xbfc3c0)];
  const GLASS = 0x8fc7e8, FRAME = 0xe8ecef;
  p.push(part(box(0.38, 0.42, 0.34), GLASS, [-0.22, 0.012, -0.2]), part(box(0.4, 0.02, 0.36), FRAME, [-0.22, 0.432, -0.2]));
  p.push(part(box(0.34, 0.28, 0.4), GLASS, [0.24, 0.012, -0.16]), part(box(0.36, 0.02, 0.42), FRAME, [0.24, 0.292, -0.16]));
  for (let k = 1; k < 5; k++) p.push(part(box(0.385, 0.008, 0.345), FRAME, [-0.22, 0.012 + k * 0.084, -0.2])); // floor bands
  for (let k = 1; k < 4; k++) p.push(part(box(0.345, 0.008, 0.405), FRAME, [0.24, 0.012 + k * 0.07, -0.16]));
  p.push(part(box(0.12, 0.05, 0.08), GLASS, [0.01, 0.2, -0.2])); // sky bridge
  for (let k = 0; k < 3; k++) p.push(part(box(0.09, 0.008, 0.26).rotateX(-0.3), 0x24384f, [0.15 + k * 0.1, 0.32, -0.16])); // solar panels
  p.push(part(cyl(0.008, 0.06, 6), 0xd0d0d0, [-0.3, 0.442, -0.26]), part(new THREE.SphereGeometry(0.04, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI * 0.7), 0xf2f2f2, [-0.3, 0.5, -0.26])); // dish
  p.push(part(box(0.86, 0.006, 0.36), 0x6fae55, [0, 0.012, 0.26])); // courtyard lawn
  for (const [x, z] of [[-0.35, 0.2], [0.35, 0.3], [-0.1, 0.36], [0.15, 0.18]] as const) p.push(part(cyl(0.01, 0.06, 6), 0x6b4a2b, [x, 0.018, z]), part(new THREE.IcosahedronGeometry(0.05, 0).translate(0, 0.1, 0), 0x3f8f3a, [x, 0.018, z]));
  p.push(part(box(0.2, 0.006, 0.36), 0xd8d4cc, [0, 0.02, 0.26])); // path
  for (let k = 0; k < 4; k++) p.push(part(box(0.006, 0.03, 0.04), 0x3a3f46, [0.3 + k * 0.03, 0.018, 0.1])); // bike racks
  p.push(part(box(0.2, 0.06, 0.02), 0x7a4fd6, [0, 0.02, 0.46]), part(box(0.16, 0.014, 0.022), 0xffffff, [0, 0.05, 0.46])); // sign
  return merge(p);
}

export function serviceModels(): Record<string, THREE.BufferGeometry> {
  return {
    svc7: depotModel(), // V1.5b stage C
    svc7rail: merge([depotModel(), railAddon()]), // IND-8: depot with a rail yard
    svc8: recyclingModel(), // V1.6
    svc10: techCampusModel(), // IND-9
    svc9: newIndustryModels().warehouse, // IND-7: the distribution-centre model (already drawn for warehouse lots)
    // V1.6: the 2×2 landfill, one geometry per fill stage (renderer picks svc0_<stage>).
    ...Object.fromEntries(Array.from({ length: 6 }, (_, k) => [`svc0_${k}`, landfillStageModel(k)])),
    svc1: policeModel(), // V1.6: the 2×2 station
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
    svc4: elementaryModel(), // V1.6: the 2×2 school
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
