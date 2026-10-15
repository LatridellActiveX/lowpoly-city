/**
 * render/buildings.ts — the catalogue of zoned building designs.
 *
 * VARIETY WITHOUT LOSING INSTANCING
 * ---------------------------------
 * Each zone has DESIGNS_PER_ZONE (5) designs, and each design is built
 * separately for levels 1, 2 and 3 (more floors, bigger footprint, extra
 * details), so a zone has 15 distinct models.
 *
 * Every model is split into three PARTS, each its own InstancedMesh:
 *   walls  – geometry is white, so the instance colour IS the wall colour
 *   accent – roofs, awnings, tanks: white geometry, tinted by an accent colour
 *   fixed  – windows, doors, chimneys, signs: already coloured, tinted white
 * So one house design can be cream with a red roof on one tile and sage with
 * a slate roof on the next, while all copies still draw in three calls.
 *
 * PICKING A DESIGN DETERMINISTICALLY
 * ----------------------------------
 * `pickLook(x, z, seed)` hashes the tile coordinates (random.ts) to choose
 * the design, wall colour and accent colour. Same tile => same look after
 * every reload. If the tile to the west would get the same design, we bump
 * ours to the next one, so rows of houses don't repeat.
 *
 * Model space: centred on the tile, base at y=0, FRONT faces +z (the renderer
 * rotates the model so the front faces the road).
 */
import * as THREE from 'three';
import { hash2 } from '../sim/random';
import { ZoneType } from '../sim/types';
import { box, gable, merge, part, pyramid } from './models';

/**
 * Gambrel roof: like gable() but the outline bends — steep near the eaves,
 * shallow near the ridge. Drawn as a 5-point shape in the (depth, height)
 * plane and extruded along x.
 */
function gambrel(w: number, h: number, d: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0);
  s.lineTo(d / 2, 0);
  s.lineTo(d * 0.3, h * 0.65); // the "knee" where the slope changes
  s.lineTo(0, h);
  s.lineTo(-d * 0.3, h * 0.65);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

/**
 * Half-cylinder lying along x with its flat side on the ground.
 * CylinderGeometry with theta −90°..+90° gives the half where z ≥ 0; rotating
 * about z turns its axis to x, then rotating about x by −90° swings that half
 * up so it sits above y = 0.
 */
function quonset(r: number, length: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, length, 12, 1, false, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
}

export const DESIGNS_PER_ZONE = 5;
/**
 * PR 6 variety pass: homes get 8 designs (3 new low-density roofs:
 * saltbox, brick hip with bay window, stucco flat-roof with parapet), a 4th
 * medium variant (mansard with balconies) and a new level 6 = stepped /
 * set-back TOWERS for high density. Shops and factories keep 5.
 */
export const RES_DESIGNS = 8;
const W = 0xffffff; // white = "tint me with the instance colour"
const GLASS = 0x3e5f7a;
const DARK = 0x4a4a4a;
const WOOD = 0x7a5232;

export interface DesignParts {
  walls: THREE.BufferGeometry;
  accent: THREE.BufferGeometry;
  fixed: THREE.BufferGeometry;
  /**
   * Night-time window glow (PR 3): a copy of every window/glass part, drawn
   * with an additive glowing material on top of the glass. Its opacity is 0
   * by day and fades up at night (cityRenderer.setNight).
   */
  lights: THREE.BufferGeometry;
}

/** Colours that count as "a window" and get a night-time glow copy. */
const LIT = new Set([0x3e5f7a, 0x9fd7ff, 0xbfe6ff, 0xffd98a]);

/** Collects parts into the three buckets, then merges each bucket. */
class Builder {
  /**
   * PR 5: `hi` = build the HIGH-detail version (window frames, sills,
   * gutters, steps, vents...). The LOW version is exactly the PR 4 model and
   * is used when zoomed far out or when Settings → Detail is Low.
   */
  constructor(readonly hi = true) {}
  walls: THREE.BufferGeometry[] = [];
  accent: THREE.BufferGeometry[] = [];
  fixed: THREE.BufferGeometry[] = [];
  lights: THREE.BufferGeometry[] = [];
  wall(g: THREE.BufferGeometry, pos: [number, number, number] = [0, 0, 0], rot?: [number, number, number]) {
    this.walls.push(part(g, W, pos, rot));
  }
  acc(g: THREE.BufferGeometry, pos: [number, number, number] = [0, 0, 0], rot?: [number, number, number]) {
    this.accent.push(part(g, W, pos, rot));
  }
  fix(g: THREE.BufferGeometry, color: number, pos: [number, number, number] = [0, 0, 0], rot?: [number, number, number]) {
    // Clone BEFORE part(), because part() moves the geometry in place.
    if (LIT.has(color)) this.lights.push(part(g.clone(), W, pos, rot));
    this.fixed.push(part(g, color, pos, rot));
  }
  /** A row of `n` small windows on the front (+z) face at height y. */
  windows(n: number, width: number, depth: number, y: number, color = GLASS, size = 0.09) {
    for (let k = 0; k < n; k++) {
      const x = -width / 2 + (width * (k + 0.5)) / n;
      this.fix(box(size, size * 1.1, 0.02), color, [x, y, depth / 2 + 0.005]);
      if (this.hi) this.frame(x, y, depth / 2 + 0.005, size, size * 1.1, 'z');
    }
  }
  /**
   * PR 5: a window frame — sill (sticks out a little), lintel on top, two
   * side jambs and a vertical mullion splitting the glass. `face` is the
   * axis the window looks along ('z' = front, 'x' = right side).
   */
  frame(cx: number, y: number, c: number, ww: number, wh: number, face: 'z' | 'x') {
    const T = 0xf4f1ea; // white trim
    const at = (a: number, yy: number, out: number): [number, number, number] => (face === 'z' ? [cx + a, yy, c + out] : [c + out, yy, cx + a]);
    const bx = (a: number, b2: number, d2: number) => (face === 'z' ? box(a, b2, d2) : box(d2, b2, a));
    this.fix(bx(ww + 0.03, 0.012, 0.035), T, at(0, y - 0.012, 0.01)); // sill
    this.fix(bx(ww + 0.02, 0.012, 0.022), T, at(0, y + wh, 0.004)); // lintel
    this.fix(bx(0.01, wh, 0.022), T, at(-ww / 2 - 0.005, y, 0.004)); // jambs
    this.fix(bx(0.01, wh, 0.022), T, at(ww / 2 + 0.005, y, 0.004));
    this.fix(bx(0.006, wh, 0.024), T, at(0, y, 0.004)); // mullion
  }
  /** Windows on the right (+x) face too, so corners don't look blank. */
  sideWindows(n: number, width: number, depth: number, y: number, color = GLASS) {
    for (let k = 0; k < n; k++) {
      const z = -depth / 2 + (depth * (k + 0.5)) / n;
      this.fix(box(0.02, 0.1, 0.09), color, [width / 2 + 0.005, y, z]);
      if (this.hi) this.frame(z, y, width / 2 + 0.005, 0.09, 0.1, 'x');
    }
  }
  done(): DesignParts {
    // An empty bucket still needs a geometry; use a degenerate tiny box.
    const safe = (a: THREE.BufferGeometry[]) => merge(a.length ? a : [part(box(0.001, 0.001, 0.001), W, [0, -1, 0])]);
    return { walls: safe(this.walls), accent: safe(this.accent), fixed: safe(this.fixed), lights: safe(this.lights) };
  }
}

const FLOOR = 0.26; // height of one storey

