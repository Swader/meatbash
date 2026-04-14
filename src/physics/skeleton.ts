import RAPIER from '@dimforge/rapier3d-compat';
import { RapierWorld } from './rapier-world';
import { tuning } from './tuning';

export interface SkeletonJoint {
  name: string;
  body: RAPIER.RigidBody;
  joint?: RAPIER.RevoluteImpulseJoint;
}

export interface FootInfo {
  body: RAPIER.RigidBody;
  sensor: RAPIER.Collider;
}

export interface BipedSkeleton {
  joints: Map<string, SkeletonJoint>;
  allBodies: RAPIER.RigidBody[];
  pelvis: RAPIER.RigidBody;
  footL: FootInfo;
  footR: FootInfo;
  /** Resting pelvis Y when both feet planted. */
  restingPelvisY: number;
}

/**
 * Build an active-ragdoll bipedal skeleton.
 *
 * Architecture (per the locomotion audit):
 * - DYNAMIC pelvis body (NOT kinematic). Falls under gravity, can be hit.
 * - Real foot bodies (cuboids) with high friction and intersection sensors.
 * - Hip / knee / ankle revolute joints, all motorized.
 * - Self-collision disabled via collision groups (creature parts ignore each
 *   other, only collide with arena).
 *
 * The locomotion controller drives motor targets and applies balance forces
 * (upright torque + height spring) to the pelvis. Standing is EARNED through
 * support contact, not faked through teleporting.
 */
