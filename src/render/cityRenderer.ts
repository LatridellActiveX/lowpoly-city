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
import { BRIDGE_Y, curveYaw, ROADS } from './roads';
import { Deco } from '../sim/terrain';
import { hash2 } from '../sim/random';
import { LAMP_REACH, substationGeometry, SUBSTATION_WIRE_Y, carriesPower, cableMatrix, dropGeometry, lampArmGeometry, lampBulbGeometry, lampYaw, poleGeometry, poleSpot, isPoleTile, nextPole, servingPole, spanGeometry, WIRE_HALF, WIRE_Y } from './powerLines';

export const ZONE_COLORS: Record<ZoneType, number> = {
  residential: 0x7fd36b,
  commercial: 0x69a8ec,
  industrial: 0xeac55c,
};

export type OverlayMode = 'none' | 'power' | 'water' | 'pollution';

const PIPE_OFFSET = new THREE.Vector3(-0.28, 0, -0.28); // pipes run along the opposite corner

/** A round badge with an emoji on it, drawn once into a canvas texture. */
function iconMaterial(emoji: string, ring: string): THREE.MeshBasicMaterial {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgba(20,28,40,0.88)';
  g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.fill();
  g.lineWidth = 5; g.strokeStyle = ring; g.stroke();
  g.font = '34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(emoji, 32, 35);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  // depthTest off + high renderOrder would hide nothing behind; we keep depth
  // testing so icons tuck behind tall buildings, like real objects.
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
}

/**
 * Roof box of a zoned building: footprint (w × d) and roof height h.
 * Mirrors the formulas at the top of each zone function in buildings.ts
 * (FLOOR = 0.26 per storey); used to hang drop wires on the roof corner.
 */
function roofBox(zone: ZoneType, level: number): { w: number; d: number; h: number } {
  if (zone === 'residential') return { w: 0.46 + level * 0.08, d: 0.4 + level * 0.07, h: 0.26 * level + 0.06 };
  if (zone === 'commercial') return { w: 0.56 + level * 0.08, d: 0.5 + level * 0.06, h: 0.26 * (level === 3 ? 4 : level) + 0.1 };
  return { w: 0.6 + level * 0.08, d: 0.48 + level * 0.07, h: 0.22 + level * 0.12 };
}

/** Scratch colour for lerps. */
const TMP = new THREE.Color();

export class CityRenderer {
  private readonly group = new THREE.Group();
  private readonly pools: Record<string, InstancePool> = {};
  private lastVersion = -1;
  private lastOverlay: OverlayMode = 'none';
  /** PR 4: bulb positions of every street lamp (for the night halo billboards). */
  private lamps: THREE.Vector3[] = [];
  /** Hub positions of every turbine (for blade animation). */
  private turbines: THREE.Vector3[] = [];
  /** Positions + colours of warning markers (for bobbing animation). */
  private markers: Array<{ pos: THREE.Vector3; color: THREE.Color; kind: 'gem' | 'power' | 'water'; slot: number }> = [];
  /** Camera rotation, set by main.ts each frame, so icon sprites can face the camera ("billboarding"). */
  cameraQuat = new THREE.Quaternion();
  /** Water pipes are only drawn while the pipe tool or the water overlay is active (PR 3). */
  showPipes = false;
  private lastShowPipes = false;
  overlay: OverlayMode = 'none';
  /** Smooth vertex-coloured ground (nature.ts), rebuilt when the city seed changes. */
  private groundMesh: THREE.Mesh | null = null;
  private groundSeed = NaN;

