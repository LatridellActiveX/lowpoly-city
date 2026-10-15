/**
 * sim/demand.ts — PR 4 RCI zone demand (the classic green/blue/yellow bars).
 *
 * Each zone gets a demand value from −1 (nobody wants to build) to +1
 * (developers queueing up). It's recomputed every tick from the city's
 * numbers and multiplies the growth chance (Simulation.demandFactor):
 *
 *     growth multiplier = clamp(0.6 + demand, 0, 1.6)
 *        demand ≤ −0.6 → growth STOPS      demand 0 → ~60% speed
 *        demand  +1    → 160% speed
 *
 * THE DRIVERS
 *   RESIDENTIAL — people move in when there are JOBS for them. We compare
 *     jobs with the working population (WORK_SHARE of residents). Spare jobs
 *     push demand up, unemployment pushes it down. Average home
 *     desirability (pollution/parks) nudges it.
 *   COMMERCIAL — shops need CUSTOMERS. Each resident supports SHOP_JOBS_PER_
 *     RESIDENT shop jobs; fewer shop jobs than that = demand. Shops with empty
 *     shelves (no goods delivered, goods.ts) drag it down.
 *   INDUSTRIAL — factories need WORKERS and BUYERS. Unemployed residents and
 *     shops waiting for goods push it up; having an out-of-city connection
 *     (exports) adds a steady bonus.
 *   TAXES — every point of tax above the 9% default lowers that zone's
 *     demand by 0.04 (and every point below raises it).
 * The first homes always have some demand (a base value), so a new city can start.
 *
 * V1.5b REBALANCE (residential side)
 *   ZONED-BUT-EMPTY homes: every free residential-zoned cell is future
 *     housing (RES_PER_FREE_CELL residents each). That pending capacity is
 *     subtracted from residential demand (ZONED_WEIGHT; a buffer of
 *     max(ZONED_BUFFER, 30% of pop) is free), so painting lots of
 *     homes visibly cools the green bar until they fill.
 *   HOMES → JOBS: once residents outnumber jobs (workers / jobs > 1), the
 *     surplus raises INDUSTRIAL demand strongly (HOMES_TO_IND) and commercial
 *     a bit (HOMES_TO_COM): new households need somewhere to work.
 */
import { World } from './grid';
import { DEFAULT_TAX } from './economy';
import { JOBS_PER_LEVEL, residentsOf } from './rules';
import { jobsOf } from './industry';
import { ZoneType } from './types';
import { ZONE_CODES } from './cells';
import { CHUNK } from './chunks';

export const WORK_SHARE = 0.55;
// PR 5 retune: was 0.22, which made a 120-person town with a couple of shops
// read −1 commercial demand. 0.35 means ~1 shop level (4 jobs) per 11 people.
export const SHOP_JOBS_PER_RESIDENT = 0.35;
/** V1.5b: residents a free residential-zoned cell will eventually house (a 3×3 house ≈ 5 people). */
export const RES_PER_FREE_CELL = 0.55;
export const ZONED_WEIGHT = 0.45;
/** V1.5b: empty zoning up to max(ZONED_BUFFER, 30% of pop) is a healthy buffer and costs nothing. */
export const ZONED_BUFFER = 60;
export const HOMES_TO_IND = 0.45;
export const HOMES_TO_COM = 0.08;

export interface ZoneDemand {
  value: number;
  /** Short human explanation of the biggest factor (tooltip). */
  driver: string;
  /**
   * V1.5b: how much of `value` is only the zoned-but-empty supply penalty.
   * Existing buildings judge occupancy by value + zoned (see occupancyDemand),
   * so painting new zones doesn't make settled homes look abandoned.
   */
  zoned?: number;
}
/** V1.5b: demand as seen by EXISTING buildings (ignores the empty-zoning penalty). */
export const occupancyDemand = (d: ZoneDemand) => d.value + (d.zoned ?? 0);
/**
 * V1.5b stage G — WORKFORCE EDUCATION (Parker).
 * Residents on a tile with elementary coverage (services.ts edu ≥ 1) are
 * "educated" workers; the rest are "uneducated". Everyone keeps a baseline
 * EDU_BASELINE share of educated workers (commuters, home schooling), so a
 * school-less village still works.
 *   Commercial jobs need EDU_SHARE_COM of their staff educated (offices,
 *   stage H, need EDU_SHARE_OFFICE); industry mostly uses uneducated workers.
 *   If educated workers fall short of what shops need, commercial demand
 *   loses up to EDU_PENALTY and its tooltip says so.
 */
