/**
 * render/coalModel.ts — V1.5b (Parker): the 2×2 COAL POWER PLANT.
 *
 * Authored in world units for the whole 2×2 footprint, centred on the
 * origin (x, z ∈ −1 … 1), so the renderer places it at the footprint centre
 * with scale 1. Layout by quadrant (unrotated, −z = "north"):
 *   NW  boiler house (brick, tall) + two red/white banded smokestacks
 *   NE  turbine hall (metal, ridge roof, clerestory) + transformer yard
 *   SE  two hyperboloid cooling towers with vapour rims
 *   SW  coal stockyard: three coal piles, a stacker, an inclined conveyor
 *       into the boiler house, a truck unloading bay and a rail siding with
 *       hopper wagons
 * Connected by overhead pipe racks and catwalks. Windows go in a separate
 * `lights` geometry so they glow at night (window-glow material).
 *
 * `detail` false (low Detail setting) drops the small parts (catwalk rails,
 * wagons, insulators, rivets of pipe flanges) to keep the triangle count low.
 */
import * as THREE from 'three';
import { merge, part } from './models';

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
const BRICK = 0x8e4f3c, BRICK_D = 0x6f3b2d, METAL = 0x9aa3a8, METAL_D = 0x6d757b, CONC = 0xb4b0a6, ROOF = 0x55606a;
const COAL = 0x23242a, RAIL = 0x5a524a, STEEL = 0x7b8288, RED = 0xc23b2e, WHITE = 0xeeeeea, YEL = 0xe0b52a;

/** Smoke-emitting stack tops (model space) — the renderer adds puffs here. */
export const COAL_STACKS: Array<[number, number, number]> = [[-0.82, 1.78, -0.78], [-0.5, 1.62, -0.84]];

