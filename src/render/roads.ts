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

/** Deck height of bridges (vehicles and poles are lifted by this much). */
export const BRIDGE_Y = 0.12;
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

export const ROADS = {
  /** Flat asphalt square for straight/junction tiles. */
  square: () => merge([part(box(1, 0.04, 1), ASPHALT)]),
  /** Curved corner: asphalt quarter ring, yellow centreline arc, two curved kerbs. */
  curve: () =>
    merge([
      part(arc(0.06, 0.94, 0, 0.04), ASPHALT),
      part(arc(0.485, 0.515, 0.04, 0.006), 0xf2e6a0),
      part(arc(0.9, 0.995, 0.04, 0.018), KERB), // outer kerb
      part(arc(0.0, 0.1, 0.04, 0.018), KERB), // inner kerb
    ]),
  /** Sidewalk strip along the tile's north edge (rotated for the others). */
  sidewalk: () => merge([part(box(1, 0.018, 0.1), KERB, [0, 0.04, -0.45])]),
  /** Avenue markings for an east-west avenue: double yellow median + white lane dashes. */
  avenueMarks: () => {
    const parts = [part(box(1, 0.008, 0.025), 0xf2d16b, [0, 0.04, -0.025]), part(box(1, 0.008, 0.025), 0xf2d16b, [0, 0.04, 0.025])];
    for (const z of [-0.24, 0.24]) for (const x of [-0.25, 0.25]) parts.push(part(box(0.2, 0.008, 0.03), 0xf4f4f4, [x, 0.04, z]));
    return merge(parts);
  },
  /** Bridge deck square (lifted) with a stone pier underneath. */
  bridgeDeck: () =>
    merge([
      part(box(1, 0.05, 1), 0x6b7078, [0, BRIDGE_Y - 0.01, 0]),
      part(box(1, 0.04, 0.96), ASPHALT, [0, BRIDGE_Y, 0]),
      part(box(0.18, BRIDGE_Y, 0.5), 0x9b968a, [0, -0.02, 0]), // pier
    ]),
  /** Railing along a bridge's north edge: posts + top rail. */
  railing: () => {
    const parts = [part(box(1, 0.02, 0.03), 0xe8e4da, [0, BRIDGE_Y + 0.1, -0.47])];
    for (const x of [-0.4, -0.13, 0.13, 0.4]) parts.push(part(box(0.025, 0.1, 0.025), 0xe8e4da, [x, BRIDGE_Y + 0.02, -0.47]));
    return merge(parts);
  },
  /**
   * Highway stub that continues OFF the map from the edge tile, along +x in
   * model space: 3 tiles of road on an embankment, plus a green highway sign.
   */
  highway: () =>
    merge([
      part(box(3, 0.6, 1.1), 0x7d6a52, [1.5, -0.56, 0]), // embankment
      part(box(3, 0.04, 1), ASPHALT, [1.5, 0, 0]),
      part(box(3, 0.008, 0.03), 0xf2d16b, [1.5, 0.04, 0]),
      part(box(0.03, 0.55, 0.03), 0x8a8f96, [0.4, 0, 0.52]),
      part(box(0.03, 0.22, 0.5), 0x1f7a3d, [0.4, 0.5, 0.52]),
      part(box(0.034, 0.03, 0.3), 0xffffff, [0.4, 0.6, 0.52]),
    ]),
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
