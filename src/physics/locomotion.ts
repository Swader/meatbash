import RAPIER from '@dimforge/rapier3d-compat';
import { InputManager } from '../engine/input';
import { RapierWorld } from './rapier-world';
import type { BipedSkeleton } from './skeleton';
import { tuning } from './tuning';

/**
 * Active-ragdoll bipedal locomotion.
 *
 * Architecture:
 *   1. Read input (now properly latched per fixed step).
 *   2. Determine grounded state from foot sensor intersections.
 *   3. Update gait state machine (which leg is swinging, which is driving).
 *   4. Set joint motor targets based on gait state.
 *   5. Apply balance forces to the dynamic pelvis:
 *      - Upright torque (PD spring around X/Z axes)
 *      - Height spring (PD spring on Y axis) — only when grounded
 *   6. Jump = single upward impulse on the pelvis (only when grounded).
 *
 * Critical: forward motion comes from FOOT FRICTION reacting to leg motors
 * rotating the pelvis forward. NOT from impulses applied to body parts.
 * The legs do the locomotion. The pelvis is just along for the ride.
 */

// ---- Constants ----
const PANIC_AMPLITUDE = 0.8;       // Hip target swing during panic
const PANIC_FREQ = 6.0;            // Hz of panic flail
const TURN_TORQUE = 25;             // Yaw torque on pelvis when A/D held
const PANIC_STAMINA_PER_SEC = 30;
const JUMP_STAMINA_COST = 15;

export interface LocomotionState {
  /** Time since last successful jump (for cooldown). */
  jumpTimer: number;
  /** Whether the pelvis is currently considered grounded. */
  isGrounded: boolean;
  /** Time accumulator for the auto-cycling walk gait when W is held. */
  gaitPhase: number;
}

export function createLocomotionState(): LocomotionState {
  return {
    jumpTimer: 999,
    isGrounded: false,
    gaitPhase: 0,
  };
}

/**
 * Configure a revolute joint motor with current tuning values.
 * Called every fixed step to support live tuning via tweakpane.
 */
function setMotor(
  joint: RAPIER.RevoluteImpulseJoint | undefined,
  target: number,
  stiffness: number,
  damping: number
) {
  if (!joint) return;
  joint.configureMotorPosition(target, stiffness, damping);
}

