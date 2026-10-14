/**
 * render/roads.ts — PR 4 road, avenue, bridge and highway geometry.
 *
 * Every road tile is drawn from a few instanced pieces chosen by looking at
 * which of its 4 neighbours are also roads:
 *
 *   - CORNER tiles (exactly two neighbours, at right angles) get a CURVED
 *     piece: a quarter ring of asphalt centred on the tile corner between
 *     the two exits. The ring's centreline has radius 0.5, so it meets the
 *     middle of both tile edges exactly where the straight neighbours end.
 *   - Every other tile (straight, T, crossroads, dead end) gets a flat
 *     square of asphalt.
 *   - SIDEWALKS (visual only): a raised kerb strip along each tile edge that
 *     has no road beyond it. Corner tiles get curved kerbs instead.
 *   - AVENUES (roadType 1) use darker asphalt with a double yellow median and
 *     white lane dashes.
 *   - BRIDGES: a road on a water tile is lifted to BRIDGE_Y and gets railings
 *     instead of sidewalks plus a pier underneath.
 *
 * CURVE ORIENTATION: the base curve connects the +x (east) and +z (south)
 * edges. rotateY(a) maps +x → (cos a, 0, −sin a) and +z → (sin a, 0, cos a),
 * so quarter turns give the other three corners:
 *    0 → E+S,   π/2 → N+E,   π → W+N,   3π/2 → S+W
 */
import * as THREE from 'three';
import { box, merge, part } from './models';

/**
 * Deck (asphalt top) height of bridges. PR 5 bridge rebuild: raised from 0.12
 * to 0.32 so the deck clearly floats above the water (surface ≈ 0.044) with
 * room for girders, a pier cap and visible air underneath. Vehicles, poles and
 * signals on bridge tiles are lifted to this height (see surfaceY below).
 */
export const BRIDGE_Y = 0.32;
/** Height of the normal road surface (top of the 0.04 asphalt slab). */
export const ROAD_Y = 0.04;
/** Half-width of the carriageway on bridges/ramps (sidewalks sit outside it). */
const DECK_HALF = 0.36;
const ASPHALT = 0x50555e;
const KERB = 0xc9c6bf;

/**
 * A flat quarter ring around (0.5, 0.5) between radii r0..r1, lying on y.
 * RingGeometry is drawn in the XY plane; rotateX(−π/2) lays it flat, mapping
 * the angle θ to the direction (cos θ, −sin θ) on the ground. θ from π/2 to π
 * covers directions (0,−1) → (−1,0): pointing back into the tile from its
 * south-east corner, which is exactly the quarter we need.
 */
function arc(r0: number, r1: number, y: number, h: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const N = 12;
  for (let k = 0; k <= N; k++) {
    const th = Math.PI / 2 + (k / N) * (Math.PI / 2);
    const px = Math.cos(th) * r1, py = Math.sin(th) * r1;
    if (k === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
  }
  for (let k = N; k >= 0; k--) {
    const th = Math.PI / 2 + (k / N) * (Math.PI / 2);
    shape.lineTo(Math.cos(th) * r0, Math.sin(th) * r0);
  }
  // Extrude gives the piece a little thickness so its edge catches light.
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); // extrusion now points up (+y)
  g.translate(0.5, y, 0.5);
  return g;
}

/**
 * PR 5: a sidewalk/kerb cross-section with chamfered (bevelled) edges,
 * extruded 1 unit along x. Profile in the (z, y) plane, from the road side
 * (z = zIn) to the outer edge (z = zOut): a raised kerb lip, then the
 * walking surface. The 45° chamfers catch the light so the edge reads
 * as a real kerb instead of a flat strip.
 */
function kerbProfile(zIn: number, zOut: number, y0: number, hgt: number, ch = 0.008): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(zIn, y0);
  sh.lineTo(zIn, y0 + hgt - ch);
  sh.lineTo(zIn - ch * Math.sign(zIn - zOut), y0 + hgt); // chamfer on the road-side top edge
  sh.lineTo(zOut + ch * Math.sign(zIn - zOut), y0 + hgt);
  sh.lineTo(zOut, y0 + hgt - ch); // chamfer on the outer edge
  sh.lineTo(zOut, y0);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
  // Shape x → world z, shape y → world y, extrusion (shape z) → world x.
  g.rotateY(Math.PI / 2);
  g.translate(-0.5, 0, 0);
  return g;
}

