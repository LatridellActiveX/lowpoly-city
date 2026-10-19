/**
 * render/graphRoads.ts — V1.6 B6: DRAWING THE ROAD GRAPH.
 *
 * Freeform roads are extruded along their arc-length LUT with the B6
 * CROSS-SECTION (roads/graph.ts), per side from the centreline:
 *   median (avenues: two thin yellow lines) | lanes (6 m, thin white dashes
 *   between same-direction lanes, a thin dashed yellow centre line on
 *   streets) | shoulder (solid thin white edge line) | gutter (darker
 *   strip with drain grates) | kerb (raised, with a face) | sidewalk.
 * Asphalt carries a SUBTLE SEEDED TEXTURE: per-vertex brightness from a
 * hash of (edge birth, sample, column), so it never shimmers and a reload
 * draws the same road. Manholes sit in the lanes every ~45 m.
 *
 * JUNCTIONS (degree ≥ 3): an asphalt disc covers the box; sidewalks, kerbs,
 * gutters and markings stop at the box edge; every approach gets a zebra
 * CROSSWALK and a STOP LINE across its inbound lanes. Dead ends get a
 * round asphalt cap with a kerb ring.
 *
 * Everything static is merged into ONE vertex-coloured mesh (one draw
 * call), rebuilt only when world.roads.version changes.
 *
 * ZONE OVERLAY: the zone-block cells as one merged quad mesh, coloured by
 * zone code (grey = unzoned), shown while a zoning or free-road tool is on.
 * PREVIEW: an InstancedMesh of up to MAX_PREVIEW cells (green = new land,
 * amber = clipped against existing cells, red = invalid proposal) plus a
 * translucent ghost of the proposed road.
 * CARS: a GraphTraffic (roads/gtraffic.ts) runs on the freeform roads so
 * cars are drawn in their lanes, offset by the same lane geometry.
 *
 * Units: the scene uses 1 tile = 1 unit = TILE_M metres.
 */
import { Y_PREVIEW } from './previewHeights';
import * as THREE from 'three';
import { at, Cubic, tangent, tAtLength, V2, buildLut } from '../roads/bezier';
import { GUTTER_M, KERB_M, LANE_M, RoadGraph, RoadType, ROAD_SPEC, SHOULDER_M, SIDEWALK_M, TILE_M, roadHalf } from '../roads/graph';
import { ZoneBlocks } from '../roads/blocks';
import { GraphTraffic } from '../roads/gtraffic';
import type { Simulation } from '../sim/simulation';
import { GRID_SIZE } from '../sim/types';
import { CROSSWALK_ROOM, edgeTrims, JunctionPlan, planAll, Ring, rings } from '../roads/junctions';

const U = 1 / TILE_M;
const Y_ASPHALT = 0.041, Y_MARK = 0.0425, Y_KERB = 0.06, Y_WALK = 0.056, Y_ZONE = 0.064;
const C = {
  asphalt: new THREE.Color(0x4d525a), gutter: new THREE.Color(0x3c4047), kerb: new THREE.Color(0xd6d3cc), walk: new THREE.Color(0xb9b6ae),
  white: new THREE.Color(0xf2f2f2), yellow: new THREE.Color(0xf2d16b), manhole: new THREE.Color(0x34373c), drain: new THREE.Color(0x2a2c30),
};
export const MAX_PREVIEW = 8192; // NEBULA: rectangle zoning boxes can hold thousands of small cells
/** Thin paint: 0.15 m wide dashes (Parker: thinner lane dashes). */
const PAINT_W = 0.15, DASH = 3, GAP = 6;

