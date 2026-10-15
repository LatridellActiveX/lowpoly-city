/**
 * sim/lots.ts — PR 6 BUILDINGS AS ENTITIES on the cell grid.
 *
 * Until PR 5 a building WAS a tile (tile.zone + tile.level). Now a building
 * is a `Building` record with a footprint rectangle in cells (cells.ts), a
 * template (footprints.ts) and its own level / construction state.
 *
 * THE HOST TILE (how old systems keep working)
 * --------------------------------------------
 * Power, water, goods trucks, taxes, demand and traffic still work per TILE
 * (they were written that way and are well tested). Every building therefore
 * has a HOST tile: the tile under the middle of its kerb-side front row. Each
 * tick `aggregate()` writes the sum of everything hosted on a tile into that
 * tile's PR 5 fields:
 *     tile.res   residents      (rules.residentsOf reads this)
 *     tile.jobs  jobs           (industry.jobsOf reads this)
 *     tile.units size units     (rules.sizeUnits: power / water / tax scale)
 *     tile.level for shops/factories ≈ units (goods.ts production rate);
 *                for homes the highest building level
 *     tile.construct / tile.zone / tile.kind / tile.structure
 * so networks.ts, goods.ts, economy.ts and demand.ts didn't need rewriting.
 * Rule that keeps this sane: a tile only hosts buildings of ONE zone + kind.
 *
 * FITTING NEW BUILDINGS (growth)
 * ------------------------------
 * `Lots.dirty` is a queue of tiles that MAY have room for a new building
 * (zoned, touches a road, has free cells). Zoning, bulldozing, roads and tier
 * changes push tiles in; nothing ever scans the whole 256 × 256 grid. Each
 * tick a handful of queued tiles are tried: for every road side of the tile
 * and every kerb cell along it we test every template that the cells allow
 * (zone, density, tier), score the ones that fit (template weight × density
 * preference × seeded random), and found the best as a construction site.
 * A 1–2 cell gap that nothing fits becomes a garden or overflow parking.
 *
 * LOCAL → WORLD
 * -------------
 * A building faces road direction r = FACES[face] (unit step toward the
 * kerb). Its template's v axis points AWAY from the road (D = −r) and its u
 * axis runs along the kerb: A = (r.z, −r.x). That is exactly the rotation
 * the renderer applies (rotateY(atan2(r.x, r.z)) sends model +x to A and the
 * model's front +z to r), so the parking on the template's "left" is on the
 * building model's left too — no mirroring.
 *     cell(u, v) = origin + u·A + v·D
 */
import { residentsAt } from './footprints';
import { CELL_GRID, CellRole, CELLS_PER_TILE, cellInBounds, cidx, FACES, tileOfCell, ZONE_CODES, ZoneCode } from './cells';
import { area, bodyRect, isFiller, parkingRequired, parkingSupply, Template, TEMPLATES, TPL } from './footprints';
import { World } from './grid';
import { hash2 } from './random';
import { tierOk } from './progression';
import { GRID_SIZE, Tile, ZoneType } from './types';

export interface Building {
  id: number;
  tpl: string;
  /** Origin cell (template u = 0, v = 0) and road direction index (cells.ts FACES). */
  ox: number;
  oz: number;
  face: number;
  /** Footprint AABB in cells: [x0, x1) × [z0, z1). Derived; kept for speed. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Host tile index (see header). */
  host: number;
  /** 0 = site not finished yet, 1..template.maxLevel. */
  level: number;
  /** Ticks of serviced work left on the current construction stage (0 = none). */
  construct: number;
  /** Ticks of continuous service (growth timer, like PR 5 happyTicks). */
  happy: number;
  /** Ticks of sustained trouble (no demand / no service / no parking) → shrink. */
  unhappy: number;
  /** PR 5 move-in: newest level's residents still driving in. */
  movingIn: boolean;
  /** Farm only: number of field cells currently claimed. */
  fields: number;
  /** Parking (parking.ts): spaces granted from public lots, cars parked now, recent arrivals / give-ups. */
  publicShare: number;
  parked: number;
  arrivals: number;
  gaveUp: number;
  /** V1.5 stage 12: health 0..1 at the last monthly check (redevelop.ts). Saved; optional for old saves. */
  health?: number;
  /** V1.5 stage 12: consecutive months with health < REDEV_HEALTH. */
  lowMonths?: number;
  /** V1.5 stage 12: this site is a redevelopment rebuild (counts toward the concurrent cap). */
  redev?: boolean;
  /** V1.5b: set when demand-driven densification rebuilt this lot denser, e.g. 'low → medium'. Saved (optional). */
  densified?: string;
}

