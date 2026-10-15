/**
 * sim/services.ts — V1.5b city SERVICES: garbage (stage E), police and
 * healthcare (stage F), education (stage G).
 *
 * Plain TypeScript (no Three.js / DOM). Every service building is ONE tile
 * structure type, 'service', with tile.kind = its Svc number (so saves,
 * bulldozing, upkeep and the renderer handle all of them the same way).
 * Big ones (hospital, college) are 2×2 tiles like the nuclear plant: the
 * top-left tile is the anchor, the others have part = anchor + 1.
 *
 * COVERAGE
 * --------
 * A service building that touches a road covers every tile within its
 * RADIUS (Chebyshev distance, i.e. a square), at full strength out to half
 * the radius and fading linearly to 0.25 at the edge. Several buildings of
 * the same type add up, capped at 1. computeCoverage() runs with the
 * environment (every tick) — it is a few hundred squares at most.
 */
import { GRID_SIZE, Tile, ToolId } from './types';
import type { World } from './grid';

/** People at which police (and with them crime) unlock. */
export const POLICE_UNLOCK_POP = 2500;

export enum Svc { Dump = 0, Police = 1, Clinic = 2, Hospital = 3, Elementary = 4, High = 5, College = 6, Depot = 7, Recycling = 8 }

export interface ServiceDef {
  svc: Svc;
  tool: ToolId;
  label: string;
  /** 1 = one tile, 2 = 2×2 tiles. */
  size: 1 | 2;
  cost: number;
  upkeep: number;
  /** Peak population that unlocks it. */
  unlockPop: number;
  /** Coverage radius in tiles (square). */
  radius: number;
  /** Vehicles the building owns (garbage trucks, patrol cars, ambulances). */
  fleet: number;
}

export const SERVICE_DEFS: ServiceDef[] = [
  // V1.6: the dump is now a 2×2 LANDFILL with a finite capacity (garbage.ts LANDFILL_MAX); the tool id stays 'garbageDump' so saves and keybinds keep working.
  { svc: Svc.Dump, tool: 'garbageDump', label: 'Landfill (2×2)', size: 2, cost: 10000, upkeep: 400, unlockPop: 1000, radius: 16, fleet: 6 },
  { svc: Svc.Police, tool: 'policeStation', label: 'Police Station', size: 1, cost: 5000, upkeep: 250, unlockPop: POLICE_UNLOCK_POP, radius: 10, fleet: 2 },
  { svc: Svc.Clinic, tool: 'clinic', label: 'Health Clinic', size: 1, cost: 6000, upkeep: 300, unlockPop: 2500, radius: 8, fleet: 1 },
  { svc: Svc.Hospital, tool: 'hospital', label: 'Hospital (2×2)', size: 2, cost: 24000, upkeep: 1100, unlockPop: 2500, radius: 18, fleet: 3 },
  { svc: Svc.Elementary, tool: 'elementarySchool', label: 'Elementary School (2×2)', size: 2, cost: 4000, upkeep: 200, unlockPop: 0, radius: 9, fleet: 0 },
  { svc: Svc.High, tool: 'highSchool', label: 'High School', size: 1, cost: 9000, upkeep: 450, unlockPop: 2500, radius: 14, fleet: 0 },
  { svc: Svc.College, tool: 'college', label: 'College (2×2)', size: 2, cost: 30000, upkeep: 1400, unlockPop: 2500, radius: 24, fleet: 0 },
  // V1.5b stage C: the SHIPPING DEPOT (2×2 industrial building). Its
  // "coverage" is its CATCHMENT: industry and shops inside it ship through
  // the depot (goods.ts) instead of driving to the highway edge.
  { svc: Svc.Depot, tool: 'shippingDepot', label: 'Shipping Depot (2×2)', size: 2, cost: 15000, upkeep: 500, unlockPop: 2000, radius: 20, fleet: 0 },
  // V1.6: RECYCLING CENTER. Its coverage cuts garbage build-up on every building in its radius (garbage.ts RECYCLE_CUT), so landfills last longer.
  { svc: Svc.Recycling, tool: 'recyclingCenter', label: 'Recycling Center', size: 1, cost: 8000, upkeep: 350, unlockPop: 2500, radius: 12, fleet: 0 },
];
export const SERVICE_BY_TOOL: Partial<Record<ToolId, ServiceDef>> = Object.fromEntries(SERVICE_DEFS.map((d) => [d.tool, d]));
export const isServiceTool = (tool: ToolId) => tool in SERVICE_BY_TOOL;
/** The service building on tile t (anchor or part), or null. */
export const serviceOf = (t: Tile): ServiceDef | null => (t.structure === 'service' ? SERVICE_DEFS[t.kind] ?? null : null);
/**
 * Real footprint (1 or 2 tiles wide) of the service whose ANCHOR is tile i.
 * A landfill or elementary school from an older save that couldn't grow into
 * 2×2 (save.ts migrateGrownServices) stays a legacy 1×1 building: it has no
 * part tile linked to it.
 */
