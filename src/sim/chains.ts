/**
 * sim/chains.ts — V1.5 stage 10: what each industrial building IS.
 *
 * Plain TypeScript (no Three.js/DOM). goods.ts moves the trucks; this file
 * only decides each industrial host tile's ROLE and its recipe.
 *
 * ROLES
 * -----
 *  EXTRACTORS (decided by the resource patch under the lot, from game start):
 *    logging  — Logging camp    on a LOGGING patch  → wood (logs)
 *    oilRig   — Oil rig         on an OIL patch     → crude oil
 *    quarry   — Quarry          on a QUARRY patch   → stone
 *    farm     — Farm            on FARMLAND / Farm tool → food   (PR 5)
 *  PROCESSORS (any other factory; recipe chosen once, see below):
 *    lumberMill  — wood            → lumber
 *    refinery    — crude oil       → fuel + plastics (alternate loads)
 *    materials   — lumber or stone → building materials
 *    furniture   — lumber          → furniture
 *    electronics — plastics (+ imported chips, goods.ts CHIP_COST) → electronics
 *    foodPlant   — food            → packaged food  (PR 5 kind 2 / Food Plant tool)
 *  factory — a plain factory making general "goods" (no local raw inputs yet)
 *
 * CHOOSING A PROCESSOR RECIPE
 * ---------------------------
 * Every ROLE_REFRESH ticks, refreshRoles() looks at what the city's
 * extractors and processors make. A plain `factory` with at least one
 * recipe whose input is made locally adopts one: preferring recipes whose
 * OUTPUT nobody makes yet (fills the gaps in the chain), ties broken by a
 * per-tile hash so neighbours differ. Once chosen, a role sticks while the
 * building stands (a mill doesn't flip to a refinery mid-shift); it is
 * dropped when the tile stops being industrial. Roles are a cache (not
 * saved): after loading, the same rules re-derive them.
 */
import { GRID_SIZE } from './types';
import { World } from './grid';
import { Resource } from './resources';
import { hash2 } from './random';
import { isFarmLot, isFoodPlant } from './industry';
import type { GoodType } from './goods';

export type Role = 'factory' | 'farm' | 'foodPlant' | 'logging' | 'oilRig' | 'quarry' | 'lumberMill' | 'refinery' | 'materials' | 'furniture' | 'electronics';

export const ROLE_NAMES: Record<Role, string> = {
  factory: 'Factory', farm: 'Farm', foodPlant: 'Food processing plant', logging: 'Logging camp', oilRig: 'Oil rig', quarry: 'Quarry',
  lumberMill: 'Lumber mill', refinery: 'Refinery', materials: 'Building-materials plant', furniture: 'Furniture factory', electronics: 'Electronics plant',
};

/** Processor recipes (1 unit in → 1 unit out). outputs[0] is the "main" product. */
export const RECIPES: Partial<Record<Role, { inputs: GoodType[]; outputs: GoodType[] }>> = {
  foodPlant: { inputs: ['food'], outputs: ['packaged'] },
  lumberMill: { inputs: ['wood'], outputs: ['lumber'] },
  refinery: { inputs: ['oil'], outputs: ['fuel', 'plastics'] },
  materials: { inputs: ['lumber', 'stone'], outputs: ['materials'] },
  furniture: { inputs: ['lumber'], outputs: ['furniture'] },
  electronics: { inputs: ['plastics'], outputs: ['electronics'] },
};
/** Recipes a plain factory may adopt (the food plant comes from its own zone kind). */
const ADOPTABLE: Role[] = ['lumberMill', 'refinery', 'materials', 'furniture', 'electronics'];
/** Extractor role and product per resource patch. */
const EXTRACT: Partial<Record<Resource, [Role, GoodType]>> = {
  [Resource.Logging]: ['logging', 'wood'],
  [Resource.Oil]: ['oilRig', 'oil'],
  [Resource.Quarry]: ['quarry', 'stone'],
};
export const ROLE_REFRESH = 30;

/** Role memo per world (tile index → adopted processor role). */
const MEMO = new WeakMap<World, Map<number, Role>>();
const memo = (w: World) => { let m = MEMO.get(w); if (!m) MEMO.set(w, (m = new Map())); return m; };

/** The role of industrial tile i (non-industrial tiles answer 'factory'). */
export function roleOf(world: World, i: number): Role {
  const t = world.tiles[i];
  if (isFoodPlant(t)) return 'foodPlant';
  if (isFarmLot(world, i)) return 'farm';
  const ex = EXTRACT[world.resourceAt(i)];
  if (ex) return ex[0];
  return memo(world).get(i) ?? 'factory';
}

/** The main product of a role at tile i. */
export function roleOutput(world: World, i: number, role: Role): GoodType {
  if (role === 'farm') return 'food';
  const rec = RECIPES[role];
  if (rec) return rec.outputs[0];
  const ex = EXTRACT[world.resourceAt(i)];
  if (ex && ex[0] === role) return ex[1];
  return 'goods';
}

/** Every good some building in the city makes (all outputs, refinery's both). */
export function cityMakes(world: World): Set<GoodType> {
  const out = new Set<GoodType>();
  world.chunks.activeTilesSorted().forEach((i) => { const t = world.tiles[i]; // V1.6 A2
    if (t.zone !== 'industrial' || t.level === 0) return;
    const r = roleOf(world, i);
    const rec = RECIPES[r];
    if (rec) rec.outputs.forEach((g) => out.add(g));
    else out.add(roleOutput(world, i, r));
  });
  return out;
}

/** Adopt recipes for plain factories (every ROLE_REFRESH ticks; cheap otherwise). */
export function refreshRoles(world: World, operating: (i: number) => boolean): void {
  const m = memo(world);
  // Drop roles of tiles that are no longer built industry.
  for (const i of [...m.keys()]) { const t = world.tiles[i]; if (t.zone !== 'industrial' || t.level === 0) m.delete(i); }
  if (world.tick % ROLE_REFRESH !== 0) return;
  const makes = cityMakes(world);
  world.chunks.activeTilesSorted().forEach((i) => { const t = world.tiles[i]; // V1.6 A2
    if (t.zone !== 'industrial' || t.level === 0 || !operating(i) || roleOf(world, i) !== 'factory') return;
    const options = ADOPTABLE.filter((r) => RECIPES[r]!.inputs.some((g) => makes.has(g)));
    if (!options.length) return;
    // Prefer recipes whose output nobody makes yet; hash picks among equals.
    const fresh = options.filter((r) => !RECIPES[r]!.outputs.some((g) => makes.has(g)));
    const pool = fresh.length ? fresh : options;
    const role = pool[Math.floor(hash2(i % GRID_SIZE, Math.floor(i / GRID_SIZE), world.seed + 777) * pool.length)];
    m.set(i, role);
    RECIPES[role]!.outputs.forEach((g) => makes.add(g)); // the next factory sees this one
  });
}