const hash = (a: number, b: number, c: number) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Growable vertex/colour/index buffers. */
class Mesher {
  pos: number[] = []; col: number[] = []; idx: number[] = [];
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ca: THREE.Color, cb = ca, cc = cb, cd = ca): void {
    const n = this.pos.length / 3;
    for (const [p, k] of [[a, ca], [b, cb], [c, cc], [d, cd]] as const) { this.pos.push(p.x, p.y, p.z); this.col.push(k.r, k.g, k.b); }
    // Wind every flat quad counter-clockwise seen from above (normal +y), so
    // it is front-facing and lit from the sun whichever side of the road it
    // was generated on. Vertical quads (kerb faces) face away from the road.
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (ny <= 0) this.idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
    else this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  /** NEBULA: one flat triangle (double-sided material, so winding is irrelevant). */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col: THREE.Color): void {
    const n = this.pos.length / 3;
    for (const p of [a, b, c]) { this.pos.push(p.x, p.y, p.z); this.col.push(col.r, col.g, col.b); }
    this.idx.push(n, n + 1, n + 2);
  }
  /** NEBULA: flat ring (annulus) r0..r1 at height y — dead-end kerb / sidewalk caps. */
  ring(x: number, z: number, r0: number, r1: number, y: number, col: THREE.Color, seg = 24): void {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const P = (a: number, r: number) => new THREE.Vector3(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
      this.quad(P(a0, r0), P(a0, r1), P(a1, r1), P(a1, r0), col);
    }
  }
  disc(x: number, z: number, r: number, y: number, col: THREE.Color, seg = 24): void {
    const n = this.pos.length / 3;
    this.pos.push(x, y, z); this.col.push(col.r, col.g, col.b);
    for (let k = 0; k <= seg; k++) { const a = (k / seg) * Math.PI * 2; this.pos.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r); this.col.push(col.r, col.g, col.b); }
    for (let k = 0; k < seg; k++) this.idx.push(n, n + 2 + k, n + 1 + k);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx); g.computeVertexNormals();
    return g;
  }
}

/** Frame (point + left normal, metres) at arc length s of a curve. */
function frame(c: Cubic, lut: Float32Array, s: number): { p: V2; n: V2; d: V2 } {
  const t = tAtLength(lut, s), p = at(c, t), d = tangent(c, t);
  return { p, d, n: { x: -d.z, z: d.x } };
}
const v3 = (p: V2, n: V2, off: number, y: number) => new THREE.Vector3((p.x + n.x * off) * U, y, (p.z + n.z * off) * U);

/** Extrude one road (edge or ghost) into the mesher. trimA/trimB: where sidewalks etc. stop at junctions (m). */
/**
 * NEBULA: trimA/trimB now trim EVERYTHING, asphalt included — inside the trim
 * the junction plate (drawJunction) is the only surface, so nothing overlaps
 * or z-fights there. markA/markB: extra distance beyond the trim where lane
 * markings start (junction arms keep room for the crosswalk + stop line, so
 * no dash or edge line runs through them).
 */
