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
 *   signal      one approach (incoming edge) green at a time, SIGNAL_GREEN s
 *               each plus SIGNAL_CLEAR all-red. RIGHT-ON-RED (the 1.5b fix):
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
 *   arc-length LUT, so speed is constant on curves. Following uses an
 *   IDM-style rule on the gap to the leader on the same segment (or the
 *   last vehicle on the next segment). No global scans: vehicles live in
 *   per-segment arrays ordered by s.
 */
import { at, buildLut, Cubic, polyline, segX, tAtLength, tangent, V2 } from './bezier';
import { LANE_M, RoadGraph, ROAD_SPEC } from './graph';

/** Lane width = the B6 cross-section's lane (cars must fit visibly). */
export const LANE_W = LANE_M;
export const STRAIGHT_DEG = 30;
export const SIGNAL_GREEN = 12, SIGNAL_CLEAR = 2;
export const ROR_STOP = 1, ROR_GAP = 12;
export const STOP_WAIT = 1;
export const YIELD_GAP = 15;
export const PATH_CACHE = 2048;
export const CAR_LEN = 4.5, MIN_GAP = 2;
/** IDM parameters. */
const ACC = 2.5, DEC = 4, HEADWAY = 1.2;

export interface Connector { node: number; inEdge: number; inLane: number; outEdge: number; outLane: number; turn: 'left' | 'straight' | 'right'; curve: Cubic; lut: Float32Array; len: number }
export interface Junction { conns: Connector[]; conflict: Uint8Array; occupied: Int32Array; phaseEdges: number[] }

/** Segment ids: lanes are (edge, dir, lane); connectors are per node. */
type Seg = { kind: 'lane'; edge: number; dir: 0 | 1; lane: number } | { kind: 'conn'; node: number; idx: number };
const laneKey = (e: number, dir: number, lane: number) => `${e}:${dir}:${lane}`;

export interface Vehicle {
  id: number; path: number[]; /** nodes along the path, path[i] edge goes nodes[i] → nodes[i+1] */ nodes: number[];
  i: number; seg: Seg; s: number; v: number; lane: number;
  wait: number; stopped: number; done: boolean; length: number;
}