/** Services that used to be 1×1 and so may still exist as legacy 1×1 buildings in old saves. */
export const GREW_FROM_1X1: Svc[] = [Svc.Dump, Svc.Elementary];
export function serviceSize(tiles: Tile[], i: number): 1 | 2 {
  const d = SERVICE_DEFS[tiles[i]?.kind];
  if (!d || d.size === 1) return 1;
  if (!GREW_FROM_1X1.includes(d.svc)) return 2;
  const r = tiles[i + 1];
  return r && r.structure === 'service' && r.kind === d.svc && r.part === i + 1 ? 2 : 1;
}

export interface Coverage {
  /** 0..1 per service type per tile. */
  by: Float32Array[];
  /** Education level per tile 0..3 (elementary, high school, college covered). */
  edu: Uint8Array;
}

/** Does the anchor at index i touch a road (any tile of its footprint)? */
function connected(world: World, i: number, size: number): boolean {
  const N = GRID_SIZE, x0 = i % N, z0 = Math.floor(i / N);
  for (let dz = -1; dz <= size; dz++) for (let dx = -1; dx <= size; dx++) {
    const inside = dx >= 0 && dz >= 0 && dx < size && dz < size;
    const x = x0 + dx, z = z0 + dz;
    if (inside || (dx < 0 || dx >= size) && (dz < 0 || dz >= size)) continue; // skip own tiles + corners
    if (x >= 0 && z >= 0 && x < N && z < N && world.tiles[z * N + x].road) return true;
  }
  return false;
}

/** Anchor tiles of every operating (road-connected) service building of `svc`. */
export function serviceAnchors(world: World, svc?: Svc): number[] {
  const out: number[] = [];
  world.chunks.activeTilesSorted().forEach((i) => { const t = world.tiles[i]; // V1.6 A2: active chunks only
    if (t.structure !== 'service' || t.part) return;
    if (svc !== undefined && t.kind !== svc) return;
    if (connected(world, i, serviceSize(world.tiles, i))) out.push(i);
  });
  return out;
}

export function computeCoverage(world: World): Coverage {
  const N = GRID_SIZE, n = world.tiles.length;
  const by = SERVICE_DEFS.map(() => new Float32Array(n));
  for (const a of serviceAnchors(world)) {
    const d = SERVICE_DEFS[world.tiles[a].kind];
    const f = by[d.svc], r = d.radius, half = serviceSize(world.tiles, a) / 2;
    const cx = (a % N) + half - 0.5, cz = Math.floor(a / N) + half - 0.5;
    for (let z = Math.max(0, Math.floor(cz - r)); z <= Math.min(N - 1, Math.ceil(cz + r)); z++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(N - 1, Math.ceil(cx + r)); x++) {
        const dist = Math.max(Math.abs(x - cx), Math.abs(z - cz)) - (half - 0.5);
        if (dist > r) continue;
        const k = dist <= r / 2 ? 1 : 1 - 0.75 * ((dist - r / 2) / (r / 2));
        f[z * N + x] = Math.min(1, f[z * N + x] + k);
      }
  }
  const edu = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const e = by[Svc.Elementary][i] > 0.3, h = by[Svc.High][i] > 0.3, c = by[Svc.College][i] > 0.3;
    edu[i] = e ? (h ? (c ? 3 : 2) : 1) : 0;
  }
  return { by, edu };
}
