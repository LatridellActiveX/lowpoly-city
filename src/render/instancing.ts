/**
 * render/instancing.ts — a small helper around THREE.InstancedMesh.
 *
 * WHAT IS INSTANCING?
 * -------------------
 * Drawing 2,000 separate road meshes means 2,000 "draw calls", and each draw
 * call has overhead on the CPU. An InstancedMesh draws ONE geometry many times
 * in a single draw call; each copy ("instance") only gets its own 4x4
 * transform matrix (position/rotation/scale) and optionally its own colour.
 * So a whole city of roads, houses or pipes costs one draw call per model.
 *
 * HOW WE USE IT
 * -------------
 * Every time the city changes we "rebuild" each pool:
 *     pool.begin();  pool.add(matrix, color); ...  pool.end();
 * `begin` resets the counter, `add` writes the next matrix into the
 * instance buffer, and `end` tells Three.js how many instances to draw and
 * that the buffers changed. If we run out of room the pool grows (doubles)
 * by creating a bigger InstancedMesh.
 */
import * as THREE from 'three';

export class InstancePool {
  mesh: THREE.InstancedMesh;
  private count = 0;
  private readonly white = new THREE.Color(1, 1, 1);

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    private capacity = 256,
    private readonly shadows = true,
  ) {
    this.mesh = this.create(capacity);
  }

  private create(capacity: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    m.count = 0;
    m.castShadow = this.shadows;
    m.receiveShadow = true;
    // Instance colour buffer must exist before first use.
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    // Bounding sphere is computed from geometry only; instances span the map,
    // so disable frustum culling rather than recompute bounds every change.
    m.frustumCulled = false;
    this.parent.add(m);
    return m;
  }

  begin(): void {
    this.count = 0;
  }

  add(matrix: THREE.Matrix4, color?: THREE.Color): void {
    if (this.count >= this.capacity) this.grow();
    this.mesh.setMatrixAt(this.count, matrix);
    this.mesh.setColorAt(this.count, color ?? this.white);
    this.count++;
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private grow(): void {
    const old = this.mesh;
    this.capacity *= 2;
    this.mesh = this.create(this.capacity);
    // Copy what we already wrote this frame into the new, bigger mesh.
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < this.count; i++) {
      old.getMatrixAt(i, m);
      old.getColorAt(i, c);
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, c);
    }
    this.parent.remove(old);
    old.dispose();
  }
}
