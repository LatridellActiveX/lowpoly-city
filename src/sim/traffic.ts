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
import { hash2 } from './random';

// ---------------------------------------------------------------------------
// PR 5 VARIABLE TRAFFIC
// ---------------------------------------------------------------------------
// Real traffic isn't a conveyor belt. Each vehicle gets its own TRAITS,
// picked from a hash of (vehicle id, city seed) so the same city replays the
// same way (deterministic — no Math.random):
//   cruise   speed multiplier 0.8..1.2 (±20%); trucks are ×0.75 of a car
//   gap      following distance in tiles (timid drivers leave more room)
//   accel    how fast it speeds up (tiles/s²); trucks are heavier = slower
//   brake    how hard it can slow down (tiles/s²)
//   react    seconds before it pulls away after the light turns green
//   wobble   small sideways offset within the lane (renderer only)
// Vehicles now have a real SPEED `v` that ramps up/down with accel/brake
// instead of jumping straight to full speed. On top of that, roughly 1 in
// 20 vehicles is in a short "random slowdown" (distracted driver, looking
// for parking) at any moment: cruise ×0.5 for an 8-second window.
//
// TRAFFIC VOLUME follows the time of day: rushFactor() is a curve with
// morning (~08:00) and evening (~17:30) peaks and quiet nights, and the
// simulation multiplies its target number of commuter cars by it.

/** Game-seconds per in-game day at 1× and the time of day the clock starts at (0.3 ≈ 07:12). */
export const DAY_SECONDS = 3600;
export const DAY_START = 0.3;
/** Time of day 0..1 (0 = midnight) for a world clock. */
export const timeOfDay = (clock: number) => ((clock / DAY_SECONDS + DAY_START) % 1 + 1) % 1;

/**
 * Traffic volume multiplier for time of day t (0..1): ~0.15 at 03:00,
 * ~1.0 at the 08:00 and 17:30 rush hours, ~0.55 at midday. A base level
 * plus two Gaussian bumps.
 */
export function rushFactor(t: number): number {
  const h = t * 24;
  const bump = (centre: number, width: number) => Math.exp(-(((h - centre) / width) ** 2));
  const day = 0.5 * Math.max(0, Math.sin(((h - 6) / 16) * Math.PI)); // daytime base 06:00–22:00
  return Math.min(1, 0.12 + day + 0.55 * bump(8, 1.3) + 0.6 * bump(17.5, 1.5));
}

export interface DriverTraits {
  cruise: number;
  gap: number;
  accel: number;
  brake: number;
  react: number;
  wobble: number;
}

/** Deterministic traits for vehicle `id` in a city with `seed`. */
export function traitsFor(id: number, kind: VehicleKind, seed: number): DriverTraits {
  const r = (k: number) => hash2(id, k, seed + 7700);
  const truck = kind === 'truck';
  return {
    cruise: (0.8 + r(1) * 0.4) * (truck ? 0.75 : 1),
    gap: (truck ? 0.5 : 0.36) + r(2) * 0.16,
    accel: (truck ? 0.9 : 1.6) * (0.75 + r(3) * 0.5),
    brake: (truck ? 2.2 : 3.2) * (0.8 + r(4) * 0.4),
    react: 0.2 + r(5) * 0.9,
    wobble: (r(6) - 0.5) * 0.05,
  };
}

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
  /** PR 5: this driver's personality (see traitsFor). */
  traits: DriverTraits;
  /** PR 5: current speed in tiles per game-second (ramps with accel/brake). */
  v: number;
  /** PR 5: current acceleration (tiles/s², negative = braking) — the renderer uses it for brake lights and pitch. */
  acc: number;
  /** PR 5: seconds left before pulling away from a light that just went green. */
  waitGreen: number;
  /** V1.5 right on red: seconds this car has been stopped at the line on red. */
  rorWait?: number;
  /** V1.5: path segment on which this car committed to a right on red (it then keeps going). */
  rorSeg?: number;
}

export const STREET_COST = 1;
export const AVENUE_COST = 0.6;
/** Tiles per game-second. Avenues are faster. Trucks are a bit slower. */
const SPEED = { car: 1.5, truck: 1.1 } as const;
const AVENUE_SPEED_BONUS = 1.6;
/** (PR 5: the following gap is now per-driver, DriverTraits.gap.) */
/** PR 5: vehicle length in tiles (gaps are measured bumper to bumper). */
const CAR_LEN = 0.26;
/** PR 5: largest traffic sub-step in game-seconds (see Traffic.update). */
const SUBSTEP = 1 / 30;
/**
 * PR 5: where a vehicle's CENTRE waits on red — its front bumper (CAR_LEN/2
 * ahead) then rests on the painted stop line, which sits 0.455 tiles from
 * the approach tile's centre (t = 0.455), just behind the crosswalk.
 * (Was 0.62, i.e. inside the junction.)
 */
