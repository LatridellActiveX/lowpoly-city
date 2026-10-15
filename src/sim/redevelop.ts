/**
 * sim/redevelop.ts — V1.5 stage 12: HEALTH-BASED REDEVELOPMENT.
 *
 * Plain TypeScript (no Three.js / DOM). Runs once per game month, right
 * after the books close (simulation.ts bookMonth → profits → here).
 *
 * BUILDING HEALTH (0 … 1)
 * -----------------------
 *   health = TYPE_WEIGHT × type score + (1 − TYPE_WEIGHT) × site score
 *
 *   type score, by zone:
 *     commercial  — customers: last month's profit margin (economy.ts Profit)
 *                   and whether the shelves have stock
 *     industrial  — inputs (a processor's hopper isn't starved), buyers
 *                   (output isn't piling up unsold), workers (city residents
 *                   per job) and the profit margin
 *     residential — occupancy (residential demand isn't collapsing) and
 *                   happiness (desirability)
 *   site score, every zone (average of):
 *     land value (env.landValue / LV_GOOD), cleanliness (1 − pollution / 4)
 *     and access = road+power+water × parking/traffic (shortfall, drivers
 *     giving up because there's nowhere to park)
 *
 * TRIGGER
 * -------
 *   health < REDEV_HEALTH for REDEV_MONTHS months in a row, OR
 *   the zone's demand is strongly negative (< REDEV_DEMAND) and the
 *   building is only middling (health < 0.6).
 *
 * REBUILD
 * -------
 * The worst candidates first, while fewer than REDEV_MAX redevelopment
 * sites are under construction. The old building is demolished and a
 * DIFFERENT template of the same zone (same industrial kind) that fits the
 * zoned cells becomes a construction site in its place — so crews from the
 * Construction Yards come and build it (industry.ts). Demand picks the size:
 * positive demand favours a bigger capacity, negative a smaller one.
 *
 *   SHOP → GARAGE: an ailing shop in a district that's short of parking
 *   (parking.ts localBalance demand > GARAGE_SWAP × supply) is replaced by
 *   a grown multi-storey garage when its whole tile is then free.
 *   GARAGE → SHOP: a grown garage that has been mostly empty (< GARAGE_IDLE
 *   occupancy) for REDEV_MONTHS months while shops are in demand is torn
 *   down; its commercial cells are free again and a shop grows there.
 */
import type { Simulation } from './simulation';
import { Building, growablePool, scoreOption } from './lots';
import { TPL, Template } from './footprints';
import { FACTORY_MAX } from './goods';
import { RECIPES, roleOf } from './chains';
import { CONSTRUCT_TICKS } from './rules';
import { GRID_SIZE } from './types';
import { occupancyDemand } from './demand';
import { healthWithSafety } from './safety';
import { cidx, CELL_GRID, ZoneCode, ZONE_CODES } from './cells';
import { mediumUnlocked } from './progression';

export const REDEV_HEALTH = 0.3;
export const REDEV_MONTHS = 3;
/** V1.5b stage B: industry redevelops ~1.5× more often (2 struggling months instead of 3). */
export const IND_REDEV_MONTHS = 2;
export const REDEV_MAX = 3;
export const REDEV_DEMAND = -0.6;
export const TYPE_WEIGHT = 0.55;
/** Land value that counts as "fully good" for health. */
export const LV_GOOD = 1.2;
export const GARAGE_SWAP = 1.3;
export const GARAGE_IDLE = 0.2;

/**
 * V1.5b DEMAND-DRIVEN DENSIFICATION (Parker)
 * ------------------------------------------
 * When residential demand stays above DENSIFY_DEMAND (0.5) for
 * DENSIFY_MONTHS months in a row, healthy finished homes are rebuilt one
 * density step up (low → medium → high) REGARDLESS of the painted zoning,
 * and the zone cells under / around them are upgraded to match (so the new
 * building is allowed and the Inspect zone label tells the truth).
 *   - frequency scales with demand: per month up to
 *       1 + floor((demand − 0.5) × DENSIFY_SCALE)  lots (cap DENSIFY_MAX)
 *   - unlocks are respected: medium only once mediumUnlocked (1,000 people
 *     or tier 2), high only when a density-2 template is growable (tier).
 *   - the rebuild is a normal construction site → Construction Yard crews.
 *   - an event notifies the player; Inspect shows "densified low → medium".
 */
