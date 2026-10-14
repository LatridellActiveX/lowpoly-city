/**
 * sim/growth.ts — PR 6 growth, redevelopment and the cell-level tools.
 *
 * Simulation.step() calls `growLots()` once per tick. It replaces the PR 5
 * per-tile growth loop with a per-BUILDING one (lots.ts entities):
 *
 *   1. FOUND new buildings: take FIT_BUDGET tiles off the dirty queue, try
 *      every template that fits (lots.options) and start the best as a
 *      construction site — if this zone's demand roll and the utilities'
 *      spare capacity allow it. Tiles that can't fit anything are dropped
 *      from the queue (they come back when something nearby changes).
 *   2. For every building:
 *        - under construction: work only with road + power + water AND a
 *          crew on the host tile (industry.ts Crews). One crew visit covers
 *          every building on that site and lingers CREW_LINGER ticks.
 *        - finished: count happy ticks (half speed while short of parking or
 *          when drivers keep giving up), then LEVEL UP inside the footprint
 *          if desirability, tier, parking (parking.canSupport), demand and
 *          spare power / water allow.
 *        - at max level for MERGE_TICKS under strong demand: try to MERGE
 *          with neighbouring small buildings into a bigger template
 *          (houses → townhouses → apartments; corner shops → strip malls).
 *        - in trouble (no demand, no service, no parking) for SHRINK_TICKS:
 *          lose a level; at level 1 the building is abandoned and removed.
 *
 * The same rules feed `buildingRequirements()` (the Inspect "Next level"
 * bars), so the panel can't disagree with what the sim checks.
 */
import { MEDIUM_LEVEL_POP, resLevel } from './footprints';
import { zonePromote } from './lots';
import { mediumUnlocked } from './progression';
import { occupancyDemand } from './demand';
import { CELL_GRID, CELLS_PER_TILE, CellRole, cidx, tileOfCell, ZONE_CODES, ZoneCode, zoneCode } from './cells';
import { area, isFiller, Template, TEMPLATES, TPL } from './footprints';
import { localToCell } from './lots';
import { residentsAt } from './footprints';
import { FIT_BUDGET, MERGE_TICKS, SHRINK_TICKS, capacityAt, growablePool, scoreOption, tileBuildable, refreshTileZone, Building } from './lots';
import { lotFits } from './parking';
import { tierOk } from './progression';
import { CONSTRUCT_TICKS, DEMAND, DESIRE_FAST, DESIRE_FOR_DENSE, DESIRE_MIN, GROW_TICKS, MEDIUM_DENSITY } from './rules';
import { growthFactor, propertyGrowth } from './economy';
import { hash2 } from './random';
import { Resource } from './resources';
import { GRID_SIZE, ToolId, ZoneType } from './types';
import type { Requirement, Simulation } from './simulation';

/** Desirability gate per density rank (rank 1 = medium, rank 2 = high). */
export const DENSITY_DESIRE = [0, MEDIUM_DENSITY[4].desire, MEDIUM_DENSITY[5].desire];

/** Desirability at a building: its host tile's value (environment.ts is per tile). */
export const desireOf = (sim: Simulation, b: Building) => sim.env.desirability[b.host];

/** Extra power / water a building needs to go from `from` to `to` level. */
function extraUse(tpl: Template, from: number, to: number): { power: number; water: number } {
  const unit = tpl.zone === 'residential' ? 5 : tpl.zone === 'commercial' ? 4 : tpl.kind === 1 ? 3 : 8;
  const du = (capacityAt(tpl, to) - capacityAt(tpl, from)) / unit;
  const d = DEMAND[tpl.zone];
  return { power: d.power * du, water: d.water * du };
}

/** Highest level this building may reach right now (desirability + tier gates). */
export function levelCap(sim: Simulation, b: Building): number {
  const tpl = TPL[b.tpl];
  if (tpl.zone !== 'residential') return tpl.maxLevel;
  const d = desireOf(sim, b);
  if (d < DESIRE_MIN) return 0;
  if (tpl.legacy) {
    // Migrated PR 5 homes keep the PR 5 ladder (levels 4/5 = medium density).
    let cap = d < DESIRE_FOR_DENSE ? 1 : 3;
    for (const lv of [4, 5] as const) if (tierOk(sim.world, MEDIUM_DENSITY[lv].tier) && d >= MEDIUM_DENSITY[lv].desire && sim.demand.residential.value > 0) cap = lv;
    return cap;
  }
  if (tpl.density === 0 && d < DESIRE_FOR_DENSE) return 1;
  // V1.5 extra medium levels (see footprints MEDIUM_LEVEL_POP): building
  // levels 3 and 4 of a medium template (= residential levels 6 and 7)
  // unlock with city population.
  if (tpl.zone === 'residential' && tpl.density === 1) {
    let cap = 2;
    for (const [k, pop] of MEDIUM_LEVEL_POP.entries()) if (sim.world.peakPop >= pop) cap = 3 + k;
    return Math.min(cap, tpl.maxLevel);
  }
  return tpl.maxLevel;
}

