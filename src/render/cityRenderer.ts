/**
 * render/cityRenderer.ts — turns the simulation's tiles into instanced 3D models.
 *
 * The renderer never changes the simulation; it only READS it. Each frame
 * `frame()` checks the simulation's `version` number. If it changed since we
 * last drew, we rebuild every instance pool from scratch by walking all 4,096
 * tiles. That sounds expensive but it's a few thousand matrix writes — well
 * under a millisecond — and it's far simpler than tracking individual edits.
 *
 * Things that move every frame (spinning turbine blades, bobbing warning
 * markers) are updated separately in `animate()`, touching only those pools.
 */
import * as THREE from 'three';
import { coords, idx, inBounds } from '../sim/grid';
import { Simulation } from '../sim/simulation';
import { GRID_SIZE, Tile, ZoneType } from '../sim/types';
import { InstancePool } from './instancing';
import { MODELS } from './models';
import { tileCenter } from './scene';

export const ZONE_COLORS: Record<ZoneType, number> = {
  residential: 0x7fd36b,
  commercial: 0x69a8ec,
  industrial: 0xeac55c,
};

export type OverlayMode = 'none' | 'power' | 'water';

const POLE_OFFSET = new THREE.Vector3(0.3, 0, 0.3); // poles stand in a tile corner
const PIPE_OFFSET = new THREE.Vector3(-0.28, 0, -0.28); // pipes run along the opposite corner
const POLE_TOP = 0.6;

export class CityRenderer {
  private readonly group = new THREE.Group();
  private readonly pools: Record<string, InstancePool> = {};
  private lastVersion = -1;
  private lastOverlay: OverlayMode = 'none';
  /** Hub positions of every turbine (for blade animation). */
  private turbines: THREE.Vector3[] = [];
  /** Positions + colours of warning markers (for bobbing animation). */
  private markers: Array<{ pos: THREE.Vector3; color: THREE.Color }> = [];
  overlay: OverlayMode = 'none';