export const DENSIFY_DEMAND = 0.5;
export const DENSIFY_MONTHS = 2;
export const DENSIFY_SCALE = 6;
export const DENSIFY_MAX = 4;
const DNAME = ['low', 'medium', 'high'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const capOf = (t: Template) => t.capacity[t.capacity.length - 1] ?? 0;

export class Redevelopment {
  /** V1.5b: months in a row with residential demand > DENSIFY_DEMAND. */
  hotMonths = 0;
  stats = { densified: 0, checked: 0, rebuilt: 0, shopToGarage: 0, garageToShop: 0, low: 0 };
  /** Grown-garage idle streaks (lot id → months). */
  private idle = new Map<number, number>();

  /** Health of one finished building right now (see header). */
  health(sim: Simulation, b: Building, workerRatio: number): number {
    const w = sim.world, tpl = TPL[b.tpl], t = w.tiles[b.host], env = sim.env;
    const st = sim.status(b.host);
    const pf = w.profits.get(b.host);
    const margin = pf ? clamp01(0.5 + pf.net / Math.max(60, pf.sales)) : 0.6;
    let type: number;
    if (tpl.zone === 'commercial') {
      type = (margin + (t.stock > 0 ? 1 : 0.4)) / 2;
    } else if (tpl.zone === 'industrial') {
      const rec = RECIPES[roleOf(w, b.host)];
      const inputs = !rec || t.input > 0.5 || t.stock > 0.5 ? 1 : 0.2;
      const buyers = t.stock >= FACTORY_MAX - 1 ? 0.3 : 1;
      type = (inputs + buyers + clamp01(workerRatio) + margin) / 4;
    } else {
      const occupancy = occupancyDemand(sim.demand.residential) > -0.5 ? 1 : 0.5;
      type = (occupancy + clamp01(env.desirability[b.host] / 1.2)) / 2;
    }
    const lv = clamp01(env.landValue[b.host] / LV_GOOD);
    // V1.5b: uncollected garbage counts against cleanliness too.
    const clean = clamp01(1 - env.pollution[b.host] / 4 - (t.garbage / 90) * (w.peakPop < 1000 ? 0.3 : 1)); // mild before the dump unlocks
    const frustrated = b.arrivals > 3 && b.gaveUp / b.arrivals > 0.5;
    const park = frustrated ? 0.4 : w.parking.shortfall(b) > 0 ? 0.7 : 1;
    const access = (st.roadAccess && st.powered && st.watered ? 1 : 0.3) * park;
    const h = clamp01(TYPE_WEIGHT * type + (1 - TYPE_WEIGHT) * (lv + clean + access) / 3);
    // V1.5b stage F: crime hurts, clinic/hospital coverage helps (safety.ts).
    const sf = sim.safety;
    return sf && sf.crime.length ? healthWithSafety(h, sf.crime[b.host], sf.care[b.host]) : h;
  }

  /** The monthly pass: update health, pick candidates, rebuild a few. */
  month(sim: Simulation): void {
    const w = sim.world, lots = w.lots;
    let res = 0, jobs = 0;
    w.chunks.activeTilesSorted().forEach((i) => { const t = w.tiles[i]; res += t.res; jobs += t.jobs; }); // V1.6 A2
    const workerRatio = jobs > 0 ? res / (jobs * 1.2) : 1; // ~1.2 residents per job keeps every shift staffed
    const cands: Building[] = [];
    this.stats.low = 0;
    for (const b of lots.buildings.values()) {
      const tpl = TPL[b.tpl];
      if (b.redev && b.construct === 0 && b.level > 0) b.redev = false; // rebuild finished
      if (b.level === 0 || b.construct > 0 || tpl.capacity[0] === 0) continue; // sites and fillers
      const h = this.health(sim, b, workerRatio);
      b.health = h;
      b.lowMonths = h < REDEV_HEALTH ? (b.lowMonths ?? 0) + 1 : 0;
      if (h < REDEV_HEALTH) this.stats.low++;
      this.stats.checked++;
      if ((b.lowMonths ?? 0) >= (tpl.zone === 'industrial' ? IND_REDEV_MONTHS : REDEV_MONTHS) || (occupancyDemand(sim.demand[tpl.zone]) < REDEV_DEMAND && h < 0.6)) cands.push(b);
    }
    let active = 0;
    for (const b of lots.buildings.values()) if (b.redev && b.construct > 0) active++;
    cands.sort((p, q) => (p.health ?? 1) - (q.health ?? 1));
    for (const b of cands) {
      if (active >= REDEV_MAX) break;
      if (this.rebuild(sim, b)) active++;
    }
    // V1.5b: sustained high residential demand → densify a few lots.
    const rd = sim.demand.residential.value;
    this.hotMonths = rd > DENSIFY_DEMAND ? this.hotMonths + 1 : 0;
    if (this.hotMonths >= DENSIFY_MONTHS) {
      const n = Math.min(DENSIFY_MAX, 1 + Math.floor((rd - DENSIFY_DEMAND) * DENSIFY_SCALE));
      let done = 0;
      // Oldest, healthiest, lowest-density homes first (deterministic order).
      const homes = [...lots.buildings.values()]
        .filter((b) => { const t = TPL[b.tpl]; return t.zone === 'residential' && b.level > 0 && b.construct === 0 && !b.redev && t.capacity[0] > 0 && (b.health ?? 1) >= 0.4; })
        .sort((p, q) => TPL[p.tpl].density - TPL[q.tpl].density || q.level - p.level || p.id - q.id);
      for (const b of homes) {
        if (done >= n) break;
        if (this.densify(sim, b)) done++;
      }
    }
    // GARAGE → SHOP: idle grown garages make way for shops when shops are wanted.
    for (const l of [...w.parking.lots.values()]) {
      if (!l.grown) continue;
      const streak = l.parked / Math.max(1, l.spaces) < GARAGE_IDLE ? (this.idle.get(l.id) ?? 0) + 1 : 0;
      this.idle.set(l.id, streak);
      if (streak >= REDEV_MONTHS && sim.demand.commercial.value > 0 && active < REDEV_MAX) {
        w.parking.removeLot(w, l);
        this.idle.delete(l.id);
        const tx = Math.floor(l.cx / 4), tz = Math.floor(l.cz / 4);
        lots.markDirty(tz * GRID_SIZE + tx); lots.markAround(tx, tz);
        w.parking.allocate(lots);
        this.stats.garageToShop++;
        active++;
        sim.events.push('🏗 Redevelopment: an almost-empty parking garage is coming down — shops are in demand, so a shop will grow on its lot.');
      }
    }
  }

  /**
   * V1.5b: rebuild one home a density step up (see DENSIFY header). Upgrades
   * the residential zone cells on the building's host tile and its 8
   * neighbours that are free or owned by `b` (never someone else's lot),
   * then places a denser template at the host. Reverts the cells if nothing
   * denser fits. Returns true when a construction site was started.
   */
  densify(sim: Simulation, b: Building): boolean {
    const w = sim.world, lots = w.lots, tpl = TPL[b.tpl];
    const to = tpl.density + 1;
    if (to > 2 || !mediumUnlocked(w)) return false;
    const pool = growablePool('residential', w).filter((p) => p.density === to && p.kind === 0 && p.capacity[0] > 0 && !p.legacy);
    if (!pool.length) return false; // high density not unlocked yet (tier)
    const code = (ZoneCode.ResLow + to) as number;
    const hx = b.host % GRID_SIZE, hz = Math.floor(b.host / GRID_SIZE);
    const changed: Array<[number, number]> = [];
    for (let cz = (hz - 1) * 4; cz < (hz + 2) * 4; cz++) for (let cx = (hx - 1) * 4; cx < (hx + 2) * 4; cx++) {
      if (cx < 0 || cz < 0 || cx >= CELL_GRID || cz >= CELL_GRID) continue;
      const c = cidx(cx, cz), z = w.cells.zone[c], info = ZONE_CODES[z];
      const own = w.cells.owner[c];
      if (info?.zone !== 'residential' || info.density >= to || (own !== 0 && own !== b.id)) continue;
      changed.push([c, z]);
      w.cells.zone[c] = code;
    }
    const opts = lots.options(w, b.host, pool, new Set([b.id])).filter((o) => o.host === b.host);
    if (!opts.length) { for (const [c, z] of changed) w.cells.zone[c] = z; return false; }
    opts.sort((p, q) => scoreOption(q, w.tick, w.seed, w) - scoreOption(p, w.tick, w.seed, w));
    const best = opts[0];
    lots.remove(w, b);
    const nb = lots.place(w, best.tpl, best.ox, best.oz, best.face, best.host, 0, CONSTRUCT_TICKS);
    nb.redev = true;
    nb.densified = `${DNAME[tpl.density]} → ${DNAME[to]}`;
    lots.markDirty(b.host); lots.markAround(hx, hz);
    this.stats.densified++;
    sim.events.push(`🏙 Densifying: housing demand is high, so a ${tpl.label.toLowerCase()} is being rebuilt as a ${best.tpl.label.toLowerCase()} — zoning upgraded ${nb.densified} density.`);
    return true;
  }

  /** Demolish b and start a different same-zone building (or a garage) in its place. */
  rebuild(sim: Simulation, b: Building): boolean {
    const w = sim.world, lots = w.lots, tpl = TPL[b.tpl];
    const hx = b.host % GRID_SIZE, hz = Math.floor(b.host / GRID_SIZE);
    // SHOP → GARAGE when the district is short of parking.
    if (tpl.zone === 'commercial' && !tpl.residents) {
      const c = [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];
      const { demand, supply } = w.parking.localBalance(lots, c);
      if (demand > GARAGE_SWAP * Math.max(1, supply)) {
        // Only if the whole host tile would be free: no other building on it.
        const others = lots.onTile(w, hx, hz).filter((o) => o.id !== b.id && TPL[o.tpl].capacity[0] > 0);
        if (!others.length) {
          lots.remove(w, b);
          for (const o of lots.onTile(w, hx, hz)) lots.remove(w, o); // fillers
          if (sim.garageTileFree(hx, hz)) {
            w.parking.addLot(w, hx * 4, hz * 4, 4, true, 3, true);
            w.parking.allocate(lots);
            this.stats.shopToGarage++;
            sim.events.push(`🏗 Redevelopment: a struggling ${tpl.label.toLowerCase()} is being replaced by a parking garage — the shops around it are short of parking.`);
            return true;
          }
          return true; // demolished; the lot regrows normally
        }
      }
    }
    // Same-zone (same industrial kind), different template; size by demand.
    const dem = occupancyDemand(sim.demand[tpl.zone]);
    const pool = growablePool(tpl.zone, w).filter((p) => p.id !== tpl.id && p.kind === tpl.kind && !p.legacy && p.capacity[0] > 0 && !!p.residents === !!tpl.residents);
    const opts = lots.options(w, b.host, pool, new Set([b.id])).filter((o) => o.host === b.host);
    if (!opts.length) return false;
    const fit = (t: Template) => (dem >= 0 ? capOf(t) / capOf(tpl) : capOf(tpl) / Math.max(1, capOf(t)));
    opts.sort((p, q) => scoreOption(q, w.tick, w.seed, w) * fit(q.tpl) - scoreOption(p, w.tick, w.seed, w) * fit(p.tpl));
    const best = opts[0];
    lots.remove(w, b);
    const nb = lots.place(w, best.tpl, best.ox, best.oz, best.face, best.host, 0, CONSTRUCT_TICKS);
    nb.redev = true;
    this.stats.rebuilt++;
    sim.events.push(`🏗 Redevelopment: a struggling ${tpl.label.toLowerCase()} is being rebuilt as a ${best.tpl.label.toLowerCase()} (health ${Math.round((b.health ?? 0) * 100)}%).`);
    return true;
  }
}
