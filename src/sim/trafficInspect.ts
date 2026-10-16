/**
 * sim/trafficInspect.ts — OASIS: TRAFFIC DIAGNOSTICS for the Inspect tool.
 *
 * WHY
 *   Parker wants to diagnose stuck traffic himself (e.g. after upgrading a
 *   road to an avenue) and report it as "node 42 has no exit for lane 1 of
 *   edge 17". This module turns the live road-graph traffic
 *   (roads/gtraffic.ts GraphTraffic) into plain, display-ready records:
 *
 *     nodeInfo(gt, n)       a junction: type, edges, lane connections,
 *                           MISSING connections, signal phase, queues
 *     edgeInfo(gt, e)       a road edge: ends, type, length, lanes, cars,
 *                           average speed, how many are stuck
 *     vehicleInfo(gt, v)    a car: trip, edge, lane, next node, route left,
 *                           wait time, stuck or not
 *     stuckReport(gt)       every stuck car and the junction it is blocked at
 *     pickGraph(gt, p)      what is under a clicked point (car > node > edge)
 *
 * RULES
 *   - PURE: every function only READS the GraphTraffic / RoadGraph. Nothing
 *     here moves a car, mutates a junction or touches the DOM, so the tests
 *     (tools/trafficinspect.test.ts) can call them on a hand-built graph.
 *   - Times are GRAPH seconds (GraphTraffic.time / Vehicle.wait), the same
 *     clock the give-up rule (GIVE_UP = 90 s) uses.
 *   - "Stuck" = Vehicle.wait > STUCK_SECONDS. Vehicle.wait counts up while
 *     the car's speed is below 0.1 m/s and resets as soon as it moves, so a
 *     car waiting a normal red light (≤ ~SIGNAL_GREEN × approaches) can trip
 *     it at a big signalized junction; a car sitting there for 30 s+ is
 *     almost certainly a real jam.
 */
import { nearest, V2 } from '../roads/bezier';
import { RoadGraph, RoadType, ROAD_SPEC, TILE_M } from '../roads/graph';
import { GraphTraffic, nodeClear, SIGNAL_CLEAR, SIGNAL_GREEN, Vehicle } from '../roads/gtraffic';

/** Seconds stationary before a car counts as STUCK (the "Show stuck cars" highlight). */
export const STUCK_SECONDS = 10;
/** Below this speed (m/s) a car counts as stationary — matches gtraffic's wait counter. */
export const STOPPED_SPEED = 0.1;

/** Junction shape shown in the panel. */
export type NodeShape = 'end' | 'outside connection' | 'bend' | 'T' | '4-way' | 'roundabout' | `${number}-way`;

