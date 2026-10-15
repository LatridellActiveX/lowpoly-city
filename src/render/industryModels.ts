/**
 * render/industryModels.ts — PR 5 models for farms, crop fields, food
 * processing plants, the Construction Yard, construction-truck cargo and the
 * wind turbine nacelle (split out so it can yaw into the wind).
 *
 * Conventions (same as models.ts): 1 unit = 1 tile, y up, buildings face +z
 * (the renderer turns +z toward the road). Every model is a merged,
 * vertex-coloured geometry drawn as ONE instanced mesh, so a hundred farms
 * cost one draw call. Colours that should vary per instance (crop colour,
 * season) are left WHITE so the instance colour tints them.
 */
import * as THREE from 'three';
import { box, gable, merge, part } from './models';
import { slab } from './landfillModel';

const STEEL = 0xc5cbd2, STEEL_D = 0x8d949c, CONCRETE = 0xb9b5ac, ROOF = 0x5c6670, WOOD = 0x8a6440;
const cyl = (r: number, h: number, seg = 14) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);
/** Dome cap (upper hemisphere) of radius r sitting at y = 0. */
const dome = (r: number) => new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);

/**
 * Farm yard: red barn with a gable roof and white trim at the FRONT (+z,
 * facing the road), a tall silo with a dome, a small farmhouse shed, hay
 * bales and a fenced yard. Fields are separate instances (fieldSoil/Crops).
 */
export function farmModel(): THREE.BufferGeometry {
  const RED = 0xb23a2e, TRIM = 0xf1ece2, ROOFC = 0x4d4a48, GRN = 0x3f8f3a;
  const p: THREE.BufferGeometry[] = [
    part(box(0.96, 0.012, 0.96), 0x9c8a62), // packed-earth yard
    // Barn: walls + gable roof (ridge along x) + white door frame and X brace.
    part(box(0.46, 0.22, 0.34), RED, [-0.12, 0.012, 0.1]),
    part(gable(0.5, 0.14, 0.38), ROOFC, [-0.12, 0.232, 0.1]),
    part(box(0.52, 0.012, 0.022), 0x35332f, [-0.12, 0.366, 0.1]), // ridge cap
    part(box(0.18, 0.16, 0.006), TRIM, [-0.12, 0.012, 0.272]),
    part(box(0.16, 0.14, 0.008), 0x8e2b22, [-0.12, 0.02, 0.274]),
    part(box(0.012, 0.19, 0.006), TRIM, [-0.12, 0.012, 0.279], [0, 0, 0.72]),
    part(box(0.012, 0.19, 0.006), TRIM, [-0.12, 0.012, 0.279], [0, 0, -0.72]),
    part(box(0.08, 0.06, 0.006), TRIM, [-0.12, 0.25, 0.272]), // hay-loft door
    part(box(0.06, 0.05, 0.004), 0x3a2a22, [-0.12, 0.255, 0.275]),
    // Barn cupola with a little gable roof, side windows and a lean-to shed.
    part(box(0.06, 0.05, 0.06), TRIM, [-0.12, 0.35, 0.1]),
    part(gable(0.07, 0.035, 0.07), ROOFC, [-0.12, 0.4, 0.1]),
    part(box(0.004, 0.025, 0.03), 0x2f3a44, [-0.12, 0.362, 0.131]),
    part(box(0.12, 0.1, 0.26), 0xa5362b, [-0.41, 0.012, 0.1]),
    part(box(0.15, 0.01, 0.29), ROOFC, [-0.415, 0.108, 0.1], [0, 0, 0.18]),
    part(box(0.004, 0.06, 0.07), 0xf1ece2, [-0.472, 0.03, 0.1]),
    // Silo: corrugated look from stacked rings + dome cap, ladder with cage hoops, filler pipe.
    part(cyl(0.085, 0.5), 0xd8dde2, [0.27, 0.012, -0.12]),
    part(dome(0.085), 0x9aa3ab, [0.27, 0.512, -0.12]),
    part(new THREE.CylinderGeometry(0.089, 0.089, 0.012, 14), 0xaab2ba, [0.27, 0.14, -0.12]),
    part(new THREE.CylinderGeometry(0.089, 0.089, 0.012, 14), 0xaab2ba, [0.27, 0.3, -0.12]),
    part(new THREE.CylinderGeometry(0.089, 0.089, 0.012, 14), 0xaab2ba, [0.27, 0.44, -0.12]),
    part(new THREE.CylinderGeometry(0.089, 0.089, 0.012, 14), 0xaab2ba, [0.27, 0.07, -0.12]),
    part(box(0.012, 0.5, 0.02), 0x6d747b, [0.36, 0.012, -0.12]), // ladder
    part(cyl(0.012, 0.04, 6), 0x555c63, [0.27, 0.598, -0.12]), // vent
    part(box(0.012, 0.012, 0.15), 0x6d747b, [0.27, 0.45, -0.025], [0, 0, 0]), // pipe from silo toward the barn
    // Tool shed.
    part(box(0.18, 0.12, 0.16), 0xe7dcc4, [0.27, 0.012, 0.22]),
    part(gable(0.2, 0.06, 0.18), 0x6b5444, [0.27, 0.132, 0.22]),
    part(box(0.07, 0.09, 0.005), 0x8a6440, [0.27, 0.012, 0.302]),
  ];
  for (let k = 0; k < 4; k++) p.push(part(new THREE.TorusGeometry(0.089, 0.003, 3, 14).rotateX(Math.PI / 2), 0x6d747b, [0.27, 0.2 + k * 0.1, -0.12])); // ladder-cage hoops
  // Farmhouse (front-left): walls, gable roof, chimney, door, windows with shutters, porch.
  p.push(part(box(0.22, 0.1, 0.14), 0xefe6cf, [-0.3, 0.012, 0.4]));
  p.push(part(gable(0.25, 0.07, 0.17), 0x7a3b2e, [-0.3, 0.112, 0.4]));
  p.push(part(box(0.025, 0.07, 0.025), 0x8a4331, [-0.37, 0.14, 0.38]));
  p.push(part(box(0.04, 0.07, 0.006), 0x6b4a2b, [-0.3, 0.012, 0.471]));
  for (const x of [-0.37, -0.23]) { p.push(part(box(0.035, 0.04, 0.006), 0x9fd7ff, [x, 0.04, 0.471])); p.push(part(box(0.01, 0.04, 0.007), 0x3f6fa0, [x - 0.025, 0.04, 0.471])); p.push(part(box(0.01, 0.04, 0.007), 0x3f6fa0, [x + 0.025, 0.04, 0.471])); }
  p.push(part(box(0.1, 0.012, 0.04), 0x8a6440, [-0.3, 0.05, 0.488]), part(box(0.006, 0.04, 0.006), 0x8a6440, [-0.34, 0.012, 0.5]), part(box(0.006, 0.04, 0.006), 0x8a6440, [-0.26, 0.012, 0.5]));
  // Tractor (+x forward): hood, cab with glass and roof, exhaust, big rear and small front wheels.
  const tractor = (x: number, z: number, yaw: number) => {
    const t: THREE.BufferGeometry[] = [
      part(box(0.05, 0.035, 0.04), GRN, [0.035, 0.03, 0]), part(box(0.04, 0.04, 0.05), GRN, [-0.02, 0.03, 0]),
      part(box(0.036, 0.036, 0.046), 0x9fd7ff, [-0.02, 0.07, 0]), part(box(0.042, 0.006, 0.054), 0x2f2f2f, [-0.02, 0.106, 0]),
      part(cyl(0.004, 0.04, 5), 0x333333, [0.045, 0.062, 0.012]),
      part(box(0.01, 0.02, 0.04), 0x555c63, [0.062, 0.03, 0]), // grille/weights
    ];
    for (const s of [-1, 1]) {
      t.push(part(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10).rotateX(Math.PI / 2), 0x222222, [-0.03, 0.03, s * 0.036]));
      t.push(part(new THREE.CylinderGeometry(0.016, 0.016, 0.022, 8).rotateX(Math.PI / 2), 0xe0b52a, [-0.03, 0.03, s * 0.036]));
      t.push(part(new THREE.CylinderGeometry(0.02, 0.02, 0.014, 8).rotateX(Math.PI / 2), 0x222222, [0.05, 0.02, s * 0.03]));
    }
    for (const g of t) g.rotateY(yaw).translate(x, 0.012, z);
    return t;
  };
  p.push(...tractor(0.1, 0.4, 0.3));
  // Windmill water pump (back-left): lattice tower, hub, eight blades, tail vane, tank.
  const WX = 0.42, WZ = -0.4;
  for (const [dx, dz] of [[-0.03, -0.03], [0.03, -0.03], [-0.03, 0.03], [0.03, 0.03]]) p.push(slab([WX + dx, 0.012, WZ + dz], [WX + dx * 0.4, 0.38, WZ + dz * 0.4], 0.008, 0.008, 0x8d949c));
  for (const y of [0.1, 0.2, 0.3]) p.push(part(box(0.06 - y * 0.05, 0.005, 0.06 - y * 0.05), 0x8d949c, [WX, y, WZ]));
  p.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8).rotateZ(Math.PI / 2), 0x6d747b, [WX, 0.39, WZ]));
  for (let k = 0; k < 8; k++) p.push(part(box(0.012, 0.075, 0.003), k % 2 ? 0xd8dde2 : 0xc9ced4, [WX + 0.014, 0.39, WZ], [(k * Math.PI) / 4, 0, 0]).translate(0, 0, 0));
  p.push(part(box(0.1, 0.003, 0.02), 0xb23a2e, [WX - 0.06, 0.39, WZ]), part(box(0.07, 0.008, 0.008), 0x6d747b, [WX - 0.03, 0.39, WZ]));
  p.push(part(cyl(0.025, 0.04, 10), 0x8a6a3a, [WX, 0.012, WZ + 0.08])); // wooden tank
  // Cows (white with black patches), chicken coop, haystack, trough, feed sacks, bales.
  const cow = (x: number, z: number, yaw: number) => {
    const c: THREE.BufferGeometry[] = [
      part(box(0.07, 0.035, 0.032), 0xf4f1ea, [0, 0.032, 0]), part(box(0.02, 0.02, 0.022), 0xf4f1ea, [0.042, 0.048, 0]), part(box(0.022, 0.014, 0.024), 0x3a3a3a, [0.0, 0.052, 0]),
      part(box(0.012, 0.012, 0.016), 0xe9c0b0, [0.054, 0.042, 0]), part(box(0.006, 0.014, 0.006), 0x333333, [-0.038, 0.04, 0]),
    ];
    for (const [lx, lz] of [[-0.025, -0.011], [-0.025, 0.011], [0.025, -0.011], [0.025, 0.011]]) c.push(part(box(0.007, 0.03, 0.007), 0xeae6dc, [lx, 0.012, lz]));
    for (const g of c) g.rotateY(yaw).translate(x, 0.012, z);
    return c;
  };
  p.push(...cow(0.42, 0.06, 0.4), ...cow(0.4, 0.2, -0.5));
  p.push(part(box(0.1, 0.05, 0.002), 0x7b6a4a, [0.43, 0.012, 0.12])); // paddock rail fragment
  p.push(part(box(0.08, 0.05, 0.07), 0xe8d9b5, [0.4, 0.04, 0.4]), part(gable(0.09, 0.03, 0.08), 0xb23a2e, [0.4, 0.09, 0.4])); // chicken coop
  for (const x of [0.37, 0.43]) p.push(part(box(0.006, 0.03, 0.006), 0x6b4a2b, [x, 0.012, 0.4]));
  p.push(part(box(0.04, 0.003, 0.05), 0x8a6440, [0.4, 0.04, 0.45], [0.5, 0, 0]));
  p.push(part(new THREE.ConeGeometry(0.07, 0.11, 8).translate(0, 0.055, 0), 0xd8b85a, [-0.41, 0.012, -0.12])); // haystack
  p.push(part(box(0.12, 0.05, 0.05), 0x8d949c, [0.12, 0.012, -0.32]));
  p.push(part(box(0.11, 0.006, 0.04), 0x3d95d9, [0.12, 0.055, -0.32]));
  p.push(part(box(0.07, 0.05, 0.05), 0xd9c9a3, [-0.06, 0.012, 0.32]));
  p.push(part(box(0.06, 0.04, 0.045), 0xcbb98f, [0.01, 0.012, 0.31], [0, 0.4, 0]));
  p.push(part(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 6).translate(0, 0.05, 0), 0x555c63, [-0.12, 0.4, 0.1]));
  p.push(part(box(0.09, 0.008, 0.008), 0x555c63, [-0.12, 0.49, 0.1]));
  p.push(part(box(0.02, 0.03, 0.004), 0x555c63, [-0.165, 0.49, 0.1]));
  // Hay bales (round, lying on their side) with a binding strap.
  for (const [x, z] of [[-0.38, -0.3], [-0.28, -0.32], [-0.33, -0.22]]) {
    p.push(part(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 10).rotateZ(Math.PI / 2), 0xe0c46a, [x, 0.057, z]));
    p.push(part(new THREE.CylinderGeometry(0.047, 0.047, 0.006, 10).rotateZ(Math.PI / 2), 0xb08c3a, [x, 0.057, z]));
  }
  // Trees, vegetable rows and a mailbox.
  for (const [x, z, r] of [[0.05, -0.4, 0.08], [-0.46, -0.45, 0.07]] as const) { p.push(part(cyl(0.014, 0.1, 6), 0x6b4a2b, [x, 0.012, z])); p.push(part(new THREE.IcosahedronGeometry(r, 0).translate(0, 0.16, 0), 0x4f9e45, [x, 0, z])); }
  for (let k = 0; k < 3; k++) { p.push(part(box(0.12, 0.012, 0.014), 0x5f442b, [-0.12, 0.012, 0.42 + k * 0.03])); for (let j = 0; j < 4; j++) p.push(part(new THREE.IcosahedronGeometry(0.01, 0).translate(0, 0.012, 0), 0x6cc551, [-0.17 + j * 0.034, 0.02, 0.42 + k * 0.03])); }
  p.push(part(box(0.006, 0.05, 0.006), 0x6b4a2b, [0.44, 0.012, 0.465]), part(box(0.03, 0.02, 0.02), 0x2b4fa6, [0.44, 0.062, 0.465]));
  // Yard fence along the back and the sides (front stays open to the road).
  for (const x of [-0.46, -0.23, 0, 0.23, 0.46]) p.push(part(box(0.016, 0.07, 0.016), WOOD, [x, 0.012, -0.46]));
  p.push(part(box(0.94, 0.012, 0.01), WOOD, [0, 0.06, -0.46]), part(box(0.94, 0.012, 0.01), WOOD, [0, 0.035, -0.46]));
  for (const x of [-0.465, 0.465]) {
    for (const z of [-0.3, -0.15, 0, 0.15]) p.push(part(box(0.016, 0.07, 0.016), WOOD, [x, 0.012, z]));
    p.push(part(box(0.01, 0.012, 0.62), WOOD, [x, 0.06, -0.075]), part(box(0.01, 0.012, 0.62), WOOD, [x, 0.035, -0.075]));
  }
  return merge(p);
}

