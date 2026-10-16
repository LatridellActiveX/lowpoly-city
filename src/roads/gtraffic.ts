/**
 * roads/gtraffic.ts — V1.6 B4: TRAFFIC ON THE ROAD GRAPH.
 *
 * LANES AND CONNECTORS
 *   Every edge has ROAD_SPEC lanes per direction (right-hand traffic; lane
 *   0 is the inner lane next to the centre line). At each node, CONNECTORS
 *   join an incoming lane end to an outgoing lane start with a cubic curve.
 *   Turn type comes from the signed angle between the approach and exit:
 *   straight (|θ| < 30°), left, right; U-turns are not generated. On multi-
 *   lane roads a left turn may only use lane 0, a right turn only the outer
 *   lane, straight any lane (the 1.5 "pick a lane for your turn" rule as
 *   connector eligibility). Lane ends stop CLEAR metres short of the node
 *   (the junction box).
 *
 * CONFLICTS
 *   For each node the connectors' curves are tested pairwise (16-segment
 *   polylines, segX) once at build time; two connectors that cross, or that
 *   end in the same exit lane (merge), CONFLICT. The matrix is a flat
 *   Uint8Array per node, so "may I enter?" is O(connectors at the node).
 *
 * JUNCTION CONTROL (node kind)
 *   plain       first come: enter when no conflicting connector is occupied.
 *   stop        come to a full stop (STOP_WAIT s) at the line, then as plain.
 *   signal      one PHASE green at a time, SIGNAL_GREEN s each plus
 *               SIGNAL_CLEAR all-red. OASIS-AVENUE: a phase is a pair of
 *               OPPOSITE approaches (a through road) or a lone approach, so a
 *               T or a cross runs 2 phases; nearby lights (≤ 48 m) are
 *               offset into a green wave (GraphTraffic.offset). RIGHT-ON-RED (the 1.5b fix):
 *               a right-turner on red stops ROR_STOP s, then goes if no
 *               occupied connector shares its EXIT lane and the exit lane's
 *               first ROR_GAP metres are empty. It does not wait for
 *               traffic it doesn't merge with.
 *   roundabout  ring edges (both ends roundabout nodes) have priority:
 *               an entering vehicle (approach not a ring edge) yields while
 *               any conflicting connector is occupied or a ring vehicle is
 *               within YIELD_GAP metres of the node on the ring approach.
 *
 * PATHFINDING
 *   A* over nodes (edges = road edges), cost = length / speed (or length
 *   only for `metric: 'length'`), a binary heap on typed arrays with reused
 *   buffers. Results are cached per (from node, to node) in an LRU of
 *   PATH_CACHE entries, dropped whenever the graph version changes.
 *
 * MOTION
 *   A vehicle is on a SEGMENT: a lane of an edge (between the clearances)
 *   or a connector. Position = distance s along it; the point comes from the
 *   arc-length LUT, so speed is constant on curves. No global scans:
 *   vehicles live in per-segment arrays ordered by s (rearmost first).
 *
 * OASIS-SAFEGAP: THE SAFE-GAP RULE (Parker, 2026-10-16: "traffic bumps into
 * each other too much and the cars merge into each other on the road")
 *   In plain words, every driver does the same three things each tick:
 *    1. LOOK at the one car directly ahead — on this lane, or, near the end
 *       of the lane, the last car on the connector / exit lane it is about
 *       to drive onto (the old code only looked inside its own segment, so a
 *       car at the end of a lane drove blind into the back of a car that had
 *       just turned). A red light / closed junction counts as a parked "car"
 *       at the stop line.
 *    2. MEASURE the free gap bumper-to-bumper, using each vehicle's REAL
 *       drawn length (a car model is ~8.5 m, a truck ~13.8 m; the old 4.5 m
 *       is why the models overlapped even when the sim thought they didn't).
 *    3. PICK A SPEED: the fastest speed from which it could still stop
 *       behind that car if it braked hard right now (reaction time
 *       HEADWAY s + braking) — in steady flow that is a "1.5-second rule" —
 *       capped by the road's limit. Speed
 *       moves towards that target by at most ACC (speeding up) or DEC
 *       (braking) per second, so motion is smooth, and a car is NEVER moved
 *       further than the free gap — the hard no-overlap guarantee.
 *   That single rule is the only speed authority (lanes, connectors, stop
 *   lines, destinations).
 */
import { at, buildLut, Cubic, polyline, segX, tAtLength, tangent, V2 } from './bezier';
import { LANE_M, RoadGraph, ROAD_SPEC } from './graph';
import { planAll, rings } from './junctions';

/** Lane width = the B6 cross-section's lane (cars must fit visibly). */
export const LANE_W = LANE_M;
export const STRAIGHT_DEG = 30;
export const SIGNAL_GREEN = 12, SIGNAL_CLEAR = 2;
export const ROR_STOP = 1, ROR_GAP = 12;
export const STOP_WAIT = 1;
export const YIELD_GAP = 15;
export const PATH_CACHE = 2048;
/**
 * OASIS-SAFEGAP: REAL model lengths in metres (render/vehicles.ts: the car
 * body + bumpers span ±0.132 tile, the truck cab-to-box ±0.216 tile at
 * TILE_M = 32 m; the truck is treated as centred on its longer half, so the
 * figure is conservative). MIN_GAP = bumper-to-bumper standstill gap.
 */
export const CAR_LEN = 8.5, TRUCK_LEN = 13.8, MIN_GAP = 1.5;
/** OASIS-SAFEGAP: length of a vehicle carrying `trip` (decorative cars: CAR_LEN). */
export const vehicleLength = (trip?: { kind: 'car' | 'truck' }) => (trip?.kind === 'truck' ? TRUCK_LEN : CAR_LEN);
/**
 * OASIS-SAFEGAP: centre-to-centre distance two vehicles must keep at least
 * (half of each body + the standstill gap). Positions s are CENTRES.
 */
export const minSpacing = (a: { length: number }, b: { length: number }) => (a.length + b.length) / 2 + MIN_GAP;
/**
 * OASIS-AVENUE: distance from an arm's trim to the REAR edge of its painted
 * stop line (render/graphRoads.ts crossing(): crosswalk trim+0.5…trim+3.5,
 * stop line trim+4.3…trim+4.8). Waiting cars hold with their front here.
 */
export const STOP_LINE_BACK = 4.8;
/** OASIS-AVENUE: shortest drivable lane kept on any edge (room for one waiting car + gap). (OASIS-SAFEGAP: kept at 8 m — a shorter-than-a-car lane still takes one car when empty, see exitRoom; a longer minimum pulled stop lines into the box on short links.) */
export const MIN_LANE = 8;
/** OASIS-AVENUE: seconds at the line before a car at a plain/stop junction claims its turn. */
export const STARVE_WAIT = 6;
/**
 * OASIS-SAFEGAP speed rule parameters:
 *  ACC      most a car speeds up, m/s per second (gentle)
 *  DEC      most a car slows down, m/s per second (firm but smooth braking)
 *  HEADWAY  reaction time (s): in steady flow the free gap settles at
 *           HEADWAY seconds of driving (a "1.5-second rule"; 2 s measured the
 *           same throughput within noise, 1.5 s keeps queues shorter)
 *  CREEP    a car may always roll this slowly into a gap of ≥ CREEP metres,
 *           so queues close up and cars reach the stop line instead of
 *           crawling towards it for ever (target = gap / HEADWAY → 0).
 *  LOOK     how far ahead (m) a car looks for a leader / stop line beyond
 *           the end of its own segment: enough to stop from 25 m/s.
 */
