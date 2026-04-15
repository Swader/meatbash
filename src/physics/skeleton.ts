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
  /** Resting pelvis Y when both feet planted, in WORLD space (includes terrain offset). */
  restingPelvisY: number;
  /** Resting pelvis HEIGHT above terrain (constant, terrain-relative). */
  restingPelvisHeightAboveGround: number;
  /** True when this skeleton has arms (shoulder + elbow joints on each side). */
  hasArms: boolean;
}

export interface BipedSkeletonOptions {
  /** Build the beast with two arms. Adds upper-arm (shoulder) and lower-arm
   *  (elbow) bodies on each side, attached to the pelvis via Z-axis hinges
   *  so they swing freely from "down" to "out to the side" — perfect for
   *  flailing, smacking enemies on the spin, and adding visual character. */
  withArms?: boolean;
}

/**
 * Build an active-ragdoll bipedal skeleton.
 *
 * Architecture:
 * - DYNAMIC pelvis body, hidden small capsule. NOT kinematic.
 * - 70%+ of mass in pelvis, COM positioned slightly LOW (toward hips).
 * - Real foot bodies (cuboids) with high friction and intersection sensors.
 * - Hip / knee / ankle revolute joints, all motorized.
 * - Self-collision disabled via collision groups AND per-joint
 *   `setContactsEnabled(false)` (belt and suspenders).
 *
 * The physics rig is optimized for stability and contact quality, NOT
 * for visual resemblance — the visible meat blob is a separate layer.
 */
