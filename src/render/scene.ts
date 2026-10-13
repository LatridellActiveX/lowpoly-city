/**
 * render/scene.ts — creates the Three.js renderer, scene, lights and terrain.
 *
 * WORLD vs TILE COORDINATES
 * -------------------------
 * Tile (x, z) covers the square from (x, z) to (x+1, z+1) in world units, so
 * its CENTRE is at world (x + 0.5, 0, z + 0.5). The whole 64x64 map spans
 * world 0..64 on both x and z. `tileCenter` below does that conversion; the
 * reverse (world -> tile) is just Math.floor, used when picking with the mouse.
 */
import * as THREE from 'three';
import { GRID_SIZE } from '../sim/types';

export function tileCenter(x: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x + 0.5, 0, z + 0.5);
}

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** The invisible-ish ground plane that mouse rays are tested against. */
  ground: THREE.Mesh;
  sun: THREE.DirectionalLight;
}

export function createScene(container: HTMLElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd3e8);

  // Soft sky/ground fill light so shadowed sides are never pitch black...
  scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x6b7f5a, 1.6));
  // ...plus a "sun" that casts shadows. Its shadow camera is an orthographic
  // box big enough to cover the entire map.
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(GRID_SIZE / 2 + 30, 60, GRID_SIZE / 2 + 15);
  sun.target.position.set(GRID_SIZE / 2, 0, GRID_SIZE / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const s = GRID_SIZE * 0.75;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 200 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // The map is a thick slab of grass with an earthy side, like a diorama.
  const half = GRID_SIZE / 2;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(GRID_SIZE, 2, GRID_SIZE),
    [0x8a6a48, 0x8a6a48, 0x86c25e, 0x5c4630, 0x8a6a48, 0x8a6a48].map(
      (c) => new THREE.MeshLambertMaterial({ color: c }),
    ),
  );
  slab.position.set(half, -1, half);
  slab.receiveShadow = true;
  scene.add(slab);

  // Thin grid lines just above the grass so tiles are readable.
  const grid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, 0x6aa548, 0x6aa548);
  grid.position.set(half, 0.005, half);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  scene.add(grid);

  // Picking plane at y = 0 (the slab's top face). Invisible but raycastable.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
  ground.position.set(half, 0, half);
  scene.add(ground);

  return { renderer, scene, ground, sun };
}
