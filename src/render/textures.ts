/**
 * render/textures.ts — V1.5b INDUSTRIAL TEXTURE ATLAS (Parker: "cool
 * procedural textures: corrugated metal, brick, concrete, rust/stains,
 * hazard stripes, rooftop vents, signage").
 *
 * One 512×384 seeded canvas holds 12 grey-scale-ish SURFACES in a 4×3 grid (8 industrial + 4 for homes)
 * (128 px cells). Industrial geometry keeps Three.js primitive UVs (0..1
 * per face); `skinned()` squeezes each part's UVs into its surface's cell,
 * so ONE material (map × vertex colour × instance colour) textures every
 * industrial model and instancing is unchanged — still one draw call per
 * model. Surfaces are mostly light so the vertex colour still decides the
 * hue (a red brick wall stays red, a blue shed stays blue).
 *
 * Seeded with sim/random seededStream → identical on every machine.
 */
import * as THREE from 'three';
import { seededStream } from '../sim/random';

export enum Skin { Plain = 0, Metal = 1, Brick = 2, Concrete = 3, Rust = 4, Hazard = 5, Roof = 6, Glass = 7, Siding = 8, Stucco = 9, Shingle = 10, Boards = 11 }
const COLS = 4, ROWS = 3, CELL = 128, INSET = 0.04;

/** Tag a geometry with the surface it should use (applied by `skinned`). */
export function skin<T extends THREE.BufferGeometry>(g: T, s: Skin): T {
  g.userData.skin = s;
  return g;
}

/** Remap a part's UVs (0..1) into its atlas cell. Untagged parts get `def`. */
export function remapUV(g: THREE.BufferGeometry, s: Skin): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return g;
  const col = s % COLS, row = Math.floor(s / COLS);
  for (let k = 0; k < uv.count; k++) {
    const u = Math.min(1, Math.max(0, uv.getX(k))), v = Math.min(1, Math.max(0, uv.getY(k)));
    uv.setXY(k, (col + INSET + u * (1 - 2 * INSET)) / COLS, (ROWS - 1 - row + INSET + v * (1 - 2 * INSET)) / ROWS);
  }
  uv.needsUpdate = true;
  return g;
}
/** Remap every part (tag or `def`) — call on the part list BEFORE merging. */
export function skinned(parts: THREE.BufferGeometry[], def: Skin = Skin.Plain): THREE.BufferGeometry[] {
  for (const p of parts) remapUV(p, (p.userData.skin as Skin | undefined) ?? def);
  return parts;
}

