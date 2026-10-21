/**
 * vr/vrMode.ts — WebXR "tabletop" mode for headsets such as the Meta Quest 3.
 *
 * The city stays a small diorama on a virtual table in front of you. Nothing
 * in the sim or the renderer changes: we draw the same scene with a headset
 * camera that lives inside a scaled "rig" group (the classic VR dolly). The
 * rig is scaled by S = 20 / zoom, so one metre in the room is S tiles of city,
 * and it is placed so the camera's look-at point (cam.target) sits on the table.
 *
 * Controls (Quest Touch controllers)
 *   Right laser          point at the ground; trigger = the current tool (drag to
 *                        draw roads / zones / bulldoze boxes), exactly like the mouse.
 *   Left hand panel      tool tabs, speed, undo/redo, view buttons, status and info.
 *                        Point the right laser at it and pull the trigger.
 *                        Left Y / X button hides or shows it.
 *   Left stick           pan the map.
 *   Right stick          left/right = turn the table, up/down = zoom.
 *   Grip (either hand)   hold and move to grab the map and drag it.
 *   Right A button       pause / resume.   Right B button: Inspect tool.
 * Hand tracking also works: pinch to click, and the panel's View tab has
 * zoom / turn / pan buttons because there are no sticks.
 *
 * Needs a secure context (https or localhost) and a browser with WebXR.
 */
import * as THREE from 'three';
import { GRID_SIZE, ToolId } from '../sim/types';
import { inBounds } from '../sim/grid';
import { pointer, InputCallbacks } from '../ui/input';
import { IsoCamera, MAX_ZOOM, minZoom } from '../render/camera';
import { TOOL_GROUPS, toolDef } from '../ui/tools';

export interface VrHud {
  line: string;
  power: [number, number];
  water: [number, number];
  /** Residential, commercial, industrial demand, -1..1. */
  demand: [number, number, number];
  outages: number;
}

/** What the VR layer needs from the game (main.ts wires these). */
export interface VrHooks {
  setTool(id: ToolId): void;
  tool(): ToolId;
  setSpeed(s: number): void;
  speed(): number;
  /** The top-bar numbers shown on the panel. */
  hud(): VrHud;
  /** Text of the inspect panel (empty when none). */
  info(): string;
  /** A hotkey as input.ts delivers it ('ctrl+z', ' ' ...). */
  key(k: string): void;
  onEnter(): void;
  onExit(): void;
}

/** Minimal WebXR shapes (so the build doesn't depend on @types/webxr being present). */
interface VrSource { handedness: string; gamepad?: { axes: readonly number[]; buttons: ReadonlyArray<{ pressed: boolean }> } | null }
interface VrSession { end(): Promise<void>; addEventListener(type: string, fn: () => void, opts?: { once?: boolean }): void }
interface VrSystem {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, init: { optionalFeatures: string[] }): Promise<VrSession>;
}

const TABLE_H = 0.85; // metres: table surface above the floor
const TABLE_D = 0.75; // metres: map centre in front of you
const SCALE_K = 20; // tiles per metre at zoom 1

interface Btn {
  id: string;
  x: number; y: number; w: number; h: number;
  label: string;
  active?: boolean;
  hint?: string;
  act: () => void;
}

type Tab = 'build' | 'roads' | 'utilities' | 'industry' | 'services' | 'view';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'build', label: 'Build' }, { id: 'roads', label: 'Roads' }, { id: 'utilities', label: 'Power' },
  { id: 'industry', label: 'Industry' }, { id: 'services', label: 'Services' }, { id: 'view', label: 'View' },
];
const BUILD_TOOLS: ToolId[] = ['inspect', 'residential', 'commercial', 'industrial', 'park', 'bulldoze'];

const CW = 768, CH = 560, HDR = 100;

interface Pad {
  object: THREE.Group;
  source: VrSource | null;
  hand: string;
  trigger: boolean;
  grab: boolean;
  grabAt: THREE.Vector3;
  laser: THREE.Mesh;
  prevButtons: boolean[];
}

