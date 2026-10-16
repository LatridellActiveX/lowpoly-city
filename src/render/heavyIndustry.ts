/**
 * render/heavyIndustry.ts — detailed heavy-industry models (chemical plant,
 * steel mill, assembly plant, refinery, building-materials plant, electronics
 * plant). Same conventions as industryModels.ts: 1 unit = 1 tile, y up, front
 * (+z) to the road, merged vertex-coloured geometry.
 *
 * Surfaces: a handful of colours are reserved for the new atlas skins and are
 * mapped by exact vertex colour in HEAVY_SKINS (riveted plate on tanks and
 * columns, ribbed cladding on halls, louvres on cooling towers, grating on
 * walkways). Everything else falls through to the colour-based autoSkin
 * (brick reds, rust browns, hazard yellows, glass blues, grey roofs …).
 */
import * as THREE from 'three';
import { box, gable, merge, part } from './models';
import { Skin } from './textures';

type G = THREE.BufferGeometry;
type V3 = [number, number, number];

const PLATE = 0x7e878f, CLAD = 0xa9b3ba, CLAD_B = 0x5f87aa, CLAD_W = 0xdde1e4, LOUV = 0x6f7a82, GRATE = 0x4a5258;
const PIPE_R = 0xc13a2c, PIPE_Y = 0xe2b81f, PIPE_G = 0x3f8a5a, PIPE_B = 0x3a74b8;
const BRICK = 0x9a4a35, RUST = 0x8a4f26, HAZ = 0xf2c230, CON = 0xc4c0b6, ROOFD = 0x4b535b, MET_D = 0x5b636a, STEEL = 0xc5cbd2;
const GLASS = 0x9fd7ff, DARK = 0x2b3035, YARD = 0xbdbab2;

/** Exact-colour surface table for the heavy models (colours chosen to be unique to them). */
export const HEAVY_SKINS: Record<number, Skin> = {
  [PLATE]: Skin.Plate, [CLAD]: Skin.Cladding, [CLAD_B]: Skin.Cladding, [CLAD_W]: Skin.Cladding, [LOUV]: Skin.Louvre, [GRATE]: Skin.Grate,
  [PIPE_R]: Skin.Plate, [PIPE_Y]: Skin.Plain, [PIPE_G]: Skin.Plain, [PIPE_B]: Skin.Plain,
};

const Y = 0.012;
const cyl = (r: number, h: number, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);
const dome = (r: number, seg = 12) => new THREE.SphereGeometry(r, seg, 5, 0, Math.PI * 2, 0, Math.PI / 2);
const yard = (c = YARD) => part(box(0.98, 0.012, 0.98), c);