const PAINT = 0xf4f4f4;
const YELLOW = 0xf2d16b;

export const ROADS = {
  /**
   * Flat asphalt square for straight/junction tiles. PR 5: subdivided slab
   * (so the flat-shaded surface isn't one giant quad) plus two slightly
   * darker repair patches for a worn look.
   */
  square: () =>
    merge([
      part(new THREE.BoxGeometry(1, 0.04, 1, 2, 1, 2).translate(0, 0.02, 0), ASPHALT),
      part(box(0.22, 0.004, 0.14), 0x484c54, [0.18, 0.04, 0.27]),
      part(box(0.12, 0.004, 0.2), 0x585c64, [-0.3, 0.04, -0.12]),
    ]),
  /**
   * Curved corner: asphalt quarter ring, yellow centreline arc, two curved
   * kerbs. PR 5: kerbs get a lighter chamfer cap and the lane edges get
   * white painted arcs.
   */
  curve: () =>
    merge([
      part(arc(0.06, 0.94, 0, 0.04), ASPHALT),
      part(arc(0.485, 0.515, 0.04, 0.006), 0xf2e6a0),
      part(arc(0.16, 0.175, 0.04, 0.004), PAINT), // inner edge line
      part(arc(0.825, 0.84, 0.04, 0.004), PAINT), // outer edge line
      part(arc(0.9, 0.995, 0.04, 0.018), KERB), // outer kerb
      part(arc(0.9, 0.915, 0.058, 0.004), 0xdedbd4), // its kerb-stone cap
      part(arc(0.0, 0.1, 0.04, 0.018), KERB), // inner kerb
      part(arc(0.085, 0.1, 0.058, 0.004), 0xdedbd4),
    ]),
  /**
   * Sidewalk strip along the tile's north edge (rotated for the others).
   * PR 5: bevelled kerb stone + bevelled pavement, a dark gutter line at the
   * kerb foot, and expansion joints across the pavement.
   */
  sidewalk: () => {
    const parts = [
      part(kerbProfile(-0.4, -0.5, 0.04, 0.02), KERB), // walking surface
      part(kerbProfile(-0.39, -0.41, 0.04, 0.026, 0.006), 0xdedbd4), // kerb stone (a bit higher)
      part(box(1, 0.004, 0.02), 0x3f434a, [0, 0.04, -0.38]), // gutter
    ];
    for (const x of [-0.25, 0, 0.25]) parts.push(part(box(0.006, 0.004, 0.09), 0xa9a69f, [x, 0.06, -0.455]));
    return merge(parts);
  },
  /**
   * Avenue markings for an east-west avenue: double yellow median, white
   * lane dashes (PR 5: twice as many, shorter) and solid white edge lines.
   */
  avenueMarks: () => {
    const parts = [part(box(1, 0.008, 0.025), YELLOW, [0, 0.04, -0.025]), part(box(1, 0.008, 0.025), YELLOW, [0, 0.04, 0.025])];
    for (const z of [-0.24, 0.24]) for (const x of [-0.375, -0.125, 0.125, 0.375]) parts.push(part(box(0.12, 0.008, 0.03), PAINT, [x, 0.04, z]));
    for (const z of [-0.36, 0.36]) parts.push(part(box(1, 0.008, 0.02), PAINT, [0, 0.04, z]));
    return merge(parts);
  },
  /**
   * PR 5 street paint: three short centre dashes + white edge lines on both
   * sides (replaces MODELS.roadDash for streets).
   */
  streetMarks: () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const x of [-0.333, 0, 0.333]) parts.push(part(box(0.16, 0.012, 0.045), 0xf2e6a0, [x, 0.04, 0]));
    for (const z of [-0.33, 0.33]) parts.push(part(box(1, 0.008, 0.018), PAINT, [0, 0.04, z]));
    return merge(parts);
  },
  /**
   * PR 5 zebra crossing on the NORTH side of a junction tile (rotated for the
   * others): six white bars across the road plus a stop line.
   */
  crosswalk: () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 6; k++) parts.push(part(box(0.07, 0.008, 0.14), PAINT, [-0.3 + k * 0.12, 0.041, -0.41]));
    return merge(parts);
  },
  /**
   * PR 5 stop line, on the tile BEFORE a junction whose north (−z) edge
   * touches the junction (rotated for the other sides). It spans only the
   * approaching lane — for a car heading north the right-hand lane is the
   * east (+x) half — and sits just behind the junction's crosswalk.
   * Its top (y 0.050) is above the other paint (≤ 0.048 where they can
   * overlap) and the asphalt (0.040), so nothing z-fights.
   */
  stopLine: () => merge([part(box(0.43, 0.01, 0.045), PAINT, [0.235, 0.04, -0.455])]),
  /** PR 5 manhole cover: an iron disc with a rim and a cross-hatch bar. */
  manhole: () =>
    merge([
      part(new THREE.CylinderGeometry(0.06, 0.06, 0.006, 14).translate(0, 0.043, 0), 0x3a3d42),
      part(new THREE.CylinderGeometry(0.066, 0.066, 0.004, 14, 1, true).translate(0, 0.043, 0), 0x6a6d72),
      part(box(0.1, 0.002, 0.012), 0x55585d, [0, 0.046, 0]),
      part(box(0.012, 0.002, 0.1), 0x55585d, [0, 0.046, 0]),
    ]),
  /** PR 5 storm drain grate in the gutter at the kerb (north side). */
  drain: () => {
    const parts = [part(box(0.12, 0.005, 0.035), 0x2c2f33, [0, 0.04, -0.375])];
    for (let k = 0; k < 4; k++) parts.push(part(box(0.008, 0.006, 0.03), 0x6a6d72, [-0.045 + k * 0.03, 0.041, -0.375]));
    return merge(parts);
  },
  // ------------------------------------------------------------------
  // PR 5 BRIDGES (rebuilt). A bridge is drawn from four instanced pieces:
  //
  //   bridgeSlab  – on EVERY water road tile: a 1×1 asphalt deck whose top is
  //                 exactly BRIDGE_Y, a thicker concrete deck beam under it
  //                 (so the edge reads as a real structure, not a sheet) and
  //                 steel girders running both ways (so turns/junctions look
  //                 right from any camera angle).
  //   bridgeEdge  – on each side of a bridge tile with NO road beyond it
  //                 (north edge in model space, rotated for the others): a
  //                 bevelled sidewalk, a concrete parapet with chamfered top,
  //                 posts and a steel hand rail, and an outer fascia that
  //                 hides the slab edge. Ends that meet the bank have a road
  //                 neighbour, so they stay open and continue into the ramp.
  //   bridgePier  – every other tile along a span (and under every turn or
  //                 junction tile): two round columns from the riverbed up
  //                 to a cap beam under the girders, with a pointed
  //                 "cutwater" footing at the water line.
  //   bridgeRamp  – on the LAND road tile next to a bridge end: a sloped
  //                 wedge rising from ROAD_Y at the far edge to BRIDGE_Y at
  //                 the bridge edge, with rising sidewalks, parapets and a
  //                 solid abutment face, so the road climbs smoothly onto
  //                 the deck. Modelled along +x (bridge on the +x side).
  //
  // No z-fighting: every visible surface sits at a different height or is
  // hidden inside another solid (slab top 0.32, sidewalk 0.32..0.34,
  // paint drawn by the road-marking pools at +0.004).
  // ------------------------------------------------------------------
  bridgeSlab: () => {
    const D = BRIDGE_Y;
    const parts = [
      part(new THREE.BoxGeometry(1, 0.05, 1, 2, 1, 2).translate(0, D - 0.025, 0), ASPHALT), // asphalt deck, top = D
      part(box(1, 0.06, 1), 0x8d9097, [0, D - 0.11, 0]), // concrete deck beam (0.21..0.27)
      // Steel girders under the deck, both directions (shared by straights, turns and crossings).
      part(box(1, 0.05, 0.05), 0x5a5f66, [0, D - 0.16, -0.26]),
      part(box(1, 0.05, 0.05), 0x5a5f66, [0, D - 0.16, 0.26]),
      part(box(0.05, 0.05, 1), 0x5a5f66, [-0.26, D - 0.16, 0]),
      part(box(0.05, 0.05, 1), 0x5a5f66, [0.26, D - 0.16, 0]),
    ];
    // Bottom flanges (thin wide plates) make the girders read as I-beams.
    for (const z of [-0.26, 0.26]) parts.push(part(box(1, 0.008, 0.09), 0x4b5056, [0, D - 0.165, z]));
    for (const x of [-0.26, 0.26]) parts.push(part(box(0.09, 0.008, 1), 0x4b5056, [x, D - 0.165, 0]));
    return merge(parts);
  },
  /** Sidewalk + parapet + rail + fascia on a bridge tile's NORTH edge. */
  bridgeEdge: () => {
    const D = BRIDGE_Y;
    const parts = [
      part(kerbProfile(-DECK_HALF, -0.46, D, 0.02), KERB), // sidewalk
      part(kerbProfile(-DECK_HALF + 0.005, -DECK_HALF - 0.015, D, 0.026, 0.006), 0xdedbd4), // kerb stone
      part(box(1, 0.004, 0.02), 0x3f434a, [0, D, -DECK_HALF + 0.015]), // gutter line
      part(kerbProfile(-0.455, -0.5, D, 0.07, 0.012), 0xb9b5ac), // parapet wall, chamfered
      part(box(1, 0.16, 0.02), 0x9a9da3, [0, D - 0.13, -0.505]), // fascia covering the slab edge
      part(box(1, 0.012, 0.02), 0x6f747b, [0, D + 0.135, -0.478]), // hand rail
      part(box(1, 0.008, 0.012), 0x6f747b, [0, D + 0.105, -0.478]), // mid rail
    ];
    for (const x of [-0.375, -0.125, 0.125, 0.375]) parts.push(part(box(0.022, 0.07, 0.022), 0x6f747b, [x, D + 0.07, -0.478])); // rail posts
    for (const x of [-0.25, 0, 0.25]) parts.push(part(box(0.006, 0.004, 0.08), 0xa9a69f, [x, D + 0.02, -0.41])); // pavement joints
    return merge(parts);
  },
  /** Twin-column pier from the riverbed to the girders, with cap beam and cutwater. */
  bridgePier: () => {
    const D = BRIDGE_Y;
    const top = D - 0.17; // underside of the girders
    const parts: THREE.BufferGeometry[] = [];
    for (const z of [-0.22, 0.22]) {
      parts.push(part(new THREE.CylinderGeometry(0.055, 0.065, top + 0.08, 12).translate(0, (top + 0.08) / 2 - 0.08, 0), 0xa8a397, [0, 0, z]));
    }
    parts.push(part(box(0.14, 0.05, 0.62), 0xbab5a8, [0, top - 0.05, 0])); // cap beam
    parts.push(part(box(0.18, 0.012, 0.66), 0xc8c3b6, [0, top - 0.002, 0])); // bearing plate
    // Cutwater footing: an elongated octagon that pokes out of the water (0.044) a little.
    parts.push(part(new THREE.CylinderGeometry(0.1, 0.12, 0.14, 8).scale(1, 1, 3.6).translate(0, -0.01, 0), 0x8e897d));
    return merge(parts);
  },
  /** Approach ramp on the bank tile, rising along +x to the bridge. */
  bridgeRamp: () => {
    const D = BRIDGE_Y;
    // Side profile in (x, y), extruded across z. The polygon's top edge is the slope.
    const wedge = (y0: number, y1: number, zA: number, zB: number, color: number) => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.5, 0);
      sh.lineTo(-0.5, y0);
      sh.lineTo(0.5, y1);
      sh.lineTo(0.5, 0);
      sh.closePath();
      // Extrude along +z by (zB − zA); shape x/y are already world x/y.
      const g = new THREE.ExtrudeGeometry(sh, { depth: zB - zA, bevelEnabled: false });
      g.translate(0, 0, zA);
      return part(g, color);
    };
    const parts = [
      wedge(ROAD_Y, D, -DECK_HALF, DECK_HALF, ASPHALT), // driving surface
      wedge(ROAD_Y + 0.02, D + 0.02, -0.46, -DECK_HALF, KERB), // sidewalks
      wedge(ROAD_Y + 0.02, D + 0.02, DECK_HALF, 0.46, KERB),
      wedge(ROAD_Y + 0.05, D + 0.07, -0.5, -0.46, 0xb9b5ac), // parapets / retaining walls
      wedge(ROAD_Y + 0.05, D + 0.07, 0.46, 0.5, 0xb9b5ac),
      part(box(0.04, D, 1), 0x9a9da3, [0.48, 0, 0]), // abutment face under the first span
    ];
    // Painted centre dashes following the slope (rotated about z by the ramp angle).
    const ang = Math.atan2(D - ROAD_Y, 1);
    for (const x of [-0.3, 0, 0.3]) {
      const y = ROAD_Y + (D - ROAD_Y) * (x + 0.5) + 0.002;
      parts.push(part(box(0.16, 0.006, 0.045), 0xf2e6a0, [x, y, 0], [0, 0, ang]));
    }
    return merge(parts);
  },
  /**
   * Highway stub that continues OFF the map from the edge tile, along +x in
   * model space: 3 tiles of road on an embankment, plus a green highway sign.
   * PR 5: white edge lines and a guard rail on posts.
   */
  highway: () => {
    const parts = [
      part(box(3, 0.6, 1.1), 0x7d6a52, [1.5, -0.56, 0]), // embankment
      part(box(3, 0.04, 1), ASPHALT, [1.5, 0, 0]),
      part(box(3, 0.008, 0.03), YELLOW, [1.5, 0.04, 0]),
      part(box(3, 0.008, 0.02), PAINT, [1.5, 0.04, -0.4]),
      part(box(3, 0.008, 0.02), PAINT, [1.5, 0.04, 0.4]),
      part(box(3, 0.025, 0.012), 0xb8bdc2, [1.5, 0.1, -0.5]), // guard rail
      part(box(0.03, 0.55, 0.03), 0x8a8f96, [0.4, 0, 0.52]),
      part(box(0.03, 0.22, 0.5), 0x1f7a3d, [0.4, 0.5, 0.52]),
      part(box(0.034, 0.03, 0.3), 0xffffff, [0.4, 0.6, 0.52]),
    ];
    for (let k = 0; k < 7; k++) parts.push(part(box(0.02, 0.1, 0.02), 0x8a8f96, [0.2 + k * 0.45, 0.02, -0.5]));
    return merge(parts);
  },
  /** Water surface tile (slightly below ground so banks read). */
  water: () => merge([part(box(1, 0.02, 1), 0x3d8ccc, [0, -0.012, 0])]),
};

