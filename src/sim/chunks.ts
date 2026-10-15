/**
 * sim/chunks.ts — V1.6 A2: CHUNK INDEX + CHANGE DETECTION.
 *
 * WHY
 * ---
 * Up to V1.5b every system looped over EVERY tile EVERY tick. On the 64-tile
 * map that is 4,096 tiles; on the 192-tile map it is 36,864 — 9× the work for
 * the same town. Most of a big map is empty grass, and empty grass never
 * produces power, pollution, jobs or garbage.
 *
 * THE IDEA
 * --------
 * The map is cut into CHUNK × CHUNK (16 × 16) tile chunks. A chunk is ACTIVE
 * when at least one of its tiles is "not bare" (see `isBare` below: it has a
 * road, line, pipe, zone, structure, farm field, garbage or the highway
 * edge). Systems that only care about non-bare tiles iterate the active
 * chunks (`forEachActive`) instead of the whole map, so their cost follows the
 * size of the CITY, not the size of the MAP.
 *
 * CHANGE DETECTION (feeds V1.6 A3's incremental systems)
 * ------------------------------------------------------
 * `sync(world)` runs once at the start of every tick (and after the player
 * edits the map). It re-reads a small "signature" of every tile in the WATCH
 * SET and compares it with the copy from last time:
 *   topo    — what a tile IS: structure, kind, part, road/roadType, line,
 *             pipe, zone, water, edge. Changes the shape of networks,
 *             coverage anchors and pollution sources.
 *   bldg    — how BIG it is: level, residents, jobs, units, farm, stock>0.
 *             Changes demand on networks, pollution strength, crime.
 *   garbage — the garbage pile (changes nearly every tick in a real city,
 *             so it is tracked on its own and patched per tile, see A3).
 * Each group has a revision counter (`topoRev`, `bldgRev`, `garbageRev`)
 * that goes up when any tile in that group changed. Systems remember the
 * revision they were computed at and skip the work when nothing moved.
 *
 * THE WATCH SET
 * -------------
 * Scanning the whole map would cost as much as the old loops, so `sync`
 * only scans: (1) active chunks and their 8 neighbours (growth, farm fields
 * and garbage spread into neighbouring chunks), (2) chunks the code `touch`ed
 * (Simulation.apply touches every tile a tool changed), and (3) ONE extra
 * chunk per tick, round-robin, so even a write nobody announced (a test or a
 * debug console poking `world.tiles[i]` directly) is found within one lap.
 * On maps with ≤ 16 chunks (the classic 64 map) everything is watched every
 * tick, so the old behaviour is reproduced exactly.
 */
import { GRID_SIZE, Tile } from './types';

/** Chunk side in tiles. 64 / 128 / 192 are all multiples of 16. */
export const CHUNK = 16;

/** True when a tile contributes nothing to any system (plain land or water, trees allowed). */
export const isBare = (t: Tile): boolean =>
  !t.road && !t.powerLine && !t.waterPipe && t.zone === null && t.structure === 'none' && !t.farm && !t.garbage && !t.edge;

/** Stable small integer per structure name (for the packed topo signature). */
const SCODE = new Map<string, number>();
const scode = (s: string) => { let c = SCODE.get(s); if (c === undefined) { c = SCODE.size + 1; SCODE.set(s, c); } return c; };
scode('none'); // 'none' must be code 1: the bare-land fast path in scanChunk relies on it
const ZCODE: Record<string, number> = { residential: 1, commercial: 2, industrial: 3 };

/** Pack the "what is it" fields into one number (exact, no hashing). */
function topoSig(t: Tile): number {
  // bits: structure 0-7, zone 8-9, road 10, line 11, pipe 12, water 13, edge 14, roadType 15-17, kind 18+
  return scode(t.structure) | ((t.zone ? ZCODE[t.zone] : 0) << 8) | (+t.road << 10) | (+t.powerLine << 11) | (+t.waterPipe << 12)
    | (+t.water << 13) | (+t.edge << 14) | ((t.roadType & 7) << 15) | (t.kind * 262144); // kind via multiply: no 32-bit overflow
}

