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
 *   signal      one PHASE green at a time. OASIS-S3: DEMAND-ACTUATED —
 *               a green rests while nobody else waits and switches to a
 *               waiting phase once its own approaches empty (MIN_GREEN …
 *               MAX_GREEN s, then AMBER_S amber + SIGNAL_CLEAR all-red; see
 *               stepSignals). OASIS-AVENUE: a phase is a pair of
 *               OPPOSITE approaches (a through road) or a lone approach, so a
 *               T or a cross runs 2 phases. RIGHT-ON-RED (the 1.5b fix):
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
import { at, buildLut, Cubic, lengthAtT, nearest, polyline, segX, tAtLength, tangent, V2 } from './bezier';
import { LANE_M, RoadGraph, ROAD_SPEC } from './graph';
import { edgeTapers, planAll, rings, Taper, taperBlend } from './junctions';

/** Lane width = the B6 cross-section's lane (cars must fit visibly). */
export const LANE_W = LANE_M;
export const STRAIGHT_DEG = 30;
export const SIGNAL_GREEN = 12, SIGNAL_CLEAR = 2;
/**
 * OASIS-S3 demand-actuated lights (see GraphTraffic.stepSignals):
 *  MIN_GREEN  a green always lasts at least this long (s)
 *  MAX_GREEN  a green that others are waiting for ends after this (s)
 *  AMBER_S    amber before the all-red, only when cars are still coming (s)
 *  DETECT     how far before the stop line a car counts as waiting (m)
 * (SIGNAL_GREEN is no longer a clock; it is kept as the typical green for
 *  the Inspect panel's wording and old tests.)
 */
export const MIN_GREEN = 5, MAX_GREEN = 20, AMBER_S = 2.5, DETECT = 60;
/** OASIS-S3: one light's controller: current phase, what it is doing, for how long, and which phase goes next. */
export interface SigState { ph: number; mode: 'green' | 'amber' | 'clear'; t: number; next: number }
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

/**
 * OASIS-S2: how far (m) a car whose road changed under it may be moved to
 * the nearest new road (a split keeps the road where it was, so this only
 * has to absorb small shifts of a re-traced road).
 */
export const SNAP_BACK = 12;
/** OASIS-S2: where a vehicle was just before a road edit (see GraphTraffic.takeSnapshot). */
interface Snap {
  /** position and heading on the map */ x: number; z: number; hx: number; hz: number;
  /** map point of its stop */ dx: number; dz: number;
  /** identity key of every edge on its route */ keys: string[];
  /** arc metres along its current edge (lanes only) and along its last edge to the stop */ arc: number; endArc: number; endDir: 0 | 1;
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
  /** OASIS-S5: edge → [taper at its a-end, at its b-end] (junctions.ts edgeTapers), rebuilt with the junctions. */
  private readonly tapers = new Map<number, [Taper | null, Taper | null]>();
  private nextId = 1;
  time = 0;
  stats = { spawned: 0, arrived: 0, rightOnRed: 0, yields: 0, noRoute: 0, gaveUp: 0 };
  /** Lengths/points of lane segments are derived from the edge LUT on demand. */
  constructor(public g: RoadGraph) {
    this.build();
    // OASIS-S2: note every car's position the moment the graph starts to
    // change (see snapshot / adopt). Optional chaining: a few tests drive a
    // bare mock graph without the hook.
    g.beforeChange?.add(this.onGraphChange);
  }
  /** OASIS-S2: stop listening to the graph (this traffic is being retired). */
  dispose(): void { this.g.beforeChange?.delete(this.onGraphChange); }
  private readonly onGraphChange = () => { if (!this.snap || this.snapFor !== this.cacheVersion) { this.snap = this.takeSnapshot(); this.snapFor = this.cacheVersion; } };

