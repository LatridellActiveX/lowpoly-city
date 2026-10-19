/** Load a debug code (LPC1:… or save JSON) into a Simulation — for tests (same as tools/debug-load.ts, no CLI). */
import { decodeDebugCode } from '../../src/sim/debugCode';
import { deserializeWorld } from '../../src/sim/save';
import { Simulation } from '../../src/sim/simulation';
export function loadCode(text: string): Simulation {
  const t = text.trim();
  const json = t.startsWith('{') ? t : (() => { const r = decodeDebugCode(t); if (!r.ok) throw new Error(r.error); return r.saveJson; })();
  const w = deserializeWorld(json);
  if (!w) throw new Error('bad save');
  const s = new Simulation(w); s.recompute(); return s;
}
