import { RegionsPanel } from './regionsPanel';
import { CELL_GRID } from '../sim/cells';
import { DEPOT_BONUS, depotOf } from '../sim/goods';
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
import { resLevel } from '../sim/footprints';
import { rangeOf } from '../sim/parking';
import { Simulation } from '../sim/simulation';
import { ToolId, ZoneType } from '../sim/types';
import { BUILD_COST, growthFactor, ledgerNet, MAX_PROPERTY, MAX_TAX, monthlyTax, propertyTax, UPKEEP } from '../sim/economy';
import { coords } from '../sim/grid';
import { OverlayMode } from '../render/cityRenderer';
import { ToolGroupId, TOOL_GROUPS, TOOLS, toolDef } from './tools';
import { GraphsPanel } from './graphs';
import { Notifier } from './notifications';
import { DemandBars } from './demandBars';
import { output } from '../sim/networks';
import { windFrom, windLabel } from '../sim/wind';
import { SERVICE_DEFS, serviceAnchors, serviceSize, Svc } from '../sim/services';
import { G_MAX, G_WARN, LANDFILL_MAX, landfillFill, landfillFull } from '../sim/garbage';
import { isUnlocked, unlockPop, RESOURCES_TIER, TIERS } from '../sim/progression';
import { factoryGood, GOOD_NAMES, shopGood } from '../sim/goods';
import { RECIPES, roleOf, ROLE_NAMES } from '../sim/chains';
import { RESOURCE_NAMES } from '../sim/resources';
import { TPL } from '../sim/footprints';
import { cellZoneLabel, industryMix } from '../sim/growth';
import { FARM_FIELDS, fieldCount, isFarmLot, isFoodPlant, YARD_FLEET } from '../sim/industry';
import { CONSTRUCT_TICKS, FUEL_MAX, POWER_OUTPUT } from "../sim/rules";

/** Small wind gauge for the stats bar: a bar plus a word ("Calm", "Gusty"...). */
function windGauge(wind: number, dir: number): string {
  const pct = Math.round(wind * 100);
  const cls = wind < 0.2 ? 'over' : wind < 0.4 ? 'warn' : '';
  // PR 5 direction arrow: points where the wind blows TO, as a map compass
  // (up = map north). The wind comes FROM bearing (π − dir), so it blows
  // toward that + 180°.
  const toDeg = ((Math.PI - dir) * 180) / Math.PI + 180;
  return `<span class="meter wind ${cls}"><i style="width:${pct}%"></i></span><span class="windarrow" style="display:inline-block;transform:rotate(${toDeg.toFixed(0)}deg)">↑</span>${windLabel(wind)} <span class="muted">from ${windFrom(dir)}</span>`;
}

export interface HudActions {
  selectTool(id: ToolId): void;
  setSpeed(s: number): void;
  setOverlay(o: OverlayMode): void;
  setTax(zone: ZoneType, rate: number): void;
  /** V1.5 stage 11: property (land-value) tax rate 0..MAX_PROPERTY. */
  setPropertyTax(rate: number): void;
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
  private readonly lastInGroup: Record<ToolGroupId, ToolId> = { roads: 'road', utilities: 'powerLine', industry: 'industrial', services: 'garbageDump' };
  /** Which flyout is open right now (null = none). Number keys pick inside it. */
  openGroup: ToolGroupId | null = null;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly overlayButtons = new Map<OverlayMode, HTMLButtonElement>();
  private viewBtn: HTMLButtonElement | null = null;
  /** Key for the Power & water grid view (shown only while it is selected). */
  private readonly gridLegend = el('div', 'panel grid-legend hidden', '<b>Power &amp; water grid</b><br>Along the roads: left line <span class="sw" style="background:#ffd21f"></span> power, right line <span class="sw" style="background:#29a3ff"></span> water<br><span class="sw" style="background:#ff3b30"></span> network overloaded · <span class="sw" style="background:#6b7280"></span> not connected to a source<br>Buildings: <span class="sw" style="background:#3ddc84"></span> served · <span class="sw" style="background:#ff3b30"></span> no power · <span class="sw" style="background:#ff9f1a"></span> no water');
  private readonly stats = el('div', 'stats');
  private readonly hint = el('div', 'hint');
  private readonly info = el('div', 'info hidden');
  private readonly toast = el('div', 'toast');
  private readonly budget = el('div', 'budget hidden');
  /** V1.6 A6: region purchase panel. */
  readonly regions = new RegionsPanel();
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
  /** PR 6: cell under the cursor when Inspect was clicked (main.ts sets it), so the panel shows THAT building. */
  pickCell: [number, number] | null = null;
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

