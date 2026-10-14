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
import { seededStream, TEXTURE_SEEDS } from '../sim/random';
import { CELL_GRID, CellRole, FACES, ZONE_CODES, ZoneCode } from '../sim/cells';
import { bodyRect, surfaceSpaces, TPL } from '../sim/footprints';
import { frame, localToCell, rectAABB } from '../sim/lots';
import { box, merge, part } from './models';

/** PR 6: most parked cars drawn per rebuild (performance cap), their colours, and asphalt. */
export const MAX_PARKED_DRAWN = 900;
const PARKED_COLORS = [0xd94b3d, 0x3d6fd9, 0xf2f2f2, 0x2b2b2b, 0x9aa3ad, 0xe0b23a, 0x3c8f5a, 0x7a3fb0];
const ASPHALT = 0x55585c;
/** PR 6 public parking garage: a three-deck concrete block with ramps and stripes. */
function parkDeckModel(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    p.push(part(box(0.9, 0.025, 0.9), 0x8d8f93, [0, k * 0.18, 0]));
    p.push(part(box(0.9, 0.05, 0.02), 0xc9c6bf, [0, k * 0.18 + 0.03, 0.44]));
    p.push(part(box(0.9, 0.05, 0.02), 0xc9c6bf, [0, k * 0.18 + 0.03, -0.44]));
  }
  for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42], [0, -0.42], [0, 0.42]]) p.push(part(box(0.05, 0.56, 0.05), 0xb8b4ab, [x, 0, z]));
  p.push(part(box(0.9, 0.025, 0.9), 0x6f7276, [0, 0.54, 0]));
  p.push(part(box(0.2, 0.2, 0.02), 0x2f6fd0, [0.3, 0.58, 0.45])); // blue "P" sign
  return merge(p);
}
import { coords, idx, inBounds } from '../sim/grid';
import { Simulation } from '../sim/simulation';
import { GRID_SIZE, Tile, ZoneType } from '../sim/types';
import { InstancePool } from './instancing';
import { MODELS, nuclearPlantModel, pumpStationModel, SITE } from './models';
import { constructionYardModel, crewLoadModel, farmModel, fieldCrops, fieldFence, fieldSoil, foodPlantModel, nacelleModel } from './industryModels';
import { CREW_PURPOSE } from "../sim/industry";
import { Resource } from '../sim/resources';
import { CONSTRUCT_TICKS } from '../sim/rules';
import { tileCenter } from './scene';
import { RES_DESIGNS, buildDesigns, pickLook } from './buildings';
import { buildGroundMesh, buildWaterMesh, NATURE } from './nature';
import { BRIDGE_Y, curveYaw, ROADS } from './roads';
import { roofColor, SIGNAL_COLORS, SIGNAL_LAMPS, WHEELS, VEHICLES, vehiclePose } from './vehicles';
import { isIntersection, lightState } from '../sim/traffic';
import { Deco } from '../sim/terrain';
import { hash2 } from '../sim/random';
import { LAMP_REACH, substationGeometry, SUBSTATION_WIRE_Y, carriesPower, cableMatrix, dropGeometry, lampArmGeometry, lampBulbGeometry, lampYaw, poleGeometry, poleSpot, isPoleTile, nextPole, servingPole, spanGeometry, WIRE_HALF, WIRE_Y } from './powerLines';

export const ZONE_COLORS: Record<ZoneType, number> = {
  residential: 0x7fd36b,
  commercial: 0x69a8ec,
  industrial: 0xeac55c,
};

/** PR 6 adds 'zoning' (per-cell zones + density) and 'parking' (occupancy green → red). */
export type OverlayMode = 'none' | 'power' | 'water' | 'pollution' | 'resources' | 'zoning' | 'parking';

const PIPE_OFFSET = new THREE.Vector3(-0.28, 0, -0.28); // pipes run along the opposite corner

/**
 * A round warning badge drawn with canvas PATHS (PR 4 fix: PR 3 drew the ⚡ and
 * 💧 with emoji fonts, which some browsers/GPUs render blank or tiny, so the
 * icons could be invisible). Now the bolt and droplet are vector shapes, the
 * badge is bigger, and it's drawn on top (depthTest off) so tall buildings
 * can't hide it.
 */
function iconMaterial(kind: 'power' | 'water' | 'crew'): THREE.MeshBasicMaterial {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const ring = kind === 'power' ? '#ffd21f' : kind === 'crew' ? '#f28c1d' : '#29a3ff';
  g.fillStyle = 'rgba(20,28,40,0.92)';
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.lineWidth = 10; g.strokeStyle = ring; g.stroke();
  g.fillStyle = ring;
  g.beginPath();
  if (kind === 'crew') {
    // PR 5 "Waiting for construction crew": an orange traffic cone, no slash.
    g.moveTo(64, 24); g.lineTo(88, 96); g.lineTo(40, 96); g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(50, 56, 28, 9); g.fillRect(45, 74, 38, 9);
    g.fillStyle = ring; g.fillRect(32, 96, 64, 8);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  }
  if (kind === 'power') {
    // Lightning bolt: a zig-zag polygon.
    for (const [px, py] of [[72, 22], [40, 70], [60, 70], [52, 106], [88, 54], [67, 54], [78, 22]]) g.lineTo(px, py);
  } else {
    // Droplet: a point at the top curving into a round bottom.
    g.moveTo(64, 22);
    g.bezierCurveTo(64, 22, 34, 62, 34, 78);
    g.arc(64, 78, 30, Math.PI, 0, true);
    g.bezierCurveTo(94, 62, 64, 22, 64, 22);
  }
  g.closePath(); g.fill();
  // Red "no" slash so it reads as MISSING power/water at a glance.
  g.strokeStyle = '#ff4a3d'; g.lineWidth = 9;
  g.beginPath(); g.moveTo(30, 98); g.lineTo(98, 30); g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
}

/**
 * Roof box of a zoned building: footprint (w × d) and roof height h.
 * Mirrors the formulas at the top of each zone function in buildings.ts
 * (FLOOR = 0.26 per storey); used for roof-corner drop wires, scaffolds and icons.
 */
function roofBox(zone: ZoneType, level: number): { w: number; d: number; h: number } {
  // PR 5: levels 4/5 are the medium-density rowhouses / apartment blocks.
  if (zone === 'residential' && level === 4) return { w: 0.9, d: 0.6, h: 0.26 * 3 + 0.25 };
  if (zone === 'residential' && level === 6) return { w: 0.84, d: 0.64, h: 1.62 }; // PR 6 tower (unit height; stretched by template.tall)
  if (zone === 'residential' && level === 5) return { w: 0.88, d: 0.68, h: 0.26 * 5 + 0.2 };
  if (zone === 'residential') return { w: 0.46 + level * 0.08, d: 0.4 + level * 0.07, h: 0.26 * level + 0.06 };
  if (zone === 'commercial') return { w: 0.56 + level * 0.08, d: 0.5 + level * 0.06, h: 0.26 * (level === 3 ? 4 : level) + 0.1 };
  return { w: 0.6 + level * 0.08, d: 0.48 + level * 0.07, h: 0.22 + level * 0.12 };
}

