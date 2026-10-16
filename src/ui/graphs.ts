/**
 * ui/graphs.ts — the "📈 Graphs" panel (PR 3).
 *
 * The simulation keeps a small RING BUFFER of snapshots (Simulation.history:
 * one every HISTORY_EVERY_TICKS ticks, at most HISTORY_MAX of them, oldest
 * dropped first), so memory stays flat no matter how long you play. History
 * is session-only: it is not saved, so a reloaded city starts a fresh graph.
 *
 * This panel draws three line charts on one plain <canvas> (no chart library):
 *   1. population and jobs
 *   2. power demand vs capacity
 *   3. water demand vs capacity
 * When demand (solid) climbs over capacity (dashed) you're about to get
 * outages — the graph teaches you to read the grid. Hovering shows the
 * values at that point in time.
 */
import { HistoryPoint, Simulation } from '../sim/simulation';
import { MONTH_TICKS } from '../sim/economy';
import { formatAmount, formatRatio } from './format';

interface Series {
  label: string;
  color: string;
  dashed?: boolean;
  get: (p: HistoryPoint) => number;
}
const CHARTS: Array<{ title: string; series: Series[] }> = [
  {
    title: 'Population & jobs',
    series: [
      { label: 'Residents', color: '#7be08a', get: (p) => p.population },
      { label: 'Jobs', color: '#4fc3f7', get: (p) => p.jobs },
    ],
  },
  {
    title: 'Power',
    series: [
      { label: 'Demand', color: '#ffd21f', get: (p) => p.powerDemand },
      { label: 'Capacity', color: '#ffffff', dashed: true, get: (p) => p.powerCapacity },
    ],
  },
  {
    title: 'Water',
    series: [
      { label: 'Demand', color: '#29a3ff', get: (p) => p.waterDemand },
      { label: 'Capacity', color: '#ffffff', dashed: true, get: (p) => p.waterCapacity },
    ],
  },
];

/** "Month 3, day 12" for a tick. */
function when(tick: number): string {
  return `Month ${Math.floor(tick / MONTH_TICKS) + 1}, day ${Math.floor(((tick % MONTH_TICKS) / MONTH_TICKS) * 30) + 1}`;
}

export class GraphsPanel {
  readonly el = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly tip = document.createElement('div');
  private hoverX: number | null = null;
  private sim: Simulation | null = null;
  private lastLen = -1;

  constructor() {
    this.el.className = 'graphs hidden';
    this.el.innerHTML = '<button class="close" aria-label="Close">×</button><h3>City graphs</h3>';
    this.canvas.width = 360 * 2; // draw at 2× for crisp lines on HiDPI screens
    this.canvas.height = 330 * 2;
    this.canvas.style.width = '360px';
    this.canvas.style.height = '330px';
    this.tip.className = 'muted small graph-tip';
    this.el.append(this.canvas, this.tip);
    (this.el.querySelector('.close') as HTMLButtonElement).onclick = () => this.toggle(false);
    this.canvas.addEventListener('mousemove', (e) => {
      this.hoverX = e.offsetX;
      this.draw(true);
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverX = null;
      this.draw(true);
    });
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(force?: boolean): boolean {
    const open = force ?? !this.open;
    this.el.classList.toggle('hidden', !open);
    if (open) this.draw(true);
    return open;
  }

  /** Called from the HUD refresh. Only redraws when there's a new sample. */
  update(sim: Simulation): void {
    this.sim = sim;
    if (this.open && sim.history.length !== this.lastLen) this.draw(true);
  }

  private draw(force = false): void {
    const sim = this.sim;
    if (!sim || !force) return;
    const h = sim.history;
    this.lastLen = h.length;
    const ctx = this.canvas.getContext('2d')!;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.scale(2, 2); // work in CSS pixels from here on
    const w = W / 2, chartH = 100, gap = 10, left = 34, right = 6;
    if (h.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '12px system-ui';
      ctx.fillText('Collecting data… (one sample every 10 s at 1×)', 10, 40);
      this.tip.textContent = '';
      return;
    }
    // Which sample is under the mouse (if any)?
    const n = h.length;
    const xOf = (k: number) => left + ((w - left - right) * k) / (n - 1);
    const hoverK = this.hoverX === null ? null : Math.max(0, Math.min(n - 1, Math.round(((this.hoverX - left) / (w - left - right)) * (n - 1))));

    CHARTS.forEach((chart, ci) => {
      const top = ci * (chartH + gap) + 4;
      const max = Math.max(1, ...h.flatMap((p) => chart.series.map((s) => s.get(p))));
      const yOf = (v: number) => top + chartH - 14 - ((chartH - 20) * v) / max;
      // Frame, title and max label.
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.setLineDash([]);
      ctx.strokeRect(left, top + 6, w - left - right, chartH - 20);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '11px system-ui';
      ctx.fillText(chart.title, left + 4, top + 18);
      ctx.fillText(formatAmount(max), 2, top + 14);
      ctx.fillText('0', 2, top + chartH - 14);
      // Each series as a polyline.
      for (const s of chart.series) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.6;
        ctx.setLineDash(s.dashed ? [4, 3] : []);
        ctx.beginPath();
        h.forEach((p, k) => (k ? ctx.lineTo(xOf(k), yOf(s.get(p))) : ctx.moveTo(xOf(k), yOf(s.get(p)))));
        ctx.stroke();
      }
      if (hoverK !== null) {
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.moveTo(xOf(hoverK), top + 6);
        ctx.lineTo(xOf(hoverK), top + chartH - 14);
        ctx.stroke();
      }
    });
    const p = h[hoverK ?? n - 1];
    // NEBULA: formatRatio so hover tip matches the top-bar power/water numbers.
    this.tip.textContent = `${hoverK === null ? 'Latest' : when(p.tick)} — residents ${formatAmount(p.population)}, jobs ${formatAmount(p.jobs)}, power ${formatRatio(p.powerDemand, p.powerCapacity)}, water ${formatRatio(p.waterDemand, p.waterCapacity)}`;
  }
}
