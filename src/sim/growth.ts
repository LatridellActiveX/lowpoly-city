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
import { CELL_GRID, CELLS_PER_TILE, CellRole, cidx, tileOfCell, ZONE_CODES, ZoneCode, zoneCode } from './cells';
import { area, isFiller, Template, TEMPLATES, TPL } from './footprints';
import { FIT_BUDGET, MERGE_TICKS, SHRINK_TICKS, capacityAt, growablePool, scoreOption, tileBuildable, refreshTileZone, Building } from './lots';
import { lotFits } from './parking';
import { CONSTRUCT_TICKS, DEMAND, DESIRE_FAST, DESIRE_FOR_DENSE, DESIRE_MIN, GROW_TICKS, MEDIUM_DENSITY } from './rules';
import { growthFactor } from './economy';
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
    for (const lv of [4, 5] as const) if (sim.world.tier >= MEDIUM_DENSITY[lv].tier && d >= MEDIUM_DENSITY[lv].desire && sim.demand.residential.value > 0) cap = lv;
    return cap;
  }
  if (tpl.density === 0 && d < DESIRE_FOR_DENSE) return 1;
  return tpl.maxLevel;
}

/** Seeded growth roll for a zone (same shape as PR 5: tax × demand). */
function roll(sim: Simulation, zone: ZoneType, salt: number): boolean {
  const w = sim.world;
  return hash2(salt, w.tick, w.seed + 777) <= 0.35 * growthFactor(w.taxRates[zone]) * sim.demandFactor(zone);
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
    const pool = growablePool(zone, w.tier).filter((p) => p.density === 0 || desireOf2(sim, i) >= DENSITY_DESIRE[p.density] || zone !== 'residential');
    const opts = lots.options(w, i, pool);
    if (!opts.length) { fillGaps(sim, i); continue; }
    // Not this tick (demand roll / no service): keep the tile queued.
    if (!ok(i) || !roll(sim, zone, i)) { lots.markDirty(i); continue; }
    opts.sort((a, b) => scoreOption(b, w.tick, w.seed, w) - scoreOption(a, w.tick, w.seed, w));
    const best = opts[0];
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
    const dem = sim.demand[tpl.zone].value;
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
    const need = tpl.zone === 'residential' && desireOf(sim, b) >= DESIRE_FAST ? GROW_TICKS / 2 : GROW_TICKS;
    if (b.happy < need) continue;
    const cap = levelCap(sim, b);
    if (b.level < Math.min(cap, tpl.maxLevel)) {
      if (!park.canSupport(b, b.level + 1)) continue;
      if (!roll(sim, tpl.zone, b.id * 31)) continue;
      if (!take(b.host, extraUse(tpl, b.level, b.level + 1))) continue;
      b.construct = CONSTRUCT_TICKS; // next stage; needs a crew on site again unless one is lingering
      b.happy = 0;
    } else if (b.level >= tpl.maxLevel && b.happy >= MERGE_TICKS && dem > 0.3 && (b.id + w.tick) % 10 === 0) {
      tryMerge(sim, b, take);
    }
  }
  // Parking spaces from public lots are re-shared every 5 ticks.
  if (w.tick % 5 === 0) park.allocate(lots);
  lots.aggregate(w);
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
function tryMerge(sim: Simulation, b: Building, take: (host: number, use: { power: number; water: number }) => boolean): boolean {
  const w = sim.world, lots = w.lots;
  const tpl = TPL[b.tpl];
  const bigger = growablePool(tpl.zone, w.tier).filter((p) => p.kind === tpl.kind && (p.density > tpl.density || area(p) > area(tpl) * 1.5) && (tpl.zone !== 'residential' || desireOf(sim, b) >= DENSITY_DESIRE[p.density]));
  if (!bigger.length) return false;
  // Neighbours that may be swallowed: same zone/kind, finished, maxed (or fillers), near b.
  const replace = new Set<number>();
  for (const o of lots.buildings.values()) {
    const ot = TPL[o.tpl];
    if (Math.abs(o.x0 - b.x0) > 10 || Math.abs(o.z0 - b.z0) > 10) continue;
    if (isFiller(ot) || (ot.zone === tpl.zone && ot.kind === tpl.kind && o.construct === 0 && o.level >= ot.maxLevel && ot.density <= tpl.density && !ot.legacy)) replace.add(o.id);
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
  const use = extraUse(best.tpl, 0, 1), unit = best.tpl.zone === 'residential' ? 5 : best.tpl.zone === 'commercial' ? 4 : 8;
  const credit = freed / unit;
  if (!take(best.host, { power: Math.max(0, use.power - DEMAND[best.tpl.zone].power * credit), water: Math.max(0, use.water - DEMAND[best.tpl.zone].water * credit) })) return false;
  for (const id of gone) lots.remove(w, lots.buildings.get(id)!);
  lots.place(w, best.tpl, best.ox, best.oz, best.face, best.host, 0, CONSTRUCT_TICKS);
  lots.stats.merged++;
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
  return zoneCode(zone, zone === 'residential' ? opt.density : Math.min(1, opt.density));
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
  const need = tpl.zone === 'residential' && desireOf(sim, b) >= DESIRE_FAST ? GROW_TICKS / 2 : GROW_TICKS;
  add('Settled (happy ticks)', Math.min(b.happy, need), need, park.shortfall(b) > 0 ? 'Short of parking: growing at half speed' : 'Just wait — growth takes a few seconds');
  return rows;
}

/** Zone code info at a cell (Inspect / tooltips). */
export const cellZoneLabel = (sim: Simulation, cx: number, cz: number) => ZONE_CODES[sim.world.cells.zone[cidx(cx, cz)]].label;
export { CELL_GRID, tileOfCell, TEMPLATES };
