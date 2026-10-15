import { GRID_SIZE } from './types';
/**
 * sim/networks.ts — how power and water get from sources to buildings.
 *
 * THE RULE (same for power and water)
 * -----------------------------------
 *   1. A network starts at a SOURCE tile (power plant / wind turbine for power,
 *      water tower for water).
 *   2. It spreads through CONDUIT tiles: power lines for power, pipes for water.
 *      Sources also count as conduits, so two plants side by side join up.
 *   3. Any building (or zoned lot) that sits right next to (N/E/S/W) a conduit
 *      or source tile is CONNECTED to that network. Buildings do NOT pass the
 *      utility on to further buildings — every block needs its own line/pipe
 *      running past it. (Chosen because it makes the line/pipe tools matter.)
 *
 * FLOOD-FILL
 * ----------
 * "Which tiles are part of the same network?" is answered with a flood-fill
 * (a breadth-first search): put a source in a queue; repeatedly take a tile
 * out, look at its 4 neighbours, and add every neighbour that is a conduit
 * and hasn't been visited yet. When the queue is empty, everything visited is
 * one connected network. Repeat from any source not yet visited to find the
 * next network. Each tile is visited at most once, so this is O(tiles).
 *
 * CAPACITY vs DEMAND, AND OUTAGES
 * -------------------------------
 * Each network adds up what its sources produce (capacity) and what its
 * connected buildings want (demand). If demand <= capacity, everyone is served.
 * If not, we hand out supply in the order buildings were reached by the
 * flood-fill (closest to a source first) until it runs out; the rest suffer an
 * OUTAGE and stop operating. That's why outages show up at the far end of a
 * long line first, which feels natural.
 */
import { coords, idx, inBounds, NEIGHBOURS, World } from './grid';
import { DEMAND, OIL_PLANT_OUTPUT, PLANT_OIL, POWER_OUTPUT, PUMP_STATION_OUTPUT, BIG_TOWER_OUTPUT, sizeUnits, UNFUELLED_OUTPUT, WATER_OUTPUT } from './rules';
import { Network, Tile, TileService } from './types';
import { applyGraphUtilities, graphOnly } from './graphutil';
import { Svc } from './services';

type Kind = 'power' | 'water';

/** V1.6: a recycling center burns garbage for power, so it is a power source like a plant. */
const isRecycler = (t: Tile) => t.structure === 'service' && t.kind === Svc.Recycling;

export function isSource(t: Tile, kind: Kind): boolean {
  return kind === 'power'
    ? t.structure === 'powerPlant' || t.structure === 'windTurbine' || t.structure === 'nuclearPlant' || isRecycler(t)
    : t.structure === 'waterTower' || t.structure === 'pumpStation';
}

function isConduit(t: Tile, kind: Kind): boolean {
  // PR 3 "auto power lines": every road carries a street-side pole line, so
  // roads are power conduits too. Connected roads form one power grid.
  return isSource(t, kind) || (kind === 'power' ? t.powerLine || t.road : t.waterPipe);
}

/**
 * What one source tile produces. Wind turbines scale with the wind (PR 3):
 * POWER_OUTPUT.windTurbine (1,000) is the output in a full gale (wind = 1).
 */
/**
 * V1.5b (Parker): the COAL plant is a 2×2 building. Like the nuclear plant
 * the anchor (top-left) tile has part 0 and the other three point at it
 * (part = anchor + 1). Pre-V1.5b 1×1 coal plants that had no room to grow
 * stay 1×1 ("legacy"); `isBigCoal` tells the two apart.
 */
export function isBigCoal(tiles: Tile[], i: number, N = GRID_SIZE): boolean {
  return tiles[i]?.kind === 0 && isBigPlant(tiles, i, N);
}
/** V1.6: the OIL plant is 2×2 as well (same anchor + 3 parts layout as coal). */
export function isBigOil(tiles: Tile[], i: number, N = GRID_SIZE): boolean {
  return tiles[i]?.kind === PLANT_OIL && isBigPlant(tiles, i, N);
}
/** Anchor tile of a 2×2 coal or oil plant. */
export function isBigPlant(tiles: Tile[], i: number, N = GRID_SIZE): boolean {
  const t = tiles[i];
  if (!t || t.structure !== 'powerPlant' || t.part) return false;
  const r = tiles[i + 1];
  return i % N < N - 1 && !!r && r.structure === 'powerPlant' && r.part === i + 1;
}

