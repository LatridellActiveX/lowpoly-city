/**
 * render/chainOverlay.ts — IND-2: the 🔗 Supply chain view.
 *
 * Draws sim/chainFlow.ts links as flat ARROWS from each producer to the
 * customer it trucks to (a processor, a shop or a construction yard), plus
 * RED RINGS on buildings short of what they need right now.
 *
 *   arrow colour   green  = busy link (≥ FLOW_GOOD loads lately)
 *                  yellow = some flow
 *                  red    = barely any flow lately (fading out)
 *   arrow width    grows a little with the flow
 *   red ring       a processor with an empty hopper and nothing on the way,
 *                  an empty shop, or a yard with no materials while sites wait
 *
 * Three InstancedMeshes (shafts, heads, rings), drawn on top of everything
 * (no depth test) so they read at any zoom. Only the busiest MAX_LINKS
 * links are drawn and the instances are rebuilt at most twice a second, so
 * a 192 map costs about the same as a small one. Scene units are tiles.
 */
import * as THREE from 'three';
import type { Simulation } from '../sim/simulation';
import { band, MAX_LINKS, shortages } from '../sim/chainFlow';
import { RECIPES, roleOf } from '../sim/chains';
import { GRID_SIZE } from '../sim/types';

/** Height of the arrows (above most low-rise roofs; no depth test anyway). */
const Y = 0.55;
const COL = { good: 0x34c759, weak: 0xffcc00, low: 0xff3b30 };
const MAX_RINGS = 512;

export class ChainOverlay {
  private shafts: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private nextBuild = 0;
  constructor(scene: THREE.Scene) {
    const mat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    // Shaft: a unit-long flat strip along +x, starting at the origin (scaled per link).
    const shaft = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    // Head: a flat triangle pointing +x, tip at the origin.
    const head = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -1, 0, -0.6, -1, 0, 0.6], 3));
    head.setIndex([0, 2, 1]); head.computeVertexNormals();
    this.shafts = new THREE.InstancedMesh(shaft, mat(), MAX_LINKS);
    this.heads = new THREE.InstancedMesh(head, mat(), MAX_LINKS);
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.34, 0.46, 24), new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide }), MAX_RINGS);
    for (const im of [this.shafts, this.heads, this.rings]) { im.count = 0; im.renderOrder = 21; im.frustumCulled = false; scene.add(im); }
    // Instance colours need a buffer before the first draw.
    this.shafts.setColorAt(0, this.c.setHex(0xffffff)); this.heads.setColorAt(0, this.c);
  }

  /** Draw the chain for `sim` (null = the view is off: hide). `t` (s) pulses the rings. */
  update(sim: Simulation | null, t: number): void {
    if (!sim) { this.shafts.count = this.heads.count = this.rings.count = 0; this.nextBuild = 0; return; }
    const pulse = 1 + 0.1 * Math.sin(t * 5);
    if (t >= this.nextBuild) { this.nextBuild = t + 0.5; this.build(sim); }
    // Pulse the rings without rebuilding the arrows.
    for (let k = 0; k < this.rings.count; k++) {
      this.rings.getMatrixAt(k, this.m);
      const p = new THREE.Vector3().setFromMatrixPosition(this.m);
      this.m.compose(p, this.flat, new THREE.Vector3(pulse, pulse, pulse));
      this.rings.setMatrixAt(k, this.m);
    }
    this.rings.instanceMatrix.needsUpdate = true;
  }

  private build(sim: Simulation): void {
    const N = GRID_SIZE, w = sim.world;
    const at = (i: number) => new THREE.Vector3((i % N) + 0.5, Y, Math.floor(i / N) + 0.5);
    const links = sim.shipping.flow.top(w.tick);
    let k = 0;
    for (const l of links) {
      const a = at(l.from), b = at(l.to), d = b.clone().sub(a), len = d.length();
      if (len < 0.3) continue;
      const ang = Math.atan2(-d.z, d.x); // rotation about +y so +x points from a to b
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      const wdt = Math.min(0.32, 0.12 + 0.05 * l.rate), head = Math.min(0.5, 0.18 + wdt);
      // Shaft from a to just before the head; the head's tip sits 0.3 short of b (outside the building).
      const tip = a.clone().addScaledVector(d, Math.max(0.5, len - 0.3) / len);
      this.m.compose(a, q, new THREE.Vector3(Math.max(0.05, tip.distanceTo(a) - head), 1, wdt));
      this.shafts.setMatrixAt(k, this.m);
      this.m.compose(tip, q, new THREE.Vector3(head, 1, head));
      this.heads.setMatrixAt(k, this.m);
      this.c.setHex(COL[band(l.rate)]);
      this.shafts.setColorAt(k, this.c); this.heads.setColorAt(k, this.c);
      k++;
    }
    this.shafts.count = this.heads.count = k;
    for (const im of [this.shafts, this.heads]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    // Red rings on shortages.
    const short = shortages(w, (i) => !!RECIPES[roleOf(w, i)], (key) => sim.shipping.isIncoming(key));
    this.rings.count = Math.min(MAX_RINGS, short.length);
    for (let r = 0; r < this.rings.count; r++) { this.m.compose(at(short[r]).setY(Y - 0.01), this.flat, new THREE.Vector3(1, 1, 1)); this.rings.setMatrixAt(r, this.m); }
    this.rings.instanceMatrix.needsUpdate = true;
  }
}
