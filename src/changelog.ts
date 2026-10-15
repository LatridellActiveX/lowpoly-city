/**
 * changelog.ts — the in-game CHANGE LOG.
 *
 * Add a new entry at the TOP of CHANGELOG for every update you ship. `id` must be
 * unique and change with each entry (it is what the game remembers as "last seen"):
 * after an update, the first time a player starts the new version a "What's new"
 * screen opens showing every entry they haven't seen yet. The screen can always be
 * reopened from the title screen or the ☰ menu.
 */
export type ChangeTag = 'new' | 'improved' | 'balance' | 'fix';

export interface ChangeEntry {
  /** Unique, increasing (compared only for equality with the last-seen id). */
  id: string;
  /** Shown as the entry heading. */
  title: string;
  /** ISO date (yyyy-mm-dd). */
  date: string;
  changes: Array<{ tag: ChangeTag; text: string }>;
}

export const CHANGELOG: ChangeEntry[] = [
  {
    id: '2026-10-15-b',
    title: 'Services, power and polish',
    date: '2026-10-15',
    changes: [
      { tag: 'new', text: 'In-game change log: this screen opens after an update, and you can reopen it from the title screen or the ☰ menu.' },
      { tag: 'new', text: 'Police Station is now a detailed 2×2 building (old 1×1 stations grow to 2×2 when loaded, if there is room).' },
      { tag: 'new', text: 'Recycling Center now burns garbage to make power — 5,000, same as a coal plant — and runs 12 garbage trucks, double a landfill. Some landfill trucks haul garbage over to a recycling center to be burned, which frees up landfill space.' },
      { tag: 'improved', text: 'Farms have more detailed models (barns, silos, fences, tractors, haystacks, crop rows).' },
      { tag: 'improved', text: 'Cars are more detailed (windows, wheels, lights, bumpers, roof shapes).' },
    ],
  },
  {
    id: '2026-10-15-a',
    title: 'Landfills, oil plants and schools',
    date: '2026-10-15',
    changes: [
      { tag: 'new', text: 'Landfill (2×2, animated): a compactor works the pile and gulls circle. The model changes as it fills (6 stages) and a full landfill stops taking trucks until you build a new one.' },
      { tag: 'new', text: 'Recycling Center: cuts the garbage nearby buildings make. Unlocks at 2,500 people.' },
      { tag: 'new', text: 'Oil Plant is now a detailed 2×2 refinery-style plant; the Elementary School is a 2×2 too.' },
      { tag: 'improved', text: 'Quarry model rebuilt with a terraced rock face, haul road, crusher plant, stockpiles and vehicles.' },
      { tag: 'improved', text: 'Oil pumpjack derrick no longer has floating pieces; the coal plant cooling towers are solid.' },
      { tag: 'balance', text: 'Police Station and High School unlock at 2,500 people, and crime now starts at 2,500 people too.' },
      { tag: 'balance', text: 'Coal Plant output 2,000 → 5,000. Wind Turbine output up to 1,000.' },
    ],
  },
];

export const CHANGELOG_LATEST = CHANGELOG[0].id;