/** Straight rod / pipe between two points (round when seg > 0, square otherwise). */
function pipe(p: G[], a: V3, b: V3, r: number, color: number, seg = 8): void {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  if (len < 1e-5) return;
  const geo = seg > 0 ? new THREE.CylinderGeometry(r, r, len, seg) : new THREE.BoxGeometry(r * 2, len, r * 2);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  p.push(part(geo, color, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]));
}
const ball = (p: G[], x: number, y: number, z: number, r: number, color: number) => p.push(part(new THREE.SphereGeometry(r, 8, 6), color, [x, y, z]));
/** Vertical steel ladder (facing +z) with rungs. */
function ladder(p: G[], x: number, z: number, y0: number, y1: number): void {
  p.push(part(box(0.005, y1 - y0, 0.005), MET_D, [x - 0.009, y0, z]), part(box(0.005, y1 - y0, 0.005), MET_D, [x + 0.009, y0, z]));
  for (let y = y0 + 0.025; y < y1; y += 0.035) p.push(part(box(0.022, 0.003, 0.005), MET_D, [x, y, z]));
}
/** Round grated platform with a handrail. */
function ring(p: G[], x: number, y: number, z: number, r: number): void {
  p.push(part(cyl(r, 0.006, 14), GRATE, [x, y, z]));
  p.push(part(new THREE.TorusGeometry(r, 0.0022, 3, 14).rotateX(Math.PI / 2), MET_D, [x, y + 0.03, z]));
}
/** Grated walkway with handrails along x or z. */
function walkway(p: G[], x: number, y: number, z: number, w: number, d: number): void {
  p.push(part(box(w, 0.006, d), GRATE, [x, y, z]));
  p.push(part(box(w, 0.003, 0.003), MET_D, [x, y + 0.03, z + d / 2]), part(box(w, 0.003, 0.003), MET_D, [x, y + 0.03, z - d / 2]));
}
/** Rooftop air handler: casing, fan guard, intake louvres. */
function ahu(p: G[], x: number, y: number, z: number, w = 0.1, d = 0.07): void {
  p.push(part(box(w, 0.045, d), 0xb8bec4, [x, y, z]));
  p.push(part(box(w * 0.5, 0.036, 0.004), LOUV, [x - w * 0.18, y + 0.006, z + d / 2]));
  p.push(part(cyl(0.02, 0.006, 10), DARK, [x + w * 0.22, y + 0.045, z]));
  p.push(part(new THREE.TorusGeometry(0.02, 0.002, 3, 10).rotateX(Math.PI / 2), MET_D, [x + w * 0.22, y + 0.05, z]));
}
/** Industrial sign board with a bright face and white lettering bar. */
function sign(p: G[], x: number, y: number, z: number, w: number, color: number): void {
  p.push(part(box(w, 0.06, 0.012), color, [x, y, z]));
  p.push(part(box(w * 0.7, 0.014, 0.014), 0xffffff, [x, y + 0.022, z + 0.001]));
  p.push(part(box(w * 0.4, 0.008, 0.014), 0xffffff, [x, y + 0.004, z + 0.001]));
}
/** Hazard-striped kerb with bollards. */
function kerb(p: G[], x: number, z: number, w: number): void {
  p.push(part(box(w, 0.012, 0.025), HAZ, [x, Y, z]));
  for (const s of [-1, 1]) p.push(part(cyl(0.01, 0.06, 8), HAZ, [x + s * (w / 2), Y, z + 0.02]));
}
/** Chain-link fence along x at depth z (posts, top rail and mid rail). */
function fenceX(p: G[], x0: number, x1: number, z: number): void {
  const n = Math.max(1, Math.round((x1 - x0) / 0.09));
  for (let k = 0; k <= n; k++) p.push(part(box(0.008, 0.06, 0.008), MET_D, [x0 + ((x1 - x0) * k) / n, Y, z]));
  p.push(part(box(x1 - x0, 0.004, 0.004), STEEL, [(x0 + x1) / 2, Y + 0.056, z]), part(box(x1 - x0, 0.003, 0.003), STEEL, [(x0 + x1) / 2, Y + 0.03, z]));
}
function fenceZ(p: G[], z0: number, z1: number, x: number): void {
  const n = Math.max(1, Math.round((z1 - z0) / 0.09));
  for (let k = 0; k <= n; k++) p.push(part(box(0.008, 0.06, 0.008), MET_D, [x, Y, z0 + ((z1 - z0) * k) / n]));
  p.push(part(box(0.004, 0.004, z1 - z0), STEEL, [x, Y + 0.056, (z0 + z1) / 2]), part(box(0.003, 0.003, z1 - z0), STEEL, [x, Y + 0.03, (z0 + z1) / 2]));
}
/** Process column: plate shell, insulation bands, dome head, platforms, ladder, vent. */
function column(p: G[], x: number, z: number, r: number, h: number): void {
  p.push(part(cyl(r, h), PLATE, [x, Y, z]));
  p.push(part(dome(r), PLATE, [x, Y + h, z]));
  p.push(part(cyl(r * 1.3, 0.02), CON, [x, Y, z])); // skirt base
  for (let i = 1; i <= 4; i++) p.push(part(cyl(r + 0.004, 0.01), MET_D, [x, Y + (h * i) / 5, z]));
  for (const f of [0.35, 0.65, 0.9]) ring(p, x, Y + h * f, z, r + 0.018);
  ladder(p, x, z + r + 0.008, Y, Y + h * 0.9);
  p.push(part(cyl(0.008, 0.06, 6), PIPE_R, [x, Y + h + r * 0.8, z]));
  pipe(p, [x - r, Y + h * 0.6, z], [x - r - 0.04, Y + h * 0.6, z], 0.006, PIPE_Y, 6);
}
/** Spherical pressure tank on braced legs with a stair and a top platform. */
function sphereTank(p: G[], x: number, z: number, r: number): void {
  const cy = Y + r * 1.3;
  p.push(part(new THREE.SphereGeometry(r, 14, 10), PLATE, [x, cy, z]));
  p.push(part(new THREE.TorusGeometry(r, 0.004, 4, 16).rotateX(Math.PI / 2), MET_D, [x, cy, z]));
  const legTop = cy - r * 0.6;
  const legs: V3[] = [];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; legs.push([x + Math.cos(a) * r * 0.8, 0, z + Math.sin(a) * r * 0.8]); }
  for (let i = 0; i < 6; i++) {
    const l = legs[i], n = legs[(i + 1) % 6];
    pipe(p, [l[0], Y, l[2]], [l[0], legTop, l[2]], 0.006, MET_D, 6);
    pipe(p, [l[0], Y + 0.02, l[2]], [n[0], legTop - 0.03, n[2]], 0.0025, STEEL, 0);
    pipe(p, [n[0], Y + 0.02, n[2]], [l[0], legTop - 0.03, l[2]], 0.0025, STEEL, 0);
  }
  p.push(part(cyl(r * 0.9, 0.01, 6), CON, [x, 0, z]));
  pipe(p, [x + r * 1.2, Y, z], [x + r * 0.25, cy + r * 0.98, z], 0.007, GRATE, 0); // stair
  ring(p, x, cy + r * 0.98, z, 0.03);
  p.push(part(cyl(0.008, 0.035, 6), PIPE_R, [x, cy + r, z]));
  pipe(p, [x, Y, z - r * 0.4], [x, cy - r * 0.9, z - r * 0.4], 0.006, PIPE_B, 6); // fill line
}
/** Horizontal pressure vessel ("bullet") on two saddles, axis along x. */
function bullet(p: G[], x: number, z: number, len: number, r: number, color = PLATE): void {
  const cy = Y + r + 0.02;
  p.push(part(new THREE.CylinderGeometry(r, r, len, 10).rotateZ(Math.PI / 2), color, [x, cy, z]));
  for (const s of [-1, 1]) {
    p.push(part(new THREE.SphereGeometry(r, 10, 6).scale(0.6, 1, 1), color, [x + (s * len) / 2, cy, z]));
    p.push(part(box(0.018, r + 0.02, r * 1.7), CON, [x + s * len * 0.3, Y, z]));
  }
  p.push(part(cyl(0.01, 0.025, 6), PIPE_R, [x, cy + r, z]));
}
/** Floating-roof storage tank: ribbed shell, roof rim, centre well, stair and a bund. */
function storageTank(p: G[], x: number, z: number, r: number, h: number, shell = CLAD_W): void {
  p.push(part(cyl(r, h, 16), shell, [x, Y, z]));
  p.push(part(new THREE.TorusGeometry(r, 0.004, 3, 16).rotateX(Math.PI / 2), MET_D, [x, Y + h, z]));
  p.push(part(cyl(r * 0.94, 0.008, 16), GRATE, [x, Y + h - 0.02, z]));
  p.push(part(cyl(r * 0.18, 0.012, 8), MET_D, [x, Y + h - 0.016, z]));
  pipe(p, [x + r + 0.006, Y, z + 0.02], [x + 0.02, Y + h + 0.01, z + r * 0.35], 0.005, MET_D, 0); // stair
  p.push(part(cyl(r * 1.02, 0.012, 16), CON, [x, Y, z]));
}
/** Low containment wall (bund) rectangle. */
function bund(p: G[], x0: number, x1: number, z0: number, z1: number): void {
  const t = 0.012, h = 0.03;
  p.push(part(box(x1 - x0, h, t), CON, [(x0 + x1) / 2, Y, z0]), part(box(x1 - x0, h, t), CON, [(x0 + x1) / 2, Y, z1]));
  p.push(part(box(t, h, z1 - z0), CON, [x0, Y, (z0 + z1) / 2]), part(box(t, h, z1 - z0), CON, [x1, Y, (z0 + z1) / 2]));
}
/** Elevated pipe rack along x: posts, cross beams and a bundle of coloured pipes. */
function pipeRack(p: G[], x0: number, x1: number, z: number, y: number, colors: number[]): void {
  const n = Math.max(2, Math.round((x1 - x0) / 0.14));
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n;
    for (const s of [-1, 1]) p.push(part(box(0.01, y, 0.01), MET_D, [x, Y, z + s * 0.03]));
    p.push(part(box(0.012, 0.01, 0.075), MET_D, [x, Y + y, z]));
  }
  colors.forEach((c, i) => p.push(part(new THREE.CylinderGeometry(0.01, 0.01, x1 - x0, 6).rotateZ(Math.PI / 2), c, [(x0 + x1) / 2, Y + y + 0.016, z - 0.03 + i * 0.02])));
}
/** Flare / chimney stack with banding, a platform and optional flame. */
function stack(p: G[], x: number, z: number, h: number, r: number, bands: [number, number], flame = false): void {
  const n = 6;
  for (let i = 0; i < n; i++) {
    const r0 = r * (1 - 0.35 * (i / n)), r1 = r * (1 - 0.35 * ((i + 1) / n)), sh = h / n;
    p.push(part(new THREE.CylinderGeometry(r1, r0, sh, 10).translate(0, sh / 2, 0), bands[i % 2], [x, Y + sh * i, z]));
  }
  ring(p, x, Y + h * 0.7, z, r * 0.9);
  ladder(p, x, z + r + 0.006, Y, Y + h * 0.7);
  if (flame) p.push(part(new THREE.ConeGeometry(0.025, 0.07, 6).translate(0, 0.035, 0), 0xff8a20, [x, Y + h, z]), part(new THREE.ConeGeometry(0.014, 0.045, 6).translate(0, 0.022, 0), 0xffe070, [x, Y + h + 0.005, z]));
}
/** Parked tanker lorry (forward +x): tank, chassis, cab, wheels. */
function tanker(p: G[], x: number, z: number, tank = 0xdfe3e6): void {
  p.push(part(box(0.2, 0.014, 0.05), DARK, [x, Y + 0.012, z]));
  p.push(part(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 10).rotateZ(Math.PI / 2), tank, [x - 0.02, Y + 0.05, z]));
  p.push(part(box(0.045, 0.045, 0.048), 0xc13a2c, [x + 0.075, Y + 0.026, z]));
  p.push(part(box(0.004, 0.02, 0.04), GLASS, [x + 0.1, Y + 0.05, z]));
  for (const wx of [-0.07, -0.04, 0.07]) for (const s of [-1, 1]) p.push(part(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 8).rotateX(Math.PI / 2), 0x1c1e20, [x + wx, Y + 0.014, z + s * 0.027]));
}
/** Small parked car (forward +x). */
function car(p: G[], x: number, z: number, color: number, yaw = 0): void {
  const q: G[] = [part(box(0.07, 0.022, 0.034), color, [0, 0.008, 0]), part(box(0.036, 0.018, 0.03), color, [-0.004, 0.028, 0]), part(box(0.038, 0.012, 0.031), GLASS, [-0.004, 0.032, 0])];
  for (const wx of [-0.022, 0.022]) for (const s of [-1, 1]) q.push(part(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 6).rotateX(Math.PI / 2), 0x1c1e20, [wx, 0.008, s * 0.017]));
  for (const g of q) p.push(g.rotateY(yaw).translate(x, Y, z));
}
/** Cooling tower: louvred cells with fan stacks and a few steam puffs. */
function coolingTower(p: G[], x: number, z: number, w: number, d: number, h: number): void {
  p.push(part(box(w, h, d), LOUV, [x, Y, z]));
  p.push(part(box(w + 0.01, 0.012, d + 0.01), CON, [x, Y + h, z]));
  const n = Math.max(1, Math.round(w / 0.07));
  for (let i = 0; i < n; i++) {
    const fx = x - w / 2 + (w * (i + 0.5)) / n;
    p.push(part(new THREE.CylinderGeometry(0.026, 0.032, 0.036, 10).translate(0, 0.018, 0), MET_D, [fx, Y + h + 0.012, z]));
    p.push(part(cyl(0.02, 0.004, 8), GRATE, [fx, Y + h + 0.05, z]));
    ball(p, fx + 0.006 * i, Y + h + 0.1, z, 0.026, 0xf4f6f8);
    ball(p, fx + 0.014, Y + h + 0.15, z - 0.006, 0.02, 0xf4f6f8);
  }
}
/** Pallet stack of drums (blue / rust / grey). */
function drums(p: G[], x: number, z: number): void {
  const cols = [0x2f6fb0, 0xb14d2a, 0x8d949c, 0x2f6fb0];
  [[0, 0], [0.04, 0.01], [0.02, 0.042], [-0.02, 0.04]].forEach(([dx, dz], i) => p.push(part(cyl(0.017, 0.045, 8), cols[i], [x + dx, Y + 0.012, z + dz])));
  p.push(part(box(0.1, 0.012, 0.09), 0x9b7a50, [x + 0.01, Y, z + 0.02]));
}

