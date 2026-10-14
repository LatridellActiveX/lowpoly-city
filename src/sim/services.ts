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

export enum Svc { Dump = 0, Police = 1, Clinic = 2, Hospital = 3, Elementary = 4, High = 5, College = 6 }

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
  { svc: Svc.Dump, tool: 'garbageDump', label: 'Garbage Dump', size: 1, cost: 6000, upkeep: 300, unlockPop: 1000, radius: 16, fleet: 6 },
  { svc: Svc.Police, tool: 'policeStation', label: 'Police Station', size: 1, cost: 5000, upkeep: 250, unlockPop: 1000, radius: 10, fleet: 2 },
  { svc: Svc.Clinic, tool: 'clinic', label: 'Health Clinic', size: 1, cost: 6000, upkeep: 300, unlockPop: 2500, radius: 8, fleet: 1 },
  { svc: Svc.Hospital, tool: 'hospital', label: 'Hospital (2×2)', size: 2, cost: 24000, upkeep: 1100, unlockPop: 2500, radius: 18, fleet: 3 },
  { svc: Svc.Elementary, tool: 'elementarySchool', label: 'Elementary School', size: 1, cost: 4000, upkeep: 200, unlockPop: 0, radius: 9, fleet: 0 },
  { svc: Svc.High, tool: 'highSchool', label: 'High School', size: 1, cost: 9000, upkeep: 450, unlockPop: 1000, radius: 14, fleet: 0 },
  { svc: Svc.College, tool: 'college', label: 'College (2×2)', size: 2, cost: 30000, upkeep: 1400, unlockPop: 2500, radius: 24, fleet: 0 },
];
export const SERVICE_BY_TOOL: Partial<Record<ToolId, ServiceDef>> = Object.fromEntries(SERVICE_DEFS.map((d) => [d.tool, d]));
export const isServiceTool = (tool: ToolId) => tool in SERVICE_BY_TOOL;
/** The service building on tile t (anchor or part), or null. */
export const serviceOf = (t: Tile): ServiceDef | null => (t.structure === 'service' ? SERVICE_DEFS[t.kind] ?? null : null);

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
  world.tiles.forEach((t, i) => {
    if (t.structure !== 'service' || t.part) return;
    if (svc !== undefined && t.kind !== svc) return;
    if (connected(world, i, SERVICE_DEFS[t.kind].size)) out.push(i);
  });
  return out;
}

export function computeCoverage(world: World): Coverage {
  const N = GRID_SIZE, n = world.tiles.length;
  const by = SERVICE_DEFS.map(() => new Float32Array(n));
  for (const a of serviceAnchors(world)) {
    const d = SERVICE_DEFS[world.tiles[a].kind];
    const f = by[d.svc], r = d.radius, half = d.size / 2;
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