export function createBipedSkeleton(
  physics: RapierWorld,
  spawnX: number = 0,
  spawnZ: number = 0
): BipedSkeleton {
  const joints = new Map<string, SkeletonJoint>();
  const allBodies: RAPIER.RigidBody[] = [];

  // ---- Dimensions (m) ----
  const pelvisHalfH = 0.18;     // capsule half-height (cylinder part)
  const pelvisRadius = 0.22;
  const upperLegLen = 0.42;     // capsule full length (cylinder part)
  const upperLegRad = 0.12;
  const lowerLegLen = 0.40;
  const lowerLegRad = 0.10;
  // Foot is a flat cuboid for stable support contact
  const footHX = 0.10;          // half-width (sideways)
  const footHY = 0.05;          // half-height (vertical) — 10cm thick total
  const footHZ = 0.16;          // half-depth (forward/back)
  const hipWidth = 0.16;        // half-distance between hips

  // ---- Standing positions (calculated bottom-up so joint anchors match exactly) ----
  // Foot bottom touches ground (Y=0) when standing
  const footCenterY = footHY + 0.005;  // tiny ground clearance
  // Ankle joint world Y = top of foot
  const ankleWorldY = footCenterY + footHY;
  // Lower leg center: ankle is at lower leg bottom anchor
  const lowerLegCenterY = ankleWorldY + lowerLegLen / 2;
  // Knee world Y = top of lower leg
  const kneeWorldY = lowerLegCenterY + lowerLegLen / 2;
  // Upper leg center: knee is at upper leg bottom anchor
  const upperLegCenterY = kneeWorldY + upperLegLen / 2;
  // Hip world Y = top of upper leg
  const hipWorldY = upperLegCenterY + upperLegLen / 2;
  // Pelvis center: hip is just below pelvis bottom (we use local anchor -pelvisHalfH-0.02)
  const pelvisHipLocalY = -(pelvisHalfH + 0.02);
  const pelvisCenterY = hipWorldY - pelvisHipLocalY;

  // Sync the tuning standing height to the actual rest pose
  tuning.standingHeight = pelvisCenterY;

  // ============================================================
  // PELVIS — dynamic root
  // ============================================================
  // Pelvis must be heavy enough that the height spring can support it.
  // We set additional mass directly so density tuning isn't confusing.
  const pelvis = physics.createDynamicBody(
    spawnX, pelvisCenterY, spawnZ,
    3.0,    // additional mass: ~3 kg
    1.5,    // angular damping (moderate, balance controller does the work)
    0.5,    // linear damping
    8       // extra solver iterations
  );
  physics.addCapsuleCollider(pelvis, pelvisHalfH, pelvisRadius, 1.0, 0.3, 0.0);
  joints.set('torso', { name: 'torso', body: pelvis });
  allBodies.push(pelvis);

  // ============================================================
  // Build one leg — returns the foot info
  // ============================================================
  const buildLeg = (side: 'l' | 'r'): FootInfo => {
    const sign = side === 'l' ? -1 : 1;
    const legX = spawnX + hipWidth * sign;

    // ---- Upper leg ----
    const upperLeg = physics.createDynamicBody(
      legX, upperLegCenterY, spawnZ,
      0.8,    // mass
      0.6,    // angular damping (let motors drive, not damping)
      0.3,    // linear damping
      6
    );
    physics.addCapsuleCollider(upperLeg, upperLegLen / 2, upperLegRad, 1.0, 0.4, 0.0);
    allBodies.push(upperLeg);

    const hipJoint = physics.createHingeJoint(
      pelvis, upperLeg,
      { x: hipWidth * sign, y: pelvisHipLocalY, z: 0 },   // pelvis local anchor
      { x: 0, y: upperLegLen / 2, z: 0 },                  // upper leg local anchor (top)
      { x: 1, y: 0, z: 0 },                                 // hinge axis: X (forward/back swing)
      { min: -1.2, max: 1.2 },                              // limits ~±70°
      {
        targetPos: tuning.neutralHip,
        stiffness: tuning.hipStiffness,
        damping: tuning.hipDamping,
      }
    );
    joints.set(`hip_${side}`, { name: `hip_${side}`, body: upperLeg, joint: hipJoint });

    // ---- Lower leg ----
    const lowerLeg = physics.createDynamicBody(
      legX, lowerLegCenterY, spawnZ,
      0.6, 0.6, 0.3, 6
    );
    physics.addCapsuleCollider(lowerLeg, lowerLegLen / 2, lowerLegRad, 1.0, 0.4, 0.0);
    allBodies.push(lowerLeg);

    const kneeJoint = physics.createHingeJoint(
      upperLeg, lowerLeg,
      { x: 0, y: -upperLegLen / 2, z: 0 },                 // upper leg bottom
      { x: 0, y: lowerLegLen / 2, z: 0 },                  // lower leg top
      { x: 1, y: 0, z: 0 },
      { min: -1.4, max: 0.05 },                             // knee bends backward only
      {
        targetPos: tuning.neutralKnee,
        stiffness: tuning.kneeStiffness,
        damping: tuning.kneeDamping,
      }
    );
    joints.set(`knee_${side}`, { name: `knee_${side}`, body: lowerLeg, joint: kneeJoint });

    // ---- Foot (cuboid) ----
    // Foot body needs to be HEAVY enough to plant firmly.
    const foot = physics.createDynamicBody(
      legX, footCenterY, spawnZ + 0.02,  // slight forward offset so foot extends forward
      0.6, 1.0, 0.5, 6
    );
    physics.addCuboidCollider(foot, footHX, footHY, footHZ, 1.5, tuning.footFriction, 0.0);
    allBodies.push(foot);

    // Foot sensor: thin cuboid just below the foot for ground contact detection
    const sensor = physics.addSensorCollider(
      foot,
      footHX * 0.9, 0.03, footHZ * 0.9,
      { x: 0, y: -footHY - 0.02, z: 0 }
    );

    const ankleJoint = physics.createHingeJoint(
      lowerLeg, foot,
      { x: 0, y: -lowerLegLen / 2, z: 0 },                 // lower leg bottom
      { x: 0, y: footHY, z: -0.02 },                        // foot top, matched to spawn offset
      { x: 1, y: 0, z: 0 },
      { min: -0.5, max: 0.5 },
      {
        targetPos: 0,
        stiffness: tuning.ankleStiffness,
        damping: tuning.ankleDamping,
      }
    );
    joints.set(`ankle_${side}`, { name: `ankle_${side}`, body: foot, joint: ankleJoint });

    return { body: foot, sensor };
  };

  const footL = buildLeg('l');
  const footR = buildLeg('r');

  return {
    joints,
    allBodies,
    pelvis,
    footL,
    footR,
    restingPelvisY: pelvisCenterY,
  };
}
