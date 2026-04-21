import type RAPIER from '@dimforge/rapier3d-compat';
import { ATTACK_PROFILES, getChargeCostLerp, getChargeDamageMul, getChargeKnockbackMul, getChargeTier } from './attack-profiles';
import type {
  ActiveAttackContext,
  AttackMovementModifiers,
  AttackSlotDefinition,
  AttackState,
  AttackTelemetry,
  ChargeTier,
} from './attack-types';

interface InputLike {
  isDown(key: string): boolean;
  justPressed(key: string): boolean;
  justReleased(key: string): boolean;
}

interface SkeletonLike {
  joints: Map<string, { name: string; body: RAPIER.RigidBody; joint?: RAPIER.RevoluteImpulseJoint }>;
  pelvis: RAPIER.RigidBody;
}

const ATTACK_RAISE_KEY = 'J';
const ATTACK_COMMIT_KEY = 'K';
const POSE_STIFFNESS = 64;
const POSE_DAMPING = 10;

const BASELINE_APPENDAGE_MASS = 1.6;

export class AttackController {
  private state: AttackState = 'IDLE';
  private stateTimer = 0;
  private holdTimer = 0;
  private commitActiveLeft = 0;
  private commitVisualLeft = 0;
  private commitVisualDuration = 0;
  private commitTier: ChargeTier = 'quick';
  private massScale = 1;
  private appendageMassMul = 1;
  private recoverScale = 1;
  private commitSerial = 0;
  private hitRegisteredThisCommit = false;
  private pendingMiss = false;

  constructor(
    private readonly skeleton: SkeletonLike,
    private readonly slot: AttackSlotDefinition
  ) {
    this.recomputeMassScaling();
  }

  update(input: InputLike, dt: number, stamina: { current: number; max: number }): void {
    this.recomputeMassScaling();
    this.stateTimer += dt;
    const raiseHeld = input.isDown(ATTACK_RAISE_KEY);
    const raiseReleased = input.justReleased(ATTACK_RAISE_KEY) || !raiseHeld;
    const commitRequested =
      input.justPressed(ATTACK_COMMIT_KEY) ||
      (input.isDown(ATTACK_COMMIT_KEY) && this.state !== 'IDLE' && this.stateTimer >= 0.05);

    switch (this.state) {
      case 'IDLE': {
        if (raiseHeld && stamina.current > 1) {
          this.enterState('WINDUP');
        }
        break;
      }
      case 'WINDUP': {
        const windupNorm = Math.min(1, this.stateTimer / Math.max(0.01, this.slot.windupTime * this.massScale));
        this.applyPose(this.slot.windupPose, windupNorm);
        if (raiseReleased) {
          this.enterState('RECOVER');
          break;
        }
        if (windupNorm >= 1) {
          this.enterState('HELD');
        }
        break;
      }
      case 'HELD': {
        this.holdTimer = Math.min(this.slot.maxChargeTime, this.holdTimer + dt);
        stamina.current = Math.max(0, stamina.current - this.slot.holdDrainPerSec * this.massScale * dt);
        this.applyPose(this.slot.windupPose, 1);
        if (raiseReleased || stamina.current <= 0) {
          this.enterState('RECOVER');
          break;
        }
        if (commitRequested) {
          this.enterCommit(stamina);
        }
        break;
      }
      case 'COMMIT': {
        this.commitActiveLeft = Math.max(0, this.commitActiveLeft - dt);
        this.commitVisualLeft = Math.max(0, this.commitVisualLeft - dt);
        this.applyPose(this.slot.strikePose, 1);
        if (this.commitVisualLeft <= 0) {
          if (!this.hitRegisteredThisCommit) {
            this.pendingMiss = true;
          }
          this.enterState('RECOVER');
        }
        break;
      }
      case 'RECOVER': {
        this.applyPose(this.slot.recoverPose, 1);
        const recoverTime = this.slot.recoverTime * this.recoverScale;
        if (this.stateTimer >= recoverTime) {
          this.enterState('IDLE');
        }
        break;
      }
    }
  }

