import RAPIER from '@dimforge/rapier3d-compat';
import { RapierWorld } from './rapier-world';
import type { SkeletonJoint, FootInfo } from './skeleton';
import { tuning } from './tuning';

/**
 * Quadruped active-ragdoll skeleton.
 *
 * Mirrors the biped skeleton layout and patterns exactly, but with:
 *   - Two torso segments (front + rear), joined by a revolute "spine" hinge.
 *   - Four legs: front-left, front-right, back-left, back-right.
 *   - Shorter legs overall, lower standing height (~0.80 m).
 *   - Wider stance and stockier build for visible quadruped feel.
 *
 * The `torso` entry in `joints` points at the FRONT body — locomotion,
 * camera follow, and the state machine attach to it, matching the biped
 * convention of `pelvis == "torso"`.
 *
 * Mass distribution:
 *   - Front torso  ~50% (carries the head — camera + locomotion root)
 *   - Rear torso   ~20%
 *   - 4 legs split the remaining ~30%
 *
 * Like the biped, joints have contacts disabled via `setContactsEnabled(false)`
 * (already handled inside `createHingeJoint`), and the dynamic bodies use
 * CCD by default from `createDynamicBody`.
 */

export interface QuadSkeleton {
  joints: Map<string, SkeletonJoint>;
  allBodies: RAPIER.RigidBody[];
  /** Front torso body — camera, locomotion, tilt queries attach here. */
  pelvis: RAPIER.RigidBody;
  footFL: FootInfo;
  footFR: FootInfo;
  footBL: FootInfo;
  footBR: FootInfo;
  /** Resting front-torso Y when all four feet planted, world space. */
  restingPelvisY: number;
  /** Resting front-torso HEIGHT above terrain (constant, terrain-relative). */
  restingPelvisHeightAboveGround: number;
}