export class ChunkIndex {
  /** Chunks per side. */
  readonly side: number;
  /** Map size this index was built for (a World never changes size). */
  readonly n: number;
  /** Non-bare tile count per chunk (> 0 = active). */
  readonly count: Int32Array;
  /** Indices of active chunks, ascending (rebuilt when the set changes). */
  active: number[] = [];
  /** Revision counters (see file header). Start at 1 so "computed at 0" means never. */
  topoRev = 1;
  bldgRev = 1;
  garbageRev = 1;
  /** Tiles whose garbage changed since the last takeGarbageDirty() (A3 patches land value for just these). */
  garbageDirty: number[] = [];
  /** Tiles whose topo or bldg signature changed in the last sync. */
  changed: number[] = [];
  /** Last seen signature per tile. */
  private topo: Float64Array;
  private part: Float64Array;
  private bldg: Float64Array[]; // level, res, jobs, units, farm, stock>0
  private garb: Float64Array;
  private bare: Uint8Array;
  private touched = new Set<number>();
  private robin = 0;
  private activeDirty = true;
  /** 1 for chunks in `active`. */
  private mask = new Uint8Array(0);

  constructor(tiles: Tile[], n = GRID_SIZE) {
    this.n = n;
    this.side = Math.ceil(n / CHUNK);
    this.count = new Int32Array(this.side * this.side);
    const len = n * n;
    this.topo = new Float64Array(len);
    this.part = new Float64Array(len);
    this.bldg = Array.from({ length: 6 }, () => new Float64Array(len));
    this.garb = new Float64Array(len);
    this.bare = new Uint8Array(len).fill(1);
    // First fill: read every tile once.
    for (let c = 0; c < this.count.length; c++) this.scanChunk(tiles, c, true);
    this.rebuildActive();
  }

  /** Chunk index of tile i. */
  chunkOf(i: number): number {
    const x = i % this.n, z = (i / this.n) | 0;
    return ((z / CHUNK) | 0) * this.side + ((x / CHUNK) | 0);
  }

  /** Hand over (and clear) the garbage-changed tile list. */
  takeGarbageDirty(): number[] { const d = this.garbageDirty; this.garbageDirty = []; return d; }

  /** Announce that tile i was (or may have been) changed. Cheap; read at the next sync. */
  touch(i: number): void { this.touched.add(this.chunkOf(i)); }
  /** Force a full rescan at the next sync (after a load or a bulk edit). */
  touchAll(): void { for (let c = 0; c < this.count.length; c++) this.touched.add(c); }

  /** Is chunk c active? */
  isActive(c: number): boolean { return this.count[c] > 0; }

  /**
   * Call fn(i) for every tile index in every active chunk (row-major inside
   * each chunk, chunks ascending). Order differs from a plain 0..n loop; only
   * use it where order does not matter (sums, per-tile writes).
   */
  forEachActive(fn: (i: number) => void): void {
    const n = this.n;
    for (const c of this.active) {
      const x0 = (c % this.side) * CHUNK, z0 = ((c / this.side) | 0) * CHUNK;
      const x1 = Math.min(n, x0 + CHUNK), z1 = Math.min(n, z0 + CHUNK);
      for (let z = z0; z < z1; z++) for (let i = z * n + x0, e = z * n + x1; i < e; i++) fn(i);
    }
  }

  /**
   * Active tile indices in ASCENDING index order (same order as a 0..n loop,
   * restricted to active chunks). Use where order matters (BFS seeds, lists
   * that must match the old full-map loop exactly). Allocates; cached per sync.
   */
  activeTilesSorted(): Int32Array {
    if (this.sortedCache) return this.sortedCache;
    const n = this.n;
    const out: number[] = [];
    // walk tile rows; inside a row, emit the spans of active chunks left→right
    for (let z = 0; z < n; z++) {
      const cz = (z / CHUNK) | 0;
      for (let cx = 0; cx < this.side; cx++) {
        if (!this.mask[cz * this.side + cx]) continue;
        const x0 = cx * CHUNK, x1 = Math.min(n, x0 + CHUNK);
        for (let x = x0; x < x1; x++) out.push(z * n + x);
      }
    }
    return (this.sortedCache = Int32Array.from(out));
  }
  private sortedCache: Int32Array | null = null;

