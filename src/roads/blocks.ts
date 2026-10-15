/**
 * roads/blocks.ts — V1.6 B2: ZONE BLOCKS generated off the road graph.
 *
 * In 1.5 the zone cells were a fixed 8 m grid (4×4 per tile). With freeform
 * roads the cells follow the road instead: every side of every edge gets a
 * ZONE BLOCK, a strip of columns along the road, up to MAX_ROWS deep.
 *
 * GENERATION (per edge side, generateCandidates):
 *   - Walk the edge's arc length in CELL_M (8 m) steps between the
 *     junction clearances at its two ends. Each step is a COLUMN.
 *   - Row r of a column is the quad between the offsets SETBACK + 8r and
 *     SETBACK + 8(r+1) along the local normal, at the column's two ends. On
 *     a straight road that is an exact 8×8 m square; on a curve it is a
 *     trapezoid:
 *       convex side (fans out): the back edge is clamped to 10 m wide;
 *       concave side (shrinks): a back edge under 6 m wide, or one whose
 *       corners have crossed, ends the column there (deeper rows dropped).
 *   - SETBACK = 16 m from the centreline = half an old tile, so a straight
 *     road along tile centres gives cells exactly where the 1.5 cell grid
 *     had them (B8 migrates cell for cell). Wider roads push it out to
 *     width/2 + 4 m.
 *
 * CONFLICTS (resolve, deterministic): all candidate cells are sorted by
 *   1. row (shorter frontage distance wins — the nearer road owns the land),
 *   2. road type rank (avenue beats street at corners),
 *   3. edge age (older edge wins ties, so adding a road doesn't churn the
 *      blocks it touches), then edge id / side / column.
 * Each cell is rasterised into a 2 m MASK (the 2 m sub-squares whose
 * centres fall inside the quad). In sorted order a cell is accepted when
 * none of its sub-squares is taken by an accepted cell or by a road
 * footprint (edge corridor ±width/2 and a node disc); otherwise it and every
 * deeper row of its column are dropped, so columns stay contiguous from the
 * road. Runs of a single surviving column are kept but flagged FILLER (only
 * gardens may grow there).
 *
 * KEEPING ZONING: regenerate() carries each old cell's zone code and owner
 * over to the new cell with the same (edge, side, column, row), or failing
 * that the new cell whose centre is within 2 m (edge splits change ids but
 * not the land). Owners whose cells all vanished are reported in `lost`
 * (the caller demolishes those buildings, as bulldozing does today).
 */
import { at, Cubic, tangent, tAtLength, V2 } from './bezier';
import { CELL_M, isStraight, RoadGraph, RoadType, ROAD_SPEC, TYPE_RANK } from './graph';

/**
 * Rows per column. The plan sketched 4 (one tile), but 1.5 zoning reaches
 * up to 4 TILES deep and templates are up to 8 cells deep, so a block
 * reaches 16 rows (128 m) like the deepest 1.5 zoning drag. Conflicts
 * trim it wherever another road is nearer.
 */
export const MAX_ROWS = 16;
/** Default setback from the centreline to the first row (half a 32 m tile). */
export const SETBACK = 16;
/** Mask resolution (m). */
export const MASK_M = 2;
/** Trapezoid limits on curves (see header). */
export const MIN_BACK = 6, MAX_BACK = 10;
/** Centroid match radius when carrying zoning across a regeneration. */
export const MATCH_R = 2;

export const setbackFor = (type: RoadType) => Math.max(SETBACK, ROAD_SPEC[type].width / 2 + 4);

/** One zone cell. quad = frontage-start, frontage-end, back-end, back-start (x, z pairs). */
export interface ZoneCell {
  edge: number; side: 0 | 1; col: number; row: number;
  quad: Float64Array; cx: number; cz: number;
  code: number; owner: number;
  /** Lone-column run: only fillers (gardens) may use it. */
  filler: boolean;
}

/** A block as described in PLAN-1.6 B.2: one edge side, its columns and their surviving depth. */
export interface ZoneBlock { edge: number; side: 0 | 1; n: number; depth: Uint8Array; cells: ZoneCell[] }

const key = (e: number, side: number, col: number, row: number) => `${e}:${side}:${col}:${row}`;
const maskKey = (sx: number, sz: number) => sz * 65536 + sx;

/** Normal pointing to `side` (0 = left of travel a→b, 1 = right). */
function normal(c: Cubic, t: number, side: number): V2 {
  const d = tangent(c, t);
  return side === 0 ? { x: -d.z, z: d.x } : { x: d.z, z: -d.x };
}