  getTelemetry(): AttackTelemetry {
    const holdSeconds = this.getCommittedHoldSeconds();
    const activeWindow = ATTACK_PROFILES[this.slot.profile].activeWindow;
    let stateProgress = 0;
    if (this.state === 'WINDUP') {
      stateProgress = Math.min(1, this.stateTimer / Math.max(0.01, this.slot.windupTime * this.massScale));
    } else if (this.state === 'HELD') {
      stateProgress = 1;
    } else if (this.state === 'COMMIT') {
      stateProgress = Math.min(1, this.stateTimer / Math.max(0.01, this.commitVisualDuration || activeWindow));
    } else if (this.state === 'RECOVER') {
      stateProgress = Math.min(1, this.stateTimer / Math.max(0.01, this.slot.recoverTime * this.recoverScale));
    }
    return {
      state: this.state,
      profile: this.slot.profile,
      chargeNorm: Math.min(1, holdSeconds / Math.max(0.001, this.slot.maxChargeTime)),
      chargeTier: getChargeTier(holdSeconds),
      holdSeconds,
      isBlocking: this.isBlocking(),
      stateProgress,
      visualRigType: this.slot.visualRigType ?? 'generic',
    };
  }

  getState(): AttackState {
    return this.state;
  }

  getCommitSerial(): number {
    return this.commitSerial;
  }

  getMovementModifiers(input?: InputLike): AttackMovementModifiers | null {
    const effectiveState =
      this.state === 'IDLE' && input?.isDown(ATTACK_RAISE_KEY)
        ? 'WINDUP'
        : this.state;
    if (effectiveState === 'IDLE') return null;

    const braceDrive = this.slot.braceDriveMultiplier ?? 0.58;
    const braceTurn = this.slot.braceTurnMultiplier ?? 1.45;
    const braceSupport = this.slot.braceSupportMultiplier ?? 1.15;
    const braceUpright = this.slot.braceUprightMultiplier ?? 1.18;
    const braceBrake = this.slot.braceBrakeMultiplier ?? 1.45;

    if (effectiveState === 'WINDUP' || effectiveState === 'HELD') {
      return {
        driveMultiplier: braceDrive,
        turnMultiplier: braceTurn,
        supportMultiplier: braceSupport,
        uprightMultiplier: braceUpright,
        brakeMultiplier: braceBrake,
        jumpLocked: true,
      };
    }

    if (effectiveState === 'COMMIT') {
      return {
        driveMultiplier: 0.72,
        turnMultiplier: 0.92,
        supportMultiplier: 1.08,
        uprightMultiplier: 1.08,
        brakeMultiplier: 1.08,
        jumpLocked: true,
      };
    }

    return {
      driveMultiplier: 0.84,
      turnMultiplier: 1.0,
      supportMultiplier: 1.02,
      uprightMultiplier: 1.02,
      brakeMultiplier: 1.08,
      jumpLocked: false,
    };
  }

  registerConfirmedHit(): void {
    if (this.state === 'COMMIT') {
      this.hitRegisteredThisCommit = true;
    }
  }

  consumePendingMiss(): boolean {
    if (!this.pendingMiss) return false;
    this.pendingMiss = false;
    return true;
  }

  getVisualPoseSnapshot():
    | {
        pose: Record<string, number>;
        exaggeration: number;
      }
    | null {
    if (this.state === 'IDLE') return null;

    if (this.state === 'WINDUP') {
      const windupNorm = Math.min(1, this.stateTimer / Math.max(0.01, this.slot.windupTime * this.massScale));
      return {
        pose: this.scalePose(this.slot.windupPose, windupNorm),
        exaggeration: 0.85 + windupNorm * 0.65,
      };
    }

    if (this.state === 'HELD') {
      const pulse = 1 + 0.08 * Math.sin(performance.now() * 0.018);
      return {
        pose: this.scalePose(this.slot.windupPose, 1.2 * pulse),
        exaggeration: 1.25,
      };
    }

    if (this.state === 'COMMIT') {
      return {
        pose: this.scalePose(this.slot.strikePose, 1),
        exaggeration: 1.2,
      };
    }

    const recoverNorm = 1 - Math.min(1, this.stateTimer / Math.max(0.01, this.slot.recoverTime * this.recoverScale));
    return {
      pose: this.scalePose(this.slot.recoverPose, recoverNorm),
      exaggeration: 0.7 + recoverNorm * 0.35,
    };
  }

