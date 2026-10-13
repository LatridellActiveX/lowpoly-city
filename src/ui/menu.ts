/**
 * ui/menu.ts — PR 4 main menu (☰ button, top-left) with two panels:
 *
 *  SETTINGS — car count, truck count, simulation update rate and the
 *    day/night cycle toggle. Changes apply immediately (the sim reads
 *    `sim.settings` every tick) and are saved to localStorage
 *    (sim/settings.ts), so they survive reloads and "New city".
 *
 *  GAME LOG — the running log from gameLog.ts with severity filter
 *    checkboxes, "Copy log" and "Clear".
 *
 * Plain DOM like the rest of the HUD. It receives a getter for the current
 * Simulation because "Load" / "New" swap the Simulation object.
 */
import { Simulation } from '../sim/simulation';
import { saveSettings } from '../sim/settings';
import { SAVE_VERSION } from '../sim/save';
import { copyText, gameLog, Severity } from './gameLog';

export class GameMenu {
  readonly button = document.createElement('button');
  readonly el = document.createElement('div');
  private view: 'main' | 'settings' | 'log' = 'main';
  private readonly filter = new Set<Severity>(['info', 'event', 'warn', 'error']);

  constructor(private readonly getSim: () => Simulation) {
    this.button.className = 'btn menu-btn';
    this.button.innerHTML = '☰';
    this.button.title = 'Menu: settings and game log';
    this.button.onclick = () => this.toggle();
    this.el.className = 'menu-panel hidden';
    gameLog.onChange = () => this.view === 'log' && !this.el.classList.contains('hidden') && this.renderLogList();
  }

  toggle(open?: boolean): void {
    const show = open ?? this.el.classList.contains('hidden');
    this.el.classList.toggle('hidden', !show);
    this.button.classList.toggle('active', show);
    if (show) this.show('main');
  }

  show(view: 'main' | 'settings' | 'log'): void {
    this.view = view;
    const back = view === 'main' ? '' : '<button class="btn back">‹ Back</button>';
    const close = '<button class="close" aria-label="Close">×</button>';
    if (view === 'main') {
      this.el.innerHTML = `${close}<h3>Menu</h3>
        <button class="menu-item" data-go="settings">⚙️ Settings<span>Traffic, simulation speed, day/night</span></button>
        <button class="menu-item" data-go="log">📜 Game log<span>Events, warnings and errors — copy to share</span></button>`;
      this.el.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => (b.onclick = () => this.show(b.dataset.go as 'settings' | 'log')));
    } else if (view === 'settings') {
      const s = this.getSim().settings;
      this.el.innerHTML = `${close}${back}<h3>Settings</h3>
        <label class="set"><span>🚗 Max cars</span><input type="range" min="0" max="300" step="10" data-k="maxCars" value="${s.maxCars}"><b>${s.maxCars}</b></label>
        <label class="set"><span>🚚 Max trucks</span><input type="range" min="0" max="80" step="5" data-k="maxTrucks" value="${s.maxTrucks}"><b>${s.maxTrucks}</b></label>
        <label class="set"><span>⏱ Sim update rate</span><select data-k="tickRate">
          ${[[0.5, 'Slow (0.5 ticks/s)'], [1, 'Normal (1 tick/s)'], [2, 'Fast (2 ticks/s)']].map(([v, l]) => `<option value="${v}" ${s.tickRate === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
        <label class="set check"><input type="checkbox" data-k="dayNight" ${s.dayNight ? 'checked' : ''}><span>🌗 Day/night cycle (1 hour per day at 1×)</span></label>
        <div class="muted small">Fewer vehicles helps slower computers. The update rate changes how fast the city grows and months pass at 1×; it doesn't change day length.</div>`;
      this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => {
        inp.oninput = inp.onchange = () => {
          const st = this.getSim().settings;
          const k = inp.dataset.k as keyof typeof st;
          if (k === 'dayNight') st.dayNight = (inp as HTMLInputElement).checked;
          else st[k] = Number(inp.value) as never;
          const label = inp.parentElement?.querySelector('b');
          if (label) label.textContent = inp.value;
          saveSettings(st);
        };
        inp.onchange = () => {
          (inp.oninput as () => void)();
          gameLog.info(`Setting changed: ${inp.dataset.k} = ${inp instanceof HTMLInputElement && inp.type === 'checkbox' ? inp.checked : inp.value}`);
        };
      });
    } else {
      this.el.innerHTML = `${close}${back}<h3>Game log</h3>
        <div class="log-filters">${(['info', 'event', 'warn', 'error'] as Severity[]).map((s) => `<label class="sev-${s}"><input type="checkbox" data-sev="${s}" ${this.filter.has(s) ? 'checked' : ''}>${s}</label>`).join('')}</div>
        <div class="log-list"></div>
        <div class="log-actions"><button class="btn copy">📋 Copy log</button><button class="btn clear">🗑 Clear</button><span class="muted small copied"></span></div>`;
      this.el.querySelectorAll<HTMLInputElement>('[data-sev]').forEach((cb) => {
        cb.onchange = () => {
          if (cb.checked) this.filter.add(cb.dataset.sev as Severity);
          else this.filter.delete(cb.dataset.sev as Severity);
          this.renderLogList();
        };
      });
      (this.el.querySelector('.copy') as HTMLButtonElement).onclick = async () => {
        const ok = await copyText(gameLog.toText(SAVE_VERSION, this.filter));
        (this.el.querySelector('.copied') as HTMLElement).textContent = ok ? 'Copied!' : 'Copy failed — select the text and copy manually';
      };
      (this.el.querySelector('.clear') as HTMLButtonElement).onclick = () => gameLog.clear();
      this.renderLogList();
    }
    (this.el.querySelector('.close') as HTMLButtonElement).onclick = () => this.toggle(false);
    const b = this.el.querySelector('.back') as HTMLButtonElement | null;
    if (b) b.onclick = () => this.show('main');
  }

  /** Newest first, filtered by severity. Text is selectable for manual copying. */
  private renderLogList(): void {
    const list = this.el.querySelector('.log-list');
    if (!list) return;
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    const rows = gameLog.entries.filter((e) => this.filter.has(e.sev)).slice(-300).reverse();
    list.innerHTML = rows.length
      ? rows.map((e) => `<div class="log-row sev-${e.sev}"><span class="t">${e.real} · ${esc(e.game)}</span> <b>${e.sev}</b> ${esc(e.msg)}</div>`).join('')
      : '<div class="muted">Nothing logged yet.</div>';
  }
}
