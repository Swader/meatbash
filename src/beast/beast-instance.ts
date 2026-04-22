import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { InputManager } from '../engine/input';
import { RapierWorld } from '../physics/rapier-world';
import { BipedSkeleton } from '../physics/skeleton';
import { applyBipedLocomotion, createLocomotionState, type LocomotionState } from '../physics/locomotion';
import type { BeastDefinition, BeastRuntimeTuning } from './beast-data';
import { AttackController } from '../combat/attack-controller';
import type {
  ActiveAttackContext,
  AttackSlotDefinition,
  AttackTelemetry,
  AttackVisualRigType,
  ChargeTier,
} from '../combat/attack-types';

const ATTACK_AIM_ASSIST_ARC_DOT = -0.28;
const ATTACK_AIM_ASSIST_STRENGTH = 0.9;
const ATTACK_AIM_ASSIST_MAX_RATE = 1.6;
const COMMIT_AIM_ASSIST_ARC_DOT = -0.34;
const COMMIT_AIM_ASSIST_STRENGTH = 0.56;
const COMMIT_AIM_ASSIST_MAX_RATE = 1.08;
const MOVE_AIM_ASSIST_ARC_DOT = -0.2;
const MOVE_AIM_ASSIST_STRENGTH = 0.42;
const MOVE_AIM_ASSIST_MAX_RATE = 1.0;
const COUNTDOWN_FACE_ASSIST_STRENGTH = 1.65;
const COUNTDOWN_FACE_ASSIST_MAX_RATE = 2.6;
const COUNTDOWN_STABILITY_MULTIPLIER = 1.24;
const HIT_FLASH_BASE_INTENSITY = 0.2;
const DETACH_CASCADE: Record<string, string[]> = {
  shoulder_l: ['elbow_l'],
  shoulder_r: ['elbow_r'],
  hip_l: ['knee_l', 'ankle_l'],
  knee_l: ['ankle_l'],
  hip_r: ['knee_r', 'ankle_r'],
  knee_r: ['ankle_r'],
  hip_fl: ['knee_fl', 'ankle_fl'],
  knee_fl: ['ankle_fl'],
  hip_fr: ['knee_fr', 'ankle_fr'],
  knee_fr: ['ankle_fr'],
  hip_bl: ['knee_bl', 'ankle_bl'],
  knee_bl: ['ankle_bl'],
  hip_br: ['knee_br', 'ankle_br'],
  knee_br: ['ankle_br'],
};

/**
 * Generic skeleton shape that any archetype can provide. BipedSkeleton
 * and QuadSkeleton both satisfy this — they expose `joints`, `allBodies`,
 * `pelvis`, and `restingPelvisY`. The archetype-specific details
 * (knee joint names, foot count) are hidden behind the joint map.
 */
export interface GenericSkeleton {
  joints: Map<string, { name: string; body: RAPIER.RigidBody; joint?: RAPIER.RevoluteImpulseJoint; additionalMass: number }>;
  allBodies: RAPIER.RigidBody[];
  pelvis: RAPIER.RigidBody;
  restingPelvisY: number;
  restingPelvisHeightAboveGround?: number;
}

/**
 * Locomotion adapter. Both biped and quad locomotion have the same
 * shape: a state struct + an update function. BeastInstance calls
 * the right one based on the beast's archetype.
 */
export type LocomotionUpdate = (
  skeleton: any,
  input: InputManager,
  dt: number,
  stamina: { current: number; max: number; regen: number },
  physics: RapierWorld,
  state: any
) => void;

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

