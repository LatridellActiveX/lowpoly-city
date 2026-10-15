/**
 * render/oilPlantModel.ts — V1.6: the 2×2 OIL-FIRED POWER PLANT.
 *
 * Authored in world units for the whole 2×2 footprint, centred on the origin
 * (x, z ∈ −1 … 1), so the renderer places it at the footprint centre with
 * scale 1 (same convention as coalModel.ts). Layout by quadrant (−z = "north"):
 *   NW  boiler house with two banded stacks, a furnace, a tall fractionating
 *       column and a shorter one, with ring platforms and ladders
 *   NE  turbine hall (ridge roof, clerestory, generator), a transformer yard
 *       with radiators + a gantry, a lattice FLARE STACK with a flame
 *   SW  bunded tank farm: three floating-roof crude tanks with stairs, gauge
 *       wells and roof drains
 *   SE  tanker loading rack with two trucks, a fire-water tank, a gatehouse
 *   mid control room, pump house, two horizontal bullet tanks on saddles,
 *       valve manifolds and pipe racks linking everything
 * Windows, the flare flame and the beacons go in a separate `lights`
 * geometry so they glow at night (window-glow material).
 *
 * `detail` false (low Detail setting) drops the small parts (railings,
 * valves, insulators, ladders, wheel hubs) to keep the triangle count low.
 */
import * as THREE from 'three';
import { gable, merge, part } from './models';
import { slab } from './landfillModel';

type V3 = [number, number, number];
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
const cyl = (r: number, h: number, seg = 14) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);
const BLUE = 0x5a7fa6, BLUE_D = 0x3d4f63, METAL = 0x9aa3a8, METAL_D = 0x6d757b, CONC = 0xb4b0a6, ASPH = 0x55575a, STEEL = 0x7b8288;
const RED = 0xc23b2e, WHITE = 0xeeeeea, YEL = 0xe0b52a, GREEN = 0x3f8f3a, PIPE = 0x8d8f91;

/** Smoke-emitting stack tops (model space) — the renderer adds puffs here. */
export const OIL_STACKS: V3[] = [[-0.8, 1.62, -0.92], [-0.52, 1.42, -0.94]];