// ----------------------------------------------------------------------------
// Residential: cottages to small apartment blocks
// ----------------------------------------------------------------------------
function residential(k: number, level: number, hi = true): DesignParts {
  if (level === 6) return tower(k % 4, hi); // PR 6 high density
  if (level === 7) return midrise(k % 4, hi); // V1.5b stage A: medium L6–L7 apartment look
  if (level >= 4) return medium(k % 4, level, hi); // PR 5 medium density (PR 6: 4 variants)
  const b = new Builder(hi);
  const floors = level;
  const h = FLOOR * floors + 0.06;
  const w = 0.46 + level * 0.08;
  const d = 0.4 + level * 0.07;
  switch (k) {
    case 0: // Gable cottage / townhouse with chimney
      b.wall(box(w, h, d));
      b.acc(gable(w + 0.06, 0.24, d + 0.08), [0, h, 0]);
      b.fix(box(0.07, 0.18, 0.07), 0x8c7f76, [w / 3, h, -d / 5]);
      b.fix(box(0.1, 0.17, 0.02), WOOD, [-w / 4, 0, d / 2 + 0.005]);
      for (let f = 0; f < floors; f++) b.windows(f === 0 ? 1 : 2, f === 0 ? w / 2 : w, d, 0.1 + f * FLOOR, GLASS);
      if (f0(level)) b.fix(box(w + 0.1, 0.06, 0.02), 0xf4f1ea, [0, 0, d / 2 + 0.14]); // little front fence
      break;
    case 1: // Hip roof with a front porch
      b.wall(box(w, h, d), [0, 0, -0.04]);
      b.acc(pyramid(w + 0.08, 0.22 + level * 0.03), [0, h, -0.04]);
      b.fix(box(w * 0.8, 0.03, 0.14), 0xcfc4b0, [0, 0, d / 2 + 0.03]); // porch deck
      b.fix(box(0.025, 0.2, 0.025), W, [-w * 0.37, 0.03, d / 2 + 0.09]);
      b.fix(box(0.025, 0.2, 0.025), W, [w * 0.37, 0.03, d / 2 + 0.09]);
      b.acc(box(w * 0.85, 0.03, 0.17), [0, 0.23, d / 2 + 0.03]); // porch roof
      for (let f = 0; f < floors; f++) b.windows(2, w, d - 0.08, 0.1 + f * FLOOR);
      b.sideWindows(Math.min(floors, 2), w, d, 0.12);
      break;
    case 2: // Modern flat-roof box with an offset upper volume
      b.wall(box(w, FLOOR + 0.04, d));
      if (floors > 1) b.wall(box(w * 0.7, h - FLOOR - 0.04, d * 0.85), [w * 0.12, FLOOR + 0.04, -d * 0.05]);
      b.acc(box(w + 0.04, 0.03, d + 0.04), [0, FLOOR + 0.04, 0]); // cantilevered slab
      if (floors > 1) b.acc(box(w * 0.74, 0.03, d * 0.9), [w * 0.12, h, -d * 0.05]);
      b.fix(box(w * 0.75, 0.12, 0.02), GLASS, [0, 0.07, d / 2 + 0.005]); // glass band
      for (let f = 1; f < floors; f++) b.fix(box(w * 0.55, 0.1, 0.02), GLASS, [w * 0.12, 0.1 + f * FLOOR, d * 0.375 + 0.005]);
      if (level === 3) for (let f = 1; f < floors; f++) b.fix(box(w * 0.6, 0.02, 0.08), 0xd8dde2, [w * 0.12, f * FLOOR + 0.04, d * 0.42]); // balconies
      b.fix(box(0.6, 0.05, 0.02), 0x6f8a5a, [0, 0, d / 2 + 0.15]); // hedge
      break;
    case 3: {
      // Gambrel "barn" house (PR 3 redesign: the old saltbox looked too much
      // like the gable cottage). A gambrel roof has steep lower slopes and a
      // shallow top, giving the roof a distinctive "bent" outline.
      const roofH = 0.2 + level * 0.04;
      b.wall(box(w, h, d));
      b.acc(gambrel(w + 0.05, roofH, d + 0.08), [0, h, 0]);
      // Round attic window in the gable end and white corner trim.
      b.fix(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 10).rotateZ(Math.PI / 2), 0xf4f1ea, [w / 2 + 0.03, h + roofH * 0.45, 0]);
      b.fix(new THREE.CylinderGeometry(0.03, 0.03, 0.022, 10).rotateZ(Math.PI / 2), GLASS, [w / 2 + 0.032, h + roofH * 0.45, 0]);
      b.fix(box(0.02, h, 0.02), 0xf4f1ea, [-w / 2, 0, d / 2]);
      b.fix(box(0.02, h, 0.02), 0xf4f1ea, [w / 2, 0, d / 2]);
      // Barn-style double door with an X brace, plus windows.
      b.fix(box(0.16, 0.18, 0.02), 0x8c3b2e, [0, 0, d / 2 + 0.005]);
      b.fix(box(0.2, 0.012, 0.022), 0xf4f1ea, [0, 0.09, d / 2 + 0.008], [0, 0, 0.8]);
      b.fix(box(0.2, 0.012, 0.022), 0xf4f1ea, [0, 0.09, d / 2 + 0.008], [0, 0, -0.8]);
      for (let f = 1; f < floors; f++) b.windows(2, w, d, 0.1 + f * FLOOR);
      b.fix(box(0.1, 0.03, 0.08), 0xcfc4b0, [0, 0, d / 2 + 0.05]); // stoop
      break;
    }
    case 5: {
      // PR 6 SALTBOX: long rear roof slope (ridge pushed toward the front),
      // clapboard trim bands and a big brick chimney on the gable end.
      b.wall(box(w, h, d));
      b.acc(gable(w + 0.05, 0.26 + level * 0.03, d + 0.08, 0.3), [0, h, 0]);
      b.fix(box(0.09, h + 0.3, 0.09), 0x9a4f3a, [-w / 2 - 0.03, 0, -d * 0.1]);
      for (let f = 0; f < floors; f++) b.fix(box(w + 0.004, 0.012, d + 0.004), TRIM, [0, (f + 1) * FLOOR - 0.02, 0]);
      b.fix(box(0.1, 0.17, 0.02), 0x2e4a62, [w * 0.2, 0, d / 2 + 0.005]);
      for (let f = 0; f < floors; f++) b.windows(2, w, d, 0.1 + f * FLOOR);
      break;
    }
    case 6: {
      // PR 6 BRICK HIP with a front BAY WINDOW and a small porch hood.
      b.fix(box(w, h, d), 0xa9573f, [0, 0, 0]);
      b.acc(pyramid(w + 0.08, 0.2 + level * 0.03), [0, h, 0]);
      b.wall(box(w * 0.4, FLOOR - 0.02, 0.07), [-w * 0.18, 0.02, d / 2 + 0.035]); // bay
      b.fix(box(w * 0.34, 0.1, 0.02), GLASS, [-w * 0.18, 0.08, d / 2 + 0.072]);
      b.acc(box(w * 0.44, 0.03, 0.09), [-w * 0.18, FLOOR, d / 2 + 0.035]);
      b.fix(box(0.09, 0.16, 0.02), 0x3f5f3f, [w * 0.22, 0, d / 2 + 0.005]);
      b.acc(box(0.16, 0.02, 0.08), [w * 0.22, 0.2, d / 2 + 0.04]); // porch hood
      for (let f = 1; f < floors; f++) b.windows(2, w, d, 0.1 + f * FLOOR);
      break;
    }
    case 7: {
      // PR 6 STUCCO FLAT ROOF with a parapet, roof terrace and a pergola.
      b.wall(box(w, h, d));
      b.acc(box(w + 0.02, 0.05, 0.02), [0, h, d / 2]);
      b.acc(box(w + 0.02, 0.05, 0.02), [0, h, -d / 2]);
      b.acc(box(0.02, 0.05, d), [w / 2, h, 0]);
      b.acc(box(0.02, 0.05, d), [-w / 2, h, 0]);
      for (const px of [-0.12, 0.12]) b.fix(box(0.015, 0.12, 0.015), WOOD, [w / 2 + 0.06, 0, d / 2 - 0.02 + px * 0]); // pergola posts
      b.fix(box(0.12, 0.012, 0.16), WOOD, [w / 2 + 0.06, 0.12, d / 2 - 0.06]);
      b.fix(box(w * 0.5, 0.12, 0.02), GLASS, [0, 0.07, d / 2 + 0.005]);
      for (let f = 1; f < floors; f++) b.windows(2, w, d, 0.1 + f * FLOOR);
      break;
    }
    default: // Steep A-frame with a dormer
      b.wall(box(w * 0.9, FLOOR * Math.max(1, floors - 1) + 0.04, d));
      b.acc(gable(w * 0.9 + 0.06, 0.32 + level * 0.06, d + 0.1), [0, FLOOR * Math.max(1, floors - 1) + 0.04, 0]);
      b.wall(box(0.14, 0.1, 0.12), [0, FLOOR * Math.max(1, floors - 1) + 0.08, d / 2 - 0.04]); // dormer
      b.acc(gable(0.18, 0.07, 0.15), [0, FLOOR * Math.max(1, floors - 1) + 0.18, d / 2 - 0.04]);
      b.fix(box(0.08, 0.06, 0.02), GLASS, [0, FLOOR * Math.max(1, floors - 1) + 0.1, d / 2 + 0.025]);
      b.fix(box(0.1, 0.17, 0.02), 0x6b3b2a, [0, 0, d / 2 + 0.005]);
      b.windows(2, w * 0.9, d, 0.1);
      b.fix(new THREE.CylinderGeometry(0.06, 0.08, 0.12, 6).translate(0, 0.06, 0), 0x6f8a5a, [w / 2 + 0.05, 0, d / 2]); // shrub
      break;
  }
  if (hi) { resDetails(b, k, level, w, h, d, floors); resExtras(b, k, level, w, h, d, floors); }
  // V1.5b: back / side detail. A-frame (default) and the modern box (2) have
  // narrower or offset upper walls, so only their ground floor is dressed.
  const lowWall = k === 4 || (k === 2 && floors > 1);
  allSides(b, { w: k === 4 ? w * 0.9 : w, d, h: lowWall ? FLOOR + 0.04 : h, floors: lowWall ? 1 : floors, zoff: k === 1 ? -0.04 : 0, cols: 2, vent: !lowWall });
  return b.done();
}
const f0 = (level: number) => level === 1;

// ----------------------------------------------------------------------------
// Commercial: corner shops to office blocks
// ----------------------------------------------------------------------------
function commercial(k: number, level: number, hi = true): DesignParts {
  const b = new Builder(hi);
  const floors = level === 3 ? 4 : level;
  const h = FLOOR * floors + 0.1;
  const w = 0.56 + level * 0.08;
  const d = 0.5 + level * 0.06;
  const rooftopUnit = (x: number, z: number) => {
    b.fix(box(0.12, 0.07, 0.1), 0xb9c0c7, [x, h + 0.03, z]);
    b.fix(new THREE.CylinderGeometry(0.035, 0.035, 0.015, 8).translate(0, 0.075, 0), DARK, [x, h + 0.03, z]);
  };
  switch (k) {
    case 0: // Corner shop: parapet, slanted awning, sign
      b.wall(box(w, h, d));
      b.acc(box(w + 0.03, 0.04, d + 0.03), [0, h - 0.01, 0]);
      b.acc(box(w * 0.9, 0.03, 0.15), [0, 0.24, d / 2 + 0.06], [0.45, 0, 0]);
      b.fix(box(w * 0.75, 0.14, 0.02), 0x9fd7ff, [0, 0.05, d / 2 + 0.005]);
      b.fix(box(w * 0.5, 0.08, 0.025), 0xffd166, [0, h - 0.1, d / 2 + 0.01]);
      for (let f = 1; f < floors; f++) b.windows(3, w, d, 0.1 + f * FLOOR);
      rooftopUnit(-w / 4, -d / 6);
      break;
    case 1: // Diner: long low box, striped band, pole sign
      b.wall(box(w, Math.max(0.3, h * 0.8), d * 0.85));
      b.acc(box(w + 0.02, 0.05, d * 0.85 + 0.02), [0, 0.2, 0]);
      b.fix(box(w * 0.85, 0.1, 0.02), 0xbfe6ff, [0, 0.06, d * 0.425 + 0.005]);
      b.fix(box(0.03, 0.5 + level * 0.1, 0.03), DARK, [w / 2 + 0.02, 0, d / 2]);
      b.acc(box(0.2, 0.12, 0.04), [w / 2 + 0.02, 0.5 + level * 0.1, d / 2]);
      for (let f = 1; f < floors; f++) b.windows(3, w, d * 0.85, 0.1 + f * FLOOR);
      rooftopUnit(w / 5, 0);
      break;
    case 2: // Office block with glass bands on every floor
      b.wall(box(w * 0.9, h + FLOOR * (level - 1) * 0.5, d * 0.9));
      for (let f = 0; f < floors + Math.floor((level - 1) * 0.5); f++) {
        b.fix(box(w * 0.92, 0.09, d * 0.92), GLASS, [0, 0.1 + f * FLOOR, 0]);
      }
      b.acc(box(w * 0.94, 0.04, d * 0.94), [0, 0, 0]);
      rooftopUnit(w / 5, -d / 6);
      rooftopUnit(-w / 5, d / 8);
      break;
    case 3: {
      // Convenience store with a fuel canopy (PR 3 redesign: the old market
      // hall's gable + awning read too close to the corner shop). The shop
      // sits at the back of the lot and a flat canopy on posts covers pumps.
      const shopD = d * 0.5;
      b.wall(box(w, Math.min(h, 0.34), shopD), [0, 0, -d * 0.25]);
      b.acc(box(w + 0.02, 0.04, shopD + 0.02), [0, Math.min(h, 0.34), -d * 0.25]);
      b.fix(box(w * 0.7, 0.13, 0.02), 0x9fd7ff, [0, 0.05, -d * 0.25 + shopD / 2 + 0.005]);
      const canopyY = 0.3 + level * 0.03;
      for (const [px, pz] of [[-w * 0.35, d * 0.1], [w * 0.35, d * 0.1], [-w * 0.35, d * 0.42], [w * 0.35, d * 0.42]]) {
        b.fix(box(0.025, canopyY, 0.025), 0xd8dde2, [px, 0, pz]);
      }
      b.acc(box(w * 0.85, 0.05, d * 0.45), [0, canopyY, d * 0.26]); // canopy fascia (accent colour)
      b.fix(box(w * 0.83, 0.01, d * 0.43), 0xf4f6f8, [0, canopyY - 0.005, d * 0.26]); // light underside
      for (let p = 0; p < level; p++) {
        const px = -w * 0.2 + (p * w * 0.4) / Math.max(1, level - 1);
        b.fix(box(0.05, 0.1, 0.04), 0xe5e8eb, [level === 1 ? 0 : px, 0, d * 0.26]); // fuel pump
        b.fix(box(0.035, 0.03, 0.042), 0xff6b6b, [level === 1 ? 0 : px, 0.07, d * 0.26]);
      }
      b.fix(box(0.03, 0.55, 0.03), DARK, [w / 2, 0, d / 2]); // price sign pole
      b.acc(box(0.14, 0.16, 0.03), [w / 2, 0.55, d / 2]);
      if (floors > 1) b.windows(3, w, shopD, 0.36);
      break;
    }
    default: // Stepped tower with antenna
      b.wall(box(w, h * 0.6, d));
      b.wall(box(w * 0.65, h * 0.6, d * 0.65), [0, h * 0.6, 0]);
      b.acc(box(w + 0.02, 0.03, d + 0.02), [0, h * 0.6, 0]);
      b.acc(box(w * 0.68, 0.03, d * 0.68), [0, h * 1.2, 0]);
      for (let f = 0; f < Math.max(1, Math.floor((h * 0.6) / FLOOR)); f++) b.windows(4, w, d, 0.1 + f * FLOOR);
      b.sideWindows(3, w, d, 0.12);
      b.fix(box(0.015, 0.25, 0.015), DARK, [0, h * 1.2, 0]);
      b.fix(box(w * 0.4, 0.07, 0.02), 0xff6b6b, [0, h * 0.6 - 0.1, d / 2 + 0.01]);
      break;
  }
  if (hi) comDetails(b, k, level, w, h, d, floors);
  return b.done();
}