export function output(t: Tile, kind: Kind, wind: number): number {
  if (kind === 'water') return t.structure === 'pumpStation' ? PUMP_STATION_OUTPUT : t.kind === 1 ? BIG_TOWER_OUTPUT : WATER_OUTPUT; // V1.5b big tower
  if (t.part) return 0; // non-anchor tile of a 2×2 plant: the anchor counts the output
  if (isRecycler(t)) return POWER_OUTPUT.powerPlant ?? 0; // V1.6: same as a coal plant
  if (t.structure === 'windTurbine') return Math.round((POWER_OUTPUT.windTurbine ?? 0) * wind);
  // PR 4: a coal/oil plant with an empty fuel bunker limps along at reduced output (goods.ts).
  if (t.structure === 'powerPlant' && t.stock <= 0) return UNFUELLED_OUTPUT;
  // V1.5: an oil-fired plant (kind = PLANT_OIL) makes 4× a coal plant.
  if (t.structure === 'powerPlant' && t.kind === PLANT_OIL) return OIL_PLANT_OUTPUT;
  return POWER_OUTPUT[t.structure] ?? 0;
}

/** How much of this utility a tile wants right now (0 for non-buildings). */
export function demandOf(t: Tile, kind: Kind): number {
  if (t.zone === null || t.level === 0) return 0;
  return DEMAND[t.zone][kind] * sizeUnits(t); // PR 5: homes scale per resident
}

/** A consumer is anything zoned, plus water towers (they need power to pump). */
function isConsumer(t: Tile, kind: Kind): boolean {
  if (t.zone !== null) return true;
  return kind === 'power' && (t.structure === 'waterTower' || t.structure === 'pumpStation');
}

/** Water towers draw a small, fixed amount of power to run their pumps. */
const TOWER_PUMP_POWER = 4;

export interface NetworkResult {
  service: TileService[];
  power: Network[];
  water: Network[];
}

/**
 * Compute one utility. Returns the networks and, per tile, which network it
 * touches and whether it is actually served.
 * `pumpsOn` (water only) tells which towers have power; unpowered towers
 * produce nothing.
 */
function solve(
  world: World,
  kind: Kind,
  netOf: Int32Array,
  served: Uint8Array,
  pumpsOn?: Uint8Array,
): Network[] {
  const tiles = world.tiles;
  const visited = new Uint8Array(tiles.length);
  const networks: Network[] = [];

  // V1.6 A2: sources only exist in active chunks; ascending order = same network ids as before.
  for (const start of world.chunks.activeTilesSorted()) {
    if (visited[start] || !isSource(tiles[start], kind)) continue;

    // ---- Flood-fill one network starting from this source ----
    const id = networks.length;
    const net: Network = { id, capacity: 0, demand: 0, supplied: 0, outages: 0 };
    const queue: number[] = [start];
    const consumers: number[] = []; // in the order the fill reached them
    const consumerSeen = new Set<number>();
    visited[start] = 1;

    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const t = tiles[i];
      netOf[i] = id;
      served[i] = 1; // conduits and sources are always "live" when part of a network
      if (isSource(t, kind) && (!pumpsOn || pumpsOn[i])) net.capacity += output(t, kind, world.wind);

      const [x, z] = coords(i);
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = x + dx;
        const nz = z + dz;
        if (!inBounds(nx, nz)) continue;
        const n = idx(nx, nz);
        const nt = tiles[n];
        if (isConduit(nt, kind)) {
          // Keep spreading along the line/pipe.
          if (!visited[n]) {
            visited[n] = 1;
            queue.push(n);
          }
        } else if (isConsumer(nt, kind) && !consumerSeen.has(n)) {
          // A building beside the conduit: connected, but it doesn't spread further.
          consumerSeen.add(n);
          consumers.push(n);
          netOf[n] = id;
        }
      }
    }

    // ---- Share capacity out, nearest consumers first ----
    // PR 4: water pumps (towers / pump stations) are served FIRST. Otherwise a
    // small power shortage at the end of the line could switch off the pumps
    // and take the whole city's water down with it.
    if (kind === 'power') consumers.sort((a, b) => +(tiles[b].structure === 'waterTower' || tiles[b].structure === 'pumpStation') - +(tiles[a].structure === 'waterTower' || tiles[a].structure === 'pumpStation'));
    let remaining = net.capacity;
    for (const c of consumers) {
      const t = tiles[c];
      const want = kind === 'power' && t.structure === 'waterTower' ? TOWER_PUMP_POWER : kind === 'power' && t.structure === 'pumpStation' ? TOWER_PUMP_POWER * 5 : demandOf(t, kind);
      net.demand += want;
      if (want <= remaining) {
        remaining -= want;
        served[c] = 1;
      } else {
        // Not enough left for this building: it's in an outage.
        served[c] = 0;
        net.outages++;
      }
    }
    net.supplied = net.capacity - remaining;
    networks.push(net);
  }
  return networks;
}

