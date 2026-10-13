/**
 * render/cityRenderer.ts — turns the simulation's tiles into instanced 3D models.
 *
 * The renderer never changes the simulation; it only READS it. Each frame
 * `frame()` checks the simulation's `version` number. If it changed since we
 * last drew, we rebuild every instance pool from scratch by walking all 4,096
 * tiles. That sounds expensive but it's a few thousand matrix writes — well
 * under a millisecond — and it's far simpler than tracking individual edits.
 *
 * Zoned buildings come from the design catalogue in buildings.ts (5 designs
 * per zone x 3 levels, each split into walls/accent/fixed pools). The ground
 * is 4,096 instanced squares tinted by terrain type (terrain.ts), and trees,
 * bushes and rocks are instanced too (nature.ts).
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
import { buildDesigns, pickLook } from './buildings';
import { buildGroundMesh, NATURE } from './nature';
import { Deco } from '../sim/terrain';
import { hash2 } from '../sim/random';
import { cableMatrix, dropGeometry, poleGeometry, poleSpot, spanGeometry, WIRE_HALF, WIRE_Y } from './powerLines';

export const ZONE_COLORS: Record<ZoneType, number> = {
  residential: 0x7fd36b,
  commercial: 0x69a8ec,
  industrial: 0xeac55c,
};

export type OverlayMode = 'none' | 'power' | 'water';

const PIPE_OFFSET = new THREE.Vector3(-0.28, 0, -0.28); // pipes run along the opposite corner

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
  /** Smooth vertex-coloured ground (nature.ts), rebuilt when the city seed changes. */
  private groundMesh: THREE.Mesh | null = null;
  private groundSeed = NaN;

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
    // One pool per (zone, design, level, part): "residential.2.1.walls" etc.
    const designs = buildDesigns();
    for (const zone of ['residential', 'commercial', 'industrial'] as const) {
      designs[zone].forEach((levels, k) =>
        levels.forEach((parts, lv) => {
          for (const which of ['walls', 'accent', 'fixed'] as const) add(`${zone}.${k}.${lv + 1}.${which}`, parts[which], solid, 32);
        }),
      );
    }
    add('pine', NATURE.pine(), solid, 512);
    add('oak', NATURE.oak(), solid, 512);
    add('birch', NATURE.birch(), solid, 512);
    add('bush', NATURE.bush(), solid, 256);
    add('rock', NATURE.rock(), solid, 256);
    add('powerPlant', MODELS.powerPlant(), solid, 32);
    add('windTower', MODELS.windTower(), solid, 64);
    add('windBlades', MODELS.windBlades(), solid, 64);
    add('waterTower', MODELS.waterTower(), solid, 32);
    // PR 3 power lines: poles on the curb, sagging spans, and drop wires to houses.
    add('pole', poleGeometry(), solid, 512);
    add('span', spanGeometry(), solid, 1024);
    add('drop', dropGeometry(), solid, 512, false);
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

    const seed = sim.world.seed;
    // The smooth ground mesh only depends on the seed, so build it once per city.
    if (seed !== this.groundSeed) {
      if (this.groundMesh) {
        this.group.remove(this.groundMesh);
        this.groundMesh.geometry.dispose();
      }
      this.groundMesh = buildGroundMesh(seed);
      this.group.add(this.groundMesh);
      this.groundSeed = seed;
    }
    tiles.forEach((t, i) => {
      const [x, z] = coords(i);
      const center = tileCenter(x, z);
      // A stable pseudo-random quarter-turn for things that don't face a road.
      const turn = Math.floor(hash2(x, z, seed + 7) * 4) * (Math.PI / 2);

      // ---- Decorations: jittered, scaled and rotated by hash ----
      if (t.deco) {
        const kind = (['', 'pine', 'oak', 'birch', 'bush', 'rock'] as const)[t.deco];
        const jx = (hash2(x, z, seed + 41) - 0.5) * 0.4;
        const jz = (hash2(x, z, seed + 43) - 0.5) * 0.4;
        const size = 0.85 + hash2(x, z, seed + 47) * 0.45;
        const tint = 0.85 + hash2(x, z, seed + 53) * 0.15;
        const pos = center.clone().add(new THREE.Vector3(jx, 0, jz));
        P[kind].add(this.place(pos, hash2(x, z, seed + 59) * Math.PI * 2, size, size), this.c.setRGB(tint, tint, tint));
        // Dense forest tiles get a second, smaller tree for a fuller canopy.
        if (t.deco <= Deco.Birch && hash2(x, z, seed + 61) > 0.6) {
          const p2 = center.clone().add(new THREE.Vector3(-jx * 0.9, 0, -jz * 0.9 + 0.12));
          P[kind].add(this.place(p2, hash2(x, z, seed + 67) * 6, size * 0.7, size * 0.7), this.c.setRGB(tint, tint, tint));
        }
      }

      if (t.road) {
        P.road.add(this.place(center));
        // Dashes follow the road: east-west roads get dashes along x, north-south along z.
        const ew = has(x - 1, z, (n) => n.road) || has(x + 1, z, (n) => n.road);
        const ns = has(x, z - 1, (n) => n.road) || has(x, z + 1, (n) => n.road);
        if (ew !== ns) P.roadDash.add(this.place(center, ns ? Math.PI / 2 : 0));
      }

      if (t.powerLine) {
        // Pole on the street edge (see powerLines.ts for the placement rules).
        const spot = poleSpot(tiles, x, z);
        P.pole.add(this.place(spot.pos, spot.rotY));
        // Draw each span once: only to the east and south neighbours.
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          if (!has(x + dx, z + dz, (n) => n.powerLine)) continue;
          const other = poleSpot(tiles, x + dx, z + dz);
          const a = spot.pos.clone().setY(WIRE_Y);
          const b = other.pos.clone().setY(WIRE_Y);
          P.span.add(cableMatrix(a, b, this.m));
        }
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
          const lv = t.level;
          const look = pickLook(t.zone, x, z, seed);
          // Turn the building so its front (+z in model space) faces a road.
          const face = this.roadFacing(x, z, has) ?? turn;
          if (st.powered) this.addDropWire(tiles, x, z, face, lv, has);
          const key = `${t.zone}.${look.design}.${lv}`;
          const dim = st.operating ? 1 : 0.55;
          const m = this.place(center, face);
          P[`${key}.walls`].add(m, this.c.setHex(look.wall).multiplyScalar(dim));
          P[`${key}.accent`].add(m, this.c.setHex(look.accent).multiplyScalar(dim));
          P[`${key}.fixed`].add(m, this.c.setScalar(dim));
          const h = 0.35 + lv * 0.3;
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

  /**
   * Angle that turns a model's front (+z) toward a neighbouring road.
   * rotateY(a) maps +z to (sin a, 0, cos a), so to face direction (dx, dz)
   * we need a = atan2(dx, dz). Prefers south, east, north, west in that order.
   */
  private roadFacing(x: number, z: number, has: (x: number, z: number, f: (t: Tile) => boolean) => boolean): number | null {
    // First choice: a road that also carries a power line, so the pole and
    // its drop wire end up in FRONT of the building (PR 3).
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      if (has(x + dx, z + dz, (n) => n.road && n.powerLine)) return Math.atan2(dx, dz);
    }
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      if (has(x + dx, z + dz, (n) => n.road)) return Math.atan2(dx, dz);
    }
    return null;
  }

  /**
   * A drop wire from the nearest pole to the front of a powered building.
   * We prefer the line tile the building faces (the street in front); if the
   * only line is elsewhere, we still connect to it so it's clear where power
   * comes from.
   */
  private addDropWire(tiles: Tile[], x: number, z: number, face: number, level: number, has: (x: number, z: number, f: (t: Tile) => boolean) => boolean): void {
    const fx = Math.round(Math.sin(face));
    const fz = Math.round(Math.cos(face));
    const options: Array<[number, number]> = [[fx, fz], [0, 1], [1, 0], [0, -1], [-1, 0]];
    const pick = options.find(([dx, dz]) => has(x + dx, z + dz, (n) => n.powerLine));
    if (!pick) return; // powered via a plant/turbine next door, no wire to draw
    const spot = poleSpot(tiles, x + pick[0], z + pick[1]);
    // Start at whichever insulator is nearer the house.
    const a = spot.pos.clone().setY(WIRE_Y - 0.03);
    const armDir = new THREE.Vector3(0, 0, 1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, spot.rotY);
    const toHouse = new THREE.Vector3(x + 0.5, 0, z + 0.5).sub(spot.pos);
    a.addScaledVector(armDir, toHouse.dot(armDir) >= 0 ? WIRE_HALF : -WIRE_HALF);
    // End on the building's front wall, about eave height.
    const b = new THREE.Vector3(x + 0.5 + fx * 0.22, 0.22 + Math.min(level, 2) * 0.12, z + 0.5 + fz * 0.22);
    this.pools.drop.add(cableMatrix(a, b, this.m));
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
