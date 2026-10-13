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
const W = 0xffffff; // white = "tint me with the instance colour"
const GLASS = 0x3e5f7a;
const DARK = 0x4a4a4a;
const WOOD = 0x7a5232;

export interface DesignParts {
  walls: THREE.BufferGeometry;
  accent: THREE.BufferGeometry;
  fixed: THREE.BufferGeometry;
}

/** Collects parts into the three buckets, then merges each bucket. */
class Builder {
  walls: THREE.BufferGeometry[] = [];
  accent: THREE.BufferGeometry[] = [];
  fixed: THREE.BufferGeometry[] = [];
  wall(g: THREE.BufferGeometry, pos: [number, number, number] = [0, 0, 0], rot?: [number, number, number]) {
    this.walls.push(part(g, W, pos, rot));
  }
  acc(g: THREE.BufferGeometry, pos: [number, number, number] = [0, 0, 0], rot?: [number, number, number]) {
    this.accent.push(part(g, W, pos, rot));
  }
  fix(g: THREE.BufferGeometry, color: number, pos: [number, number, number] = [0, 0, 0], rot?: [number, number, number]) {
    this.fixed.push(part(g, color, pos, rot));
  }
  /** A row of `n` small windows on the front (+z) face at height y. */
  windows(n: number, width: number, depth: number, y: number, color = GLASS, size = 0.09) {
    for (let k = 0; k < n; k++) {
      const x = -width / 2 + (width * (k + 0.5)) / n;
      this.fix(box(size, size * 1.1, 0.02), color, [x, y, depth / 2 + 0.005]);
    }
  }
  /** Windows on the right (+x) face too, so corners don't look blank. */
  sideWindows(n: number, width: number, depth: number, y: number, color = GLASS) {
    for (let k = 0; k < n; k++) {
      const z = -depth / 2 + (depth * (k + 0.5)) / n;
      this.fix(box(0.02, 0.1, 0.09), color, [width / 2 + 0.005, y, z]);
    }
  }
  done(): DesignParts {
    // An empty bucket still needs a geometry; use a degenerate tiny box.
    const safe = (a: THREE.BufferGeometry[]) => merge(a.length ? a : [part(box(0.001, 0.001, 0.001), W, [0, -1, 0])]);
    return { walls: safe(this.walls), accent: safe(this.accent), fixed: safe(this.fixed) };
  }
}

const FLOOR = 0.26; // height of one storey

// ----------------------------------------------------------------------------
// Residential: cottages to small apartment blocks
// ----------------------------------------------------------------------------
function residential(k: number, level: number): DesignParts {
  const b = new Builder();
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
  return b.done();
}
const f0 = (level: number) => level === 1;

// ----------------------------------------------------------------------------
// Commercial: corner shops to office blocks
// ----------------------------------------------------------------------------
function commercial(k: number, level: number): DesignParts {
  const b = new Builder();
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
  return b.done();
}

// ----------------------------------------------------------------------------
// Industrial: workshops to heavy plants
// ----------------------------------------------------------------------------
function industrial(k: number, level: number): DesignParts {
  const b = new Builder();
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
  return b.done();
}

/** Build all designs: result[zone][design][level-1]. */
export function buildDesigns(): Record<ZoneType, DesignParts[][]> {
  const make = (fn: (k: number, level: number) => DesignParts) =>
    Array.from({ length: DESIGNS_PER_ZONE }, (_, k) => [1, 2, 3].map((lv) => fn(k, lv)));
  return { residential: make(residential), commercial: make(commercial), industrial: make(industrial) };
}

// ----------------------------------------------------------------------------
// Palettes and deterministic picking
// ----------------------------------------------------------------------------
const WALLS: Record<ZoneType, number[]> = {
  residential: [0xf3ead8, 0xf6e3a8, 0xcfe0ec, 0xd5e3c4, 0xf0d2c4, 0xffffff, 0xd9a58a],
  commercial: [0xf1f3f5, 0xd6dbe0, 0xcdebd9, 0xf6dcc2, 0xe2d6f0],
  industrial: [0xd8ccb4, 0xb8bdc2, 0xc7b08f, 0xbfcab3, 0xd2bfa8],
};
const ACCENTS: Record<ZoneType, number[]> = {
  residential: [0xc8553d, 0x8a5a44, 0x5b6770, 0x4f7a4a, 0xb8643f, 0x4c5d7a],
  commercial: [0xd94a4a, 0x3c8dde, 0x3fa66b, 0xf08a3c, 0x2bb3b1, 0x8d6bd6],
  industrial: [0xb5543c, 0x5e6266, 0x3d8f8a, 0xa8743f, 0x7d8a9a],
};

export interface Look {
  design: number;
  wall: number;
  accent: number;
}

function rawDesign(x: number, z: number, seed: number): number {
  return Math.floor(hash2(x, z, seed + 101) * DESIGNS_PER_ZONE);
}

export function pickLook(zone: ZoneType, x: number, z: number, seed: number): Look {
  let design = rawDesign(x, z, seed);
  // Neighbour rule: never the same design as the raw pick of the tile to the
  // west or north, so adjacent buildings differ.
  const west = rawDesign(x - 1, z, seed);
  const north = rawDesign(x, z - 1, seed);
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