/** Field soil: a slightly raised tilled bed with furrows (not tinted). */
export function fieldSoil(): THREE.BufferGeometry {
  const p = [part(box(0.98, 0.014, 0.98), 0x7a5a3a)];
  for (let k = 0; k < 8; k++) p.push(part(box(0.94, 0.004, 0.03), 0x5f442b, [0, 0.014, -0.42 + k * 0.12]));
  return merge(p);
}
/** Crop rows (white → tinted per field by season and crop). 8 ridges of little plants. */
export function fieldCrops(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) {
    const z = -0.36 + k * 0.12;
    p.push(part(box(0.92, 0.035, 0.05), 0xffffff, [0, 0.014, z]));
    // Bumps along the ridge so rows read as plants, not stripes.
    for (let j = 0; j < 6; j++) {
      p.push(part(new THREE.SphereGeometry(0.028, 6, 3), 0xffffff, [-0.4 + j * 0.16, 0.05, z]));
      p.push(part(new THREE.ConeGeometry(0.014, 0.05, 5).translate(0, 0.025, 0), 0xffffff, [-0.32 + j * 0.16, 0.05, z + 0.012])); // leaf tuft between plants
    }
  }
  return merge(p);
}
/** Wooden post-and-rail fence along the NORTH (−z) edge of a field tile. */
export function fieldFence(): THREE.BufferGeometry {
  const p = [part(box(1, 0.01, 0.01), WOOD, [0, 0.06, -0.485]), part(box(1, 0.01, 0.01), WOOD, [0, 0.032, -0.485])];
  for (const x of [-0.5, -0.375, -0.25, -0.125, 0, 0.125, 0.25, 0.375]) p.push(part(box(0.018, 0.08, 0.018), 0x6d4f33, [x, 0, -0.485]));
  return merge(p);
}

