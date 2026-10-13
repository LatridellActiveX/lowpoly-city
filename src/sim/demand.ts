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
 */
import { World } from './grid';
import { DEFAULT_TAX } from './economy';
import { JOBS_PER_LEVEL, residentsOf } from './rules';
import { ZoneType } from './types';

export const WORK_SHARE = 0.55;
// PR 5 retune: was 0.22, which made a 120-person town with a couple of shops
// read −1 commercial demand. 0.35 means ~1 shop level (4 jobs) per 11 people.
export const SHOP_JOBS_PER_RESIDENT = 0.35;

export interface ZoneDemand {
  value: number;
  /** Short human explanation of the biggest factor (tooltip). */
  driver: string;
}
export type Demand = Record<ZoneType, ZoneDemand>;

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export function computeDemand(world: World, desirabilityAvg: number, operating: (i: number) => boolean): Demand {
  let pop = 0, shopJobs = 0, factoryJobs = 0, shops = 0, emptyShops = 0;
  world.tiles.forEach((t, i) => {
    if (!t.zone || t.level === 0 || !operating(i)) return;
    if (t.zone === 'residential') pop += residentsOf(t);
    else if (t.zone === 'commercial') {
      shopJobs += JOBS_PER_LEVEL.commercial * t.level;
      shops++;
      if (t.stock <= 0) emptyShops++;
    } else factoryJobs += JOBS_PER_LEVEL.industrial * t.level;
  });
  const jobs = shopJobs + factoryJobs;
  const workers = pop * WORK_SHARE;
  const tax = (z: ZoneType) => -(world.taxRates[z] - DEFAULT_TAX) * 100 * 0.04;

  // Residential: spare jobs relative to city size.
  const spareJobs = jobs - workers;
  const rJobs = spareJobs / Math.max(30, pop * 0.3);
  const rDes = (desirabilityAvg - 1) * 0.3;
  const r = clamp(0.35 + rJobs + rDes + tax('residential'));
  const rDriver = spareJobs > 5 ? `${Math.round(spareJobs)} unfilled jobs attract new residents` : spareJobs < -5 ? `${Math.round(-spareJobs)} residents can't find work` : rDes < -0.1 ? 'Pollution makes homes unattractive' : 'Jobs and workers are balanced';

  // Commercial: customers vs shop jobs, minus empty shelves.
  const wantShop = pop * SHOP_JOBS_PER_RESIDENT;
  // PR 5: empty shelves only weigh in once the town is big enough to have
  // working supply chains (pop ≥ 300), and at most −0.3; the imbalance term
  // is divided by a gentler scale so a few extra shop jobs nudge rather than
  // slam demand to −1. Base raised 0.25 → 0.35.
  const shelves = shops && pop >= 300 ? (emptyShops / shops) * 0.3 : 0;
  const c = clamp(0.35 + (wantShop - shopJobs) / Math.max(40, pop * 0.3) - shelves + tax('commercial'));
  const cDriver = shelves > 0.15 ? `${emptyShops} shop${emptyShops > 1 ? 's have' : ' has'} empty shelves — need goods` : wantShop > shopJobs + 2 ? 'Residents want more places to shop' : pop < 20 ? 'Not enough customers yet' : 'Shops are keeping up with customers';

  // Industrial: idle workers + shops waiting for goods + export market.
  const idle = Math.max(0, workers - jobs);
  const exportBonus = world.edgeIndex >= 0 ? 0.15 : -0.2;
  const i = clamp(0.2 + idle / Math.max(20, pop * 0.2) + shelves * 1.3 + exportBonus - factoryJobs / Math.max(40, pop * 1.2) + tax('industrial'));
  const iDriver = idle > 5 ? `${Math.round(idle)} workers looking for factory jobs` : shelves > 0.15 ? 'Shops are waiting for goods' : world.edgeIndex < 0 ? 'No highway connection for exports' : 'Export market keeps factories busy';

  return { residential: { value: r, driver: rDriver }, commercial: { value: c, driver: cDriver }, industrial: { value: i, driver: iDriver } };
}

/** Growth multiplier for a demand value (see top of file). */
export const demandGrowth = (d: number) => Math.max(0, Math.min(1.6, 0.6 + d));
