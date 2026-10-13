/**
 * main.ts — wires the three layers together and runs the game loop.
 *
 *   src/sim/    the city itself (pure data + rules, no graphics)
 *   src/render/ draws the sim with Three.js (reads the sim, never changes it)
 *   src/ui/     HTML panels and input (turns clicks into sim actions)
 *
 * THE GAME LOOP
 * Every animation frame (~60 times a second) we:
 *   1. advance the simulation by the elapsed time (it runs whole ticks inside),
 *   2. ease the camera toward its target rotation,
 *   3. let the city renderer rebuild instances if the sim changed,
 *   4. render the frame.
 * The HUD numbers refresh 4 times a second, and the city autosaves every 20
 * seconds and whenever the tab is hidden or closed.
 */
import * as THREE from 'three';
import './style.css';
import { idx } from './sim/grid';
import { canPlace } from './sim/rules';
import { clearSave, hasSave, loadWorld, saveWorld } from './sim/save';
import { Simulation } from './sim/simulation';
import { ToolId } from './sim/types';
import { IsoCamera } from './render/camera';
import { CityRenderer, OverlayMode, PreviewRenderer } from './render/cityRenderer';
import { createScene } from './render/scene';
import { Hud } from './ui/hud';
import { attachInput } from './ui/input';
import { shapeTiles, TOOLS } from './ui/tools';
import { installDesktopNotice } from './ui/desktopOnly';

const app = document.getElementById('app')!;
const { renderer, scene, ground } = createScene(app);
const cam = new IsoCamera();
const city = new CityRenderer(scene);
const preview = new PreviewRenderer(scene);

let sim = new Simulation(loadWorld() ?? undefined);
let tool: ToolId = 'inspect';
let dragFrom: [number, number] | null = null;
let hoverTile: [number, number] | null = null;
let lastSpeed = 1;
/** Last mouse position in screen pixels (for the cost tooltip). */
let mouse: [number, number] = [0, 0];
void mouse; // read by the cost tooltip (stage 7)

const hud = new Hud(app, {
  selectTool: (id) => setTool(id),
  setSpeed: (s) => setSpeed(s),
  setOverlay: (o) => setOverlay(o),
  rotate: (d) => cam.rotate(d),
  zoom: (f) => cam.zoomBy(f),
  setTax: (zone, rate) => {
    sim.world.taxRates[zone] = rate;
    hud.refresh(sim);
  },
  save: () => {
    saveWorld(sim.world);
    hud.flash('City saved');
  },
  load: () => {
    const w = loadWorld();
    if (!w) return hud.flash('No saved city found');
    sim = new Simulation(w);
    sim.speed = lastSpeed;
    hud.inspect(null);
    hud.flash('City loaded');
  },
  newCity: () => {
    if (!confirm('Start a new empty city? Your saved city will be erased.')) return;
    clearSave();
    sim = new Simulation();
    sim.speed = lastSpeed;
    hud.inspect(null);
  },
});

function setTool(id: ToolId): void {
  tool = id;
  hud.setTool(id);
  updatePreview();
}
function setSpeed(s: number): void {
  sim.speed = s;
  if (s > 0) lastSpeed = s;
  hud.setSpeed(s);
}
function setOverlay(o: OverlayMode): void {
  city.overlay = o;
  hud.setOverlay(o);
}

/** Recompute the green/red preview for the current hover or drag. */
function updatePreview(): void {
  if (!hoverTile) return preview.show([]);
  if (tool === 'inspect') return preview.show([{ x: hoverTile[0], z: hoverTile[1], ok: null }]);
  const from = dragFrom ?? hoverTile;
  const tiles = shapeTiles(tool, from[0], from[1], hoverTile[0], hoverTile[1]);
  // If the whole drag is unaffordable, every tile shows red and the cursor
  // becomes a "not allowed" sign; the hint line shows the price.
  const cost = sim.quote(tool, tiles);
  const affordable = sim.canAfford(tool, cost);
  renderer.domElement.style.cursor = affordable ? 'crosshair' : 'not-allowed';
  hud.showCost(tool, cost, affordable, sim.world.cash);
  preview.show(tiles.map(([x, z]) => ({ x, z, ok: affordable && canPlace(tool, sim.world.at(x, z)) })));
}

attachInput(renderer.domElement, cam, ground, {
  hover(t, mx, my) {
    mouse = [mx, my];
    hoverTile = t;
    updatePreview();
  },
  dragStart(t) {
    dragFrom = t;
    hoverTile = t;
    updatePreview();
  },
  dragMove(t) {
    hoverTile = t;
    updatePreview();
  },
  dragEnd(t) {
    const end = t ?? hoverTile;
    if (dragFrom && end) {
      if (tool === 'inspect') hud.inspect(idx(end[0], end[1]));
      else {
        const r = sim.apply(tool, shapeTiles(tool, dragFrom[0], dragFrom[1], end[0], end[1]));
        if (r.broke && r.changed === 0) hud.flash('Not enough money');
        else if (r.broke) hud.flash(`Ran out of money after ${r.changed} tiles (-$${r.spent.toLocaleString()})`);
        else if (r.changed === 0) hud.flash("Can't build there");
        else if (tool === 'bulldoze') hud.flash(`Bulldozed — refund $${r.refunded.toLocaleString()}${r.spent ? `, clearing $${r.spent}` : ''}`);
        else hud.flash(`-$${r.spent.toLocaleString()}`);
      }
    }
    dragFrom = null;
    updatePreview();
    hud.refresh(sim);
  },
  dragCancel() {
    dragFrom = null;
    updatePreview();
  },
  key(k) {
    if (k === ' ') {
      setSpeed(sim.speed === 0 ? lastSpeed : 0);
      return true;
    }
    if (k === 'escape') {
      setTool('inspect');
      hud.inspect(null);
      return true;
    }
    const t = TOOLS.find((d) => d.key === k);
    if (t) setTool(t.id);
    return !!t;
  },
});

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  cam.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

// Desktop only: small or touch-only screens see a "play on a computer" notice.
installDesktopNotice(document.body);

setTool('inspect');
setSpeed(1);
setOverlay('none');

// ---- Game loop ----
const clock = new THREE.Clock();
let hudTimer = 0;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  sim.update(dt);
  cam.update(dt);
  city.frame(sim, clock.elapsedTime);
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hud.refresh(sim);
    // Previews depend on the world (a tile may have just been built on).
    updatePreview();
    hudTimer = 0.25;
  }
  renderer.render(scene, cam.camera);
});

// ---- Autosave ----
setInterval(() => saveWorld(sim.world), 20_000);
document.addEventListener('visibilitychange', () => document.hidden && saveWorld(sim.world));
window.addEventListener('beforeunload', () => saveWorld(sim.world));
if (hasSave()) hud.flash('Welcome back — city loaded');

// Debug handle (handy in the browser console and for automated screenshots).
(window as unknown as { city: unknown }).city = {
  get sim() {
    return sim;
  },
  cam,
  setTool,
  setOverlay,
  setSpeed,
  inspect: (x: number, z: number) => hud.inspect(idx(x, z)),
  refresh: () => hud.refresh(sim),
};
