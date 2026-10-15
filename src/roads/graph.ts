/**
 * roads/graph.ts — V1.6 B1: THE ROAD GRAPH.
 *
 * Freeform roads (Cities: Skylines style) instead of one road per tile.
 *
 *   NODE  — a point where roads meet or end: position in metres, a kind
 *           (plain / signal / roundabout / stop) and the edges touching it.
 *   EDGE  — one road between two nodes, shaped as a cubic Bézier
 *           (bezier.ts), with a type (street / avenue / highway / oneway),
 *           lanes, width, its arc-length LUT and cached length.
 *
 * UNITS: metres. One old tile is TILE_M = 32 m, so the 64-tile map is
 * 2,048 m wide; zone cells are CELL_M = 8 m (¼ tile, the same cells as the
 * 1.5 cell grid, so templates and art carry over).
 *
 * STORAGE: struct-of-arrays (parallel arrays indexed by id) with free lists
 * so ids are reused; `version` goes up on every change (renderers and the
 * zone generator compare it). Edges are also registered in a spatial hash
 * of BUCKET-metre squares by their bounding box, so "what is near here" is a
 * few bucket lookups, never a scan of every road.
 *
 * RULES (placeRoad refuses a road that breaks one, with a reason):
 *   - every edge at least MIN_EDGE (16 m) long;
 *   - roads meeting at a node at least MIN_ANGLE (30°) apart;
 *   - at most MAX_DEGREE (6) roads per node;
 *   - curves no tighter than the type's minimum radius (24 m street, 40 m avenue).
 *
 * CROSSINGS: a new road that crosses an existing one SPLITS both at the
 * crossing (de Casteljau keeps the exact shape) and a node joins them; an
 * end within SNAP_EDGE of a road becomes a T-junction on it.
 *
 * SNAPPING ORDER (snap()): existing node ≤ 8 m, then a point on an edge
 * ≤ 6 m, then an angle snap (15° steps from the start point), then the
 * optional 8 m grid, else the raw point.
 */
import { at, buildLut, Cubic, curvature, dist, intersect, lineCubic, nearest, polyline, split, tangent, V2 } from './bezier';

export const TILE_M = 32;
export const CELL_M = 8;
export const MIN_EDGE = 16;
export const MIN_ANGLE = (30 * Math.PI) / 180;
export const MAX_DEGREE = 6;
export const SNAP_NODE = 8;
export const SNAP_EDGE = 6;
export const BUCKET = 64;

export type RoadType = 'street' | 'avenue' | 'highway' | 'oneway';
export type NodeKind = 'plain' | 'signal' | 'roundabout' | 'stop';
/**
 * V1.6 B6 CROSS-SECTION (Parker: wider lanes so cars visibly fit, more
 * detail). From the centreline out, per side:
 *   median/2 (avenue/highway) | lanes × LANE_M | SHOULDER (gutter-side
 *   strip of asphalt) | GUTTER | KERB | SIDEWALK
 * Cars are drawn ~3.8 m wide, so lanes are LANE_M = 6 m. `width` is the
 * asphalt (kerb to kerb, used for road footprints and junction boxes);
 * roadHalf() is the full half-width to the back of the sidewalk, which is
 * where zone blocks start (blocks.ts setbackFor).
 */
export const LANE_M = 6, SHOULDER_M = 1.5, GUTTER_M = 0.8, KERB_M = 0.5, SIDEWALK_M = 4;
const MEDIAN: Record<string, number> = { street: 0, avenue: 2, highway: 3, oneway: 0 };
const spec = (lanes: number, median: number, minRadius: number, speed: number) => ({ lanes, median, width: 2 * (median / 2 + lanes * LANE_M + SHOULDER_M), minRadius, speed });
/** Lanes per direction, median and asphalt width (m), tightest curve radius (m), speed (m/s). */
export const ROAD_SPEC: Record<RoadType, { lanes: number; median: number; width: number; minRadius: number; speed: number }> = {
  street: spec(1, MEDIAN.street, 24, 13),
  avenue: spec(2, MEDIAN.avenue, 40, 17),
  highway: spec(3, MEDIAN.highway, 60, 25),
  oneway: spec(1, MEDIAN.oneway, 24, 13),
};
/** Full half-width (centreline to the back of the sidewalk). */
export const roadHalf = (t: RoadType) => ROAD_SPEC[t].width / 2 + GUTTER_M + KERB_M + SIDEWALK_M;
export const TYPE_RANK: Record<RoadType, number> = { highway: 3, avenue: 2, oneway: 1, street: 1 };

