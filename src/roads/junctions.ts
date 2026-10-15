/**
 * roads/junctions.ts — NEBULA: CLEAN JUNCTION GEOMETRY for the road graph.
 *
 * Pure geometry (no three.js) so it can be unit-tested; render/graphRoads.ts
 * turns it into meshes.
 *
 * THE PROBLEM IT SOLVES
 *   Up to oasis every edge was extruded to the node centre and a round
 *   asphalt disc was dropped on junctions. Where roads meet at an angle the
 *   sidewalks/kerbs of neighbouring arms OVERLAPPED (inside of a bend) or
 *   left WEDGE GAPS (outside of a bend and between arms of a T/+/Y), the
 *   disc z-fought with the edge asphalt, and corners were square.
 *
 * THE MODEL
 *   At every node the incident edges ("arms") are sorted by the angle they
 *   leave the node at. Each arm is TRIMMED back from the node by a distance
 *   `trim`: everything belonging to the edge (asphalt, markings, kerb,
 *   sidewalk) is extruded only beyond it. Inside, ONE junction PLATE is
 *   drawn: asphalt bounded by the arms' kerb lines at their trims and, between
 *   each pair of angularly adjacent arms, a ROUNDED KERB CORNER: a quadratic
 *   Bézier from arm i's left kerb-line end to arm j's right kerb-line end,
 *   with its control point where the two kerb lines would meet (clamped).
 *   Kerb and sidewalk bands are offset outward along that corner curve, so
 *   they join the arms' own kerb/sidewalk exactly at the trims: no gaps, no
 *   overlaps, rounded corners.
 *
 * TRIM
 *   Two adjacent arms separated by angle θ have outer sidewalk edges that
 *   meet W / tan(θ/2) from the node (W = road half-width to the back of the
 *   sidewalk, the wider arm's). Trimming every arm to at least that (plus a
 *   small margin) guarantees the corner bands start where the arms stop
 *   overlapping. Junctions (degree ≥ 3) also keep room for a crosswalk and
 *   stop line: at least the box radius (half-width + gutter) + 0.5 m.
 *   A trim never exceeds 45% of its edge (very short edges keep a sliver).
 *   A degree-2 node that is (almost) straight — a traced run — gets trim 0
 *   and no plate: the road just continues.
 */
import { at, tangent, tAtLength, V2 } from './bezier';
import { GUTTER_M, RoadGraph, ROAD_SPEC, roadHalf } from './graph';

/** One arm (edge end) at a node. */
export interface Arm {
  edge: number;
  /** True if the edge starts at this node (arc 0 is at the node). */
  atA: boolean;
  /** Unit direction leaving the node (tangent at the node end). */
  dir: V2;
  /** Angle of `dir` (radians, atan2(z, x)). */
  ang: number;
  /** Trim distance (m) from the node along the edge. */
  trim: number;
  /** Kerb line half-width: lanes + median half + gutter (m). */
  kerbHalf: number;
}
export interface Corner {
  /** From arm (index in arms) → to arm, counter-clockwise neighbours. */
  from: number; to: number;
  /** Sampled kerb-line curve points (m) and the outward normal (away from the plate) at each. */
  pts: V2[]; nrm: V2[];
}
/**
 * ROUNDABOUTS: the ring edges between 'roundabout' nodes are drawn as one
 * round asphalt disc with a planted central island (render/graphRoads.ts);
 * ring nodes get no plate, ring edges no extrusion, and approach arms are
 * trimmed to the disc's rim.
 */
export interface Ring { nodes: number[]; edges: number[]; cx: number; cz: number; /** mean node distance */ r: number; outer: number; island: number }
export const RING_PAD = 7.5;
export function rings(g: RoadGraph): Ring[] {
  const isRing = (e: number) => g.nKind[g.eA[e]] === 'roundabout' && g.nKind[g.eB[e]] === 'roundabout';
  const seen = new Set<number>(), out: Ring[] = [];
  for (const n0 of g.liveNodes()) {
    if (g.nKind[n0] !== 'roundabout' || seen.has(n0)) continue;
    const nodes: number[] = [], edges = new Set<number>(), stack = [n0]; seen.add(n0);
    while (stack.length) {
      const n = stack.pop()!; nodes.push(n);
      for (const e of g.nEdges[n]) if (isRing(e)) { edges.add(e); const m = g.other(e, n); if (!seen.has(m)) { seen.add(m); stack.push(m); } }
    }
    if (nodes.length < 3) continue; // not a closed ring: draw as ordinary junctions
    const cx = nodes.reduce((a, n) => a + g.nx[n], 0) / nodes.length, cz = nodes.reduce((a, n) => a + g.nz[n], 0) / nodes.length;
    const r = nodes.reduce((a, n) => a + Math.hypot(g.nx[n] - cx, g.nz[n] - cz), 0) / nodes.length;
    out.push({ nodes, edges: [...edges], cx, cz, r, outer: r + RING_PAD, island: Math.max(3, r * 0.4) });
  }
  return out;
}

