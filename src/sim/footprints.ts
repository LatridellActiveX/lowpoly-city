/**
 * sim/footprints.ts — PR 6 FOOTPRINT TEMPLATES: every building design's size
 * in cells, which side faces the road, and the parking it brings with it.
 *
 * LOCAL TEMPLATE FRAME
 * --------------------
 * A template is drawn in its own (u, v) cell frame:
 *      u = 0 .. w−1  ALONG the road (left → right as you look from the road)
 *      v = 0 .. d−1  AWAY from the road; v = 0 is the row touching the kerb
 *
 *        road ════════════════════
 *        v=0  [P][P][P]           ← 3 front parking spaces
 *        v=1  [B][B][B]
 *        v=2  [B][B][B]           ← building body
 *        v=3  [B][B][B]
 *             u=0 1  2            (the "corner shop" below)
 *
 * lots.ts rotates this frame onto the map so v points away from whichever
 * road the lot faces (cells.ts FACES), then checks that every cell is free
 * and zoned. The renderer uses the SAME rects to place the model (on the
 * body rect), asphalt + painted stalls (parking rects) and gardens.
 *
 * PARKING NUMBERS
 * ---------------
 * `required(level)` follows the approved plan:
 *   homes:     low density 1 space / home, medium 0.7, high 0.5
 *   shops:     1 space per 3 jobs
 *   factories: 1 space per 4 jobs (+ truck bays, which the templates carry)
 * `supply` = surface parking cells (1 space each) + garage spaces. Some
 * small shops are DELIBERATELY one space short at their top level, so a
 * public lot nearby (parking.ts) is what lets them grow — that's the
 * "parking as a real requirement" loop.
 */
import { CellRole } from './cells';
import { ZoneType } from './types';

/** One rectangle of a template, in local (u, v) cells. */
export interface TplRect {
  u: number;
  v: number;
  w: number;
  d: number;
  role: CellRole;
}

export interface Template {
  id: string;
  label: string;
  zone: ZoneType;
  /** Industrial kind (0 factory, 1 farm, 2 food plant); 0 for R/C. */
  kind: number;
  /** Density rank 0/1/2 (see cells.ts ZONE_CODES). Cells must allow at least this. */
  density: number;
  /** Lowest population tier (progression.ts) at which this design can be built. */
  tier: number;
  /** Width along the road and depth away from it, in cells. */
  w: number;
  d: number;
  rects: TplRect[];
  /** Spaces inside the building (underground / integrated garage). Not drawn as stalls. */
  garage: number;
  /** Truck loading bays (factories). */
  bays: number;
  /** Highest level of this design (1-based). */
  maxLevel: number;
  /** Residents (homes) or jobs (shops/factories) at each level; index = level − 1. */
  capacity: number[];
  /**
   * V1.5 MIXED USE: residents living above a commercial building, per level
   * (capacity[] then holds its JOBS). Undefined for every other template.
   */
  residents?: number[];
  /** Households per level (homes AND mixed-use flats), for the parking requirement. */
  homes?: number[];
  /**
   * Renderer hints: which zone model level to draw, and extra height for
   * towers. V1.5 `grow`: per-level height multiplier, so a medium building's
   * extra levels (residential levels 6 and 7) are drawn taller.
   */
  model: { level: number[]; tall?: number; grow?: number[] };
  /** Relative chance of being picked when several templates fit. */
  weight: number;
  /** Only created by save migration (old 1-tile buildings), never grown. */
  legacy?: boolean;
}

const R = (u: number, v: number, w: number, d: number, role: CellRole): TplRect => ({ u, v, w, d, role });
const B = CellRole.Body, P = CellRole.Parking, G = CellRole.Garage, Gd = CellRole.Garden, Bay = CellRole.Bay;

