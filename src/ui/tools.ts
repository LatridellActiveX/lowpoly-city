/**
 * ui/tools.ts — toolbar metadata and the "shape" each tool paints when dragged.
 *
 *  - LINE tools (road, power line, pipe) paint an L-shaped path: first along
 *    the axis you dragged furthest in, then along the other. That's how most
 *    city builders let you lay a road around a corner in one drag.
 *  - AREA tools (zones, bulldoze) paint the filled rectangle between the
 *    press and release tiles.
 *  - POINT tools (power plant, turbine, water tower, inspect) act on one tile.
 */
import { ToolId } from '../sim/types';

export interface ToolDef {
  id: ToolId;
  label: string;
  icon: string;
  key: string;
  shape: 'point' | 'line' | 'area';
  hint: string;
  /**
   * PR 5: tools that belong to a toolbar GROUP live inside that group's
   * flyout menu instead of having their own toolbar button.
   */
  group?: ToolGroupId;
}

/** PR 5: the three grouped toolbar buttons. */
export type ToolGroupId = 'roads' | 'power' | 'water' | 'industry' | 'services';

export interface ToolGroupDef {
  id: ToolGroupId;
  label: string;
  icon: string;
  /** Tools shown in the flyout, in order — number keys 1..n pick them while it's open. */
  tools: ToolId[];
}

/**
 * PR 5 grouped toolbar. Each group is one button on the toolbar; clicking it
 * opens a small flyout menu listing its tools with icon, price and lock badge.
 * The group button shows (and re-selects) whichever tool you used last.
 *
 * "Bridge" isn't a separate tool in the sim — dragging a road across water
 * builds a bridge automatically — so the flyout entry for it is an info row
 * that selects the Road tool (see hud.ts).
 */
export const TOOL_GROUPS: ToolGroupDef[] = [
  { id: 'roads', label: 'Roads', icon: '🛣️', tools: ['road', 'avenue', 'roundabout', 'parkingLot', 'parkingGarage'] },
  { id: 'power', label: 'Power', icon: '⚡', tools: ['powerLine', 'powerPlant', 'oilPlant', 'windTurbine', 'nuclearPlant'] },
  { id: 'water', label: 'Water', icon: '💧', tools: ['waterPipe', 'waterTower', 'pumpStation'] },
  // PR 5: industry flyout — zone, farm, food plant and the Construction Yard.
  { id: 'industry', label: 'Industry', icon: '🏭', tools: ['industrial', 'constructionYard'] },
  // V1.5b city services (sim/services.ts).
  { id: 'services', label: 'Services', icon: '🏛️', tools: ['garbageDump', 'policeStation', 'clinic', 'hospital', 'elementarySchool', 'highSchool', 'college'] },
];