export interface JunctionPlan {
  node: number; arms: Arm[]; corners: Corner[];
  /** Draw a plate (junction or bend). False: straight pass-through or dead end. */
  plate: boolean;
  /** Junction proper (degree ≥ 3): crosswalks + stop lines on every arm. */
  junction: boolean;
}

/** Treat a degree-2 node as a straight continuation below this bend angle. */
export const STRAIGHT_BEND = (6 * Math.PI) / 180;
/** Corner curve samples. */
export const CORNER_SEG = 10;
/** Crosswalk depth + stop line clearance kept outside the plate (m). */
export const CROSSWALK_ROOM = 5.5;

/** The kerb line half-width of an edge (where the plate's boundary runs). */
export const kerbHalfOf = (g: RoadGraph, e: number) => ROAD_SPEC[g.eType[e]].width / 2 + GUTTER_M;

/** Point at arc length s of edge e (metres). */
function pointAt(g: RoadGraph, e: number, s: number): { p: V2; d: V2 } {
  const t = tAtLength(g.eLut[e], Math.max(0, Math.min(g.eLen[e], s)));
  return { p: at(g.eCurve[e], t), d: tangent(g.eCurve[e], t) };
}
/** Point + leaving-direction of arm `a` at distance s from the node. */
export function armFrame(g: RoadGraph, a: Arm, s: number): { p: V2; d: V2; left: V2 } {
  const f = pointAt(g, a.edge, a.atA ? s : g.eLen[a.edge] - s);
  const d = a.atA ? f.d : { x: -f.d.x, z: -f.d.z };
  // "left" of the direction leaving the node, in x/z with y up: (d.z, −d.x)
  // is the right-hand normal used by gtraffic lanes; left is its negative.
  return { p: f.p, d, left: { x: -d.z, z: d.x } };
}

