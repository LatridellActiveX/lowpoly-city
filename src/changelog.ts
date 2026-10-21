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
    // IND-7: services.ts Svc.Warehouse (tool 'warehouse', $12,000, 2,000 people, reach 20), world.warehouses saved per good; goods.ts warehousePickups (shops / yards / processors restocked first), factory drop-off step 2b, no import when a warehouse in reach holds the good; svc9 model = existing warehouse model; hud stock panel; industryctl.test IND-7.
    id: '2026-10-20-oasis-ind7-warehouse',
    title: 'Warehouses',
    date: '2026-10-20',
    changes: [
      { tag: 'new', text: 'New 🏬 Warehouse in the Industry menu ($12,000, unlocks at 2,000 people). It stores up to 400 of every good.' },
      { tag: 'new', text: 'Factories within 20 tiles drop off loads there when no shop or factory needs them right away. Shops, Construction Yards and factories within 20 tiles are restocked from the warehouse first, so fewer trucks run half-empty and fewer goods are imported.' },
      { tag: 'improved', text: 'Click a warehouse to see what it holds. Its stock is saved with your city.' },
    ],
  },
  {
    // keeptraffic.test: split-street tolerance 8 m → 18 m (one real car/truck place, safe-gap lengths); failing since OASIS-S6 changed the traffic snapshot. Test-only, no game change.
    id: '2026-10-20-oasis-keeptraffic-test-fix',
    title: 'Traffic test fix',
    date: '2026-10-20',
    changes: [
      { tag: 'fix', text: 'Fixed a traffic test that had been failing since the busier everyday traffic. When a new road splits a street, waiting cars can now move up by one car or truck length. The game itself is unchanged.' },
    ],
  },
  {
    // IND-6: sim/recycleMode.ts (mode on the center's tile.recipe, saved; '' = power only), garbage.ts burn() adds 8 per 100 garbage to tile.stock, networks.ts output ×0.8 in a product mode, goods.ts ships recycler stock through the factory loop, factoryCtl clearIfGone skips service tiles; hud Makes dropdown; industryctl.test IND-6.
    id: '2026-10-20-oasis-ind6-recycling-products',
    title: 'Recycling centers make products',
    date: '2026-10-20',
    changes: [
      { tag: 'new', text: 'The recycling center panel has a new Makes dropdown with Power only, Plastics or Building materials. In a product mode, every 100 garbage burned also makes 8 plastics or 8 building materials, and the center makes 20% less power.' },
      { tag: 'improved', text: 'Recycled products go out by truck like any factory\'s goods: plastics to factories that use them, building materials to Construction Yards and hardware stores, and any surplus is exported.' },
      { tag: 'improved', text: 'Existing recycling centers stay on Power only, so old saves work exactly as before.' },
    ],
  },
  {
    // IND-5: resources.ts Resource.Ore (after every other patch, ORE_THRESHOLD 0.84) + oreMask (no ore under pre-existing industry; mines marked tile.recipe='mine'); chains.ts mine / steelMill / vehiclePlant (RecipeDef.needs second ingredient), ROLE_TIER (mine 2, vehiclePlant 3), materials takes steel; goods.ts ore/steel/vehicles prices 180/480/900, Shipping.second hopper, steelYards → growth.ts +20% build speed; car_dealer sells vehicles; mineModel + heavy steel/assembly reused; Resources view ore colour; industryctl.test IND-5.
    id: '2026-10-20-oasis-ind5-ore-steel-vehicles',
    title: 'Ore, steel and vehicles',
    date: '2026-10-20',
    changes: [
      { tag: 'new', text: 'Iron ore patches now appear on the map, shown in rust red in the Resources view. They are rarer than quarries and only on land that had no other resource, so none of your existing buildings change what they make.' },
      { tag: 'new', text: 'Industry zoned on ore becomes an ore mine once you reach 2,000 people. Factories can pick two new recipes: steel mill (ore → steel) and, once you reach 10,000 people, vehicle plant (steel + plastics → vehicles).' },
      { tag: 'new', text: 'Car dealerships now sell vehicles. Export prices per load are $180 for ore, $480 for steel and $900 for vehicles.' },
      { tag: 'improved', text: 'Building-materials plants accept steel instead of stone. Construction Yards stocked with steel-based materials build 20% faster.' },
      { tag: 'improved', text: 'Mines and steel mills have their own 3D models. Ore travels in dump trucks.' },
    ],
  },
  {
    id: '2026-10-20-oasis-vr',
    title: 'VR mode for Meta Quest 3',
    date: '2026-10-20',
    changes: [
      { tag: 'new', text: 'Tabletop VR for Meta Quest 3 and other WebXR headsets: open the game in the headset browser (https) and press 🥽 Enter VR. The city floats on a table in front of you.' },
      { tag: 'new', text: 'Right laser + trigger uses the current tool exactly like the mouse (drag to draw roads, zones and bulldoze boxes). The left-hand panel has the tool tabs, pause / 1× / 2× / 3×, undo / redo, view buttons, your cash, people and time, and an info line. Left Y/X hides it.' },
      { tag: 'new', text: 'Left stick pans, right stick turns the table (left/right) and zooms (up/down), and either grip grabs and drags the map. Right A pauses; right B picks Inspect. Hand tracking works too (pinch to click; use the panel\'s View tab).' },
      { tag: 'improved', text: 'In the Meta Quest browser (outside VR) the thumbsticks, which arrive as scrolling, now pan the map instead of zooming, and + / - buttons appear for zoom.' },
      { tag: 'new', text: 'Outside VR, the left stick of a connected gamepad or controller now pans the map (press any button once so the browser sees it).' },
      { tag: 'new', text: 'In VR, the Inspect tool opens an info window floating next to the asset, turned toward you. Point at it and pull the trigger to close it.' },
      { tag: 'improved', text: 'The VR panel also shows jobs, power and water meters and the R / C / I demand bars. The laser now stops at the panel and shows a cursor dot where it lands.' },
      { tag: 'improved', text: 'VR runs lighter so it stays smooth: no shadows, lighter building models, a slightly lower render resolution, and the panel and HUD refresh less often.' },
    ],
  },
  {
    // IND-4: factoryCtl.ts POLICIES on world.policies (saved, missing = off); eco → pollutionMult ×0.7 + runningCostShare +0.15; night → outputMult ×1.25, goods.ts nightShiftTrucks (≤1 per building, 22:00–06:00), environment.ts −0.05 desirability for homes within 4 tiles of a factory; Budget panel checkboxes; industryctl.test IND-4.
    id: '2026-10-20-oasis-ind4-industrial-policies',
    title: 'Industrial policies',
    date: '2026-10-20',
    changes: [
      { tag: 'new', text: 'The Budget panel has a new Industrial policies section with two city-wide switches. 🌿 Eco standards makes all industry pollute 30% less, but factories earn 15% less profit.' },
      { tag: 'new', text: '🌙 Night shifts makes every factory produce 25% more. Factories also run trucks at night (at most one extra per building), and homes near factories are 5% less happy.' },
      { tag: 'improved', text: 'Policies are saved with your city, and older saves start with both off. Turning a policy off undoes its effects right away.' },
    ],
  },
  {
    // IND-3: factoryCtl.ts UPG bits on tile.upg (shift / automation / filters), applied in goods.ts (output, running cost), industry.ts jobsOf (workers), networks.ts demandOf (power), environment.ts (pollution); hud Upgrades buttons; industryctl.test IND-3.
    id: '2026-10-20-oasis-ind3-factory-upgrades',
    title: 'Factory upgrades',
    date: '2026-10-20',
    changes: [
      { tag: 'new', text: 'Factories, mines and farms now have an Upgrades row in their Inspect panel. Second shift ($3,000) gives +50% output and hires 30% more workers. Automation ($6,000, unlocks at the City tier) gives +30% output with 40% fewer workers but uses 50% more power. Filters ($2,000) cut the pollution by 60% and add 10% to running costs.' },
      { tag: 'improved', text: 'A building can have all three upgrades, and they stack. They are kept when you save and load, and lost if the building is bulldozed.' },
    ],
  },
  {
    // IND-2: sim/chainFlow.ts (producer → customer links, fading "loads lately", shortages), goods.ts records each delivery truck, render/chainOverlay.ts arrows + red rings, 🔗 Supply chain view; tools/industryctl.test.ts IND-2 block.
    id: '2026-10-20-oasis-ind2-supply-chain-view',
    title: 'Supply chain view',
    date: '2026-10-20',
    changes: [
      { tag: 'new', text: 'A new 🔗 Supply chain view in the View menu draws an arrow from each factory to the business it trucks goods to: another factory, a shop or a construction yard. Green arrows are busy links, yellow ones carry some goods, and red ones have had almost no trucks lately.' },
      { tag: 'new', text: 'Buildings that are short of what they need get a pulsing red ring: a factory with an empty hopper and nothing on the way, an empty shop, or a construction yard without materials while sites wait.' },
      { tag: 'improved', text: 'The view only draws the 200 busiest links, so it stays quick on the biggest maps.' },
    ],
  },
  {
    // IND-1: sim/factoryCtl.ts (recipe picker, $500 switch, 30 s retool), tile fields recipe/pause/upg (save v11, no migration), chains.ts roleOf honours the pick, ui/hud.ts Recipe dropdown; tools/industryctl.test.ts.
    id: '2026-10-20-oasis-ind1-factory-panel',
    title: 'Choose what a factory makes',
    date: '2026-10-20',
    changes: [
      { tag: 'new', text: 'Click a factory with Inspect to pick its recipe from the new Recipe list, for example turn a toy factory into a print works. Auto keeps the old behaviour, where the factory picks for itself. Your choice is kept when you save and load.' },
      { tag: 'balance', text: 'Switching a recipe costs $500, and the factory makes nothing for 30 seconds while the line is retooled. Its hopper is emptied, because the old inputs no longer fit. Going back to Auto is free.' },
      { tag: 'improved', text: 'Logging camps, oil rigs, quarries, farms and food plants make what their land or zone says, so they have no recipe list.' },
    ],
  },
  {
    // OASIS-S6: sim/traffic.ts rushFactor night floor 0.12 → 0.2, day 0.5 → 0.55, morning bump 0.55 → 0.6; sim/settings.ts maxCars 75 → 100 + one-time migration (trafficRev); tools/everyday.test.ts.
    id: '2026-10-19-oasis-s6-more-everyday-traffic',
    title: 'More everyday traffic',
    date: '2026-10-19',
    changes: [
      { tag: 'balance', text: 'There are more cars about outside rush hour. Nights are no longer almost empty: a steady trickle of cars keeps driving. Midday is busier too, at about 70% of rush-hour traffic instead of 55%. The morning rush now reaches the same peak as the evening one.' },
      { tag: 'balance', text: 'The default Max cars setting goes from 75 to 100, so the extra traffic shows up in towns of a thousand people or more. If you never changed the setting it moves to 100 once. A value you chose yourself is kept, and you can still lower it in Settings for slower computers.' },
    ],
  },
  {
    // OASIS-S5: roads/junctions.ts Taper / TAPER_M / taperBlend / edgeTapers on straight degree-2 nodes of different width; render/graphRoads.ts extrude halfAt/medAt in 1 m slices; roads/gtraffic.ts lanePoint follows the taper; tools/junctions.test.ts.
    id: '2026-10-19-oasis-s5-avenue-street-taper',
    title: 'Avenues narrow smoothly into streets',
    date: '2026-10-19',
    changes: [
      { tag: 'improved', text: 'Where an avenue carries straight on as an ordinary street, it no longer steps abruptly from four lanes to two. Over its last 30 metres the avenue narrows in a smooth curve: the kerbs and sidewalks bend in to meet the street\'s, the double yellow median closes to a point, and the two lanes on each side merge into one.' },
      { tag: 'improved', text: 'Cars follow the narrowing road too, gliding over into the single lane instead of driving off the edge of the street. The same smooth narrowing applies wherever a wider road runs straight on as a narrower one, for example a highway into an avenue.' },
    ],
  },
  {
    // OASIS-S4: sim/environment.ts parkReach (road BFS ≤ PARK_ROAD_REACH + fronting lots) replaces the 10×10 square; rules.ts PARK_ROAD_REACH / PARK_FRONT_DEPTH; main.ts park preview; ui/tools.ts hint; tools/parkroads.test.ts.
    id: '2026-10-19-oasis-s4-parks-serve-by-road',
    title: 'Parks serve the streets they are on',
    date: '2026-10-19',
    changes: [
      { tag: 'improved', text: 'A park now makes homes more desirable along the roads next to it, up to 12 road tiles away, much like garbage collection follows the road network. Homes far down the same street now benefit, while a block across a river with no bridge no longer does.' },
      { tag: 'improved', text: 'The bonus fades gently with the distance along the road, and every lot up to 4 tiles back from a reached street shares it. A park in the middle of a block reaches the streets of its block, and a park with no road at all still helps its direct neighbours.' },
      { tag: 'improved', text: 'When you place a park, the preview highlights every road and lot it will reach.' },
    ],
  },
  {
    // OASIS-S3: roads/gtraffic.ts actuated controller (stepSignals, phaseDemand, MIN/MAX_GREEN, amber) replaces the fixed timer; render/graphUtilities.ts amber lamp; sim/trafficInspect.ts + ui/trafficPanel.ts show it; tools/actuated.test.ts.
    id: '2026-10-19-oasis-s3-demand-actuated-lights',
    title: 'Traffic lights react to waiting cars',
    date: '2026-10-19',
    changes: [
      { tag: 'improved', text: 'Traffic lights are no longer on a fixed timer. A light stays green while cars are using it, and when a car pulls up to a red light with nobody on the other roads it turns green for it after a short all-red, instead of making it wait out the cycle.' },
      { tag: 'improved', text: 'Busy junctions still take turns fairly: a green lasts at least 5 seconds and at most 20 seconds while another road is waiting, then shows amber before switching.' },
      { tag: 'improved', text: 'The traffic inspector shows the new amber and all-red steps, which road is next, and when a light is resting on green because nobody else is waiting.' },
    ],
  },
  {
    // OASIS-S2: roads/graph.ts beforeChange hook, roads/gtraffic.ts takeSnapshot/adopt, sim/livegraph.ts adopts instead of finishAll; tools/keeptraffic.test.ts.
    id: '2026-10-19-oasis-s2-keep-traffic-on-road-edits',
    title: 'Building roads no longer clears traffic',
    date: '2026-10-19',
    changes: [
      { tag: 'fix', text: 'Building a road that connects to an existing road no longer makes every car on the map disappear. Cars on roads you did not touch stay exactly where they are, and cars on the road you joined onto stay on it and simply plan a new route. This also works for undo and redo.' },
      { tag: 'improved', text: 'Only a car whose road you actually bulldozed (or that has no way to its destination any more) finishes its trip on the spot, as before, so no delivery or commuter is ever lost.' },
    ],
  },
  {
    // OASIS-S1: ui/menu.ts Save city / Load city items (hud.ts top-bar buttons removed); render/industryModels.ts YARD_TRUCK_SLOTS + parkedCrewTruckModel; tools/menuyard.test.ts.
    id: '2026-10-19-oasis-s1-menu-save-yard-trucks',
    title: 'Save & Load in the menu, 8 trucks in the yard',
    date: '2026-10-19',
    changes: [
      { tag: 'improved', text: 'Save and Load have moved into the ☰ menu at the top left (Save city / Load city), so the top bar is less crowded. The New button stays where it was.' },
      { tag: 'improved', text: 'Construction Yards now show all 8 of their crew trucks parked in painted bays. Every truck that drives out to a building site leaves an empty bay until it comes back, so you can see at a glance how busy a yard is.' },
    ],
  },
  {
    // OASIS-SAFEGAP: roads/gtraffic.ts safe-gap car following, real model lengths, junction slot checks; tools/safegap.test.ts.
    id: '2026-10-16-oasis-safegap-traffic',
    title: 'Smoother traffic: cars keep a safe gap',
    date: '2026-10-16',
    changes: [
      { tag: 'improved', text: 'Cars now keep a safe distance from the car in front. They speed up gently, brake smoothly, and only drive as fast as they could still stop behind the car ahead. Traffic moves evenly instead of bunching up.' },
      { tag: 'fix', text: 'Cars and trucks no longer drive into or through each other. The traffic now knows how long every model really is, and drivers also watch the car that has just turned in front of them.' },
      { tag: 'improved', text: 'At junctions a car only enters when its path is clear and there is room for its whole length on the road it is turning into. If not, it waits at the stop line. Cars only pick a lane where there is room for them, and cars pulling out wait for a gap in the traffic.' },
    ],
  },
  {
    id: '2026-10-16-oasis-garbage-depot',
    title: 'Garbage across the whole road network',
    date: '2026-10-16',
    changes: [
      { tag: 'improved', text: 'Landfills and recycling centers now serve every building on their connected roads, anywhere on the map, instead of a fixed radius. The garbage view shows the served buildings.' },
      { tag: 'improved', text: 'Garbage trucks now hold 200 each and keep visiting nearby piles on one run until they are nearly full, then head home. Landfills also have an Inspect option to unload to recycling centers automatically or only when you send it.' },
      { tag: 'balance', text: 'Industry makes 3× the garbage of housing and shops 2×, and their buildings hold proportionally more before they pile up.' },
      { tag: 'balance', text: 'The Shipping Depot now costs $100,000.' },
      { tag: 'new', text: 'Neighbouring fully-grown farms can now merge into one large farm with a bigger shared field. It has the same detailed barn, silo and yard, plus an annex with extra barns, silos and machinery.' },
      { tag: 'improved', text: 'Farm yards now fill their whole plot, so the barn, silo and farmhouse are about 1.5× larger and easier to see.' },
      { tag: 'new', text: 'Settings has a new option to show an FPS counter on the HUD.' },
    ],
  },
  {
    id: '2026-10-16-oasis-farm-machines-calendar',
    title: 'Working farms and a slower calendar',
    date: '2026-10-16',
    changes: [
      { tag: 'new', text: 'Farms now send machines out into their fields: tractors plough in late winter and autumn, drill seed in spring and spray the crop in early summer, and each farm sends a single combine out only while its crops are being harvested, kicking up dust as they go. Between jobs they wait by the barn. Bigger farms send two. Also in the Model viewer.' },
      { tag: 'improved', text: 'The calendar is slower: a day now lasts 10 seconds at 1× (5 s at 2×, 2.5 s at 3×). The day/night cycle, traffic, growth and money are unchanged at 1×.' },
      { tag: 'improved', text: 'The 3× button now runs at 4× game speed. Slow frames at the fast speeds are split into smaller steps so cars never skip past lights or queues, and a safety cap stops a laggy frame from piling up extra work.' },
    ],
  },
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
    // OASIS-AVENUE: avenue upgrade reaches the road graph + intersection fixes
    // (roads/persist.ts upgradeGraphRoads / demoteStaleJunctions, roads/gtraffic.ts).
    id: '2026-10-16-oasis-avenue-traffic',
    title: 'Avenue upgrades and smoother intersections',
    date: '2026-10-16',
    changes: [
      { tag: 'fix', text: 'Upgrading a street to an avenue now really gives it four lanes. Before, the road only changed colour while cars kept driving one lane, which caused jams. Cities saved earlier are repaired when loaded.' },
      { tag: 'fix', text: 'Leftover traffic lights on plain straight roads (where a side road was removed) are gone, and short road pieces next to junctions no longer trap cars.' },
      { tag: 'improved', text: 'Traffic lights give the through road one shared green in both directions, so T and four-way junctions cycle twice as fast, and lights close together are timed as a green wave.' },
      { tag: 'improved', text: 'Cars going straight on an avenue use both lanes instead of queuing in one.' },
      { tag: 'fix', text: 'Cars waiting at lights, stop signs and roundabouts now stop on the painted stop line instead of on the crosswalk or inside the junction, and only drive in when they can get all the way across.' },
      { tag: 'fix', text: 'At junctions without lights, a driver who has waited a while now gets a turn instead of waiting forever for a gap in busy traffic.' },
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
    id: '2026-10-16-b',
    title: 'Heavy industry overhaul',
    date: '2026-10-16',
    changes: [
      { tag: 'improved', text: 'Chemical plant, steel mill and assembly plant rebuilt with far more detail: process columns with platforms and ladders, spherical tanks, pipe racks, cooling towers, a blast furnace with hot-blast stoves, a gantry crane, a ladle car on rails, sawtooth halls, car lots and more.' },
      { tag: 'improved', text: 'Refinery, building-materials (cement) plant and electronics plant get the same treatment: floating-roof tank farms, a rotary kiln and silos, a fab hall with rooftop air handlers and utility yard.' },
      { tag: 'new', text: 'Four new surfaces for heavy industry: riveted steel plate, insulated cladding, louvres and walkway grating. All visible in the Model viewer under Industry and Resources.' },
    ],
  },
  {
    id: '2026-10-16-a',
    title: 'Cleaner zoning and update notes',
    date: '2026-10-16',
    changes: [
      { tag: 'improved', text: 'Zoning no longer shows a cost / size tooltip next to the cursor, so it stops covering the menu. The coloured squares show what you are about to zone.' },
      { tag: 'improved', text: 'After an update, the pop-up shows only what changed in the latest patch. The full history is still in What\'s new on the title screen and the ☰ menu.' },
    ],
  },
  {
    // OASIS: merged nebula (d2d8890..5eb1845) and models (97ae17f..2b4c14e).
    id: '2026-10-16-oasis-merge-nebula-models',
    title: 'Nebula and new models arrive',
    date: '2026-10-16',
    changes: [
      { tag: 'improved', text: 'This update brings together rectangle zoning, the power fix for lots past a junction, cleaner power and water numbers, debug codes and the new tab icon, plus the Model viewer, textured houses and shops, new businesses, and the books and toys goods.' },
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
    id: '2026-10-15-models-roof-cinema-textures',
    title: 'Roof fixes, cinema and factory textures',
    date: '2026-10-15',
    changes: [
      { tag: 'fix', text: 'Townhouse and mansard roofs no longer hang over the edge: the rowhouse blocks (A, C, E, G at level 4), the mansard apartment block (H at level 5), the terraced townhouses and the print works now have roofs that match their walls.' },
      { tag: 'improved', text: 'The multiplex cinema is rebuilt with brick and concrete textures, a glass lobby, a curved lit marquee, a neon blade sign, poster cases, a ticket booth, a popcorn cart, queue posts, a fly tower and a searchlight.' },
      { tag: 'improved', text: 'The brewery, pharmaceutical lab, clothing factory, cold storage, industrial park and mega-factory now have proper surface textures (concrete, metal, brick, stucco, glass and roof membrane).' },
      { tag: 'improved', text: 'Removed the old 1x1 landfill, police station and school models. Any left over in very old saves are drawn at half size using the current models.' },
    ],
  },
  {
    id: '2026-10-15-models-textured-shops',
    title: 'Textured shops and new businesses',
    date: '2026-10-15',
    changes: [
      { tag: 'improved', text: 'All shops are now textured (brick, siding, stucco, concrete, roof membrane and glass) with much more street-level detail: striped awnings, cornices, window mullions, double doors, sign letters, planters, sandwich boards, bike racks, crates and rooftop water tanks.' },
      { tag: 'new', text: 'Ten new, fully textured businesses: bakery, bookstore, toy store, garden centre, restaurant, bank, car dealership, gym & pool, laundromat and vet clinic.' },
      { tag: 'new', text: 'Two new factories - a print works (lumber into books) and a toy factory (plastics into toys) - and two new goods, books and toys, which shops now sell.' },
      { tag: 'improved', text: 'The supermarket, petrol station, pharmacy, hotel, cinema, department store, outlet mall, office tower and business park are textured too.' },
    ],
  },
  {
    id: '2026-10-15-models-textured-houses',
    title: 'Better-looking houses',
    date: '2026-10-15',
    changes: [
      { tag: 'improved', text: 'Low-density homes (levels 1-3) now have textured walls (clapboard siding, stucco, vertical boards, brick) and shingled roofs, plus a lot more detail: roof courses and ridge caps, eave boards, shutters, flower boxes, door panels and porch lamps, stepping stones, picket fences with gates, flower beds, and rounded trees and bushes.' },
      { tag: 'improved', text: 'The terraced townhouses are rebuilt with much more detail: textured siding, brick and stucco, bay windows, fanlights, chimney pots, dormers, front walls with hedges and flower beds, bins, and street trees.' },
      { tag: 'fix', text: 'The "update available" prompt now shows on top of the Model viewer and What\'s new screens too.' },
    ],
  },
  {
    id: '2026-10-15-models-viewer',
    title: 'Model viewer',
    date: '2026-10-15',
    changes: [
      { tag: 'new', text: 'New 🏛 Model viewer, in the ☰ menu and on the title screen: a grid of every building, power and water plant, service and vehicle model, with titles and categories (homes, apartments & towers, shops & offices, industry, resources & farms, power & water, services, vehicles, roads) and a search box. Hover a model to spin it, drag to turn it, click for a big view with zoom.' },
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
