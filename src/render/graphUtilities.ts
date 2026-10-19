/**
 * render/graphUtilities.ts — NEBULA: what the ROAD GRAPH carries, made visible.
 *
 * In graph worlds (new games, freeform roads) the tile renderer skips road
 * tiles that belong to the graph (cityRenderer: graphTiles), so the street
 * furniture the tile code used to draw there — power poles + wires, water
 * mains, traffic signals — has to come from the graph instead. This module
 * is PURE GEOMETRY (no three.js scene objects): it turns the graph + its
 * junction plans (roads/junctions.ts) into placements in TILE units, which
 * cityRenderer feeds into its existing instanced pools (pole / span /
 * pipe / pipeJoint / lightPole / lightHead / signalGlow). Keeping it pure
 * lets tools/nebula.test.ts check it headless.
 *
 * It mirrors the simulation exactly (roads/utilities.ts): EVERY graph road
 * edge is a power conduit (street poles) and a water conduit (a main under
 * the street), so what you see is the network the sim uses.
 *
 * Units: the graph is in metres; 1 tile = 32 m, so everything returned is
 * multiplied by U = 1/32.
 */
import { at, tangent, tAtLength, V2 } from '../roads/bezier';
import { isStraight, RoadGraph } from '../roads/graph';
import { armFrame, JunctionPlan, kerbHalfOf, Ring } from '../roads/junctions';
import { GraphTraffic } from '../roads/gtraffic';
/** OASIS-S3: amber length now lives with the controller (roads/gtraffic.ts); re-exported for old imports. */
export { AMBER_S } from '../roads/gtraffic';

const U = 1 / 32;

/* ------------------------------------------------------------------ power */

/** Target spacing of street poles along a graph road (m): ~2 tiles, like the tile rule. */
export const POLE_SPACING = 60;
/** How far out from the kerb line a pole stands (m): on the sidewalk, clear of the kerb. */
const POLE_OUT = 2.2;
/** Arm-end poles closer than this (m) are merged into one. */
const POLE_MERGE = 6;

export interface Pole { x: number; z: number; rotY: number }
export interface GraphPower {
  poles: Pole[];
  /** Wire spans between pole indices (each drawn once, sagging, by cableMatrix). */
  spans: Array<[number, number]>;
}

/**
 * Poles along every live edge on its RIGHT side (direction A→B), spaced
 * evenly between the junction trims (so none stands inside a junction
 * plate), with wires pole to pole. At each node, the end poles of the arms
 * are chained round the junction in angle order (the corner poles of a
 * crossroads are wired corner to corner, like real overhead distribution),
 * which keeps the visible network connected exactly where the sim's is.
 * Ring (roundabout) edges are skipped: their arms end at the ring rim and
 * the rim poles are chained through the ring's own centre-side order.
 */
export function graphPower(g: RoadGraph, plans: Map<number, JunctionPlan>, rings: Ring[] = []): GraphPower {
  const poles: Pole[] = [], spans: Array<[number, number]> = [];
  const ringEdge = new Set(rings.flatMap((r) => r.edges));
  /** End pole index of each (edge, end) — "e:A" / "e:B" — for chaining at nodes. */
  const endPole = new Map<string, number>();
  for (const e of g.liveEdges()) {
    if (ringEdge.has(e)) continue;
    const len = g.eLen[e];
    const ta = plans.get(g.eA[e])?.arms.find((a) => a.edge === e && a.atA)?.trim ?? 0;
    const tb = plans.get(g.eB[e])?.arms.find((a) => a.edge === e && !a.atA)?.trim ?? 0;
    // Stand the end poles just behind the crosswalk zone of each end.
    const s0 = Math.min(len / 2, ta + 1.5), s1 = Math.max(len / 2, len - tb - 1.5);
    const n = Math.max(1, Math.round((s1 - s0) / POLE_SPACING));
    const half = kerbHalfOf(g, e) + POLE_OUT;
    /** Pole at arc length s, on the right of A→B ((d.z, −d.x), gtraffic's lane normal), or null on a ring disc. */
    const place = (s: number): Pole | null => {
      const t = tAtLength(g.eLut[e], s);
      const p = at(g.eCurve[e], t), d = tangentAt(g, e, t);
      const x = p.x + d.z * half, z = p.z - d.x * half;
      if (rings.some((r) => Math.hypot(x - r.cx, z - r.cz) < r.outer + 2)) return null;
      return { x: x * U, z: z * U, rotY: Math.atan2(-d.z, d.x) };
    };
    let prev = -1;
    for (let k = 0; k <= n; k++) {
      if (k > 0 && s1 - s0 < 4) break; // tiny edge: one pole
      const s = s0 + ((s1 - s0) * k) / n;
      const pos = place(s);
      if (!pos) continue; // would stand on a roundabout disc
      // Two arm-end poles within POLE_MERGE share one pole (a straight
      // through-node, a ring entry): no doubled poles side by side.
      let id = k === 0 || k === n ? poles.findIndex((q) => Math.hypot(q.x - pos.x, q.z - pos.z) * 32 < POLE_MERGE) : -1;
      if (id < 0) id = poles.push(pos) - 1;
      if (id === prev) continue;
      if (prev >= 0) spans.push([prev, id]);
      if (!endPole.has(`${e}:A`)) endPole.set(`${e}:A`, id); // first pole actually placed
      prev = id;
    }
    if (prev >= 0) endPole.set(`${e}:B`, prev);
  }
  // Chain the arm-end poles round each node (arms are sorted by angle).
  for (const [, plan] of plans) {
    const ids = plan.arms.map((a) => endPole.get(`${a.edge}:${a.atA ? 'A' : 'B'}`)).filter((v): v is number => v !== undefined);
    const uniq = [...new Set(ids)];
    for (let i = 0; i + 1 < uniq.length; i++) spans.push([uniq[i], uniq[i + 1]]);
  }
  // Roundabouts: chain the approach poles of each ring in angle order (closing the loop).
  for (const r of rings) {
    const ids: Array<{ id: number; ang: number }> = [];
    for (const n of r.nodes) for (const a of plans.get(n)?.arms ?? []) {
      if (ringEdge.has(a.edge)) continue;
      const id = endPole.get(`${a.edge}:${a.atA ? 'A' : 'B'}`);
      if (id !== undefined) ids.push({ id, ang: Math.atan2(poles[id].z - r.cz * U, poles[id].x - r.cx * U) });
    }
    ids.sort((a, b) => a.ang - b.ang);
    for (let i = 0; i < ids.length && ids.length > 1; i++) if (ids.length > 2 || i === 0) spans.push([ids[i].id, ids[(i + 1) % ids.length].id]);
  }
  return { poles, spans };
}