export function createBipedSkeleton(
  physics: RapierWorld,
  spawnX: number = 0,
  spawnZ: number = 0,
  groundY: number = 0,
  options: BipedSkeletonOptions = {}
): BipedSkeleton {
  const joints = new Map<string, SkeletonJoint>();
  const allBodies: RAPIER.RigidBody[] = [];
  const withArms = !!options.withArms;

  // ---- Dimensions (m) ----
  // Hidden pelvis — bigger than before so it actually sits inside the
  // visible blob instead of rattling around like a marble in a balloon.
  // Still smaller than the visual radius (~0.42) to let the meat hang
  // over the edges naturally.
  const pelvisHalfH = 0.16;
  const pelvisRadius = 0.25;
  const upperLegLen = 0.42;
  const upperLegRad = 0.11;
  const lowerLegLen = 0.40;
  const lowerLegRad = 0.09;
  // Foot is a flat cuboid for stable support contact
  const footHX = 0.10;
  const footHY = 0.05;
  const footHZ = 0.16;
  const hipWidth = 0.16;

  // ---- Standing positions (calculated bottom-up so joint anchors match exactly) ----
  // Foot bottom touches ground (groundY) when standing
  const footCenterY = groundY + footHY + 0.005;
  // Ankle joint world Y = top of foot
  const ankleWorldY = footCenterY + footHY;
  const lowerLegCenterY = ankleWorldY + lowerLegLen / 2;
  const kneeWorldY = lowerLegCenterY + lowerLegLen / 2;
  const upperLegCenterY = kneeWorldY + upperLegLen / 2;
  const hipWorldY = upperLegCenterY + upperLegLen / 2;
  // Hip anchor on the pelvis is BELOW its center (lowers COM toward hips)
  const pelvisHipLocalY = -(pelvisHalfH + 0.02);
  const pelvisCenterY = hipWorldY - pelvisHipLocalY;

  // The constant "how high the pelvis sits above the terrain" — locomotion
  // uses this for support height calculations independent of slope.
  const restingPelvisHeightAboveGround = pelvisCenterY - groundY;
  tuning.standingHeight = restingPelvisHeightAboveGround;

  // ============================================================
  // PELVIS — dynamic root, MOST of the beast's mass
  // ============================================================
  // 70% of total mass in the pelvis = stable base, less prone to
  // helicopter-leg flipping. Damping is MODEST — the state machine
  // + support spring do the real stabilizing work, not damping.
  const pelvis = physics.createDynamicBody(
    spawnX, pelvisCenterY, spawnZ,
    5.5,    // additional mass: ~5.5 kg
    1.2,    // angular damping (moderate — was 2.6)
    0.6,    // linear damping (moderate — was 1.4)
    8       // extra solver iterations
  );
  // Bigger, smoother pelvis collider — low friction so it doesn't catch on rocks.
  physics.addCapsuleCollider(pelvis, pelvisHalfH, pelvisRadius, 1.0, 0.25, 0.0);
  joints.set('torso', { name: 'torso', body: pelvis });
  allBodies.push(pelvis);

  // ============================================================
  // Build one leg — returns the foot info
  // ============================================================
  const buildLeg = (side: 'l' | 'r'): FootInfo => {
    const sign = side === 'l' ? -1 : 1;
    const legX = spawnX + hipWidth * sign;

    // ---- Upper leg (light, motors do the work) ----
    const upperLeg = physics.createDynamicBody(
      legX, upperLegCenterY, spawnZ,
      0.5,    // light limb mass
      1.5,    // angular damping — was 2.8 (over-damped)
      0.4,
      6
    );
    physics.addCapsuleCollider(upperLeg, upperLegLen / 2, upperLegRad, 1.0, 0.4, 0.0);
    allBodies.push(upperLeg);

    const hipJoint = physics.createHingeJoint(
      pelvis, upperLeg,
      { x: hipWidth * sign, y: pelvisHipLocalY, z: 0 },
      { x: 0, y: upperLegLen / 2, z: 0 },
      { x: 1, y: 0, z: 0 },
      { min: -1.2, max: 1.2 },
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
      0.4, 1.8, 0.4, 6  // angular damping was 3.4 (over-damped)
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
    joints.set(`knee_${side}`, { name: `knee_${side}`, body: lowerLeg, joint: kneeJoint });

    // ---- Foot (cuboid with high friction) ----
    const foot = physics.createDynamicBody(
      legX, footCenterY, spawnZ + 0.02,
      0.3, 1.0, 0.5, 6
    );
    physics.addCuboidCollider(foot, footHX, footHY, footHZ, 1.5, tuning.footFriction, 0.0);
    allBodies.push(foot);

    // Foot sensor extending well below — catches ground from a generous range
    const sensor = physics.addSensorCollider(
      foot,
      footHX * 0.95, 0.08, footHZ * 0.95,
      { x: 0, y: -footHY - 0.06, z: 0 }
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
    joints.set(`ankle_${side}`, { name: `ankle_${side}`, body: foot, joint: ankleJoint });

    return { body: foot, sensor };
  };

  const footL = buildLeg('l');
  const footR = buildLeg('r');

  // ============================================================
  // ARMS (optional)
  //
  // Each arm = upper-arm capsule + lower-arm capsule.
  // - Shoulder: revolute hinge attached to the TOP-SIDE of the pelvis.
  //   Axis = Z (torso forward), so the arm can rotate from "hanging
  //   down" to "out to the side" in the body's lateral plane. When the
  //   beast spins (yaws) around Y, centrifugal force in the body frame
  //   pushes radially outward — that translates into a torque around
  //   the (rotated) Z axis at the shoulder, swinging the arm OUT. End
  //   result: a fast spin makes the arms fly out and smack everything
  //   they pass through.
  // - Elbow: revolute hinge between upper and lower arm on the X axis,
  //   so the lower arm can fold like a normal elbow.
  // - Motors are very weak: we add just enough damping/restoring force
  //   to keep arms from oscillating forever. Most of the motion comes
  //   from physics — gravity hangs them down, momentum throws them.
  //
  // Arms add mass (~1.2 kg total), which lets them deal real damage
  // on impact via the existing collision-event damage system. They're
  // tagged as 'shoulder_l/r' (upper) and 'elbow_l/r' (lower) so they
  // show up in the joint map alongside hip/knee/ankle without colliding
  // with leg lookups.
  // ============================================================
  if (withArms) {
    const upperArmLen = 0.36;
    const upperArmRad = 0.085;
    const lowerArmLen = 0.34;
    const lowerArmRad = 0.075;
    // Shoulder world position: ABOVE and OUTSIDE the visual torso.
    //
    // The visible meat blob is a sphere of radius 0.42 centered on the
    // pelvis. If we anchor the shoulder anywhere inside that sphere, the
    // arm's first 30 cm is buried in meat and the player just sees a
    // limbless ball (which is exactly what was happening before this
    // tweak). shoulderWidth=0.50 puts the anchor cleanly outside the
    // sphere on the X axis, and the higher Y offset makes the arm hang
    // visibly from the upper torso instead of poking out of the belly.
    const shoulderWidth = 0.50;
    const pelvisShoulderLocalY = pelvisHalfH + 0.10;
    const shoulderWorldY = pelvisCenterY + pelvisShoulderLocalY;
    // Upper-arm center hangs below the shoulder.
    const upperArmCenterY = shoulderWorldY - upperArmLen / 2;
    // Lower-arm center hangs below the upper arm (aligned, arm straight).
    const lowerArmCenterY = upperArmCenterY - upperArmLen / 2 - lowerArmLen / 2;

    const buildArm = (side: 'l' | 'r') => {
      const sign = side === 'l' ? -1 : 1;
      const armX = spawnX + shoulderWidth * sign;

      // ---- Upper arm ----
      // Light enough to swing fast, heavy enough to hurt on impact.
      const upperArm = physics.createDynamicBody(
        armX, upperArmCenterY, spawnZ,
        0.6,    // additional mass ~0.6 kg — comparable to a thigh
        1.2,    // angular damping (let it swing a bit)
        0.4,    // linear damping
        6
      );
      physics.addCapsuleCollider(upperArm, upperArmLen / 2, upperArmRad, 1.0, 0.4, 0.05);
      allBodies.push(upperArm);

      // Shoulder = Z-axis hinge. Arm rotates in the body's XY plane.
      // Limits: a wide arc from "tucked across body" through "down" to
      // "fully extended outward and up". For the right arm (sign=+1) we
      // want positive rotation = arm out to the right / up. For left
      // (sign=-1) we mirror it. Using `sign * angle` lets the same min/max
      // describe both arms naturally — the hinge axis is always +Z, but
      // the limit signs flip.
      // The default rest target is hanging straight down (rotation = 0).
      // We give it a TINY restoring spring so it doesn't drift outward
      // when there's no input, but the spring is way too weak to fight a
      // real spin. Result: floppy but not chaotic.
      const minLimit = sign > 0 ? -1.4 : -2.6;
      const maxLimit = sign > 0 ?  2.6 :  1.4;
      const shoulderJoint = physics.createHingeJoint(
        pelvis, upperArm,
        { x: shoulderWidth * sign, y: pelvisShoulderLocalY, z: 0 },
        { x: 0, y: upperArmLen / 2, z: 0 },
        { x: 0, y: 0, z: 1 },               // Z-axis hinge
        { min: minLimit, max: maxLimit },
        {
          targetPos: 0,
          stiffness: 2.0,                   // very weak — gravity dominates
          damping: 0.8,
        }
      );
      joints.set(`shoulder_${side}`, {
        name: `shoulder_${side}`,
        body: upperArm,
        joint: shoulderJoint,
      });

      // ---- Lower arm ----
      const lowerArm = physics.createDynamicBody(
        armX, lowerArmCenterY, spawnZ,
        0.45,   // additional mass ~0.45 kg
        1.2,
        0.4,
        6
      );
      physics.addCapsuleCollider(lowerArm, lowerArmLen / 2, lowerArmRad, 1.0, 0.4, 0.05);
      allBodies.push(lowerArm);

      // Elbow = X-axis hinge so the lower arm can fold forward (like a
      // human elbow). Limits: -2.4 to 0.05 — almost full bend in one
      // direction, barely any back-bend.
      const elbowJoint = physics.createHingeJoint(
        upperArm, lowerArm,
        { x: 0, y: -upperArmLen / 2, z: 0 },
        { x: 0, y:  lowerArmLen / 2, z: 0 },
        { x: 1, y: 0, z: 0 },
        { min: -2.4, max: 0.05 },
        {
          targetPos: -0.3,                  // slight rest bend
          stiffness: 3.0,
          damping: 1.2,
        }
      );
      joints.set(`elbow_${side}`, {
        name: `elbow_${side}`,
        body: lowerArm,
        joint: elbowJoint,
      });
    };

    buildArm('l');
    buildArm('r');
  }

  return {
    joints,
    allBodies,
    pelvis,
    footL,
    footR,
    restingPelvisY: pelvisCenterY,
    restingPelvisHeightAboveGround,
    hasArms: withArms,
  };
}

/**
 * Sum the actual masses of every body in a skeleton.
 * Used to mass-normalize drive force, turn torque, jump impulse, stamina.
 *
 * Recomputed each frame so that future mass loss (combat damage) is
 * automatically reflected in locomotion strength.
 */
export function getTotalMass(skeleton: BipedSkeleton): number {
  let total = 0;
  for (const body of skeleton.allBodies) {
    total += body.mass();
  }
  return total;
}