// ============================================================================

/** CHEMICAL PLANT. */
function chemicalPlant(): G {
  const p: G[] = [yard()];
  // Control building (front-left): cladding walls, glass band, awning, roof units.
  p.push(part(box(0.3, 0.16, 0.2), CLAD_W, [-0.28, Y, 0.1]));
  p.push(part(box(0.32, 0.014, 0.22), ROOFD, [-0.28, Y + 0.16, 0.1]));
  p.push(part(box(0.26, 0.05, 0.004), GLASS, [-0.28, Y + 0.06, 0.2]));
  p.push(part(box(0.06, 0.1, 0.005), MET_D, [-0.18, Y, 0.2]));
  p.push(part(box(0.1, 0.01, 0.05), 0xd02c2c, [-0.18, Y + 0.11, 0.225]));
  ahu(p, -0.34, Y + 0.174, 0.1); ahu(p, -0.22, Y + 0.174, 0.06, 0.08, 0.06);
  p.push(part(cyl(0.01, 0.07, 6), MET_D, [-0.4, Y + 0.174, 0.04])); // lab extractor stack
  // Cooling tower (back-left).
  coolingTower(p, -0.3, -0.2, 0.2, 0.1, 0.12);
  // Process columns, linked at the top, with a reboiler drum and a catwalk between them.
  column(p, 0.02, -0.17, 0.045, 0.64); column(p, 0.17, -0.2, 0.04, 0.5); column(p, 0.08, 0.0, 0.034, 0.4);
  pipe(p, [0.02, Y + 0.6, -0.17], [0.17, Y + 0.5, -0.2], 0.008, PIPE_R, 6);
  pipe(p, [0.17, Y + 0.36, -0.2], [0.08, Y + 0.36, 0.0], 0.007, PIPE_Y, 6);
  walkway(p, 0.095, Y + 0.31, -0.185, 0.15, 0.03);
  bullet(p, 0.09, 0.12, 0.17, 0.028, STEEL);
  // Spherical tanks in a bund, plus a horizontal bullet pair.
  bund(p, 0.2, 0.46, -0.1, 0.34);
  sphereTank(p, 0.33, 0.2, 0.09); sphereTank(p, 0.34, -0.02, 0.07);
  pipe(p, [0.33, Y, 0.12], [0.34, Y, 0.05], 0.006, PIPE_B, 6);
  bullet(p, -0.06, 0.32, 0.2, 0.035); bullet(p, -0.06, 0.4, 0.16, 0.026);
  // Back pipe rack, two levels, with flare stack at its end.
  pipeRack(p, -0.42, 0.42, -0.38, 0.18, [PIPE_R, PIPE_Y, PIPE_G, PIPE_B]);
  pipeRack(p, -0.42, 0.42, -0.38, 0.26, [PIPE_Y, PIPE_G]);
  stack(p, -0.44, -0.4, 0.82, 0.02, [0xc23b2e, 0xf0f0f0], true);
  for (const a of [0.8, 2.4, 4.0]) pipe(p, [-0.44, Y + 0.6, -0.4], [-0.44 + Math.cos(a) * 0.1, Y, -0.4 + Math.sin(a) * 0.1], 0.0015, STEEL, 4); // guy wires
  // Tanker loading gantry (front-right).
  for (const [dx, dz] of [[-0.11, -0.05], [0.11, -0.05], [-0.11, 0.05], [0.11, 0.05]]) p.push(part(box(0.01, 0.14, 0.01), MET_D, [0.3 + dx, Y, 0.4 + dz]));
  p.push(part(box(0.26, 0.014, 0.14), 0xd02c2c, [0.3, Y + 0.14, 0.4]));
  p.push(part(box(0.24, 0.006, 0.12), ROOFD, [0.3, Y + 0.154, 0.4]));
  tanker(p, 0.3, 0.4);
  pipe(p, [0.34, Y + 0.14, 0.4], [0.34, Y + 0.07, 0.4], 0.004, PIPE_Y, 5);
  // Details: drums, safety shower, kerb, sign, fence.
  drums(p, -0.42, 0.34); drums(p, -0.36, 0.4);
  p.push(part(cyl(0.004, 0.06, 5), 0x2f9a4c, [-0.04, Y, 0.22]), part(cyl(0.012, 0.012, 6), 0x2f9a4c, [-0.04, Y + 0.06, 0.22]));
  kerb(p, -0.28, 0.24, 0.2);
  sign(p, -0.28, Y + 0.22, 0.21, 0.24, 0xe07a1f);
  fenceX(p, -0.46, 0.46, 0.47);
  fenceZ(p, -0.46, 0.47, -0.47); fenceZ(p, -0.46, 0.47, 0.47);
  return merge(p);
}