// ----------------------------------------------------------------------------
// Industrial: workshops to heavy plants
// ----------------------------------------------------------------------------
function industrial(k: number, level: number, hi = true): DesignParts {
  const b = new Builder(hi);
  const h = 0.22 + level * 0.12;
  const w = 0.6 + level * 0.08;
  const d = 0.48 + level * 0.07;
  const stack = (x: number, z: number, height: number, stripes = true) => {
    b.fix(new THREE.CylinderGeometry(0.04, 0.055, height, 8).translate(0, height / 2, 0), 0x8d8f91, [x, 0, z]);
    if (stripes) b.acc(new THREE.CylinderGeometry(0.043, 0.043, 0.05, 8).translate(0, height - 0.08, 0), [x, 0, z]);
  };
  switch (k) {
    case 0: // Saw-tooth roof warehouse + smokestack
      b.wall(box(w, h, d));
      for (let s = 0; s < 2 + (level > 1 ? 1 : 0); s++) {
        const z = -d / 2 + (d * (s + 0.5)) / (2 + (level > 1 ? 1 : 0));
        b.acc(gable(w, 0.12, d / (2 + (level > 1 ? 1 : 0)), 0.15), [0, h, z]);
      }
      stack(w / 2 - 0.08, -d / 2 + 0.06, h + 0.3 + level * 0.12);
      b.fix(box(0.2, 0.18, 0.02), 0x6c6f73, [-w / 5, 0, d / 2 + 0.005]);
      break;
    case 1: // Tank farm: shed + storage tanks + pipe
      b.wall(box(w * 0.55, h, d), [-w * 0.22, 0, 0]);
      b.acc(box(w * 0.57, 0.03, d + 0.02), [-w * 0.22, h, 0]);
      for (let t = 0; t < (level === 1 ? 1 : 2); t++) {
        const z = level === 1 ? 0 : t === 0 ? -d * 0.22 : d * 0.24;
        b.acc(new THREE.CylinderGeometry(0.13, 0.13, 0.2 + level * 0.08, 10).translate(0, 0.1 + level * 0.04, 0), [w * 0.27, 0, z]);
        b.fix(new THREE.CylinderGeometry(0.13, 0.13, 0.015, 10).translate(0, 0.21 + level * 0.08, 0), 0x8d8f91, [w * 0.27, 0, z]);
      }
      b.fix(new THREE.CylinderGeometry(0.02, 0.02, w * 0.4, 6).rotateZ(Math.PI / 2), 0x9a9a9a, [w * 0.05, h * 0.6, 0]);
      b.fix(box(0.14, 0.15, 0.02), 0x6c6f73, [-w * 0.22, 0, d / 2 + 0.005]);
      break;
    case 2: {
      // Quonset hut: a corrugated half-cylinder shed (PR 3 redesign: the old
      // gable warehouse looked like the saw-tooth one). See quonset() below.
      // The hut's axis runs front-to-back (z) so its round END faces the road.
      const r = Math.min(w * 0.36, 0.18 + level * 0.05);
      const len = d * 0.8;
      const cz = -d * 0.06;
      const alongZ: [number, number, number] = [0, Math.PI / 2, 0];
      b.acc(quonset(r, len), [0, 0, cz], alongZ);
      // Ribs every so often, slightly darker so the curve reads.
      for (let k2 = 0; k2 < 4 + level; k2++) {
        const z = cz - len / 2 + (len * (k2 + 0.5)) / (4 + level);
        b.fix(quonset(r + 0.006, 0.012), 0x8d9196, [0, 0, z], alongZ);
      }
      // Front end wall: big roller door + a small lit window above it.
      b.fix(box(r * 1.1, r * 0.85, 0.02), 0x6c6f73, [0, 0, cz + len / 2 + 0.006]);
      b.fix(box(0.08, 0.04, 0.022), 0xffd98a, [0, r * 0.88, cz + len / 2 + 0.007]);
      // Shipping containers stacked beside the hut.
      for (let c = 0; c < level; c++) b.fix(box(0.09, 0.08, 0.16), [0x4f7da8, 0xb5543c, 0x3d8f8a][c], [w * 0.42, 0.08 * c, d * 0.15]);
      b.fix(box(0.02, 0.08, 0.85), 0xb0b4b8, [-0.44, 0, 0]);
      break;
    }
    case 3: // Heavy plant: tall striped stacks + silo
      b.wall(box(w * 0.7, h * 1.15, d), [-w * 0.12, 0, 0]);
      b.acc(box(w * 0.72, 0.04, d + 0.02), [-w * 0.12, h * 1.15, 0]);
      b.acc(new THREE.CylinderGeometry(0.1, 0.1, h * 1.5, 10).translate(0, h * 0.75, 0), [w * 0.33, 0, d * 0.2]);
      b.fix(new THREE.ConeGeometry(0.1, 0.08, 10).translate(0, h * 1.5 + 0.04, 0), 0x8d8f91, [w * 0.33, 0, d * 0.2]);
      stack(-w * 0.3, -d * 0.25, h + 0.45 + level * 0.12);
      if (level > 1) stack(-w * 0.05, -d * 0.25, h + 0.35 + level * 0.1);
      b.sideWindows(2, w * 0.46, d, h * 0.7, 0xffd98a);
      break;
    default: // Workshop with shed roof, rooftop units and crates
      b.wall(box(w * 0.85, h, d * 0.85));
      b.acc(gable(w * 0.85 + 0.04, 0.1, d * 0.85 + 0.04, 0.05), [0, h, 0]);
      b.fix(box(0.11, 0.06, 0.09), 0xb9c0c7, [w * 0.15, h + 0.06, d * 0.1]);
      b.fix(box(0.24, 0.17, 0.02), 0x6c6f73, [0, 0, d * 0.425 + 0.005]);
      for (let c = 0; c < level + 1; c++) b.fix(box(0.08, 0.08, 0.08), 0xa77b4a, [w / 2 - 0.02, 0.08 * Math.floor(c / 2), d / 2 - 0.05 - (c % 2) * 0.1]);
      b.windows(2, w * 0.85, d * 0.85, h * 0.6, 0xffd98a);
      break;
  }
  // V1.5b stage B: levels 4–5 add an annex wing and (L5) a second plant block.
  if (level >= 4) {
    b.wall(box(w * 0.32, h * 0.7, d * 0.4), [-w / 2 - w * 0.12, 0, d * 0.18]);
    b.acc(box(w * 0.34, 0.03, d * 0.42), [-w / 2 - w * 0.12, h * 0.7, d * 0.18]);
    b.fix(new THREE.CylinderGeometry(0.07, 0.07, h * 1.2, 10).translate(0, h * 0.6, 0), 0x8f989f, [w / 2 + 0.06, 0, d * 0.3]);
  }
  if (level >= 5) {
    b.wall(box(w * 0.4, h * 1.3, d * 0.35), [w * 0.15, 0, -d / 2 - d * 0.12]);
    b.fix(new THREE.CylinderGeometry(0.035, 0.05, h + 0.7, 8).translate(0, (h + 0.7) / 2, 0), 0xb9b2a6, [w * 0.32, 0, -d / 2 - d * 0.2]);
    b.fix(new THREE.CylinderGeometry(0.052, 0.052, 0.05, 8).translate(0, h + 0.6, 0), 0xc23b2e, [w * 0.32, 0, -d / 2 - d * 0.2]);
  }
  if (hi) indDetails(b, k, level, w, h, d);
  if (hi) indRevamp(b, k, level, w, h, d);
  return b.done();
}