/** A crew must be on site; after the last stage finishes it lingers this many ticks for follow-up work. */
export const CREW_LINGER = 12;
/** Tiles tried for new buildings per tick (dirty queue budget). */
export const FIT_BUDGET = 24;
/** Ticks at max level before a building considers merging into a bigger design. */
export const MERGE_TICKS = 40;
/** Ticks of sustained trouble before a building loses a level (or is abandoned at level 1). */
export const SHRINK_TICKS = 90;

/** Rotate the template frame: unit vectors A (along kerb) and D (away from road). */
export function frame(face: number): { ax: number; az: number; dx: number; dz: number } {
  const [rx, rz] = FACES[face];
  return { ax: rz, az: -rx, dx: -rx, dz: -rz };
}

/** Map a local (u, v) cell of a building to world cell coords. */
export function localToCell(ox: number, oz: number, face: number, u: number, v: number): [number, number] {
  const f = frame(face);
  return [ox + u * f.ax + v * f.dx, oz + u * f.az + v * f.dz];
}

/** World AABB [x0, x1) × [z0, z1) of a local rect. */
export function rectAABB(ox: number, oz: number, face: number, u: number, v: number, w: number, d: number): [number, number, number, number] {
  const [ax, az] = localToCell(ox, oz, face, u, v);
  const [bx, bz] = localToCell(ox, oz, face, u + w - 1, v + d - 1);
  return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx) + 1, Math.max(az, bz) + 1];
}

/** May template `tpl` use a cell zoned `code`? */
/**
 * V1.5 AUTOMATIC MEDIUM DENSITY: while true, low-density residential cells
 * also accept medium-density homes. growth.tryMerge switches it on only for
 * a maxed (level 3) house once medium housing is unlocked, so "after level 3
 * homes grow into medium density" without the player re-zoning; the new
 * building's cells are then repainted Residential · medium.
 */
export const zonePromote = { on: false };

export function codeAllows(tpl: Template, code: number): boolean {
  if (code === ZoneCode.None) return false;
  if (zonePromote.on && code === ZoneCode.ResLow && tpl.zone === 'residential' && tpl.density === 1) return true;
  const info = ZONE_CODES[code];
  if (tpl.id === 'garden') return true; // fillers go anywhere zoned
  if (tpl.id === 'overflow') return info.zone !== 'residential';
  // PR 6: farms and food plants GROW on ordinary industrial zoning (growth.ts
  // weights them by food demand); old Farm / Food plant cells still take them.
  if (tpl.zone === 'industrial' && info.zone === 'industrial' && tpl.kind !== 0) return info.kind === 0 || info.kind === tpl.kind;
  return info.zone === tpl.zone && info.kind === tpl.kind && info.density >= tpl.density;
}

/** Can a building stand on this tile at all (terrain + tile-level stuff)? */
export const tileBuildable = (t: Tile) => !t.road && !t.water && !t.edge && t.structure !== 'powerPlant' && t.structure !== 'windTurbine' && t.structure !== 'waterTower' && t.structure !== 'park' && t.structure !== 'nuclearPlant' && t.structure !== 'pumpStation' && t.structure !== 'constructionYard' && t.structure !== 'service' && !t.powerLine && !t.waterPipe;

/** Zone + kind of a building (for host-tile consistency). */
const hostKey = (tpl: Template) => `${tpl.zone}:${tpl.kind}`;

/** Count of a building's level-L capacity (residents or jobs). */
export const capacityAt = (tpl: Template, level: number) => (level <= 0 ? 0 : tpl.capacity[Math.min(level, tpl.maxLevel) - 1]);

export class Lots {
  buildings = new Map<number, Building>();
  nextId = 1;
  /** Tiles that may fit a new building (see header). A Set keeps it duplicate-free; `queue` is its round-robin order. */
  private dirtySet = new Set<number>();
  private queue: number[] = [];
  /** Hosts written by the last aggregate(), so we can zero tiles that lost their buildings. */
  private hosts = new Set<number>();
  /** Session counters for tests / Inspect. */
  stats = { founded: 0, merged: 0, shrunk: 0, abandoned: 0, fillers: 0 };