/** STEEL MILL. */
function steelMill(): G {
  const p: G[] = [yard(0xaaa59c)];
  // Melt shop: brick base, rust corrugated upper wall, monitor roof, glowing bay door, vents.
  p.push(part(box(0.5, 0.12, 0.4), BRICK, [-0.2, Y, 0.1]));
  p.push(part(box(0.5, 0.3, 0.4), RUST, [-0.2, Y + 0.12, 0.1]));
  p.push(part(gable(0.52, 0.1, 0.42, 0.5), ROOFD, [-0.2, Y + 0.42, 0.1]));
  p.push(part(box(0.5, 0.045, 0.1), CLAD, [-0.2, Y + 0.5, 0.1])); // monitor roof clerestory
  p.push(part(box(0.5, 0.012, 0.12), ROOFD, [-0.2, Y + 0.545, 0.1]));
  p.push(part(box(0.46, 0.03, 0.004), GLASS, [-0.2, Y + 0.512, 0.152]));
  p.push(part(box(0.16, 0.2, 0.006), 0x3a2a22, [-0.2, Y, 0.302])); // bay doorway
  p.push(part(box(0.12, 0.16, 0.007), 0xff7a1a, [-0.2, Y, 0.304])); // furnace glow
  for (const x of [-0.4, -0.01]) for (const y of [0.1, 0.22]) p.push(part(box(0.05, 0.05, 0.005), GLASS, [x, Y + y + 0.06, 0.302]));
  for (let k = 0; k < 4; k++) { p.push(part(box(0.01, 0.42, 0.012), MET_D, [-0.44 + k * 0.16, Y, 0.305])); } // wall columns
  for (const x of [-0.35, -0.2, -0.05]) { p.push(part(cyl(0.015, 0.07, 8), MET_D, [x, Y + 0.56, 0.1])); p.push(part(cyl(0.02, 0.008, 8), STEEL, [x, Y + 0.635, 0.1])); }
  sign(p, -0.2, Y + 0.34, 0.304, 0.22, 0x3d5a80);
  // Blast furnace + three hot-blast stoves, skip hoist and downcomer.
  p.push(part(new THREE.CylinderGeometry(0.075, 0.105, 0.34, 14).translate(0, 0.17, 0), PLATE, [0.26, Y, -0.16]));
  p.push(part(new THREE.CylinderGeometry(0.04, 0.075, 0.18, 14).translate(0, 0.09, 0), PLATE, [0.26, Y + 0.34, -0.16]));
  p.push(part(dome(0.04), PLATE, [0.26, Y + 0.52, -0.16]));
  for (const f of [0.1, 0.22, 0.34]) p.push(part(new THREE.TorusGeometry(0.09 - f * 0.12, 0.004, 3, 14).rotateX(Math.PI / 2), MET_D, [0.26, Y + f, -0.16]));
  for (const f of [0.18, 0.4]) ring(p, 0.26, Y + f, -0.16, 0.09 - f * 0.1);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; pipe(p, [0.26 + Math.cos(a) * 0.1, Y + 0.12, -0.16 + Math.sin(a) * 0.1], [0.26 + Math.cos(a) * 0.075, Y + 0.12, -0.16 + Math.sin(a) * 0.075], 0.008, PIPE_R, 6); } // tuyeres
  p.push(part(new THREE.TorusGeometry(0.108, 0.006, 4, 14).rotateX(Math.PI / 2), PIPE_R, [0.26, Y + 0.12, -0.16])); // bustle pipe
  pipe(p, [0.26, Y + 0.56, -0.16], [0.4, Y + 0.5, -0.16], 0.01, PIPE_Y, 6); // downcomer
  for (const [sx, sz] of [[0.39, -0.3], [0.39, -0.17], [0.39, -0.04]] as const) {
    p.push(part(cyl(0.035, 0.34, 10), CLAD, [sx + 0.03, Y, sz])); p.push(part(dome(0.035, 10), CLAD, [sx + 0.03, Y + 0.34, sz]));
    p.push(part(new THREE.TorusGeometry(0.036, 0.003, 3, 10).rotateX(Math.PI / 2), MET_D, [sx + 0.03, Y + 0.2, sz]));
  }
  pipe(p, [0.4, Y + 0.5, -0.16], [0.42, Y + 0.34, -0.3], 0.007, PIPE_Y, 6);
  pipe(p, [0.4, Y + 0.5, -0.16], [0.42, Y + 0.34, -0.04], 0.007, PIPE_Y, 6);
  pipe(p, [0.1, Y, -0.04], [0.23, Y + 0.54, -0.16], 0.005, GRATE, 0); // skip hoist rails
  p.push(part(box(0.025, 0.02, 0.03), HAZ, [0.17, Y + 0.28, -0.1], [0, 0, 0.9])); // skip car
  // Chimneys.
  stack(p, 0.14, -0.4, 0.88, 0.032, [0xc23b2e, 0xf0f0f0]); stack(p, 0.32, -0.42, 0.74, 0.028, [0xb9b2a6, 0x8f857a]);
  // Slab yard with a gantry crane; slabs and coils on the ground.
  for (const x of [-0.44, -0.04]) { pipe(p, [x, Y, 0.38], [x, Y + 0.22, 0.38], 0.01, HAZ, 4); pipe(p, [x, Y, 0.46], [x, Y + 0.22, 0.46], 0.01, HAZ, 4); p.push(part(box(0.012, 0.012, 0.1), MET_D, [x, Y + 0.22, 0.42])); }
  p.push(part(box(0.5, 0.02, 0.026), HAZ, [-0.24, Y + 0.234, 0.42]));
  p.push(part(box(0.04, 0.03, 0.04), 0xd02c2c, [-0.2, Y + 0.2, 0.42])); // hoist trolley
  pipe(p, [-0.2, Y + 0.2, 0.42], [-0.2, Y + 0.1, 0.42], 0.0015, STEEL, 3);
  p.push(part(box(0.1, 0.012, 0.06), HAZ, [-0.2, Y + 0.088, 0.42]));
  for (let k = 0; k < 4; k++) p.push(part(box(0.11, 0.022, 0.07), k % 2 ? 0x6d6f73 : 0x8a4f26, [-0.38 + (k % 2) * 0.01, Y + k * 0.022, 0.38])); // stacked slabs
  for (let k = 0; k < 3; k++) p.push(part(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 12).rotateX(Math.PI / 2), k % 2 ? STEEL : 0x9aa3ab, [-0.08 + k * 0.065, Y + 0.03, 0.4])); // coils
  // Rail line with a torpedo ladle car.
  p.push(part(box(0.9, 0.006, 0.006), MET_D, [0, Y, 0.27]), part(box(0.9, 0.006, 0.006), MET_D, [0, Y, 0.3]));
  for (let k = 0; k < 18; k++) p.push(part(box(0.008, 0.004, 0.044), 0x6b5444, [-0.43 + k * 0.05, Y, 0.285]));
  p.push(part(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10).rotateZ(Math.PI / 2), PLATE, [0.32, Y + 0.05, 0.285]));
  p.push(part(new THREE.SphereGeometry(0.03, 10, 6).scale(1.4, 1, 1), PLATE, [0.2, Y + 0.05, 0.285]), part(new THREE.SphereGeometry(0.03, 10, 6).scale(1.4, 1, 1), PLATE, [0.44, Y + 0.05, 0.285]));
  p.push(part(box(0.26, 0.012, 0.03), DARK, [0.32, Y + 0.012, 0.285]));
  p.push(part(new THREE.ConeGeometry(0.014, 0.02, 8).translate(0, 0.01, 0), 0xff7a1a, [0.32, Y + 0.078, 0.285])); // molten slit
  // Slag heap, ore and coke piles, scrap.
  p.push(part(new THREE.ConeGeometry(0.1, 0.1, 8).translate(0, 0.05, 0).scale(1.3, 1, 1), 0x4a4a4e, [0.0, Y, -0.38]));
  p.push(part(new THREE.ConeGeometry(0.07, 0.08, 7).translate(0, 0.04, 0), 0x7a4a36, [-0.4, Y, -0.34]));
  p.push(part(new THREE.ConeGeometry(0.06, 0.06, 7).translate(0, 0.03, 0), 0x232326, [-0.28, Y, -0.4]));
  for (let k = 0; k < 6; k++) p.push(part(box(0.05, 0.02, 0.03), 0x8a4f26, [-0.22 + k * 0.025, Y + (k % 3) * 0.018, -0.2 + (k % 2) * 0.03], [0, k * 0.5, 0.2 * (k % 3)]));
  // Cooling water tank and pump house.
  p.push(part(cyl(0.05, 0.1, 12), CLAD_W, [-0.02, Y, -0.14]), part(dome(0.05), PLATE, [-0.02, Y + 0.1, -0.14]));
  pipe(p, [-0.02, Y + 0.02, -0.14], [0.17, Y + 0.02, -0.14], 0.007, PIPE_B, 6);
  fenceX(p, -0.46, 0.46, 0.475);
  return merge(p);
}