export class VrMode {
  active = false;
  readonly rig = new THREE.Group();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.02, 200);
  private pads: Pad[] = [];
  private yaw = 0;
  private supported = false;
  private session: VrSession | null = null;
  // Panel
  private panel!: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private ctx2d: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private tab: Tab = 'build';
  private btns: Btn[] = [];
  private hoverBtn = '';
  private lastPanelKey = '';
  private toastText = '';
  private toastUntil = 0;
  private panelShown = true;
  private marker: THREE.Mesh;
  private cursor: THREE.Mesh;
  // Pointer state
  private dragPad: Pad | null = null;
  private lastTile = '';
  private ray = new THREE.Raycaster();
  private tmpO = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private savedShadow: [number, number] | null = null;
  readonly headQuat = new THREE.Quaternion();

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private cam: IsoCamera,
    private sun: THREE.DirectionalLight,
    private cb: Pick<InputCallbacks, 'hover' | 'dragStart' | 'dragMove' | 'dragEnd' | 'dragCancel'>,
    private hooks: VrHooks,
  ) {
    this.rig.add(this.camera);
    scene.add(this.rig);
    this.canvas.width = CW; this.canvas.height = CH;
    this.ctx2d = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    // Ground marker under the pointer (a flat ring; sized each frame in tiles).
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    scene.add(this.marker);
    this.cursor = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    this.cursor.renderOrder = 12;
    this.cursor.visible = false;
    scene.add(this.cursor);
    for (let i = 0; i < 2; i++) this.addPad(i);
    this.makePanel();
    const xr = (navigator as unknown as { xr?: VrSystem }).xr;
    if (xr && window.isSecureContext) {
      xr.isSessionSupported('immersive-vr').then((ok) => { this.supported = ok; }, () => { this.supported = false; });
    }
  }

  get available(): boolean { return this.supported; }

  /** Show a short message on the panel (mirrors the HUD toast). */
  toast(msg: string): void {
    this.toastText = msg;
    this.toastUntil = performance.now() + 2500;
  }

  async enter(): Promise<void> {
    if (this.active || !this.supported) return;
    const xr = (navigator as unknown as { xr: VrSystem }).xr;
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    this.session = session;
    this.active = true; // so the very first XR frame already uses the rig camera
    const x = this.renderer.xr;
    x.enabled = true;
    x.setReferenceSpaceType('local-floor');
    x.setFramebufferScaleFactor(1.0);
    x.setFoveation(1);
    session.addEventListener('end', () => this.onEnded(), { once: true });
    try { await x.setSession(session as any); } catch (e) { this.onEnded(); throw e; }
    // The 8k shadow map is too heavy for a headset: use a 2k one while in VR.
    this.savedShadow = [this.sun.shadow.mapSize.x, this.sun.shadow.mapSize.y];
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as unknown as { map: unknown }).map = null;
    this.cam.resize(1, 1); // square view box for chunk culling
    this.hooks.onEnter();
    this.toast('VR: right trigger uses the tool · left hand panel for tools');
  }

  exit(): void { this.session?.end().catch(() => {}); }

  private onEnded(): void {
    this.active = false;
    this.session = null;
    this.renderer.xr.enabled = false;
    this.marker.visible = false;
    this.cursor.visible = false;
    for (const p of this.pads) p.laser.visible = false;
    if (this.dragPad) { this.cb.dragCancel(); this.dragPad = null; }
    if (this.savedShadow) {
      this.sun.shadow.mapSize.set(this.savedShadow[0], this.savedShadow[1]);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as unknown as { map: unknown }).map = null;
      this.savedShadow = null;
    }
    this.hooks.onExit();
  }

  // ---------------------------------------------------------------- controllers
  private addPad(i: number): void {
    const object = this.renderer.xr.getController(i);
    this.rig.add(object);
    // A small controller stand-in and a thin laser.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.11), new THREE.MeshBasicMaterial({ color: 0x2b3a4a }));
    body.position.z = 0.04;
    object.add(body);
    const laser = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 1).translate(0, 0, -0.5), new THREE.MeshBasicMaterial({ color: 0x7fd1ff, depthTest: false }));
    laser.renderOrder = 9;
    laser.visible = false;
    object.add(laser);
    const pad: Pad = { object, source: null, hand: '', trigger: false, grab: false, grabAt: new THREE.Vector3(), laser, prevButtons: [] };
    this.pads.push(pad);
    const ev: any = object;
    ev.addEventListener('connected', (e: { data: VrSource }) => { pad.source = e.data; pad.hand = e.data.handedness; this.assignPanel(); });
    ev.addEventListener('disconnected', () => { pad.source = null; pad.hand = ''; pad.laser.visible = false; this.assignPanel(); });
    ev.addEventListener('selectstart', () => this.onTrigger(pad, true));
    ev.addEventListener('selectend', () => this.onTrigger(pad, false));
    ev.addEventListener('squeezestart', () => { pad.grab = true; pad.object.getWorldPosition(pad.grabAt); });
    ev.addEventListener('squeezeend', () => { pad.grab = false; });
  }

  /** The pointing hand: right if connected, else whichever is. */
  private primary(): Pad | null {
    return this.pads.find((p) => p.source && p.hand === 'right') ?? this.pads.find((p) => p.source) ?? null;
  }
  private secondary(): Pad | null {
    const pr = this.primary();
    return this.pads.find((p) => p.source && p !== pr) ?? null;
  }

  private assignPanel(): void {
    const host = this.secondary() ?? this.primary();
    if (!host) return;
    host.object.add(this.panel);
    // Tilt toward the face. On a lone controller the panel hangs further up.
    this.panel.position.set(0, 0.075, -0.045);
    this.panel.rotation.set(-Math.PI * 0.36, 0, 0);
  }

  private makePanel(): void {
    const W = 0.3;
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(W, W * CH / CW),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.panel.renderOrder = 8;
  }

  // ---------------------------------------------------------------- input
  private rayOf(p: Pad): THREE.Raycaster {
    p.object.getWorldPosition(this.tmpO);
    p.object.getWorldQuaternion(this.tmpQ);
    this.tmpD.set(0, 0, -1).applyQuaternion(this.tmpQ);
    this.ray.set(this.tmpO, this.tmpD);
    return this.ray;
  }

  /** Where a pad's laser meets the panel (button under it) or the ground plane. */
  private aim(p: Pad): { btn: Btn | null; panelDist: number; panelPt: THREE.Vector3 | null; ground: THREE.Vector3 | null } {
    const r = this.rayOf(p);
    let btn: Btn | null = null, panelDist = Infinity, panelPt: THREE.Vector3 | null = null;
    if (this.panelShown && this.panel.parent && this.panel.parent !== p.object) {
      const hit = r.intersectObject(this.panel, false)[0];
      if (hit && hit.uv) {
        panelDist = hit.distance;
        panelPt = hit.point.clone();
        const cx = hit.uv.x * CW, cy = (1 - hit.uv.y) * CH;
        btn = this.btns.find((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) ?? null;
      }
    }
    let ground: THREE.Vector3 | null = null;
    const o = r.ray.origin, d = r.ray.direction;
    if (d.y < -1e-4) {
      const t = -o.y / d.y;
      if (t > 0 && t < panelDist) ground = new THREE.Vector3(o.x + d.x * t, 0, o.z + d.z * t);
    }
    return { btn, panelDist, panelPt, ground };
  }

  private onTrigger(p: Pad, down: boolean): void {
    p.trigger = down;
    if (!this.active) return;
    if (down) {
      const a = this.aim(p);
      if (a.btn) { a.btn.act(); this.haptic(p); this.lastPanelKey = ''; return; }
      if (a.ground) {
        const t = this.tile(a.ground);
        if (t) { this.dragPad = p; this.cb.dragStart(t); }
      }
    } else if (this.dragPad === p) {
      const a = this.aim(p);
      const t = a.ground ? this.tile(a.ground) : null;
      this.dragPad = null;
      this.cb.dragEnd(t);
    }
  }

  private tile(g: THREE.Vector3): [number, number] | null {
    pointer.x = g.x; pointer.z = g.z;
    const x = Math.floor(g.x), z = Math.floor(g.z);
    return inBounds(x, z) ? [x, z] : null;
  }

  private haptic(p: Pad): void {
    try { (p.source?.gamepad as any)?.hapticActuators?.[0]?.pulse(0.35, 25); } catch { /* optional */ }
  }

  // ---------------------------------------------------------------- per frame
  /** Call once per frame from the game loop (before rendering). */
  update(dt: number): void {
    if (!this.active) return;
    const cam = this.cam;
    const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    const S = SCALE_K / cam.zoom;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.rig.updateMatrixWorld(true);

    // Sticks / buttons.
    for (const p of this.pads) {
      const gp = p.source?.gamepad;
      if (!gp) continue;
      const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] ?? 0, gp.axes[1] ?? 0];
      const sx = dead(ax[0]), sy = dead(ax[1]);
      if (p.hand === 'left') {
        if (sx || sy) {
          const v = 0.7 * S * dt;
          cam.target.addScaledVector(right, sx * v).addScaledVector(fwd, -sy * v);
        }
      } else {
        if (sx) this.yaw -= sx * 1.4 * dt;
        if (sy) cam.zoomBy(Math.exp(-sy * 1.3 * dt));
      }
      const pressed = gp.buttons.map((b) => b.pressed);
      const edge = (i: number) => !!pressed[i] && !p.prevButtons[i];
      if (p.hand === 'left' && (edge(4) || edge(5))) this.panelShown = !this.panelShown;
      if (p.hand === 'right') {
        if (edge(4)) { this.hooks.key(' '); this.lastPanelKey = ''; }
        if (edge(5)) { this.hooks.setTool('inspect'); this.lastPanelKey = ''; }
      }
      p.prevButtons = pressed;
    }
    // Grab-and-drag the map.
    for (const p of this.pads) {
      if (!p.grab) continue;
      const cur = new THREE.Vector3();
      p.object.getWorldPosition(cur);
      cam.target.x += p.grabAt.x - cur.x;
      cam.target.z += p.grabAt.z - cur.z;
      p.grabAt.copy(cur);
    }
    cam.target.x = THREE.MathUtils.clamp(cam.target.x, 0, GRID_SIZE);
    cam.target.z = THREE.MathUtils.clamp(cam.target.z, 0, GRID_SIZE);

    // Rig: scale, turn, and place so cam.target lies on the table.
    const S2 = SCALE_K / cam.zoom;
    this.rig.scale.setScalar(S2);
    this.rig.rotation.set(0, this.yaw, 0);
    const off = new THREE.Vector3(0, TABLE_H, -TABLE_D).multiplyScalar(S2).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.rig.position.copy(cam.target).sub(off);
    this.rig.updateMatrixWorld(true);
    this.camera.getWorldQuaternion(this.headQuat);

    // Lasers / hover.
    const prim = this.primary();
    let hoverId = '';
    let markerAt: THREE.Vector3 | null = null;
    for (const p of this.pads) p.laser.visible = false;
    this.cursor.visible = false;
    if (prim) {
      const a = this.aim(prim);
      prim.laser.visible = true;
      const reach = a.panelPt ? a.panelDist : a.ground ? a.ground.distanceTo(this.rayOf(prim).ray.origin) : 3 * S2;
      prim.laser.scale.z = reach / S2; // laser is parented under the scaled rig
      if (a.btn) hoverId = a.btn.id;
      // A cursor dot sits on the panel where the laser lands (the laser stops there).
      if (a.panelPt) {
        this.cursor.visible = true;
        this.cursor.position.copy(a.panelPt).addScaledVector(this.tmpD.set(0, 0, 1).applyQuaternion(this.panel.getWorldQuaternion(this.tmpQ)), 0.002 * S2);
        this.cursor.scale.setScalar(0.006 * S2);
      } else this.cursor.visible = false;
      const g = a.ground;
      if (g && !a.btn) {
        markerAt = g;
        const t = this.tile(g);
        const key = t ? `${t[0]},${t[1]}` : '';
        if (this.dragPad === prim) { if (t && key !== this.lastTile) this.cb.dragMove(t); }
        else if (key !== this.lastTile) this.cb.hover(t, -1, -1);
        this.lastTile = key;
      } else if (this.lastTile !== 'off') {
        if (!this.dragPad) this.cb.hover(null, -1, -1);
        this.lastTile = 'off';
      }
    }
    if (markerAt) {
      this.marker.visible = true;
      this.marker.position.set(markerAt.x, 0.06, markerAt.z);
      this.marker.scale.setScalar(Math.max(0.6, S2 * 0.02));
    } else this.marker.visible = false;
    if (hoverId !== this.hoverBtn) { this.hoverBtn = hoverId; this.lastPanelKey = ''; }

    this.drawPanel();
  }

  // ---------------------------------------------------------------- panel
  private layout(): Btn[] {
    const h = this.hooks, out: Btn[] = [];
    const cur = h.tool();
    // Tabs.
    const tw = (CW - 24) / TABS.length;
    TABS.forEach((t, i) => out.push({ id: 'tab:' + t.id, x: 12 + i * tw, y: HDR + 8, w: tw - 6, h: 52, label: t.label, active: this.tab === t.id, act: () => { this.tab = t.id; } }));
    // Tool grid / view buttons.
    const cols = 4, gw = (CW - 24) / cols, gh = 80, gy = HDR + 72;
    const add = (i: number, id: string, label: string, act: () => void, active = false, hint = '') =>
      out.push({ id, x: 12 + (i % cols) * gw, y: gy + Math.floor(i / cols) * gh, w: gw - 6, h: gh - 6, label, active, hint, act });
    if (this.tab === 'view') {
      const nudge = (right: number, fwd: number) => () => {
        const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        const s = (SCALE_K / this.cam.zoom) * 0.35;
        this.cam.target.addScaledVector(r, right * s).addScaledVector(f, fwd * s);
      };
      add(0, 'v:zin', '🔍 Zoom in', () => this.cam.zoomBy(1.3));
      add(1, 'v:zout', '🔎 Zoom out', () => this.cam.zoomBy(1 / 1.3));
      add(2, 'v:rl', '⟲ Turn left', () => { this.yaw += Math.PI / 4; });
      add(3, 'v:rr', '⟳ Turn right', () => { this.yaw -= Math.PI / 4; });
      add(4, 'v:pn', '⬆ Pan ahead', nudge(0, 1));
      add(5, 'v:ps', '⬇ Pan back', nudge(0, -1));
      add(6, 'v:pl', '⬅ Pan left', nudge(-1, 0));
      add(7, 'v:pr', '➡ Pan right', nudge(1, 0));
      add(8, 'v:fit', '🗺 Whole map', () => { this.cam.zoom = 1; this.cam.zoomBy(minZoom() / this.cam.zoom * 1.0001); this.cam.target.set(GRID_SIZE / 2, 0, GRID_SIZE / 2); });
      add(9, 'v:close', '🏠 Close up', () => { this.cam.zoom = 1; this.cam.zoomBy(Math.min(MAX_ZOOM, 2.5)); });
    } else {
      const ids: ToolId[] = this.tab === 'build' ? BUILD_TOOLS : (TOOL_GROUPS.find((g) => g.id === this.tab)?.tools ?? []);
      ids.forEach((id, i) => {
        const d = toolDef(id);
        add(i, 't:' + id, `${d.icon} ${d.label.replace(/ \(.*\)$/, '')}`, () => h.setTool(id), cur === id, d.hint);
      });
    }
    // Bottom row: speed / history / exit.
    const sp = h.speed();
    const row: Array<[string, string, () => void, boolean]> = [
      ['b:pause', sp === 0 ? '▶ Play' : '⏸ Pause', () => h.key(' '), sp === 0],
      ['b:1', '1×', () => h.setSpeed(1), sp === 1], ['b:2', '2×', () => h.setSpeed(2), sp === 2], ['b:3', '3×', () => h.setSpeed(3), sp === 3],
      ['b:undo', '↶ Undo', () => h.key('ctrl+z'), false], ['b:redo', '↷ Redo', () => h.key('ctrl+y'), false],
      ['b:exit', '✕ Exit VR', () => this.exit(), false],
    ];
    const bw = (CW - 24) / row.length;
    row.forEach(([id, label, act, active], i) => out.push({ id, x: 12 + i * bw, y: HDR + 322, w: bw - 6, h: 52, label, active, act }));
    return out;
  }

  private drawPanel(): void {
    const now = performance.now();
    const toast = now < this.toastUntil ? this.toastText : '';
    const hud = this.hooks.hud();
    const info = this.hooks.info();
    const btns = this.layout();
    this.btns = btns;
    const hov = btns.find((b) => b.id === this.hoverBtn);
    const key = [this.panelShown, JSON.stringify(hud), toast ? toast : info.slice(0, 120), this.hoverBtn, this.tab, this.hooks.tool(), this.hooks.speed()].join('|');
    this.panel.visible = this.panelShown;
    if (key === this.lastPanelKey) return;
    this.lastPanelKey = key;
    const c = this.ctx2d;
    c.clearRect(0, 0, CW, CH);
    const round = (x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
    c.fillStyle = 'rgba(14,22,32,0.94)'; round(0, 0, CW, CH, 28); c.fill();
    c.strokeStyle = 'rgba(127,209,255,0.5)'; c.lineWidth = 3; round(2, 2, CW - 4, CH - 4, 26); c.stroke();
    c.textBaseline = 'middle';
    c.fillStyle = '#e8f3ff'; c.font = '600 30px system-ui, sans-serif'; c.textAlign = 'left';
    c.fillText(hud.line.slice(0, 44), 16, 30);
    // Power and water meters.
    const meter = (x: number, icon: string, [used, cap]: [number, number]) => {
      const pct = cap > 0 ? Math.min(1, used / cap) : used > 0 ? 1 : 0;
      c.font = '26px system-ui, sans-serif'; c.textAlign = 'left'; c.fillStyle = '#fff'; c.fillText(icon, x, 70);
      c.fillStyle = '#2b3b4d'; round(x + 40, 58, 150, 22, 8); c.fill();
      c.fillStyle = used > cap ? '#ff6b5e' : pct > 0.85 ? '#f2c94c' : '#59d18a'; round(x + 40, 58, Math.max(6, 150 * pct), 22, 8); c.fill();
      c.fillStyle = '#cfe3f5'; c.font = '20px system-ui, sans-serif'; c.fillText(`${Math.round(used)}/${Math.round(cap)}`, x + 198, 70);
    };
    meter(16, '⚡', hud.power); meter(300, '💧', hud.water);
    if (hud.outages) { c.fillStyle = '#ff7a6e'; c.font = '600 22px system-ui, sans-serif'; c.textAlign = 'right'; c.fillText(`⚠ ${hud.outages}`, 548, 30); }
    // R / C / I demand bars: up = wanted, down (dim) = not wanted.
    const cols: Array<[string, string]> = [['R', '#6ad37a'], ['C', '#5aa8f0'], ['I', '#f2c94c']];
    cols.forEach(([l, col], k) => {
      const x = 576 + k * 62, mid = 40, v = Math.max(-1, Math.min(1, hud.demand[k]));
      c.fillStyle = '#2b3b4d'; round(x, 8, 34, 64, 8); c.fill();
      c.globalAlpha = v >= 0 ? 1 : 0.45; c.fillStyle = col;
      if (v >= 0) c.fillRect(x + 2, mid - v * 30, 30, v * 30 + 0.5); else c.fillRect(x + 2, mid, 30, -v * 30);
      c.globalAlpha = 1; c.fillStyle = '#fff'; c.fillRect(x, mid - 1, 34, 2);
      c.fillStyle = col; c.font = '600 20px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(l, x + 17, 88);
    });
    c.textAlign = 'left';
    for (const b of btns) {
      const hot = b.id === this.hoverBtn;
      c.fillStyle = b.active ? '#1f9d8f' : hot ? '#3b556e' : '#243447';
      round(b.x, b.y, b.w, b.h, 14); c.fill();
      if (hot) { c.strokeStyle = '#7fd1ff'; c.lineWidth = 4; round(b.x, b.y, b.w, b.h, 14); c.stroke(); }
      c.fillStyle = '#fff'; c.textAlign = 'center';
      let size = b.id.startsWith('tab:') || b.id.startsWith('b:') ? 26 : 25;
      c.font = `600 ${size}px system-ui, sans-serif`;
      while (c.measureText(b.label).width > b.w - 14 && size > 14) { size -= 1; c.font = `600 ${size}px system-ui, sans-serif`; }
      c.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    }
    // Info area: toast > hovered tool hint > inspect text.
    const text = toast || hov?.hint || info.replace(/\s+/g, ' ').trim();
    c.fillStyle = toast ? '#ffe28a' : '#cfe3f5'; c.textAlign = 'left'; c.font = '24px system-ui, sans-serif';
    const words = text.split(' ');
    let line = '', y = HDR + 400, lines = 0;
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (c.measureText(t).width > CW - 32) {
        c.fillText(line, 16, y); y += 28; line = w; if (++lines >= 2) { line = ''; break; }
      } else line = t;
    }
    if (line && lines < 2) c.fillText(line, 16, y);
    this.tex.needsUpdate = true;
  }
}