export interface SnapResult { p: V2; kind: 'node' | 'edge' | 'angle' | 'grid' | 'free'; node?: number; edge?: number; t?: number }
export interface PlaceResult { ok: boolean; reason?: string; edges: number[]; nodes: number[] }
/** angleMagnet: radians — the angle snap only grabs within this of a 15° step (smooth magnet instead of hard steps). */
export interface PlaceOptions { angleMagnet?: number; angleSnap?: boolean; gridSnap?: boolean; noSnap?: boolean; dryRun?: boolean }

export class RoadGraph {
  /* ---- nodes (SoA) ---- */
  nx: number[] = [];
  nz: number[] = [];
  nKind: NodeKind[] = [];
  nEdges: number[][] = [];
  nAlive: boolean[] = [];
  /* ---- edges (SoA) ---- */
  eA: number[] = [];
  eB: number[] = [];
  eCurve: Cubic[] = [];
  eType: RoadType[] = [];
  eLut: Float32Array[] = [];
  eLen: number[] = [];
  eAlive: boolean[] = [];
  /** Bounding box [minX, minZ, maxX, maxZ] per edge (spatial hash keys). */
  eBox: Float64Array[] = [];
  /** Creation order, used for deterministic tie-breaks (older wins). */
  eBorn: number[] = [];
  private born = 0;
  private freeN: number[] = [];
  private freeE: number[] = [];
  private hash = new Map<number, Set<number>>();
  /** Bumped on every change. */
  version = 0;

  /* ================= basic records ================= */
  nodeCount(): number { return this.nAlive.filter(Boolean).length; }
  edgeCount(): number { return this.eAlive.filter(Boolean).length; }
  liveEdges(): number[] { const o: number[] = []; this.eAlive.forEach((a, i) => a && o.push(i)); return o; }
  liveNodes(): number[] { const o: number[] = []; this.nAlive.forEach((a, i) => a && o.push(i)); return o; }
  nodePos(n: number): V2 { return { x: this.nx[n], z: this.nz[n] }; }

  addNode(p: V2, kind: NodeKind = 'plain'): number {
    const id = this.freeN.length ? this.freeN.pop()! : this.nx.length;
    this.nx[id] = p.x; this.nz[id] = p.z; this.nKind[id] = kind; this.nEdges[id] = []; this.nAlive[id] = true;
    this.version++;
    return id;
  }
  private killNode(n: number): void { this.nAlive[n] = false; this.nEdges[n] = []; this.freeN.push(n); this.version++; }

  /** Add an edge WITHOUT any checks (placeRoad does the checking). The curve's ends are pinned to the nodes. */
  addEdge(a: number, b: number, c: Cubic, type: RoadType): number {
    const id = this.freeE.length ? this.freeE.pop()! : this.eA.length;
    const curve = Float64Array.from(c);
    curve[0] = this.nx[a]; curve[1] = this.nz[a]; curve[6] = this.nx[b]; curve[7] = this.nz[b];
    this.eA[id] = a; this.eB[id] = b; this.eCurve[id] = curve; this.eType[id] = type; this.eAlive[id] = true; this.eBorn[id] = this.born++;
    this.eLut[id] = buildLut(curve);
    this.eLen[id] = this.eLut[id][this.eLut[id].length - 1];
    this.nEdges[a].push(id); if (b !== a) this.nEdges[b].push(id);
    this.register(id);
    this.version++;
    return id;
  }
  /** Remove an edge (nodes stay; see removeRoad for cleanup). */
  removeEdge(e: number): void {
    if (!this.eAlive[e]) return;
    this.unregister(e);
    const a = this.eA[e], b = this.eB[e];
    this.nEdges[a] = this.nEdges[a].filter((x) => x !== e);
    this.nEdges[b] = this.nEdges[b].filter((x) => x !== e);
    this.eAlive[e] = false; this.freeE.push(e);
    this.version++;
  }

