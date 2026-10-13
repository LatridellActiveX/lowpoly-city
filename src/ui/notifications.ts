/**
 * ui/notifications.ts — stacked toast notifications (PR 3).
 *
 * The Notifier compares the city's stats between HUD refreshes and pops a
 * short message when something CHANGES (an edge, not a level), so you get
 * one "Power shortage" when the outage starts — not one every 0.25 s:
 *   - power or water shortage begins / ends
 *   - cash drops below LOW_CASH, or goes negative
 *   - population passes a milestone (100, 250, 500, 1,000, ...)
 * Toasts stack in the top-right corner and fade out after a few seconds.
 * It only READS the simulation; it never changes it.
 */
import { Simulation } from '../sim/simulation';

export const LOW_CASH = 1000;
export const MILESTONES = [100, 250, 1000, 5000]; // 500, 2,000, 10,000, 20,000 are tier announcements now (progression.ts)

type Kind = 'bad' | 'good' | 'info';

export class Notifier {
  readonly el = document.createElement('div');
  private powerShort = false;
  private waterShort = false;
  private lowCash = false;
  private broke = false;
  private bestPop = -1;
  /** Every message shown this session (handy for tests). */
  readonly log: string[] = [];

  constructor() {
    this.el.className = 'notices';
  }

  /** Forget state (new city / load), so we don't announce old milestones. */
  reset(sim: Simulation): void {
    const s = sim.stats();
    this.bestPop = s.population;
    this.powerShort = this.waterShort = false;
    this.lowCash = sim.world.cash < LOW_CASH;
    this.broke = sim.world.cash < 0;
  }

  push(msg: string, kind: Kind = 'info'): void {
    this.log.push(msg);
    const n = document.createElement('div');
    n.className = `notice ${kind}`;
    n.textContent = msg;
    this.el.prepend(n);
    while (this.el.children.length > 4) this.el.lastElementChild!.remove();
    // Fade out, then remove.
    window.setTimeout(() => n.classList.add('fade'), 4500);
    window.setTimeout(() => n.remove(), 5200);
  }

  check(sim: Simulation): void {
    const s = sim.stats();
    if (this.bestPop < 0) this.bestPop = s.population; // first call: just remember
    // Count outage buildings per utility from the networks.
    const powerOut = sim.net.power.reduce((a, n) => a + n.outages, 0);
    const waterOut = sim.net.water.reduce((a, n) => a + n.outages, 0);
    if (powerOut > 0 && !this.powerShort) this.push(`⚡ Power shortage: ${powerOut} building${powerOut > 1 ? 's' : ''} without power`, 'bad');
    if (powerOut === 0 && this.powerShort) this.push('⚡ Power restored', 'good');
    if (waterOut > 0 && !this.waterShort) this.push(`💧 Water shortage: ${waterOut} building${waterOut > 1 ? 's' : ''} without water`, 'bad');
    if (waterOut === 0 && this.waterShort) this.push('💧 Water restored', 'good');
    this.powerShort = powerOut > 0;
    this.waterShort = waterOut > 0;

    const cash = sim.world.cash;
    if (cash < 0 && !this.broke) this.push('💸 The city is in debt. Construction is blocked until income recovers.', 'bad');
    else if (cash < LOW_CASH && !this.lowCash) this.push(`💵 Low on cash: under $${LOW_CASH.toLocaleString()}`, 'bad');
    this.broke = cash < 0;
    this.lowCash = cash < LOW_CASH;

    for (const m of MILESTONES) {
      if (s.population >= m && this.bestPop < m) this.push(`🎉 Population reached ${m.toLocaleString()}!`, 'good');
    }
    this.bestPop = Math.max(this.bestPop, s.population);
  }
}
