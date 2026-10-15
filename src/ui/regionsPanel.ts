/**
 * ui/regionsPanel.ts — V1.6 A6: the Regions panel.
 *
 * A small grid (2 × 2 or 3 × 3) of the map's regions: owned ones are green,
 * buyable ones show their price and a Buy button, the rest say what they
 * still need (population, money, or a shared border). The button in the top
 * bar only appears on big maps. Buying calls Simulation.buyRegion, which
 * checks the same rules (sim/regions.ts) again.
 */
import type { Simulation } from '../sim/simulation';
import { buyBlocker, owns, regionPrice, regionSide } from '../sim/regions';

export class RegionsPanel {
  readonly el = document.createElement('div');
  readonly button = document.createElement('button');
  private sim: Simulation | null = null;
  private key = '';

  constructor() {
    this.el.className = 'budget regions hidden';
    this.button.className = 'btn';
    this.button.innerHTML = '🗺️<span class="lbl"> Regions</span>';
    this.button.title = 'Regions — buy more land';
    this.button.onclick = () => {
      const open = this.el.classList.toggle('hidden') === false;
      this.button.classList.toggle('active', open);
      this.key = '';
      if (open && this.sim) this.update(this.sim);
    };
  }

  /** Called from Hud.refresh. Cheap when nothing changed (keyed redraw). */
  update(sim: Simulation): void {
    this.sim = sim;
    const s = regionSide();
    this.button.style.display = s > 1 ? '' : 'none';
    if (s === 1) this.el.classList.add('hidden');
    if (this.el.classList.contains('hidden')) return;
    const w = sim.world;
    const key = `${w.regionsOwned}|${Math.floor(w.cash / 1000)}|${w.peakPop}|${s}`;
    if (key === this.key) return;
    this.key = key;
    const cells: string[] = [];
    for (let r = 0; r < s * s; r++) {
      const why = buyBlocker(w, r);
      const state = owns(w, r) ? 'owned' : why ? 'locked' : 'buyable';
      const body = state === 'owned' ? 'Owned' : state === 'buyable' ? `<button class="btn" data-r="${r}">Buy $${regionPrice(w).toLocaleString()}</button>` : why;
      cells.push(`<div class="region ${state}"><b>${r + 1}</b><span>${body}</span></div>`);
    }
    this.el.innerHTML = `<h3>🗺️ Regions</h3><p>Build only on land you own. Buy a region next to yours once the city is big enough.</p><div class="region-grid" style="grid-template-columns: repeat(${s}, 1fr)">${cells.join('')}</div>`;
    this.el.querySelectorAll<HTMLButtonElement>('button[data-r]').forEach((b) => {
      b.onclick = () => { const why = sim.buyRegion(Number(b.dataset.r)); if (why) alert(why); this.key = ''; this.update(sim); };
    });
  }
}
