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
/**
 * Bits 1..8 are available for PER-BEAST collision membership. Each spawned
 * beast is assigned a unique bit so its own body parts don't collide with
 * each other (self-collision = ragdoll explosions), but parts still collide
 * with the arena AND with every OTHER beast's parts.
 *
 * Arena filter accepts everything.
 * Beast N membership bit = 1 << (N+1).
 * Beast N solid filter = arena bit + all other beast bits (i.e. NOT its own).
 *
 * Helpers below compute the right groups given a beast index.
 */
const MAX_BEASTS = 8;
const ALL_BEAST_BITS = ((1 << MAX_BEASTS) - 1) << 1; // bits 1..8 set

const GROUP_SENSOR_BIT = 0x0400; // bit 10 — well above beast bits

export const COLLISION_GROUPS = {
  // Arena collides with everything
  ARENA: (GROUP_ARENA_BIT << 16) | 0xFFFF,
  // Default solid (legacy arena-only). Replaced per-beast at spawn time.
  CREATURE_SOLID: (0x0002 << 16) | GROUP_ARENA_BIT,
  // Sensor colliders intersect with arena only
  CREATURE_SENSOR: (GROUP_SENSOR_BIT << 16) | GROUP_ARENA_BIT,
};

/**
 * Compute the InteractionGroups for a specific beast's solid colliders.
 *
 * @param beastIndex   0-based index (0..MAX_BEASTS-1)
 * @returns A 32-bit groups value where membership = this beast's unique bit
 *          and filter = arena + every OTHER beast's bit (but not its own).
 */
export function creatureSolidGroups(beastIndex: number): number {
  const myBit = 1 << (beastIndex + 1);
  const otherBeasts = ALL_BEAST_BITS & ~myBit;
  const filter = GROUP_ARENA_BIT | otherBeasts;
  return (myBit << 16) | filter;
}

/**
 * Compute the sensor groups for a specific beast — foot sensors
 * should only detect the arena, never other creatures.
 */
export function creatureSensorGroups(_beastIndex: number): number {
  // Sensors: same for all beasts — intersect with arena only
  return (GROUP_SENSOR_BIT << 16) | GROUP_ARENA_BIT;
}

export class RapierWorld {
  world!: RAPIER.World;
  rapier!: typeof RAPIER;
  eventQueue!: RAPIER.EventQueue;
  private initialized = false;

  /**
   * Current creature collision groups. Skeleton builders set this via
   * `beginBeast(index)` before creating any creature bodies; collider
   * helpers pick it up automatically. Default is beast index 0.
   */
  private activeCreatureGroups = creatureSolidGroups(0);
  private activeSensorGroups = creatureSensorGroups(0);

  /**
   * Begin building the colliders for beast N. All subsequent calls to
   * `addCapsuleCollider`, `addCuboidCollider`, `addBallCollider`, and
   * `addSensorCollider` will use beast N's collision groups until the
   * next `beginBeast` call.
   */
  beginBeast(beastIndex: number): void {
    this.activeCreatureGroups = creatureSolidGroups(beastIndex);
    this.activeSensorGroups = creatureSensorGroups(beastIndex);
  }

  async init() {
    await RAPIER.init();
    this.rapier = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    // Bump solver iterations for stability with motorized joints.
    // Default is 4. Active ragdoll needs more.
    this.world.numSolverIterations = 8;
    this.world.numInternalPgsIterations = 2;
    (this.world as any).numAdditionalFrictionIterations = 4;

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

  /**
   * Create a flat ground plane collider.
   * Use createHeightfieldGround for terrain that matches the visual mesh.
   */
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

  /**
   * Create a heightfield ground collider that matches a visual terrain mesh.
   *
   * IMPORTANT: Despite what the JSDoc on `ColliderDesc.heightfield` says,
   * `nrows`/`ncols` are SUBDIVISION counts, not matrix dimensions.
   * The heights array MUST contain `(nrows+1) * (ncols+1)` samples
   * (one per grid intersection, including borders). This was verified
   * empirically — passing `nrows*ncols` heights triggers a WASM panic.
   *
   * The grid is centered at the body origin and spans local coords
   * [-0.5, 0.5] × [-0.5, 0.5], stretched to world units by the scale.
   *
   * @param subdivisionsX  Number of cell subdivisions along local X.
   * @param subdivisionsZ  Number of cell subdivisions along local Z.
   * @param heights        Column-major Float32Array of length (sx+1)*(sz+1).
   * @param scale          World-space scale of the heightfield (X/Y/Z).
   */
  createHeightfieldGround(
    subdivisionsX: number,
    subdivisionsZ: number,
    heights: Float32Array,
    scale: { x: number; y: number; z: number }
  ): RAPIER.RigidBody {
    const expectedLen = (subdivisionsX + 1) * (subdivisionsZ + 1);
    if (heights.length !== expectedLen) {
      throw new Error(
        `Heightfield: heights.length (${heights.length}) must equal ` +
        `(subdivisionsX+1)*(subdivisionsZ+1) = ${expectedLen}`
      );
    }
    const bodyDesc = this.rapier.RigidBodyDesc.fixed();
    const body = this.world.createRigidBody(bodyDesc);
    const scaleVec = { x: scale.x, y: scale.y, z: scale.z };
    const colliderDesc = this.rapier.ColliderDesc.heightfield(
      subdivisionsX, subdivisionsZ, heights, scaleVec
    )
      .setFriction(1.2)
      .setRestitution(0.0)
      .setCollisionGroups(COLLISION_GROUPS.ARENA);
    this.world.createCollider(colliderDesc, body);
    return body;
  }

  /**
   * Create a fixed body with a convex-hull collider built from a vertex cloud.
   * Used for rocks so their collider matches the deformed visual silhouette.
   * @param vertices   Float32Array of (x,y,z) triples in LOCAL space.
   * @param position   World-space position of the body.
   */
  createConvexHullBody(
    vertices: Float32Array,
    position: { x: number; y: number; z: number }
  ): RAPIER.RigidBody | null {
    const bodyDesc = this.rapier.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = this.rapier.ColliderDesc.convexHull(vertices);
    if (!colliderDesc) {
      this.world.removeRigidBody(body);
      return null;
    }
    colliderDesc
      .setFriction(0.7)
      .setRestitution(0.05)
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
   * CCD (Continuous Collision Detection) is enabled by default so
   * fast-moving creature parts don't tunnel through the heightfield
   * during jumps / falls / recoveries. Without this, the beast
   * progressively sinks into the ground.
   */
  createDynamicBody(
    x: number, y: number, z: number,
    mass: number = 0,
    angularDamping: number = 0.5,
    linearDamping: number = 0.3,
    extraSolverIterations: number = 4,
    enableCcd: boolean = true
  ): RAPIER.RigidBody {
    const bodyDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(linearDamping)
      .setAngularDamping(angularDamping)
      .setAdditionalSolverIterations(extraSolverIterations)
      .setCcdEnabled(enableCcd);
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
      .setCollisionGroups(this.activeCreatureGroups);
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
      .setCollisionGroups(this.activeCreatureGroups);
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
      .setCollisionGroups(this.activeCreatureGroups);
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
      .setCollisionGroups(this.activeSensorGroups)
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
   *
   * IMPORTANT: contacts between the two linked bodies are EXPLICITLY DISABLED.
   * The 4th boolean to createImpulseJoint in Rapier is `wakeUp`, NOT
   * "disable contacts". We must call `setContactsEnabled(false)` on the
   * joint after creation to prevent self-collision between connected
   * skeleton parts (which would cause ragdoll explosions).
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
    joint.setContactsEnabled(false);
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
