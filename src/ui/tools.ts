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
export type ToolGroupId = 'roads' | 'power' | 'water' | 'industry';

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
  { id: 'roads', label: 'Roads', icon: '🛣️', tools: ['road', 'avenue', 'parkingLot', 'parkingGarage'] },
  { id: 'power', label: 'Power', icon: '⚡', tools: ['powerLine', 'powerPlant', 'windTurbine', 'nuclearPlant'] },
  { id: 'water', label: 'Water', icon: '💧', tools: ['waterPipe', 'waterTower', 'pumpStation'] },
  // PR 5: industry flyout — zone, farm, food plant and the Construction Yard.
  { id: 'industry', label: 'Industry', icon: '🏭', tools: ['industrial', 'constructionYard'] },
];

export const TOOLS: ToolDef[] = [
  { id: 'inspect', label: 'Inspect', icon: '🔍', key: 'i', shape: 'point', hint: 'Click a tile to see its status.' },
  { id: 'road', label: 'Road', icon: '🛣️', key: 'r', shape: 'line', hint: 'Drag to lay roads ($17/tile incl. street power poles and a water main underneath). Roads carry power AND water; buildings need one next to them. Crossing water builds a bridge (+$48/tile).', group: 'roads' },
  { id: 'avenue', label: 'Avenue', icon: '🛤️', key: 'v', shape: 'line', hint: 'Medium-density avenue ($29/tile incl. water main): 4 lanes, faster traffic. Drag over a street to upgrade it. Unlocks at 500 people.', group: 'roads' },
  { id: 'residential', label: 'Homes', icon: '🏠', key: '1', shape: 'area', hint: 'Drag along a road to zone homes (fills cells ~3 tiles deep; set density + depth in the bar above the toolbar). Buildings of different sizes grow to fit, each with its own parking. High density unlocks at 10,000 people.' },
  { id: 'commercial', label: 'Shops', icon: '🏪', key: '2', shape: 'area', hint: 'Drag along a road to zone shops (low: corner shops; high: strip malls and shopping centres). Shops need 1 parking space per 3 jobs.' },
  { id: 'industrial', label: 'Industry', icon: '🏭', key: '3', shape: 'area', hint: 'Drag to zone industry. Factories, FARMS and FOOD PLANTS grow here on their own, weighted by what the city needs (food demand, farms waiting for processing). Farms favour farmland patches and need room behind for fields.', group: 'industry' },
  { id: 'constructionYard', label: 'Construction Yard', icon: '🏗️', key: 'y', shape: 'point', hint: 'Build this first! Houses 8 construction trucks (one visit covers every building on a site); new buildings only start once a truck reaches them by road. More yards = faster growth. $2,500 + $120/month.', group: 'industry' },
  { id: 'powerPlant', label: 'Coal/Oil Plant', icon: '⚡', key: 'p', shape: 'point', hint: 'Output 2,000 (about 2,000 people incl. their shops and factories). Burns coal or oil delivered by truck. $4,000 + $250/month.', group: 'power' },
  { id: 'nuclearPlant', label: 'Nuclear', icon: '☢️', key: 'u', shape: 'point', hint: '2×2 plant. Output 8,000 (about 8,000 people), no fuel or pollution. $20,000 + $1,250/month. Unlocks at 10,000 people.', group: 'power' },
  { id: 'pumpStation', label: 'Pump Station', icon: '⛲', key: 'j', shape: 'point', hint: 'High-capacity water (4,000). Needs 20 power. $16,000 + $850/month. Unlocks at 10,000 people.', group: 'water' },
  { id: 'windTurbine', label: 'Wind', icon: '🌬️', key: 'n', shape: 'point', hint: '800 × wind power: ~400 people at average wind, up to ~800 in a gale, nothing when calm. $1,500 + $60/month.', group: 'power' },
  { id: 'powerLine', label: 'Power Line', icon: '🔌', key: 'l', shape: 'line', hint: 'Run power across land with no road (roads already carry power).', group: 'power' },
  { id: 'waterTower', label: 'Water Tower', icon: '🗼', key: 't', shape: 'point', hint: 'Supplies 800 water (about 1,000 people). Needs power to pump. $4,000 + $200/month.', group: 'water' },
  { id: 'waterPipe', label: 'Pipe', icon: '🚰', key: 'o', shape: 'line', hint: 'Roads already carry water mains (PR 6). Use pipes for runs across land with no road. Buildings beside a pipe get water.', group: 'water' },
  { id: 'park', label: 'Park', icon: '🌳', key: 'k', shape: 'point', hint: 'Makes nearby homes more desirable and offsets pollution.' },
  { id: 'parkingLot', label: 'Parking Lot', icon: '🅿️', key: 'b', shape: 'point', hint: 'Public 2×2-cell surface lot (4 spaces, $120) on the quarter of the tile you click. Serves buildings within 3 tiles that are short of parking.', group: 'roads' },
  { id: 'parkingGarage', label: 'Parking Garage', icon: '🏢', key: 'm', shape: 'point', hint: 'Public 3-deck garage filling one tile (40 spaces, $1,600). Serves buildings within 3 tiles.', group: 'roads' },
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
  if (id === 'nuclearPlant') return [[x1, z1], [x1 + 1, z1], [x1, z1 + 1], [x1 + 1, z1 + 1]].filter(([x, z]) => x < 64 && z < 64) as Array<[number, number]>;
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
