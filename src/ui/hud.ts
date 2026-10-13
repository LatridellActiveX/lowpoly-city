/**
 * ui/hud.ts — all the HTML user interface: toolbar, top stats bar, time
 * controls, overlay toggles, save/load buttons and the info panel.
 *
 * The UI is plain DOM (no framework). It reads from the Simulation and calls
 * back into main.ts through the `HudActions` interface, so it never touches
 * Three.js directly.
 *
 * The BUDGET PANEL is built once (so the tax sliders don't get recreated
 * while you drag them) and only its numbers are refreshed.
 */
import { Simulation } from '../sim/simulation';
import { ToolId, ZoneType } from '../sim/types';
import { BUILD_COST, growthFactor, ledgerNet, MAX_TAX, monthlyTax, UPKEEP } from '../sim/economy';
import { coords } from '../sim/grid';
import { OverlayMode } from '../render/cityRenderer';
import { TOOLS, toolDef } from './tools';
import { output } from '../sim/networks';
import { windLabel } from '../sim/wind';

/** Small wind gauge for the stats bar: a bar plus a word ("Calm", "Gusty"...). */
function windGauge(wind: number): string {
  const pct = Math.round(wind * 100);
  const cls = wind < 0.2 ? 'over' : wind < 0.4 ? 'warn' : '';
  return `<span class="meter wind ${cls}"><i style="width:${pct}%"></i></span>${windLabel(wind)}`;
}

export interface HudActions {
  selectTool(id: ToolId): void;
  setSpeed(s: number): void;
  setOverlay(o: OverlayMode): void;
  setTax(zone: ZoneType, rate: number): void;
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
  private readonly budget = el('div', 'budget hidden');
  private readonly money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
  private infoTile: number | null = null;
  private currentTool: ToolId = 'inspect';
  private lastSim: Simulation | null = null;
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
        ['pollution', '☁️ Pollution'],
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

    const budgetBtn = el('button', 'btn', '💰 Budget') as HTMLButtonElement;
    budgetBtn.onclick = () => {
      const open = this.budget.classList.toggle('hidden') === false;
      budgetBtn.classList.toggle('active', open);
      if (open) this.refreshBudget(this.lastSim!);
    };
    const file = el('div', 'group');
    file.append(budgetBtn);
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

