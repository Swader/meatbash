import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { InputManager } from '../engine/input';
import { RapierWorld } from '../physics/rapier-world';
import { BipedSkeleton } from '../physics/skeleton';
import { applyBipedLocomotion, createLocomotionState, type LocomotionState } from '../physics/locomotion';

/**
 * Deterministic sin-based noise for vertex displacement.
 * No external lib needed — just a crunchy hash.
 */
function noise3D(x: number, y: number, z: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (n - Math.floor(n)) * 2.0 - 1.0;
}

/** Layered noise for more organic feel */
function organicNoise(x: number, y: number, z: number, seed: number): number {
  const s = seed * 13.37;
  return (
    noise3D(x * 3.0 + s, y * 3.0, z * 3.0) * 0.6 +
    noise3D(x * 7.0 + s, y * 7.0, z * 7.0) * 0.3 +
    noise3D(x * 13.0 + s, y * 13.0, z * 13.0) * 0.1
  );
}

/** Displace vertices of a geometry along their normals using noise */
function displaceVertices(
  geometry: THREE.BufferGeometry,
  amplitude: number,
  seed: number
) {
  geometry.computeVertexNormals();
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);

    const disp = organicNoise(px, py, pz, seed) * amplitude;
    pos.setXYZ(i, px + nx * disp, py + ny * disp, pz + nz * disp);
  }

  geometry.computeVertexNormals();
  pos.needsUpdate = true;
}

/** Store original vertex positions so jiggle always offsets from base */
function storeOriginalPositions(geometry: THREE.BufferGeometry): Float32Array {
  const pos = geometry.attributes.position;
  return new Float32Array(pos.array as Float32Array);
}

/**
 * A beast instance in the game world.
 * Links physics skeleton to Three.js visual meshes.
 * Phase 1: blobby organic visual proxies for each body part.
 * Phase 2: SDF meat layer rendered on top.
 */
export class BeastInstance {
  skeleton: BipedSkeleton;
  physics: RapierWorld;
  group: THREE.Group;
  stamina: { current: number; max: number; regen: number };

  // Locomotion state (tracks stride alternation)
  private locoState: LocomotionState;

  // Map from joint name -> visual mesh
  private visuals = new Map<string, THREE.Mesh>();

  // Meat material
  private meatMaterial: THREE.MeshStandardMaterial;
  private boneMaterial: THREE.MeshStandardMaterial;

  // Jiggle state: original positions + previous world positions for velocity
  private originalPositions = new Map<string, Float32Array>();
  private prevPositions = new Map<string, THREE.Vector3>();

  constructor(
    skeleton: BipedSkeleton,
    physics: RapierWorld,
    scene: THREE.Scene
  ) {
    this.skeleton = skeleton;
    this.physics = physics;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.stamina = { current: 100, max: 100, regen: 5.0 };
    this.locoState = createLocomotionState();

    // Wet, glisteny meat material with fresnel rim glow
    this.meatMaterial = new THREE.MeshStandardMaterial({
      color: 0xdd4444,
      roughness: 0.4,
      metalness: 0.05,
      emissive: 0x330808,
      emissiveIntensity: 0.2,
    });

    // Inject fresnel rim glow via onBeforeCompile (fake subsurface scattering)
    this.meatMaterial.onBeforeCompile = (shader) => {
      // Add varyings for rim light
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
varying vec3 vViewNormal;
varying vec3 vViewDir;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vViewNormal = normalize(normalMatrix * objectNormal);
vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
vViewDir = normalize(-mvPos.xyz);`
      );

      // Add rim glow to fragment shader
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
varying vec3 vViewNormal;
varying vec3 vViewDir;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `// Fresnel rim glow — pinkish at grazing angles
float rimDot = 1.0 - max(dot(vViewNormal, vViewDir), 0.0);
float rimPower = pow(rimDot, 3.0);
vec3 rimColor = vec3(1.0, 0.4, 0.35) * rimPower * 0.6;
gl_FragColor.rgb += rimColor;
#include <dithering_fragment>`
      );
    };