/** Is p inside the convex-ish quad q (even-odd rule)? */
export function inQuad(q: ArrayLike<number>, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = q[2 * i], zi = q[2 * i + 1], xj = q[2 * j], zj = q[2 * j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** 2 m mask squares whose centres fall inside the quad. */
export function maskOf(q: ArrayLike<number>): number[] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < 4; i++) { x0 = Math.min(x0, q[2 * i]); x1 = Math.max(x1, q[2 * i]); z0 = Math.min(z0, q[2 * i + 1]); z1 = Math.max(z1, q[2 * i + 1]); }
  const out: number[] = [];
  for (let sz = Math.floor(z0 / MASK_M); sz <= Math.floor(z1 / MASK_M); sz++)
    for (let sx = Math.floor(x0 / MASK_M); sx <= Math.floor(x1 / MASK_M); sx++)
      if (sx >= 0 && sz >= 0 && inQuad(q, (sx + 0.5) * MASK_M, (sz + 0.5) * MASK_M)) out.push(maskKey(sx, sz));
  return out;
}

/**
 * Junction clearance at node n for side `side` of edge e: the setback of
 * the widest OTHER road that leaves n on that side (so the far side of a
 * T keeps its cells, as on the 1.5 grid). 0 at dead ends and for a road
 * that just continues straight on.
 */
function clearance(g: RoadGraph, e: number, n: number, side: 0 | 1): number {
  if (n < 0 || g.nEdges[n].length <= 1) return 0;
  const d = g.dirAt(e, n); // pointing away from n along e
  // Normal of `side` in e's a→b frame; at the b end the travel direction is reversed.
  const sgn = (g.eA[e] === n ? 1 : -1) * (side === 0 ? 1 : -1);
  const nx = -d.z * sgn, nz = d.x * sgn;
  let w = 0;
  for (const o of g.nEdges[n]) {
    if (o === e) continue;
    const od = g.dirAt(o, n);
    if (od.x * nx + od.z * nz > 0.2) w = Math.max(w, setbackFor(g.eType[o]));
  }
  return w;
}

/** Candidate cells of one edge side, before conflicts (see header). */
export function generateSide(g: RoadGraph, e: number, side: 0 | 1, c: Cubic = g.eCurve[e], lut = g.eLut[e], len = g.eLen[e], type: RoadType = g.eType[e], clearA = e >= 0 ? clearance(g, e, g.eA[e], side) : 0, clearB = e >= 0 ? clearance(g, e, g.eB[e], side) : 0): ZoneCell[] {
  const out: ZoneCell[] = [];
  if (isStraight(c)) len = Math.hypot(c[6] - c[0], c[7] - c[1]);
  const usable = len - clearA - clearB;
  const n = Math.floor(usable / CELL_M + 1e-6);
  if (n <= 0) return out;
  // Centre the columns in the usable stretch (on grid roads the slack is 0).
  const s0 = clearA + (usable - n * CELL_M) / 2;
  const sb = setbackFor(type);
  // Straight edges are walked exactly (no LUT rounding), so grid roads give
  // cells exactly on the 8 m grid.
  const straight = isStraight(c);
  const L = Math.hypot(c[6] - c[0], c[7] - c[1]);
  const off = (s: number, o: number): V2 => {
    if (straight) {
      const ux = (c[6] - c[0]) / L, uz = (c[7] - c[1]) / L, nx = side === 0 ? -uz : uz, nz = side === 0 ? ux : -ux;
      return { x: c[0] + ux * s + nx * o, z: c[1] + uz * s + nz * o };
    }
    const t = tAtLength(lut, s); const p = at(c, t), nn = normal(c, t, side); return { x: p.x + nn.x * o, z: p.z + nn.z * o };
  };
  for (let col = 0; col < n; col++) {
    const sa = s0 + col * CELL_M, sbE = sa + CELL_M;
    let fa = off(sa, sb), fb = off(sbE, sb);
    const fdx = fb.x - fa.x, fdz = fb.z - fa.z;
    for (let row = 0; row < MAX_ROWS; row++) {
      let ba = off(sa, sb + (row + 1) * CELL_M), bb = off(sbE, sb + (row + 1) * CELL_M);
      let bw = Math.hypot(bb.x - ba.x, bb.z - ba.z);
      // Concave side: corners crossed (back edge points backwards) or too narrow.
      if ((bb.x - ba.x) * fdx + (bb.z - ba.z) * fdz <= 0 || bw < MIN_BACK) break;
      if (bw > MAX_BACK) {
        // Convex side: clamp the back edge to MAX_BACK about its middle.
        const mx = (ba.x + bb.x) / 2, mz = (ba.z + bb.z) / 2, k = MAX_BACK / bw / 2;
        ba = { x: mx - (bb.x - ba.x) * k, z: mz - (bb.z - ba.z) * k };
        bb = { x: mx + (bb.x - mx) * 2 * k, z: mz + (bb.z - mz) * 2 * k };
        bw = MAX_BACK;
      }
      const quad = Float64Array.of(fa.x, fa.z, fb.x, fb.z, bb.x, bb.z, ba.x, ba.z);
      out.push({ edge: e, side, col, row, quad, cx: (fa.x + fb.x + bb.x + ba.x) / 4, cz: (fa.z + fb.z + bb.z + ba.z) / 4, code: 0, owner: 0, filler: false });
      fa = ba; fb = bb;
    }
  }
  return out;
}