const STOP_LINE_T = 0.455;
/** Where a vehicle waits on red: 0.62 along the tile before the junction. */
const STOP_T = STOP_LINE_T - CAR_LEN / 2 - 0.01;
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
export function lightState(i: number, clock: number, sig?: Signals): { green: 'ns' | 'ew' | 'none'; amber: boolean } {
  // PR 6: traffic-actuated control when a controller is running (Signals).
  if (sig?.actuated) { const st = sig.state(i); if (st) return st; }
  const p = (clock + (i * 7.31) % LIGHT_CYCLE) % LIGHT_CYCLE;
  const half = LIGHT_CYCLE / 2;
  if (p < GREEN) return { green: 'ns', amber: p > GREEN - 1 };
  if (p < half) return { green: 'none', amber: false };
  if (p < half + GREEN) return { green: 'ew', amber: p > half + GREEN - 1 };
  return { green: 'none', amber: false };
}

/**
 * PR 6 TRAFFIC-ACTUATED SIGNALS (replaces the fixed 10 s cycle above).
 *
 * Each junction (3+ road neighbours: T or 4-way) runs a tiny state machine
 * over its two PHASES, 'ns' (approaches from north/south) and 'ew':
 *
 *     GREEN(phase) ──(decide to switch)──► AMBER 1 s ──► ALL-RED 0.8 s ──► GREEN(other)
 *
 * Every frame `update()` counts the QUEUE on each phase: vehicles whose next
 * tile is this junction and that are within the last 90 % of the approach
 * tile (waiting at, or rolling up to, the stop line). While green:
 *   - never switch before MIN_GREEN (5 s) — gives a platoon time to go;
 *   - EXTEND while cars keep arriving on the green phase (its queue > 0);
 *   - switch once the other phase's queue is LONGER than ours (after
 *     MIN_GREEN), or ours empties ("gap-out") while the other has cars;
 *   - force a switch at MAX_GREEN (30 s) if anyone is waiting on the other
 *     phase, and at any time once the other phase's oldest waiter has been
 *     red for MAX_WAIT (20 s) — starvation protection, so every waiting approach is served within ~22 s.
 * With nobody anywhere the light rests on its current green. A junction is
 * first seen with the phase that has the longer queue (longest queue first).
 * The AMBER + ALL-RED clearance and the per-approach signal heads (renderer)
 * are unchanged: the renderer just asks lightState() which phase is green.
 */
export const MIN_GREEN = 5;
export const MAX_GREEN = 30;
export const AMBER_TIME = 1;
export const ALL_RED_TIME = 0.8;
/** 20 s (not 40): must stay under the gridlock give-up timer STUCK_SECONDS (25 s) incl. amber + all-red, or queued drivers give up while waiting. */
export const MAX_WAIT = 20;

interface Ctl {
  phase: 'ns' | 'ew';
  mode: 'green' | 'amber' | 'red';
  /** Seconds in the current mode. */
  t: number;
  /** Seconds the other phase has had someone waiting (starvation timer). */
  starve: number;
  q: { ns: number; ew: number };
}