  markDirty(tile: number): void {
    if (tile < 0 || tile >= GRID_SIZE * GRID_SIZE || this.dirtySet.has(tile)) return;
    this.dirtySet.add(tile);
    this.queue.push(tile);
  }
  /** Mark a tile and its 8 neighbours (roads change who can face what). */
  markAround(x: number, z: number): void {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < GRID_SIZE && nz < GRID_SIZE) this.markDirty(nz * GRID_SIZE + nx);
    }
  }
  get dirtyCount(): number {
    return this.dirtySet.size;
  }
  /** Take up to n tiles off the front of the queue. */
  takeDirty(n: number): number[] {
    const out: number[] = [];
    while (out.length < n && this.queue.length) {
      const t = this.queue.shift()!;
      this.dirtySet.delete(t);
      out.push(t);
    }
    return out;
  }

  /** Building that owns cell (cx, cz) (body, parking, garden or field), if any. */
  at(world: World, cx: number, cz: number): Building | undefined {
    if (!cellInBounds(cx, cz)) return undefined;
    const o = world.cells.owner[cidx(cx, cz)];
    return o > 0 ? this.buildings.get(o) : undefined;
  }
  /** Buildings hosted on tile i. */
  hostedOn(i: number): Building[] {
    const out: Building[] = [];
    const ids = this.hostIndex().get(i);
    if (ids) for (const id of ids) { const b = this.buildings.get(id); if (b && b.host === i) out.push(b); }
    return out.sort((a, b) => a.id - b.id); // same order as the old full scan (insertion = id order)
  }
  /**
   * V1.6 T2: host tile → building ids. fits() and hostedOn() used to scan
   * every building (O(buildings) per placement test, O(n²) per city).
   * place()/remove() keep it current; anything that edits `buildings`
   * directly (save loading, tests) changes its size, which triggers a
   * rebuild. Entries are re-checked against the building on read.
   */
  private hostIdx: Map<number, Set<number>> | null = null;
  private hostIdxCount = 0;
  private hostIndex(): Map<number, Set<number>> {
    if (!this.hostIdx || this.hostIdxCount !== this.buildings.size) {
      this.hostIdx = new Map();
      for (const b of this.buildings.values()) (this.hostIdx.get(b.host) ?? this.hostIdx.set(b.host, new Set()).get(b.host)!).add(b.id);
      this.hostIdxCount = this.buildings.size;
    }
    return this.hostIdx;
  }
  /** Buildings with any cell on tile (x, z) (fields included). */
  onTile(world: World, x: number, z: number): Building[] {
    const ids = new Set<number>();
    for (let dz = 0; dz < CELLS_PER_TILE; dz++) for (let dx = 0; dx < CELLS_PER_TILE; dx++) {
      const o = world.cells.owner[cidx(x * CELLS_PER_TILE + dx, z * CELLS_PER_TILE + dz)];
      if (o > 0) ids.add(o);
    }
    return [...ids].map((id) => this.buildings.get(id)!).filter(Boolean);
  }

  /**
   * Does `tpl` fit with origin (ox, oz) facing `face`? Returns the host tile
   * index, or −1. `replace` = building ids whose cells may be reused (merging).
   */
  fits(world: World, tpl: Template, ox: number, oz: number, face: number, replace?: Set<number>): number {
    const cells = world.cells;
    const [rx, rz] = FACES[face];
    for (const r of tpl.rects) {
      for (let v = r.v; v < r.v + r.d; v++) for (let u = r.u; u < r.u + r.w; u++) {
        const [cx, cz] = localToCell(ox, oz, face, u, v);
        if (!cellInBounds(cx, cz)) return -1;
        const c = cidx(cx, cz);
        const o = cells.owner[c];
        if (o !== 0 && !(o > 0 && replace?.has(o))) return -1;
        if (!codeAllows(tpl, cells.zone[c])) return -1;
        if (!tileBuildable(world.tiles[tileOfCell(cx, cz)])) return -1;
      }
    }
    // Every kerb-side cell must look onto a (land) road tile.
    for (let u = 0; u < tpl.w; u++) {
      const [cx, cz] = localToCell(ox, oz, face, u, 0);
      const nx = cx + rx, nz = cz + rz;
      if (!cellInBounds(nx, nz)) return -1;
      const rt = world.tiles[tileOfCell(nx, nz)];
      if (!rt.road || rt.water || tileOfCell(nx, nz) === tileOfCell(cx, cz)) return -1;
    }
    const [hx, hz] = localToCell(ox, oz, face, Math.floor((tpl.w - 1) / 2), 0);
    const host = tileOfCell(hx, hz);
    // One zone + kind per host tile (see header).
    for (const b of this.hostedOn(host)) {
      if (replace?.has(b.id)) continue;
      if (hostKey(TPL[b.tpl]) !== hostKey(tpl) && !isFiller(TPL[b.tpl]) && !isFiller(tpl)) return -1;
    }
    return host;
  }

  /** Create a building and stamp its cells. `level`/`construct` set by the caller's rules. */
  place(world: World, tpl: Template, ox: number, oz: number, face: number, host: number, level: number, construct: number): Building {
    const [x0, z0, x1, z1] = rectAABB(ox, oz, face, 0, 0, tpl.w, tpl.d);
    const b: Building = { id: this.nextId++, tpl: tpl.id, ox, oz, face, x0, z0, x1, z1, host, level, construct, happy: 0, unhappy: 0, movingIn: false, fields: 0, publicShare: 0, parked: 0, arrivals: 0, gaveUp: 0 };
    const idx = this.hostIndex();
    this.buildings.set(b.id, b);
    (idx.get(host) ?? idx.set(host, new Set()).get(host)!).add(b.id); this.hostIdxCount = this.buildings.size;
    this.stamp(world, b);
    return b;
  }

  /** Write a building's id + roles into the cell layer. */
  stamp(world: World, b: Building): void {
    const tpl = TPL[b.tpl];
    for (const r of tpl.rects)
      for (let v = r.v; v < r.v + r.d; v++) for (let u = r.u; u < r.u + r.w; u++) {
        const [cx, cz] = localToCell(b.ox, b.oz, b.face, u, v);
        const c = cidx(cx, cz);
        world.cells.owner[c] = b.id;
        world.cells.role[c] = r.role;
        // Building over a tree/rock: clear it (the tile's decoration).
        world.tiles[tileOfCell(cx, cz)].deco = 0;
      }
  }

  /** Remove a building: free every cell it owns (fields too) and requeue the tiles. */
  remove(world: World, b: Building): void {
    const { owner, role } = world.cells;
    // Scan its AABB plus a margin for fields (fields sit behind the barn).
    const m = TPL[b.tpl].kind === 1 && TPL[b.tpl].zone === 'industrial' ? 20 : 0;
    for (let cz = Math.max(0, b.z0 - m); cz < Math.min(CELL_GRID, b.z1 + m); cz++)
      for (let cx = Math.max(0, b.x0 - m); cx < Math.min(CELL_GRID, b.x1 + m); cx++) {
        const c = cidx(cx, cz);
        if (owner[c] !== b.id) continue;
        owner[c] = 0;
        role[c] = CellRole.None;
        this.markDirty(tileOfCell(cx, cz));
      }
    const idx = this.hostIndex();
    this.buildings.delete(b.id);
    idx.get(b.host)?.delete(b.id); this.hostIdxCount = this.buildings.size;
    this.markDirty(b.host);
  }

  /**
   * All placements of templates (from `pool`) on tile i: every road side ×
   * every kerb cell of that side as origin. Returned unsorted.
   */
  options(world: World, i: number, pool: Template[], replace?: Set<number>): Array<{ tpl: Template; ox: number; oz: number; face: number; host: number }> {
    const x = i % GRID_SIZE, z = Math.floor(i / GRID_SIZE);
    const out: Array<{ tpl: Template; ox: number; oz: number; face: number; host: number }> = [];
    for (let face = 0; face < 4; face++) {
      const [rx, rz] = FACES[face];
      const nx = x + rx, nz = z + rz;
      if (nx < 0 || nz < 0 || nx >= GRID_SIZE || nz >= GRID_SIZE) continue;
      const rt = world.tiles[nz * GRID_SIZE + nx];
      if (!rt.road || rt.water) continue;
      for (let k = 0; k < CELLS_PER_TILE; k++) {
        // Kerb cell k of this side: the tile's edge row/column facing the road.
        const cx = rx === 1 ? x * 4 + 3 : rx === -1 ? x * 4 : x * 4 + k;
        const cz = rz === 1 ? z * 4 + 3 : rz === -1 ? z * 4 : z * 4 + k;
        for (const tpl of pool) {
          const host = this.fits(world, tpl, cx, cz, face, replace);
          if (host >= 0) out.push({ tpl, ox: cx, oz: cz, face, host });
        }
      }
    }
    return out;
  }

  /**
   * Write the host-tile aggregates (see header). Run once per tick after
   * growth; O(buildings), not O(cells).
   */
  aggregate(world: World): void {
    const tiles = world.tiles;
    for (const h of this.hosts) {
      const t = tiles[h];
      t.res = t.jobs = t.units = 0;
      t.level = 0;
      t.construct = 0;
      if (t.structure === 'building') t.structure = 'none';
    }
    const next = new Set<number>();
    const mixedUnits = new Map<number, number>();
    for (const b of this.buildings.values()) {
      const tpl = TPL[b.tpl];
      if (isFiller(tpl)) continue;
      const t = tiles[b.host];
      if (!next.has(b.host)) {
        next.add(b.host);
        t.res = t.jobs = t.units = 0;
        t.level = 0;
        t.construct = 0;
      }
      t.zone = tpl.zone;
      t.kind = tpl.kind;
      t.construct = Math.max(t.construct, b.construct);
      if (b.level > 0) {
        t.structure = 'building';
        const lvNow = b.movingIn ? b.level - 1 : b.level;
        if (tpl.zone === 'residential') {
          t.res += capacityAt(tpl, lvNow);
          t.units += capacityAt(tpl, b.level) / 5; // power/water reserved for the full building
          t.level = Math.max(t.level, b.level);
        } else {
          // V1.5 mixed use: flats above the shop. Residents live on the
          // (commercial) host tile; their power/water units are added after
          // the shop level is derived from units below.
          if (tpl.residents) {
            t.res += residentsAt(tpl, lvNow);
            mixedUnits.set(b.host, (mixedUnits.get(b.host) ?? 0) + residentsAt(tpl, b.level) / 5);
          }
          const jobs = capacityAt(tpl, b.level);
          t.jobs += jobs;
          t.units += jobs / (tpl.zone === 'commercial' ? 4 : tpl.kind === 1 ? 3 : 8);
        }
      }
    }
    for (const h of next) {
      const t = tiles[h];
      if (t.zone !== 'residential' && t.units > 0) t.level = Math.max(1, Math.round(t.units));
      t.units += mixedUnits.get(h) ?? 0;
      if (t.construct === 0 && t.crewLinger > 0) t.crewLinger--;
      if (t.construct === 0 && t.crewLinger === 0) t.crew = false;
    }
    // Tiles that lost all their buildings fall back to their painted zone.
    for (const h of this.hosts) if (!next.has(h)) { refreshTileZone(world, h); tiles[h].crew = false; }
    this.hosts = next;
  }
}