// ----------------------------------------------------------------------------
// PR 5 medium-density residential: level 4 rowhouses, level 5 apartments.
// Three variants each (design k uses variant k % 3). They fill most of the
// lot (~0.9 wide), front faces +z like every other design.
// ----------------------------------------------------------------------------
/**
 * V1.5b stage A — MID-RISE APARTMENTS (model level 7).
 *
 * Medium-density homes that reach template levels 3–4 (city levels L6–L7)
 * switch from the rowhouse / 5-storey look to a proper 6-storey apartment (L7 stretches it ~20% taller)
 * building instead of just being stretched taller. Four variants:
 *   0  balcony slab with a lobby canopy and rooftop water tank
 *   1  brick "mansion block" with corner bay columns and cornices
 *   2  modern block: glass stair core, set-back penthouse floor
 *   3  L-shaped wing block with a stepped rear wing
 * Unit box is ≈ 0.88 × 0.68 × 1.76 (see roofBox in cityRenderer.ts).
 */
function midrise(v: number, hi: boolean): DesignParts {
  const b = new Builder(hi);
  const BRICK = 0xa95a43;
  const floors = 6, w = 0.88, d = 0.68, h = FLOOR * floors + 0.2;
  // Ground floor: lobby glazing + entrance canopy (shared by every variant).
  const lobby = () => {
    b.fix(box(w * 0.5, 0.16, 0.02), 0x9fd7ff, [0, 0.04, d / 2 + 0.006]);
    b.acc(box(0.3, 0.025, 0.14), [0, 0.22, d / 2 + 0.07]);
  };
  if (v === 0) {
    b.wall(box(w, h, d));
    b.acc(box(w + 0.03, 0.04, d + 0.03), [0, h, 0]);
    for (let f = 1; f < floors; f++) b.windows(4, w, d, 0.1 + f * FLOOR, GLASS, 0.085);
    b.sideWindows(3, w, d, 0.12);
    if (hi) for (let f = 1; f < floors; f++) for (const dx of [-0.3, 0, 0.3]) balcony(b, dx, f * FLOOR + 0.02, d / 2, 0.16);
    // Rooftop water tank on legs.
    b.fix(cyl(0.07, 0.12, 10), WOOD, [w * 0.25, h + 0.08, -d * 0.15]);
    for (const lx of [-0.04, 0.04]) b.fix(box(0.012, 0.08, 0.012), DARK, [w * 0.25 + lx, h, -d * 0.15]);
  } else if (v === 1) {
    b.fix(box(w, h, d), BRICK, [0, 0, 0]);
    for (const sx of [-1, 1]) b.wall(box(0.16, h + 0.06, 0.08), [sx * (w / 2 - 0.08), 0, d / 2 + 0.03]); // corner bays
    for (let f = 2; f < floors; f += 3) b.acc(box(w + 0.02, 0.025, d + 0.02), [0, f * FLOOR, 0]); // string courses
    b.acc(box(w + 0.05, 0.05, d + 0.05), [0, h, 0]); // cornice
    for (let f = 1; f < floors; f++) b.windows(3, w * 0.6, d, 0.1 + f * FLOOR, GLASS, 0.08);
    b.sideWindows(3, w, d, 0.12);
    if (hi) for (let f = 1; f < floors; f++) for (const sx of [-1, 1]) b.fix(box(0.1, 0.1, 0.02), GLASS, [sx * (w / 2 - 0.08), 0.1 + f * FLOOR, d / 2 + 0.072]);
  } else if (v === 2) {
    b.wall(box(w, h - FLOOR, d));
    b.wall(box(w * 0.6, FLOOR, d * 0.7), [-w * 0.1, h - FLOOR, -d * 0.1]); // penthouse
    b.acc(box(w * 0.66, 0.03, d * 0.76), [-w * 0.1, h, -d * 0.1]);
    b.wall(box(0.18, h + 0.1, 0.12), [w * 0.3, 0, d / 2 - 0.02]); // glass stair core
    b.fix(box(0.12, h, 0.02), 0x9fd7ff, [w * 0.3, 0.04, d / 2 + 0.042]);
    for (let f = 1; f < floors - 1; f++) b.fix(box(w * 0.55, 0.11, 0.02), GLASS, [-w * 0.12, 0.09 + f * FLOOR, d / 2 + 0.005]); // ribbon windows
    if (hi) for (let f = 1; f < floors - 1; f++) balcony(b, -w * 0.12, f * FLOOR + 0.02, d / 2, 0.4);
    if (hi) b.fix(box(w * 0.3, 0.012, d * 0.3), 0x6f8a5a, [w * 0.2, h - FLOOR, -d * 0.2]); // roof garden
  } else {
    b.wall(box(w, h, d * 0.5), [0, 0, d * 0.25]); // front wing
    b.wall(box(w * 0.45, h - FLOOR * 2, d * 0.5), [-w * 0.275, 0, -d * 0.25]); // stepped rear wing
    b.acc(box(w + 0.03, 0.04, d * 0.5 + 0.03), [0, h, d * 0.25]);
    b.acc(box(w * 0.45 + 0.03, 0.04, d * 0.5 + 0.03), [-w * 0.275, h - FLOOR * 2, -d * 0.25]);
    for (let f = 1; f < floors; f++) b.windows(4, w, d, 0.1 + f * FLOOR, GLASS, 0.085);
    if (hi) for (let f = 1; f < floors; f++) balcony(b, w * 0.3, f * FLOOR + 0.02, d / 2, 0.18);
  }
  lobby();
  // V1.5b: backs + sides (variant 2's top floor is a set-back penthouse,
  // variant 3's rear wing is lower — dress the full-height part).
  allSides(b, { w, d: v === 3 ? d * 0.5 : d, zoff: v === 3 ? d * 0.25 : 0, h: v === 2 ? h - FLOOR : v === 3 ? h - FLOOR * 2 : h, floors: v === 2 ? floors - 1 : v === 3 ? floors - 2 : floors, cols: 4, apt: true, right: v !== 0 });
  if (hi) {
    acUnit(b, -w * 0.3, h, -d * 0.2, 1.2);
    acUnit(b, -w * 0.15, h, -d * 0.2, 1.2);
    shrub(b, -w * 0.35, d / 2 + 0.08, 0.04);
    shrub(b, w * 0.35, d / 2 + 0.08, 0.04);
    b.fix(box(w + 0.04, 0.035, d + 0.04), STONE, [0, 0, 0]);
  }
  return b.done();
}

function medium(v: number, level: number, hi: boolean): DesignParts {
  const b = new Builder(hi);
  const BRICK = 0xb5654a;
  if (level === 4) {
    // ROWHOUSES / TOWNHOUSES: three attached units, 3 storeys.
    const units = 3, uw = 0.29, d = 0.56, hBase = FLOOR * 3 + 0.04;
    for (let u = 0; u < units; u++) {
      const x = -uw + u * uw;
      // Variant 0: gabled units with alternating heights; 1: flat-roof brick
      // with bay windows; 2: mansard roofs with dormers.
      const h = v === 0 ? hBase + (u % 2) * 0.05 : hBase;
      if (v === 1) b.fix(box(uw - 0.004, h, d), BRICK, [x, 0, 0]);
      else b.wall(box(uw - 0.004, h, d), [x, 0, 0]);
      if (v === 0) b.acc(gable(uw + 0.01, 0.16, d + 0.06), [x, h, 0], [0, Math.PI / 2, 0]);
      else if (v === 1) {
        b.acc(box(uw + 0.004, 0.04, d + 0.02), [x, h, 0]); // cornice
        b.wall(box(uw * 0.6, FLOOR * 2 - 0.04, 0.07), [x, FLOOR, d / 2 + 0.035]); // bay
        b.fix(box(uw * 0.5, 0.1, 0.02), GLASS, [x, FLOOR + 0.07, d / 2 + 0.072]);
        b.fix(box(uw * 0.5, 0.1, 0.02), GLASS, [x, FLOOR * 2 + 0.07, d / 2 + 0.072]);
      } else {
        b.acc(gambrel(uw + 0.01, 0.2, d + 0.04), [x, h, 0], [0, Math.PI / 2, 0]);
        b.wall(box(0.09, 0.08, 0.08), [x, h + 0.05, d / 2 - 0.02]);
        b.fix(box(0.06, 0.05, 0.02), GLASS, [x, h + 0.065, d / 2 + 0.025]);
      }
      // Door with steps on the left of each unit, windows on every floor.
      b.fix(box(0.07, 0.16, 0.02), [0x2e4a62, 0x6b3b2a, 0x3f5f3f][u], [x - uw * 0.22, 0.04, d / 2 + 0.005]);
      steps(b, x - uw * 0.22, d / 2, 0.1);
      b.windows(1, uw * 0.4, d, 0.1, GLASS, 0.08);
      for (let f = 1; f < 3; f++) if (v !== 1) b.windows(2, uw - 0.04, d, 0.1 + f * FLOOR, GLASS, 0.075);
      if (hi) {
        b.fix(box(0.012, h, 0.014), TRIM, [x + uw / 2 - 0.002, 0, d / 2 + 0.006]); // party-wall trim
        chimney(b, x + uw * 0.25, h, -d * 0.2, 0.16);
        shrub(b, x + uw * 0.2, d / 2 + 0.07, 0.035);
        b.fix(box(uw - 0.02, 0.05, 0.012), 0x2b2b2b, [x, 0, d / 2 + 0.17]); // railing along the front yard
      }
    }
    if (hi) {
      gutterX(b, 0.9, hBase, d / 2 + 0.03);
      acUnit(b, 0.47, 0, -d * 0.25);
      b.fix(box(0.9, 0.035, d + 0.02), STONE, [0, 0, 0]);
    }
  } else {
    // SMALL APARTMENT BLOCKS: 5 storeys.
    const floors = 5, w = 0.86, d = 0.66, h = FLOOR * floors + 0.06;
    if (v === 0) {
      // Slab block with a grid of balconies and a flat roof.
      b.wall(box(w, h, d));
      b.acc(box(w + 0.03, 0.04, d + 0.03), [0, h, 0]);
      for (let f = 0; f < floors; f++) b.windows(4, w, d, 0.1 + f * FLOOR, GLASS, 0.085);
      b.sideWindows(3, w, d, 0.12);
    } else if (v === 1) {
      // Brick block with a central glass stair core rising above the roof.
      b.fix(box(w, h, d), BRICK, [0, 0, 0]);
      b.wall(box(0.18, h + 0.12, 0.12), [0, 0, d / 2 - 0.02]);
      b.fix(box(0.12, h, 0.02), 0x9fd7ff, [0, 0.04, d / 2 + 0.042]);
      b.acc(box(0.2, 0.03, 0.14), [0, h + 0.12, d / 2 - 0.02]);
      b.acc(box(w + 0.02, 0.035, d + 0.02), [0, h, 0]);
      for (let f = 0; f < floors; f++) for (const sx of [-1, 1]) b.windows(2, w * 0.36, d, 0.1 + f * FLOOR, GLASS, 0.08), void sx;
    } else if (v === 3) {
      // PR 6 MANSARD block: steep slate mansard on top, a balcony on every bay.
      b.wall(box(w, h - FLOOR, d));
      b.acc(gambrel(w + 0.02, FLOOR + 0.1, d + 0.02), [0, h - FLOOR, 0], [0, Math.PI / 2, 0]);
      for (let f = 0; f < floors - 1; f++) b.windows(4, w, d, 0.1 + f * FLOOR, GLASS, 0.085);
      for (const dx of [-0.3, 0, 0.3]) { b.wall(box(0.1, 0.09, 0.08), [dx, h - FLOOR + 0.04, d / 2 - 0.03]); b.fix(box(0.07, 0.06, 0.02), GLASS, [dx, h - FLOOR + 0.055, d / 2 + 0.015]); }
      if (hi) for (let f = 1; f < floors - 1; f++) for (const dx of [-0.3, 0, 0.3]) balcony(b, dx, f * FLOOR + 0.02, d / 2, 0.14);
    } else {
      // Block with a ground-floor shopfront, upper floors set back, corner tower.
      b.wall(box(w, FLOOR + 0.04, d));
      b.fix(box(w * 0.85, 0.13, 0.02), 0x9fd7ff, [0, 0.05, d / 2 + 0.005]);
      b.acc(box(w * 0.85, 0.025, 0.12), [0, 0.22, d / 2 + 0.05], [0.3, 0, 0]); // awning
      b.wall(box(w * 0.92, h - FLOOR - 0.04, d * 0.86), [0, FLOOR + 0.04, -d * 0.05]);
      b.wall(box(0.2, h + 0.15, 0.2), [w / 2 - 0.08, 0, d / 2 - 0.1]); // corner tower
      b.acc(pyramid(0.24, 0.14), [w / 2 - 0.08, h + 0.15, d / 2 - 0.1]);
      b.acc(box(w * 0.94, 0.035, d * 0.88), [0, h, -d * 0.05]);
      for (let f = 1; f < floors; f++) b.windows(4, w * 0.8, d * 0.86 - 0.1, 0.1 + f * FLOOR, GLASS, 0.08);
    }
    if (hi && v !== 3) {
      // Balconies on upper floors, roof plant, entrance canopy, bike racks, plinth.
      for (let f = 1; f < floors; f++) {
        balcony(b, -w * 0.28, f * FLOOR + 0.02, d / 2 - (v === 2 ? 0.1 : 0), 0.18);
        if (v !== 1) balcony(b, w * 0.2, f * FLOOR + 0.02, d / 2 - (v === 2 ? 0.1 : 0), 0.18);
      }
      coping(b, w, d, h);
      acUnit(b, -w * 0.25, h, -d * 0.2, 1.3);
      acUnit(b, w * 0.1, h, -d * 0.25, 1.3);
      vent(b, w * 0.3, h, d * 0.1, 0.025);
      b.fix(box(0.9, 0.035, 0.7), STONE, [0, 0, 0]);
      door(b, v === 1 ? 0 : -w * 0.1, d / 2, 0x9fd7ff, 0.12, 0.17);
      steps(b, v === 1 ? 0 : -w * 0.1, d / 2, 0.18);
      for (let n = 0; n < 4; n++) b.fix(box(0.006, 0.05, 0.04), METAL, [w * 0.3 + n * 0.03, 0, d / 2 + 0.12]);
      for (const sx of [-1, 1]) b.fix(box(0.016, h, 0.016), METAL, [sx * (w / 2 - 0.01), 0, d / 2 + 0.01]);
    }
  }
  // V1.5b: backs + sides. Rowhouses: three back doors/patios via one call
  // per unit; apartment blocks: back balconies + rear entrance.
  if (level === 4) for (let u = 0; u < 3; u++) allSides(b, { x: -0.29 + u * 0.29, w: 0.286, d: 0.56, h: FLOOR * 3 + 0.04, floors: 3, cols: 1, left: u === 0, right: u === 2, vent: false });
  else allSides(b, { w: 0.86, d: 0.66, h: FLOOR * 5 + 0.06, floors: 5, cols: 4, apt: true, right: v !== 0 });
  return b.done();
}