/**
 * PR 4 lamp glow: a radial gradient (bright centre fading to transparent)
 * drawn once into a canvas. Used on camera-facing squares with additive
 * blending, it reads as a soft halo around each bulb instead of the flat
 * discs PR 3 painted on the road.
 */
function haloMaterial(neutral = false): THREE.MeshBasicMaterial {
  // PR 5: the PR 4 halo had a fully opaque centre and a hard 25% stop, so
  // with additive blending each lamp read as a white blob. Now the gradient
  // is a smooth, mostly-transparent falloff (many stops approximating a
  // Gaussian), peaking at only ~40% so overlapping halos don't blow out.
  // `neutral` = white gradient, so the instance colour can tint it (used
  // for traffic-signal glows, which take the lamp's red/amber/green).
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  const rgb = neutral ? '255,255,255' : '255,214,150';
  for (let k = 0; k <= 10; k++) {
    const r = k / 10;
    const a = (neutral ? 0.55 : 0.4) * Math.exp(-r * r * 5) * (1 - r); // soft bell, exactly 0 at the rim
    grad.addColorStop(r, `rgba(${rgb},${a.toFixed(3)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
}

/**
 * Tileable grayscale "grain" for the solid low-poly material. Every speck is
 * drawn at its wrapped offsets so the texture tiles seamlessly; each face's
 * built-in 0..1 UVs then sample a different patch of noise. Three.js
 * multiplies map x vertex color x instance color, so near-white speckles add
 * surface variation without changing any model's palette.
 */
function grainTexture(size = 128, speckles = 1100): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, size, size);
  // Seeded (not Math.random) so the texture is identical across reloads/players.
  const rnd = seededStream(TEXTURE_SEEDS.grain);
  for (let i = 0; i < speckles; i++) {
    const x = rnd() * size, y = rnd() * size;
    const r = 0.5 + rnd() * 1.7;
    const v = 224 + Math.floor(rnd() * 31); // 224..255, subtle darkening only
    g.fillStyle = `rgb(${v},${v},${v})`;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Scratch colour for lerps. */
const TMP = new THREE.Color();

export class CityRenderer {
  private readonly group = new THREE.Group();
  private readonly pools: Record<string, InstancePool> = {};
  private lastVersion = -1;
  /** PR 5 smooth river/lake surface (rebuilt with the ground when the seed changes). */
  private waterMesh: THREE.Mesh | null = null;
  private lastOverlay: OverlayMode = 'none';
  /** PR 4: smokestack tops of fuelled power plants. */
  private stacks: THREE.Vector3[] = [];
  /** PR 4: intersections with traffic lights (tile index + pole position). */
  private junctions: Array<{ i: number; pos: THREE.Vector3; yaw: number; axis: 'ns' | 'ew' }> = [];
  /** The sim being drawn (animate() needs vehicles and the clock). */
  private sim: Simulation | null = null;
  /** PR 4: crane tops (position + phase) for the spinning jibs. */
  private cranes: Array<{ pos: THREE.Vector3; phase: number; aim: number; reach: number }> = [];
  /** PR 4: bulb positions of every street lamp (for the night halo billboards). */
  private lamps: THREE.Vector3[] = [];
  /** Hub positions of every turbine (for blade animation). */
  private turbines: Array<{ i: number; top: THREE.Vector3 }> = [];
  /** PR 5: current (eased) yaw of each turbine's nacelle, by tile index. */
  private turbineYaw = new Map<number, number>();
  /** PR 5: wind heading (radians, see sim/wind.ts) — set every frame by frame(). */
  windDir = 0;
  /** Positions + colours of warning markers (for bobbing animation). */
  private markers: Array<{ pos: THREE.Vector3; color: THREE.Color; kind: 'gem' | 'power' | 'water' | 'crew'; slot: number }> = [];
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
  private readonly windowGlow = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private readonly bulbGlow = new THREE.MeshBasicMaterial({ color: 0xfff0b8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });

  private readonly haloMat = haloMaterial();
  /** PR 5: small coloured halo for lit traffic-signal lamps (night only). */
  private readonly signalGlowMat = haloMaterial(true);
  /** Hour bucket used for window lights (they switch on/off through the night). */
  private hour = -1;

  /**
   * PR 5 level of detail: 'high' shows the detailed models (and road
   * furniture like manholes); 'low' the simpler PR 4 models. main.ts calls
   * setLod() every frame from the zoom level + the Detail setting; a change
   * forces one rebuild of the instance pools.
   */
  lod: 'high' | 'low' = 'high';
  setLod(lod: 'high' | 'low'): void {
    if (lod === this.lod) return;
    this.lod = lod;
    this.lastVersion = -1;
  }

  /** 0 = day, 1 = night: fades in lit windows and street lamps (dayNight.ts). `time` is time of day 0..1. */
  setNight(n: number, time = 0.5): void {
    this.haloMat.opacity = n * 0.75; // PR 5: subtler (was 0.9 on an opaque-centred texture)
    this.pools.lampHalo.mesh.visible = n > 0.01;
    this.signalGlowMat.opacity = n * 0.8;
    this.pools.signalGlow.mesh.visible = n > 0.05;
    // Rebuild window lights when the in-game hour changes at night.
    const h = n > 0.01 ? Math.floor(time * 24) : -1;
    if (h !== this.hour) {
      this.hour = h;
      this.lastVersion = -1;
    }
    this.windowGlow.opacity = n;
    this.bulbGlow.opacity = n;
    // Hide the lamp meshes completely by day so they cost nothing.
    for (const k of ['lampBulb']) this.pools[k].mesh.visible = n > 0.01;
  }

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    // Procedural grain on the shared low-poly material: one 128px tileable
    // canvas texture adds subtle surface variation to every solid face
    // (map x vertex color x instance color multiply in the shader).
    const grain = grainTexture();
    const solid = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: grain });
    const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material = solid, cap = 256, shadows = true) =>
      (this.pools[name] = new InstancePool(this.group, geo, mat, cap, shadows));

    // PR 4 roads (roads.ts): squares, curves, sidewalks, avenue markings, bridges.
    add('road', ROADS.square(), solid, 1024, false);
    add('roadCurve', ROADS.curve(), solid, 256, false);
    add('sidewalk', ROADS.sidewalk(), solid, 2048, false);
    add('avenueMarks', ROADS.avenueMarks(), solid, 512, false);
    add('roadDash', ROADS.streetMarks(), solid, 1024, false); // PR 5: dashes + edge lines
    // PR 5 road furniture: crosswalks at junctions, manholes, gutter drains.
    add('crosswalk', ROADS.crosswalk(), solid, 512, false);
    add('stopLine', ROADS.stopLine(), solid, 1024, false);
    add('manhole', ROADS.manhole(), solid, 512, false);
    add('drain', ROADS.drain(), solid, 512, false);
    // PR 5 rebuilt bridges (see the BRIDGES block in roads.ts).
    add('bridgeSlab', ROADS.bridgeSlab(), solid, 256);
    add('bridgeEdge', ROADS.bridgeEdge(), solid, 512);
    add('bridgePier', ROADS.bridgePier(), solid, 256);
    add('bridgeRamp', ROADS.bridgeRamp(), solid, 128);
    add('highway', ROADS.highway(), solid, 4);
    add('water', ROADS.water(), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.9, map: grain }), 1024, false);
    add('lot', MODELS.lot(), solid, 4096, false);
    // PR 6 parking: painted stall lines, parked cars and public garages.
    add('stall', merge([part(box(0.012, 0.002, 0.2), 0xf2f2f2, [-0.118, 0, 0])]), solid, 2048, false);
    add('parkedCar', VEHICLES.car(), solid, 512);
    add('parkDeck', parkDeckModel(), solid, 32);
    // PR 6 yard props: a small pool (tiles + water) and a street hedge, both cell-sized.
    add('pool', merge([part(box(0.22, 0.012, 0.22), 0xe9e4da), part(box(0.17, 0.004, 0.17), 0x4fb3e8, [0, 0.012, 0])]), solid, 128, false);
    add('hedge', merge([part(box(0.24, 0.06, 0.04), 0x4f7a3a, [0, 0, 0.1])]), solid, 1024);
    // One pool per (zone, design, level, part): "residential.2.1.walls" etc.
    // PR 5: two levels of detail. "high" pools are named like
    // "residential.2.1.walls", "low" ones "lo:residential.2.1.walls". Both
    // exist all the time; rebuild() only fills the set for the current LOD
    // (the other set is left with 0 instances, so it costs nothing to draw).
    for (const lod of ['high', 'low'] as const) {
      const designs = buildDesigns(lod);
      const pre = lod === 'low' ? 'lo:' : '';
      for (const zone of ['residential', 'commercial', 'industrial'] as const) {
        designs[zone].forEach((levels, k) =>
          levels.forEach((parts, lv) => {
            // PR 5 perf: the small "fixed" trim (frames, vents, steps...) doesn't
            // cast shadows — at this scale they're invisible and cost a lot in the shadow pass.
            for (const which of ['walls', 'accent', 'fixed'] as const) add(`${pre}${zone}.${k}.${lv + 1}.${which}`, parts[which], solid, 32, which !== 'fixed');
            add(`${pre}${zone}.${k}.${lv + 1}.lights`, parts.lights, this.windowGlow, 32, false);
          }),
        );
      }
    }
    // PR 4 traffic: vehicles (moved every frame), traffic lights, driveways.
    add('car', VEHICLES.car(), solid, 256);
    // PR 5 driving polish: spinning wheels, tail/brake lights, headlight glow.
    add('wheel', VEHICLES.wheel(), solid, 1536, false);
    add('carRoof', VEHICLES.carRoof(), solid, 320, false);
    add('tailLight', VEHICLES.tailLights(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 320, false);
    add('headGlow', new THREE.PlaneGeometry(0.16, 0.16), this.signalGlowMat, 320, false);
    add('truckCab', VEHICLES.truckCab(), solid, 64);
    add('truckBox', VEHICLES.truckBox(), solid, 64);
    add('lightPole', VEHICLES.lightPole(), solid, 512);
    add('lightHead', VEHICLES.lightHead(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 1536, false);
    // PR 5: night glow around each LIT signal lamp (instance colour = lamp colour).
    add('signalGlow', new THREE.PlaneGeometry(0.11, 0.11), this.signalGlowMat, 512, false);
    add('driveway', VEHICLES.driveway(), solid, 512, false);
    add('garage', VEHICLES.garage(), solid, 256);
    add('loadingDock', VEHICLES.loadingDock(), solid, 128, false);
    // PR 4 smokestack smoke (only while a plant has fuel).
    add('smoke', new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, flatShading: true }), 256, false);
    // PR 4 construction sites.
    add('scaffold', SITE.scaffold(), solid, 64);
    add('craneMast', SITE.craneMast(), solid, 64);
    add('craneJib', SITE.craneJib(), solid, 64);
    add('pine', NATURE.pine(), solid, 512);
    add('oak', NATURE.oak(), solid, 512);
    add('birch', NATURE.birch(), solid, 512);
    add('bush', NATURE.bush(), solid, 256);
    add('rock', NATURE.rock(), solid, 256);
    add('powerPlant', MODELS.powerPlant(), solid, 32);
    add('nuclearPlant', nuclearPlantModel(), solid, 16);
    add('pumpStation', pumpStationModel(), solid, 16);
    add('windTower', MODELS.windTower(), solid, 64);
    add('windBlades', MODELS.windBlades(), solid, 64);
    // PR 5 industry + wind (industryModels.ts).
    add('nacelle', nacelleModel(), solid, 64);
    add('farm', farmModel(), solid, 128);
    add('fieldSoil', fieldSoil(), solid, 1024, false);
    add('fieldCrops', fieldCrops(), solid, 1024);
    add('fieldFence', fieldFence(), solid, 2048);
    for (const k of [0, 1, 2]) add(`foodPlant${k}`, foodPlantModel(k), solid, 128);
    add('constructionYard', constructionYardModel(), solid, 32);
    add('crewLoad', crewLoadModel(), solid, 64);
    add('iconCrew', new THREE.PlaneGeometry(0.5, 0.5), iconMaterial('crew'), 256, false);
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
    add('lampHalo', new THREE.PlaneGeometry(0.55, 0.55), this.haloMat, 512, false);
    add('pipeJoint', MODELS.pipeJoint(), solid, 512, false);
    add('pipe', MODELS.pipe(), solid, 1024, false);
    // Warning icons (PR 3): ⚡ for no power, 💧 for no water. Each is ONE
    // instanced textured square, turned to face the camera every frame, so a
    // city with hundreds of problems still costs two draw calls.
    add('iconPower', new THREE.PlaneGeometry(0.5, 0.5), iconMaterial('power'), 256, false);
    add('iconWater', new THREE.PlaneGeometry(0.5, 0.5), iconMaterial('water'), 256, false);
    this.pools.iconPower.mesh.renderOrder = 20;
    this.pools.iconWater.mesh.renderOrder = 20;
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
    this.frameDt = dt * (this.sim?.speed ?? 1); // PR 5: wheel spin uses game-time distance
    if (sim.speed > 0) this.bladeAngle += dt * (0.3 + sim.world.wind * 4.5);
    this.animate(time);
  }
  private lastTime = 0;
  /** PR 5: per-vehicle wheel angle and last frame's duration (seconds, game time). */
  private wheelSpin = new Map<number, number>();
  private frameDt = 0;
  private bladeAngle = 0;

  private rebuild(sim: Simulation): void {
    this.sim = sim;
    const P = this.pools;
    for (const p of Object.values(P)) p.begin();
    this.turbines = [];
    this.markers = [];
    this.lamps = [];
    this.cranes = [];
    this.junctions = [];
    this.stacks = [];
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
      // PR 5: one smooth-shored water mesh instead of per-tile water squares.
      if (this.waterMesh) {
        this.group.remove(this.waterMesh);
        this.waterMesh.geometry.dispose();
      }
      this.waterMesh = buildWaterMesh(seed, (gx, gz) => tiles[idx(gx, gz)].water);
      if (this.waterMesh) this.group.add(this.waterMesh);
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

      // (PR 5: water is drawn by the single smooth waterMesh, see buildWaterMesh.)

      if (t.road) {
        this.addRoad(t, x, z, center, has);
        if (isIntersection(tiles, i)) {
          // PR 5 fix: ONE signal pole PER APPROACH (3 at a T, 4 at a
          // crossroads), on the near-right corner for traffic entering
          // from that side, its arm reaching over that approach's lane and
          // its head facing the oncoming drivers.
          // Model frame (vehicles.ts lightPole): traffic arrives from local
          // NORTH (−z) driving +z; its right is −x, so the near-right corner
          // is (−0.44, −0.44), the arm runs +x over the lane at x ≈ −0.18
          // and the head faces −z. rotateY(a) sends local north (0, −1) to
          // (−sin a, −cos a), so the approach from neighbour (dx, dz) uses:
          //   north (0,−1) → 0,  east (1,0) → −π/2,  south (0,1) → π,  west (−1,0) → π/2.
          // Approaches from north/south run on the 'ns' phase, east/west on 'ew'
          // (same axis test as traffic.ts uses to stop cars at red).
          const y = t.water ? BRIDGE_Y : 0.04;
          for (const [dx, dz, yaw] of [[0, -1, 0], [1, 0, -Math.PI / 2], [0, 1, Math.PI], [-1, 0, Math.PI / 2]] as const) {
            if (!has(x + dx, z + dz, (q) => q.road)) continue;
            const pos = new THREE.Vector3(-0.44, 0, -0.44).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(center).setY(y);
            P.lightPole.add(this.place(pos, yaw));
            const axis: 'ns' | 'ew' = dx === 0 ? 'ns' : 'ew';
            this.junctions.push({ i, pos, yaw, axis });
          }
        }
      }

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
          if (!has(x + dx, z + dz, (n) => n.structure === 'waterTower' || n.structure === 'pumpStation')) continue;
          P.pipe.add(this.place(joint, Math.atan2(-dz, dx), 0.62, 1, 1));
        }
      }

      // PR 6: buildings, parking and zoned cells are drawn per CELL in
      // addLots() below. Here we only flag problems on HOST tiles (tiles that
      // carry a building or site), so deep zoned tiles don't show a sea of
      // "no road" icons.
      if (t.zone && (t.level > 0 || t.construct > 0)) {
        const st0 = sim.status(i);
        const both = !st0.powered && !st0.watered;
        const pos = center.clone().setY(t.construct > 0 ? 0.9 : 0.75);
        if (!st0.roadAccess) this.markers.push({ pos, color: new THREE.Color(0xbbbbbb), kind: 'gem', slot: 0 });
        if (!st0.powered) this.markers.push({ pos, color: new THREE.Color(1, 1, 1), kind: 'power', slot: both ? -1.3 : 0 });
        if (!st0.watered) this.markers.push({ pos, color: new THREE.Color(1, 1, 1), kind: 'water', slot: both ? 1.3 : 0 });
        // PR 5: no crew yet → orange cone icon ("Waiting for construction crew", see Inspect).
        if (t.construct > 0 && !t.crew && st0.operating) this.markers.push({ pos: center.clone().setY(1.25), color: new THREE.Color(1, 1, 1), kind: 'crew', slot: 0 });
        if (st0.powered && t.level > 0) this.addDropWire(tiles, x, z, this.roadFacing(x, z, has) ?? 0, 1, has, t.zone);
      }

      if (t.structure === 'powerPlant') {
        P.powerPlant.add(this.place(center, turn));
        // Smoke from the tall stack at model (−0.32, 1.02, −0.3), only while fuelled.
        if (t.stock > 0) this.stacks.push(new THREE.Vector3(-0.32, 1.02, -0.3).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn).add(center));
        // Plants connect to the street grid with a wire from their corner.
        this.addGridTie(tiles, x, z, has, false);
      }
      if (t.structure === 'nuclearPlant' && !t.part) {
        // 2×2: drawn once from the anchor, centred on the footprint and scaled ×2.
        P.nuclearPlant.add(this.place(center.clone().add(new THREE.Vector3(0.5, 0, 0.5)), 0, 2, 1.6, 2));
        this.addGridTie(tiles, x, z, has, false);
      }
      if (t.structure === 'park') P.park.add(this.place(center, turn));
      if (t.structure === 'pumpStation') {
        const st = sim.status(i);
        P.pumpStation.add(this.place(center, turn), st.powered ? undefined : this.c.setHex(0x8a8a8a));
        if (!st.powered) this.markers.push({ pos: center.clone().setY(1.0), color: new THREE.Color(1, 1, 1), kind: 'power', slot: 0 });
      }
      if (t.structure === 'waterTower') {
        const st = sim.status(i);
        P.waterTower.add(this.place(center), st.powered ? undefined : this.c.setHex(0x8a8a8a));
        if (!st.powered) this.markers.push({ pos: center.clone().setY(1.3), color: new THREE.Color(1, 1, 1), kind: 'power', slot: 0 });
      }
      if (t.structure === 'windTurbine') {
        P.windTower.add(this.place(center));
        // Turbines get a substation beside them, wired to the road's pole line.
        this.addGridTie(tiles, x, z, has, true);
        // PR 5: the nacelle + rotor yaw into the wind (animate()); keyed by tile.
        this.turbines.push({ i, top: center.clone().setY(1.26) });
      }
      if (t.structure === 'constructionYard') {
        P.constructionYard.add(this.place(center, this.roadFacing(x, z, has) ?? turn));
      }
      // Pollution overlay (PR 3): yellow (light) -> red -> purple (heavy).
      // Tiles helped by a park (and not polluted) get a soft green instead.
      if (this.overlay === 'resources') {
        // PR 4 Resources view (unlocks at 2,000 people): seeded patches.
        const r = sim.world.resourceAt(i);
        const col = { [Resource.Farmland]: 0xe8d36a, [Resource.Logging]: 0x2f8a46, [Resource.Quarry]: 0x9aa0a8, [Resource.Oil]: 0x1d1d24 }[r as 1];
        if (r !== Resource.None && col !== undefined) P.overlay.add(this.place(center.clone().setY(0.09)), this.c.setHex(col));
      } else if (this.overlay === 'pollution') {
        const p = sim.env.pollution[i];
        if (p > 0.15) {
          const k = Math.min(1, p / 5);
          this.c.setHex(0xffe14d).lerp(TMP.setHex(0xff3b30), Math.min(1, k * 2)).lerp(TMP.setHex(0x7a1fa2), Math.max(0, k * 2 - 1));
          P.overlay.add(this.place(center.clone().setY(0.09)), this.c);
        } else if (sim.env.parks[i] > 0.05) {
          P.overlay.add(this.place(center.clone().setY(0.09)), this.c.setHex(0x3ddc84));
        }
      } else if (this.overlay === 'power' || this.overlay === 'water') {
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

    this.addLots(sim, seed);
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
      // PR 5 bridge tile: deck slab, an edge (sidewalk + parapet) on every
      // side without a road beyond it, and a pier on every other tile of a
      // straight span (always under turns/junctions, which carry more load
      // and would otherwise look unsupported). Yaw per side: N=0, W=π/2,
      // S=π, E=3π/2 (rotateY sends the model's north edge there).
      P.bridgeSlab.add(this.place(center), tint);
      [[n, 0], [w, Math.PI / 2], [s, Math.PI], [e, (3 * Math.PI) / 2]].forEach(([has_, yaw]) => !has_ && P.bridgeEdge.add(this.place(center, yaw as number)));
      const straightEW = (e || w) && !n && !s, straightNS = (n || s) && !e && !w;
      const along = straightEW ? x : straightNS ? z : 0;
      if (!(straightEW || straightNS) || along % 2 === 0) P.bridgePier.add(this.place(center, straightNS ? Math.PI / 2 : 0));
    } else if (this.bridgeSide(x, z, has) !== null) {
      // PR 5 approach ramp: a land road tile touching a bridge end. The ramp
      // model rises along +x; rotateY(a) sends +x to (cos a, −sin a), so a
      // bridge to the east → 0, north → π/2, west → π, south → 3π/2. The
      // ramp REPLACES the flat road square, sidewalks and paint on this tile
      // (they would poke through the slope). A junction right at a bridge end
      // still gets the ramp; see the wiki note on bridge ends.
      P.bridgeRamp.add(this.place(center, this.bridgeSide(x, z, has)!), tint);
      return;
    } else {
      const curve = curveYaw(n, e, s, w);
      if (curve !== null) {
        P.roadCurve.add(this.place(center, curve), tint);
      } else {
        P.road.add(this.place(center), tint);
        // Kerb strips on the edges with no road beyond them (yaw: N=0, W=π/2, S=π, E=3π/2).
        [[n, 0], [w, Math.PI / 2], [s, Math.PI], [e, (3 * Math.PI) / 2]].forEach(([has_, yaw]) => {
          // The map-edge side of the highway tile stays open: the road continues off the map.
          if (!has_ && !(t.edge && this.edgeOutward(x, z) === yaw)) {
            P.sidewalk.add(this.place(center, yaw as number));
            // PR 5: a storm drain in the gutter on roughly every third kerb.
            if (this.lod === 'high' && hash2(x * 4 + (yaw as number) * 7, z, 911) > 0.66) P.drain.add(this.place(center, yaw as number));
          }
        });
        // PR 5: a stop line on this tile's approach lane for every
        // neighbouring junction (unless this tile is a junction itself).
        if (+n + +e + +s + +w < 3) {
          const tiles = this.sim!.world.tiles;
          ([[0, -1, 0], [-1, 0, Math.PI / 2], [0, 1, Math.PI], [1, 0, (3 * Math.PI) / 2]] as const).forEach(([dx, dz, yaw]) => {
            if (has(x + dx, z + dz, (q) => q.road && !q.water) && isIntersection(tiles, idx(x + dx, z + dz))) P.stopLine.add(this.place(center, yaw));
          });
        }
        // PR 5: zebra crossings on every arm of a junction (3+ road neighbours).
        if (+n + +e + +s + +w >= 3) {
          [[n, 0], [w, Math.PI / 2], [s, Math.PI], [e, (3 * Math.PI) / 2]].forEach(([has_, yaw]) => has_ && P.crosswalk.add(this.place(center, yaw as number)));
        } else if (this.lod === 'high' && hash2(x, z, 913) > 0.72) {
          // A manhole on some plain road tiles, nudged off the centreline.
          P.manhole.add(this.place(center.clone().add(new THREE.Vector3(0.12, 0, -0.1))));
        }
      }
    }
    // Lane markings on straight pieces only.
    const ew = e || w, ns = n || s;
    if (ew !== ns) {
      const yaw = ns ? Math.PI / 2 : 0;
      // Bridge paint: the marking models sit on y = 0.04, so lift them by
      // (BRIDGE_Y − 0.04) plus 0.004 to clear the deck asphalt (no z-fight).
      const pos = t.water ? center.clone().setY(BRIDGE_Y - 0.04 + 0.004) : center;
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

  /**
   * PR 6: draw everything that lives on the CELL grid (sim/cells.ts):
   *   - zoned free cells: a thin slab per cell, zone colour, darker = denser
   *   - each building (sim/lots.ts) — the zone design model stretched onto
   *     its template BODY rect, turned to face its road; construction sites
   *     rise inside a scaffold with a crane on the body's back corner
   *   - its parking cells (asphalt + PARKED CARS for the occupied ones),
   *     garages, truck bays, gardens, farm fields
   *   - public lots / garages, and the zoning + parking overlays.
   * A cell is 0.25 world units; the tile-sized models (lot slab, field soil)
   * are simply scaled by 0.25 so a cell reads as one "stall".
   */
  private addLots(sim: Simulation, seed: number): void {
    const P = this.pools;
    const w = sim.world, cells = w.cells;
    const Q = 0.25;
    const cellPos = (cx: number, cz: number, y = 0) => new THREE.Vector3((cx + 0.5) * Q, y, (cz + 0.5) * Q);
    const ov = this.overlay;
    // Parked cars drawn this rebuild; far zoom draws a simplified box only.
    let carsLeft = MAX_PARKED_DRAWN;
    const parkCar = (cx: number, cz: number, yaw: number, k: number) => {
      if (carsLeft-- <= 0) return;
      const pos = cellPos(cx, cz, 0.03);
      const col = PARKED_COLORS[Math.floor(hash2(cx, cz, seed + k) * PARKED_COLORS.length)];
      const m = this.place(pos, yaw + (hash2(cx, cz, seed + 5) - 0.5) * 0.12, 0.95);
      P.parkedCar.add(m, this.c.setHex(col));
      if (this.lod === 'high') P.carRoof.add(m, this.c.setHex(roofColor(cx * 7 + cz, col)));
    };
    const occColor = (used: number, cap: number) => this.c.setHex(0x3ddc84).lerp(TMP.setHex(0xff3b30), cap > 0 ? Math.min(1, used / cap) : 1);

    // ---- zoned free cells (and the zoning overlay for owned ones) ----
    for (const b of w.lots.buildings.values()) void b;
    const zoneTint = [0, 0, 0.82, 0.66, 0, 0.78, 0, 0.78, 0, 0];
    for (let c = 0; c < cells.zone.length; c++) {
      const code = cells.zone[c];
      if (!code) continue;
      const cx = c % CELL_GRID, cz = (c - cx) / CELL_GRID;
      const info = ZONE_CODES[code];
      const col = code === ZoneCode.Farm ? 0xc9b46a : code === ZoneCode.FoodPlant ? 0xd9a35c : ZONE_COLORS[info.zone!];
      if (cells.owner[c] === 0) {
        this.c.setHex(col);
        if (zoneTint[code]) this.c.multiplyScalar(zoneTint[code]);
        P.lot.add(this.place(cellPos(cx, cz), 0, Q, 1, Q), this.c);
      }
      if (ov === 'zoning') {
        this.c.setHex(col);
        if (zoneTint[code]) this.c.multiplyScalar(zoneTint[code]);
        P.overlay.add(this.place(cellPos(cx, cz, 0.09), 0, Q, 1, Q), this.c);
      }
    }

    // ---- public lots ----
    for (const l of w.parking.lots.values()) {
      if (l.size === 4) {
        const c0 = new THREE.Vector3((l.cx + 2) * Q, 0, (l.cz + 2) * Q);
        P.parkDeck.add(this.place(c0, 0));
        if (ov === 'parking') P.overlay.add(this.place(c0.clone().setY(0.62), 0, 1, 1, 1), occColor(l.parked, l.spaces));
        continue;
      }
      let k = 0;
      for (let z = l.cz; z < l.cz + 2; z++) for (let x = l.cx; x < l.cx + 2; x++, k++) {
        P.lot.add(this.place(cellPos(x, z), 0, Q, 1, Q), this.c.setHex(ASPHALT));
        P.stall.add(this.place(cellPos(x, z, 0.031), 0));
        if (k < l.parked) parkCar(x, z, Math.PI / 2, 300);
        if (ov === 'parking') P.overlay.add(this.place(cellPos(x, z, 0.09), 0, Q, 1, Q), occColor(l.parked, l.spaces));
      }
    }

    // ---- buildings ----
    for (const b of w.lots.buildings.values()) {
      const tpl = TPL[b.tpl];
      const [rx, rz] = FACES[b.face];
      const yaw = Math.atan2(rx, rz); // model front (+z) faces the road
      const st = sim.status(b.host);
      const dim = b.level > 0 && !st.operating && tpl.capacity[0] > 0 ? 0.55 : 1;
      // Occupied surface stalls: the first `parked` Parking cells (stable order).
      let parkedLeft = b.parked;
      const surface = surfaceSpaces(tpl);
      const shortRatio = this.sim!.world.parking.shortfall(b) > 0;
      for (const r of tpl.rects) {
        for (let v = r.v; v < r.v + r.d; v++) for (let u = r.u; u < r.u + r.w; u++) {
          const [cx, cz] = localToCell(b.ox, b.oz, b.face, u, v);
          const ci = cz * CELL_GRID + cx;
          if (cells.owner[ci] !== b.id) continue; // fallow / reassigned
          const role = cells.role[ci];
          if (role === CellRole.Parking) {
            // Driveways (homes) are lighter concrete; lots are asphalt with stall lines.
            const drive = tpl.zone === 'residential';
            P.lot.add(this.place(cellPos(cx, cz), 0, Q, 1, Q), this.c.setHex(drive ? 0xbdb8ae : ASPHALT));
            if (!drive) P.stall.add(this.place(cellPos(cx, cz, 0.031), yaw));
            if (parkedLeft > 0) { parkedLeft--; parkCar(cx, cz, yaw, b.id); }
            if (ov === 'parking') P.overlay.add(this.place(cellPos(cx, cz, 0.09), 0, Q, 1, Q), occColor(b.parked, surface));
          } else if (role === CellRole.Garage) {
            P.lot.add(this.place(cellPos(cx, cz), 0, Q, 1, Q), this.c.setHex(0xbdb8ae));
            P.garage.add(this.place(cellPos(cx, cz), yaw, 1.4, 1, 1.4), this.c.setScalar(dim));
          } else if (role === CellRole.Bay) {
            P.loadingDock.add(this.place(cellPos(cx, cz, 0.002), yaw, 0.8, 1, 1.1));
          } else if (role === CellRole.Garden) {
            P.lot.add(this.place(cellPos(cx, cz), 0, Q, 1, Q), this.c.setHex(0x7fbf5a));
            // PR 6 yard props, seeded per cell: shrubs, a shed, an occasional
            // pool (villas always get one), hedges along the street and a
            // picket fence along the back of every home's garden.
            const hsh = hash2(cx, cz, seed + 91);
            const pool = tpl.id === 'villa' ? u >= 3 && v >= 2 : tpl.zone === 'residential' && hsh > 0.93;
            if (pool) P.pool.add(this.place(cellPos(cx, cz, 0.002), 0, 1, 1, 1));
            else if (hsh < 0.4) P.bush.add(this.place(cellPos(cx, cz), hsh * 20, 0.45, 0.45));
            else if (hsh < 0.52) P.garage.add(this.place(cellPos(cx, cz), yaw, 0.8, 0.8, 0.8), this.c.setHex(0xa38b6d)); // garden shed
            if (tpl.zone === 'residential') {
              const f = frame(b.face);
              if (v === 0) P.hedge.add(this.place(cellPos(cx, cz), yaw));
              if (v === tpl.d - 1) P.fieldFence.add(this.place(cellPos(cx, cz), Math.atan2(-f.dx, -f.dz), Q, 1, Q), this.c.setHex(0xf4f1ea));
            }
          } else if (role === CellRole.Body && tpl.capacity[0] > 0) {
            P.lot.add(this.place(cellPos(cx, cz), 0, Q, 1, Q), this.c.setHex(0x9fcf72));
          }
        }
      }
      if (tpl.capacity[0] === 0) continue; // fillers: done
      // Body rect → world centre + size (in tiles).
      // PR 6: some designs have several bodies (twin towers, courtyard wings) — one model each.
      const bodies = tpl.rects.filter((r) => r.role === CellRole.Body);
      let centre = new THREE.Vector3(), bw = 0, bd = 0, sx = 1, sy = 1, sz = 1, mlv = 1, body = bodyRect(tpl);
      const farm = tpl.zone === 'industrial' && tpl.kind === 1;
      const food = tpl.zone === 'industrial' && tpl.kind === 2;
      for (const [bi, br] of bodies.entries()) {
      body = br;
      const [x0, z0, x1, z1] = rectAABB(b.ox, b.oz, b.face, body.u, body.v, body.w, body.d);
      centre = new THREE.Vector3(((x0 + x1) / 2) * Q, 0, ((z0 + z1) / 2) * Q);
      bw = body.w * Q; bd = body.d * Q; // along-road width, depth
      const lvIdx = Math.max(0, Math.min(tpl.maxLevel, Math.max(1, b.level + (b.construct > 0 ? 1 : 0))) - 1);
      mlv = tpl.model.level[lvIdx];
      if (farm || food) {
        sx = sz = Math.min(bw, bd) * 0.95; sy = sx;
      } else {
        const rb = roofBox(tpl.zone, mlv);
        sx = (bw * 0.9) / rb.w; sz = (bd * 0.9) / rb.d;
        if (tpl.zone === 'residential' && tpl.density === 0) sx = sz = Math.min(sx, sz); // houses keep their proportions
        sy = Math.min(1.25, Math.min(sx, sz)) * (tpl.model.tall ?? 1);
      }
      const progress = b.construct > 0 ? 1 - b.construct / CONSTRUCT_TICKS : 1;
      const look = pickLook(tpl.zone, b.ox + bi * 3, b.oz, seed, tpl.zone === 'residential' && mlv <= 3 ? RES_DESIGNS : undefined);
      const key = `${this.lod === 'low' ? 'lo:' : ''}${tpl.zone}.${look.design}.${mlv}`;
      const m = this.place(centre, yaw, sx, sy * (b.construct > 0 ? Math.max(0.06, progress) : 1), sz);
      const raw = b.construct > 0 ? 0.75 : 0;
      if (farm) P.farm.add(m, this.c.setScalar(dim));
      else if (food) P[`foodPlant${Math.floor(hash2(b.ox, b.oz, seed + 61) * 3)}`].add(m, this.c.setScalar(dim));
      else {
        P[`${key}.walls`].add(m, this.c.setHex(look.wall).lerp(TMP.setHex(0xcfc8bb), raw).multiplyScalar(dim));
        P[`${key}.accent`].add(m, this.c.setHex(look.accent).lerp(TMP.setHex(0xcfc8bb), raw).multiplyScalar(dim));
        P[`${key}.fixed`].add(m, this.c.setScalar(b.construct > 0 ? 0.85 : dim));
        // Night windows (PR 4 rules: per-building bedtime and bulb colour).
        const lit = hash2(b.ox, b.oz, seed + 404);
        const hr = this.hour < 0 ? 12 : this.hour;
        const late = hr >= 0 && hr < 6 ? hr + 24 : hr;
        const bedtime = tpl.zone === 'residential' ? 22 + lit * 7 : tpl.zone === 'commercial' ? 21 + lit * 2.5 : 30;
        const on = b.construct === 0 && st.operating && lit < 0.92 && late < bedtime;
        const hue = hash2(b.ox, b.oz, seed + 405);
        P[`${key}.lights`].add(m, on ? this.c.setHex(hue < 0.6 ? 0xffd890 : hue < 0.85 ? 0xfff4e0 : 0x9fc4ff).multiplyScalar(1.1 + lit * 0.9) : this.c.setScalar(0));
      }
      }
      const h = (farm || food ? 0.5 : roofBox(tpl.zone, mlv).h) * sy;
      if (ov === 'parking') {
        const need = this.sim!.world.parking.required(b), have = this.sim!.world.parking.available(b);
        P.overlay.add(this.place(centre.clone().setY(h + 0.05), 0, bw, 1, bd), this.c.setHex(have >= need ? 0x3ddc84 : 0xff3b30));
      }
      if (shortRatio && b.construct === 0) this.markers.push({ pos: centre.clone().setY(h + 0.3), color: new THREE.Color(0x4aa3ff), kind: 'gem', slot: 0 });
      if (b.construct > 0) {
        // Scaffold around the finished size, crane on the BODY's back-left corner
        // (local u = 0, v = far end), jib aimed at the body centre (PR 5 crane maths).
        P.scaffold.add(this.place(centre, yaw, bw * 0.95, Math.max(0.3, h) + 0.05, bd * 0.95));
        const [bcx, bcz] = localToCell(b.ox, b.oz, b.face, body.u, body.v + body.d - 1);
        const back = cellPos(bcx, bcz);
        const mastH = Math.max(0.3, h) + 0.45;
        P.craneMast.add(this.place(back, 0, 1, mastH, 1));
        const dx = centre.x - back.x, dz = centre.z - back.z;
        this.cranes.push({ pos: back.clone().setY(mastH + 0.05), phase: hash2(b.ox, b.oz, seed + 3) * 6.28, aim: Math.atan2(-dz, dx), reach: Math.max(0.3, Math.hypot(dx, dz)) / 0.55 });
      }
    }
    // ---- farm fields (cells with role Field / Fallow) ----
    const month = w.month;
    for (const b of w.lots.buildings.values()) {
      if (!b.fields && TPL[b.tpl].kind !== 1) continue;
      if (TPL[b.tpl].zone !== 'industrial' || TPL[b.tpl].kind !== 1) continue;
      for (let cz = Math.max(0, b.z0 - 20); cz < Math.min(CELL_GRID, b.z1 + 20); cz++)
        for (let cx = Math.max(0, b.x0 - 20); cx < Math.min(CELL_GRID, b.x1 + 20); cx++) {
          const ci = cz * CELL_GRID + cx;
          if (cells.owner[ci] !== b.id || (cells.role[ci] !== CellRole.Field && cells.role[ci] !== CellRole.Fallow)) continue;
          const pos = cellPos(cx, cz);
          const rowYaw = hash2(b.id, 3, seed) > 0.5 ? 0 : Math.PI / 2;
          P.fieldSoil.add(this.place(pos, rowYaw, Q, 1, Q));
          if (cells.role[ci] === CellRole.Fallow) continue;
          // Season colour (PR 5 palette), per-farm crop offset.
          const crop = hash2(b.id, 71, seed);
          const k = (((month - 1 + crop * 1.5) % 12) + 12) % 12;
          const cols = [0x8a7a58, 0x9bbf5a, 0x6fb041, 0x4f9a35, 0x5f9c34, 0xb9b94a, 0xd9b44a, 0xd29a3c, 0xa98a54, 0x8a7a58, 0x8a7a58, 0x8a7a58];
          this.c.setHex(cols[Math.floor(k)]).lerp(TMP.setHex(cols[(Math.floor(k) + 1) % 12]), k % 1);
          P.fieldCrops.add(this.place(pos, rowYaw, Q, 0.7 + crop * 0.6, Q), this.c);
        }
    }
  }

  /**
   * PR 4: place every vehicle and colour every traffic light for this frame.
   * Vehicles change every frame, so these pools are rebuilt here rather than
   * in rebuild() (a few hundred matrix writes — cheap).
   */
  private animateTraffic(): void {
    const sim = this.sim;
    const P = this.pools;
    for (const k of ['car', 'truckCab', 'truckBox', 'lightHead', 'signalGlow', 'wheel', 'tailLight', 'headGlow', 'carRoof', 'crewLoad']) P[k].begin();
    if (sim) {
      const tiles = sim.world.tiles;
      const pos = new THREE.Vector3();
      // PR 5: each vehicle gets a full pose — Bézier position + heading,
      // body roll in turns and pitch under braking/acceleration — composed
      // as yaw · pitch(about local z) · roll(about local x). Wheels spin by
      // distance travelled / radius. Tail lights: dim red at night, bright
      // red when braking (any time), off otherwise. Headlights add a soft
      // warm glow in front of the car at night.
      const night = this.signalGlowMat.opacity > 0.05;
      const pose = { yaw: 0, roll: 0, pitch: 0 };
      const e = new THREE.Euler(0, 0, 0, 'YZX');
      const wq = new THREE.Quaternion(), tmpQ = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1), wp = new THREE.Vector3();
      for (const v of sim.traffic.vehicles) {
        if (!tiles[v.path[v.seg]] || !tiles[v.path[v.seg + 1]]) continue;
        vehiclePose(v, tiles, pos, pose);
        e.set(pose.roll, pose.yaw, pose.pitch);
        this.q.setFromEuler(e);
        const m = this.m.compose(pos, this.q, one);
        if (v.kind === 'car') {
          P.car.add(m, this.c.setHex(v.color));
          P.carRoof.add(m, this.c.setHex(roofColor(v.id, v.color))); // PR 5 two-tone roofs
        }
        else {
          P.truckCab.add(m);
          P.truckBox.add(m, this.c.setHex(v.color));
          // PR 5: construction trucks (orange) carry bricks + pipes on top.
          if (v.purpose.startsWith(CREW_PURPOSE)) P.crewLoad.add(m);
        }
        // Wheels: distance-based spin, stored per vehicle on the render side.
        const spin = ((this.wheelSpin.get(v.id) ?? 0) + (v.v * this.frameDt) / WHEELS.radius) % (Math.PI * 2);
        this.wheelSpin.set(v.id, spin);
        tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -spin);
        for (const [wx, wz] of v.kind === 'car' ? WHEELS.car : WHEELS.truck) {
          wp.set(wx, WHEELS.radius, wz).applyQuaternion(this.q).add(pos);
          wq.copy(this.q).multiply(tmpQ);
          P.wheel.add(this.m.compose(wp, wq, one));
        }
        if (v.kind === 'car') {
          const braking = v.acc < -0.4 || (v.v < 0.05 && v.waitGreen >= 0 && v.acc <= 0 && v.t > 0.5);
          if (braking || night) P.tailLight.add(this.m.compose(pos, this.q, one), this.c.setRGB(braking ? 1 : 0.55, braking ? 0.08 : 0.02, braking ? 0.05 : 0.02));
          if (night) {
            wp.set(0.2, 0.03, 0).applyQuaternion(this.q).add(pos);
            P.headGlow.add(this.m.compose(wp, this.cameraQuat, one), this.c.setRGB(1, 0.9, 0.65));
          }
        }
      }
      if (this.wheelSpin.size > 4 * sim.traffic.vehicles.length + 64) {
        const live = new Set(sim.traffic.vehicles.map((v) => v.id));
        for (const k of this.wheelSpin.keys()) if (!live.has(k)) this.wheelSpin.delete(k);
      }
      // PR 5: every pole has two heads × three lamps. Only the active lamp
      // of each head is lit (full colour; the material is unlit so it reads
      // as glowing, and at night a soft coloured halo is added on top);
      // the other two lamps are drawn very dark, like real unlit lenses.
      // Each pole's single head shows its own approach's phase (axis).
      const glowOn = this.pools.signalGlow.mesh.visible;
      for (const { i, pos: p, yaw, axis } of this.junctions) {
        const st = lightState(i, sim.world.clock, sim.traffic.signals);
        for (const lamp of SIGNAL_LAMPS) {
          const active = st.green === axis ? (st.amber ? 1 : 2) : 0;
          const lit = lamp.slot === active;
          const wp = lamp.pos.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(p);
          this.c.setHex(SIGNAL_COLORS[lamp.slot]);
          if (!lit) this.c.multiplyScalar(0.12);
          P.lightHead.add(this.place(wp), this.c);
          if (lit && glowOn) P.signalGlow.add(this.m.compose(wp, this.cameraQuat, this.s.set(1, 1, 1)), this.c);
        }
      }
    }
    for (const k of ['car', 'truckCab', 'truckBox', 'lightHead', 'signalGlow', 'wheel', 'tailLight', 'headGlow', 'carRoof', 'crewLoad']) P[k].end();
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
  /**
   * PR 5: if this land road tile touches a BRIDGE (water road tile), the yaw
   * that points the ramp model's +x at it; null otherwise. Prefers E, N, W, S.
   */
  private bridgeSide(x: number, z: number, has: (x: number, z: number, f: (t: Tile) => boolean) => boolean): number | null {
    const b = (q: Tile) => q.road && q.water;
    if (has(x + 1, z, b)) return 0;
    if (has(x, z - 1, b)) return Math.PI / 2;
    if (has(x - 1, z, b)) return Math.PI;
    if (has(x, z + 1, b)) return (3 * Math.PI) / 2;
    return null;
  }

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
    const nac = this.pools.nacelle;
    nac.begin();
    const yawQ = new THREE.Quaternion(), hub = new THREE.Vector3();
    for (const [k, { i, top }] of this.turbines.entries()) {
      // PR 5 YAW: the rotor faces INTO the wind. The rotor sits on the
      // nacelle's local +z, and rotateY(a) sends +z to (sin a, cos a) — the
      // same convention as world.windDir (the direction the wind comes
      // FROM), so the target yaw is simply windDir. Each turbine turns at
      // most ~0.6–1°/s real time (per-turbine rate from a hash, so they
      // don't move in perfect unison) along the shortest way round.
      const rate = (0.6 + hash2(i, 7, 99) * 0.4) * (Math.PI / 180) * this.frameDt;
      let cur = this.turbineYaw.get(i);
      if (cur === undefined) cur = this.windDir + (hash2(i, 8, 99) - 0.5) * 0.3; // start near the wind
      const d = Math.atan2(Math.sin(this.windDir - cur), Math.cos(this.windDir - cur));
      cur += Math.max(-rate, Math.min(rate, d));
      this.turbineYaw.set(i, cur);
      yawQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, cur);
      nac.add(this.m.compose(top, yawQ, this.s.set(1, 1, 1)));
      // Blades: spin about the rotor axis (local z) after yawing; each turbine gets its own phase.
      spin.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.bladeAngle + k * 1.7);
      hub.set(0, 0, 0.12).applyQuaternion(yawQ).add(top);
      blades.add(this.m.compose(hub, yawQ.clone().multiply(spin), this.s.set(1, 1, 1)));
    }
    blades.end();
    nac.end();

    this.animateTraffic();
    // Lamp halos face the camera (billboards), like the warning icons.
    const halo = this.pools.lampHalo;
    halo.begin();
    if (halo.mesh.visible) for (const p of this.lamps) halo.add(this.m.compose(p, this.cameraQuat, this.s.set(1, 1, 1)));
    halo.end();
    // PR 4 smoke: each stack emits SMOKE_PUFFS puffs on a loop. A puff's age
    // a (0..1) comes from time + its slot, so they're evenly staggered; it
    // rises, drifts downwind (+x, scaled by the wind) and grows/lightens as it ages.
    const smoke = this.pools.smoke;
    smoke.begin();
    const wind = this.sim?.world.wind ?? 0.5;
    this.stacks.forEach((top, k) => {
      for (let p = 0; p < 6; p++) {
        const a = (time * 0.22 + p / 6 + k * 0.37) % 1;
        const pos = top.clone().add(new THREE.Vector3(a * (0.15 + wind * 0.6), a * 0.9, a * 0.1));
        const r = 0.05 + a * 0.16;
        const g = 0.55 + a * 0.4;
        this.q.identity();
        smoke.add(this.m.compose(pos, this.q, this.s.set(r, r, r)), this.c.setRGB(g, g, g));
      }
    });
    smoke.end();
    // Crane jibs (PR 5 fix): each points at its own construction frame and
    // only sways a little (±0.15 rad ≈ the hook stays inside the scaffold).
    // The old ±1.4 rad swing from a random phase left hooks over neighbours.
    const jib = this.pools.craneJib;
    jib.begin();
    for (const { pos, phase, aim, reach } of this.cranes) {
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, aim + Math.sin(time * 0.35 + phase) * 0.15);
      jib.add(this.m.compose(pos, this.q, this.s.set(reach, 1, 1)));
    }
    jib.end();

    const mk = this.pools.marker;
    const ip = this.pools.iconPower, iw = this.pools.iconWater, ic = this.pools.iconCrew;
    mk.begin(); ip.begin(); iw.begin(); ic.begin();
    // Camera's "right" direction, to put paired icons side by side on screen.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.cameraQuat);
    for (const { pos, color, kind, slot } of this.markers) {
      const p = pos.clone().addScaledVector(right, slot * 0.2);
      p.y += Math.sin(time * 3 + pos.x) * 0.05;
      if (kind === 'gem') {
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, time * 1.5);
        mk.add(this.m.compose(p, this.q, this.s.set(1, 1.4, 1)), color);
      } else {
        (kind === 'power' ? ip : kind === 'crew' ? ic : iw).add(this.m.compose(p, this.cameraQuat, this.s.set(1, 1, 1)));
      }
    }
    mk.end(); ip.end(); iw.end(); ic.end();
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
