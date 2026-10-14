/**
 * sim/save.ts — saving and loading the city to the browser's localStorage.
 *
 * A save is JSON:
 *   { version, size, tick, seed, cash, taxRates, ledger, lastLedger, tiles: [...] }
 *
 * MIGRATIONS: `version` says which format a save uses. When we load an older
 * one we upgrade it step by step:
 *   v1 (milestone 1) had no money, seed or decorations. We give it the
 *   starting cash and default taxes, pick a seed, and scatter trees only on
 *   tiles that are still completely empty, so nothing the player built moves.
 *   v2 (PR 2) had no wind. v1 and v2 saves start with a moderate wind (0.5)
 *   and no drift. v3 (PR 3) stores `wind` and `windDrift`.
 *   v4 (PR 4) adds per-tile `water`, `edge`, `roadType`, `construct`, `stock`,
 *   `part` (2×2 buildings) and world `clock` + `tier`. Migrating a v1–v3 save:
 *   a river/lake is generated ONLY on empty tiles (your town never floods),
 *   the highway connection is laid at the first free edge spot, existing
 *   power plants get a full fuel bunker, the clock starts at 0 and the tier
 *   is worked out from the current population on the first tick.
 *
 * Merging over defaults: each tile is spread over emptyTile(), and the ledger
 * is merged section by section, so a field added later (like the park upkeep
 * line) gets its default instead of `undefined`.
 */
import { initialWindDir } from './wind';
import { World, emptyTile } from './grid';
import { defaultTaxRates, emptyLedger, Ledger, STARTING_CASH } from './economy';
import { scatterDecorations } from './terrain';
import { generateWater, placeEdgeConnection } from './mapgen';
import { FUEL_MAX } from './rules';
import { GRID_SIZE, Tile } from './types';
import { b64ToBytes, bytesToB64, CellRole, cidx, zoneCode } from './cells';
import { TPL } from './footprints';
import { localToCell } from './lots';

const KEY = 'lowpoly-city-save';
/** v5 (PR 5): tile kind/farm/input/crew + windDir/windDirVel. */
/** v6 (PR 6): cell grid (zone/owner/role, base64), building entities, public lots; roads gain water mains. */
/** v7 (V1.5): public lots gain garage/decks/grown; whole-tile surface lots; ledger trade.parking. */
/** v8 (V1.5b): coal plants become 2×2 where there is room (migrateCoal). */
export const SAVE_VERSION = 8;

export function saveWorld(world: World): void {
  const data = {
    version: SAVE_VERSION,
    size: GRID_SIZE,
    tick: world.tick,
    seed: world.seed,
    cash: world.cash,
    taxRates: world.taxRates,
    propertyRate: world.propertyRate, // V1.5 stage 11
    ledger: world.ledger,
    lastLedger: world.lastLedger,
    wind: world.wind,
    windDrift: world.windDrift,
    windDir: world.windDir,
    windDirVel: world.windDirVel,
    clock: world.clock,
    tier: world.tier,
    peakPop: world.peakPop,
    tiles: world.tiles,
    // PR 6 cell layer: typed arrays as base64 (≈ 90 KB zone/role + 350 KB owners, before JSON).
    cells: { zone: bytesToB64(world.cells.zone), role: bytesToB64(world.cells.role), owner: bytesToB64(new Uint8Array(world.cells.owner.buffer)) },
    buildings: [...world.lots.buildings.values()],
    nextBuilding: world.lots.nextId,
    lots: [...world.parking.lots.values()],
    nextLot: world.parking.nextId,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    // Storage full or blocked (private mode). console.warn is captured by the Game Log.
    console.warn('Save failed:', e instanceof Error ? e.message : e);
  }
}

export function hasSave(): boolean {
  return localStorage.getItem(KEY) !== null;
}

