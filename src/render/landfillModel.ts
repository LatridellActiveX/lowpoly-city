/**
 * render/landfillModel.ts — V1.6: the 2×2 LANDFILL (service kind Svc.Dump).
 *
 * Authored in world units for the whole 2×2 footprint, centred on the origin
 * (x, z ∈ −1 … 1), front (+z) toward the entrance. The model has SIX STAGES
 * that the renderer swaps between as the landfill fills (sim/garbage.ts
 * landfillStage): 0 = empty lined pit, 1…4 = a terraced mound of waste that
 * gets taller (and gets more litter, gas wells and a flare as it grows), and
 * 5 = FULL: the mound is capped and grassed over, the barrier is down and a
 * red CLOSED sign stands at the gate. More fill means more polygons.
 *
 * Moving parts are separate geometries so the renderer can animate them:
 *   - landfillDozerModel(): a yellow compactor that drives over the working
 *     surface (its height follows landfillTopY(stage));
 *   - landfillGullModel(): a bird that circles above, flapping by squashing z.
 */
import * as THREE from 'three';
import { box, merge, part } from './models';

export type V3 = [number, number, number];

/** Centre (z) of the fill cell inside the 2×2 site. */
export const LF_CZ = -0.18;
const FLOOR = 0.016, LAYER = 0.115, W0 = 1.44, ASPECT = 1.263, STEP = 0.22, SLOPE = 0.1;
const layerW = (k: number) => W0 - STEP * k;

/** Height of the working surface at a stage (the dozer drives on it). */
export const landfillTopY = (stage: number) => FLOOR + LAYER * Math.min(4, Math.max(0, stage));
/** Width × depth of the working surface at a stage. */
export function landfillTopSize(stage: number): [number, number] {
  const s = Math.min(4, Math.max(0, stage));
  if (s === 0) return [W0, W0 / ASPECT];
  const w = layerW(s - 1) - SLOPE;
  return [w, w / ASPECT];
}

const EARTH = 0x80714f, SOIL = 0x8b7552, STEEL = 0x9aa0a4, STEEL_D = 0x6d757b, ASPHALT = 0x4d5156;
const WASTE = [0x6e6450, 0x5d5543, 0x756a52, 0x655b48];
const LITTER = [0xf2f0e8, 0x2f6fb0, 0x2f9a4c, 0xc39a62, 0xc23b2e, 0x2b2b2b, 0xe0b52a, 0xd8d8d8];

/** Deterministic 0..1 noise so every landfill of a stage looks the same. */
const hh = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const cyl = (r: number, h: number, seg = 8) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);
/** Square frustum (4-sided cone, axis-aligned): bottom width wBot, top width wTop, depth = width / aspect. */
const frustum = (wBot: number, wTop: number, h: number, aspect = ASPECT) =>
  new THREE.CylinderGeometry(wTop / Math.SQRT2, wBot / Math.SQRT2, h, 4).rotateY(Math.PI / 4).scale(1, 1, 1 / aspect).translate(0, h / 2, 0);
