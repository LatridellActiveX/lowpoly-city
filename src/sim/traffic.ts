/**
 * sim/traffic.ts — PR 4 cars and trucks.
 *
 * VEHICLES ARE SHORT-LIVED: a vehicle is created for one trip (commute,
 * delivery, move-in), follows a path of ROAD tiles, and is removed when it
 * arrives. Vehicles are not saved; deliveries already in flight are lost on
 * reload (the factory simply ships again later), and families still driving
 * in move in immediately on load (PR 5, Tile.movingIn).
 *
 * PATHFINDING: A* ("A-star")
 * --------------------------
 * A* finds the cheapest route on the road grid. It keeps a priority queue of
 * tiles to explore, ordered by   f = g + h:
 *     g = cost of the best route found so far from the start to this tile
 *     h = an optimistic GUESS of the remaining cost (here Manhattan distance
 *         × the cheapest per-tile cost, so it never over-estimates — that's
 *         what guarantees A* still finds the cheapest route)
 * It always expands the tile with the smallest f next, so it heads toward the
 * goal instead of flooding the whole map like a plain breadth-first search.
 * Each step costs STREET_COST on a street and AVENUE_COST on an avenue, so
 * routes prefer avenues when they're not much longer.
 *
 * MOVEMENT
 * --------
 * A vehicle is "on segment k" travelling from path[k] to path[k+1], with
 * progress `t` (0..1). Each frame `t` grows by speed × dt. Three things can
 * hold it back:
 *   1. The car in front: vehicles in the same LANE (tile + travel direction)
 *      keep a GAP. We bucket vehicles by lane every update so this check is
 *      cheap.
 *   2. Traffic lights: every road tile with 3+ road neighbours is an
 *      intersection with a timed light (see lightGreen()). A vehicle about to
 *      enter one on a red axis stops at STOP_T.
 *   3. PR 5 JUNCTION OCCUPANCY: a vehicle that's inside an intersection
 *      "holds" it. Another vehicle may only enter (pass STOP_T) if every
 *      holder is travelling the same way or the exact opposite way (those
 *      lanes don't cross). Crossing or turning traffic waits at the stop
 *      line, so cars queue instead of driving through each other.
 *   4. If a vehicle has been stuck for STUCK_SECONDS (gridlock), it gives up
 *      and is removed — its arrival callback still runs, so deliveries aren't
 *      lost.
 * Positions are interpolated between tile centres; the renderer adds the
 * right-hand lane offset and smooths the turn at corners.
 */
import { GRID_SIZE, Tile } from './types';
import { World } from './grid';

export type VehicleKind = 'car' | 'truck';

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  /** Road tile indices from start to destination. */
  path: number[];
  /** Current segment (path[seg] -> path[seg+1]). */
  seg: number;
  /** Progress along the segment 0..1. */
  t: number;
  /** Seconds spent not moving (for gridlock clean-up). */
  stuck: number;
  /** Paint colour (cars) or cargo colour (trucks). */
  color: number;
  /** Free text for the info/debug view: "commute", "delivery: food", ... */
  purpose: string;
  /** Called once on arrival (deliveries, move-ins). */
  onArrive?: () => void;
}

export const STREET_COST = 1;
export const AVENUE_COST = 0.6;
/** Tiles per game-second. Avenues are faster. Trucks are a bit slower. */
const SPEED = { car: 1.5, truck: 1.1 } as const;
const AVENUE_SPEED_BONUS = 1.6;
/** Minimum distance (in tiles) to the vehicle ahead in the same lane. */
const GAP = 0.42;
/** Where a vehicle waits on red: 0.62 along the tile before the junction. */
const STOP_T = 0.62;
const STUCK_SECONDS = 25;
/** Traffic light cycle (game seconds): NS green, all-red, EW green, all-red. */
export const LIGHT_CYCLE = 10;
const GREEN = 4.4;

export const isIntersection = (tiles: Tile[], i: number): boolean => {
  const x = i % GRID_SIZE, z = Math.floor(i / GRID_SIZE);
  let n = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, nz = z + dz;
    if (nx >= 0 && nz >= 0 && nx < GRID_SIZE && nz < GRID_SIZE && tiles[nz * GRID_SIZE + nx].road) n++;
  }
  return n >= 3;
};

/**
 * Light state at intersection i at game time `clock`: which axis is green.
 * Each junction gets an offset from its index so a whole avenue doesn't
 * switch in lockstep. Returns 'ns' | 'ew' | 'none' (all red) and, for the
 * renderer, whether the green is in its last second (amber).
 */
