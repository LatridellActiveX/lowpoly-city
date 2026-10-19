/**
 * tools/menuyard.test.ts — OASIS-S1 regression (Parker, 2026-10-19):
 *   "Save and load go into the hamburger menu on the top left instead of
 *    being their own distinct HUD options" and "construction yards hold 8
 *    trucks".
 *
 * The HUD is plain DOM, which node has none of, so the UI half checks the
 * SOURCE (the Playwright run in tools/pw/s1.mjs clicks the real buttons):
 *  a. the ☰ menu's main view has 💾 Save city and 📂 Load city items wired
 *     to onSave / onLoad, and main.ts points those at the HUD's save/load;
 *  b. the top bar no longer builds Save / Load buttons (New stays).
 * The yard half checks the real model code:
 *  c. there is one parking bay per truck (YARD_TRUCK_SLOTS = YARD_FLEET = 8);
 *  d. every bay's truck fits inside the yard tile and no two trucks overlap;
 *  e. the full yard model (Model viewer) is the lot plus 8 trucks' triangles.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { YARD_FLEET } from '../src/sim/industry';
import { constructionYardFullModel, constructionYardModel, parkedCrewTruckModel, YARD_TRUCK_SLOTS } from '../src/render/industryModels';

let fails = 0;
const ok = (c: boolean, m: string, x?: unknown) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`); if (!c) fails++; };

// ---- a/b: Save + Load in the menu, not in the top bar ----
const menu = readFileSync('src/ui/menu.ts', 'utf8'), hud = readFileSync('src/ui/hud.ts', 'utf8'), main = readFileSync('src/main.ts', 'utf8');
ok(/data-go="save"[^`]*Save city/.test(menu) && /data-go="load"[^`]*Load city/.test(menu), 'menu has Save city and Load city items');
ok(/'save'\) \{ this\.toggle\(false\); this\.onSave\(\)/.test(menu) && /'load'\) \{ this\.toggle\(false\); this\.onLoad\(\)/.test(menu), 'menu items call onSave / onLoad');
ok(main.includes('menu.onSave = () => hud.saveCity()') && main.includes('menu.onLoad = () => hud.loadCity()'), 'main.ts wires the menu to the save/load actions');
ok(!/\['Save', actions\.save\]/.test(hud) && !/\['Load', actions\.load\]/.test(hud), 'top bar no longer has Save / Load buttons');
ok(/\['New', actions\.newCity\]/.test(hud), 'top bar keeps the New button');

// ---- c/d/e: 8 trucks in the yard ----
ok(YARD_FLEET === 8, 'a yard owns 8 trucks', YARD_FLEET);
ok(YARD_TRUCK_SLOTS.length === YARD_FLEET, 'one parking bay per truck', YARD_TRUCK_SLOTS.length);
const t = parkedCrewTruckModel(); t.computeBoundingBox();
const bb = t.boundingBox!, w = bb.max.x - bb.min.x, l = bb.max.z - bb.min.z;
const boxes = YARD_TRUCK_SLOTS.map(([x, z]) => ({ x0: x + bb.min.x, x1: x + bb.max.x, z0: z + bb.min.z, z1: z + bb.max.z }));
ok(boxes.every((b) => b.x0 > -0.49 && b.x1 < 0.49 && b.z0 > -0.49 && b.z1 < 0.49), 'every truck fits inside the yard tile', { w: +w.toFixed(3), l: +l.toFixed(3) });
let overl = 0;
for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1) overl++; }
ok(overl === 0, 'no two parked trucks overlap', overl);
const tri = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
ok(Math.abs(tri(constructionYardFullModel()) - (tri(constructionYardModel()) + 8 * tri(t))) < 1, 'Model viewer yard = lot + 8 trucks');

console.log(fails ? `${fails} FAILED` : 'all menu/yard checks passed');
if (fails) process.exit(1);