/** Loading docks along the FRONT (+z): roll-up doors, bumpers, and a refrigerated (white) bay. */
function docks(p: THREE.BufferGeometry[], x0: number, n: number, z: number, h: number): void {
  for (let k = 0; k < n; k++) {
    const x = x0 + k * 0.14;
    p.push(part(box(0.1, h * 0.7, 0.006), k === n - 1 ? 0xeef3f6 : 0x8f969d, [x, 0.06, z])); // door (last = reefer bay)
    p.push(part(box(0.11, 0.06, 0.05), CONCRETE, [x, 0, z + 0.025])); // dock plate
    p.push(part(box(0.02, 0.03, 0.012), 0x222222, [x - 0.04, 0.04, z + 0.05]), part(box(0.02, 0.03, 0.012), 0x222222, [x + 0.04, 0.04, z + 0.05])); // bumpers
    p.push(part(box(0.12, 0.012, 0.06), 0x4a525a, [x, 0.06 + h * 0.7, z + 0.03])); // canopy
  }
}
/** Steel tank with a ring and a cone top. */
function tank(p: THREE.BufferGeometry[], x: number, z: number, r: number, h: number): void {
  p.push(part(cyl(r, h), STEEL, [x, 0.012, z]));
  p.push(part(new THREE.ConeGeometry(r, r * 0.6, 14).translate(0, r * 0.3, 0), STEEL_D, [x, 0.012 + h, z]));
  p.push(part(new THREE.CylinderGeometry(r + 0.004, r + 0.004, 0.012, 14), STEEL_D, [x, 0.012 + h * 0.5, z]));
  p.push(part(box(0.01, h, 0.016), 0x6d747b, [x + r, 0.012, z])); // ladder
}
/** Inclined conveyor (a covered belt on legs) from (x0,y0) up to (x1,y1) along x at depth z. */
function conveyor(p: THREE.BufferGeometry[], x0: number, y0: number, x1: number, y1: number, z: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0);
  p.push(part(new THREE.BoxGeometry(len, 0.03, 0.05), 0x9aa3ab, [(x0 + x1) / 2, (y0 + y1) / 2, z], [0, 0, ang]));
  p.push(part(new THREE.BoxGeometry(len, 0.012, 0.055), 0x4d555d, [(x0 + x1) / 2, (y0 + y1) / 2 + 0.02, z], [0, 0, ang])); // cover
  for (const f of [0.25, 0.75]) {
    const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
    p.push(part(box(0.012, y, 0.012), STEEL_D, [x, 0, z]));
  }
}
/** A cluster of oil drums (blue / rust-red / grey) with lids. */
function barrels(p: THREE.BufferGeometry[], x: number, z: number): void {
  const cols = [0x2f6fb0, 0xb14d2a, 0x8d949c, 0x2f6fb0, 0xb14d2a];
  [[0, 0], [0.09, 0.01], [0.045, 0.08], [-0.045, 0.07], [0.13, 0.07]].forEach(([dx, dz], i) => {
    p.push(part(cyl(0.035, 0.09), cols[i % cols.length], [x + dx, 0.012, z + dz]));
    p.push(part(new THREE.CylinderGeometry(0.036, 0.036, 0.008, 10), STEEL_D, [x + dx, 0.075, z + dz]));
  });
}
/** Wooden pallet stacked with two crates. */
function cratePallet(p: THREE.BufferGeometry[], x: number, z: number): void {
  p.push(part(box(0.12, 0.02, 0.1), 0x9b7a50, [x, 0.012, z]));
  p.push(part(box(0.1, 0.07, 0.08), 0xc89a5e, [x, 0.032, z]));
  p.push(part(box(0.07, 0.05, 0.06), 0xb78a4e, [x + 0.01, 0.102, z - 0.005]));
}
/** Green dumpster with a lid and caster blocks. */
function dumpster(p: THREE.BufferGeometry[], x: number, z: number): void {
  p.push(part(box(0.14, 0.09, 0.07), 0x2f7a4c, [x, 0.012, z]));
  p.push(part(box(0.145, 0.015, 0.075), 0x256b42, [x, 0.102, z]));
  for (const s of [-1, 1]) p.push(part(box(0.02, 0.02, 0.02), 0x222222, [x + s * 0.05, 0.012, z]));
}
/** Roof exhaust stack with a rain cap on two posts. */
function exhaustStack(p: THREE.BufferGeometry[], x: number, y: number, z: number, h = 0.16): void {
  p.push(part(cyl(0.02, h), STEEL_D, [x, y, z]));
  p.push(part(box(0.06, 0.012, 0.06), STEEL_D, [x, y + h + 0.02, z]));
  for (const s of [-1, 1]) p.push(part(box(0.006, 0.025, 0.006), STEEL_D, [x + s * 0.024, y + h + 0.008, z]));
}
/** Small orange traffic cone with a white band. */
function trafficCone(p: THREE.BufferGeometry[], x: number, z: number): void {
  p.push(part(new THREE.ConeGeometry(0.025, 0.07, 8).translate(0, 0.035, 0), 0xf28c1d, [x, 0.014, z]));
  p.push(part(new THREE.CylinderGeometry(0.016, 0.019, 0.015, 8).translate(0, 0.04, 0), 0xffffff, [x, 0.014, z]));
}

/**
 * Food processing plant, three variants (k = 0..2). All have the loading
 * docks + a refrigerated truck bay at the front (+z).
 *   0: processing shed with a sawtooth roof, two steel tanks, a conveyor
 *      up into the packing hall.
 *   1: three tall grain/flour silos feeding a packing hall by conveyor.
 *   2: long packing hall with roof vents and cooling units, tank farm and a
 *      parked reefer truck.
 */
export function foodPlantModel(k: number): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [part(box(0.98, 0.012, 0.98), 0x9ea2a4)]; // concrete apron
  // Painted parking/dock lines.
  for (const x of [-0.3, -0.16, -0.02, 0.12]) p.push(part(box(0.008, 0.002, 0.12), 0xf2d16b, [x + 0.07, 0.012, 0.4]));
  if (k === 0) {
    p.push(part(box(0.6, 0.24, 0.42), 0xd9d6cc, [-0.12, 0.012, 0.05])); // packing hall
    for (let j = 0; j < 4; j++) p.push(part(gable(0.15, 0.08, 0.42, 0.15), ROOF, [-0.35 + j * 0.15, 0.252, 0.05], [0, Math.PI / 2, 0])); // sawtooth
    p.push(part(box(0.62, 0.025, 0.44), 0x2f7a5c, [-0.12, 0.2, 0.05])); // green band
    tank(p, 0.32, -0.25, 0.08, 0.32);
    tank(p, 0.32, 0.02, 0.07, 0.26);
    conveyor(p, 0.3, 0.12, 0.18, 0.24, -0.18);
    docks(p, -0.36, 4, 0.265, 0.22);
    // Yard detail: barrel cluster, dumpster, roof exhaust stack.
    barrels(p, -0.4, -0.32);
    dumpster(p, 0.4, 0.32);
    exhaustStack(p, -0.275, 0.252, -0.1);
  } else if (k === 1) {
    for (const [x, z] of [[-0.3, -0.3], [-0.1, -0.3], [0.1, -0.3]]) {
      p.push(part(cyl(0.085, 0.55), 0xe4e1d8, [x, 0.012, z]));
      p.push(part(dome(0.085), 0xa9b0b6, [x, 0.562, z]));
      p.push(part(box(0.18, 0.012, 0.03), STEEL_D, [x, 0.56, z + 0.08]));
    }
    p.push(part(box(0.2, 0.012, 0.03), STEEL_D, [0.2, 0.56, -0.22])); // catwalk
    conveyor(p, 0.12, 0.52, 0.32, 0.26, -0.15);
    p.push(part(box(0.5, 0.26, 0.36), 0xcfd5d8, [0.12, 0.012, 0.1])); // packing hall
    p.push(part(gable(0.52, 0.08, 0.38), ROOF, [0.12, 0.272, 0.1]));
    p.push(part(box(0.2, 0.06, 0.006), 0xc23b2f, [0.12, 0.2, 0.282])); // company sign
    docks(p, -0.04, 3, 0.282, 0.2);
    p.push(part(box(0.1, 0.14, 0.1), 0xe8eef2, [-0.36, 0.012, 0.25])); // refrigeration unit
    for (const x of [-0.39, -0.33]) p.push(part(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 10), 0x555c63, [x, 0.157, 0.25]));
    // Staging detail: crate pallets, barrel cluster, roof exhaust stack.
    cratePallet(p, -0.3, 0.34);
    cratePallet(p, -0.14, 0.36);
    barrels(p, 0.38, -0.32);
    exhaustStack(p, 0.3, 0.272, 0.02);
  } else {
    p.push(part(box(0.78, 0.2, 0.36), 0xe6e1d4, [-0.02, 0.012, 0.06])); // long hall
    p.push(part(box(0.8, 0.02, 0.38), 0x6c757d, [-0.02, 0.212, 0.06]));
    for (const x of [-0.3, -0.1, 0.1, 0.3]) {
      p.push(part(cyl(0.025, 0.04, 10), STEEL_D, [x, 0.232, 0.0])); // roof vents
      p.push(part(box(0.08, 0.035, 0.06), 0xdfe5ea, [x, 0.232, 0.14])); // cooling units
      p.push(part(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 10), 0x444b52, [x, 0.27, 0.14]));
    }
    tank(p, -0.32, -0.32, 0.06, 0.24);
    tank(p, -0.16, -0.32, 0.06, 0.24);
    tank(p, 0.0, -0.32, 0.06, 0.24);
    p.push(part(box(0.32, 0.012, 0.02), STEEL_D, [-0.16, 0.2, -0.24])); // pipe bridge
    docks(p, -0.3, 5, 0.242, 0.18);
    // Parked reefer truck at the end bay.
    p.push(part(box(0.26, 0.11, 0.1), 0xf4f6f8, [0.3, 0.03, 0.38], [0, Math.PI / 2, 0]));
    p.push(part(box(0.08, 0.09, 0.1), 0x2f6fb0, [0.3, 0.03, 0.54 - 0.06], [0, Math.PI / 2, 0]));
    // Yard detail: dumpster, crate pallets, exhaust stack, hazard curb.
    dumpster(p, 0.42, -0.08);
    cratePallet(p, -0.4, 0.3);
    cratePallet(p, -0.26, 0.33);
    exhaustStack(p, 0.32, 0.232, -0.05);
    for (let i = 0; i < 10; i++) p.push(part(box(0.07, 0.008, 0.03), i % 2 ? 0x222222 : 0xffd21f, [-0.35 + i * 0.07, 0.012, 0.44]));
  }
  return merge(p);
}

/**
 * Construction Yard: gravel lot, a depot shed with two roll-up doors facing
 * the road (+z), an office cabin, two parked orange crew trucks, stacks of
 * bricks, pipes and timber, a sand pile and a perimeter fence.
 */
