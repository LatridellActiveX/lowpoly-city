/**
 * sim/industry.ts — PR 5 farms, food processing plants and construction crews.
 *
 * Plain TypeScript, no Three.js / DOM (the sim/render split). The renderer
 * only READS the tile fields set here (kind, farm, input, crew).
 *
 * FARMS
 * -----
 * An industrial lot is a FARM when it was painted with the Farm tool
 * (tile.kind = 1) or when it sits on a FARMLAND resource patch — available
 * from the very start of the game (no tier gate). A grown farm has a barn +
 * silo at the road-facing front and claims crop FIELDS behind it, away from
 * the road:
 *
 *        road  ═══════════
 *              [FARM][    ]     depth 0  (farm tile)
 *              [ F1 ][ F2 ]     depth 1  ← fields, 2 wide (farm column +
 *              [ F3 ][ F4 ]     depth 2     the column to its "right")
 *              [ F5 ][ F6 ]     depth 3
 *
 * Level 1 claims 2 fields, level 2 claims 4, level 3 claims 6. A field may
 * only be claimed on buildable land: not water/road/structure, and either
 * unzoned or an EMPTY industrial lot (pipes and power lines are fine). The
 * owner is stored as tile.farm = farmIndex + 1. Every tick (updateFarms):
 *   1. fields whose owner is no longer a farm (bulldozed, re-zoned) are freed;
 *   2. each farm claims candidates in order until it has its quota.
 * Bulldozing a field turns it FALLOW (tile.farm = −(owner + 1)): its farm
 * won't take it back, so the farm shrinks. Bulldozing the farm frees all.
 * More fields = more food: output = PRODUCE_RATE × 0.5 × (1 + fields).
 * Farms have few jobs (3 per level) and pollute only a quarter as much.
 *
 * FOOD PROCESSING PLANTS (tile.kind = 2, an industrial lot)
 * ---------------------------------------------------------
 * Farms truck their food to the nearest plant with room in its `input`
 * hopper first (goods.ts). A plant turns input into PACKAGED FOOD, which
 * grocers (shops selling food) stock and which exports for more money.
 *
 * CONSTRUCTION CREWS
 * ------------------
 * A Construction Yard (structure 'constructionYard') is built instantly and
 * owns a fleet of YARD_FLEET (4) trucks. Every construction site (a zoned lot
 * with construct > 0) waits until a crew truck reaches it by road (A* in
 * traffic.findPath) — only then does work progress (simulation.ts). The
 * dispatcher (Crews.tick) serves waiting sites nearest-first, from the
 * nearest yard with a free truck; the truck drives back afterwards and only
 * then is the slot free again. More yards = more trucks = faster growth.
 * Sites with no reachable yard keep `crew = false` and show a "Waiting for
 * construction crew" warning. Utilities (plants, towers, turbines) are still
 * built instantly — they're paid one-off purchases, not growth.
 */
import { GRID_SIZE, Tile } from './types';
import { World } from './grid';
import { Resource } from './resources';
import { roadNextTo, Traffic } from './traffic';
import { CellRole, cellInBounds, cidx, tileOfCell, ZoneCode } from './cells';
import { TPL } from './footprints';
import { CREW_LINGER, localToCell, tileBuildable } from './lots';

export const KIND_FACTORY = 0;
export const KIND_FARM = 1;
export const KIND_FOOD_PLANT = 2;

/** Fields a farm wants at each level (index = level). */
/** Trucks per Construction Yard. */
/** PR 6: 4 → 8, and one visit now covers every building on the site (CREW_LINGER). */
export const YARD_FLEET = 8;
/** Colour of construction trucks (renderer adds a load of materials on top). */
export const CREW_TRUCK_COLOR = 0xf28c1d;
/** Prefix of a construction truck's `purpose` (the renderer keys off it). */
export const CREW_PURPOSE = 'construction';


/**
 * Is tile i a farm lot? PR 6: the tile's kind comes from its hosted building
 * or its painted cells (lots.ts aggregate / refreshTileZone). Industry zoned
 * on a FARMLAND patch is painted as Farm cells automatically (zoneCells).
 */