/** Mask squares covered by road footprints near a box (edge corridors and node discs). */
export function roadMask(g: RoadGraph, edges: Iterable<number>): Set<number> {
  const m = new Set<number>();
  const nodes = new Set<number>();
  for (const e of edges) {
    const hw = ROAD_SPEC[g.eType[e]].width / 2, c = g.eCurve[e], lut = g.eLut[e], len = g.eLen[e];
    // Walk the centreline in 1 m steps and stamp a disc of radius hw.
    const r = Math.ceil(hw / MASK_M) + 1;
    for (let s = 0; s <= len + 1e-6; s += 1) {
      const p = at(c, tAtLength(lut, Math.min(s, len)));
      const cx = Math.floor(p.x / MASK_M), cz = Math.floor(p.z / MASK_M);
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const sx = cx + dx, sz = cz + dz;
        if (sx < 0 || sz < 0) continue;
        if (Math.hypot((sx + 0.5) * MASK_M - p.x, (sz + 0.5) * MASK_M - p.z) < hw) m.add(maskKey(sx, sz));
      }
    }
    nodes.add(g.eA[e]); nodes.add(g.eB[e]);
  }
  for (const n of nodes) {
    let hw = 0; for (const e of g.nEdges[n]) hw = Math.max(hw, ROAD_SPEC[g.eType[e]].width / 2);
    const r = Math.ceil(hw / MASK_M) + 1, cx = Math.floor(g.nx[n] / MASK_M), cz = Math.floor(g.nz[n] / MASK_M);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const sx = cx + dx, sz = cz + dz;
      if (sx >= 0 && sz >= 0 && Math.hypot((sx + 0.5) * MASK_M - g.nx[n], (sz + 0.5) * MASK_M - g.nz[n]) < hw) m.add(maskKey(sx, sz));
    }
  }
  return m;
}

/** Priority order (see header). */
function cmp(g: RoadGraph, a: ZoneCell, b: ZoneCell): number {
  return a.row - b.row || TYPE_RANK[g.eType[b.edge]] - TYPE_RANK[g.eType[a.edge]] || g.eBorn[a.edge] - g.eBorn[b.edge] || a.edge - b.edge || a.side - b.side || a.col - b.col;
}

/**
 * Resolve conflicts among candidates (sorted in place) against an already
 * taken mask. Returns the accepted cells; `taken` gains their squares
 * (value = index into the returned array).
 */
export function resolve(g: RoadGraph, cand: ZoneCell[], taken: Map<number, number>, road: Set<number>): ZoneCell[] {
  cand.sort((a, b) => cmp(g, a, b));
  const cut = new Set<string>(); // "edge:side:col" columns that already lost a row
  const out: ZoneCell[] = [];
  for (const c of cand) {
    const colKey = `${c.edge}:${c.side}:${c.col}`;
    if (cut.has(colKey)) continue;
    const sq = maskOf(c.quad);
    if (!sq.length || sq.some((k) => road.has(k) || taken.has(k))) { cut.add(colKey); continue; }
    for (const k of sq) taken.set(k, out.length);
    out.push(c);
  }
  return out;
}

/** Group accepted cells into blocks and flag lone-column runs as fillers. */
function toBlocks(cells: ZoneCell[]): Map<string, ZoneBlock> {
  const blocks = new Map<string, ZoneBlock>();
  for (const c of cells) {
    const k = `${c.edge}:${c.side}`;
    let b = blocks.get(k);
    if (!b) { b = { edge: c.edge, side: c.side, n: 0, depth: new Uint8Array(0), cells: [] }; blocks.set(k, b); }
    b.cells.push(c);
  }
  for (const b of blocks.values()) {
    b.n = Math.max(...b.cells.map((c) => c.col)) + 1;
    b.depth = new Uint8Array(b.n);
    for (const c of b.cells) b.depth[c.col] = Math.max(b.depth[c.col], c.row + 1);
    b.cells.sort((p, q) => p.col - q.col || p.row - q.row);
    for (let i = 0; i < b.n; i++) {
      if (!b.depth[i]) continue;
      const lone = !(i > 0 && b.depth[i - 1]) && !(i + 1 < b.n && b.depth[i + 1]);
      if (lone) for (const c of b.cells) if (c.col === i) c.filler = true;
    }
  }
  return blocks;
}