export function constructionYardModel(): THREE.BufferGeometry {
  const ORANGE = 0xf28c1d;
  const p: THREE.BufferGeometry[] = [part(box(0.98, 0.014, 0.98), 0xa49a88)]; // gravel
  for (let k = 0; k < 14; k++) p.push(part(box(0.03, 0.004, 0.03), 0x8a8170, [((k * 37) % 90) / 100 - 0.45, 0.014, ((k * 53) % 90) / 100 - 0.45])); // gravel speckle
  // Depot shed (back half).
  p.push(part(box(0.56, 0.24, 0.3), 0x6f8796, [-0.16, 0.014, -0.28]));
  p.push(part(gable(0.58, 0.07, 0.32), 0x3d4a55, [-0.16, 0.254, -0.28]));
  for (const x of [-0.3, -0.04]) {
    p.push(part(box(0.18, 0.17, 0.006), 0xc9cdd1, [x, 0.014, -0.128]));
    for (let j = 1; j < 5; j++) p.push(part(box(0.18, 0.004, 0.008), 0x9aa0a6, [x, 0.014 + j * 0.034, -0.126]));
  }
  p.push(part(box(0.1, 0.03, 0.006), ORANGE, [-0.17, 0.22, -0.128])); // yard sign
  // Office cabin.
  p.push(part(box(0.2, 0.12, 0.12), 0xf2f0ea, [0.3, 0.014, -0.32]));
  p.push(part(box(0.22, 0.012, 0.14), 0x555c63, [0.3, 0.134, -0.32]));
  p.push(part(box(0.06, 0.04, 0.004), 0x8fc6e8, [0.26, 0.07, -0.258]));
  // Two parked crew trucks (cab + orange tipper bed).
  for (const x of [-0.3, -0.06]) {
    p.push(part(box(0.1, 0.012, 0.3), 0x333333, [x, 0.03, 0.08]));
    p.push(part(box(0.1, 0.09, 0.08), 0xe8e8e8, [x, 0.035, 0.2]));
    p.push(part(box(0.1, 0.07, 0.18), ORANGE, [x, 0.042, 0.03]));
    p.push(part(box(0.08, 0.03, 0.12), 0xb14d2a, [x, 0.112, 0.03])); // bricks load
    for (const z of [0.15, -0.03]) for (const s of [-1, 1]) p.push(part(new THREE.CylinderGeometry(0.022, 0.022, 0.016, 10).rotateZ(Math.PI / 2), 0x222222, [x + s * 0.05, 0.022, z]));
  }
  // Materials: brick pallets, a pipe stack, timber, sand pile.
  for (const [x, z] of [[0.2, 0.05], [0.32, 0.05]]) {
    p.push(part(box(0.1, 0.02, 0.1), 0x9b7a50, [x, 0.014, z]));
    p.push(part(box(0.09, 0.07, 0.09), 0xb14d2a, [x, 0.034, z]));
  }
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) p.push(part(new THREE.CylinderGeometry(0.018, 0.018, 0.26, 8).rotateX(Math.PI / 2), 0x8d949c, [0.18 + c * 0.04 + r * 0.02, 0.032 + r * 0.033, 0.3]));
  for (let k = 0; k < 4; k++) p.push(part(box(0.24, 0.018, 0.035), 0xc89a5e, [0.3, 0.014 + k * 0.019, -0.12 + (k % 2) * 0.01]));
  p.push(part(new THREE.ConeGeometry(0.1, 0.09, 10).translate(0, 0.045, 0), 0xd8c08a, [0.38, 0.014, 0.22]));
  // Portable toilet, a floodlight mast, and traffic cones around the work area.
  p.push(part(box(0.07, 0.14, 0.07), 0x2f6fb0, [0.4, 0.014, -0.14]));
  p.push(part(box(0.06, 0.1, 0.006), 0x245a86, [0.4, 0.03, -0.104]));
  p.push(part(box(0.075, 0.012, 0.075), 0xf2f2f2, [0.4, 0.154, -0.14]));
  p.push(part(new THREE.CylinderGeometry(0.008, 0.01, 0.3, 8).translate(0, 0.15, 0), 0x8d949c, [-0.4, 0.014, 0.32]));
  p.push(part(box(0.09, 0.02, 0.05), 0xfff3c4, [-0.4, 0.3, 0.32]));
  for (const [x, z] of [[-0.14, 0.3], [0.02, 0.3], [0.18, 0.3], [-0.4, 0.1]]) trafficCone(p, x, z);
  // Perimeter fence (sides + back) with orange-capped posts.
  for (let k = 0; k <= 8; k++) {
    const v = -0.47 + k * 0.1175;
    p.push(part(box(0.014, 0.1, 0.014), 0x8d949c, [v, 0.014, -0.47]), part(box(0.014, 0.1, 0.014), 0x8d949c, [-0.47, 0.014, v]), part(box(0.014, 0.1, 0.014), 0x8d949c, [0.47, 0.014, v]));
  }
  p.push(part(box(0.94, 0.07, 0.004), 0xb8bec4, [0, 0.03, -0.47]));
  p.push(part(box(0.004, 0.07, 0.94), 0xb8bec4, [-0.47, 0.03, 0]), part(box(0.004, 0.07, 0.94), 0xb8bec4, [0.47, 0.03, 0]));
  return merge(p);
}

/**
 * Cargo on a construction truck (vehicle-local, +x forward): a pallet of
 * bricks, a bundle of pipes and hazard stripes on the bed — drawn on top of
 * the standard truck when its purpose is a construction run.
 */
export function crewLoadModel(): THREE.BufferGeometry {
  const p = [
    part(box(0.26, 0.012, 0.135), 0x3a3a3a, [-0.05, 0.175, 0]),
    part(box(0.09, 0.05, 0.1), 0xb14d2a, [-0.12, 0.187, 0]),
    part(box(0.095, 0.01, 0.105), 0x9b7a50, [-0.12, 0.177, 0]),
  ];
  for (let k = 0; k < 3; k++) p.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8).rotateZ(Math.PI / 2), 0x9aa3ab, [0.01, 0.2, -0.03 + k * 0.03]));
  for (let k = 0; k < 4; k++) p.push(part(box(0.02, 0.025, 0.004), k % 2 ? 0x222222 : 0xffd21f, [-0.16 + k * 0.03, 0.09, 0.067]));
  return merge(p);
}

/** Turbine nacelle (yawed into the wind by the renderer about its own origin at the tower top). */
export function nacelleModel(): THREE.BufferGeometry {
  return merge([
    part(box(0.1, 0.08, 0.2), 0xf5f7fa, [0, -0.04, 0]),
    part(new THREE.SphereGeometry(0.05, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), 0xf5f7fa, [0, 0, -0.1]),
    part(box(0.06, 0.012, 0.08), 0xc9ced4, [0, 0.04, -0.02]),
  ]);
}

// ============================================================================
// V1.5 STAGE 10 — resource industries + processors (sim/chains.ts roles).
// Each is a whole-lot model (unit square, front = +z toward the road), drawn
// INSTEAD of the generic factory, like the farm and food plant.
// ============================================================================
const logs = (n: number, x: number, z: number, len = 0.32): THREE.BufferGeometry[] => {
  // A pyramid stack of logs lying along x.
  const out: THREE.BufferGeometry[] = [];
  let k = 0;
  for (let row = 0; k < n; row++) for (let c = 0; c < 4 - row && k < n; c++, k++)
    out.push(part(new THREE.CylinderGeometry(0.03, 0.03, len, 8).rotateZ(Math.PI / 2), k % 2 ? 0x9b6b3f : 0x8a5c33, [x, 0.03 + row * 0.052, z - 0.09 + c * 0.06 + row * 0.03]));
  return out;
};
const pine = (x: number, z: number, s = 1): THREE.BufferGeometry[] => [
  part(cyl(0.015 * s, 0.1 * s, 6), 0x6b4a2b, [x, 0, z]),
  part(new THREE.ConeGeometry(0.08 * s, 0.22 * s, 7).translate(0, 0.2 * s, 0), 0x2f7a3a, [x, 0, z]),
];

/**
 * A straight bar between two points (a box oriented along the segment). Used
 * for lattice work: because every strut starts and ends exactly on the
 * points it connects, joints always meet instead of drifting apart.
 */
function strut(p: THREE.BufferGeometry[], a: [number, number, number], b: [number, number, number], t: number, color: number): void {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  const g = new THREE.BoxGeometry(t, len, t).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  p.push(part(g, color, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]));
}

/**
 * Oil rig: a four-legged lattice derrick, a pumpjack and two storage tanks.
 * The derrick legs lean INWARD toward the crown; every ring, work platform
 * and X-brace is computed from the leg positions at its height so nothing
 * hovers. The pumpjack sits on a skid with an A-frame post, a walking beam
 * pivoting on top of it, a horsehead with its cable down to the wellhead, and
 * a counterweight / gearbox / motor at the other end.
 */
