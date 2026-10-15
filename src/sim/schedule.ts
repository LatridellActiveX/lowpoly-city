/**
 * sim/schedule.ts — V1.6 A4: TIME-SLICING OF PERIODIC JOBS.
 *
 * Several jobs run "every 30 ticks": booking the month, measuring parking
 * demand for garages, refreshing factory recipes, police patrols. Before
 * V1.6 they all fired on the SAME tick (tick % 30 === 0), so one tick in
 * thirty did four jobs' worth of work — a visible hitch on a big map
 * (target T3: a month tick may cost at most 2× a normal tick).
 *
 * Each job now has a PHASE inside its period. They still run exactly once
 * per period, just on different ticks. The month itself stays on phase 0
 * (the calendar, taxes and history depend on it).
 */
export const PHASE = {
  month: 0,
  garages: 15, // parking.ts measure()
  roles: 10,   // chains.ts refreshRoles adoption pass
  patrol: 20,  // safety.ts police patrol dispatch
  ambulance: 5, // safety.ts ambulance runs
} as const;

/** True on the one tick per `period` that belongs to `phase`. */
export const due = (tick: number, period: number, phase: number): boolean => tick % period === phase % period;