/** ASSEMBLY PLANT. */
function assemblyPlant(): G {
  const p: G[] = [yard(0xb5b2aa)];
  // Production hall: blue cladding with a white band, sawtooth roof with glazing, ribbon windows.
  p.push(part(box(0.8, 0.3, 0.5), CLAD_B, [0, Y, -0.17]));
  p.push(part(box(0.802, 0.045, 0.502), CLAD_W, [0, Y + 0.255, -0.17]));
  for (let s = 0; s < 4; s++) { p.push(part(gable(0.8, 0.08, 0.125, 0.12), ROOFD, [0, Y + 0.3, -0.355 + s * 0.125])); p.push(part(box(0.78, 0.045, 0.005), GLASS, [0, Y + 0.318, -0.42 + s * 0.125])); }
  p.push(part(box(0.7, 0.05, 0.004), GLASS, [0, Y + 0.12, 0.082]));
  for (let k = 0; k < 8; k++) p.push(part(box(0.008, 0.3, 0.012), MET_D, [-0.4 + k * 0.114, Y, 0.083])); // pilasters
  // Office wing at the front: glass curtain wall, flat roof, canopy, flagpoles.
  p.push(part(box(0.3, 0.18, 0.16), GLASS, [-0.22, Y, 0.18]));
  for (let k = 0; k <= 6; k++) p.push(part(box(0.006, 0.18, 0.008), STEEL, [-0.37 + k * 0.05, Y, 0.262]));
  for (const y of [0.06, 0.12]) p.push(part(box(0.3, 0.006, 0.008), STEEL, [-0.22, Y + y, 0.262]));
  p.push(part(box(0.32, 0.014, 0.18), ROOFD, [-0.22, Y + 0.18, 0.18]));
  p.push(part(box(0.12, 0.008, 0.07), 0xd02c2c, [-0.22, Y + 0.075, 0.3]));
  for (const x of [-0.27, -0.17]) p.push(part(box(0.006, 0.075, 0.006), MET_D, [x, Y, 0.325]));
  ahu(p, -0.3, Y + 0.194, 0.18); ahu(p, -0.14, Y + 0.194, 0.18);
  pipe(p, [0.0, Y, 0.34], [0.0, Y + 0.2, 0.34], 0.003, STEEL, 4); p.push(part(box(0.05, 0.03, 0.002), 0x1f7a3d, [0.026, Y + 0.18, 0.34]));
  // Rooftop solar array and exhaust.
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) p.push(part(box(0.09, 0.004, 0.05), 0x24406e, [0.12 + c * 0.1, Y + 0.38 + r * 0.01, -0.16 + r * 0.07], [0.3, 0, 0]));
  for (const x of [0.12, 0.3]) ahu(p, x, Y + 0.37, -0.36, 0.1, 0.06);
  // Paint shop with stacks and an enclosed overhead conveyor bridge.
  p.push(part(box(0.2, 0.2, 0.2), CON, [0.3, Y, 0.17]));
  p.push(part(box(0.22, 0.012, 0.22), ROOFD, [0.3, Y + 0.2, 0.17]));
  p.push(part(box(0.16, 0.04, 0.004), GLASS, [0.3, Y + 0.12, 0.272]));
  for (const dx of [-0.05, 0.05]) { p.push(part(cyl(0.02, 0.17, 10), 0xd0d4d8, [0.3 + dx, Y + 0.21, 0.15])); p.push(part(new THREE.TorusGeometry(0.021, 0.003, 3, 10).rotateX(Math.PI / 2), 0xc23b2e, [0.3 + dx, Y + 0.37, 0.15])); }
  p.push(part(box(0.1, 0.05, 0.05), CLAD_W, [0.2, Y + 0.17, 0.0]));
  for (const x of [0.17, 0.23]) p.push(part(box(0.008, 0.17, 0.008), MET_D, [x, Y, 0.0]));
  // Docks along the back-right and a trailer.
  for (let k = 0; k < 3; k++) { p.push(part(box(0.1, 0.12, 0.006), 0x8f969d, [0.1 + k * 0.14, Y + 0.02, -0.425])); p.push(part(box(0.11, 0.03, 0.04), CON, [0.1 + k * 0.14, Y, -0.45])); }
  // Finished-vehicle lot with painted bays (front-right) and a car transporter.
  const cols = [0xd9432f, 0xe8e8e8, 0x2f6fb0, 0x222428, 0xe0b52a, 0x3b8a5c, 0x9aa3ab];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) car(p, -0.4 + c * 0.075, 0.405 + r * 0.05 - 0.03, cols[(r * 5 + c) % cols.length], Math.PI / 2);
  for (let c = 0; c < 6; c++) p.push(part(box(0.002, 0.001, 0.05), 0xf2f2f2, [-0.44 + c * 0.075, Y + 0.002, 0.405]));
  p.push(part(box(0.2, 0.012, 0.05), DARK, [0.3, Y + 0.012, 0.42]), part(box(0.2, 0.01, 0.05), PIPE_B, [0.3, Y + 0.05, 0.42]));
  for (let c = 0; c < 3; c++) { car(p, 0.24 + c * 0.055, 0.42, cols[c + 1], 0); }
  p.push(part(box(0.045, 0.045, 0.048), 0xc13a2c, [0.42, Y + 0.026, 0.42]));
  kerb(p, 0.0, 0.34, 0.2);
  sign(p, 0.28, Y + 0.28, 0.274, 0.18, 0x1f7a3d);
  fenceX(p, -0.46, 0.46, 0.475);
  return merge(p);
}

