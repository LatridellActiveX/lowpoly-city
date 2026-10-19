/**
 * sim/roadnet.ts — which road tiles are connected to which.
 *
 * `roadComponents` labels every road tile with the id (1, 2, …) of its connected
 * network (4-neighbour flood fill over tiles with `road`); non-road tiles get 0.
 * The label is cached for a few ticks because roads change rarely and the fill
 * touches every road tile. Used by garbage collection and the garbage coverage
 * overlay: a landfill serves every building whose street is on its network.
 */
import { GRID_SIZE } from './types';
import type { World } from './grid';

const cache = new WeakMap<World, { tick: number; size: number; label: Int32Array }>();
/** How many ticks a labelling may be reused (roads are rarely edited, and a stale label only delays a pickup). */
const REUSE_TICKS = 5;

export function roadComponents(world: World): Int32Array {
  const hit = cache.get(world);
  if (hit && hit.size === world.tiles.length && world.tick - hit.tick >= 0 && world.tick - hit.tick < REUSE_TICKS) return hit.label;
  const N = GRID_SIZE, tiles = world.tiles;
  const label = new Int32Array(tiles.length);
  const stack: number[] = [];
  let next = 0;
  for (let s = 0; s < tiles.length; s++) {
    if (!tiles[s].road || label[s]) continue;
    next++;
    label[s] = next;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!, x = i % N, z = (i - x) / N;
      if (x > 0 && tiles[i - 1].road && !label[i - 1]) { label[i - 1] = next; stack.push(i - 1); }
      if (x < N - 1 && tiles[i + 1].road && !label[i + 1]) { label[i + 1] = next; stack.push(i + 1); }
      if (z > 0 && tiles[i - N].road && !label[i - N]) { label[i - N] = next; stack.push(i - N); }
      if (z < N - 1 && tiles[i + N].road && !label[i + N]) { label[i + N] = next; stack.push(i + N); }
    }
  }
  cache.set(world, { tick: world.tick, size: tiles.length, label });
  return label;
}
