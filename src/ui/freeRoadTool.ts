/**
 * ui/freeRoadTool.ts — V1.6 B7: the FREE ROAD tool and block zoning brush.
 *
 * MODES (options bar while the tool is on):
 *   Straight  click start, click end;
 *   Curve     click start, click the bend (control point), click end
 *             (a quadratic raised to a cubic, roads/bezier.ts quadCubic).
 * TYPE: Street / Avenue.  SNAP: Angle (15° steps from the start) and Grid
 * (8 m) toggles; node (8 m) and road (6 m) snapping are always on; hold
 * SHIFT to place without any snapping.
 * While drawing, every pointer move dry-runs the placement
 * (sim/freeroads.ts placeFreeRoad) and shows: the ghost road (blue, red
 * when invalid), the zone cells it would create (green new, amber clipped)
 * and a tooltip with length, angle, cost or the reason it is refused
 * ("Roads meet at too sharp an angle (min 30°)", "Will demolish 2 building
 * tiles — release to confirm", …). Clicking with a demolish warning is the
 * confirmation. Esc drops the points; Ctrl+Z / Ctrl+Y undo and redo road
 * and block-zoning operations.
 */
import { buildLut, Cubic, lineCubic, quadCubic, V2 } from '../roads/bezier';
import { RoadType, TILE_M } from '../roads/graph';
import { placeFreeRoad, undo, redo, paintBlocks } from '../sim/freeroads';
import type { Simulation } from '../sim/simulation';
import type { GraphRoadLayer } from '../render/graphRoads';

export class FreeRoadTool {
  mode: 'straight' | 'curve' = 'curve';
  type: RoadType = 'street';
  angle = true;
  grid = false;
  shift = false;
  pts: V2[] = [];
  bar = document.createElement('div');
  /** Last tooltip (html) for main.ts to show next to the cursor. */
  tip: string | null = null;

  constructor(private layer: GraphRoadLayer, private sim: () => Simulation, private flash: (m: string) => void) {
    this.bar.id = 'freeroadbar';
    this.bar.className = 'panel hidden';
    document.body.append(this.bar);
    window.addEventListener('keydown', (e) => { if (e.key === 'Shift') this.shift = true; });
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') this.shift = false; });
    this.render();
  }
  show(on: boolean): void { this.bar.classList.toggle('hidden', !on); if (!on) this.cancel(); }
  render(): void {
    const b = (k: string, label: string, on: boolean) => `<button class="btn${on ? ' active' : ''}" data-k="${k}">${label}</button>`;
    this.bar.innerHTML = `<span class="muted">Mode</span> ${b('straight', 'Straight', this.mode === 'straight')}${b('curve', 'Curve', this.mode === 'curve')}
      <span class="muted" style="margin-left:10px">Type</span> ${b('street', 'Street', this.type === 'street')}${b('avenue', 'Avenue', this.type === 'avenue')}
      <span class="muted" style="margin-left:10px">Snap</span> ${b('angle', 'Angle 15°', this.angle)}${b('grid', 'Grid 8 m', this.grid)}
      <span class="muted" style="margin-left:10px">${b('undo', '↶ Undo', false)}${b('redo', '↷ Redo', false)}</span>`;
    this.bar.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((el) => (el.onclick = () => {
      const k = el.dataset.k!;
      if (k === 'straight' || k === 'curve') { this.mode = k; this.pts = []; }
      else if (k === 'street' || k === 'avenue') this.type = k;
      else if (k === 'angle') this.angle = !this.angle;
      else if (k === 'grid') this.grid = !this.grid;
      else if (k === 'undo') this.undo();
      else if (k === 'redo') this.redo();
      this.render();
    }));
  }
  cancel(): void { this.pts = []; this.layer.showPreview(null); this.tip = null; }
  undo(): void { if (undo(this.sim())) this.flash('Undone'); }
  redo(): void { if (redo(this.sim())) this.flash('Redone'); }

  private opts() { return this.shift ? { noSnap: true } : { angleSnap: this.angle, gridSnap: this.grid }; }
  /** The proposed curve from the clicked points to the (snapped) cursor. */
  private proposal(cursor: V2): Cubic | null {
    if (!this.pts.length) return null;
    const g = this.sim().world.roads;
    const end = this.shift ? cursor : g.snap(cursor, this.opts(), this.pts[0]).p;
    if (this.mode === 'curve' && this.pts.length === 2) return quadCubic(this.pts[0], this.pts[1], end);
    return lineCubic(this.pts[0], end);
  }
  /** Pointer moved (metres). */
  hover(p: V2): void {
    const c = this.proposal(p);
    if (!c) { this.layer.showPreview(null); this.tip = null; return; }
    const sim = this.sim();
    const plan = placeFreeRoad(sim, c, this.type, this.opts(), false);
    const lut = buildLut(plan.curve), len = lut[lut.length - 1];
    const cells = len > 1 ? sim.world.blocks.preview(sim.world.roads, plan.curve, lut, len, this.type) : [];
    const ok = plan.ok || /release to confirm/.test(plan.reason ?? '');
    this.layer.showPreview({ cells, curve: plan.curve, type: this.type, ok });
    const ang = Math.round((Math.atan2(-(plan.curve[7] - plan.curve[1]), plan.curve[6] - plan.curve[0]) * 180) / Math.PI);
    const head = `${Math.round(len)} m · ${ang}° · ${cells.length} cells`;
    this.tip = plan.ok ? `${head}<br>$${plan.cost.toLocaleString()}` : `${head}<br><span style="color:#ff8a80">${plan.reason}</span>`;
  }
  /** Click (metres). Returns a message for the HUD, if any. */
  click(p: V2): string | null {
    const sim = this.sim();
    const need = this.mode === 'curve' ? 2 : 1;
    if (this.pts.length < need) {
      const g = sim.world.roads;
      this.pts.push(this.shift ? p : g.snap(p, this.opts(), this.pts[0]).p);
      return null;
    }
    const c = this.proposal(p)!;
    const plan = placeFreeRoad(sim, c, this.type, this.opts(), true, true);
    this.layer.showPreview(null);
    if (!plan.ok) return plan.reason ?? "Can't build there";
    // Chain: the next road starts where this one ended.
    this.pts = [{ x: plan.curve[6], z: plan.curve[7] }];
    return `-$${plan.cost.toLocaleString()}`;
  }
}

/** Zoning brush on block cells (zone tools over a freeform road's block). */
export function brushBlocks(sim: Simulation, p: V2, code: number, depthTiles: number): number {
  return paintBlocks(sim, p, code, 2, depthTiles * 4);
}
export const toMetres = (x: number, z: number): V2 => ({ x: x * TILE_M, z: z * TILE_M });