/** Seeded growth roll for a zone (same shape as PR 5: tax × demand). */
function roll(sim: Simulation, zone: ZoneType, salt: number): boolean {
  const w = sim.world;
  // V1.5 mixed use (commercial host tile with kind 3): flats AND a shop, so
  // whichever of residential / commercial demand is stronger drives it.
  const mixed = zone === 'commercial' && w.tiles[salt]?.kind === 3;
  // V1.5b stage H: offices grow on BOTH commercial and industrial demand.
  const office = zone === 'commercial' && w.tiles[salt]?.kind === 4;
  const f = mixed ? Math.max(sim.demandFactor('commercial'), sim.demandFactor('residential')) : office ? (sim.demandFactor('commercial') + sim.demandFactor('industrial')) / 2 : sim.demandFactor(zone);
  return hash2(salt, w.tick, w.seed + 777) <= 0.35 * growthFactor(w.taxRates[zone]) * propertyGrowth(w.propertyRate) * f; // V1.5: property tax too
}

export function growLots(sim: Simulation, sparePower: number[], spareWater: number[]): void {
  const w = sim.world, lots = w.lots, park = w.parking;
  const take = (host: number, use: { power: number; water: number }): boolean => {
    const s = sim.net.service[host];
    if (s.powerNet < 0 || s.waterNet < 0) return false;
    if (sparePower[s.powerNet] < use.power || spareWater[s.waterNet] < use.water) return false;
    sparePower[s.powerNet] -= use.power;
    spareWater[s.waterNet] -= use.water;
    return true;
  };
  const ok = (host: number) => { const s = sim.net.service[host]; return s.roadAccess && s.powered && s.watered; };

  // ---- 1. found new buildings on dirty tiles ----
  for (const i of lots.takeDirty(FIT_BUDGET)) {
    const t = w.tiles[i];
    if (!t.zone) continue;
    const zone = t.zone;
    const pool = growablePool(zone, w).filter((p) => p.density === 0 || desireOf2(sim, i) >= DENSITY_DESIRE[p.density] || zone !== 'residential');
    const opts = lots.options(w, i, pool);
    if (!opts.length) { fillGaps(sim, i); continue; }
    // Not this tick (demand roll / no service): keep the tile queued.
    if (!ok(i) || !roll(sim, zone, i)) { lots.markDirty(i); continue; }
    const mix = zone === 'industrial' ? industryMix(sim) : null;
    const score = (o: (typeof opts)[number]) => scoreOption(o, w.tick, w.seed, w) * (mix ? kindWeight(sim, mix, o) : 1);
    const scored = opts.map((o) => ({ o, sc: score(o) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc);
    if (!scored.length) { lots.markDirty(i); continue; }
    const best = scored[0].o;
    if (!ok(best.host) || !take(best.host, extraUse(best.tpl, 0, 1))) { lots.markDirty(i); continue; }
    lots.place(w, best.tpl, best.ox, best.oz, best.face, best.host, 0, CONSTRUCT_TICKS);
    lots.stats.founded++;
    lots.markDirty(i); // there may be room for another one
  }

  // ---- 2. every building ----
  sim.completed = [];
  for (const b of [...lots.buildings.values()]) {
    const tpl = TPL[b.tpl];
    if (isFiller(tpl)) continue;
    const host = w.tiles[b.host];
    const serviced = ok(b.host);
    if (b.construct > 0) {
      if (serviced && host.crew) {
        b.construct--;
        if (b.construct === 0) {
          b.level++;
          b.happy = 0;
          sim.completed.push(b.id);
          if (tpl.zone === 'commercial') host.stock = Math.max(host.stock, 4); // opening stock
        }
      }
      continue;
    }
    // Trouble counters: no service, negative demand, or no parking.
    const short = park.shortfall(b) > 0;
    const dem = occupancyDemand(sim.demand[tpl.zone]); // V1.5b: empty zoning doesn't shrink settled homes
    const frustrated = b.arrivals > 3 && b.gaveUp / b.arrivals > 0.5;
    if (!serviced || dem < -0.5 || short && frustrated) b.unhappy++;
    else b.unhappy = Math.max(0, b.unhappy - 2);
    if (b.unhappy > SHRINK_TICKS) {
      b.unhappy = 0;
      if (b.level > 1) { b.level--; lots.stats.shrunk++; }
      else { lots.remove(w, b); lots.stats.abandoned++; continue; }
    }
    if (!serviced) { b.happy = 0; continue; }
    // Parking shortfall / give-ups slow growth to half speed.
    if (!(short || frustrated) || w.tick % 2 === 0) b.happy++;
    const need = (tpl.zone === 'residential' && desireOf(sim, b) >= DESIRE_FAST ? GROW_TICKS / 2 : GROW_TICKS) * eduSlow(sim, b);
    if (b.happy < need) continue;
    const cap = levelCap(sim, b);
    if (b.level < Math.min(cap, tpl.maxLevel)) {
      if (!park.canSupport(b, b.level + 1)) continue;
      if (!roll(sim, tpl.zone, b.id * 31)) continue;
      if (!take(b.host, extraUse(tpl, b.level, b.level + 1))) continue;
      b.construct = CONSTRUCT_TICKS; // next stage; needs a crew on site again unless one is lingering
      b.happy = 0;
    } else if (mergeReady(tpl, b, cap) && b.happy >= mergeTicks(tpl) && dem > (medRes(tpl) ? MED_MERGE_DEMAND : 0.3) && (b.id + w.tick) % mergeEvery(tpl) === 0) {
      tryMerge(sim, b, take);
    }
  }
  // Parking spaces from public lots are re-shared every 5 ticks.
  if (w.tick % 5 === 0) park.allocate(lots);
  lots.aggregate(w);
}

/**
 * PR 6 INDUSTRY MIX. Farms and food plants are no longer placed by hand:
 * when industrial cells develop, growth picks a farm, a food processing
 * plant or an ordinary factory, weighted by what the city is short of:
 *   farmNeed  = shortfall of farm output vs food demand. Food demand is one
 *               farm level per FOOD_PEOPLE residents (shops sell food to them).
 *   plantNeed = shortfall of processing capacity vs farm output: one plant
 *               level per PLANT_PER_FARM farm levels (packaged food demand).
 * Weights: factory 1; farm 0.15 + 3 × farmNeed (×2.5 on a FARMLAND patch);
 * food plant 0.1 + 3 × plantNeed. A farm also needs ≥ 16 free cells of room
 * behind its barn for fields, or it isn't considered at all. The seeded
 * random in scoreOption keeps the choice deterministic per city.
 */
export const FOOD_PEOPLE = 180;
export const PLANT_PER_FARM = 4;
export interface IndustryMix { farmNeed: number; plantNeed: number; farms: number; plants: number; wantFarms: number; wantPlants: number; driver: string }
export function industryMix(sim: Simulation): IndustryMix {
  let pop = 0, farms = 0, plants = 0;
  for (const b of sim.world.lots.buildings.values()) {
    const t = TPL[b.tpl];
    const lv = b.level + (b.construct > 0 ? 1 : 0);
    if (t.zone === 'residential') pop += capacityAt(t, b.level);
    else if (t.residents) pop += residentsAt(t, b.level); // V1.5 mixed use
    else if (t.zone === 'industrial' && t.kind === 1) farms += lv;
    else if (t.zone === 'industrial' && t.kind === 2) plants += lv;
  }
  const wantFarms = pop / FOOD_PEOPLE, wantPlants = farms / PLANT_PER_FARM;
  const farmNeed = Math.max(0, Math.min(1, (wantFarms - farms) / Math.max(1, wantFarms)));
  const plantNeed = Math.max(0, Math.min(1, (wantPlants - plants) / Math.max(1, wantPlants)));
  const driver = farmNeed > 0.3 ? `Food demand: ${Math.round(wantFarms)} farm levels wanted, ${farms} built — new industry favours farms` : plantNeed > 0.3 ? `Farms need processing: ${Math.ceil(wantPlants)} food-plant levels wanted, ${plants} built` : 'Food supply is keeping up — new industry favours factories';
  return { farmNeed, plantNeed, farms, plants, wantFarms, wantPlants, driver };
}
function kindWeight(sim: Simulation, mix: IndustryMix, o: { tpl: Template; ox: number; oz: number; face: number; host: number }): number {
  if (o.tpl.kind === 0) return 1;
  if (o.tpl.kind === 2) return 0.1 + 3 * mix.plantNeed;
  // Farm: needs room for fields behind the barn.
  const w = sim.world;
  let room = 0;
  for (let v = o.tpl.d; v < o.tpl.d + 6 && room < 16; v++) for (let u = -1; u <= o.tpl.w; u++) {
    const [cx, cz] = localToCell(o.ox, o.oz, o.face, u, v);
    if (cx < 0 || cz < 0 || cx >= CELL_GRID || cz >= CELL_GRID) continue;
    const c = cidx(cx, cz);
    const code = w.cells.zone[c];
    if (w.cells.owner[c] === 0 && (code === 0 || ZONE_CODES[code].zone === 'industrial') && tileBuildable(w.tiles[tileOfCell(cx, cz)])) room++;
  }
  if (room < 16) return 0;
  return (0.15 + 3 * mix.farmNeed) * (w.resourceAt(o.host) === Resource.Farmland ? 2.5 : 1);
}

/** Desirability of a tile index (for pool filtering before a building exists). */
const desireOf2 = (sim: Simulation, i: number) => sim.env.desirability[i];

/**
 * REDEVELOPMENT. Try to replace b (and neighbours) with a bigger template:
 * a candidate must have a higher density rank or a bigger area, fit the
 * zoned cells, and may only reuse cells of SAME-zone buildings that are
 * entirely inside its footprint, finished, and themselves at max level (or
 * fillers). The old buildings are removed and the new one starts as a
 * construction site (needs a crew like any other).
 */
/**
 * V1.5b stage A — MORE FREQUENT MEDIUM MERGES.
 * Parker: "adjacent lots merge more often into larger footprints at higher
 * levels". A medium-density home counts as merge-ready once it has reached
 * L6 (template level 3) and is topped out at its current population cap —
 * it no longer has to wait for L7. It waits half as long (MERGE_TICKS / 2),
 * needs only mild demand (MED_MERGE_DEMAND) and is checked every 5 ticks
 * instead of every 10. Neighbours at L6+ may be swallowed too, and the new
 * large footprint (apt_complex / twin_midrise / perimeter …) starts at
 * template level MED_MERGE_START so the street doesn't lose most of its
 * residents during the rebuild.
 */
/**
 * V1.5b stage G — EDUCATION AND HOME LEVELS. Homes still grow without
 * schools, but slower: the next level L4–L5 needs elementary coverage
 * (edu ≥ 1) and L6–L7 high-school coverage (edu ≥ 2), else growth takes
 * EDU_SLOW_ELEM / EDU_SLOW_HIGH × as long.
 */
export const EDU_SLOW_ELEM = 1.4, EDU_SLOW_HIGH = 1.6;
export function eduSlow(sim: Simulation, b: Building): number {
  const tpl = TPL[b.tpl];
  if (tpl.zone !== 'residential' || !sim.cov) return 1;
  const next = resLevel(tpl, b.level + 1), e = sim.cov.edu[b.host] ?? 0;
  if (next >= 6 && e < 2) return EDU_SLOW_HIGH;
  if (next >= 4 && e < 1) return EDU_SLOW_ELEM;
  return 1;
}
export const MED_MERGE_DEMAND = 0.1;
export const MED_MERGE_START = 2;
const medRes = (t: Template) => t.zone === 'residential' && t.density === 1 && !t.legacy;
/** V1.5b stage B: industry merges ~1.5× more often (shorter wait, checked more often). */
export const IND_MERGE_RATE = 1.5;
const mergeTicks = (t: Template) => (medRes(t) ? MERGE_TICKS / 2 : t.zone === 'industrial' ? Math.round(MERGE_TICKS / IND_MERGE_RATE) : MERGE_TICKS);
const mergeEvery = (t: Template) => (medRes(t) ? 5 : t.zone === 'industrial' ? Math.round(10 / IND_MERGE_RATE) : 10);
/** Ready to merge: maxed out, or (medium homes) L6+ and at the population cap. */
export function mergeReady(t: Template, b: Building, cap = t.maxLevel): boolean {
  if (b.level >= t.maxLevel) return true;
  return medRes(t) && b.level >= 3 && b.level >= cap;
}

function tryMerge(sim: Simulation, b: Building, take: (host: number, use: { power: number; water: number }) => boolean): boolean {
  const w = sim.world;
  const tpl = TPL[b.tpl];
  // V1.5: a maxed low-density home may become MEDIUM density by itself once
  // medium housing is unlocked (1,000 people) — no re-zoning needed. The
  // desirability gate for medium density still applies.
  const promote = tpl.zone === 'residential' && tpl.density === 0 && mediumUnlocked(w) && desireOf(sim, b) >= DENSITY_DESIRE[1];
  const bigger = growablePool(tpl.zone, w).filter((p) => p.kind === tpl.kind && (p.density > tpl.density || area(p) > area(tpl) * 1.5) && (tpl.zone !== 'residential' || desireOf(sim, b) >= DENSITY_DESIRE[p.density]) && (p.density <= 1 || !promote));
  if (!bigger.length) return false;
  zonePromote.on = promote;
  try {
    return mergeInto(sim, b, tpl, bigger, take, promote);
  } finally {
    zonePromote.on = false;
  }
}

/** tryMerge body (split out so the zone-promotion flag is always reset). */
function mergeInto(sim: Simulation, b: Building, tpl: Template, bigger: Template[], take: (host: number, use: { power: number; water: number }) => boolean, promote: boolean): boolean {
  const w = sim.world, lots = w.lots;
  // Neighbours that may be swallowed: same zone/kind, finished, maxed (or fillers), near b.
  const replace = new Set<number>();
  for (const o of lots.buildings.values()) {
    const ot = TPL[o.tpl];
    if (Math.abs(o.x0 - b.x0) > 10 || Math.abs(o.z0 - b.z0) > 10) continue;
    const done = o.level >= ot.maxLevel || (medRes(ot) && o.level >= 3); // V1.5b: L6+ medium neighbours count
    if (isFiller(ot) || (ot.zone === tpl.zone && ot.kind === tpl.kind && o.construct === 0 && done && ot.density <= tpl.density && !ot.legacy)) replace.add(o.id);
  }
  replace.add(b.id);
  const opts = lots.options(w, b.host, bigger, replace).filter((o) => {
    // Must cover b, and every swallowed building must be fully inside.
    const [x0, z0, x1, z1] = aabb(o.tpl, o.ox, o.oz, o.face);
    if (!(b.x0 >= x0 && b.z0 >= z0 && b.x1 <= x1 && b.z1 <= z1)) return false;
    for (let cz = z0; cz < z1; cz++) for (let cx = x0; cx < x1; cx++) {
      const id = w.cells.owner[cidx(cx, cz)];
      if (id > 0) { const q = lots.buildings.get(id)!; if (q.x0 < x0 || q.z0 < z0 || q.x1 > x1 || q.z1 > z1) return false; }
    }
    return true;
  });
  if (!opts.length) return false;
  opts.sort((p, q) => scoreOption(q, w.tick, w.seed) - scoreOption(p, w.tick, w.seed));
  const best = opts[0];
  const [x0, z0, x1, z1] = aabb(best.tpl, best.ox, best.oz, best.face);
  const gone = new Set<number>();
  for (let cz = z0; cz < z1; cz++) for (let cx = x0; cx < x1; cx++) { const id = w.cells.owner[cidx(cx, cz)]; if (id > 0) gone.add(id); }
  // The new building's level-1 use minus what the old ones used.
  let freed = 0;
  for (const id of gone) { const q = lots.buildings.get(id)!; freed += capacityAt(TPL[q.tpl], q.level); }
  // V1.5b: medium → larger medium merges restart at MED_MERGE_START (L5), not L4.
  const start = medRes(tpl) && medRes(best.tpl) ? Math.min(MED_MERGE_START, best.tpl.maxLevel - 1) : 0;
  const use = extraUse(best.tpl, 0, start + 1), unit = best.tpl.zone === 'residential' ? 5 : best.tpl.zone === 'commercial' ? 4 : 8;
  const credit = freed / unit;
  if (!take(best.host, { power: Math.max(0, use.power - DEMAND[best.tpl.zone].power * credit), water: Math.max(0, use.water - DEMAND[best.tpl.zone].water * credit) })) return false;
  for (const id of gone) lots.remove(w, lots.buildings.get(id)!);
  lots.place(w, best.tpl, best.ox, best.oz, best.face, best.host, start, CONSTRUCT_TICKS);
  lots.stats.merged++;
  // V1.5: an automatic low → medium step repaints the new building's cells
  // Residential · medium so it keeps growing (and later saves agree).
  if (promote && best.tpl.density === 1) {
    for (let cz = z0; cz < z1; cz++) for (let cx = x0; cx < x1; cx++) if (w.cells.zone[cidx(cx, cz)] === ZoneCode.ResLow) w.cells.zone[cidx(cx, cz)] = ZoneCode.ResMed;
    sim.events.push(`🏘 A level-3 neighbourhood is growing into medium density: a ${best.tpl.label.toLowerCase()} is going up.`);
  }
  sim.events.push(`🏗 Redevelopment: ${gone.size} building${gone.size > 1 ? 's' : ''} merging into a ${best.tpl.label.toLowerCase()}.`);
  return true;
}

function aabb(tpl: Template, ox: number, oz: number, face: number): [number, number, number, number] {
  // (local import-free copy of lots.rectAABB for the whole template)
  const f = [[0, -1], [1, 0], [0, 1], [-1, 0]][face];
  const ax = f[1], az = -f[0], dx = -f[0], dz = -f[1];
  const bx = ox + (tpl.w - 1) * ax + (tpl.d - 1) * dx, bz = oz + (tpl.w - 1) * az + (tpl.d - 1) * dz;
  return [Math.min(ox, bx), Math.min(oz, bz), Math.max(ox, bx) + 1, Math.max(oz, bz) + 1];
}

/**
 * LEFTOVERS. No real building fits on tile i any more: drop a garden into
 * 1-cell kerb gaps and overflow parking into 2-cell gaps of non-residential
 * zones, so blocks look naturally packed instead of gap-toothed.
 */
function fillGaps(sim: Simulation, i: number): void {
  const w = sim.world;
  const t = w.tiles[i];
  if (!t.zone) return;
  const fillers = [TPL.overflow, TPL.garden].filter((f) => t.zone !== 'residential' || f.id === 'garden');
  // Only once the tile's kerb already has a real building (an empty, zoned
  // tile is just waiting for demand, not a "gap").
  if (!w.lots.hostedOn(i).some((b) => !isFiller(TPL[b.tpl]))) return;
  for (const o of w.lots.options(w, i, fillers)) {
    w.lots.place(w, o.tpl, o.ox, o.oz, o.face, o.host, 1, 0);
    w.lots.stats.fillers++;
    return;
  }
}

// ---------------------------------------------------------------------------
// Cell-level tools
// ---------------------------------------------------------------------------

/** Zoning UI options (main.ts owns them; Settings-free, session only). */
export interface ZoneOptions {
  /** 0 low / light, 1 medium / high / heavy, 2 high (residential). */
  density: number;
  /** How many tiles deep a drag along a road zones (1..4). */
  depth: number;
}

/** Zone code a tool paints on tile i. Industry on a farmland patch paints Farm cells (PR 5 rule). */
export function codeForTool(sim: Simulation, tool: ToolId, i: number, opt: ZoneOptions): ZoneCode {
  if (tool === 'farm') return ZoneCode.Farm;
  if (tool === 'foodPlant') return ZoneCode.FoodPlant;
  const zone = tool as ZoneType;
  if (zone === 'industrial' && opt.density === 0 && sim.world.resourceAt(i) === Resource.Farmland) return ZoneCode.Farm;
  // V1.5: commercial accepts density 2 (= Mixed use, cells.ts ComMixed).
  return zoneCode(zone, zone === 'industrial' ? Math.min(1, opt.density) : opt.density);
}

/**
 * Tiles a zoning drag actually covers: the dragged tiles, plus — for each
 * dragged tile that touches a road — up to depth−1 more tiles straight back
 * from that road. So "drag one row along the street" zones a 3-tile-deep
 * strip by default.
 */
export function zoneTiles(sim: Simulation, tiles: Array<[number, number]>, depth: number): Array<[number, number]> {
  const w = sim.world;
  const seen = new Set<number>();
  const out: Array<[number, number]> = [];
  const push = (x: number, z: number) => { const k = z * GRID_SIZE + x; if (x >= 0 && z >= 0 && x < GRID_SIZE && z < GRID_SIZE && !seen.has(k)) { seen.add(k); out.push([x, z]); } };
  for (const [x, z] of tiles) {
    push(x, z);
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const rx = x + dx, rz = z + dz;
      if (rx < 0 || rz < 0 || rx >= GRID_SIZE || rz >= GRID_SIZE || !w.at(rx, rz).road) continue;
      for (let k = 1; k < depth; k++) {
        const bx = x - dx * k, bz = z - dz * k;
        if (bx < 0 || bz < 0 || bx >= GRID_SIZE || bz >= GRID_SIZE) break;
        const bt = w.at(bx, bz);
        if (bt.road || bt.water) break; // stop at the next street / river
        push(bx, bz);
      }
    }
  }
  return out;
}

/** Free cells of tile (x, z) that this code would (re)paint. */
export function paintableCells(sim: Simulation, x: number, z: number, code: ZoneCode): number {
  const w = sim.world;
  let n = 0;
  for (let dz = 0; dz < CELLS_PER_TILE; dz++) for (let dx = 0; dx < CELLS_PER_TILE; dx++) {
    const c = cidx(x * 4 + dx, z * 4 + dz);
    if (w.cells.owner[c] === 0 && w.cells.zone[c] !== code) n++;
  }
  return n;
}

/** Paint the free cells of tile (x, z). Returns cells painted. */
export function paintTile(sim: Simulation, x: number, z: number, code: ZoneCode): number {
  const w = sim.world;
  let n = 0;
  for (let dz = 0; dz < CELLS_PER_TILE; dz++) for (let dx = 0; dx < CELLS_PER_TILE; dx++) {
    const c = cidx(x * 4 + dx, z * 4 + dz);
    if (w.cells.owner[c] !== 0 || w.cells.zone[c] === code) continue;
    w.cells.zone[c] = code;
    n++;
  }
  const i = z * GRID_SIZE + x;
  if (!w.lots.hostedOn(i).length) refreshTileZone(w, i);
  w.lots.markAround(x, z);
  return n;
}

/**
 * Bulldoze the cell layer of tile (x, z): remove every building with a body
 * / parking / garden cell here, turn field cells FALLOW (the farm keeps
 * the rest), remove public lots touching the tile and unzone the free cells.
 */
export function bulldozeCells(sim: Simulation, x: number, z: number): number {
  const w = sim.world, lots = w.lots, { owner, role, zone } = w.cells;
  let n = 0;
  const kill = new Set<number>(), lotsHit = new Set<number>();
  for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) {
    const c = cidx(x * 4 + dx, z * 4 + dz);
    const o = owner[c];
    if (o > 0) {
      if (role[c] === CellRole.Field) { role[c] = CellRole.Fallow; const b = lots.buildings.get(o); if (b) b.fields--; n++; }
      else if (role[c] !== CellRole.Fallow) kill.add(o);
    } else if (o < 0) lotsHit.add(-o);
  }
  for (const id of kill) { const b = lots.buildings.get(id); if (b) { lots.remove(w, b); n++; } }
  for (const id of lotsHit) { const l = w.parking.lots.get(id); if (l) { w.parking.removeLot(w, l); n++; } }
  for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) {
    const c = cidx(x * 4 + dx, z * 4 + dz);
    if (owner[c] === 0 && zone[c]) { zone[c] = 0; n++; }
  }
  w.lots.markAround(x, z);
  return n;
}