/** Returns a World, or null if there's no save or it's unreadable. */
export function loadWorld(): World | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data.size !== GRID_SIZE || !Array.isArray(data.tiles)) return null;
    const version: number = data.version ?? 1;
    // Merge each saved tile over a default tile so fields added later get defaults.
    // PR 5: movingIn is reset — cars in transit aren't saved, so anyone who
    // was still driving in simply arrives when the save loads.
    const tiles: Tile[] = data.tiles.map((t: Partial<Tile>) => ({ ...emptyTile(), ...t, movingIn: false }));
    const seed: number = data.seed ?? Math.floor(Math.random() * 1e9);
    const w = new World(tiles, seed);
    w.tick = data.tick ?? 0;
    if (version < 2) {
      // ---- v1 -> v2 migration ----
      w.cash = STARTING_CASH;
      w.taxRates = defaultTaxRates();
      scatterDecorations(w.tiles, seed);
    } else {
      w.cash = data.cash ?? STARTING_CASH;
      w.taxRates = { ...defaultTaxRates(), ...data.taxRates };
      if (typeof data.propertyRate === 'number') w.propertyRate = data.propertyRate;
      w.ledger = mergeLedger(data.ledger) ?? emptyLedger();
      w.lastLedger = mergeLedger(data.lastLedger);
    }
    if (version < 3) {
      // ---- v1/v2 -> v3 migration: no weather yet, start with a moderate breeze ----
      w.wind = 0.5;
      w.windDrift = 0;
    } else {
      w.wind = typeof data.wind === 'number' ? data.wind : 0.5;
      w.windDrift = typeof data.windDrift === 'number' ? data.windDrift : 0;
    }
    if (version < 4) {
      // ---- v1-v3 -> v4 migration (PR 4) ----
      generateWater(w.tiles, seed, true);
      if (w.edgeIndex < 0) placeEdgeConnection(w.tiles, seed);
      w.tiles.forEach((t) => t.structure === 'powerPlant' && (t.stock = FUEL_MAX));
    } else {
      w.clock = typeof data.clock === 'number' ? data.clock : 0;
      w.tier = typeof data.tier === 'number' ? data.tier : 0;
      w.peakPop = typeof data.peakPop === 'number' ? data.peakPop : 0; // older saves: set on the first tick from the current population
    }
    if (version < 5) {
      // ---- v4 -> v5 migration (PR 5 industry) ----
      // Old cities have no Construction Yard, so treat sites that were already
      // underway as having their crew on site (they finish normally). New
      // sites need a yard; the sim posts a hint until one is built.
      // kind / farm / input default to 0 via emptyTile(), i.e. ordinary
      // factories and no fields — farms on farmland claim fields next tick.
      w.tiles.forEach((t) => { if (t.construct > 0) t.crew = true; });
    }
    if (version < 6) migrateToCells(w);
    else if (data.cells) {
      // ---- v6: restore the cell layer and entities ----
      w.cells.zone.set(b64ToBytes(data.cells.zone));
      w.cells.role.set(b64ToBytes(data.cells.role));
      w.cells.owner.set(new Int32Array(b64ToBytes(data.cells.owner).buffer));
      for (const b of data.buildings ?? []) if (TPL[b.tpl]) w.lots.buildings.set(b.id, { ...b, movingIn: false });
      w.lots.nextId = data.nextBuilding ?? w.lots.buildings.size + 1;
      // V1.5 (save v7): lots gained garage/decks/grown. PR 6 lots: size 4 was
      // the garage (3 decks, 40 spaces), size 2 the surface lot (4 spaces);
      // both keep their size and spaces.
      for (const l of data.lots ?? []) w.parking.lots.set(l.id, { garage: l.size === 4, decks: 3, grown: false, ...l, parked: 0 });
      w.parking.nextId = data.nextLot ?? w.parking.lots.size + 1;
    }
    if (version < 8) migrateCoal(w);
    // Every zoned tile goes back on the growth queue; aggregates are rebuilt.
    w.tiles.forEach((t, i) => t.zone && w.lots.markDirty(i));
    w.lots.aggregate(w);
    w.parking.allocate(w.lots);
    // PR 5 wind direction: older saves get the seeded default heading.
    w.windDir = typeof data.windDir === 'number' ? data.windDir : initialWindDir(seed);
    w.windDirVel = typeof data.windDirVel === 'number' ? data.windDirVel : 0;
    return w;
  } catch (e) {
    console.warn('Load failed: save data unreadable —', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Merge a saved ledger over an empty one, section by section (null stays null). */
function mergeLedger(l: Partial<Ledger> | null | undefined): Ledger | null {
  if (!l) return null;
  const e = emptyLedger();
  return {
    taxes: { ...e.taxes, ...l.taxes },
    upkeep: { ...e.upkeep, ...l.upkeep },
    construction: l.construction ?? 0,
    refunds: l.refunds ?? 0,
    trade: { ...e.trade, ...l.trade },
    property: l.property ?? 0,
  };
}

export function clearSave(): void {
  localStorage.removeItem(KEY);
}

/**
 * ---- v5 → v6 migration (PR 6 cell grid) ----
 *  - Every road tile gains a water main (roads now carry water).
 *  - Every zoned tile's 16 cells get its zone (homes at PR 5 levels 4–5
 *    become MEDIUM density cells so they can keep redeveloping).
 *  - Every grown building / site becomes a whole-tile "legacy" lot
 *    (footprints.ts legacy_*: 4 × 4 cells, body + driveway/lot, plus a
 *    garage allowance so its parking matches its needs) facing the same road
 *    PR 5 faced it to, at the same level, keeping its construction progress.
 *  - PR 5 field tiles become Field cells owned by their farm; fallow tiles
 *    are just freed.
 */
export function migrateToCells(w: World): void {
  const N = GRID_SIZE;
  const farmOf = new Map<number, number>(); // tile index → building id
  w.tiles.forEach((t, i) => {
    if (t.road) t.waterPipe = true;
    if (!t.zone || t.part) return;
    const x = i % N, z = Math.floor(i / N);
    const code = zoneCode(t.zone, t.zone === 'residential' && t.level >= 4 ? 1 : 0, t.kind);
    for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) w.cells.zone[cidx(x * 4 + dx, z * 4 + dz)] = code;
    if (t.level === 0 && t.construct === 0) return;
    const id = t.zone === 'residential' ? 'legacy_res' : t.zone === 'commercial' ? 'legacy_com' : t.kind === 1 ? 'legacy_farm' : t.kind === 2 ? 'legacy_food' : 'legacy_ind';
    const tpl = TPL[id];
    // Face the road in PR 5's priority order (S, E, N, W); FACES index 2,1,0,3.
    let face = 2;
    for (const [f, dx, dz] of [[2, 0, 1], [1, 1, 0], [0, 0, -1], [3, -1, 0]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < N && nz < N && w.tiles[nz * N + nx].road) { face = f; break; }
    }
    // Pick the origin corner so the 4×4 footprint lands exactly on this tile.
    for (let oz = z * 4; oz < z * 4 + 4; oz++) for (let ox = x * 4; ox < x * 4 + 4; ox++) {
      const [ex, ez] = localToCell(ox, oz, face, 3, 3);
      const inside = (cx: number, cz: number) => cx >= x * 4 && cx < x * 4 + 4 && cz >= z * 4 && cz < z * 4 + 4;
      const [fx, fz] = localToCell(ox, oz, face, 0, 0);
      const front = face === 0 ? fz === z * 4 : face === 2 ? fz === z * 4 + 3 : face === 1 ? fx === x * 4 + 3 : fx === x * 4;
      if (!inside(ex, ez) || !front) continue;
      const b = w.lots.place(w, tpl, ox, oz, face, i, Math.min(t.level, tpl.maxLevel), t.construct);
      if (t.construct > 0) t.crew = true;
      if (tpl.kind === 1 && tpl.zone === 'industrial') farmOf.set(i, b.id);
      return;
    }
  });
  // Fields: PR 5 tile.farm = owner tile + 1.
  w.tiles.forEach((t, i) => {
    if (t.farm > 0 && farmOf.has(t.farm - 1)) {
      const id = farmOf.get(t.farm - 1)!;
      const b = w.lots.buildings.get(id)!;
      const x = i % N, z = Math.floor(i / N);
      for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) {
        const c = cidx(x * 4 + dx, z * 4 + dz);
        if (w.cells.owner[c]) continue;
        w.cells.owner[c] = id;
        w.cells.role[c] = CellRole.Field;
        w.cells.zone[c] = 8;
        b.fields++;
      }
    }
    t.farm = 0;
  });
}

