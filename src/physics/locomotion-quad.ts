import RAPIER from '@dimforge/rapier3d-compat';
import { InputManager } from '../engine/input';
import { RapierWorld } from './rapier-world';
import type { QuadSkeleton } from './skeleton-quad';
import { getTotalMassQuad } from './skeleton-quad';
import { tuning } from './tuning';
import { sampleTerrainHeight } from '../engine/terrain';
import type { LocomotionMode } from './locomotion';
import type { AttackMovementModifiers } from '../combat/attack-types';

/**
 * Active-ragdoll quadruped locomotion.
 *
 * Follows the same architecture as `applyBipedLocomotion`:
 *   - Mass-normalized forces, torques, and jump impulses.
 *   - Per-foot downward raycasts for grounded detection (sensors are
 *     unreliable against heightfields in this Rapier version).
 *   - Support spring applied along WORLD UP (not the ground normal) to
 *     avoid downhill drift on slopes.
 *   - State machine: SUPPORTED / STUMBLING / AIRBORNE / FALLEN / RECOVERING.
 *   - Terrain safety clamp that lifts any body that has penetrated the
 *     heightfield back out, killing its downward velocity.
 *
 * QUADRUPED-SPECIFIC differences vs the biped:
 *   - Four feet instead of two. STUMBLING is triggered only when
 *     `groundedFeet <= 2` or tilt > stumble threshold. SUPPORTED requires
 *     at least 3 feet grounded. AIRBORNE requires 0 feet.
 *   - Gait is a diagonal trot: (FL + BR) alternate with (FR + BL).
 *   - Upright torque is boosted ~20% internally because the wider base
 *     means small corrective torques are less effective at stopping a
 *     roll — this keeps the quad feeling stably clumsy, MORE stable
 *     than the biped but still rag-dolly.
 *   - `torso` entry in joints is the FRONT torso body, same as the biped's
 *     `pelvis`. Locomotion and camera follow attach to it.
 */

const PANIC_AMPLITUDE = 0.8;
const PANIC_FREQ = 6.0;
const PANIC_STAMINA_PER_SEC = 30;
const JUMP_STAMINA_COST = 15;
const ARENA_QUERY = (0x0001 << 16) | 0x0001;

/** Re-export so beast code can import the mode type from here as well. */
export type { LocomotionMode } from './locomotion';

export interface QuadLocomotionState {
  jumpTimer: number;
  /** Whether the creature has usable support (>= 1 foot grounded and not FALLEN/AIRBORNE). */
  isGrounded: boolean;
  /** 0..4 — how many foot raycasts currently hit the arena. */
  groundedFeet: number;
  /** Seconds with 0 grounded feet. Reset to 0 whenever any foot touches. */
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
  detachedSegments?: Set<string> | null;
  massOverride?: number | null;
  combatTargetYaw?: number | null;
  combatAssistStrength?: number;
  combatAssistMaxRate?: number;
  definitionDriveMultiplier?: number;
  definitionTurnMultiplier?: number;
  definitionSupportMultiplier?: number;
  definitionUprightMultiplier?: number;
  definitionRegenMultiplier?: number;
  definitionWalkCostMultiplier?: number;
  definitionTurnCostMultiplier?: number;
}