/** Does tile (x, z) have anything on its cells (buildings, lots, fields)? */
export function tileHasCells(sim: Simulation, x: number, z: number): boolean {
  for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) if (sim.world.cells.owner[cidx(x * 4 + dx, z * 4 + dz)] !== 0) return true;
  return false;
}

/**
 * Where a public lot of `size` cells goes when you click tile (x, z) at
 * fractional position (fx, fz) inside it: the 2×2 quadrant under the
 * cursor (surface lot) or the whole tile (garage). Must touch a road tile.
 */
export function parkingSpot(sim: Simulation, x: number, z: number, fx: number, fz: number, size: number): [number, number] | null {
  const w = sim.world;
  const cx = x * 4 + (size === 4 ? 0 : fx >= 0.5 ? 2 : 0);
  const cz = z * 4 + (size === 4 ? 0 : fz >= 0.5 ? 2 : 0);
  if (!lotFits(w, cx, cz, size, tileBuildable)) return null;
  const nearRoad = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dz]) => { const nx = x + dx, nz = z + dz; return nx >= 0 && nz >= 0 && nx < GRID_SIZE && nz < GRID_SIZE && w.at(nx, nz).road; });
  return nearRoad ? [cx, cz] : null;
}

// ---------------------------------------------------------------------------
// Inspect: "Next level" requirement bars for a building
// ---------------------------------------------------------------------------

