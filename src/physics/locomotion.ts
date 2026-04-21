import RAPIER from '@dimforge/rapier3d-compat';
import { InputManager } from '../engine/input';
import { RapierWorld } from './rapier-world';
import type { BipedSkeleton } from './skeleton';
import { getTotalMass } from './skeleton';
import { tuning } from './tuning';
import { sampleTerrainHeight } from '../engine/terrain';
import type { AttackMovementModifiers } from '../combat/attack-types';

/**
 * Active-ragdoll bipedal locomotion.
 *
 * Pelvis is a DYNAMIC body. All forces/torques scale with total body
 * mass so the controller survives mass loss and mass variation.
 *
 * State machine (post-audit):
 *   SUPPORTED   — both feet planted, tilt low. Full assist.
 *   STUMBLING   — one foot planted, or tilt > stumbleTiltDeg. Reduced assist.
 *   AIRBORNE    — zero feet planted for > airborneGrace. Jump / fall / edge. No stand-up spring.
 *   FALLEN      — tilt > fallTiltDeg AND support lost, or pelvis near ground. No assist; gravity wins.
 *   RECOVERING  — delayed ramp after FALLEN. Uses a dedicated get-up pose and BOOSTED upright torque.
 *
 * Grounded state comes from the FOOT SENSORS, not a pelvis raycast.
 * The pelvis ray is only used to compute ground distance / slope normal
 * for the support spring.
 */

const PANIC_AMPLITUDE = 0.8;
const PANIC_FREQ = 6.0;
const PANIC_STAMINA_PER_SEC = 30;
const JUMP_STAMINA_COST = 15;
const ARENA_QUERY = (0x0001 << 16) | 0x0001;

export type LocomotionMode =
  | 'SUPPORTED'
  | 'STUMBLING'
  | 'AIRBORNE'
  | 'FALLEN'
  | 'RECOVERING';

export interface LocomotionState {
  jumpTimer: number;
  /** Whether the creature has usable support (feet grounded in a non-FALLEN state). */
  isGrounded: boolean;
  /** 0, 1, or 2 — how many foot sensors are currently touching the ground. */
  groundedFeet: number;
  /** Seconds with 0 grounded feet. Reset to 0 when any foot touches. */
  airborneTimer: number;
  gaitPhase: number;
  mode: LocomotionMode;
  modeTimer: number;
  turnAxis: number;
  yawRate: number;
  // --- Debug readouts (updated each step for the HUD) ---
  tiltDeg: number;
  groundDist: number;
  totalMass: number;
  regenPerSec: number;
  attackModifiers?: AttackMovementModifiers | null;
}

export function createLocomotionState(): LocomotionState {
  return {
    jumpTimer: 999,
    isGrounded: false,
    groundedFeet: 0,
    airborneTimer: 0,
    gaitPhase: 0,
    mode: 'SUPPORTED',
    modeTimer: 0,
    turnAxis: 0,
    yawRate: 0,
    tiltDeg: 0,
    groundDist: 0,
    totalMass: 0,
    regenPerSec: 0,
    attackModifiers: null,
  };
}