export interface NodeEdgeRow {
  /** Edge id (copyable "edge 17"). */
  edge: number;
  /** Node at the far end of this edge. */
  other: number;
  type: RoadType;
  /** Lanes arriving AT this node on this edge (0 on a one-way leaving it). */
  lanesIn: number;
  /** Lanes leaving this node on this edge. */
  lanesOut: number;
}
export interface LaneConn { inEdge: number; inLane: number; outEdge: number; outLane: number; turn: 'left' | 'straight' | 'right' }
export interface MissingConn {
  /** 'turn': no connector at all from inEdge to outEdge (that move is impossible).
   *  'lane': incoming lane inLane of inEdge has NO way out of this junction at all. */
  kind: 'turn' | 'lane';
  inEdge: number; inLane: number; outEdge: number;
}
export interface SignalInfo {
  /** Edge whose approach has (or is about to get) green. */
  greenEdge: number;
  /** Phase index / phase count (one phase per approach). */
  phase: number; phases: number;
  /** 'green' while the approach runs, 'all-red' during the clearance. */
  state: 'green' | 'all-red';
  /** Seconds until this state ends. */
  remaining: number;
}
export interface QueueRow { edge: number; queued: number; longestWait: number }
export interface NodeInfo {
  id: number; shape: NodeShape; control: 'plain' | 'signal' | 'stop' | 'roundabout';
  x: number; z: number;
  edges: NodeEdgeRow[];
  conns: LaneConn[];
  missing: MissingConn[];
  signal: SignalInfo | null;
  /** Cars queued per approach (stationary on the last stretch before the stop line). */
  queues: QueueRow[];
  /** Cars inside the junction box right now. */
  inBox: number;
  /** Longest wait (s) among cars queued at / inside this junction. */
  longestWait: number;
  /** Cars stuck (> STUCK_SECONDS) whose blocking junction is this one. */
  stuck: number;
}
export interface EdgeInfo {
  id: number; from: number; to: number; type: RoadType;
  /** 'road' or 'avenue' etc. as the player calls it. */
  label: string;
  length: number;
  /** Lanes a→b and b→a (one-way: b→a = 0). */
  lanesAB: number; lanesBA: number;
  vehicles: number; avgSpeed: number; stuck: number;
}
export interface VehicleInfo {
  id: number; trip: string; kind: 'car' | 'truck';
  /** Edge it is on, or -1 inside a junction box (then `inJunction` is set). */
  edge: number; inJunction: number; lane: number; dir: 0 | 1;
  nextNode: number;
  /** Edges still to drive after the current one, and metres left in total. */
  edgesLeft: number; metresLeft: number;
  speed: number; wait: number; stuck: boolean;
  /** Junction it is held at when stuck (or −1). */
  blockedAt: number;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Player-facing road type name ("road" for the basic street). */
export const roadLabel = (t: RoadType): string => (t === 'street' ? 'road' : t === 'oneway' ? 'one-way' : t);

/** Lanes on edge e travelling INTO node n (one-way roads only arrive at eB). */
function lanesInto(g: RoadGraph, e: number, n: number): number {
  if (g.eType[e] === 'oneway') return g.eB[e] === n ? ROAD_SPEC.oneway.lanes : 0;
  return ROAD_SPEC[g.eType[e]].lanes;
}
/** Lanes on edge e leaving node n. */
function lanesOutOf(g: RoadGraph, e: number, n: number): number {
  if (g.eType[e] === 'oneway') return g.eA[e] === n ? ROAD_SPEC.oneway.lanes : 0;
  return ROAD_SPEC[g.eType[e]].lanes;
}

/**
 * Junction a vehicle is waiting for: inside a box → that node; on a lane →
 * the node at the end of the lane (nodes[i+1]); −1 when the lane is its last
 * (it parks mid-road, nothing ahead to block it).
 */
export function aheadNode(v: Vehicle): number {
  if (v.seg.kind === 'conn') return v.seg.node;
  return v.i + 1 < v.path.length ? v.nodes[v.i + 1] : -1;
}
export const isStuck = (v: Vehicle, secs = STUCK_SECONDS): boolean => !v.done && v.wait > secs;

/**
 * Default "is node n the map's outside connection?" test: a dead end (one
 * edge) within one tile of the map border. main.ts passes a sharper test
 * (the tile under it is a highway connection tile) when it has the world.
 */
export function defaultOutside(g: RoadGraph, n: number, mapM: number): boolean {
  if (g.nEdges[n].length !== 1) return false;
  const x = g.nx[n], z = g.nz[n];
  return x < TILE_M || z < TILE_M || x > mapM - TILE_M || z > mapM - TILE_M;
}

/** Shape name from degree / kind. */
export function nodeShape(g: RoadGraph, n: number, outside = false): NodeShape {
  if (g.nKind[n] === 'roundabout') return 'roundabout';
  const d = g.nEdges[n].length;
  if (d <= 1) return outside ? 'outside connection' : 'end';
  if (d === 2) return 'bend';
  if (d === 3) return 'T';
  if (d === 4) return '4-way';
  return `${d}-way`;
}

/**
 * Signal phase at node n, mirroring GraphTraffic.green exactly: phases cycle
 * over J.phaseEdges, SIGNAL_GREEN s green then SIGNAL_CLEAR s all-red each.
 * Null when the node isn't a signal or has ≤ 1 approach (always green).
 */
export function signalInfo(gt: GraphTraffic, n: number): SignalInfo | null {
  if (gt.g.nKind[n] !== 'signal') return null;
  const J = gt.junctions.get(n); if (!J) return null;
  const k = J.phaseEdges.length; if (k <= 1) return null;
  const cyc = SIGNAL_GREEN + SIGNAL_CLEAR, tt = gt.time % (cyc * k), ph  /* same expression as GraphTraffic.green */ = Math.floor(tt / cyc), into = tt - ph * cyc;
  const green = into < SIGNAL_GREEN;
  return { greenEdge: J.phaseEdges[ph], phase: ph, phases: k, state: green ? 'green' : 'all-red', remaining: green ? SIGNAL_GREEN - into : cyc - into };
}

/* ------------------------------------------------------------------ */
/* node                                                                */
/* ------------------------------------------------------------------ */

/** Metres before the stop line that still count as "in the queue" for an approach. */
export const QUEUE_ZONE = 60;

/**
 * Everything the junction panel shows for node n.
 * `outside(n)` tells whether n is the map's outside connection (see defaultOutside).
 */
export function nodeInfo(gt: GraphTraffic, n: number, outside: (n: number) => boolean = () => false): NodeInfo {
  const g = gt.g, J = gt.junctions.get(n);
  const es = g.nEdges[n];
  const edges: NodeEdgeRow[] = es.map((e) => ({ edge: e, other: g.other(e, n), type: g.eType[e], lanesIn: lanesInto(g, e, n), lanesOut: lanesOutOf(g, e, n) }));
  const conns: LaneConn[] = (J?.conns ?? []).map((c) => ({ inEdge: c.inEdge, inLane: c.inLane, outEdge: c.outEdge, outLane: c.outLane, turn: c.turn }));

  // MISSING CONNECTIONS — the "why can't they get through" check.
  //  1. turn: every approach with lanes in × every OTHER edge with lanes
  //     out should have at least one connector. The builder skips only
  //     U-turns (|angle| > 170°), so a flagged pair is either a hairpin or a
  //     real hole in the junction plan — either way traffic can't make it.
  //  2. lane: an incoming lane with no connector at all is a dead lane: any
  //     car routed into it (laneFor picks the lane for its NEXT turn) waits
  //     at the line for ever until it gives up.
  const missing: MissingConn[] = [];
  if (es.length >= 2) {
    for (const r of edges) {
      if (!r.lanesIn) continue;
      for (const o of edges) {
        if (o.edge === r.edge || !o.lanesOut) continue;
        if (!conns.some((c) => c.inEdge === r.edge && c.outEdge === o.edge)) {
          missing.push({ kind: 'turn', inEdge: r.edge, inLane: -1, outEdge: o.edge });
        }
      }
      for (let lane = 0; lane < r.lanesIn; lane++) {
        if (!conns.some((c) => c.inEdge === r.edge && c.inLane === lane)) missing.push({ kind: 'lane', inEdge: r.edge, inLane: lane, outEdge: -1 });
      }
    }
  }

  // QUEUES — stationary cars on each approach within QUEUE_ZONE m of the
  // line, plus cars sitting inside the box. Cars on their LAST lane (parking
  // mid-road) are not queued for this junction.
  const queues: QueueRow[] = [];
  let inBox = 0, longestWait = 0, stuck = 0;
  const qOf = new Map<number, QueueRow>();
  for (const r of edges) if (r.lanesIn) { const q = { edge: r.edge, queued: 0, longestWait: 0 }; qOf.set(r.edge, q); queues.push(q); }
  for (const v of gt.vehicles) {
    if (v.done || aheadNode(v) !== n) continue;
    if (isStuck(v)) stuck++;
    if (v.seg.kind === 'conn') { inBox++; longestWait = Math.max(longestWait, v.wait); continue; }
    const q = qOf.get(v.seg.edge); if (!q) continue;
    if (v.v >= STOPPED_SPEED || gt.laneLen(v.seg.edge) - v.s > QUEUE_ZONE) continue;
    q.queued++; q.longestWait = Math.max(q.longestWait, v.wait); longestWait = Math.max(longestWait, v.wait);
  }
  const control = g.nKind[n];
  return { id: n, shape: nodeShape(g, n, outside(n)), control, x: g.nx[n], z: g.nz[n], edges, conns, missing, signal: signalInfo(gt, n), queues, inBox, longestWait, stuck };
}

/* ------------------------------------------------------------------ */
/* edge                                                                */
/* ------------------------------------------------------------------ */

/** Everything the road panel shows for edge e. */
export function edgeInfo(gt: GraphTraffic, e: number): EdgeInfo {
  const g = gt.g, t = g.eType[e], L = ROAD_SPEC[t].lanes;
  let vehicles = 0, speed = 0, stuck = 0;
  for (const v of gt.vehicles) {
    if (v.done || v.seg.kind !== 'lane' || v.seg.edge !== e) continue;
    vehicles++; speed += v.v; if (isStuck(v)) stuck++;
  }
  return { id: e, from: g.eA[e], to: g.eB[e], type: t, label: roadLabel(t), length: g.eLen[e], lanesAB: L, lanesBA: t === 'oneway' ? 0 : L, vehicles, avgSpeed: vehicles ? speed / vehicles : 0, stuck };
}

/* ------------------------------------------------------------------ */
/* vehicle                                                             */
/* ------------------------------------------------------------------ */

/** Everything the car panel shows for vehicle v. */
export function vehicleInfo(gt: GraphTraffic, v: Vehicle): VehicleInfo {
  const onLane = v.seg.kind === 'lane';
  // Metres left: rest of the current segment, then every later edge's
  // drivable lane (junction boxes are short; ignored), stopping at endS on
  // the last lane for a mid-road destination.
  let metresLeft = 0;
  if (onLane) {
    const last = v.i + 1 >= v.path.length, end = last && v.endS !== undefined ? v.endS : gt.laneLen(v.path[v.i]);
    metresLeft += Math.max(0, end - v.s);
  } else {
    const c = gt.junctions.get((v.seg as { node: number }).node)?.conns[(v.seg as { idx: number }).idx];
    if (c) metresLeft += Math.max(0, c.len - v.s);
  }
  for (let k = v.i + 1; k < v.path.length; k++) metresLeft += k === v.path.length - 1 && v.endS !== undefined ? v.endS : gt.laneLen(v.path[k]);
  const nextNode = aheadNode(v);
  const st = isStuck(v);
  return {
    id: v.id,
    trip: v.trip?.purpose || (v.trip ? v.trip.kind : 'decorative'),
    kind: v.trip?.kind ?? 'car',
    edge: onLane ? (v.seg as { edge: number }).edge : -1,
    inJunction: onLane ? -1 : (v.seg as { node: number }).node,
    lane: onLane ? (v.seg as { lane: number }).lane : v.lane,
    dir: onLane ? (v.seg as { dir: 0 | 1 }).dir : 0,
    nextNode,
    edgesLeft: Math.max(0, v.path.length - v.i - 1),
    metresLeft,
    speed: v.v, wait: v.wait, stuck: st,
    blockedAt: st ? nextNode : -1,
  };
}

/* ------------------------------------------------------------------ */
/* stuck report                                                        */
/* ------------------------------------------------------------------ */

export interface StuckReport {
  /** Stuck vehicles (ids) and where they are. */
  vehicles: Array<{ id: number; pos: V2; wait: number; node: number }>;
  /** Junctions with ≥ 1 stuck car waiting for them, most stuck first. */
  nodes: Array<{ id: number; pos: V2; count: number }>;
}
/** Every car stationary > secs and the junctions they're blocked at. */
export function stuckReport(gt: GraphTraffic, secs = STUCK_SECONDS): StuckReport {
  const vehicles: StuckReport['vehicles'] = [], per = new Map<number, number>();
  for (const v of gt.vehicles) {
    if (!isStuck(v, secs)) continue;
    const node = aheadNode(v);
    vehicles.push({ id: v.id, pos: gt.position(v), wait: v.wait, node });
    if (node >= 0) per.set(node, (per.get(node) ?? 0) + 1);
  }
  const nodes = [...per].map(([id, count]) => ({ id, count, pos: gt.g.nodePos(id) })).sort((a, b) => b.count - a.count || a.id - b.id);
  return { vehicles, nodes };
}

/* ------------------------------------------------------------------ */
/* picking                                                             */
/* ------------------------------------------------------------------ */

export type GraphPick = { kind: 'vehicle'; id: number } | { kind: 'node'; id: number } | { kind: 'edge'; id: number };
/** Click radius (m) around a car's centre. */
export const PICK_CAR = 3.5;

/**
 * What did the player click at world point p (metres)? Priority: a car
 * (within PICK_CAR m) > a junction (inside its box, ≥ 6 m) > a road edge
 * (within its paved half-width + 1 m). Dead-end nodes count as junctions too
 * so "end" / "outside connection" can be inspected. Null = nothing graph-ish.
 */
export function pickGraph(gt: GraphTraffic, p: V2): GraphPick | null {
  const g = gt.g;
  let bv: Vehicle | null = null, bd = PICK_CAR;
  for (const v of gt.vehicles) { if (v.done) continue; const q = gt.position(v), d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; bv = v; } }
  if (bv) return { kind: 'vehicle', id: bv.id };
  const near = g.edgesNear([p.x, p.z, p.x, p.z], 40);
  let bn = -1, bnd = Infinity;
  for (const e of near) for (const n of [g.eA[e], g.eB[e]]) {
    const d = Math.hypot(g.nx[n] - p.x, g.nz[n] - p.z), r = Math.max(6, nodeClear(g, n));
    if (d <= r && d < bnd) { bnd = d; bn = n; }
  }
  if (bn >= 0) return { kind: 'node', id: bn };
  let be = -1, bed = Infinity;
  for (const e of near) { const r = nearest(g.eCurve[e], p); if (r.d <= ROAD_SPEC[g.eType[e]].width / 2 + 1 && r.d < bed) { bed = r.d; be = e; } }
  return be >= 0 ? { kind: 'edge', id: be } : null;
}