export function bigOilModel(detail = true): { solid: THREE.BufferGeometry; lights: THREE.BufferGeometry } {
  const P: THREE.BufferGeometry[] = [];
  const L: THREE.BufferGeometry[] = [];
  const Y = 0.04; // top of the site slab

  // ---- Reusable parts ------------------------------------------------------
  /** Horizontal pipe from a to b (round, via a stretched cylinder). */
  const pipe = (a: V3, b: V3, r = 0.012, color = PIPE) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    P.push(part(g, color));
  };
  /** A valve wheel + body on a pipe. */
  const valve = (x: number, y: number, z: number, along: 'x' | 'z' = 'x') => {
    if (!detail) return;
    P.push(part(box(along === 'x' ? 0.03 : 0.02, 0.025, along === 'x' ? 0.02 : 0.03), 0x3d4a55, [x, y - 0.012, z]));
    P.push(part(new THREE.TorusGeometry(0.014, 0.003, 4, 8).rotateX(Math.PI / 2), RED, [x, y + 0.03, z]));
    P.push(part(cyl(0.003, 0.03, 4), METAL_D, [x, y + 0.012, z]));
  };
  /** Ring platform with a railing around a vertical column of radius r at height y. */
  const ring = (x: number, y: number, z: number, r: number) => {
    P.push(part(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.008, 12), METAL_D, [x, y, z]));
    if (detail) P.push(part(new THREE.TorusGeometry(r + 0.03, 0.0025, 3, 12).rotateX(Math.PI / 2), STEEL, [x, y + 0.03, z]));
  };
  /** Floating-roof crude tank with stair, gauge well and top ring. */
  const tank = (x: number, z: number, r: number, h: number, stairSide: number) => {
    P.push(part(cyl(r, h, 18), WHITE, [x, Y, z]));
    P.push(part(new THREE.CylinderGeometry(r + 0.006, r + 0.006, 0.012, 18), METAL_D, [x, Y + h * 0.35, z])); // stiffening band
    P.push(part(new THREE.CylinderGeometry(r + 0.006, r + 0.006, 0.012, 18), METAL_D, [x, Y + h * 0.68, z]));
    P.push(part(new THREE.CylinderGeometry(r - 0.008, r - 0.008, 0.012, 18), 0x9a9f9f, [x, Y + h - 0.035, z])); // floating roof
    P.push(part(new THREE.TorusGeometry(r, 0.004, 4, 18).rotateX(Math.PI / 2), STEEL, [x, Y + h + 0.012, z])); // handrail ring
    P.push(part(cyl(0.01, 0.04, 6), STEEL, [x, Y + h - 0.035, z - r * 0.4])); // gauge well
    P.push(part(box(0.03, 0.006, 0.03), RED, [x + r * 0.3, Y + h - 0.03, z + r * 0.2])); // roof drain
    // stair: diagonal slab up the side to the ring
    const sx = x + Math.cos(stairSide) * (r + 0.012), sz = z + Math.sin(stairSide) * (r + 0.012);
    const ex = x + Math.cos(stairSide + 1.1) * (r + 0.012), ez = z + Math.sin(stairSide + 1.1) * (r + 0.012);
    P.push(slab([sx, Y + 0.01, sz], [ex, Y + h + 0.012, ez], 0.022, 0.008, YEL));
    if (detail) P.push(part(new THREE.SphereGeometry(0.01, 5, 3), 0xff3020, [x, Y + h + 0.03, z])); // beacon
    // foundation ring + manway
    P.push(part(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.012, 18), CONC, [x, Y, z]));
    P.push(part(cyl(0.02, 0.03, 8), METAL_D, [x - Math.cos(stairSide) * r, Y + 0.04, z - Math.sin(stairSide) * r], [0, 0, Math.PI / 2]));
  };
  /** Horizontal bullet tank on two saddles. */
  const bullet = (x: number, z: number, len: number, r: number) => {
    const body = new THREE.CylinderGeometry(r, r, len, 12).rotateZ(Math.PI / 2);
    P.push(part(body, WHITE, [x, Y + 0.035 + r, z]));
    for (const s of [-1, 1]) {
      P.push(part(new THREE.SphereGeometry(r, 12, 6).scale(0.5, 1, 1), WHITE, [x + s * len / 2, Y + 0.035 + r, z]));
      P.push(part(box(0.02, 0.035 + r * 0.6, r * 1.8), CONC, [x + s * len * 0.3, Y, z]));
    }
    P.push(part(cyl(0.012, 0.03, 6), METAL_D, [x, Y + 0.035 + r * 2 - 0.004, z])); // dome
    if (detail) P.push(part(box(len * 0.9, 0.006, 0.02), YEL, [x, Y + 0.035 + r * 2 + 0.008, z])); // walkway
  };
  /** Transformer: tank, radiator fins, bushings. */
  const transformer = (x: number, z: number) => {
    P.push(part(box(0.15, 0.085, 0.1), 0x6e7f77, [x, Y, z]));
    P.push(part(box(0.16, 0.012, 0.11), 0x4d555d, [x, Y + 0.085, z]));
    for (let k = 0; k < 5; k++) P.push(part(box(0.01, 0.07, 0.04), METAL, [x - 0.06 + k * 0.03, Y + 0.008, z + 0.07]));
    for (const dx of [-0.045, 0, 0.045]) {
      P.push(part(cyl(0.011, 0.05, 6), 0xd8d0c0, [x + dx, Y + 0.097, z - 0.02]));
      if (detail) for (let k = 0; k < 3; k++) P.push(part(new THREE.CylinderGeometry(0.018, 0.018, 0.005, 6), 0xd8d0c0, [x + dx, Y + 0.115 + k * 0.014, z - 0.02]));
    }
  };
  /** Tanker truck heading +x. */
  const truck = (x: number, z: number) => {
    P.push(part(box(0.2, 0.02, 0.07), 0x33373c, [x, Y + 0.02, z]));
    P.push(part(new THREE.CylinderGeometry(0.037, 0.037, 0.15, 10).rotateZ(Math.PI / 2), 0xd9dde0, [x - 0.025, Y + 0.065, z]));
    P.push(part(box(0.15, 0.008, 0.012), YEL, [x - 0.025, Y + 0.1, z]));
    P.push(part(box(0.05, 0.05, 0.065), 0xd02c2c, [x + 0.075, Y + 0.025, z]));
    P.push(part(box(0.004, 0.025, 0.05), 0x9fd7ff, [x + 0.101, Y + 0.05, z]));
    for (const wx of [-0.07, -0.02, 0.07]) for (const s of [-1, 1]) P.push(part(new THREE.CylinderGeometry(0.019, 0.019, 0.015, 8).rotateX(Math.PI / 2), 0x23262a, [x + wx, Y + 0.022, z + s * 0.036]));
  };

  // ---- Site: slab, road, verges ---------------------------------------------
  P.push(part(box(1.98, 0.04, 1.98), 0x8f8d86));
  P.push(part(box(1.9, 0.005, 0.12), ASPH, [0, Y, 0.15])); // internal E–W road
  P.push(part(box(0.12, 0.005, 0.6), ASPH, [0.0, Y, 0.65])); // spur to the south gate
  for (let k = 0; k < 8; k++) P.push(part(box(0.06, 0.002, 0.008), 0xf2e6a0, [-0.84 + k * 0.24, Y + 0.005, 0.15]));
  for (const [x, z, w, d] of [[0, -0.98, 1.98, 0.02], [0, 0.98, 1.98, 0.02], [-0.98, 0, 0.02, 1.98], [0.98, 0, 0.02, 1.98]] as const) P.push(part(box(w, 0.04, d), CONC, [x, 0.0, z])); // kerb

  // ---- NW: boiler house + stacks --------------------------------------------
  P.push(part(box(0.62, 0.62, 0.5), BLUE, [-0.55, Y, -0.62]));
  P.push(part(box(0.66, 0.03, 0.54), BLUE_D, [-0.55, Y + 0.62, -0.62])); // roof
  P.push(part(box(0.3, 0.12, 0.28), METAL_D, [-0.62, Y + 0.65, -0.62])); // roof plant
  for (let k = 0; k < 6; k++) P.push(part(box(0.62, 0.008, 0.5), BLUE_D, [-0.55, Y + 0.08 + k * 0.1, -0.62])); // cladding seams
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    L.push(part(box(0.07, 0.08, 0.006), 0x9fd7ff, [-0.77 + c * 0.14, Y + 0.12 + r * 0.17, -0.367])); // south face
    L.push(part(box(0.006, 0.08, 0.07), 0x9fd7ff, [-0.243, Y + 0.12 + r * 0.17, -0.8 + c * 0.14])); // east face
  }
  P.push(part(box(0.12, 0.17, 0.008), 0x3a3a3a, [-0.4, Y, -0.366])); // roller door
  for (const [x, top, z] of OIL_STACKS) {
    const h = top - Y;
    P.push(part(new THREE.CylinderGeometry(0.05, 0.085, h, 12).translate(0, h / 2, 0), CONC, [x, Y, z]));
    for (const f of [0.6, 0.76, 0.92]) P.push(part(new THREE.CylinderGeometry(0.056, 0.056, h * 0.07, 12), f === 0.76 ? WHITE : RED, [x, Y + h * f, z]));
    P.push(part(new THREE.TorusGeometry(0.058, 0.01, 4, 12).rotateX(Math.PI / 2), METAL_D, [x, top - 0.01, z]));
    ring(x, Y + h * 0.5, z, 0.07);
    if (detail) { P.push(part(new THREE.SphereGeometry(0.014, 5, 3), 0xff3020, [x, top + 0.012, z])); P.push(part(box(0.006, h * 0.55, 0.01), METAL_D, [x + 0.07, Y + h * 0.2, z])); }
  }
  pipe([-0.8, 0.5, -0.9], [-0.55, 0.62, -0.9], 0.03, METAL_D); // flue ducts feeding the stacks
  pipe([-0.55, 0.55, -0.9], [-0.55, 0.66, -0.78], 0.03, METAL_D);
  // furnace + columns
  P.push(part(box(0.2, 0.2, 0.2), 0x8e4f3c, [-0.12, Y, -0.45]));
  P.push(part(box(0.22, 0.02, 0.22), 0x6f3b2d, [-0.12, Y + 0.2, -0.45]));
  P.push(part(cyl(0.025, 0.18, 8), METAL_D, [-0.12, Y + 0.22, -0.45]));
  L.push(part(box(0.05, 0.03, 0.006), 0xff8a2a, [-0.12, Y + 0.09, -0.348])); // peephole glow
  for (const [x, z, r, h] of [[-0.12, -0.72, 0.07, 1.12], [0.06, -0.74, 0.055, 0.82]] as const) {
    P.push(part(new THREE.CylinderGeometry(r, r * 1.1, h, 14).translate(0, h / 2, 0), 0xc3c8cc, [x, Y, z]));
    P.push(part(new THREE.SphereGeometry(r, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0xc3c8cc, [x, Y + h, z]));
    for (let k = 1; k <= 5; k++) P.push(part(new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.014, 14), STEEL, [x, Y + h * (k / 6), z])); // weld bands
    for (const f of [0.35, 0.62, 0.86]) ring(x, Y + h * f, z, r);
    if (detail) {
      P.push(part(box(0.008, h * 0.92, 0.008), STEEL, [x + r + 0.02, Y, z])); // ladder rails
      for (let k = 0; k < 10; k++) P.push(part(box(0.022, 0.004, 0.004), STEEL, [x + r + 0.02, Y + 0.05 + k * h * 0.09, z]));
      P.push(part(new THREE.SphereGeometry(0.012, 5, 3), 0xff3020, [x, Y + h + r * 0.9, z]));
    }
  }
  pipe([-0.12, Y + 0.3, -0.53], [-0.12, Y + 0.3, -0.7], 0.014); // furnace → column
  pipe([-0.05, 0.9, -0.74], [0.01, 0.78, -0.74], 0.012); // overhead vapour line between columns
  pipe([-0.12, 0.98, -0.72], [-0.05, 0.9, -0.74], 0.012);

  // ---- NE: turbine hall, generator, transformer yard, flare -------------------
  P.push(part(box(0.7, 0.4, 0.42), METAL, [0.58, Y, -0.72]));
  P.push(part(gable(0.74, 0.11, 0.46), 0x55606a, [0.58, Y + 0.4, -0.72]));
  for (let c = 0; c < 6; c++) L.push(part(box(0.07, 0.1, 0.006), 0x9fd7ff, [0.35 + c * 0.105, Y + 0.2, -0.508])); // south windows
  P.push(part(box(0.5, 0.05, 0.1), 0x4d555d, [0.58, Y + 0.51, -0.72])); // clerestory
  for (let c = 0; c < 5; c++) L.push(part(box(0.06, 0.03, 0.006), 0xfff1c4, [0.4 + c * 0.09, Y + 0.525, -0.67]));
  P.push(part(box(0.12, 0.17, 0.008), 0x3a3a3a, [0.9, Y, -0.508]));
  P.push(part(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 12).rotateZ(Math.PI / 2), 0x6a8faf, [0.58, Y + 0.1, -0.52])); // generator on a pad outside the hall
  P.push(part(box(0.3, 0.035, 0.1), CONC, [0.58, Y, -0.52]));
  for (const dx of [-0.12, 0.12]) P.push(part(box(0.025, 0.05, 0.08), CONC, [0.58 + dx, Y, -0.52]));
  for (let k = 0; k < 2; k++) { // intake silencer stacks on the roof
    P.push(part(cyl(0.035, 0.16, 8), METAL_D, [0.34 + k * 0.5, Y + 0.51, -0.85]));
    P.push(part(new THREE.ConeGeometry(0.04, 0.03, 8).translate(0, 0.015, 0), METAL_D, [0.34 + k * 0.5, Y + 0.67, -0.85]));
  }
  // transformer yard + gantry
  P.push(part(box(0.62, 0.006, 0.34), 0xa8a39a, [0.62, Y, -0.22])); // gravel
  transformer(0.42, -0.2);
  transformer(0.66, -0.2);
  transformer(0.9 - 0.04, -0.2);
  for (const x of [0.36, 0.78, 0.94]) P.push(part(box(0.016, 0.22, 0.016), STEEL, [x, Y, -0.36]));
  P.push(part(box(0.6, 0.014, 0.014), STEEL, [0.65, Y + 0.22, -0.36]));
  if (detail) for (let k = 0; k < 6; k++) P.push(part(cyl(0.007, 0.03, 5), 0xd8d0c0, [0.4 + k * 0.1, Y + 0.19, -0.36]));
  for (const x of [0.4, 0.66, 0.86]) pipe([x, Y + 0.17, -0.36], [x, Y + 0.12, -0.22], 0.003, 0x333333);
  // lattice flare stack with a flame
  const FB = [0.935, Y, 0.0] as V3, FT = [0.935, 1.32, 0.0] as V3;
  for (const [dx, dz] of [[-0.035, -0.035], [0.035, -0.035], [-0.035, 0.035], [0.035, 0.035]]) P.push(slab([FB[0] + dx, Y, FB[2] + dz], [FT[0] + dx * 0.25, FT[1] - 0.06, FT[2] + dz * 0.25], 0.008, 0.008, STEEL));
  for (let k = 0; k < 8; k++) {
    const y0 = Y + 0.02 + k * 0.16, y1 = y0 + 0.16, f0 = 1 - k * 0.09, f1 = 1 - (k + 1) * 0.09;
    P.push(slab([FB[0] - 0.035 * f0, y0, FB[2] - 0.035 * f0], [FB[0] + 0.035 * f1, y1, FB[2] - 0.035 * f1], 0.005, 0.004, METAL_D));
    P.push(slab([FB[0] + 0.035 * f0, y0, FB[2] - 0.035 * f0], [FB[0] - 0.035 * f1, y1, FB[2] - 0.035 * f1], 0.005, 0.004, METAL_D));
    if (detail) P.push(part(box(0.07 * f1, 0.004, 0.07 * f1), STEEL, [FB[0], y1, FB[2]]));
  }
  P.push(part(new THREE.CylinderGeometry(0.02, 0.014, 0.1, 8).translate(0, 0.05, 0), METAL_D, [FT[0], FT[1] - 0.06, FT[2]])); // flare tip
  L.push(part(new THREE.ConeGeometry(0.035, 0.14, 7).translate(0, 0.07, 0), 0xff8a2a, [FT[0], FT[1] + 0.03, FT[2]]));
  L.push(part(new THREE.ConeGeometry(0.018, 0.08, 6).translate(0, 0.04, 0), 0xffe08a, [FT[0], FT[1] + 0.03, FT[2]]));
  pipe([0.935, Y + 0.05, 0.06], [0.935, Y + 0.05, 0.4], 0.012); // knock-out drum line
  P.push(part(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 10).rotateX(Math.PI / 2), 0x9aa0a6, [0.935, Y + 0.06, 0.12]));

  // ---- Mid: control room, pump house, bullet tanks, manifold ------------------
  P.push(part(box(0.28, 0.13, 0.16), 0xe8e4da, [0.25, Y, -0.04]));
  P.push(part(box(0.3, 0.014, 0.18), 0x4d555d, [0.25, Y + 0.13, -0.04]));
  for (let c = 0; c < 4; c++) L.push(part(box(0.04, 0.05, 0.006), 0xfff1c4, [0.15 + c * 0.065, Y + 0.05, 0.042]));
  P.push(part(cyl(0.004, 0.16, 5), METAL_D, [0.34, Y + 0.14, -0.08])); // antenna
  P.push(part(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 8).rotateX(Math.PI / 2), 0xffffff, [0.2, Y + 0.16, -0.04])); // dish
  P.push(part(box(0.22, 0.1, 0.15), 0x8f989f, [-0.1, Y, 0.4])); // pump house
  P.push(part(box(0.24, 0.012, 0.17), 0x4b535b, [-0.1, Y + 0.1, 0.4]));
  for (const x of [-0.16, -0.04]) P.push(part(cyl(0.016, 0.04, 8), 0xd02c2c, [x, Y + 0.112, 0.4])); // motor housings
  bullet(0.22, 0.4, 0.26, 0.055);
  bullet(0.22, 0.62, 0.26, 0.055);
  // pipe racks linking boiler house, columns, turbine hall and tank farm
  for (const [x, z] of [[-0.25, -0.26], [0.0, -0.26], [0.25, -0.26], [0.4, -0.26]] as const) P.push(part(box(0.014, 0.12, 0.014), STEEL, [x, Y, z]));
  for (const dz of [-0.012, 0, 0.012]) pipe([-0.25, Y + 0.12 + dz * 2, -0.26 + dz], [0.4, Y + 0.12 + dz * 2, -0.26 + dz], 0.008 + Math.abs(dz) * 0.2);
  P.push(part(box(0.66, 0.008, 0.05), STEEL, [0.075, Y + 0.115, -0.26]));
  valve(0.1, Y + 0.14, -0.27); valve(0.28, Y + 0.14, -0.25);
  for (const [x, z] of [[-0.25, 0.28], [-0.25, 0.4], [-0.25, 0.56], [-0.25, 0.7]] as const) P.push(part(box(0.012, 0.07, 0.012), STEEL, [x, Y, z]));
  pipe([-0.25, Y + 0.07, 0.28], [-0.25, Y + 0.07, 0.7], 0.012);
  pipe([-0.25, Y + 0.07, 0.4], [-0.16, Y + 0.07, 0.4], 0.012);
  pipe([-0.25, Y + 0.07, 0.55], [-0.43, Y + 0.07, 0.55], 0.012); // into the tank farm
  pipe([-0.04, Y + 0.06, 0.4], [0.1, Y + 0.06, 0.4], 0.012);
  valve(-0.25, Y + 0.09, 0.34, 'z'); valve(-0.25, Y + 0.09, 0.6, 'z'); valve(0.06, Y + 0.08, 0.4);
  pipe([0.1, Y + 0.06, 0.4], [0.1, Y + 0.06, 0.62], 0.012);
  for (const z of [-0.2, -0.04]) P.push(part(box(0.012, 0.12, 0.012), STEEL, [-0.55, Y, z]));
  pipe([-0.55, Y + 0.12, -0.37], [-0.55, Y + 0.12, 0.02], 0.012); // fuel feed down to the tank farm side
  pipe([-0.55, Y + 0.12, 0.02], [-0.25, Y + 0.07, 0.28], 0.012);

  // ---- SW: tank farm in a bund ---------------------------------------------
  const BX0 = -0.97, BX1 = -0.3, BZ0 = 0.25, BZ1 = 0.96;
  P.push(part(box(BX1 - BX0, 0.004, BZ1 - BZ0), 0x7a7d75, [(BX0 + BX1) / 2, Y, (BZ0 + BZ1) / 2])); // bund floor
  for (const [x, z, w, d] of [[(BX0 + BX1) / 2, BZ0, BX1 - BX0, 0.02], [(BX0 + BX1) / 2, BZ1, BX1 - BX0, 0.02], [BX0, (BZ0 + BZ1) / 2, 0.02, BZ1 - BZ0], [BX1, (BZ0 + BZ1) / 2, 0.02, BZ1 - BZ0]] as const) P.push(part(box(w, 0.05, d), CONC, [x, Y, z]));
  tank(-0.78, 0.48, 0.16, 0.3, 0.3);
  tank(-0.46, 0.5, 0.14, 0.26, 2.4);
  tank(-0.64, 0.8, 0.15, 0.28, -0.6);
  if (detail) for (const [x, z] of [[-0.9, 0.68], [-0.33, 0.8]] as const) { P.push(part(cyl(0.012, 0.05, 6), RED, [x, Y, z])); P.push(part(box(0.04, 0.005, 0.04), YEL, [x, Y + 0.05, z])); } // foam pourers / drain valves
  pipe([-0.78, Y + 0.02, 0.64], [-0.64, Y + 0.02, 0.65], 0.012); // manifold between tanks
  pipe([-0.46, Y + 0.02, 0.64], [-0.64, Y + 0.02, 0.65], 0.012);
  pipe([-0.46, Y + 0.02, 0.64], [-0.43, Y + 0.07, 0.55], 0.012);
  valve(-0.7, Y + 0.04, 0.645);

  // ---- SE: loading rack, trucks, fire-water tank, gatehouse -------------------
  P.push(part(box(0.5, 0.005, 0.38), 0x4a4d52, [0.64, Y, 0.62])); // apron
  for (const [x, z] of [[0.4, 0.5], [0.88, 0.5], [0.4, 0.74], [0.88, 0.74]] as const) P.push(part(box(0.014, 0.22, 0.014), YEL, [x, Y, z]));
  P.push(part(box(0.56, 0.014, 0.3), 0xd9dde0, [0.64, Y + 0.22, 0.62])); // canopy
  P.push(part(box(0.58, 0.02, 0.012), RED, [0.64, Y + 0.225, 0.77]));
  for (const x of [0.52, 0.76]) { P.push(part(cyl(0.006, 0.12, 5), STEEL, [x, Y + 0.1, 0.62])); P.push(part(box(0.04, 0.008, 0.008), STEEL, [x + 0.02, Y + 0.1, 0.62])); }
  P.push(part(box(0.5, 0.006, 0.012), YEL, [0.64, Y + 0.006, 0.62])); // lane stripe
  truck(0.52, 0.55);
  truck(0.78, 0.7);
  P.push(part(cyl(0.085, 0.14, 14), 0xd02c2c, [0.34, Y, 0.9])); // fire-water tank
  P.push(part(new THREE.ConeGeometry(0.09, 0.03, 14).translate(0, 0.015, 0), 0x9aa0a6, [0.34, Y + 0.14, 0.9]));
  P.push(part(box(0.16, 0.1, 0.12), 0xf2f0ea, [0.88, Y, 0.9])); // gatehouse
  P.push(part(box(0.18, 0.012, 0.14), 0x4d555d, [0.88, Y + 0.1, 0.9]));
  L.push(part(box(0.1, 0.04, 0.006), 0xfff1c4, [0.88, Y + 0.04, 0.84]));
  P.push(part(box(0.012, 0.08, 0.012), 0x555c63, [0.06, Y, 0.96]));
  P.push(part(box(0.2, 0.012, 0.012), 0xd02c2c, [-0.04, Y + 0.07, 0.96])); // barrier arm across the gate
  P.push(part(box(0.26, 0.07, 0.008), 0xf28c1d, [0.6, Y + 0.09, 0.965])); // plant sign
  for (const x of [0.5, 0.7]) P.push(part(box(0.01, 0.09, 0.01), 0x6b4a2b, [x, Y, 0.965]));
  // light masts + perimeter fence
  for (const [x, z] of [[-0.93, -0.93], [0.93, -0.93], [-0.2, 0.22], [0.3, 0.3]] as const) {
    P.push(part(cyl(0.007, 0.34, 6), METAL_D, [x, Y, z]));
    P.push(part(box(0.06, 0.012, 0.03), 0xfff3c4, [x, Y + 0.34, z]));
    L.push(part(box(0.05, 0.006, 0.025), 0xfff3c4, [x, Y + 0.332, z]));
  }
  if (detail) {
    for (let k = 0; k < 18; k++) { P.push(part(box(0.008, 0.05, 0.008), STEEL, [-0.94 + k * 0.11, Y, -0.965])); }
    for (let k = 0; k < 8; k++) P.push(part(box(0.008, 0.05, 0.008), STEEL, [-0.965, Y, -0.9 + k * 0.1]));
    P.push(part(box(1.9, 0.004, 0.004), 0xb8bec4, [0, Y + 0.04, -0.965]), part(box(0.004, 0.004, 1.9), 0xb8bec4, [-0.965, Y + 0.04, 0]));
  }
  // small shrubs along the verges
  for (const [x, z] of [[0.5, 0.93], [-0.1, 0.93], [0.95, 0.35], [0.95, 0.55]] as const) P.push(part(new THREE.IcosahedronGeometry(0.045, 0).translate(0, 0.045, 0), GREEN, [x, Y, z]));

  return { solid: merge(P), lights: merge(L) };
}

