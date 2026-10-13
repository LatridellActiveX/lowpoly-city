/**
 * ui/hud.ts — all the HTML user interface: toolbar, top stats bar, time
 * controls, overlay toggles, save/load buttons and the info panel.
 *
 * The UI is plain DOM (no framework). It reads from the Simulation and calls
 * back into main.ts through the `HudActions` interface, so it never touches
 * Three.js directly.
 */
import { Simulation } from '../sim/simulation';
import { ToolId } from '../sim/types';
import { coords } from '../sim/grid';
import { OverlayMode } from '../render/cityRenderer';
import { TOOLS, toolDef } from './tools';

export interface HudActions {
  selectTool(id: ToolId): void;
  setSpeed(s: number): void;
  setOverlay(o: OverlayMode): void;
  rotate(dir: 1 | -1): void;
  zoom(f: number): void;
  save(): void;
  load(): void;
  newCity(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Hud {
  private readonly toolButtons = new Map<ToolId, HTMLButtonElement>();
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly overlayButtons = new Map<OverlayMode, HTMLButtonElement>();
  private readonly stats = el('div', 'stats');
  private readonly hint = el('div', 'hint');
  private readonly info = el('div', 'info hidden');
  private readonly toast = el('div', 'toast');
  private infoTile: number | null = null;
  private toastTimer = 0;

  constructor(root: HTMLElement, actions: HudActions) {
    // ---- Top bar: stats, time, overlays, view, file ----
    const top = el('div', 'topbar');
    top.append(this.stats);

    const time = el('div', 'group');
    (['⏸', '1×', '2×', '3×'] as const).forEach((label, s) => {
      const b = el('button', 'btn', label) as HTMLButtonElement;
      b.title = s === 0 ? 'Pause (Space)' : `Speed ${s}x`;
      b.onclick = () => actions.setSpeed(s);
      this.speedButtons.push(b);
      time.append(b);
    });

    const overlays = el('div', 'group');
    (
      [
        ['none', 'Normal'],
        ['power', '⚡ Power'],
        ['water', '💧 Water'],
      ] as Array<[OverlayMode, string]>
    ).forEach(([mode, label]) => {
      const b = el('button', 'btn', label) as HTMLButtonElement;
      b.onclick = () => actions.setOverlay(mode);
      this.overlayButtons.set(mode, b);
      overlays.append(b);
    });

    const view = el('div', 'group');
    const mk = (label: string, title: string, fn: () => void) => {
      const b = el('button', 'btn', label) as HTMLButtonElement;
      b.title = title;
      b.onclick = fn;
      view.append(b);
    };
    mk('⟲', 'Rotate left (Q)', () => actions.rotate(-1));
    mk('⟳', 'Rotate right (E)', () => actions.rotate(1));
    mk('＋', 'Zoom in', () => actions.zoom(1.25));
    mk('－', 'Zoom out', () => actions.zoom(0.8));

    const file = el('div', 'group');
    for (const [label, fn] of [
      ['Save', actions.save],
      ['Load', actions.load],
      ['New', actions.newCity],
    ] as const) {
      const b = el('button', 'btn', label) as HTMLButtonElement;
      b.onclick = fn;
      file.append(b);
    }
    top.append(time, overlays, view, file);

    // ---- Bottom toolbar ----
    const bar = el('div', 'toolbar');
    for (const t of TOOLS) {
      const b = el('button', 'tool', `<span class="icon">${t.icon}</span><span class="label">${t.label}</span>`) as HTMLButtonElement;
      b.title = `${t.label} (${t.key.toUpperCase()}) — ${t.hint}`;
      b.onclick = () => actions.selectTool(t.id);
      this.toolButtons.set(t.id, b);
      bar.append(b);
    }

    root.append(top, this.info, this.hint, bar, this.toast);
  }

  setTool(id: ToolId): void {
    this.toolButtons.forEach((b, k) => b.classList.toggle('active', k === id));
    this.hint.textContent = toolDef(id).hint;
  }

  setSpeed(s: number): void {
    this.speedButtons.forEach((b, k) => b.classList.toggle('active', k === s));
  }

  setOverlay(o: OverlayMode): void {
    this.overlayButtons.forEach((b, k) => b.classList.toggle('active', k === o));
  }

  flash(msg: string): void {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 1800);
  }

  /** Show the info panel for a tile index (or hide with null). */
  inspect(i: number | null): void {
    this.infoTile = i;
    this.info.classList.toggle('hidden', i === null);
  }

  /** Refresh numbers. Called a few times per second from main.ts. */
  refresh(sim: Simulation): void {
    const s = sim.stats();
    const bar = (used: number, cap: number) => {
      const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : used > 0 ? 100 : 0;
      const cls = used > cap ? 'over' : pct > 85 ? 'warn' : '';
      return `<span class="meter ${cls}"><i style="width:${pct}%"></i></span>${used}/${cap}`;
    };
    this.stats.innerHTML =
      `<span title="Residents">👥 ${s.population}</span>` +
      `<span title="Jobs">💼 ${s.jobs}</span>` +
      `<span title="Power demand / capacity">⚡ ${bar(s.power.demand, s.power.capacity)}</span>` +
      `<span title="Water demand / capacity">💧 ${bar(s.water.demand, s.water.capacity)}</span>` +
      (s.outages ? `<span class="alert" title="Buildings in an outage">⚠ ${s.outages} outage${s.outages > 1 ? 's' : ''}</span>` : '') +
      `<span class="day" title="Ticks since founding">Day ${Math.floor(sim.world.tick / 20) + 1}</span>`;

    if (this.infoTile !== null) this.renderInfo(sim, this.infoTile);
  }

  private renderInfo(sim: Simulation, i: number): void {
    const t = sim.world.tiles[i];
    const [x, z] = coords(i);
    const svc = sim.net.service[i];
    const names: Record<string, string> = {
      powerPlant: 'Power Plant',
      windTurbine: 'Wind Turbine',
      waterTower: 'Water Tower',
      residential: 'House',
      commercial: 'Shop',
      industrial: 'Factory',
    };
    let title = 'Empty land';
    if (t.structure !== 'none' && t.structure !== 'building') title = names[t.structure];
    else if (t.zone) title = t.level > 0 ? `${names[t.zone]} (level ${t.level})` : `Empty ${t.zone} lot`;
    else if (t.road || t.powerLine || t.waterPipe)
      title = [t.road && 'Road', t.powerLine && 'Power line', t.waterPipe && 'Water pipe'].filter(Boolean).join(' + ');

    const rows: string[] = [`<div class="row muted">Tile ${x}, ${z}</div>`];
    const yes = (b: boolean) => (b ? '<b class="ok">yes</b>' : '<b class="bad">no</b>');
    const netLine = (kind: 'power' | 'water') => {
      const id = kind === 'power' ? svc.powerNet : svc.waterNet;
      if (id < 0) return 'not connected';
      const n = (kind === 'power' ? sim.net.power : sim.net.water)[id];
      return `network #${id + 1}: ${n.demand}/${n.capacity} used${n.outages ? `, <b class="bad">${n.outages} in outage</b>` : ''}`;
    };
    if (t.zone || t.structure === 'waterTower') {
      const st = sim.status(i);
      rows.push(`<div class="row">Operating: ${yes(st.operating)}</div>`);
      if (t.zone) rows.push(`<div class="row">Road access: ${yes(st.roadAccess)}</div>`);
      rows.push(`<div class="row">Power: ${yes(st.powered)} <span class="muted">(${netLine('power')})</span></div>`);
      if (t.zone) rows.push(`<div class="row">Water: ${yes(st.watered)} <span class="muted">(${netLine('water')})</span></div>`);
      if (st.missing.length) rows.push(`<div class="row bad">Missing: ${st.missing.join(', ')}</div>`);
      if (t.zone && t.level === 0 && st.operating) rows.push('<div class="row muted">Serviced — a building will grow here soon.</div>');
    } else if (t.structure === 'powerPlant' || t.structure === 'windTurbine') {
      rows.push(`<div class="row">Output: ${t.structure === 'powerPlant' ? 120 : 15} power</div>`);
      rows.push(`<div class="row muted">${netLine('power')}</div>`);
    } else if (t.powerLine || t.waterPipe) {
      if (t.powerLine) rows.push(`<div class="row">Power: <span class="muted">${netLine('power')}</span></div>`);
      if (t.waterPipe) rows.push(`<div class="row">Water: <span class="muted">${netLine('water')}</span></div>`);
    }
    this.info.innerHTML = `<button class="close" aria-label="Close">×</button><h3>${title}</h3>${rows.join('')}`;
    (this.info.querySelector('.close') as HTMLButtonElement).onclick = () => this.inspect(null);
  }
}