  /**
   * V1.6 A4: tiles of active chunks AND their 8 neighbours, ascending. Every
   * field that spreads out from buildings (pollution, parks, noise, commerce,
   * road distance — all radii ≤ 6 < CHUNK) is zero beyond this ring, so
   * per-tile passes over such fields can stop here.
   */
  ringTilesSorted(): Int32Array {
    if (this.ringCache) return this.ringCache;
    const s = this.side, ring = new Uint8Array(s * s);
    for (const c of this.active) {
      const cx = c % s, cz = (c / s) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x >= 0 && z >= 0 && x < s && z < s) ring[z * s + x] = 1;
      }
    }
    const n = this.n, out: number[] = [];
    for (let z = 0; z < n; z++) {
      const cz = (z / CHUNK) | 0;
      for (let cx = 0; cx < s; cx++) {
        if (!ring[cz * s + cx]) continue;
        const x0 = cx * CHUNK, x1 = Math.min(n, x0 + CHUNK);
        for (let x = x0; x < x1; x++) out.push(z * n + x);
      }
    }
    return (this.ringCache = Int32Array.from(out));
  }
  private ringCache: Int32Array | null = null;

  /** Re-read the watch set and bump revisions. Call once per tick before the systems run. */
  sync(tiles: Tile[]): void {
    this.changed.length = 0; // garbageDirty is NOT cleared here: its consumer calls takeGarbageDirty()
    const total = this.count.length;
    if (total <= 16) {
      for (let c = 0; c < total; c++) this.scanChunk(tiles, c, false);
    } else {
      const watch = new Uint8Array(total);
      const s = this.side;
      for (const c of this.active) {
        const cx = c % s, cz = (c / s) | 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, z = cz + dz;
          if (x >= 0 && z >= 0 && x < s && z < s) watch[z * s + x] = 1;
        }
      }
      for (const c of this.touched) watch[c] = 1;
      watch[this.robin] = 1;
      this.robin = (this.robin + 1) % total;
      for (let c = 0; c < total; c++) if (watch[c]) this.scanChunk(tiles, c, false);
    }
    this.touched.clear();
    if (this.activeDirty) this.rebuildActive();
  }

  private rebuildActive(): void {
    this.active = [];
    // Small maps (≤ 16 chunks, the classic 64 map) treat EVERY chunk as
    // active: loops then cover the whole map exactly like V1.5b did, even
    // for tiles a test changed without a sync.
    const all = this.count.length <= 16;
    this.mask = new Uint8Array(this.count.length);
    for (let c = 0; c < this.count.length; c++) if (all || this.count[c] > 0) { this.active.push(c); this.mask[c] = 1; }
    this.activeDirty = false;
    this.sortedCache = null;
    this.ringCache = null;
  }

  /** Compare every tile of chunk c with its stored signature. */
  private scanChunk(tiles: Tile[], c: number, first: boolean): void {
    const n = this.n, x0 = (c % this.side) * CHUNK, z0 = ((c / this.side) | 0) * CHUNK;
    const x1 = Math.min(n, x0 + CHUNK), z1 = Math.min(n, z0 + CHUNK);
    const [lv, rs, jb, un, fm, st] = this.bldg;
    let topoHit = false, bldgHit = false, garbHit = false;
    for (let z = z0; z < z1; z++) for (let i = z * n + x0, e = z * n + x1; i < e; i++) {
      const t = tiles[i];
      const b = isBare(t) ? 1 : 0;
      if (b !== this.bare[i]) { this.count[c] += b ? -1 : 1; this.bare[i] = b; this.activeDirty = true; }
      if (b && !t.water && this.topo[i] === 1 && !this.garb[i] && !first) continue; // still plain land: nothing else can differ
      const tp = topoSig(t);
      let hit = false;
      if (tp !== this.topo[i] || t.part !== this.part[i]) { this.topo[i] = tp; this.part[i] = t.part; topoHit = hit = true; }
      const sp = t.stock > 0 ? 1 : 0;
      if (t.level !== lv[i] || t.res !== rs[i] || t.jobs !== jb[i] || t.units !== un[i] || t.farm !== fm[i] || sp !== st[i]) {
        lv[i] = t.level; rs[i] = t.res; jb[i] = t.jobs; un[i] = t.units; fm[i] = t.farm; st[i] = sp; bldgHit = hit = true;
      }
      if (t.garbage !== this.garb[i]) { this.garb[i] = t.garbage; garbHit = true; if (!first) this.garbageDirty.push(i); }
      if (hit && !first) this.changed.push(i);
    }
    if (topoHit) this.topoRev++;
    if (bldgHit) this.bldgRev++;
    if (garbHit) this.garbageRev++;
  }
}
