/**
 * render/shopModels.ts — V1.6 new businesses (shops, services and two
 * factories), every part individually TEXTURED from the shared atlas
 * (textures.ts: Brick, Stucco, Siding, Boards, Shingle, Roof, Concrete,
 * Metal, Glass, Plain). Each part is projected onto its surface with
 * skinProjected, so register these pools with industrialMaterial() and DO
 * NOT run autoSkin over them (cityModels.PRESKINNED lists the keys).
 *
 *   shops/services: bakery, bookstore, toy store, garden centre, restaurant,
 *                   bank, car dealership, gym, laundromat, vet clinic
 *   factories:      print works (books), toy factory (toys)
 * 1 unit ≈ the building body's shorter side; the front faces +z.
 */
import * as THREE from 'three';
import { box, gable, merge, part } from './models';
import { Skin, skinProjected } from './textures';

type G = THREE.BufferGeometry;
type V3 = [number, number, number];
const cyl = (r: number, h: number, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);
const cylC = (r: number, h: number, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg);
const sp = (geo: G, color: number, pos: V3, sk: Skin, rot?: V3): G => skinProjected(part(geo, color, pos, rot), sk);
const ball = (r: number, c: number, pos: V3): G => sp(new THREE.IcosahedronGeometry(r, 1), c, pos, Skin.Plain);
const GL = 0x9fd7ff, TRIM = 0xf4f1ea, DARKW = 0x5a3a22;

/** Pavement slab. */
const pave = (c = 0xbdb8ae, sk = Skin.Concrete) => sp(box(0.98, 0.012, 0.98), c, [0, 0, 0], sk);
/** Shop window (glass pane + frame + sill) on the front face at z, centred on x. */
function win(x: number, y: number, z: number, w: number, h: number): G[] {
  return [
    sp(box(w, h, 0.01), GL, [x, y, z], Skin.Glass),
    sp(box(w + 0.02, 0.012, 0.016), TRIM, [x, y + h, z], Skin.Plain), sp(box(w + 0.02, 0.012, 0.03), TRIM, [x, y - 0.012, z + 0.008], Skin.Plain),
    sp(box(0.008, h, 0.014), TRIM, [x - w / 2, y, z], Skin.Plain), sp(box(0.008, h, 0.014), TRIM, [x + w / 2, y, z], Skin.Plain), sp(box(0.006, h, 0.014), TRIM, [x, y, z], Skin.Plain),
  ];
}
/** Slanted striped awning of n slats alternating two colours. */
function awning(x: number, y: number, z: number, w: number, n: number, c1: number, c2: number, depth = 0.1): G[] {
  const o: G[] = [];
  for (let i = 0; i < n; i++) o.push(sp(box(w / n, 0.012, depth), i % 2 ? c2 : c1, [x - w / 2 + (w * (i + 0.5)) / n, y, z + depth / 2 - 0.01], Skin.Stucco, [0.4, 0, 0]));
  o.push(sp(box(w, 0.02, 0.01), c1, [x, y - 0.035, z + depth - 0.02], Skin.Stucco));
  return o;
}
/** Sign board: a coloured backing with n small white "letters". */
function board(x: number, y: number, z: number, w: number, c: number, n = 5): G[] {
  const o: G[] = [sp(box(w, 0.06, 0.014), c, [x, y, z], Skin.Boards), sp(box(w + 0.012, 0.008, 0.016), TRIM, [x, y + 0.06, z], Skin.Plain)];
  for (let i = 0; i < n; i++) o.push(sp(box(w / (n * 1.8), 0.032, 0.008), 0xffffff, [x - w / 2 + (w * (i + 0.5)) / n, y + 0.012, z + 0.01], Skin.Plain));
  return o;
}
const door = (x: number, z: number, c = DARKW, h = 0.12): G[] => [sp(box(0.06, h, 0.012), c, [x, 0.012, z], Skin.Boards), sp(box(0.075, h + 0.012, 0.008), TRIM, [x, 0.012, z - 0.002], Skin.Plain), sp(new THREE.SphereGeometry(0.006, 6, 5), 0xc9a646, [x + 0.02, 0.07, z + 0.008], Skin.Plain)];
const pot = (x: number, z: number, c = 0x4f8a45): G[] => [sp(cyl(0.016, 0.03, 8), 0xb4633f, [x, 0.012, z], Skin.Brick), ball(0.026, c, [x, 0.058, z])];
const tree = (x: number, z: number, s = 1): G[] => [sp(cyl(0.012 * s, 0.07 * s, 6), 0x6b4a2f, [x, 0.012, z], Skin.Boards), ball(0.06 * s, 0x4f8a45, [x, 0.12 * s, z]), ball(0.045 * s, 0x5a9a4a, [x + 0.03 * s, 0.16 * s, z])];
const carAt = (x: number, z: number, c: number, yaw = 0): G[] => [
  sp(box(0.05, 0.02, 0.1), c, [x, 0.014, z], Skin.Metal, [0, yaw, 0]), sp(box(0.044, 0.016, 0.05), 0x2b3a47, [x, 0.034, z], Skin.Glass, [0, yaw, 0]),
];
const CARS = [0xc0392b, 0x2f6fb0, 0xe8e8e8, 0x2d2d2d, 0xe0b030, 0x3f9e4a];
/** Chimney with a stack of smoke puffs. */
const chimney = (x: number, y: number, z: number, smoke = false): G[] => [
  sp(box(0.05, 0.1, 0.05), 0xa4533b, [x, y, z], Skin.Brick), sp(box(0.06, 0.014, 0.06), 0xcfc8bb, [x, y + 0.1, z], Skin.Concrete),
  ...(smoke ? [0, 1, 2].map((i) => ball(0.02 + i * 0.01, 0xf2f2f2, [x + i * 0.015, y + 0.14 + i * 0.05, z])) : []),
];
/** Gable roof (ridge along x unless rotated) with shingles. */
const roof = (x: number, y: number, z: number, w: number, h: number, d: number, c = 0x6a5a55, sk = Skin.Shingle): G => sp(gable(w, h, d), c, [x, y, z], sk);

