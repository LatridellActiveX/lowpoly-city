/**
 * ui/freeRoadTool.ts — V1.6 B7: the FREE ROAD tool and block zoning brush.
 *
 * MODES (options bar while the tool is on):
 *   Straight  click start, click end;
 *   Curve     click start, click the bend (control point), click end
 *             (a quadratic raised to a cubic, roads/bezier.ts quadCubic).
 * TYPE: Street / Avenue.  SNAP: Angle (15° steps from the start) and Grid
 * (8 m) toggles; node (8 m) and road (6 m) snapping are always on and
 * sticky (hysteresis), the preview eases to the snapped point each frame
 * (tick), the angle snap is a ±6° magnet; hold SHIFT to place without
 * any snapping. The preview is an outline the width of the road.
 * While drawing, every pointer move dry-runs the placement
 * (sim/freeroads.ts placeFreeRoad) and shows: the ghost road (blue, red
 * when invalid), the zone cells it would create (green new, amber clipped)
 * and a tooltip with length, angle, cost or the reason it is refused
 * ("Roads meet at too sharp an angle (min 30°)", "Will demolish 2 building
 * tiles — release to confirm", …). Clicking with a demolish warning is the
 * confirmation. Esc drops the points; Ctrl+Z / Ctrl+Y undo and redo road
 * and block-zoning operations.
 */
import { buildLut, Cubic, dist, lineCubic, quadCubic, V2 } from '../roads/bezier';
import { RoadType, SNAP_EDGE, SNAP_NODE, TILE_M } from '../roads/graph';
import { placeFreeRoad, undo, redo, paintBlocks, cellsInRect, paintCells } from '../sim/freeroads';
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
  cancel(): void { this.pts = []; this.target = this.shown = null; this.stickNode = this.stickEdge = -1; this.layer.showPreview(null); this.layer.showOutline(null); this.tip = null; }
  undo(): void { if (undo(this.sim())) this.flash('Undone'); }
  redo(): void { if (redo(this.sim())) this.flash('Redone'); }

  /** Angle snap is a soft magnet (±6° around each 15° step) rather than hard steps. */
  private opts() { return this.shift ? { noSnap: true } : { angleSnap: this.angle, gridSnap: this.grid, angleMagnet: 0.105 }; }

  /* ---- smooth, sticky snapping ---- */
  private stickNode = -1;
  private stickEdge = -1;
  /** Where the cursor wants to be (snapped) and where the preview currently is (eased towards it). */
  private target: V2 | null = null;
  private shown: V2 | null = null;
  private snapMark: V2 | null = null;
  /**
   * Snap with hysteresis: once the cursor has grabbed a junction or a road it
   * stays on it until you move clearly away (1.6× the grab radius), so the
   * preview doesn't flicker between snapped and free positions.
   */
  private resolve(p: V2): V2 {
    this.snapMark = null;
    if (this.shift) { this.stickNode = this.stickEdge = -1; return p; }
    const g = this.sim().world.roads;
    if (this.stickNode >= 0 && g.nAlive[this.stickNode] && dist(g.nodePos(this.stickNode), p) <= SNAP_NODE * 1.6) { this.snapMark = g.nodePos(this.stickNode); return this.snapMark; }
    this.stickNode = -1;
    const s = g.snap(p, this.opts(), this.pts[0]);
    if (s.kind === 'node') { this.stickNode = s.node!; this.stickEdge = -1; this.snapMark = s.p; return s.p; }
    if (this.stickEdge >= 0 && g.eAlive[this.stickEdge]) {
      const ep = g.nearestEdgePoint(p, SNAP_EDGE * 1.6);
      if (ep && ep.edge === this.stickEdge) { this.snapMark = ep.pt; return ep.pt; }
    }
    this.stickEdge = s.kind === 'edge' ? s.edge! : -1;
    if (s.kind === 'edge') this.snapMark = s.p;
    return s.p;
  }
  /** Per-frame: ease the preview towards the snapped cursor (call from the render loop). */
  tick(dt: number): void {
    if (!this.target) return;
    if (!this.shown) this.shown = { ...this.target };
    const k = 1 - Math.exp(-dt * 28), d = dist(this.shown, this.target);
    if (d < 0.02) { if (d > 0) { this.shown = { ...this.target }; this.refresh(); } return; }
    this.shown = { x: this.shown.x + (this.target.x - this.shown.x) * k, z: this.shown.z + (this.target.z - this.shown.z) * k };
    this.refresh();
  }

  /** The proposed curve from the clicked points to the (eased) cursor. */
  private proposal(end: V2): Cubic | null {
    if (!this.pts.length) return null;
    if (this.mode === 'curve' && this.pts.length === 2) return quadCubic(this.pts[0], this.pts[1], end);
    return lineCubic(this.pts[0], end);
  }
  /** Pointer moved (metres). */
  hover(p: V2): void {
    this.target = this.resolve(p);
    if (!this.shown || !this.pts.length) this.shown = { ...this.target };
    this.refresh();
  }
  private refresh(): void {
    const at = this.shown;
    if (!at) return;
    const c = this.proposal(at);
    if (!c) {
      // Nothing drawn yet: a ring the size of the road at the cursor.
      this.layer.showPreview(null);
      this.layer.showOutline({ type: this.type, ok: true, cursor: at, snap: this.snapMark });
      this.tip = null; return;
    }
    const sim = this.sim();
    const plan = placeFreeRoad(sim, c, this.type, this.opts(), false);
    const lut = buildLut(plan.curve), len = lut[lut.length - 1];
    const cells = len > 1 ? sim.world.blocks.preview(sim.world.roads, plan.curve, lut, len, this.type) : [];
    const ok = plan.ok || /release to confirm/.test(plan.reason ?? '');
    this.layer.showPreview({ cells, curve: plan.curve, type: this.type, ok });
    this.layer.showOutline({ type: this.type, ok, curve: plan.curve, snap: this.snapMark });
    const ang = Math.round((Math.atan2(-(plan.curve[7] - plan.curve[1]), plan.curve[6] - plan.curve[0]) * 180) / Math.PI);
    const head = `${Math.round(len)} m · ${ang}° · ${cells.length} cells`;
    this.tip = plan.ok ? `${head}<br>$${plan.cost.toLocaleString()}` : `${head}<br><span style="color:#ff8a80">${plan.reason}</span>`;
  }
  /** Click (metres). Returns a message for the HUD, if any. */
  click(p: V2): string | null {
    const sim = this.sim();
    const need = this.mode === 'curve' ? 2 : 1;
    const q = this.resolve(p); // exactly what the outline showed once it settled
    if (this.pts.length < need) {
      this.pts.push(q);
      this.shown = { ...q };
      return null;
    }
    const c = this.proposal(q)!;
    const plan = placeFreeRoad(sim, c, this.type, this.opts(), true, true);
    this.layer.showPreview(null); this.layer.showOutline(null);
    this.stickNode = this.stickEdge = -1;
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
/** Zoning drag: the free block cells between two points (metres), and painting them. */
export function dragCells(sim: Simulation, a: V2, b: V2, depthTiles: number) { return cellsInRect(sim, a, b, depthTiles * 4); }
export function paintDragged(sim: Simulation, a: V2, b: V2, code: number, depthTiles: number): number { return paintCells(sim, cellsInRect(sim, a, b, depthTiles * 4), code); }
export const toMetres = (x: number, z: number): V2 => ({ x: x * TILE_M, z: z * TILE_M });