export function createQuadLocomotionState(): QuadLocomotionState {
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
    detachedSegments: null,
    massOverride: null,
    combatTargetYaw: null,
    combatAssistStrength: 0,
    combatAssistMaxRate: 0,
    definitionDriveMultiplier: 1,
    definitionTurnMultiplier: 1,
    definitionSupportMultiplier: 1,
    definitionUprightMultiplier: 1,
    definitionRegenMultiplier: 1,
    definitionWalkCostMultiplier: 1,
    definitionTurnCostMultiplier: 1,
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shortestAngle(delta: number): number {
  let out = delta;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
}

export function applyQuadLocomotion(
  skeleton: QuadSkeleton,
  input: InputManager,
  dt: number,
  stamina: { current: number; max: number; regen: number },
  physics: RapierWorld,
  locoState: QuadLocomotionState
) {
  const pelvis = skeleton.pelvis; // front torso

  // Fetch all leg joints up front. Missing any = skip the step.
  const hipFL = skeleton.joints.get('hip_fl');
  const hipFR = skeleton.joints.get('hip_fr');
  const hipBL = skeleton.joints.get('hip_bl');
  const hipBR = skeleton.joints.get('hip_br');
  const kneeFL = skeleton.joints.get('knee_fl');
  const kneeFR = skeleton.joints.get('knee_fr');
  const kneeBL = skeleton.joints.get('knee_bl');
  const kneeBR = skeleton.joints.get('knee_br');
  const ankleFL = skeleton.joints.get('ankle_fl');
  const ankleFR = skeleton.joints.get('ankle_fr');
  const ankleBL = skeleton.joints.get('ankle_bl');
  const ankleBR = skeleton.joints.get('ankle_br');

  if (!hipFL || !hipFR || !hipBL || !hipBR) return;
  if (!kneeFL || !kneeFR || !kneeBL || !kneeBR) return;

  pelvis.resetForces(true);
  pelvis.resetTorques(true);

  locoState.jumpTimer += dt;
  locoState.modeTimer += dt;

  // ============================================================
  // TERRAIN SAFETY CLAMP + NaN GUARD — lift any body that has penetrated
  // the heightfield back out, kill its downward velocity so gravity can't
  // re-penetrate on the same frame. Also catch NaN positions and snap
  // broken bodies back to the pelvis so a single bad solver step can't
  // freeze the entire game. See the matching biped block for the why.
  // ============================================================
  {
    const penetrationTolerance = 0.02;
    const pelvisP = pelvis.translation();
    const pelvisOk =
      isFinite(pelvisP.x) && isFinite(pelvisP.y) && isFinite(pelvisP.z);
    const safeX = pelvisOk ? pelvisP.x : 0;
    const safeY = pelvisOk
      ? pelvisP.y + 0.5
      : skeleton.restingPelvisHeightAboveGround + 1.0;
    const safeZ = pelvisOk ? pelvisP.z : 0;

    for (const body of skeleton.allBodies) {
      const p = body.translation();
      if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) {
        console.warn('[locomotion-quad] NaN body position — snapping to pelvis');
        body.setTranslation({ x: safeX, y: safeY, z: safeZ }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        continue;
      }
      const terrainY = sampleTerrainHeight(p.x, p.z);
      if (!isFinite(terrainY)) continue;
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

  const totalMass =
    locoState.massOverride && locoState.massOverride > 0
      ? locoState.massOverride
      : getTotalMassQuad(skeleton);
  locoState.totalMass = totalMass;
  const attackMods = locoState.attackModifiers ?? null;
  const detachedSegments = locoState.detachedSegments ?? null;
  const definitionDriveMul = locoState.definitionDriveMultiplier ?? 1;
  const definitionTurnMul = locoState.definitionTurnMultiplier ?? 1;
  const definitionSupportMul = locoState.definitionSupportMultiplier ?? 1;
  const definitionUprightMul = locoState.definitionUprightMultiplier ?? 1;
  const definitionRegenMul = locoState.definitionRegenMultiplier ?? 1;
  const definitionWalkCostMul = locoState.definitionWalkCostMultiplier ?? 1;
  const definitionTurnCostMul = locoState.definitionTurnCostMultiplier ?? 1;

  // ============================================================
  // GROUNDED DETECTION — per-foot downward raycast against arena.
  // ============================================================
  const checkFootGrounded = (footBody: RAPIER.RigidBody): boolean => {
    const p = footBody.translation();
    const ray = new physics.rapier.Ray(
      { x: p.x, y: p.y + 0.02, z: p.z },
      { x: 0, y: -1, z: 0 }
    );
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

  const flGrounded = !detachedSegments?.has('ankle_fl') && checkFootGrounded(skeleton.footFL.body);
  const frGrounded = !detachedSegments?.has('ankle_fr') && checkFootGrounded(skeleton.footFR.body);
  const blGrounded = !detachedSegments?.has('ankle_bl') && checkFootGrounded(skeleton.footBL.body);
  const brGrounded = !detachedSegments?.has('ankle_br') && checkFootGrounded(skeleton.footBR.body);

  const groundedFeet =
    (flGrounded ? 1 : 0) +
    (frGrounded ? 1 : 0) +
    (blGrounded ? 1 : 0) +
    (brGrounded ? 1 : 0);
  locoState.groundedFeet = groundedFeet;

  if (groundedFeet === 0) {
    locoState.airborneTimer += dt;
  } else {
    locoState.airborneTimer = 0;
  }

  // ============================================================
  // Pelvis (front torso) ground probe — for support spring height
  // and slope-aware tilt reference. Not used for grounded state.
  // ============================================================
  const pelvisPos = pelvis.translation();
  const pelvisVel = pelvis.linvel();
  const downRay = new physics.rapier.Ray(
    { x: pelvisPos.x, y: pelvisPos.y, z: pelvisPos.z },
    { x: 0, y: -1, z: 0 }
  );
  // Use skeleton's own resting height + headroom instead of tuning.standingHeight
  // (that one is shared with / owned by the biped).
  const standingHeight = skeleton.restingPelvisHeightAboveGround;
  const hit = physics.world.castRayAndGetNormal(
    downRay,
    standingHeight + 2.0,
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
  // Tilt — relative to ground normal (slope-aware), fall back to world up.
  // ============================================================
  const rot = pelvis.rotation();
  const pelvisUpX = 2 * (rot.x * rot.y + rot.w * rot.z);
  const pelvisUpY = 1 - 2 * (rot.x * rot.x + rot.z * rot.z);
  const pelvisUpZ = 2 * (rot.y * rot.z - rot.w * rot.x);

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

  const pelvisNearGround = isFinite(groundDist) && groundDist < 0.45;

  // ============================================================
  // STATE MACHINE — same ordering as biped, adjusted thresholds.
  //   SUPPORTED requires >= 3 feet grounded.
  //   STUMBLING when groundedFeet <= 2 or tilt > stumble threshold.
  //   AIRBORNE after 0 feet for > airborneGrace.
  // ============================================================
  let desiredMode: LocomotionMode;

  if (locoState.mode === 'FALLEN') {
    if (
      locoState.modeTimer >= tuning.recoverDelay &&
      (groundedFeet > 0 || pelvisNearGround)
    ) {
      desiredMode = 'RECOVERING';
    } else {
      desiredMode = 'FALLEN';
    }
  } else if (locoState.mode === 'RECOVERING') {
    if (
      groundedFeet >= 2 &&
      tiltDeg < tuning.stumbleTiltDeg &&
      locoState.modeTimer >= tuning.recoverRamp
    ) {
      desiredMode = 'SUPPORTED';
    } else if (
      tiltDeg > tuning.fallTiltDeg &&
      locoState.modeTimer >= tuning.recoverRamp
    ) {
      desiredMode = 'FALLEN';
    } else {
      desiredMode = 'RECOVERING';
    }
  } else {
    const hardDown =
      (tiltDeg > tuning.fallTiltDeg && groundedFeet === 0) ||
      pelvisNearGround;

    if (hardDown) {
      desiredMode = 'FALLEN';
    } else if (groundedFeet === 0) {
      if (locoState.airborneTimer > tuning.airborneGrace) {
        desiredMode = 'AIRBORNE';
      } else {
        desiredMode = locoState.mode;
      }
    } else if (groundedFeet <= 2 || tiltDeg > tuning.stumbleTiltDeg) {
      desiredMode = 'STUMBLING';
    } else {
      // 3 or 4 feet grounded, low tilt
      desiredMode = 'SUPPORTED';
    }
  }

  if (desiredMode !== locoState.mode) {
    const prevMode = locoState.mode;
    locoState.mode = desiredMode;
    locoState.modeTimer = 0;

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

  // Per-mode multipliers — same numbers as biped, but STUMBLING is a
  // little stronger because a tripod-stance quadruped should still feel
  // functional with 2-3 feet down.
  let supportMul: number;
  let driveMul: number;
  let uprightBoost = 1.0;
  switch (locoState.mode) {
    case 'SUPPORTED':
      supportMul = 1.0;
      driveMul = 1.0;
      break;
    case 'STUMBLING':
      supportMul = 0.82;
      driveMul = 0.78;
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
  // GAIT — diagonal trot (FL+BR) <-> (FR+BL).
  // Phase A drives FL and BR; phase B (offset by PI) drives FR and BL.
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

  // Four targets: A-pair (FL,BR) and B-pair (FR,BL).
  let hipA = tuning.neutralHip;
  let hipB = tuning.neutralHip;
  let kneeA = tuning.neutralKnee;
  let kneeB = tuning.neutralKnee;

  if (locoState.mode === 'RECOVERING') {
    hipA = tuning.recoverHip;
    hipB = tuning.recoverHip;
    kneeA = tuning.recoverKnee;
    kneeB = tuning.recoverKnee;
  } else if (panicDown) {
    const t = performance.now() * 0.001 * PANIC_FREQ;
    hipA = Math.sin(t) * PANIC_AMPLITUDE;
    hipB = Math.sin(t + Math.PI) * PANIC_AMPLITUDE;
    kneeA = -0.4 + Math.sin(t * 1.7) * 0.3;
    kneeB = -0.4 + Math.cos(t * 1.7) * 0.3;
  } else if (wDown || sDown) {
    const aPhase = Math.sin(locoState.gaitPhase);
    const bPhase = Math.sin(locoState.gaitPhase + Math.PI);
    const lerpHip = (p: number) =>
      p > 0 ? p * tuning.swingHip : p * Math.abs(tuning.driveHip);
    const lerpKnee = (p: number) =>
      p > 0 ? p * tuning.swingKnee : tuning.driveKnee;
    hipA = lerpHip(aPhase);
    kneeA = lerpKnee(aPhase);
    hipB = lerpHip(bPhase);
    kneeB = lerpKnee(bPhase);
  }

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

  // Diagonal pairing: FL & BR share phase A; FR & BL share phase B.
  setMotor(hipFL.joint, hipA, hipK, hipD);
  setMotor(hipBR.joint, hipA, hipK, hipD);
  setMotor(hipFR.joint, hipB, hipK, hipD);
  setMotor(hipBL.joint, hipB, hipK, hipD);

  setMotor(kneeFL.joint, kneeA, kneeK, kneeD);
  setMotor(kneeBR.joint, kneeA, kneeK, kneeD);
  setMotor(kneeFR.joint, kneeB, kneeK, kneeD);
  setMotor(kneeBL.joint, kneeB, kneeK, kneeD);

  if (ankleFL?.joint) setMotor(ankleFL.joint, 0, ankleK, ankleD);
  if (ankleFR?.joint) setMotor(ankleFR.joint, 0, ankleK, ankleD);
  if (ankleBL?.joint) setMotor(ankleBL.joint, 0, ankleK, ankleD);
  if (ankleBR?.joint) setMotor(ankleBR.joint, 0, ankleK, ankleD);

  // ============================================================
  // SUPPORT SPRING — along WORLD UP, not ground normal. Only when at
  // least one foot is grounded and we're not mid-jump holdoff.
  // ============================================================
  const inJumpHoldoff = locoState.jumpTimer < 0.4;
  if (groundedFeet > 0 && supportMul > 0 && !inJumpHoldoff && isFinite(groundDist)) {
    const compression = standingHeight - groundDist;
    if (compression > -0.1) {
      const supportMag =
        (tuning.heightStiffness * compression - tuning.heightDamping * pelvisVel.y) *
        supportMul *
        attackSupportMul *
        definitionSupportMul;
      pelvis.addForce({ x: 0, y: supportMag, z: 0 }, true);
    }
  }

  // ============================================================
  // UPRIGHT TORQUE — PD spring aligning front torso up to the reference.
  // Quadrupeds get a small internal boost for extra stability; combined
  // with the "STUMBLING only when <= 2 feet" threshold this makes the
  // beast noticeably harder to knock over than the biped.
  // ============================================================
  const QUAD_UPRIGHT_BOOST = 1.2;
  const uprightMul =
    supportMul * uprightBoost * QUAD_UPRIGHT_BOOST * attackUprightMul * definitionUprightMul;
  if (uprightMul > 0) {
    const errX = pelvisUpY * refZ - pelvisUpZ * refY;
    const errY = pelvisUpZ * refX - pelvisUpX * refZ;
    const errZ = pelvisUpX * refY - pelvisUpY * refX;

    const angVel = pelvis.angvel();
    const k = tuning.uprightStiffness * uprightMul;
    const d = tuning.uprightDamping * uprightMul;
    const torqueX = errX * k - angVel.x * d;
    const torqueZ = errZ * k - angVel.z * d;
    void errY;
    pelvis.addTorque({ x: torqueX, y: 0, z: torqueZ }, true);
  }

  // ============================================================
  // SMOOTHED TURNING — raw A/D → filtered axis → yaw rate → torque.
  // ============================================================
  const rawTurn = (aDown ? 1 : 0) - (dDown ? 1 : 0);
  locoState.turnAxis = smooth(locoState.turnAxis, rawTurn, tuning.turnSharpness, dt);

  const horizSpeed = Math.sqrt(pelvisVel.x * pelvisVel.x + pelvisVel.z * pelvisVel.z);
  const speedMul = 1 - Math.min(1, horizSpeed / Math.max(tuning.maxSpeed, 0.001)) * 0.25;
  // Scale turn rate by foot count out of 4.
  const groundFootMul = Math.min(groundedFeet, 4) / 4;

  const currentYaw = Math.atan2(
    2 * (rot.x * rot.z + rot.w * rot.y),
    1 - 2 * (rot.x * rot.x + rot.y * rot.y)
  );
  let targetYawRate =
    locoState.turnAxis *
    tuning.maxYawRate *
    Math.max(groundFootMul, locoState.mode === 'AIRBORNE' ? 0.15 : 0) *
    speedMul *
    attackTurnMul *
    definitionTurnMul;
  const combatTargetYaw = locoState.combatTargetYaw;
  if (combatTargetYaw != null) {
    targetYawRate += clamp(
      shortestAngle(combatTargetYaw - currentYaw) * (locoState.combatAssistStrength ?? 0),
      -(locoState.combatAssistMaxRate ?? 0),
      locoState.combatAssistMaxRate ?? 0
    );
  }

  locoState.yawRate = smooth(locoState.yawRate, targetYawRate, tuning.yawRateSharpness, dt);

  if (rawTurn !== 0 || Math.abs(locoState.yawRate) > 0.01) {
    const angVel = pelvis.angvel();
    const yawErr = locoState.yawRate - angVel.y;
    pelvis.addTorque(
      { x: 0, y: yawErr * tuning.turnTorquePerKg * totalMass, z: 0 },
      true
    );

    if (rawTurn !== 0 && (locoState.mode === 'SUPPORTED' || locoState.mode === 'STUMBLING')) {
      const turnTiltDamp = tuning.turnTiltDamp * totalMass;
      pelvis.addTorque(
        { x: -angVel.x * turnTiltDamp, y: 0, z: -angVel.z * turnTiltDamp },
        true
      );
    }
  }

  // ============================================================
  // FORWARD DRIVE — mass-scaled, state-aware. Forward is +fX/+fZ.
  // ============================================================
  const fwdX = 2 * (rot.x * rot.z + rot.w * rot.y);
  const fwdZ = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
  const fwdLen = Math.sqrt(fwdX * fwdX + fwdZ * fwdZ) || 1;
  const fX = fwdX / fwdLen;
  const fZ = fwdZ / fwdLen;

  const isAirborne = locoState.mode === 'AIRBORNE';

  if (isAirborne && (wDown || sDown)) {
    let accel = 0;
    if (wDown) accel += tuning.forwardAccel;
    if (sDown) accel -= tuning.backwardAccel;
    accel *= tuning.airControlMul * definitionDriveMul;
    const force = accel * totalMass;
    pelvis.addForce({ x: fX * force, y: 0, z: fZ * force }, true);
  } else if (driveMul > 0 && groundedFeet > 0) {
    const tiltScale = Math.max(0, 1 - tiltDeg / tuning.stumbleTiltDeg);
    // Normalize by 4 feet instead of 2, but floor at ~0.5 so a tripod
    // still drives meaningfully.
    const footScale = Math.max(0.5, groundedFeet / 4);

    let accel = 0;
    if (wDown) accel += tuning.forwardAccel;
    if (sDown) accel -= tuning.backwardAccel;
    accel *= driveMul * tiltScale * footScale * attackDriveMul * definitionDriveMul;

    if (accel !== 0) {
      const force = accel * totalMass;
      pelvis.addForce({ x: fX * force, y: 0, z: fZ * force }, true);
    } else if (locoState.mode === 'SUPPORTED') {
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
  // JUMP — mass-scaled impulse, only while SUPPORTED.
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
    stamina.current = Math.max(0, stamina.current - JUMP_STAMINA_COST);
  }

  // ============================================================
  // STAMINA — mass-based regen, same formula as biped.
  // ============================================================
  let staminaCost = 0;
  if (wDown || sDown) staminaCost += tuning.walkStaminaCost * definitionWalkCostMul * dt;
  if (aDown || dDown) staminaCost += tuning.turnStaminaCost * definitionTurnCostMul * dt;
  if (panicDown) staminaCost += PANIC_STAMINA_PER_SEC * dt;

  if (locoState.mode === 'RECOVERING' || locoState.mode === 'FALLEN') {
    staminaCost = 0;
  }

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
    (anyMoveKey ? tuning.movingRegen : tuning.idleRegenLight) * massMul * definitionRegenMul;
  locoState.regenPerSec = regenPerSec;

  stamina.current = Math.max(
    0,
    Math.min(stamina.max, stamina.current - staminaCost + regenPerSec * dt)
  );
}