export function lightState(i: number, clock: number): { green: 'ns' | 'ew' | 'none'; amber: boolean } {
  const p = (clock + (i * 7.31) % LIGHT_CYCLE) % LIGHT_CYCLE;
  const half = LIGHT_CYCLE / 2;
  if (p < GREEN) return { green: 'ns', amber: p > GREEN - 1 };
  if (p < half) return { green: 'none', amber: false };
  if (p < half + GREEN) return { green: 'ew', amber: p > half + GREEN - 1 };
  return { green: 'none', amber: false };
}

/** Tiny binary min-heap keyed by f (for A*). */
class Heap {
  private a: number[] = [];
  private f: number[] = [];
  get size(): number {
    return this.a.length;
  }
  push(v: number, f: number): void {
    const a = this.a, F = this.f;
    a.push(v); F.push(f);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= F[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [F[p], F[i]] = [F[i], F[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a, F = this.f;
    const top = a[0];
    const lastV = a.pop()!, lastF = F.pop()!;
    if (a.length) {
      a[0] = lastV; F[0] = lastF;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && F[l] < F[m]) m = l;
        if (r < a.length && F[r] < F[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [F[m], F[i]] = [F[i], F[m]];
        i = m;
      }
    }
    return top;
  }
}

/** A* over road tiles. Returns the list of tile indices, or null if unreachable. */
export function findPath(tiles: Tile[], start: number, goal: number): number[] | null {
  if (!tiles[start]?.road || !tiles[goal]?.road) return null;
  if (start === goal) return [start];
  const N = GRID_SIZE;
  const g = new Float32Array(N * N).fill(Infinity);
  const from = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  const gx = goal % N, gz = Math.floor(goal / N);
  const h = (i: number) => (Math.abs((i % N) - gx) + Math.abs(Math.floor(i / N) - gz)) * AVENUE_COST;
  const open = new Heap();
  g[start] = 0;
  open.push(start, h(start));
  while (open.size) {
    const i = open.pop();
    if (i === goal) {
      const path = [goal];
      for (let k = from[goal]; k !== -1; k = from[k]) path.push(k);
      return path.reverse();
    }
    if (closed[i]) continue; // a stale heap entry (we found a cheaper way earlier)
    closed[i] = 1;
    const x = i % N, z = Math.floor(i / N);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const n = nz * N + nx;
      const t = tiles[n];
      if (!t.road || closed[n]) continue;
      const cost = g[i] + (t.roadType === 1 ? AVENUE_COST : STREET_COST);
      if (cost < g[n]) {
        g[n] = cost;
        from[n] = i;
        open.push(n, cost + h(n));
      }
    }
  }
  return null;
}

/** First road tile next to tile i (where a building's driveway meets the street), or -1. */
export function roadNextTo(tiles: Tile[], i: number): number {
  if (tiles[i].road) return i;
  const x = i % GRID_SIZE, z = Math.floor(i / GRID_SIZE);
  for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    const nx = x + dx, nz = z + dz;
    if (nx >= 0 && nz >= 0 && nx < GRID_SIZE && nz < GRID_SIZE && tiles[nz * GRID_SIZE + nx].road) return nz * GRID_SIZE + nx;
  }
  return -1;
}

/** Direction index 0..3 (E, W, S, N) of a step between two neighbouring tiles. */
function dirOf(a: number, b: number): number {
  const d = b - a;
  return d === 1 ? 0 : d === -1 ? 1 : d === GRID_SIZE ? 2 : 3;
}

const CAR_COLORS = [0xd94b3d, 0x3d7bd9, 0xf2f2f2, 0x2b2d31, 0xf2c14e, 0x4caf6a, 0x9aa1a8, 0x8e4fc1, 0xe0773a];

export class Traffic {
  vehicles: Vehicle[] = [];
  private nextId = 1;
  /** Counters for tests and the info panel. */
  stats = { spawned: 0, arrived: 0, gaveUp: 0, noRoute: 0 };

  count(kind: VehicleKind): number {
    let n = 0;
    for (const v of this.vehicles) if (v.kind === kind) n++;
    return n;
  }

  /**
   * Start a trip between two ROAD tiles. Returns false (and spawns nothing)
   * if there's no route. Single-tile trips arrive immediately.
   */
  spawn(world: World, kind: VehicleKind, from: number, to: number, purpose: string, color?: number, onArrive?: () => void): boolean {
    const path = findPath(world.tiles, from, to);
    if (!path) {
      this.stats.noRoute++;
      return false;
    }
    this.stats.spawned++;
    if (path.length < 2) {
      onArrive?.();
      this.stats.arrived++;
      return true;
    }
    const id = this.nextId++;
    this.vehicles.push({ id, kind, path, seg: 0, t: 0, stuck: 0, purpose, onArrive, color: color ?? CAR_COLORS[id % CAR_COLORS.length] });
    return true;
  }