export function isFarmLot(world: World, i: number): boolean {
  const t = world.tiles[i];
  return t.zone === 'industrial' && (t.kind === KIND_FARM || (t.kind === KIND_FACTORY && t.level === 0 && world.resourceAt(i) === Resource.Farmland));
}
/** A food processing plant lot? */
export const isFoodPlant = (t: Tile) => t.zone === 'industrial' && t.kind === KIND_FOOD_PLANT;

/**
 * PR 6 FARM FIELDS ON CELLS. A farm's fields are cells (role Field, owner =
 * the farm building) claimed BEHIND the barn — the region from the barn's
 * back row outwards, one cell wider than the barn on each side:
 *
 *        road ═══════════════
 *             [yard ][yard ]       v = 0     (barn template, 3 × 3)
 *             [ barn  barn ]       v = 1..2
 *          F  F  F  F  F           v = 3, 4, …  ← claimed row by row,
 *          F  F  F  F  F                         nearest first
 *
 * Quota per level FIELD_CELLS (2 / 4 / 6 tiles' worth, like PR 5's 2/4/6
 * field tiles). Claimable: free cell, buildable tile, zoned Farm or not
 * zoned at all. Bulldozing a field cell leaves it FALLOW (role Fallow, still
 * owned) so the farm doesn't take it straight back; bulldozing the barn
 * frees everything (lots.remove).
 */
export const FIELD_CELLS = [0, 32, 64, 96];
/** The same quota in PR 5 "field tiles" (FIELD_CELLS ÷ 16), for the HUD. */
export const FARM_FIELDS = [0, 2, 4, 6];
/** Field cells per PR 5 "field tile" for the production formula. */
const CELLS_PER_FIELD = 16;

export function updateFarms(world: World): void {
  const lots = world.lots;
  const { owner, role, zone } = world.cells;
  for (const b of lots.buildings.values()) {
    const tpl = TPL[b.tpl];
    if (tpl.zone !== 'industrial' || tpl.kind !== KIND_FARM || b.level <= 0) continue;
    const want = FIELD_CELLS[Math.min(3, b.level)];
    if (b.fields >= want || (world.tick + b.id) % 4 !== 0) continue; // stagger: claim every 4th tick
    // Walk the region behind the barn row by row (local u from −1 to w, v from d onward).
    outer: for (let v = tpl.d; v < tpl.d + 14; v++) {
      for (let u = -1; u <= tpl.w; u++) {
        if (b.fields >= want) break outer;
        const [cx, cz] = localToCell(b.ox, b.oz, b.face, u, v);
        if (!cellInBounds(cx, cz)) continue;
        const c = cidx(cx, cz);
        if (owner[c] !== 0) continue;
        const code = zone[c];
        if (code !== ZoneCode.None && code !== ZoneCode.Farm && code !== ZoneCode.IndLight && code !== ZoneCode.IndHeavy) continue; // PR 6: fields spread over industrial zoning too
        const tt = world.tiles[tileOfCell(cx, cz)];
        if (!tileBuildable(tt) || (tt.zone !== null && tt.zone !== 'industrial')) continue;
        owner[c] = b.id;
        role[c] = CellRole.Field;
        zone[c] = ZoneCode.Farm;
        tt.deco = 0;
        b.fields++;
      }
    }
  }
}

/** Field "tiles" (16 cells each) of the farm(s) hosted on tile i — feeds goods.ts farmRate. */
export function fieldCount(world: World, i: number): number {
  let cells = 0;
  for (const b of world.lots.buildings.values()) if (b.host === i) cells += b.fields;
  return cells / CELLS_PER_FIELD;
}

/** Jobs on tile i (PR 6: the host-tile aggregate of its buildings, lots.ts). */
export function jobsOf(world: World, i: number): number {
  const t = world.tiles[i];
  if (!t.zone || t.zone === 'residential') return 0;
  return t.jobs;
}

/** Food per tick for a farm with `fields` fields (more fields = more output). */
export const farmRate = (produceRate: number, fields: number) => produceRate * 0.5 * (1 + fields);

// ---------------------------------------------------------------------------
// Construction crews
// ---------------------------------------------------------------------------

export class Crews {
  /** Trucks out (driving to a site or back) per yard tile index. */
  private busy = new Map<number, number>();
  /** Sites a truck is already driving to. */
  private enRoute = new Set<number>();
  /** Sites that no yard could reach last tick (for the warning tooltip). */
  unreachable = new Set<number>();
  stats = { dispatched: 0, arrived: 0, returned: 0 };