/** A flat board from point a to point b (width w across, thickness t), e.g. a ramp. */
export function slab(a: V3, b: V3, w: number, t: number, color: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  const g = new THREE.BoxGeometry(w, len, t).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  return part(g, color, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}

/** Stage 0…5 of the landfill. */
export function landfillStageModel(stage: number): THREE.BufferGeometry {
  const st = Math.max(0, Math.min(5, Math.round(stage)));
  const full = st === 5;
  const layers = full ? 4 : st; // terraces built so far
  const P: THREE.BufferGeometry[] = [];
  const hx = W0 / 2 + 0.03, hz = W0 / ASPECT / 2 + 0.03;

  // ---- Site, access road, weighbridge, gate -----------------------------------
  P.push(part(box(1.96, 0.012, 1.96), 0x8f8676));
  P.push(part(box(0.46, 0.006, 0.56), ASPHALT, [0, 0.012, 0.72]));
  for (let k = 0; k < 4; k++) P.push(part(box(0.02, 0.002, 0.07), 0xf2e6a0, [0, 0.018, 0.5 + k * 0.14])); // centre dashes
  P.push(part(box(0.34, 0.014, 0.24), STEEL, [0, 0.018, 0.78])); // weighbridge deck
  for (const s of [-1, 1]) P.push(part(box(0.012, 0.016, 0.24), 0xf2f0e8, [s * 0.14, 0.018, 0.78]));
  P.push(part(box(0.13, 0.1, 0.1), 0xe9e5da, [0.3, 0.012, 0.72])); // scale house
  P.push(part(box(0.15, 0.014, 0.12), 0x3d4a55, [0.3, 0.112, 0.72]));
  P.push(part(box(0.2, 0.14, 0.16), 0xe9e5da, [-0.45, 0.012, 0.8])); // gatehouse
  P.push(part(box(0.23, 0.02, 0.19), 0x3d4a55, [-0.45, 0.152, 0.8]));
  P.push(part(box(0.1, 0.05, 0.004), 0x9fd7ff, [-0.45, 0.07, 0.884]));
  P.push(part(box(0.03, 0.1, 0.03), 0x555c63, [0.26, 0.012, 0.97])); // barrier post
  if (full) P.push(part(box(0.5, 0.016, 0.016), 0xd02c2c, [0.0, 0.09, 0.97])); // barrier DOWN across the road
  else P.push(part(box(0.2, 0.016, 0.016), 0xd02c2c, [0.26, 0.1, 0.97], [0, 0, 1.2])); // barrier raised
  // Leachate pond, recycling drop-off bins, light masts and a perimeter fence.
  P.push(part(box(0.62, 0.01, 0.4), EARTH, [0.62, 0.012, 0.74]));
  P.push(part(box(0.54, 0.008, 0.32), 0x47605a, [0.62, 0.02, 0.74]));
  [0x2f6fb0, 0x2f9a4c, 0xe0b52a].forEach((c, k) => {
    P.push(part(box(0.1, 0.1, 0.08), c, [-0.86 + k * 0.12, 0.012, 0.58]));
    P.push(part(box(0.105, 0.012, 0.085), 0x2b2b2b, [-0.86 + k * 0.12, 0.112, 0.58]));
  });
  for (const s of [-1, 1]) {
    P.push(part(cyl(0.01, 0.55, 6), 0x7b8288, [s * 0.93, 0.012, 0.3]));
    P.push(part(box(0.08, 0.02, 0.04), 0xf2f2ee, [s * 0.93, 0.56, 0.3]));
  }
  for (let k = 0; k < 7; k++) for (const s of [-1, 1]) P.push(part(box(0.016, 0.1, 0.016), STEEL_D, [s * 0.97, 0.012, -0.95 + k * 0.32]));
  for (let k = 0; k < 7; k++) P.push(part(box(0.016, 0.1, 0.016), STEEL_D, [-0.9 + k * 0.3, 0.012, -0.97]));
  for (const s of [-1, 1]) P.push(part(box(0.006, 0.006, 1.92), STEEL, [s * 0.97, 0.08, 0]));
  P.push(part(box(1.92, 0.006, 0.006), STEEL, [0, 0.08, -0.97]));

  // ---- The pit: liner floor and four earth berms (front one has a gap for the ramp) ------
  P.push(part(box(2 * hx, 0.004, 2 * hz), 0x24282a, [0, 0.012, LF_CZ])); // liner
  const berm = (x: number, z: number, w: number, d: number) => P.push(part(box(w, 0.1, d), EARTH, [x, 0.012, z]));
  berm(0, LF_CZ - hz - 0.06, 2 * hx + 0.24, 0.12);
  berm(-(hx + 0.06), LF_CZ, 0.12, 2 * hz);
  berm(hx + 0.06, LF_CZ, 0.12, 2 * hz);
  for (const s of [-1, 1]) berm(s * (0.22 + (hx - 0.22 + 0.12) / 2), LF_CZ + hz + 0.06, hx - 0.22 + 0.12, 0.12);

  // ---- Terraced mound ------------------------------------------------------------------
  for (let k = 0; k < layers; k++) {
    const y = FLOOR + LAYER * k, wb = layerW(k), wt = wb - SLOPE;
    P.push(part(frustum(wb, wt, LAYER - 0.012), full ? (k % 2 ? 0x5a8f45 : 0x679c4c) : WASTE[k % WASTE.length], [0, y, LF_CZ]));
    P.push(part(frustum(wt, wt - 0.012, 0.012), full ? 0x7a6a48 : SOIL, [0, y + LAYER - 0.012, LF_CZ])); // daily cover soil on the terrace
  }
  if (layers > 0) {
    const [tw, td] = landfillTopSize(layers);
    const topY = landfillTopY(layers);
    // Haul ramp from the gate up onto the working surface.
    P.push(slab([0, FLOOR + 0.002, LF_CZ + hz + 0.1], [0, topY + 0.004, LF_CZ + td / 2 - 0.06], 0.3, 0.012, 0x9a8f78));
    if (full) {
      // Capped: a domed grass cap, shrubs, a ring drain and a few gas wells. The mound is closed.
      P.push(part(frustum(tw - 0.02, tw * 0.45, 0.13), 0x6fae52, [0, topY, LF_CZ]));
      for (let k = 0; k < 7; k++) P.push(part(new THREE.IcosahedronGeometry(0.045 + 0.02 * hh(k), 0).translate(0, 0.04, 0), 0x3f8f3a, [(hh(k * 5 + 1) - 0.5) * tw * 0.7, topY + 0.05, LF_CZ + (hh(k * 5 + 2) - 0.5) * td * 0.6]));
      for (let k = 0; k < 6; k++) {
        const x = (hh(k * 7 + 3) - 0.5) * tw * 0.55, z = LF_CZ + (hh(k * 7 + 4) - 0.5) * td * 0.5;
        P.push(part(cyl(0.006, 0.12, 6), 0x777c80, [x, topY + 0.1, z]));
        P.push(part(new THREE.ConeGeometry(0.014, 0.02, 6).translate(0, 0.01, 0), 0x2f9a4c, [x, topY + 0.22, z]));
      }
      // Gate sign: CLOSED — red board on two posts with a white X.
      for (const s of [-1, 1]) P.push(part(box(0.016, 0.22, 0.016), 0x555c63, [0.2 + s * 0.13, 0.012, 0.58]));
      P.push(part(box(0.3, 0.16, 0.012), 0xc23b2e, [0.2, 0.17, 0.58]));
      for (const a of [0.7, -0.7]) P.push(part(box(0.2, 0.026, 0.008), 0xffffff, [0.2, 0.25, 0.59], [0, 0, a]));
    } else {
      // Litter on the working surface: more of it the fuller the pit is.
      for (let k = 0; k < 6 + layers * 6; k++) {
        const s = 0.025 + 0.04 * hh(k * 3 + 9);
        P.push(part(box(s * 1.4, s, s), LITTER[Math.floor(hh(k * 3 + 10) * LITTER.length)], [(hh(k * 3 + 11) - 0.5) * tw * 0.9, topY, LF_CZ + (hh(k * 3 + 12) - 0.5) * td * 0.9], [0, hh(k) * 6.28, 0]));
      }
      // Gas wells with caps once the mound is tall enough to need them.
      if (layers >= 2) for (let k = 0; k < (layers - 1) * 2; k++) {
        const x = (hh(k * 7 + 3) - 0.5) * tw * 0.55, z = LF_CZ + (hh(k * 7 + 4) - 0.5) * td * 0.5;
        P.push(part(cyl(0.006, 0.1, 6), 0x777c80, [x, topY, z]));
        P.push(part(new THREE.ConeGeometry(0.014, 0.02, 6).translate(0, 0.01, 0), 0xd9a520, [x, topY + 0.1, z]));
      }
    }
  } else {
    // Empty pit: a few drainage sumps and a pile of daily-cover soil waiting at the back.
    for (let k = 0; k < 3; k++) P.push(part(cyl(0.05, 0.02, 8), 0x3a4348, [-0.4 + k * 0.4, 0.016, LF_CZ - 0.2]));
    P.push(part(new THREE.ConeGeometry(0.2, 0.14, 7).translate(0, 0.07, 0).scale(1.6, 1, 1), SOIL, [0.3, 0.016, LF_CZ - 0.38]));
    P.push(part(box(0.24, 0.012, 0.18), 0x24282a, [-0.35, 0.016, LF_CZ + 0.25])); // rolled liner offcut
  }
  // Gas flare outside the back berm once there is gas to burn (stage 3 and up).
  if (st >= 3) {
    P.push(part(cyl(0.014, 0.42, 8), 0xc23b2e, [-0.78, 0.012, -0.9]));
    P.push(part(cyl(0.017, 0.04, 8), 0xeeeeea, [-0.78, 0.25, -0.9]));
    P.push(part(new THREE.ConeGeometry(0.03, 0.09, 6).translate(0, 0.045, 0), 0xff8a20, [-0.78, 0.44, -0.9]));
    P.push(part(box(0.1, 0.05, 0.08), 0x6d757b, [-0.78, 0.012, -0.8]));
  }
  return merge(P);
}

/** The compactor that works the surface of a landfill. Forward = +x, base at y = 0. */
export function landfillDozerModel(): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [];
  for (const x of [-0.065, 0.07]) for (const z of [-0.065, 0.065]) {
    P.push(part(new THREE.CylinderGeometry(0.036, 0.036, 0.045, 10).rotateX(Math.PI / 2), 0x5d6468, [x, 0.036, z]));
    P.push(part(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 6).rotateX(Math.PI / 2), 0xb8bec4, [x, 0.036, z])); // hub
  }
  P.push(part(box(0.19, 0.05, 0.1), 0xe0b52a, [-0.01, 0.03, 0]));
  P.push(part(box(0.07, 0.04, 0.09), 0xe0b52a, [0.07, 0.07, 0]));
  P.push(part(box(0.07, 0.05, 0.085), 0xf2f2ee, [-0.04, 0.08, 0])); // cab
  P.push(part(box(0.004, 0.03, 0.07), 0x9fd7ff, [0.0, 0.09, 0]));
  P.push(part(box(0.08, 0.008, 0.095), 0x3d4a55, [-0.04, 0.13, 0]));
  P.push(part(box(0.02, 0.012, 0.02), 0xf28c1d, [-0.04, 0.138, 0])); // beacon
  P.push(part(box(0.014, 0.06, 0.16), STEEL_D, [0.12, 0.016, 0])); // blade
  for (const z of [-0.06, 0.06]) P.push(part(box(0.06, 0.012, 0.012), 0xe0b52a, [0.09, 0.04, z]));
  P.push(part(cyl(0.006, 0.05, 6), 0x2b2b2b, [0.05, 0.09, 0.03])); // exhaust
  return merge(P);
}

/** A gull: body, head, beak and two raised wings along z (squash z to flap). Forward = +x. */
export function landfillGullModel(): THREE.BufferGeometry {
  return merge([
    part(box(0.03, 0.012, 0.012), 0xf4f4f0, [0, 0, 0]),
    part(box(0.012, 0.012, 0.012), 0xe6e6e0, [0.02, 0.004, 0]),
    part(box(0.008, 0.004, 0.006), 0xe0b52a, [0.029, 0.006, 0]),
    part(box(0.026, 0.003, 0.05), 0xf4f4f0, [0, 0.008, 0.026], [-0.4, 0, 0]),
    part(box(0.026, 0.003, 0.05), 0xf4f4f0, [0, 0.008, -0.026], [0.4, 0, 0]),
    part(box(0.012, 0.0032, 0.014), 0x4a4f55, [0, 0.019, 0.05], [-0.4, 0, 0]),
    part(box(0.012, 0.0032, 0.014), 0x4a4f55, [0, 0.019, -0.05], [0.4, 0, 0]),
  ]);
}