export function newShopModels(): Record<string, G> {
  const out: Record<string, G> = {};
  { // BAKERY
    const p: G[] = [pave(0xc9c1b0)];
    p.push(sp(box(0.76, 0.3, 0.5), 0xc2644a, [0, 0.012, -0.12], Skin.Brick), sp(box(0.78, 0.02, 0.52), 0xd8d2c4, [0, 0.31, -0.12], Skin.Concrete), roof(0, 0.32, -0.12, 0.78, 0.08, 0.52));
    p.push(...win(-0.2, 0.06, 0.135, 0.3, 0.14), ...door(0.2, 0.135), ...awning(-0.2, 0.22, 0.14, 0.34, 8, 0xd23b2e, 0xffffff));
    p.push(...board(0.0, 0.27, 0.14, 0.4, 0x7a4a2a, 6), ...chimney(0.28, 0.32, -0.28, true));
    p.push(sp(new THREE.SphereGeometry(0.05, 10, 8).scale(1.5, 0.8, 0.8), 0xd9a557, [0.2, 0.2, 0.15], Skin.Stucco)); // bread-loaf sign
    for (let i = 0; i < 3; i++) p.push(sp(box(0.07, 0.04, 0.05), 0xb8854a, [-0.3 + i * 0.1, 0.012, 0.33], Skin.Boards), ball(0.014, 0xd9a557, [-0.3 + i * 0.1, 0.06, 0.33])); // bread crates
    p.push(sp(box(0.05, 0.1, 0.012), 0x2f4f2f, [0.38, 0.012, 0.3], Skin.Boards, [0, 0.5, 0]), ...pot(0.4, 0.2), ...pot(0.05, 0.3, 0xe05a6d), ...tree(-0.42, 0.4, 0.8));
    out.bakery = merge(p);
  }
  { // BOOKSTORE
    const p: G[] = [pave()];
    p.push(sp(box(0.74, 0.4, 0.46), 0xd6c4a6, [0, 0.012, -0.14], Skin.Stucco), sp(box(0.76, 0.02, 0.48), 0x4a525a, [0, 0.412, -0.14], Skin.Roof));
    p.push(...win(-0.2, 0.06, 0.098, 0.3, 0.14), ...win(0.2, 0.06, 0.098, 0.2, 0.14), ...win(-0.2, 0.26, 0.098, 0.3, 0.1), ...win(0.2, 0.26, 0.098, 0.2, 0.1), ...door(0.02, 0.098, 0x2f5f4f));
    for (let i = 0; i < 9; i++) p.push(sp(box(0.022, 0.07 + (i % 3) * 0.015, 0.03), [0xb5543c, 0x3f6fa0, 0x4f8a45, 0xe0b030, 0x7a4a8a][i % 5], [-0.33 + i * 0.03, 0.07, 0.104], Skin.Plain)); // books in the window
    p.push(...awning(0, 0.2, 0.1, 0.62, 10, 0x2f6a4f, 0xe8e0c8, 0.08), ...board(0, 0.35, 0.098, 0.42, 0x3a2a1a, 7));
    p.push(sp(box(0.12, 0.05, 0.07), 0x7a5232, [0.36, 0.012, 0.3], Skin.Boards)); // book cart
    for (let i = 0; i < 4; i++) p.push(sp(box(0.02, 0.04, 0.05), [0xb5543c, 0x3f6fa0, 0xe0b030, 0x4f8a45][i], [0.32 + i * 0.025, 0.065, 0.3], Skin.Plain));
    p.push(sp(box(0.14, 0.03, 0.05), 0x7a5232, [-0.32, 0.03, 0.34], Skin.Boards), ...chimney(0.28, 0.42, -0.3), ...tree(-0.42, 0.42, 0.9), ...pot(0.2, 0.34));
    out.bookstore = merge(p);
  }
  { // TOY STORE
    const p: G[] = [pave(0xd6d0c4)];
    p.push(sp(box(0.74, 0.34, 0.46), 0xf0e6ff, [0, 0.012, -0.14], Skin.Stucco), sp(box(0.76, 0.02, 0.48), 0xf2c230, [0, 0.352, -0.14], Skin.Plain));
    const bl = [0xd23b2e, 0x2f6fb0, 0xf2c230, 0x3f9e4a, 0xb872c4, 0xff8a3d];
    for (let i = 0; i < 6; i++) p.push(sp(box(0.1, 0.1, 0.012), bl[i], [-0.31 + i * 0.124, 0.25 - (i % 2) * 0.0, 0.098], Skin.Plain)); // toy-block frieze
    p.push(...win(-0.2, 0.05, 0.098, 0.3, 0.13), ...win(0.22, 0.05, 0.098, 0.2, 0.13), ...door(0.02, 0.098, 0xd23b2e));
    p.push(...awning(0, 0.19, 0.1, 0.7, 12, 0xd23b2e, 0xf2c230, 0.08));
    p.push(sp(new THREE.ConeGeometry(0.035, 0.12, 8).translate(0, 0.06, 0), 0xe8e8e8, [0.28, 0.352, -0.2], Skin.Metal), sp(new THREE.ConeGeometry(0.035, 0.05, 8).translate(0, 0.025, 0), 0xd23b2e, [0.28, 0.472, -0.2], Skin.Plain)); // rocket on the roof
    for (const f of [-0.02, 0.02]) p.push(sp(box(0.015, 0.04, 0.02), 0xd23b2e, [0.28 + f * 1.4, 0.352, -0.2], Skin.Plain));
    p.push(ball(0.05, 0x8a5a33, [-0.3, 0.07, 0.34]), ball(0.035, 0x8a5a33, [-0.3, 0.14, 0.34]), ball(0.014, 0x8a5a33, [-0.33, 0.17, 0.34]), ball(0.014, 0x8a5a33, [-0.27, 0.17, 0.34])); // teddy
    for (let i = 0; i < 4; i++) { p.push(ball(0.03, bl[i], [0.3 + i * 0.03, 0.34, 0.3 + (i % 2) * 0.03]), sp(box(0.003, 0.2, 0.003), 0x777777, [0.3 + i * 0.03, 0.14, 0.3 + (i % 2) * 0.03], Skin.Plain)); } // balloons
    p.push(...board(-0.05, 0.31, 0.098, 0.4, 0x2f6fb0, 6), ...tree(-0.43, 0.4, 0.8));
    out.toystore = merge(p);
  }
  { // GARDEN CENTRE
    const p: G[] = [sp(box(0.98, 0.012, 0.98), 0x9fb87a, [0, 0, 0], Skin.Stucco)];
    p.push(sp(box(0.5, 0.2, 0.4), 0xe6f2f2, [-0.2, 0.012, -0.22], Skin.Glass), roof(-0.2, 0.212, -0.22, 0.52, 0.12, 0.42, 0xcfe6e8, Skin.Glass)); // greenhouse
    for (let i = 0; i <= 4; i++) p.push(sp(box(0.008, 0.2, 0.41), 0xe8e8e8, [-0.45 + i * 0.125, 0.012, -0.22], Skin.Metal));
    p.push(sp(box(0.24, 0.16, 0.2), 0x8a6a48, [0.3, 0.012, -0.3], Skin.Boards), roof(0.3, 0.172, -0.3, 0.26, 0.07, 0.22, 0x4a4540, Skin.Shingle)); // shed
    p.push(...door(0.3, -0.198, 0x3f6a5a, 0.1));
    for (let r = 0; r < 3; r++) { p.push(sp(box(0.8, 0.02, 0.06), 0x8a6a48, [0, 0.012, 0.0 + r * 0.14], Skin.Boards)); for (let i = 0; i < 9; i++) p.push(ball(0.022, [0x4f8a45, 0xe05a6d, 0xf2c230, 0x5a9a4a][(i + r) % 4], [-0.36 + i * 0.09, 0.05, r * 0.14])); }
    for (let i = 0; i < 4; i++) p.push(sp(cyl(0.025, 0.04 + (i % 2) * 0.02, 8), 0xb4633f, [0.35 + (i % 2) * 0.06, 0.012 + (i > 1 ? 0.04 : 0), 0.3 + (i % 2) * 0.01], Skin.Brick)); // stacked pots
    for (let i = 0; i < 3; i++) p.push(sp(box(0.07, 0.03, 0.05), 0x4a3a2a, [-0.35 + i * 0.08, 0.012, 0.42], Skin.Stucco)); // soil bags
    p.push(...tree(0.42, 0.1, 1), ...tree(0.1, 0.42, 0.8), ...board(-0.1, 0.18, 0.0, 0.3, 0x3f7a4a, 5));
    out.gardencentre = merge(p);
  }
  { // RESTAURANT
    const p: G[] = [pave(0xc6bfae)];
    p.push(sp(box(0.7, 0.28, 0.42), 0xf0d9b5, [-0.04, 0.012, -0.22], Skin.Stucco), roof(-0.04, 0.292, -0.22, 0.74, 0.12, 0.46, 0xb4633f, Skin.Shingle));
    p.push(...win(-0.2, 0.06, -0.006, 0.28, 0.13), ...door(0.12, -0.006, 0x7a2a2a), ...awning(-0.04, 0.2, 0.0, 0.62, 8, 0x7a2a2a, 0xe8d8b8, 0.08), ...board(-0.04, 0.3, 0.0, 0.34, 0x2a2a30, 6), ...chimney(0.25, 0.3, -0.34, true));
    for (let i = 0; i < 4; i++) { const x = -0.34 + i * 0.22, z = 0.22 + (i % 2) * 0.1; p.push(sp(cyl(0.035, 0.015, 10), 0xf4f1ea, [x, 0.065, z], Skin.Plain), sp(cyl(0.006, 0.065, 5), 0x777777, [x, 0.012, z], Skin.Metal), sp(new THREE.ConeGeometry(0.06, 0.03, 8).translate(0, 0.015, 0), [0xd23b2e, 0x2f6fb0, 0xe0b030, 0x3f9e4a][i], [x, 0.16, z], Skin.Stucco), sp(cyl(0.004, 0.1, 5), 0x777777, [x, 0.07, z], Skin.Metal)); } // terrace tables + umbrellas
    for (const x of [-0.45, 0.45]) { p.push(sp(cyl(0.006, 0.16, 5), 0x555555, [x, 0.012, 0.15], Skin.Metal)); p.push(ball(0.012, 0xffe9a8, [x, 0.18, 0.15])); }
    p.push(sp(box(0.9, 0.003, 0.003), 0x777777, [0, 0.17, 0.15], Skin.Metal), ...pot(0.3, 0.02), ...tree(0.42, 0.4, 0.8), ...carAt(-0.3, 0.45, CARS[0]));
    out.restaurant = merge(p);
  }
  { // BANK
    const p: G[] = [pave(0xb9b4aa)];
    p.push(sp(box(0.78, 0.36, 0.5), 0xd9d3c4, [0, 0.03, -0.14], Skin.Concrete), sp(box(0.84, 0.03, 0.56), 0xc2bcad, [0, 0.012, -0.14], Skin.Concrete), sp(box(0.82, 0.03, 0.54), 0x8a8478, [0, 0.39, -0.14], Skin.Concrete));
    for (let i = 0; i < 6; i++) p.push(sp(cyl(0.022, 0.32, 10), 0xeee9dc, [-0.26 + i * 0.104, 0.03, 0.14], Skin.Concrete));
    p.push(sp(box(0.66, 0.03, 0.1), 0xcfc8b8, [0, 0.35, 0.14], Skin.Concrete), sp(new THREE.CylinderGeometry(0.0, 0.34, 0.1, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.3).translate(0, 0.42, 0), 0xd9d3c4, [0, 0, 0.14], Skin.Concrete)); // pediment
    for (let i = 0; i < 3; i++) p.push(sp(box(0.7 - i * 0.04, 0.016, 0.06), 0xd0cabc, [0, 0.012 + i * 0.016, 0.24 - i * 0.02], Skin.Concrete)); // steps
    p.push(...door(0, 0.115, 0x3a3f45, 0.14), sp(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 14).rotateX(Math.PI / 2), 0xc9a646, [0, 0.3, 0.117], Skin.Metal), ...board(0, 0.42, 0.2, 0.28, 0x1f3a5f, 4));
    p.push(sp(box(0.07, 0.12, 0.05), 0x4a525a, [0.38, 0.012, 0.3], Skin.Metal), sp(box(0.05, 0.03, 0.006), 0x6fd0ff, [0.38, 0.09, 0.327], Skin.Glass), sp(cyl(0.006, 0.4, 5), 0xdddddd, [-0.38, 0.012, 0.3], Skin.Metal), sp(box(0.09, 0.05, 0.004), 0xc23b2e, [-0.335, 0.37, 0.3], Skin.Stucco)); // ATM + flag
    p.push(...tree(0.42, -0.42, 0.9), ...tree(-0.42, -0.42, 0.9), ...carAt(-0.15, 0.44, CARS[3]));
    out.bank = merge(p);
  }
  { // CAR DEALERSHIP
    const p: G[] = [pave(0x8f9396, Skin.Concrete)];
    p.push(sp(box(0.62, 0.22, 0.34), 0xe6f0f4, [-0.14, 0.012, -0.28], Skin.Glass), sp(box(0.68, 0.02, 0.4), 0x4a525a, [-0.14, 0.232, -0.28], Skin.Roof), sp(box(0.66, 0.04, 0.012), 0xd23b2e, [-0.14, 0.2, -0.098], Skin.Metal));
    for (let i = 0; i <= 5; i++) p.push(sp(box(0.008, 0.22, 0.012), 0x4a525a, [-0.43 + i * 0.116, 0.012, -0.1], Skin.Metal));
    p.push(...carAt(-0.3, -0.28, CARS[0], 0.3), ...carAt(-0.1, -0.28, CARS[1], -0.2)); // showroom cars
    for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) p.push(...carAt(-0.4 + i * 0.16, 0.12 + r * 0.22, CARS[(i + r * 2) % 6], 0), sp(box(0.003, 0.003, 0.09), 0xffffff, [-0.4 + i * 0.16 + 0.04, 0.013, 0.12 + r * 0.22], Skin.Plain));
    p.push(sp(cyl(0.008, 0.36, 6), 0xdddddd, [0.42, 0.012, 0.3], Skin.Metal), sp(box(0.14, 0.12, 0.02), 0x1f3a5f, [0.42, 0.32, 0.3], Skin.Boards), sp(box(0.9, 0.003, 0.003), 0xf2c230, [0, 0.12, 0.0], Skin.Plain));
    for (let i = 0; i < 9; i++) p.push(sp(new THREE.ConeGeometry(0.015, 0.03, 3).rotateX(Math.PI), [0xd23b2e, 0xf2c230, 0x2f6fb0][i % 3], [-0.4 + i * 0.1, 0.108, 0.0], Skin.Plain)); // pennants
    out.cardealer = merge(p);
  }
  { // GYM
    const p: G[] = [pave()];
    p.push(sp(box(0.74, 0.3, 0.5), 0xcfd4d8, [0, 0.012, -0.14], Skin.Concrete), sp(box(0.76, 0.02, 0.52), 0x3a4048, [0, 0.312, -0.14], Skin.Roof));
    p.push(sp(box(0.5, 0.2, 0.012), GL, [-0.06, 0.06, 0.112], Skin.Glass), ...door(0.3, 0.112, 0x2f2f35), sp(box(0.52, 0.016, 0.02), 0xf2c230, [-0.06, 0.28, 0.114], Skin.Plain));
    for (let i = 0; i <= 5; i++) p.push(sp(box(0.008, 0.2, 0.016), 0x3a4048, [-0.31 + i * 0.1, 0.06, 0.118], Skin.Metal));
    p.push(sp(box(0.5, 0.012, 0.3), 0x6fc3d9, [0.0, 0.325, -0.1], Skin.Glass), sp(box(0.54, 0.016, 0.34), 0xe8e8e8, [0, 0.31, -0.1], Skin.Concrete)); // rooftop pool
    p.push(sp(cylC(0.04, 0.012, 10).rotateZ(Math.PI / 2), 0x333333, [-0.26, 0.4, 0.14], Skin.Metal), sp(cylC(0.04, 0.012, 10).rotateZ(Math.PI / 2), 0x333333, [-0.06, 0.4, 0.14], Skin.Metal), sp(cylC(0.008, 0.2, 6).rotateZ(Math.PI / 2), 0xaaaaaa, [-0.16, 0.4, 0.14], Skin.Metal), sp(box(0.5, 0.06, 0.012), 0xd23b2e, [-0.16, 0.34, 0.122], Skin.Plain)); // dumbbell sign
    for (let i = 0; i < 4; i++) p.push(sp(new THREE.TorusGeometry(0.018, 0.004, 5, 10), 0x333333, [0.32 + i * 0.012, 0.03, 0.34 - i * 0.002], Skin.Metal), sp(new THREE.TorusGeometry(0.018, 0.004, 5, 10), 0x333333, [0.32 + i * 0.012 + 0.04, 0.03, 0.34], Skin.Metal), sp(box(0.003, 0.03, 0.003), 0xaaaaaa, [0.32 + i * 0.012, 0.03, 0.34], Skin.Metal));
    p.push(sp(box(0.3, 0.016, 0.1), 0xd23b2e, [-0.2, 0.012, 0.36], Skin.Plain), ...tree(-0.42, 0.42, 0.8), ...carAt(0.15, 0.42, CARS[1]));
    out.gym = merge(p);
  }
  { // LAUNDROMAT
    const p: G[] = [pave(0xc6c6cc)];
    p.push(sp(box(0.7, 0.26, 0.44), 0xbcd8ee, [0, 0.012, -0.16], Skin.Siding), sp(box(0.72, 0.02, 0.46), 0xe8e8e8, [0, 0.272, -0.16], Skin.Roof));
    for (let i = 0; i < 3; i++) p.push(sp(new THREE.CylinderGeometry(0.058, 0.058, 0.012, 16).rotateX(Math.PI / 2), 0x9fd7ff, [-0.22 + i * 0.22, 0.12, 0.062], Skin.Glass), sp(new THREE.TorusGeometry(0.058, 0.01, 6, 16), 0xe8e8e8, [-0.22 + i * 0.22, 0.12, 0.066], Skin.Metal)); // porthole windows
    p.push(...door(0.3, 0.062, 0x2f6fb0), ...board(-0.05, 0.22, 0.066, 0.46, 0x2f6fb0, 7), sp(box(0.4, 0.012, 0.02), 0x6fd0ff, [-0.05, 0.19, 0.07], Skin.Glass));
    for (let i = 0; i < 4; i++) p.push(sp(box(0.07, 0.09, 0.07), 0xf0f0f0, [-0.3 + i * 0.1, 0.012, 0.27], Skin.Metal), sp(cylC(0.026, 0.012, 10).rotateX(Math.PI / 2), 0x6fd0ff, [-0.3 + i * 0.1, 0.06, 0.308], Skin.Glass)); // machines out front on the forecourt
    p.push(sp(box(0.2, 0.025, 0.06), 0x7a5232, [0.26, 0.03, 0.32], Skin.Boards), ball(0.03, 0xffffff, [0.2, 0.07, 0.32]), ball(0.03, 0xd9e8ff, [0.28, 0.07, 0.32]), ...tree(0.42, -0.4, 0.8));
    out.laundromat = merge(p);
  }
  { // VET CLINIC
    const p: G[] = [pave(0xc2c8b8)];
    p.push(sp(box(0.66, 0.26, 0.42), 0xf3ead8, [-0.06, 0.012, -0.2], Skin.Stucco), roof(-0.06, 0.272, -0.2, 0.7, 0.1, 0.46, 0x4f7a8a, Skin.Shingle));
    p.push(...win(-0.24, 0.06, 0.012, 0.2, 0.12), ...win(0.1, 0.06, 0.012, 0.2, 0.12), ...door(-0.07, 0.012, 0x3f7a5a), ...awning(-0.06, 0.2, 0.014, 0.58, 8, 0x3f7a5a, 0xf3ead8, 0.07));
    p.push(...board(-0.06, 0.29, 0.016, 0.3, 0x3f7a5a, 4), sp(box(0.07, 0.02, 0.012), 0xffffff, [0.3, 0.38, -0.2], Skin.Plain), sp(box(0.02, 0.07, 0.012), 0x3f9e4a, [0.3, 0.38, -0.2], Skin.Plain), sp(box(0.07, 0.02, 0.012), 0x3f9e4a, [0.3, 0.38, -0.19], Skin.Plain));
    p.push(ball(0.016, 0x8a5a33, [0.26, 0.2, 0.0]), ball(0.01, 0x8a5a33, [0.24, 0.23, 0.0]), ball(0.01, 0x8a5a33, [0.28, 0.23, 0.0])); // paw sign
    p.push(sp(box(0.1, 0.07, 0.1), 0x8a6a48, [0.38, 0.012, 0.22], Skin.Boards), roof(0.38, 0.082, 0.22, 0.12, 0.05, 0.12, 0x6a3a2a, Skin.Shingle), ball(0.022, 0x8a5a33, [0.38, 0.04, 0.27]));
    for (let i = 0; i < 12; i++) p.push(sp(box(0.016, 0.06, 0.008), 0xf4f1ea, [-0.4 + i * 0.07, 0.012, 0.4], Skin.Plain));
    p.push(...pot(-0.3, 0.3), ...pot(0.2, 0.3, 0xe05a6d), ...tree(-0.43, 0.2, 0.9), ...carAt(0.1, 0.45, CARS[2]));
    out.vetclinic = merge(p);
  }
  return out;
}

