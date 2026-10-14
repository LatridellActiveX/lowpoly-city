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

export const KIND_FACTORY = 0;
export const KIND_FARM = 1;
export const KIND_FOOD_PLANT = 2;

/** Fields a farm wants at each level (index = level). */
export const FARM_FIELDS = [0, 2, 4, 6];
/** Trucks per Construction Yard. */
export const YARD_FLEET = 4;
/** Colour of construction trucks (renderer adds a load of materials on top). */
export const CREW_TRUCK_COLOR = 0xf28c1d;
/** Prefix of a construction truck's `purpose` (the renderer keys off it). */
export const CREW_PURPOSE = 'construction';

const N = GRID_SIZE;

/** Is tile i a (grown or not) farm lot? */
export function isFarmLot(world: World, i: number): boolean {
  const t = world.tiles[i];
  return t.zone === 'industrial' && (t.kind === KIND_FARM || (t.kind === KIND_FACTORY && world.resourceAt(i) === Resource.Farmland));
}
/** A food processing plant lot? */
export const isFoodPlant = (t: Tile) => t.zone === 'industrial' && t.kind === KIND_FOOD_PLANT;

/**
 * Direction from the farm toward its road, in the same priority order the
 * renderer uses to face buildings (S, E, N, W) — so the barn's front and the
 * fields' "behind" agree with what you see. null = no road.
 */
export function roadDir(tiles: Tile[], i: number): [number, number] | null {
  const x = i % N, z = Math.floor(i / N);
  for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
    const nx = x + dx, nz = z + dz;
    if (nx >= 0 && nz >= 0 && nx < N && nz < N && tiles[nz * N + nx].road) return [dx, dz];
  }
  return null;
}

/** Field candidates behind farm i, in claiming order (see the diagram above). */
export function fieldCandidates(tiles: Tile[], i: number): number[] {
  const d = roadDir(tiles, i);
  if (!d) return [];
  const x = i % N, z = Math.floor(i / N);
  const [fx, fz] = d;
  const bx = -fx, bz = -fz; // behind = away from the road
  const rx = -bz, rz = bx; // a fixed side column (the farm's "right" when facing the road)
  const out: number[] = [];
  for (let depth = 1; depth <= 3; depth++)
    for (const lat of [0, 1]) {
      const cx = x + bx * depth + rx * lat, cz = z + bz * depth + rz * lat;
      if (cx >= 0 && cz >= 0 && cx < N && cz < N) out.push(cz * N + cx);
    }
  return out;
}

/** May farm f claim tile c as a field? */
function claimable(t: Tile, f: number): boolean {
  if (t.water || t.road || t.edge || t.structure !== 'none' || t.part) return false;
  if (t.farm > 0 && t.farm !== f + 1) return false; // another farm's field
  if (t.farm === -(f + 1)) return false; // fallow: bulldozed by the player
  if (t.zone === null) return true;
  return t.zone === 'industrial' && t.level === 0 && t.construct === 0 && t.kind === KIND_FACTORY;
}

/** Number of fields currently owned by farm f. */
export function fieldCount(world: World, f: number): number {
  let n = 0;
  for (const t of world.tiles) if (t.farm === f + 1) n++;
  return n;
}

/** Steps 1 and 2 of the farm rules (see header). Cheap: one pass + ≤ 6 checks per farm. */
export function updateFarms(world: World): void {
  const tiles = world.tiles;
  const owned = new Map<number, number>();
  // 1. Free fields (and fallow marks) whose owner is gone; count the rest.
  tiles.forEach((t, i) => {
    if (t.farm === 0) return;
    const owner = Math.abs(t.farm) - 1;
    const alive = isFarmLot(world, owner) && tiles[owner].level > 0;
    if (!alive) { t.farm = 0; return; }
    if (t.farm > 0) {
      // A field must still be bare land (someone may have built a road over fallow → then re-owned? no: canPlace blocks owned fields).
      owned.set(owner, (owned.get(owner) ?? 0) + 1);
      void i;
    }
  });
  // 2. Each grown farm claims fields up to its quota; drops extras if it shrank.
  tiles.forEach((t, f) => {
    if (!isFarmLot(world, f) || t.level === 0) return;
    const want = FARM_FIELDS[Math.min(3, t.level)];
    let have = owned.get(f) ?? 0;
    const cands = fieldCandidates(tiles, f);
    for (const c of cands) {
      if (have >= want) break;
      const ct = tiles[c];
      if (ct.farm === f + 1 || !claimable(ct, f)) continue;
      ct.farm = f + 1;
      ct.zone = null; // an empty industrial lot becomes farmland
      ct.deco = 0;
      have++;
    }
    // Over quota (shouldn't happen as levels only rise, but stay safe): free the last ones.
    for (let k = cands.length - 1; k >= 0 && have > want; k--) if (tiles[cands[k]].farm === f + 1) { tiles[cands[k]].farm = 0; have--; }
  });
}

/** Jobs at a grown commercial/industrial tile: farms are low-labour (3 per level). */
export function jobsOf(world: World, i: number): number {
  const t = world.tiles[i];
  if (!t.zone || t.zone === 'residential' || t.level === 0) return 0;
  if (t.zone === 'commercial') return 4 * t.level;
  return isFarmLot(world, i) ? 3 * t.level : 8 * t.level;
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
    tiles.forEach((t, i) => {
      if (t.structure === 'constructionYard') yards.push(i);
      // Only sites that can actually be worked on (road + power + water):
      // sending a crew to a site without water would just park a truck there.
      else if (t.zone && t.construct > 0 && !t.crew && !this.enRoute.has(i) && serviced(i)) sites.push(i);
    });
    // Forget yards that were bulldozed.
    for (const y of [...this.busy.keys()]) if (tiles[y].structure !== 'constructionYard') this.busy.delete(y);
    this.unreachable.clear();
    if (!sites.length) return;
    const dist = (a: number, b: number) => Math.abs((a % N) - (b % N)) + Math.abs(Math.floor(a / N) - Math.floor(b / N));
    const nearestYard = (s: number) => yards.reduce((m, y) => Math.min(m, dist(s, y)), Infinity);
    sites.sort((a, b) => nearestYard(a) - nearestYard(b));
    for (const s of sites) {
      const to = roadNextTo(tiles, s);
      const free = yards.filter((y) => this.out(y) < YARD_FLEET && roadNextTo(tiles, y) >= 0).sort((a, b) => dist(a, s) - dist(b, s));
      if (!yards.length || to < 0) { this.unreachable.add(s); continue; }
      if (!free.length) continue; // all trucks busy: wait in the queue
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
    if (t.zone && t.construct > 0) t.crew = true; // work can start
    this.stats.arrived++;
    // Drive back; the truck is only free again once it is home.
    const home = () => { this.busy.set(yard, Math.max(0, this.out(yard) - 1)); this.stats.returned++; };
    if (!traffic.spawn(world, 'truck', siteRoad, yardRoad, `${CREW_PURPOSE}: returning`, CREW_TRUCK_COLOR, home)) home();
  }
}