export function oilRigModel(): THREE.BufferGeometry {
  const RED = 0xb0362f, DARK = 0x2c2c2c;
  const p: THREE.BufferGeometry[] = [part(box(0.96, 0.012, 0.96), 0x8b8478)];

  // ---- Lattice derrick -------------------------------------------------------
  const cx = -0.18, cz = -0.12, y0 = 0.012, yTop = 0.75, hBase = 0.09, hTop = 0.025;
  const half = (y: number) => hBase + (hTop - hBase) * ((y - y0) / (yTop - y0));
  const levels = [y0, 0.2, 0.4, 0.6, yTop];
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; // in loop order
  const at = (lv: number, k: number): [number, number, number] => {
    const h = half(levels[lv]), [a, c] = corners[k];
    return [cx + a * h, levels[lv], cz + c * h];
  };
  p.push(part(box(0.24, 0.02, 0.24), CONCRETE, [cx, y0 - 0.002, cz])); // footing pad (legs start inside it)
  for (let k = 0; k < 4; k++) strut(p, at(0, k), at(levels.length - 1, k), 0.02, RED); // legs
  for (let lv = 0; lv < levels.length; lv++) for (let k = 0; k < 4; k++) strut(p, at(lv, k), at(lv, (k + 1) % 4), 0.014, RED); // rings
  for (let lv = 0; lv < levels.length - 1; lv++) for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4; // X brace on each face of each section
    strut(p, at(lv, k), at(lv + 1, n), 0.01, 0xd04a3c);
    strut(p, at(lv, n), at(lv + 1, k), 0.01, 0xd04a3c);
  }
  for (const lv of [1, 3]) { // work platforms spanning the leg spacing at their height
    const w = half(levels[lv]) * 2 + 0.02;
    p.push(part(box(w, 0.01, w), STEEL_D, [cx, levels[lv] - 0.01, cz]));
  }
  p.push(part(cyl(0.007, yTop - y0 + 0.02, 6), 0x8d949c, [cx, y0, cz])); // drill pipe up the middle
  p.push(part(box(0.075, 0.04, 0.075), DARK, [cx, yTop - 0.01, cz])); // crown block, overlapping the leg tops
  p.push(part(box(0.03, 0.025, 0.03), 0xf2b134, [cx, yTop + 0.03, cz])); // beacon

  // ---- Pumpjack --------------------------------------------------------------
  const X = 0.2, Z = 0.15;
  p.push(part(box(0.44, 0.02, 0.16), 0x4a4f55, [X, y0, Z])); // skid (top at y = 0.032)
  for (const s of [-1, 1]) { // A-frame samson post, two struts per side
    strut(p, [X - 0.075, 0.032, Z + s * 0.035], [X, 0.17, Z + s * 0.035], 0.014, 0x5d6468);
    strut(p, [X + 0.075, 0.032, Z + s * 0.035], [X, 0.17, Z + s * 0.035], 0.014, 0x5d6468);
  }
  p.push(part(box(0.05, 0.03, 0.1), 0x3a3a3a, [X, 0.155, Z])); // pivot bearing (top at 0.185)
  const tilt = 0.2; // walking beam rocks about its centre
  p.push(part(box(0.34, 0.03, 0.04), DARK, [X, 0.185, Z], [0, 0, tilt]));
  const endY = 0.185 + Math.sin(tilt) * 0.17 + 0.015, endX = X + Math.cos(tilt) * 0.17;
  p.push(part(box(0.05, 0.075, 0.03), 0x3a3a3a, [endX - 0.025, endY - 0.04, Z], [0, 0, tilt])); // horsehead on the front end
  strut(p, [endX - 0.01, endY - 0.01, Z], [endX - 0.01, 0.06, Z], 0.006, 0x9aa3ab); // bridle cable
  p.push(part(cyl(0.016, 0.06), STEEL_D, [endX - 0.01, 0.032, Z])); // wellhead (cable ends inside it)
  p.push(part(box(0.045, 0.055, 0.07), 0x8a3b2a, [X - 0.15, 0.11, Z])); // counterweight hanging off the rear end
  p.push(part(box(0.07, 0.09, 0.05), 0x5d6468, [X - 0.12, 0.032, Z])); // gearbox (reaches the counterweight)
  p.push(part(box(0.08, 0.05, 0.05), 0x3f8f3a, [X - 0.19, 0.032, Z])); // motor

  // ---- Tanks -----------------------------------------------------------------
  p.push(part(cyl(0.1, 0.18), STEEL, [0.28, 0.012, -0.25]), part(cyl(0.1, 0.18), STEEL, [0.06, 0.012, -0.3]));
  return merge(p);
}

/** Move parts built around the origin (forward = +x) to (x, y, z), turned by yaw about y. */
function placed(parts: THREE.BufferGeometry[], yaw: number, x: number, y: number, z: number): THREE.BufferGeometry[] {
  for (const g of parts) g.rotateY(yaw).translate(x, y, z);
  return parts;
}
/** Rigid-frame haul truck (forward +x): six wheels, cab, tipping bed with a load of rock. tilt raises the front of the bed. */
function haulTruck(yaw: number, x: number, y: number, z: number, tilt = 0.05, loaded = true): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [part(box(0.22, 0.025, 0.08), 0x3d4349, [0, 0.04, 0])];
  for (const [wx, wz] of [[0.085, 0.048], [0.085, -0.048], [-0.075, 0.048], [-0.075, -0.048], [-0.03, 0.048], [-0.03, -0.048]]) {
    p.push(part(new THREE.CylinderGeometry(0.033, 0.033, 0.03, 10).rotateX(Math.PI / 2), 0x23262a, [wx, 0.033, wz]));
    p.push(part(new THREE.CylinderGeometry(0.016, 0.016, 0.032, 6).rotateX(Math.PI / 2), 0xb8bec4, [wx, 0.033, wz]));
  }
  p.push(part(box(0.06, 0.06, 0.09), 0xf2b134, [0.09, 0.052, 0]));
  p.push(part(box(0.004, 0.03, 0.07), 0x9fd7ff, [0.121, 0.09, 0]));
  p.push(part(box(0.07, 0.008, 0.1), 0xe09a1a, [0.085, 0.112, 0])); // canopy over the cab
  p.push(part(box(0.17, 0.05, 0.1), 0xe0a32a, [-0.04, 0.06, 0], [0, 0, tilt])); // tipping bed
  for (const z of [-0.052, 0.052]) p.push(part(box(0.17, 0.05, 0.006), 0xb88218, [-0.04, 0.06, z], [0, 0, tilt]));
  if (loaded) p.push(part(box(0.15, 0.02, 0.08), 0x8f897d, [-0.04, 0.105, 0], [0, 0, tilt]));
  return placed(p, yaw, x, y, z);
}
/** Crawler excavator (forward +x): tracks, house, cab, counterweight, boom, stick and bucket. */
function excavator(yaw: number, x: number, z: number): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    p.push(part(box(0.19, 0.03, 0.04), 0x2b2e31, [0, 0, s * 0.055]));
    for (const wx of [-0.07, 0, 0.07]) p.push(part(new THREE.CylinderGeometry(0.015, 0.015, 0.042, 8).rotateX(Math.PI / 2), 0x555c63, [wx, 0.015, s * 0.055]));
  }
  p.push(part(box(0.12, 0.02, 0.1), 0x3d4349, [0, 0.03, 0]));
  p.push(part(box(0.11, 0.05, 0.1), 0xe0b52a, [-0.01, 0.05, 0]));
  p.push(part(box(0.05, 0.05, 0.07), 0xf2f2ee, [0.015, 0.1, -0.01]));
  p.push(part(box(0.004, 0.03, 0.06), 0x9fd7ff, [0.042, 0.11, -0.01]));
  p.push(part(box(0.04, 0.045, 0.1), 0x4d555d, [-0.075, 0.05, 0])); // counterweight
  p.push(slab([0.04, 0.085, 0.03], [0.15, 0.18, 0.03], 0.016, 0.016, 0xe0b52a)); // boom
  p.push(slab([0.15, 0.18, 0.03], [0.21, 0.06, 0.03], 0.014, 0.014, 0xe0b52a)); // stick
  p.push(part(box(0.045, 0.04, 0.07), 0x4d555d, [0.21, 0.03, 0.03], [0, 0, 0.5])); // bucket
  p.push(part(box(0.012, 0.05, 0.012), 0x8d949c, [0.1, 0.1, 0.045], [0, 0, -0.5])); // hydraulic ram
  return placed(p, yaw, x, 0.012, z);
}
/** Articulated wheel loader (forward +x): four wheels, cab, engine hood, lift arms and bucket. */
function wheelLoader(yaw: number, x: number, z: number, bucketLoad = true): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  for (const wx of [-0.06, 0.06]) for (const s of [-1, 1]) {
    p.push(part(new THREE.CylinderGeometry(0.035, 0.035, 0.032, 10).rotateX(Math.PI / 2), 0x23262a, [wx, 0.035, s * 0.06]));
    p.push(part(new THREE.CylinderGeometry(0.018, 0.018, 0.034, 6).rotateX(Math.PI / 2), 0xe0b52a, [wx, 0.035, s * 0.06]));
  }
  p.push(part(box(0.07, 0.04, 0.08), 0xe0b52a, [-0.05, 0.04, 0]));
  p.push(part(box(0.06, 0.035, 0.08), 0xe0b52a, [0.05, 0.04, 0]));
  p.push(part(box(0.045, 0.05, 0.065), 0xf2f2ee, [-0.045, 0.08, 0]));
  p.push(part(box(0.004, 0.028, 0.055), 0x9fd7ff, [-0.022, 0.095, 0]));
  p.push(part(box(0.05, 0.03, 0.07), 0xc9971a, [-0.075, 0.08, 0])); // engine hood
  for (const s of [-1, 1]) p.push(slab([0.04, 0.07, s * 0.04], [0.115, 0.05, s * 0.04], 0.012, 0.012, 0x4d555d)); // lift arms
  p.push(part(box(0.045, 0.045, 0.11), 0x4d555d, [0.125, 0.02, 0], [0, 0, 0.25])); // bucket
  if (bucketLoad) p.push(part(new THREE.ConeGeometry(0.035, 0.03, 6).translate(0, 0.015, 0), 0x8f897d, [0.13, 0.062, 0]));
  return placed(p, yaw, x, 0.012, z);
}
/** A cone-shaped stockpile of aggregate with a darker base ring. */
function stockpile(p: THREE.BufferGeometry[], x: number, z: number, r: number, color: number): void {
  p.push(part(new THREE.ConeGeometry(r, r * 1.15, 9).translate(0, r * 0.575, 0), color, [x, 0.012, z]));
  p.push(part(new THREE.CylinderGeometry(r * 1.04, r * 1.12, 0.012, 9), 0x6e695e, [x, 0.012, z]));
}
/** A covered belt conveyor from a to b on trestle legs (legs go down to the ground). */
function beltConveyor(p: THREE.BufferGeometry[], a: [number, number, number], b: [number, number, number], legs = 3): void {
  p.push(slab(a, b, 0.04, 0.03, 0x4d555d));
  p.push(slab([a[0], a[1] + 0.018, a[2]], [b[0], b[1] + 0.018, b[2]], 0.046, 0.012, 0x2b3035)); // hood
  for (let k = 1; k <= legs; k++) {
    const f = k / (legs + 1), x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, z = a[2] + (b[2] - a[2]) * f;
    p.push(part(box(0.012, Math.max(0.01, y - 0.012), 0.012), STEEL_D, [x, 0.012, z]));
  }
}