export const TEMPLATES: Template[] = [
  // ---------------- Residential · low (houses) ----------------
  // "small house 2×3 + 1×2 driveway" (plus a 1-cell garden behind the drive).
  { id: 'house_s', label: 'Small house', zone: 'residential', kind: 0, density: 0, tier: 0, w: 3, d: 3,
    rects: [R(0, 0, 2, 3, B), R(2, 0, 1, 2, P), R(2, 2, 1, 1, Gd)], garage: 0, bays: 0,
    maxLevel: 3, capacity: [5, 10, 20], homes: [1, 1, 2], model: { level: [1, 2, 3] }, weight: 3 },
  // Wider house with a driveway and a single garage at the end of it.
  { id: 'house_w', label: 'Family house + garage', zone: 'residential', kind: 0, density: 0, tier: 0, w: 4, d: 3,
    rects: [R(0, 0, 3, 3, B), R(3, 0, 1, 2, P), R(3, 2, 1, 1, G)], garage: 1, bays: 0,
    maxLevel: 3, capacity: [5, 10, 20], homes: [1, 2, 2], model: { level: [1, 2, 3] }, weight: 2 },
  // Narrow deep house: drive down the side, shed at the back.
  { id: 'house_d', label: 'Deep-lot house', zone: 'residential', kind: 0, density: 0, tier: 0, w: 3, d: 4,
    rects: [R(1, 0, 2, 4, B), R(0, 0, 1, 3, P), R(0, 3, 1, 1, Gd)], garage: 0, bays: 0,
    maxLevel: 3, capacity: [5, 10, 20], homes: [1, 1, 2], model: { level: [1, 2, 3] }, weight: 1.5 },
  // PR 6 variety pass: 5 more low-density footprints (8 total).
  { id: 'cottage', label: 'Cottage', zone: 'residential', kind: 0, density: 0, tier: 0, w: 2, d: 3,
    rects: [R(0, 0, 1, 1, P), R(1, 0, 1, 1, Gd), R(0, 1, 2, 2, B)], garage: 0, bays: 0,
    maxLevel: 3, capacity: [5, 10, 15], homes: [1, 1, 1], model: { level: [1, 1, 2] }, weight: 1.2 },
  { id: 'house_p', label: 'Porch house', zone: 'residential', kind: 0, density: 0, tier: 0, w: 3, d: 4,
    rects: [R(0, 0, 2, 1, Gd), R(0, 1, 2, 3, B), R(2, 0, 1, 2, P), R(2, 2, 1, 2, Gd)], garage: 0, bays: 0,
    maxLevel: 3, capacity: [5, 10, 20], homes: [1, 1, 2], model: { level: [1, 2, 3] }, weight: 1.5 },
  { id: 'house_g', label: 'House + detached garage', zone: 'residential', kind: 0, density: 0, tier: 0, w: 4, d: 4,
    rects: [R(0, 0, 3, 3, B), R(0, 3, 3, 1, Gd), R(3, 0, 1, 3, P), R(3, 3, 1, 1, G)], garage: 1, bays: 0,
    maxLevel: 3, capacity: [5, 10, 20], homes: [1, 2, 2], model: { level: [1, 2, 3] }, weight: 1.5 },
  { id: 'bungalow', label: 'Bungalow', zone: 'residential', kind: 0, density: 0, tier: 0, w: 4, d: 3,
    rects: [R(1, 0, 3, 2, B), R(1, 2, 3, 1, Gd), R(0, 0, 1, 3, P)], garage: 0, bays: 0,
    maxLevel: 3, capacity: [5, 10, 15], homes: [1, 1, 2], model: { level: [1, 1, 2] }, weight: 1.2 },
  { id: 'villa', label: 'Villa with pool', zone: 'residential', kind: 0, density: 0, tier: 0, w: 5, d: 4,
    rects: [R(0, 0, 3, 3, B), R(0, 3, 3, 1, Gd), R(3, 0, 1, 2, P), R(4, 0, 1, 2, G), R(3, 2, 2, 2, Gd)], garage: 1, bays: 0,
    maxLevel: 3, capacity: [5, 10, 20], homes: [1, 1, 2], model: { level: [2, 2, 3] }, weight: 0.8 },
  // ---------------- Residential · medium ----------------
  // "townhouse row 6×3 + rear garages".
  { id: 'townhouse', label: 'Townhouse row', zone: 'residential', kind: 0, density: 1, tier: 2, w: 6, d: 4,
    rects: [R(0, 0, 6, 3, B), R(0, 3, 6, 1, G)], garage: 6, bays: 0,
    maxLevel: 4, capacity: [40, 55, 80, 120], homes: [6, 8, 12, 18], model: { level: [4, 4, 7, 7], grow: [1, 1, 1, 1.2] }, weight: 2 },
  { id: 'apartment_d', label: 'Small apartment block', zone: 'residential', kind: 0, density: 1, tier: 2, w: 4, d: 6,
    rects: [R(0, 0, 4, 4, B), R(0, 4, 4, 2, P)], garage: 12, bays: 0,
    maxLevel: 4, capacity: [40, 65, 100, 145], homes: [16, 26, 39, 57], model: { level: [4, 5, 7, 7], grow: [1, 1, 1, 1.2] }, weight: 1.5 },
  // "apartments 6×6 with integrated garage" (+ a rear surface lot).
  { id: 'apartment', label: 'Apartment block', zone: 'residential', kind: 0, density: 1, tier: 3, w: 6, d: 6,
    rects: [R(0, 0, 6, 4, B), R(0, 4, 6, 2, P)], garage: 20, bays: 0,
    maxLevel: 4, capacity: [70, 110, 165, 240], homes: [28, 44, 66, 97], model: { level: [5, 5, 7, 7], grow: [1, 1, 1, 1.2] }, weight: 2 },
  // PR 6 variety pass: 5 more medium footprints (8 total).
  { id: 'townhouse_s', label: 'Short townhouse row', zone: 'residential', kind: 0, density: 1, tier: 2, w: 4, d: 4,
    rects: [R(0, 0, 4, 3, B), R(0, 3, 4, 1, G)], garage: 4, bays: 0,
    maxLevel: 4, capacity: [25, 35, 50, 75], homes: [4, 5, 8, 11], model: { level: [4, 4, 7, 7], grow: [1, 1, 1, 1.2] }, weight: 1.5 },
  { id: 'duplex_row', label: 'Duplex row', zone: 'residential', kind: 0, density: 1, tier: 2, w: 6, d: 4,
    rects: [R(0, 0, 6, 1, Gd), R(0, 1, 6, 2, B), R(0, 3, 6, 1, P)], garage: 0, bays: 0,
    maxLevel: 4, capacity: [30, 45, 70, 100], homes: [6, 8, 12, 18], model: { level: [4, 4, 7, 7], grow: [1, 1, 1, 1.2] }, weight: 1.2 },
  { id: 'walkup', label: 'Walk-up flats', zone: 'residential', kind: 0, density: 1, tier: 2, w: 4, d: 5,
    rects: [R(0, 0, 4, 4, B), R(0, 4, 4, 1, P)], garage: 10, bays: 0,
    maxLevel: 4, capacity: [35, 55, 80, 120], homes: [14, 20, 30, 44], model: { level: [5, 5, 7, 7], grow: [1, 1, 1, 1.2] }, weight: 1.2 },
  { id: 'courtyard', label: 'Courtyard block', zone: 'residential', kind: 0, density: 1, tier: 3, w: 8, d: 6,
    rects: [R(0, 0, 8, 2, B), R(0, 2, 2, 3, B), R(6, 2, 2, 3, B), R(2, 2, 4, 3, Gd), R(0, 5, 8, 1, P)], garage: 32, bays: 0,
    maxLevel: 4, capacity: [90, 140, 210, 310], homes: [36, 56, 84, 123], model: { level: [5, 5, 7, 7], grow: [1, 1, 1, 1.2] }, weight: 1 },
  { id: 'mansard', label: 'Mansard apartments', zone: 'residential', kind: 0, density: 1, tier: 3, w: 6, d: 5,
    rects: [R(0, 0, 6, 4, B), R(0, 4, 6, 1, G)], garage: 26, bays: 0,
    maxLevel: 4, capacity: [60, 90, 135, 200], homes: [24, 36, 54, 79], model: { level: [5, 5, 7, 7], grow: [1, 1, 1, 1.2] }, weight: 1.2 },
  // ---------------- Residential · high (towers, City tier) ----------------
  { id: 'tower', label: 'Residential tower', zone: 'residential', kind: 0, density: 2, tier: 3, w: 6, d: 6,
    rects: [R(0, 0, 6, 5, B), R(0, 5, 6, 1, G)], garage: 64, bays: 0,
    maxLevel: 2, capacity: [200, 320], homes: [80, 128], model: { level: [5, 5], tall: 2.6 }, weight: 2 },
  { id: 'tower_l', label: 'Twin tower', zone: 'residential', kind: 0, density: 2, tier: 3, w: 8, d: 6,
    rects: [R(0, 0, 8, 5, B), R(0, 5, 8, 1, G)], garage: 90, bays: 0,
    maxLevel: 2, capacity: [300, 450], homes: [120, 180], model: { level: [5, 5], tall: 3.4 }, weight: 1 },
  // PR 6 variety pass: 6 more high-density footprints (8 total). Model level
  // 6 = stepped / set-back tower designs (buildings.ts tower()).
  { id: 'tower_s', label: 'Point tower', zone: 'residential', kind: 0, density: 2, tier: 3, w: 4, d: 4,
    rects: [R(0, 0, 4, 4, B)], garage: 40, bays: 0,
    maxLevel: 2, capacity: [120, 200], homes: [50, 80], model: { level: [6, 6], tall: 2.2 }, weight: 1.5 },
  { id: 'tower_slim', label: 'Slim tower', zone: 'residential', kind: 0, density: 2, tier: 3, w: 4, d: 6,
    rects: [R(0, 0, 4, 5, B), R(0, 5, 4, 1, G)], garage: 50, bays: 0,
    maxLevel: 2, capacity: [150, 240], homes: [60, 100], model: { level: [6, 6], tall: 3 }, weight: 1.2 },
  { id: 'setback', label: 'Set-back tower', zone: 'residential', kind: 0, density: 2, tier: 3, w: 6, d: 8,
    rects: [R(0, 0, 6, 1, Gd), R(0, 1, 6, 6, B), R(0, 7, 6, 1, G)], garage: 80, bays: 0,
    maxLevel: 2, capacity: [260, 400], homes: [100, 160], model: { level: [6, 6], tall: 3.2 }, weight: 1.2 },
  { id: 'podium', label: 'Podium tower', zone: 'residential', kind: 0, density: 2, tier: 3, w: 8, d: 8,
    rects: [R(0, 0, 8, 1, P), R(0, 1, 8, 7, B)], garage: 120, bays: 0,
    maxLevel: 2, capacity: [380, 560], homes: [150, 240], model: { level: [6, 6], tall: 3.6 }, weight: 1 },
  { id: 'slab', label: 'Slab block', zone: 'residential', kind: 0, density: 2, tier: 3, w: 8, d: 4,
    rects: [R(0, 0, 8, 4, B)], garage: 70, bays: 0,
    maxLevel: 2, capacity: [180, 280], homes: [80, 120], model: { level: [5, 5], tall: 2 }, weight: 1 },
  { id: 'twin_slim', label: 'Twin slim towers', zone: 'residential', kind: 0, density: 2, tier: 3, w: 6, d: 6,
    rects: [R(0, 0, 2, 6, B), R(2, 0, 2, 6, Gd), R(4, 0, 2, 6, B)], garage: 60, bays: 0,
    maxLevel: 2, capacity: [160, 240], homes: [70, 110], model: { level: [6, 6], tall: 3 }, weight: 0.8 },
  // ---------------- Commercial · low ----------------
  // "corner shop 3×3 + 3 front spaces" — one space short at level 3 on purpose.
  { id: 'corner_shop', label: 'Corner shop', zone: 'commercial', kind: 0, density: 0, tier: 0, w: 3, d: 4,
    rects: [R(0, 0, 3, 1, P), R(0, 1, 3, 3, B)], garage: 0, bays: 0,
    maxLevel: 3, capacity: [4, 8, 12], model: { level: [1, 2, 3] }, weight: 3 },
  { id: 'shop_w', label: 'Shop with front lot', zone: 'commercial', kind: 0, density: 0, tier: 0, w: 4, d: 4,
    rects: [R(0, 0, 4, 1, P), R(0, 1, 4, 3, B)], garage: 0, bays: 0,
    maxLevel: 3, capacity: [5, 10, 14], model: { level: [1, 2, 3] }, weight: 2 },
  // ---------------- Commercial · high ----------------
  // "strip mall 8×4 + front lot".
  { id: 'strip_mall', label: 'Strip mall', zone: 'commercial', kind: 0, density: 1, tier: 1, w: 8, d: 6,
    rects: [R(0, 0, 8, 2, P), R(0, 2, 8, 4, B)], garage: 0, bays: 0,
    maxLevel: 3, capacity: [24, 36, 48], model: { level: [1, 2, 2] }, weight: 2 },
  { id: 'mall', label: 'Shopping centre', zone: 'commercial', kind: 0, density: 1, tier: 2, w: 8, d: 8,
    rects: [R(0, 0, 8, 2, P), R(0, 2, 8, 6, B)], garage: 16, bays: 0,
    maxLevel: 2, capacity: [60, 90], model: { level: [3, 3] }, weight: 1 },
  // ---------------- Industrial ----------------
  { id: 'workshop', label: 'Workshop', zone: 'industrial', kind: 0, density: 0, tier: 0, w: 4, d: 4,
    rects: [R(0, 0, 3, 1, P), R(3, 0, 1, 1, Bay), R(0, 1, 4, 3, B)], garage: 0, bays: 1,
    maxLevel: 3, capacity: [8, 12, 16], model: { level: [1, 2, 3] }, weight: 2 },
  // "factory 6×6 + loading yard".
  { id: 'factory', label: 'Factory', zone: 'industrial', kind: 0, density: 1, tier: 0, w: 6, d: 8,
    rects: [R(0, 0, 4, 2, P), R(4, 0, 2, 2, Bay), R(0, 2, 6, 6, B)], garage: 6, bays: 2,
    // V1.5b stage B: factories now reach LEVEL 5 (more workers and output).
    maxLevel: 5, capacity: [16, 24, 32, 42, 54], model: { level: [2, 3, 3, 4, 5] }, weight: 2 },
  // Farm: barn + silo with a small yard; FIELDS are claimed separately (industry.ts).
  { id: 'farm', label: 'Farm', zone: 'industrial', kind: 1, density: 0, tier: 0, w: 3, d: 3,
    rects: [R(0, 0, 3, 1, P), R(0, 1, 3, 2, B)], garage: 0, bays: 0,
    maxLevel: 3, capacity: [3, 6, 9], model: { level: [1, 2, 3] }, weight: 1 },
  { id: 'food_plant', label: 'Food processing plant', zone: 'industrial', kind: 2, density: 0, tier: 0, w: 6, d: 6,
    rects: [R(0, 0, 4, 2, P), R(4, 0, 2, 2, Bay), R(0, 2, 6, 4, B)], garage: 0, bays: 2,
    maxLevel: 3, capacity: [8, 16, 24], model: { level: [1, 2, 3] }, weight: 1 },
  // ---------------- Leftover fillers (odd gaps) ----------------
  // Not "buildings": no residents/jobs, no power or water. lots.ts drops one
  // into a 1–2 cell gap along the kerb so blocks look naturally packed.
  { id: 'garden', label: 'Garden', zone: 'residential', kind: 0, density: 0, tier: 0, w: 1, d: 2,
    rects: [R(0, 0, 1, 2, Gd)], garage: 0, bays: 0, maxLevel: 1, capacity: [0], model: { level: [0] }, weight: 0 },
  { id: 'overflow', label: 'Overflow parking', zone: 'commercial', kind: 0, density: 0, tier: 0, w: 2, d: 2,
    rects: [R(0, 0, 2, 2, P)], garage: 0, bays: 0, maxLevel: 1, capacity: [0], model: { level: [0] }, weight: 0 },
  // ---------------- Migrated PR 5 buildings (save v5 → v6) ----------------
  // An old 1-tile building becomes a whole-tile 4×4 lot: body on 3 columns,
  // driveway/lot on the 4th, plus a garage allowance so its parking matches
  // what it needs at every PR 5 level (no instant shortfall after loading).
  { id: 'legacy_res', label: 'Home (pre-PR 6 lot)', zone: 'residential', kind: 0, density: 0, tier: 0, w: 4, d: 4, legacy: true,
    rects: [R(0, 0, 3, 4, B), R(3, 0, 1, 4, P)], garage: 24, bays: 0,
    maxLevel: 5, capacity: [5, 10, 20, 40, 70], homes: [1, 1, 2, 6, 28], model: { level: [1, 2, 3, 4, 5] }, weight: 0 },
  { id: 'legacy_com', label: 'Shop (pre-PR 6 lot)', zone: 'commercial', kind: 0, density: 0, tier: 0, w: 4, d: 4, legacy: true,
    rects: [R(0, 0, 4, 1, P), R(0, 1, 4, 3, B)], garage: 0, bays: 0,
    maxLevel: 3, capacity: [4, 8, 12], model: { level: [1, 2, 3] }, weight: 0 },
  { id: 'legacy_ind', label: 'Factory (pre-PR 6 lot)', zone: 'industrial', kind: 0, density: 0, tier: 0, w: 4, d: 4, legacy: true,
    rects: [R(0, 0, 3, 1, P), R(3, 0, 1, 1, Bay), R(0, 1, 4, 3, B)], garage: 3, bays: 1,
    maxLevel: 3, capacity: [8, 16, 24], model: { level: [1, 2, 3] }, weight: 0 },
  { id: 'legacy_farm', label: 'Farm (pre-PR 6 lot)', zone: 'industrial', kind: 1, density: 0, tier: 0, w: 4, d: 4, legacy: true,
    rects: [R(0, 0, 4, 1, P), R(0, 1, 4, 3, B)], garage: 0, bays: 0,
    maxLevel: 3, capacity: [3, 6, 9], model: { level: [1, 2, 3] }, weight: 0 },
  { id: 'legacy_food', label: 'Food plant (pre-PR 6 lot)', zone: 'industrial', kind: 2, density: 0, tier: 0, w: 4, d: 4, legacy: true,
    rects: [R(0, 0, 3, 1, P), R(3, 0, 1, 1, Bay), R(0, 1, 4, 3, B)], garage: 3, bays: 1,
    maxLevel: 3, capacity: [8, 16, 24], model: { level: [1, 2, 3] }, weight: 0 },
  // (Appended LAST so earlier templates keep their index — scoreOption salts by index.)
  // ---------------- V1.5 Mixed use (Commercial ▸ Mixed) ----------------
  // Parker: "shop ground floor, homes above — holds 10 people and 1 business".
  // One business = 4 jobs (a corner shop at level 1). 4 households of flats.
  { id: 'mixed_use', label: 'Mixed-use block', zone: 'commercial', kind: 3, density: 1, tier: 0, w: 4, d: 4,
    rects: [R(0, 0, 4, 1, P), R(0, 1, 4, 3, B)], garage: 2, bays: 0,
    maxLevel: 1, capacity: [4], residents: [10], homes: [4], model: { level: [1] }, weight: 2 },
  { id: 'mixed_corner', label: 'Mixed-use corner', zone: 'commercial', kind: 3, density: 1, tier: 0, w: 3, d: 4,
    rects: [R(0, 0, 3, 1, P), R(0, 1, 3, 3, B)], garage: 3, bays: 0,
    maxLevel: 1, capacity: [4], residents: [10], homes: [4], model: { level: [1] }, weight: 1.5 },
  // ---------------- V1.5b stage A: large medium-density footprints ----------------
  // Parker: "adjacent lots merge more often into larger footprints at higher
  // levels, with new larger models". These only fit after neighbours merge
  // (growth.tryMerge); they jump straight to the mid-rise look (model 7) at
  // L6–L7. Capacity scales with area (~5 residents per cell at L7).
  { id: 'apt_complex', label: 'Apartment complex', zone: 'residential', kind: 0, density: 1, tier: 2, w: 8, d: 8,
    rects: [R(0, 0, 8, 5, B), R(0, 5, 8, 1, Gd), R(0, 6, 8, 2, P)], garage: 40, bays: 0,
    maxLevel: 4, capacity: [110, 170, 255, 370], homes: [44, 68, 102, 150], model: { level: [5, 5, 7, 7], grow: [1, 1, 1, 1.2] }, weight: 1.5 },
  { id: 'twin_midrise', label: 'Twin mid-rise blocks', zone: 'residential', kind: 0, density: 1, tier: 2, w: 10, d: 6,
    rects: [R(0, 0, 4, 5, B), R(4, 0, 2, 5, Gd), R(6, 0, 4, 5, B), R(0, 5, 10, 1, P)], garage: 44, bays: 0,
    maxLevel: 4, capacity: [120, 185, 280, 400], homes: [48, 74, 112, 160], model: { level: [5, 5, 7, 7], grow: [1, 1, 1, 1.2] }, weight: 1.2 },
  { id: 'perimeter', label: 'Perimeter block', zone: 'residential', kind: 0, density: 1, tier: 2, w: 10, d: 8,
    rects: [R(0, 0, 10, 3, B), R(0, 3, 3, 4, B), R(7, 3, 3, 4, B), R(3, 3, 4, 4, Gd), R(0, 7, 10, 1, P)], garage: 56, bays: 0,
    maxLevel: 4, capacity: [150, 230, 345, 500], homes: [60, 92, 138, 200], model: { level: [5, 5, 7, 7], grow: [1, 1, 1, 1.2] }, weight: 1 },
  // ---------------- V1.5b stage H: offices (Commercial ▸ Office, kind 4) ----------------
  // Parker: "counts toward both commercial and industrial demand and jobs".
  // capacity = jobs. Offices want educated workers (demand.ts EDU_SHARE_OFFICE).
  // `special` models: render/officeModels.ts (key office.<id>).
  { id: 'law_firm', label: 'Law firm', zone: 'commercial', kind: 4, density: 1, tier: 0, w: 4, d: 4,
    rects: [R(0, 0, 4, 1, P), R(0, 1, 4, 3, B)], garage: 10, bays: 0,
    maxLevel: 3, capacity: [10, 18, 28], model: { level: [1, 2, 3] }, weight: 1.5 },
  { id: 'cable_co', label: 'Cable company', zone: 'commercial', kind: 4, density: 1, tier: 0, w: 4, d: 4,
    rects: [R(0, 0, 4, 1, P), R(0, 1, 4, 3, B)], garage: 10, bays: 0,
    maxLevel: 3, capacity: [12, 20, 30], model: { level: [1, 2, 3] }, weight: 1.2 },
  { id: 'internet_co', label: 'Internet company', zone: 'commercial', kind: 4, density: 1, tier: 0, w: 6, d: 4,
    rects: [R(0, 0, 6, 1, P), R(0, 1, 6, 3, B)], garage: 8, bays: 0,
    maxLevel: 3, capacity: [16, 28, 42], model: { level: [1, 2, 3] }, weight: 1.2 },
  { id: 'data_center', label: 'Data center', zone: 'commercial', kind: 4, density: 1, tier: 0, w: 8, d: 8,
    rects: [R(0, 0, 8, 1, P), R(0, 1, 8, 7, B)], garage: 17, bays: 0,
    maxLevel: 3, capacity: [20, 34, 50], model: { level: [1, 2, 3] }, weight: 0.8 },
  { id: 'cell_tower', label: 'Cell tower', zone: 'commercial', kind: 4, density: 1, tier: 0, w: 3, d: 3,
    rects: [R(0, 0, 3, 3, B)], garage: 1, bays: 0,
    maxLevel: 1, capacity: [2], model: { level: [1] }, weight: 0.6 },
  { id: 'radio_station', label: 'Radio station', zone: 'commercial', kind: 4, density: 1, tier: 0, w: 4, d: 4,
    rects: [R(0, 0, 4, 1, P), R(0, 1, 4, 3, B)], garage: 3, bays: 0,
    maxLevel: 2, capacity: [8, 14], model: { level: [1, 2] }, weight: 0.8 },
  // ---------------- V1.5b stage B: six new industry types (Parker) ----------------
  // Factory-family (kind 0) buildings with their own textured models
  // (render/industryModels.ts newIndustryModels). Bigger footprints and up to
  // LEVEL 5 (more workers → more output: goods.ts produces level × rate).
  // Parking: (w−2)×2 surface stalls + an in-plant garage allowance so the
  // L5 workforce is covered (FACTORY_JOBS_PER_SPACE = 4).
  { id: 'warehouse', label: 'Warehouse / distribution centre', zone: 'industrial', kind: 0, density: 0, tier: 1, w: 8, d: 6,
    rects: [R(0, 0, 6, 2, P), R(6, 0, 2, 2, Bay), R(0, 2, 8, 4, B)], garage: 6, bays: 2,
    maxLevel: 5, capacity: [12, 20, 28, 36, 44], model: { level: [1, 2, 3, 4, 5] }, weight: 1 },
  { id: 'chemical_plant', label: 'Chemical plant', zone: 'industrial', kind: 0, density: 1, tier: 2, w: 6, d: 8,
    rects: [R(0, 0, 4, 2, P), R(4, 0, 2, 2, Bay), R(0, 2, 6, 6, B)], garage: 10, bays: 2,
    maxLevel: 5, capacity: [18, 28, 38, 48, 58], model: { level: [2, 3, 3, 4, 5] }, weight: 1 },
  { id: 'steel_mill', label: 'Steel mill', zone: 'industrial', kind: 0, density: 1, tier: 2, w: 8, d: 8,
    rects: [R(0, 0, 6, 2, P), R(6, 0, 2, 2, Bay), R(0, 2, 8, 6, B)], garage: 12, bays: 2,
    maxLevel: 5, capacity: [24, 36, 48, 60, 72], model: { level: [2, 3, 3, 4, 5] }, weight: 1 },
  { id: 'textile_mill', label: 'Textile mill', zone: 'industrial', kind: 0, density: 0, tier: 1, w: 6, d: 6,
    rects: [R(0, 0, 4, 2, P), R(4, 0, 2, 2, Bay), R(0, 2, 6, 4, B)], garage: 4, bays: 1,
    maxLevel: 4, capacity: [12, 18, 26, 34], model: { level: [1, 2, 3, 4] }, weight: 1 },
  { id: 'bottling_plant', label: 'Bottling plant', zone: 'industrial', kind: 0, density: 0, tier: 1, w: 6, d: 6,
    rects: [R(0, 0, 4, 2, P), R(4, 0, 2, 2, Bay), R(0, 2, 6, 4, B)], garage: 4, bays: 2,
    maxLevel: 4, capacity: [10, 16, 24, 32], model: { level: [1, 2, 3, 4] }, weight: 1 },
  { id: 'assembly_plant', label: 'Assembly plant', zone: 'industrial', kind: 0, density: 1, tier: 2, w: 8, d: 8,
    rects: [R(0, 0, 6, 2, P), R(6, 0, 2, 2, Bay), R(0, 2, 8, 6, B)], garage: 14, bays: 3,
    maxLevel: 5, capacity: [24, 36, 50, 64, 80], model: { level: [2, 3, 3, 4, 5] }, weight: 1 },
];