    // All map views live in one dropdown behind a round "view menu" button.
    const overlays = el('div', 'view-menu');
    const viewBtn = el('button', 'view-btn', '👁') as HTMLButtonElement;
    viewBtn.title = 'View menu — pick a map view';
    this.viewBtn = viewBtn;
    const viewList = el('div', 'view-list hidden');
    viewBtn.onclick = () => viewList.classList.toggle('hidden');
    window.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest('.view-menu')) viewList.classList.add('hidden');
    });
    overlays.append(viewBtn, viewList);
    (
      [
        ['none', 'Normal'],
        ['power', '⚡ Power'],
        ['water', '💧 Water'],
        ['grid', '🔌 Power & water grid'],
        ['pollution', '☁️ Pollution'],
        ['resources', '🗺 Resources'],
        ['zoning', '🧱 Zoning'],
        ['parking', '🅿️ Parking'],
        ['landValue', '💎 Land value'], // V1.5 stage 11
        ['garbage', '🗑 Garbage'], // V1.5b stage E
        ['crime', '🚓 Crime'], // V1.5b stage F
        ['health', '🩺 Health care'], // V1.5b stage F
        ['education', '🎓 Education'], // V1.5b stage G
        ['shipping', '📦 Shipping'], // V1.5b stage C
      ] as Array<[OverlayMode, string]>
    ).forEach(([mode, label]) => {
      // PR 5: the word goes in a .lbl span that hides on narrow (≤1500 px)
      // screens, leaving just the icon (full name stays in the tooltip).
      const b = el('button', 'view-item', label) as HTMLButtonElement;
      b.onclick = () => {
        actions.setOverlay(mode);
        viewList.classList.add('hidden');
      };
      this.overlayButtons.set(mode, b);
      viewList.append(b);
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
    file.append(budgetBtn, graphsBtn, this.regions.button); // V1.6 A6: Regions (big maps only)
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
    root.append(top, this.gridLegend, this.info, this.budget, this.regions.el, this.graphs.el, this.hint, bar, this.toast, this.tip, this.notices.el, this.demandBars.el);
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
          ${zones.map(([z, l]) => row(`tax.${z}`, l)).join('')}${row('tax.property', '🏡 Property tax (land value)')}
          <tr class="sec"><td colspan="3">Expenses (upkeep)</td></tr>
          ${row('up.powerPlant', '⚡ Power plants')}${row('up.windTurbine', '🌬️ Wind turbines')}${row('up.waterTower', '🗼 Water towers')}${row('up.park', '🌳 Parks')}${row('up.nuclearPlant', '☢️ Nuclear')}${row('up.pumpStation', '⛲ Pump stations')}${row('up.service', '🏛️ Services')}
          <tr class="sec"><td colspan="3">Trade (PR 4)</td></tr>
          ${row('trade.exports', '🚚 Exports')}${row('trade.fuel', '⛏ Imported coal')}${row('trade.parking', '🅿️ Garage fees')}${row('trade.materials', '🧱 Imported materials')}
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
      <label class="tax"><span>🏡 Property</span><input type="range" min="0" max="${MAX_PROPERTY * 100}" step="1" data-prop="1">
          <b data-k="rate.property"></b></label>
      <div class="muted small" data-k="growth"></div>
      <h4>Businesses (last month)</h4>
      <div class="small" data-k="biz"></div>`;
    (this.budget.querySelector('.close') as HTMLButtonElement).onclick = () => this.budget.classList.add('hidden');
    this.budget.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      inp.oninput = () => (inp.dataset.prop ? actions.setPropertyTax(Number(inp.value) / 100) : actions.setTax(inp.dataset.zone as ZoneType, Number(inp.value) / 100));
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
    // V1.5 stage 11: property tax + business profit summary.
    this.setCell('tax.property.now', fmt(now.property ?? 0));
    this.setCell('tax.property.last', fmt(last?.property));
    this.setCell('rate.property', `${Math.round(w.propertyRate * 100)}%`);
    const pin = this.budget.querySelector<HTMLInputElement>('input[data-prop]')!;
    if (document.activeElement !== pin) pin.value = String(Math.round(w.propertyRate * 100));
    const biz = { commercial: [] as number[], industrial: [] as number[] };
    w.profits.forEach((p, i) => { const z = w.tiles[i].zone; if (z === 'commercial' || z === 'industrial') biz[z].push(p.net); });
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const line = (l: string, a: number[]) => a.length ? `${l}: ${a.length} · avg profit <b class="${sum(a) < 0 ? 'bad' : 'ok'}">${this.money(Math.round(sum(a) / a.length))}</b>/mo · <span class="${a.filter((x) => x < 0).length ? 'bad' : ''}">${a.filter((x) => x < 0).length} losing money</span>` : `${l}: —`;
    let lvS = 0, lvN = 0; w.tiles.forEach((t, i) => { if (t.zone) { lvS += sim.env.landValue[i]; lvN++; } });
    this.setCell('biz', `${line('🏪 Shops', biz.commercial)}<br>${line('🏭 Industry', biz.industrial)}<br>💎 Average land value of zoned land: <b>${lvN ? (lvS / lvN).toFixed(2) : '—'}</b> (overlay: 💎 Land value)`);
    this.setCell('trade.exports.now', fmt(w.ledger.trade.exports));
    this.setCell('trade.exports.last', fmt(last?.trade?.exports));
    this.setCell('trade.fuel.now', fmt(w.ledger.trade.fuel, true));
    this.setCell('trade.fuel.last', fmt(last?.trade?.fuel, true));
    this.setCell('trade.parking.now', fmt(w.ledger.trade.parking ?? 0));
    this.setCell('trade.parking.last', fmt(last?.trade?.parking));
    this.setCell('trade.materials.now', fmt(w.ledger.trade.materials ?? 0, true));
    this.setCell('trade.materials.last', fmt(last?.trade?.materials, true));
    now.trade = w.ledger.trade;
    for (const u of ['powerPlant', 'windTurbine', 'waterTower', 'park', 'nuclearPlant', 'pumpStation', 'service'] as const) {
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
      const sec = g.sections?.[id];
      if (sec) fly.append(el('div', 'flyout-section', sec));
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
    this.viewBtn?.classList.toggle('active', o !== 'none');
    this.gridLegend.classList.toggle('hidden', o !== 'grid');
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
      `<span title="Wind: turbines make 800 × wind power (now ${Math.round(800 * sim.world.wind)} each, ~400 people at average wind)">🌬️ ${windGauge(sim.world.wind, sim.world.windDir)}</span>` +
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
      const locked = !isUnlocked(t.id, sim.world.tier, sim.world.peakPop);
      b.classList.toggle('locked', locked);
      b.classList.toggle('unaffordable', poor && !locked);
      const need = { pop: unlockPop(t.id), name: TIERS.filter((q) => q.pop <= unlockPop(t.id)).pop()?.name ?? '' }; // V1.5b: services unlock by population
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
    this.regions.update(sim);
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
      powerPlant: 'Coal Power Plant',
      windTurbine: 'Wind Turbine',
      waterTower: t.kind === 1 ? 'Large Water Tower' : 'Water Tower',
      park: 'Park',
      nuclearPlant: 'Nuclear Power Plant (2×2)',
      pumpStation: 'Pump Station',
      constructionYard: 'Construction Yard',
      residential: 'House',
      commercial: 'Shop',
      industrial: 'Factory',
    };
    let title = 'Empty land';
    if (t.structure !== 'none' && t.structure !== 'building') title = names[t.structure];
    if (t.structure === 'service') title = SERVICE_DEFS[t.kind]?.label ?? 'Service'; // V1.5b
    // V1.5: oil-fired plants share the powerPlant structure (kind 1).
    if (t.structure === 'powerPlant' && t.kind === 1) title = 'Oil Power Plant';
    else if (t.zone) {
      // V1.5: residential levels run 1–7 across densities (footprints.resLevel).
      let lv = t.level;
      if (t.zone === 'residential') for (const b of sim.world.lots.buildings.values()) if (b.host === i) lv = Math.max(lv, resLevel(TPL[b.tpl], b.level));
      title = t.level > 0 ? `${names[t.zone]} (level ${lv})` : `Empty ${t.zone} lot`;
    }
    else if (t.road || t.powerLine || t.waterPipe)
      title = [t.road && 'Road', t.powerLine && 'Power line', t.waterPipe && 'Water pipe'].filter(Boolean).join(' + ');

    if (t.zone === 'industrial' && isFarmLot(sim.world, i)) title = t.level > 0 ? `Farm (level ${t.level})` : 'Empty farm lot';
    if (isFoodPlant(t)) title = t.level > 0 ? `Food Processing Plant (level ${t.level})` : 'Empty food plant lot';
    // PR 6: which building / lot / field is under the cursor cell?
    const [pcx, pcz] = this.pickCell ?? [x * 4 + 1, z * 4 + 1];
    const inTile = Math.floor(pcx / 4) === x && Math.floor(pcz / 4) === z;
    const cellOwner = inTile ? sim.world.cells.owner[pcz * CELL_GRID + pcx] : 0;
    let bld = cellOwner > 0 ? sim.world.lots.buildings.get(cellOwner) : undefined;
    const fieldOf = bld && inTile && sim.world.cells.role[pcz * CELL_GRID + pcx] === 5 ? bld : undefined;
    if (fieldOf) bld = undefined;
    if (!bld && !fieldOf) bld = sim.world.lots.hostedOn(i).find((q) => TPL[q.tpl].capacity[0] > 0) ?? sim.world.lots.onTile(sim.world, x, z).find((q) => sim.world.cells.role[pcz * CELL_GRID + pcx] !== 5 && TPL[q.tpl].capacity[0] > 0);
    const pubLot = cellOwner < 0 ? sim.world.parking.lots.get(-cellOwner) : [...sim.world.parking.lots.values()].find((l) => Math.floor(l.cx / 4) === x && Math.floor(l.cz / 4) === z);
    if (bld) {
      const tpl = TPL[bld.tpl];
      title = bld.level > 0 ? `${tpl.label}${tpl.capacity[0] > 0 ? ` (level ${bld.level}/${tpl.maxLevel})` : ''}` : `${tpl.label} — construction site`;
    } else if (fieldOf) title = 'Crop field';
    else if (pubLot) title = pubLot.garage ? `${pubLot.grown ? 'Grown' : 'Public'} parking garage (${pubLot.decks} decks)` : 'Public parking lot';
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
    // PR 6: the BUILDING under the cursor (buildings are cell entities now,
    // lots.ts). Shows its design + footprint, residents or workers, and its
    // parking: cars parked / spaces available, plus what it needs.
    if (bld) {
      const tpl = TPL[bld.tpl];
      const real = tpl.capacity[0] > 0;
      rows.push(`<div class="row">Footprint: <b>${tpl.w} × ${tpl.d} cells</b> <span class="muted">(${(tpl.w / 4).toFixed(2).replace(/\.?0+$/, '')} × ${(tpl.d / 4).toFixed(2).replace(/\.?0+$/, '')} tiles, faces ${['north', 'east', 'south', 'west'][bld.face]})</span></div>`);
      if (real && bld.level > 0) {
        const cap = tpl.capacity[Math.min(bld.level, tpl.maxLevel) - 1];
        const op = sim.status(bld.host).operating;
        if (tpl.zone === 'residential') {
          const now = !op ? 0 : bld.movingIn ? (bld.level > 1 ? tpl.capacity[bld.level - 2] : 0) : cap;
          rows.push(`<div class="row">Residents: <b>${now} / ${cap}</b>${bld.movingIn ? ' · 🚗 new residents on the way' : ''}</div>`);
        } else {
          const cs = sim.stats();
          const rate = cs.jobs > 0 ? Math.min(1, cs.population / cs.jobs) : 0;
          rows.push(`<div class="row">Workers: <b>${op ? Math.round(cap * rate) : 0} / ${cap}</b></div>`);
        }
        const pk = sim.world.parking;
        const avail = pk.available(bld), need = pk.required(bld);
        rows.push(`<div class="row">🅿️ Parking: <b>${bld.parked} / ${pk.own(bld)}</b> used${bld.publicShare ? ` <span class="muted">+ ${bld.publicShare} in public lots</span>` : ''} · needs <b class="${avail < need ? 'bad' : 'ok'}">${need}</b>${tpl.garage ? ` <span class="muted">(${tpl.garage} in garage)</span>` : ''}${tpl.bays ? ` · ${tpl.bays} truck bay${tpl.bays > 1 ? 's' : ''}` : ''}</div>`);
        if (bld.arrivals > 0.5) rows.push(`<div class="row${bld.gaveUp / bld.arrivals > 0.3 ? ' bad' : ' muted'}">Drivers who found no space lately: ${Math.round((bld.gaveUp / bld.arrivals) * 100)}%</div>`);
      } else if (!real) rows.push('<div class="row muted">Fills a small leftover gap in the block.</div>');
    } else if (t.zone) {
      if (t.zone === 'industrial') rows.push(`<div class="row muted">🏭 What grows here next: ${industryMix(sim).driver}</div>`);
      rows.push(`<div class="row muted">Zoned cells here: ${zonedCells(sim, x, z)}/16 · ${cellZoneLabel(sim, x * 4 + 1, z * 4 + 1)}</div>`);
    }
    if (pubLot) {
      rows.push(`<div class="row">🅿️ Public ${pubLot.garage ? 'garage' : 'parking lot'}: <b>${pubLot.parked} / ${pubLot.spaces}</b> parked · ${pubLot.allocated} spaces shared with nearby buildings</div>`);
      // V1.5 coverage: how far it reaches, and garage fees.
      rows.push(`<div class="row muted">Serves buildings within ${rangeOf(pubLot) / 4} tiles${pubLot.garage ? ' · charges drivers a fee (Budget ▸ Garage fees)' : ''}. The Parking overlay shades its coverage.</div>`);
    }
    if (t.zone === 'industrial' && t.level > 0) {
      // V1.5 stage 10: the building's role in the goods chain and its recipe.
      const role = roleOf(sim.world, i), rec = RECIPES[role];
      const makes = rec ? rec.outputs.map((g) => GOOD_NAMES[g]).join(' + ') : GOOD_NAMES[factoryGood(sim.world, i)];
      rows.push(`<div class="row">${ROLE_NAMES[role]}: makes <b>${makes}</b> · in stock ${t.stock.toFixed(1)}</div>`);
      if (rec && role !== 'foodPlant') rows.push(`<div class="row">Needs: <b>${rec.inputs.map((g) => GOOD_NAMES[g]).join(' or ')}</b> · hopper ${t.input.toFixed(1)}${sim.shipping.isIncoming(-1 - i) ? ' · 🚚 on the way' : ''}</div>`);
    }
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
      if (t.zone && t.level > 0) rows.push(`<div class="row">Taxes: <b>${this.money(monthlyTax(t, st.operating, sim.world.taxRates))}</b>/month + property <b>${this.money(Math.round(propertyTax(t, st.operating, sim.env.landValue[i], sim.world.propertyRate)))}</b></div>`);
      // V1.5 stage 11: land value and last month's profit.
      if (t.zone) rows.push(`<div class="row">Land value: <b>${sim.env.landValue[i].toFixed(2)}</b> <span class="muted">(noise ${sim.env.noise[i].toFixed(1)})</span></div>`);
      // V1.5 stage 12: building health (monthly) and redevelopment status.
      for (const hb of sim.world.lots.hostedOn(i)) {
        if (hb.health === undefined) continue;
        const hp = Math.round(hb.health * 100);
        rows.push(`<div class="row">Health: <b class="${hb.health < 0.3 ? 'bad' : hb.health > 0.6 ? 'ok' : ''}">${hp}%</b>${hb.lowMonths ? ` <span class="bad">· struggling ${hb.lowMonths}/3 months — then it's redeveloped</span>` : ''}${hb.redev && hb.construct > 0 ? ' · 🏗 being redeveloped' : ''}</div>`);
        if (hb.densified) rows.push(`<div class="row">🏙 Densified (${hb.densified}) by high housing demand</div>`); // V1.5b
        break;
      }
      const pf = sim.world.profits.get(i);
      if (pf) rows.push(`<div class="row">Profit last month: <b class="${pf.net < 0 ? 'bad' : 'ok'}">${pf.net < 0 ? '-' : ''}${this.money(Math.abs(Math.round(pf.net)))}</b> <span class="muted">(sales ${this.money(Math.round(pf.sales))} − inputs ${this.money(Math.round(pf.inputs))} − wages ${this.money(Math.round(pf.wages))} − tax ${this.money(Math.round(pf.taxes))})</span></div>`);
      if (st.missing.length) rows.push(`<div class="row bad">Missing: ${st.missing.join(', ')}</div>`);
      if (t.zone === 'residential') {
        // Pollution & desirability (PR 3): explain why a home is stuck.
        const env = sim.env;
        rows.push(`<div class="row">Pollution: <b class="${env.pollution[i] > 2 ? 'bad' : ''}">${env.pollution[i].toFixed(1)}</b> · Desirability: <b class="${env.desirability[i] < 0.6 ? 'bad' : 'ok'}">${env.desirability[i].toFixed(2)}</b></div>`);
        if (env.desirability[i] < 0.2) rows.push('<div class="row bad">Too polluted to grow. Move industry away or add a park.</div>');
      } else if (t.zone) {
        rows.push(`<div class="row muted">Pollution here: ${sim.env.pollution[i].toFixed(1)}</div>`);
      }
      if (t.zone && t.level === 0 && st.operating && !bld) rows.push('<div class="row muted">Serviced — a building will grow here soon.</div>');
    } else if (t.structure === 'powerPlant' || t.structure === 'windTurbine' || t.structure === 'nuclearPlant') {
      // Turbine output follows the wind (sim/wind.ts); plants are constant.
      const out = output(t, 'power', sim.world.wind);
      rows.push(`<div class="row">Output: ${out} power${t.structure === 'windTurbine' ? ` <span class="muted">(max 1,000, wind ${Math.round(sim.world.wind * 100)}%)</span>` : ''}</div>`);
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
    // PR 5 farm / food plant / yard rows.
    if (t.zone === 'industrial' && isFarmLot(sim.world, i) && t.level > 0) rows.push(`<div class="row">🌾 Fields: <b>${fieldCount(sim.world, i)} / ${FARM_FIELDS[Math.min(3, t.level)]}</b></div>`);
    if (t.zone === 'industrial' && isFoodPlant(t)) rows.push(`<div class="row">Food in hopper: <b>${t.input.toFixed(1)}</b>${sim.shipping.isIncoming(-1 - i) ? ' · 🚚 food on the way' : ''}</div>`);
    if (fieldOf) rows.push(`<div class="row">Crop field of the farm at tile ${coords(fieldOf.host).join(', ')}. Bulldoze to leave it fallow.</div>`);
    if (t.structure === 'constructionYard') {
      rows.push(`<div class="row">Trucks out: <b>${sim.crews.out(i)} / ${YARD_FLEET}</b></div>`);
      rows.push(`<div class="row">Upkeep: ${this.money(UPKEEP.constructionYard)}/month</div>`);
    }
    // V1.5b services: the building itself, then garbage + coverage on any tile.
    if (t.structure === 'service') {
      const d = SERVICE_DEFS[t.kind], a = t.part ? t.part - 1 : i;
      rows.push(`<div class="row">Covers <b>${d.radius}</b> tiles around it${serviceSize(sim.world.tiles, a) === 2 ? ' (2×2)' : ''}. Upkeep: ${this.money(d.upkeep)}/month</div>`);
      if (d.svc === Svc.Police || d.svc === Svc.Clinic || d.svc === Svc.Hospital) rows.push(`<div class="row">${d.svc === Svc.Police ? 'Patrol cars' : 'Ambulances'} out: <b>${sim.responders.outOf(a)} / ${d.fleet}</b></div>`);
      if (d.svc === Svc.Dump) {
        const lf = sim.world.tiles[a], fill = landfillFill(lf);
        rows.push(`<div class="row">🗑 Landfill: <b class="${fill >= 0.8 ? 'bad' : ''}">${Math.round(fill * 100)}% full</b> (${Math.round(lf.stock).toLocaleString()} / ${LANDFILL_MAX.toLocaleString()})</div>`);
        if (landfillFull(lf)) rows.push('<div class="row bad">FULL — it takes no more garbage. Build a new landfill (recycling centers slow the flow).</div>');
        else if (fill >= 0.8) rows.push('<div class="row bad">Almost full — plan a new landfill.</div>');
        rows.push(`<div class="row">Garbage trucks out: <b>${sim.garbage.outOf(a)} / ${d.fleet}</b> · collected so far ${Math.round(sim.garbage.stats.collected)}</div>`);
      }
      if (d.svc === Svc.Recycling) {
        rows.push('<div class="row">♻️ Buildings in range make up to 45% less garbage.</div>');
        rows.push(`<div class="row">🔥 Burns garbage for <b>${POWER_OUTPUT.powerPlant}</b> power (like a coal plant). Garbage trucks out: <b>${sim.garbage.outOf(a)} / ${d.fleet}</b> · burned so far ${Math.round(sim.garbage.burnedBy(a)).toLocaleString()}</div>`);
        rows.push('<div class="row muted">Landfill trucks haul stored garbage here to be burned, freeing landfill space.</div>');
      }
      if (d.svc === Svc.Depot) {
        let n = 0; sim.world.tiles.forEach((q, j) => { if ((q.zone === 'industrial' || q.zone === 'commercial') && q.level > 0 && depotOf([a], j) === a) n++; });
        rows.push(`<div class="row">📦 Loads handled: <b>${sim.shipping.depotLoads.get(a) ?? 0}</b> · businesses in catchment: <b>${n}</b></div>`);
        rows.push(`<div class="row muted">Exports via the depot pay +${Math.round(DEPOT_BONUS * 100)}% and leave at half a hopper; imports to the catchment start here.</div>`);
      }
      if (!serviceAnchors(sim.world).includes(a)) rows.push('<div class="row bad">Not next to a road: covers nothing.</div>');
    }
    if (t.zone && t.level > 0 && t.garbage > 0) rows.push(`<div class="row">🗑 Garbage: <b class="${t.garbage >= G_WARN ? 'bad' : ''}">${Math.round(t.garbage)}</b> / ${G_MAX}${t.garbage >= G_WARN ? ' — piling up! Build a Landfill nearby' : ''}</div>`);
    if (t.zone) {
      const c = sim.cov.by;
      // V1.5b stage G: workforce education.
      const wf = sim.demand.workforce;
      if (t.zone === 'residential' && t.res > 0) rows.push(`<div class="row">🎓 Workers here are <b>${sim.cov.edu[i] >= 1 ? 'educated' : 'uneducated'}</b>${sim.cov.edu[i] >= 1 ? '' : ' — no elementary school in range'}</div>`);
      if (wf && (t.zone === 'commercial' || t.zone === 'industrial')) rows.push(`<div class="row muted">City workforce: ${Math.round(wf.educated)} educated · ${Math.round(wf.uneducated)} uneducated · ${t.zone === 'commercial' ? `shops/offices need ${Math.round(wf.needEducated)} educated` : 'industry mostly hires uneducated workers'}</div>`);
      // V1.5b stage F: crime on this tile (police coverage lowers it).
      const cr = sim.safety.crime[i] ?? 0;
      if (cr > 0.02) rows.push(`<div class="row">🚓 Crime: <b class="${cr > 0.4 ? 'bad' : ''}">${Math.round(cr * 100)}%</b>${c[Svc.Police][i] < 0.3 && cr > 0.2 ? ' — build a Police Station nearby' : ''}</div>`);
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      if ((t.zone === 'industrial' || t.zone === 'commercial') && t.level > 0) { const dp = depotOf(serviceAnchors(sim.world, Svc.Depot), i); if (dp >= 0) rows.push(`<div class="row">📦 Ships via the depot at ${coords(dp).join(', ')}</div>`); }
      rows.push(`<div class="row muted">Coverage — 🗑 ${pct(c[Svc.Dump][i])} · ♻️ ${pct(c[Svc.Recycling][i])} · 🚓 ${pct(c[Svc.Police][i])} · 🩺 ${pct(Math.min(1, c[Svc.Clinic][i] + c[Svc.Hospital][i]))} · 🎓 level ${sim.cov.edu[i]}</div>`);
    }
    if (t.construct > 0 && !t.crew) rows.push(`<div class="row bad">🚧 Waiting for construction crew${sim.crews.isEnRoute(i) ? ' (truck on its way)' : ''}</div>`);
    // PR 5 "Next level" bars from Simulation.requirements (the real growth rules).
    if (bld && TPL[bld.tpl].capacity[0] > 0) {
      const req = sim.buildingRequirements(bld);
      const atMax = bld.level >= TPL[bld.tpl].maxLevel && bld.construct === 0;
      if (!req) rows.push('<div class="row"><b>Max level</b></div>');
      else {
        const blocker = req.find((r) => !r.met);
        rows.push(`<div class="row levelbars-h">${atMax ? 'Max level — redevelopment:' : `Next level (${bld.level + 1}):`}</div>`);
        for (const r of req) {
          const pct = Math.max(0, Math.min(100, r.target > 0 ? (r.current / r.target) * 100 : 100));
          rows.push(`<div class="row lvbar${r.met ? ' met' : ''}${r === blocker ? ' blocker' : ''}"><span>${r.label}</span><span class="meter wide"><i style="width:${pct}%"></i></span><span class="muted">${r.current}/${r.target}</span>${r === blocker ? `<div class="hint">→ ${r.hint}</div>` : ''}</div>`);
        }
      }
    }
    this.info.innerHTML = `<button class="close" aria-label="Close">×</button><h3>${title}</h3>${rows.join('')}`;
    (this.info.querySelector('.close') as HTMLButtonElement).onclick = () => this.inspect(null);
  }
}

/** PR 6: zoned cells on tile (x, z) (Inspect). */
function zonedCells(sim: Simulation, x: number, z: number): number {
  let n = 0;
  for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) if (sim.world.cells.zone[(z * 4 + dz) * CELL_GRID + x * 4 + dx]) n++;
  return n;
}