/** Which quarter turn draws a curve for this pair of exits (or null if not a corner). */
export function curveYaw(n: boolean, e: boolean, s: boolean, w: boolean): number | null {
  if (n === s || e === w) return null; // not exactly one vertical + one horizontal exit
  if (+n + +e + +s + +w !== 2) return null;
  if (e && s) return 0;
  if (n && e) return Math.PI / 2;
  if (w && n) return Math.PI;
  return (3 * Math.PI) / 2; // s && w
}

/**
 * PR 5: the height of the driving surface at world point (wx, wz). Used by
 * vehicles (and anything else that must sit ON the road) so they follow the
 * bridge deck and climb the approach ramps:
 *   - water road tile (bridge)            → BRIDGE_Y
 *   - land road tile next to a bridge     → linear slope from ROAD_Y at the
 *     (ramp)                                 far edge to BRIDGE_Y at the edge
 *                                            touching the bridge (the highest
 *                                            of up to 4 neighbouring bridges)
 *   - anything else                       → ROAD_Y
 * This mirrors exactly how cityRenderer places bridgeRamp/bridgeSlab, so
 * wheels stay on the asphalt. Pure function of the tiles: no sim state.
 */
export function surfaceY(tiles: ReadonlyArray<{ road: boolean; water: boolean }>, gridSize: number, wx: number, wz: number): number {
  const x = Math.floor(wx), z = Math.floor(wz);
  if (x < 0 || z < 0 || x >= gridSize || z >= gridSize) return ROAD_Y;
  const t = tiles[z * gridSize + x];
  if (t.water) return BRIDGE_Y;
  if (!t.road) return ROAD_Y;
  const fx = wx - x, fz = wz - z; // 0..1 inside the tile
  let y = ROAD_Y;
  for (const [dx, dz, s] of [[1, 0, fx], [-1, 0, 1 - fx], [0, 1, fz], [0, -1, 1 - fz]] as const) {
    const nx = x + dx, nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= gridSize || nz >= gridSize) continue;
    const n = tiles[nz * gridSize + nx];
    if (n.road && n.water) y = Math.max(y, ROAD_Y + (BRIDGE_Y - ROAD_Y) * s);
  }
  return y;
}
