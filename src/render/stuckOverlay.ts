/**
 * render/stuckOverlay.ts — OASIS: the "Show stuck cars" highlight.
 *
 * Two InstancedMeshes of flat rings drawn on top of everything (no depth
 * test) so they read at any zoom: RED rings around cars stationary longer
 * than STUCK_SECONDS, bigger ORANGE rings around the junctions those cars
 * are waiting for (ring size grows a little with the stuck count). Data
 * comes from sim/trafficInspect.ts stuckReport (via Hud.stuck); this file
 * only places instances. Scene units are tiles, the report is in metres.
 */
import * as THREE from 'three';
import { TILE_M } from '../roads/graph';
import type { StuckReport } from '../sim/trafficInspect';

const MAX = 512;
/** Height above the graph asphalt (0.041) so rings never z-fight. */
const Y = 0.06;

export class StuckOverlay {
  private cars: THREE.InstancedMesh;
  private nodes: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  constructor(scene: THREE.Scene) {
    const mat = (c: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.cars = new THREE.InstancedMesh(new THREE.RingGeometry(0.75, 1, 24), mat(0xff3b30), MAX);
    this.nodes = new THREE.InstancedMesh(new THREE.RingGeometry(0.82, 1, 32), mat(0xff9f0a), MAX);
    for (const im of [this.cars, this.nodes]) { im.count = 0; im.renderOrder = 20; im.frustumCulled = false; scene.add(im); }
  }
  /** Draw the report (null / off = hide). `t` (s) pulses the junction rings. */
  update(r: StuckReport | null, t: number): void {
    const put = (im: THREE.InstancedMesh, list: Array<{ pos: { x: number; z: number } }>, radius: (k: number) => number) => {
      im.count = Math.min(MAX, list.length);
      for (let k = 0; k < im.count; k++) {
        const p = list[k].pos, s = radius(k);
        this.m.compose(new THREE.Vector3(p.x / TILE_M, Y, p.z / TILE_M), this.q, new THREE.Vector3(s, s, s));
        im.setMatrixAt(k, this.m);
      }
      im.instanceMatrix.needsUpdate = true;
    };
    if (!r) { this.cars.count = this.nodes.count = 0; return; }
    const pulse = 1 + 0.12 * Math.sin(t * 5);
    put(this.cars, r.vehicles, () => 4.2 / TILE_M);
    put(this.nodes, r.nodes, (k) => ((14 + Math.min(10, r.nodes[k].count)) / TILE_M) * pulse);
  }
}
