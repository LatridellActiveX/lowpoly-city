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
import * as THREE from 'three';
import { at, Cubic, tangent, tAtLength, V2, buildLut } from '../roads/bezier';
import { GUTTER_M, KERB_M, LANE_M, RoadGraph, RoadType, ROAD_SPEC, SHOULDER_M, SIDEWALK_M, TILE_M, roadHalf } from '../roads/graph';
import { ZoneBlocks } from '../roads/blocks';
import { GraphTraffic } from '../roads/gtraffic';

const U = 1 / TILE_M;
const Y_ASPHALT = 0.041, Y_MARK = 0.0425, Y_KERB = 0.06, Y_WALK = 0.056, Y_DISC = 0.0415, Y_ZONE = 0.064;
const C = {
  asphalt: new THREE.Color(0x4d525a), gutter: new THREE.Color(0x3c4047), kerb: new THREE.Color(0xd6d3cc), walk: new THREE.Color(0xb9b6ae),
  white: new THREE.Color(0xf2f2f2), yellow: new THREE.Color(0xf2d16b), manhole: new THREE.Color(0x34373c), drain: new THREE.Color(0x2a2c30),
};
export const MAX_PREVIEW = 2000;
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
export function extrude(m: Mesher, c: Cubic, lut: Float32Array, len: number, type: RoadType, seed: number, trimA: number, trimB: number, ghost = false): void {
  const sp = ROAD_SPEC[type], half = sp.width / 2, med = sp.median / 2;
  const n = Math.max(2, Math.ceil(len / 2));
  const S = (k: number) => (k / n) * len;
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
  const dashed = (o: number, col: THREE.Color, mirror: boolean) => {
    for (let s = trimA + 2; s + DASH < len - trimB - 2; s += DASH + GAP) strip(o - PAINT_W / 2, o + PAINT_W / 2, Y_MARK, col, s, s + DASH, mirror);
  };
  // gutter, kerb (raised with a face), sidewalk
  strip(half, half + GUTTER_M, Y_ASPHALT + 0.0005, C.gutter);
  strip(half + GUTTER_M, half + GUTTER_M + KERB_M, Y_KERB, C.kerb, trimA, len - trimB, true, true);
  strip(half + GUTTER_M + KERB_M, half + GUTTER_M + KERB_M + SIDEWALK_M, Y_WALK, C.walk);
  // edge lines (solid, thin) at the shoulder
  strip(half - SHOULDER_M - PAINT_W, half - SHOULDER_M, Y_MARK, C.white);
  // centre: avenue median double yellow; street a thin dashed yellow line
  if (med > 0) { strip(med - PAINT_W, med, Y_MARK, C.yellow); strip(med - 3 * PAINT_W, med - 2 * PAINT_W, Y_MARK, C.yellow); }
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
  const sw0 = box + 1, sw1 = box + 4; // 3 m deep crosswalk
  if (sw1 + 2 > len / 2) return;
  for (let o = -half + 0.6; o < half - 0.6; o += 1.2) {
    const a = frame(c, lut, sAt(sw0)), b = frame(c, lut, sAt(sw1));
    m.quad(v3(a.p, a.n, o, Y_MARK), v3(a.p, a.n, o + 0.6, Y_MARK), v3(b.p, b.n, o + 0.6, Y_MARK), v3(b.p, b.n, o, Y_MARK), C.white);
  }
  // Stop line across the INBOUND half: traffic arriving at n drives on the
  // right of its travel direction; arriving at A means travel b→a, whose
  // right is the +normal side of the a→b frame.
  const f0 = frame(c, lut, sAt(sw1 + 1)), f1 = frame(c, lut, sAt(sw1 + 1.5));
  const [o0, o1] = atA ? [sp.median / 2, half - SHOULDER_M] : [-(half - SHOULDER_M), -sp.median / 2];
  m.quad(v3(f0.p, f0.n, o0, Y_MARK), v3(f0.p, f0.n, o1, Y_MARK), v3(f1.p, f1.n, o1, Y_MARK), v3(f1.p, f1.n, o0, Y_MARK), C.white);
}

/** Junction box radius at node n (m). */
const boxR = (g: RoadGraph, n: number) => { let r = 0; for (const e of g.nEdges[n]) r = Math.max(r, ROAD_SPEC[g.eType[e]].width / 2 + GUTTER_M); return r; };