/** OASIS-SAFEGAP: how far (m) along the kerb a pulling-out car may look for a free gap. */
export const PULL_OUT = 24;
export const ACC = 3, DEC = 5, HEADWAY = 1.5, CREEP = 2, LOOK = 60;

export interface Connector { node: number; inEdge: number; inLane: number; outEdge: number; outLane: number; turn: 'left' | 'straight' | 'right'; curve: Cubic; lut: Float32Array; len: number }
/**
 * phaseEdges: every approach (incoming edge) that has a signal head.
 * phases (OASIS-AVENUE fix #4): the signal PHASES — groups of approaches
 * that are green together. Opposite approaches of a through road (within
 * 30° of straight across) share one phase, so a T junction runs 2 phases
 * (through road, side road) and a cross 2 phases (N–S, E–W) instead of one
 * phase per approach (3 or 4), which gave each through direction only a
 * third/quarter of the cycle. Left turns stay permissive: they enter only
 * when no conflicting connector is occupied (conflict matrix, conflictFree).
 */
export interface Junction {
  conns: Connector[]; conflict: Uint8Array; occupied: Int32Array; phaseEdges: number[]; phases: number[][];
  /**
   * OASIS-AVENUE ANTI-STARVATION (plain / stop junctions): the connector the
   * longest-waiting car at the line wants (−1 none) and that car's wait.
   * `claim` collects this frame's candidate, `held` is last frame's winner,
   * which conflicting movements must leave free (see mayEnter).
   */
  claim: number; claimWait: number; held: number;
}

/** Segment ids: lanes are (edge, dir, lane); connectors are per node. */
type Seg = { kind: 'lane'; edge: number; dir: 0 | 1; lane: number } | { kind: 'conn'; node: number; idx: number };
const laneKey = (e: number, dir: number, lane: number) => `${e}:${dir}:${lane}`;

export interface Vehicle {
  id: number; path: number[]; /** nodes along the path, path[i] edge goes nodes[i] → nodes[i+1] */ nodes: number[];
  i: number; seg: Seg; s: number; v: number; lane: number;
  wait: number; stopped: number; done: boolean; length: number;
  /**
   * OASIS: a LIVE city trip riding this vehicle (sim/livegraph.ts). Decorative
   * cars have none. `onArrive` fires exactly once when the vehicle reaches
   * the end of its path (deliveries land, commuters reach work, garbage is
   * burned...). A vehicle that GIVES UP (gridlock) is dropped without it,
   * exactly like a tile car that gives up (sim/traffic.ts STUCK_SECONDS).
   */
  trip?: { kind: 'car' | 'truck'; color: number; purpose: string; onArrive?: () => void };
  /**
   * OASIS: where on its LAST lane the vehicle stops (lane distance s). Live
   * trips start and end at a building's frontage in the middle of a road,
   * not at a junction; undefined = drive to the end of the last lane.
   */
  endS?: number;
}
/** OASIS: seconds (graph time) a live vehicle may sit still before it gives up. */
export const GIVE_UP = 90;

/** Clearance (junction box radius) at node n. */
export function nodeClear(g: RoadGraph, n: number): number {
  if (g.nEdges[n].length <= 1) return 0;
  // OASIS-AVENUE: a PLAIN node joining just two roads (a bend, or where a
  // street turns into an avenue) has no cross traffic, so it needs only a
  // short transition, not a full junction box. With the full box, a 32 m
  // avenue piece between two such nodes had a 0 m lane and pinned every car.
  if (g.nEdges[n].length === 2 && g.nKind[n] === 'plain') return 2;
  let w = 0; for (const e of g.nEdges[n]) w = Math.max(w, ROAD_SPEC[g.eType[e]].width / 2);
  return w + 2;
}

export class GraphTraffic {
  junctions = new Map<number, Junction>();
  vehicles: Vehicle[] = [];
  private onSeg = new Map<string, Vehicle[]>();
  private cache = new Map<string, { edges: number[]; nodes: number[] } | null>();
  private cacheVersion = -1;
  private nextId = 1;
  time = 0;
  stats = { spawned: 0, arrived: 0, rightOnRed: 0, yields: 0, noRoute: 0, gaveUp: 0 };
  /** Lengths/points of lane segments are derived from the edge LUT on demand. */
  constructor(public g: RoadGraph) { this.build(); }