export const TOOLS: ToolDef[] = [
  { id: 'inspect', label: 'Inspect', icon: '🔍', key: 'i', shape: 'point', hint: 'Click a tile to see its status.' },
  { id: 'road', label: 'Road', icon: '🛣️', key: 'r', shape: 'line', hint: 'Drag to lay roads ($17/tile incl. street power poles and a water main underneath). Roads carry power AND water; buildings need one next to them. Crossing water builds a bridge (+$48/tile).', group: 'roads' },
  { id: 'avenue', label: 'Avenue', icon: '🛤️', key: 'v', shape: 'line', hint: 'Medium-density avenue ($29/tile incl. water main): 4 lanes, faster traffic. Drag over a street to upgrade it. Unlocks at 250 people.', group: 'roads' },
  { id: 'residential', label: 'Homes', icon: '🏠', key: '1', shape: 'area', hint: 'Drag along a road to zone homes (fills cells ~3 tiles deep; set density + depth in the bar above the toolbar). Buildings of different sizes grow to fit, each with its own parking. High density unlocks at 10,000 people.' },
  { id: 'commercial', label: 'Shops', icon: '🏪', key: '2', shape: 'area', hint: 'Drag along a road to zone shops (low: corner shops; high: strip malls and shopping centres; mixed: a shop on the ground floor with flats above — 10 residents + 1 business; office: law firms, cable / internet companies, data centres, cell towers and radio stations — they grow on commercial AND industrial demand and need educated workers). Shops need 1 parking space per 3 jobs.' },
  { id: 'industrial', label: 'Industry', icon: '🏭', key: '3', shape: 'area', hint: 'Drag to zone industry. Factories, FARMS and FOOD PLANTS grow here on their own, weighted by what the city needs (food demand, farms waiting for processing). Farms favour farmland patches and need room behind for fields.', group: 'industry' },
  { id: 'constructionYard', label: 'Construction Yard', icon: '🏗️', key: 'y', shape: 'point', hint: 'Build this first! Houses 8 construction trucks (one visit covers every building on a site); new buildings only start once a truck reaches them by road. More yards = faster growth. $2,500 + $120/month.', group: 'industry' },
  { id: 'powerPlant', label: 'Coal Plant', icon: '⚡', key: 'p', shape: 'point', hint: 'Output 2,000 (about 2,000 people incl. their shops and factories). Burns coal delivered by truck. $4,000 + $250/month.', group: 'power' },
  // V1.5 power tiers: same tier as coal (below nuclear), 4× its output.
  { id: 'oilPlant', label: 'Oil Plant', icon: '🛢️', key: 'g', shape: 'point', hint: 'Output 8,000 (about 8,000 people). Burns oil delivered by truck. $15,000 + $1,000/month. Unlocks at 2,000 people.', group: 'power' },
  { id: 'nuclearPlant', label: 'Nuclear', icon: '☢️', key: 'u', shape: 'point', hint: '2×2 plant. Output 32,000 (about 32,000 people), no fuel or pollution. $60,000 + $3,000/month. Unlocks at 10,000 people.', group: 'power' },
  { id: 'pumpStation', label: 'Pump Station', icon: '⛲', key: 'j', shape: 'point', hint: 'High-capacity water (4,000). Needs 20 power. $16,000 + $850/month. Unlocks at 10,000 people.', group: 'water' },
  { id: 'windTurbine', label: 'Wind', icon: '🌬️', key: 'n', shape: 'point', hint: '800 × wind power: ~400 people at average wind, up to ~800 in a gale, nothing when calm. $1,500 + $60/month.', group: 'power' },
  { id: 'powerLine', label: 'Power Line', icon: '🔌', key: 'l', shape: 'line', hint: 'Run power across land with no road (roads already carry power).', group: 'power' },
  { id: 'waterTower', label: 'Water Tower', icon: '🗼', key: 't', shape: 'point', hint: 'Supplies 800 water (about 1,000 people). Needs power to pump. $4,000 + $200/month.', group: 'water' },
  { id: 'waterPipe', label: 'Pipe', icon: '🚰', key: 'o', shape: 'line', hint: 'Roads already carry water mains (PR 6). Use pipes for runs across land with no road. Buildings beside a pipe get water.', group: 'water' },
  { id: 'garbageDump', label: 'Garbage Dump', icon: '🗑️', key: '4', shape: 'point', hint: 'Sends 6 garbage trucks along the roads to empty bins within 16 tiles. Uncollected garbage piles up, lowers land value and building health. $6,000 + $300/month. Unlocks at 1,000 people.', group: 'services' },
  { id: 'policeStation', label: 'Police Station', icon: '🚓', key: '5', shape: 'point', hint: 'Cuts crime within 10 tiles (crime lowers land value and health); patrol cars drive the streets. $5,000 + $250/month. Unlocks at 1,000 people.', group: 'services' },
  { id: 'clinic', label: 'Health Clinic', icon: '🩺', key: '6', shape: 'point', hint: 'Healthcare within 8 tiles; uncovered homes are less healthy and worth less. $6,000 + $300/month. Unlocks at 2,500 people.', group: 'services' },
  { id: 'hospital', label: 'Hospital', icon: '🏥', key: '7', shape: 'point', hint: '2×2. Healthcare within 18 tiles and ambulances. $24,000 + $1,100/month. Unlocks at 2,500 people.', group: 'services' },
  { id: 'elementarySchool', label: 'Elementary School', icon: '🏫', key: '8', shape: 'point', hint: 'Education level 1 within 9 tiles: homes need it to grow fast past level 3, and shops need educated workers. $4,000 + $200/month. Available from the start.', group: 'services' },
  { id: 'highSchool', label: 'High School', icon: '🎓', key: '9', shape: 'point', hint: 'Education level 2 within 14 tiles (with an elementary school): homes need it for levels 6–7; offices and electronics want educated workers. $9,000 + $450/month. Unlocks at 1,000 people.', group: 'services' },
  { id: 'college', label: 'College', icon: '🏛️', key: '0', shape: 'point', hint: '2×2. Education level 3 within 24 tiles: boosts offices, electronics and the top housing levels. $30,000 + $1,400/month. Unlocks at 2,500 people.', group: 'services' },
  { id: 'park', label: 'Park', icon: '🌳', key: 'k', shape: 'point', hint: 'Makes nearby homes more desirable and offsets pollution.' },
  // V1.5: 2×2 roundabout, available from the start.
  { id: 'roundabout', label: 'Roundabout', icon: '⭕', key: 'h', shape: 'point', hint: '2×2 roundabout ($260): traffic circulates counter-clockwise and entering cars yield — no lights. Click its top-left tile; it joins the roads, power and water mains on every side. Can replace an existing junction.', group: 'roads' },
  { id: 'parkingLot', label: 'Parking Lot', icon: '🅿️', key: 'b', shape: 'point', hint: 'Public surface lot filling the whole tile (16 spaces, $480). Serves buildings within 6 tiles that are short of parking.', group: 'roads' },
  { id: 'parkingGarage', label: 'Parking Garage', icon: '🏢', key: 'm', shape: 'point', hint: 'Public 3-deck garage filling one tile (40 spaces, $1,600). Serves buildings within 9 tiles and earns parking fees. Busy shopping streets also grow their own garages.', group: 'roads' },
  { id: 'bulldoze', label: 'Bulldoze', icon: '🧨', key: 'x', shape: 'area', hint: 'Drag to clear everything in the box.' },
];