let atlas: THREE.CanvasTexture | null = null;
/** The shared atlas (built once, lazily — needs a DOM canvas). */
export function industrialAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const cv = document.createElement('canvas');
  cv.width = COLS * CELL; cv.height = ROWS * CELL;
  const g = cv.getContext('2d')!;
  const rnd = seededStream(0x1b5a7c);
  const cell = (s: Skin, draw: (x0: number, y0: number) => void) => {
    const x0 = (s % COLS) * CELL, y0 = Math.floor(s / COLS) * CELL;
    g.save(); g.beginPath(); g.rect(x0, y0, CELL, CELL); g.clip(); draw(x0, y0); g.restore();
  };
  const grey = (v: number, a = 1) => `rgba(${v},${v},${v},${a})`;
  const speckle = (x0: number, y0: number, n: number, lo: number, hi: number) => {
    for (let i = 0; i < n; i++) { g.fillStyle = grey(lo + Math.floor(rnd() * (hi - lo))); g.fillRect(x0 + rnd() * CELL, y0 + rnd() * CELL, 1 + rnd() * 2, 1 + rnd() * 2); }
  };
  const stains = (x0: number, y0: number, n: number, color: string) => {
    for (let i = 0; i < n; i++) {
      const x = x0 + rnd() * CELL, len = 20 + rnd() * 60, w = 2 + rnd() * 6;
      const grd = g.createLinearGradient(x, y0, x, y0 + len);
      grd.addColorStop(0, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(x, y0 + rnd() * 20, w, len);
    }
  };
  // 0 Plain: fine grain (matches the city's standard look).
  cell(Skin.Plain, (x0, y0) => { g.fillStyle = grey(244); g.fillRect(x0, y0, CELL, CELL); speckle(x0, y0, 260, 222, 255); });
  // 1 Corrugated metal: vertical ribs with highlights + light streaks.
  cell(Skin.Metal, (x0, y0) => {
    g.fillStyle = grey(236); g.fillRect(x0, y0, CELL, CELL);
    for (let x = 0; x < CELL; x += 8) { g.fillStyle = grey(206); g.fillRect(x0 + x, y0, 3, CELL); g.fillStyle = grey(252); g.fillRect(x0 + x + 4, y0, 2, CELL); }
    stains(x0, y0, 6, 'rgba(120,110,100,0.25)');
    g.fillStyle = grey(190); g.fillRect(x0, y0 + 60, CELL, 2); // panel seam
  });
  // 2 Brick: running bond with mortar lines and a few darker bricks.
  cell(Skin.Brick, (x0, y0) => {
    g.fillStyle = grey(250); g.fillRect(x0, y0, CELL, CELL);
    for (let r = 0; r < CELL / 8; r++) for (let c = -1; c < CELL / 16 + 1; c++) {
      const x = x0 + c * 16 + (r % 2) * 8, y = y0 + r * 8, v = 205 + Math.floor(rnd() * 40);
      g.fillStyle = grey(v); g.fillRect(x + 1, y + 1, 14, 6);
    }
    stains(x0, y0, 3, 'rgba(60,60,60,0.18)');
  });
  // 3 Concrete: tilt-up panels with tie holes, mottling and water stains.
  cell(Skin.Concrete, (x0, y0) => {
    g.fillStyle = grey(232); g.fillRect(x0, y0, CELL, CELL); speckle(x0, y0, 500, 205, 250);
    for (let x = 0; x < CELL; x += 32) { g.fillStyle = grey(196); g.fillRect(x0 + x, y0, 2, CELL); }
    for (let x = 8; x < CELL; x += 16) for (let y = 12; y < CELL; y += 40) { g.fillStyle = grey(180); g.fillRect(x0 + x, y0 + y, 2, 2); }
    stains(x0, y0, 7, 'rgba(90,90,90,0.22)');
  });
  // 4 Rusty metal: ribs plus orange-brown rust blooms and streaks.
  cell(Skin.Rust, (x0, y0) => {
    g.fillStyle = grey(226); g.fillRect(x0, y0, CELL, CELL);
    for (let x = 0; x < CELL; x += 8) { g.fillStyle = grey(196); g.fillRect(x0 + x, y0, 3, CELL); }
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(${150 + rnd() * 50},${80 + rnd() * 30},${40 + rnd() * 20},${0.25 + rnd() * 0.3})`; g.beginPath(); g.arc(x0 + rnd() * CELL, y0 + rnd() * CELL, 2 + rnd() * 9, 0, Math.PI * 2); g.fill(); }
    stains(x0, y0, 9, 'rgba(140,70,30,0.35)');
  });
  // 5 Hazard stripes (yellow/black diagonal) — doors, kerbs, bollards.
  cell(Skin.Hazard, (x0, y0) => {
    g.fillStyle = '#f2c230'; g.fillRect(x0, y0, CELL, CELL);
    g.fillStyle = '#26262a';
    for (let k = -CELL; k < CELL * 2; k += 24) { g.beginPath(); g.moveTo(x0 + k, y0); g.lineTo(x0 + k + 12, y0); g.lineTo(x0 + k + 12 - CELL, y0 + CELL); g.lineTo(x0 + k - CELL, y0 + CELL); g.fill(); }
  });
  // 6 Roof: bitumen membrane with seams, patches and small vent caps.
  cell(Skin.Roof, (x0, y0) => {
    g.fillStyle = grey(214); g.fillRect(x0, y0, CELL, CELL); speckle(x0, y0, 400, 180, 230);
    for (let y = 0; y < CELL; y += 22) { g.fillStyle = grey(188); g.fillRect(x0, y0 + y, CELL, 1); }
    for (let i = 0; i < 6; i++) { g.fillStyle = grey(170 + rnd() * 30); g.fillRect(x0 + rnd() * 110, y0 + rnd() * 110, 10 + rnd() * 14, 8 + rnd() * 10); }
    for (let i = 0; i < 5; i++) { const x = x0 + 10 + rnd() * 108, y = y0 + 10 + rnd() * 108; g.fillStyle = grey(120); g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); g.fillStyle = grey(240); g.beginPath(); g.arc(x - 1, y - 1, 1.2, 0, Math.PI * 2); g.fill(); }
  });
  // 7 Glass / window grid: mullions over a dark gradient (offices, control rooms).
  cell(Skin.Glass, (x0, y0) => {
    const grd = g.createLinearGradient(x0, y0, x0 + CELL, y0 + CELL); grd.addColorStop(0, grey(200)); grd.addColorStop(1, grey(150));
    g.fillStyle = grd; g.fillRect(x0, y0, CELL, CELL);
    g.fillStyle = grey(245);
    for (let x = 0; x < CELL; x += 21) g.fillRect(x0 + x, y0, 3, CELL);
    for (let y = 0; y < CELL; y += 32) g.fillRect(x0, y0 + y, CELL, 3);
  });
  // 8 Clapboard siding: horizontal boards with a shadow line under each and wood grain.
  cell(Skin.Siding, (x0, y0) => {
    g.fillStyle = grey(244); g.fillRect(x0, y0, CELL, CELL);
    for (let y = 0; y < CELL; y += 12) {
      g.fillStyle = grey(232); g.fillRect(x0, y0 + y, CELL, 8);
      g.fillStyle = grey(255); g.fillRect(x0, y0 + y, CELL, 2);
      g.fillStyle = grey(176); g.fillRect(x0, y0 + y + 9, CELL, 3);
      for (let i = 0; i < 4; i++) { g.fillStyle = grey(210 + Math.floor(rnd() * 30)); g.fillRect(x0 + rnd() * CELL, y0 + y + 2 + rnd() * 6, 10 + rnd() * 30, 1); }
    }
  });
  // 9 Stucco: rough render with soft trowel patches and fine pitting.
  cell(Skin.Stucco, (x0, y0) => {
    g.fillStyle = grey(240); g.fillRect(x0, y0, CELL, CELL);
    for (let i = 0; i < 30; i++) { g.fillStyle = grey(226 + Math.floor(rnd() * 28), 0.5); g.beginPath(); g.arc(x0 + rnd() * CELL, y0 + rnd() * CELL, 6 + rnd() * 16, 0, Math.PI * 2); g.fill(); }
    speckle(x0, y0, 700, 196, 255);
    stains(x0, y0, 4, 'rgba(110,100,90,0.16)');
  });
  // 10 Roof shingles: staggered rows of rounded tiles, each a slightly different grey.
  cell(Skin.Shingle, (x0, y0) => {
    g.fillStyle = grey(150); g.fillRect(x0, y0, CELL, CELL);
    for (let r = 0; r < CELL / 10; r++) for (let c = -1; c < CELL / 14 + 1; c++) {
      const x = x0 + c * 14 + (r % 2) * 7, y = y0 + r * 10, v = 196 + Math.floor(rnd() * 56);
      g.fillStyle = grey(v); g.fillRect(x + 1, y + 1, 12, 8);
      g.fillStyle = grey(v - 46); g.fillRect(x + 1, y + 8, 12, 2); // shadow under the tile
    }
  });
  // 11 Boards: vertical planks with grain, knots and gaps.
  cell(Skin.Boards, (x0, y0) => {
    g.fillStyle = grey(170); g.fillRect(x0, y0, CELL, CELL);
    for (let x = 0; x < CELL; x += 16) {
      const v = 214 + Math.floor(rnd() * 34);
      g.fillStyle = grey(v); g.fillRect(x0 + x + 1, y0, 14, CELL);
      for (let i = 0; i < 6; i++) { g.fillStyle = grey(v - 26 + Math.floor(rnd() * 14)); g.fillRect(x0 + x + 2 + rnd() * 11, y0 + rnd() * CELL, 1, 12 + rnd() * 40); }
      if (rnd() < 0.5) { g.fillStyle = grey(v - 60); g.beginPath(); g.arc(x0 + x + 8, y0 + rnd() * CELL, 2.2, 0, Math.PI * 2); g.fill(); }
    }
  });
  atlas = new THREE.CanvasTexture(cv);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

/**
 * V1.5b: pick a surface from a vertex colour (used on MERGED models where
 * per-part tags are gone). Reds/terracotta → brick, orange-browns → rust,
 * saturated yellows → hazard stripes, greys by lightness → roof (dark) /
 * corrugated metal (mid) / concrete (light), pale blues → glass, else plain.
 */
const HSL = { h: 0, s: 0, l: 0 };
export function skinForColor(c: THREE.Color): Skin {
  c.getHSL(HSL, THREE.SRGBColorSpace); // judge in display (sRGB) space
  const { h, s, l } = HSL;
  if (s > 0.55 && l > 0.4 && h > 0.1 && h < 0.17) return Skin.Hazard;
  if (s > 0.25 && l > 0.2 && l < 0.6 && (h < 0.045 || h > 0.96)) return Skin.Brick;
  if (s > 0.3 && l > 0.15 && l < 0.5 && h >= 0.045 && h <= 0.1) return Skin.Rust;
  if (s > 0.35 && l > 0.6 && h > 0.53 && h < 0.62) return Skin.Glass;
  if (s < 0.14) return l < 0.4 ? Skin.Roof : l < 0.64 ? Skin.Metal : l < 0.9 ? Skin.Concrete : Skin.Plain;
  return Skin.Plain;
}

/**
 * V1.5b: texture a merged geometry in place — every triangle gets the
 * surface of its (first) vertex colour, or `force` for all of it (zone
 * designs whose white walls are painted by the instance colour).
 * Non-indexed geometry only (part()/merge() output). Returns the geometry.
 */
export function autoSkin(g: THREE.BufferGeometry, force?: Skin): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!uv || g.index) return g;
  const c = new THREE.Color();
  for (let t = 0; t + 2 < uv.count; t += 3) {
    let s = force;
    if (s === undefined) { if (!col) s = Skin.Plain; else { c.setRGB(col.getX(t), col.getY(t), col.getZ(t)); s = skinForColor(c); } }
    const cx = s % COLS, row = Math.floor(s / COLS);
    for (let k = t; k < t + 3; k++) {
      const u = Math.min(1, Math.max(0, uv.getX(k))), v = Math.min(1, Math.max(0, uv.getY(k)));
      uv.setXY(k, (cx + INSET + u * (1 - 2 * INSET)) / COLS, (ROWS - 1 - row + INSET + v * (1 - 2 * INSET)) / ROWS);
    }
  }
  uv.needsUpdate = true;
  return g;
}

let indMat: THREE.MeshLambertMaterial | null = null;
/** The shared textured industrial material (atlas × vertex colour × instance colour). */
export function industrialMaterial(): THREE.MeshLambertMaterial {
  return (indMat ??= new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: industrialAtlas() }));
}

/**
 * V1.6: texture a merged geometry with TRIPLANAR UVs — each triangle takes
 * the surface `s` and projects the model's bounding box onto it along the
 * triangle's dominant normal axis, so walls, roof slopes and gables all get
 * an even texture density whatever their own UVs were (extruded gable roofs
 * have none that are usable). Non-indexed geometry only.
 */
export function skinProjected(g: THREE.BufferGeometry, s: Skin): THREE.BufferGeometry {
  if (g.index) return g;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const sz = [bb.max.x - bb.min.x || 1, bb.max.y - bb.min.y || 1, bb.max.z - bb.min.z || 1];
  const uv = new Float32Array(pos.count * 2);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
  const cx = s % COLS, row = Math.floor(s / COLS);
  for (let t = 0; t + 2 < pos.count; t += 3) {
    A.fromBufferAttribute(pos, t); B.fromBufferAttribute(pos, t + 1); C.fromBufferAttribute(pos, t + 2);
    N.subVectors(B, A).cross(C.sub(A));
    const ax = Math.abs(N.x), ay = Math.abs(N.y), az = Math.abs(N.z);
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(t + k), y = pos.getY(t + k), z = pos.getZ(t + k);
      let u: number, v: number;
      if (ay >= ax && ay >= az) { u = (x - bb.min.x) / sz[0]; v = (z - bb.min.z) / sz[2]; }
      else if (ax >= az) { u = (z - bb.min.z) / sz[2]; v = (y - bb.min.y) / sz[1]; }
      else { u = (x - bb.min.x) / sz[0]; v = (y - bb.min.y) / sz[1]; }
      u = Math.min(1, Math.max(0, u)); v = Math.min(1, Math.max(0, v));
      uv[(t + k) * 2] = (cx + INSET + u * (1 - 2 * INSET)) / COLS;
      uv[(t + k) * 2 + 1] = (ROWS - 1 - row + INSET + v * (1 - 2 * INSET)) / ROWS;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * Surfaces for the low-density HOMES (zone designs 0–7, levels 1–3):
 * walls get siding / stucco / boards by design, roofs (accent) get shingles.
 * Trim and details stay colour-picked (autoSkin).
 */
const HOME_WALL: Skin[] = [Skin.Siding, Skin.Siding, Skin.Stucco, Skin.Boards, Skin.Boards, Skin.Siding, Skin.Brick, Skin.Stucco];
export function texturedHome(parts: { walls: THREE.BufferGeometry; accent: THREE.BufferGeometry; fixed: THREE.BufferGeometry }, k: number, flatRoof = k === 2 || k === 7): void {
  skinProjected(parts.walls, HOME_WALL[k % HOME_WALL.length]);
  skinProjected(parts.accent, flatRoof ? Skin.Roof : Skin.Shingle);
  autoSkin(parts.fixed);
}