export class Signals {
  /** true = actuated (PR 6 default); false = PR 5 fixed timing (tests compare). */
  actuated = true;
  private ctl = new Map<number, Ctl>();
  /** Queue measurement + state machines. `dt` in game seconds. */
  update(tiles: Tile[], vehicles: Vehicle[], dt: number): void {
    if (!this.actuated) return;
    const q = new Map<number, { ns: number; ew: number }>();
    for (const v of vehicles) {
      const j = v.path[v.seg + 1];
      if (j === undefined || v.t < 0.1 || !isIntersection(tiles, j)) continue; // (stopped cars sit at t ≈ 0.36)
      const axis = Math.abs(j - v.path[v.seg]) === 1 ? 'ew' : 'ns';
      const e = q.get(j) ?? { ns: 0, ew: 0 };
      e[axis]++;
      q.set(j, e);
    }
    // Forget junctions that stopped being junctions (bulldozed roads).
    for (const j of this.ctl.keys()) if (!isIntersection(tiles, j)) this.ctl.delete(j);
    for (const [j, e] of q) if (!this.ctl.has(j)) this.ctl.set(j, { phase: e.ew > e.ns ? 'ew' : 'ns', mode: 'green', t: 0, starve: 0, q: e });
    for (const [j, c] of this.ctl) {
      c.q = q.get(j) ?? { ns: 0, ew: 0 };
      c.t += dt;
      const other = c.phase === 'ns' ? 'ew' : 'ns';
      if (c.mode === 'green') {
        const mine = c.q[c.phase], theirs = c.q[other];
        c.starve = theirs > 0 ? c.starve + dt : 0;
        const sw = theirs > 0 && (c.starve >= MAX_WAIT || c.t >= MAX_GREEN || (c.t >= MIN_GREEN && (theirs > mine || mine === 0)));
        if (sw) { c.mode = 'amber'; c.t = 0; }
      } else if (c.mode === 'amber' && c.t >= AMBER_TIME) { c.mode = 'red'; c.t = 0; }
      else if (c.mode === 'red' && c.t >= ALL_RED_TIME) { c.mode = 'green'; c.phase = other; c.t = 0; c.starve = 0; }
    }
  }
  /** Current light at junction i, or null if it has no controller yet (falls back to fixed timing). */
  state(i: number): { green: 'ns' | 'ew' | 'none'; amber: boolean } | null {
    const c = this.ctl.get(i);
    if (!c) return null;
    if (c.mode === 'red') return { green: 'none', amber: false };
    return { green: c.phase, amber: c.mode === 'amber' };
  }
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
/**
 * V1.5 RIGHT ON RED. Is a → j → c a RIGHT turn? Grid x runs east, z runs
 * south, traffic drives on the right. Heading (dx, dz) turned right is
 * (−dz, dx): e.g. north (0, −1) → east (1, 0).
 */
export function isRightTurn(a: number, j: number, c: number): boolean {
  const dx = (j % GRID_SIZE) - (a % GRID_SIZE), dz = Math.floor(j / GRID_SIZE) - Math.floor(a / GRID_SIZE);
  const ex = (c % GRID_SIZE) - (j % GRID_SIZE), ez = Math.floor(c / GRID_SIZE) - Math.floor(j / GRID_SIZE);
  return ex === -dz && ez === dx;
}
/** Full stop required before turning right on red (game seconds). */
export const ROR_STOP = 1.0;

function dirOf(a: number, b: number): number {
  const d = b - a;
  return d === 1 ? 0 : d === -1 ? 1 : d === GRID_SIZE ? 2 : 3;
}

const CAR_COLORS = [0xd94b3d, 0x3d7bd9, 0xf2f2f2, 0x2b2d31, 0xf2c14e, 0x4caf6a, 0x9aa1a8, 0x8e4fc1, 0xe0773a];

export class Traffic {
  vehicles: Vehicle[] = [];
  private nextId = 1;
  /** Counters for tests and the info panel. */
  stats = { spawned: 0, arrived: 0, gaveUp: 0, noRoute: 0, waitSec: 0, rightOnRed: 0 };
  /** V1.5: allow right turns on red after a full stop (tests switch it off to compare). */
  rightOnRed = true;
  /** PR 6 traffic-actuated signal controllers. */
  signals = new Signals();

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
    const traits = traitsFor(id, kind, world.seed);
    this.vehicles.push({ id, kind, path, seg: 0, t: 0, stuck: 0, purpose, onArrive, color: color ?? CAR_COLORS[id % CAR_COLORS.length], traits, v: 0, acc: 0, waitGreen: 0 });
    return true;
  }

  /** Move every vehicle by `dt` game-seconds. */
  /**
   * Move every vehicle by `dt` game-seconds.
   * PR 5: split into fixed sub-steps of at most 1/30 game-second, so the
   * car-following maths stays stable and motion stays smooth even at 3×
   * speed or after a slow frame (a 0.75 s jump would make cars teleport
   * and overshoot each other). The renderer reads positions every frame,
   * and since the sim advances continuously each frame there is nothing to
   * interpolate between — positions are always "now".
   */
  update(world: World, dt: number): void {
    if (dt <= 0) return;
    this.signals.update(world.tiles, this.vehicles, dt); // PR 6: actuated lights read the queues once per frame
    const n = Math.ceil(dt / SUBSTEP);
    for (let k = 0; k < n; k++) this.stepOnce(world, dt / n);
  }

