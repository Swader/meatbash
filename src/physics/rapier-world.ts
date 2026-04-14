import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Rapier 3D physics world wrapper.
 *
 * Owns the WASM physics simulation. All rigid bodies, colliders, joints,
 * and sensors are created through this class for consistent setup.
 */

// Collision groups (membership << 16 | filter)
// - ARENA: ground, walls, rocks, decorations
// - CREATURE_SOLID: physical creature bodies (no self-collision)
// - CREATURE_SENSOR: foot sensors (intersect with arena only)
const GROUP_ARENA_BIT = 0x0001;
const GROUP_CREATURE_BIT = 0x0002;
const GROUP_SENSOR_BIT = 0x0004;

export const COLLISION_GROUPS = {
  // Arena collides with everything
  ARENA: (GROUP_ARENA_BIT << 16) | 0xFFFF,
  // Creature solid bodies collide with arena only (no self-collision)
  CREATURE_SOLID: (GROUP_CREATURE_BIT << 16) | GROUP_ARENA_BIT,
  // Sensor colliders intersect with arena only
  CREATURE_SENSOR: (GROUP_SENSOR_BIT << 16) | GROUP_ARENA_BIT,
};

export class RapierWorld {
  world!: RAPIER.World;
  rapier!: typeof RAPIER;
  eventQueue!: RAPIER.EventQueue;
  private initialized = false;

  async init() {
    await RAPIER.init();
    this.rapier = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    // Bump solver iterations for stability with motorized joints.
    // Default is 4. Active ragdoll needs more.
    this.world.numSolverIterations = 8;
    this.world.numInternalPgsIterations = 2;
    this.world.numAdditionalFrictionIterations = 4;

    this.eventQueue = new RAPIER.EventQueue(true);
    this.initialized = true;
  }

  /** Step the simulation. Emits collision/intersection events into eventQueue. */
  step() {
    if (!this.initialized) return;
    this.world.step(this.eventQueue);
  }

  // ============================================================
  // ARENA — fixed colliders for ground, walls, rocks
  // ============================================================

  /** Create a ground plane collider */
  createGround(): RAPIER.RigidBody {
    const bodyDesc = this.rapier.RigidBodyDesc.fixed();
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = this.rapier.ColliderDesc.cuboid(40, 0.5, 40)
      .setTranslation(0, -0.5, 0)
      .setFriction(1.2)
      .setRestitution(0.0)
      .setCollisionGroups(COLLISION_GROUPS.ARENA);
    this.world.createCollider(colliderDesc, body);
    return body;
  }

  /** Create arena wall colliders (invisible boundaries) */
  createArenaWalls(halfSize: number = 35): RAPIER.RigidBody[] {
    const walls: RAPIER.RigidBody[] = [];
    const wallHeight = 10;
    const wallThickness = 1;

    const wallPositions = [
      { x: halfSize, y: wallHeight / 2, z: 0, hw: wallThickness, hh: wallHeight / 2, hd: halfSize },
      { x: -halfSize, y: wallHeight / 2, z: 0, hw: wallThickness, hh: wallHeight / 2, hd: halfSize },
      { x: 0, y: wallHeight / 2, z: halfSize, hw: halfSize, hh: wallHeight / 2, hd: wallThickness },
      { x: 0, y: wallHeight / 2, z: -halfSize, hw: halfSize, hh: wallHeight / 2, hd: wallThickness },
    ];

    for (const wp of wallPositions) {
      const bodyDesc = this.rapier.RigidBodyDesc.fixed();
      const body = this.world.createRigidBody(bodyDesc);
      const colliderDesc = this.rapier.ColliderDesc.cuboid(wp.hw, wp.hh, wp.hd)
        .setTranslation(wp.x, wp.y, wp.z)
        .setFriction(0.5)
        .setRestitution(0.1)
        .setCollisionGroups(COLLISION_GROUPS.ARENA);
      this.world.createCollider(colliderDesc, body);
      walls.push(body);
    }
    return walls;
  }

  /** Create rock collider matching a visual rock */
  createRockCollider(x: number, y: number, z: number, radius: number): RAPIER.RigidBody {
    const bodyDesc = this.rapier.RigidBodyDesc.fixed();
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = this.rapier.ColliderDesc.ball(radius * 0.8)
      .setTranslation(x, y, z)
      .setFriction(0.7)
      .setRestitution(0.1)
      .setCollisionGroups(COLLISION_GROUPS.ARENA);
    this.world.createCollider(colliderDesc, body);
    return body;
  }

  // ============================================================
  // DYNAMIC BODIES — for creature parts
  // ============================================================

  /**
   * Create a dynamic rigid body with explicit additional mass.
   *
   * NOTE: The `mass` argument is now actually applied via setAdditionalMass.
   * Previously it was accepted but ignored, leading to confusing tuning.
   */
  createDynamicBody(
    x: number, y: number, z: number,
    mass: number = 0,
    angularDamping: number = 0.5,
    linearDamping: number = 0.3,
    extraSolverIterations: number = 4
  ): RAPIER.RigidBody {
    const bodyDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(linearDamping)
      .setAngularDamping(angularDamping)
      .setAdditionalSolverIterations(extraSolverIterations);
    if (mass > 0) {
      bodyDesc.setAdditionalMass(mass);
    }
    return this.world.createRigidBody(bodyDesc);
  }