/**
 * Quarry (role model, 1×1 lot, front = +z): a four-tier rock face with strata,
 * blast holes and a vegetated crest across the back, stepped side benches, a
 * zig-zag haul road up to the crest with a drill rig on top, and a working pit
 * floor (pond, excavator, loader, haul trucks, boulders, blasted rubble). On
 * the right: a feed ramp into a crusher hopper, belts up a screening tower and
 * three stacker conveyors dropping onto aggregate stockpiles. At the front a
 * weighbridge, site office, fuel tank, sign, light masts and perimeter fence.
 */
function quarryModel(): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [part(box(0.96, 0.012, 0.96), 0xa39e93)];
  const hh = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  // ---- Rock face: four tiers whose back edge stays at z = −0.46 while the front steps back ----
  const tierCol = [0xd2c9b2, 0xbfb59b, 0xcfc6ae, 0xada38a];
  for (let i = 0; i < 4; i++) {
    const w = 0.92 - 0.04 * i, d = 0.24 - 0.04 * i, y = 0.012 + 0.075 * i, zf = -0.22 - 0.04 * i;
    P.push(part(box(w, 0.075, d), tierCol[i], [0, y, zf - d / 2]));
    P.push(part(box(w - 0.02, 0.006, 0.006), 0x8a806a, [0, y + 0.035, zf + 0.002])); // dark strata band
    P.push(part(box(w - 0.04, 0.003, 0.035), 0x9a917b, [0, y + 0.075, zf - 0.02])); // bench ledge
    for (let k = 0; k < 4; k++) P.push(part(cyl(0.005, 0.06, 5), 0x3a3a3a, [-w * 0.38 + (k + hh(i * 4 + k)) * w * 0.2, y + 0.008, zf + 0.002])); // blast holes
  }
  P.push(part(box(0.88, 0.02, 0.12), 0x6e5a3a, [0, 0.312, -0.4])); // overburden on the crest
  for (let k = 0; k < 9; k++) P.push(part(new THREE.IcosahedronGeometry(0.02 + 0.016 * hh(k), 0).translate(0, 0.016, 0), 0x5f8f45, [-0.4 + k * 0.1, 0.332, -0.36 - 0.06 * hh(k + 20)]));
  for (const x of [-0.3, 0.34]) { P.push(part(cyl(0.008, 0.05, 5), 0x6b4a2b, [x, 0.332, -0.42])); P.push(part(new THREE.ConeGeometry(0.05, 0.14, 7).translate(0, 0.07, 0), 0x2f7a3a, [x, 0.372, -0.42])); }
  // ---- Left side benches, rubble at the foot, boulders ----
  P.push(part(box(0.12, 0.075, 0.38), tierCol[0], [-0.4, 0.012, -0.07]));
  P.push(part(box(0.08, 0.075, 0.3), tierCol[1], [-0.42, 0.087, -0.11]));
  P.push(part(box(0.05, 0.05, 0.22), tierCol[2], [-0.435, 0.162, -0.15]));
  P.push(part(box(0.04, 0.04, 0.7), 0x8a806a, [0.46, 0.012, -0.05])); // right-hand berm
  for (let k = 0; k < 8; k++) P.push(part(new THREE.ConeGeometry(0.03 + 0.03 * hh(k + 40), 0.04 + 0.04 * hh(k + 50), 6).translate(0, 0.03, 0), k % 2 ? 0xb5ab92 : 0x9a9078, [-0.32 + k * 0.09, 0.012, -0.2 + 0.03 * hh(k + 60)]));
  for (let k = 0; k < 11; k++) P.push(part(new THREE.IcosahedronGeometry(0.018 + 0.022 * hh(k + 70), 0).translate(0, 0.014, 0), k % 3 ? 0xaaa293 : 0x8a847a, [-0.3 + 0.55 * hh(k + 80), 0.012, -0.18 + 0.35 * hh(k + 90)], [hh(k), hh(k + 1), 0]));
  // ---- Pit floor: pond, haul road zig-zag up the left side, drill rig on the crest ----
  P.push(part(box(0.2, 0.01, 0.12), 0x7a735f, [-0.24, 0.012, -0.12]));
  P.push(part(box(0.17, 0.006, 0.09), 0x4d7f8f, [-0.24, 0.02, -0.12])); // pond
  const road: Array<[number, number, number]> = [[-0.22, 0.014, 0.06], [-0.36, 0.09, -0.02], [-0.42, 0.166, -0.18], [-0.34, 0.24, -0.3], [-0.2, 0.31, -0.38]];
  for (let k = 0; k < road.length - 1; k++) P.push(slab(road[k], road[k + 1], 0.07, 0.012, 0x8d826c));
  for (const [rx, ry, rz] of road) P.push(part(box(0.075, 0.014, 0.075), 0x8d826c, [rx, ry - 0.007, rz])); // landings at the bends
  P.push(...placed([part(box(0.1, 0.05, 0.07), 0xe0b52a, [0, 0.02, 0]), part(box(0.012, 0.2, 0.012), 0x4d555d, [0.045, 0.02, 0]), part(box(0.05, 0.012, 0.012), 0x4d555d, [0.02, 0.215, 0]), part(box(0.07, 0.014, 0.08), 0x2b2e31, [0, 0.012, 0])], 0.3, 0.14, 0.312, -0.38)); // drill rig
  // ---- Vehicles in the pit ----
  P.push(...excavator(-0.5, 0.04, -0.12));
  P.push(...wheelLoader(2.6, -0.06, 0.03));
  P.push(...haulTruck(0.3, -0.14, 0.012, 0.14, 0.12));
  P.push(...haulTruck(Math.PI / 2, 0.2, 0.012, 0.3, 0.0, false)); // second truck heading for the exit
  // ---- Processing plant on the right: feed ramp → crusher → belts → screen tower → stackers ----
  P.push(slab([0.16, 0.012, -0.16], [0.24, 0.13, -0.16], 0.1, 0.014, 0x8d826c)); // earth ramp for trucks to tip into the hopper
  P.push(part(box(0.14, 0.12, 0.12), 0x6d757b, [0.32, 0.012, -0.16])); // crusher house
  P.push(part(new THREE.CylinderGeometry(0.085, 0.04, 0.07, 4).rotateY(Math.PI / 4).translate(0, 0.035, 0), 0x8a8f94, [0.32, 0.132, -0.16])); // hopper
  for (const [dx, dz] of [[-0.06, -0.05], [0.06, -0.05], [-0.06, 0.05], [0.06, 0.05]]) P.push(part(box(0.01, 0.03, 0.01), STEEL_D, [0.32 + dx, 0.012, -0.16 + dz]));
  P.push(part(box(0.1, 0.02, 0.1), 0xc23b2e, [0.32, 0.128, -0.16])); // red feeder skirt
  beltConveyor(P, [0.32, 0.05, -0.1], [0.32, 0.3, 0.09]);
  P.push(part(box(0.12, 0.3, 0.1), 0x8f989f, [0.32, 0.012, 0.14])); // screening tower
  for (let k = 0; k < 6; k++) P.push(part(box(0.008, 0.3, 0.104), 0x6d757b, [0.27 + k * 0.02, 0.012, 0.14])); // wall ribs
  P.push(part(box(0.13, 0.014, 0.11), 0x3d4a55, [0.32, 0.312, 0.14])); // roof
  P.push(part(box(0.1, 0.04, 0.004), 0x9fd7ff, [0.32, 0.2, 0.192])); // window band
  P.push(part(box(0.01, 0.3, 0.02), STEEL_D, [0.39, 0.012, 0.19])); // ladder
  P.push(part(box(0.075, 0.008, 0.02), STEEL, [0.4, 0.3, 0.2]));
  beltConveyor(P, [0.32, 0.2, 0.19], [0.12, 0.13, 0.33], 2);
  beltConveyor(P, [0.32, 0.2, 0.19], [0.28, 0.12, 0.4], 1);
  beltConveyor(P, [0.32, 0.2, 0.19], [0.42, 0.11, 0.3], 1);
  stockpile(P, 0.12, 0.34, 0.09, 0x8f8f8f);
  stockpile(P, 0.28, 0.4, 0.075, 0xd8c08a);
  stockpile(P, 0.41, 0.28, 0.07, 0x4a4a4e);
  P.push(part(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 6).translate(0, 0.06, 0), 0x3d95d9, [0.45, 0.012, 0.0])); // dust-suppression water standpipe
  P.push(part(box(0.03, 0.012, 0.03), 0x3d95d9, [0.45, 0.132, 0.0]));
  // ---- Front: exit road, weighbridge, office, fuel tank, sign, masts, fence ----
  P.push(part(box(0.16, 0.006, 0.42), 0x4d5156, [-0.12, 0.012, 0.27]));
  for (let k = 0; k < 3; k++) P.push(part(box(0.012, 0.002, 0.05), 0xf2e6a0, [-0.12, 0.018, 0.14 + k * 0.12]));
  P.push(part(box(0.14, 0.012, 0.1), STEEL, [-0.12, 0.018, 0.34])); // weighbridge deck
  P.push(part(box(0.15, 0.1, 0.11), 0xf2f0ea, [-0.34, 0.012, 0.34])); // office cabin
  P.push(part(box(0.17, 0.012, 0.13), 0x4d555d, [-0.34, 0.112, 0.34]));
  P.push(part(box(0.06, 0.04, 0.004), 0x9fd7ff, [-0.34, 0.06, 0.396]));
  P.push(part(box(0.04, 0.02, 0.04), 0x8d949c, [-0.2, 0.012, 0.4])); // entry steps
  P.push(part(box(0.1, 0.05, 0.006), 0xf28c1d, [-0.34, 0.14, 0.395])); // company sign over the office door
  P.push(part(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8).rotateZ(Math.PI / 2), 0xeeeeea, [-0.4, 0.06, 0.18])); // fuel tank
  for (const dx of [-0.04, 0.04]) P.push(part(box(0.012, 0.04, 0.05), STEEL_D, [-0.4 + dx, 0.012, 0.18]));
  for (let k = 0; k < 4; k++) P.push(part(box(0.01, 0.02, 0.006), k % 2 ? 0x222222 : 0xffd21f, [-0.43 + k * 0.02, 0.07, 0.21])); // hazard stripes
  P.push(part(box(0.012, 0.1, 0.012), 0x555c63, [-0.04, 0.012, 0.46]));
  P.push(part(box(0.2, 0.014, 0.014), 0xd02c2c, [-0.13, 0.09, 0.46]));
  for (const x of [-0.45, 0.45]) { P.push(part(cyl(0.008, 0.38, 6), 0x7b8288, [x, 0.012, 0.0])); P.push(part(box(0.07, 0.014, 0.04), 0xfff3c4, [x, 0.39, 0.0])); }
  for (let k = 0; k < 10; k++) { const v = -0.46 + k * 0.1; P.push(part(box(0.012, 0.07, 0.012), 0x8d949c, [v, 0.012, 0.475])); }
  for (let k = 0; k < 8; k++) P.push(part(box(0.012, 0.07, 0.012), 0x8d949c, [-0.475, 0.012, -0.46 + k * 0.14]));
  P.push(part(box(0.94, 0.006, 0.006), 0xb8bec4, [0, 0.06, 0.475]), part(box(0.006, 0.006, 0.94), 0xb8bec4, [-0.475, 0.06, 0]));
  return merge(P);
}

