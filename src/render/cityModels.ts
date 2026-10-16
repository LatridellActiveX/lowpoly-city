/**
 * render/cityModels.ts — more homes, shops, offices and industry.
 *
 * One merged vertex-coloured geometry per template (instanced like the
 * office / industry models). 1 unit ≈ the building body's shorter side;
 * the front faces +z. Three groups, keyed by template id:
 *   homeModels()      — villa, terrace, modern house, garden towers, sky residence
 *   commerceModels()  — supermarket, petrol station, pharmacy, hotel, cinema,
 *                       department store, outlet mall, office tower, business park
 *   industryExtra()   — brewery, pharma lab, clothing factory, cold store,
 *                       industrial park, mega-factory
 */
import * as THREE from 'three';
import { box, gable, merge, part } from './models';
import { autoSkinMap, remapUV, Skin, skinProjected } from './textures';
import { newFactoryModels, newShopModels } from './shopModels';

type G = THREE.BufferGeometry;
const cyl = (r: number, h: number, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);
const GL = 0x9fd7ff, WIN = 0x3e5f7a;
const plot = (c = 0xb9b6ae) => part(box(0.98, 0.012, 0.98), c);
const lawn = () => part(box(0.98, 0.012, 0.98), 0x8fc06a);
const tree = (x: number, z: number, s = 1) => [
  part(cyl(0.012 * s, 0.05 * s, 6), 0x6b4a2f, [x, 0.012, z]),
  part(new THREE.IcosahedronGeometry(0.05 * s, 0).translate(0, 0.09 * s, 0), 0x4f8a45, [x, 0.012, z]),
];
const car = (x: number, z: number, c: number, yaw = 0) => [
  part(box(0.05, 0.022, 0.1), c, [x, 0.016, z], [0, yaw, 0]),
  part(box(0.045, 0.016, 0.05), 0x2b3a47, [x, 0.036, z], [0, yaw, 0]),
];
const CARS = [0xc0392b, 0x2f6fb0, 0xe8e8e8, 0x2d2d2d, 0xe0b030];
/** Window grid on the front and back faces of a w × h box (and sides if d > 0). */
function windows(w: number, d: number, floors: number, y0: number, fh: number, cx = 0, cz = 0, c = WIN): G[] {
  const out: G[] = [];
  const nx = Math.max(2, Math.round(w / 0.1)), nz = Math.max(2, Math.round(d / 0.1));
  for (let f = 0; f < floors; f++) {
    const y = y0 + f * fh;
    for (let k = 0; k < nx; k++) { const x = cx - w / 2 + (w * (k + 0.5)) / nx; out.push(part(box(0.045, 0.055, 0.008), c, [x, y, cz + d / 2 + 0.004]), part(box(0.045, 0.055, 0.008), c, [x, y, cz - d / 2 - 0.004])); }
    for (let k = 0; k < nz; k++) { const z = cz - d / 2 + (d * (k + 0.5)) / nz; out.push(part(box(0.008, 0.055, 0.045), c, [cx + w / 2 + 0.004, y, z]), part(box(0.008, 0.055, 0.045), c, [cx - w / 2 - 0.004, y, z])); }
  }
  return out;
}
const sign = (x: number, y: number, z: number, w: number, c: number) => [part(box(w, 0.06, 0.012), c, [x, y, z]), part(box(w * 0.7, 0.014, 0.014), 0xffffff, [x, y + 0.022, z + 0.001])];
const hvac = (x: number, y: number, z: number) => [part(box(0.1, 0.05, 0.07), 0xb8bec4, [x, y, z]), part(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 10), 0x3a3f44, [x + 0.02, y + 0.053, z])];
const stalls = (x0: number, z: number, n: number, dx = 0.09) => {
  const o: G[] = [];
  for (let k = 0; k < n; k++) o.push(part(box(0.004, 0.003, 0.08), 0xf5f5f0, [x0 + k * dx, 0.013, z]));
  return o;
};