/** Recompute both utilities for the whole map. Called every simulation tick. */
/**
 * The original from-scratch solver (V1.5b). Kept as the REFERENCE: the A3
 * equivalence tests compare the incremental computeNetworks() below with it
 * after random edit sequences.
 */
export function computeNetworksFull(world: World): NetworkResult {
  const n = world.tiles.length;
  const powerNet = new Int32Array(n).fill(-1);
  const waterNet = new Int32Array(n).fill(-1);
  const powered = new Uint8Array(n);
  const watered = new Uint8Array(n);

  // Power first, because water towers need power to pump.
  const power = solve(world, 'power', powerNet, powered);
  const water = solve(world, 'water', waterNet, watered, powered);

  const service: TileService[] = world.tiles.map((t, i) => {
    let roadAccess = false;
    const [x, z] = coords(i);
    for (const [dx, dz] of NEIGHBOURS) {
      if (inBounds(x + dx, z + dz) && world.at(x + dx, z + dz).road) roadAccess = true;
    }
    return {
      powerNet: powerNet[i],
      waterNet: waterNet[i],
      // An empty lot "is served" if it is connected and there'd be capacity; we
      // treat level-0 lots (demand 0) as served whenever connected.
      powered: powered[i] === 1 || (powerNet[i] >= 0 && isSource(t, 'power')),
      watered: watered[i] === 1 || (waterNet[i] >= 0 && isSource(t, 'water')),
      roadAccess,
    };
  });
  return { service, power, water };
}

/* ------------------------------------------------------------------------ *
 * V1.6 A3: INCREMENTAL NETWORKS
 *
 * The expensive part of solve() is the flood fill (which tiles belong to
 * which network, which consumers each network reaches and in what order).
 * That only depends on the TOPOLOGY: structures, roads, lines, pipes, zones —
 * exactly the fields chunks.ts folds into `topoRev`. The cheap part, adding
 * up capacity (wind changes it every tick, coal stock, pumps losing power)
 * and handing it out to consumers in order, depends on levels and wind.
 *
 * So computeNetworks():
 *   1. If topoRev moved since last time → flood fill again (buildTopology)
 *      and remember, per network, its sources and its ordered consumer list.
 *   2. Every tick → re-run only the allocation over those lists.
 * The result is identical to computeNetworksFull (tested), but a stable city
 * pays for a few hundred list entries instead of a flood over the map.
 *
 * `service` objects are created once per topology and UPDATED IN PLACE, so
 * a tick allocates no per-tile objects (V1.6 target T4).
 * ------------------------------------------------------------------------ */
interface NetTopo { sources: number[]; consumers: number[] }
interface Topo {
  rev: number;
  power: NetTopo[];
  water: NetTopo[];
  powerNet: Int32Array;
  waterNet: Int32Array;
  /** 1 for conduits/sources reached by a network: always "served". */
  conduitP: Uint8Array;
  conduitW: Uint8Array;
  service: TileService[];
  /** Persistent served flags: conduits fixed at 1, consumer entries rewritten every allocation. */
  servedP: Uint8Array;
  servedW: Uint8Array;
  /** Tiles whose powered/watered can change tick to tick (consumers). */
  watch: number[];
}
const topoCache = new WeakMap<World, Topo>();
/** Bumps whenever any tile's powered/watered flag flips (environment.ts keys land value on it). */
export const servedRev = new WeakMap<World, number>();

function floodTopology(world: World, kind: Kind, netOf: Int32Array, conduit: Uint8Array): NetTopo[] {
  const tiles = world.tiles, visited = new Uint8Array(tiles.length), out: NetTopo[] = [];
  for (const start of world.chunks.activeTilesSorted()) {
    if (visited[start] || !isSource(tiles[start], kind)) continue;
    const id = out.length, queue = [start], sources: number[] = [], consumers: number[] = [], seen = new Set<number>();
    visited[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], t = tiles[i];
      netOf[i] = id; conduit[i] = 1;
      if (isSource(t, kind)) sources.push(i);
      const x = i % GRID_SIZE, z = (i / GRID_SIZE) | 0;
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = x + dx, nz = z + dz;
        if (!inBounds(nx, nz)) continue;
        const n = idx(nx, nz), nt = tiles[n];
        if (isConduit(nt, kind)) { if (!visited[n]) { visited[n] = 1; queue.push(n); } }
        else if (isConsumer(nt, kind) && !seen.has(n)) { seen.add(n); consumers.push(n); netOf[n] = id; }
      }
    }
    // Same stable sort as solve(): pumps first on power networks.
    if (kind === 'power') consumers.sort((a, b) => +(tiles[b].structure === 'waterTower' || tiles[b].structure === 'pumpStation') - +(tiles[a].structure === 'waterTower' || tiles[a].structure === 'pumpStation'));
    out.push({ sources, consumers });
  }
  return out;
}

