import * as THREE from 'three';

interface Shockwave {
  mesh: THREE.Mesh;
  active: boolean;
  life: number;
  maxLife: number;
  growth: number;
}

const POOL_SIZE = 12;

export class ImpactShockwaves {
  private readonly shockwaves: Shockwave[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffd68a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 24), material);
      mesh.rotation.x = -Math.PI * 0.5;
      mesh.visible = false;
      scene.add(mesh);
      this.shockwaves.push({
        mesh,
        active: false,
        life: 0,
        maxLife: 0,
        growth: 0,
      });
    }
  }

  spawn(point: { x: number; y: number; z: number }, intensity: number = 1): void {
    const shockwave = this.shockwaves.find((entry) => !entry.active);
    if (!shockwave) return;
    shockwave.active = true;
    shockwave.life = shockwave.maxLife = 0.16 + Math.min(0.14, intensity * 0.08);
    shockwave.growth = 3.8 + intensity * 2.2;
    shockwave.mesh.visible = true;
    shockwave.mesh.position.set(point.x, point.y + 0.04, point.z);
    shockwave.mesh.scale.setScalar(0.08 + intensity * 0.06);
    const material = shockwave.mesh.material as THREE.MeshBasicMaterial;
    material.opacity = 0.75;
    material.color.setHex(intensity > 1.2 ? 0xfff1b6 : 0xffcc72);
  }

  update(dt: number): void {
    for (const shockwave of this.shockwaves) {
      if (!shockwave.active) continue;
      shockwave.life -= dt;
      if (shockwave.life <= 0) {
        shockwave.active = false;
        shockwave.mesh.visible = false;
        continue;
      }
      const progress = 1 - shockwave.life / shockwave.maxLife;
      shockwave.mesh.scale.setScalar(0.2 + progress * shockwave.growth);
      shockwave.mesh.position.y += dt * 0.18;
      const material = shockwave.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = (1 - progress) * 0.72;
    }
  }
}