// ------------------------------------------------------------------ homes
export function homeModels(): Record<string, G> {
  const out: Record<string, G> = {};
  { // VILLA: stucco villa with a terracotta hip roof, a pool and palms.
    const p: G[] = [lawn()];
    p.push(part(box(0.5, 0.2, 0.42), 0xf0e4cc, [-0.1, 0.012, -0.1]));
    p.push(part(new THREE.CylinderGeometry(0.02, 0.4, 0.14, 4, 1).rotateY(Math.PI / 4).scale(1.1, 1, 0.95).translate(0, 0.28, 0), 0xc4623a, [-0.1, 0, -0.1]));
    p.push(part(box(0.2, 0.15, 0.18), 0xf0e4cc, [0.2, 0.012, 0.1]));
    p.push(part(gable(0.22, 0.08, 0.2), 0xc4623a, [0.2, 0.162, 0.1]));
    p.push(...windows(0.5, 0.42, 1, 0.1, 0.1, -0.1, -0.1, 0x5b8fb5));
    p.push(part(box(0.1, 0.13, 0.008), 0x5a3a22, [-0.1, 0.012, 0.115]));
    p.push(part(box(0.22, 0.014, 0.14), 0x4fb3d9, [-0.22, 0.012, 0.34])); // pool
    p.push(part(box(0.26, 0.008, 0.18), 0xe8dfc9, [-0.22, 0.008, 0.34]));
    for (const [x, z] of [[0.38, -0.38], [0.4, 0.3]]) { p.push(part(cyl(0.008, 0.16, 5), 0x7a5a3a, [x, 0.012, z])); p.push(part(new THREE.ConeGeometry(0.06, 0.04, 6).translate(0, 0.02, 0), 0x3f8a4a, [x, 0.17, z])); }
    p.push(...car(0.33, 0.42, 0xe8e8e8));
    out.villa = merge(p);
  }
  { // TERRACE: five textured townhouses (siding / brick / stucco walls, shingle roofs) with bay windows,
    // fanlights, chimneys, front walls, hedges, flower beds, bins and a street tree.
    // UVs are set per part (skinProjected), so register this one WITHOUT autoSkin and with industrialMaterial.
    const p: G[] = [];
    const sp = (geo: G, color: number, pos: [number, number, number], sk: Skin, rot?: [number, number, number]) => skinProjected(part(geo, color, pos, rot), sk);
    const ball = (r: number, x: number, y: number, z: number, c: number) => sp(new THREE.IcosahedronGeometry(r, 1), c, [x, y, z], Skin.Plain);
    p.push(sp(box(0.98, 0.012, 0.98), 0xc9c5bb, [0, 0, 0], Skin.Concrete)); // pavement
    p.push(sp(box(0.98, 0.014, 0.3), 0x7fb35f, [0, 0.012, 0.34], Skin.Plain)); // front lawns
    const cols = [0xe3a88e, 0xf0d58a, 0x9ec2d6, 0xd6dc8e, 0xe6a8be];
    const walls = [Skin.Siding, Skin.Brick, Skin.Stucco, Skin.Siding, Skin.Brick];
    const bricks = [0xffffff, 0xc2644a, 0xffffff, 0xffffff, 0xb95a44];
    for (let k = 0; k < 5; k++) {
      const x = -0.4 + k * 0.2, tall = 0.3 + (k % 2) * 0.03;
      const wall = walls[k] === Skin.Brick ? bricks[k] : cols[k];
      p.push(sp(box(0.19, tall, 0.5), wall, [x, 0.012, -0.05], walls[k]));
      p.push(sp(box(0.2, 0.012, 0.52), 0xd8d2c4, [x, 0.012 + 0.0, -0.05], Skin.Concrete)); // plinth
      p.push(sp(gable(0.5, 0.08, 0.19), 0x6a5a55, [x, 0.012 + tall, -0.05], Skin.Shingle, [0, Math.PI / 2, 0]));
      p.push(sp(box(0.2, 0.014, 0.012), 0xf4f1ea, [x, 0.012 + tall - 0.006, 0.22], Skin.Plain)); // fascia
      // chimney + pot
      p.push(sp(box(0.045, 0.1, 0.045), 0xa4533b, [x + 0.05, 0.012 + tall + 0.02, -0.2], Skin.Brick), sp(box(0.055, 0.014, 0.055), 0xcfc8bb, [x + 0.05, 0.012 + tall + 0.12, -0.2], Skin.Concrete), sp(new THREE.CylinderGeometry(0.01, 0.012, 0.03, 8).translate(0, 0.015, 0), 0xc2713f, [x + 0.05, 0.012 + tall + 0.134, -0.2], Skin.Plain));
      // ground-floor bay window with its own roof, upper window with sill + lintel, shutters on odd houses
      p.push(sp(box(0.08, 0.1, 0.045), wall, [x - 0.04, 0.05, 0.222], walls[k]), sp(box(0.07, 0.07, 0.008), GL, [x - 0.04, 0.065, 0.248], Skin.Glass), sp(box(0.09, 0.014, 0.05), 0xf4f1ea, [x - 0.04, 0.15, 0.222], Skin.Plain), sp(box(0.09, 0.012, 0.05), 0xe8e4da, [x - 0.04, 0.04, 0.226], Skin.Concrete));
      p.push(sp(box(0.06, 0.075, 0.008), GL, [x - 0.04, 0.2, 0.2], Skin.Glass), sp(box(0.075, 0.012, 0.02), 0xf4f1ea, [x - 0.04, 0.195, 0.205], Skin.Plain), sp(box(0.07, 0.012, 0.014), 0xf4f1ea, [x - 0.04, 0.28, 0.2], Skin.Plain), sp(box(0.004, 0.075, 0.01), 0xf4f1ea, [x - 0.04, 0.2, 0.205], Skin.Plain));
      if (k % 2) for (const sg of [-1, 1]) p.push(sp(box(0.02, 0.075, 0.01), 0x3f6a5a, [x - 0.04 + sg * 0.046, 0.2, 0.203], Skin.Boards));
      // front door: frame, panels, fanlight, step, lamp, number plate
      p.push(sp(box(0.05, 0.11, 0.012), 0x5a3a22, [x + 0.05, 0.012, 0.204], Skin.Boards), sp(box(0.06, 0.12, 0.008), 0xf4f1ea, [x + 0.05, 0.012, 0.2], Skin.Plain), sp(new THREE.CylinderGeometry(0.026, 0.026, 0.01, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).translate(0, 0.123, 0), 0xbfe6ff, [x + 0.05, 0.012, 0.208], Skin.Glass));
      for (const dy of [0.04, 0.08]) p.push(sp(box(0.03, 0.03, 0.006), 0x4a2f1a, [x + 0.05, dy, 0.211], Skin.Boards));
      p.push(sp(box(0.07, 0.018, 0.05), 0xcfc8bb, [x + 0.05, 0.012, 0.238], Skin.Concrete), sp(box(0.012, 0.016, 0.006), 0xc9a646, [x + 0.09, 0.14, 0.205], Skin.Plain), sp(new THREE.SphereGeometry(0.009, 6, 5), 0xffe9a8, [x + 0.09, 0.16, 0.208], Skin.Plain));
      // drainpipe + party wall pilaster
      p.push(sp(box(0.008, tall, 0.008), 0x4a4f55, [x + 0.092, 0.012, 0.207], Skin.Metal), sp(box(0.012, tall + 0.02, 0.52), 0xcfc8bb, [x - 0.1, 0.012, -0.05], Skin.Concrete));
      // dormer on alternate houses
      if (k % 2 === 0) p.push(sp(box(0.07, 0.06, 0.06), wall, [x, 0.012 + tall + 0.012, 0.1], walls[k]), sp(gable(0.06, 0.04, 0.07), 0x6a5a55, [x, 0.012 + tall + 0.072, 0.1], Skin.Shingle, [0, Math.PI / 2, 0]), sp(box(0.04, 0.035, 0.008), GL, [x, 0.012 + tall + 0.03, 0.132], Skin.Glass));
      // front garden: low brick wall, gate gap by the door, hedge balls, flower bed, bin
      p.push(sp(box(0.1, 0.03, 0.012), 0xa4533b, [x - 0.04, 0.012, 0.47], Skin.Brick), sp(box(0.03, 0.04, 0.014), 0xa4533b, [x + 0.01, 0.012, 0.47], Skin.Brick));
      for (let h = 0; h < 3; h++) p.push(ball(0.022, x - 0.07 + h * 0.035, 0.044, 0.44, 0x4f8a45));
      for (let f = 0; f < 4; f++) p.push(ball(0.011, x - 0.075 + f * 0.04, 0.034, 0.36, [0xe05a6d, 0xf2c230, 0xffffff, 0xb872c4][(f + k) % 4]));
      p.push(sp(cyl(0.016, 0.045, 8), [0x2f6f4f, 0x2f4f8a, 0x555a60][k % 3], [x + 0.07, 0.014, 0.4], Skin.Plain), sp(cyl(0.017, 0.008, 8), 0x333333, [x + 0.07, 0.059, 0.4], Skin.Plain));
      p.push(sp(box(0.036, 0.004, 0.14), 0xb9b2a6, [x + 0.05, 0.013, 0.34], Skin.Concrete)); // path
    }
    // street trees + cars
    for (const tx of [-0.46, 0.46]) p.push(sp(cyl(0.012, 0.09, 6), 0x6b4a2f, [tx, 0.012, 0.44], Skin.Boards), ball(0.06, tx, 0.14, 0.44, 0x4f8a45), ball(0.045, tx + 0.03, 0.18, 0.43, 0x5a9a4a));
    p.push(...car(-0.18, 0.5, CARS[1]).map((g) => remapUV(g, Skin.Plain)), ...car(0.2, 0.5, CARS[0]).map((g) => remapUV(g, Skin.Plain)));
    out.terrace = merge(p);
  }
  { // MODERN HOUSE: stacked white and timber boxes, flat roofs, big glazing, solar panels.
    const p: G[] = [lawn()];
    p.push(part(box(0.5, 0.17, 0.4), 0xf4f4f0, [-0.05, 0.012, -0.05]));
    p.push(part(box(0.32, 0.15, 0.34), 0x8a6a48, [0.06, 0.182, -0.03]));
    p.push(part(box(0.54, 0.014, 0.44), 0x4a4f55, [-0.05, 0.182, -0.05]));
    p.push(part(box(0.36, 0.014, 0.38), 0x4a4f55, [0.06, 0.332, -0.03]));
    p.push(part(box(0.36, 0.1, 0.008), 0x3e6a8a, [-0.1, 0.05, 0.155]));
    p.push(part(box(0.2, 0.09, 0.008), 0x3e6a8a, [0.1, 0.22, 0.145]));
    for (let k = 0; k < 3; k++) p.push(part(box(0.09, 0.006, 0.07), 0x1d3550, [0.0 + k * 0.1, 0.348, -0.03], [0.3, 0, 0]));
    p.push(part(box(0.22, 0.012, 0.1), 0xa09a90, [0.26, 0.012, 0.38]));
    p.push(...car(0.28, 0.38, CARS[3]));
    p.push(...tree(-0.38, -0.38), ...tree(0.4, -0.4, 0.8));
    out.modern = merge(p);
  }
  { // GARDEN TOWERS: two slim residential towers over a landscaped podium with balconies.
    const p: G[] = [plot(0xaab39b)];
    p.push(part(box(0.9, 0.06, 0.9), 0xd8d2c2, [0, 0.012, 0]));
    for (const [x, h] of [[-0.22, 0.62], [0.24, 0.5]] as const) {
      p.push(part(box(0.3, h, 0.3), 0xe9e4d8, [x, 0.07, -0.08]));
      p.push(part(box(0.32, 0.02, 0.32), 0x585f66, [x, 0.07 + h, -0.08]));
      p.push(...windows(0.3, 0.3, Math.round(h / 0.1), 0.14, 0.09, x, -0.08, 0x6a8fa8));
      for (let f = 0; f < Math.round(h / 0.1); f += 2) p.push(part(box(0.3, 0.012, 0.05), 0xb9b2a2, [x, 0.12 + f * 0.09, 0.095]));
    }
    p.push(...tree(-0.38, 0.35), ...tree(0.0, 0.38, 1.2), ...tree(0.4, 0.34));
    p.push(part(box(0.2, 0.01, 0.12), 0x4fb3d9, [0, 0.08, 0.34]));
    out.gardentowers = merge(p);
  }
  { // SKY RESIDENCE: one tall slim tower with a stepped crown and a glass lobby.
    const p: G[] = [plot(0x9fa6a6)];
    p.push(part(box(0.7, 0.07, 0.5), 0x7a8288, [0, 0.012, 0.15]));
    p.push(part(box(0.5, 0.11, 0.04), 0x2d5f80, [0, 0.082, 0.4]));
    p.push(part(box(0.38, 0.9, 0.38), 0xcfd8de, [0, 0.07, -0.1]));
    p.push(part(box(0.3, 0.12, 0.3), 0xb8c4cc, [0, 0.97, -0.1]));
    p.push(part(box(0.2, 0.1, 0.2), 0xa7b6c0, [0, 1.09, -0.1]));
    p.push(part(cyl(0.008, 0.16, 5), 0xd23b2e, [0, 1.19, -0.1]));
    p.push(...windows(0.38, 0.38, 9, 0.14, 0.09, 0, -0.1, 0x35607f));
    for (const [x, z] of [[-0.3, 0.4], [0.3, 0.4]]) p.push(...tree(x, z, 1.1));
    out.skyresidence = merge(p);
  }
  return out;
}

