/**
 * sim/truckBodies.ts — V1.5b stage B: which BODY a truck is drawn with.
 * Plain TS so tests can check it. Decided from the trip's `purpose` text
 * (goods.ts writes e.g. "fuel: oil", "delivery: plastics to …",
 * "export: stone"):
 *   tanker — liquids: oil, fuel, plastics (resin), chemicals
 *   dump   — bulk aggregate: stone (quarries), coal, iron ore (IND-5 mines)
 *   box    — everything else (the cargo-coloured box)
 * Service trucks (garbage, ambulance, construction crews) keep their own.
 */
export type TruckBody = 'tanker' | 'dump' | 'box';
const LIQUID = /\b(oil|fuel|plastics|chemicals)\b/;
const BULK = /\b(stone|coal|ore)\b/; // IND-5: mine ore rides in the dump body
export function truckBody(purpose: string): TruckBody {
  if (purpose.startsWith('garbage') || purpose.startsWith('ambulance') || purpose.startsWith('construction')) return 'box';
  if (BULK.test(purpose)) return 'dump'; // first: "fuel: imported coal" is a bulk load
  if (LIQUID.test(purpose)) return 'tanker';
  return 'box';
}
