/**
 * sim/prof.ts — V1.6 A0: a tiny PHASE PROFILER for Simulation.step().
 *
 * Off by default: `prof.on` is false and begin/end return immediately, so
 * the game pays one boolean check per phase. Benchmarks (tools/bench) turn
 * it on and read `prof.totals` (ms per phase, summed over the run).
 * Uses performance.now() (Node ≥ 16 and every browser have it).
 */
export const prof = {
  on: false,
  totals: new Map<string, number>(),
  /** V1.6 A4: worst single-tick time per phase (finds spikes, not averages). */
  max: new Map<string, number>(),
  private_t: 0,
  private_name: '',
  /** Start timing a phase (phases are sequential — no nesting needed). */
  begin(name: string): void {
    if (!this.on) return;
    this.private_name = name;
    this.private_t = performance.now();
  },
  /** End the current phase and add its time to the totals. */
  end(): void {
    if (!this.on) return;
    const dt = performance.now() - this.private_t;
    this.totals.set(this.private_name, (this.totals.get(this.private_name) ?? 0) + dt);
    if (dt > (this.max.get(this.private_name) ?? 0)) this.max.set(this.private_name, dt);
  },
  reset(): void { this.totals.clear(); this.max.clear(); },
};