  /* ---------------- geometry ---------------- */
  lanes(e: number): number { return ROAD_SPEC[this.g.eType[e]].lanes; }
  /** Lane centre offset (to the right of travel). */
  laneOff(lane: number, e = -1): number { return (e >= 0 ? ROAD_SPEC[this.g.eType[e]].median / 2 : 0) + (lane + 0.5) * LANE_W; }
  /** Start / end arc length of the drivable part of edge e. */
  span(e: number): [number, number] {
    const a = e < this.clrA.length && this.clrA[e] >= 0 ? this.clrA[e] : nodeClear(this.g, this.g.eA[e]);
    const b = e < this.clrB.length && this.clrB[e] >= 0 ? this.clrB[e] : nodeClear(this.g, this.g.eB[e]);
    return [a, this.g.eLen[e] - b];
  }
  /**
   * OASIS-AVENUE STOP LINES: how far from each end node the lanes of edge e
   * stop (−1 = use nodeClear). A lane ENDS where its cars must wait, and the
   * vehicle point `s` is the car's CENTRE (the renderer draws the model
   * centred there), so the lane ends half a car length behind the line:
   *  - a JUNCTION (degree ≥ 3, plan.junction) whose arm got a crosswalk:
   *    the painted stop line (render/graphRoads.ts crossing()) sits at
   *    trim + STOP_LINE_BACK from the node; cars hold with their FRONT on its
   *    rear edge, never on the crosswalk or inside the box;
   *  - a junction arm too short for a crosswalk, a ROUNDABOUT entry (yield
   *    at the rim), or any other plated node: hold right at the trim (+0.3 m);
   *  - otherwise (plain bends, dead ends): nodeClear as before.
   * Everything past that point is the junction box, crossed on a connector,
   * which a car only enters when its exit lane has room to clear the box
   * (mayEnter "don't block the box"). Rebuilt with the junctions (build()).
   */
  private clrA = new Float64Array(0);
  private clrB = new Float64Array(0);
  private buildStopLines(): void {
    const g = this.g, n = g.eAlive.length;
    this.clrA = new Float64Array(n).fill(-1); this.clrB = new Float64Array(n).fill(-1);
    const rs = rings(g), ringNode = new Set<number>(rs.flatMap((r) => r.nodes));
    const plans = planAll(g, rs);
    for (const [node, plan] of plans) {
      const ring = ringNode.has(node);
      if (!plan.junction && !ring) continue;
      for (const arm of plan.arms) {
        if (ring && ringNode.has(g.other(arm.edge, node))) continue; // the ring's own edges: no entry line
        const len = g.eLen[arm.edge];
        // Same test crossing() uses to decide whether this arm is painted.
        const painted = plan.junction && !ring && arm.trim + STOP_LINE_BACK - 1.3 + 2 <= len / 2;
        const d = (painted ? arm.trim + STOP_LINE_BACK : arm.trim + 0.3) + CAR_LEN / 2;
        if (arm.atA) this.clrA[arm.edge] = d; else this.clrB[arm.edge] = d;
      }
    }
    // A short link between two junctions must still hold at least one
    // waiting car (MIN_LANE): otherwise "don't block the box" can never let
    // anyone onto it and the two junctions deadlock (gtraffic bench: a 32 m
    // link kept a 4 m lane). Pull both hold points towards their nodes,
    // proportionally, until the lane is MIN_LANE long (or as long as it can be).
    for (const e of g.liveEdges()) {
      const a = this.clrA[e] >= 0 ? this.clrA[e] : nodeClear(g, g.eA[e]);
      const b = this.clrB[e] >= 0 ? this.clrB[e] : nodeClear(g, g.eB[e]);
      const len = g.eLen[e];
      if (len - a - b >= MIN_LANE || a + b <= 0) continue;
      const k = Math.max(0, len - MIN_LANE) / (a + b);
      this.clrA[e] = a * k; this.clrB[e] = b * k;
    }
  }
  /** Point on lane (e, dir, lane) at distance s from its start (dir 0 = a→b). */
  lanePoint(e: number, dir: 0 | 1, lane: number, s: number): V2 {
    const [s0, s1] = this.span(e), L = this.g.eLen[e];
    const sa = dir === 0 ? s0 + s : L - (L - s1) - s; // along a→b
    const t = tAtLength(this.g.eLut[e], Math.max(0, Math.min(L, sa)));
    const p = at(this.g.eCurve[e], t), d = tangent(this.g.eCurve[e], t);
    const sg = dir === 0 ? 1 : -1, o = this.laneOff(lane, e);
    // right of travel: travel dir = sg·d → right normal = (sg·d.z, −sg·d.x)
    return { x: p.x + sg * d.z * o, z: p.z - sg * d.x * o };
  }
  laneLen(e: number): number { const [a, b] = this.span(e); return Math.max(0, b - a); }
  private laneDir(e: number, dir: 0 | 1, atEnd: boolean): V2 {
    const t = atEnd ? (dir === 0 ? 1 : 0) : dir === 0 ? 0 : 1;
    const d = tangent(this.g.eCurve[e], t);
    return dir === 0 ? d : { x: -d.x, z: -d.z };
  }