function createChargeGlowTexture(
  colors: Array<{ stop: number; color: string }>,
  width: number = 128,
  height: number = 128
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(width / 2, height / 2, 4, width / 2, height / 2, width / 2);
  for (const stop of colors) {
    gradient.addColorStop(stop.stop, stop.color);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createChargeStreakTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, canvas.height / 2, canvas.width, canvas.height / 2);
  gradient.addColorStop(0, 'rgba(255,180,70,0)');
  gradient.addColorStop(0.2, 'rgba(255,200,90,0.3)');
  gradient.addColorStop(0.5, 'rgba(255,255,220,0.95)');
  gradient.addColorStop(0.8, 'rgba(255,200,90,0.3)');
  gradient.addColorStop(1, 'rgba(255,180,70,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const NO_INPUT_SOURCE = {
  isDown: (_key: string) => false,
  justPressed: (_key: string) => false,
  justReleased: (_key: string) => false,
  beginFixedStep: () => {},
  endFrame: () => {},
  getHeldKeys: () => [] as string[],
};

/**
 * A beast instance in the game world.
 * Links physics skeleton to Three.js visual meshes.
 * Phase 1: blobby organic visual proxies for each body part.
 * Phase 2: SDF meat layer rendered on top.
 */
export class BeastInstance {
  skeleton: GenericSkeleton;
  physics: RapierWorld;
  group: THREE.Group;
  stamina: { current: number; max: number; regen: number };
  definition?: BeastDefinition;

  // Locomotion state — shape depends on archetype; treat as any
  locoState: any;
  // Per-archetype locomotion update function
  private locomotionUpdate: LocomotionUpdate;
  private attackController?: AttackController;
  private remoteAttackTelemetry: AttackTelemetry | null = null;

  // Map from joint name -> visual mesh
  private visuals = new Map<string, THREE.Mesh>();

  // Meat material
  private meatMaterial: THREE.MeshStandardMaterial;
  private boneMaterial: THREE.MeshStandardMaterial;

  // Jiggle state: original positions + previous world positions for velocity
  private originalPositions = new Map<string, Float32Array>();
  private prevPositions = new Map<string, THREE.Vector3>();
  private attackIndicatorGroup?: THREE.Group;
  private attackIndicatorFlare?: THREE.Sprite;
  private attackIndicatorStreak?: THREE.Sprite;
  private attackIndicatorBloom?: THREE.Sprite;
  private attackHeatOverlays = new Map<string, THREE.Mesh>();
  private attackTempQuat = new THREE.Quaternion();
  private attackTempVec = new THREE.Vector3();
  private attackTempVec2 = new THREE.Vector3();
  private attackTempVec3 = new THREE.Vector3();
  private pendingAudioEvents: Array<{ type: 'jump' | 'land' | 'miss' }> = [];
  private pendingHudEvents: string[] = [];
  private prevGroundedForAudio: boolean | null = null;
  private prevJumpTimerForAudio: number | null = null;
  private detachedSegments = new Set<string>();
  private combatTarget: BeastInstance | null = null;
  private hitFlashStrength = 0;
  private hitFlashUntilMs = 0;
  private initialAttachedMass = 1;
  private weaponVisualRoot?: THREE.Group;

  constructor(
    skeleton: GenericSkeleton,
    physics: RapierWorld,
    scene: THREE.Scene,
    definition?: BeastDefinition,
    locomotionUpdate?: LocomotionUpdate,
    locomotionState?: any
  ) {
    this.skeleton = skeleton;
    this.physics = physics;
    this.definition = definition;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.stamina = { current: 100, max: 100, regen: 5.0 };
    // Default to biped locomotion unless the caller passes quad
    this.locomotionUpdate = locomotionUpdate || (applyBipedLocomotion as any);
    this.locoState = locomotionState || createLocomotionState();
    if (definition?.attackSlots?.length) {
      this.attackController = new AttackController(this.skeleton as any, definition.attackSlots[0]!);
    }

    // Pull color/emissive from definition if provided
    const color = definition?.visuals.color ?? 0xdd4444;
    const emissive = definition?.visuals.emissive ?? 0x330808;

    // Wet, glisteny meat material with fresnel rim glow
    this.meatMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.05,
      emissive,
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
    this.createAttackIndicator();
    this.createAttackHeatOverlays();
    this.createWeaponVisuals();
    this.applyDefinitionTuning();
    this.initialAttachedMass = Math.max(0.001, this.getAttachedMass());
  }

  private createVisuals() {
    // Create blobby organic visual proxies for each skeleton body part.
    // The pelvis is small for physics stability, but the visual torso is bigger
    // (a meaty blob) so it covers the pelvis area and looks chunky.
    type SegConfig =
      | { kind: 'sphere'; radius: number; isMeat: boolean }
      | { kind: 'capsule'; halfHeight: number; radius: number; isMeat: boolean }
      | { kind: 'box'; hx: number; hy: number; hz: number; isMeat: boolean };

    const torsoScale = this.definition?.visuals.torsoScale ?? 1.0;
    const archetype = this.definition?.archetype ?? 'bipedal';

    const bipedConfigs: Record<string, SegConfig> = {
      // Torso: big meaty sphere covering the small pelvis collider
      'torso':   { kind: 'sphere', radius: 0.42 * torsoScale, isMeat: true },
      // Upper legs: thigh capsules matching collider dimensions (halfH=0.21, rad=0.12)
      'hip_l':   { kind: 'capsule', halfHeight: 0.21, radius: 0.13, isMeat: true },
      'hip_r':   { kind: 'capsule', halfHeight: 0.21, radius: 0.13, isMeat: true },
      // Lower legs: shin capsules
      'knee_l':  { kind: 'capsule', halfHeight: 0.20, radius: 0.11, isMeat: true },
      'knee_r':  { kind: 'capsule', halfHeight: 0.20, radius: 0.11, isMeat: true },
      // Feet: flat boxes
      'ankle_l': { kind: 'box', hx: 0.10, hy: 0.05, hz: 0.16, isMeat: false },
      'ankle_r': { kind: 'box', hx: 0.10, hy: 0.05, hz: 0.16, isMeat: false },
      // Arms (optional — only present when the skeleton was built with
      // withArms=true; missing keys silently no-op in the loop below).
      // Match the collider dimensions in skeleton.ts (upperArmLen=0.36,
      // upperArmRad=0.085 / lowerArmLen=0.34, lowerArmRad=0.075).
      'shoulder_l': { kind: 'capsule', halfHeight: 0.18, radius: 0.10, isMeat: true },
      'shoulder_r': { kind: 'capsule', halfHeight: 0.18, radius: 0.10, isMeat: true },
      'elbow_l':    { kind: 'capsule', halfHeight: 0.17, radius: 0.085, isMeat: true },
      'elbow_r':    { kind: 'capsule', halfHeight: 0.17, radius: 0.085, isMeat: true },
    };

    const quadConfigs: Record<string, SegConfig> = {
      // Front torso is the "head" — bigger, gets the eyes.
      // Rear torso is smaller so the silhouette reads as one body
      // with a head at the front, not two joined heads.
      'torso':      { kind: 'sphere', radius: 0.36 * torsoScale, isMeat: true },
      'torso_rear': { kind: 'sphere', radius: 0.22 * torsoScale, isMeat: true },
      // Upper legs (hip = thigh segment)
      'hip_fl': { kind: 'capsule', halfHeight: 0.15, radius: 0.11, isMeat: true },
      'hip_fr': { kind: 'capsule', halfHeight: 0.15, radius: 0.11, isMeat: true },
      'hip_bl': { kind: 'capsule', halfHeight: 0.15, radius: 0.11, isMeat: true },
      'hip_br': { kind: 'capsule', halfHeight: 0.15, radius: 0.11, isMeat: true },
      // Lower legs (knee = shin segment)
      'knee_fl': { kind: 'capsule', halfHeight: 0.14, radius: 0.09, isMeat: true },
      'knee_fr': { kind: 'capsule', halfHeight: 0.14, radius: 0.09, isMeat: true },
      'knee_bl': { kind: 'capsule', halfHeight: 0.14, radius: 0.09, isMeat: true },
      'knee_br': { kind: 'capsule', halfHeight: 0.14, radius: 0.09, isMeat: true },
      // Feet
      'ankle_fl': { kind: 'box', hx: 0.08, hy: 0.04, hz: 0.12, isMeat: false },
      'ankle_fr': { kind: 'box', hx: 0.08, hy: 0.04, hz: 0.12, isMeat: false },
      'ankle_bl': { kind: 'box', hx: 0.08, hy: 0.04, hz: 0.12, isMeat: false },
      'ankle_br': { kind: 'box', hx: 0.08, hy: 0.04, hz: 0.12, isMeat: false },
    };

    const segmentConfigs = archetype === 'quadruped' ? quadConfigs : bipedConfigs;

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

  private createAttackIndicator() {
    if (this.attackIndicatorGroup) return;
    const group = new THREE.Group();
    group.visible = false;
    const flare = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createChargeGlowTexture([
          { stop: 0, color: 'rgba(255,255,240,0.95)' },
          { stop: 0.18, color: 'rgba(255,225,140,0.9)' },
          { stop: 0.45, color: 'rgba(255,145,40,0.42)' },
          { stop: 1, color: 'rgba(255,90,0,0)' },
        ]),
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    flare.scale.set(0.8, 0.8, 0.8);
    group.add(flare);

    const streak = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createChargeStreakTexture(),
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    streak.scale.set(1.2, 0.28, 1);
    group.add(streak);

    const bloom = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createChargeGlowTexture([
          { stop: 0, color: 'rgba(255,250,220,0.45)' },
          { stop: 0.3, color: 'rgba(255,170,60,0.2)' },
          { stop: 1, color: 'rgba(255,110,0,0)' },
        ], 96, 96),
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    bloom.scale.set(1.35, 1.35, 1.35);
    group.add(bloom);

    this.group.add(group);
    this.attackIndicatorGroup = group;
    this.attackIndicatorFlare = flare;
    this.attackIndicatorStreak = streak;
    this.attackIndicatorBloom = bloom;
  }

  private createAttackHeatOverlays(): void {
    const slot = this.getPrimaryAttackSlot();
    if (!slot) return;
    const segments = new Set<string>([
      ...slot.drivenJoints,
      ...(slot.activeBodies ?? slot.hitSegments),
      slot.appendageRoot,
    ]);
    for (const name of segments) {
      const source = this.visuals.get(name);
      if (!source) continue;
      const overlay = new THREE.Mesh(
        source.geometry,
        new THREE.MeshBasicMaterial({
          color: 0xff7a2f,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      overlay.visible = false;
      overlay.renderOrder = 3;
      this.group.add(overlay);
      this.attackHeatOverlays.set(name, overlay);
    }
  }

  private createWeaponVisuals(): void {
    const slot = this.getPrimaryAttackSlot();
    if (!slot) return;
    const anchorName = this.getWeaponVisualAnchorName(slot);
    const anchor = this.visuals.get(anchorName);
    if (!anchor) return;

    const root = new THREE.Group();
    const reachMul = this.getWeaponReachMultiplier(slot);
    const visualMul = this.definition?.runtimeTuning?.weaponVisualScale ?? 1;
    const weaponType = slot.weaponType ?? this.inferWeaponType(slot);

    if (weaponType === 'hammer') {
      const head = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.12 * visualMul, 1),
        this.meatMaterial
      );
      head.position.set(0, -0.16 * reachMul, 0.08 * reachMul);
      head.scale.set(1.15, 1.0, 1.25);
      root.add(head);
    } else if (weaponType === 'spike') {
      const spikeMat = this.boneMaterial.clone();
      spikeMat.emissive = new THREE.Color(0x231108);
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.09 * visualMul, 0.34 * reachMul * visualMul, 8),
        spikeMat
      );
      spike.rotation.x = Math.PI;
      spike.position.set(0, -0.16 * reachMul, 0.12 * reachMul);
      root.add(spike);
    } else if (weaponType === 'shield') {
      const shieldMat = this.boneMaterial.clone();
      shieldMat.color = new THREE.Color(0xf1d7bf);
      const shield = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16 * visualMul, 0.18 * visualMul, 0.08 * visualMul, 12),
        shieldMat
      );
      shield.rotation.x = Math.PI * 0.5;
      shield.position.set(0, 0.02, this.isQuadruped() ? 0.34 * reachMul : 0.1 * reachMul);
      root.add(shield);
    } else {
      const hornMat = this.boneMaterial.clone();
      hornMat.color = new THREE.Color(0xf1d7bf);
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(
          new THREE.ConeGeometry(0.05 * visualMul, 0.22 * reachMul * visualMul, 8),
          hornMat
        );
        horn.position.set(side * 0.08, 0.02, 0.34 * reachMul);
        horn.rotation.x = -Math.PI * 0.5;
        horn.rotation.z = side * 0.18;
        root.add(horn);
      }
    }

    anchor.add(root);
    this.weaponVisualRoot = root;
  }

  private applyDefinitionTuning(): void {
    const tuning = this.definition?.runtimeTuning;
    if (!tuning) return;
    const slot = this.getPrimaryAttackSlot();
    const attackSegments = new Set<string>(this.getAttackRequiredSegments(slot));
    const bodyMassScale = tuning.bodyMassScale ?? 1;
    const weaponMassScale = tuning.weaponMassScale ?? 1;

    for (const [name, joint] of this.skeleton.joints) {
      const scale = attackSegments.has(name) ? bodyMassScale * weaponMassScale : bodyMassScale;
      joint.body.setAdditionalMass(Math.max(0.05, joint.additionalMass * scale), true);
    }

    const staminaMaxMul = tuning.staminaMaxMultiplier ?? 1;
    this.stamina.max = Math.round(100 * staminaMaxMul);
    this.stamina.current = this.stamina.max;
  }

  /**
   * Optional override input source — if set, `applyInput` ignores the
   * InputManager passed in and uses this instead. Used to drive the
   * opponent beast with BotAI while the player beast uses the keyboard.
   */
  inputOverride?: InputManager;

  /** Whether to apply input at all this frame. Match controller may disable
   * during countdown / result screens. */
  inputActive: boolean = true;

  /** Apply player input as physics torques */
  applyInput(input: InputManager, dt: number) {
    const controlsEnabled = this.inputActive;
    const activeInputSource = this.inputOverride || input;
    const src = controlsEnabled ? activeInputSource : (NO_INPUT_SOURCE as any);
    // Bot-driven inputs need beginFixedStep called too
    if (this.inputOverride && typeof (this.inputOverride as any).beginFixedStep === 'function') {
      (this.inputOverride as any).beginFixedStep();
    }
    const attackAvailable = this.hasPrimaryAttackCapability();
    this.attackController?.setAttackAvailable(attackAvailable);
    (this.locoState as any).attackModifiers =
      this.attackController?.getMovementModifiers(src as any) ?? null;
    (this.locoState as any).detachedSegments = this.detachedSegments;
    (this.locoState as any).massOverride = this.getAttachedMass();
    const runtime = this.getRuntimeTuning();
    const stabilityMul = controlsEnabled ? 1 : COUNTDOWN_STABILITY_MULTIPLIER;
    (this.locoState as any).definitionDriveMultiplier =
      (runtime.moveAccelMultiplier ?? 1) * (controlsEnabled ? 1 : 0);
    (this.locoState as any).definitionTurnMultiplier =
      (runtime.turnMultiplier ?? 1) * stabilityMul;
    (this.locoState as any).definitionSupportMultiplier =
      (runtime.supportMultiplier ?? 1) * stabilityMul;
    (this.locoState as any).definitionUprightMultiplier =
      (runtime.uprightMultiplier ?? 1) * stabilityMul;
    (this.locoState as any).definitionRegenMultiplier = runtime.staminaRegenMultiplier ?? 1;
    (this.locoState as any).definitionWalkCostMultiplier = runtime.walkCostMultiplier ?? 1;
    (this.locoState as any).definitionTurnCostMultiplier = runtime.turnCostMultiplier ?? 1;
    const facingAssist = this.computeFacingAssistConfig(activeInputSource as any, controlsEnabled);
    (this.locoState as any).combatTargetYaw = facingAssist?.targetYaw ?? null;
    (this.locoState as any).combatAssistStrength = facingAssist?.strength ?? 0;
    (this.locoState as any).combatAssistMaxRate = facingAssist?.maxRate ?? 0;
    this.locomotionUpdate(this.skeleton as any, src, dt, this.stamina, this.physics, this.locoState);
    this.attackController?.update(src as any, dt, this.stamina);
    this.captureAudioEvents();
  }

  /** Sync visual mesh positions/rotations from physics bodies, apply jiggle */
  syncFromPhysics() {
    const slot = this.getPrimaryAttackSlot();
    const tele = this.getAttackTelemetry();
    const useCustomRig =
      !!slot &&
      !!tele &&
      this.hasCustomAttackRig(slot) &&
      this.areSegmentsAttached(this.getAttackRigSegments(slot));
    for (const [name, joint] of this.skeleton.joints) {
      const mesh = this.visuals.get(name);
      if (!mesh) continue;

      const pos = joint.body.translation();
      const rot = joint.body.rotation();

      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      mesh.scale.setScalar(this.getSegmentBaseScale(name));
      if (slot && tele && !useCustomRig && this.isSegmentAttached(name)) {
        this.applyAttackVisualPose(mesh, name, slot, tele);
      }

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
    if (slot && tele && useCustomRig) {
      this.applyAttackVisualRig(slot, tele);
    }
    this.updateAttackHeatOverlays(slot, tele);
    this.updateAttackTelegraph();
    this.meatMaterial.emissiveIntensity = HIT_FLASH_BASE_INTENSITY + this.getHitFlashStrength();
  }

  /** Get the torso position (for camera follow) */
  getPosition(): THREE.Vector3 {
    const torso = this.skeleton.joints.get('torso');
    if (!torso) return new THREE.Vector3();
    const pos = torso.body.translation();
    return new THREE.Vector3(pos.x, pos.y, pos.z);
  }

  /**
   * Get the beast's current facing yaw in radians.
   * Computed from the torso quaternion's rotation around world Y.
   */
  getYaw(): number {
    const torso = this.skeleton.joints.get('torso');
    if (!torso) return 0;
    const r = torso.body.rotation();
    // yaw = atan2(2*(wy + xz), 1 - 2*(y² + x²)) for rotation around Y
    // Derivation: forward vector after rotation (0,0,1) → (2(xz+wy), ..., 1-2(x²+y²))
    const fx = 2 * (r.x * r.z + r.w * r.y);
    const fz = 1 - 2 * (r.x * r.x + r.y * r.y);
    return Math.atan2(fx, fz);
  }

  /** Whether the beast is currently considered on the ground by locomotion. */
  isGrounded(): boolean {
    return this.locoState.isGrounded;
  }

  /** Current stamina as a fraction [0..1]. */
  getStaminaFraction(): number {
    return this.stamina.current / this.stamina.max;
  }

  /** Get current mass fraction of starting mass (for HP display). */
  getMassPercent(): number {
    return (this.getAttachedMass() / Math.max(0.001, this.initialAttachedMass)) * 100;
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

  getAttackTelemetry(): AttackTelemetry | null {
    return this.remoteAttackTelemetry ?? this.attackController?.getTelemetry() ?? null;
  }

  setRemoteAttackTelemetry(telemetry: AttackTelemetry | null): void {
    this.remoteAttackTelemetry = telemetry;
  }

  resolveActiveAttackForSegment(segment: string, attackerForwardDot: number): ActiveAttackContext | null {
    if (!this.isSegmentAttached(segment) || !this.hasPrimaryAttackCapability()) return null;
    return this.attackController?.resolveActiveHit(segment, attackerForwardDot) ?? null;
  }

  resolveGenericActiveAttack(attackerForwardDot: number): ActiveAttackContext | null {
    if (!this.hasPrimaryAttackCapability()) return null;
    return this.attackController?.resolveGenericActiveHit(attackerForwardDot) ?? null;
  }

  getAttackCommitSerial(): number {
    return this.attackController?.getCommitSerial() ?? 0;
  }

  registerAttackHit(): void {
    this.attackController?.registerConfirmedHit();
  }

  consumeHudEvents(): string[] {
    const out = this.pendingHudEvents;
    this.pendingHudEvents = [];
    return out;
  }

  consumeAudioEvents(): Array<{ type: 'jump' | 'land' | 'miss' }> {
    const out = this.pendingAudioEvents;
    this.pendingAudioEvents = [];
    return out;
  }

  getPrimaryAttackSlot(): AttackSlotDefinition | null {
    return this.definition?.attackSlots?.[0] ?? null;
  }

  getJointBody(name: string): RAPIER.RigidBody | undefined {
    return this.skeleton.joints.get(name)?.body;
  }

  getSegmentWorldPoint(name: string, localOffset?: { x: number; y: number; z: number }): { x: number; y: number; z: number } | null {
    const body = this.getJointBody(name);
    if (!body) return null;
    const p = body.translation();
    if (!localOffset) return { x: p.x, y: p.y, z: p.z };
    const r = body.rotation();
    this.attackTempQuat.set(r.x, r.y, r.z, r.w);
    this.attackTempVec.set(localOffset.x, localOffset.y, localOffset.z).applyQuaternion(this.attackTempQuat);
    return { x: p.x + this.attackTempVec.x, y: p.y + this.attackTempVec.y, z: p.z + this.attackTempVec.z };
  }

  getIncomingBlockReduction(attackerProfile: 'blunt' | 'spike' | 'shield'): number {
    return this.attackController?.getIncomingBlockReduction(attackerProfile) ?? 0;
  }

  setCombatTarget(target: BeastInstance | null): void {
    this.combatTarget = target;
  }

  getKnockbackResistance(): number {
    return this.getRuntimeTuning().knockbackResistance ?? 1;
  }

  flashImpact(intensity: number, durationSec: number = 0.08): void {
    this.hitFlashStrength = Math.max(this.hitFlashStrength, intensity);
    this.hitFlashUntilMs = Math.max(this.hitFlashUntilMs, performance.now() + durationSec * 1000);
  }

  markSegmentDetached(segment: string): void {
    const wasAttackCapable = this.hasPrimaryAttackCapability();
    for (const name of expandDetachedSegments(segment)) {
      this.detachedSegments.add(name);
    }
    const isAttackCapable = this.hasPrimaryAttackCapability();
    if (wasAttackCapable && !isAttackCapable) {
      this.pendingHudEvents.push('DISARMED!');
    }
    this.attackController?.setAttackAvailable(isAttackCapable);
  }

  isSegmentAttached(name: string): boolean {
    return !this.detachedSegments.has(name);
  }

  areSegmentsAttached(names: string[]): boolean {
    return names.every((name) => this.isSegmentAttached(name));
  }

  getAttachedMass(): number {
    let total = 0;
    for (const [name, joint] of this.skeleton.joints) {
      if (!this.isSegmentAttached(name)) continue;
      total += joint.body.mass();
    }
    return total;
  }

  private getRuntimeTuning(): BeastRuntimeTuning {
    return this.definition?.runtimeTuning ?? {};
  }

  private hasPrimaryAttackCapability(): boolean {
    const slot = this.getPrimaryAttackSlot();
    if (!slot) return false;
    return this.areSegmentsAttached(this.getAttackRequiredSegments(slot));
  }

  private getAttackRequiredSegments(slot: AttackSlotDefinition | null): string[] {
    if (!slot) return [];
    return Array.from(
      new Set([
        slot.appendageRoot,
        ...slot.drivenJoints,
        ...(slot.activeBodies ?? slot.hitSegments),
        ...(slot.blockBodies ?? []),
        ...(slot.tipSegment ? [slot.tipSegment] : []),
      ])
    );
  }

  private getAttackRigSegments(slot: AttackSlotDefinition): string[] {
    return Array.from(
      new Set([
        slot.appendageRoot,
        ...slot.drivenJoints,
        ...(slot.activeBodies ?? slot.hitSegments),
      ])
    );
  }

  private getSegmentBaseScale(_name: string): number {
    return this.definition?.runtimeTuning?.bodyVisualScale ?? this.definition?.visuals.bodyScale ?? 1;
  }

  private inferWeaponType(slot: AttackSlotDefinition): 'hammer' | 'spike' | 'shield' | 'headbutt' {
    if (slot.weaponType) return slot.weaponType;
    if (slot.visualRigType === 'headbutt_lunge') return 'headbutt';
    if (slot.profile === 'spike') return 'spike';
    if (slot.profile === 'shield') return 'shield';
    return 'hammer';
  }

  private getWeaponVisualAnchorName(slot: AttackSlotDefinition): string {
    if (slot.weaponSocket === 'head_front' || slot.weaponSocket === 'forebody') {
      return 'torso';
    }
    if (slot.weaponSocket === 'left_arm') {
      return slot.tipSegment ?? slot.activeBodies?.find((name) => name.endsWith('_l')) ?? 'elbow_l';
    }
    if (slot.weaponSocket === 'right_arm') {
      return slot.tipSegment ?? slot.activeBodies?.find((name) => name.endsWith('_r')) ?? 'elbow_r';
    }
    return slot.tipSegment ?? slot.activeBodies?.[0] ?? slot.appendageRoot;
  }

  private getWeaponReachMultiplier(slot: AttackSlotDefinition | null = this.getPrimaryAttackSlot()): number {
    return (this.getRuntimeTuning().weaponReachMultiplier ?? 1) * (slot?.reachMultiplier ?? 1);
  }

  private isQuadruped(): boolean {
    return this.definition?.archetype === 'quadruped';
  }

  private computeFacingAssistConfig(
    input: { isDown(key: string): boolean },
    controlsEnabled: boolean
  ): { targetYaw: number; strength: number; maxRate: number } | null {
    if (!this.combatTarget) return null;
    const selfPos = this.getPosition();
    const targetPos = this.combatTarget.getPosition();
    const dx = targetPos.x - selfPos.x;
    const dz = targetPos.z - selfPos.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return null;
    const targetYaw = Math.atan2(dx, dz);
    const yawDelta = shortestAngle(targetYaw - this.getYaw());
    const facingDot = Math.cos(yawDelta);

    if (!controlsEnabled) {
      return {
        targetYaw,
        strength: COUNTDOWN_FACE_ASSIST_STRENGTH,
        maxRate: COUNTDOWN_FACE_ASSIST_MAX_RATE,
      };
    }

    const tele = this.getAttackTelemetry();
    if (tele && (tele.state === 'WINDUP' || tele.state === 'HELD')) {
      if (facingDot < ATTACK_AIM_ASSIST_ARC_DOT) return null;
      const distanceFactor = Math.max(0, Math.min(1, 1 - Math.max(0, len - 1.2) / 3.4));
      const chargeFactor = 0.8 + tele.chargeNorm * 0.55;
      return {
        targetYaw,
        strength: ATTACK_AIM_ASSIST_STRENGTH * chargeFactor * (0.85 + distanceFactor * 0.35),
        maxRate: ATTACK_AIM_ASSIST_MAX_RATE * (0.8 + distanceFactor * 0.35),
      };
    }

    if (tele && tele.state === 'COMMIT') {
      if (facingDot < COMMIT_AIM_ASSIST_ARC_DOT) return null;
      const distanceFactor = Math.max(0, Math.min(1, 1 - Math.max(0, len - 1.1) / 3.2));
      return {
        targetYaw,
        strength: COMMIT_AIM_ASSIST_STRENGTH * (0.85 + distanceFactor * 0.35),
        maxRate: COMMIT_AIM_ASSIST_MAX_RATE * (0.8 + distanceFactor * 0.3),
      };
    }

    const moving = input.isDown('W') || input.isDown('S');
    const manuallyTurning = input.isDown('A') || input.isDown('D');
    if (moving && !manuallyTurning && facingDot >= MOVE_AIM_ASSIST_ARC_DOT) {
      const distanceFactor = Math.max(0, Math.min(1, 1 - Math.max(0, len - 1.4) / 3.8));
      return {
        targetYaw,
        strength: MOVE_AIM_ASSIST_STRENGTH * (0.7 + distanceFactor * 0.45),
        maxRate: MOVE_AIM_ASSIST_MAX_RATE * (0.75 + distanceFactor * 0.35),
      };
    }

    return null;
  }

  private getHitFlashStrength(): number {
    if (this.hitFlashUntilMs <= 0) return 0;
    const now = performance.now();
    if (now >= this.hitFlashUntilMs) {
      this.hitFlashUntilMs = 0;
      this.hitFlashStrength = 0;
      return 0;
    }
    const remaining = Math.max(0, this.hitFlashUntilMs - now);
    return this.hitFlashStrength * Math.min(1, remaining / 80);
  }

  private updateAttackHeatOverlays(
    slot: AttackSlotDefinition | null,
    tele: AttackTelemetry | null
  ): void {
    const heating =
      !!slot &&
      !!tele &&
      this.hasPrimaryAttackCapability() &&
      (tele.state === 'WINDUP' || tele.state === 'HELD');
    const chargeNorm = tele?.chargeNorm ?? 0;
    const heatOpacity =
      heating
        ? 0.08 + chargeNorm * 0.24 + (tele?.chargeTier === 'heavy' ? 0.1 : 0)
        : 0;

    for (const [name, overlay] of this.attackHeatOverlays) {
      const source = this.visuals.get(name);
      const attached = this.isSegmentAttached(name);
      if (!heating || !source || !attached) {
        overlay.visible = false;
        continue;
      }
      overlay.visible = true;
      overlay.position.copy(source.position);
      overlay.quaternion.copy(source.quaternion);
      overlay.scale.copy(source.scale).multiplyScalar(1.06 + chargeNorm * 0.05);
      const mat = overlay.material as THREE.MeshBasicMaterial;
      mat.opacity = heatOpacity;
      mat.color.setHex(
        tele?.chargeTier === 'heavy'
          ? 0xfff08a
          : tele?.chargeTier === 'ready'
            ? 0xffb04c
            : 0xff7a2f
      );
    }
  }

  private updateAttackTelegraph(): void {
    if (!this.definition?.attackSlots?.length) {
      if (this.attackIndicatorGroup) this.attackIndicatorGroup.visible = false;
      return;
    }
    const slot = this.definition.attackSlots[0];
    if (!slot) return;
    const tele = this.getAttackTelemetry();
    if (!tele) {
      if (this.attackIndicatorGroup) this.attackIndicatorGroup.visible = false;
      return;
    }
    if (
      !this.attackIndicatorGroup ||
      tele.state === 'IDLE' ||
      tele.state === 'RECOVER' ||
      !this.hasPrimaryAttackCapability()
    ) {
      if (this.attackIndicatorGroup) this.attackIndicatorGroup.visible = false;
      return;
    }

    const anchorName = slot.tipSegment ?? slot.activeBodies?.[0] ?? slot.appendageRoot;
    if (!this.isSegmentAttached(anchorName)) {
      this.attackIndicatorGroup.visible = false;
      return;
    }
    const anchorPoint =
      this.getSegmentWorldPoint(slot.tipSegment ?? slot.appendageRoot, slot.tipLocalOffset) ??
      this.getSegmentWorldPoint(anchorName);
    if (!anchorPoint) {
      this.attackIndicatorGroup.visible = false;
      return;
    }

    const now = performance.now();
    const pulse = tele.state === 'HELD' ? 0.95 + 0.18 * Math.sin(now * 0.024) : 0.84 + tele.stateProgress * 0.22;
    const reachMul = this.getWeaponReachMultiplier(slot);
    const heavyBoost = tele.chargeTier === 'heavy' ? 1.35 : tele.chargeTier === 'ready' ? 1.05 : 0.86;
    const hueColor =
      tele.chargeTier === 'heavy' ? 0xfff2aa :
      tele.chargeTier === 'ready' ? 0xffc85a :
      0xff9d52;

    this.attackIndicatorGroup.visible = true;
    this.attackIndicatorGroup.position.set(anchorPoint.x, anchorPoint.y, anchorPoint.z);
    if (this.attackIndicatorFlare) {
      this.attackIndicatorFlare.scale.setScalar((0.9 + tele.chargeNorm * 1.1) * pulse * reachMul);
      const mat = this.attackIndicatorFlare.material as THREE.SpriteMaterial;
      mat.color.setHex(hueColor);
      mat.opacity = tele.state === 'HELD' ? 0.45 + tele.chargeNorm * 0.35 : 0.24 + tele.stateProgress * 0.22;
    }
    if (this.attackIndicatorStreak) {
      this.attackIndicatorStreak.scale.set(
        (1.1 + tele.chargeNorm * 1.4) * heavyBoost * reachMul,
        0.24 + tele.chargeNorm * 0.24,
        1
      );
      this.attackIndicatorStreak.material.rotation = (now * 0.0018) % (Math.PI * 2);
      const mat = this.attackIndicatorStreak.material as THREE.SpriteMaterial;
      mat.color.setHex(tele.chargeTier === 'heavy' ? 0xffdd8c : 0xffb14b);
      mat.opacity = 0.12 + tele.chargeNorm * 0.22;
    }
    if (this.attackIndicatorBloom) {
      this.attackIndicatorBloom.scale.setScalar((1.35 + tele.chargeNorm * 1.9) * heavyBoost * reachMul);
      const mat = this.attackIndicatorBloom.material as THREE.SpriteMaterial;
      mat.color.setHex(tele.chargeTier === 'heavy' ? 0xfff3c8 : 0xffd18a);
      mat.opacity = tele.chargeTier === 'heavy' ? 0.2 + tele.chargeNorm * 0.16 : 0.08 + tele.chargeNorm * 0.1;
    }
  }

  private captureAudioEvents(): void {
    const grounded = !!this.locoState.isGrounded;
    const jumpTimer = typeof this.locoState.jumpTimer === 'number' ? this.locoState.jumpTimer : null;

    if (this.prevGroundedForAudio !== null) {
      if (this.prevGroundedForAudio === false && grounded === true) {
        this.pendingAudioEvents.push({ type: 'land' });
      }
      if (
        jumpTimer !== null &&
        this.prevJumpTimerForAudio !== null &&
        this.prevJumpTimerForAudio > 0.08 &&
        jumpTimer < 0.02
      ) {
        this.pendingAudioEvents.push({ type: 'jump' });
      }
    }

    const missTier = this.attackController?.consumePendingMissTier();
    if (missTier) {
      this.pendingAudioEvents.push({ type: 'miss' });
      if (missTier === 'ready' || missTier === 'heavy') {
        this.pendingHudEvents.push('WHIFF!');
      }
    }

    this.prevGroundedForAudio = grounded;
    this.prevJumpTimerForAudio = jumpTimer;
  }

  private applyAttackVisualRig(
    slot: AttackSlotDefinition,
    tele: AttackTelemetry
  ) {
    if (!this.areSegmentsAttached(this.getAttackRigSegments(slot))) return;
    const rigType = slot.visualRigType ?? 'generic';
    if (rigType === 'overhand_smash') {
      this.applyConnectedOverhandSmashVisual(slot, tele);
      return;
    }
    if (rigType === 'arm_chain_spike') {
      this.applyConnectedArmChainSpikeVisual(slot, tele);
      return;
    }
    if (rigType === 'forequarters_shove') {
      this.applyForequartersShoveVisual(slot, tele);
      return;
    }
    if (rigType === 'headbutt_lunge') {
      this.applyHeadbuttLungeVisual(slot, tele);
    }
  }

  private applyConnectedOverhandSmashVisual(
    slot: AttackSlotDefinition,
    tele: AttackTelemetry
  ): void {
    if (slot.visualRigType !== 'overhand_smash' || tele.state === 'IDLE') {
      return;
    }
    const side = slot.appendageRoot.endsWith('_l') ? -1 : 1;
    const shoulderName = slot.drivenJoints.find((name) => name.startsWith('shoulder')) ?? `shoulder_${side > 0 ? 'r' : 'l'}`;
    const elbowName = slot.drivenJoints.find((name) => name.startsWith('elbow')) ?? `elbow_${side > 0 ? 'r' : 'l'}`;
    if (!this.areSegmentsAttached([shoulderName, elbowName])) return;

    const torsoBody = this.getJointBody('torso');
    const shoulderMesh = this.visuals.get(shoulderName);
    const elbowMesh = this.visuals.get(elbowName);
    if (!torsoBody || !shoulderMesh || !elbowMesh) return;

    const torsoPos = torsoBody.translation();
    const torsoRot = torsoBody.rotation();
    this.attackTempQuat.set(torsoRot.x, torsoRot.y, torsoRot.z, torsoRot.w);

    const shoulderAnchorLocal = this.attackTempVec.set(0.34 * side, 0.18, 0.02);
    const shoulderAnchorWorld = this.attackTempVec2
      .copy(shoulderAnchorLocal)
      .applyQuaternion(this.attackTempQuat)
      .add(new THREE.Vector3(torsoPos.x, torsoPos.y, torsoPos.z));

    const upperRest = new THREE.Vector3(0.52 * side, -0.84, 0.12);
    const upperWindup = new THREE.Vector3(0.16 * side, 0.92, 0.36);
    const upperStrike = new THREE.Vector3(0.08 * side, -0.5, 0.86);

    const lowerRest = new THREE.Vector3(0.48 * side, -0.86, 0.16);
    const lowerWindup = new THREE.Vector3(0.1 * side, 0.96, 0.24);
    const lowerStrike = new THREE.Vector3(0.06 * side, -0.78, 0.62);

    let upperDir = new THREE.Vector3();
    let lowerDir = new THREE.Vector3();
    if (tele.state === 'WINDUP') {
      upperDir = upperRest.clone().lerp(upperWindup, tele.stateProgress);
      lowerDir = lowerRest.clone().lerp(lowerWindup, tele.stateProgress);
    } else if (tele.state === 'HELD') {
      const pulse = 0.05 * Math.sin(performance.now() * 0.02);
      upperDir = upperWindup.clone().add(new THREE.Vector3(0, pulse, pulse * 0.5));
      lowerDir = lowerWindup.clone().add(new THREE.Vector3(0, pulse, pulse * 0.4));
    } else if (tele.state === 'COMMIT') {
      const t = Math.max(tele.stateProgress, 0.25);
      upperDir = upperWindup.clone().lerp(upperStrike, t);
      lowerDir = lowerWindup.clone().lerp(lowerStrike, t);
    } else {
      upperDir = upperStrike.clone().lerp(upperRest, tele.stateProgress);
      lowerDir = lowerStrike.clone().lerp(lowerRest, tele.stateProgress);
    }

    upperDir.normalize().applyQuaternion(this.attackTempQuat);
    lowerDir.normalize().applyQuaternion(this.attackTempQuat);

    const upperLen = 0.36;
    const lowerLen = 0.34;
    const elbowAnchorWorld = this.attackTempVec3
      .copy(upperDir)
      .multiplyScalar(upperLen * 0.92)
      .add(shoulderAnchorWorld);

    shoulderMesh.position.copy(
      this.attackTempVec
        .copy(upperDir)
        .multiplyScalar(upperLen * 0.46)
        .add(shoulderAnchorWorld)
    );
    shoulderMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), upperDir);
    elbowMesh.position.copy(
      this.attackTempVec2
        .copy(lowerDir)
        .multiplyScalar(lowerLen * 0.44)
        .add(elbowAnchorWorld)
    );
    elbowMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lowerDir);

    const scaleBoost = tele.state === 'COMMIT' ? 1.22 : 1.1 + tele.chargeNorm * 0.08;
    shoulderMesh.scale.setScalar(this.getSegmentBaseScale(shoulderName) * scaleBoost);
    elbowMesh.scale.setScalar(this.getSegmentBaseScale(elbowName) * scaleBoost * 1.02);
  }

  private applyConnectedArmChainSpikeVisual(
    slot: AttackSlotDefinition,
    tele: AttackTelemetry
  ): void {
    if (slot.visualRigType !== 'arm_chain_spike' || tele.state === 'IDLE') return;
    const side = slot.appendageRoot.endsWith('_r') ? 1 : -1;
    const shoulderName = slot.drivenJoints.find((name) => name.startsWith('shoulder')) ?? `shoulder_${side > 0 ? 'r' : 'l'}`;
    const elbowName = slot.drivenJoints.find((name) => name.startsWith('elbow')) ?? `elbow_${side > 0 ? 'r' : 'l'}`;
    if (!this.areSegmentsAttached([shoulderName, elbowName])) return;

    const torsoBody = this.getJointBody('torso');
    const shoulderMesh = this.visuals.get(shoulderName);
    const elbowMesh = this.visuals.get(elbowName);
    if (!torsoBody || !shoulderMesh || !elbowMesh) return;

    const torsoPos = torsoBody.translation();
    const torsoRot = torsoBody.rotation();
    this.attackTempQuat.set(torsoRot.x, torsoRot.y, torsoRot.z, torsoRot.w);

    const shoulderAnchorLocal = this.attackTempVec.set(0.32 * side, 0.18, 0.05);
    const shoulderAnchorWorld = this.attackTempVec2
      .copy(shoulderAnchorLocal)
      .applyQuaternion(this.attackTempQuat)
      .add(new THREE.Vector3(torsoPos.x, torsoPos.y, torsoPos.z));

    const upperRest = new THREE.Vector3(0.32 * side, -0.88, 0.06);
    const upperWindup = new THREE.Vector3(0.18 * side, 0.94, 0.28);
    const upperStrike = new THREE.Vector3(0.08 * side, -0.06, 1.08);

    const lowerRest = new THREE.Vector3(0.42 * side, -0.88, 0.12);
    const lowerWindup = new THREE.Vector3(0.08 * side, 0.98, 0.3);
    const lowerStrike = new THREE.Vector3(0.04 * side, -0.02, 1.2);

    let upperDir = new THREE.Vector3();
    let lowerDir = new THREE.Vector3();
    if (tele.state === 'WINDUP') {
      upperDir = upperRest.clone().lerp(upperWindup, tele.stateProgress);
      lowerDir = lowerRest.clone().lerp(lowerWindup, tele.stateProgress);
    } else if (tele.state === 'HELD') {
      upperDir = upperWindup.clone();
      lowerDir = lowerWindup.clone();
    } else if (tele.state === 'COMMIT') {
      const t = Math.max(tele.stateProgress, 0.2);
      upperDir = upperWindup.clone().lerp(upperStrike, t);
      lowerDir = lowerWindup.clone().lerp(lowerStrike, t);
    } else {
      upperDir = upperStrike.clone().lerp(upperRest, tele.stateProgress);
      lowerDir = lowerStrike.clone().lerp(lowerRest, tele.stateProgress);
    }

    upperDir.normalize().applyQuaternion(this.attackTempQuat);
    lowerDir.normalize().applyQuaternion(this.attackTempQuat);

    const upperLen = 0.36;
    const lowerLen = 0.34;
    const elbowAnchorWorld = this.attackTempVec3
      .copy(upperDir)
      .multiplyScalar(upperLen * 0.92)
      .add(shoulderAnchorWorld);

    shoulderMesh.position.copy(
      this.attackTempVec.copy(upperDir).multiplyScalar(upperLen * 0.46).add(shoulderAnchorWorld)
    );
    shoulderMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), upperDir);
    elbowMesh.position.copy(
      this.attackTempVec2.copy(lowerDir).multiplyScalar(lowerLen * 0.44).add(elbowAnchorWorld)
    );
    elbowMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lowerDir);

    const scaleBoost = tele.state === 'COMMIT' ? 1.16 : 1.08 + tele.chargeNorm * 0.08;
    shoulderMesh.scale.setScalar(this.getSegmentBaseScale(shoulderName) * scaleBoost);
    elbowMesh.scale.setScalar(this.getSegmentBaseScale(elbowName) * scaleBoost * 1.03);
  }

  private applyForequartersShoveVisual(
    slot: AttackSlotDefinition,
    tele: AttackTelemetry
  ): void {
    if (slot.visualRigType !== 'forequarters_shove' || tele.state === 'IDLE') return;
    if (!this.areSegmentsAttached(['torso', 'hip_fl', 'hip_fr', 'knee_fl', 'knee_fr'])) return;

    const torsoBody = this.getJointBody('torso');
    const torsoMesh = this.visuals.get('torso');
    const frontHipL = this.visuals.get('hip_fl');
    const frontHipR = this.visuals.get('hip_fr');
    const frontKneeL = this.visuals.get('knee_fl');
    const frontKneeR = this.visuals.get('knee_fr');
    if (!torsoBody || !torsoMesh || !frontHipL || !frontHipR || !frontKneeL || !frontKneeR) return;

    const torsoPos = torsoBody.translation();
    const torsoRot = torsoBody.rotation();
    this.attackTempQuat.set(torsoRot.x, torsoRot.y, torsoRot.z, torsoRot.w);

    let chestLift = 0;
    let chestBack = 0;
    let chestPitch = 0;
    let hipTuck = 0;
    let kneeTuck = 0;

    if (tele.state === 'WINDUP') {
      chestLift = 0.18 * tele.stateProgress;
      chestBack = -0.16 * tele.stateProgress;
      chestPitch = 0.55 * tele.stateProgress;
      hipTuck = 0.14 * tele.stateProgress;
      kneeTuck = 0.18 * tele.stateProgress;
    } else if (tele.state === 'HELD') {
      chestLift = 0.18;
      chestBack = -0.16;
      chestPitch = 0.55;
      hipTuck = 0.14;
      kneeTuck = 0.18;
    } else if (tele.state === 'COMMIT') {
      const t = Math.max(tele.stateProgress, 0.2);
      chestLift = this.lerp(0.18, 0.04, t);
      chestBack = this.lerp(-0.16, 0.28, t);
      chestPitch = this.lerp(0.55, -0.42, t);
      hipTuck = this.lerp(0.14, -0.08, t);
      kneeTuck = this.lerp(0.18, -0.1, t);
    } else {
      chestLift = this.lerp(0.04, 0, tele.stateProgress);
      chestBack = this.lerp(0.22, 0, tele.stateProgress);
      chestPitch = this.lerp(-0.3, 0, tele.stateProgress);
      hipTuck = this.lerp(-0.08, 0, tele.stateProgress);
      kneeTuck = this.lerp(-0.08, 0, tele.stateProgress);
    }

    this.attackTempVec.set(0, chestLift, chestBack).applyQuaternion(this.attackTempQuat);
    torsoMesh.position.add(this.attackTempVec);
    this.attackTempQuat.setFromAxisAngle(this.attackTempVec2.set(1, 0, 0), chestPitch);
    torsoMesh.quaternion.multiply(this.attackTempQuat);
    torsoMesh.scale.setScalar(this.getSegmentBaseScale('torso') * (tele.state === 'COMMIT' ? 1.12 : 1.05));

    const frontOffset = 0.1;
    const hipLift = 0.08 + Math.max(0, hipTuck);
    for (const [mesh, side] of [
      [frontHipL, -1],
      [frontHipR, 1],
      [frontKneeL, -1],
      [frontKneeR, 1],
    ] as const) {
      const lateral = side * (mesh === frontHipL || mesh === frontHipR ? 0.04 : 0.02);
      const forward = mesh === frontHipL || mesh === frontHipR ? frontOffset + hipTuck : frontOffset * 0.6 + kneeTuck;
      const vertical = mesh === frontHipL || mesh === frontHipR ? hipLift : hipLift * 0.75;
      this.attackTempVec.set(lateral, vertical, forward).applyQuaternion(mesh.quaternion);
      mesh.position.add(this.attackTempVec);
      mesh.scale.setScalar(
        this.getSegmentBaseScale(mesh === frontHipL || mesh === frontHipR ? 'hip_fl' : 'knee_fl') *
          (tele.state === 'COMMIT' ? 1.08 : 1.04)
      );
    }
  }

  private applyHeadbuttLungeVisual(
    slot: AttackSlotDefinition,
    tele: AttackTelemetry
  ): void {
    if (slot.visualRigType !== 'headbutt_lunge' || tele.state === 'IDLE') return;
    if (!this.areSegmentsAttached(['torso', 'hip_fl', 'hip_fr', 'knee_fl', 'knee_fr'])) return;

    const torsoBody = this.getJointBody('torso');
    const torsoMesh = this.visuals.get('torso');
    const frontHipL = this.visuals.get('hip_fl');
    const frontHipR = this.visuals.get('hip_fr');
    const frontKneeL = this.visuals.get('knee_fl');
    const frontKneeR = this.visuals.get('knee_fr');
    if (!torsoBody || !torsoMesh || !frontHipL || !frontHipR || !frontKneeL || !frontKneeR) return;

    const torsoRot = torsoBody.rotation();
    this.attackTempQuat.set(torsoRot.x, torsoRot.y, torsoRot.z, torsoRot.w);

    let headDrop = 0;
    let headDrive = 0;
    let pitch = 0;
    let brace = 0;
    if (tele.state === 'WINDUP') {
      headDrop = 0.1 * tele.stateProgress;
      headDrive = -0.18 * tele.stateProgress;
      pitch = 0.72 * tele.stateProgress;
      brace = 0.12 * tele.stateProgress;
    } else if (tele.state === 'HELD') {
      headDrop = 0.1;
      headDrive = -0.18;
      pitch = 0.72;
      brace = 0.12;
    } else if (tele.state === 'COMMIT') {
      const t = Math.max(tele.stateProgress, 0.22);
      headDrop = this.lerp(0.1, 0.02, t);
      headDrive = this.lerp(-0.18, 0.42, t);
      pitch = this.lerp(0.72, -0.28, t);
      brace = this.lerp(0.12, -0.05, t);
    } else {
      headDrop = this.lerp(0.02, 0, tele.stateProgress);
      headDrive = this.lerp(0.18, 0, tele.stateProgress);
      pitch = this.lerp(-0.18, 0, tele.stateProgress);
      brace = this.lerp(-0.03, 0, tele.stateProgress);
    }

    this.attackTempVec.set(0, -headDrop, headDrive).applyQuaternion(this.attackTempQuat);
    torsoMesh.position.add(this.attackTempVec);
    this.attackTempQuat.setFromAxisAngle(this.attackTempVec2.set(1, 0, 0), pitch);
    torsoMesh.quaternion.multiply(this.attackTempQuat);
    torsoMesh.scale.setScalar(this.getSegmentBaseScale('torso') * (tele.state === 'COMMIT' ? 1.14 : 1.06));

    for (const [mesh, side, segmentName] of [
      [frontHipL, -1, 'hip_fl'],
      [frontHipR, 1, 'hip_fr'],
      [frontKneeL, -1, 'knee_fl'],
      [frontKneeR, 1, 'knee_fr'],
    ] as const) {
      const lateral = side * (segmentName.startsWith('hip_') ? 0.03 : 0.02);
      const vertical = segmentName.startsWith('hip_') ? 0.1 + brace : 0.06 + brace * 0.7;
      const forward = segmentName.startsWith('hip_') ? -0.04 + brace : -0.01 + brace * 0.8;
      this.attackTempVec.set(lateral, vertical, forward).applyQuaternion(mesh.quaternion);
      mesh.position.add(this.attackTempVec);
      mesh.scale.setScalar(
        this.getSegmentBaseScale(segmentName) * (tele.state === 'COMMIT' ? 1.1 : 1.04)
      );
    }
  }

  private applyAttackVisualPose(
    mesh: THREE.Mesh,
    name: string,
    slot: AttackSlotDefinition,
    tele: AttackTelemetry
  ): void {
    if (!slot.drivenJoints.includes(name)) return;
    if (tele.state === 'IDLE') return;
    if (!this.isSegmentAttached(name)) return;

    let poseAngle = 0;
    if (tele.state === 'WINDUP') {
      poseAngle = (slot.windupPose[name] ?? 0) * tele.stateProgress;
    } else if (tele.state === 'HELD') {
      poseAngle = slot.windupPose[name] ?? 0;
    } else if (tele.state === 'COMMIT') {
      const from = slot.windupPose[name] ?? 0;
      const to = slot.strikePose[name] ?? from;
      poseAngle = this.lerp(from, to, Math.max(tele.stateProgress, 0.35));
    } else if (tele.state === 'RECOVER') {
      const from = slot.recoverPose[name] ?? slot.strikePose[name] ?? 0;
      poseAngle = this.lerp(from, 0, tele.stateProgress);
    }

    const axis = this.getAttackVisualAxis(name);
    if (!axis) return;

    const exaggeration =
      name.startsWith('shoulder') ? 2.05 :
      name.startsWith('elbow') ? 2.35 :
      0.9;
    this.attackTempQuat.setFromAxisAngle(axis, poseAngle * exaggeration);
    mesh.quaternion.multiply(this.attackTempQuat);

    const lift =
      (name.startsWith('elbow') ? 0.18 : 0.11) * Math.abs(poseAngle) +
      (tele.state === 'COMMIT' ? 0.12 : 0.03);
    const lateralBase = (name.endsWith('_r') ? 1 : name.endsWith('_l') ? -1 : 0) * Math.abs(poseAngle) * 0.15;
    const forward =
      tele.state === 'COMMIT'
        ? 0.3 * Math.abs(poseAngle)
        : tele.state === 'HELD' || tele.state === 'WINDUP'
          ? -0.2 * Math.abs(poseAngle)
          : 0;
    this.attackTempVec.set(lateralBase, lift, forward).applyQuaternion(mesh.quaternion);
    mesh.position.add(this.attackTempVec);

    const scaleBoost = tele.state === 'COMMIT' ? 1.32 : 1.14 + tele.chargeNorm * 0.14;
    mesh.scale.setScalar(this.getSegmentBaseScale(name) * scaleBoost);
  }

  private getAttackVisualAxis(name: string): THREE.Vector3 | null {
    if (name.startsWith('shoulder')) return this.attackTempVec2.set(0, 0, 1);
    if (
      name.startsWith('elbow') ||
      name.startsWith('hip_') ||
      name.startsWith('knee_') ||
      name.startsWith('ankle_')
    ) {
      return this.attackTempVec2.set(1, 0, 0);
    }
    return null;
  }

  private hasCustomAttackRig(slot: AttackSlotDefinition): boolean {
    const rigType = slot.visualRigType ?? 'generic';
    return rigType !== 'generic';
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * Math.max(0, Math.min(1, t));
  }
}

function expandDetachedSegments(root: string): string[] {
  const out = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (out.has(next)) continue;
    out.add(next);
    for (const child of DETACH_CASCADE[next] ?? []) {
      queue.push(child);
    }
  }
  return [...out];
}

function shortestAngle(delta: number): number {
  let out = delta;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
}