/**
 * PR 6 HIGH-DENSITY TOWERS (residential model level 6). Drawn at a "unit"
 * height and stretched tall by the renderer (template model.tall), so
 * these are about proportions: a podium, then 2–3 STEPPED SET-BACK volumes,
 * balcony bands, a crown. Variants: 0 wedding-cake setbacks, 1 slim glass
 * tower with a podium, 2 brick tower with corner balconies, 3 stepped slab.
 */
function tower(v: number, hi: boolean): DesignParts {
  const b = new Builder(hi);
  const tiers = v === 1 ? [[0.86, 0.66, 0.25], [0.5, 0.42, 1.25]] : v === 3 ? [[0.88, 0.5, 0.7], [0.7, 0.4, 0.45], [0.5, 0.3, 0.35]] : [[0.84, 0.64, 0.6], [0.66, 0.5, 0.5], [0.46, 0.36, 0.4]];
  let y = 0;
  tiers.forEach(([tw, td, th], k) => {
    if (v === 2) b.fix(box(tw, th, td), 0xa9573f, [0, y, 0]);
    else b.wall(box(tw, th, td), [0, y, 0]);
    if (v === 1 && k === 1) b.fix(box(tw * 0.9, th * 0.96, 0.01), 0x9fd7ff, [0, y + 0.02, td / 2 + 0.005]);
    // window bands
    for (let f = 0; f < Math.floor(th / 0.09); f++) {
      b.fix(box(tw * 0.86, 0.035, 0.012), GLASS, [0, y + 0.03 + f * 0.09, td / 2 + 0.004]);
      // V1.5b: window bands on the back and both sides too (lit at night).
      b.fix(box(tw * 0.86, 0.035, 0.012), GLASS, [0, y + 0.03 + f * 0.09, -td / 2 - 0.004]);
      for (const sx of [-1, 1]) b.fix(box(0.012, 0.035, td * 0.8), GLASS, [sx * (tw / 2 + 0.004), y + 0.03 + f * 0.09, 0]);
      if (hi && v !== 1 && f % 2 === 1) b.fix(box(tw * 0.9, 0.01, 0.05), TRIM, [0, y + f * 0.09, -td / 2 - 0.025]); // back balcony slabs
    }
    if (hi && v !== 1) for (let f = 1; f < Math.floor(th / 0.09); f += 2) b.fix(box(tw * 0.9, 0.01, 0.05), TRIM, [0, y + f * 0.09, td / 2 + 0.025]); // balcony slabs
    y += th;
    b.acc(box(tw + 0.02, 0.025, td + 0.02), [0, y, 0]); // setback terrace edge
  });
  b.acc(box(0.14, 0.12, 0.14), [0, y, 0]); // crown / plant room
  if (hi) {
    acUnit(b, 0.1, y, 0.05, 1.2); b.fix(box(0.9, 0.03, 0.7), STONE, [0, 0, 0]); door(b, 0, 0.33, 0x9fd7ff, 0.14, 0.12);
    // V1.5b: rear service door, downpipes, vent.
    const bd = tiers[0][1] / 2;
    b.fix(box(0.12, 0.15, 0.02), 0x9fd7ff, [0, 0.03, -bd - 0.006]);
    for (const sx of [-1, 1]) b.fix(box(0.016, tiers[0][2], 0.016), METAL, [sx * (tiers[0][0] / 2 - 0.02), 0, -bd - 0.01]);
    vent(b, -0.05, y, -0.04, 0.022);
  }
  return b.done();
}

/**
 * Build all designs: result[zone][design][level-1].
 * PR 5: `lod` picks the high-detail (default) or the low-detail (PR 4) set.
 */
export function buildDesigns(lod: 'high' | 'low' = 'high'): Record<ZoneType, DesignParts[][]> {
  const hi = lod === 'high';
  const make = (fn: (k: number, level: number, hi: boolean) => DesignParts, levels = [1, 2, 3], n = DESIGNS_PER_ZONE) =>
    Array.from({ length: n }, (_, k) => levels.map((lv) => fn(k, lv, hi)));
  // PR 5: homes have 5 levels (4 = rowhouses, 5 = apartments); PR 6 adds 6 = towers and 8 designs.
  return { residential: make(residential, [1, 2, 3, 4, 5, 6, 7], RES_DESIGNS), commercial: make(commercial), industrial: make(industrial, [1, 2, 3, 4, 5]) }; // V1.5b stage B: industry L5
}

// ----------------------------------------------------------------------------
// PR 5 HIGH-DETAIL extras
// ----------------------------------------------------------------------------
// These run only for the high-detail LOD. They add the small things that make
// a low-poly building read as "real" up close: plinths, door steps, gutters,
// downspouts, chimney caps, AC units, vents, mailboxes, balconies, signs,
// pipes, tanks and loading docks. Everything is still boxes/cylinders, so a
// model stays a few hundred triangles — and still ONE shared geometry per
// design+level (instancing is unchanged).

const TRIM = 0xf4f1ea;
const METAL = 0x9aa1a8;
const STONE = 0x9b948a;
const cyl = (r: number, h: number, seg = 8) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);