/** Plan the geometry of node n. */
export function planNode(g: RoadGraph, n: number): JunctionPlan {
  const es = g.nEdges[n];
  const arms: Arm[] = [];
  for (const e of es) {
    // A self-loop has both ends here; list each end once.
    for (const atA of g.eA[e] === g.eB[e] ? [true, false] : [g.eA[e] === n]) {
      const f = pointAt(g, e, atA ? 0 : g.eLen[e]);
      const dir = atA ? f.d : { x: -f.d.x, z: -f.d.z };
      arms.push({ edge: e, atA, dir, ang: Math.atan2(dir.z, dir.x), trim: 0, kerbHalf: kerbHalfOf(g, e) });
    }
  }
  arms.sort((a, b) => a.ang - b.ang);
  const k = arms.length;
  const junction = k >= 3;
  let plate = junction;
  if (k === 2) {
    // Bend angle between "continue along arm 0 reversed" and arm 1.
    const d0 = arms[0].dir, d1 = arms[1].dir;
    const straight = Math.acos(Math.max(-1, Math.min(1, -(d0.x * d1.x + d0.z * d1.z))));
    plate = straight > STRAIGHT_BEND;
  }
  if (!plate) return { node: n, arms, corners: [], plate: false, junction: false };
  // ---- trims ----
  const W = Math.max(...arms.map((a) => roadHalf(g.eType[a.edge])));
  for (let i = 0; i < k; i++) {
    const a = arms[i];
    let need = junction ? a.kerbHalf + 0.5 : 1;
    for (const j of [(i + 1) % k, (i + k - 1) % k]) {
      if (j === i) continue;
      let th = Math.abs(arms[j].ang - a.ang); if (th > Math.PI) th = 2 * Math.PI - th;
      // Only the gap on the side facing neighbour j matters; for k = 2 the
      // INNER side of the bend is the one that overlaps (θ < π).
      need = Math.max(need, W / Math.tan(Math.max(0.2, th) / 2) * 0.85 + 0.5);
    }
    const len = g.eLen[a.edge];
    a.trim = Math.min(need, len * 0.45);
  }
  // ---- rounded kerb corners between CCW neighbours ----
  const corners: Corner[] = [];
  // For a BEND (k = 2) the two corners are the two sides of one road: on
  // the near side of travel (in along arm 0, out along arm 1) arm 0's side
  // is −left and arm 1's is +left, and the other way round on the far side.
  const pairs = k === 2 ? [[0, 1, -1, 1], [0, 1, 1, -1]] : arms.map((_, i) => [i, (i + 1) % k, 0, 0]);
  for (const [i, j, forceA, forceB] of pairs) {
    const A = arms[i], B = arms[j];
    const fa = armFrame(g, A, A.trim), fb = armFrame(g, B, B.trim);
    // Deterministic from the angular order (a dot test is ambiguous for the
    // straight side of a T, where the neighbour lies dead ahead): `left` is
    // dir rotated +90° in atan2(z, x) terms, i.e. towards INCREASING angle,
    // which is where the CCW neighbour j is. So arm i faces j with +left and
    // arm j faces i (clockwise from it) with −left.
    const sa = forceA || 1;
    const sb = forceB || -1;
    const p0 = { x: fa.p.x + fa.left.x * sa * A.kerbHalf, z: fa.p.z + fa.left.z * sa * A.kerbHalf };
    const p2 = { x: fb.p.x + fb.left.x * sb * B.kerbHalf, z: fb.p.z + fb.left.z * sb * B.kerbHalf };
    // Control point: where the two kerb lines (extended INTO the junction,
    // i.e. along −dir) meet; fall back to the chord midpoint pulled to the node.
    const d0 = { x: -fa.d.x, z: -fa.d.z }, d1 = { x: -fb.d.x, z: -fb.d.z };
    const den = d0.x * d1.z - d0.z * d1.x;
    let ctrl: V2 = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
    if (Math.abs(den) > 1e-6) {
      const t = ((p2.x - p0.x) * d1.z - (p2.z - p0.z) * d1.x) / den;
      const u = ((p2.x - p0.x) * d0.z - (p2.z - p0.z) * d0.x) / den;
      // Use it only when it lies ahead of both ends and not absurdly far.
      const lim = 3 * Math.hypot(p2.x - p0.x, p2.z - p0.z) + 1;
      if (t > 0 && u > 0 && t < lim && u < lim) ctrl = { x: p0.x + d0.x * t, z: p0.z + d0.z * t };
    }
    const node = { x: g.nx[n], z: g.nz[n] };
    const pts: V2[] = [], nrm: V2[] = [];
    for (let s = 0; s <= CORNER_SEG; s++) {
      const t = s / CORNER_SEG, u = 1 - t;
      const p = { x: u * u * p0.x + 2 * u * t * ctrl.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * ctrl.z + t * t * p2.z };
      const dt = { x: 2 * u * (ctrl.x - p0.x) + 2 * t * (p2.x - ctrl.x), z: 2 * u * (ctrl.z - p0.z) + 2 * t * (p2.z - ctrl.z) };
      const L = Math.hypot(dt.x, dt.z) || 1;
      let q = { x: -dt.z / L, z: dt.x / L };
      // Outward = away from the node (the plate side is the node's side).
      if (q.x * (p.x - node.x) + q.z * (p.z - node.z) < 0) q = { x: -q.x, z: -q.z };
      // At the ends use the arm's own kerb normal exactly, so bands join seamlessly.
      if (s === 0) q = { x: fa.left.x * sa, z: fa.left.z * sa };
      if (s === CORNER_SEG) q = { x: fb.left.x * sb, z: fb.left.z * sb };
      pts.push(p); nrm.push(q);
    }
    corners.push({ from: i, to: j, pts, nrm });
  }
  return { node: n, arms, corners, plate: true, junction };
}

/** Plans for every live node (render build). */
export function planAll(g: RoadGraph, rs: Ring[] = rings(g)): Map<number, JunctionPlan> {
  const out = new Map<number, JunctionPlan>();
  const ringOf = new Map<number, Ring>(); for (const r of rs) for (const n of r.nodes) ringOf.set(n, r);
  for (const n of g.liveNodes()) {
    const ring = ringOf.get(n);
    if (!ring) { out.set(n, planNode(g, n)); continue; }
    // Ring node: no plate; approach arms stop at the disc rim (ring edges
    // themselves are not extruded — the disc is their surface).
    const p = planNode(g, n);
    const d = Math.hypot(g.nx[n] - ring.cx, g.nz[n] - ring.cz);
    for (const a of p.arms) a.trim = Math.min(g.eLen[a.edge] * 0.45, Math.max(0, ring.outer - d) + 1);
    out.set(n, { ...p, plate: false, junction: false, corners: [] });
  }
  return out;
}
/** Trim of edge e at its a-end and b-end from a plan map. */
export function edgeTrims(g: RoadGraph, plans: Map<number, JunctionPlan>, e: number): [number, number] {
  const f = (n: number, atA: boolean) => plans.get(n)?.arms.find((a) => a.edge === e && a.atA === atA)?.trim ?? 0;
  return [f(g.eA[e], true), f(g.eB[e], false)];
}