export function extrude(m: Mesher, c: Cubic, lut: Float32Array, len: number, type: RoadType, seed: number, trimA: number, trimB: number, ghost = false, markA = 0, markB = 0): void {
  const sp = ROAD_SPEC[type], half = sp.width / 2, med = sp.median / 2;
  const aLen = Math.max(0.01, len - trimA - trimB);
  const n = Math.max(2, Math.ceil(aLen / 2));
  const S = (k: number) => trimA + (k / n) * aLen; // asphalt only between the trims
  const tmp = new THREE.Color();
  // Asphalt across the full width in 6 lateral columns, with seeded brightness.
  const cols = 6;
  for (let k = 0; k < n; k++) {
    const f0 = frame(c, lut, S(k)), f1 = frame(c, lut, S(k + 1));
    for (let j = 0; j < cols; j++) {
      const o0 = -half + (2 * half * j) / cols, o1 = -half + (2 * half * (j + 1)) / cols;
      const shade = (kk: number, jj: number) => tmp.copy(C.asphalt).multiplyScalar(ghost ? 1.2 : 0.95 + 0.1 * hash(seed, kk, jj)).clone();
      m.quad(v3(f0.p, f0.n, o0, Y_ASPHALT), v3(f0.p, f0.n, o1, Y_ASPHALT), v3(f1.p, f1.n, o1, Y_ASPHALT), v3(f1.p, f1.n, o0, Y_ASPHALT), shade(k, j), shade(k, j + 1), shade(k + 1, j + 1), shade(k + 1, j));
    }
  }
  if (ghost) return;
  // Strips along [s0, s1] at lateral offsets [o0, o1] (both sides when mirror).
  const strip = (o0: number, o1: number, y: number, col: THREE.Color, s0 = trimA, s1 = len - trimB, mirror = true, face = false) => {
    if (s1 - s0 < 0.2) return;
    const k = Math.max(1, Math.ceil((s1 - s0) / 2));
    for (const sg of mirror ? [1, -1] : [1]) for (let i = 0; i < k; i++) {
      const a = frame(c, lut, s0 + ((s1 - s0) * i) / k), b = frame(c, lut, s0 + ((s1 - s0) * (i + 1)) / k);
      const A = sg * o0, B = sg * o1;
      m.quad(v3(a.p, a.n, A, y), v3(a.p, a.n, B, y), v3(b.p, b.n, B, y), v3(b.p, b.n, A, y), col);
      if (face) m.quad(v3(a.p, a.n, A, Y_ASPHALT), v3(a.p, a.n, A, y), v3(b.p, b.n, A, y), v3(b.p, b.n, A, Y_ASPHALT), C.gutter); // kerb face
    }
  };
  const mA = trimA + markA, mB = len - trimB - markB; // painted span
  const dashed = (o: number, col: THREE.Color, mirror: boolean) => {
    for (let s = mA + 2; s + DASH < mB - 2; s += DASH + GAP) strip(o - PAINT_W / 2, o + PAINT_W / 2, Y_MARK, col, s, s + DASH, mirror);
  };
  // gutter, kerb (raised with a face), sidewalk
  strip(half, half + GUTTER_M, Y_ASPHALT + 0.0005, C.gutter);
  strip(half + GUTTER_M, half + GUTTER_M + KERB_M, Y_KERB, C.kerb, trimA, len - trimB, true, true);
  strip(half + GUTTER_M + KERB_M, half + GUTTER_M + KERB_M + SIDEWALK_M, Y_WALK, C.walk);
  // edge lines (solid, thin) at the shoulder
  strip(half - SHOULDER_M - PAINT_W, half - SHOULDER_M, Y_MARK, C.white, mA, mB);
  // centre: avenue median double yellow; street a thin dashed yellow line
  if (med > 0) { strip(med - PAINT_W, med, Y_MARK, C.yellow, mA, mB); strip(med - 3 * PAINT_W, med - 2 * PAINT_W, Y_MARK, C.yellow, mA, mB); }
  else if (type !== 'oneway') dashed(0, C.yellow, false);
  // lane separators between same-direction lanes: thin white dashes
  for (let l = 1; l < sp.lanes; l++) dashed(med + l * LANE_M, C.white, true);
  // manholes in the lanes, drains in the gutters
  for (let s = trimA + 20, k = 0; s < len - trimB - 10; s += 45, k++) { const f = frame(c, lut, s); const o = (k % 2 ? 1 : -1) * (med + LANE_M * 0.5); const q = v3(f.p, f.n, o, Y_MARK + 0.0003); m.disc(q.x, q.z, 0.6 * U, q.y, C.manhole, 10); }
  for (let s = trimA + 8; s < len - trimB - 4; s += 25) for (const sg of [1, -1]) {
    const a = frame(c, lut, s), b = frame(c, lut, s + 1);
    m.quad(v3(a.p, a.n, sg * (half + 0.1), Y_ASPHALT + 0.001), v3(a.p, a.n, sg * (half + GUTTER_M - 0.1), Y_ASPHALT + 0.001), v3(b.p, b.n, sg * (half + GUTTER_M - 0.1), Y_ASPHALT + 0.001), v3(b.p, b.n, sg * (half + 0.1), Y_ASPHALT + 0.001), C.drain);
  }
}

/** Zebra crosswalk + stop line on the approach of edge e at node n. */
function crossing(m: Mesher, g: RoadGraph, e: number, n: number, box: number): void {
  const c = g.eCurve[e], lut = g.eLut[e], len = g.eLen[e], sp = ROAD_SPEC[g.eType[e]], half = sp.width / 2;
  const atA = g.eA[e] === n;
  const sAt = (d: number) => (atA ? d : len - d);
  // NEBULA: `box` is the arm's TRIM (where the junction plate ends): the
  // crosswalk starts 0.5 m beyond it, the stop line follows; both lie
  // inside CROSSWALK_ROOM, where no lane paint is drawn.
  const sw0 = box + 0.5, sw1 = box + 3.5; // 3 m deep crosswalk
  if (sw1 + 2 > len / 2) return;
  for (let o = -half + 0.6; o < half - 0.6; o += 1.2) {
    const a = frame(c, lut, sAt(sw0)), b = frame(c, lut, sAt(sw1));
    m.quad(v3(a.p, a.n, o, Y_MARK), v3(a.p, a.n, o + 0.6, Y_MARK), v3(b.p, b.n, o + 0.6, Y_MARK), v3(b.p, b.n, o, Y_MARK), C.white);
  }
  // Stop line across the INBOUND half: traffic arriving at n drives on the
  // right of its travel direction; arriving at A means travel b→a, whose
  // right is the +normal side of the a→b frame.
  const f0 = frame(c, lut, sAt(sw1 + 0.8)), f1 = frame(c, lut, sAt(sw1 + 1.3));
  const [o0, o1] = atA ? [sp.median / 2, half - SHOULDER_M] : [-(half - SHOULDER_M), -sp.median / 2];
  m.quad(v3(f0.p, f0.n, o0, Y_MARK), v3(f0.p, f0.n, o1, Y_MARK), v3(f1.p, f1.n, o1, Y_MARK), v3(f1.p, f1.n, o0, Y_MARK), C.white);
}