/** REFINERY. */
function refinery(): G {
  const p: G[] = [yard(0xaaa59c)];
  // Tank farm in a bund (back-left): four floating-roof tanks.
  bund(p, -0.46, 0.04, -0.46, -0.04);
  storageTank(p, -0.33, -0.33, 0.1, 0.16); storageTank(p, -0.1, -0.33, 0.1, 0.16);
  storageTank(p, -0.33, -0.12, 0.075, 0.12); storageTank(p, -0.1, -0.12, 0.075, 0.12);
  pipe(p, [-0.33, Y, -0.22], [-0.1, Y, -0.22], 0.006, PIPE_Y, 6);
  // Distillation tower, cracker and reactor sphere.
  column(p, 0.2, -0.3, 0.05, 0.72); column(p, 0.34, -0.32, 0.034, 0.52); column(p, 0.1, -0.12, 0.028, 0.42);
  pipe(p, [0.2, Y + 0.66, -0.3], [0.34, Y + 0.5, -0.32], 0.008, PIPE_R, 6);
  pipe(p, [0.34, Y + 0.2, -0.32], [0.1, Y + 0.2, -0.12], 0.007, PIPE_Y, 6);
  walkway(p, 0.27, Y + 0.4, -0.31, 0.16, 0.03);
  sphereTank(p, 0.4, -0.12, 0.06);
  // Fired heater: brick firebox with stack and a convection section.
  p.push(part(box(0.16, 0.12, 0.12), BRICK, [0.3, Y, 0.0]), part(box(0.14, 0.05, 0.1), CLAD, [0.3, Y + 0.12, 0.0]), part(box(0.17, 0.012, 0.13), ROOFD, [0.3, Y + 0.17, 0.0]));
  p.push(part(cyl(0.016, 0.26, 8), PLATE, [0.3, Y + 0.17, 0.0]));
  for (const x of [0.25, 0.3, 0.35]) p.push(part(box(0.02, 0.03, 0.004), 0xff8a20, [x, Y + 0.04, 0.062]));
  // Heat-exchanger bank: stacked shells with channel heads.
  for (let r = 0; r < 3; r++) bullet(p, -0.22, 0.2 + r * 0.05, 0.2, 0.02, STEEL);
  // Pipe rack across the middle with many lines.
  pipeRack(p, -0.44, 0.44, 0.1, 0.2, [PIPE_R, PIPE_Y, PIPE_G, PIPE_B, MET_D]);
  // Control room + lab (front-left), tanker rack (front-right), flare.
  p.push(part(box(0.24, 0.12, 0.14), CLAD_W, [-0.3, Y, 0.34]), part(box(0.26, 0.012, 0.16), ROOFD, [-0.3, Y + 0.12, 0.34]), part(box(0.2, 0.04, 0.004), GLASS, [-0.3, Y + 0.05, 0.41]));
  ahu(p, -0.34, Y + 0.132, 0.34, 0.08, 0.06);
  for (const dx of [-0.1, 0.1]) p.push(part(box(0.01, 0.12, 0.01), MET_D, [0.22 + dx, Y, 0.4]));
  p.push(part(box(0.24, 0.012, 0.1), 0xf2c230, [0.22, Y + 0.12, 0.4])); tanker(p, 0.22, 0.4, 0xe9e4da);
  stack(p, -0.45, 0.0, 0.8, 0.018, [0xc23b2e, 0xf0f0f0], true);
  p.push(part(new THREE.ConeGeometry(0.06, 0.05, 6).translate(0, 0.025, 0), PIPE_Y, [0.0, Y, 0.3])); // sulphur pile
  sign(p, -0.3, Y + 0.18, 0.425, 0.22, 0x2f6fb0);
  kerb(p, 0.22, 0.46, 0.2);
  fenceX(p, -0.46, 0.46, 0.475);
  return merge(p);
}

