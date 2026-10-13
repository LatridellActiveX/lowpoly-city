/**
 * main.ts — placeholder entry point (scaffold).
 * Shows a single spinning low-poly cube so we can confirm the build and deploy work.
 */
import * as THREE from 'three';
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3e8);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(3, 3, 3);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x6fbf73, flatShading: true }));
scene.add(cube);
renderer.setAnimationLoop(() => { cube.rotation.y += 0.01; renderer.render(scene, camera); });
