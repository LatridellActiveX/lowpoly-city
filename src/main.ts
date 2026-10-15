import { TPL } from './sim/footprints';
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
import { clearSave, downloadSave, importSaveText, hasSave, loadWorld, saveWorld } from './sim/save';
import { Simulation } from './sim/simulation';
import { GRID_SIZE, ToolId } from './sim/types';
import { IsoCamera } from './render/camera';
import { setGridSize } from './sim/mapsize';
import { REGION, regionSide, startRegion } from './sim/regions';
import { CityRenderer, OverlayMode, PreviewRenderer, zoneCodeColor } from './render/cityRenderer';
import { ZONE_CODES } from './sim/cells';
import { createScene, resizeScene } from './render/scene';
import { clockText, DayNight } from './render/dayNight';
import { Hud } from './ui/hud';
import { attachInput, pointer } from './ui/input';
import { ZONE_TOOLS } from './sim/simulation';
import { sound, toolSound } from './audio/sound';
import { shapeTiles, toolDef, TOOLS } from './ui/tools';
import { bulldozeRefund } from './sim/economy';
import { installDesktopNotice } from './ui/desktopOnly';
import { gameLog } from './ui/gameLog';
import { GameMenu } from './ui/menu';
import { ChangelogPanel } from './ui/changelogPanel';
import { RESUME_KEY, UpdateChecker } from './ui/updateCheck';
import { NewGameOptions, TitleScreen } from './ui/titleScreen';
import { buildBackdrop } from './ui/titleBackdrop';
import { loadSlotIntoMain, saveToSlot } from './sim/slots';
import { World } from './sim/grid';
import { GraphRoadLayer } from './render/graphRoads';
import { migrateToGraph } from './roads/persist';
import { placeFreeRoad, paintBlocks, undo, redo, zoneDryRun } from './sim/freeroads';
import { quadCubic, lineCubic } from './roads/bezier';
import type { V2 } from './roads/bezier';
import { FreeRoadTool, dragCells, paintDragged, toMetres } from './ui/freeRoadTool';
import { codeForTool } from './sim/growth';

// PR 4: start the Game Log first so even errors during start-up are captured.
gameLog.install();

const app = document.getElementById('app')!;
const sceneBundle = createScene(app);
const { renderer, scene, ground, sun, hemi } = sceneBundle;
const cam = new IsoCamera();
const city = new CityRenderer(scene);
const preview = new PreviewRenderer(scene);
// V1.6 B6/B7: freeform roads (graph mesh, zone-block overlay, preview grid, lane cars) and their tool.
const graphLayer = new GraphRoadLayer(scene);
// Day/night cycle: purely visual, driven by the sim's tick counter (dayNight.ts).
const dayNight = new DayNight(scene, sun, hemi);

/**
 * V1.5 start-up: the simulation now starts ON DEMAND.
 *  - Normally the title screen opens over a live demo town (`buildBackdrop`)
 *    and the player's city is only created/loaded when they pick an option.
 *  - After an in-game update reload, sessionStorage[RESUME_KEY] says whether
 *    to drop straight back into the saved city ('continue') or a new one
 *    ('new'), skipping the title.
 * `inTitle` gates autosave so the demo town is never written to the save.
 */