// ------------------------------------------------------------- commerce
/** Model keys whose UVs are already set (do NOT autoSkin them; draw with industrialMaterial). */
export const PRESKINNED = new Set(['terrace', 'bakery', 'bookstore', 'toystore', 'gardencentre', 'restaurant', 'bank', 'cardealer', 'gym', 'laundromat', 'vetclinic', 'printworks', 'toyfactory',
  'supermarket', 'petrol', 'pharmacy', 'hotel', 'cinema', 'department', 'outlet', 'officetower', 'bizpark']);
/** Surfaces for the older commerce models, picked by exact vertex colour. */
const SHOP_SKINS: Record<number, Skin> = {
  0xe9e3d4: Skin.Stucco, 0xf0ece2: Skin.Stucco, 0xf4f6f4: Skin.Stucco, 0xd9c9ad: Skin.Stucco, 0xefe6d2: Skin.Stucco, 0xd9d2c0: Skin.Concrete,
  0x4a525a: Skin.Roof, 0x7b8790: Skin.Roof, 0x5a4a40: Skin.Roof, 0x7c6a58: Skin.Roof, 0x7a6f66: Skin.Roof, 0x585f66: Skin.Roof,
  0x3f9e4a: Skin.Siding, 0xd8cdb6: Skin.Concrete, 0xcbbfa5: Skin.Concrete, 0x6b3f5e: Skin.Concrete, 0x4e2c44: Skin.Concrete, 0xdfe5e8: Skin.Concrete,
  0x6fa8c8: Skin.Glass, 0x5c93b3: Skin.Glass, 0x4f84a3: Skin.Glass, 0x7fb3a8: Skin.Glass,
  0x8d9194: Skin.Concrete, 0x8b8e90: Skin.Concrete, 0xc4c0b6: Skin.Concrete, 0xb5b0a4: Skin.Concrete, 0xb2aea6: Skin.Concrete, 0xb9b4aa: Skin.Concrete, 0xcfc7b5: Skin.Concrete, 0xaeb3b3: Skin.Concrete,
  0xdedede: Skin.Metal, 0xf4f4f0: Skin.Metal, 0xd23b2e: Skin.Plain,
};
export function commerceModels(): Record<string, G> {
  const out: Record<string, G> = {};
  { // SUPERMARKET: wide low shop, green sign, trolley bay, big front lot, rooftop units.
    const p: G[] = [plot(0x8d9194)];
    p.push(part(box(0.84, 0.2, 0.5), 0xe9e3d4, [0, 0.012, -0.2]));
    p.push(part(box(0.86, 0.02, 0.52), 0x4a525a, [0, 0.212, -0.2]));
    p.push(part(box(0.84, 0.09, 0.012), 0x3f9e4a, [0, 0.13, 0.055]));
    p.push(part(box(0.5, 0.11, 0.008), GL, [-0.1, 0.03, 0.054]));
    p.push(part(box(0.2, 0.06, 0.1), 0xd9d2c0, [0.32, 0.012, 0.1])); // trolley shelter
    p.push(...sign(0.12, 0.27, 0.07, 0.34, 0x3f9e4a));
    for (let k = 0; k < 3; k++) p.push(...hvac(-0.25 + k * 0.25, 0.232, -0.25));
    p.push(...stalls(-0.4, 0.28, 9, 0.1), ...stalls(-0.4, 0.42, 9, 0.1));
    p.push(...car(-0.3, 0.28, CARS[0]), ...car(-0.1, 0.28, CARS[2]), ...car(0.2, 0.42, CARS[1]), ...car(0.0, 0.42, CARS[4]));
    out.supermarket = merge(p);
  }
  { // PETROL STATION: big canopy on posts, pumps, kiosk, price sign.
    const p: G[] = [plot(0x8b8e90)];
    p.push(part(box(0.9, 0.025, 0.46), 0xd23b2e, [0, 0.33, 0.2]));
    p.push(part(box(0.92, 0.012, 0.48), 0xf4f4f0, [0, 0.355, 0.2]));
    for (const x of [-0.36, 0.36]) for (const z of [0.05, 0.35]) p.push(part(cyl(0.018, 0.32, 8), 0xdedede, [x, 0.012, z]));
    for (const x of [-0.2, 0.2]) { p.push(part(box(0.05, 0.12, 0.04), 0xd23b2e, [x, 0.012, 0.2])); p.push(part(box(0.04, 0.03, 0.005), 0x222222, [x, 0.09, 0.222])); }
    p.push(part(box(0.38, 0.17, 0.26), 0xf0ece2, [-0.18, 0.012, -0.32]), part(box(0.4, 0.02, 0.28), 0xd23b2e, [-0.18, 0.182, -0.32]), part(box(0.3, 0.09, 0.006), GL, [-0.18, 0.04, -0.188]));
    p.push(part(cyl(0.012, 0.5, 6), 0x777777, [0.42, 0.012, -0.1]), part(box(0.12, 0.14, 0.02), 0xf2c230, [0.42, 0.45, -0.1]));
    p.push(...car(0.0, 0.2, CARS[2], Math.PI / 2));
    out.petrol = merge(p);
  }
  { // PHARMACY: white corner clinic with a green cross, awning and ramp.
    const p: G[] = [plot(0xc4c0b6)];
    p.push(part(box(0.78, 0.26, 0.6), 0xf4f6f4, [0, 0.012, -0.12]));
    p.push(part(box(0.8, 0.02, 0.62), 0x7b8790, [0, 0.272, -0.12]));
    p.push(part(box(0.7, 0.014, 0.12), 0x3aa86b, [0, 0.19, 0.24]));
    p.push(part(box(0.5, 0.12, 0.008), GL, [-0.05, 0.03, 0.182]));
    p.push(part(box(0.12, 0.04, 0.012), 0x3aa86b, [0.0, 0.3, 0.18]), part(box(0.04, 0.12, 0.012), 0x3aa86b, [0.0, 0.3, 0.18]));
    p.push(part(box(0.1, 0.1, 0.012), 0x3aa86b, [0.28, 0.4, 0.18]), part(box(0.1, 0.034, 0.012), 0xffffff, [0.28, 0.4, 0.19]), part(box(0.034, 0.1, 0.012), 0xffffff, [0.28, 0.4, 0.19]));
    p.push(...hvac(-0.2, 0.292, -0.2), ...car(-0.35, 0.4, CARS[1]));
    out.pharmacy = merge(p);
  }
  { // HOTEL: mid-rise with a canopy porch, rooftop sign and pool terrace.
    const p: G[] = [plot(0xb5b0a4)];
    p.push(part(box(0.8, 0.5, 0.44), 0xd9c9ad, [0, 0.012, -0.16]));
    p.push(part(box(0.82, 0.02, 0.46), 0x5a4a40, [0, 0.512, -0.16]));
    p.push(...windows(0.8, 0.44, 5, 0.1, 0.095, 0, -0.16, 0x4f7490));
    p.push(part(box(0.3, 0.02, 0.22), 0x9b2f3a, [0, 0.14, 0.2]), ...[-0.12, 0.12].map((x) => part(cyl(0.012, 0.13, 6), 0xdedede, [x, 0.012, 0.28])));
    p.push(part(box(0.34, 0.12, 0.02), 0xc9a646, [0.2, 0.62, -0.1]));
    p.push(part(box(0.26, 0.012, 0.14), 0x4fb3d9, [-0.26, 0.012, 0.38]), ...tree(0.36, 0.38), ...car(0.12, 0.3, CARS[3]));
    out.hotel = merge(p);
  }
  { // DEPARTMENT STORE: stone-faced block, corner clock tower, flag poles, display windows.
    const p: G[] = [plot(0xb9b4aa)];
    p.push(part(box(0.9, 0.4, 0.6), 0xd8cdb6, [0, 0.012, -0.12]));
    p.push(part(box(0.92, 0.03, 0.62), 0x7c6a58, [0, 0.412, -0.12]));
    p.push(part(box(0.9, 0.012, 0.012), 0x9b7f55, [0, 0.26, 0.19]));
    for (let k = 0; k < 6; k++) p.push(part(box(0.1, 0.12, 0.008), GL, [-0.38 + k * 0.152, 0.04, 0.182]), part(box(0.07, 0.08, 0.008), WIN, [-0.38 + k * 0.152, 0.3, 0.182]));
    p.push(part(box(0.18, 0.62, 0.18), 0xcbbfa5, [0.36, 0.012, -0.1]), part(new THREE.ConeGeometry(0.13, 0.14, 4).rotateY(Math.PI / 4).translate(0, 0.07, 0), 0x6e4e3c, [0.36, 0.632, -0.1]));
    p.push(part(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 14).rotateX(Math.PI / 2), 0xf4f1e6, [0.36, 0.5, 0.0]));
    p.push(part(box(0.4, 0.07, 0.012), 0xb52f43, [-0.1, 0.45, 0.19]));
    p.push(...stalls(-0.4, 0.38, 8, 0.11), ...car(-0.3, 0.38, CARS[1]), ...car(0.1, 0.38, CARS[4]));
    out.department = merge(p);
  }
  { // OUTLET MALL: two long arcades with coloured shopfronts around a plaza, fountain and flags.
    const p: G[] = [plot(0xcfc7b5)];
    const fronts = [0xd9604f, 0xe0b040, 0x4f9ec9, 0x6fb06a, 0xb872c4, 0xe8825a];
    for (const z of [-0.3, 0.05]) {
      p.push(part(box(0.9, 0.18, 0.22), 0xefe6d2, [0, 0.012, z]), part(box(0.92, 0.02, 0.24), 0x7a6f66, [0, 0.192, z]));
      for (let k = 0; k < 6; k++) p.push(part(box(0.1, 0.07, 0.008), fronts[k], [-0.38 + k * 0.152, 0.13, z + 0.114]), part(box(0.1, 0.09, 0.008), GL, [-0.38 + k * 0.152, 0.03, z + 0.114]));
    }
    p.push(part(cyl(0.06, 0.04, 14), 0xbfb8aa, [0, 0.012, 0.26]), part(cyl(0.05, 0.03, 14), 0x7fd0e6, [0, 0.04, 0.26]), part(cyl(0.01, 0.1, 6), 0xdedede, [0, 0.04, 0.26]));
    p.push(...stalls(-0.4, 0.4, 8, 0.11), ...car(-0.2, 0.4, CARS[0]), ...car(0.3, 0.4, CARS[2]));
    for (const x of [-0.42, 0.42]) p.push(part(cyl(0.007, 0.34, 5), 0xdedede, [x, 0.012, 0.18]), part(box(0.06, 0.04, 0.004), 0xd23b2e, [x + 0.032, 0.32, 0.18]));
    out.outlet = merge(p);
  }
  { // OFFICE TOWER: glass curtain-wall tower on a podium with a stepped crown.
    const p: G[] = [plot(0xaeb3b3)];
    p.push(part(box(0.8, 0.12, 0.5), 0x8c949a, [0, 0.012, 0.18]));
    p.push(part(box(0.5, 0.09, 0.012), 0x2b5a7a, [0, 0.07, 0.435]));
    p.push(part(box(0.5, 1.0, 0.44), 0x6fa8c8, [0, 0.13, -0.14]));
    p.push(part(box(0.4, 0.12, 0.36), 0x5c93b3, [0, 1.13, -0.14]), part(box(0.28, 0.1, 0.26), 0x4f84a3, [0, 1.25, -0.14]));
    for (let f = 0; f < 11; f++) p.push(part(box(0.5, 0.01, 0.446), 0xe8eef2, [0, 0.2 + f * 0.09, -0.14]));
    p.push(part(cyl(0.008, 0.2, 5), 0xd23b2e, [0, 1.35, -0.14]));
    p.push(...hvac(0.12, 1.22, -0.14));
    p.push(...tree(-0.38, 0.42), ...tree(0.4, 0.42));
    out.officetower = merge(p);
  }
  { // BUSINESS PARK: three low glass pavilions linked by walkways round a pond.
    const p: G[] = [lawn()];
    for (const [x, z, w, d, c] of [[-0.25, -0.25, 0.4, 0.3, 0x6fa8c8], [0.25, -0.25, 0.4, 0.3, 0x7fb3a8], [0.0, 0.15, 0.5, 0.26, 0x6fa8c8]] as const) {
      p.push(part(box(w, 0.2, d), c, [x, 0.012, z]), part(box(w + 0.02, 0.014, d + 0.02), 0xdfe5e8, [x, 0.212, z]), part(box(w + 0.01, 0.01, d + 0.01), 0xffffff, [x, 0.1, z]));
      p.push(...windows(w, d, 2, 0.06, 0.08, x, z, 0x35607f));
    }
    p.push(part(box(0.1, 0.016, 0.3), 0xcfc7b5, [0, 0.016, -0.1]));
    p.push(part(cyl(0.1, 0.01, 16), 0x6fc3d9, [0.4, 0.012, 0.34]));
    p.push(...stalls(-0.45, 0.43, 8, 0.11), ...car(-0.3, 0.43, CARS[2]), ...car(-0.1, 0.43, CARS[3]));
    p.push(...tree(-0.42, 0.0), ...tree(0.42, 0.05), ...tree(-0.4, -0.42));
    out.bizpark = merge(p);
  }
  for (const k of Object.keys(out)) autoSkinMap(out[k], SHOP_SKINS);
  Object.assign(out, newShopModels());
  return out;
}