export function buildingRequirements(sim: Simulation, b: Building): Requirement[] | null {
  const w = sim.world, tpl = TPL[b.tpl], park = w.parking;
  if (isFiller(tpl)) return null;
  const rows: Requirement[] = [];
  const add = (label: string, current: number, target: number, hint: string) => rows.push({ label, current, target, met: current >= target, hint });
  const st = sim.status(b.host);
  add('Road, power & water', +st.roadAccess + +st.powered + +st.watered, 3, `Connect ${st.missing.join(', ') || 'utilities'}`);
  const t = w.tiles[b.host];
  if (b.construct > 0) {
    add('Construction crew on site', t.crew ? 1 : 0, 1, sim.crews.unreachable.has(b.host) || !w.tiles.some((q) => q.structure === 'constructionYard') ? 'Build a Construction Yard connected by road' : 'Crew truck on its way / queued');
    add('Construction work', CONSTRUCT_TICKS - b.construct, CONSTRUCT_TICKS, 'Keep road, power and water connected');
    return rows;
  }
  if (b.level >= tpl.maxLevel) {
    // Max level: show what redevelopment (merging) needs instead.
    const dem = sim.demand[tpl.zone].value;
    add('Strong demand to redevelop (merge)', Math.max(0, Math.round(dem * 100)), 31, 'Keep demand high — neighbours may merge into a bigger building');
    add('Settled at top level', Math.min(b.happy, MERGE_TICKS), MERGE_TICKS, 'Just wait');
    return rows;
  }
  const next = b.level + 1;
  const dem = sim.demand[tpl.zone].value;
  add(`${tpl.zone === 'residential' ? 'Residential' : tpl.zone === 'commercial' ? 'Commercial' : 'Industrial'} demand`, Math.max(0, Math.round(dem * 100)), 1, tpl.zone === 'residential' ? 'Add jobs (shops/industry) to attract residents' : tpl.zone === 'commercial' ? 'More residents = more customers' : 'More workers or export access needed');
  if (tpl.zone === 'residential') {
    const d = desireOf(sim, b);
    const need = tpl.legacy ? (next === 1 ? DESIRE_MIN : next <= 3 ? DESIRE_FOR_DENSE : MEDIUM_DENSITY[next as 4 | 5].desire) : next <= 1 ? DESIRE_MIN : tpl.density === 0 ? DESIRE_FOR_DENSE : DENSITY_DESIRE[tpl.density];
    add('Desirability (parks, low pollution)', Math.round(d * 100), Math.round(need * 100), 'Build a park nearby / move away from industry');
    if (tpl.legacy && next >= 4) {
      const tier = MEDIUM_DENSITY[next as 4 | 5].tier;
      add('Population milestone', tierOk(w, tier) ? 1 : 0, 1, tier === 2 ? 'Reach 1,000 people (medium housing)' : 'Reach 10,000 people');
    }
  }
  const req = park.required(b, next);
  let have = park.available(b);
  for (const l of park.inRange(b)) have += Math.max(0, l.spaces - l.allocated);
  add('Parking spaces for next level', Math.min(have, req), req, 'Place a public Parking Lot / Garage nearby (Roads menu)');
  const s = sim.net.service[b.host];
  const use = extraUse(tpl, b.level, next);
  const sp = s.powerNet >= 0 ? sim.net.power[s.powerNet].capacity - sim.net.power[s.powerNet].supplied : 0;
  const sw = s.waterNet >= 0 ? sim.net.water[s.waterNet].capacity - sim.net.water[s.waterNet].supplied : 0;
  add('Spare power & water capacity', +(sp >= use.power) + +(sw >= use.water), 2, 'Build another power plant or water tower');
  const need = (tpl.zone === 'residential' && desireOf(sim, b) >= DESIRE_FAST ? GROW_TICKS / 2 : GROW_TICKS) * eduSlow(sim, b);
  add('Settled (happy ticks)', Math.min(b.happy, need), need, park.shortfall(b) > 0 ? 'Short of parking: growing at half speed' : 'Just wait — growth takes a few seconds');
  return rows;
}

/** Zone code info at a cell (Inspect / tooltips). */
export const cellZoneLabel = (sim: Simulation, cx: number, cz: number) => ZONE_CODES[sim.world.cells.zone[cidx(cx, cz)]].label;
export { CELL_GRID, tileOfCell, TEMPLATES };
