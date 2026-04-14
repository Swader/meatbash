/**
 * Meat chunk particles.
 *
 * Visual debris that pops off when two beasts collide hard. This is a
 * tiny CPU-side pool of InstancedMesh rows — cheap, doesn't need
 * physics integration, purely visual. Each chunk has its own velocity
 * and spin, fades out, and is recycled.
 */

import * as THREE from 'three';

interface Chunk {
  active: boolean;
  life: number;   // seconds remaining
  maxLife: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  scale: number;
}

const POOL_SIZE = 64;
const GRAVITY = -9.81;

export class MeatChunks {
  private mesh: THREE.InstancedMesh;
  private chunks: Chunk[] = [];
  private tmpObj = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    // Tiny cubes — cheap to render, read as "lump of meat" at a glance.
    const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xdd4444,
      roughness: 0.5,
      metalness: 0.0,
      emissive: 0x220505,
      emissiveIntensity: 0.3,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL_SIZE);
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    for (let i = 0; i < POOL_SIZE; i++) {
      this.chunks.push({
        active: false,
        life: 0,
        maxLife: 0,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        rot: new THREE.Euler(),
        scale: 0,
      });
      // Hide inactive chunks by zero-scaling them
      this.tmpObj.position.set(0, -1000, 0);
      this.tmpObj.scale.setScalar(0);
      this.tmpObj.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmpObj.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Spawn `count` chunks at the given world point with a random burst
   * velocity. Tint is the meat color for this beast (falls back to
   * a default pink if unspecified).
   */
  spawn(
    point: { x: number; y: number; z: number },
    count: number,
    speed: number = 3.0,
    color?: number
  ): void {
    let spawned = 0;
    for (const c of this.chunks) {
      if (spawned >= count) break;
      if (c.active) continue;
      c.active = true;
      c.life = 0.8 + Math.random() * 0.6;
      c.maxLife = c.life;
      c.pos.set(point.x, point.y + 0.1, point.z);
      const ang = Math.random() * Math.PI * 2;
      const pitch = Math.random() * Math.PI * 0.5 + Math.PI * 0.2;
      c.vel.set(
        Math.cos(ang) * Math.sin(pitch) * speed,
        Math.cos(pitch) * speed + 1.5,
        Math.sin(ang) * Math.sin(pitch) * speed
      );
      c.spin.set(
        (Math.random() * 2 - 1) * 8,
        (Math.random() * 2 - 1) * 8,
        (Math.random() * 2 - 1) * 8
      );
      c.rot.set(0, 0, 0);
      c.scale = 0.6 + Math.random() * 0.6;
      spawned++;
    }
    void color; // Phase 2 extra: per-beast tinting via setColorAt
  }

  /** Advance all live chunks. Call from the variable-rate update. */
  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (!c.active) continue;

      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
        this.tmpObj.position.set(0, -1000, 0);
        this.tmpObj.scale.setScalar(0);
        this.tmpObj.updateMatrix();
        this.mesh.setMatrixAt(i, this.tmpObj.matrix);
        dirty = true;
        continue;
      }

      // Gravity + drag
      c.vel.y += GRAVITY * dt;
      c.vel.multiplyScalar(1 - 0.5 * dt);
      c.pos.addScaledVector(c.vel, dt);

      // Bounce off ground-ish plane
      if (c.pos.y < 0.05) {
        c.pos.y = 0.05;
        c.vel.y = -c.vel.y * 0.3;
        c.vel.x *= 0.6;
        c.vel.z *= 0.6;
      }

      c.rot.x += c.spin.x * dt;
      c.rot.y += c.spin.y * dt;
      c.rot.z += c.spin.z * dt;

      const fade = Math.max(0, c.life / c.maxLife);
      const s = c.scale * fade;

      this.tmpObj.position.copy(c.pos);
      this.tmpObj.rotation.copy(c.rot);
      this.tmpObj.scale.setScalar(s);
      this.tmpObj.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmpObj.matrix);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