    this.buildBudget(actions);
    root.append(top, this.info, this.budget, this.hint, bar, this.toast);
  }

  /** Create the budget panel's static structure + tax sliders. */
  private buildBudget(actions: HudActions): void {
    const zones: Array<[ZoneType, string]> = [
      ['residential', '🏠 Residential'],
      ['commercial', '🏪 Commercial'],
      ['industrial', '🏭 Industrial'],
    ];
    const row = (id: string, label: string) => `<tr><td>${label}</td><td data-k="${id}.now"></td><td data-k="${id}.last"></td></tr>`;
    this.budget.innerHTML = `
      <button class="close" aria-label="Close">×</button>
      <h3>City budget</h3>
      <table>
        <thead><tr><th></th><th>This month*</th><th>Last month</th></tr></thead>
        <tbody>
          <tr class="sec"><td colspan="3">Income (taxes)</td></tr>
          ${zones.map(([z, l]) => row(`tax.${z}`, l)).join('')}
          <tr class="sec"><td colspan="3">Expenses (upkeep)</td></tr>
          ${row('up.powerPlant', '⚡ Power plants')}${row('up.windTurbine', '🌬️ Wind turbines')}${row('up.waterTower', '🗼 Water towers')}${row('up.park', '🌳 Parks')}
          <tr class="sec"><td colspan="3">One-off</td></tr>
          ${row('construction', '🏗 Construction')}${row('refunds', '♻ Bulldoze refunds')}
          <tr class="net">${'<td>Net</td><td data-k="net.now"></td><td data-k="net.last"></td>'}</tr>
        </tbody>
      </table>
      <div class="muted small">*Taxes and upkeep are projected from the city as it is now; they're booked at month end.</div>
      <h4>Tax rates</h4>
      ${zones
        .map(
          ([z, l]) => `<label class="tax"><span>${l}</span><input type="range" min="0" max="${MAX_TAX * 100}" step="1" data-zone="${z}">
          <b data-k="rate.${z}"></b></label>`,
        )
        .join('')}
      <div class="muted small" data-k="growth"></div>`;
    (this.budget.querySelector('.close') as HTMLButtonElement).onclick = () => this.budget.classList.add('hidden');
    this.budget.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      inp.oninput = () => actions.setTax(inp.dataset.zone as ZoneType, Number(inp.value) / 100);
    });
  }

  private setCell(k: string, html: string): void {
    const c = this.budget.querySelector(`[data-k="${k}"]`);
    if (c) c.innerHTML = html;
  }

  private refreshBudget(sim: Simulation): void {
    const w = sim.world;
    const now = sim.projectMonth();
    now.construction = w.ledger.construction;
    now.refunds = w.ledger.refunds;
    const last = w.lastLedger;
    const fmt = (n: number | undefined, neg = false) => (n === undefined ? '—' : n === 0 ? '$0' : `<span class="${neg ? 'bad' : 'ok'}">${neg ? '-' : '+'}${this.money(n)}</span>`);
    for (const z of ['residential', 'commercial', 'industrial'] as const) {
      this.setCell(`tax.${z}.now`, fmt(now.taxes[z]));
      this.setCell(`tax.${z}.last`, fmt(last?.taxes[z]));
      const rate = w.taxRates[z];
      this.setCell(`rate.${z}`, `${Math.round(rate * 100)}%`);
      const inp = this.budget.querySelector<HTMLInputElement>(`input[data-zone="${z}"]`)!;
      if (document.activeElement !== inp) inp.value = String(Math.round(rate * 100));
    }
    for (const u of ['powerPlant', 'windTurbine', 'waterTower', 'park'] as const) {
      this.setCell(`up.${u}.now`, fmt(now.upkeep[u], true));
      this.setCell(`up.${u}.last`, fmt(last?.upkeep[u], true));
    }
    this.setCell('construction.now', fmt(now.construction, true));
    this.setCell('construction.last', fmt(last?.construction, true));
    this.setCell('refunds.now', fmt(now.refunds));
    this.setCell('refunds.last', fmt(last?.refunds));
    const n = ledgerNet(now);
    const ln = last ? ledgerNet(last) : undefined;
    this.setCell('net.now', fmt(Math.abs(n), n < 0));
    this.setCell('net.last', ln === undefined ? '—' : fmt(Math.abs(ln), ln < 0));
    const g = (z: ZoneType) => `${Math.round(growthFactor(w.taxRates[z]) * 100)}%`;
    this.setCell('growth', `Growth speed vs. default: homes ${g('residential')}, shops ${g('commercial')}, industry ${g('industrial')}. Lower taxes grow faster.`);
  }

  /** Update the hint line with the price of the current hover/drag. */
  showCost(tool: ToolId, cost: number, affordable: boolean, cash: number): void {
    const base = toolDef(tool).hint;
    if (tool === 'inspect') return void (this.hint.textContent = base);
    if (!affordable) {
      this.hint.innerHTML = `<span class="bad">Not enough money: costs ${this.money(cost)}, you have ${this.money(cash)}</span>`;
    } else if (tool === 'bulldoze') {
      this.hint.textContent = `${base} Refunds 25% of what it cost.`;
    } else {
      this.hint.textContent = `${base} Cost: ${this.money(cost)}`;
    }
  }

  setTool(id: ToolId): void {
    this.currentTool = id;
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
    // The top bar can wrap onto two rows on narrower screens, so place the
    // floating panels just below wherever it currently ends.
    const below = `${Math.round(this.stats.parentElement!.getBoundingClientRect().bottom + 8)}px`;
    this.info.style.top = below;
    this.budget.style.top = below;
    const s = sim.stats();
    const bar = (used: number, cap: number) => {
      const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : used > 0 ? 100 : 0;
      const cls = used > cap ? 'over' : pct > 85 ? 'warn' : '';
      return `<span class="meter ${cls}"><i style="width:${pct}%"></i></span>${used}/${cap}`;
    };
    this.lastSim = sim;
    const cash = sim.world.cash;
    const mo = sim.world.month;
    const year = Math.floor((mo - 1) / 12) + 1;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    this.stats.innerHTML =
      `<span class="cash ${cash < 0 ? 'bad' : ''}" title="Cash">💵 ${this.money(cash)}</span>` +
      `<span title="Residents">👥 ${s.population}</span>` +
      `<span title="Jobs">💼 ${s.jobs}</span>` +
      `<span title="Power demand / capacity">⚡ ${bar(s.power.demand, s.power.capacity)}</span>` +
      `<span title="Wind: turbines make 15 × wind power (now ${Math.round(15 * sim.world.wind)} each)">🌬️ ${windGauge(sim.world.wind)}</span>` +
      `<span title="Water demand / capacity">💧 ${bar(s.water.demand, s.water.capacity)}</span>` +
      (s.outages ? `<span class="alert" title="Buildings in an outage">⚠ ${s.outages} outage${s.outages > 1 ? 's' : ''}</span>` : '') +
      `<span class="day" title="Month ${mo}">${MONTHS[(mo - 1) % 12]} ${sim.world.day}, Year ${year}</span>`;

    // Grey out tools you can't afford even one of.
    for (const t of TOOLS) {
      const b = this.toolButtons.get(t.id)!;
      if (t.id === 'inspect' || t.id === 'bulldoze') continue;
      const price = BUILD_COST[t.id];
      const poor = cash < price;
      b.classList.toggle('unaffordable', poor);
      b.title = `${t.label} (${t.key.toUpperCase()}) — ${this.money(price)}${t.shape === 'point' ? '' : ' per tile'}${poor ? ' — NOT ENOUGH MONEY' : ''}\n${t.hint}`;
    }
    if (!this.budget.classList.contains('hidden')) this.refreshBudget(sim);
    void this.currentTool;

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
      park: 'Park',
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
      if (t.zone && t.level > 0) rows.push(`<div class="row">Taxes: <b>${this.money(monthlyTax(t, st.operating, sim.world.taxRates))}</b>/month</div>`);
      if (st.missing.length) rows.push(`<div class="row bad">Missing: ${st.missing.join(', ')}</div>`);
      if (t.zone === 'residential') {
        // Pollution & desirability (PR 3): explain why a home is stuck.
        const env = sim.env;
        rows.push(`<div class="row">Pollution: <b class="${env.pollution[i] > 2 ? 'bad' : ''}">${env.pollution[i].toFixed(1)}</b> · Desirability: <b class="${env.desirability[i] < 0.6 ? 'bad' : 'ok'}">${env.desirability[i].toFixed(2)}</b></div>`);
        const cap = sim.maxLevel(i);
        if (cap === 0) rows.push('<div class="row bad">Too polluted to grow. Move industry away or add a park.</div>');
        else if (cap < 3) rows.push(`<div class="row bad">Pollution limits this home to level ${cap}.</div>`);
      } else if (t.zone) {
        rows.push(`<div class="row muted">Pollution here: ${sim.env.pollution[i].toFixed(1)}</div>`);
      }
      if (t.zone && t.level === 0 && st.operating && sim.maxLevel(i) > 0) rows.push('<div class="row muted">Serviced — a building will grow here soon.</div>');
    } else if (t.structure === 'powerPlant' || t.structure === 'windTurbine') {
      // Turbine output follows the wind (sim/wind.ts); plants are constant.
      const out = output(t, 'power', sim.world.wind);
      rows.push(`<div class="row">Output: ${out} power${t.structure === 'windTurbine' ? ` <span class="muted">(max 15, wind ${Math.round(sim.world.wind * 100)}%)</span>` : ''}</div>`);
      rows.push(`<div class="row">Upkeep: ${this.money(UPKEEP[t.structure])}/month</div>`);
      rows.push(`<div class="row muted">${netLine('power')}</div>`);
    } else if (t.structure === 'park') {
      rows.push(`<div class="row">Raises desirability within 3 tiles.</div>`);
      rows.push(`<div class="row">Upkeep: ${this.money(UPKEEP.park)}/month</div>`);
    } else if (t.powerLine || t.waterPipe) {
      if (t.powerLine) rows.push(`<div class="row">Power: <span class="muted">${netLine('power')}</span></div>`);
      if (t.waterPipe) rows.push(`<div class="row">Water: <span class="muted">${netLine('water')}</span></div>`);
    }
    this.info.innerHTML = `<button class="close" aria-label="Close">×</button><h3>${title}</h3>${rows.join('')}`;
    (this.info.querySelector('.close') as HTMLButtonElement).onclick = () => this.inspect(null);
  }
}
