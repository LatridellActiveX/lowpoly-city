/**
 * render/camera.ts — the isometric camera: pan, zoom and 90-degree rotation.
 *
 * WHY ORTHOGRAPHIC?
 * -----------------
 * A normal (perspective) camera makes far things smaller. Classic isometric
 * games use an ORTHOGRAPHIC camera instead: parallel lines stay parallel and
 * every tile is the same size on screen no matter how far away it is. That's
 * what gives the "board game / diorama" look.
 *
 * THE CAMERA MATH
 * ---------------
 * The camera always looks at a TARGET point on the ground (y = 0). Its position
 * is the target plus an offset described by two angles:
 *
 *   azimuth  (theta) – the compass direction we look from. 45 degrees puts the
 *                      map's diagonal pointing straight up the screen; each
 *                      rotation step adds 90 degrees (Q/E keys).
 *   elevation (phi)  – how far above the horizon. atan(1/sqrt(2)) ~= 35.26
 *                      degrees is "true isometric": the three axes x, y, z
 *                      appear equally foreshortened on screen.
 *
 *   offset = DISTANCE * ( cos(phi) * sin(theta),  sin(phi),  cos(phi) * cos(theta) )
 *
 * The distance doesn't change how big things look (orthographic!), it only
 * needs to be large enough that the whole map is in front of the camera.
 *
 * ZOOM with an orthographic camera means shrinking/growing the visible box
 * (the "frustum"). We keep a base view height of VIEW_HEIGHT world units and
 * divide it by `zoom`.
 *
 * PANNING: when you drag the mouse by (dx, dy) pixels, the ground under the
 * cursor should follow it. One pixel equals (visible height / canvas height)
 * world units. Horizontal drags move the target along the camera's "right"
 * vector. Vertical drags move along the ground direction the camera faces,
 * but because the ground is tilted away from us, one screen unit covers
 * 1 / sin(phi) units of ground — so we divide by sin(phi).
 */
import * as THREE from 'three';
import { GRID_SIZE } from '../sim/types';

const VIEW_HEIGHT = 30; // world units visible vertically at zoom = 1
const DISTANCE = 120;
const ELEVATION = Math.atan(1 / Math.SQRT2);
export const MIN_ZOOM = 0.45;
export const MAX_ZOOM = 4;
/** PR 4 orbit pitch limits (radians): ~22° to ~65° above the horizon. */
const MIN_PITCH = 0.38;
const MAX_PITCH = 1.13;

export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;
  /** The point on the ground we orbit around and look at. */
  target = new THREE.Vector3(GRID_SIZE / 2, 0, GRID_SIZE / 2);
  zoom = 1;
  /** Rotation step 0..3 (each is 90 degrees). */
  rotation = 0;
  /** Current animated azimuth in radians; eases toward the rotation step's angle. */
  private azimuth = Math.PI / 4;
  /**
   * PR 4 free orbit (middle-mouse drag): an extra yaw added on top of the
   * 90° rotation steps, and an adjustable elevation (pitch) kept between
   * MIN_PITCH and MAX_PITCH so you can't look from underground or straight down.
   */
  freeYaw = 0;
  elevation = ELEVATION;
  private aspect = 1;

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.update(0);
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.applyFrustum();
  }

  /** Rotate by +1 or -1 steps of 90 degrees. */
  rotate(dir: 1 | -1): void {
    this.rotation += dir;
  }

  /**
   * PR 4: orbit by mouse-drag pixels. Horizontal = yaw around the target,
   * vertical = pitch (clamped). The yaw is applied directly (no easing) so
   * the view follows the mouse 1:1.
   */
  /**
   * PR 5: player sensitivity multipliers (Settings → Camera rotation / pan
   * speed, 0.25–2, default 1). main.ts copies them from the settings every
   * frame so slider changes apply live.
   */
  rotateSpeed = 1;
  panSpeed = 1;

  orbit(dxPixels: number, dyPixels: number): void {
    // PR 5: base sensitivity halved (was 0.006 / 0.004 rad per pixel — too twitchy).
    const dYaw = -dxPixels * 0.003 * this.rotateSpeed;
    this.freeYaw += dYaw;
    this.azimuth += dYaw; // move now; the easing in update() then has nothing to catch up
    this.elevation = THREE.MathUtils.clamp(this.elevation + dyPixels * 0.002 * this.rotateSpeed, MIN_PITCH, MAX_PITCH);
  }

  zoomBy(factor: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.applyFrustum();
  }

  /** Pan by a screen-space delta in pixels (drag right => map moves right). */
  panPixels(dx: number, dy: number, canvasHeight: number): void {
    const worldPerPixel = (VIEW_HEIGHT / this.zoom / canvasHeight) * this.panSpeed;
    const right = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    // "Forward" = the ground direction pointing away from the camera (up the screen).
    const forward = new THREE.Vector3(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    this.target.addScaledVector(right, -dx * worldPerPixel);
    this.target.addScaledVector(forward, (dy * worldPerPixel) / Math.sin(this.elevation));
    this.clampTarget();
  }

  /** Pan by world units along screen axes (keyboard panning). */
  panWorld(rightAmount: number, upAmount: number): void {
    const right = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    const forward = new THREE.Vector3(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    this.target.addScaledVector(right, (rightAmount * this.panSpeed) / this.zoom);
    this.target.addScaledVector(forward, (upAmount * this.panSpeed) / this.zoom);
    this.clampTarget();
  }

  /** Keep the camera looking at (or near) the map so you can't get lost. */
  private clampTarget(): void {
    this.target.x = THREE.MathUtils.clamp(this.target.x, 0, GRID_SIZE);
    this.target.z = THREE.MathUtils.clamp(this.target.z, 0, GRID_SIZE);
  }

  private applyFrustum(): void {
    const halfH = VIEW_HEIGHT / this.zoom / 2;
    const halfW = halfH * this.aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  /** Call every frame. Eases rotation and recomputes the camera position. */
  update(dt: number): void {
    const goal = Math.PI / 4 + (this.rotation * Math.PI) / 2 + this.freeYaw;
    // Exponential ease: close a fixed fraction of the gap each second.
    const t = dt === 0 ? 1 : 1 - Math.exp(-dt * 10);
    this.azimuth += (goal - this.azimuth) * t;
    const offset = new THREE.Vector3(
      Math.cos(this.elevation) * Math.sin(this.azimuth),
      Math.sin(this.elevation),
      Math.cos(this.elevation) * Math.cos(this.azimuth),
    ).multiplyScalar(DISTANCE);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }
}
