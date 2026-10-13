/**
 * ui/input.ts — mouse, touch and keyboard handling.
 *
 * Controls
 *   Mouse: left-drag = use tool, right/middle-drag = pan, wheel = zoom.
 *   Touch: one finger = use tool (with Inspect selected, one finger pans),
 *          two fingers = pan + pinch-zoom.
 *   Keys:  WASD / arrows = pan, Q / E = rotate 90 degrees, + / - = zoom,
 *          tool hotkeys are listed in tools.ts, Space = pause.
 *
 * PICKING (which tile is under the cursor?)
 * We cast a ray from the camera through the mouse position (THREE.Raycaster)
 * and intersect it with the flat ground plane at y = 0. The hit point's
 * world x/z, floored, are the tile coordinates (see scene.ts).
 */
import * as THREE from 'three';
import { inBounds } from '../sim/grid';
import { IsoCamera } from '../render/camera';

export interface InputCallbacks {
  /** Pointer moved over the map (tile or null if off-map). */
  hover(tile: [number, number] | null): void;
  /** Tool drag started / moved / finished at tiles. */
  dragStart(tile: [number, number]): void;
  dragMove(tile: [number, number]): void;
  dragEnd(tile: [number, number] | null): void;
  dragCancel(): void;
  /** Whether a single-finger touch should pan instead of using the tool. */
  touchPans(): boolean;
  key(key: string): boolean;
}

export function attachInput(canvas: HTMLCanvasElement, cam: IsoCamera, ground: THREE.Object3D, cb: InputCallbacks): void {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pick(clientX: number, clientY: number): [number, number] | null {
    const r = canvas.getBoundingClientRect();
    // Convert pixels to "normalised device coordinates": -1..1 on both axes.
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam.camera);
    const hit = ray.intersectObject(ground, false)[0];
    if (!hit) return null;
    const x = Math.floor(hit.point.x);
    const z = Math.floor(hit.point.z);
    return inBounds(x, z) ? [x, z] : null;
  }

  // Active pointers (for multi-touch).
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'none' | 'tool' | 'pan' = 'none';
  let last = { x: 0, y: 0 };
  let pinchDist = 0;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = { x: e.clientX, y: e.clientY };
    if (pointers.size === 2) {
      // Second finger: abandon any tool drag and switch to pan/pinch.
      if (mode === 'tool') cb.dragCancel();
      mode = 'pan';
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      last = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return;
    }
    const isTouch = e.pointerType === 'touch';
    if (e.button === 1 || e.button === 2 || (isTouch && cb.touchPans())) {
      mode = 'pan';
      return;
    }
    const t = pick(e.clientX, e.clientY);
    if (t) {
      mode = 'tool';
      cb.dragStart(t);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pan') {
      let cx = e.clientX, cy = e.clientY;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        cx = (a.x + b.x) / 2;
        cy = (a.y + b.y) / 2;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) cam.zoomBy(d / pinchDist);
        pinchDist = d;
      }
      cam.panPixels(cx - last.x, cy - last.y, canvas.clientHeight);
      last = { x: cx, y: cy };
      return;
    }
    const t = pick(e.clientX, e.clientY);
    cb.hover(t);
    if (mode === 'tool' && t) cb.dragMove(t);
  });

  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (mode === 'tool') cb.dragEnd(pick(e.clientX, e.clientY));
    if (pointers.size === 0) mode = 'none';
    else if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      last = { x: p.x, y: p.y };
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    if (mode === 'tool') cb.dragCancel();
    mode = 'none';
  });
  canvas.addEventListener('pointerleave', () => mode === 'none' && cb.hover(null));

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
    },
    { passive: false },
  );

  // Held keys pan smoothly; handled each frame via `held`.
  const held = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k) && !e.ctrlKey) {
      held.add(k);
      return;
    }
    if (k === 'q') cam.rotate(-1);
    else if (k === 'e') cam.rotate(1);
    else if (k === '+' || k === '=') cam.zoomBy(1.15);
    else if (k === '-') cam.zoomBy(1 / 1.15);
    else if (cb.key(k)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => held.clear());

  const tick = (prev: number) => (now: number) => {
    const dt = Math.min((now - prev) / 1000, 0.1);
    const speed = 18 * dt;
    let rx = 0, uy = 0;
    if (held.has('a') || held.has('arrowleft')) rx -= speed;
    if (held.has('d') || held.has('arrowright')) rx += speed;
    if (held.has('w') || held.has('arrowup')) uy += speed;
    if (held.has('s') || held.has('arrowdown')) uy -= speed;
    if (rx || uy) cam.panWorld(rx, uy);
    requestAnimationFrame(tick(now));
  };
  requestAnimationFrame(tick(performance.now()));
}