  /** (Re)build connectors and conflict matrices for every node. */
  build(): void {
    const g = this.g;
    this.junctions.clear();
    this.buildStopLines(); // before the connectors: they start at the lane ends
    for (const n of g.liveNodes()) this.junctions.set(n, this.buildNode(n));
    this.cache.clear(); this.cacheVersion = g.version;
  }
  private buildNode(n: number): Junction {
    const g = this.g, conns: Connector[] = [];
    const es = g.nEdges[n];
    for (const ein of es) for (const eout of es) {
      if (ein === eout) continue;
      if (g.eType[ein] === 'oneway' && g.eB[ein] !== n) continue; // oneway: only a→b arrives at b
      if (g.eType[eout] === 'oneway' && g.eA[eout] !== n) continue;
      const dirIn: 0 | 1 = g.eB[ein] === n ? 0 : 1, dirOut: 0 | 1 = g.eA[eout] === n ? 0 : 1;
      const din = this.laneDir(ein, dirIn, true), dout = this.laneDir(eout, dirOut, false);
      const ang = Math.atan2(din.x * dout.z - din.z * dout.x, din.x * dout.x + din.z * dout.z) * 180 / Math.PI;
      if (Math.abs(ang) > 170) continue; // no U-turns
      // Lanes sit on the (d.z, −d.x) side of travel (laneOff/lanePoint), so a
      // turn TOWARDS that kerb side — the one that crosses no oncoming lane —
      // has a negative cross product: that is the RIGHT turn.
      const turn: Connector['turn'] = Math.abs(ang) < STRAIGHT_DEG ? 'straight' : ang < 0 ? 'right' : 'left';
      const li = this.lanes(ein), lo = this.lanes(eout);
      for (let a = 0; a < li; a++) {
        if (li > 1 && turn === 'left' && a !== 0) continue;
        if (li > 1 && turn === 'right' && a !== li - 1) continue;
        const b = turn === 'left' ? 0 : turn === 'right' ? lo - 1 : Math.min(a, lo - 1);
        const p0 = this.lanePoint(ein, dirIn, a, this.laneLen(ein)), p3 = this.lanePoint(eout, dirOut, b, 0);
        const k = Math.hypot(p3.x - p0.x, p3.z - p0.z) / 3;
        const curve = Float64Array.of(p0.x, p0.z, p0.x + din.x * k, p0.z + din.z * k, p3.x - dout.x * k, p3.z - dout.z * k, p3.x, p3.z);
        const lut = buildLut(curve, 24);
        conns.push({ node: n, inEdge: ein, inLane: a, outEdge: eout, outLane: b, turn, curve, lut, len: lut[lut.length - 1] });
      }
    }
    const m = conns.length, conflict = new Uint8Array(m * m);
    const polys = conns.map((c) => polyline(c.curve, 16));
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
      const A = conns[i], B = conns[j];
      let x = A.outEdge === B.outEdge && A.outLane === B.outLane; // merge into the same lane
      if (!x && !(A.inEdge === B.inEdge && A.inLane === B.inLane)) { // same entry lane: queue, not conflict
        const pa = polys[i], pb = polys[j];
        outer: for (let u = 0; u < 16; u++) for (let v = 0; v < 16; v++) {
          // ignore touching at the very ends (shared lane end/start points)
          const r = segX(pa[2 * u], pa[2 * u + 1], pa[2 * u + 2], pa[2 * u + 3], pb[2 * v], pb[2 * v + 1], pb[2 * v + 2], pb[2 * v + 3]);
          if (r && !((u === 0 && r[0] < 1e-6) || (u === 15 && r[0] > 1 - 1e-6))) { x = true; break outer; }
        }
      }
      if (x) conflict[i * m + j] = conflict[j * m + i] = 1;
    }
    const phaseEdges = es.filter((e) => !(g.eType[e] === 'oneway' && g.eB[e] !== n));
    // OASIS-AVENUE fix #4: pair opposite approaches into one phase (see Junction).
    const phases: number[][] = [], used = new Set<number>();
    for (const e of phaseEdges) {
      if (used.has(e)) continue;
      used.add(e);
      const d = g.dirAt(e, n);
      // The most nearly opposite remaining approach, if within 30° of straight across.
      let best = -1, bestDot = -Math.cos((30 * Math.PI) / 180);
      for (const f of phaseEdges) {
        if (used.has(f)) continue;
        const o = g.dirAt(f, n), dot = d.x * o.x + d.z * o.z;
        if (dot <= bestDot) { best = f; bestDot = dot; }
      }
      if (best >= 0) { used.add(best); phases.push([e, best]); } else phases.push([e]);
    }
    return { conns, conflict, occupied: new Int32Array(m), phaseEdges, phases, claim: -1, claimWait: 0, held: -1 };
  }
  /** Do connectors i and j at node n conflict? */
  conflicts(n: number, i: number, j: number): boolean { const J = this.junctions.get(n)!; return J.conflict[i * J.conns.length + j] === 1; }

  /* ---------------- pathfinding ---------------- */
  private heapN = new Int32Array(0); private heapF = new Float64Array(0);
  private gScore = new Float64Array(0); private prevE = new Int32Array(0); private stamp = new Int32Array(0); private curStamp = 0;
  /** A* from node a to node b; returns edges and nodes, or null. */
  route(a: number, b: number, metric: 'time' | 'length' = 'time'): { edges: number[]; nodes: number[] } | null {
    const g = this.g;
    if (this.cacheVersion !== g.version) this.build();
    const key = `${a}>${b}>${metric}`;
    if (this.cache.has(key)) { const v = this.cache.get(key)!; this.cache.delete(key); this.cache.set(key, v); return v; }
    const N = g.nx.length;
    if (this.gScore.length < N) { this.gScore = new Float64Array(N); this.prevE = new Int32Array(N); this.stamp = new Int32Array(N); this.heapN = new Int32Array(N * 4); this.heapF = new Float64Array(N * 4); }
    const st = ++this.curStamp, vmax = 25;
    const h = (n: number) => Math.hypot(g.nx[n] - g.nx[b], g.nz[n] - g.nz[b]) / (metric === 'time' ? vmax : 1);
    let hs = 0;
    const push = (n: number, f: number) => {
      if (hs >= this.heapN.length) { const nn = new Int32Array(hs * 2), nf = new Float64Array(hs * 2); nn.set(this.heapN); nf.set(this.heapF); this.heapN = nn; this.heapF = nf; }
      let i = hs++; this.heapN[i] = n; this.heapF[i] = f;
      while (i > 0) { const p = (i - 1) >> 1; if (this.heapF[p] <= this.heapF[i]) break; [this.heapN[p], this.heapN[i]] = [this.heapN[i], this.heapN[p]]; [this.heapF[p], this.heapF[i]] = [this.heapF[i], this.heapF[p]]; i = p; }
    };
    const pop = (): number => {
      const top = this.heapN[0]; hs--; this.heapN[0] = this.heapN[hs]; this.heapF[0] = this.heapF[hs];
      let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hs && this.heapF[l] < this.heapF[m]) m = l; if (r < hs && this.heapF[r] < this.heapF[m]) m = r; if (m === i) break; [this.heapN[m], this.heapN[i]] = [this.heapN[i], this.heapN[m]]; [this.heapF[m], this.heapF[i]] = [this.heapF[i], this.heapF[m]]; i = m; }
      return top;
    };
    this.stamp[a] = st; this.gScore[a] = 0; this.prevE[a] = -1; push(a, h(a));
    let found = false;
    while (hs) {
      const n = pop();
      if (n === b) { found = true; break; }
      const gn = this.gScore[n];
      for (const e of g.nEdges[n]) {
        if (g.eType[e] === 'oneway' && g.eA[e] !== n) continue;
        const m = g.other(e, n);
        const c = gn + g.eLen[e] / (metric === 'time' ? ROAD_SPEC[g.eType[e]].speed : 1);
        if (this.stamp[m] !== st || c < this.gScore[m] - 1e-9) { this.stamp[m] = st; this.gScore[m] = c; this.prevE[m] = e; push(m, c + h(m)); }
      }
    }
    let res: { edges: number[]; nodes: number[] } | null = null;
    if (found) {
      const edges: number[] = [], nodes = [b];
      for (let n = b; n !== a;) { const e = this.prevE[n]; edges.push(e); n = g.other(e, n); nodes.push(n); }
      res = { edges: edges.reverse(), nodes: nodes.reverse() };
    }
    this.cache.set(key, res);
    if (this.cache.size > PATH_CACHE) this.cache.delete(this.cache.keys().next().value!);
    return res;
  }
  /** Length in metres of a route (edges, for parity tests). */
  routeLength(r: { edges: number[] }): number { return r.edges.reduce((s, e) => s + this.g.eLen[e], 0); }

  /* ---------------- vehicles ---------------- */
  private list(seg: Seg): Vehicle[] {
    const k = seg.kind === 'lane' ? laneKey(seg.edge, seg.dir, seg.lane) : `c${seg.node}:${seg.idx}`;
    let l = this.onSeg.get(k); if (!l) { l = []; this.onSeg.set(k, l); } return l;
  }
  private segLen(seg: Seg): number { return seg.kind === 'lane' ? this.laneLen(seg.edge) : this.junctions.get(seg.node)!.conns[seg.idx].len; }
  private dirOf(e: number, from: number): 0 | 1 { return this.g.eA[e] === from ? 0 : 1; }
  /** Spawn a vehicle from node a to node b. */
  spawn(a: number, b: number, trip?: Vehicle['trip']): Vehicle | null {
    const r = this.route(a, b);
    if (!r || !r.edges.length) { this.stats.noRoute++; return null; }
    const e = r.edges[0], dir = this.dirOf(e, a);
    const lane = this.laneFor(r.edges, r.nodes, 0);
    const seg: Seg = { kind: 'lane', edge: e, dir, lane };
    const l = this.list(seg);
    // Lists are ordered by s ascending (rearmost first): a new car enters at the back.
    // OASIS-SAFEGAP: entry blocked unless the rearmost car is a full real-length spacing away.
    const len0 = vehicleLength(trip);
    if (l.length && l[0].s < (l[0].length + len0) / 2 + MIN_GAP) return null;
    // OASIS-AVENUE: nor may it pull out in front of a car that is crossing
    // the junction box into this very lane: that car would be stuck in the
    // box (its exit start is taken), blocking every crossing movement —
    // the seed of a box gridlock on busy plain junctions.
    { const J = this.junctions.get(a); if (J) for (let j = 0; j < J.conns.length; j++) if (J.occupied[j] > 0 && J.conns[j].outEdge === e) return null; }
    const v: Vehicle = { id: this.nextId++, path: r.edges, nodes: r.nodes, i: 0, seg, s: 0, v: 0, lane, wait: 0, stopped: 0, done: false, length: len0, trip };
    l.unshift(v); this.vehicles.push(v); this.stats.spawned++;
    return v;
  }
  /**
   * OASIS: lane distance s on (edge e, direction dir) of the point `arc`
   * metres along the edge's a→b curve, clamped to the drivable lane.
   */
  laneS(e: number, dir: 0 | 1, arc: number): number {
    const [s0, s1] = this.span(e);
    return Math.max(0, Math.min(this.laneLen(e), dir === 0 ? arc - s0 : s1 - arc));
  }
  /**
   * OASIS: spawn a vehicle MID-ROAD — from `arcA` metres along edge eA to
   * `arcB` metres along edge eB (arc lengths measured a→b on each edge's
   * curve), the way a trip from one building's frontage to another's runs.
   *
   * The car may set off in either direction and arrive from either end, so
   * up to four candidate paths are compared (2 start directions × 2 arrival
   * directions), each = rest of the start lane + A* between the junctions +
   * the part of the last lane up to the stop. Candidates that would need a
   * U-turn (the A* route doubling back over the start or end edge) are
   * skipped; there are no U-turn connectors. Same edge, stop ahead: drive
   * straight there. Returns null when no candidate exists (no connection)
   * or the start spot is occupied — the caller then falls back.
   */
  spawnAt(eA: number, arcA: number, eB: number, arcB: number, trip?: Vehicle['trip']): Vehicle | null {
    const g = this.g;
    if (this.cacheVersion !== g.version) this.build();
    let best: { path: number[]; nodes: number[]; dir: 0 | 1; cost: number; endS: number } | null = null;
    const consider = (c: NonNullable<typeof best>) => { if (!best || c.cost < best.cost) best = c; };
    for (const dir of [0, 1] as const) {
      if (g.eType[eA] === 'oneway' && dir === 1) continue;
      const startNode = dir === 0 ? g.eA[eA] : g.eB[eA], exitNode = dir === 0 ? g.eB[eA] : g.eA[eA];
      const sStart = this.laneS(eA, dir, arcA), restA = this.laneLen(eA) - sStart;
      if (eA === eB) {
        // Same road: the stop is straight ahead in this direction?
        const sEnd = this.laneS(eB, dir, arcB);
        if (sEnd > sStart + 1) consider({ path: [eA], nodes: [startNode, exitNode], dir, cost: sEnd - sStart, endS: sEnd });
      }
      for (const dirB of [0, 1] as const) {
        if (g.eType[eB] === 'oneway' && dirB === 1) continue;
        const entryB = dirB === 0 ? g.eA[eB] : g.eB[eB], endNode = dirB === 0 ? g.eB[eB] : g.eA[eB];
        const r = exitNode === entryB ? { edges: [] as number[], nodes: [exitNode] } : this.route(exitNode, entryB, 'length');
        if (!r) continue;
        if (r.edges.length && (r.edges[0] === eA || r.edges[r.edges.length - 1] === eB)) continue; // would need a U-turn
        if (!r.edges.length && eA === eB) continue; // same edge, turning round at its own end: U-turn
        if (!r.edges.length && this.connector(exitNode, eA, eB, -1) < 0) continue; // no turn allowed between them
        const sEnd = this.laneS(eB, dirB, arcB);
        consider({ path: [eA, ...r.edges, eB], nodes: [startNode, ...r.nodes, endNode], dir, cost: restA + this.routeLength(r) + sEnd, endS: sEnd });
      }
    }
    if (!best) { this.stats.noRoute++; return null; }
    const b: { path: number[]; nodes: number[]; dir: 0 | 1; cost: number; endS: number } = best;
    const lane = this.laneFor(b.path, b.nodes, 0);
    const seg: Seg = { kind: 'lane', edge: eA, dir: b.dir, lane };
    const sWant = this.laneS(eA, b.dir, arcA), l = this.list(seg);
    // Pull out only into a gap: nobody within a (real-length) spacing either
    // side. OASIS-SAFEGAP: the car behind must also be able to brake for us —
    // it needs its own stopping distance v²/(2·DEC) on top of the spacing.
    const len0 = vehicleLength(trip);
    const free = (s0: number) => {
      for (const o of l) {
        const need = (o.length + len0) / 2 + MIN_GAP;
        if (Math.abs(o.s - s0) < need) return false;
        if (o.s < s0 && s0 - o.s < need + (o.v * o.v) / (2 * DEC)) return false; // would cut in front of a moving car
      }
      return true;
    };
    // OASIS-SAFEGAP: with real 8.5 m cars the exact frontage spot is taken
    // more often, so the driver pulls out into the NEAREST free gap within
    // PULL_OUT metres along the kerb (like pulling out a few car lengths
    // further up), instead of giving the trip back to the tile router.
    // A same-road trip must still start before its stop.
    const L0 = this.laneLen(eA), maxS = b.path.length === 1 ? b.endS - 1 : L0;
    let s0 = -1;
    for (let d = 0; d <= PULL_OUT && s0 < 0; d += 1.5) for (const c of d ? [sWant - d, sWant + d] : [sWant]) if (s0 < 0 && c >= 0 && c <= Math.min(L0, maxS) && free(c)) s0 = c;
    if (s0 < 0) return null;
    const v: Vehicle = { id: this.nextId++, path: b.path, nodes: b.nodes, i: 0, seg, s: s0, v: 0, lane, wait: 0, stopped: 0, done: false, length: len0, trip, endS: b.endS };
    // Keep the per-lane list ordered by s (rearmost first).
    let k = 0; while (k < l.length && l[k].s < s0) k++;
    l.splice(k, 0, v); this.vehicles.push(v); this.stats.spawned++;
    return v;
  }
  /** Lane to drive on along path edge i, chosen for the next turn. */
  private laneFor(edges: number[], nodes: number[], i: number, entering?: Vehicle): number {
    const e = edges[i], n = this.lanes(e);
    if (n === 1 || i + 1 >= edges.length) return 0;
    // OASIS-SAFEGAP LANE CHOICE ONLY INTO A SAFE GAP: when a car is actually
    // about to drive onto edge i (`entering`), a lane whose rearmost car sits
    // closer than one spacing to the lane start is skipped while another
    // eligible lane has room (there is never a car behind at s = 0, so only
    // the gap ahead matters here). Without `entering` it is the plain choice.
    const dirE = this.dirOf(e, nodes[i]);
    const roomy = (lane: number) => { if (!entering) return true; const l = this.list({ kind: 'lane', edge: e, dir: dirE, lane }); return !l.length || l[0].s >= minSpacing(l[0], entering); };
    const node = nodes[i + 1], J = this.junctions.get(node);
    if (!J) return 0;
    // OASIS-AVENUE fix #3: USE EVERY LANE THAT GOES WHERE THE CAR IS GOING.
    // The old code took the FIRST connector for (e → next edge). Turns have
    // exactly one lane (left: inner, right: kerb), but STRAIGHT has one
    // connector per lane, and "first" always meant lane 0 — so every
    // through car queued in the inner lane and an avenue carried no more
    // through traffic than a street. Now: among the lanes with a connector
    // to the next edge, take the one with the shortest queue in this
    // direction (ties → the vehicle's own path parity, so a burst of cars
    // spreads over both lanes). (The old `return c ? … : 0` also mis-read
    // connector index 0 as "none"; same result, but fixed here.)
    const dir = this.dirOf(e, nodes[i]);
    let best = -1, bestQ = Infinity;
    for (const c of J.conns) {
      if (c.inEdge !== e || c.outEdge !== edges[i + 1]) continue;
      // (a lane with no room for `entering` costs +1000: chosen only if nothing better)
      const q = this.list({ kind: 'lane', edge: e, dir, lane: c.inLane }).length + ((c.inLane + edges.length) % 2) * 0.5 + (roomy(c.inLane) ? 0 : 1000);
      if (q < bestQ) { bestQ = q; best = c.inLane; }
    }
    return best < 0 ? 0 : best;
  }
  /** Connector index at node for (inEdge → outEdge), preferring inLane (or any when −1). */
  connector(node: number, inEdge: number, outEdge: number, inLane: number): number {
    const J = this.junctions.get(node); if (!J) return -1;
    let any = -1;
    for (let i = 0; i < J.conns.length; i++) { const c = J.conns[i]; if (c.inEdge === inEdge && c.outEdge === outEdge) { if (c.inLane === inLane || inLane < 0) return i; if (any < 0) any = i; } }
    return any;
  }
  /** Signal state: is the approach on edge e green at node n? */
  green(n: number, e: number): boolean {
    const J = this.junctions.get(n)!, k = J.phases.length;
    if (k <= 1) return true; // one phase (a through road with no side road): always green
    const cyc = SIGNAL_GREEN + SIGNAL_CLEAR, tt = (this.time + this.offset(n)) % (cyc * k), ph = Math.floor(tt / cyc);
    return J.phases[ph].includes(e) && tt - ph * cyc < SIGNAL_GREEN;
  }
  /**
   * OASIS-AVENUE fix #4b: a per-node phase OFFSET (seconds) so lights close
   * together run as a GREEN WAVE instead of independently. A signal that is
   * joined by a short edge (≤ 48 m) to a lower-numbered signal copies that
   * node's offset plus the travel time, so a platoon released by one light
   * arrives on green at the next. Cached per graph version.
   */
  private offsets = new Map<number, number>();
  private offsetsVersion = -1;
  offset(n: number): number {
    if (this.offsetsVersion !== this.g.version) { this.offsets.clear(); this.offsetsVersion = this.g.version; }
    const hit = this.offsets.get(n); if (hit !== undefined) return hit;
    this.offsets.set(n, 0); // cycle guard
    const g = this.g;
    let off = 0;
    for (const e of g.nEdges[n]) {
      const m = g.other(e, n);
      if (m < n && g.nKind[m] === 'signal' && g.eLen[e] <= 48) { off = this.offset(m) - g.eLen[e] / ROAD_SPEC[g.eType[e]].speed; break; }
    }
    this.offsets.set(n, off);
    return off;
  }
  /** May vehicle v, at the end of its lane, enter connector ci at node n now? */
  private mayEnter(v: Vehicle, n: number, ci: number, dt: number): boolean {
    const g = this.g, J = this.junctions.get(n)!, m = J.conns.length, c = J.conns[ci];
    // OASIS-AVENUE: at first-come junctions a left-turner facing an endless
    // stream never found a gap (the stream's connectors were always
    // occupied) and its queue starved for minutes. A car that has waited
    // STARVE_WAIT s at the line CLAIMS its movement; while the longest such
    // claim stands, conflicting movements may not start, so the box empties
    // and the claimant goes next (classic "longest waiter first").
    const yieldsToClaim = () => J.held >= 0 && J.held !== ci && J.conflict[ci * m + J.held] === 1;
    const claim = () => { if (v.wait >= STARVE_WAIT && v.wait > J.claimWait) { J.claim = ci; J.claimWait = v.wait; } };
    const conflictFree = () => {
      for (let j = 0; j < m; j++) if (J.occupied[j] > 0 && j !== ci && J.conflict[ci * m + j]) { if (kind === 'plain' || kind === 'stop') claim(); return false; }
      if ((kind === 'plain' || kind === 'stop') && yieldsToClaim()) return false;
      return true;
    };
    // DON'T BLOCK THE BOX: only enter when the exit lane has room for this car
    // after every car already in the box heading for the same lane.
    {
      // OASIS-SAFEGAP: SLOT RESERVATION, in real metres. The exit lane's free
      // start (up to its rearmost car's tail) minus the full length + gap of
      // every vehicle already in the box heading the same way must still fit
      // THIS vehicle; otherwise it waits at its stop line.
      if (!this.exitRoom(v, n, ci)) return false;
    }
    const kind = g.nKind[n];
    if (kind === 'stop') { if (v.stopped < STOP_WAIT) { v.stopped += dt; return false; } return conflictFree(); }
    if (kind === 'signal') {
      if (this.green(n, c.inEdge)) return conflictFree();
      if (c.turn !== 'right') return false;
      // Right on red (1.5b rule): stop, then yield only to traffic sharing the exit lane.
      if (v.stopped < ROR_STOP) { v.stopped += dt; return false; }
      for (let j = 0; j < m; j++) if (J.occupied[j] > 0 && J.conns[j].outEdge === c.outEdge && J.conns[j].outLane === c.outLane) return false;
      const ex = this.list({ kind: 'lane', edge: c.outEdge, dir: this.dirOf(c.outEdge, n), lane: c.outLane });
      if (ex.length && ex[0].s < ROR_GAP) return false; // rearmost car on the exit lane
      this.stats.rightOnRed++;
      return true;
    }
    if (kind === 'roundabout') {
      const ring = (e: number) => g.nKind[g.eA[e]] === 'roundabout' && g.nKind[g.eB[e]] === 'roundabout';
      if (!ring(c.inEdge)) {
        // entering: yield to ring traffic close to the node
        for (const e of g.nEdges[n]) if (ring(e) && e !== c.inEdge) {
          const dir = g.eB[e] === n ? 0 : 1;
          for (let lane = 0; lane < this.lanes(e); lane++) { const l = this.list({ kind: 'lane', edge: e, dir: dir as 0 | 1, lane }); if (l.length && this.laneLen(e) - l[l.length - 1].s < YIELD_GAP) { this.stats.yields++; return false; } }
        }
      }
      return conflictFree();
    }
    return conflictFree();
  }

  /**
   * OASIS-SAFEGAP: does the exit lane of connector ci at node n have room for
   * vehicle v after every vehicle already crossing the box onto that edge?
   * (A lane shorter than one car + gap takes one car when it is empty, so a
   * tiny link can never become a permanent wall.) Public for the tests.
   */
  exitRoom(v: Vehicle, n: number, ci: number): boolean {
    const J = this.junctions.get(n)!, m = J.conns.length, c = J.conns[ci];
    const lane = Math.min(this.laneFor(v.path, v.nodes, v.i + 1, v), this.lanes(c.outEdge) - 1);
    const ex = this.list({ kind: 'lane', edge: c.outEdge, dir: this.dirOf(c.outEdge, n), lane });
    let inBox = 0;
    for (let j = 0; j < m; j++) if (J.occupied[j] > 0 && J.conns[j].outEdge === c.outEdge) for (const o of this.list({ kind: 'conn', node: n, idx: j })) inBox += o.length + MIN_GAP;
    const L = this.laneLen(c.outEdge);
    const free = (ex.length ? ex[0].s - ex[0].length / 2 : L) - inBox; // metres of lane start not yet spoken for
    return free >= Math.min(v.length / 2 + MIN_GAP, L);
  }

  /** Advance every vehicle by dt seconds. */
  update(dt: number): void {
    this.time += dt;
    // OASIS-AVENUE anti-starvation: last frame's longest claim becomes the one honoured this frame.
    for (const J of this.junctions.values()) { J.held = J.claim; J.claim = -1; J.claimWait = 0; }
    if (this.cacheVersion !== this.g.version) this.build();
    for (const [, l] of this.onSeg) {
      // leader first (largest s)
      for (let k = l.length - 1; k >= 0; k--) this.move(l[k], l, k, dt);
    }
    // apply segment transitions after moving (keeps per-segment order stable)
    for (const v of this.pending) this.transfer(v);
    this.pending.length = 0;
    // OASIS: live trips that have been stuck too long give up (frees gridlock).
    for (const v of this.vehicles) if (v.trip && !v.done && v.wait > GIVE_UP) this.drop(v);
    if (this.vehicles.some((v) => v.done)) this.vehicles = this.vehicles.filter((v) => !v.done);
  }
  private pending: Vehicle[] = [];
  /**
   * OASIS: take a vehicle off the road without arriving (give-up). It leaves
   * its segment list and, if it was inside a junction box, frees that
   * connector so the junction does not stay "occupied" for ever.
   */
  drop(v: Vehicle): void {
    const l = this.list(v.seg), k = l.indexOf(v); if (k >= 0) l.splice(k, 1);
    if (v.seg.kind === 'conn') { const J = this.junctions.get(v.seg.node); if (J) J.occupied[v.seg.idx]--; }
    v.done = true; this.stats.gaveUp++;
  }
  /**
   * OASIS: the graph is about to be replaced (an edit changed its version, so
   * edge/node ids may be gone). Every live trip is COMPLETED on the spot
   * (onArrive) rather than lost: a delivery or a commuter mid-way when the
   * player edits a road still counts, as if the car finished its drive.
   * Returns how many trips were completed.
   */
  finishAll(): number {
    let n = 0;
    for (const v of this.vehicles) if (!v.done) { v.done = true; if (v.trip) { n++; v.trip.onArrive?.(); } }
    this.vehicles = []; this.onSeg.clear();
    return n;
  }
  /**
   * OASIS-SAFEGAP: where on its current segment vehicle v must hold when it
   * may not go on. Lanes end with a CAR_LEN car's centre half a car behind
   * the stop line; a longer truck holds (length − CAR_LEN)/2 further back so
   * its FRONT is on the line too, never on the crosswalk.
   */
  private holdS(v: Vehicle, len: number): number {
    return v.seg.kind === 'lane' ? Math.max(0, len - Math.max(0, (v.length - CAR_LEN) / 2)) : len;
  }
  /**
   * OASIS-SAFEGAP: the next segment the vehicle will drive onto (connector
   * when on a lane, exit lane when on a connector), or null at its last lane.
   */
  private nextSeg(v: Vehicle): Seg | null {
    if (v.seg.kind === 'lane') {
      if (v.i + 1 >= v.path.length) return null;
      const n = v.nodes[v.i + 1];
      const ci = (v as Vehicle & { go?: number }).go ?? this.connector(n, v.path[v.i], v.path[v.i + 1], v.seg.lane);
      return ci < 0 ? null : { kind: 'conn', node: n, idx: ci };
    }
    const c = this.junctions.get(v.seg.node)!.conns[v.seg.idx];
    return { kind: 'lane', edge: c.outEdge, dir: this.dirOf(c.outEdge, v.seg.node), lane: Math.min(this.laneFor(v.path, v.nodes, v.i + 1, v), this.lanes(c.outEdge) - 1) };
  }
  /**
   * OASIS-SAFEGAP step 1+2: the FREE GAP (metres the vehicle's centre may
   * still advance before it would come within MIN_GAP of the car ahead, or
   * pass its hold point) — Infinity when the road ahead is clear for LOOK m.
   * Looks at the car directly ahead on this segment; if there is none, at
   * the stop line (when it may not go on) or the rearmost car on the next
   * one or two segments along its path.
   */
  private freeGap(v: Vehicle, l: Vehicle[], k: number, len: number, dt: number): number {
    this.leadV = 0; // speed of whatever we found ahead (a stop line stands still)
    if (k + 1 < l.length) { const ld = l[k + 1]; this.leadV = ld.v; return ld.s - v.s - minSpacing(ld, v); }
    const room = this.holdS(v, len) - v.s;
    if (v.seg.kind === 'lane' && v.endS !== undefined && v.i + 1 >= v.path.length) return Infinity; // pulls in at its destination
    if (!this.canLeave(v, dt, room)) return room; // red / closed: the stop line is the "car ahead"
    // Road on: look past the end of this segment along the path.
    let dist = len - v.s, seg = this.nextSeg(v), hops = 0;
    while (seg && dist < LOOK && hops < 2) {
      const nl = this.list(seg);
      if (nl.length) { this.leadV = nl[0].v; return dist + nl[0].s - minSpacing(nl[0], v); }
      dist += this.segLen(seg); hops++;
      if (seg.kind === 'conn') {
        // the exit lane after this connector (laneFor at path step i + 1)
        const c = this.junctions.get(seg.node)!.conns[seg.idx];
        seg = { kind: 'lane', edge: c.outEdge, dir: this.dirOf(c.outEdge, seg.node), lane: Math.min(this.laneFor(v.path, v.nodes, v.i + 1, v), this.lanes(c.outEdge) - 1) };
      } else seg = null;
    }
    return Infinity;
  }
  /** OASIS-SAFEGAP: speed of the leader freeGap() found (scratch, set per call). */
  private leadV = 0;
  private move(v: Vehicle, l: Vehicle[], k: number, dt: number): void {
    // OASIS: a mid-road destination shortens the last lane: the car stops at
    // its building's frontage (endS) and arrives there.
    const lastLane = v.seg.kind === 'lane' && v.endS !== undefined && v.i + 1 >= v.path.length;
    const len = lastLane ? Math.min(this.segLen(v.seg), v.endS!) : this.segLen(v.seg);
    // OASIS-SAFEGAP: through the box, straight on at 12 m/s, turns at 8 m/s
    // (was 8 for everything: straight platoons crawled across and the box
    // stayed occupied longer than it had to).
    const vmax = v.seg.kind === 'lane' ? ROAD_SPEC[this.g.eType[v.seg.edge]].speed : this.junctions.get(v.seg.node)!.conns[v.seg.idx].turn === 'straight' ? 12 : 8;
    // OASIS-SAFEGAP step 3: the SAFE SPEED — the fastest speed v from which
    // this driver could still stop behind the car ahead even if that car
    // slammed on its brakes right now:
    //     reaction distance + my braking distance ≤ free gap + its braking distance
    //     v·HEADWAY + v²/(2·DEC)              ≤ gap      + vLead²/(2·DEC)
    // (solved for v below). Standing behind a stop line, vLead = 0, so it is
    // simply "can I stop before the line". With equal speeds it settles at a
    // gap of HEADWAY seconds and a queue pulling away
    // from a green light moves off together instead of one by one. Never
    // above the limit; a car may always creep (CREEP m/s) into a gap of at
    // least CREEP metres so queues close up.
    const gap = Math.max(0, this.freeGap(v, l, k, len, dt));
    const budget = gap + (this.leadV * this.leadV) / (2 * DEC);
    const safe = DEC * (-HEADWAY + Math.sqrt(HEADWAY * HEADWAY + (2 * budget) / DEC));
    const target = gap === Infinity ? vmax : Math.min(vmax, Math.max(safe, gap >= CREEP ? CREEP : gap));
    // Speed changes smoothly: at most ACC up / DEC down per second.
    v.v = Math.max(0, Math.min(vmax, v.v + Math.max(-DEC * dt, Math.min(ACC * dt, target - v.v))));
    // HARD NO-OVERLAP GUARANTEE: never advance further than the free gap.
    let ds = Math.min(v.v * dt, gap);
    if (ds < v.v * dt) v.v = ds / dt; // the gap capped us: that IS our speed now
    // A car never runs past its hold point inside one tick: it leaves the
    // segment only through the junction's decision (mayEnter) / transfer,
    // which restarts it at s = 0 on the next segment (keeping its speed).
    // Without this cap a car that saw a free road ahead but was then refused
    // at the line would creep further past the line every tick.
    const hold = this.holdS(v, len);
    if (!lastLane) ds = Math.min(ds, Math.max(0, hold - v.s));
    // Snap the last few centimetres to the hold point (the creep only approaches it).
    if (k + 1 === l.length && gap !== Infinity && Math.abs(gap - (hold - v.s)) < 1e-9 && hold - v.s - ds < 0.5 && hold - v.s - ds > 0) ds = hold - v.s;
    v.s += ds;
    if (v.v < 0.1) v.wait += dt; else v.wait = 0;
    // OASIS: a car reaching its mid-road stop arrives even with cars ahead of it.
    if (lastLane && v.s >= len - 1e-6) { this.pending.push(v); return; }
    if (v.s >= hold - 1e-6 && k + 1 === l.length) {
      // At the line: the junction decides now (mayEnter), else wait there.
      if (v.seg.kind === 'conn' && !this.canLeave(v, dt, 0)) { v.s = Math.min(v.s, len); v.v = 0; return; }
      if (v.seg.kind === 'lane' && v.i + 1 < v.path.length) {
        const n = v.nodes[v.i + 1], ci = this.connector(n, v.path[v.i], v.path[v.i + 1], v.seg.lane);
        if (ci >= 0 && !this.mayEnter(v, n, ci, dt)) { if (v.s < hold) v.s = hold; v.v = 0; return; } // never moves a car BACKWARDS (a truck that pulled out past its hold point stays put)
        // The connector's rearmost car must also be clear of us (safe gap).
        if (ci >= 0) { const cl = this.list({ kind: 'conn', node: n, idx: ci }); if (cl.length && cl[0].s + (len - v.s) < minSpacing(cl[0], v)) { v.v = 0; return; } }
        (v as Vehicle & { go?: number }).go = ci;
      }
      this.pending.push(v);
    }
  }
  /** Is the vehicle at the end of its segment allowed to continue (only checked near the end)? */
  private canLeave(v: Vehicle, dt: number, room: number): boolean {
    if (room > LOOK) return true; // OASIS-SAFEGAP: decide early enough to brake smoothly (DEC)
    if (v.seg.kind === 'conn') {
      // Leave the junction box only when the exit lane has room at its start.
      const c = this.junctions.get(v.seg.node)!.conns[v.seg.idx];
      // OASIS-SAFEGAP: room = a real-length spacing to the rearmost car there.
      const ex = this.list({ kind: 'lane', edge: c.outEdge, dir: this.dirOf(c.outEdge, v.seg.node), lane: Math.min(this.laneFor(v.path, v.nodes, v.i + 1, v), this.lanes(c.outEdge) - 1) });
      return !(ex.length && ex[0].s < minSpacing(ex[0], v));
    }
    if (v.i + 1 >= v.path.length) return true; // arrives at the end of the lane
    const n = v.nodes[v.i + 1];
    const ci = this.connector(n, v.path[v.i], v.path[v.i + 1], v.seg.lane);
    if (ci < 0) return true;
    // Look-ahead only: whether to brake for the line. The real decision is
    // taken at the line (move → mayEnter).
    return this.wantGo(v, n, ci);
  }
  private wantGo(v: Vehicle, n: number, ci: number): boolean {
    const J = this.junctions.get(n)!;
    const k = this.g.nKind[n];
    // OASIS-SAFEGAP: brake early for a full exit lane too (no last-metre slam).
    if (!this.exitRoom(v, n, ci)) return false;
    if (k === 'signal') return this.green(n, J.conns[ci].inEdge);
    if (k === 'stop') return false;
    const m = J.conns.length;
    for (let j = 0; j < m; j++) if (J.occupied[j] > 0 && j !== ci && J.conflict[ci * m + j]) return false;
    return true;
  }
  private transfer(v: Vehicle): void {
    // OASIS-SAFEGAP LAST-MOMENT CHECK: two cars leaving two different
    // connectors in the same tick can both have seen the same empty exit
    // lane (the lane is picked per car by laneFor, so connectors that never
    // "merge" on paper can still feed one lane). The first one to transfer
    // takes the slot; the second stays at the end of its connector, stopped,
    // and tries again next tick — instead of landing on top of the first.
    if (v.seg.kind === 'conn') {
      const J0 = this.junctions.get(v.seg.node)!, c0 = J0.conns[v.seg.idx];
      const lane0 = Math.min(this.laneFor(v.path, v.nodes, v.i + 1, v), this.lanes(c0.outEdge) - 1);
      const ex0 = this.list({ kind: 'lane', edge: c0.outEdge, dir: this.dirOf(c0.outEdge, v.seg.node), lane: lane0 });
      if (ex0.length && ex0[0].s < minSpacing(ex0[0], v)) { v.s = this.segLen(v.seg); v.v = 0; return; }
    }
    const from = this.list(v.seg);
    const idx = from.indexOf(v); if (idx >= 0) from.splice(idx, 1);
    if (v.seg.kind === 'lane') {
      if (v.i + 1 >= v.path.length) { v.done = true; this.stats.arrived++; v.trip?.onArrive?.(); return; } // OASIS: live trip lands
      const n = v.nodes[v.i + 1];
      const ci = (v as Vehicle & { go?: number }).go ?? this.connector(n, v.path[v.i], v.path[v.i + 1], v.seg.lane);
      v.seg = { kind: 'conn', node: n, idx: ci }; v.s = 0; v.stopped = 0;
      this.junctions.get(n)!.occupied[ci]++;
      this.list(v.seg).unshift(v);
    } else {
      const J = this.junctions.get(v.seg.node)!; J.occupied[v.seg.idx]--;
      const c = J.conns[v.seg.idx];
      v.i++;
      const lane = this.laneFor(v.path, v.nodes, v.i, v); // OASIS-SAFEGAP: a lane with a safe gap
      v.seg = { kind: 'lane', edge: c.outEdge, dir: this.dirOf(c.outEdge, v.seg.node), lane: Math.min(lane, this.lanes(c.outEdge) - 1) };
      v.s = 0; (v as Vehicle & { go?: number }).go = undefined;
      this.list(v.seg).unshift(v);
    }
  }
  /** World position of a vehicle (renderer). */
  position(v: Vehicle): V2 {
    if (v.seg.kind === 'lane') return this.lanePoint(v.seg.edge, v.seg.dir, v.seg.lane, v.s);
    const c = this.junctions.get(v.seg.node)!.conns[v.seg.idx];
    return at(c.curve, tAtLength(c.lut, v.s));
  }
}