const ISLAND = new THREE.Color(0x6fa04a), ISLAND_EDGE = new THREE.Color(0x5b8a3c);
/**
 * NEBULA: a ROUNDABOUT drawn round: an asphalt disc out to the ring's outer
 * radius, a raised kerb + planted island in the middle (with a lighter
 * inner lawn), and outside the rim a kerb + sidewalk ring broken where each
 * approach road comes in (its angular window = its kerb half-width at the
 * rim), so no sidewalk runs across an entry. Approach roads are trimmed to
 * the rim by planAll, and their crosswalks are skipped (yield entries).
 */
function drawRing(m: Mesher, g: RoadGraph, r: Ring, plans: Map<number, JunctionPlan>): void {
  const x = r.cx * U, z = r.cz * U, Ro = r.outer, Ri = r.island;
  m.disc(x, z, Ro * U, Y_ASPHALT, C.asphalt, 40);
  m.ring(x, z, Ri * U, (Ri + KERB_M) * U, Y_KERB, C.kerb, 32);
  m.disc(x, z, Ri * U, Y_KERB + 0.0005, ISLAND_EDGE, 32);
  m.disc(x, z, (Ri - 0.8) * U, Y_KERB + 0.001, ISLAND, 32);
  // Entry windows (angle ranges) where approaches cross the rim.
  const wins: Array<[number, number]> = [];
  for (const n of r.nodes) for (const a of plans.get(n)?.arms ?? []) {
    if (g.nKind[g.other(a.edge, n)] === 'roundabout' && g.nKind[n] === 'roundabout' && r.edges.includes(a.edge)) continue;
    const t = tAtLength(g.eLut[a.edge], a.atA ? a.trim : g.eLen[a.edge] - a.trim), p = at(g.eCurve[a.edge], t);
    const ang = Math.atan2(p.z - r.cz, p.x - r.cx), half = Math.asin(Math.min(1, (a.kerbHalf + 0.3) / Ro));
    wins.push([ang - half, ang + half]);
  }
  const inWin = (ang: number) => wins.some(([a0, a1]) => { const d = Math.atan2(Math.sin(ang - (a0 + a1) / 2), Math.cos(ang - (a0 + a1) / 2)); return Math.abs(d) < (a1 - a0) / 2; });
  const seg = 72;
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    if (inWin((a0 + a1) / 2)) continue;
    const Pt = (a: number, rr: number, y: number) => new THREE.Vector3(x + Math.cos(a) * rr * U, y, z + Math.sin(a) * rr * U);
    m.quad(Pt(a0, Ro, Y_KERB), Pt(a0, Ro + KERB_M, Y_KERB), Pt(a1, Ro + KERB_M, Y_KERB), Pt(a1, Ro, Y_KERB), C.kerb);
    m.quad(Pt(a0, Ro, Y_ASPHALT), Pt(a0, Ro, Y_KERB), Pt(a1, Ro, Y_KERB), Pt(a1, Ro, Y_ASPHALT), C.gutter);
    m.quad(Pt(a0, Ro + KERB_M, Y_WALK), Pt(a0, Ro + KERB_M + SIDEWALK_M, Y_WALK), Pt(a1, Ro + KERB_M + SIDEWALK_M, Y_WALK), Pt(a1, Ro + KERB_M, Y_WALK), C.walk);
  }
}

/**
 * NEBULA: draw a junction / bend PLATE from its plan (roads/junctions.ts):
 *  - asphalt: a fan from the node over the boundary made of every rounded
 *    kerb corner and the arm mouths between them (the arms' asphalt stops
 *    exactly at those mouths, so plate and arms share edges, no overlap);
 *  - per corner: a gutter band just inside the kerb line, a raised kerb band
 *    with its face, and a sidewalk band outside — offset along the corner's
 *    outward normals, whose end normals equal the arms' own, so the bands
 *    run on seamlessly from the arms' kerbs and sidewalks.
 */