/** tile.zone/kind for a tile with no hosted building: the most common zone among its cells. */
export function refreshTileZone(world: World, i: number): void {
  const t = world.tiles[i];
  const x = i % GRID_SIZE, z = Math.floor(i / GRID_SIZE);
  const count = new Array(ZONE_CODES.length).fill(0); // V1.5: was 10 (before Mixed use)
  for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) count[world.cells.zone[cidx(x * 4 + dx, z * 4 + dz)]]++;
  let best = 0;
  for (let c = 1; c < ZONE_CODES.length; c++) if (count[c] > 0 && (best === 0 || count[c] > count[best])) best = c;
  if (best === 0) { if (t.structure === 'none' || t.structure === 'building') t.zone = null; t.kind = 0; return; }
  t.zone = ZONE_CODES[best].zone;
  t.kind = ZONE_CODES[best].kind;
}

/** Templates that may be FOUNDED (grown fresh) at this tier. */
export function growablePool(zone: ZoneType, world: World): Template[] {
  return TEMPLATES.filter((t) => !t.legacy && !isFiller(t) && t.zone === zone && tierOk(world, t.tier, t.zone));
}

/** Seeded pick among options: weight × density preference × area × random. */
export function scoreOption(o: { tpl: Template; ox: number; oz: number; face?: number }, tick: number, seed: number, world?: World): number {
  // Salt by the template's index so two designs at the same spot roll differently.
  const r = hash2(o.ox * 7 + o.oz * 13, tick, seed + TEMPLATES.indexOf(o.tpl) * 7919 + 977);
  let score = o.tpl.weight * (1 + o.tpl.density * 1.5) * Math.sqrt(area(o.tpl) / 9) * (0.4 + r);
  // VARIETY: avoid identical neighbours — a design already standing right
  // beside this spot (either side along the kerb) scores a quarter.
  if (world && o.face !== undefined) {
    const f = frame(o.face);
    for (const [u] of [[-1], [o.tpl.w]]) {
      const cx = o.ox + u * f.ax, cz = o.oz + u * f.az;
      if (!cellInBounds(cx, cz)) continue;
      const id = world.cells.owner[cidx(cx, cz)];
      if (id > 0 && world.lots.buildings.get(id)?.tpl === o.tpl.id) score *= 0.25;
    }
  }
  return score;
}

export { bodyRect, parkingRequired, parkingSupply };
