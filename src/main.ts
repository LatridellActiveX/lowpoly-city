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
import { clockText, DayNight } from './render/dayNight';
import { Hud } from './ui/hud';
import { attachInput } from './ui/input';
import { shapeTiles, toolDef, TOOLS } from './ui/tools';
import { bulldozeRefund } from './sim/economy';
import { installDesktopNotice } from './ui/desktopOnly';
import { gameLog } from './ui/gameLog';
import { GameMenu } from './ui/menu';

// PR 4: start the Game Log first so even errors during start-up are captured.
gameLog.install();

const app = document.getElementById('app')!;
const { renderer, scene, ground, sun, hemi } = createScene(app);
const cam = new IsoCamera();
const city = new CityRenderer(scene);
const preview = new PreviewRenderer(scene);
// Day/night cycle: purely visual, driven by the sim's tick counter (dayNight.ts).
const dayNight = new DayNight(scene, sun, hemi);

let sim = new Simulation(loadWorld() ?? undefined);
gameLog.gameDate = () => {
  const w = sim.world;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[(w.month - 1) % 12]} ${w.day}, Y${Math.floor((w.month - 1) / 12) + 1}`;
};
gameLog.event(hasSave() ? 'Game started — saved city loaded' : 'Game started — new city');
let tool: ToolId = 'inspect';
let dragFrom: [number, number] | null = null;
let hoverTile: [number, number] | null = null;
let lastSpeed = 1;
/** Last mouse position in screen pixels (for the cost tooltip). */
let mouse: [number, number] = [0, 0];

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
    gameLog.event('City saved');
    hud.flash('City saved');
  },
  load: () => {
    const w = loadWorld();
    if (!w) {
      gameLog.warn('Load failed: no saved city found (or it was unreadable)');
      return hud.flash('No saved city found');
    }
    sim = new Simulation(w);
    sim.speed = lastSpeed;
    hud.inspect(null);
    hud.notices.reset(sim);
    gameLog.event('City loaded');
    hud.flash('City loaded');
  },
  newCity: () => {
    if (!confirm('Start a new empty city? Your saved city will be erased.')) return;
    clearSave();
    sim = new Simulation();
    gameLog.event('New city founded');
    sim.speed = lastSpeed;
    hud.inspect(null);
    hud.notices.reset(sim);
  },
});

function setTool(id: ToolId): void {
  tool = id;
  hud.setTool(id);
  // Pipes are underground: only show them while placing pipes (or via the water overlay).
  city.showPipes = id === 'waterPipe';
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

/**
 * Recompute the green/red preview for the current hover or drag, plus the
 * cost tooltip next to the cursor (PR 3): it shows the price BEFORE you
 * click, and while dragging a zone rectangle it shows its size and total.
 */
function updatePreview(): void {
  if (!hoverTile) {
    hud.showTip(null);
    return preview.show([]);
  }
  if (tool === 'inspect') {
    // Hovering a building with a warning icon explains it: "No power", "No water".
    const ti = sim.world.at(hoverTile[0], hoverTile[1]);
    const st = sim.status(idx(hoverTile[0], hoverTile[1]));
    // PR 4 fix: explain WHY (not connected vs. city-wide shortage), and also
    // for empty lots / construction sites, not just finished buildings.
    const why = (m: string) =>
      m === 'power connection' ? '⚡ No power — not connected to the grid (needs a road or power line next to it)'
      : m.startsWith('power') ? '⚡ No power — demand exceeds supply (build more power)'
      : m === 'water connection' ? '💧 No water — not near a pipe (or a water tower)'
      : m.startsWith('water') ? '💧 No water — demand exceeds supply (build more water towers)'
      : '🛣 No road access';
    const needsUtil = ti.zone || ti.structure === 'waterTower' || ti.structure === 'pumpStation';
    const probs = needsUtil ? st.missing.map(why) : [];
    hud.showTip(probs.length ? `<span class="bad">${[...new Set(probs)].join('<br>')}</span>` : null, mouse[0], mouse[1]);
    return preview.show([{ x: hoverTile[0], z: hoverTile[1], ok: null }]);
  }
  const from = dragFrom ?? hoverTile;
  const tiles = shapeTiles(tool, from[0], from[1], hoverTile[0], hoverTile[1]);
  // If the whole drag is unaffordable, every tile shows red and the cursor
  // becomes a "not allowed" sign; the hint line shows the price.
  const cost = sim.quote(tool, tiles);
  const affordable = sim.canAfford(tool, cost);
  const valid = tiles.filter(([x, z]) => canPlace(tool, sim.world.at(x, z))).length;
  renderer.domElement.style.cursor = affordable ? 'crosshair' : 'not-allowed';
  hud.showCost(tool, cost, affordable, sim.world.cash);
  preview.show(
    tiles.map(([x, z]) => ({ x, z, ok: affordable && canPlace(tool, sim.world.at(x, z)) })),
    affordable && valid > 0,
  );
  // ---- Cursor tooltip ----
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const def = toolDef(tool);
  let size = '';
  if (def.shape === 'area' && dragFrom) {
    const w = Math.abs(hoverTile[0] - from[0]) + 1;
    const h = Math.abs(hoverTile[1] - from[1]) + 1;
    size = `${w}×${h} · `;
  }
  let html: string;
  if (valid === 0) html = `<span class="bad">Can't build here</span>`;
  else if (tool === 'bulldoze') {
    const refund = tiles.reduce((a, [x, z]) => a + (canPlace(tool, sim.world.at(x, z)) ? bulldozeRefund(sim.world.at(x, z)) : 0), 0);
    html = `${size}${valid} tile${valid > 1 ? 's' : ''} · <span class="ok">refund ${money(refund)}</span>${cost ? ` · clearing ${money(cost)}` : ''}`;
  } else {
    const count = def.shape === 'point' ? '' : `${size}${valid} tile${valid > 1 ? 's' : ''} · `;
    html = `${count}<b class="${affordable ? 'ok' : 'bad'}">${money(cost)}</b>${affordable ? '' : ` <span class="bad">(you have ${money(sim.world.cash)})</span>`}`;
  }
  hud.showTip(html, mouse[0], mouse[1]);
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
        if (r.locked) hud.flash('🔒 Locked — grow your population to unlock this (see the tier bar)');
        else if (r.broke && r.changed === 0) hud.flash('Not enough money');
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
    // PR 5: while a toolbar flyout is open, number keys pick inside it
    // (1 = first row...) instead of their normal zone shortcuts.
    if (/^[1-9]$/.test(k) && hud.openGroup) {
      const pick = hud.flyoutPick(Number(k));
      if (pick) {
        setTool(pick);
        hud.closeFlyout();
      }
      return true;
    }
    if (k === 'escape') {
      if (hud.openGroup) {
        hud.closeFlyout();
        return true;
      }
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

// PR 4: ☰ menu (Settings + Game log) at the far left of the top bar.
const menu = new GameMenu(() => sim);
document.querySelector('.topbar')!.prepend(menu.button);
app.append(menu.el);

// Desktop only: small or touch-only screens see a "play on a computer" notice.
installDesktopNotice(document.body);

setTool('inspect');
setSpeed(1);
setOverlay('none');

// ---- Game loop ----
/** PR 5: below this camera zoom the low-detail building models are used. */
const LOD_ZOOM = 0.8;
const clock = new THREE.Clock();
let hudTimer = 0;
let lastNoRoute = 0;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  sim.update(dt);
  cam.update(dt);
  dayNight.update(sim);
  city.setNight(dayNight.night, dayNight.time);
  // PR 5 LOD: detailed models only when Detail = High AND zoomed in past
  // LOD_ZOOM (far out, the extra trim is sub-pixel anyway).
  city.setLod(sim.settings.detail === 'high' && cam.zoom >= LOD_ZOOM ? 'high' : 'low');
  city.cameraQuat.copy(cam.camera.quaternion);
  city.frame(sim, clock.elapsedTime);
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hud.refresh(sim, clockText(dayNight.time));
    // Game Log: trips that couldn't find a road route (usually a disconnected road island).
    if (sim.traffic.stats.noRoute > lastNoRoute + 4) {
      gameLog.warn(`${sim.traffic.stats.noRoute - lastNoRoute} vehicle trips had no road route — is every district connected to the highway?`);
      lastNoRoute = sim.traffic.stats.noRoute;
    } else if (sim.traffic.stats.noRoute < lastNoRoute) lastNoRoute = sim.traffic.stats.noRoute;
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
  /** PR 4 testing: swap in a prepared Simulation (e.g. new city.sim.constructor(world)). */
  useSim: (s: Simulation) => {
    sim = s;
    hud.notices.reset(sim);
  },
  setTool,
  setOverlay,
  setSpeed,
  /** Force a time of day for screenshots (0 = midnight, 0.5 = noon); null = follow the sim. */
  openGraphs: () => hud.graphs.toggle(true),
  menu,
  gameLog,
  get timeOfDay() {
    return dayNight.time;
  },
  get notices() {
    return hud.notices.log;
  },
  setTimeOfDay: (t: number | null) => (dayNight.override = t),
  inspect: (x: number, z: number) => hud.inspect(idx(x, z)),
  refresh: () => hud.refresh(sim),
};