  // Reused scratch objects so we don't allocate thousands per rebuild.
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  /**
   * Glow materials for night (PR 3). ADDITIVE blending adds their colour to
   * whatever is behind, so black = invisible and warm yellow = a glow; the
   * polygon offset pulls the window glow just in front of the glass it copies
   * so the two don't flicker ("z-fighting").
   */
  private readonly windowGlow = new THREE.MeshBasicMaterial({ color: 0xffd890, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private readonly bulbGlow = new THREE.MeshBasicMaterial({ color: 0xfff0b8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });

  /** 0 = day, 1 = night: fades in lit windows and street lamps (dayNight.ts). */
  setNight(n: number): void {
    this.windowGlow.opacity = n;
    this.bulbGlow.opacity = n;
    // Hide the lamp meshes completely by day so they cost nothing.
    for (const k of ['lampBulb']) this.pools[k].mesh.visible = n > 0.01;
  }

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const solid = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material = solid, cap = 256, shadows = true) =>
      (this.pools[name] = new InstancePool(this.group, geo, mat, cap, shadows));

    // PR 4 roads (roads.ts): squares, curves, sidewalks, avenue markings, bridges.
    add('road', ROADS.square(), solid, 1024, false);
    add('roadCurve', ROADS.curve(), solid, 256, false);
    add('sidewalk', ROADS.sidewalk(), solid, 2048, false);
    add('avenueMarks', ROADS.avenueMarks(), solid, 512, false);
    add('roadDash', MODELS.roadDash(), solid, 1024, false);
    add('bridge', ROADS.bridgeDeck(), solid, 128);
    add('railing', ROADS.railing(), solid, 256);
    add('highway', ROADS.highway(), solid, 4);
    add('water', ROADS.water(), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }), 1024, false);
    add('lot', MODELS.lot(), solid, 1024, false);
    // One pool per (zone, design, level, part): "residential.2.1.walls" etc.
    const designs = buildDesigns();
    for (const zone of ['residential', 'commercial', 'industrial'] as const) {
      designs[zone].forEach((levels, k) =>
        levels.forEach((parts, lv) => {
          for (const which of ['walls', 'accent', 'fixed'] as const) add(`${zone}.${k}.${lv + 1}.${which}`, parts[which], solid, 32);
          add(`${zone}.${k}.${lv + 1}.lights`, parts.lights, this.windowGlow, 32, false);
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
    add('park', MODELS.park(), solid, 64);
    // PR 3 power lines: poles on the curb, sagging spans, and drop wires to houses.
    add('pole', poleGeometry(), solid, 512);
    add('span', spanGeometry(), solid, 1024);
    add('drop', dropGeometry(), solid, 512, false);
    add('substation', substationGeometry(), solid, 64);
    // Street lamps on road-side poles (PR 3): arm + glowing bulb + light pool.
    add('lampArm', lampArmGeometry(), solid, 512);
    add('lampBulb', lampBulbGeometry(), this.bulbGlow, 512, false);
    add('pipeJoint', MODELS.pipeJoint(), solid, 512, false);
    add('pipe', MODELS.pipe(), solid, 1024, false);
    // Warning icons (PR 3): ⚡ for no power, 💧 for no water. Each is ONE
    // instanced textured square, turned to face the camera every frame, so a
    // city with hundreds of problems still costs two draw calls.
    add('iconPower', new THREE.PlaneGeometry(0.34, 0.34), iconMaterial('⚡', '#ffd21f'), 128, false);
    add('iconWater', new THREE.PlaneGeometry(0.34, 0.34), iconMaterial('💧', '#29a3ff'), 128, false);
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
    if (sim.version !== this.lastVersion || this.overlay !== this.lastOverlay || this.showPipes !== this.lastShowPipes) {
      this.lastShowPipes = this.showPipes;
      this.rebuild(sim);
      this.lastVersion = sim.version;
      this.lastOverlay = this.overlay;
    }
    // Blades turn faster in stronger wind. We integrate an angle instead of
    // using time × speed directly, so a change in wind doesn't make the
    // blades jump to a new position.
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    if (sim.speed > 0) this.bladeAngle += dt * (0.3 + sim.world.wind * 4.5);
    this.animate(time);
  }
  private lastTime = 0;
  private bladeAngle = 0;

  private rebuild(sim: Simulation): void {
    const P = this.pools;
    for (const p of Object.values(P)) p.begin();
    this.turbines = [];
    this.markers = [];
    this.lamps = [];
    const tiles = sim.world.tiles;
    const has = (x: number, z: number, f: (t: Tile) => boolean) => inBounds(x, z) && f(tiles[idx(x, z)]);

    const seed = sim.world.seed;
    // The smooth ground mesh only depends on the seed, so build it once per city.
    if (seed !== this.groundSeed) {
      if (this.groundMesh) {
        this.group.remove(this.groundMesh);
        this.groundMesh.geometry.dispose();
      }
      this.groundMesh = buildGroundMesh(seed, (gx, gz) => tiles[idx(gx, gz)].water);
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

      if (t.water) {
        // River/lake surface. A gentle per-tile tint wobble keeps it from looking flat.
        const k = 0.92 + hash2(x, z, seed + 5) * 0.1;
        P.water.add(this.place(center), this.c.setRGB(k, k, k));
      }

      if (t.road) this.addRoad(t, x, z, center, has);

      // PR 4: poles only on "pole tiles" (every other tile on straight runs,
      // always at junctions/corners/ends), see powerLines.isPoleTile. The
      // round light pools PR 3 painted on the road under lamps are gone; the
      // lamp's glow is now a soft halo around the bulb (stage 6).
      if (carriesPower(t) && isPoleTile(tiles, x, z)) {
        const spot = poleSpot(tiles, x, z);
        P.pole.add(this.place(spot.pos, spot.rotY));
        // Road poles carry a street lamp reaching over the street.
        const yaw = t.road ? lampYaw(spot.pos, x, z) : null;
        if (yaw !== null) {
          const lm = this.place(spot.pos, yaw);
          P.lampArm.add(lm);
          P.lampBulb.add(lm);
          this.lamps.push(new THREE.Vector3(LAMP_REACH, 0.6, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(spot.pos));
        }
        // Each span once: walk east and south to the next pole (may skip a tile).
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          const np = nextPole(tiles, x, z, dx, dz);
          if (!np) continue;
          const other = poleSpot(tiles, np[0], np[1]);
          const a = spot.pos.clone().setY(spot.pos.y + WIRE_Y);
          const b = other.pos.clone().setY(other.pos.y + WIRE_Y);
          P.span.add(cableMatrix(a, b, this.m));
        }
      }

      // Pipes are underground: hidden unless you're working with water.
      if (t.waterPipe && (this.showPipes || this.overlay === 'water')) {
        const joint = center.clone().add(PIPE_OFFSET);
        P.pipeJoint.add(this.place(joint));
        if (has(x + 1, z, (n) => n.waterPipe)) P.pipe.add(this.place(joint, 0));
        if (has(x, z + 1, (n) => n.waterPipe)) P.pipe.add(this.place(joint, -Math.PI / 2));
        // PR 4: pipes auto-connect to a neighbouring water tower. In the sim a
        // tower already joins any adjacent pipe network (networks.ts: sources
        // are conduits); here we draw the short pipe into the tower's base so
        // the connection is visible. rotateY(a) sends the +x pipe to (cos a, −sin a).
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!has(x + dx, z + dz, (n) => n.structure === 'waterTower')) continue;
          P.pipe.add(this.place(joint, Math.atan2(-dz, dx), 0.62, 1, 1));
        }
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
          if (st.powered) this.addDropWire(tiles, x, z, face, lv, has, t.zone);
          const key = `${t.zone}.${look.design}.${lv}`;
          const dim = st.operating ? 1 : 0.55;
          const m = this.place(center, face);
          P[`${key}.walls`].add(m, this.c.setHex(look.wall).multiplyScalar(dim));
          P[`${key}.accent`].add(m, this.c.setHex(look.accent).multiplyScalar(dim));
          P[`${key}.fixed`].add(m, this.c.setScalar(dim));
          // Night windows: most homes have a light on, some don't; offices and
          // factories are mostly lit. Dark (non-operating) buildings stay dark.
          const lit = hash2(x, z, seed + 404);
          const on = st.operating && lit < (t.zone === 'residential' ? 0.8 : 0.9);
          P[`${key}.lights`].add(m, this.c.setScalar(on ? 1.1 + lit * 0.9 : 0));
          const h = 0.35 + lv * 0.3;
          if (!st.operating) {
            // Floating warnings: grey gem = no road, ⚡ = no power, 💧 = no water.
            // With both power and water missing, the two icons sit side by side.
            const pos = center.clone().setY(h * 0.6 + 0.4);
            const both = !st.powered && !st.watered;
            if (!st.roadAccess) this.markers.push({ pos, color: new THREE.Color(0xbbbbbb), kind: 'gem', slot: 0 });
            if (!st.powered) this.markers.push({ pos, color: new THREE.Color(1, 1, 1), kind: 'power', slot: both ? -1 : 0 });
            if (!st.watered) this.markers.push({ pos, color: new THREE.Color(1, 1, 1), kind: 'water', slot: both ? 1 : 0 });
          }
        }
      }

      if (t.structure === 'powerPlant') {
        P.powerPlant.add(this.place(center, turn));
        // Plants connect to the street grid with a wire from their corner.
        this.addGridTie(tiles, x, z, has, false);
      }
      if (t.structure === 'park') P.park.add(this.place(center, turn));
      if (t.structure === 'waterTower') {
        const st = sim.status(i);
        P.waterTower.add(this.place(center), st.powered ? undefined : this.c.setHex(0x8a8a8a));
        if (!st.powered) this.markers.push({ pos: center.clone().setY(1.3), color: new THREE.Color(1, 1, 1), kind: 'power', slot: 0 });
      }
      if (t.structure === 'windTurbine') {
        P.windTower.add(this.place(center));
        // Turbines get a substation beside them, wired to the road's pole line.
        this.addGridTie(tiles, x, z, has, true);
        this.turbines.push(center.clone().setY(1.26).add(new THREE.Vector3(0, 0, 0.12)));
      }

      // Pollution overlay (PR 3): yellow (light) -> red -> purple (heavy).
      // Tiles helped by a park (and not polluted) get a soft green instead.
      if (this.overlay === 'pollution') {
        const p = sim.env.pollution[i];
        if (p > 0.15) {
          const k = Math.min(1, p / 5);
          this.c.setHex(0xffe14d).lerp(TMP.setHex(0xff3b30), Math.min(1, k * 2)).lerp(TMP.setHex(0x7a1fa2), Math.max(0, k * 2 - 1));
          P.overlay.add(this.place(center.clone().setY(0.09)), this.c);
        } else if (sim.env.parks[i] > 0.05) {
          P.overlay.add(this.place(center.clone().setY(0.09)), this.c.setHex(0x3ddc84));
        }
      } else if (this.overlay !== 'none') {
        // Coverage overlay: yellow/blue = served, red = connected but in outage.
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
   * PR 4: draw one road tile (see roads.ts for the pieces).
   * Avenues are tinted darker via the instance colour (the geometry is shared).
   */
  private addRoad(t: Tile, x: number, z: number, center: THREE.Vector3, has: (x: number, z: number, f: (t: Tile) => boolean) => boolean): void {
    const P = this.pools;
    const isRoad = (n: Tile) => n.road;
    const n = has(x, z - 1, isRoad), e = has(x + 1, z, isRoad), s = has(x, z + 1, isRoad), w = has(x - 1, z, isRoad);
    const tint = t.roadType === 1 ? this.c.setRGB(0.78, 0.78, 0.8) : this.c.setRGB(1, 1, 1);
    if (t.water) {
      // Bridge: lifted deck + pier, railings on every side without a road.
      P.bridge.add(this.place(center), tint);
      [[n, 0], [w, Math.PI / 2], [s, Math.PI], [e, (3 * Math.PI) / 2]].forEach(([has_, yaw]) => !has_ && P.railing.add(this.place(center, yaw as number)));
    } else {
      const curve = curveYaw(n, e, s, w);
      if (curve !== null) {
        P.roadCurve.add(this.place(center, curve), tint);
      } else {
        P.road.add(this.place(center), tint);
        // Kerb strips on the edges with no road beyond them (yaw: N=0, W=π/2, S=π, E=3π/2).
        [[n, 0], [w, Math.PI / 2], [s, Math.PI], [e, (3 * Math.PI) / 2]].forEach(([has_, yaw]) => {
          // The map-edge side of the highway tile stays open: the road continues off the map.
          if (!has_ && !(t.edge && this.edgeOutward(x, z) === yaw)) P.sidewalk.add(this.place(center, yaw as number));
        });
      }
    }
    // Lane markings on straight pieces only.
    const ew = e || w, ns = n || s;
    if (ew !== ns) {
      const yaw = ns ? Math.PI / 2 : 0;
      const pos = t.water ? center.clone().setY(BRIDGE_Y - 0.035) : center;
      if (t.roadType === 1) P.avenueMarks.add(this.place(pos, yaw));
      else P.roadDash.add(this.place(pos, yaw));
    }
    if (t.edge) {
      // Highway continuing off the map. The model runs along +x, and
      // rotateY(a) sends +x to (cos a, 0, −sin a), so: west edge → a = π
      // (points −x), east → 0, north → π/2 (points −z), south → −π/2.
      const yaw = x === 0 ? Math.PI : x === GRID_SIZE - 1 ? 0 : z === 0 ? Math.PI / 2 : -Math.PI / 2;
      const off = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(0.5);
      P.highway.add(this.place(center.clone().add(off), yaw));
    }
  }

  /** Sidewalk yaw (N=0, W=π/2, S=π, E=3π/2) of the map side an edge tile sits on. */
  private edgeOutward(x: number, z: number): number {
    if (x === 0) return Math.PI / 2;
    if (x === GRID_SIZE - 1) return (3 * Math.PI) / 2;
    if (z === 0) return 0;
    return Math.PI;
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
      if (has(x + dx, z + dz, (n) => n.road)) return Math.atan2(dx, dz);
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
  private addDropWire(tiles: Tile[], x: number, z: number, face: number, level: number, has: (x: number, z: number, f: (t: Tile) => boolean) => boolean, zone: ZoneType): void {
    const fx = Math.round(Math.sin(face));
    const fz = Math.round(Math.cos(face));
    const options: Array<[number, number]> = [[fx, fz], [0, 1], [1, 0], [0, -1], [-1, 0]];
    const pick = options.find(([dx, dz]) => has(x + dx, z + dz, carriesPower));
    if (!pick) return; // powered via a plant/turbine next door, no wire to draw
    // PR 4: with poles every other tile, the street tile in front may have no
    // pole of its own; hook onto the pole that serves it.
    const [px, pz] = servingPole(tiles, x + pick[0], z + pick[1]);
    const spot = poleSpot(tiles, px, pz);
    // Start at whichever insulator is nearer the house.
    const a = spot.pos.clone().setY(spot.pos.y + WIRE_Y - 0.03);
    const armDir = new THREE.Vector3(0, 0, 1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, spot.rotY);
    const toHouse = new THREE.Vector3(x + 0.5, 0, z + 0.5).sub(spot.pos);
    a.addScaledVector(armDir, toHouse.dot(armDir) >= 0 ? WIRE_HALF : -WIRE_HALF);
    // PR 4: end on the ROOF CORNER nearest the pole. roofBox() mirrors the
    // footprint/height formulas in buildings.ts, so the attachment point moves
    // up and out automatically when the building upgrades a level (the
    // renderer rebuilds on every sim change, including level-ups).
    const { w, d, h } = roofBox(zone, level);
    const local = new THREE.Vector3(0, h, d / 2); // front edge, roof height
    const worldDir = (v: THREE.Vector3) => v.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, face);
    const centre = new THREE.Vector3(x + 0.5, 0, z + 0.5);
    // Try both front corners; keep the one closer to the pole.
    const cA = centre.clone().add(worldDir(local.clone().setX(w / 2)));
    const cB = centre.clone().add(worldDir(local.clone().setX(-w / 2)));
    const b2 = cA.distanceToSquared(spot.pos) < cB.distanceToSquared(spot.pos) ? cA : cB;
    this.pools.drop.add(cableMatrix(a, b2, this.m));
  }

  /**
   * Visual grid connection for a power source (PR 3). In the SIMULATION a
   * plant/turbine next to a road or line is already part of that network
   * (networks.ts: sources join neighbouring conduits). Here we just draw it:
   * an optional substation in the tile corner facing that road, plus a wire
   * from it to the road's curb pole.
   */
  private addGridTie(tiles: Tile[], x: number, z: number, has: (x: number, z: number, f: (t: Tile) => boolean) => boolean, substation: boolean): void {
    const dir = ([[0, 1], [1, 0], [0, -1], [-1, 0]] as const).find(([dx, dz]) => has(x + dx, z + dz, carriesPower));
    if (!dir) return;
    const [dx, dz] = dir;
    // Substation sits toward the road, shifted sideways so it clears the tower.
    const sp = new THREE.Vector3(x + 0.5 + dx * 0.3 + dz * 0.22, 0, z + 0.5 + dz * 0.3 + dx * 0.22);
    if (substation) this.pools.substation.add(this.place(sp, Math.atan2(dx, dz)));
    const a = substation ? sp.clone().setY(SUBSTATION_WIRE_Y) : new THREE.Vector3(x + 0.5 + dx * 0.4, 0.45, z + 0.5 + dz * 0.4);
    const [px, pz] = servingPole(tiles, x + dx, z + dz);
    const pp = poleSpot(tiles, px, pz).pos;
    const b = pp.clone().setY(pp.y + WIRE_Y - 0.03);
    this.pools.drop.add(cableMatrix(a, b, this.m));
  }

  /** Per-frame motion: spin blades, bob markers. */
  private animate(time: number): void {
    const blades = this.pools.windBlades;
    blades.begin();
    const spin = new THREE.Quaternion();
    for (const [k, hub] of this.turbines.entries()) {
      // Each turbine gets a slightly different phase so they don't spin in lockstep.
      spin.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.bladeAngle + k * 1.7);
      blades.add(this.m.compose(hub, spin, this.s.set(1, 1, 1)));
    }
    blades.end();

    const mk = this.pools.marker;
    const ip = this.pools.iconPower, iw = this.pools.iconWater;
    mk.begin(); ip.begin(); iw.begin();
    // Camera's "right" direction, to put paired icons side by side on screen.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.cameraQuat);
    for (const { pos, color, kind, slot } of this.markers) {
      const p = pos.clone().addScaledVector(right, slot * 0.2);
      p.y += Math.sin(time * 3 + pos.x) * 0.05;
      if (kind === 'gem') {
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, time * 1.5);
        mk.add(this.m.compose(p, this.q, this.s.set(1, 1.4, 1)), color);
      } else {
        (kind === 'power' ? ip : iw).add(this.m.compose(p, this.cameraQuat, this.s.set(1, 1, 1)));
      }
    }
    mk.end(); ip.end(); iw.end();
  }
}

