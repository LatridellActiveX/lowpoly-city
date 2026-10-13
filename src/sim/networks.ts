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
import { DEMAND, POWER_OUTPUT, UNFUELLED_OUTPUT, WATER_OUTPUT } from './rules';
import { Network, Tile, TileService } from './types';

type Kind = 'power' | 'water';

function isSource(t: Tile, kind: Kind): boolean {
  return kind === 'power'
    ? t.structure === 'powerPlant' || t.structure === 'windTurbine'
    : t.structure === 'waterTower';
}

function isConduit(t: Tile, kind: Kind): boolean {
  // PR 3 "auto power lines": every road carries a street-side pole line, so
  // roads are power conduits too. Connected roads form one power grid.
  return isSource(t, kind) || (kind === 'power' ? t.powerLine || t.road : t.waterPipe);
}

/**
 * What one source tile produces. Wind turbines scale with the wind (PR 3):
 * POWER_OUTPUT.windTurbine (15) is the output in a full gale (wind = 1).
 */
export function output(t: Tile, kind: Kind, wind: number): number {
  if (kind === 'water') return WATER_OUTPUT;
  if (t.structure === 'windTurbine') return Math.round((POWER_OUTPUT.windTurbine ?? 0) * wind);
  // PR 4: a coal/oil plant with an empty fuel bunker limps along at reduced output (goods.ts).
  if (t.structure === 'powerPlant' && t.stock <= 0) return UNFUELLED_OUTPUT;
  return POWER_OUTPUT[t.structure] ?? 0;
}

/** How much of this utility a tile wants right now (0 for non-buildings). */
export function demandOf(t: Tile, kind: Kind): number {
  if (t.zone === null || t.level === 0) return 0;
  return DEMAND[t.zone][kind] * t.level;
}

/** A consumer is anything zoned, plus water towers (they need power to pump). */
function isConsumer(t: Tile, kind: Kind): boolean {
  if (t.zone !== null) return true;
  return kind === 'power' && t.structure === 'waterTower';
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

  for (let start = 0; start < tiles.length; start++) {
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
    let remaining = net.capacity;
    for (const c of consumers) {
      const t = tiles[c];
      const want = kind === 'power' && t.structure === 'waterTower' ? TOWER_PUMP_POWER : demandOf(t, kind);
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
export function computeNetworks(world: World): NetworkResult {
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