/** Critically-damped exponential smoothing. */
function smooth(current: number, target: number, sharpness: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-sharpness * dt));
}

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

  pelvis.resetForces(true);
  pelvis.resetTorques(true);

  locoState.jumpTimer += dt;
  locoState.modeTimer += dt;

  const totalMass = getTotalMass(skeleton);
  locoState.totalMass = totalMass;
  const attackMods = locoState.attackModifiers ?? null;

  // ============================================================
  // HARD-FLOOR SAFETY CLAMP + NaN GUARD
  //
  // After many falls/jumps, Rapier's solver can leave creature bodies
  // slightly penetrated into the heightfield — and each cycle the
  // penetration grows, until knees and feet end up underground. This
  // loop catches any body below the local terrain surface and lifts
  // it back out.
  //
  // It ALSO guards against NaN positions, which can leak in when the
  // solver hits a degenerate contact configuration (e.g. a foot wedged
  // between an angled rock convex hull and another beast body during a
  // jump). Without this guard, NaN would propagate to every subsequent
  // step and freeze the game. We snap broken bodies back to the pelvis.
  // ============================================================
  {
    const penetrationTolerance = 0.02; // m of slop before we clamp
    const pelvisP = pelvis.translation();
    const pelvisOk =
      isFinite(pelvisP.x) && isFinite(pelvisP.y) && isFinite(pelvisP.z);
    // Fallback safe spot if even the pelvis is broken — the standing height
    // above world origin. Rare but possible after a catastrophic step.
    const safeX = pelvisOk ? pelvisP.x : 0;
    const safeY = pelvisOk ? pelvisP.y + 0.5 : tuning.standingHeight + 1.0;
    const safeZ = pelvisOk ? pelvisP.z : 0;

    for (const body of skeleton.allBodies) {
      const p = body.translation();
      // NaN / infinite position → snap back to pelvis area, kill velocity.
      // Logged once-per-occurrence so we can see in console how often it
      // happens during stress tests.
      if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) {
        console.warn('[locomotion] NaN body position — snapping to pelvis');
        body.setTranslation({ x: safeX, y: safeY, z: safeZ }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        continue;
      }
      const terrainY = sampleTerrainHeight(p.x, p.z);
      if (!isFinite(terrainY)) continue; // sample borked, skip — don't make it worse
      const minY = terrainY + penetrationTolerance;
      if (p.y < minY) {
        body.setTranslation({ x: p.x, y: minY, z: p.z }, true);
        const v = body.linvel();
        if (v.y < 0) {
          body.setLinvel({ x: v.x, y: 0, z: v.z }, true);
        }
      }
    }
  }

  // ============================================================
  // SUPPORT — per-foot downward raycast against arena
  //
  // Sensor colliders turn out not to reliably detect heightfield
  // intersections in this Rapier version, so we shapecast straight
  // down from each foot body and consider that foot grounded if the
  // ray hits the arena within a short distance. This is robust across
  // heightfields, rocks, and walls.
  // ============================================================
  const checkFootGrounded = (footBody: RAPIER.RigidBody): boolean => {
    const p = footBody.translation();
    // Ray from slightly above foot center, downward
    const ray = new physics.rapier.Ray(
      { x: p.x, y: p.y + 0.02, z: p.z },
      { x: 0, y: -1, z: 0 }
    );
    // Max distance: foot body is ~0.07m above its collider bottom; allow
    // a generous threshold so we count "about to step" as grounded.
    const maxDist = 0.20;
    const hit = physics.world.castRay(
      ray,
      maxDist,
      true,
      undefined,
      ARENA_QUERY,
      undefined,
      footBody
    );
    return hit !== null;
  };

  const footL_grounded = checkFootGrounded(skeleton.footL.body);
  const footR_grounded = checkFootGrounded(skeleton.footR.body);
  const groundedFeet =
    (footL_grounded ? 1 : 0) + (footR_grounded ? 1 : 0);
  locoState.groundedFeet = groundedFeet;

  if (groundedFeet === 0) {
    locoState.airborneTimer += dt;
  } else {
    locoState.airborneTimer = 0;
  }

  // ============================================================
  // Pelvis ground probe — for support spring height + slope normal.
  // NOT used to decide grounded state.
  // ============================================================
  const pelvisPos = pelvis.translation();
  const pelvisVel = pelvis.linvel();
  const downRay = new physics.rapier.Ray(
    { x: pelvisPos.x, y: pelvisPos.y, z: pelvisPos.z },
    { x: 0, y: -1, z: 0 }
  );
  const hit = physics.world.castRayAndGetNormal(
    downRay,
    tuning.standingHeight + 2.0,
    true,
    undefined,
    ARENA_QUERY,
    undefined,
    pelvis
  );
  let groundDist = Infinity;
  let groundNormal = { x: 0, y: 1, z: 0 };
  if (hit) {
    groundDist = hit.timeOfImpact;
    if (hit.normal) {
      groundNormal = { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z };
    }
  }
  locoState.groundDist = groundDist;

  // ============================================================
  // Tilt — measured relative to the GROUND NORMAL, not world up.
  //
  // This way, a beast standing perfectly aligned with a 35° slope
  // reads as 0° tilt, not 35°. Recovery works on rocks as long as
  // the body is oriented with the slope. If we can't find a ground
  // normal (ray missed), fall back to world up.
  // ============================================================
  const rot = pelvis.rotation();
  const pelvisUpX = 2 * (rot.x * rot.y + rot.w * rot.z);
  const pelvisUpY = 1 - 2 * (rot.x * rot.x + rot.z * rot.z);
  const pelvisUpZ = 2 * (rot.y * rot.z - rot.w * rot.x);

  // Blend ground normal toward world up for extreme slopes so the
  // beast doesn't try to stand perfectly aligned with a cliff.
  let refX = 0, refY = 1, refZ = 0;
  if (isFinite(groundDist) && groundNormal.y > 0.5) {
    refX = groundNormal.x;
    refY = groundNormal.y;
    refZ = groundNormal.z;
  }
  const tiltDot = pelvisUpX * refX + pelvisUpY * refY + pelvisUpZ * refZ;
  const tiltCos = Math.max(-1, Math.min(1, tiltDot));
  const tiltDeg = Math.acos(tiltCos) * (180 / Math.PI);
  locoState.tiltDeg = tiltDeg;

  // Pelvis close to the ground → the body is literally down
  const pelvisNearGround = isFinite(groundDist) && groundDist < 0.55;

  // ============================================================
  // STATE MACHINE
  //
  // ORDERING MATTERS: handle the current mode first so FALLEN /
  // RECOVERING can transition correctly. Then look at everything else.
  // ============================================================
  let desiredMode: LocomotionMode;

  if (locoState.mode === 'FALLEN') {
    // Stay down for at least recoverDelay. Exit to RECOVERING when we
    // have something to push off — either a foot on the ground OR the
    // pelvis is close enough to use the get-up impulse.
    if (
      locoState.modeTimer >= tuning.recoverDelay &&
      (groundedFeet > 0 || pelvisNearGround)
    ) {
      desiredMode = 'RECOVERING';
    } else {
      desiredMode = 'FALLEN';
    }
  } else if (locoState.mode === 'RECOVERING') {
    // Recovery succeeded: feet on ground and upright again
    if (
      groundedFeet > 0 &&
      tiltDeg < tuning.stumbleTiltDeg &&
      locoState.modeTimer >= tuning.recoverRamp
    ) {
      desiredMode = 'SUPPORTED';
    } else if (
      tiltDeg > tuning.fallTiltDeg &&
      locoState.modeTimer >= tuning.recoverRamp
    ) {
      // Recovery failed, slam back to FALLEN
      desiredMode = 'FALLEN';
    } else {
      desiredMode = 'RECOVERING';
    }
  } else {
    // Not already FALLEN / RECOVERING — pick a mode fresh.
    const hardDown =
      (tiltDeg > tuning.fallTiltDeg && groundedFeet === 0) ||
      pelvisNearGround;

    if (hardDown) {
      desiredMode = 'FALLEN';
    } else if (groundedFeet === 0) {
      // Only count as airborne once the grace period has passed
      if (locoState.airborneTimer > tuning.airborneGrace) {
        desiredMode = 'AIRBORNE';
      } else {
        desiredMode = locoState.mode; // sticky during grace
      }
    } else if (groundedFeet === 1 || tiltDeg > tuning.stumbleTiltDeg) {
      desiredMode = 'STUMBLING';
    } else {
      desiredMode = 'SUPPORTED';
    }
  }

  if (desiredMode !== locoState.mode) {
    const prevMode = locoState.mode;
    locoState.mode = desiredMode;
    locoState.modeTimer = 0;

    // One-shot RECOVERING get-up impulse
    if (desiredMode === 'RECOVERING' && prevMode === 'FALLEN') {
      pelvis.applyImpulse(
        {
          x: 0,
          y: totalMass * tuning.recoveringGetupImpulsePerKg,
          z: 0,
        },
        true
      );
    }
  }

  // Per-mode multipliers
  let supportMul: number;
  let driveMul: number;
  let uprightBoost = 1.0;
  switch (locoState.mode) {
    case 'SUPPORTED':
      supportMul = 1.0;
      driveMul = 1.0;
      break;
    case 'STUMBLING':
      supportMul = 0.55;
      driveMul = 0.5;
      break;
    case 'AIRBORNE':
      supportMul = 0.0;
      driveMul = 0.0;
      break;
    case 'FALLEN':
      supportMul = 0.0;
      driveMul = 0.0;
      break;
    case 'RECOVERING': {
      const t = Math.min(1, locoState.modeTimer / Math.max(tuning.recoverRamp, 0.01));
      supportMul = tuning.recoveringAssistStart +
        (tuning.recoveringAssistEnd - tuning.recoveringAssistStart) * t;
      driveMul = 0.0;
      uprightBoost = tuning.recoveringUprightBoost;
      break;
    }
  }

  const attackSupportMul = attackMods?.supportMultiplier ?? 1;
  const attackUprightMul = attackMods?.uprightMultiplier ?? 1;
  const attackDriveMul = attackMods?.driveMultiplier ?? 1;
  const attackTurnMul = attackMods?.turnMultiplier ?? 1;
  const attackBrakeMul = attackMods?.brakeMultiplier ?? 1;
  const jumpLocked = attackMods?.jumpLocked ?? false;

  locoState.isGrounded =
    groundedFeet > 0 &&
    locoState.mode !== 'FALLEN' &&
    locoState.mode !== 'AIRBORNE';

  // ============================================================
  // GAIT — auto-cycle when W/S held
  // ============================================================
  const wDown = input.isDown('W') && stamina.current > 0;
  const sDown = input.isDown('S') && stamina.current > 0;
  const aDown = input.isDown('A');
  const dDown = input.isDown('D');
  const panicDown =
    input.isDown(' ') && stamina.current > 0 && locoState.mode === 'AIRBORNE';

  if (wDown || sDown) {
    locoState.gaitPhase += dt * tuning.gaitFrequency;
  } else {
    locoState.gaitPhase *= 0.85;
  }

  let leftHipTarget: number;
  let leftKneeTarget: number;
  let rightHipTarget: number;
  let rightKneeTarget: number;

  if (locoState.mode === 'RECOVERING') {
    // Dedicated get-up pose — hips slightly forward, knees bent hard
    leftHipTarget = tuning.recoverHip;
    rightHipTarget = tuning.recoverHip;
    leftKneeTarget = tuning.recoverKnee;
    rightKneeTarget = tuning.recoverKnee;
  } else if (panicDown) {
    const t = performance.now() * 0.001 * PANIC_FREQ;
    leftHipTarget = Math.sin(t) * PANIC_AMPLITUDE;
    rightHipTarget = Math.sin(t + Math.PI) * PANIC_AMPLITUDE;
    leftKneeTarget = -0.4 + Math.sin(t * 1.7) * 0.3;
    rightKneeTarget = -0.4 + Math.cos(t * 1.7) * 0.3;
  } else if (wDown || sDown) {
    const lPhase = Math.sin(locoState.gaitPhase);
    const rPhase = Math.sin(locoState.gaitPhase + Math.PI);
    const lerpHip = (p: number) =>
      p > 0 ? p * tuning.swingHip : p * Math.abs(tuning.driveHip);
    const lerpKnee = (p: number) =>
      p > 0 ? p * tuning.swingKnee : tuning.driveKnee;
    leftHipTarget = lerpHip(lPhase);
    leftKneeTarget = lerpKnee(lPhase);
    rightHipTarget = lerpHip(rPhase);
    rightKneeTarget = lerpKnee(rPhase);
  } else {
    leftHipTarget = tuning.neutralHip;
    leftKneeTarget = tuning.neutralKnee;
    rightHipTarget = tuning.neutralHip;
    rightKneeTarget = tuning.neutralKnee;
  }

  // Motor multiplier: weak in AIRBORNE and FALLEN, full on the ground
  const motorMul =
    locoState.mode === 'AIRBORNE' || locoState.mode === 'FALLEN'
      ? tuning.airMotorMul
      : 1.0;
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
  if (ankleL?.joint) setMotor(ankleL.joint, 0, ankleK, ankleD);
  if (ankleR?.joint) setMotor(ankleR.joint, 0, ankleK, ankleD);

  // ============================================================
  // SUPPORT SPRING — ONLY when at least one foot is grounded.
  // Applied along WORLD UP, not the ground normal. Using the ground
  // normal pushes the beast DOWN a slope, which is how a ledge-landing
  // immediately slid off. The spring only needs to cancel gravity; it
  // doesn't need to fight slopes horizontally — friction + the slope
  // stability brake below do that.
  // Skipped during jump holdoff so upward impulse can build height.
  // ============================================================
  const inJumpHoldoff = locoState.jumpTimer < 0.4;
  if (groundedFeet > 0 && supportMul > 0 && !inJumpHoldoff && isFinite(groundDist)) {
    const compression = tuning.standingHeight - groundDist;
    if (compression > -0.1) {
      const supportMag =
        (tuning.heightStiffness * compression - tuning.heightDamping * pelvisVel.y) *
        supportMul *
        attackSupportMul;
      pelvis.addForce({ x: 0, y: supportMag, z: 0 }, true);
    }
  }

  // ============================================================
  // UPRIGHT TORQUE — PD spring aligning pelvis up to the reference
  // (ground normal or world up). Scaled by supportMul * uprightBoost.
  //
  // Error = pelvisUp × reference → axis of rotation needed to align.
  // ============================================================
  const uprightMul = supportMul * uprightBoost * attackUprightMul;
  if (uprightMul > 0) {
    // Cross product: pelvisUp × ref (the torque axis to align them)
    const errX = pelvisUpY * refZ - pelvisUpZ * refY;
    const errY = pelvisUpZ * refX - pelvisUpX * refZ;
    const errZ = pelvisUpX * refY - pelvisUpY * refX;

    const angVel = pelvis.angvel();
    const k = tuning.uprightStiffness * uprightMul;
    const d = tuning.uprightDamping * uprightMul;
    // Damp on X/Z only — don't fight yaw here; that's the turning system's job
    const torqueX = errX * k - angVel.x * d;
    const torqueZ = errZ * k - angVel.z * d;
    void errY;
    pelvis.addTorque({ x: torqueX, y: 0, z: torqueZ }, true);
  }

  // ============================================================
  // SMOOTHED TURNING — raw A/D → filtered axis → desired yaw rate → torque
  // Yaw torque is mass-scaled so heavy beasts turn proportionally.
  // ============================================================
  const rawTurn = (aDown ? 1 : 0) - (dDown ? 1 : 0);
  locoState.turnAxis = smooth(locoState.turnAxis, rawTurn, tuning.turnSharpness, dt);

  const horizSpeed = Math.sqrt(pelvisVel.x * pelvisVel.x + pelvisVel.z * pelvisVel.z);
  const speedMul = 1 - Math.min(1, horizSpeed / Math.max(tuning.maxSpeed, 0.001)) * 0.25;
  // Further reduce turn rate based on grounded feet count (1 foot = weaker)
  const groundFootMul = Math.min(groundedFeet, 2) / 2;

  const targetYawRate =
    locoState.turnAxis *
    tuning.maxYawRate *
    Math.max(groundFootMul, locoState.mode === 'AIRBORNE' ? 0.15 : 0) *
    speedMul *
    attackTurnMul;

  locoState.yawRate = smooth(locoState.yawRate, targetYawRate, tuning.yawRateSharpness, dt);

  if (rawTurn !== 0 || Math.abs(locoState.yawRate) > 0.01) {
    const angVel = pelvis.angvel();
    const yawErr = locoState.yawRate - angVel.y;
    pelvis.addTorque(
      { x: 0, y: yawErr * tuning.turnTorquePerKg * totalMass, z: 0 },
      true
    );

    // Actively damp X/Z angular velocity while turning so yaw torque
    // does not leak into tilt and tip the beast over in place.
    if (rawTurn !== 0 && (locoState.mode === 'SUPPORTED' || locoState.mode === 'STUMBLING')) {
      const turnTiltDamp = tuning.turnTiltDamp * totalMass;
      pelvis.addTorque(
        { x: -angVel.x * turnTiltDamp, y: 0, z: -angVel.z * turnTiltDamp },
        true
      );
    }
  }

  // ============================================================
  // FORWARD DRIVE — mass-scaled, state-aware.
  //
  // Ground drive uses driveMul * tiltScale * footScale.
  // AIRBORNE drive uses airControlMul so the player keeps some steering
  // influence mid-jump — less than on the ground, but not zero.
  // ============================================================
  const fwdX = 2 * (rot.x * rot.z + rot.w * rot.y);
  const fwdZ = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
  const fwdLen = Math.sqrt(fwdX * fwdX + fwdZ * fwdZ) || 1;
  const fX = fwdX / fwdLen;
  const fZ = fwdZ / fwdLen;

  const isAirborne = locoState.mode === 'AIRBORNE';

  if (isAirborne && (wDown || sDown)) {
    // Mid-jump steering — always available, weaker than ground drive
    let accel = 0;
    if (wDown) accel += tuning.forwardAccel;
    if (sDown) accel -= tuning.backwardAccel;
    accel *= tuning.airControlMul;
    const force = accel * totalMass;
    pelvis.addForce({ x: fX * force, y: 0, z: fZ * force }, true);
  } else if (driveMul > 0 && groundedFeet > 0) {
    // Grounded drive
    const tiltScale = Math.max(0, 1 - tiltDeg / tuning.stumbleTiltDeg);
    const footScale = groundedFeet / 2;

    let accel = 0;
    if (wDown) accel += tuning.forwardAccel;
    if (sDown) accel -= tuning.backwardAccel;
    accel *= driveMul * tiltScale * footScale * attackDriveMul;

    if (accel !== 0) {
      const force = accel * totalMass;
      pelvis.addForce({ x: fX * force, y: 0, z: fZ * force }, true);
    } else if (locoState.mode === 'SUPPORTED') {
      // Horizontal damping. Boosted on slopes to prevent ledge-sliding.
      // Detect slope via ground normal: flat = (0,1,0), normal.y = 1.
      // The lower normal.y gets, the steeper the slope.
      const slopiness = isFinite(groundDist) ? Math.max(0, 1 - groundNormal.y) : 0;
      const slopeBrake = 1 + slopiness * (tuning.slopeStabilityBoost - 1);
      const brakeForce = tuning.horizontalBrake * totalMass * slopeBrake * attackBrakeMul;
      pelvis.addForce(
        {
          x: -pelvisVel.x * brakeForce,
          y: 0,
          z: -pelvisVel.z * brakeForce,
        },
        true
      );
    }
  }

  // ============================================================
  // JUMP — MASS-scaled impulse so heavy beasts still get off the ground
  // ============================================================
  if (
    input.justPressed(' ') &&
    locoState.mode === 'SUPPORTED' &&
    groundedFeet > 0 &&
    locoState.jumpTimer >= tuning.jumpCooldown &&
    stamina.current >= JUMP_STAMINA_COST &&
    !jumpLocked
  ) {
    pelvis.applyImpulse(
      { x: 0, y: totalMass * tuning.jumpVelocity, z: 0 },
      true
    );
    locoState.jumpTimer = 0;
    // Jump stamina cost is intentional — we still want it to matter
    stamina.current = Math.max(0, stamina.current - JUMP_STAMINA_COST);
  }

  // ============================================================
  // STAMINA — mass-based regen. Recovery is free.
  // ============================================================
  let staminaCost = 0;
  if (wDown || sDown) staminaCost += tuning.walkStaminaCost * dt;
  if (aDown || dDown) staminaCost += tuning.turnStaminaCost * dt;
  if (panicDown) staminaCost += PANIC_STAMINA_PER_SEC * dt;

  // Recovery doesn't cost stamina
  if (locoState.mode === 'RECOVERING' || locoState.mode === 'FALLEN') {
    staminaCost = 0;
  }

  // Mass-scaled regen: lightest beasts recover fast, heaviest get half
  const massT = Math.max(
    0,
    Math.min(
      1,
      (totalMass - tuning.regenLightMass) /
        Math.max(0.001, tuning.regenHeavyMass - tuning.regenLightMass)
    )
  );
  const massMul = 1.0 - 0.5 * massT;
  const anyMoveKey = wDown || sDown || aDown || dDown;
  const regenPerSec =
    (anyMoveKey ? tuning.movingRegen : tuning.idleRegenLight) * massMul;
  locoState.regenPerSec = regenPerSec;

  stamina.current = Math.max(
    0,
    Math.min(stamina.max, stamina.current - staminaCost + regenPerSec * dt)
  );
}