const resume = sessionStorage.getItem(RESUME_KEY);
sessionStorage.removeItem(RESUME_KEY);
let inTitle = !resume;
let sim = inTitle ? buildBackdrop() : new Simulation((resume === 'continue' && loadWorld()) || undefined);
gameLog.gameDate = () => {
  const w = sim.world;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[(w.month - 1) % 12]} ${w.day}, Y${Math.floor((w.month - 1) / 12) + 1}`;
};
gameLog.event(hasSave() ? 'Game started — saved city loaded' : 'Game started — new city');
let tool: ToolId = 'inspect';
let dragFrom: [number, number] | null = null;
/** Zoning on freeform-road blocks: metres where the drag began (null = ordinary tile zoning). */
let blockDragFrom: V2 | null = null;
let cellsShown = false;

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
  // V1.5 stage 11: land-value property tax slider.
  setPropertyTax: (rate) => {
    sim.world.propertyRate = rate;
    hud.refresh(sim);
  },
  save: () => {
    if (inTitle) return;
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

/**
 * PR 6 zoning options bar: density (Low / Medium / High) and depth (tiles
 * a road-side drag reaches back). Shown only while a zone tool is active.
 * Residential High is locked until the 10,000 tier.
 */
const freeTool = new FreeRoadTool(graphLayer, () => sim, (m) => hud.flash(m));
const zoneBar = document.createElement('div');
zoneBar.id = 'zonebar';
zoneBar.className = 'panel hidden';
document.body.append(zoneBar);
function renderZoneBar(): void {
  const show = ZONE_TOOLS.has(tool) && tool !== 'farm' && tool !== 'foodPlant';
  zoneBar.classList.toggle('hidden', !show);
  if (!show) return;
  const names = tool === 'residential' ? ['Low', 'Medium', 'High'] : tool === 'commercial' ? ['Low', 'High', 'Mixed', 'Office'] : ['Light', 'Heavy'];
  const d = Math.min(sim.zoneOpt.density, names.length - 1);
  zoneBar.innerHTML = `<span class="muted">Density</span> ${names.map((n, k) => `<button class="btn${k === d ? ' active' : ''}" data-d="${k}" ${tool === 'residential' && k === 2 && sim.world.tier < 3 ? 'disabled title="Unlocks at 10,000 people"' : ''}>${n}${tool === 'residential' && k === 2 && sim.world.tier < 3 ? ' 🔒' : ''}</button>`).join('')}
    <span class="muted" style="margin-left:10px">Depth</span> ${[1, 2, 3, 4].map((k) => `<button class="btn${k === sim.zoneOpt.depth ? ' active' : ''}" data-depth="${k}">${k}</button>`).join('')} <span class="muted">tiles</span>`;
  zoneBar.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => (b.onclick = () => { sim.zoneOpt.density = +b.dataset.d!; renderZoneBar(); }));
  zoneBar.querySelectorAll<HTMLButtonElement>('[data-depth]').forEach((b) => (b.onclick = () => { sim.zoneOpt.depth = +b.dataset.depth!; renderZoneBar(); }));
}

function setTool(id: ToolId): void {
  if (id !== tool) sound.play('tool');
  tool = id;
  freeTool.show(id === 'freeRoad');
  renderZoneBar();
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
  // Zone tools over a freeform road's block: highlight the small squares under the drag (or cursor).
  if (ZONE_TOOLS.has(tool) && tool !== 'farm' && tool !== 'foodPlant') {
    const pm = toMetres(pointer.x, pointer.z), a = blockDragFrom ?? pm;
    if (blockDragFrom || sim.world.blocks.cellAt(pm)) {
      const cells = dragCells(sim, a, pm, sim.zoneOpt.depth);
      const zc = codeForTool(sim, tool, idx(Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(pointer.x))), Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(pointer.z)))), sim.zoneOpt);
      // NEBULA: also draw the kerb-row fill squares mouse-up will zone (zoneDryRun),
      // so the highlight is exactly what gets zoned; the tip counts those squares.
      const dry = zoneDryRun(sim, cells, zc);
      graphLayer.showCells(cells.length ? [...cells, ...dry.fill.map((quad) => ({ quad }))] : [], cells.length ? zoneCodeColor(zc) : 0xe5484d);
      cellsShown = true;
      preview.show([]);
      hud.showTip(cells.length ? `<b style="color:#${zoneCodeColor(zc).toString(16).padStart(6, '0')}">${ZONE_CODES[zc]?.label ?? ''}</b> · ${dry.keys.length} square${dry.keys.length !== 1 ? 's' : ''}` : null, mouse[0], mouse[1]);
      return;
    }
  }
  if (cellsShown) { graphLayer.showCells(null); cellsShown = false; }
  if (tool === 'freeRoad') {
    preview.show([]);
    freeTool.hover(toMetres(pointer.x, pointer.z));
    hud.showTip(freeTool.tip, mouse[0], mouse[1]);
    return;
  }
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
  let tiles = shapeTiles(tool, from[0], from[1], hoverTile[0], hoverTile[1]);
  // PR 6: a zoning drag also covers the tiles behind it (depth setting), and
  // the tooltip counts CELLS. The park preview shows its 10×10 area.
  const zq = ZONE_TOOLS.has(tool) ? sim.zoneQuote(tool, tiles) : null;
  if (zq) tiles = zq.tiles.length ? zq.tiles : tiles;
  sim.pointerFrac = [pointer.x - Math.floor(pointer.x), pointer.z - Math.floor(pointer.z)];
  // If the whole drag is unaffordable, every tile shows red and the cursor
  // becomes a "not allowed" sign; the hint line shows the price.
  const cost = sim.quote(tool, tiles);
  const affordable = sim.canAfford(tool, cost);
  const valid = tiles.filter(([x, z]) => canPlace(tool, sim.world.at(x, z))).length;
  renderer.domElement.style.cursor = affordable ? 'crosshair' : 'not-allowed';
  hud.showCost(tool, cost, affordable, sim.world.cash);
  // Zoning shows WHAT is being zoned: the preview takes the zone's own ground colour
  // (residential green, shops blue, industry yellow, darker for denser zones).
  const zcode = zq ? codeForTool(sim, tool, idx(hoverTile[0], hoverTile[1]), sim.zoneOpt) : 0;
  preview.show(
    tiles.map(([x, z]) => ({ x, z, ok: affordable && canPlace(tool, sim.world.at(x, z)) })),
    affordable && valid > 0,
    zcode ? zoneCodeColor(zcode) : undefined,
  );
  if (tool === 'park' && hoverTile) {
    // PR 6: show the park's 10×10 desirability square (offsets −5..+4).
    const area: Array<{ x: number; z: number; ok: boolean | null }> = [];
    for (let dz = -5; dz <= 4; dz++) for (let dx = -5; dx <= 4; dx++) {
      const x = hoverTile[0] + dx, z = hoverTile[1] + dz;
      if (x >= 0 && z >= 0 && x < GRID_SIZE && z < GRID_SIZE) area.push({ x, z, ok: dx === 0 && dz === 0 ? affordable && canPlace(tool, sim.world.at(x, z)) : null });
    }
    preview.show(area, affordable && valid > 0);
  }
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
  } else if (zq) {
    const zl = ZONE_CODES[zcode]?.label ?? '';
    html = zq.cells ? `<b style="color:#${zoneCodeColor(zcode).toString(16).padStart(6, '0')}">${zl}</b> · ${size}${zq.tiles.length} tiles · <b>${zq.cells} cells</b> zoned · <b class="${affordable ? 'ok' : 'bad'}">${money(cost)}</b>` : `<span class="muted">Already zoned</span>`;
  } else {
    const count = def.shape === 'point' ? '' : `${size}${valid} tile${valid > 1 ? 's' : ''} · `;
    html = `${count}<b class="${affordable ? 'ok' : 'bad'}">${money(cost)}</b>${affordable ? '' : ` <span class="bad">(you have ${money(sim.world.cash)})</span>`}`;
  }
  hud.showTip(html, mouse[0], mouse[1]);
}

/**
 * PR 6 sound hooks that don't belong to one call site:
 *  - every <button> click → soft click; hovering a toolbar / top-bar button → tiny tick;
 *  - flyout groups and panels opening/closing → pops (watching .open / .hidden classes);
 *  - each frame, sim counters: new construction sites (thump), finished
 *    buildings (chime at level 1, sparkle on a level-up), HUD notices (ding).
 */
sound.attach();
document.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) sound.play('click'); }, true);
document.addEventListener('pointerover', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b && b !== lastHoverBtn) { lastHoverBtn = b; sound.play('hover'); } }, true);
let lastHoverBtn: Element | null = null;
new MutationObserver((ms) => {
  for (const m of ms) {
    const el = m.target as HTMLElement;
    const was = (m.oldValue ?? '').split(' ');
    if (el.classList.contains('open') !== was.includes('open')) sound.play(el.classList.contains('open') ? 'open' : 'close');
    else if (el.classList.contains('panel') && el.classList.contains('hidden') !== was.includes('hidden')) sound.play(el.classList.contains('hidden') ? 'close' : 'open');
  }
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
const soundSeen = { founded: 0, completed: -1, notices: 0 };
function soundTick(): void {
  const st = sim.world.lots.stats;
  if (st.founded > soundSeen.founded && soundSeen.completed >= 0) sound.play('place');
  soundSeen.founded = st.founded;
  if (sim.world.tick !== soundSeen.completed) {
    if (soundSeen.completed >= 0) for (const id of sim.completed) { const b = sim.world.lots.buildings.get(id); if (b) sound.play(b.level > 1 ? 'levelup' : 'complete'); }
    soundSeen.completed = sim.world.tick;
  }
  const n = hud.notices.log.length;
  if (n > soundSeen.notices) sound.play('ding');
  soundSeen.notices = n;
}
setInterval(soundTick, 100);

attachInput(renderer.domElement, cam, ground, {
  hover(t, mx, my) {
    mouse = [mx, my];
    hoverTile = t;
    updatePreview();
  },
  dragStart(t) {
    dragFrom = t;
    const pm0 = toMetres(pointer.x, pointer.z);
    blockDragFrom = ZONE_TOOLS.has(tool) && tool !== 'farm' && tool !== 'foodPlant' && sim.world.blocks.cellAt(pm0) ? pm0 : null;
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
      sim.pointerFrac = [pointer.x - Math.floor(pointer.x), pointer.z - Math.floor(pointer.z)];
      hud.pickCell = [Math.max(0, Math.min(GRID_SIZE * 4 - 1, Math.floor(pointer.x * 4))), Math.max(0, Math.min(GRID_SIZE * 4 - 1, Math.floor(pointer.z * 4)))];
      const pm = toMetres(pointer.x, pointer.z);
      if (tool === 'inspect') hud.inspect(idx(end[0], end[1]));
      else if (tool === 'freeRoad') {
        const msg = freeTool.click(pm);
        if (msg) { hud.flash(msg); sound.play(msg.startsWith('-$') ? toolSound('road') : 'error'); }
      } else if (blockDragFrom) {
        // Drag over a freeform road's block: zone the small squares inside the dragged rectangle.
        const n = paintDragged(sim, blockDragFrom, pm, codeForTool(sim, tool, idx(end[0], end[1]), sim.zoneOpt), sim.zoneOpt.depth);
        hud.flash(n ? `Zoned ${n} square${n > 1 ? 's' : ''}` : 'Already zoned');
      } else {
        const r = sim.apply(tool, shapeTiles(tool, dragFrom[0], dragFrom[1], end[0], end[1]));
        // PR 6 sounds: one placement sound per drag (throttled inside sound.ts), buzz on failure.
        if (r.locked || r.changed === 0) sound.play('error');
        else sound.play(toolSound(tool));
        if (r.locked) hud.flash('🔒 Locked — grow your population to unlock this (see the tier bar)');
        else if (r.broke && r.changed === 0) hud.flash('Not enough money');
        else if (r.broke) hud.flash(`Ran out of money after ${r.changed} tiles (-$${r.spent.toLocaleString()})`);
        else if (r.changed === 0) hud.flash("Can't build there");
        else if (tool === 'bulldoze') hud.flash(`Bulldozed — refund $${r.refunded.toLocaleString()}${r.spent ? `, clearing $${r.spent}` : ''}`);
        else hud.flash(`-$${r.spent.toLocaleString()}`);
      }
    }
    dragFrom = null; blockDragFrom = null;
    updatePreview();
    hud.refresh(sim);
  },
  dragCancel() {
    dragFrom = null; blockDragFrom = null;
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
    if (k === 'ctrl+z') { freeTool.undo(); return true; }
    if (k === 'ctrl+y') { freeTool.redo(); return true; }
    if (k === 'escape' && tool === 'freeRoad' && freeTool.pts.length) { freeTool.cancel(); updatePreview(); return true; }
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
// V1.6: the What's new (change log) screen — opens by itself after an update, and from the title screen / ☰ menu.
const changelog = new ChangelogPanel();
document.body.append(changelog.el);
menu.onChangelog = () => changelog.open();
// Back to the title screen: save the city first (Continue picks it up), then reload clean.
menu.onMainMenu = () => {
  if (!inTitle) saveWorld(sim.world);
  window.location.reload();
};
// NEBULA debug code: a pasted code was written to the save — load it in place
// (no page reload, so the beforeunload autosave can't overwrite it).
menu.onDebugLoaded = () => startGame('continue');

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
  // V1.5 title backdrop: slow orbit (~1 turn / 3 min) and a fast day/night
  // loop (one full day every 90 s) over the demo town.
  if (inTitle) {
    cam.orbit(dt * 12, 0);
    dayNight.override = ((performance.now() / 1000) / 90 + 0.3) % 1;
  }
  sim.update(dt);
  if (tool === 'freeRoad') freeTool.tick(dt); // eased snapping
  cam.update(dt);
  dayNight.update(sim);
  city.setNight(dayNight.night, dayNight.time);
  // PR 5 LOD: detailed models only when Detail = High AND zoomed in past
  // LOD_ZOOM (far out, the extra trim is sub-pixel anyway).
  // PR 5: camera sensitivity sliders apply live.
  cam.rotateSpeed = sim.settings.camRotate;
  cam.panSpeed = sim.settings.camPan;
  city.setLod(sim.settings.detail === 'high' && cam.zoom >= LOD_ZOOM ? 'high' : 'low');
  city.setWireLod(cam.zoom < LOD_ZOOM * 0.5); // NEBULA: wires off when far out
  city.cameraQuat.copy(cam.camera.quaternion);
  city.setView(cam.camera, GRID_SIZE); // V1.6 A5: frustum-culled chunk set
  city.windDir = sim.world.windDir; // PR 5: turbines yaw toward this
  city.frame(sim, clock.elapsedTime);
  graphLayer.showZones = tool === 'freeRoad' || ZONE_TOOLS.has(tool);
  graphLayer.updateGrid(city.overlay === 'grid' ? sim : null); // power & water grid ribbons along the roads
  graphLayer.sync(sim.world.roads, sim.world.blocks);
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
// V1.5: never while the title screen's demo town is running.
const autosave = () => !inTitle && saveWorld(sim.world);
setInterval(autosave, 20_000);
document.addEventListener('visibilitychange', () => document.hidden && autosave());
window.addEventListener('beforeunload', autosave);
if (resume === 'continue') hud.flash('Updated — welcome back');

// ---- V1.5: title screen ----
/**
 * Leave the title screen and run a real city. `kind`:
 *   'continue' -> the autosave (falls back to a new city if unreadable)
 *   'new'      -> a fresh city (optionally seeded / dry map) — erases the autosave
 */
function startGame(kind: 'continue' | 'new', opts: NewGameOptions = { map: 'river' }): void {
  if (kind === 'new') {
    clearSave();
    setGridSize(opts.size ?? 64); // V1.6 A6: map size chosen on the title screen
    sim = new Simulation(new World(undefined, opts.seed, { dry: opts.map === 'dry' }));
    // OASIS: new games are GRAPH WORLDS from the start — the generated roads
    // (highway connection) are traced into the road graph, drawn by the graph
    // renderer, and every road built afterwards (tile or free tool) joins it.
    migrateToGraph(sim.world);
    sim.version++;
    gameLog.event(`New city founded (seed ${sim.world.seed}${opts.map === 'dry' ? ', dry land' : ''})`);
  } else {
    const w = loadWorld();
    sim = new Simulation(w ?? undefined);
    gameLog.event(w ? 'Saved city loaded' : 'No readable save — new city founded');
  }
  inTitle = false;
  title.hide();
  dayNight.override = null;
  // V1.6 A6: the map may have changed size (new big map, or a save of another size).
  resizeScene(sceneBundle, GRID_SIZE);
  const sr = startRegion(), rs = regionSide();
  if (rs > 1) cam.target.set((sr % rs) * REGION + REGION / 2, 0, Math.floor(sr / rs) * REGION + REGION / 2);
  else cam.target.set(GRID_SIZE / 2, 0, GRID_SIZE / 2);
  cam.zoomBy(1 / 1.5);
  sim.speed = lastSpeed;
  hud.inspect(null);
  hud.notices.reset(sim);
  setTool('inspect');
  saveWorld(sim.world);
}

const title = new TitleScreen({
  newGame: (opts) => startGame('new', opts),
  continueGame: () => startGame('continue'),
  loadSlot: (i) => (loadSlotIntoMain(i) ? startGame('continue') : alert('That slot is empty or unreadable.')),
  importSave: (text) => {
    if (!importSaveText(text)) return false;
    startGame('continue');
    return true;
  },
  openSettings: () => menu.toggle(true),
  openChangelog: () => changelog.open(),
  saveSlot: (i) => saveToSlot(i),
});
if (inTitle) {
  // Frame the demo town (it sits around tiles 18..45 x 19..33) a bit closer.
  cam.target.set(31, 0, 26);
  cam.zoomBy(1.5);
  title.show();
  gameLog.event('Title screen');
}

// First start after an update: show what changed (once per change-log entry).
changelog.openIfUnseen();

// ---- V1.5: update prompt ----
// Polls /version.json (every minute + on focus) and offers to update.
const updater = new UpdateChecker({
  save: autosave,
  exportSave: () => { saveWorld(sim.world); return downloadSave(); },
  clearSave: () => clearSave(),
  // Title screen shows an "Update available" badge next to the version.
  onAvailable: () => title.setUpdateBadge(true),
});
updater.start();

// Debug handle (handy in the browser console and for automated screenshots).
(window as unknown as { city: unknown }).city = {
  get sim() {
    return sim;
  },
  cam,
  /** V1.6 A5: the city renderer (chunk culling toggle + render stats for the render bench). */
  renderer: city,
  /** V1.6 B6/B7: free-road layer + tool + helpers (Playwright screenshots/flows). */
  graphLayer,
  freeTool,
  free: { placeFreeRoad, paintBlocks, quadCubic, lineCubic, undo, redo },
  /** NEBULA testing: trace a tile-road world into the graph (as loading a v9 save does). */
  migrateToGraph,
  /** PR 4 testing: swap in a prepared Simulation (e.g. new city.sim.constructor(world)). */
  useSim: (s: Simulation) => {
    sim = s;
    hud.notices.reset(sim);
  },
  setTool,
  /** V1.5b: template table (screenshots place showcase buildings). */
  TPL,
  updater,
  /** V1.5: leave the title screen (tests/screenshots). */
  startGame,
  title,
  get inTitle() {
    return inTitle;
  },
  saveToSlot: (i: number) => (autosave(), saveToSlot(i)),
  setOverlay,
  setSpeed,
  /** Force a time of day for screenshots (0 = midnight, 0.5 = noon); null = follow the sim. */
  openGraphs: () => hud.graphs.toggle(true),
  menu,
  changelog,
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