  // Reused scratch objects so we don't allocate thousands per rebuild.
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const solid = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material = solid, cap = 256, shadows = true) =>
      (this.pools[name] = new InstancePool(this.group, geo, mat, cap, shadows));

    add('road', MODELS.road(), solid, 1024, false);
    add('roadDash', MODELS.roadDash(), solid, 1024, false);
    add('lot', MODELS.lot(), solid, 1024, false);
    add('house', MODELS.house());
    add('shop', MODELS.shop());
    add('factory', MODELS.factory());
    add('powerPlant', MODELS.powerPlant(), solid, 32);
    add('windTower', MODELS.windTower(), solid, 64);
    add('windBlades', MODELS.windBlades(), solid, 64);
    add('waterTower', MODELS.waterTower(), solid, 32);
    add('pole', MODELS.pole(), solid, 512);
    add('wire', MODELS.wire(), solid, 1024, false);
    add('pipeJoint', MODELS.pipeJoint(), solid, 512, false);
    add('pipe', MODELS.pipe(), solid, 1024, false);
    add('marker', MODELS.marker(), new THREE.MeshBasicMaterial({ vertexColors: true }), 128, false);
    // Overlay squares are transparent and drawn on top of the ground.
    const overlayMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false, vertexColors: false });
    add('overlay', MODELS.tilePlane(), overlayMat, 1024, false);
  }

  /** Compose position * rotation(y) * scale into the scratch matrix. */
  private place(pos: THREE.Vector3, rotY = 0, sx = 1, sy = 1, sz = sx): THREE.Matrix4 {
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY);
    this.s.set(sx, sy, sz);
    return this.m.compose(pos, this.q, this.s);
  }

  /** Called every frame. Rebuilds instances if the sim changed, then animates. */
  frame(sim: Simulation, time: number): void {
    if (sim.version !== this.lastVersion || this.overlay !== this.lastOverlay) {
      this.rebuild(sim);
      this.lastVersion = sim.version;
      this.lastOverlay = this.overlay;
    }
    this.animate(time);
  }

  private rebuild(sim: Simulation): void {
    const P = this.pools;
    for (const p of Object.values(P)) p.begin();
    this.turbines = [];
    this.markers = [];
    const tiles = sim.world.tiles;
    const has = (x: number, z: number, f: (t: Tile) => boolean) => inBounds(x, z) && f(tiles[idx(x, z)]);

    tiles.forEach((t, i) => {
      const [x, z] = coords(i);
      const center = tileCenter(x, z);
      // Every tile gets a stable pseudo-random rotation (0/90/180/270) so
      // rows of identical houses don't look copy-pasted.
      const turn = Math.floor(t.variant * 4) * (Math.PI / 2);

      if (t.road) {
        P.road.add(this.place(center));
        // Dashes follow the road: east-west roads get dashes along x, north-south along z.
        const ew = has(x - 1, z, (n) => n.road) || has(x + 1, z, (n) => n.road);
        const ns = has(x, z - 1, (n) => n.road) || has(x, z + 1, (n) => n.road);
        if (ew !== ns) P.roadDash.add(this.place(center, ns ? Math.PI / 2 : 0));
      }

      if (t.powerLine) {
        const pole = center.clone().add(POLE_OFFSET);
        P.pole.add(this.place(pole));
        const top = pole.clone().setY(POLE_TOP);
        // Draw each wire once: only to the east and south neighbours.
        if (has(x + 1, z, (n) => n.powerLine)) P.wire.add(this.place(top, 0));
        if (has(x, z + 1, (n) => n.powerLine)) P.wire.add(this.place(top, -Math.PI / 2));
      }

      if (t.waterPipe) {
        const joint = center.clone().add(PIPE_OFFSET);
        P.pipeJoint.add(this.place(joint));
        if (has(x + 1, z, (n) => n.waterPipe)) P.pipe.add(this.place(joint, 0));
        if (has(x, z + 1, (n) => n.waterPipe)) P.pipe.add(this.place(joint, -Math.PI / 2));
      }

      if (t.zone) {
        P.lot.add(this.place(center), this.c.setHex(ZONE_COLORS[t.zone]));
        if (t.level > 0) {
          const st = sim.status(i);
          // Non-operating buildings are drawn dimmed grey so problems stand out.
          const tint = st.operating ? this.c.setHex(0xffffff) : this.c.setHex(0x8a8a8a);
          const lv = t.level;
          const model = t.zone === 'residential' ? 'house' : t.zone === 'commercial' ? 'shop' : 'factory';
          // Bigger level => wider and much taller building.
          const w = 0.75 + lv * 0.08;
          const h = model === 'house' ? 0.8 + lv * 0.45 : 0.7 + lv * 0.55;
          P[model].add(this.place(center, turn, w, h, w), tint);
          if (!st.operating) {
            // Marker colour says what's missing first: grey road, yellow power, blue water.
            const col = !st.roadAccess ? 0xbbbbbb : !st.powered ? 0xffd21f : 0x29a3ff;
            this.markers.push({ pos: center.clone().setY(h * 0.6 + 0.35), color: new THREE.Color(col) });
          }
        }
      }

      if (t.structure === 'powerPlant') P.powerPlant.add(this.place(center, turn));
      if (t.structure === 'waterTower') {
        const st = sim.status(i);
        P.waterTower.add(this.place(center), st.powered ? undefined : this.c.setHex(0x8a8a8a));
        if (!st.powered) this.markers.push({ pos: center.clone().setY(1.3), color: new THREE.Color(0xffd21f) });
      }
      if (t.structure === 'windTurbine') {
        P.windTower.add(this.place(center));
        this.turbines.push(center.clone().setY(1.26).add(new THREE.Vector3(0, 0, 0.12)));
      }

      // Coverage overlay: green-ish = served, red = connected but in outage.
      if (this.overlay !== 'none') {
        const s = sim.net.service[i];
        const net = this.overlay === 'power' ? s.powerNet : s.waterNet;
        if (net >= 0) {
          const served = this.overlay === 'power' ? s.powered : s.watered;
          const color = !served ? 0xff3b30 : this.overlay === 'power' ? 0xffd21f : 0x29a3ff;
          P.overlay.add(this.place(center.clone().setY(0.09)), this.c.setHex(color));
        }
      }
    });

    for (const p of Object.values(P)) p.end();
  }

  /** Per-frame motion: spin blades, bob markers. */
  private animate(time: number): void {
    const blades = this.pools.windBlades;
    blades.begin();
    const spin = new THREE.Quaternion();
    for (const [k, hub] of this.turbines.entries()) {
      // Each turbine gets a slightly different phase so they don't spin in lockstep.
      spin.setFromAxisAngle(new THREE.Vector3(0, 0, 1), time * 2.2 + k * 1.7);
      blades.add(this.m.compose(hub, spin, this.s.set(1, 1, 1)));
    }
    blades.end();

    const mk = this.pools.marker;
    mk.begin();
    for (const { pos, color } of this.markers) {
      const p = pos.clone();
      p.y += Math.sin(time * 3 + pos.x) * 0.06;
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, time * 1.5);
      mk.add(this.m.compose(p, this.q, this.s.set(1, 1.4, 1)), color);
    }
    mk.end();
  }
}

/** Highlights for the hovered tile and the green/red placement preview. */
export class PreviewRenderer {
  private readonly pool: InstancePool;
  private readonly c = new THREE.Color();
  private readonly m = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });
    this.pool = new InstancePool(scene, MODELS.tilePlane(), mat, GRID_SIZE * 4, false);
    this.pool.mesh.renderOrder = 10;
  }

  /** tiles: each with a validity flag; hover-only tiles are drawn white. */
  show(tiles: Array<{ x: number; z: number; ok: boolean | null }>): void {
    this.pool.begin();
    for (const t of tiles) {
      const color = t.ok === null ? 0xffffff : t.ok ? 0x34c759 : 0xff3b30;
      this.m.makeTranslation(t.x + 0.5, 0.12, t.z + 0.5);
      this.pool.add(this.m, this.c.setHex(color));
    }
    this.pool.end();
  }
}
