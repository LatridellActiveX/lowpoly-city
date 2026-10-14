/**
 * ui/demandBars.ts — PR 4 RCI demand meter (bottom-left of the screen).
 *
 * Three vertical bars — green R(esidential), blue C(ommercial), yellow
 * I(ndustrial) — around a centre line. A bar grows UP for positive demand and
 * DOWN (dimmed) for negative demand. Hovering a bar shows its value and the
 * main reason (Simulation.demand[zone].driver, from sim/demand.ts).
 * It only reads the simulation.
 */
import { Simulation } from '../sim/simulation';
import { ZoneType } from '../sim/types';

const ZONES: Array<[ZoneType, string, string]> = [
  ['residential', 'R', '#6ad37a'],
  ['commercial', 'C', '#5aa8f0'],
  ['industrial', 'I', '#f2c94c'],
];

export class DemandBars {
  readonly el = document.createElement('div');
  private readonly bars = new Map<ZoneType, { fill: HTMLElement; col: HTMLElement }>();

  constructor() {
    this.el.className = 'rci';
    this.el.innerHTML = '<div class="rci-title">Demand</div>';
    const row = document.createElement('div');
    row.className = 'rci-row';
    for (const [zone, letter, color] of ZONES) {
      const col = document.createElement('div');
      col.className = 'rci-col';
      col.innerHTML = `<div class="rci-track"><i></i><span class="rci-mid"></span></div><b style="color:${color}">${letter}</b>`;
      const fill = col.querySelector('i') as HTMLElement;
      fill.style.background = color;
      this.bars.set(zone, { fill, col });
      row.append(col);
    }
    this.el.append(row);
  }

  update(sim: Simulation): void {
    for (const [zone] of ZONES) {
      const { value, driver } = sim.demand[zone];
      const { fill, col } = this.bars.get(zone)!;
      // Track is 60 px: 30 above the centre line, 30 below.
      const h = Math.round(Math.abs(value) * 30);
      fill.style.height = `${h}px`;
      fill.style.bottom = value >= 0 ? '30px' : `${30 - h}px`;
      fill.style.opacity = value >= 0 ? '1' : '0.45';
      const name = zone === 'residential' ? 'Residential' : zone === 'commercial' ? 'Commercial' : 'Industrial';
      const pct = Math.round(value * 100);
      col.title = `${name} demand: ${pct > 0 ? '+' : ''}${pct}%\n${driver}${value <= -0.6 ? '\n(Growth stopped)' : ''}`;
      col.dataset.value = String(pct);
    }
  }
}
