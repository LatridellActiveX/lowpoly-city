/**
 * sim/cells.ts — PR 6 the CELL GRID under the tile map.
 *
 * WHY CELLS?
 * ----------
 * Until PR 5 one tile held one building. That made every block look like a
 * chessboard and left no room for driveways, parking lots or buildings of
 * different sizes. PR 6 splits every map tile into CELLS_PER_TILE × CELLS_PER_TILE
 * (4 × 4) CELLS, so the 64 × 64 map has a 256 × 256 cell grid:
 *
 *        tile (x, z)                     cell (cx, cz)
 *     ┌───────────────┐            cx = x * 4 + 0..3
 *     │ . . . . │     │            cz = z * 4 + 0..3
 *     │ . . . . │ ... │            cell index = cz * CELL_GRID + cx
 *     └───────────────┘
 *
 * WHAT LIVES WHERE
 *   - PER TILE (unchanged): terrain, water, roads, power lines, pipes and the
 *     utility buildings (plants, towers, turbines, parks, yards). Networks,
 *     goods trucks and traffic still think in tiles.
 *   - PER CELL (new, this file): the ZONE you painted (with its density),
 *     and the OWNER of the cell: a building, a public parking lot, a farm
 *     field or a garden. Buildings themselves are entities (sim/lots.ts) with
 *     a footprint rectangle in cells.
 *
 * The cell arrays are typed arrays (Uint8Array / Int32Array), 65,536 entries
 * each — small (≈ 320 KB) and fast. Nothing scans all of them every tick:
 * growth works from a DIRTY set of tiles (lots.ts), see "Performance" in the
 * Zoning wiki page.
 */
import { GRID_SIZE, ZoneType } from './types';

/** Cells along one side of a tile. */
export const CELLS_PER_TILE = 4;
/** Cells along one side of the map (256 on the 64-tile map). */
export const CELL_GRID = GRID_SIZE * CELLS_PER_TILE;
/** World size of one cell in tile units (the renderer uses 1 tile = 1 unit). */
export const CELL = 1 / CELLS_PER_TILE;

/**
 * ZONE CODES stored per cell. 0 = not zoned. Each code is a zone + DENSITY.
 * Density is a MAXIMUM: a medium-density cell can still grow a small house
 * while the town is young, and later merge into townhouses (lots.ts).
 * Farm and food plant are their own industrial "kinds" (like PR 5).
 */
export enum ZoneCode {
  None = 0,
  ResLow = 1,
  ResMed = 2,
  ResHigh = 3,
  ComLow = 4,
  ComHigh = 5,
  IndLight = 6,
  IndHeavy = 7,
  Farm = 8,
  FoodPlant = 9,
  /** V1.5: mixed-use (shops on the ground floor, homes above) — Commercial ▸ Mixed. */
  ComMixed = 10,
}

/** Static facts about each zone code (index = code). */
export interface ZoneCodeInfo {
  zone: ZoneType | null;
  /** 0 = low / light, 1 = medium / high (commercial) / heavy, 2 = high (residential only). */
  density: number;
  /** PR 5 industry kind: 0 factory, 1 farm, 2 food plant. */
  kind: number;
  label: string;
}
export const ZONE_CODES: ZoneCodeInfo[] = [
  { zone: null, density: 0, kind: 0, label: 'Unzoned' },
  { zone: 'residential', density: 0, kind: 0, label: 'Residential · low' },
  { zone: 'residential', density: 1, kind: 0, label: 'Residential · medium' },
  { zone: 'residential', density: 2, kind: 0, label: 'Residential · high' },
  { zone: 'commercial', density: 0, kind: 0, label: 'Commercial · low' },
  { zone: 'commercial', density: 1, kind: 0, label: 'Commercial · high' },
  { zone: 'industrial', density: 0, kind: 0, label: 'Industrial · light' },
  { zone: 'industrial', density: 1, kind: 0, label: 'Industrial · heavy' },
  { zone: 'industrial', density: 0, kind: 1, label: 'Farm' },
  { zone: 'industrial', density: 0, kind: 2, label: 'Food plant' },
  // V1.5: commercial kind 3 = mixed-use. Density 1 so only mixed templates fit.
  { zone: 'commercial', density: 1, kind: 3, label: 'Mixed use' },
];

/** The zone code for a zone + density (+ industrial kind). */
export function zoneCode(zone: ZoneType, density: number, kind = 0): ZoneCode {
  if (zone === 'residential') return (ZoneCode.ResLow + Math.min(2, density)) as ZoneCode;
  // V1.5: commercial "density" 2 in the zone bar = Mixed use.
  if (zone === 'commercial') return density >= 2 ? ZoneCode.ComMixed : ((ZoneCode.ComLow + Math.min(1, density)) as ZoneCode);
  if (kind === 1) return ZoneCode.Farm;
  if (kind === 2) return ZoneCode.FoodPlant;
  return (ZoneCode.IndLight + Math.min(1, density)) as ZoneCode;
}

/**
 * CELL OWNER values (Int32Array `owner`):
 *    0       free (maybe zoned)
 *   > 0      building id (lots.ts) — the building's body, its driveway,
 *            its attached parking, its gardens AND a farm's fields; the
 *            `role` array says which
 *   < 0      public parking lot id (negated), see parking.ts
 */
export enum CellRole {
  None = 0,
  Body = 1,
  /** Surface parking that belongs to a building (lot, driveway). */
  Parking = 2,
  /** A garage door / garage block (spaces counted, cars hidden). */
  Garage = 3,
  /** A small garden, lawn or shed filling an odd leftover gap. */
  Garden = 4,
  /** A farm field (owner = the farm building). */
  Field = 5,
  /** Public parking lot / garage cell. */
  Public = 6,
  /** A loading bay for trucks (factories). */
  Bay = 7,
  /** A field the player bulldozed: still owned by its farm so it isn't reclaimed. */
  Fallow = 8,
}

/** The per-cell layer. Owned by World (grid.ts). */
export class CellLayer {
  zone = new Uint8Array(CELL_GRID * CELL_GRID);
  owner = new Int32Array(CELL_GRID * CELL_GRID);
  role = new Uint8Array(CELL_GRID * CELL_GRID);
}

/** (cx, cz) -> cell index. */
export const cidx = (cx: number, cz: number) => cz * CELL_GRID + cx;
export const cellInBounds = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < CELL_GRID && cz < CELL_GRID;
/** Index of the TILE a cell sits on. */
export const tileOfCell = (cx: number, cz: number) => Math.floor(cz / CELLS_PER_TILE) * GRID_SIZE + Math.floor(cx / CELLS_PER_TILE);

/** Every cell index of tile (x, z), row by row. */
export function cellsOfTile(x: number, z: number): number[] {
  const out: number[] = [];
  for (let dz = 0; dz < CELLS_PER_TILE; dz++) for (let dx = 0; dx < CELLS_PER_TILE; dx++) out.push(cidx(x * CELLS_PER_TILE + dx, z * CELLS_PER_TILE + dz));
  return out;
}

/**
 * The four road directions a building can face, as (dx, dz) unit steps
 * FROM the building TOWARD the road: 0 = north (−z), 1 = east, 2 = south, 3 = west.
 */
export const FACES: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Compact base64 helpers so the cell arrays fit in a localStorage save (save.ts). */
export function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
