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
    // HOTFIX: update reload on a big map kept the 64-tile ground, so clicks did nothing (main.ts fitSceneToMap).
    id: '2026-10-16-oasis-hotfix-build-after-update',
    title: 'Building works again after an update',
    date: '2026-10-16',
    changes: [
      { tag: 'fix', text: 'On bigger maps, clicking to build roads, zones or buildings did nothing after the game updated itself. Building works right after an update again.' },
    ],
  },
  {
    // OASIS: Inspect traffic diagnostics (sim/trafficInspect.ts, ui/trafficPanel.ts, render/stuckOverlay.ts).
    id: '2026-10-16-oasis-inspect-traffic-diagnostics',
    title: 'Inspect traffic: junctions, roads and stuck cars',
    date: '2026-10-16',
    changes: [
      { tag: 'new', text: 'Inspect a junction to see its ID, type, connected roads with lanes in and out, which lanes can turn where (missing connections are flagged in red), the traffic light phase and time left, cars queued per approach and the longest wait.' },
      { tag: 'new', text: 'Inspect a road to see its ID, end junctions, type, length, lanes each way, cars on it, average speed and how many are stuck. Inspect a car to see its trip, road, lane, next junction, route left and how long it has been waiting.' },
      { tag: 'new', text: 'A "Show stuck cars" button (with the Inspect tool) rings every car that has not moved for over 10 seconds in red and the junctions they are stuck at in orange, with a live count. Click any ID like "node 42" to copy it.' },
    ],
  },
  {
    // OASIS zoning UI cleanup: one short hint + segmented density control.
    id: '2026-10-16-oasis-zoning-ui-declutter',
    title: 'Tidier zoning bar',
    date: '2026-10-16',
    changes: [
      { tag: 'improved', text: 'Zoning shows one short hint, "Drag to zone · Click for one square", next to a compact Density switch, instead of long overlapping text. Hover a zone button for the full explanation.' },
    ],
  },
  {
    // NEBULA: top-bar power/water showed raw floats (1184.3000000000002/5930).
    // Descriptive id so it can't collide with other workers' letter ids.
    id: '2026-10-15-hud-amount-format',
    title: 'Cleaner power and water numbers',
    date: '2026-10-15',
    changes: [
      { tag: 'fix', text: 'Power and water in the top bar (and the inspect network line, graphs tip and debug-load text) no longer show long floating-point leftovers like 1184.3000000000002 — they round to a whole number with commas, or one decimal when the value is under 10.' },
    ],
  },
  {
    // NEBULA rectangle zoning (descriptive id: can't collide with letter ids).
    id: '2026-10-15-zone-rectangle',
    title: 'Zoning: drag a rectangle',
    date: '2026-10-15',
    changes: [
      { tag: 'new', text: 'Zoning is now one simple rectangle: press on one corner and drag to the opposite corner. Every free small square inside gets zoned; a click zones a single small square.' },
      { tag: 'new', text: 'Beside curved or angled roads the rectangle follows the road — along it and away from it — so zones line up with the road instead of making a staircase.' },
      { tag: 'improved', text: 'Squares in the rectangle that cannot be zoned (road, water, buildings, too far from a road) show red, and the tip shows the size, squares, price and how many are skipped.' },
      { tag: 'improved', text: 'Zone colours on empty land now show only while a zoning tool is selected (or in the Zoning overlay), so the normal view stays clean.' },
      { tag: 'improved', text: 'The old zoning depth buttons and road-following strips are gone — the rectangle is the only way to zone.' },
    ],
  },
  {
    // NEBULA: merged the latest origin/models (descriptive id: no collisions).
    id: '2026-10-15-models-merge',
    title: 'New buildings arrive on nebula',
    date: '2026-10-15',
    changes: [
      { tag: 'improved', text: 'This version includes the new homes, shops, offices and industry (and their three new goods) together with the junction, power line, traffic light, zoning and power fixes.' },
    ],
  },
  {
    // NEBULA: Parker's "not enough capacity" with a turbine at 16/645. A
    // descriptive id so it can't collide with other workers' letter ids.
    id: '2026-10-15-power-graphonly-fix',
    title: 'Power fix: lots past the junction',
    date: '2026-10-15',
    changes: [
      { tag: 'fix', text: 'Lots beside a road past a junction no longer show "no power — not enough capacity" while the power plant has plenty to spare. A lot that got its water through the road network had its power status frozen after the city changed.' },
      { tag: 'improved', text: '"Not enough capacity" now only appears when the network really is short; anything else says "connected but not delivered" so it can be reported.' },
    ],
  },
  {
    // NEBULA favicon. Descriptive id so it can't collide with other workers' ids.
    id: '2026-10-15-favicon',
    title: 'Browser tab icon',
    date: '2026-10-15',
    changes: [
      { tag: 'new', text: 'The game now has its own low-poly icon (a house and a pine tree on a grass tile) in browser tabs, bookmarks and on phone home screens.' },
    ],
  },
  {
    // NEBULA zoning highlight fix (descriptive id: can't collide with letter ids).
    id: '2026-10-15-zoneangles',
    title: 'Zoning highlight matches what you zone',
    date: '2026-10-15',
    changes: [
      { tag: 'fix', text: 'The zoning highlight now sits exactly on the squares under your cursor from every camera angle — it no longer slides off them when the camera is low.' },
      { tag: 'fix', text: 'The highlight now also shows the thin strip by the kerb that gets zoned too, so the highlighted squares (and the count) are exactly what you get.' },
    ],
  },
  {
    // NEBULA debug codes. A descriptive id (not a letter) so it can't collide
    // with letter ids other workers add on nebula at the same time.
    id: '2026-10-15-debugcode',
    title: 'Debug codes',
    date: '2026-10-15',
    changes: [
      { tag: 'new', text: '☰ Menu → 🐞 Debug code: "Copy debug code" turns your whole city (roads, buildings, zoning, power and water, money and time) into one line of text you can paste into a bug report.' },
      { tag: 'new', text: '"Load debug code" opens a city from a pasted code, so a reported problem can be reproduced exactly.' },
    ],
  },
  {
    // From origin/models (5cc753c). Its id was '2026-10-15-o', which nebula already
    // uses (renumbered zoning entry), so it got a descriptive id in the merge.
    id: '2026-10-15-models-more-buildings',
    title: 'More homes, shops and industry',
    date: '2026-10-15',
    changes: [
      { tag: 'new', text: 'Five new homes: hacienda, terraced townhouses, modern house, garden towers and the sky residence.' },
      { tag: 'new', text: 'New shops and offices: supermarket, petrol station, pharmacy & clinic, hotel, multiplex cinema, department store, outlet mall, office tower and business park.' },
      { tag: 'new', text: 'New industry: brewery, pharmaceutical lab, clothing factory, cold storage, industrial park and mega-factory, each with its own model.' },
      { tag: 'new', text: 'Three new goods - clothing, medicine and beverages - with new factory types that make them (clothing factory from plastics, pharmaceutical lab from crude oil, brewery from food). Shops now sell clothing and medicine, and grocers take beverages.' },
      { tag: 'improved', text: 'Commercial buildings of every kind (shops, mixed-use, offices) and factories with food plants now merge together into the bigger footprints: a row of corner shops and a law firm can become a mall or business park, and small factories become industrial parks and mega-factories.' },
    ],
  },
  {
    id: '2026-10-15-n',
    title: 'Faster update checks',
    date: '2026-10-15',
    changes: [
      { tag: 'improved', text: 'The game now checks for a new version every minute instead of every 5 minutes.' },
    ],
  },
  {
    id: '2026-10-15-m',
    title: 'Fix: roads cut off at a junction after editing it',
    date: '2026-10-15',
    changes: [
      { tag: 'fix', text: 'Building a junction on a road you had edited before (for example the road in from the outside connection) now joins it properly. The new street used to hang off a leftover point instead, so power lines, traffic and street poles stopped at that junction.' },
      { tag: 'fix', text: 'Bulldozing or rebuilding a road tile at a junction no longer cuts the streets beyond it out of the road network.' },
      { tag: 'fix', text: 'Cities saved with leftover junction points are cleaned up when you load them.' },
      { tag: 'improved', text: 'The power and water views now colour the streets too, so you can see how far the network reaches past every junction.' },
    ],
  },
  {
    id: '2026-10-15-q',
    title: 'Power & water grid view',
    date: '2026-10-15',
    changes: [
      { tag: 'new', text: 'New 🔌 Power & water grid view (view menu): a yellow power line and a blue water line run along every road, turning red where that network is overloaded and grey where it is not connected to any plant, tower or pump. Buildings show green when served, red without power, orange without water; plants, towers and pumps are highlighted.' },
    ],
  },
  {
    id: '2026-10-15-p',
    title: 'Freeform road zoning, power and traffic fixes',
    date: '2026-10-15',
    changes: [
      { tag: 'fix', text: 'Zones painted on freeform roads now actually grow: they were missing from the growth, power and water systems, so some residential areas stayed empty or showed "not enough capacity". They now connect to the power and water grid like any other zoned land.' },
      { tag: 'fix', text: 'Zones on roads that do not line up with the old tile grid no longer leave an unzoned strip beside the road that blocked buildings; the gap is filled automatically.' },
      { tag: 'improved', text: 'Cars and trucks on freeform roads now use the full detailed vehicle models (two-tone roofs, spinning wheels, brake lights, garbage / tanker / dump trucks) instead of plain placeholder boxes.' },
      { tag: 'improved', text: 'Hovering over zoning squares on a freeform road now highlights, before you drag, the whole strip a click would zone (to the Depth setting), in that zone\'s colour.' },
      { tag: 'improved', text: 'Zoning preview and tooltip show what you are zoning: the squares take that zone\'s colour and the tooltip names it (e.g. Residential · medium).' },
    ],
  },
  {
    id: '2026-10-15-k',
    title: 'Power lines, water mains and working traffic lights',
    date: '2026-10-15',
    changes: [
      { tag: 'new', text: 'Streets now have power poles with sagging wires, every couple of tiles on the sidewalk and wired round each corner. Power lines from your plants connect into them, so you can follow the power from the plant into town. Wires fade out when you zoom far out.' },
      { tag: 'new', text: 'In the water view (and while placing pipes), a water main runs under every road and joins your pipes, towers and pumps, matching the real water network.' },
      { tag: 'new', text: 'Signalled junctions have a traffic light for every approach, showing the live red, amber and green the cars actually obey. Turning right on red works as before.' },
      { tag: 'fix', text: 'Junctions, roundabouts and avenues in older cities converted to the new road system get the same clean junctions.' },
    ],
  },
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
    id: '2026-10-15-o',
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