/**
 * V1.5: the raw save JSON (or null), for "Export save" in the update prompt
 * and the title screen. Kept as the exact stored string so a later import is
 * byte-identical and goes through the normal loadWorld() migrations.
 */
export function exportSaveText(): string | null {
  return localStorage.getItem(KEY);
}

/**
 * V1.5: import a previously exported save. Validates that it parses and has
 * the basic shape; returns false (and leaves the current save alone) if not.
 */
export function importSaveText(text: string): boolean {
  try {
    const d = JSON.parse(text);
    if (d.size !== GRID_SIZE || !Array.isArray(d.tiles)) return false;
    localStorage.setItem(KEY, text);
    return true;
  } catch {
    return false;
  }
}

/** V1.5: trigger a browser download of the current save as a .json file. */
export function downloadSave(name = 'lowpoly-city-save'): boolean {
  const text = exportSaveText();
  if (!text) return false;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}

/**
 * V1.5b save v8: every 1×1 COAL plant grows into a 2×2 plant (expanding
 * right and down) when those three tiles are empty land — no road, water,
 * structure, zone cells, wires or pipes. Otherwise it stays a legacy 1×1
 * plant (still works; drawn with the old model). Oil plants stay 1×1.
 */
export function migrateCoal(w: World): number {
  const N = 64;
  let n = 0;
  w.tiles.forEach((t, i) => {
    if (t.structure !== 'powerPlant' || t.kind !== 0 || t.part) return;
    const x = i % N, z = Math.floor(i / N);
    if (x >= N - 1 || z >= N - 1) return;
    const others = [i + 1, i + N, i + N + 1];
    const free = others.every((j) => {
      const o = w.tiles[j];
      if (o.road || o.water || o.edge || o.structure !== 'none' || o.zone || o.powerLine || o.waterPipe) return false;
      const ox = j % N, oz = Math.floor(j / N);
      for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) { const c = (oz * 4 + dz) * N * 4 + ox * 4 + dx; if (w.cells.zone[c] || w.cells.owner[c]) return false; }
      return true;
    });
    if (!free) return;
    for (const j of others) { const o = w.tiles[j]; o.structure = 'powerPlant'; o.kind = 0; o.part = i + 1; o.deco = 0; o.stock = 0; }
    n++;
  });
  return n;
}