  /* ---------------- OASIS-S2: keeping traffic across road edits ----------------
   * Parker: "make it so that building roads that connect to existing roads
   * doesn't clear traffic on the existing road".
   *
   * WHY TRAFFIC USED TO VANISH: any road edit bumps the graph's version, and
   * edge/node ids can then mean something else (splitting an edge frees its
   * id and the next new edge REUSES it). The safe old answer was to finish
   * every trip on the spot and start with an empty map — every car on the
   * screen disappeared each time you built a road.
   *
   * HOW IT WORKS NOW, in three steps:
   *  1. SNAPSHOT (before the edit): the first time the graph is about to
   *     change, while the old roads still exist, every car notes where it
   *     is (map point + heading), where it is going (map point of its
   *     stop), how far along its edge it is, and an IDENTITY KEY for each
   *     edge on its route (creation stamp + length + start point — an edge
   *     that survived the edit keeps exactly that key, a split or removed
   *     one does not).
   *  2. ADOPT (after the edit, on the new traffic object): each car is put
   *     back, best option first:
   *       a. its edge still exists        → same edge, same lane, same spot
   *                                         (cars on untouched roads do not move);
   *       b. it is crossing a junction box that still has the same turn
   *                                       → stays on that turn;
   *       c. otherwise (its edge was split/merged/retyped away)
   *                                       → the nearest point of the new roads
   *                                         within SNAP_BACK m, driving the same way.
   *     Then it plans a fresh route from there to its stop (also found again
   *     on the new roads), and keeps its speed, id and trip.
   *  3. Only a car that cannot be placed (its road was bulldozed, no route
   *     is left, or no free gap) finishes its trip on the spot as before —
   *     never lost, its delivery still lands.
   * Same-gap rule: a car is only put back where it keeps a full safe
   * spacing to the cars already placed (nudged up to PULL_OUT m otherwise).
   * --------------------------------------------------------------------- */
  private snap: Map<Vehicle, Snap> | null = null;
  private snapFor = -1;
  /** Identity key of edge e: survives an edit only if the edge itself did. */
  private edgeKey(e: number): string { const g = this.g, c = g.eCurve[e]; return `${g.eBorn[e]}|${g.eLen[e].toFixed(3)}|${c[0].toFixed(2)},${c[1].toFixed(2)}`; }
  /** Arc length (a→b along the edge curve) of lane distance s on (e, dir). */
  private arcOf(e: number, dir: 0 | 1, s: number): number { const [s0, s1] = this.span(e); return dir === 0 ? s0 + s : s1 - s; }
  /** Step 1: where every live vehicle is right now (old graph still intact). */
  takeSnapshot(): Map<Vehicle, Snap> {
    const m = new Map<Vehicle, Snap>();
    for (const v of this.vehicles) {
      if (v.done) continue;
      const p = this.position(v);
      // Heading: a point half a metre further along the same segment.
      const q = v.seg.kind === 'lane' ? this.lanePoint(v.seg.edge, v.seg.dir, v.seg.lane, v.s + 0.5) : (() => { const c = this.junctions.get(v.seg.node)!.conns[v.seg.idx]; return at(c.curve, tAtLength(c.lut, v.s + 0.5)); })();
      let hx = q.x - p.x, hz = q.z - p.z;
      if (Math.hypot(hx, hz) < 1e-6) { // at the very end of its segment: use the direction there
        const d = v.seg.kind === 'lane' ? this.laneDir(v.seg.edge, v.seg.dir, true) : (() => { const c = this.junctions.get(v.seg.node)!.conns[v.seg.idx]; return tangent(c.curve, 1); })();
        hx = d.x; hz = d.z;
      }
      const last = v.path.length - 1, eL = v.path[last], dirL = this.dirOf(eL, v.nodes[last]);
      const sEnd = v.endS ?? this.laneLen(eL);
      const d = this.lanePoint(eL, dirL, 0, sEnd);
      m.set(v, {
        x: p.x, z: p.z, hx, hz, dx: d.x, dz: d.z,
        keys: v.path.map((e) => this.edgeKey(e)),
        arc: v.seg.kind === 'lane' ? this.arcOf(v.seg.edge, v.seg.dir, v.s) : 0,
        endArc: this.arcOf(eL, dirL, sEnd), endDir: dirL,
      });
    }
    return m;
  }
  /**
   * OASIS-S2: a seat for vehicle v on a junction CONNECTOR it is standing on
   * after the edit (within 2.5 m of the connector curve, facing along it,
   * with a safe gap to cars already on it and a route on from its exit), or
   * null. Used when the junction box was built over the car's lane spot.
   */
  private boxSeat(v: Vehicle, sn: Snap, eB: number, arcB: number): { path: number[]; nodes: number[]; seg: Seg; s: number; endS: number; lane: number } | null {
    const g = this.g, p = { x: sn.x, z: sn.z }, hl = Math.hypot(sn.hx, sn.hz) || 1;
    let best: { path: number[]; nodes: number[]; seg: Seg; s: number; endS: number; lane: number } | null = null, bestD = 2.5;
    for (const n of g.liveNodes()) {
      if (Math.hypot(g.nx[n] - p.x, g.nz[n] - p.z) > 40) continue; // only junctions close by
      const J = this.junctions.get(n); if (!J) continue;
      J.conns.forEach((c, ci) => {
        const q = nearest(c.curve, p);
        if (q.d >= bestD) return;
        const t = tangent(c.curve, q.t);
        if ((t.x * sn.hx + t.z * sn.hz) / hl < 0.7) return; // must face the same way
        const s = lengthAtT(c.lut, q.t), l = this.list({ kind: 'conn', node: n, idx: ci });
        if (!l.every((o) => Math.abs(o.s - s) >= minSpacing(o, v) - 1e-6)) return;
        const dirOut = this.dirOf(c.outEdge, n), b = this.plan(c.outEdge, this.arcOf(c.outEdge, dirOut, 0), eB, arcB, dirOut);
        if (!b) return;
        bestD = q.d;
        best = { path: [c.inEdge, ...b.path], nodes: [g.other(c.inEdge, n), ...b.nodes], seg: { kind: 'conn', node: n, idx: ci }, s, endS: b.endS, lane: c.inLane };
      });
    }
    return best;
  }
  /**
   * Step 2 + 3: take over the vehicles of `old` (the traffic of the graph
   * before the edit) onto this traffic's (new) graph. Returns how many cars
   * stayed put (kept), were moved onto a nearby new edge (moved), and how
   * many could not be placed and had their trip finished (finished — their
   * onArrive callbacks run last, after every other car is placed, because
   * they often start the next trip on this traffic).
   */
  adopt(old: GraphTraffic): { kept: number; moved: number; finished: number; why: Record<string, number> } {
    const g = this.g;
    if (this.cacheVersion !== g.version) this.build();
    const snap = old.snap && (old.g !== g || old.snapFor === old.cacheVersion) ? old.snap : old.takeSnapshot();
    // New graph: identity key → edge id (only edges that survived the edit match).
    const byKey = new Map<string, number>();
    for (const e of g.liveEdges()) byKey.set(this.edgeKey(e), e);
    this.time = old.time;
    // OASIS-S3: every light that is still a light keeps its controller state.
    for (const [n, st] of old.sig) if (g.nAlive[n] && g.nKind[n] === 'signal') this.sig.set(n, { ...st });
    this.nextId = Math.max(this.nextId, old.nextId);
    const res = { kept: 0, moved: 0, finished: 0, why: {} as Record<string, number> }, finished: Vehicle[] = [];
    /** Why cars could not be put back (diagnostics: Inspect / tests). */
    const why = (k: string) => { res.why[k] = (res.why[k] ?? 0) + 1; };
    // Place cars on surviving roads first (case a, then b), the moved ones last,
    // so a car that has to be nudged never pushes an untouched one away.
    type Job = { v: Vehicle; sn: Snap; rank: number };
    const jobs: Job[] = [];
    for (const v of old.vehicles) {
      if (v.done) continue;
      const sn = snap.get(v);
      if (!sn) { why('no snapshot'); finished.push(v); continue; }
      const here = v.seg.kind === 'lane' ? byKey.get(sn.keys[v.i]) : undefined;
      jobs.push({ v, sn, rank: here !== undefined ? 0 : v.seg.kind === 'conn' ? 1 : 2 });
    }
    // Leaders first within a lane (largest s), so followers fit behind them.
    jobs.sort((a, b) => a.rank - b.rank || b.v.s - a.v.s);
    for (const { v, sn, rank } of jobs) {
      // Where is it going? Its last edge if it survived, else the nearest new road point.
      const lastK = sn.keys[sn.keys.length - 1];
      let eB = byKey.get(lastK) ?? -1, arcB = sn.endArc;
      if (eB < 0) {
        const q = g.nearestEdgePoint({ x: sn.dx, z: sn.dz }, SNAP_BACK * 2);
        if (q) { eB = q.edge; arcB = lengthAtT(g.eLut[q.edge], q.t); }
      }
      let placed: { path: number[]; nodes: number[]; seg: Seg; s: number; endS: number; lane: number } | null = null;
      if (eB >= 0 && rank === 0 && v.seg.kind === 'lane') {
        // a. same edge, same direction, same lane, same spot.
        const e = byKey.get(sn.keys[v.i])!, dir = v.seg.dir;
        const b = this.plan(e, sn.arc, eB, arcB, dir);
        if (b) { const lane = Math.min(v.seg.lane, this.lanes(e) - 1); placed = { path: b.path, nodes: b.nodes, seg: { kind: 'lane', edge: e, dir, lane }, s: this.laneS(e, dir, sn.arc), endS: b.endS, lane }; }
      } else if (eB >= 0 && rank === 1 && v.seg.kind === 'conn') {
        // b. still crossing the same junction on the same turn?
        const oc = old.junctions.get(v.seg.node)!.conns[v.seg.idx];
        const inE = byKey.get(sn.keys[v.i]), outE = byKey.get(sn.keys[v.i + 1]);
        const J = this.junctions.get(v.seg.node);
        if (inE !== undefined && outE !== undefined && J && g.nAlive[v.seg.node]) {
          const ci = J.conns.findIndex((c) => c.inEdge === inE && c.outEdge === outE && c.inLane === oc.inLane && c.outLane === oc.outLane);
          const dirOut = this.dirOf(outE, v.seg.node);
          const b = ci >= 0 ? this.plan(outE, this.arcOf(outE, dirOut, 0), eB, arcB, dirOut) : null;
          if (b) placed = { path: [inE, ...b.path], nodes: [g.other(inE, v.seg.node), ...b.nodes], seg: { kind: 'conn', node: v.seg.node, idx: ci }, s: Math.min(v.s, J.conns[ci].len), endS: b.endS, lane: v.lane };
        }
      }
      if (!placed && eB >= 0) {
        // c. its road changed: the nearest new road point, driving the same way.
        const q = g.nearestEdgePoint({ x: sn.x, z: sn.z }, SNAP_BACK);
        if (q) {
          const t = tangent(g.eCurve[q.edge], q.t), dir: 0 | 1 = t.x * sn.hx + t.z * sn.hz >= 0 ? 0 : 1;
          const arc = lengthAtT(g.eLut[q.edge], q.t);
          const b = g.eType[q.edge] === 'oneway' && dir === 1 ? null : this.plan(q.edge, arc, eB, arcB, dir);
          if (b) { const lane = this.laneFor(b.path, b.nodes, 0); placed = { path: b.path, nodes: b.nodes, seg: { kind: 'lane', edge: q.edge, dir, lane }, s: this.laneS(q.edge, dir, arc), endS: b.endS, lane }; }
        }
      }
      // Find a free spot (safe spacing to cars already put back): the nearest
      // one along the same lane — usually where it was, or a few metres up;
      // a car that stood where the new junction box now is joins the queue
      // at the nearest gap instead of vanishing.
      let s0 = -1;
      if (placed) {
        const l = this.list(placed.seg), L = this.segLen(placed.seg);
        const maxS = placed.seg.kind === 'lane' && placed.path.length === 1 ? Math.max(0, placed.endS - 1) : L;
        const free = (c: number) => l.every((o) => Math.abs(o.s - c) >= minSpacing(o, v) - 1e-6); // (tolerance: a queue stands at exactly the spacing)
        const want = Math.max(0, Math.min(maxS, placed.s));
        for (let d = 0; d <= Math.max(PULL_OUT, maxS) && s0 < 0; d += 1) for (const c of d ? [want - d, want + d] : [want]) if (s0 < 0 && c >= 0 && c <= maxS && free(c)) s0 = c;
      }
      // Its spot is now INSIDE a new junction box (the box and its stop lines
      // took that stretch of lane) and the lane is queued solid: put it on
      // the box's own turn lane it is standing on (connector), going its way.
      if ((!placed || s0 < 0) && eB >= 0) {
        const box = this.boxSeat(v, sn, eB, arcB);
        if (box) { placed = box; s0 = box.s; }
      }
      if (!placed || s0 < 0) { why(eB < 0 ? 'destination gone' : !placed ? 'no road / route from here' : 'no free gap'); finished.push(v); continue; }
      // Re-seat the SAME vehicle object (id, trip, speed and wait carry over).
      v.path = placed.path; v.nodes = placed.nodes; v.i = 0; v.seg = placed.seg; v.s = s0; v.lane = placed.lane;
      v.endS = placed.endS; v.stopped = 0; (v as Vehicle & { go?: number }).go = undefined;
      const l = this.list(v.seg);
      let k = 0; while (k < l.length && l[k].s < s0) k++;
      l.splice(k, 0, v); this.vehicles.push(v);
      if (v.seg.kind === 'conn') this.junctions.get(v.seg.node)!.occupied[v.seg.idx]++;
      if (rank === 2 || Math.abs(s0 - placed.s) > 1e-6) res.moved++; else res.kept++;
    }
    // 3. The rest finish their trips (as before the change) — after placing, see above.
    for (const v of finished) { v.done = true; if (v.trip) { res.finished++; v.trip.onArrive?.(); } }
    old.vehicles = []; old.onSeg.clear(); old.snap = null;
    return res;
  }

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
    const sg = dir === 0 ? 1 : -1;
    let o = this.laneOff(lane, e);
    // OASIS-S5 TAPER: near a node where this (wider) road runs on as a
    // narrower one, the lane centre slides smoothly (same smoothstep as the
    // drawn asphalt, junctions.ts taperBlend) to the narrow road's lane, so
    // cars follow the narrowing road instead of driving off its edge. Only
    // the drawn position bends — arc lengths, gaps and timing are unchanged.
    const tp = this.tapers.get(e);
    if (tp) {
      const blendAt = (t: Taper | null, d: number) => {
        if (!t) return;
        const sp = ROAD_SPEC[t.narrow], on = sp.median / 2 + (Math.min(lane, sp.lanes - 1) + 0.5) * LANE_W;
        o = on + (o - on) * taperBlend(d, t.len);
      };
      blendAt(tp[0], sa); blendAt(tp[1], L - sa);
    }
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
    // OASIS-S5: which edge ends taper (lanePoint bends lanes there).
    this.tapers.clear();
    for (const e of g.liveEdges()) { const t = edgeTapers(g, e); if (t[0] || t[1]) this.tapers.set(e, t); }
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
  /**
   * The route search behind spawnAt (OASIS-S2: shared with adopt, which
   * passes `onlyDir` because a car that is already driving keeps going the
   * way it faces). Best of up to four candidates; null = no route.
   */
  private plan(eA: number, arcA: number, eB: number, arcB: number, onlyDir?: 0 | 1): { path: number[]; nodes: number[]; dir: 0 | 1; cost: number; endS: number } | null {
    const g = this.g;
    if (this.cacheVersion !== g.version) this.build();
    let best: { path: number[]; nodes: number[]; dir: 0 | 1; cost: number; endS: number } | null = null;
    const consider = (c: NonNullable<typeof best>) => { if (!best || c.cost < best.cost) best = c; };
    for (const dir of [0, 1] as const) {
      if (onlyDir !== undefined && dir !== onlyDir) continue;
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
    return best;
  }
  spawnAt(eA: number, arcA: number, eB: number, arcB: number, trip?: Vehicle['trip']): Vehicle | null {
    const best = this.plan(eA, arcA, eB, arcB);
    if (!best) { this.stats.noRoute++; return null; }
    const b = best;
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
  /* ---------------- OASIS-S3: DEMAND-ACTUATED TRAFFIC LIGHTS ----------------
   * Parker: "traffic lights are green for cars waiting if there are no cars
   * in the other roads instead of it being timed".
   *
   * Before: every light ran a fixed clock (12 s green per phase, 2 s all-red,
   * nearby lights offset into a "green wave"), so a lone car could sit at a
   * red light on an empty crossing for up to ~14 s.
   *
   * Now every light has a small controller that LOOKS at the roads, like a
   * real light with sensor loops in the road:
   *   - DEMAND: a phase "has cars" when a car heading through the junction
   *     is within DETECT m of the stop line on one of its approaches.
   *   - A green phase STAYS green while nobody else is waiting ("rest on
   *     green") — however long that is.
   *   - When another phase has cars and this green has run MIN_GREEN s, it
   *     switches as soon as its own approaches are empty, or at MAX_GREEN s
   *     at the latest (so busy cross traffic can never starve anyone).
   *   - Switching: AMBER_S s amber if cars are still coming on the old green
   *     (they may still go, as before), then SIGNAL_CLEAR s all-red so the
   *     box empties, then the next waiting phase (in turn order) gets green.
   *     With nobody left on the old green the amber is skipped, so a lone
   *     car on an empty crossing gets green about 2 s after it arrives.
   *   - GREEN WAVE: the old fixed offsets are gone; a group of cars released
   *     by one light shows up as demand at the next one and holds or calls
   *     its green there instead.
   * Phases are the same as before (opposite approaches together), right on
   * red still works, and the controllers run in node order every tick, so
   * a replay is still identical.
   * ------------------------------------------------------------------------ */
  private sig = new Map<number, SigState>();
  /**
   * Tests / tools: override the demand sensor (true = cars waiting). With
   * `() => true` every light cycles at MAX_GREEN like a fixed-time light.
   */
  signalDemand?: (n: number, phase: number) => boolean;
  /** The controller of signal node n (created green on phase 0). */
  signalState(n: number): Readonly<SigState> { return this.sigOf(n); }
  private sigOf(n: number): SigState {
    let st = this.sig.get(n);
    if (!st) { st = { ph: 0, mode: 'green', t: 0, next: 0 }; this.sig.set(n, st); }
    const k = this.junctions.get(n)?.phases.length ?? 1;
    if (st.ph >= k) { st.ph = 0; st.next = 0; st.mode = 'green'; st.t = 0; } // the junction lost an approach
    return st;
  }
  /** Tests / tools: put signal n straight onto `phase`, green (or another mode), timer 0. */
  forcePhase(n: number, phase: number, mode: SigState['mode'] = 'green'): void { const st = this.sigOf(n); st.ph = phase; st.next = phase; st.mode = mode; st.t = 0; }
  /** Is a car heading THROUGH node n within DETECT m of the stop line on an approach of `phase`? */
  phaseDemand(n: number, phase: number): boolean {
    if (this.signalDemand) return this.signalDemand(n, phase);
    const g = this.g, J = this.junctions.get(n)!;
    for (const e of J.phases[phase]) {
      const dir: 0 | 1 = g.eB[e] === n ? 0 : 1, L = this.laneLen(e);
      for (let lane = 0; lane < this.lanes(e); lane++) {
        const l = this.onSeg.get(laneKey(e, dir, lane));
        if (!l) continue;
        // Leaders are at the end of the list: walk back while within range.
        for (let k = l.length - 1; k >= 0 && L - l[k].s <= DETECT; k--) { const v = l[k]; if (v.i + 1 < v.path.length && v.path[v.i] === e) return true; }
      }
    }
    return false;
  }
  /** Run every signal controller for dt seconds (once per update, node order). */
  private stepSignals(dt: number): void {
    for (const [n, J] of this.junctions) {
      const k = J.phases.length;
      if (k <= 1 || this.g.nKind[n] !== 'signal') continue;
      const st = this.sigOf(n);
      st.t += dt;
      if (st.mode === 'green') {
        if (st.t < MIN_GREEN) continue;
        // The next phase in turn order that has cars waiting, if any.
        let next = -1;
        for (let q = 1; q < k && next < 0; q++) { const p = (st.ph + q) % k; if (this.phaseDemand(n, p)) next = p; }
        if (next < 0) continue; // nobody else waiting: rest on green
        const mine = this.phaseDemand(n, st.ph);
        if (mine && st.t < MAX_GREEN) continue; // keep serving the flow (up to MAX_GREEN)
        st.next = next; st.mode = mine ? 'amber' : 'clear'; st.t = 0;
      } else if (st.mode === 'amber') {
        if (st.t >= AMBER_S) { st.mode = 'clear'; st.t = 0; }
      } else if (st.t >= SIGNAL_CLEAR) { st.mode = 'green'; st.ph = st.next; st.t = 0; }
    }
  }
  /** Signal state: is the approach on edge e green (or amber: cars may still go) at node n? */
  green(n: number, e: number): boolean {
    const J = this.junctions.get(n)!, k = J.phases.length;
    if (k <= 1) return true; // one phase (a through road with no side road): always green
    const st = this.sigOf(n);
    return st.mode !== 'clear' && J.phases[st.ph].includes(e);
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
    this.stepSignals(dt); // OASIS-S3: lights look at the waiting cars first
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