/** Clearance (junction box radius) at node n. */
export function nodeClear(g: RoadGraph, n: number): number {
  if (g.nEdges[n].length <= 1) return 0;
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
  stats = { spawned: 0, arrived: 0, rightOnRed: 0, yields: 0, noRoute: 0 };
  /** Lengths/points of lane segments are derived from the edge LUT on demand. */
  constructor(public g: RoadGraph) { this.build(); }

  /* ---------------- geometry ---------------- */
  lanes(e: number): number { return ROAD_SPEC[this.g.eType[e]].lanes; }
  /** Lane centre offset (to the right of travel). */
  laneOff(lane: number, e = -1): number { return (e >= 0 ? ROAD_SPEC[this.g.eType[e]].median / 2 : 0) + (lane + 0.5) * LANE_W; }
  /** Start / end arc length of the drivable part of edge e. */
  span(e: number): [number, number] { return [nodeClear(this.g, this.g.eA[e]), this.g.eLen[e] - nodeClear(this.g, this.g.eB[e])]; }
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
    return { conns, conflict, occupied: new Int32Array(m), phaseEdges };
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
  spawn(a: number, b: number): Vehicle | null {
    const r = this.route(a, b);
    if (!r || !r.edges.length) { this.stats.noRoute++; return null; }
    const e = r.edges[0], dir = this.dirOf(e, a);
    const lane = this.laneFor(r.edges, r.nodes, 0);
    const seg: Seg = { kind: 'lane', edge: e, dir, lane };
    const l = this.list(seg);
    // Lists are ordered by s ascending (rearmost first): a new car enters at the back.
    if (l.length && l[0].s < CAR_LEN + MIN_GAP) return null; // entry blocked
    const v: Vehicle = { id: this.nextId++, path: r.edges, nodes: r.nodes, i: 0, seg, s: 0, v: 0, lane, wait: 0, stopped: 0, done: false, length: CAR_LEN };
    l.unshift(v); this.vehicles.push(v); this.stats.spawned++;
    return v;
  }
  /** Lane to drive on along path edge i, chosen for the next turn. */
  private laneFor(edges: number[], nodes: number[], i: number): number {
    const e = edges[i], n = this.lanes(e);
    if (n === 1 || i + 1 >= edges.length) return 0;
    const c = this.connector(nodes[i + 1], e, edges[i + 1], -1);
    return c ? this.junctions.get(nodes[i + 1])!.conns[c].inLane : 0;
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
    const J = this.junctions.get(n)!, k = J.phaseEdges.length;
    if (k <= 1) return true;
    const cyc = SIGNAL_GREEN + SIGNAL_CLEAR, tt = this.time % (cyc * k), ph = Math.floor(tt / cyc);
    return J.phaseEdges[ph] === e && tt - ph * cyc < SIGNAL_GREEN;
  }
  /** May vehicle v, at the end of its lane, enter connector ci at node n now? */
  private mayEnter(v: Vehicle, n: number, ci: number, dt: number): boolean {
    const g = this.g, J = this.junctions.get(n)!, m = J.conns.length, c = J.conns[ci];
    const conflictFree = () => { for (let j = 0; j < m; j++) if (J.occupied[j] > 0 && j !== ci && J.conflict[ci * m + j]) return false; return true; };
    // DON'T BLOCK THE BOX: only enter when the exit lane has room for this car
    // after every car already in the box heading for the same lane.
    {
      const lane = Math.min(this.laneFor(v.path, v.nodes, v.i + 1), this.lanes(c.outEdge) - 1);
      const ex = this.list({ kind: 'lane', edge: c.outEdge, dir: this.dirOf(c.outEdge, n), lane });
      let inBox = 0; for (let j = 0; j < m; j++) if (J.occupied[j] > 0 && J.conns[j].outEdge === c.outEdge) inBox += J.occupied[j];
      const room = (ex.length ? ex[0].s : this.laneLen(c.outEdge)) - inBox * (CAR_LEN + MIN_GAP);
      if (room < CAR_LEN + MIN_GAP) return false;
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

  /** Advance every vehicle by dt seconds. */
  update(dt: number): void {
    this.time += dt;
    if (this.cacheVersion !== this.g.version) this.build();
    for (const [, l] of this.onSeg) {
      // leader first (largest s)
      for (let k = l.length - 1; k >= 0; k--) this.move(l[k], l, k, dt);
    }
    // apply segment transitions after moving (keeps per-segment order stable)
    for (const v of this.pending) this.transfer(v);
    this.pending.length = 0;
    if (this.vehicles.some((v) => v.done)) this.vehicles = this.vehicles.filter((v) => !v.done);
  }
  private pending: Vehicle[] = [];
  private move(v: Vehicle, l: Vehicle[], k: number, dt: number): void {
    const len = this.segLen(v.seg);
    const vmax = v.seg.kind === 'lane' ? ROAD_SPEC[this.g.eType[v.seg.edge]].speed : 8;
    // Gap to the leader on this segment, or the segment end (a stop line) when we may not go on.
    let gap = Infinity;
    if (k + 1 < l.length) gap = l[k + 1].s - v.s - l[k + 1].length - MIN_GAP;
    else {
      const room = len - v.s;
      // A stop line is a "leader" MIN_GAP beyond the line, so the IDM brings
      // the car to rest right AT the line (where canLeave asks the junction).
      if (!this.canLeave(v, dt, room)) gap = room + MIN_GAP;
    }
    const sStar = MIN_GAP + v.v * HEADWAY;
    const acc = ACC * (1 - (v.v / vmax) ** 4 - (gap === Infinity ? 0 : (sStar / Math.max(0.1, gap)) ** 2));
    v.v = Math.max(0, Math.min(vmax, v.v + Math.max(-DEC * 2, acc) * dt));
    let ds = v.v * dt;
    if (gap !== Infinity) ds = Math.min(ds, Math.max(0, gap - (k + 1 < l.length ? 0 : MIN_GAP)));
    // Creep the last few centimetres to the line (the IDM only approaches it).
    if (k + 1 === l.length && gap !== Infinity && len - v.s - ds < 0.5 && len - v.s - ds > 0) { ds = len - v.s; }
    v.s += ds;
    if (v.v < 0.1) v.wait += dt; else v.wait = 0;
    if (v.s >= len - 1e-6 && k + 1 === l.length) {
      // At the line: the junction decides now (mayEnter), else wait there.
      if (v.seg.kind === 'conn' && !this.canLeave(v, dt, 0)) { v.s = len; v.v = 0; return; }
      if (v.seg.kind === 'lane' && v.i + 1 < v.path.length) {
        const n = v.nodes[v.i + 1], ci = this.connector(n, v.path[v.i], v.path[v.i + 1], v.seg.lane);
        if (ci >= 0 && !this.mayEnter(v, n, ci, dt)) { v.s = len; v.v = 0; return; }
        (v as Vehicle & { go?: number }).go = ci;
      }
      this.pending.push(v);
    }
  }
  /** Is the vehicle at the end of its segment allowed to continue (only checked near the end)? */
  private canLeave(v: Vehicle, dt: number, room: number): boolean {
    if (room > 25) return true;
    if (v.seg.kind === 'conn') {
      // Leave the junction box only when the exit lane has room at its start.
      const c = this.junctions.get(v.seg.node)!.conns[v.seg.idx];
      const ex = this.list({ kind: 'lane', edge: c.outEdge, dir: this.dirOf(c.outEdge, v.seg.node), lane: Math.min(this.laneFor(v.path, v.nodes, v.i + 1), this.lanes(c.outEdge) - 1) });
      return !(ex.length && ex[0].s < CAR_LEN + MIN_GAP);
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
    if (k === 'signal') return this.green(n, J.conns[ci].inEdge);
    if (k === 'stop') return false;
    const m = J.conns.length;
    for (let j = 0; j < m; j++) if (J.occupied[j] > 0 && j !== ci && J.conflict[ci * m + j]) return false;
    return true;
  }
  private transfer(v: Vehicle): void {
    const from = this.list(v.seg);
    const idx = from.indexOf(v); if (idx >= 0) from.splice(idx, 1);
    if (v.seg.kind === 'lane') {
      if (v.i + 1 >= v.path.length) { v.done = true; this.stats.arrived++; return; }
      const n = v.nodes[v.i + 1];
      const ci = (v as Vehicle & { go?: number }).go ?? this.connector(n, v.path[v.i], v.path[v.i + 1], v.seg.lane);
      v.seg = { kind: 'conn', node: n, idx: ci }; v.s = 0; v.stopped = 0;
      this.junctions.get(n)!.occupied[ci]++;
      this.list(v.seg).unshift(v);
    } else {
      const J = this.junctions.get(v.seg.node)!; J.occupied[v.seg.idx]--;
      const c = J.conns[v.seg.idx];
      v.i++;
      const lane = this.laneFor(v.path, v.nodes, v.i);
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
