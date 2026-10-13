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
}

export const TOOLS: ToolDef[] = [
  { id: 'inspect', label: 'Inspect', icon: '🔍', key: 'i', shape: 'point', hint: 'Click a tile to see its status.' },
  { id: 'road', label: 'Road', icon: '🛣️', key: 'r', shape: 'line', hint: 'Drag to lay roads ($12/tile incl. street power poles). Roads carry power and buildings need one next to them. Crossing water builds a bridge (+$48/tile).' },
  { id: 'avenue', label: 'Avenue', icon: '🛤️', key: 'v', shape: 'line', hint: 'Medium-density avenue ($24/tile): 4 lanes, faster traffic. Drag over a street to upgrade it. Unlocks at 500 people.' },
  { id: 'residential', label: 'Homes', icon: '🏠', key: '1', shape: 'area', hint: 'Drag to zone low-density residential.' },
  { id: 'commercial', label: 'Shops', icon: '🏪', key: '2', shape: 'area', hint: 'Drag to zone commercial.' },
  { id: 'industrial', label: 'Industry', icon: '🏭', key: '3', shape: 'area', hint: 'Drag to zone industrial.' },
  { id: 'powerPlant', label: 'Power Plant', icon: '⚡', key: 'p', shape: 'point', hint: 'High output (120). Connect with power lines.' },
  { id: 'windTurbine', label: 'Wind', icon: '🌬️', key: 'n', shape: 'point', hint: 'Up to 15 power, depending on the wind. Connect with power lines.' },
  { id: 'powerLine', label: 'Power Line', icon: '🔌', key: 'l', shape: 'line', hint: 'Run power across land with no road (roads already carry power).' },
  { id: 'waterTower', label: 'Water Tower', icon: '🗼', key: 't', shape: 'point', hint: 'Supplies 80 water. Needs power to pump.' },
  { id: 'waterPipe', label: 'Pipe', icon: '🚰', key: 'o', shape: 'line', hint: 'Drag to carry water. Buildings beside a pipe get water.' },
  { id: 'park', label: 'Park', icon: '🌳', key: 'k', shape: 'point', hint: 'Makes nearby homes more desirable and offsets pollution.' },
  { id: 'bulldoze', label: 'Bulldoze', icon: '🧨', key: 'x', shape: 'area', hint: 'Drag to clear everything in the box.' },
];

export function toolDef(id: ToolId): ToolDef {
  return TOOLS.find((t) => t.id === id)!;
}

/** Tiles covered when dragging tool `id` from (x0,z0) to (x1,z1). */
export function shapeTiles(id: ToolId, x0: number, z0: number, x1: number, z1: number): Array<[number, number]> {
  const shape = toolDef(id).shape;
  const out: Array<[number, number]> = [];
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