  resolveActiveHit(segment: string, attackerForwardDot: number): ActiveAttackContext | null {
    if (this.state !== 'COMMIT' || this.commitActiveLeft <= 0) return null;
    if (!this.getActiveBodies().includes(segment)) return null;
    return this.buildActiveContext(attackerForwardDot);
  }

  resolveGenericActiveHit(attackerForwardDot: number): ActiveAttackContext | null {
    if (this.state !== 'COMMIT' || this.commitActiveLeft <= 0) return null;
    if (this.slot.profile === 'spike') return null;
    return this.buildActiveContext(attackerForwardDot);
  }

  private buildActiveContext(attackerForwardDot: number): ActiveAttackContext {
    const profileData = ATTACK_PROFILES[this.slot.profile];
    const chargeHeldSec = this.getCommittedHoldSeconds();
    const chargeTier = this.commitTier;
    const chargeNorm = Math.min(1, chargeHeldSec / Math.max(0.001, this.slot.maxChargeTime));
    const quality = this.computeHitQuality(attackerForwardDot);
    return {
      slotId: this.slot.id,
      profile: this.slot.profile,
      state: this.state,
      chargeTier,
      chargeNorm,
      chargeHeldSec,
      appendageMassMul: this.appendageMassMul,
      damageMul:
        profileData.damageMul *
        getChargeDamageMul(chargeTier) *
        this.lerp(this.slot.damageMulLight, this.slot.damageMulHeavy, chargeNorm),
      knockbackMul:
        profileData.knockbackMul *
        getChargeKnockbackMul(chargeTier) *
        this.slot.knockbackMul,
      blockReduction: profileData.blockReduction,
      isBlocking: false,
      hitQualityMul: quality,
    };
  }

  getIncomingBlockReduction(attackerProfile: 'blunt' | 'spike' | 'shield'): number {
    if (!this.isBlocking()) return 0;
    const base = ATTACK_PROFILES.shield.blockReduction;
    if (attackerProfile === 'spike') return Math.max(0.2, base - 0.1);
    if (attackerProfile === 'blunt') return base + 0.05;
    return base;
  }

  private enterState(next: AttackState): void {
    this.state = next;
    this.stateTimer = 0;
    if (next === 'IDLE') {
      this.holdTimer = 0;
      this.commitActiveLeft = 0;
      this.commitVisualLeft = 0;
      this.commitVisualDuration = 0;
      this.commitTier = 'quick';
      this.pendingMiss = false;
      this.hitRegisteredThisCommit = false;
    }
    if (next === 'RECOVER') {
      this.commitActiveLeft = 0;
      this.commitVisualLeft = 0;
    }
  }