// ------------------------------------------------------------- industry
const BRICK = 0x9a4a35, MET = 0x8f989f, MET_D = 0x5b636a, CON = 0xc4c0b6, ROOFD = 0x4b535b, STEEL = 0xc5cbd2;
const apron = () => part(box(0.98, 0.012, 0.98), 0x9ea2a4);
const dock = (x: number, z: number, h = 0.16) => [part(box(0.1, h * 0.7, 0.006), 0x8f969d, [x, 0.05, z]), part(box(0.11, 0.05, 0.04), CON, [x, 0, z + 0.02])];
const stack = (x: number, z: number, h: number, c = 0xb9b2a6) => part(new THREE.CylinderGeometry(0.025, 0.04, h, 10).translate(0, h / 2, 0), c, [x, 0.012, z]);
const tankAt = (x: number, z: number, r: number, h: number, c = STEEL) => [
  part(cyl(r, h, 14), c, [x, 0.012, z]),
  part(new THREE.ConeGeometry(r, r * 0.5, 14).translate(0, r * 0.25, 0), MET_D, [x, 0.012 + h, z]),
];
const truck = (x: number, z: number, c = 0xe8e8e8) => [part(box(0.1, 0.09, 0.3), c, [x, 0.03, z]), part(box(0.1, 0.07, 0.06), 0x2f6fb0, [x, 0.03, z + 0.18]), part(box(0.1, 0.012, 0.36), 0x333333, [x, 0.012, z + 0.02])];