function drawJunction(m: Mesher, g: RoadGraph, plan: JunctionPlan): void {
  const node = new THREE.Vector3(g.nx[plan.node] * U, Y_ASPHALT, g.nz[plan.node] * U);
  const P = (p: V2, n: V2, off: number, y: number) => new THREE.Vector3((p.x + n.x * off) * U, y, (p.z + n.z * off) * U);
  // Boundary in order: corner pts; consecutive corners connect across an arm mouth.
  const boundary: THREE.Vector3[] = [];
  for (const c of plan.corners) for (let k = 0; k < c.pts.length; k++) boundary.push(P(c.pts[k], c.nrm[k], 0, Y_ASPHALT));
  if (plan.arms.length === 2 && plan.corners.length === 2) {
    // Bend: corner 0 runs arm0→arm1 on one side, corner 1 the same on the
    // other; the closed outline is corner 0, then corner 1 REVERSED.
    boundary.length = 0;
    const [c0, c1] = plan.corners;
    for (let k = 0; k < c0.pts.length; k++) boundary.push(P(c0.pts[k], c0.nrm[k], 0, Y_ASPHALT));
    for (let k = c1.pts.length - 1; k >= 0; k--) boundary.push(P(c1.pts[k], c1.nrm[k], 0, Y_ASPHALT));
  }
  for (let k = 0; k < boundary.length; k++) m.tri(node, boundary[k], boundary[(k + 1) % boundary.length], C.asphalt);
  for (const c of plan.corners) {
    for (let k = 0; k + 1 < c.pts.length; k++) {
      const a = c.pts[k], b = c.pts[k + 1], na = c.nrm[k], nb = c.nrm[k + 1];
      m.quad(P(a, na, -GUTTER_M, Y_ASPHALT + 0.0005), P(a, na, 0, Y_ASPHALT + 0.0005), P(b, nb, 0, Y_ASPHALT + 0.0005), P(b, nb, -GUTTER_M, Y_ASPHALT + 0.0005), C.gutter);
      m.quad(P(a, na, 0, Y_KERB), P(a, na, KERB_M, Y_KERB), P(b, nb, KERB_M, Y_KERB), P(b, nb, 0, Y_KERB), C.kerb);
      m.quad(P(a, na, 0, Y_ASPHALT), P(a, na, 0, Y_KERB), P(b, nb, 0, Y_KERB), P(b, nb, 0, Y_ASPHALT), C.gutter); // kerb face
      m.quad(P(a, na, KERB_M, Y_WALK), P(a, na, KERB_M + SIDEWALK_M, Y_WALK), P(b, nb, KERB_M + SIDEWALK_M, Y_WALK), P(b, nb, KERB_M, Y_WALK), C.walk);
    }
  }
}