  /** Move every vehicle by `dt` game-seconds. */
  update(world: World, dt: number): void {
    if (dt <= 0) return;
    const tiles = world.tiles;
    // ---- Bucket vehicles by lane: (tile, direction) -> list of progress values ----
    const lanes = new Map<number, number[]>();
    const laneOf = (v: Vehicle, seg: number) => v.path[seg] * 4 + dirOf(v.path[seg], v.path[seg + 1]);
    for (const v of this.vehicles) {
      const k = laneOf(v, v.seg);
      let l = lanes.get(k);
      if (!l) lanes.set(k, (l = []));
      l.push(v.t);
    }
    // ---- PR 5: who is inside each intersection right now ----
    // A vehicle is physically inside junction J during the last part of the
    // segment INTO J (t > STOP_T) and the first half of the segment OUT of J.
    // We record its travel direction there (0..3 = E, W, S, N).
    const inJunction = new Map<number, Array<{ id: number; dir: number }>>();
    const hold = (j: number, id: number, dir: number) => {
      let l = inJunction.get(j);
      if (!l) inJunction.set(j, (l = []));
      l.push({ id, dir });
    };
    for (const v of this.vehicles) {
      const a = v.path[v.seg], b = v.path[v.seg + 1];
      if (b === undefined) continue;
      if (v.t > STOP_T && isIntersection(tiles, b)) hold(b, v.id, dirOf(a, b));
      if (v.t < 0.5 && v.seg > 0 && isIntersection(tiles, a)) hold(a, v.id, dirOf(v.path[v.seg - 1], a));
    }
    /** Opposite directions: E↔W (0,1) and S↔N (2,3) — straight-through lanes that never cross. */
    const compatible = (d1: number, d2: number) => d1 === d2 || (d1 >> 1 === d2 >> 1);
    const done: Vehicle[] = [];
    for (const v of this.vehicles) {
      const cur = tiles[v.path[v.seg]];
      const next = tiles[v.path[v.seg + 1]];
      if (!cur?.road || !next?.road) {
        // The road was bulldozed under us: finish the trip "off screen".
        done.push(v);
        continue;
      }
      const speed = SPEED[v.kind] * (cur.roadType === 1 && next.roadType === 1 ? AVENUE_SPEED_BONUS : 1);
      let limit = Infinity;
      // 1. Vehicle ahead in the same lane on this tile.
      for (const other of lanes.get(laneOf(v, v.seg))!) if (other > v.t + 1e-6) limit = Math.min(limit, other - GAP);
      // ...or just past the tile boundary in the next lane.
      if (v.seg + 2 < v.path.length) {
        const ahead = lanes.get(laneOf(v, v.seg + 1));
        if (ahead) for (const other of ahead) limit = Math.min(limit, 1 + other - GAP);
      }
      // 2. Red light at the junction we're about to enter (the next tile).
      if (v.t <= STOP_T && isIntersection(tiles, v.path[v.seg + 1])) {
        const axis = Math.abs(v.path[v.seg + 1] - v.path[v.seg]) === 1 ? 'ew' : 'ns';
        if (lightState(v.path[v.seg + 1], world.clock).green !== axis) limit = Math.min(limit, STOP_T);
      }
      // 3. PR 5: yield to crossing traffic already inside the junction ahead.
      const jNext = v.path[v.seg + 1];
      const myDir = dirOf(v.path[v.seg], jNext);
      const enteringJunction = v.t <= STOP_T && isIntersection(tiles, jNext);
      if (enteringJunction) {
        const holders = inJunction.get(jNext);
        if (holders && holders.some((h) => h.id !== v.id && !compatible(h.dir, myDir))) limit = Math.min(limit, STOP_T);
      }
      const want = v.t + speed * dt;
      const nt = Math.max(v.t, Math.min(want, limit));
      v.stuck = nt - v.t < 1e-4 ? v.stuck + dt : 0;
      // Crossed the stop line this frame? Then we hold the junction from now
      // on, so a crossing car later in this same loop has to wait for us.
      if (enteringJunction && nt > STOP_T) hold(jNext, v.id, myDir);
      v.t = nt;
      if (v.stuck > STUCK_SECONDS) {
        this.stats.gaveUp++;
        done.push(v);
        continue;
      }
      while (v.t >= 1) {
        v.t -= 1;
        v.seg++;
        if (v.seg >= v.path.length - 1) {
          done.push(v);
          break;
        }
      }
    }
    if (done.length) {
      const gone = new Set(done);
      this.vehicles = this.vehicles.filter((v) => !gone.has(v));
      for (const v of done) {
        this.stats.arrived++;
        v.onArrive?.();
      }
    }
  }
}
