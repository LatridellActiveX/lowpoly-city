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
  const p: THREE.BufferGeometry[] = [
    part(box(0.96, 0.012, 0.96), 0x9c8a62), // packed-earth yard
    // Barn: walls + gable roof (ridge along x) + white door frame and X brace.
    part(box(0.46, 0.22, 0.34), 0xb23a2e, [-0.12, 0.012, 0.1]),
    part(gable(0.5, 0.14, 0.38), 0x4d4a48, [-0.12, 0.232, 0.1]),
    part(box(0.18, 0.16, 0.006), 0xf1ece2, [-0.12, 0.012, 0.272]),
    part(box(0.16, 0.14, 0.008), 0x8e2b22, [-0.12, 0.02, 0.274]),
    part(box(0.012, 0.19, 0.006), 0xf1ece2, [-0.12, 0.012, 0.279], [0, 0, 0.72]),
    part(box(0.012, 0.19, 0.006), 0xf1ece2, [-0.12, 0.012, 0.279], [0, 0, -0.72]),
    part(box(0.08, 0.06, 0.006), 0xf1ece2, [-0.12, 0.25, 0.272]), // hay-loft door
    // Silo: corrugated look from stacked rings + dome cap.
    part(cyl(0.085, 0.5), 0xd8dde2, [0.27, 0.012, -0.12]),
    part(dome(0.085), 0x9aa3ab, [0.27, 0.512, -0.12]),
    part(new THREE.CylinderGeometry(0.089, 0.089, 0.012, 14), 0xaab2ba, [0.27, 0.14, -0.12]),
    part(new THREE.CylinderGeometry(0.089, 0.089, 0.012, 14), 0xaab2ba, [0.27, 0.3, -0.12]),
    part(new THREE.CylinderGeometry(0.089, 0.089, 0.012, 14), 0xaab2ba, [0.27, 0.44, -0.12]),
    part(box(0.012, 0.5, 0.02), 0x6d747b, [0.36, 0.012, -0.12]), // ladder
    // Tool shed + small tractor.
    part(box(0.18, 0.12, 0.16), 0xe7dcc4, [0.27, 0.012, 0.22]),
    part(gable(0.2, 0.06, 0.18), 0x6b5444, [0.27, 0.132, 0.22]),
    part(box(0.09, 0.05, 0.06), 0x3f8f3a, [0.05, 0.03, 0.36]),
    part(box(0.04, 0.04, 0.05), 0x2f2f2f, [0.07, 0.08, 0.36]),
    part(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10).rotateX(Math.PI / 2), 0x222222, [0.025, 0.03, 0.39]),
    part(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10).rotateX(Math.PI / 2), 0x222222, [0.025, 0.03, 0.33]),
  ];
  // Water trough, feed sacks by the barn door, a weather vane on the roof.
  p.push(part(box(0.12, 0.05, 0.05), 0x8d949c, [0.12, 0.012, -0.32]));
  p.push(part(box(0.11, 0.006, 0.04), 0x3d95d9, [0.12, 0.055, -0.32]));
  p.push(part(box(0.07, 0.05, 0.05), 0xd9c9a3, [-0.34, 0.012, 0.18]));
  p.push(part(box(0.06, 0.04, 0.045), 0xcbb98f, [-0.27, 0.012, 0.2], [0, 0.4, 0]));
  p.push(part(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 6).translate(0, 0.05, 0), 0x555c63, [-0.12, 0.372, 0.1]));
  p.push(part(box(0.09, 0.008, 0.008), 0x555c63, [-0.12, 0.46, 0.1]));
  p.push(part(box(0.02, 0.03, 0.004), 0x555c63, [-0.165, 0.46, 0.1]));
  // Hay bales (round, lying on their side).
  for (const [x, z] of [[-0.38, -0.3], [-0.28, -0.32], [-0.33, -0.22]]) p.push(part(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 10).rotateZ(Math.PI / 2), 0xe0c46a, [x, 0.057, z]));
  // Yard fence along the back and the sides (front stays open to the road).
  for (const x of [-0.46, -0.23, 0, 0.23, 0.46]) p.push(part(box(0.016, 0.07, 0.016), WOOD, [x, 0.012, -0.46]));
  p.push(part(box(0.94, 0.012, 0.01), WOOD, [0, 0.06, -0.46]), part(box(0.94, 0.012, 0.01), WOOD, [0, 0.035, -0.46]));
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
    for (let j = 0; j < 6; j++) p.push(part(new THREE.SphereGeometry(0.028, 6, 3), 0xffffff, [-0.4 + j * 0.16, 0.05, z]));
  }
  return merge(p);
}
/** Wooden post-and-rail fence along the NORTH (−z) edge of a field tile. */
export function fieldFence(): THREE.BufferGeometry {
  const p = [part(box(1, 0.01, 0.01), WOOD, [0, 0.06, -0.485]), part(box(1, 0.01, 0.01), WOOD, [0, 0.032, -0.485])];
  for (const x of [-0.5, -0.25, 0, 0.25]) p.push(part(box(0.018, 0.08, 0.018), 0x6d4f33, [x, 0, -0.485]));
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
