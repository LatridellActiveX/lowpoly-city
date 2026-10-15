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
    id: '2026-10-15-j',
    title: 'Clean intersections and real roundabouts',
    date: '2026-10-15',
    changes: [
      { tag: 'improved', text: 'Intersections are rebuilt as proper junctions: roads stop at the junction edge, a single smooth plate fills the middle and kerbs and sidewalks wrap round rounded corners. No more overlapping sidewalks, flicker or lane dashes through the middle.' },
      { tag: 'improved', text: 'Crosswalks and stop lines sit just outside every junction, including Y, curved, five-way and avenue-to-road junctions.' },
      { tag: 'new', text: 'Roundabouts are drawn as a round road around a planted island, with sidewalks broken where each road enters.' },
    ],
  },
  {
    id: '2026-10-15-g',
    title: 'Freeform road polish and square zoning',
    date: '2026-10-15',
    changes: [
      { tag: 'improved', text: 'Placing a freeform road now shows an outline the exact width of the road (kerb to kerb, with end caps), and a ring of that size at your cursor before you start, like Cities: Skylines.' },
      { tag: 'improved', text: 'Much smoother snapping: the preview glides to junctions and roads, stays locked on them until you move clearly away, and the 15° angle snap is a soft magnet instead of hard steps. A small ring marks what you are snapped to.' },
      { tag: 'new', text: 'Zoning freeform roads is a drag tool: drag a rectangle over the small zone squares beside a road and every square inside it is zoned (limited by the Depth setting). The squares light up as you drag.' },
    ],
  },
  {
    id: '2026-10-15-i',
    title: 'Version 1.6.0',
    date: '2026-10-15',
    changes: [
      { tag: 'improved', text: 'The game now reports its version as 1.6.0 to match the freeform roads and bigger maps update.' },
    ],
  },
  {
    id: '2026-10-15-h',
    title: 'Smooth curves',
    date: '2026-10-15',
    changes: [
      { tag: 'fix', text: 'A curved road placed in a new city stays one smooth road with its junctions, instead of being covered by a staircase of small straight road pieces.' },
    ],
  },
  {
    id: '2026-10-15-g',
    title: 'Free roads carry the real city',
    date: '2026-10-15',
    changes: [
      { tag: 'new', text: "The cars and trucks on your roads are now the city's real trips: commuters, people moving in, deliveries, freight and garbage and service trucks all find their way along the road network's lanes, curves and junctions." },
      { tag: 'new', text: 'Trips start and end at each building\'s own frontage, so homes on a curved road really drive along that curve.' },
      { tag: 'improved', text: 'New cities use the new road network from the start: roads built with the Road, Avenue and Roundabout tools join it automatically, with traffic lights at junctions (right on red included) and roundabouts where cars yield to the ring.' },
      { tag: 'improved', text: 'Power and water reach buildings along a curved road even where they only touch the road at a corner.' },
      { tag: 'fix', text: 'Editing a road while cars are driving no longer loses their trips: anyone on the road when it changes finishes their journey.' },
    ],
  },
  {
    id: '2026-10-15-f',
    title: 'Cleaner menus',
    date: '2026-10-15',
    changes: [
      { tag: 'improved', text: 'All map views (power, water, pollution, zoning…) now live in one dropdown behind the round 👁 view-menu button.' },
      { tag: 'improved', text: 'Power and Water are merged into a single Utilities toolbar menu with Power and Water sections.' },
      { tag: 'new', text: 'The ☰ menu has a Main menu entry: it saves your city and takes you back to the title screen (use Continue to resume).' },
      { tag: 'improved', text: 'Bridges are automatic: drag a road across water and it bridges. The separate Bridge row is gone from the Roads menu.' },
    ],
  },
  {
    id: '2026-10-15-e',
    title: 'Version 1.6: freeform roads and bigger maps',
    date: '2026-10-15',
    changes: [
      { tag: 'new', text: 'Freeform roads: draw straight or curved roads that snap to existing roads, with junctions wherever they cross. Undo and redo work too.' },
      { tag: 'new', text: 'Zoning now comes off the roads: while you drag a road, a see-through grid shows the zoning cells it will create on each side.' },
      { tag: 'new', text: 'Bigger maps: choose 64, 128 or 192 tiles across. You start with a few regions and can buy neighbouring ones for $30,000 each from the Regions panel.' },
      { tag: 'improved', text: 'Roads are wider and more detailed, so cars fit in their lanes: curbs, sidewalks, crosswalks, drains and thinner dashed lines.' },
      { tag: 'improved', text: 'Much faster simulation: only built-up parts of the map are updated, power, water and coverage recalculate only when something changes, month-end work is spread out, and only the visible parts of the map are drawn.' },
      { tag: 'improved', text: 'Saves move to version 10 with the new road layout. Older saves convert automatically and keep their buildings, population and traffic.' },
    ],
  },
  {
    id: '2026-10-15-d',
    title: 'Oil plant and recycling checks',
    date: '2026-10-15',
    changes: [
      { tag: 'fix', text: 'Fixed the automated checks for the 2×2 Oil Plant (they now unlock it at the Town tier, as the game does) and for landfill trucks hauling to a Recycling Center (the center now sits on a road). Gameplay is unchanged.' },
    ],
  },
  {
    id: '2026-10-15-c',
    title: 'Roundabouts',
    date: '2026-10-15',
    changes: [
      { tag: 'improved', text: 'Roundabouts have a much more detailed island: cobbled apron, kerb stones, flower beds, hedges, a big tree, rocks and chevron boards facing each entry.' },
      { tag: 'new', text: 'Painted counter-clockwise arrows on the ring, give-way markings and a roundabout sign at every entry, so the direction of travel is clear.' },
      { tag: 'fix', text: 'Cars now follow a smooth circle around the island, and two roundabouts built side by side both keep counter-clockwise traffic (the ring remembers its own corners).' },
    ],
  },
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