export class GraphRoadLayer {
  group = new THREE.Group();
  private roads: THREE.Mesh | null = null;
  private zones: THREE.Mesh | null = null;
  private ghost: THREE.Mesh | null = null;
  private outline: THREE.LineSegments | null = null;
  private grid: THREE.Mesh | null = null;
  private gridKey = '';
  private preview: THREE.InstancedMesh;
  private builtVersion = -1;
  private zoneKey = '';
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }); // double: kerb faces
  /** (OASIS: unused — the live traffic is owned by the simulation, see updateCars.) */
  traffic: GraphTraffic | null = null;
  private seed = 1;
  showZones = false;
  /** NEBULA: junction plans of the last build (traffic lights, power poles use them). */
  plans = new Map<number, JunctionPlan>();
  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0.5);
    // NEBULA zoning-angle fix: the zone highlight is drawn ON the ground (Y_PREVIEW), not
    // floating above it, and without depth test so it still shows over kerbs / sidewalks /
    // lot pads. The pointer is picked on the y=0 ground plane (ui/input.ts); a quad lifted
    // by h is seen displaced by ~h/tan(pitch) along the view, so at low camera pitch the
    // old lift (Y_ZONE+0.004 ≈ 2.2 m) moved the highlight about 0.7 of a cell away from
    // the squares that the click actually zones. DoubleSide: some block sides map the
    // unit quad mirrored (negative determinant), which flips its winding.
    this.preview = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, side: THREE.DoubleSide }), MAX_PREVIEW);
    this.preview.count = 0; this.preview.frustumCulled = false; this.preview.renderOrder = 10;
    this.group.add(this.preview);
  }

  /** Rebuild the static road mesh if the graph changed. */
  sync(g: RoadGraph, zb: ZoneBlocks): void {
    if (g.version !== this.builtVersion) {
      this.builtVersion = g.version;
      if (this.roads) { this.group.remove(this.roads); this.roads.geometry.dispose(); }
      const m = new Mesher();
      // NEBULA: plan every node first (trims, rounded kerb corners), then
      // extrude edges between their trims and draw one plate per junction/bend.
      const rs = rings(g);
      const plans = planAll(g, rs);
      this.plans = plans;
      const ringEdge = new Set(rs.flatMap((r) => r.edges));
      for (const r of rs) drawRing(m, g, r, plans);
      for (const e of g.liveEdges()) {
        if (ringEdge.has(e)) continue; // the ring disc is its surface
        const [ta, tb] = edgeTrims(g, plans, e);
        const room = (n: number) => (plans.get(n)?.junction ? CROSSWALK_ROOM : 0);
        extrude(m, g.eCurve[e], g.eLut[e], g.eLen[e], g.eType[e], g.eBorn[e] + this.seed, ta, tb, false, room(g.eA[e]), room(g.eB[e]));
      }
      for (const n of g.liveNodes()) {
        const deg = g.nEdges[n].length, plan = plans.get(n)!;
        if (plan.plate) {
          drawJunction(m, g, plan);
          if (plan.junction) for (const a of plan.arms) crossing(m, g, a.edge, n, a.trim);
        } else if (deg === 1) {
          // Dead end: round cap — asphalt to the kerb line, then a kerb ring and
          // a sidewalk ring at the same heights as the road's own bands.
          const e = g.nEdges[n][0], h = ROAD_SPEC[g.eType[e]].width / 2, x = g.nx[n] * U, z = g.nz[n] * U;
          m.disc(x, z, (h + GUTTER_M) * U, Y_ASPHALT, C.asphalt, 24);
          m.ring(x, z, (h + GUTTER_M) * U, (h + GUTTER_M + KERB_M) * U, Y_KERB, C.kerb, 24);
          m.ring(x, z, (h + GUTTER_M + KERB_M) * U, roadHalf(g.eType[e]) * U, Y_WALK, C.walk, 24);
        }
      }
      this.roads = new THREE.Mesh(m.geometry(), this.mat);
      this.roads.receiveShadow = true;
      this.group.add(this.roads);
    }
    const zk = `${zb.version}:${zb.cells.length}:${zb.cells.reduce((a, c) => (a * 31 + c.code) | 0, 0)}:${this.showZones}`;
    if (zk !== this.zoneKey) {
      this.zoneKey = zk;
      if (this.zones) { this.group.remove(this.zones); this.zones.geometry.dispose(); this.zones = null; }
      if (this.showZones && zb.cells.length) {
        const m = new Mesher(); const col = new THREE.Color();
        for (const c of zb.cells) {
          col.set(ZONE_COLOR[c.code] ?? 0x9aa0a6);
          const q = c.quad, ins = 0.06; // inset so cell borders show
          const cx = c.cx, cz = c.cz, p = (i: number) => new THREE.Vector3((q[2 * i] + (cx - q[2 * i]) * ins) * U, Y_ZONE, (q[2 * i + 1] + (cz - q[2 * i + 1]) * ins) * U);
          m.quad(p(0), p(1), p(2), p(3), col);
        }
        this.zones = new THREE.Mesh(m.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
        this.zones.renderOrder = 2;
        this.group.add(this.zones);
      }
    }
  }

  /**
   * Cities-Skylines-style footprint: an outline the width of the road being
   * placed (to the back of the sidewalk) along `curve`, with end caps, or a
   * ring of that width around the cursor when nothing is drawn yet. `snap`
   * adds a small ring where the cursor is magnetised to a node / road.
   */
  showOutline(o: { type: RoadType; ok: boolean; curve?: Cubic; cursor?: V2; snap?: V2 | null } | null): void {
    if (this.outline) { this.group.remove(this.outline); this.outline.geometry.dispose(); this.outline = null; }
    if (!o) return;
    const h = roadHalf(o.type), pos: number[] = [], y = 0.075;
    const seg = (ax: number, az: number, bx: number, bz: number) => pos.push(ax * U, y, az * U, bx * U, y, bz * U);
    const ring = (c: V2, r: number, n = 32) => { for (let i = 0; i < n; i++) { const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2; seg(c.x + Math.cos(a0) * r, c.z + Math.sin(a0) * r, c.x + Math.cos(a1) * r, c.z + Math.sin(a1) * r); } };
    if (o.curve) {
      const lut = buildLut(o.curve), len = lut[lut.length - 1];
      const n = Math.max(2, Math.min(200, Math.ceil(len / 4)));
      let pl: V2 | null = null, pr: V2 | null = null;
      for (let i = 0; i <= n; i++) {
        const t = tAtLength(lut, (len * i) / n), c = at(o.curve, t), d = tangent(o.curve, t);
        const L = { x: c.x - d.z * h, z: c.z + d.x * h }, R = { x: c.x + d.z * h, z: c.z - d.x * h };
        if (pl && pr) { seg(pl.x, pl.z, L.x, L.z); seg(pr.x, pr.z, R.x, R.z); } else seg(L.x, L.z, R.x, R.z);
        if (i === n) seg(L.x, L.z, R.x, R.z);
        pl = L; pr = R;
      }
    } else if (o.cursor) ring(o.cursor, h);
    if (o.snap) ring(o.snap, 3, 16);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.outline = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: o.ok ? 0xffffff : 0xff6b6b, transparent: true, opacity: 0.95, depthTest: false }));
    this.outline.renderOrder = 6; this.outline.frustumCulled = false;
    this.group.add(this.outline);
  }

  /**
   * POWER & WATER GRID view: two thin ribbons along every road — power (left)
   * and water (right) — coloured per stretch by the network that stretch belongs
   * to: yellow / blue = connected and keeping up, red = its network is overloaded
   * (demand above supply), grey = not connected to any source. Graph roads are
   * sampled along their curve; tile roads (old grids) link tile centre to centre.
   * Rebuilt when the roads or the solved networks change (and about once a second).
   */
  updateGrid(sim: Simulation | null): void {
    if (!sim) { if (this.grid) { this.group.remove(this.grid); this.grid.geometry.dispose(); this.grid = null; this.gridKey = ''; } return; }
    const w = sim.world, key = `${w.roads.version}|${w.tick >> 1}|${w.graphTiles.size}|${sim.version}`;
    if (key === this.gridKey && this.grid) return;
    this.gridKey = key;
    if (this.grid) { this.group.remove(this.grid); this.grid.geometry.dispose(); this.grid = null; }
    const pos: number[] = [], col: number[] = [], idxs: number[] = [];
    const C = new THREE.Color(), Y = 0.105, HALF = 0.035, OFF = 0.1;
    const tint = (x: number, z: number, kind: 'power' | 'water'): number => {
      const tx = Math.floor(x), tz = Math.floor(z);
      if (tx < 0 || tz < 0 || tx >= GRID_SIZE || tz >= GRID_SIZE) return 0x6b7280;
      const sv = sim.net.service[tz * GRID_SIZE + tx], id = kind === 'power' ? sv.powerNet : sv.waterNet;
      if (id < 0) return 0x6b7280;
      const n = (kind === 'power' ? sim.net.power : sim.net.water)[id];
      return n && (n.outages > 0 || n.demand > n.capacity) ? 0xff3b30 : kind === 'power' ? 0xffd21f : 0x29a3ff;
    };
    // One quad between two points (tile units) offset sideways by `off`.
    const ribbon = (ax: number, az: number, bx: number, bz: number, off: number, kind: 'power' | 'water') => {
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      if (l < 1e-6) return;
      const nx = -dz / l, nz = dx / l, o = off, h = HALF;
      const c = tint((ax + bx) / 2, (az + bz) / 2, kind);
      C.setHex(c);
      const base = pos.length / 3;
      for (const [px, pz] of [[ax + nx * (o - h), az + nz * (o - h)], [ax + nx * (o + h), az + nz * (o + h)], [bx + nx * (o + h), bz + nz * (o + h)], [bx + nx * (o - h), bz + nz * (o - h)]]) { pos.push(px, Y, pz); col.push(C.r, C.g, C.b); }
      idxs.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const both = (ax: number, az: number, bx: number, bz: number) => { ribbon(ax, az, bx, bz, -OFF, 'power'); ribbon(ax, az, bx, bz, OFF, 'water'); };
    const g = w.roads;
    for (const e of g.liveEdges()) {
      const c = g.eCurve[e], lut = g.eLut[e], len = g.eLen[e], n = Math.max(2, Math.ceil(len / 12));
      let pp = at(c, 0);
      for (let i = 1; i <= n; i++) { const q = at(c, tAtLength(lut, (len * i) / n)); both(pp.x * U, pp.z * U, q.x * U, q.z * U); pp = q; }
    }
    for (let i = 0; i < w.tiles.length; i++) {
      const t = w.tiles[i];
      if (!t.road || t.water || w.graphTiles.has(i)) continue;
      const x = i % GRID_SIZE, z = Math.floor(i / GRID_SIZE);
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const j = (z + dz) * GRID_SIZE + x + dx;
        if (x + dx < GRID_SIZE && z + dz < GRID_SIZE && w.tiles[j].road && !w.graphTiles.has(j)) both(x + 0.5, z + 0.5, x + dx + 0.5, z + dz + 0.5);
      }
      // dead ends / lone tiles still get a short stub so they are visible
      both(x + 0.5 - 0.04, z + 0.5, x + 0.5 + 0.04, z + 0.5);
    }
    if (!idxs.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idxs);
    this.grid = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.grid.renderOrder = 5; this.grid.frustumCulled = false;
    this.group.add(this.grid);
  }

  /** Highlight zone cells only (zoning drag preview); null clears. */
  showCells(cells: Array<{ quad: Float64Array; color?: number }> | null, color = 0x46c36b): void {
    // NEBULA: a cell may carry its own colour (rectangle zoning paints skipped squares red).
    this.showPreview(cells && { cells: cells.map((c) => ({ quad: c.quad, state: 'new' as const, color: c.color })), curve: new Float64Array(8), type: 'street', ok: true, color });
  }

  /** Show the zoning preview cells + ghost road (null clears). */
  showPreview(p: { cells: Array<{ quad: Float64Array; state: 'new' | 'clipped'; color?: number }>; curve: Cubic; type: RoadType; ok: boolean; color?: number } | null): void {
    if (this.ghost) { this.group.remove(this.ghost); this.ghost.geometry.dispose(); this.ghost = null; }
    if (!p) { this.preview.count = 0; return; }
    const lut = buildLut(p.curve), len = lut[lut.length - 1];
    if (len > 1) {
      const m = new Mesher(); extrude(m, p.curve, lut, len, p.type, 0, 0, 0, true);
      this.ghost = new THREE.Mesh(m.geometry(), new THREE.MeshBasicMaterial({ color: p.ok ? 0x9ad0ff : 0xff6b6b, transparent: true, opacity: 0.35, depthWrite: false }));
      this.ghost.position.y = 0.01; this.ghost.renderOrder = 4;
      this.group.add(this.ghost);
    }
    const mat = new THREE.Matrix4(), col = new THREE.Color();
    let k = 0;
    for (const c of p.cells) {
      if (k >= MAX_PREVIEW) break;
      const q = c.quad;
      // Unit square → parallelogram from corners 0, 1 and 3 (cells are near-parallelograms).
      const ux = (q[2] - q[0]) * U, uz = (q[3] - q[1]) * U, wx = (q[6] - q[0]) * U, wz = (q[7] - q[1]) * U;
      mat.set(ux * 0.94, 0, wx * 0.94, q[0] * U + (ux + wx) * 0.03, 0, 1, 0, Y_PREVIEW, uz * 0.94, 0, wz * 0.94, q[1] * U + (uz + wz) * 0.03, 0, 0, 0, 1);
      this.preview.setMatrixAt(k, mat);
      this.preview.setColorAt(k, col.set(!p.ok ? 0xe5484d : c.color ?? p.color ?? (c.state === 'new' ? 0x46c36b : 0xf0a830)));
      k++;
    }
    this.preview.count = k;
    this.preview.instanceMatrix.needsUpdate = true;
    if (this.preview.instanceColor) this.preview.instanceColor.needsUpdate = true;
  }
}

/** Overlay colour per zone code (cells.ts ZONE_CODES order). */
const ZONE_COLOR: Record<number, number> = { 0: 0x9aa0a6, 1: 0x6fcf6f, 2: 0x3fae4f, 3: 0x1f8a3a, 4: 0x5fa8ff, 5: 0x2f74d9, 6: 0xf2c94c, 7: 0xd99a2b, 8: 0xb5d36b, 9: 0xc98b4f, 10: 0x8f7ff2, 11: 0x4fd1d9 };
