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
import { ToolGroupId, TOOL_GROUPS, TOOLS, toolDef } from './tools';
import { GraphsPanel } from './graphs';
import { Notifier } from './notifications';
import { DemandBars } from './demandBars';
import { output } from '../sim/networks';
import { windLabel } from '../sim/wind';
import { isUnlocked, RESOURCES_TIER, TIERS, TOOL_TIER } from '../sim/progression';
import { factoryGood, GOOD_NAMES, shopGood } from '../sim/goods';
import { RESOURCE_NAMES } from '../sim/resources';
import { CONSTRUCT_TICKS, FUEL_MAX, JOBS_PER_LEVEL, MAX_RES_LEVEL, RESIDENTS_AT, residentsOf } from '../sim/rules';

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
  /** PR 5: grouped toolbar — one button + one flyout menu per group. */
  private readonly groupButtons = new Map<ToolGroupId, HTMLButtonElement>();
  private readonly flyouts = new Map<ToolGroupId, HTMLDivElement>();
  /** Last tool used in each group; the group button shows and re-selects it. */
  private readonly lastInGroup: Record<ToolGroupId, ToolId> = { roads: 'road', power: 'powerLine', water: 'waterPipe' };
  /** Which flyout is open right now (null = none). Number keys pick inside it. */
  openGroup: ToolGroupId | null = null;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly overlayButtons = new Map<OverlayMode, HTMLButtonElement>();
  private readonly stats = el('div', 'stats');
  private readonly hint = el('div', 'hint');
  private readonly info = el('div', 'info hidden');
  private readonly toast = el('div', 'toast');
  private readonly budget = el('div', 'budget hidden');
  /** Cost tooltip that follows the mouse (PR 3). */
  private readonly tip = el('div', 'cost-tip hidden');
  /** Graphs panel and stacked notifications (PR 3). */
  readonly graphs = new GraphsPanel();
  readonly notices = new Notifier();
  /** PR 4 RCI demand bars (bottom-left). */
  readonly demandBars = new DemandBars();
  private readonly money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
  private infoTile: number | null = null;
  private currentTool: ToolId = 'inspect';
  private lastSim: Simulation | null = null;
  private toastTimer = 0;
  /** Time-of-day text from the day/night cycle, e.g. "21:40". */
  private lastClock = '';

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
        ['resources', '🗺 Resources'],
      ] as Array<[OverlayMode, string]>
    ).forEach(([mode, label]) => {
      // PR 5: the word goes in a .lbl span that hides on narrow (≤1500 px)
      // screens, leaving just the icon (full name stays in the tooltip).
      const sp = label.indexOf(' ');
      const b = el('button', 'btn', sp > 0 ? `${label.slice(0, sp)}<span class="lbl">${label.slice(sp)}</span>` : label) as HTMLButtonElement;
      if (!b.title) b.title = label;
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

    const budgetBtn = el('button', 'btn', '💰<span class="lbl"> Budget</span>') as HTMLButtonElement;
    budgetBtn.title = 'Budget';
    budgetBtn.onclick = () => {
      const open = this.budget.classList.toggle('hidden') === false;
      budgetBtn.classList.toggle('active', open);
      if (open) this.refreshBudget(this.lastSim!);
    };
    const graphsBtn = el('button', 'btn', '📈<span class="lbl"> Graphs</span>') as HTMLButtonElement;
    graphsBtn.title = 'Graphs';
    graphsBtn.onclick = () => {
      const open = this.graphs.toggle();
      if (open && this.lastSim) this.graphs.update(this.lastSim);
    };
    const file = el('div', 'group');
    file.append(budgetBtn, graphsBtn);
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
    // PR 5: tools with a `group` live in a flyout above their group button.
    // The group button sits where the first of its tools used to be, so the
    // toolbar order stays familiar: Inspect, Roads, zones, Power, Water, Park...
    const bar = el('div', 'toolbar');
    const placed = new Set<ToolGroupId>();
    for (const t of TOOLS) {
      if (t.group) {
        if (placed.has(t.group)) continue;
        placed.add(t.group);
        bar.append(this.buildGroup(t.group, actions));
        continue;
      }
      const b = el('button', 'tool', `<span class="icon">${t.icon}</span><span class="label">${t.label}</span>`) as HTMLButtonElement;
      b.title = `${t.label} (${t.key.toUpperCase()}) — ${t.hint}`;
      b.onclick = () => {
        this.closeFlyout();
        actions.selectTool(t.id);
      };
      this.toolButtons.set(t.id, b);
      bar.append(b);
    }
    // Clicking anywhere outside the toolbar closes an open flyout.
    window.addEventListener('pointerdown', (e) => {
      if (this.openGroup && !(e.target as HTMLElement).closest('.tool-group')) this.closeFlyout();
    });

    this.buildBudget(actions);
    root.append(top, this.info, this.budget, this.graphs.el, this.hint, bar, this.toast, this.tip, this.notices.el, this.demandBars.el);
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
          ${row('up.powerPlant', '⚡ Power plants')}${row('up.windTurbine', '🌬️ Wind turbines')}${row('up.waterTower', '🗼 Water towers')}${row('up.park', '🌳 Parks')}${row('up.nuclearPlant', '☢️ Nuclear')}${row('up.pumpStation', '⛲ Pump stations')}
          <tr class="sec"><td colspan="3">Trade (PR 4)</td></tr>
          ${row('trade.exports', '🚚 Exports')}${row('trade.fuel', '⛏ Imported coal')}
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
    this.setCell('trade.exports.now', fmt(w.ledger.trade.exports));
    this.setCell('trade.exports.last', fmt(last?.trade?.exports));
    this.setCell('trade.fuel.now', fmt(w.ledger.trade.fuel, true));
    this.setCell('trade.fuel.last', fmt(last?.trade?.fuel, true));
    now.trade = w.ledger.trade;
    for (const u of ['powerPlant', 'windTurbine', 'waterTower', 'park', 'nuclearPlant', 'pumpStation'] as const) {
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

  /** Show the cost tooltip near the cursor, or hide it with null. */
  showTip(html: string | null, x = 0, y = 0): void {
    this.tip.classList.toggle('hidden', html === null);
    if (html === null) return;
    this.tip.innerHTML = html;
    // Offset so the tip doesn't sit under the cursor and hide the tile.
    this.tip.style.left = `${x + 18}px`;
    this.tip.style.top = `${y + 18}px`;
  }

  /**
   * PR 5: build one group button + its flyout. The flyout is a column of
   * rows: [number] icon  name  price  (🔒 tier badge when locked).
   */
  private buildGroup(gid: ToolGroupId, actions: HudActions): HTMLElement {
    const g = TOOL_GROUPS.find((x) => x.id === gid)!;
    const wrap = el('div', 'tool-group');
    const btn = el('button', 'tool group-btn') as HTMLButtonElement;
    btn.title = `${g.label} — click for the menu, then pick with the mouse or number keys`;
    const fly = el('div', 'flyout hidden') as HTMLDivElement;
    fly.append(el('div', 'flyout-title', `${g.icon} ${g.label}`));
    g.tools.forEach((id, n) => {
      const t = toolDef(id);
      const row = el(
        'button',
        'fly-item',
        `<kbd>${n + 1}</kbd><span class="icon">${t.icon}</span><span class="name">${t.label}<small>${t.key.toUpperCase()}</small></span><span class="price"></span><span class="lock"></span>`,
      ) as HTMLButtonElement;
      row.onclick = () => {
        actions.selectTool(id);
        this.closeFlyout();
      };
      this.toolButtons.set(id, row);
      fly.append(row);
    });
    if (gid === 'roads') {
      // Bridges are automatic: any road dragged over water becomes a bridge.
      const row = el('button', 'fly-item info', `<kbd>${g.tools.length + 1}</kbd><span class="icon">🌉</span><span class="name">Bridge<small>auto</small></span><span class="price">+$48</span><span class="lock"></span>`) as HTMLButtonElement;
      row.title = 'Bridges build automatically: drag a road or avenue across water (+$48 per water tile). Selects the Road tool.';
      row.onclick = () => {
        actions.selectTool('road');
        this.closeFlyout();
      };
      fly.append(row);
    }
    btn.onclick = () => {
      if (this.openGroup === gid) return this.closeFlyout();
      this.openFlyout(gid);
      // Opening the menu also picks the tool you used last in this group.
      actions.selectTool(this.lastInGroup[gid]);
    };
    this.groupButtons.set(gid, btn);
    this.flyouts.set(gid, fly);
    wrap.append(fly, btn);
    this.paintGroup(gid);
    return wrap;
  }

  /** Group button face = icon of the remembered tool + group name + ▴ caret. */
  private paintGroup(gid: ToolGroupId): void {
    const t = toolDef(this.lastInGroup[gid]);
    const g = TOOL_GROUPS.find((x) => x.id === gid)!;
    this.groupButtons.get(gid)!.innerHTML = `<span class="icon">${t.icon}</span><span class="label">${g.label} ▴</span>`;
  }

  openFlyout(gid: ToolGroupId): void {
    this.closeFlyout();
    this.openGroup = gid;
    this.flyouts.get(gid)!.classList.remove('hidden');
    this.groupButtons.get(gid)!.classList.add('open');
  }

  closeFlyout(): void {
    if (!this.openGroup) return;
    this.flyouts.get(this.openGroup)!.classList.add('hidden');
    this.groupButtons.get(this.openGroup)!.classList.remove('open');
    this.openGroup = null;
  }

  /**
   * PR 5: number key n while a flyout is open → the n-th row of it.
   * Returns the tool to select, or null if no flyout is open / no such row.
   */
  flyoutPick(n: number): ToolId | null {
    if (!this.openGroup) return null;
    const g = TOOL_GROUPS.find((x) => x.id === this.openGroup)!;
    if (n === g.tools.length + 1 && g.id === 'roads') return 'road'; // the Bridge info row
    return g.tools[n - 1] ?? null;
  }

  setTool(id: ToolId): void {
    this.currentTool = id;
    this.toolButtons.forEach((b, k) => b.classList.toggle('active', k === id));
    // PR 5: remember the tool in its group and highlight the group button.
    const gid = toolDef(id).group;
    if (gid) {
      this.lastInGroup[gid] = id;
      this.paintGroup(gid);
    }
    this.groupButtons.forEach((b, k) => b.classList.toggle('active', k === gid));
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
  refresh(sim: Simulation, clock = this.lastClock): void {
    this.lastClock = clock;
    // The top bar can wrap onto two rows on narrower screens, so place the
    // floating panels just below wherever it currently ends.
    const below = `${Math.round(this.stats.parentElement!.getBoundingClientRect().bottom + 8)}px`;
    this.info.style.top = below;
    this.budget.style.top = below;
    this.graphs.el.style.top = below;
    this.notices.el.style.top = below;
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
      this.tierBadge(sim, s.population) +
      `<span title="Power demand / capacity">⚡ ${bar(s.power.demand, s.power.capacity)}</span>` +
      `<span title="Wind: turbines make 800 × wind power (now ${Math.round(800 * sim.world.wind)} each, ~400 people at average wind)">🌬️ ${windGauge(sim.world.wind)}</span>` +
      `<span title="Water demand / capacity">💧 ${bar(s.water.demand, s.water.capacity)}</span>` +
      (s.outages ? `<span class="alert" title="Buildings in an outage">⚠ ${s.outages} outage${s.outages > 1 ? 's' : ''}</span>` : '') +
      `<span class="day" title="Month ${mo}">${MONTHS[(mo - 1) % 12]} ${sim.world.day}, Year ${year}${clock ? ` · 🕒 ${clock}` : ''}</span>`;

    // Grey out tools you can't afford even one of.
    for (const t of TOOLS) {
      const b = this.toolButtons.get(t.id)!;
      if (t.id === 'inspect' || t.id === 'bulldoze') continue;
      const price = BUILD_COST[t.id];
      const poor = cash < price;
      // PR 4: tools above the city's tier show a padlock and the population needed.
      const locked = !isUnlocked(t.id, sim.world.tier);
      b.classList.toggle('locked', locked);
      b.classList.toggle('unaffordable', poor && !locked);
      const need = TIERS[TOOL_TIER[t.id] ?? 0];
      // PR 5: flyout rows show the price (or the tier needed) as text.
      const priceEl = b.querySelector('.price');
      if (priceEl) priceEl.textContent = `${this.money(price)}${t.shape === 'line' ? '/tile' : ''}`;
      const lockEl = b.querySelector('.lock');
      if (lockEl) lockEl.textContent = locked ? `🔒 ${need.pop.toLocaleString()}` : '';
      b.title = locked
        ? `🔒 ${t.label} — unlocks at ${need.pop.toLocaleString()} people (${need.name})`
        : `${t.label} (${t.key.toUpperCase()}) — ${this.money(price)}${t.shape === 'point' ? '' : ' per tile'}${poor ? ' — NOT ENOUGH MONEY' : ''}\n${t.hint}`;
    }
    // Resources overlay is locked until the Town tier.
    const resBtn = this.overlayButtons.get('resources')!;
    const resLocked = sim.world.tier < RESOURCES_TIER;
    resBtn.classList.toggle('locked', resLocked);
    resBtn.title = resLocked ? `🔒 Unlocks at ${TIERS[RESOURCES_TIER].pop.toLocaleString()} people` : 'Resource patches: farmland (yellow), logging (green), quarry (grey), oil (black)';
    // Tier unlock messages from the sim become notifications.
    for (const msg of sim.events.splice(0)) this.notices.push(msg, 'good');
    {
    }
    if (!this.budget.classList.contains('hidden')) this.refreshBudget(sim);
    this.graphs.update(sim);
    this.demandBars.update(sim);
    this.notices.check(sim);
    void this.currentTool;

    if (this.infoTile !== null) this.renderInfo(sim, this.infoTile);
  }

  /** PR 4: "🏘 Village · 612 / 2,000" progress toward the next tier. */
  private tierBadge(sim: Simulation, pop: number): string {
    const tier = sim.world.tier;
    const t = TIERS[tier];
    const next = TIERS[tier + 1];
    const pct = next ? Math.min(100, ((pop - t.pop) / (next.pop - t.pop)) * 100) : 100;
    const title = next ? `Next tier: ${next.name} at ${next.pop.toLocaleString()} — unlocks ${next.unlocks}` : 'Highest tier reached';
    return `<span class="tier" title="${title}">🏘 ${t.name}${next ? ` <span class="meter tiermeter"><i style="width:${pct}%"></i></span>` : ''}</span>`;
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
      nuclearPlant: 'Nuclear Power Plant (2×2)',
      pumpStation: 'Pump Station',
      residential: 'House',
      commercial: 'Shop',
      industrial: 'Factory',
    };
    let title = 'Empty land';
    if (t.structure !== 'none' && t.structure !== 'building') title = names[t.structure];
    else if (t.zone) title = t.level > 0 ? `${names[t.zone]} (level ${t.level})` : `Empty ${t.zone} lot`;
    else if (t.road || t.powerLine || t.waterPipe)
      title = [t.road && 'Road', t.powerLine && 'Power line', t.waterPipe && 'Water pipe'].filter(Boolean).join(' + ');

    if (t.edge) title = 'Highway connection';
    else if (t.road && t.water) title = t.roadType === 1 ? 'Avenue bridge' : 'Bridge';
    else if (t.road && t.roadType === 1 && !t.powerLine && !t.waterPipe) title = 'Avenue';
    else if (t.water) title = 'Water';
    const rows: string[] = [`<div class="row muted">Tile ${x}, ${z}${sim.world.tier >= RESOURCES_TIER && sim.world.resourceAt(i) ? ` · ${RESOURCE_NAMES[sim.world.resourceAt(i)]} patch` : ''}</div>`];
    // ---- PR 4 rows: construction, goods, fuel, highway ----
    if (t.construct > 0) {
      const pct = Math.round((1 - t.construct / CONSTRUCT_TICKS) * 100);
      rows.push(`<div class="row">🏗 Under construction: <b>${pct}%</b> (to level ${t.level + 1})${sim.status(i).operating ? '' : ' <span class="bad">— paused, needs road, power and water</span>'}</div>`);
    }
    // PR 5: occupancy rows (re-rendered every HUD tick, so they update live).
    //  - Homes: people living there now vs the level's capacity (RESIDENTS_AT,
    //    incl. medium density). The newest level's people count only once
    //    their car arrives (residentsOf), and nobody lives in a building
    //    that isn't operating.
    //  - Shops/factories: the sim has no per-building worker list, so jobs are
    //    filled at the CITY-WIDE rate: min(1, population ÷ total jobs).
    if (t.zone === 'residential' && t.level > 0) {
      const cap = RESIDENTS_AT[Math.min(t.level, MAX_RES_LEVEL)];
      const now = sim.status(i).operating ? residentsOf(t) : 0;
      rows.push(`<div class="row">Residents: <b>${now} / ${cap}</b>${t.movingIn ? ' · 🚗 new residents on the way' : ''}</div>`);
    }
    if ((t.zone === 'commercial' || t.zone === 'industrial') && t.level > 0) {
      const cap = JOBS_PER_LEVEL[t.zone] * t.level;
      const cs = sim.stats();
      const rate = cs.jobs > 0 ? Math.min(1, cs.population / cs.jobs) : 0;
      const now = sim.status(i).operating ? Math.round(cap * rate) : 0;
      rows.push(`<div class="row">Workers: <b>${now} / ${cap}</b></div>`);
    }
    if (t.zone === 'industrial' && t.level > 0) rows.push(`<div class="row">Makes: <b>${GOOD_NAMES[factoryGood(sim.world, i)]}</b> · in stock ${t.stock.toFixed(1)}</div>`);
    if (t.zone === 'commercial' && t.level > 0) rows.push(`<div class="row">Sells: <b>${GOOD_NAMES[shopGood(sim.world, i)]}</b> · shelves ${t.stock.toFixed(1)}${t.stock <= 0 ? ' <span class="bad">(empty: half tax)</span>' : ''}${sim.shipping.isIncoming(i) ? ' · 🚚 delivery on the way' : ''}</div>`);
    if (t.structure === 'powerPlant') rows.push(`<div class="row">Fuel: <b class="${t.stock <= 0 ? 'bad' : ''}">${Math.round((t.stock / FUEL_MAX) * 100)}%</b>${t.stock <= 0 ? ' — running on backup (30)' : ''}${sim.shipping.isIncoming(i) ? ' · 🚚 fuel on the way' : ''}</div>`);
    if (t.edge) rows.push('<div class="row">Cars and trucks enter and leave the city here. Exports and imports use this road.</div>');
    const yes = (b: boolean) => (b ? '<b class="ok">yes</b>' : '<b class="bad">no</b>');
    const netLine = (kind: 'power' | 'water') => {
      const id = kind === 'power' ? svc.powerNet : svc.waterNet;
      if (id < 0) return 'not connected';
      const n = (kind === 'power' ? sim.net.power : sim.net.water)[id];
      return `network #${id + 1}: ${n.demand}/${n.capacity} used${n.outages ? `, <b class="bad">${n.outages} in outage</b>` : ''}`;
    };
    if (t.zone || t.structure === 'waterTower' || t.structure === 'pumpStation') {
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
    } else if (t.structure === 'powerPlant' || t.structure === 'windTurbine' || t.structure === 'nuclearPlant') {
      // Turbine output follows the wind (sim/wind.ts); plants are constant.
      const out = output(t, 'power', sim.world.wind);
      rows.push(`<div class="row">Output: ${out} power${t.structure === 'windTurbine' ? ` <span class="muted">(max 15, wind ${Math.round(sim.world.wind * 100)}%)</span>` : ''}</div>`);
      rows.push(`<div class="row">Upkeep: ${this.money(UPKEEP[t.structure])}/month</div>`);
      if (t.part) rows.push('<div class="row muted">Part of a 2×2 nuclear plant (output is counted on its top-left tile).</div>');
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