export class GraphRoadLayer {
  group = new THREE.Group();
  private roads: THREE.Mesh | null = null;
  private zones: THREE.Mesh | null = null;
  private ghost: THREE.Mesh | null = null;
  private preview: THREE.InstancedMesh;
  private cars: THREE.InstancedMesh;
  private builtVersion = -1;
  private zoneKey = '';
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }); // double: kerb faces
  traffic: GraphTraffic | null = null;
  private trafficVersion = -1;
  private seed = 1;
  showZones = false;
  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0.5);
    this.preview = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }), MAX_PREVIEW);
    this.preview.count = 0; this.preview.frustumCulled = false; this.preview.renderOrder = 3;
    this.group.add(this.preview);
    // Cars: same proportions as the tile cars (render/vehicles.ts).
    const body = new THREE.BoxGeometry(0.24, 0.06, 0.12).translate(0, 0.07, 0);
    this.cars = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.6 }), 400);
    this.cars.count = 0; this.cars.frustumCulled = false;
    this.group.add(this.cars);
  }

  /** Rebuild the static road mesh if the graph changed. */
  sync(g: RoadGraph, zb: ZoneBlocks): void {
    if (g.version !== this.builtVersion) {
      this.builtVersion = g.version;
      if (this.roads) { this.group.remove(this.roads); this.roads.geometry.dispose(); }
      const m = new Mesher();
      for (const e of g.liveEdges()) {
        const trim = (n: number) => (g.nEdges[n].length >= 3 ? boxR(g, n) + 0.5 : 0);
        extrude(m, g.eCurve[e], g.eLut[e], g.eLen[e], g.eType[e], g.eBorn[e] + this.seed, trim(g.eA[e]), trim(g.eB[e]));
      }
      for (const n of g.liveNodes()) {
        const deg = g.nEdges[n].length;
        if (deg >= 3) {
          m.disc(g.nx[n] * U, g.nz[n] * U, boxR(g, n) * 1.1 * U, Y_DISC, C.asphalt, 28);
          for (const e of g.nEdges[n]) crossing(m, g, e, n, boxR(g, n) + 0.5);
        } else if (deg === 1) {
          const e = g.nEdges[n][0], h = ROAD_SPEC[g.eType[e]].width / 2;
          m.disc(g.nx[n] * U, g.nz[n] * U, (roadHalf(g.eType[e])) * U, Y_WALK - 0.001, C.walk, 24);
          m.disc(g.nx[n] * U, g.nz[n] * U, (h + GUTTER_M + KERB_M) * U, Y_KERB - 0.0005, C.kerb, 24);
          m.disc(g.nx[n] * U, g.nz[n] * U, (h + GUTTER_M) * U, Y_DISC + 0.015, C.asphalt, 24);
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

  /** Show the zoning preview cells + ghost road (null clears). */
  showPreview(p: { cells: Array<{ quad: Float64Array; state: 'new' | 'clipped' }>; curve: Cubic; type: RoadType; ok: boolean } | null): void {
    if (this.ghost) { this.group.remove(this.ghost); this.ghost.geometry.dispose(); this.ghost = null; }
    if (!p) { this.preview.count = 0; return; }
    const lut = buildLut(p.curve), len = lut[lut.length - 1];
    if (len > 1) {
      const m = new Mesher(); extrude(m, p.curve, lut, len, p.type, 0, 0, 0, true);
      this.ghost = new THREE.Mesh(m.geometry(), new THREE.MeshBasicMaterial({ color: p.ok ? 0x9ad0ff : 0xff6b6b, transparent: true, opacity: 0.55, depthWrite: false }));
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
      mat.set(ux * 0.94, 0, wx * 0.94, q[0] * U + (ux + wx) * 0.03, 0, 1, 0, Y_ZONE + 0.004, uz * 0.94, 0, wz * 0.94, q[1] * U + (uz + wz) * 0.03, 0, 0, 0, 1);
      this.preview.setMatrixAt(k, mat);
      this.preview.setColorAt(k, col.set(!p.ok ? 0xe5484d : c.state === 'new' ? 0x46c36b : 0xf0a830));
      k++;
    }
    this.preview.count = k;
    this.preview.instanceMatrix.needsUpdate = true;
    if (this.preview.instanceColor) this.preview.instanceColor.needsUpdate = true;
  }

  /** Decorative traffic on the freeform roads: keep it topped up and move it. */
  updateCars(g: RoadGraph, dt: number): void {
    if (!g.edgeCount()) { this.cars.count = 0; return; }
    if (!this.traffic || this.trafficVersion !== g.version) { this.traffic = new GraphTraffic(g); this.trafficVersion = g.version; }
    const tr = this.traffic, nodes = g.liveNodes();
    const want = Math.min(300, g.edgeCount() * 14);
    for (let tries = 0; tr.vehicles.length < want && tries < 12; tries++) {
      const a = nodes[Math.floor(Math.random() * nodes.length)], b = nodes[Math.floor(Math.random() * nodes.length)];
      if (a !== b) tr.spawn(a, b);
    }
    tr.update(Math.min(0.1, dt) * 3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (const v of tr.vehicles) {
      if (k >= 400) break;
      const p = tr.position(v), p2 = tr.position({ ...v, s: v.s + 0.5 } as typeof v);
      q.setFromAxisAngle(up, -Math.atan2(p2.z - p.z, p2.x - p.x));
      m.compose(new THREE.Vector3(p.x * U, 0, p.z * U), q, s);
      this.cars.setMatrixAt(k, m);
      this.cars.setColorAt(k, col.setHex(CAR_COLORS[v.id % CAR_COLORS.length]));
      k++;
    }
    this.cars.count = k;
    this.cars.instanceMatrix.needsUpdate = true;
    if (this.cars.instanceColor) this.cars.instanceColor.needsUpdate = true;
  }
}

const CAR_COLORS = [0xd94b3d, 0x3d7bd9, 0xf2f2f2, 0x2b2d31, 0xf2c14e, 0x4caf6a, 0x9aa1a8, 0x8e4fc1, 0xe0773a];
/** Overlay colour per zone code (cells.ts ZONE_CODES order). */
const ZONE_COLOR: Record<number, number> = { 0: 0x9aa0a6, 1: 0x6fcf6f, 2: 0x3fae4f, 3: 0x1f8a3a, 4: 0x5fa8ff, 5: 0x2f74d9, 6: 0xf2c94c, 7: 0xd99a2b, 8: 0xb5d36b, 9: 0xc98b4f, 10: 0x8f7ff2, 11: 0x4fd1d9 };