/** Little air-conditioning box with a round fan on top and a grille line. */
function acUnit(b: Builder, x: number, y: number, z: number, s = 1) {
  b.fix(box(0.09 * s, 0.065 * s, 0.075 * s), 0xc5ccd3, [x, y, z]);
  b.fix(cyl(0.028 * s, 0.008, 10), DARK, [x, y + 0.065 * s, z]);
  b.fix(box(0.092 * s, 0.006, 0.077 * s), METAL, [x, y + 0.03 * s, z]);
}
/** Mushroom roof vent: a pipe with a cone cap. */
function vent(b: Builder, x: number, y: number, z: number, r = 0.018) {
  b.fix(cyl(r, 0.05, 8), METAL, [x, y, z]);
  b.fix(new THREE.ConeGeometry(r * 1.8, 0.025, 8).translate(0, 0.0125, 0), 0x7b828a, [x, y + 0.05, z]);
}
/** Two front steps, centred on x, in front of the face at z. */
function steps(b: Builder, x: number, z: number, wdt = 0.14) {
  b.fix(box(wdt, 0.02, 0.06), 0xcfc8bb, [x, 0, z + 0.03]);
  b.fix(box(wdt, 0.02, 0.035), 0xdcd6ca, [x, 0.02, z + 0.0175]);
}
/** A door with frame, lintel and a round knob on the face at z. */
function door(b: Builder, x: number, z: number, color = WOOD, dw = 0.09, dh = 0.16) {
  b.fix(box(dw, dh, 0.02), color, [x, 0.04, z + 0.004]);
  b.fix(box(dw + 0.025, 0.014, 0.026), TRIM, [x, 0.04 + dh, z + 0.004]);
  b.fix(box(0.012, dh, 0.026), TRIM, [x - dw / 2 - 0.006, 0.04, z + 0.004]);
  b.fix(box(0.012, dh, 0.026), TRIM, [x + dw / 2 + 0.006, 0.04, z + 0.004]);
  b.fix(new THREE.SphereGeometry(0.008, 6, 4), 0xd8b45a, [x + dw * 0.3, 0.04 + dh * 0.45, z + 0.018]);
}
/** Half-round gutter along x at the eave (y, z), plus a downspout at each end. */
function gutterX(b: Builder, len: number, y: number, z: number, x0 = 0, spouts = true) {
  b.fix(new THREE.CylinderGeometry(0.014, 0.014, len, 8, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI), METAL, [x0, y, z]);
  if (spouts) for (const sx of [-1, 1]) b.fix(box(0.016, y, 0.016), METAL, [x0 + sx * (len / 2 - 0.02), 0, z]);
}
/** Ring of coping stones around a flat roof (rw × rd) at height y. */
function coping(b: Builder, rw: number, rd: number, y: number, cx = 0, cz = 0) {
  b.fix(box(rw + 0.02, 0.03, 0.025), TRIM, [cx, y, cz + rd / 2]);
  b.fix(box(rw + 0.02, 0.03, 0.025), TRIM, [cx, y, cz - rd / 2]);
  b.fix(box(0.025, 0.03, rd), TRIM, [cx + rw / 2, y, cz]);
  b.fix(box(0.025, 0.03, rd), TRIM, [cx - rw / 2, y, cz]);
}
/** Balcony: slab + front rail + 4 balusters, on the front face at height y. */
function balcony(b: Builder, x: number, y: number, z: number, bw: number) {
  b.fix(box(bw, 0.018, 0.08), 0xd8dde2, [x, y, z + 0.04]);
  b.fix(box(bw, 0.012, 0.012), DARK, [x, y + 0.07, z + 0.078]);
  for (let k = 0; k < 4; k++) b.fix(box(0.008, 0.07, 0.008), DARK, [x - bw / 2 + 0.01 + (k * (bw - 0.02)) / 3, y + 0.018, z + 0.078]);
  b.fix(box(0.012, 0.012, 0.08), DARK, [x - bw / 2 + 0.006, y + 0.07, z + 0.04]);
  b.fix(box(0.012, 0.012, 0.08), DARK, [x + bw / 2 - 0.006, y + 0.07, z + 0.04]);
}
/** Chimney with a cap stone and a clay pot. */
function chimney(b: Builder, x: number, y: number, z: number, ch: number) {
  b.fix(box(0.07, ch, 0.07), 0x8c5a48, [x, y, z]);
  b.fix(box(0.085, 0.02, 0.085), STONE, [x, y + ch, z]);
  b.fix(cyl(0.015, 0.035, 8), 0xb0603f, [x, y + ch + 0.02, z]);
}
/** Round shrub (icosahedron). */
const shrub = (b: Builder, x: number, z: number, r = 0.045) => b.fix(new THREE.IcosahedronGeometry(r, 0).translate(0, r * 0.8, 0), 0x5f8f4a, [x, 0, z]);

/**
 * V1.5b (Parker): DETAIL ON EVERY SIDE. Residential models used to be dressed
 * only on the front (+z) face, so from behind a street looked like blank
 * boxes. `allSides` adds, for a wall box w × d × h (front at z = zoff + d/2):
 *   ALWAYS (both LODs, cheap and lit at night — GLASS is in LIT):
 *     back (−z) windows on every floor, left (−x) windows, and right (+x)
 *     windows unless the design already has them (`right: false`).
 *   HIGH DETAIL ONLY (the low Detail setting drops these extras):
 *     houses: back door + steps, or a glazed patio door on wider homes;
 *     apartments: back balconies on upper floors and a glazed rear entrance;
 *     downpipes on both back corners, a side AC unit, a roof vent.
 * Everything merges into the design's existing buckets, so instancing is
 * unchanged (still one geometry per design + level).
 */
interface SideOpts { left?: boolean; x?: number; w: number; d: number; h: number; floors: number; zoff?: number; cols?: number; apt?: boolean; right?: boolean; vent?: boolean }
function allSides(b: Builder, o: SideOpts): void {
  // `x` shifts everything sideways (rowhouse units): parts added here are
  // translated once at the end.
  const lists = [b.walls, b.accent, b.fixed, b.lights], n0 = lists.map((l) => l.length);
  sidesAt(b, o);
  if (o.x) lists.forEach((l, i) => { for (let k = n0[i]; k < l.length; k++) l[k].translate(o.x!, 0, 0); });
}
function sidesAt(b: Builder, o: SideOpts): void {
  const zoff = o.zoff ?? 0, back = zoff - o.d / 2 - 0.005, cols = o.cols ?? Math.max(1, Math.round(o.w / 0.22));
  const floors = Math.max(1, Math.min(o.floors, Math.floor((o.h - 0.04) / FLOOR)));
  const sz = 0.085;
  for (let f = 0; f < floors; f++) {
    const y = 0.1 + f * FLOOR;
    for (let k = 0; k < cols; k++) {
      const x = -o.w / 2 + (o.w * (k + 0.5)) / cols;
      if (f === 0 && k === (o.apt ? Math.floor(cols / 2) : 0)) continue; // back door goes here
      b.fix(box(sz, sz * 1.1, 0.02), GLASS, [x, y, back]);
      if (b.hi) b.fix(box(sz + 0.03, 0.012, 0.035), TRIM, [x, y - 0.012, back - 0.01]); // sill
    }
    const sideN = Math.max(1, Math.round(o.d / 0.3));
    for (let k = 0; k < sideN; k++) {
      const z = zoff - o.d / 2 + (o.d * (k + 0.5)) / sideN;
      if (o.left !== false) b.fix(box(0.02, sz * 1.1, sz), GLASS, [-o.w / 2 - 0.005, y, z]);
      if (o.right !== false) b.fix(box(0.02, sz * 1.1, sz), GLASS, [o.w / 2 + 0.005, y, z]);
    }
  }
  if (!b.hi) return;
  const dx = o.apt ? -o.w / 2 + (o.w * (Math.floor(cols / 2) + 0.5)) / cols : -o.w / 2 + o.w / (2 * cols);
  if (o.apt) {
    b.fix(box(0.14, 0.17, 0.02), 0x9fd7ff, [dx, 0.04, back]); // glazed rear entrance
    b.acc(box(0.2, 0.02, 0.1), [dx, 0.23, back - 0.05]); // canopy
    for (let f = 1; f < floors; f++) for (const bx of [-o.w * 0.3, o.w * 0.3]) balconyBack(b, bx, f * FLOOR + 0.02, back, 0.16);
  } else if (o.w > 0.6) {
    b.fix(box(0.14, 0.16, 0.02), 0x9fd7ff, [dx, 0.04, back]); // patio door
    b.fix(box(0.24, 0.02, 0.14), 0xcfc4b0, [dx, 0, back - 0.07]); // patio slab
  } else {
    b.fix(box(0.08, 0.16, 0.02), WOOD, [dx, 0.04, back]); // back door
    b.fix(box(0.12, 0.02, 0.05), 0xcfc8bb, [dx, 0, back - 0.025]); // back step
  }
  for (const sx of [-1, 1]) b.fix(box(0.016, Math.min(o.h, floors * FLOOR + 0.06), 0.016), METAL, [sx * (o.w / 2 - 0.02), 0, back - 0.01]); // downpipes
  acUnit(b, -o.w / 2 - 0.05, 0, zoff - o.d * 0.2);
  if (o.vent !== false) vent(b, o.w * 0.2, o.h, zoff - o.d * 0.25);
}
/** Balcony on the BACK (−z) face. */
function balconyBack(b: Builder, x: number, y: number, z: number, bw: number) {
  b.fix(box(bw, 0.018, 0.08), 0xd8dde2, [x, y, z - 0.04]);
  b.fix(box(bw, 0.012, 0.012), DARK, [x, y + 0.07, z - 0.078]);
  for (let k = 0; k < 3; k++) b.fix(box(0.008, 0.07, 0.008), DARK, [x - bw / 2 + 0.01 + (k * (bw - 0.02)) / 2, y + 0.018, z - 0.078]);
}

function resDetails(b: Builder, k: number, level: number, w: number, h: number, d: number, floors: number): void {
  const zoff = k === 1 ? -0.04 : 0;
  const bw = k === 4 ? w * 0.9 : w;
  const front = zoff + d / 2;
  const wallH = k === 4 ? FLOOR * Math.max(1, floors - 1) + 0.04 : k === 2 ? FLOOR + 0.04 : h;
  // Stone plinth the house sits on.
  b.fix(box(bw + 0.025, 0.035, d + 0.025), STONE, [0, 0, zoff]);
  // Door + steps (designs that already have a door get steps and trim).
  // PR 6: designs 5–7 (saltbox, brick hip, stucco flat) have their door centred.
  const doorX = [-w / 4, 0, -w * 0.3, 0, 0][k] ?? 0;
  if (k === 2) door(b, doorX, front, 0x3b4a57);
  else if (k !== 1) {
    b.fix(box(0.125, 0.014, 0.026), TRIM, [doorX, 0.17, front + 0.004]); // lintel over the existing door
    b.fix(new THREE.SphereGeometry(0.008, 6, 4), 0xd8b45a, [doorX + 0.03, 0.08, front + 0.02]);
  }
  if (k !== 1) steps(b, doorX, front);
  else steps(b, 0, front + 0.1, w * 0.4); // porch steps
  shrub(b, doorX - 0.11, front + 0.06);
  shrub(b, doorX + 0.11, front + 0.06, 0.04);
  // Gutters + downspouts: along front & back eaves for ridge roofs, all 4 for hip, coping for flat.
  if (k === 2) {
    coping(b, w + 0.04, d + 0.04, FLOOR + 0.07);
    if (floors > 1) coping(b, w * 0.74, d * 0.9, h + 0.03, w * 0.12, -d * 0.05);
  } else {
    gutterX(b, bw + 0.06, wallH, front + 0.045);
    gutterX(b, bw + 0.06, wallH, zoff - d / 2 - 0.045, 0, false);
  }
  // Chimney (design 0 already has one: just cap it).
  if (k === 0) {
    b.fix(box(0.085, 0.02, 0.085), STONE, [w / 3, h + 0.18, -d / 5]);
    b.fix(cyl(0.015, 0.035, 8), 0xb0603f, [w / 3, h + 0.2, -d / 5]);
  } else if (k !== 2) chimney(b, -bw / 3, wallH, zoff - d / 5, 0.24 + level * 0.05);
  else vent(b, -w * 0.3, FLOOR + 0.07, -d * 0.2);
  // AC unit on the right-hand side and a mailbox at the curb.
  acUnit(b, bw / 2 + 0.06, 0, zoff - d / 5);
  b.fix(box(0.012, 0.09, 0.012), WOOD, [bw / 2 + 0.02, 0, front + 0.2]);
  b.fix(box(0.04, 0.03, 0.06), 0x3b5f8a, [bw / 2 + 0.02, 0.09, front + 0.2]);
  // Upper floors get balconies on bigger houses; level 3 adds a satellite dish.
  if (level >= 2 && k !== 2 && k !== 4) for (let f = 1; f < floors; f++) balcony(b, w * 0.18, f * FLOOR + 0.02, front, w * 0.38);
  if (level === 3) {
    b.fix(new THREE.SphereGeometry(0.04, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-1.1), 0xe4e6e8, [bw / 2 - 0.02, wallH * 0.85, zoff - d / 2 - 0.03]);
    b.fix(box(0.01, 0.04, 0.01), METAL, [bw / 2 - 0.02, wallH * 0.85 - 0.03, zoff - d / 2 - 0.02]);
  }
}