/** Surfaces for the factory extras (brewery … mega-factory), picked by exact vertex colour. */
export const FACTORY_SKINS: Record<number, Skin> = {
  0xcfc9bd: Skin.Concrete, 0xe6eef2: Skin.Metal, 0xf2f4f5: Skin.Stucco, 0xe6e9eb: Skin.Metal, 0xd7dbde: Skin.Metal, 0xd0d4d8: Skin.Metal,
  0x8a9aa5: Skin.Roof, 0x7a8790: Skin.Roof, 0x4aa3c7: Skin.Glass, 0xb5543c: Skin.Brick, 0xc4c0b6: Skin.Concrete, 0xc27b3a: Skin.Rust,
  0x9ea2a4: Skin.Concrete, 0xe0b030: Skin.Plain, 0xe8e8e8: Skin.Metal, 0xeef3f6: Skin.Metal,
};
export function industryExtra(): Record<string, G> {
  const out: Record<string, G> = {};
  { // BREWERY: brick brewhouse, shiny copper kettles, tall fermenters, bottling hall, delivery lorry.
    const p: G[] = [apron()];
    p.push(part(box(0.5, 0.3, 0.4), BRICK, [-0.2, 0.012, -0.1]), part(gable(0.52, 0.1, 0.42), ROOFD, [-0.2, 0.312, -0.1]));
    for (const x of [-0.34, -0.2, -0.06]) p.push(part(box(0.06, 0.1, 0.006), 0x9fd7ff, [x, 0.1, 0.103]));
    for (const [x, z] of [[0.12, -0.3], [0.26, -0.3], [0.4, -0.3]]) { p.push(...tankAt(x, z, 0.06, 0.4)); p.push(part(box(0.012, 0.4, 0.012), MET_D, [x + 0.06, 0.012, z])); }
    p.push(part(new THREE.SphereGeometry(0.09, 14, 8), 0xc27b3a, [0.22, 0.15, 0.05]), part(cyl(0.02, 0.1, 8), 0xc27b3a, [0.22, 0.22, 0.05]));
    p.push(part(box(0.26, 0.14, 0.2), CON, [0.3, 0.012, 0.32]), part(box(0.28, 0.014, 0.22), ROOFD, [0.3, 0.152, 0.32]));
    p.push(part(box(0.3, 0.07, 0.012), 0xe0a020, [-0.2, 0.34, 0.11]));
    for (let k = 0; k < 6; k++) p.push(part(box(0.05, 0.05, 0.05), 0xe0b030, [-0.38 + (k % 3) * 0.055, 0.012 + Math.floor(k / 3) * 0.05, 0.36])); // crates
    p.push(...truck(-0.1, 0.1 + 0.3));
    out.brewery = merge(p);
  }
  { // PHARMA LAB: clean white lab block, glass atrium, filter stacks and a small tank farm.
    const p: G[] = [apron()];
    p.push(part(box(0.58, 0.24, 0.42), 0xf2f4f5, [-0.14, 0.012, -0.12]), part(box(0.6, 0.014, 0.44), 0x8a9aa5, [-0.14, 0.252, -0.12]));
    p.push(...windows(0.58, 0.42, 2, 0.07, 0.1, -0.14, -0.12, 0x4aa3c7));
    p.push(part(box(0.24, 0.2, 0.16), GL, [0.0, 0.012, 0.18]), part(box(0.26, 0.014, 0.18), 0xdfe5e8, [0.0, 0.212, 0.18]));
    p.push(part(box(0.2, 0.06, 0.012), 0x2aa876, [-0.14, 0.2, 0.1]));
    for (const [x, z] of [[0.32, -0.26], [0.32, -0.08]]) p.push(...tankAt(x, z, 0.06, 0.22, 0xe6e9eb));
    for (let k = 0; k < 3; k++) p.push(stack(0.2 + k * 0.08, -0.38, 0.28 - k * 0.04, 0xd7dbde));
    for (let k = 0; k < 3; k++) p.push(...hvac(-0.3 + k * 0.17, 0.27, -0.12));
    p.push(...tree(0.4, 0.38, 0.9), ...car(-0.3, 0.38, CARS[2]), ...car(-0.12, 0.38, CARS[1]));
    out.pharma = merge(p);
  }
  { // CLOTHING FACTORY: saw-tooth roofed hall, fabric rolls, rail of garments and a pink sign.
    const p: G[] = [apron()];
    p.push(part(box(0.8, 0.2, 0.5), 0xcfc9bd, [0, 0.012, -0.15]));
    for (let k = 0; k < 4; k++) {
      p.push(part(box(0.2, 0.002, 0.5), ROOFD, [-0.3 + k * 0.2, 0.25, -0.15], [0, 0, 0.35]));
      p.push(part(box(0.2, 0.06, 0.006), 0x9fd7ff, [-0.3 + k * 0.2 + 0.09, 0.24, -0.15 + 0.2]));
    }
    for (const x of [-0.32, -0.12, 0.08]) p.push(part(box(0.1, 0.09, 0.006), 0x8f969d, [x, 0.04, 0.105]));
    p.push(part(box(0.3, 0.07, 0.012), 0xd0589c, [0.3, 0.17, 0.105]));
    for (let k = 0; k < 5; k++) p.push(part(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 10).rotateZ(Math.PI / 2), [0xd0589c, 0x4f9ec9, 0xe0b040, 0x6fb06a, 0xb872c4][k], [-0.3 + k * 0.1, 0.04, 0.34]));
    p.push(...truck(0.35, 0.18, 0xf0e6f0));
    out.clothing = merge(p);
  }
  { // COLD STORE: windowless insulated box, refrigeration plant, reefer docks.
    const p: G[] = [apron()];
    p.push(part(box(0.88, 0.3, 0.56), 0xe6eef2, [0, 0.012, -0.12]), part(box(0.9, 0.02, 0.58), 0x7a8790, [0, 0.312, -0.12]));
    p.push(part(box(0.88, 0.02, 0.56), 0x4aa3c7, [0, 0.2, -0.12]));
    for (let k = 0; k < 5; k++) p.push(...dock(-0.34 + k * 0.17, 0.165));
    for (let k = 0; k < 4; k++) p.push(part(box(0.12, 0.06, 0.1), 0xb8bec4, [-0.3 + k * 0.2, 0.322, -0.2]), part(new THREE.CylinderGeometry(0.035, 0.035, 0.006, 10), 0x333a40, [-0.3 + k * 0.2, 0.386, -0.2]));
    p.push(...truck(-0.3, 0.32, 0xeef3f6), ...truck(0.1, 0.32, 0xeef3f6));
    p.push(part(box(0.3, 0.07, 0.012), 0x2f8fd0, [0.28, 0.27, 0.17]));
    out.coldstore = merge(p);
  }
  { // INDUSTRIAL PARK: three connected sheds, dock row, shared tank farm and a stack. A merged-estate model.
    const p: G[] = [apron()];
    for (const [x, w, c] of [[-0.3, 0.34, MET], [0.05, 0.34, 0xb5543c], [0.38, 0.22, MET]] as const) {
      p.push(part(box(w, 0.22, 0.44), c, [x, 0.012, -0.18]), part(box(w + 0.02, 0.016, 0.46), ROOFD, [x, 0.232, -0.18]));
      p.push(...dock(x - 0.06, -0.03), ...dock(x + 0.06, -0.03));
    }
    for (const [x, z] of [[-0.3, -0.42], [-0.1, -0.42]]) p.push(...tankAt(x, z, 0.06, 0.3));
    p.push(stack(0.3, -0.44, 0.7), part(cyl(0.03, 0.02, 10), 0xc23b2e, [0.3, 0.62, -0.44]));
    p.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6).rotateZ(Math.PI / 2), 0x3f8a5a, [0, 0.3, -0.42]));
    p.push(...truck(-0.25, 0.3), ...truck(0.15, 0.3, 0xe0b030), ...truck(0.4, 0.28));
    p.push(part(box(0.96, 0.012, 0.025), 0xf2c230, [0, 0.014, 0.12]));
    out.indpark = merge(p);
  }
  { // MEGA-FACTORY: huge assembly hall, gantry cranes, silos, rail spur and two stacks.
    const p: G[] = [apron()];
    p.push(part(box(0.88, 0.34, 0.56), MET, [0, 0.012, -0.12]), part(box(0.9, 0.02, 0.58), ROOFD, [0, 0.352, -0.12]));
    for (let k = 0; k < 7; k++) p.push(part(box(0.07, 0.16, 0.006), 0x9fd7ff, [-0.36 + k * 0.12, 0.2, 0.166]));
    for (let k = 0; k < 4; k++) p.push(...dock(-0.33 + k * 0.2, 0.162, 0.2));
    p.push(part(box(0.9, 0.03, 0.04), 0xf2c230, [0, 0.4, 0.0]), part(box(0.04, 0.34, 0.04), 0xf2c230, [-0.4, 0.012, 0.0]), part(box(0.04, 0.34, 0.04), 0xf2c230, [0.4, 0.012, 0.0]));
    for (const x of [-0.3, 0.0, 0.3]) p.push(...hvac(x, 0.372, -0.25));
    for (const x of [0.38, 0.26]) p.push(part(cyl(0.05, 0.55, 12), 0xd0d4d8, [x, 0.012, -0.42]), part(new THREE.SphereGeometry(0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), STEEL, [x, 0.562, -0.42]));
    p.push(stack(-0.38, -0.44, 0.85), stack(-0.26, -0.44, 0.7));
    p.push(part(box(0.96, 0.01, 0.03), 0x6d6a66, [0, 0.014, 0.4]), part(box(0.96, 0.01, 0.03), 0x6d6a66, [0, 0.014, 0.46]));
    for (let k = 0; k < 3; k++) p.push(part(box(0.22, 0.07, 0.07), [0x2f6fb0, 0xb14d2a, 0x3f8a5a][k], [-0.3 + k * 0.26, 0.05, 0.43])); // freight wagons
    p.push(part(box(0.34, 0.07, 0.012), 0xd23b2e, [-0.1, 0.3, 0.17]));
    out.megafactory = merge(p);
  }
  Object.assign(out, newFactoryModels());
  return out;
}