export function bigCoalModel(detail = true): { solid: THREE.BufferGeometry; lights: THREE.BufferGeometry } {
  const P: THREE.BufferGeometry[] = [];
  const L: THREE.BufferGeometry[] = [];
  // Site slab, roads/aprons.
  P.push(part(box(1.98, 0.04, 1.98), 0x9c9a92));
  P.push(part(box(0.18, 0.005, 1.9), 0x55575a, [0.02, 0.04, 0])); // internal road N–S
  // ---- NW: boiler house -------------------------------------------------
  P.push(part(box(0.62, 0.95, 0.7), BRICK, [-0.42, 0.04, -0.5]));
  P.push(part(box(0.66, 0.05, 0.74), BRICK_D, [-0.42, 0.99, -0.5])); // cornice
  P.push(part(box(0.4, 0.18, 0.4), METAL_D, [-0.42, 1.04, -0.5])); // roof plant
  for (let k = 0; k < 4; k++) P.push(part(box(0.66, 0.025, 0.74), BRICK_D, [-0.42, 0.2 + k * 0.2, -0.5])); // string courses
  // Window rows (east + south faces) → night glow.
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    L.push(part(box(0.08, 0.1, 0.006), 0x9fd7ff, [-0.66 + c * 0.16, 0.1 + r * 0.2, -0.149]));
    L.push(part(box(0.006, 0.1, 0.08), 0x9fd7ff, [-0.104, 0.1 + r * 0.2, -0.77 + c * 0.16]));
  }
  P.push(part(box(0.12, 0.2, 0.01), 0x3a3a3a, [-0.3, 0.04, -0.148])); // big door
  // ---- Smokestacks (banded) ---------------------------------------------
  for (const [x, top, z] of COAL_STACKS) {
    const h = top - 0.04;
    P.push(part(new THREE.CylinderGeometry(0.06, 0.1, h, 12).translate(0, h / 2, 0), CONC, [x, 0.04, z]));
    for (const f of [0.62, 0.78, 0.94]) P.push(part(new THREE.CylinderGeometry(0.066, 0.066, h * 0.07, 12), f === 0.94 ? RED : f === 0.78 ? WHITE : RED, [x, 0.04 + h * f, z]));
    P.push(part(new THREE.TorusGeometry(0.07, 0.01, 4, 12).rotateX(Math.PI / 2), METAL_D, [x, top - 0.01, z]));
    if (detail) P.push(part(new THREE.SphereGeometry(0.015, 5, 3), 0xff3020, [x, top + 0.01, z])); // aviation light
  }
  P.push(part(box(0.06, 0.04, 0.4), METAL_D, [-0.66, 0.6, -0.8]).rotateY(0)); // flue duct
  // ---- NE: turbine hall + transformer yard ------------------------------
  P.push(part(box(0.9, 0.45, 0.5), METAL, [0.5, 0.04, -0.62]));
  const ridge = new THREE.CylinderGeometry(0.29, 0.29, 0.9, 3, 1).rotateZ(Math.PI / 2).scale(1, 0.35, 1);
  P.push(part(ridge, ROOF, [0.5, 0.52, -0.62]));
  for (let c = 0; c < 8; c++) {
    L.push(part(box(0.07, 0.12, 0.006), 0x9fd7ff, [0.13 + c * 0.105, 0.22, -0.369]));
    P.push(part(box(0.012, 0.45, 0.012), METAL_D, [0.08 + c * 0.11, 0.04, -0.368])); // wall ribs
  }
  P.push(part(box(0.14, 0.24, 0.01), YEL, [0.85, 0.04, -0.368])); // roller door (hazard yellow)
  // Pipe rack boiler → turbine hall.
  P.push(part(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8).rotateZ(Math.PI / 2), 0xb8b0a0, [0.07, 0.62, -0.62]));
  P.push(part(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8).rotateZ(Math.PI / 2), 0x8f6f4f, [0.07, 0.55, -0.55]));
  for (const x of [-0.1, 0.24]) P.push(part(box(0.02, 0.6, 0.02), STEEL, [x, 0.04, -0.58]));
  // Transformer yard (fenced gravel, transformers, gantry).
  P.push(part(box(0.5, 0.01, 0.42), 0x8d8a80, [0.72, 0.04, -0.12]));
  for (let k = 0; k < 3; k++) {
    P.push(part(box(0.1, 0.12, 0.08), 0x6f7a62, [0.56 + k * 0.15, 0.05, -0.12]));
    if (detail) for (const dx of [-0.03, 0, 0.03]) P.push(part(new THREE.CylinderGeometry(0.008, 0.012, 0.07, 5).translate(0, 0.035, 0), 0xd8d0c0, [0.56 + k * 0.15 + dx, 0.17, -0.12]));
  }
  for (const x of [0.5, 0.94]) P.push(part(box(0.02, 0.35, 0.02), STEEL, [x, 0.04, -0.3]));
  P.push(part(box(0.46, 0.02, 0.02), STEEL, [0.72, 0.39, -0.3]));
  if (detail) for (const [x, z, w, d] of [[0.72, 0.09, 0.5, 0.005], [0.72, -0.33, 0.5, 0.005], [0.47, -0.12, 0.005, 0.42], [0.97, -0.12, 0.005, 0.42]] as const) P.push(part(box(w, 0.06, d), 0x9aa0a0, [x, 0.04, z]));
  // ---- SE: cooling towers -----------------------------------------------
  // Materials are single-sided, so a lathe with only an outer wall is see-through
  // from above (you look straight through the open top at whatever is behind
  // the tower). Each tower is therefore a hollow SHELL: the outer wall up, a
  // flat lip across the top, and an inner wall back down (a closed profile),
  // plus a dark basin floor, so the opening shows the inside of the tower.
  const WALL = 0.025;
  const profile = (r: number, h: number) => [
    new THREE.Vector2(r, 0), new THREE.Vector2(r * 0.8, h * 0.35), new THREE.Vector2(r * 0.66, h * 0.7),
    new THREE.Vector2(r * 0.68, h * 0.88), new THREE.Vector2(r * 0.74, h)];
  const shell = (r: number, h: number) => {
    const outer = profile(r, h);
    const inner = outer.map((v) => new THREE.Vector2(v.x - WALL, v.y)).reverse(); // top → bottom: faces point inward
    return new THREE.LatheGeometry([...outer, ...inner], 18);
  };
  for (const [x, z, r, h] of [[0.32, 0.6, 0.3, 0.9], [0.74, 0.22, 0.24, 0.75]] as const) {
    P.push(part(shell(r, h), 0xc9c6bd, [x, 0.04, z]));
    P.push(part(new THREE.CircleGeometry(r - WALL, 18).rotateX(-Math.PI / 2), 0x3f5a6b, [x, 0.04 + 0.032, z])); // basin water, seen through the opening
    P.push(part(new THREE.TorusGeometry(r * 0.74, 0.012, 4, 18).rotateX(Math.PI / 2), 0x9c988e, [x, 0.04 + h, z]));
    P.push(part(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.03, 18), 0x8f8b82, [x, 0.04, z])); // basin
    if (detail) P.push(part(box(0.006, h * 0.85, 0.01), 0x8a8478, [x + r * 0.78, 0.04, z])); // stain streak
  }
  // ---- SW: coal stockyard, conveyor, unloading --------------------------
  for (const [x, z, r, h] of [[-0.55, 0.35, 0.22, 0.2], [-0.25, 0.62, 0.18, 0.15], [-0.62, 0.72, 0.15, 0.12]] as const) {
    P.push(part(new THREE.ConeGeometry(r, h, 9).translate(0, h / 2, 0).scale(1.3, 1, 1), COAL, [x, 0.04, z]));
  }
  // Inclined conveyor from the yard up into the boiler house.
  const conv = box(0.07, 0.04, 0.7).rotateX(-0.75);
  P.push(part(conv, METAL_D, [-0.3, 0.12, -0.0]));
  if (detail) for (const z of [0.12, -0.1]) P.push(part(box(0.02, 0.3 - z, 0.02), STEEL, [-0.3, 0.04, z]));
  P.push(part(box(0.1, 0.12, 0.1), METAL, [-0.3, 0.04, 0.3])); // transfer tower
  // Truck unloading bay (canopy + hopper) on the south edge.
  P.push(part(box(0.32, 0.015, 0.22), METAL_D, [0.05, 0.28, 0.82]));
  for (const [x, z] of [[-0.1, 0.72], [0.2, 0.72], [-0.1, 0.92], [0.2, 0.92]]) P.push(part(box(0.015, 0.24, 0.015), STEEL, [x, 0.04, z]));
  P.push(part(new THREE.ConeGeometry(0.09, 0.08, 4).rotateX(Math.PI).translate(0, 0.04, 0), METAL_D, [0.05, 0.04, 0.82]));
  for (const x of [-0.12, 0.22]) P.push(part(box(0.02, 0.006, 0.22), YEL, [x, 0.044, 0.82])); // hazard lines
  // Rail siding along the west edge with hopper wagons.
  for (const x of [-0.93, -0.87]) P.push(part(box(0.01, 0.012, 1.9), RAIL, [x, 0.04, 0]));
  if (detail) {
    for (let k = 0; k < 12; k++) P.push(part(box(0.1, 0.008, 0.02), 0x6b5a48, [-0.9, 0.04, -0.88 + k * 0.16]));
    for (const z of [0.15, 0.45, 0.75]) {
      P.push(part(box(0.09, 0.08, 0.24), 0x5b4a3f, [-0.9, 0.06, z]));
      P.push(part(box(0.07, 0.015, 0.2), COAL, [-0.9, 0.14, z]));
    }
  }
  // ---- Catwalks around the boiler house ---------------------------------
  P.push(part(box(0.7, 0.01, 0.06), STEEL, [-0.42, 0.6, -0.12]));
  if (detail) {
    P.push(part(box(0.7, 0.05, 0.004), STEEL, [-0.42, 0.61, -0.09]));
    for (let k = 0; k < 6; k++) P.push(part(box(0.006, 0.56, 0.006), STEEL, [-0.75 + k * 0.13, 0.04, -0.09]));
    P.push(part(box(0.02, 0.56, 0.04), STEEL, [-0.08, 0.04, -0.1])); // stair tower
  }
  return { solid: merge(P), lights: merge(L) };
}