/**
 * V1.6: extra detail for the low-density homes (high LOD only) — roof
 * courses and ridge cap, eave boards, shutters, flower boxes, a picket
 * fence with a gate, stepping stones, a porch lamp, door panels, a garden
 * with flower beds, and rounded trees and bushes.
 */
function resExtras(b: Builder, k: number, level: number, w: number, h: number, d: number, floors: number): void {
  const zoff = k === 1 ? -0.04 : 0;
  const front = zoff + d / 2;
  const sloped = k === 0 || k === 1 || k === 3 || k === 5 || k === 6 || k === 4;
  // Roof courses: thin dark shingle lines down each slope of the ridge roofs.
  if (k === 0 || k === 5 || k === 4) {
    const rw = (k === 4 ? w * 0.9 : w) + 0.06, rd = d + (k === 4 ? 0.1 : 0.08);
    const rh = k === 0 ? 0.24 : k === 5 ? 0.26 + level * 0.03 : 0.32 + level * 0.06;
    const wallTop = k === 4 ? FLOOR * Math.max(1, floors - 1) + 0.04 : h;
    const slope = Math.atan2(rh, rd / 2);
    for (let t = 1; t <= 5; t++) {
      const f = t / 6;
      for (const sg of [1, -1]) {
        b.fix(box(rw + 0.012, 0.008, 0.016), 0x5a4a42, [0, wallTop + rh * f + 0.002, sg * (rd / 2) * (1 - f)], [sg * -slope, 0, 0]);
      }
    }
    b.fix(box(rw + 0.02, 0.022, 0.03), 0x4a403a, [0, wallTop + rh - 0.004, 0]); // ridge cap
  }
  if (k === 1 || k === 6) { // hip roofs: a ring of eave boards
    const wallTop = h;
    b.fix(box(w + 0.1, 0.018, 0.012), 0x4a403a, [0, wallTop + 0.005, zoff + d / 2 + 0.05]);
    b.fix(box(w + 0.1, 0.018, 0.012), 0x4a403a, [0, wallTop + 0.005, zoff - d / 2 - 0.05]);
  }
  // Fascia / eave board along the front.
  if (sloped || k === 3) b.fix(box(w + 0.07, 0.022, 0.014), TRIM, [0, h - 0.008, front + 0.045]);
  // Shutters beside the ground-floor windows (cottage, porch house, saltbox).
  if (k === 0 || k === 1 || k === 5) {
    const n = k === 0 ? 1 : 2, width = k === 0 ? w / 2 : w;
    for (let i = 0; i < n; i++) {
      const x = -width / 2 + (width * (i + 0.5)) / n;
      for (const sg of [-1, 1]) b.fix(box(0.022, 0.1, 0.012), 0x3f6a5a, [x + sg * 0.062, 0.1, front + 0.006]);
      // flower box under the window
      b.fix(box(0.11, 0.025, 0.035), WOOD, [x, 0.075, front + 0.03]);
      for (let f = 0; f < 4; f++) b.fix(new THREE.IcosahedronGeometry(0.014, 1).translate(0, 0.014, 0), [0xe05a6d, 0xf2c230, 0xe05a6d, 0xffffff][f], [x - 0.04 + f * 0.027, 0.1, front + 0.032]);
    }
  }
  // Door panels + porch lamp.
  const dx = [-w / 4, 0, -w * 0.3, 0, 0][k] ?? 0;
  if (k !== 2) {
    b.fix(box(0.035, 0.05, 0.006), 0x5a3f2a, [dx - 0.02, 0.05, front + 0.016]);
    b.fix(box(0.035, 0.05, 0.006), 0x5a3f2a, [dx + 0.02, 0.05, front + 0.016]);
    b.fix(box(0.035, 0.04, 0.006), 0x5a3f2a, [dx - 0.02, 0.11, front + 0.016]);
    b.fix(box(0.035, 0.04, 0.006), 0x5a3f2a, [dx + 0.02, 0.11, front + 0.016]);
  }
  b.fix(cyl(0.01, 0.03, 8), DARK, [dx + 0.09, 0.14, front + 0.012]);
  b.fix(new THREE.SphereGeometry(0.014, 8, 6), 0xffe9a8, [dx + 0.09, 0.175, front + 0.012]);
  // Stepping stones to the street.
  for (let i = 0; i < 3; i++) b.fix(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 8), 0xb9b2a6, [dx, 0.004, front + 0.16 + i * 0.075]);
  // Picket fence with a gate on the cottage, porch house and saltbox.
  if (k === 0 || k === 1 || k === 5 || k === 3) {
    const fw = w + 0.12, fz = front + 0.3;
    const n = Math.round(fw / 0.045);
    for (let i = 0; i <= n; i++) {
      const x = -fw / 2 + (fw * i) / n;
      if (Math.abs(x - dx) < 0.05) continue; // gate gap
      b.fix(box(0.02, 0.07, 0.01), 0xf4f1ea, [x, 0, fz]);
      b.fix(new THREE.ConeGeometry(0.014, 0.02, 4).rotateY(Math.PI / 4).translate(0, 0.08, 0), 0xf4f1ea, [x, 0, fz]);
    }
    b.fix(box(fw, 0.01, 0.008), 0xe8e4da, [0, 0.02, fz + 0.006]);
    b.fix(box(fw, 0.01, 0.008), 0xe8e4da, [0, 0.055, fz + 0.006]);
  }
  // Flower beds either side of the path.
  for (const sg of [-1, 1]) {
    const bx = dx + sg * 0.21;
    b.fix(box(0.14, 0.018, 0.06), 0x5a4a3a, [bx, 0, front + 0.14]);
    for (let f = 0; f < 5; f++) b.fix(new THREE.IcosahedronGeometry(0.016, 1).translate(0, 0.03, 0), [0xe05a6d, 0xf2c230, 0xb872c4, 0xff9aa8, 0xffffff][(f + (sg > 0 ? 2 : 0)) % 5], [bx - 0.05 + f * 0.025, 0.012, front + 0.14 + ((f % 2) - 0.5) * 0.02]);
  }
  // A rounded tree at the back corner (trunk + three canopy blobs) and a hedge of bushes.
  const tx = -w / 2 - 0.1, tz = zoff - d / 2 - 0.02;
  b.fix(cyl(0.018, 0.14, 8), 0x6b4a2f, [tx, 0, tz]);
  for (const [ox, oy, oz, r] of [[0, 0.2, 0, 0.09], [0.05, 0.27, 0.02, 0.07], [-0.04, 0.26, -0.03, 0.065]] as const)
    b.fix(new THREE.IcosahedronGeometry(r, 1).translate(ox, oy, oz), 0x4f8a45, [tx, 0, tz]);
  for (const bx of [w / 2 + 0.08, w / 2 + 0.08]) b.fix(new THREE.IcosahedronGeometry(0.05, 1).translate(0, 0.04, 0), 0x5a9a4a, [bx, 0, zoff + d / 4]);
  // Dormer window on the bigger gable cottages.
  if (k === 0 && level >= 2) {
    b.wall(box(0.14, 0.1, 0.1), [w * 0.2, h + 0.07, d * 0.1]);
    b.acc(gable(0.18, 0.07, 0.14), [w * 0.2, h + 0.17, d * 0.1]);
    b.fix(box(0.07, 0.06, 0.012), GLASS, [w * 0.2, h + 0.09, d * 0.1 + 0.052]);
  }
}

