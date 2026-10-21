/**
 * IND-10: regional contracts.
 *
 * Every 10–20 in-game days a neighbouring region offers a contract such as
 * "deliver 208 steel within 30 days for $25,000". The contract becomes active
 * at once (the player just has to keep exporting that good). Rules:
 *  - at most MAX_ACTIVE (2) contracts run at the same time — while 2 are
 *    running no new offer arrives (the timer simply waits);
 *  - progress counts every export truck of that good that ARRIVES (edge or
 *    depot), LOAD units per truck; the normal export price is still paid;
 *  - on completion the reward is paid on top; on expiry the contract just
 *    disappears — no penalty, by design.
 *  - only goods the city has actually exported (this session) are offered,
 *    so offers are always something the city can make.
 * State lives in world.contracts (saved; missing = none).
 */
import type { World } from './grid';
import { hash2 } from './random';

export const MAX_ACTIVE = 2;
export const OFFER_MIN = 100; // ticks (10 days)
export const OFFER_MAX = 200; // ticks (20 days)
export const DEADLINE = 300; // ticks (30 days)
export const UNIT = 16; // = goods.ts LOAD (kept local to avoid an import cycle)

export interface Contract {
  id: number;
  good: string;
  /** Units to deliver (multiple of UNIT). */
  need: number;
  /** Units delivered so far. */
  got: number;
  reward: number;
  /** Tick by which it must be done. */
  due: number;
}
export interface Contracts {
  active: Contract[];
  /** Tick of the next offer. */
  next: number;
  seq: number;
  done: number;
  expired: number;
}
export const emptyContracts = (): Contracts => ({ active: [], next: OFFER_MIN, seq: 0, done: 0, expired: 0 });

/**
 * Called once per tick. `exported` = goods exported so far; `price` = base
 * export price per load. Returns notices for the event feed.
 */
export function tickContracts(world: World, exported: Set<string>, price: Record<string, number>, names: Record<string, string>): string[] {
  const c = world.contracts, out: string[] = [];
  // Expire overdue contracts — silently costless (no penalty).
  for (const k of c.active.filter((x) => world.tick >= x.due)) {
    out.push(`📜 Contract for ${names[k.good] ?? k.good} expired (${k.got}/${k.need}). No penalty.`);
    c.expired++;
  }
  c.active = c.active.filter((x) => world.tick < x.due);
  if (world.tick < c.next) return out;
  // Schedule the next offer 10–20 days away, whether or not this one lands.
  const r = hash2(c.seq, world.tick, world.seed + 777);
  c.next = world.tick + OFFER_MIN + Math.floor(r * (OFFER_MAX - OFFER_MIN + 1));
  const goods = [...exported].filter((g) => price[g] && !c.active.some((x) => x.good === g)).sort();
  if (c.active.length >= MAX_ACTIVE || !goods.length) return out;
  const good = goods[Math.floor(hash2(c.seq + 1, world.tick, world.seed + 778) * goods.length) % goods.length];
  const loads = 8 + Math.floor(hash2(c.seq + 2, world.tick, world.seed + 779) * 9); // 8..16 truckloads
  // Reward ≈ twice the normal export value + a $5,000 bonus, rounded to $500.
  const reward = Math.round((loads * price[good] * 2 + 5000) / 500) * 500;
  const k: Contract = { id: ++c.seq, good, need: loads * UNIT, got: 0, reward, due: world.tick + DEADLINE };
  c.active.push(k);
  out.push(`📜 New regional contract: deliver ${k.need} ${names[good] ?? good} within 30 days for $${reward.toLocaleString()}.`);
  return out;
}

/** An export truck of `good` arrived: count it toward the oldest matching contract; pays the reward on completion. */
export function deliver(world: World, good: string, notices?: string[]): void {
  const c = world.contracts;
  const k = c.active.find((x) => x.good === good);
  if (!k) return;
  k.got = Math.min(k.need, k.got + UNIT);
  if (k.got < k.need) return;
  world.cash += k.reward;
  world.ledger.trade.contracts = (world.ledger.trade.contracts ?? 0) + k.reward;
  c.active = c.active.filter((x) => x !== k);
  c.done++;
  notices?.push(`✅ Contract complete: ${k.need} ${good} delivered, $${k.reward.toLocaleString()} paid.`);
}

/** Validate a saved contracts object (missing / malformed = none). */
export function loadContracts(d: unknown): Contracts {
  const c = emptyContracts();
  if (!d || typeof d !== 'object') return c;
  const o = d as Partial<Contracts>;
  const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  c.next = num(o.next, c.next); c.seq = num(o.seq, 0); c.done = num(o.done, 0); c.expired = num(o.expired, 0);
  if (Array.isArray(o.active)) c.active = o.active.filter((x) => x && typeof x.good === 'string' && typeof x.need === 'number' && typeof x.due === 'number').slice(0, MAX_ACTIVE)
    .map((x) => ({ id: num(x.id, 0), good: x.good, need: x.need, got: num(x.got, 0), reward: num(x.reward, 0), due: x.due }));
  return c;
}