  isEnRoute(i: number): boolean {
    return this.enRoute.has(i);
  }
  /** Trucks out for yard y. */
  out(y: number): number {
    return this.busy.get(y) ?? 0;
  }

  /**
   * Dispatch free trucks to waiting sites, nearest site first. A truck that
   * gives up in a jam still "arrives" (traffic.ts runs onArrive when it is
   * removed), so slots never leak.
   */
  tick(world: World, traffic: Traffic, serviced: (i: number) => boolean = () => true): void {
    const tiles = world.tiles;
    const yards: number[] = [];
    const sites: number[] = [];
    world.chunks.activeTilesSorted().forEach((i) => { const t = tiles[i]; // V1.6 A2: active chunks only
      if (t.structure === 'constructionYard') yards.push(i);
      // Only sites that can actually be worked on (road + power + water):
      // sending a crew to a site without water would just park a truck there.
      else if (t.zone && t.construct > 0 && !t.crew && !this.enRoute.has(i) && serviced(i)) sites.push(i);
    });
    // Forget yards that were bulldozed.
    for (const y of [...this.busy.keys()]) if (tiles[y].structure !== 'constructionYard') this.busy.delete(y);
    this.unreachable.clear();
    if (!sites.length) return;
    const dist = (a: number, b: number) => Math.abs((a % GRID_SIZE) - (b % GRID_SIZE)) + Math.abs(Math.floor(a / GRID_SIZE) - Math.floor(b / GRID_SIZE));
    // V1.6 T2: this used to recompute the nearest yard inside the sort
    // comparator and re-filter the yards per site (O(sites × yards × log)),
    // which grew quadratically with several towns. Same order, computed once.
    const near = new Map<number, number>();
    for (const s of sites) { let m = Infinity; for (const y of yards) m = Math.min(m, dist(s, y)); near.set(s, m); }
    sites.sort((a, b) => near.get(a)! - near.get(b)!);
    const roadYards = yards.filter((y) => roadNextTo(tiles, y) >= 0);
    for (const s of sites) {
      const to = roadNextTo(tiles, s);
      if (!yards.length || to < 0) { this.unreachable.add(s); continue; }
      const free = roadYards.filter((y) => this.out(y) < YARD_FLEET);
      if (!free.length) continue; // all trucks busy: wait in the queue
      free.sort((a, b) => dist(a, s) - dist(b, s));
      let sent = false;
      for (const y of free) {
        const from = roadNextTo(tiles, y);
        const ok = traffic.spawn(world, 'truck', from, to, `${CREW_PURPOSE}: to site`, CREW_TRUCK_COLOR, () => this.arrive(world, traffic, y, s, from, to));
        if (ok) {
          this.busy.set(y, this.out(y) + 1);
          this.enRoute.add(s);
          this.stats.dispatched++;
          sent = true;
          break;
        }
      }
      if (!sent) this.unreachable.add(s);
    }
  }

  private arrive(world: World, traffic: Traffic, yard: number, site: number, yardRoad: number, siteRoad: number): void {
    this.enRoute.delete(site);
    const t = world.tiles[site];
    if (t.zone && t.construct > 0) { t.crew = true; t.crewLinger = CREW_LINGER; } // work can start (PR 6: whole site)
    // PR 6 "one visit covers the whole site": with buildings now smaller than
    // a tile, a building site is the block around the truck — the crew also
    // takes on every waiting site within one tile of where it parked.
    const sx = site % GRID_SIZE, sz = Math.floor(site / GRID_SIZE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = sx + dx, nz = sz + dz;
      if (nx < 0 || nz < 0 || nx >= GRID_SIZE || nz >= GRID_SIZE) continue;
      const q = world.tiles[nz * GRID_SIZE + nx];
      if (q.zone && q.construct > 0 && !q.crew) { q.crew = true; q.crewLinger = CREW_LINGER; this.enRoute.delete(nz * GRID_SIZE + nx); }
    }
    this.stats.arrived++;
    // Drive back; the truck is only free again once it is home.
    const home = () => { this.busy.set(yard, Math.max(0, this.out(yard) - 1)); this.stats.returned++; };
    if (!traffic.spawn(world, 'truck', siteRoad, yardRoad, `${CREW_PURPOSE}: returning`, CREW_TRUCK_COLOR, home)) home();
  }
}
