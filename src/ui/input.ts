/**
 * ui/input.ts — mouse and keyboard handling (desktop only).
 *
 * Since PR 3 the game is a desktop game: there are no touch or pinch
 * gestures any more. Phones and small screens get a "play on a computer"
 * notice instead (see desktopOnly.ts).
 *
 * Controls
 *   Mouse: left-drag = use tool, right/middle-drag = pan, wheel = zoom.
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
  /** Pointer moved over the map (tile or null if off-map). Also gives the raw mouse position for tooltips. */
  hover(tile: [number, number] | null, clientX: number, clientY: number): void;
  /** Tool drag started / moved / finished at tiles. */
  dragStart(tile: [number, number]): void;
  dragMove(tile: [number, number]): void;
  dragEnd(tile: [number, number] | null): void;
  dragCancel(): void;
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

  // 'tool' = left button held with a tool, 'pan' = right/middle button held.
  let mode: 'none' | 'tool' | 'pan' = 'none';
  let last = { x: 0, y: 0 };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'none') return; // ignore a second button while one is held
    canvas.setPointerCapture(e.pointerId);
    last = { x: e.clientX, y: e.clientY };
    if (e.button === 1 || e.button === 2) {
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
    if (mode === 'pan') {
      cam.panPixels(e.clientX - last.x, e.clientY - last.y, canvas.clientHeight);
      last = { x: e.clientX, y: e.clientY };
      return;
    }
    const t = pick(e.clientX, e.clientY);
    cb.hover(t, e.clientX, e.clientY);
    if (mode === 'tool' && t) cb.dragMove(t);
  });

  canvas.addEventListener('pointerup', (e) => {
    if (mode === 'tool') cb.dragEnd(pick(e.clientX, e.clientY));
    mode = 'none';
  });
  canvas.addEventListener('pointercancel', () => {
    if (mode === 'tool') cb.dragCancel();
    mode = 'none';
  });
  canvas.addEventListener('pointerleave', (e) => mode === 'none' && cb.hover(null, e.clientX, e.clientY));

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