/** BUILDING-MATERIALS (cement) PLANT. */
function materialsPlant(): G {
  const p: G[] = [yard(0xc9c5bb)];
  // Rotary kiln on piers, tilted slightly, with burner hood and cooler.
  const kiln = new THREE.CylinderGeometry(0.035, 0.035, 0.52, 12).rotateZ(Math.PI / 2).rotateZ(0.05);
  p.push(part(kiln, RUST, [-0.02, Y + 0.12, -0.12]));
  for (const x of [-0.2, 0, 0.18]) { p.push(part(box(0.03, 0.09, 0.06), CON, [x, Y, -0.12])); p.push(part(new THREE.TorusGeometry(0.037, 0.005, 4, 12).rotateY(Math.PI / 2), MET_D, [x, Y + 0.12 + (x + 0.02) * 0.05, -0.12])); }
  p.push(part(box(0.06, 0.08, 0.08), CLAD_W, [-0.3, Y + 0.08, -0.12])); // burner hood
  p.push(part(box(0.1, 0.08, 0.08), CLAD, [0.28, Y + 0.08, -0.12])); // clinker cooler
  // Preheater tower with cyclones.
  p.push(part(box(0.14, 0.5, 0.14), CON, [0.38, Y, -0.34]));
  for (let i = 0; i < 4; i++) { p.push(part(box(0.15, 0.012, 0.15), MET_D, [0.38, Y + 0.12 * (i + 1), -0.34])); p.push(part(new THREE.CylinderGeometry(0.03, 0.012, 0.09, 8).translate(0, 0.045, 0), PLATE, [0.34 + (i % 2) * 0.08, Y + 0.12 * i + 0.02, -0.26])); }
  p.push(part(box(0.15, 0.014, 0.15), ROOFD, [0.38, Y + 0.5, -0.34]));
  pipe(p, [0.38, Y + 0.5, -0.34], [0.38, Y + 0.62, -0.34], 0.008, MET_D, 6);
  // Cement silos with slip-form rings, top gallery and loading spouts.
  for (let i = 0; i < 4; i++) {
    const x = -0.36 + i * 0.12, z = -0.36;
    p.push(part(cyl(0.05, 0.46, 14), CON, [x, Y, z]));
    for (let r = 1; r < 7; r++) p.push(part(new THREE.CylinderGeometry(0.052, 0.052, 0.006, 14), 0xa9a59b, [x, Y + r * 0.065, z]));
    p.push(part(dome(0.05, 14), 0xdedbd3, [x, Y + 0.46, z]));
    p.push(part(cyl(0.012, 0.03, 6), MET_D, [x, Y + 0.51, z]));
  }
  p.push(part(box(0.5, 0.05, 0.05), CLAD_W, [-0.24, Y + 0.5, -0.36])); // gallery over the silos
  p.push(part(box(0.5, 0.01, 0.06), ROOFD, [-0.24, Y + 0.55, -0.36]));
  for (let i = 0; i < 2; i++) { const x = -0.3 + i * 0.24; pipe(p, [x, Y + 0.15, -0.31], [x, Y + 0.08, -0.26], 0.012, MET_D, 6); }
  // Batching plant: four aggregate bins on a frame, hopper conveyor and mixer truck.
  for (let i = 0; i < 4; i++) {
    const c = [0x9f8f78, 0xb5ab92, 0x8f8f8f, 0xd8c08a][i], x = -0.36 + i * 0.075;
    p.push(part(box(0.07, 0.07, 0.1), PLATE, [x, Y + 0.12, 0.1]));
    p.push(part(new THREE.CylinderGeometry(0.036, 0.012, 0.05, 4).rotateY(Math.PI / 4).translate(0, 0.025, 0), PLATE, [x, Y + 0.07, 0.1]));
    p.push(part(box(0.06, 0.01, 0.09), c, [x, Y + 0.19, 0.1]));
  }
  for (const [dx, dz] of [[-0.04, -0.05], [0.3, -0.05], [-0.04, 0.05], [0.3, 0.05]]) p.push(part(box(0.01, 0.12, 0.01), MET_D, [-0.36 + dx, Y, 0.1 + dz]));
  pipe(p, [-0.4, Y + 0.02, 0.06], [-0.2, Y + 0.22, 0.06], 0.014, GRATE, 0); // feed conveyor
  for (const [x, c] of [[-0.4, 0x9f8f78], [-0.3, 0xb5ab92]] as const) p.push(part(new THREE.ConeGeometry(0.07, 0.07, 8).translate(0, 0.035, 0), c, [x, Y, 0.28]));
  // Mixer truck.
  p.push(part(box(0.18, 0.016, 0.05), DARK, [0.14, Y + 0.012, 0.3]));
  p.push(part(new THREE.CylinderGeometry(0.03, 0.02, 0.12, 10).rotateZ(Math.PI / 2 - 0.2), 0xe0a32a, [0.12, Y + 0.06, 0.3]));
  p.push(part(box(0.045, 0.04, 0.048), 0xf2f2ee, [0.22, Y + 0.03, 0.3]), part(box(0.004, 0.018, 0.04), GLASS, [0.245, Y + 0.045, 0.3]));
  for (const wx of [0.06, 0.1, 0.22]) for (const s of [-1, 1]) p.push(part(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 8).rotateX(Math.PI / 2), 0x1c1e20, [wx, Y + 0.014, 0.3 + s * 0.027]));
  // Bagged cement pallets, brick stacks, office, sign.
  for (let k = 0; k < 6; k++) p.push(part(box(0.06, 0.04, 0.05), 0xe8e4d8, [0.0 + (k % 3) * 0.065, Y + Math.floor(k / 3) * 0.04, 0.42]));
  for (let k = 0; k < 3; k++) p.push(part(box(0.07, 0.028, 0.05), BRICK, [-0.35 + k * 0.08, Y + 0.0, 0.42]));
  p.push(part(box(0.14, 0.08, 0.09), CLAD_W, [0.38, Y, 0.4]), part(box(0.15, 0.01, 0.1), ROOFD, [0.38, Y + 0.08, 0.4]), part(box(0.1, 0.03, 0.004), GLASS, [0.38, Y + 0.035, 0.446]));
  sign(p, 0.38, Y + 0.14, 0.4, 0.15, 0xd68a1f);
  kerb(p, 0.14, 0.46, 0.16);
  fenceX(p, -0.46, 0.46, 0.475);
  return merge(p);
}