export const TPL: Record<string, Template> = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

/** Is this template a filler (garden / overflow lot) rather than a real building? */
/** V1.5: residents living in a (mixed-use) building at `level`; 0 for templates without flats. */
export const residentsAt = (t: Template, level: number) => (level <= 0 || !t.residents ? 0 : t.residents[Math.min(level, t.maxLevel) - 1]);
/**
 * V1.5 RESIDENTIAL LEVEL LADDER (what Inspect calls "level"):
 *   1–3  low density houses            (5 / 10 / 20 residents)
 *   4–5  medium density, building lv 1–2 (e.g. townhouse 40 / 55, apartments 70 / 110)
 *   6    medium building lv 3 ≈ 1.5× lv 2 (apartments ~165) — needs 2,000 people
 *   7    medium building lv 4 ≈ 2.2× lv 2 (apartments ~240) — needs 5,000 people
 * After level 3 a house grows into medium density automatically
 * (growth.tryMerge + lots.zonePromote) once 1,000 people live in the city.
 */
export const MEDIUM_LEVEL_POP = [2000, 5000];
/** Residential level shown to the player for a building at template level `level`. */
export const resLevel = (t: Template, level: number) => (t.zone !== 'residential' ? level : t.density === 0 ? level : t.density === 1 ? level + 3 : level + 7);
/**
 * V1.5: spaces a building of this template supplies at `level`. Medium
 * homes' extra levels (3–4 = residential 6–7) add an underground deck sized
 * for their added flats; everything else supplies parkingSupply(t).
 */