/**
 * Highlights for the hovered tile and the green/red placement preview.
 *
 * PR 3 adds an OUTLINE: besides a soft fill on each tile, we draw a bright
 * border around the OUTSIDE of the selection. For every tile we look at its
 * four edges and only draw an edge whose neighbour is NOT in the selection,
 * so a 5×3 rectangle gets one clean rectangle outline, and an L-shaped road
 * drag gets an outline that follows the L.
 */
export class PreviewRenderer {
  private readonly pool: InstancePool;
  private readonly edges: InstancePool;
  private readonly c = new THREE.Color();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false, depthTest: false });
    this.pool = new InstancePool(scene, MODELS.tilePlane(), mat, GRID_SIZE * 4, false);
    this.pool.mesh.renderOrder = 10;
    // One edge bar: 1 tile long along x, thin, lying flat.
    const bar = new THREE.PlaneGeometry(1.0, 0.07).rotateX(-Math.PI / 2);
    const edgeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false, depthTest: false });
    this.edges = new InstancePool(scene, bar, edgeMat, GRID_SIZE * 8, false);
    this.edges.mesh.renderOrder = 11;
  }

  /** tiles: each with a validity flag; hover-only tiles are drawn white. `outline` colours the border. */
  show(tiles: Array<{ x: number; z: number; ok: boolean | null }>, outline: boolean | null = null): void {
    this.pool.begin();
    this.edges.begin();
    const inSel = new Set(tiles.map((t) => t.z * GRID_SIZE + t.x));
    const edgeColor = outline === null ? 0xffffff : outline ? 0x34c759 : 0xff3b30;
    for (const t of tiles) {
      const color = t.ok === null ? 0xffffff : t.ok ? 0x34c759 : 0xff3b30;
      this.m.makeTranslation(t.x + 0.5, 0.12, t.z + 0.5);
      this.pool.add(this.m, this.c.setHex(color));
      // [dx, dz, bar centre offset x, z, rotation]: N, S, W, E edges.
      for (const [dx, dz, ox, oz, rot] of [[0, -1, 0.5, 0, 0], [0, 1, 0.5, 1, 0], [-1, 0, 0, 0.5, Math.PI / 2], [1, 0, 1, 0.5, Math.PI / 2]]) {
        if (inSel.has((t.z + dz) * GRID_SIZE + (t.x + dx)) && t.x + dx >= 0 && t.x + dx < GRID_SIZE) continue;
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot);
        this.m.compose(this.v.set(t.x + ox, 0.13, t.z + oz), this.q, this.one);
        this.edges.add(this.m, this.c.setHex(edgeColor));
      }
    }
    this.pool.end();
    this.edges.end();
  }
}