/** ELECTRONICS PLANT (semiconductor fab). */
function electronicsPlant(): G {
  const p: G[] = [yard(0xd3d3cf)];
  // Fab hall: white cladding with a blue glass band, parapet, big roof air handlers.
  p.push(part(box(0.72, 0.22, 0.46), CLAD_W, [0, Y, -0.16]));
  p.push(part(box(0.724, 0.05, 0.464), CLAD_B, [0, Y + 0.12, -0.16]));
  p.push(part(box(0.7, 0.03, 0.004), GLASS, [0, Y + 0.13, 0.074]));
  p.push(part(box(0.74, 0.014, 0.48), ROOFD, [0, Y + 0.22, -0.16]));
  for (let i = 0; i < 4; i++) ahu(p, -0.27 + i * 0.18, Y + 0.234, -0.22, 0.13, 0.09);
  for (let i = 0; i < 3; i++) { p.push(part(cyl(0.016, 0.1, 8), 0xd0d4d8, [-0.22 + i * 0.22, Y + 0.234, -0.04])); p.push(part(new THREE.ConeGeometry(0.022, 0.02, 8).translate(0, 0.01, 0), MET_D, [-0.22 + i * 0.22, Y + 0.334, -0.04])); }
  // Glass atrium at the front with a canopy, plus a logo plaque.
  p.push(part(box(0.26, 0.16, 0.14), GLASS, [-0.2, Y, 0.17]));
  for (let k = 0; k <= 5; k++) p.push(part(box(0.005, 0.16, 0.006), STEEL, [-0.33 + k * 0.052, Y, 0.241]));
  p.push(part(box(0.28, 0.012, 0.16), ROOFD, [-0.2, Y + 0.16, 0.17]));
  p.push(part(box(0.14, 0.008, 0.07), 0x2f6fb0, [-0.2, Y + 0.075, 0.275]));
  for (const x of [-0.26, -0.14]) p.push(part(box(0.006, 0.075, 0.006), MET_D, [x, Y, 0.305]));
  p.push(part(box(0.07, 0.07, 0.01), 0x2c4a6e, [0.0, Y + 0.17, 0.24])); p.push(part(box(0.04, 0.04, 0.012), 0x55c4e8, [0.0, Y + 0.185, 0.24]));
  // Utility yard: chillers (louvred), cooling fans, gas bullets, DI water tank and a nitrogen sphere.
  coolingTower(p, 0.28, 0.1, 0.18, 0.08, 0.09);
  for (let i = 0; i < 2; i++) p.push(part(box(0.1, 0.06, 0.07), LOUV, [0.2 + i * 0.12, Y, 0.24]));
  bullet(p, 0.32, -0.38, 0.2, 0.03, CLAD_W); bullet(p, 0.32, -0.3, 0.2, 0.03, CLAD_W);
  p.push(part(cyl(0.05, 0.12, 12), CLAD_W, [0.18, Y, 0.38]), part(dome(0.05), PLATE, [0.18, Y + 0.12, 0.38]));
  sphereTank(p, 0.4, 0.38, 0.055);
  pipe(p, [0.18, Y + 0.02, 0.38], [0.36, Y + 0.02, 0.38], 0.006, PIPE_B, 6);
  pipeRack(p, 0.24, 0.46, -0.2, 0.12, [PIPE_B, PIPE_G, PIPE_Y]);
  // Loading dock at the rear right.
  for (let k = 0; k < 2; k++) p.push(part(box(0.1, 0.1, 0.006), 0x8f969d, [0.22 + k * 0.14, Y + 0.02, -0.395]));
  // Staff car park with solar canopy (front-left).
  const cols = [0xd9432f, 0xe8e8e8, 0x2f6fb0, 0x222428, 0x9aa3ab, 0x3b8a5c];
  for (let c = 0; c < 6; c++) car(p, -0.42 + c * 0.075, 0.42, cols[c], 0);
  for (const x of [-0.44, -0.2]) for (const z of [0.38, 0.46]) p.push(part(box(0.006, 0.07, 0.006), MET_D, [x, Y, z]));
  p.push(part(box(0.3, 0.006, 0.1), 0x24406e, [-0.32, Y + 0.075, 0.42], [0.1, 0, 0]));
  // Landscape strip + sign + fence.
  for (const x of [-0.42, -0.1, 0.02]) { p.push(part(cyl(0.006, 0.04, 5), 0x6b4a2b, [x, Y, 0.34])); p.push(part(new THREE.IcosahedronGeometry(0.025, 0).translate(0, 0.06, 0), 0x3f8f3a, [x, Y, 0.34])); }
  sign(p, 0.1, Y + 0.05, 0.43, 0.2, 0x2f6fb0);
  fenceX(p, -0.46, 0.46, 0.475);
  return merge(p);
}

export interface HeavyModels { chemical: G; steel: G; assembly: G; refinery: G; materials: G; electronics: G }
/** The detailed heavy-industry geometry (built on demand, once per call). */
export function heavyIndustryModels(): HeavyModels {
  return { chemical: chemicalPlant(), steel: steelMill(), assembly: assemblyPlant(), refinery: refinery(), materials: materialsPlant(), electronics: electronicsPlant() };
}