export function supplyAt(t: Template, level: number): number {
  const deck = t.zone === 'residential' && t.density === 1 && level > 2 ? parkingRequired(t, level) - parkingRequired(t, 2) : 0;
  return parkingSupply(t) + Math.max(0, deck);
}
export const isFiller = (t: Template) => t.capacity[0] === 0;

/** Surface parking spaces drawn as stalls (1 per Parking cell). */
export function surfaceSpaces(t: Template): number {
  return t.rects.reduce((a, r) => a + (r.role === CellRole.Parking ? r.w * r.d : 0), 0);
}
/** Total parking supply of a template: surface stalls + garage spaces. */
export const parkingSupply = (t: Template) => surfaceSpaces(t) + t.garage;

/** PR 6 parking ratios (see header). */
export const SPACES_PER_HOME = [1, 0.7, 0.5];
export const SHOP_JOBS_PER_SPACE = 3;
export const FACTORY_JOBS_PER_SPACE = 4;

/** Spaces a building of this template needs at `level` (1-based). */
export function parkingRequired(t: Template, level: number): number {
  if (level <= 0 || isFiller(t)) return 0;
  const k = Math.min(level, t.maxLevel) - 1;
  if (t.zone === 'residential') return Math.ceil((t.homes?.[k] ?? 1) * SPACES_PER_HOME[t.density]);
  // V1.5 mixed use: shop spaces + medium-density spaces for the flats above.
  if (t.zone === 'commercial') return Math.ceil(t.capacity[k] / SHOP_JOBS_PER_SPACE + (t.residents ? (t.homes?.[k] ?? 0) * SPACES_PER_HOME[1] : 0));
  return Math.ceil(t.capacity[k] / FACTORY_JOBS_PER_SPACE);
}

/** The body rect (where the model stands). Every template has exactly one. */
export const bodyRect = (t: Template) => t.rects.find((r) => r.role === CellRole.Body) ?? t.rects[0];

/** Area in cells (used to prefer templates that use the space well). */
export const area = (t: Template) => t.w * t.d;