  private enterCommit(stamina: { current: number }): void {
    const holdSeconds = this.getCommittedHoldSeconds();
    const chargeNorm = Math.min(1, holdSeconds / Math.max(0.001, this.slot.maxChargeTime));
    const tier = getChargeTier(holdSeconds);
    const cost = this.lerp(this.slot.strikeCostLight, this.slot.strikeCostHeavy, getChargeCostLerp(tier)) * this.appendageMassMul;
    if (stamina.current < cost) {
      this.enterState('RECOVER');
      return;
    }
    stamina.current = Math.max(0, stamina.current - cost);

    this.commitTier = tier;
    this.state = 'COMMIT';
    this.stateTimer = 0;
    this.commitActiveLeft = ATTACK_PROFILES[this.slot.profile].activeWindow;
    this.commitVisualDuration =
      ATTACK_PROFILES[this.slot.profile].activeWindow +
      (this.slot.profile === 'spike' ? 0.08 : 0.14);
    this.commitVisualLeft = this.commitVisualDuration;
    this.commitSerial += 1;
    this.hitRegisteredThisCommit = false;

    const commitImpulseMul =
      tier === 'heavy' ? 1.28 :
      tier === 'ready' ? 1.12 :
      1;
    const lungeForward =
      this.lerp(this.slot.rootLungeForward * 0.7, this.slot.rootLungeForward, chargeNorm) *
      commitImpulseMul;
    const lungeUp =
      this.lerp(this.slot.rootLungeUp * 0.65, this.slot.rootLungeUp, chargeNorm) *
      (this.slot.profile === 'shield' ? 0.96 : 1.04);
    const forward = this.getPelvisForward();
    const pelvis = this.skeleton.pelvis;
    const mass = pelvis.mass();
    pelvis.applyImpulse(
      { x: forward.x * lungeForward * mass, y: lungeUp * mass, z: forward.z * lungeForward * mass },
      true
    );
    const yawSide =
      this.slot.appendageRoot.endsWith('_r') ? 1 :
      this.slot.appendageRoot.endsWith('_l') ? -1 :
      0;
    pelvis.applyTorqueImpulse(
      { x: 0, y: this.slot.rootYawAssist * mass * yawSide, z: 0 },
      true
    );

    // Give the actual weapon bodies a burst too, so commits create a real collision
    // instead of depending entirely on slow motor motion.
    for (const seg of this.getActiveBodies()) {
      const body = this.skeleton.joints.get(seg)?.body;
      if (!body) continue;
      const segMass = body.mass();
      body.applyImpulse(
        {
          x: forward.x * lungeForward * segMass * 1.08,
          y: lungeUp * segMass * 0.42,
          z: forward.z * lungeForward * segMass * 1.08,
        },
        true
      );
    }
  }

  private isBlocking(): boolean {
    return this.slot.profile === 'shield' && (this.state === 'WINDUP' || this.state === 'HELD');
  }

  private applyPose(pose: Record<string, number>, alpha: number): void {
    for (const name of this.slot.drivenJoints) {
      const j = this.skeleton.joints.get(name)?.joint;
      if (!j) continue;
      const poseTarget = pose[name];
      if (poseTarget === undefined) continue;
      j.configureMotorPosition(poseTarget * alpha, POSE_STIFFNESS, POSE_DAMPING);
    }
  }

  private recomputeMassScaling(): void {
    let appendageMass = 0;
    const massSegments = new Set<string>([
      this.slot.appendageRoot,
      ...this.slot.drivenJoints,
    ]);
    if (massSegments.size === 0) {
      for (const seg of this.getActiveBodies()) massSegments.add(seg);
    }
    for (const seg of massSegments) {
      const body = this.skeleton.joints.get(seg)?.body;
      if (!body) continue;
      appendageMass += body.mass();
    }
    const ratio = Math.max(0.35, appendageMass / BASELINE_APPENDAGE_MASS);
    const norm = Math.max(0, Math.min(1, (ratio - 0.5) / 1.5));
    this.massScale = Math.sqrt(ratio);
    this.appendageMassMul = ratio;
    this.recoverScale = this.lerp(0.85, 1.4, norm);
  }

  private getCommittedHoldSeconds(): number {
    const held = this.holdTimer + this.slot.minHoldForCharge;
    return Math.min(this.slot.maxChargeTime, Math.max(0, held));
  }

  private getPelvisForward(): { x: number; z: number } {
    const q = this.skeleton.pelvis.rotation();
    const fwdX = 2 * (q.x * q.z + q.w * q.y);
    const fwdZ = 1 - 2 * (q.x * q.x + q.y * q.y);
    const len = Math.sqrt(fwdX * fwdX + fwdZ * fwdZ) || 1;
    return { x: fwdX / len, z: fwdZ / len };
  }

  private computeHitQuality(forwardDot: number): number {
    if (this.slot.profile === 'spike') {
      return this.lerp(0.75, 1.3, Math.max(0, forwardDot));
    }
    if (this.slot.profile === 'shield') {
      return this.lerp(0.8, 1.1, Math.max(0, forwardDot));
    }
    return this.lerp(0.9, 1.15, Math.max(0, forwardDot));
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * Math.max(0, Math.min(1, t));
  }

  private getActiveBodies(): string[] {
    return this.slot.activeBodies ?? this.slot.hitSegments;
  }

  private scalePose(pose: Record<string, number>, scale: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(pose)) {
      out[key] = value * scale;
    }
    return out;
  }
}