/** Nearest graph pole to (x, z) (tile units) within maxD, or −1 — used to wire tile power lines into the street network. */
export function nearestPole(p: GraphPower, x: number, z: number, maxD = 2): number {
  let best = -1, bd = maxD * maxD;
  for (let i = 0; i < p.poles.length; i++) {
    const d = (p.poles[i].x - x) ** 2 + (p.poles[i].z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/* ------------------------------------------------------------------ water */

/** Max length of one straight pipe piece along a curved edge (m). */
const MAIN_STEP = 12;

/**
 * Water mains: one pipe down the middle of every live edge, from node to
 * node (so all mains meet in a joint at the node centre, exactly like the
 * sim's conduit graph). Straight edges are one piece; curves are cut into
 * ≤ MAIN_STEP pieces. Returns segments + joints (tile units).
 */
export function graphMains(g: RoadGraph): { segs: Array<[V2, V2]>; joints: V2[] } {
  const segs: Array<[V2, V2]> = [], joints: V2[] = [];
  for (const n of g.liveNodes()) if (g.nEdges[n].length) joints.push({ x: g.nx[n] * U, z: g.nz[n] * U });
  for (const e of g.liveEdges()) {
    const c = g.eCurve[e], len = g.eLen[e];
    const n = isStraight(c) ? 1 : Math.max(2, Math.ceil(len / MAIN_STEP));
    let a = at(c, 0);
    for (let k = 1; k <= n; k++) {
      const b = at(c, tAtLength(g.eLut[e], (len * k) / n));
      segs.push([{ x: a.x * U, z: a.z * U }, { x: b.x * U, z: b.z * U }]);
      a = b;
    }
  }
  return { segs, joints };
}

/* -------------------------------------------------------------- signals */

export interface GraphSignal {
  node: number;
  /** The approach (incoming) edge whose phase this head shows. */
  edge: number;
  /** Pole position (tile units) and model yaw (vehicles.ts lightPole frame). */
  x: number; z: number; yaw: number;
}

/**
 * One signal pole PER APPROACH at every 'signal' node: on the kerb facing
 * traffic arriving along that arm (just behind the crosswalk), its
 * arm reaching over the approach lanes and its head facing the drivers.
 * Only edges that can ENTER the node get one (a one-way leaving the node
 * has no approach) — the same list gtraffic cycles its phases over.
 *
 * lightPole model frame: traffic arrives from local north driving +z, the
 * pole stands on the driver's right (−x) and the arm runs +x. rotateY(a)
 * sends local +z to (sin a, cos a), so heading h → yaw = atan2(h.x, h.z).
 */
export function graphSignals(g: RoadGraph, plans: Map<number, JunctionPlan>): GraphSignal[] {
  const out: GraphSignal[] = [];
  for (const [n, plan] of plans) {
    if (g.nKind[n] !== 'signal' || !plan.junction) continue;
    for (const a of plan.arms) {
      if (g.eType[a.edge] === 'oneway' && g.eB[a.edge] !== n) continue; // can't enter here
      const f = armFrame(g, a, a.trim + 2);
      // Arriving heading h = −d. The graph's approach lanes lie on the
      // (h.z, −h.x) side of travel (gtraffic laneOff) = f.left, and the
      // model's arm reaches local +x, which yaw maps to (h.z, −h.x) too. So
      // the pole stands on the OPPOSITE kerb (−f.left) and its arm reaches
      // across the road to hang the head over the approach lanes.
      const off = a.kerbHalf + 1;
      out.push({ node: n, edge: a.edge, x: (f.p.x - f.left.x * off) * U, z: (f.p.z - f.left.z * off) * U, yaw: Math.atan2(-f.d.x, -f.d.z) });
    }
  }
  return out;
}

/**
 * Which lamp is lit for approach `e` at node `n`: 0 red, 1 amber, 2 green.
 * OASIS-S3: reads the LIVE demand-actuated controller (GraphTraffic
 * signalState — the very state cars use to stop): amber is the controller's
 * own amber step before it switches (cars may still go on amber, as before),
 * so the display can never show go while cars are held.
 */
export function signalSlot(gt: GraphTraffic, n: number, e: number): 0 | 1 | 2 {
  const J = gt.junctions.get(n);
  if (!J || !J.phases.length) return 0;
  if (!gt.green(n, e)) return 0;
  return J.phases.length > 1 && gt.signalState(n).mode === 'amber' ? 1 : 2;
}

/* --------------------------------------------------------------- helpers */

/** Unit tangent of edge e at parameter t. */
function tangentAt(g: RoadGraph, e: number, t: number): V2 {
  return tangent(g.eCurve[e], t);
}
