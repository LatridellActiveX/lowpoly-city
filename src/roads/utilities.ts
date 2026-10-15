/**
 * roads/utilities.ts — V1.6 B5: POWER AND WATER ON THE GRAPH.
 *
 * CONDUITS (as 1.5, now as geometry instead of tiles):
 *   power: every road edge (street poles) + the POWER-LINE utility graph;
 *   water: every road edge (water main)  + the PIPE utility graph.
 *   Explicit lines and pipes are their own RoadGraph (same graph code, no
 *   zoning, no traffic) so they can cross open land freely.
 * SOURCES (plants, turbines, towers, pumps) and CONSUMERS (buildings,
 * services) are footprints: a list of points (the centres of the 32 m
 * squares they cover).
 *
 * CONNECTION RULE: two things are joined when they come within REACH
 * (32 m, one old tile) of each other — a footprint point to a conduit, a
 * line/pipe to a road, a source to a source. On grid towns this is exactly
 * the 1.5 rule "N/E/S/W neighbour of a conduit or source" (conduits run
 * through tile centres, so 4-neighbours are 32 m apart and diagonals 45 m).
 *
 * COMPONENTS: union-find over all conduit edges, isolated conduit nodes and
 * sources (edges in one graph join through their shared nodes). Rebuilt
 * when any graph's version changes; additions between rebuilds are unioned
 * in place (addConduitEdge) — removals need the rebuild (union-find can't
 * split). Each component sums its sources' capacity; a consumer reads its
 * component in O(1) after the lookup (spatial hash of conduit samples).
 */
import { at, tAtLength, V2 } from './bezier';
import { isStraight, RoadGraph } from './graph';

export const REACH = 32;
const EPS = 1e-3;
const BUCKET = 64;
const SAMPLE = 4;

export interface Footprint { pts: V2[]; capacity?: number }

class UF {
  p: number[] = [];
  add(): number { this.p.push(this.p.length); return this.p.length - 1; }
  find(a: number): number { while (this.p[a] !== a) { this.p[a] = this.p[this.p[a]]; a = this.p[a]; } return a; }
  union(a: number, b: number): void { a = this.find(a); b = this.find(b); if (a !== b) this.p[Math.max(a, b)] = Math.min(a, b); }
}

export class UtilityNet {
  private uf = new UF();
  /** spatial hash: bucket → [element id, x, z] samples */
  private hash = new Map<number, number[]>();
  private versions = '';
  /** element ids of sources (index in `sources`). */
  private sourceEl: number[] = [];
  /** capacity per component root (after refresh). */
  capacity = new Map<number, number>();

  constructor(public roads: RoadGraph, public util: RoadGraph, public sources: Footprint[] = []) { this.refresh(true); }

  private bkey(x: number, z: number) { return Math.floor(z / BUCKET) * 100000 + Math.floor(x / BUCKET); }
  private addSample(el: number, x: number, z: number): void {
    // Union with everything already within REACH, then store.
    const bx = Math.floor(x / BUCKET), bz = Math.floor(z / BUCKET);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const l = this.hash.get((bz + dz) * 100000 + bx + dx); if (!l) continue;
      for (let k = 0; k < l.length; k += 3) if (l[k] !== el && Math.hypot(l[k + 1] - x, l[k + 2] - z) <= REACH + EPS) this.uf.union(el, l[k]);
    }
    const key = this.bkey(x, z);
    let l = this.hash.get(key); if (!l) { l = []; this.hash.set(key, l); }
    l.push(el, x, z);
  }
  private samplesOf(g: RoadGraph, e: number): V2[] {
    const c = g.eCurve[e], len = g.eLen[e], out: V2[] = [];
    const n = Math.max(1, Math.ceil(len / SAMPLE));
    for (let k = 0; k <= n; k++) {
      const s = (k / n) * len;
      out.push(isStraight(c) ? { x: c[0] + (c[6] - c[0]) * (k / n), z: c[1] + (c[7] - c[1]) * (k / n) } : at(c, tAtLength(g.eLut[e], s)));
    }
    return out;
  }
  /** Add one conduit edge in place (union-find only grows). */
  addConduitEdge(g: RoadGraph, e: number, nodeEl: Map<string, number>, tag: string): void {
    const el = this.uf.add();
    for (const n of [g.eA[e], g.eB[e]]) { const k = tag + n; const ne = nodeEl.get(k); if (ne === undefined) nodeEl.set(k, el); else this.uf.union(el, ne); }
    for (const p of this.samplesOf(g, e)) this.addSample(el, p.x, p.z);
  }
  /** Rebuild if any graph changed (or `force`). */
  refresh(force = false): void {
    const v = `${this.roads.version}/${this.util.version}/${this.sources.length}`;
    if (!force && v === this.versions) return;
    this.versions = v;
    this.uf = new UF(); this.hash.clear(); this.sourceEl = []; this.capacity.clear();
    const nodeEl = new Map<string, number>();
    for (const [g, tag] of [[this.roads, 'r'], [this.util, 'u']] as const) {
      for (const e of g.liveEdges()) this.addConduitEdge(g, e, nodeEl, tag);
      // isolated nodes (a single line tile) are conduits too
      for (const n of g.liveNodes()) if (!g.nEdges[n].length) { const el = this.uf.add(); this.addSample(el, g.nx[n], g.nz[n]); }
    }
    for (const s of this.sources) { const el = this.uf.add(); this.sourceEl.push(el); for (const p of s.pts) this.addSample(el, p.x, p.z); }
    this.sources.forEach((s, i) => { const r = this.uf.find(this.sourceEl[i]); this.capacity.set(r, (this.capacity.get(r) ?? 0) + (s.capacity ?? 0)); });
  }
  /** Component of a consumer footprint (−1 if it touches nothing that has a source). */
  componentOf(f: Footprint): number {
    this.refresh();
    let best = -1;
    for (const p of f.pts) {
      const bx = Math.floor(p.x / BUCKET), bz = Math.floor(p.z / BUCKET);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const l = this.hash.get((bz + dz) * 100000 + bx + dx); if (!l) continue;
        for (let k = 0; k < l.length; k += 3) if (Math.hypot(l[k + 1] - p.x, l[k + 2] - p.z) <= REACH + EPS) {
          const r = this.uf.find(l[k]);
          if (this.capacity.has(r) && (best < 0 || r < best)) best = r;
        }
      }
    }
    return best;
  }
}