  /** Add a capsule collider to a creature body */
  addCapsuleCollider(
    body: RAPIER.RigidBody,
    halfHeight: number,
    radius: number,
    density: number = 1.0,
    friction: number = 0.6,
    restitution: number = 0.0
  ): RAPIER.Collider {
    const colliderDesc = this.rapier.ColliderDesc.capsule(halfHeight, radius)
      .setDensity(density)
      .setFriction(friction)
      .setRestitution(restitution)
      .setCollisionGroups(COLLISION_GROUPS.CREATURE_SOLID);
    return this.world.createCollider(colliderDesc, body);
  }

  /** Add a cuboid (box) collider — useful for foot pads */
  addCuboidCollider(
    body: RAPIER.RigidBody,
    hx: number, hy: number, hz: number,
    density: number = 1.0,
    friction: number = 1.0,
    restitution: number = 0.0,
    offsetY: number = 0
  ): RAPIER.Collider {
    const colliderDesc = this.rapier.ColliderDesc.cuboid(hx, hy, hz)
      .setDensity(density)
      .setFriction(friction)
      .setRestitution(restitution)
      .setTranslation(0, offsetY, 0)
      .setCollisionGroups(COLLISION_GROUPS.CREATURE_SOLID);
    return this.world.createCollider(colliderDesc, body);
  }

  /** Add a ball collider to a body */
  addBallCollider(
    body: RAPIER.RigidBody,
    radius: number,
    density: number = 1.0
  ): RAPIER.Collider {
    const colliderDesc = this.rapier.ColliderDesc.ball(radius)
      .setDensity(density)
      .setFriction(0.6)
      .setRestitution(0.0)
      .setCollisionGroups(COLLISION_GROUPS.CREATURE_SOLID);
    return this.world.createCollider(colliderDesc, body);
  }

  /**
   * Create a sensor collider attached to a body.
   * Sensors detect intersections without physical forces.
   * Use `intersectionPairsWith` to query each frame.
   */
  addSensorCollider(
    body: RAPIER.RigidBody,
    hx: number, hy: number, hz: number,
    offset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
  ): RAPIER.Collider {
    const colliderDesc = this.rapier.ColliderDesc.cuboid(hx, hy, hz)
      .setSensor(true)
      .setTranslation(offset.x, offset.y, offset.z)
      .setCollisionGroups(COLLISION_GROUPS.CREATURE_SENSOR)
      .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS);
    return this.world.createCollider(colliderDesc, body);
  }

  /**
   * Check if a sensor collider is currently intersecting any other collider.
   * Returns true on first intersection found.
   */
  isSensorTouching(sensor: RAPIER.Collider): boolean {
    let touching = false;
    this.world.intersectionPairsWith(sensor, () => {
      touching = true;
    });
    return touching;
  }

  // ============================================================
  // JOINTS
  // ============================================================

  /**
   * Create a revolute (hinge) joint with optional motor and limits.
   */
  createHingeJoint(
    body1: RAPIER.RigidBody,
    body2: RAPIER.RigidBody,
    anchor1: { x: number; y: number; z: number },
    anchor2: { x: number; y: number; z: number },
    axis: { x: number; y: number; z: number },
    limits?: { min: number; max: number },
    motor?: { targetPos: number; stiffness: number; damping: number }
  ): RAPIER.RevoluteImpulseJoint {
    const params = this.rapier.JointData.revolute(anchor1, anchor2, axis);
    if (limits) {
      params.limitsEnabled = true;
      params.limits = [limits.min, limits.max];
    }
    const joint = this.world.createImpulseJoint(params, body1, body2, true) as RAPIER.RevoluteImpulseJoint;
    if (motor) {
      joint.configureMotorPosition(motor.targetPos, motor.stiffness, motor.damping);
    }
    return joint;
  }

  /** Create a ball (spherical) joint */
  createBallJoint(
    body1: RAPIER.RigidBody,
    body2: RAPIER.RigidBody,
    anchor1: { x: number; y: number; z: number },
    anchor2: { x: number; y: number; z: number }
  ): RAPIER.ImpulseJoint {
    const params = this.rapier.JointData.spherical(anchor1, anchor2);
    return this.world.createImpulseJoint(params, body1, body2, true);
  }

  // ============================================================
  // FORCE / IMPULSE WRAPPERS
  // ============================================================

  applyTorqueImpulse(body: RAPIER.RigidBody, torque: { x: number; y: number; z: number }) {
    body.applyTorqueImpulse(torque, true);
  }

  applyImpulse(body: RAPIER.RigidBody, impulse: { x: number; y: number; z: number }) {
    body.applyImpulse(impulse, true);
  }

  /** Add a continuous force to a body (reset each step). */
  addForce(body: RAPIER.RigidBody, force: { x: number; y: number; z: number }) {
    body.addForce(force, true);
  }

  /** Add a continuous torque to a body (reset each step). */
  addTorque(body: RAPIER.RigidBody, torque: { x: number; y: number; z: number }) {
    body.addTorque(torque, true);
  }

  // ============================================================
  // QUERIES
  // ============================================================

  getPosition(body: RAPIER.RigidBody): { x: number; y: number; z: number } {
    return body.translation();
  }

  getRotation(body: RAPIER.RigidBody): { x: number; y: number; z: number; w: number } {
    return body.rotation();
  }
}
