/**
 * tools/tricount.ts — PR 5 helper: prints the triangle count of every model
 * family (buildings per zone, roads, signals, utilities) so we can prove
 * the detail pass at least doubled them. Run: npm run tricount
 */
import * as THREE from 'three';
import * as B from '../src/render/buildings';
import { ROADS } from '../src/render/roads';
import { MODELS, nuclearPlantModel, pumpStationModel } from '../src/render/models';
import { VEHICLES } from '../src/render/vehicles';

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const out: Record<string, number> = {};
const anyB = B as any;
for (const [lod, build] of [['high', () => anyB.buildDesigns('high') ], ['low', () => anyB.buildDesigns('low')]] as const) {
  const d = build();
  for (const zone of ['residential', 'commercial', 'industrial']) {
    let sum = 0;
    for (const levels of d[zone]) for (const p of levels) sum += tris(p.walls) + tris(p.accent) + tris(p.fixed);
    out[`${zone} (${lod}, 15 models total)`] = sum;
  }
}
// Smallest high/low ratio of any single building model (proves EVERY model doubled).
{
  const hiD = anyB.buildDesigns('high'), loD = anyB.buildDesigns('low');
  let min = Infinity;
  for (const zone of ['residential', 'commercial', 'industrial'])
    hiD[zone].forEach((levels: any[], k: number) => levels.forEach((p: any, lv: number) => {
      const lo = loD[zone][k][lv];
      const r = (tris(p.walls) + tris(p.accent) + tris(p.fixed)) / (tris(lo.walls) + tris(lo.accent) + tris(lo.fixed));
      min = Math.min(min, r);
    }));
  out['min per-building ratio x100'] = Math.round(min * 100);
}
const R = ROADS as any;
for (const k of Object.keys(R)) out[`road.${k}`] = tris(R[k]());
out['roadDash(PR4)/streetMarks(PR5)'] = tris((R.streetMarks ?? MODELS.roadDash)());
out['trafficPole'] = tris(VEHICLES.lightPole());
out['signalLamp'] = tris(VEHICLES.lightHead());
for (const k of ['powerPlant', 'windTower', 'waterTower', 'park'] as const) out[k] = tris((MODELS as any)[k]());
out['nuclearPlant'] = tris(nuclearPlantModel());
out['pumpStation'] = tris(pumpStationModel());
console.log(JSON.stringify(out, null, 1));