/** The zone blocks of a whole road graph, with zoning kept across regenerations. */
export class ZoneBlocks {
  blocks = new Map<string, ZoneBlock>();
  cells: ZoneCell[] = [];
  /** mask square → index in `cells`. */
  private taken = new Map<number, number>();
  private byKey = new Map<string, ZoneCell>();
  /** Owners whose cells all vanished in the last regenerate(). */
  lost: number[] = [];
  /** Graph version the blocks were generated for. */
  version = -1;

  /** Rebuild every block from the graph (deterministic), carrying zoning over. */
  regenerate(g: RoadGraph): void {
    const old = this.cells;
    const cand: ZoneCell[] = [];
    const edges = g.liveEdges();
    for (const e of edges) for (const side of [0, 1] as const) cand.push(...generateSide(g, e, side));
    this.taken = new Map();
    this.cells = resolve(g, cand, this.taken, roadMask(g, edges));
    this.blocks = toBlocks(this.cells);
    this.byKey = new Map(this.cells.map((c) => [key(c.edge, c.side, c.col, c.row), c]));
    // Carry zoning / ownership over: same key, else nearest centre ≤ MATCH_R.
    const owners = new Set<number>();
    const grid = new Map<number, ZoneCell[]>(); // 8 m buckets of new cells
    const gk = (x: number, z: number) => Math.floor(z / 8) * 65536 + Math.floor(x / 8);
    for (const c of this.cells) (grid.get(gk(c.cx, c.cz)) ?? grid.set(gk(c.cx, c.cz), []).get(gk(c.cx, c.cz))!).push(c);
    const kept = new Set<number>();
    for (const o of old) {
      if (!o.code && !o.owner) continue;
      if (o.owner) owners.add(o.owner);
      let n = this.byKey.get(key(o.edge, o.side, o.col, o.row));
      if (!n || Math.hypot(n.cx - o.cx, n.cz - o.cz) > MATCH_R) {
        n = undefined; let bd = MATCH_R;
        const bx = Math.floor(o.cx / 8), bz = Math.floor(o.cz / 8);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const c of grid.get((bz + dz) * 65536 + bx + dx) ?? []) {
          const d = Math.hypot(c.cx - o.cx, c.cz - o.cz);
          if (d <= bd) { bd = d; n = c; }
        }
      }
      if (!n) continue;
      n.code = o.code; n.owner = o.owner;
      if (o.owner) kept.add(o.owner);
    }
    this.lost = [...owners].filter((o) => !kept.has(o)).sort((a, b) => a - b);
    this.version = g.version;
  }

  /** Cell under a world point, if any. */
  cellAt(p: V2): ZoneCell | undefined {
    const i = this.taken.get(maskKey(Math.floor(p.x / MASK_M), Math.floor(p.z / MASK_M)));
    return i === undefined ? undefined : this.cells[i];
  }
  /** Cell by block coordinates. */
  get(edge: number, side: number, col: number, row: number): ZoneCell | undefined { return this.byKey.get(key(edge, side, col, row)); }

  /**
   * Zoning preview for a proposed road (B6 draws it while dragging): the
   * proposal's own candidate cells, each marked
   *   'new'     — free land, would become a zone cell,
   *   'clipped' — overlaps an existing cell that it would win (steal) or lose to.
   * Only cells near the proposal are consulted (no full regeneration).
   */
  preview(g: RoadGraph, c: Cubic, lut: Float32Array, len: number, type: RoadType): Array<{ quad: Float64Array; state: 'new' | 'clipped' }> {
    const out: Array<{ quad: Float64Array; state: 'new' | 'clipped' }> = [];
    for (const side of [0, 1] as const) for (const cell of generateSide(g, -1, side, c, lut, len, type, 0, 0)) {
      const sq = maskOf(cell.quad);
      out.push({ quad: cell.quad, state: sq.some((k) => this.taken.has(k)) ? 'clipped' : 'new' });
    }
    return out;
  }

  /** Invariants for tests: no shared mask square, no road overlap, contiguous columns. */
  check(g: RoadGraph): void {
    const seen = new Map<number, ZoneCell>();
    const road = roadMask(g, g.liveEdges());
    for (const c of this.cells) for (const k of maskOf(c.quad)) {
      if (seen.has(k)) throw new Error(`cells overlap: ${key(c.edge, c.side, c.col, c.row)} and ${key(seen.get(k)!.edge, seen.get(k)!.side, seen.get(k)!.col, seen.get(k)!.row)}`);
      if (road.has(k)) throw new Error(`cell on a road: ${key(c.edge, c.side, c.col, c.row)}`);
      seen.set(k, c);
    }
    for (const b of this.blocks.values()) for (const c of b.cells) if (c.row > 0 && !this.byKey.has(key(c.edge, c.side, c.col, c.row - 1))) throw new Error(`column not contiguous at ${key(c.edge, c.side, c.col, c.row)}`);
  }
}