function comDetails(b: Builder, k: number, level: number, w: number, h: number, d: number, floors: number): void {
  // Footprint (rw × rd centred at cz) and roof height of each design.
  const [rw, rd, cz, roofY] = [
    [w, d, 0, h],
    [w, d * 0.85, 0, Math.max(0.3, h * 0.8)],
    [w * 0.9, d * 0.9, 0, h + FLOOR * (level - 1) * 0.5],
    [w, d * 0.5, -d * 0.25, Math.min(h, 0.34)],
    [w * 0.65, d * 0.65, 0, h * 1.2],
  ][k];
  const front = k === 4 ? d / 2 : cz + rd / 2;
  // Parapet coping round the flat roof + vents + AC units.
  coping(b, rw, rd, roofY, 0, cz);
  vent(b, rw * 0.3, roofY, cz - rd * 0.25);
  vent(b, -rw * 0.3, roofY, cz + rd * 0.2, 0.022);
  acUnit(b, -rw * 0.12, roofY, cz - rd * 0.2, 1.2);
  if (level >= 2) acUnit(b, rw * 0.15, roofY, cz + rd * 0.15, 1.2);
  // Glass entrance door with a frame, step and a little canopy.
  const dx = k === 3 ? -w * 0.3 : -w * 0.32;
  door(b, dx, front, 0x9fd7ff, 0.1, 0.17);
  steps(b, dx, front, 0.16);
  b.acc(box(0.16, 0.02, 0.07), [dx, 0.23, front + 0.035]);
  // Downspouts on the front corners + bollards on the pavement.
  for (const sx of [-1, 1]) b.fix(box(0.016, roofY, 0.016), METAL, [sx * (rw / 2 - 0.01), 0, front + 0.01]);
  for (let n = 0; n < 3; n++) b.fix(cyl(0.012, 0.05, 6), 0x5a5f66, [-w * 0.3 + n * w * 0.3, 0, d / 2 + 0.14]);
  // Projecting "blade" sign on the corner; level 3 gets a rooftop billboard.
  if (level >= 2) {
    b.fix(box(0.05, 0.012, 0.012), DARK, [rw / 2 + 0.025, roofY * 0.7, front - 0.04]);
    b.acc(box(0.012, 0.12, 0.07), [rw / 2 + 0.05, roofY * 0.7 - 0.13, front - 0.04]);
  }
  if (level === 3) {
    for (const sx of [-1, 1]) b.fix(box(0.012, 0.12, 0.012), DARK, [sx * rw * 0.22, roofY, cz]);
    b.acc(box(rw * 0.55, 0.1, 0.015), [0, roofY + 0.1, cz]);
    b.fix(box(rw * 0.5, 0.06, 0.017), 0xffd166, [0, roofY + 0.12, cz]);
  }
  // Striped awning over the ground floor on the shops (levels 2+).
  if ((k === 0 || k === 1) && level >= 2) {
    for (let n = 0; n < 6; n++) {
      const sx = -rw * 0.4 + (n + 0.5) * ((rw * 0.8) / 6);
      b.fix(box((rw * 0.8) / 6, 0.02, 0.11), n % 2 ? 0xffffff : 0xd94a4a, [sx, 0.3, front + 0.055], [0.35, 0, 0]);
    }
  }
}

/**
 * V1.5b stage B revamp (high detail only): hazard-striped kerb + bollards at
 * the door, rooftop HVAC row, a company sign board, a rust-streak panel and
 * gutter downpipes. Colours chosen so the industrial texture atlas lands the
 * right surface (textures.ts skinForColor).
 */
function indRevamp(b: Builder, k: number, level: number, w: number, h: number, d: number): void {
  const HAZ = 0xf2c230;
  const roofY = k === 2 ? 0 : k === 3 ? h * 1.15 : h;
  const front = k === 2 ? d * 0.34 : d / 2;
  b.fix(box(0.26, 0.012, 0.03), HAZ, [-w / 5, 0, front + 0.03]);
  for (const s of [-1, 1]) b.fix(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 8).translate(0, 0.035, 0), HAZ, [-w / 5 + s * 0.13, 0, front + 0.05]);
  if (k !== 2) for (let n = 0; n < Math.min(4, 1 + level); n++) {
    b.fix(box(0.08, 0.045, 0.06), 0xb8bec4, [-w * 0.3 + n * 0.12, roofY, -d * 0.25]);
    b.fix(new THREE.CylinderGeometry(0.018, 0.018, 0.006, 8), 0x3a3f44, [-w * 0.3 + n * 0.12, roofY + 0.048, -d * 0.25]);
  }
  const signCol = [0x2f6fb0, 0xd02c2c, 0x1f7a3d, 0xe07a1f, 0x7d2f6b][k % 5];
  b.fix(box(Math.min(0.3, w * 0.4), 0.05, 0.01), signCol, [w * 0.15, Math.max(0.12, roofY * 0.8), front + 0.012]);
  b.fix(box(0.08, roofY * 0.5, 0.004), 0x8a4f26, [w * 0.38, roofY * 0.3, front + 0.004]); // rust streak
  for (const s of [-1, 1]) b.fix(box(0.014, roofY, 0.014), 0x6d757b, [s * (w / 2 - 0.02), 0, front + 0.01]);
}

function indDetails(b: Builder, k: number, level: number, w: number, h: number, d: number): void {
  const front = [d / 2, d / 2, d * 0.34, d / 2, d * 0.425][k];
  const back = -[d / 2, d / 2, d * 0.46, d / 2, d * 0.425][k];
  // Pipe run along the back wall with two drops and elbow joints.
  const py = Math.max(0.12, h * 0.6);
  b.fix(new THREE.CylinderGeometry(0.016, 0.016, w * 0.7, 8).rotateZ(Math.PI / 2), 0xb07a45, [0, py, back - 0.03]);
  for (const sx of [-1, 1]) {
    b.fix(cyl(0.016, py, 8), 0xb07a45, [sx * w * 0.35, 0, back - 0.03]);
    b.fix(new THREE.SphereGeometry(0.02, 8, 4), 0x8a5a36, [sx * w * 0.35, py, back - 0.03]);
  }
  // Loading dock: raised platform, yellow bumpers and a ribbed roller door.
  const dockX = k === 1 ? -w * 0.22 : w * 0.22;
  b.fix(box(0.22, 0.05, 0.08), 0x9c9890, [dockX, 0, front + 0.04]);
  for (const sx of [-1, 1]) b.fix(box(0.025, 0.035, 0.02), 0x222222, [dockX + sx * 0.09, 0.01, front + 0.085]);
  b.fix(box(0.16, 0.15, 0.02), 0x8c9096, [dockX, 0.05, front + 0.003]);
  for (let n = 0; n < 4; n++) b.fix(box(0.162, 0.006, 0.022), 0x6c6f73, [dockX, 0.07 + n * 0.035, front + 0.004]);
  b.fix(box(0.2, 0.012, 0.012), 0xf2c14e, [dockX, 0.05, front + 0.081]);
  // Small pressure tank on legs at the side.
  const tx = -w / 2 - 0.02, tz = -d * 0.15;
  b.fix(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 10).rotateX(Math.PI / 2), 0xd9dde1, [tx, 0.09, tz]);
  for (const [lx, lz] of [[-0.03, -0.04], [0.03, -0.04], [-0.03, 0.04], [0.03, 0.04]]) b.fix(box(0.01, 0.05, 0.01), DARK, [tx + lx, 0, tz + lz]);
  // Roof turbine vents (or ground vents beside the round quonset roof).
  const roofY = k === 2 ? 0 : k === 3 ? h * 1.15 : h;
  vent(b, -w * 0.25, roofY, 0, 0.026);
  vent(b, w * 0.1, roofY, -d * 0.15, 0.026);
  // Wall ladder with rungs on the right side.
  if (k !== 2) {
    const lx = k === 1 ? -w * 0.22 + w * 0.275 + 0.01 : (k === 3 ? -w * 0.12 + w * 0.35 : k === 4 ? w * 0.425 : w / 2) + 0.01;
    for (const sz of [-0.025, 0.025]) b.fix(box(0.008, roofY, 0.008), METAL, [lx, 0, sz]);
    for (let n = 1; n < 6; n++) b.fix(box(0.006, 0.006, 0.05), METAL, [lx, (n * roofY) / 6, 0]);
  }
  // Chain-link-style fence along the back: posts and two rails.
  for (let n = 0; n < 5; n++) b.fix(box(0.012, 0.09, 0.012), 0x7d848b, [-0.44 + n * 0.22, 0, -0.45]);
  for (const ry of [0.04, 0.085]) b.fix(box(0.9, 0.006, 0.006), 0x7d848b, [0, ry, -0.45]);
  // Bigger plants get a second tank and a pallet stack.
  if (level >= 2) {
    b.fix(cyl(0.05, 0.16, 10), 0x5e8f6e, [w / 2 + 0.03, 0, -d * 0.35]);
    b.fix(cyl(0.052, 0.012, 10), METAL, [w / 2 + 0.03, 0.16, -d * 0.35]);
  }
  if (level >= 3) for (let n = 0; n < 3; n++) b.fix(box(0.09, 0.025, 0.09), 0xa77b4a, [-w / 2 + 0.06, n * 0.03, d / 2 + 0.12]);
}


// ----------------------------------------------------------------------------
// Palettes and deterministic picking
// ----------------------------------------------------------------------------
const WALLS: Record<ZoneType, number[]> = {
  // PR 6: wider (still muted) palette — siding creams, sage, pale blue, warm stucco, greys, brick-ish clay.
  residential: [0xf3ead8, 0xf6e3a8, 0xcfe0ec, 0xd5e3c4, 0xf0d2c4, 0xffffff, 0xd9a58a, 0xe8dcc8, 0xc9d4c0, 0xbfc8cf, 0xeed9b6, 0xdcc5b0, 0xb9a48f, 0xe4e0d4],
  commercial: [0xf1f3f5, 0xd6dbe0, 0xcdebd9, 0xf6dcc2, 0xe2d6f0],
  industrial: [0xd8ccb4, 0xb8bdc2, 0xc7b08f, 0xbfcab3, 0xd2bfa8],
};
const ACCENTS: Record<ZoneType, number[]> = {
  residential: [0xc8553d, 0x8a5a44, 0x5b6770, 0x4f7a4a, 0xb8643f, 0x4c5d7a, 0x3f3f44, 0x6e4b3a, 0x7d8c6a, 0x94755a],
  commercial: [0xd94a4a, 0x3c8dde, 0x3fa66b, 0xf08a3c, 0x2bb3b1, 0x8d6bd6],
  industrial: [0xb5543c, 0x5e6266, 0x3d8f8a, 0xa8743f, 0x7d8a9a],
};

export interface Look {
  design: number;
  wall: number;
  accent: number;
}

function rawDesign(x: number, z: number, seed: number, n = DESIGNS_PER_ZONE): number {
  return Math.floor(hash2(x, z, seed + 101) * n);
}

/** `n` (PR 6): how many designs to pick from (homes have RES_DESIGNS). */
export function pickLook(zone: ZoneType, x: number, z: number, seed: number, n = zone === 'residential' ? RES_DESIGNS : DESIGNS_PER_ZONE): Look {
  const DESIGNS_PER_ZONE = n;
  let design = rawDesign(x, z, seed, n);
  // Neighbour rule: never the same design as the raw pick of the tile to the
  // west or north, so adjacent buildings differ.
  const west = rawDesign(x - 1, z, seed, n);
  const north = rawDesign(x, z - 1, seed, n);
  for (let tries = 0; tries < DESIGNS_PER_ZONE && (design === west || design === north); tries++) {
    design = (design + 1) % DESIGNS_PER_ZONE;
  }
  const walls = WALLS[zone];
  const accents = ACCENTS[zone];
  return {
    design,
    wall: walls[Math.floor(hash2(x, z, seed + 202) * walls.length)],
    accent: accents[Math.floor(hash2(x, z, seed + 303) * accents.length)],
  };
}