/** Every role model by name (keys match sim/chains.ts Role). */
export function roleModels(): Record<string, THREE.BufferGeometry> {
  return {
    // Logging camp: cabin, log piles, stumps and forest edge.
    logging: merge([
      part(box(0.96, 0.012, 0.96), 0x7d6a4c),
      part(box(0.26, 0.16, 0.2), WOOD, [-0.25, 0.012, 0.2]), part(gable(0.3, 0.1, 0.24), 0x4a3a2c, [-0.25, 0.172, 0.2]),
      ...logs(9, 0.15, 0.15), ...logs(6, 0.2, -0.2, 0.28),
      ...[[-0.35, -0.3], [-0.15, -0.36], [0.38, -0.38], [-0.4, -0.05]].flatMap(([x, z], k) => pine(x, z, 1 + (k % 2) * 0.3)),
      ...[[0, -0.3], [0.32, 0.36]].map(([x, z]) => part(cyl(0.035, 0.04, 8), 0xa47a4a, [x, 0, z])),
      part(box(0.12, 0.06, 0.08), 0xf2b134, [-0.02, 0.012, 0.36]), // log loader
    ]),
    // Oil rig: lattice derrick, pumpjack, two tanks.
    oilRig: oilRigModel(),
    // Quarry: terraced rock face, haul road, crusher + screening plant, stockpiles, vehicles, site office.
    quarry: quarryModel(),
    // Lumber mill: long saw shed with a log yard and a plank stack.
    lumberMill: merge([
      part(box(0.96, 0.012, 0.96), 0x9c8a62),
      part(box(0.6, 0.24, 0.32), 0xb08a5a, [-0.1, 0.012, -0.15]), part(gable(0.64, 0.12, 0.36), 0x5c4a3a, [-0.1, 0.252, -0.15]),
      part(cyl(0.03, 0.42, 8), STEEL_D, [0.32, 0.012, -0.3]),
      ...logs(8, -0.2, 0.25), ...[0, 1, 2, 3].map((k) => part(box(0.26, 0.025, 0.12), 0xd8b47a, [0.25, 0.012 + k * 0.026, 0.25])),
    ]),
    // Refinery: tank farm, distillation column and a flare stack.
    refinery: merge([
      part(box(0.96, 0.012, 0.96), 0x8b8478),
      part(cyl(0.07, 0.7, 10), STEEL, [-0.25, 0.012, -0.2]), ...[0.2, 0.4, 0.6].map((y) => part(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 10), STEEL_D, [-0.25, y, -0.2])),
      part(cyl(0.025, 0.85, 6), 0x8d949c, [0.35, 0.012, -0.35]), part(new THREE.ConeGeometry(0.03, 0.08, 6).translate(0, 0.9, 0), 0xff8a1f, [0.35, 0, -0.35]),
      ...[[0.12, -0.15], [0.12, 0.2], [-0.15, 0.22]].map(([x, z]) => part(cyl(0.12, 0.16), 0xe9e4da, [x, 0.012, z])),
      part(box(0.6, 0.02, 0.02), STEEL_D, [0, 0.2, 0.02]),
    ]),
    // Building-materials plant: cement silos, aggregate bins and pallets.
    materials: merge([
      part(box(0.96, 0.012, 0.96), CONCRETE),
      part(box(0.5, 0.26, 0.3), 0xd5d1c7, [-0.15, 0.012, -0.2]), part(box(0.52, 0.03, 0.32), ROOF, [-0.15, 0.27, -0.2]),
      ...[-0.05, 0.12, 0.29].map((x) => part(cyl(0.065, 0.5, 10), 0xe2ddd2, [x + 0.05, 0.012, 0.15])),
      ...[-0.38, -0.24].map((x) => part(new THREE.ConeGeometry(0.08, 0.1, 7).translate(0, 0.05, 0), 0x9f8f78, [x, 0.012, 0.3])),
      ...[0, 1].map((k) => part(box(0.14, 0.08, 0.14), 0xc04a32, [0.3, 0.012 + k * 0.08, -0.3])),
    ]),
    // Furniture factory: brick workshop, timber store, sofas on pallets.
    furniture: merge([
      part(box(0.96, 0.012, 0.96), 0xb9b5ac),
      part(box(0.62, 0.26, 0.42), 0xa45a3e, [0, 0.012, -0.15]), part(box(0.64, 0.04, 0.44), 0x4d4a48, [0, 0.27, -0.15]),
      ...[-0.2, 0, 0.2].map((x) => part(box(0.1, 0.08, 0.012), 0xffd98a, [x, 0.1, 0.07])),
      part(box(0.2, 0.06, 0.1), 0x3d6fa8, [-0.25, 0.012, 0.3]), part(box(0.2, 0.06, 0.1), 0xc0784a, [0.05, 0.012, 0.3]),
      ...[0, 1, 2].map((k) => part(box(0.22, 0.02, 0.1), 0xd8b47a, [0.3, 0.012 + k * 0.022, 0.32])),
    ]),
    // Electronics plant: clean white hall, glass band, rooftop units.
    electronics: merge([
      part(box(0.96, 0.012, 0.96), 0xc7ccd2),
      part(box(0.7, 0.22, 0.5), 0xf3f5f7, [0, 0.012, -0.12]), part(box(0.71, 0.05, 0.51), 0x4ea3d8, [0, 0.13, -0.12]),
      ...[-0.2, 0, 0.2].map((x) => part(box(0.1, 0.05, 0.1), STEEL_D, [x, 0.232, -0.2])),
      part(box(0.2, 0.012, 0.2), 0x2c4a6e, [0.28, 0.02, 0.3]), part(box(0.06, 0.08, 0.06), 0x55a868, [-0.3, 0.012, 0.3]),
    ]),
  };
}

// ----------------------------------------------------------------------------
// V1.5b stage B — SIX NEW INDUSTRY TYPES (Parker). One model each, 1×1 unit,
// front (+z) to the road, scaled to the body like the role models. Colours
// are picked so textures.ts `autoSkin` lands the right surface: brick reds,
// mid-grey corrugated metal, light concrete, dark roofs, yellow hazard
// stripes, orange-brown rust. Signage boards are bright saturated colours.
// ----------------------------------------------------------------------------
const BRICK = 0x9a4a35, MET = 0x8f989f, MET_D = 0x5b636a, CON = 0xc4c0b6, ROOFD = 0x4b535b, HAZ = 0xf2c230, RUST = 0x8a4f26;
/** Rooftop HVAC unit with a fan grille. */
function hvac(p: THREE.BufferGeometry[], x: number, y: number, z: number): void {
  p.push(part(box(0.1, 0.05, 0.07), 0xb8bec4, [x, y, z]));
  p.push(part(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 10), 0x3a3f44, [x + 0.02, y + 0.053, z]));
}
/** Sign board on posts / wall with a coloured face (company signage). */
function sign(p: THREE.BufferGeometry[], x: number, y: number, z: number, w: number, color: number): void {
  p.push(part(box(w, 0.06, 0.012), color, [x, y, z]));
  p.push(part(box(w * 0.7, 0.014, 0.014), 0xffffff, [x, y + 0.022, z + 0.001]));
}
/** Hazard-striped kerb + two bollards in front of a door. */
function hazardKerb(p: THREE.BufferGeometry[], x: number, z: number, w: number): void {
  p.push(part(box(w, 0.012, 0.025), HAZ, [x, 0.012, z]));
  for (const s of [-1, 1]) p.push(part(cyl(0.012, 0.07, 8), HAZ, [x + s * (w / 2), 0.012, z + 0.02]));
}
const apron = () => part(box(0.98, 0.012, 0.98), 0x9ea2a4);