  private stepOnce(world: World, dt: number): void {
    const tiles = world.tiles;
    // ---- Bucket vehicles by lane: (tile, direction) -> list of {progress, speed} ----
    const lanes = new Map<number, Array<{ t: number; v: number }>>();
    const laneOf = (v: Vehicle, seg: number) => v.path[seg] * 4 + dirOf(v.path[seg], v.path[seg + 1]);
    for (const v of this.vehicles) {
      const k = laneOf(v, v.seg);
      let l = lanes.get(k);
      if (!l) lanes.set(k, (l = []));
      l.push({ t: v.t, v: v.v });
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
    // V1.5: cars about to enter each junction (for the right-on-red gap check).
    const approaching = new Map<number, Vehicle[]>();
    for (const v of this.vehicles) {
      const a = v.path[v.seg], b = v.path[v.seg + 1];
      if (b === undefined) continue;
      if (v.t <= 0.5 && isIntersection(tiles, b)) { let l = approaching.get(b); if (!l) approaching.set(b, (l = [])); l.push(v); }
      // (Physically inside = past the tile edge, t > 0.5 — cars waiting between the stop line and the edge don't hold it.)
      if (v.t > 0.5 && isIntersection(tiles, b)) hold(b, v.id, dirOf(a, b));
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
      // PR 5: personal cruise speed, halved during a random slowdown window.
      const slow = hash2(v.id, Math.floor(world.clock / 8), world.seed + 7800) < 0.05 ? 0.5 : 1;
      const speed = SPEED[v.kind] * v.traits.cruise * slow * (cur.roadType === 1 && next.roadType === 1 ? AVENUE_SPEED_BONUS : 1);
      const GAP = v.traits.gap;
      const s0 = Math.max(0.06, GAP - CAR_LEN); // bumper-to-bumper standstill gap
      // `limit` = hard "never pass this" position; `obsPos/obsV` = nearest
      // obstacle ahead (a leader's rear bumper or a stop line) and its speed,
      // which feed the IDM car-following model below.
      let limit = Infinity;
      let obsPos = Infinity, obsV = 0;
      const lead = (pos: number, speedAhead: number) => {
        // PR 5: a "leader" whose rear is already behind our centre is an
        // overlap (two trips spawned on the same driveway tile). Ignore it —
        // otherwise both wait for each other forever. They separate naturally.
        if (pos < v.t - 0.02) return;
        limit = Math.min(limit, pos - GAP * 0.55);
        if (pos < obsPos) { obsPos = pos; obsV = speedAhead; }
      };
      // 1. Vehicle ahead in the same lane on this tile.
      for (const o of lanes.get(laneOf(v, v.seg))!) if (o.t > v.t + 1e-6) lead(o.t - CAR_LEN, o.v);
      // ...or just past the tile boundary in the next lane.
      if (v.seg + 2 < v.path.length) {
        const ahead = lanes.get(laneOf(v, v.seg + 1));
        if (ahead) for (const o of ahead) lead(1 + o.t - CAR_LEN, o.v);
      }
      const stopAt = () => {
        limit = Math.min(limit, STOP_T);
        // A stop line is a stationary obstacle; +s0 so IDM's desired gap
        // brings the car to rest exactly ON the line, not s0 short of it.
        const p = STOP_T + s0;
        if (p < obsPos) { obsPos = p; obsV = 0; }
      };
      // 2. Red light at the junction we're about to enter (the next tile).
      if (v.t <= STOP_T && isIntersection(tiles, v.path[v.seg + 1])) {
        const axis = Math.abs(v.path[v.seg + 1] - v.path[v.seg]) === 1 ? 'ew' : 'ns';
        const jn = v.path[v.seg + 1];
        const light = lightState(jn, world.clock, this.signals);
        // V1.5 RIGHT ON RED: only when this car's own route turns right here
        // (the path is A*'s, so "where its pathing takes it"). It must first
        // come to a full stop at the line for ROR_STOP seconds, then go only
        // on a gap: the junction box empty, no car entering it from the
        // approach whose light is green (they have right of way), and room
        // in the exit lane. Works with both fixed and queue-based signals —
        // the controller still counts this car in its queue until it leaves.
        const turnsRight = v.seg + 2 < v.path.length && isRightTurn(v.path[v.seg], jn, v.path[v.seg + 2]);
        let rorGo = v.rorSeg === v.seg && light.green !== axis; // already committed: keep going
        if (!rorGo && this.rightOnRed && light.green !== axis && turnsRight && light.green !== 'none') {
          const atLine = v.t > STOP_T - 0.05 && v.v < 0.05;
          v.rorWait = atLine ? (v.rorWait ?? 0) + dt : 0;
          if ((v.rorWait ?? 0) >= ROR_STOP) {
            const boxFree = !(inJunction.get(jn)?.some((h) => h.id !== v.id));
            const crossing = (approaching.get(jn) ?? []).some((o) => o.id !== v.id && (Math.abs(jn - o.path[o.seg]) === 1 ? 'ew' : 'ns') === light.green && (o.t > 0.25 || o.v > 0.2));
            const exit = lanes.get(laneOf(v, v.seg + 1));
            const room = !exit || !exit.some((o) => o.t < 0.6 && o.v < 0.3);
            rorGo = boxFree && !crossing && room;
          }
        } else v.rorWait = 0;
        if (rorGo) {
          if (v.rorSeg !== v.seg) { v.rorSeg = v.seg; this.stats.rightOnRed++; }
        } else if (light.green !== axis) {
          if (v.v < 0.05) this.stats.waitSec += dt; // PR 6: time spent waiting at red (tests)
          stopAt();
          // Waiting at red: arm the reaction delay for when it turns green.
          if (v.t > STOP_T - 0.05) v.waitGreen = v.traits.react;
        } else if (v.waitGreen > 0) {
          // PR 5: green now, but this driver takes a moment to react.
          v.waitGreen -= dt;
          stopAt();
        }
      }
      // 3. PR 5: yield to crossing traffic already inside the junction ahead.
      const jNext = v.path[v.seg + 1];
      const myDir = dirOf(v.path[v.seg], jNext);
      const enteringJunction = v.t <= STOP_T && isIntersection(tiles, jNext);
      if (enteringJunction) {
        const holders = inJunction.get(jNext);
        // After 8 s of waiting a driver edges in anyway (prevents rare
        // starvation/gridlock loops; the 25 s give-up stays as a last resort).
        const patient = v.stuck < 8;
        if (patient && holders && holders.some((h) => h.id !== v.id && !compatible(h.dir, myDir))) stopAt();
        // PR 5 "don't block the box": only enter if there's room to get
        // all the way through — no stationary/slow car near the start of the
        // lane we'll leave the junction by. Prevents junction gridlock.
        if (v.seg + 2 < v.path.length) {
          const exit = lanes.get(laneOf(v, v.seg + 1));
          if (patient && exit && exit.some((o) => o.t < 0.6 && o.v < 0.3)) stopAt();
        }
      }
      // ---- PR 5 IDM (Intelligent Driver Model) ----
      // The standard car-following model used in traffic research:
      //   a = A · [ 1 − (v/v0)^4 − (s*/s)^2 ]
      //   s* = s0 + v·T + v·Δv / (2·√(A·B))
      // v0 = desired speed, s = gap to the obstacle ahead, Δv = closing speed,
      // s0 = minimum standstill gap, T = time headway, A/B = comfortable
      // acceleration/braking. It gives smooth S-shaped speed-ups, early
      // gentle braking when closing in, and queues that start one car after
      // another (each waits for the gap in front to open).
      const A = v.traits.accel, Bk = v.traits.brake;
      const T = 0.5 + v.traits.react * 0.5;
      const gapS = obsPos - v.t;
      let acc = A * (1 - Math.pow(v.v / Math.max(speed, 0.05), 4));
      if (gapS < 6) {
        const sStar = s0 + Math.max(0, v.v * T + (v.v * (v.v - obsV)) / (2 * Math.sqrt(A * Bk)));
        acc -= A * (sStar / Math.max(gapS, 0.01)) ** 2;
      }
      acc = Math.max(acc, -Bk * 3); // physical braking limit
      v.v = Math.max(0, v.v + acc * dt);
      v.acc = acc;
      const want = v.t + v.v * dt;
      const nt = Math.max(v.t, Math.min(want, limit));
      if (nt < want) v.v = Math.min(v.v, (nt - v.t) / Math.max(dt, 1e-3)); // safety clamp hit: shed speed
      v.stuck = nt - v.t < 1e-4 ? v.stuck + dt : 0;
      // Crossed the stop line this frame? Then we hold the junction from now
      // on, so a crossing car later in this same loop has to wait for us.
      if (enteringJunction && nt > STOP_T && nt > 0.5) hold(jNext, v.id, myDir);
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