export function createQuadSkeleton(
  physics: RapierWorld,
  spawnX: number = 0,
  spawnZ: number = 0,
  groundY: number = 0
): QuadSkeleton {
  const joints = new Map<string, SkeletonJoint>();
  const allBodies: RAPIER.RigidBody[] = [];

  // ---- Dimensions (m) ----
  // Quadruped stands LOWER than biped (~0.80 m) and is stockier.
  const torsoHalfH = 0.14;     // half-height of each torso capsule (upright axis)
  const torsoRadius = 0.26;    // chunkier than pelvis
  // Spine separation: front torso center to rear torso center along Z.
  // Front is at -halfSpan, rear at +halfSpan (rear = behind in +Z).
  const spineHalfSpan = 0.28;

  const upperLegLen = 0.30;    // shorter than biped's 0.42
  const upperLegRad = 0.09;
  const lowerLegLen = 0.28;    // shorter than biped's 0.40
  const lowerLegRad = 0.075;

  // Smaller feet than the biped.
  const footHX = 0.08;
  const footHY = 0.04;
  const footHZ = 0.12;

  // Wider stance for lateral stability.
  const hipWidth = 0.20;

  // ---- Standing positions (calculated bottom-up) ----
  const footCenterY = groundY + footHY + 0.005;
  const ankleWorldY = footCenterY + footHY;
  const lowerLegCenterY = ankleWorldY + lowerLegLen / 2;
  const kneeWorldY = lowerLegCenterY + lowerLegLen / 2;
  const upperLegCenterY = kneeWorldY + upperLegLen / 2;
  const hipWorldY = upperLegCenterY + upperLegLen / 2;
  // Hip anchor on the torso capsule — slightly below center so mass hangs low.
  const torsoHipLocalY = -(torsoHalfH + 0.02);
  const torsoCenterY = hipWorldY - torsoHipLocalY;

  const restingPelvisHeightAboveGround = torsoCenterY - groundY;
  // The quad stands lower than the biped, but we don't want to clobber
  // tuning.standingHeight (shared with biped). The locomotion code reads
  // it, but quadruped locomotion will pass its own height — we store it
  // in the skeleton for the controller to read.

  // ============================================================
  // FRONT TORSO — dynamic, big chunk of mass, = "pelvis" for API.
  // ~50% of the beast's mass.
  // ============================================================
  // Capsule axis is Y by default (upright). That matches the biped —
  // torso segments read as vertical pills.
  const frontTorso = physics.createDynamicBody(
    spawnX, torsoCenterY, spawnZ - spineHalfSpan,
    4.0,    // additional mass ~4kg (front)
    1.3,    // angular damping
    0.6,    // linear damping
    8
  );
  physics.addCapsuleCollider(frontTorso, torsoHalfH, torsoRadius, 1.0, 0.25, 0.0);
  joints.set('torso', { name: 'torso', body: frontTorso });
  allBodies.push(frontTorso);

  // ============================================================
  // REAR TORSO — dynamic, ~20% of mass.
  // ============================================================
  const rearTorso = physics.createDynamicBody(
    spawnX, torsoCenterY, spawnZ + spineHalfSpan,
    1.5,    // additional mass ~1.5kg (rear)
    1.3,
    0.6,
    8
  );
  physics.addCapsuleCollider(rearTorso, torsoHalfH, torsoRadius, 1.0, 0.25, 0.0);
  joints.set('torso_rear', { name: 'torso_rear', body: rearTorso });
  allBodies.push(rearTorso);

  // ============================================================
  // SPINE — revolute joint connecting front + rear torso along the X axis.
  // Tight limits so the spine basically stays rigid, but allows micro-flex
  // when the beast hits something or stumbles. Motor holds it at zero.
  // ============================================================
  physics.createHingeJoint(
    frontTorso, rearTorso,
    { x: 0, y: 0, z: spineHalfSpan },   // anchor on front torso (rear side)
    { x: 0, y: 0, z: -spineHalfSpan },  // anchor on rear torso (front side)
    { x: 1, y: 0, z: 0 },               // hinge axis = X
    { min: -0.20, max: 0.20 },
    {
      targetPos: 0,
      // Spine should be stiff — piggyback on hipStiffness scale.
      stiffness: tuning.hipStiffness * 2.5,
      damping: tuning.hipDamping * 2.0,
    }
  );

  // ============================================================
  // Build one leg attached to a torso body.
  //   torsoBody: front or rear torso
  //   sideSign: -1 (left) or +1 (right)
  //   legKey: 'fl' | 'fr' | 'bl' | 'br' (used for joint map names)
  //   baseZ:  world Z of the torso this leg hangs from
  // ============================================================
  const buildLeg = (
    torsoBody: RAPIER.RigidBody,
    sideSign: number,
    legKey: 'fl' | 'fr' | 'bl' | 'br',
    baseZ: number
  ): FootInfo => {
    const legX = spawnX + hipWidth * sideSign;

    // ---- Upper leg ----
    const upperLeg = physics.createDynamicBody(
      legX, upperLegCenterY, baseZ,
      0.4,
      1.5,
      0.4,
      6
    );
    physics.addCapsuleCollider(upperLeg, upperLegLen / 2, upperLegRad, 1.0, 0.4, 0.0);
    allBodies.push(upperLeg);

    const hipJoint = physics.createHingeJoint(
      torsoBody, upperLeg,
      { x: hipWidth * sideSign, y: torsoHipLocalY, z: 0 },
      { x: 0, y: upperLegLen / 2, z: 0 },
      { x: 1, y: 0, z: 0 },
      { min: -1.2, max: 1.2 },
      {
        targetPos: tuning.neutralHip,
        stiffness: tuning.hipStiffness,
        damping: tuning.hipDamping,
      }
    );
    joints.set(`hip_${legKey}`, { name: `hip_${legKey}`, body: upperLeg, joint: hipJoint });

    // ---- Lower leg ----
    const lowerLeg = physics.createDynamicBody(
      legX, lowerLegCenterY, baseZ,
      0.3, 1.8, 0.4, 6
    );
    physics.addCapsuleCollider(lowerLeg, lowerLegLen / 2, lowerLegRad, 1.0, 0.4, 0.0);
    allBodies.push(lowerLeg);

    const kneeJoint = physics.createHingeJoint(
      upperLeg, lowerLeg,
      { x: 0, y: -upperLegLen / 2, z: 0 },
      { x: 0, y: lowerLegLen / 2, z: 0 },
      { x: 1, y: 0, z: 0 },
      { min: -1.4, max: 0.05 },
      {
        targetPos: tuning.neutralKnee,
        stiffness: tuning.kneeStiffness,
        damping: tuning.kneeDamping,
      }
    );
    joints.set(`knee_${legKey}`, { name: `knee_${legKey}`, body: lowerLeg, joint: kneeJoint });

    // ---- Foot ----
    const foot = physics.createDynamicBody(
      legX, footCenterY, baseZ + 0.015,
      0.22, 1.0, 0.5, 6
    );
    physics.addCuboidCollider(foot, footHX, footHY, footHZ, 1.5, tuning.footFriction, 0.0);
    allBodies.push(foot);

    // Keep sensor collider for parity with biped (locomotion ignores it
    // and uses raycasts — but beast visuals / damage may attach to it later).
    const sensor = physics.addSensorCollider(
      foot,
      footHX * 0.95, 0.07, footHZ * 0.95,
      { x: 0, y: -footHY - 0.05, z: 0 }
    );

    const ankleJoint = physics.createHingeJoint(
      lowerLeg, foot,
      { x: 0, y: -lowerLegLen / 2, z: 0 },
      { x: 0, y: footHY, z: -0.02 },
      { x: 1, y: 0, z: 0 },
      { min: -0.5, max: 0.5 },
      {
        targetPos: 0,
        stiffness: tuning.ankleStiffness,
        damping: tuning.ankleDamping,
      }
    );
    joints.set(`ankle_${legKey}`, { name: `ankle_${legKey}`, body: foot, joint: ankleJoint });

    return { body: foot, sensor };
  };

  // Front legs attach to front torso (z = spawnZ - spineHalfSpan)
  const footFL = buildLeg(frontTorso, -1, 'fl', spawnZ - spineHalfSpan);
  const footFR = buildLeg(frontTorso,  1, 'fr', spawnZ - spineHalfSpan);
  // Back legs attach to rear torso (z = spawnZ + spineHalfSpan)
  const footBL = buildLeg(rearTorso,  -1, 'bl', spawnZ + spineHalfSpan);
  const footBR = buildLeg(rearTorso,   1, 'br', spawnZ + spineHalfSpan);

  return {
    joints,
    allBodies,
    pelvis: frontTorso,
    footFL,
    footFR,
    footBL,
    footBR,
    restingPelvisY: torsoCenterY,
    restingPelvisHeightAboveGround,
  };
}

/**
 * Sum the actual masses of every body in a quadruped skeleton.
 * Used to mass-normalize drive force, turn torque, jump impulse, stamina —
 * same pattern as `getTotalMass` in `skeleton.ts`.
 */
export function getTotalMassQuad(skeleton: QuadSkeleton): number {
  let total = 0;
  for (const body of skeleton.allBodies) {
    total += body.mass();
  }
  return total;
}