export function newIndustryModels(): Record<string, THREE.BufferGeometry> {
  const out: Record<string, THREE.BufferGeometry> = {};
  { // WAREHOUSE / DISTRIBUTION CENTRE: long low metal shed, many dock doors, trailers, yard.
    const p = [apron()];
    p.push(part(box(0.86, 0.24, 0.56), MET, [0, 0.012, -0.12]));
    p.push(part(box(0.88, 0.02, 0.58), ROOFD, [0, 0.252, -0.12]));
    docks(p, -0.35, 6, 0.16, 0.24);
    for (let k = 0; k < 4; k++) hvac(p, -0.3 + k * 0.2, 0.272, -0.15);
    for (const x of [-0.3, -0.02]) { p.push(part(box(0.1, 0.09, 0.32), 0xe8e8e8, [x, 0.03, 0.38])); p.push(part(box(0.1, 0.012, 0.32), 0x3a3a3a, [x, 0.012, 0.38])); }
    sign(p, 0.25, 0.18, 0.165, 0.26, 0x2f6fb0);
    hazardKerb(p, 0.3, 0.42, 0.2);
    out.warehouse = merge(p);
  }
  { // CHEMICAL PLANT: process columns, spherical tanks, pipe racks, flare stack.
    const p = [apron()];
    p.push(part(box(0.36, 0.2, 0.26), CON, [-0.26, 0.012, 0.2]));
    p.push(part(box(0.38, 0.015, 0.28), ROOFD, [-0.26, 0.212, 0.2]));
    for (const [x, z, h] of [[0.05, -0.15, 0.62], [0.17, -0.2, 0.5], [0.05, 0.02, 0.42]] as const) {
      p.push(part(cyl(0.045, h, 12), 0xd0d4d8, [x, 0.012, z]));
      for (let r = 1; r < 4; r++) p.push(part(box(0.11, 0.006, 0.11), MET_D, [x, 0.012 + (h * r) / 4, z]));
    }
    for (const [x, z] of [[0.32, 0.2], [0.32, -0.05]]) { p.push(part(new THREE.SphereGeometry(0.1, 14, 8), 0xe6e8ea, [x, 0.17, z])); for (const s of [-1, 1]) p.push(part(box(0.012, 0.1, 0.012), MET_D, [x + s * 0.07, 0.012, z])); }
    p.push(part(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6).rotateZ(Math.PI / 2), RUST, [0, 0.3, -0.32]));
    p.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 6).rotateZ(Math.PI / 2), 0x3f8a5a, [0, 0.26, -0.32]));
    for (const x of [-0.3, 0, 0.3]) p.push(part(box(0.015, 0.3, 0.015), MET_D, [x, 0.012, -0.32]));
    p.push(part(cyl(0.018, 0.85, 8), 0xc23b2e, [-0.38, 0.012, -0.36]));
    p.push(part(new THREE.ConeGeometry(0.03, 0.06, 8).translate(0, 0.03, 0), 0xff8a20, [-0.38, 0.86, -0.36]));
    barrels(p, -0.4, 0.38);
    hazardKerb(p, -0.2, 0.36, 0.18);
    sign(p, -0.26, 0.15, 0.335, 0.22, 0xe07a1f);
    out.chemical = merge(p);
  }
  { // STEEL MILL: tall brick-and-rust melt shop, blast furnace, stacks, ore piles.
    const p = [apron()];
    p.push(part(box(0.5, 0.42, 0.42), RUST, [-0.18, 0.012, 0.1]));
    p.push(part(gable(0.52, 0.1, 0.44, 0.02), ROOFD, [-0.18, 0.43, 0.1]));
    p.push(part(box(0.5, 0.12, 0.006), BRICK, [-0.18, 0.012, 0.32]));
    p.push(part(new THREE.CylinderGeometry(0.08, 0.12, 0.55, 12).translate(0, 0.275, 0), MET_D, [0.25, 0.012, -0.15]));
    p.push(part(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8).rotateZ(0.9), RUST, [0.12, 0.5, -0.15]));
    for (const [x, h] of [[0.36, 0.95], [0.18, 0.85]] as const) {
      p.push(part(new THREE.CylinderGeometry(0.03, 0.045, h, 10).translate(0, h / 2, 0), 0xb9b2a6, [x, 0.012, -0.38]));
      p.push(part(new THREE.CylinderGeometry(0.033, 0.033, 0.04, 10), 0xc23b2e, [x, h - 0.08, -0.38]));
    }
    p.push(part(new THREE.ConeGeometry(0.14, 0.1, 8).translate(0, 0.05, 0).scale(1.4, 1, 1), 0x7a4a36, [0.28, 0.012, 0.3]));
    conveyor(p, 0.2, 0.05, -0.05, 0.38, 0.22);
    for (let k = 0; k < 3; k++) p.push(part(box(0.12, 0.025, 0.08), 0x6d6f73, [-0.35 + k * 0.14, 0.012, 0.42])); // slabs
    sign(p, -0.18, 0.3, 0.325, 0.2, 0x3d5a80);
    out.steel = merge(p);
  }
  { // TEXTILE MILL: classic red-brick multi-storey mill with tall windows + chimney + water tower.
    const p = [apron()];
    p.push(part(box(0.72, 0.4, 0.34), BRICK, [-0.05, 0.012, 0.0]));
    p.push(part(box(0.74, 0.02, 0.36), ROOFD, [-0.05, 0.412, 0]));
    for (let f = 0; f < 3; f++) for (let c = 0; c < 7; c++) p.push(part(box(0.06, 0.07, 0.006), 0x9fd7ff, [-0.38 + c * 0.1, 0.06 + f * 0.12, 0.173]));
    p.push(part(box(0.1, 0.5, 0.1), BRICK, [0.34, 0.012, -0.05])); // stair tower
    p.push(part(new THREE.ConeGeometry(0.08, 0.1, 4).rotateY(Math.PI / 4).translate(0, 0.05, 0), ROOFD, [0.34, 0.512, -0.05]));
    p.push(part(new THREE.CylinderGeometry(0.03, 0.05, 0.9, 10).translate(0, 0.45, 0), 0x8a4532, [-0.38, 0.012, -0.32]));
    p.push(part(cyl(0.07, 0.1, 10), 0x6b4a32, [0.1, 0.43, -0.08])); // rooftop water tank
    for (let k = 0; k < 4; k++) p.push(part(box(0.06, 0.04, 0.06), 0xd3c7e8, [0.3 + (k % 2) * 0.07, 0.012 + Math.floor(k / 2) * 0.04, 0.32])); // bales of cloth
    sign(p, -0.05, 0.33, 0.18, 0.3, 0x7d2f6b);
    out.textile = merge(p);
  }
  { // BOTTLING PLANT: clean concrete hall, glass-front lobby, silo + syrup tanks, crate stacks.
    const p = [apron()];
    p.push(part(box(0.66, 0.24, 0.42), CON, [-0.1, 0.012, -0.08]));
    p.push(part(box(0.68, 0.02, 0.44), ROOFD, [-0.1, 0.252, -0.08]));
    p.push(part(box(0.2, 0.16, 0.006), 0x9fd7ff, [-0.25, 0.04, 0.134]));
    for (let k = 0; k < 3; k++) tank(p, 0.36, -0.3 + k * 0.17, 0.065, 0.32);
    p.push(part(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6).rotateZ(Math.PI / 2), 0xd0d4d8, [0.12, 0.2, -0.14]));
    for (let k = 0; k < 4; k++) p.push(part(box(0.07, 0.05, 0.07), [0x2f9a4c, 0xc23b2e][k % 2], [0.08 + (k % 2) * 0.08, 0.012 + Math.floor(k / 2) * 0.05, 0.32]));
    docks(p, 0.02, 2, 0.134, 0.22);
    hvac(p, -0.2, 0.272, -0.12); hvac(p, 0.05, 0.272, -0.2);
    sign(p, -0.1, 0.27, 0.14, 0.32, 0xd02c2c);
    out.bottling = merge(p);
  }
  { // ASSEMBLY PLANT: big sawtooth-roof hall, paint shop with stacks, finished-goods lot.
    const p = [apron()];
    p.push(part(box(0.78, 0.26, 0.5), MET, [0, 0.012, -0.18]));
    for (let s = 0; s < 4; s++) p.push(part(gable(0.78, 0.08, 0.125, 0.12), ROOFD, [0, 0.272, -0.37 + s * 0.125]));
    for (let s = 0; s < 4; s++) p.push(part(box(0.76, 0.05, 0.006), 0x9fd7ff, [0, 0.29, -0.42 + s * 0.125])); // sawtooth glazing
    p.push(part(box(0.22, 0.18, 0.18), CON, [-0.26, 0.012, 0.2])); // paint shop
    for (const x of [-0.32, -0.2]) exhaustStack(p, x, 0.192, 0.2, 0.2);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) p.push(part(box(0.06, 0.04, 0.1), [0x2f6fb0, 0xe8e8e8, 0xc23b2e, 0x3a3a3a][(r + c) % 4], [0.02 + c * 0.1, 0.012, 0.18 + r * 0.16])); // finished products
    docks(p, 0.1, 3, 0.07, 0.24);
    hazardKerb(p, 0.24, 0.12, 0.3);
    sign(p, 0.0, 0.2, 0.074, 0.18, 0x1f7a3d);
    out.assembly = merge(p);
  }
  return out;
}