export function toolDef(id: ToolId): ToolDef {
  return TOOLS.find((t) => t.id === id)!;
}

/** Tiles covered when dragging tool `id` from (x0,z0) to (x1,z1). */
export function shapeTiles(id: ToolId, x0: number, z0: number, x1: number, z1: number): Array<[number, number]> {
  const shape = toolDef(id).shape;
  const out: Array<[number, number]> = [];
  // PR 4: the nuclear plant is 2×2 — the hovered tile is its top-left corner.
  // V1.5: the roundabout is 2×2 too (hovered tile = top-left).
  // V1.5b: the hospital and the college are 2×2 as well.
  if (id === 'nuclearPlant' || id === 'roundabout' || id === 'hospital' || id === 'college') return [[x1, z1], [x1 + 1, z1], [x1, z1 + 1], [x1 + 1, z1 + 1]].filter(([x, z]) => x < 64 && z < 64) as Array<[number, number]>;
  if (shape === 'point') return [[x1, z1]];
  if (shape === 'area') {
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push([x, z]);
    return out;
  }
  // L-shaped line: go along the longer axis first, then turn the corner.
  const sx = Math.sign(x1 - x0);
  const sz = Math.sign(z1 - z0);
  const xFirst = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const corner: [number, number] = xFirst ? [x1, z0] : [x0, z1];
  let [x, z] = [x0, z0];
  out.push([x, z]);
  while (x !== corner[0] || z !== corner[1]) {
    if (xFirst) x += sx; else z += sz;
    out.push([x, z]);
  }
  while (x !== x1 || z !== z1) {
    if (xFirst) z += sz; else x += sx;
    out.push([x, z]);
  }
  return out;
}