function buildTopology(world: World): Topo {
  const n = world.tiles.length, tiles = world.tiles;
  const powerNet = new Int32Array(n).fill(-1), waterNet = new Int32Array(n).fill(-1);
  const conduitP = new Uint8Array(n), conduitW = new Uint8Array(n);
  const power = floodTopology(world, 'power', powerNet, conduitP);
  const water = floodTopology(world, 'water', waterNet, conduitW);
  const watch = new Set<number>();
  for (const nt of power) for (const c of nt.consumers) watch.add(c);
  for (const nt of water) { for (const c of nt.consumers) watch.add(c); for (const s of nt.sources) watch.add(s); }
  const service: TileService[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % GRID_SIZE, z = (i / GRID_SIZE) | 0;
    const roadAccess = (x > 0 && tiles[i - 1].road) || (x < GRID_SIZE - 1 && tiles[i + 1].road) || (z > 0 && tiles[i - GRID_SIZE].road) || (z < GRID_SIZE - 1 && tiles[i + GRID_SIZE].road);
    const t = tiles[i];
    service[i] = {
      powerNet: powerNet[i], waterNet: waterNet[i],
      powered: conduitP[i] === 1 || (powerNet[i] >= 0 && isSource(t, 'power')),
      watered: conduitW[i] === 1 || (waterNet[i] >= 0 && isSource(t, 'water')),
      roadAccess,
    };
  }
  return { rev: world.chunks.topoRev, power, water, powerNet, waterNet, conduitP, conduitW, service, servedP: conduitP.slice(), servedW: conduitW.slice(), watch: [...watch].sort((a, b) => a - b) };
}

/** Hand capacity to consumers in order (the cheap half of solve()). */
function allocate(world: World, kind: Kind, nets: NetTopo[], served: Uint8Array, pumpsOn?: Uint8Array): Network[] {
  const tiles = world.tiles, out: Network[] = [];
  for (let id = 0; id < nets.length; id++) {
    const { sources, consumers } = nets[id];
    const net: Network = { id, capacity: 0, demand: 0, supplied: 0, outages: 0 };
    for (const s of sources) if (!pumpsOn || pumpsOn[s]) net.capacity += output(tiles[s], kind, world.wind);
    let remaining = net.capacity;
    for (const c of consumers) {
      const t = tiles[c];
      const want = kind === 'power' && t.structure === 'waterTower' ? TOWER_PUMP_POWER : kind === 'power' && t.structure === 'pumpStation' ? TOWER_PUMP_POWER * 5 : demandOf(t, kind);
      net.demand += want;
      if (want <= remaining) { remaining -= want; served[c] = 1; } else { served[c] = 0; net.outages++; }
    }
    net.supplied = net.capacity - remaining;
    out.push(net);
  }
  return out;
}

/** Incremental solver (see block comment above). Same answer as computeNetworksFull. */
export function computeNetworks(world: World): NetworkResult {
  let topo = topoCache.get(world);
  if (!topo || topo.rev !== world.chunks.topoRev) { topo = buildTopology(world); topoCache.set(world, topo); servedRev.set(world, (servedRev.get(world) ?? 0) + 1); }
  const servedP = topo.servedP, servedW = topo.servedW; // no per-tick allocation
  const power = allocate(world, 'power', topo.power, servedP);
  const water = allocate(world, 'water', topo.water, servedW, servedP);
  const tiles = world.tiles;
  let flipped = false;
  const gOnly = world.graphRoads ? graphOnly(world) : undefined; // OASIS: served by sim/graphutil.ts instead
  for (const i of topo.watch) {
    if (gOnly?.has(i)) continue;
    const s = topo.service[i], t = tiles[i];
    const p = servedP[i] === 1 || (topo.powerNet[i] >= 0 && isSource(t, 'power'));
    const w = servedW[i] === 1 || (topo.waterNet[i] >= 0 && isSource(t, 'water'));
    if (p !== s.powered || w !== s.watered) { s.powered = p; s.watered = w; flipped = true; }
  }
  if (flipped) servedRev.set(world, (servedRev.get(world) ?? 0) + 1);
  const res = { service: topo.service, power, water };
  // OASIS: graph worlds also connect buildings that only the free road's real
  // geometry reaches (sim/graphutil.ts). Bump servedRev when it connects any,
  // so served-dependent caches refresh.
  if (world.graphRoads && applyGraphUtilities(world, res)) servedRev.set(world, (servedRev.get(world) ?? 0) + 1);
  return res;
}