  /* ================= spatial hash ================= */
  private keys(box: Float64Array, pad = 0): number[] {
    const k: number[] = [];
    const x0 = Math.floor((box[0] - pad) / BUCKET), z0 = Math.floor((box[1] - pad) / BUCKET), x1 = Math.floor((box[2] + pad) / BUCKET), z1 = Math.floor((box[3] + pad) / BUCKET);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) k.push(z * 100003 + x);
    return k;
  }
  private register(e: number): void {
    const p = polyline(this.eCurve[e], 16);
    const box = Float64Array.of(Infinity, Infinity, -Infinity, -Infinity);
    for (let i = 0; i < p.length; i += 2) { box[0] = Math.min(box[0], p[i]); box[1] = Math.min(box[1], p[i + 1]); box[2] = Math.max(box[2], p[i]); box[3] = Math.max(box[3], p[i + 1]); }
    this.eBox[e] = box;
    for (const k of this.keys(box)) { let s = this.hash.get(k); if (!s) this.hash.set(k, (s = new Set())); s.add(e); }
  }
  private unregister(e: number): void { for (const k of this.keys(this.eBox[e])) this.hash.get(k)?.delete(e); }
  /** Edges whose bounding box comes within `pad` metres of box. */
  edgesNear(box: ArrayLike<number>, pad = 0): number[] {
    const out = new Set<number>();
    for (const k of this.keys(Float64Array.from(box), pad)) for (const e of this.hash.get(k) ?? []) out.add(e);
    return [...out].filter((e) => { const b = this.eBox[e]; return b[0] - pad <= box[2] && b[2] + pad >= box[0] && b[1] - pad <= box[3] && b[3] + pad >= box[1]; }).sort((a, b) => a - b);
  }

  /* ================= queries ================= */
  /** Nearest live node within r metres, or -1. */
  nearestNode(p: V2, r = SNAP_NODE): number {
    let best = -1, bd = r;
    for (const e of this.edgesNear([p.x, p.z, p.x, p.z], r)) for (const n of [this.eA[e], this.eB[e]]) { const d = Math.hypot(this.nx[n] - p.x, this.nz[n] - p.z); if (d <= bd) { bd = d; best = n; } }
    // Lone nodes (no edges) are not in the hash; check them directly (rare).
    if (best < 0) this.nAlive.forEach((a, n) => { if (a && !this.nEdges[n].length) { const d = Math.hypot(this.nx[n] - p.x, this.nz[n] - p.z); if (d <= bd) { bd = d; best = n; } } });
    return best;
  }
  /** Nearest point on any edge within r metres. */
  nearestEdgePoint(p: V2, r = SNAP_EDGE): { edge: number; t: number; pt: V2; d: number } | null {
    let best: { edge: number; t: number; pt: V2; d: number } | null = null;
    for (const e of this.edgesNear([p.x, p.z, p.x, p.z], r)) {
      const q = nearest(this.eCurve[e], p);
      if (q.d <= r && (!best || q.d < best.d)) best = { edge: e, ...q };
    }
    return best;
  }
  /** Unit direction of edge e LEAVING node n. */
  dirAt(e: number, n: number): V2 {
    const c = this.eCurve[e];
    if (this.eA[e] === n) return tangent(c, 0);
    const t = tangent(c, 1);
    return { x: -t.x, z: -t.z };
  }
  /** Other end of edge e from node n. */
  other(e: number, n: number): number { return this.eA[e] === n ? this.eB[e] : this.eA[e]; }

  /* ================= snapping ================= */
  /** Snap a cursor point (see header for the order). `from` enables the angle snap. */
  snap(p: V2, opts: PlaceOptions = {}, from?: V2): SnapResult {
    if (opts.noSnap) return { p, kind: 'free' };
    const n = this.nearestNode(p);
    if (n >= 0) return { p: this.nodePos(n), kind: 'node', node: n };
    const ep = this.nearestEdgePoint(p);
    if (ep) return { p: ep.pt, kind: 'edge', edge: ep.edge, t: ep.t };
    if (opts.angleSnap && from) {
      const a = Math.atan2(p.z - from.z, p.x - from.x), step = Math.PI / 12, s = Math.round(a / step) * step, l = dist(p, from);
      if (opts.angleMagnet === undefined || Math.abs(a - s) <= opts.angleMagnet) return { p: { x: from.x + Math.cos(s) * l, z: from.z + Math.sin(s) * l }, kind: 'angle' };
    }
    if (opts.gridSnap) return { p: { x: Math.round(p.x / CELL_M) * CELL_M, z: Math.round(p.z / CELL_M) * CELL_M }, kind: 'grid' };
    return { p, kind: 'free' };
  }

  /* ================= split / merge ================= */
  /** Split edge e at t; returns the new node (exact shape: de Casteljau). */
  splitEdge(e: number, t: number): number { return this.splitEdgeFull(e, t).node; }
  /** Split with the ids of both halves: lo covers t ∈ [0, t], hi covers [t, 1]. */
  splitEdgeFull(e: number, t: number): { node: number; lo: number; hi: number } {
    const [c1, c2] = split(this.eCurve[e], t);
    const a = this.eA[e], b = this.eB[e], type = this.eType[e], born = this.eBorn[e];
    this.removeEdge(e);
    const node = this.addNode({ x: c1[6], z: c1[7] });
    const lo = this.addEdge(a, node, c1, type);
    const hi = this.addEdge(node, b, c2, type);
    // The halves keep the old road's age: zone-block conflicts favour older
    // roads, and a split must not make a road lose land it already had.
    this.eBorn[lo] = this.eBorn[hi] = born;
    return { node, lo, hi };
  }
  /**
   * Remove a road and tidy up: nodes left with no roads disappear; a node
   * left joining exactly two collinear straight roads of the same type is
   * merged away so the road is one edge again.
   */
  removeRoad(e: number): void {
    if (!this.eAlive[e]) return;
    const ends = [this.eA[e], this.eB[e]];
    this.removeEdge(e);
    for (const n of ends) this.tidyNode(n);
  }
  /** Drop an empty node; merge a degree-2 node between collinear same-type straights. */
  tidyNode(n: number): void {
    if (!this.nAlive[n]) return;
    const es = this.nEdges[n];
    if (es.length === 0) { this.killNode(n); return; }
    if (es.length !== 2 || es[0] === es[1]) return;
    const [e1, e2] = es;
    if (this.eType[e1] !== this.eType[e2] || !isStraight(this.eCurve[e1]) || !isStraight(this.eCurve[e2])) return;
    const d1 = this.dirAt(e1, n), d2 = this.dirAt(e2, n);
    if (d1.x * d2.x + d1.z * d2.z > -0.9999) return; // not collinear (opposite directions)
    const a = this.other(e1, n), b = this.other(e2, n), type = this.eType[e1];
    if (a === b) return;
    const born = Math.min(this.eBorn[e1], this.eBorn[e2]);
    this.removeEdge(e1); this.removeEdge(e2);
    this.killNode(n);
    const m = this.addEdge(a, b, lineCubic(this.nodePos(a), this.nodePos(b)), type);
    this.eBorn[m] = born; // merged road keeps the older age (see splitEdgeFull)
  }

  /* ================= validation ================= */
  /** Why edge (a → b along c) would break a rule, or null. a/b are node ids or -1 for new nodes. */
  edgeProblem(c: Cubic, type: RoadType, a: number, b: number, extraAtA: V2[] = [], extraAtB: V2[] = []): string | null {
    const len = buildLut(c);
    if (len[len.length - 1] < MIN_EDGE) return `Too short (min ${MIN_EDGE} m)`;
    const rMin = ROAD_SPEC[type].minRadius;
    for (let k = 0; k <= 16; k++) if (Math.abs(curvature(c, k / 16)) > 1 / rMin + 1e-9) return `Curve too tight (min radius ${rMin} m)`;
    const endCheck = (n: number, dir: V2, extra: V2[]) => {
      const dirs = [...(n >= 0 ? this.nEdges[n].map((e) => this.dirAt(e, n)) : []), ...extra];
      if (n >= 0 && this.nEdges[n].length + 1 > MAX_DEGREE) return `Too many roads at one junction (max ${MAX_DEGREE})`;
      for (const d of dirs) if (Math.acos(Math.max(-1, Math.min(1, d.x * dir.x + d.z * dir.z))) < MIN_ANGLE - 1e-9) return 'Roads meet at too sharp an angle (min 30°)';
      return null;
    };
    const t0 = tangent(c, 0), t1 = tangent(c, 1);
    return endCheck(a, t0, extraAtA) ?? endCheck(b, { x: -t1.x, z: -t1.z }, extraAtB);
  }

  /* ================= placing a road ================= */
  /**
   * Place a road along curve c (its end points are snapped first). Splits
   * crossed roads, creates junction nodes, checks every rule BEFORE changing
   * anything (dryRun: check only). Returns the new edges and nodes.
   */
  placeRoad(c0: Cubic, type: RoadType = 'street', opts: PlaceOptions = {}): PlaceResult {
    const c = Float64Array.from(c0);
    // 1. Snap both ends (moving the neighbouring control point along).
    const s0 = this.snap({ x: c[0], z: c[1] }, opts), s1 = this.snap({ x: c[6], z: c[7] }, opts, s0.p);
    c[2] += s0.p.x - c[0]; c[3] += s0.p.z - c[1]; c[0] = s0.p.x; c[1] = s0.p.z;
    c[4] += s1.p.x - c[6]; c[5] += s1.p.z - c[7]; c[6] = s1.p.x; c[7] = s1.p.z;
    if (s0.kind === 'node' && s1.kind === 'node' && s0.node === s1.node) return fail('Start and end are the same junction');
    if (s0.node !== undefined && s1.node !== undefined && this.nEdges[s0.node].some((e) => this.other(e, s0.node!) === s1.node)) {
      // A second road between the same two junctions is allowed only if it's a different shape (curve).
      if (isStraight(c)) return fail('Those junctions are already joined');
    }
    // 2. Crossings with existing roads (ends that snapped onto an edge are T-junctions, handled below).
    const box = Float64Array.of(Math.min(c[0], c[2], c[4], c[6]), Math.min(c[1], c[3], c[5], c[7]), Math.max(c[0], c[2], c[4], c[6]), Math.max(c[1], c[3], c[5], c[7]));
    const cuts: Array<{ tNew: number; edge: number; tOld: number }> = [];
    for (const e of this.edgesNear(box, 1)) {
      for (const [tn, to] of intersect(c, this.eCurve[e])) {
        const pN = at(c, tn);
        // Skip touches at our own snapped ends and at the old edge's end nodes (those are nodes already).
        if (dist(pN, s0.p) < 1 || dist(pN, s1.p) < 1) continue;
        if (to < 1e-6 || to > 1 - 1e-6) {
          // passes exactly through an existing node: treat as a node cut
          cuts.push({ tNew: tn, edge: -1 - (to < 0.5 ? this.eA[e] : this.eB[e]), tOld: 0 });
          continue;
        }
        cuts.push({ tNew: tn, edge: e, tOld: to });
      }
    }
    cuts.sort((p, q) => p.tNew - q.tNew);
    // Dedupe cuts closer than 1 m along the new road (same crossing seen twice).
    const uniq: typeof cuts = [];
    for (const k of cuts) if (!uniq.length || dist(at(c, k.tNew), at(c, uniq[uniq.length - 1].tNew)) > 1) uniq.push(k);
    // 3. Check everything on a dry run of the pieces.
    const ts = [0, ...uniq.map((k) => k.tNew), 1];
    const pieces: Cubic[] = [];
    let rest: Cubic = c, consumed = 0;
    for (let i = 1; i < ts.length; i++) {
      if (i === ts.length - 1) { pieces.push(rest); break; }
      const local = (ts[i] - consumed) / (1 - consumed);
      const [p1, p2] = split(rest, local);
      pieces.push(p1); rest = p2; consumed = ts[i];
    }
    for (const p of pieces) { const l = buildLut(p); if (l[l.length - 1] < MIN_EDGE + 0.25) return fail(`Too close to another junction (pieces must be ≥ ${MIN_EDGE} m)`); }
    // Crossing angle at every cut through an existing road.
    for (const k of uniq) {
      if (k.edge < 0) continue;
      const dN = tangent(c, k.tNew), dO = tangent(this.eCurve[k.edge], k.tOld);
      const ang = Math.acos(Math.min(1, Math.abs(dN.x * dO.x + dN.z * dO.z)));
      if (ang < MIN_ANGLE - 1e-9) return fail('Crosses a road at too sharp an angle (min 30°)');
    }
    // Every existing road we cut (crossings and T-junction ends together)
    // must leave pieces ≥ MIN_EDGE between ALL its cut points, not just
    // from each cut to its own ends: two cuts on one road can be close.
    const cutTs = new Map<number, number[]>();
    const addCut = (e: number, t: number) => (cutTs.get(e) ?? cutTs.set(e, []).get(e)!).push(t);
    for (const k of uniq) if (k.edge >= 0) addCut(k.edge, k.tOld);
    for (const sn of [s0, s1]) if (sn.kind === 'edge') addCut(sn.edge!, sn.t!);
    for (const [e, ts2] of cutTs) {
      const lo = this.eLut[e], arc = (t: number) => { const f = t * (lo.length - 1), i = Math.min(lo.length - 2, Math.floor(f)); return lo[i] + (lo[i + 1] - lo[i]) * (f - i); };
      const s = [0, ...ts2.map(arc).sort((p, q) => p - q), this.eLen[e]];
      for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] < MIN_EDGE + 0.25) return fail(i === 1 || i === s.length - 1 ? 'Too close to an existing junction' : 'Cuts that road into too short a piece');
    }
    const atEdgeDirs = (s: SnapResult): V2[] => { if (s.kind !== 'edge') return []; const t = tangent(this.eCurve[s.edge!], s.t!); return [t, { x: -t.x, z: -t.z }]; };
    for (let i = 0; i < pieces.length; i++) {
      const a = i === 0 ? (s0.node ?? -1) : uniq[i - 1].edge < 0 ? -1 - uniq[i - 1].edge : -1;
      const b = i === pieces.length - 1 ? (s1.node ?? -1) : uniq[i].edge < 0 ? -1 - uniq[i].edge : -1;
      const why = this.edgeProblem(pieces[i], type, a, b, i === 0 ? atEdgeDirs(s0) : [], i === pieces.length - 1 ? atEdgeDirs(s1) : []);
      if (why) return fail(why);
    }
    if (opts.dryRun) return { ok: true, edges: [], nodes: [] };
    // 4. Commit: split crossed roads (later t first per edge so earlier ts stay valid), make nodes, add pieces.
    const cutNode = new Map<number, number>(); // index in uniq → node id
    const byEdge = new Map<number, number[]>();
    uniq.forEach((k, i) => { if (k.edge >= 0) (byEdge.get(k.edge) ?? byEdge.set(k.edge, []).get(k.edge)!).push(i); else cutNode.set(i, -1 - k.edge); });
    for (const [e, idxs] of byEdge) {
      idxs.sort((p, q) => uniq[q].tOld - uniq[p].tOld); // highest t first
      // Splitting at the highest t first leaves the lower half covering
      // [0, t], so the next (smaller) t just needs rescaling by the old t.
      let edge = e, scale = 1;
      for (const i of idxs) {
        const r = this.splitEdgeFull(edge, uniq[i].tOld / scale);
        cutNode.set(i, r.node);
        edge = r.lo;
        scale = uniq[i].tOld;
      }
    }
    const endNode = (s: SnapResult): number => {
      if (s.kind === 'node') return s.node!;
      if (s.kind !== 'edge') return this.addNode(s.p);
      // The crossings above may already have split that edge: look it up again.
      const n = this.nearestNode(s.p, 0.5);
      if (n >= 0) return n;
      const ep = this.nearestEdgePoint(s.p, 0.5)!;
      return this.splitEdge(ep.edge, ep.t);
    };
    const nA = endNode(s0), nB = endNode(s1);
    const nodes = [nA, ...uniq.map((_, i) => cutNode.get(i)!), nB];
    const edges: number[] = [];
    for (let i = 0; i < pieces.length; i++) edges.push(this.addEdge(nodes[i], nodes[i + 1], pieces[i], type));
    return { ok: true, edges, nodes };

    function fail(reason: string): PlaceResult { return { ok: false, reason, edges: [], nodes: [] }; }
  }

  /** Straight road helper. */
  placeLine(a: V2, b: V2, type: RoadType = 'street', opts: PlaceOptions = {}): PlaceResult { return this.placeRoad(lineCubic(a, b), type, opts); }

  /* ================= invariants (tests) ================= */
  /** Throws if the graph is inconsistent. */
  check(): void {
    this.eAlive.forEach((alive, e) => {
      if (!alive) return;
      const a = this.eA[e], b = this.eB[e], c = this.eCurve[e];
      if (!this.nAlive[a] || !this.nAlive[b]) throw new Error(`edge ${e} has a dead node`);
      if (Math.hypot(c[0] - this.nx[a], c[1] - this.nz[a]) > 1e-6 || Math.hypot(c[6] - this.nx[b], c[7] - this.nz[b]) > 1e-6) throw new Error(`edge ${e} not pinned to its nodes`);
      if (!this.nEdges[a].includes(e) || !this.nEdges[b].includes(e)) throw new Error(`edge ${e} missing from node lists`);
      if (this.eLen[e] < MIN_EDGE - 1e-6) throw new Error(`edge ${e} too short (${this.eLen[e]})`);
    });
    this.nAlive.forEach((alive, n) => {
      if (!alive) return;
      if (this.nEdges[n].length > MAX_DEGREE) throw new Error(`node ${n} degree ${this.nEdges[n].length}`);
      for (const e of this.nEdges[n]) if (!this.eAlive[e]) throw new Error(`node ${n} lists dead edge ${e}`);
    });
    // No two edges cross away from a shared node.
    const live = this.liveEdges();
    for (const e of live) for (const f of this.edgesNear(this.eBox[e], 0)) {
      if (f <= e) continue;
      for (const [ta, tb] of intersect(this.eCurve[e], this.eCurve[f], 24)) {
        const p = at(this.eCurve[e], ta);
        const shared = [this.eA[e], this.eB[e]].filter((n) => n === this.eA[f] || n === this.eB[f]);
        if (shared.some((n) => Math.hypot(this.nx[n] - p.x, this.nz[n] - p.z) < 0.5)) continue;
        void tb;
        throw new Error(`edges ${e} and ${f} cross without a node at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
      }
    }
  }
}

/** Is this cubic a straight line (controls on the chord)? */
export function isStraight(c: Cubic, eps = 1e-6): boolean {
  const dx = c[6] - c[0], dz = c[7] - c[1], l = Math.hypot(dx, dz) || 1;
  const off = (x: number, z: number) => Math.abs((x - c[0]) * dz - (z - c[1]) * dx) / l;
  return off(c[2], c[3]) < eps * Math.max(1, l) && off(c[4], c[5]) < eps * Math.max(1, l);
}
