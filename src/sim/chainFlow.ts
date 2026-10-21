/**
 * sim/chainFlow.ts — IND-2: who feeds whom (the Supply chain view).
 *
 * Plain TypeScript (no Three.js/DOM). goods.ts Shipping calls add() every
 * time it sends a truck from a producer to a CUSTOMER in the city: a
 * processor's hopper, a shop's shelves or a construction yard. Exports and
 * imports are not links (they leave / enter at the map edge).
 *
 * HOW MUCH IS FLOWING: each link keeps a running "loads lately" number that
 * fades with time, halving every HALF_LIFE ticks (game seconds). So a link
 * that ran a truck a minute ago counts for almost 1, one an hour ago for
 * nearly nothing. That is cheaper than keeping a list of every truck: one
 * number per link, updated only when a truck is sent or the view asks.
 *
 * SHORTAGES are worked out from the tiles when the view asks (shortages()):
 * a processor with an empty hopper and nothing on the way, an empty shop,
 * or a yard with no materials while sites wait.
 *
 * Not saved: it is a running picture, and it fills back up within minutes.
 */
import type { World } from './grid';
import type { GoodType } from './goods';

/** Ticks for a link's "loads lately" to halve (balance of how long arrows linger). */
export const HALF_LIFE = 300;
/** At most this many links are drawn (busiest first), so big maps stay quick. */
export const MAX_LINKS = 200;
/** Thresholds of "loads lately" for the arrow colour: ≥ GOOD green, ≥ WEAK yellow, below red (fading). */
export const FLOW_GOOD = 2, FLOW_WEAK = 0.6;

export interface Link {
  from: number;
  to: number;
  good: GoodType;
  /** Loads lately (fading), valid at tick `last`. */
  n: number;
  last: number;
  /** Every load ever sent on this link (tests compare it with truck counts). */
  total: number;
}

export class ChainFlow {
  links = new Map<string, Link>();
  /** A truck left `from` for customer `to` carrying `good`. */
  add(tick: number, from: number, to: number, good: GoodType): void {
    const k = `${from}>${to}>${good}`;
    let l = this.links.get(k);
    if (!l) this.links.set(k, (l = { from, to, good, n: 0, last: tick, total: 0 }));
    l.n = this.rate(l, tick) + 1; l.last = tick; l.total++;
  }
  /** A link's loads lately at `tick` (fades by half every HALF_LIFE ticks). */
  rate(l: Link, tick: number): number {
    return l.n * Math.pow(0.5, Math.max(0, tick - l.last) / HALF_LIFE);
  }
  /** The busiest links still alive at `tick` (rate ≥ 0.05), busiest first, at most `max`. Drops dead ones. */
  top(tick: number, max = MAX_LINKS): Array<Link & { rate: number }> {
    const out: Array<Link & { rate: number }> = [];
    for (const [k, l] of this.links) {
      const r = this.rate(l, tick);
      if (r < 0.05) { this.links.delete(k); continue; } // long dead: forget it
      out.push({ ...l, rate: r });
    }
    out.sort((a, b) => b.rate - a.rate);
    return out.slice(0, max);
  }
  /** Sum of `total` over all links still remembered (tests). */
  get loads(): number { let s = 0; for (const l of this.links.values()) s += l.total; return s; }
}

/** Colour band of a link: 'good' green, 'weak' yellow, 'low' red. */
export const band = (rate: number): 'good' | 'weak' | 'low' => (rate >= FLOW_GOOD ? 'good' : rate >= FLOW_WEAK ? 'weak' : 'low');

/**
 * Buildings short of what they need, right now. `isProcessor(i)` says if
 * industrial tile i has a recipe (chains.ts), `incoming(key)` mirrors
 * Shipping.isIncoming (−1 − i = a processor's hopper side).
 */
export function shortages(world: World, isProcessor: (i: number) => boolean, incoming: (key: number) => boolean): number[] {
  const out: number[] = [];
  let sites = 0;
  world.chunks.activeTilesSorted().forEach((i) => { const t = world.tiles[i]; if (t.zone && t.construct > 0 && t.crew) sites++; });
  world.chunks.activeTilesSorted().forEach((i) => {
    const t = world.tiles[i];
    if (t.zone === 'industrial' && t.level > 0 && t.construct === 0 && isProcessor(i)) { if (t.input < 0.5 && t.stock < 1 && !incoming(-1 - i)) out.push(i); }
    else if (t.zone === 'commercial' && t.level > 0 && t.kind !== 4 && t.stock <= 0 && !incoming(i)) out.push(i); // offices (kind 4) sell nothing
    else if (t.structure === 'constructionYard' && sites > 0 && t.stock <= 0 && !incoming(i)) out.push(i);
  });
  return out;
}