export const EDU_BASELINE = 0.25, EDU_SHARE_COM = 0.5, EDU_SHARE_OFFICE = 0.9, EDU_PENALTY = 0.45;
export interface Workforce { educated: number; uneducated: number; needEducated: number }
export type Demand = Record<ZoneType, ZoneDemand> & { workforce?: Workforce };

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export function computeDemand(world: World, desirabilityAvg: number, operating: (i: number) => boolean, edu?: Uint8Array): Demand {
  let officeJobs = 0;
  let covered = 0;
  let pop = 0, shopJobs = 0, factoryJobs = 0, shops = 0, emptyShops = 0;
  // V1.6 A2: only active chunks hold buildings (ascending order = same sums as before).
  world.chunks.activeTilesSorted().forEach((i) => {
    const t = world.tiles[i];
    if (!t.zone || t.level === 0 || !operating(i)) return;
    pop += residentsOf(t); // V1.5: mixed-use shops house people too
    if (edu && edu[i] >= 1) covered += residentsOf(t);
    if (t.zone === 'residential') { /* homes counted above */ }
    else if (t.zone === 'commercial' && t.kind === 4) {
      // V1.5b stage H: office jobs count half as shop jobs, half as industry jobs.
      officeJobs += t.jobs; shopJobs += t.jobs / 2; factoryJobs += t.jobs / 2;
    } else if (t.zone === 'commercial') {
      shopJobs += JOBS_PER_LEVEL.commercial * t.level;
      shops++;
      if (t.stock <= 0) emptyShops++;
    } else factoryJobs += jobsOf(world, i); // PR 5: farms 3/level, plants 8
  });
  const jobs = shopJobs + factoryJobs;
  const workers = pop * WORK_SHARE;
  const tax = (z: ZoneType) => -(world.taxRates[z] - DEFAULT_TAX) * 100 * 0.04;

  // Residential: spare jobs relative to city size.
  const spareJobs = jobs - workers;
  const rJobs = spareJobs / Math.max(30, pop * 0.3);
  const rDes = (desirabilityAvg - 1) * 0.3;
  // V1.5b: pending (zoned, unbuilt) residential capacity cools demand.
  const { zone: cz, owner } = world.cells;
  let freeCells = 0;
  // V1.6 A2: zoned cells only exist under zoned tiles, which live in active
  // chunks — count the cells of active chunks instead of all CELL_GRID².
  const CG = Math.round(Math.sqrt(cz.length)), CPT = CG / Math.round(Math.sqrt(world.tiles.length)), ch = world.chunks, span = CHUNK * CPT;
  for (const c of ch.active) {
    const cx0 = (c % ch.side) * span, cz0 = ((c / ch.side) | 0) * span;
    for (let y = cz0; y < Math.min(CG, cz0 + span); y++) for (let k = y * CG + cx0, e = y * CG + Math.min(CG, cx0 + span); k < e; k++)
      if (cz[k] && owner[k] === 0 && ZONE_CODES[cz[k]]?.zone === 'residential') freeCells++;
  }
  const pending = freeCells * RES_PER_FREE_CELL;
  const rZoned = (ZONED_WEIGHT * Math.max(0, pending - Math.max(ZONED_BUFFER, pop * 0.3))) / Math.max(150, pop + pending);
  const r = clamp(0.35 + rJobs + rDes - rZoned + tax('residential'));
  const rDriver = rZoned > 0.25 ? `${Math.round(pending)} homes' worth of zoned land is still empty` : spareJobs > 5 ? `${Math.round(spareJobs)} unfilled jobs attract new residents` : spareJobs < -5 ? `${Math.round(-spareJobs)} residents can't find work` : rDes < -0.1 ? 'Pollution makes homes unattractive' : 'Jobs and workers are balanced';

  // Commercial: customers vs shop jobs, minus empty shelves.
  const wantShop = pop * SHOP_JOBS_PER_RESIDENT;
  // PR 5: empty shelves only weigh in once the town is big enough to have
  // working supply chains (pop ≥ 300), and at most −0.3; the imbalance term
  // is divided by a gentler scale so a few extra shop jobs nudge rather than
  // slam demand to −1. Base raised 0.25 → 0.35.
  const shelves = shops && pop >= 300 ? (emptyShops / shops) * 0.3 : 0;
  // V1.5b: households without enough jobs push industry (and a little retail).
  const homesPush = Math.max(0, Math.min(1, workers / Math.max(20, jobs) - 1));
  const c = clamp(0.35 + HOMES_TO_COM * homesPush + (wantShop - shopJobs) / Math.max(40, pop * 0.3) - shelves + tax('commercial'));
  // V1.5b stage G: educated workforce vs what shops (and offices) need.
  const coveredShare = pop > 0 ? covered / pop : 0;
  const educated = workers * (EDU_BASELINE + (1 - EDU_BASELINE) * coveredShare);
  const needEducated = (shopJobs - officeJobs / 2) * EDU_SHARE_COM + officeJobs * EDU_SHARE_OFFICE;
  const eduShort = needEducated > 10 ? Math.max(0, 1 - educated / needEducated) : 0;
  const cEdu = EDU_PENALTY * eduShort;
  const cFinal = clamp(c - cEdu);
  const cDriver0 = shelves > 0.15 ? `${emptyShops} shop${emptyShops > 1 ? 's have' : ' has'} empty shelves — need goods` : wantShop > shopJobs + 2 ? 'Residents want more places to shop' : pop < 20 ? 'Not enough customers yet' : 'Shops are keeping up with customers';
  const cDriver = eduShort > 0.15 ? `Not enough educated workers (${Math.round(educated)} of ${Math.round(needEducated)} needed) — build schools` : cDriver0;

  // Industrial: idle workers + shops waiting for goods + export market.
  const idle = Math.max(0, workers - jobs);
  const exportBonus = world.edgeIndex >= 0 ? 0.15 : -0.2;
  const i = clamp(0.2 + HOMES_TO_IND * homesPush + idle / Math.max(20, pop * 0.2) + shelves * 1.3 + exportBonus - factoryJobs / Math.max(40, pop * 1.2) + tax('industrial'));
  const iDriver = idle > 5 ? `${Math.round(idle)} workers looking for factory jobs` : shelves > 0.15 ? 'Shops are waiting for goods' : world.edgeIndex < 0 ? 'No highway connection for exports' : 'Export market keeps factories busy';

  return { residential: { value: r, driver: rDriver, zoned: Math.min(rZoned, r + 1) }, commercial: { value: cFinal, driver: cDriver }, industrial: { value: i, driver: iDriver }, workforce: { educated, uneducated: Math.max(0, workers - educated), needEducated } };
}

/** Growth multiplier for a demand value (see top of file). */
export const demandGrowth = (d: number) => Math.max(0, Math.min(1.6, 0.6 + d));
