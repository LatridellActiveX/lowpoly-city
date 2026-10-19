/**
 * render/farmVehicles.ts — the machines that work the farm fields (animated by
 * cityRenderer): a tractor with a plough, a seed drill or a crop sprayer, and a
 * combine harvester. All face +x (forward), sit on y = 0 and are about 0.12–0.22
 * tiles long. Plain vertex-coloured geometry (the shared `solid` material).
 */
import * as THREE from 'three';
import { box, merge, part } from './models';

type G = THREE.BufferGeometry;
const GREEN = 0x3f8f3a, GLASS = 0x9fd7ff, TYRE = 0x1f2124, STEEL = 0x555c63;
const wheel = (r: number, w: number, x: number, z: number, hub = 0xe0b52a): G[] => [
  part(new THREE.CylinderGeometry(r, r, w, 10).rotateX(Math.PI / 2), TYRE, [x, r, z]),
  part(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.002, 8).rotateX(Math.PI / 2), hub, [x, r, z]),
];

/** Tractor: hood, cab with glass and roof, exhaust, big rear and small front wheels. Hitch at x = -0.075. */
function tractorParts(): G[] {
  const p: G[] = [
    part(box(0.07, 0.035, 0.05), GREEN, [0.03, 0.03, 0]), // hood
    part(box(0.012, 0.025, 0.045), STEEL, [0.068, 0.034, 0]), // grille / weights
    part(box(0.05, 0.04, 0.056), GREEN, [-0.03, 0.03, 0]), // body
    part(box(0.04, 0.04, 0.05), GLASS, [-0.03, 0.068, 0]), // cab glass
    part(box(0.05, 0.006, 0.058), 0x2f2f2f, [-0.03, 0.108, 0]), // cab roof
    part(new THREE.CylinderGeometry(0.004, 0.004, 0.045, 5).translate(0, 0.0225, 0), 0x333333, [0.045, 0.062, 0.014]), // exhaust
    part(box(0.012, 0.012, 0.03), STEEL, [-0.07, 0.03, 0]), // hitch
  ];
  for (const s of [-1, 1]) p.push(...wheel(0.032, 0.022, -0.035, s * 0.04), ...wheel(0.02, 0.016, 0.055, s * 0.036));
  return p;
}
/** Plough: a frame with four angled mouldboards, towed behind the tractor. */
function ploughParts(): G[] {
  const p: G[] = [part(box(0.1, 0.01, 0.012), STEEL, [-0.13, 0.04, 0], [0, 0.4, 0]), part(box(0.012, 0.03, 0.012), STEEL, [-0.08, 0.025, 0])];
  for (let k = 0; k < 4; k++) {
    const z = -0.06 + k * 0.04, x = -0.12 - k * 0.012;
    p.push(part(box(0.045, 0.034, 0.006), 0x8d949c, [x, 0.006, z], [0, 0.6, 0.15]), part(box(0.012, 0.03, 0.006), STEEL, [x + 0.02, 0.03, z]));
  }
  return p;
}
/** Seed drill: red hopper with a green stripe on two wheels and seed tubes dropping to the soil. */
function seederParts(): G[] {
  const p: G[] = [part(box(0.012, 0.012, 0.03), STEEL, [-0.09, 0.034, 0]), part(box(0.05, 0.05, 0.16), 0xb23a2e, [-0.14, 0.03, 0]), part(box(0.052, 0.008, 0.162), GREEN, [-0.14, 0.062, 0])];
  for (const z of [-0.07, 0, 0.07]) p.push(part(box(0.034, 0.03, 0.012), 0xd9d9d0, [-0.14, 0.08, z]));
  for (let k = 0; k < 6; k++) p.push(part(box(0.004, 0.034, 0.004), STEEL, [-0.166, 0.0, -0.075 + k * 0.03]));
  for (const s of [-1, 1]) p.push(...wheel(0.02, 0.014, -0.14, s * 0.086, 0xb23a2e));
  return p;
}
/** Crop sprayer: a yellow tank on wheels with a wide folded-out boom and nozzles. */
function sprayerParts(): G[] {
  const p: G[] = [part(box(0.012, 0.012, 0.03), STEEL, [-0.09, 0.034, 0]), part(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 10).rotateZ(Math.PI / 2), 0xe8d24a, [-0.145, 0.058, 0]), part(box(0.006, 0.006, 0.26), STEEL, [-0.19, 0.05, 0])];
  for (let k = 0; k < 9; k++) p.push(part(box(0.003, 0.016, 0.003), 0x2f6fb0, [-0.19, 0.036, -0.12 + k * 0.03]));
  for (const s of [-1, 1]) p.push(...wheel(0.022, 0.014, -0.145, s * 0.045, 0xe8d24a));
  return p;
}
export const tractorPlough = (): G => merge([...tractorParts(), ...ploughParts()]);
export const tractorSeeder = (): G => merge([...tractorParts(), ...seederParts()]);
export const tractorSprayer = (): G => merge([...tractorParts(), ...sprayerParts()]);

/** Combine harvester: yellow body, cab, grain tank with an unloading auger, wide header with a reel. */
export function combineHarvester(): G {
  const Y = 0xe0b52a;
  const p: G[] = [
    part(box(0.12, 0.05, 0.085), Y, [-0.02, 0.03, 0]), // body
    part(box(0.07, 0.04, 0.085), 0xc9971a, [-0.06, 0.08, 0]), // grain tank
    part(box(0.05, 0.04, 0.07), GLASS, [0.03, 0.08, 0]), // cab glass
    part(box(0.056, 0.006, 0.076), 0x2f2f2f, [0.03, 0.12, 0]),
    part(box(0.11, 0.008, 0.01), Y, [-0.03, 0.12, -0.055], [0, 0.5, 0.4]), // unloading auger
    part(box(0.07, 0.04, 0.2), 0x9b8f40, [0.1, 0.012, 0]), // header
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8).rotateX(Math.PI / 2), 0xb23a2e, [0.115, 0.06, 0]), // reel
    part(box(0.012, 0.01, 0.2), STEEL, [0.14, 0.014, 0]), // cutter bar
  ];
  for (const s of [-1, 1]) p.push(...wheel(0.034, 0.026, 0.02, s * 0.052, Y), ...wheel(0.02, 0.018, -0.08, s * 0.04, Y));
  return merge(p);
}