export function newFactoryModels(): Record<string, G> {
  const out: Record<string, G> = {};
  const apron = () => sp(box(0.98, 0.012, 0.98), 0x9ea2a4, [0, 0, 0], Skin.Concrete);
  const dock = (x: number, z: number): G[] => [sp(box(0.1, 0.11, 0.008), 0x8f969d, [x, 0.04, z], Skin.Metal), sp(box(0.11, 0.05, 0.04), 0xc4c0b6, [x, 0, z + 0.02], Skin.Concrete)];
  { // PRINT WORKS: brick saw-tooth hall, paper-roll yard, ink tank, book-stack sign.
    const p: G[] = [apron()];
    p.push(sp(box(0.84, 0.24, 0.5), 0xa4533b, [0, 0.012, -0.14], Skin.Brick));
    for (let i = 0; i < 4; i++) p.push(sp(gable(0.21, 0.08, 0.52), 0x4b535b, [-0.315 + i * 0.21, 0.252, -0.14], Skin.Roof, [0, Math.PI / 2, 0]), sp(box(0.2, 0.05, 0.006), GL, [-0.315 + i * 0.21, 0.27, 0.12], Skin.Glass));
    for (let i = 0; i < 5; i++) p.push(sp(box(0.1, 0.11, 0.008), 0x8f969d, [-0.34 + i * 0.17, 0.04, 0.115], Skin.Metal), ...[0].map(() => sp(box(0.11, 0.05, 0.04), 0xc4c0b6, [-0.34 + i * 0.17, 0, 0.135], Skin.Concrete)));
    for (let i = 0; i < 4; i++) p.push(sp(cylC(0.04, 0.09, 12).rotateX(Math.PI / 2), 0xf4f1ea, [-0.35 + i * 0.1, 0.05, 0.3], Skin.Plain), sp(cylC(0.012, 0.095, 8).rotateX(Math.PI / 2), 0x8a6a48, [-0.35 + i * 0.1, 0.05, 0.3], Skin.Boards)); // paper rolls
    for (let i = 0; i < 3; i++) p.push(sp(box(0.08, 0.016, 0.06), [0xb5543c, 0x3f6fa0, 0x4f8a45][i], [0.3, 0.012 + i * 0.016, 0.3], Skin.Plain)); // book stack
    p.push(sp(cyl(0.05, 0.3, 12), 0xc5cbd2, [0.36, 0.012, -0.34], Skin.Metal), sp(cyl(0.02, 0.5, 10), 0xa4533b, [-0.38, 0.012, -0.38], Skin.Brick), sp(box(0.3, 0.06, 0.014), 0x1f3a5f, [-0.05, 0.3, 0.118], Skin.Boards));
    p.push(...[0, 1, 2].map((i) => sp(box(0.03, 0.04, 0.01), [0xb5543c, 0xe0b030, 0x4f8a45][i], [-0.14 + i * 0.04, 0.3, 0.126], Skin.Plain)), sp(box(0.1, 0.09, 0.3), 0xe8e8e8, [0.1, 0.03, 0.4], Skin.Metal), sp(box(0.1, 0.07, 0.06), 0x2f6fb0, [0.1, 0.03, 0.55], Skin.Metal));
    out.printworks = merge(p);
  }
  { // TOY FACTORY: bright block-coloured sheds, candy-striped chimney, giant ABC blocks, conveyor of toys.
    const p: G[] = [apron()];
    p.push(sp(box(0.5, 0.22, 0.44), 0xf2c230, [-0.2, 0.012, -0.14], Skin.Metal), sp(box(0.52, 0.02, 0.46), 0xd23b2e, [-0.2, 0.232, -0.14], Skin.Roof), sp(box(0.3, 0.3, 0.36), 0x2f6fb0, [0.28, 0.012, -0.18], Skin.Metal), sp(box(0.32, 0.02, 0.38), 0xf2c230, [0.28, 0.312, -0.18], Skin.Roof));
    for (let i = 0; i < 7; i++) p.push(sp(cyl(0.028, 0.06, 10), i % 2 ? 0xffffff : 0xd23b2e, [-0.38, 0.012 + 0.0 + (i * 0.1), -0.36], Skin.Plain));
    for (const [i, c] of [0xd23b2e, 0x3f9e4a, 0x2f6fb0].entries()) p.push(sp(box(0.07, 0.07, 0.07), c, [-0.34 + i * 0.09, 0.012, 0.3], Skin.Plain), sp(box(0.03, 0.03, 0.004), 0xffffff, [-0.34 + i * 0.09, 0.03, 0.337], Skin.Plain)); // ABC blocks
    p.push(sp(box(0.6, 0.02, 0.05), 0x555a60, [-0.05, 0.05, 0.18], Skin.Metal));
    for (let i = 0; i < 6; i++) p.push(ball(0.018, [0xd23b2e, 0x3f9e4a, 0x2f6fb0, 0xf2c230, 0xb872c4, 0xff8a3d][i], [-0.3 + i * 0.1, 0.085, 0.18]));
    for (let i = 0; i < 3; i++) p.push(...dock(-0.34 + i * 0.14, 0.085));
    p.push(sp(cyl(0.06, 0.26, 12), 0xe8e8e8, [0.42, 0.012, 0.18], Skin.Metal), sp(new THREE.ConeGeometry(0.06, 0.05, 12).translate(0, 0.025, 0), 0xc5cbd2, [0.42, 0.272, 0.18], Skin.Metal)); // pellet silo
    p.push(sp(box(0.4, 0.06, 0.014), 0xd23b2e, [-0.2, 0.2, 0.082], Skin.Plain), sp(box(0.3, 0.025, 0.016), 0xffffff, [-0.2, 0.21, 0.09], Skin.Plain));
    out.toyfactory = merge(p);
  }
  return out;
}