    // Bone/joint material
    this.boneMaterial = new THREE.MeshStandardMaterial({
      color: 0xeeddcc,
      roughness: 0.8,
      metalness: 0.0,
    });

    this.createVisuals();
  }

  private createVisuals() {
    // Create blobby organic visual proxies for each skeleton body part.
    // The pelvis is small for physics stability, but the visual torso is bigger
    // (a meaty blob) so it covers the pelvis area and looks chunky.
    type SegConfig =
      | { kind: 'sphere'; radius: number; isMeat: boolean }
      | { kind: 'capsule'; halfHeight: number; radius: number; isMeat: boolean }
      | { kind: 'box'; hx: number; hy: number; hz: number; isMeat: boolean };

    const segmentConfigs: Record<string, SegConfig> = {
      // Torso: big meaty sphere covering the small pelvis collider
      'torso':   { kind: 'sphere', radius: 0.42, isMeat: true },
      // Upper legs: thigh capsules matching collider dimensions (halfH=0.21, rad=0.12)
      'hip_l':   { kind: 'capsule', halfHeight: 0.21, radius: 0.13, isMeat: true },
      'hip_r':   { kind: 'capsule', halfHeight: 0.21, radius: 0.13, isMeat: true },
      // Lower legs: shin capsules (halfH=0.20, rad=0.10)
      'knee_l':  { kind: 'capsule', halfHeight: 0.20, radius: 0.11, isMeat: true },
      'knee_r':  { kind: 'capsule', halfHeight: 0.20, radius: 0.11, isMeat: true },
      // Feet: flat boxes (matching collider 0.10 x 0.05 x 0.16 half-extents)
      'ankle_l': { kind: 'box', hx: 0.10, hy: 0.05, hz: 0.16, isMeat: false },
      'ankle_r': { kind: 'box', hx: 0.10, hy: 0.05, hz: 0.16, isMeat: false },
    };

    let seedCounter = 0;

    for (const [name, joint] of this.skeleton.joints) {
      const config = segmentConfigs[name];
      if (!config) continue;

      let mesh: THREE.Mesh;
      const seed = seedCounter++;

      if (config.kind === 'sphere') {
        const geo = new THREE.SphereGeometry(config.radius, 24, 18);
        displaceVertices(geo, config.radius * 0.13, seed);
        mesh = new THREE.Mesh(geo, this.meatMaterial);
      } else if (config.kind === 'capsule') {
        const geo = new THREE.CapsuleGeometry(config.radius, config.halfHeight * 2, 12, 12);
        if (config.isMeat) {
          displaceVertices(geo, config.radius * 0.12, seed);
        }
        mesh = new THREE.Mesh(geo, config.isMeat ? this.meatMaterial : this.boneMaterial);
      } else {
        // Box (foot)
        const geo = new THREE.BoxGeometry(config.hx * 2, config.hy * 2, config.hz * 2);
        mesh = new THREE.Mesh(geo, config.isMeat ? this.meatMaterial : this.boneMaterial);
      }

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.visuals.set(name, mesh);

      // Store original vertex positions for jiggle (meat parts only)
      if (config.isMeat && (config.kind === 'sphere' || config.kind === 'capsule')) {
        this.originalPositions.set(name, storeOriginalPositions(mesh.geometry));
      }

      // Init previous position for velocity tracking
      const pos = joint.body.translation();
      this.prevPositions.set(name, new THREE.Vector3(pos.x, pos.y, pos.z));
    }

    // Add some "eyes" to the torso for personality
    const torsoMesh = this.visuals.get('torso');
    if (torsoMesh) {
      const eyeGeo = new THREE.SphereGeometry(0.06, 8, 8);
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const pupilGeo = new THREE.SphereGeometry(0.035, 8, 8);
      const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(side * 0.15, 0.2, 0.35);
        torsoMesh.add(eye);

        const pupil = new THREE.Mesh(pupilGeo, pupilMat);
        pupil.position.set(0, 0, 0.03);
        eye.add(pupil);
      }
    }
  }

  /** Apply player input as physics torques */
  applyInput(input: InputManager, dt: number) {
    applyBipedLocomotion(this.skeleton, input, dt, this.stamina, this.physics, this.locoState);
  }

  /** Sync visual mesh positions/rotations from physics bodies, apply jiggle */
  syncFromPhysics() {
    for (const [name, joint] of this.skeleton.joints) {
      const mesh = this.visuals.get(name);
      if (!mesh) continue;

      const pos = joint.body.translation();
      const rot = joint.body.rotation();

      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

      // Jiggle: offset vertices based on velocity
      const origPositions = this.originalPositions.get(name);
      if (origPositions) {
        const prev = this.prevPositions.get(name)!;
        const vx = pos.x - prev.x;
        const vy = pos.y - prev.y;
        const vz = pos.z - prev.z;
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

        // Only jiggle if there's meaningful movement
        if (speed > 0.001) {
          const posAttr = mesh.geometry.attributes.position;
          const jiggleStrength = Math.min(speed * 1.5, 0.06);

          // Use a time-varying phase so jiggle wobbles
          const phase = performance.now() * 0.008;

          for (let i = 0; i < posAttr.count; i++) {
            const ox = origPositions[i * 3];
            const oy = origPositions[i * 3 + 1];
            const oz = origPositions[i * 3 + 2];

            // Perpendicular wobble: use sin of position + phase for organic feel
            const wobble = Math.sin(ox * 11.0 + phase) *
                           Math.cos(oy * 13.0 + phase * 0.7) *
                           jiggleStrength;

            // Offset perpendicular to velocity direction (cross with up, fallback to x)
            const len = Math.sqrt(vx * vx + vz * vz) || 1.0;
            const perpX = -vz / len;
            const perpZ = vx / len;

            posAttr.setXYZ(
              i,
              ox + perpX * wobble,
              oy + wobble * 0.5,
              oz + perpZ * wobble
            );
          }
          posAttr.needsUpdate = true;
        } else {
          // Restore original positions when still (stop wobbling)
          const posAttr = mesh.geometry.attributes.position;
          const arr = posAttr.array as Float32Array;
          // Only restore if we previously jiggled (avoid unnecessary updates)
          let dirty = false;
          for (let i = 0; i < origPositions.length; i++) {
            if (arr[i] !== origPositions[i]) {
              arr[i] = origPositions[i];
              dirty = true;
            }
          }
          if (dirty) {
            posAttr.needsUpdate = true;
          }
        }

        // Update previous position
        prev.set(pos.x, pos.y, pos.z);
      }
    }
  }

  /** Get the torso position (for camera follow) */
  getPosition(): THREE.Vector3 {
    const torso = this.skeleton.joints.get('torso');
    if (!torso) return new THREE.Vector3();
    const pos = torso.body.translation();
    return new THREE.Vector3(pos.x, pos.y, pos.z);
  }

  /** Get current mass percentage (for HP display) */
  getMassPercent(): number {
    // Phase 1: always 100%. Phase 3 will track actual mass loss.
    return 100;
  }

  getStaminaPercent(): number {
    return (this.stamina.current / this.stamina.max) * 100;
  }

  /**
   * Snapshot of the controller's internal state, for the debug HUD.
   * Reading this is free — the locomotion already updates these fields
   * each fixed step.
   */
  getDebugState() {
    return {
      mode: this.locoState.mode,
      groundedFeet: this.locoState.groundedFeet,
      tiltDeg: this.locoState.tiltDeg,
      groundDist: this.locoState.groundDist,
      totalMass: this.locoState.totalMass,
      regenPerSec: this.locoState.regenPerSec,
    };
  }
}