export function applyBipedLocomotion(
  skeleton: BipedSkeleton,
  input: InputManager,
  dt: number,
  stamina: { current: number; max: number; regen: number },
  physics: RapierWorld,
  locoState: LocomotionState
) {
  const pelvis = skeleton.pelvis;
  const hipL = skeleton.joints.get('hip_l');
  const hipR = skeleton.joints.get('hip_r');
  const kneeL = skeleton.joints.get('knee_l');
  const kneeR = skeleton.joints.get('knee_r');
  const ankleL = skeleton.joints.get('ankle_l');
  const ankleR = skeleton.joints.get('ankle_r');

  if (!hipL || !hipR || !kneeL || !kneeR) return;

  // CRITICAL: addForce/addTorque ACCUMULATE in this Rapier version and
  // do not auto-reset between steps. Reset them at the start of each
  // fixed step before computing fresh forces.
  pelvis.resetForces(true);
  pelvis.resetTorques(true);

  let staminaCost = 0;
  locoState.jumpTimer += dt;

  // ============================================================
  // GROUND CONTACT — downward raycast from pelvis to arena
  //
  // Foot sensors are unreliable because the legs can fold, lifting
  // the feet off the ground. The pelvis raycast directly tells us
  // how far the body is from the ground regardless of leg state.
  // ============================================================
  const pelvisPos = pelvis.translation();
  const downRay = new physics.rapier.Ray(
    { x: pelvisPos.x, y: pelvisPos.y, z: pelvisPos.z },
    { x: 0, y: -1, z: 0 }
  );
  // Query filterGroups: hit ARENA group only (membership=1, filter=1)
  const ARENA_QUERY = (0x0001 << 16) | 0x0001;
  const groundHit = physics.world.castRay(
    downRay,
    tuning.standingHeight + 1.0,
    true,
    undefined,
    ARENA_QUERY,
    undefined,
    pelvis
  );
  const distToGround = groundHit ? groundHit.timeOfImpact : Infinity;
  // Grounded when the pelvis is within standing height (plus a generous tolerance)
  // of the ground. This means "I have support somewhere below me".
  locoState.isGrounded = distToGround < tuning.standingHeight + 0.3;

  // ============================================================
  // GAIT STATE — WASD scheme with auto-cycling walk animation
  // ============================================================
  // W held: walk forward — legs auto-alternate (left swing → right swing)
  // S held: walk backward
  // A/D: turn (handled below)
  // SPACE: jump (grounded) / panic flail (airborne)
  const wDown = input.isDown('W') && stamina.current > 0;
  const sDown = input.isDown('S') && stamina.current > 0;
  const panicDown = input.isDown(' ') && stamina.current > 0 && !locoState.isGrounded;

  // Advance the gait phase only when actively walking.
  // tuning.gaitFrequency controls how fast the legs alternate.
  if (wDown || sDown) {
    locoState.gaitPhase += dt * tuning.gaitFrequency;
  } else {
    // Settle gait phase smoothly back toward zero so legs return to neutral
    locoState.gaitPhase *= 0.85;
  }

  let leftHipTarget: number;
  let leftKneeTarget: number;
  let rightHipTarget: number;
  let rightKneeTarget: number;

  if (panicDown) {
    // Panic flail in the air — swing legs wildly
    const t = performance.now() * 0.001 * PANIC_FREQ;
    leftHipTarget = Math.sin(t) * PANIC_AMPLITUDE;
    rightHipTarget = Math.sin(t + Math.PI) * PANIC_AMPLITUDE;
    leftKneeTarget = -0.4 + Math.sin(t * 1.7) * 0.3;
    rightKneeTarget = -0.4 + Math.cos(t * 1.7) * 0.3;
    staminaCost += PANIC_STAMINA_PER_SEC * dt;
  } else if (wDown || sDown) {
    // Walking: left and right legs alternate using a phase oscillator.
    // sin(phase)   — left leg cycle (positive = swing forward)
    // sin(phase+π) — right leg cycle, 180° out of phase
    // When walking backward (S), the phase still advances but the
    // forward force is negated below, so the legs visually still cycle.
    const lPhase = Math.sin(locoState.gaitPhase);
    const rPhase = Math.sin(locoState.gaitPhase + Math.PI);

    // Map phase [-1..1] to (drive ↔ swing). When phase > 0: leg swinging.
    // When phase < 0: leg planted/driving (slightly back).
    const lerpHip = (p: number) => p > 0
      ? p * tuning.swingHip                    // swing forward
      : p * Math.abs(tuning.driveHip);         // negative = drive back
    const lerpKnee = (p: number) => p > 0
      ? p * tuning.swingKnee                   // bend on swing
      : tuning.driveKnee;                       // straight on drive

    leftHipTarget = lerpHip(lPhase);
    leftKneeTarget = lerpKnee(lPhase);
    rightHipTarget = lerpHip(rPhase);
    rightKneeTarget = lerpKnee(rPhase);
    staminaCost += tuning.walkStaminaCost * dt;
  } else {
    // Neutral standing — both legs hang straight at neutral angles
    leftHipTarget = tuning.neutralHip;
    leftKneeTarget = tuning.neutralKnee;
    rightHipTarget = tuning.neutralHip;
    rightKneeTarget = tuning.neutralKnee;
  }

  // ============================================================
  // APPLY MOTOR TARGETS — weakened when airborne
  // ============================================================
  const motorMul = locoState.isGrounded ? 1.0 : tuning.airMotorMul;
  const hipK = tuning.hipStiffness * motorMul;
  const hipD = tuning.hipDamping * motorMul;
  const kneeK = tuning.kneeStiffness * motorMul;
  const kneeD = tuning.kneeDamping * motorMul;
  const ankleK = tuning.ankleStiffness * motorMul;
  const ankleD = tuning.ankleDamping * motorMul;

  setMotor(hipL.joint, leftHipTarget, hipK, hipD);
  setMotor(hipR.joint, rightHipTarget, hipK, hipD);
  setMotor(kneeL.joint, leftKneeTarget, kneeK, kneeD);
  setMotor(kneeR.joint, rightKneeTarget, kneeK, kneeD);
  // Ankles always hold flat
  if (ankleL?.joint) setMotor(ankleL.joint, 0, ankleK, ankleD);
  if (ankleR?.joint) setMotor(ankleR.joint, 0, ankleK, ankleD);

  // ============================================================
  // YAW TURN — A/D apply torque around Y axis to pelvis
  // ============================================================
  if (input.isDown('A')) {
    pelvis.applyTorqueImpulse({ x: 0, y: TURN_TORQUE * dt, z: 0 }, true);
    staminaCost += tuning.turnStaminaCost * dt;
  }
  if (input.isDown('D')) {
    pelvis.applyTorqueImpulse({ x: 0, y: -TURN_TORQUE * dt, z: 0 }, true);
    staminaCost += tuning.turnStaminaCost * dt;
  }

  // ============================================================
  // FORWARD MOVEMENT — direct force on the dynamic pelvis
  //
  // The auditor's "pure motor walk" is hard to tune in a jam.
  // This is the fallback they suggested: apply force to the dynamic
  // root in its facing direction. The pelvis is still dynamic so it
  // can fall, get hit, collide with rocks/walls — only locomotion
  // is "cheated". Movement only works when grounded.
  // ============================================================
  if (locoState.isGrounded) {
    // Compute forward direction from pelvis yaw
    const rot = pelvis.rotation();
    // Forward vector = (0,0,1) rotated by quaternion → projected to XZ
    const fwdX = 2 * (rot.x * rot.z + rot.w * rot.y);
    const fwdZ = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
    const fwdLen = Math.sqrt(fwdX * fwdX + fwdZ * fwdZ) || 1;
    const fX = fwdX / fwdLen;
    const fZ = fwdZ / fwdLen;

    let forwardMag = 0;
    if (wDown) forwardMag += tuning.forwardForce;
    if (sDown) forwardMag -= tuning.backwardForce;

    if (forwardMag !== 0) {
      pelvis.addForce({ x: fX * forwardMag, y: 0, z: fZ * forwardMag }, true);
    }

    // Apply horizontal damping when no input — prevents endless sliding
    if (forwardMag === 0) {
      const vel = pelvis.linvel();
      const dampForce = 30; // N per (m/s)
      pelvis.addForce({ x: -vel.x * dampForce, y: 0, z: -vel.z * dampForce }, true);
    }
  }

  // ============================================================
  // BALANCE — upright torque (PD spring) on pelvis
  // Strong when grounded, much weaker when airborne.
  // ============================================================
  {
    const rot = pelvis.rotation();
    // Pelvis local up vector rotated to world space (i.e., rotate (0,1,0))
    const upX = 2 * (rot.x * rot.y + rot.w * rot.z);
    const upY = 1 - 2 * (rot.x * rot.x + rot.z * rot.z);
    const upZ = 2 * (rot.y * rot.z - rot.w * rot.x);
    void upY;

    // Tilt error = up × worldUp = (upZ, 0, -upX)
    // Magnitude is sin(tilt angle)
    const errX = upZ;
    const errZ = -upX;

    const angVel = pelvis.angvel();
    const k = tuning.uprightStiffness * (locoState.isGrounded ? 1.0 : 0.3);
    const d = tuning.uprightDamping * (locoState.isGrounded ? 1.0 : 0.3);

    const torqueX = errX * k - angVel.x * d;
    const torqueZ = errZ * k - angVel.z * d;

    pelvis.addTorque({ x: torqueX, y: 0, z: torqueZ }, true);
  }

  // ============================================================
  // BALANCE — height spring on pelvis (only while grounded)
  // F = k * (targetHeight - currentY) - d * vy
  //
  // Skipped briefly after a jump so the upward impulse can build
  // height before the spring damping kills it.
  // ============================================================
  const inJumpHoldoff = locoState.jumpTimer < 0.4;
  if (locoState.isGrounded && !inJumpHoldoff) {
    const pos = pelvis.translation();
    const vel = pelvis.linvel();
    const heightError = tuning.standingHeight - pos.y;
    const clampedError = Math.max(-0.5, Math.min(0.5, heightError));
    const fy = tuning.heightStiffness * clampedError - tuning.heightDamping * vel.y;
    pelvis.addForce({ x: 0, y: fy, z: 0 }, true);
  }

  // ============================================================
  // JUMP — single upward impulse, grounded + cooldown
  // ============================================================
  if (
    input.justPressed(' ') &&
    locoState.isGrounded &&
    locoState.jumpTimer >= tuning.jumpCooldown &&
    stamina.current >= JUMP_STAMINA_COST
  ) {
    // Impulse = mass * desiredVelocity
    // Use additionalMass + collider mass approximation
    const approxMass = 3.5; // pelvis mass
    pelvis.applyImpulse(
      { x: 0, y: approxMass * tuning.jumpVelocity, z: 0 },
      true
    );
    locoState.jumpTimer = 0;
    staminaCost += JUMP_STAMINA_COST;
  }

  // ============================================================
  // STAMINA
  // ============================================================
  stamina.current = Math.max(0, stamina.current - staminaCost);
  if (staminaCost === 0) {
    stamina.current = Math.min(stamina.max, stamina.current + stamina.regen * dt);
  }
}
