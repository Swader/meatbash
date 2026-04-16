/**
 * Collision-based damage system.
 *
 * Hooks Rapier contact events between creature colliders and converts
 * them to per-beast mass loss. For Phase 2 Block 2 this is a simple
 * HP model — each body segment has a `segmentHP` value that ticks
 * down on hits, and the beast's `massFraction` is the average of all
 * segment HPs. Block 2B will use segment HP to sever limbs.
 *
 * Damage formula (tuneable via constants below):
 *
 *   damage = k * |relative velocity| * (impactor mass + defender mass) / 2
 *
 * So: heavy, fast hits hurt a lot, light slow bumps barely tick. A
 * beast can't damage itself (contacts between two bodies of the same
 * BeastInstance are filtered out).
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { BeastInstance } from '../beast/beast-instance';
import type { ActiveAttackContext, AttackProfile, ChargeTier } from '../combat/attack-types';

// ---- Tuneable constants ----

/** Global damage scalar. Raise for squishier beasts, lower for durable. */
const DAMAGE_SCALE = 0.02;
/** Minimum impact speed (m/s) below which contacts are ignored.
 *  Lowered from 1.0 → 0.6 so arm flailing (which is slow) still registers. */
const IMPACT_SPEED_THRESHOLD = 0.6;
/** Max HP per body segment (so it takes multiple big hits to destroy one). */
const SEGMENT_MAX_HP = 100;
/** Cooldown (s) between damage events on the same pair, prevents rapid double-dipping. */
const PAIR_COOLDOWN = 0.08;
/**
 * Bonus damage multiplier when an arm segment (shoulder_*, elbow_*) is the
 * INCOMING side of a contact. Arms have momentum + reach, so a swung arm
 * should hurt more than a casual torso bump. The arm itself still takes
 * normal damage on its own segment.
 */
const ARM_IMPACT_BONUS = 1.45;
const PASSIVE_DAMAGE_MUL = 0.38;
const PASSIVE_CHARGE_DAMAGE_MUL = 0.14;
const PASSIVE_CHARGE_SPEED_THRESHOLD = 1.8;
const ACTIVE_DAMAGE_MIN = 12;
const ACTIVE_DAMAGE_MUL = 2;

const ARM_SEGMENTS = new Set([
  'shoulder_l',
  'shoulder_r',
  'elbow_l',
  'elbow_r',
]);

export interface DamageEvent {
  /** The beast that took damage. */
  victim: BeastInstance;
  /** The beast that dealt it (usually the other one, can be null if e.g. a rock). */
  attacker: BeastInstance | null;
  /** Which segment name on the victim was hit (e.g. "torso", "knee_l"). */
  segment: string;
  /** Amount of HP removed. */
  amount: number;
  /** World-space location of the impact. */
  point: { x: number; y: number; z: number };
  /** Relative speed at impact, m/s. */
  impactSpeed: number;
  source: 'passive' | 'active';
  profile?: AttackProfile;
  chargeTier?: ChargeTier;
  blocked: boolean;
  glancing: boolean;
  splashText: string;
  hitstop: number;
  shake: number;
}

/**
 * Per-beast per-segment HP tracker. Stored on the beast itself (via
 * `beast.damageState`) so mass-fraction queries stay cheap.
 */
export class BeastDamageState {
  /** Segment name → current HP. */
  segmentHP = new Map<string, number>();
  /** Segment name → whether it's still attached (severance is Block 2B). */
  segmentAttached = new Map<string, boolean>();
  private totalSegments = 0;

  constructor(beast: BeastInstance) {
    for (const [name] of beast.skeleton.joints) {
      this.segmentHP.set(name, SEGMENT_MAX_HP);
      this.segmentAttached.set(name, true);
      this.totalSegments++;
    }
  }

  /** Apply damage to a named segment. Returns actual HP removed. */
  applyDamage(segment: string, amount: number): number {
    const cur = this.segmentHP.get(segment);
    if (cur === undefined || cur <= 0) return 0;
    const next = Math.max(0, cur - amount);
    this.segmentHP.set(segment, next);
    return cur - next;
  }

  /** Average HP fraction across all still-attached segments. 1.0 = full health. */
  getMassFraction(): number {
    if (this.totalSegments === 0) return 1.0;
    let sum = 0;
    let count = 0;
    for (const [name, attached] of this.segmentAttached) {
      if (!attached) continue;
      sum += (this.segmentHP.get(name) || 0) / SEGMENT_MAX_HP;
      count++;
    }
    if (count === 0) return 0;
    return sum / count;
  }

  /** Is the given segment currently below zero HP? */
  isSegmentDead(segment: string): boolean {
    return (this.segmentHP.get(segment) || 0) <= 0;
  }

  /** How many segments are still attached? */
  getAttachedCount(): number {
    let count = 0;
    for (const attached of this.segmentAttached.values()) if (attached) count++;
    return count;
  }
}

/**
 * Damage resolver. Maintains:
 *   - Per-beast damage state (HP per segment)
 *   - Collider-handle → (beast, segmentName) lookup for O(1) event dispatch
 *   - Pair cooldowns (to prevent double-dipping on a single collision)
 *   - A queue of recent damage events for particles / HUD feedback
 */
export class DamageResolver {
  private colliderIndex = new Map<number, { beast: BeastInstance; segment: string }>();
  private pairCooldowns = new Map<string, number>(); // "<colliderA>:<colliderB>" → time remaining
  private states = new Map<BeastInstance, BeastDamageState>();
  private recentEvents: DamageEvent[] = [];
  private readonly MAX_RECENT = 32;
  private resolvedCommitHits = new WeakMap<BeastInstance, WeakMap<BeastInstance, number>>();

  /**
   * Register a beast with the resolver. Walks every body/collider and
   * enables BOTH collision events and contact-force events so Rapier
   * reports start/stop contacts AND ongoing force magnitudes. Must be
   * called after the beast is spawned.
   */
  register(beast: BeastInstance, rapier: typeof RAPIER, world: RAPIER.World): void {
    const state = new BeastDamageState(beast);
    this.states.set(beast, state);

    // Walk joints (they have the segment names we want to track)
    for (const [name, joint] of beast.skeleton.joints) {
      const body = joint.body;
      // Index every collider on this body back to the beast + segment
      const colCount = body.numColliders();
      for (let i = 0; i < colCount; i++) {
        const col = body.collider(i);
        // Enable both kinds of events. COLLISION_EVENTS fires once per
        // pair start/stop; that's our main damage trigger. Contact-force
        // events add finer-grained ongoing impacts.
        col.setActiveEvents(
          rapier.ActiveEvents.COLLISION_EVENTS |
            rapier.ActiveEvents.CONTACT_FORCE_EVENTS
        );
        // Low force threshold so even gentle bumps get reported.
        try {
          (col as any).setContactForceEventThreshold?.(0.1);
        } catch (e) {
          void e;
        }
        this.colliderIndex.set(col.handle, { beast, segment: name });
      }
    }
    void world;
  }

  /** Remove a beast from tracking (called on teardown). */
  unregister(beast: BeastInstance): void {
    this.states.delete(beast);
    for (const [handle, info] of this.colliderIndex) {
      if (info.beast === beast) this.colliderIndex.delete(handle);
    }
  }

  getState(beast: BeastInstance): BeastDamageState | undefined {
    return this.states.get(beast);
  }

  /** Call this once per fixed step, AFTER physics.step(), BEFORE syncing visuals. */
  processEvents(
    eventQueue: RAPIER.EventQueue,
    world: RAPIER.World,
    dt: number
  ): void {
    // Tick down pair cooldowns
    for (const [key, t] of this.pairCooldowns) {
      const next = t - dt;
      if (next <= 0) this.pairCooldowns.delete(key);
      else this.pairCooldowns.set(key, next);
    }

    const processPair = (h1: number, h2: number) => {
      const a = this.colliderIndex.get(h1);
      const b = this.colliderIndex.get(h2);
      if (!a && !b) return; // neither is a beast — ignore

      // Same-beast contact: already filtered by per-beast collision
      // groups, but double-check in case joint contacts snuck through.
      if (a && b && a.beast === b.beast) return;

      // Pair cooldown key (order-independent)
      const pairKey = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
      if (this.pairCooldowns.has(pairKey)) return;

      const col1 = world.getCollider(h1);
      const col2 = world.getCollider(h2);
      if (!col1 || !col2) return;
      const body1 = col1.parent();
      const body2 = col2.parent();
      if (!body1 || !body2) return;

      const v1 = body1.linvel();
      const v2 = body2.linvel();
      const relVx = v1.x - v2.x;
      const relVy = v1.y - v2.y;
      const relVz = v1.z - v2.z;
      const impactSpeed = Math.sqrt(relVx * relVx + relVy * relVy + relVz * relVz);

      const hasActiveIntent =
        (a && b
          ? this.hasActiveIntentContact(a.beast, a.segment, b.beast) ||
            this.hasActiveIntentContact(b.beast, b.segment, a.beast)
          : false);
      const chargingPassiveContext =
        !hasActiveIntent &&
        ((a && this.isChargingAttack(a.beast)) || (b && this.isChargingAttack(b.beast)));
      const passiveSpeedThreshold = chargingPassiveContext
        ? PASSIVE_CHARGE_SPEED_THRESHOLD
        : IMPACT_SPEED_THRESHOLD;

      if (impactSpeed < passiveSpeedThreshold && !hasActiveIntent) return;

      // Set cooldown only after we've decided it's a real impact
      this.pairCooldowns.set(pairKey, PAIR_COOLDOWN);

      const m1 = body1.mass();
      const m2 = body2.mass();
      const baseDamage =
        DAMAGE_SCALE * impactSpeed * impactSpeed * ((m1 + m2) / 2);

      // Impact point — midpoint of the two collider positions
      const p1 = col1.translation();
      const p2 = col2.translation();
      const point = {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
        z: (p1.z + p2.z) / 2,
      };

      const aIsArm = !!a && ARM_SEGMENTS.has(a.segment);
      const bIsArm = !!b && ARM_SEGMENTS.has(b.segment);

      // Dispatch damage to whichever side is a beast
      if (a) {
        this.damageSegment(
          a.beast,
          a.segment,
          b?.beast || null,
          b?.segment,
          point,
          impactSpeed,
          baseDamage * (bIsArm ? ARM_IMPACT_BONUS : 1),
          undefined
        );
      }
      if (b) {
        this.damageSegment(
          b.beast,
          b.segment,
          a?.beast || null,
          a?.segment,
          point,
          impactSpeed,
          baseDamage * (aIsArm ? ARM_IMPACT_BONUS : 1),
          undefined
        );
      }
    };

    // Collision events: fire on contact start/stop between colliders.
    // We process on start only (started = true).
    eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      processPair(h1, h2);
    });

    // Also process ongoing contact-force events for sustained pressing
    eventQueue.drainContactForceEvents((event) => {
      processPair(event.collider1(), event.collider2());
    });
  }

  processIntentionalHits(attacker: BeastInstance, victim: BeastInstance): void {
    this.tryResolveIntentionalHit(attacker, victim);
    this.tryResolveIntentionalHit(victim, attacker);
  }

  private damageSegment(
    victim: BeastInstance,
    segment: string,
    attacker: BeastInstance | null,
    attackerSegment: string | undefined,
    point: { x: number; y: number; z: number },
    impactSpeed: number,
    baseDamage: number,
    forcedActive: ActiveAttackContext | undefined
  ): void {
    const state = this.states.get(victim);
    if (!state) return;
    let damageAmount = baseDamage * PASSIVE_DAMAGE_MUL;
    let source: 'passive' | 'active' = 'passive';
    let profile: AttackProfile | undefined;
    let chargeTier: ChargeTier | undefined;
    let blocked = false;
    let glancing = false;
    let splashText = 'GLANCE!';
    let hitstop = 0.006;
    let shake = 0.08;
    const chargingPassiveContext =
      (attacker && this.isChargingAttack(attacker)) || this.isChargingAttack(victim);

    if (attacker && attackerSegment) {
      const toVictim = victim.getPosition().sub(attacker.getPosition());
      const dot = this.forwardDot(attacker.getYaw(), toVictim.x, toVictim.z);
      const active =
        forcedActive ??
        attacker.resolveActiveAttackForSegment(attackerSegment, dot) ??
        attacker.resolveGenericActiveAttack(dot);
      if (active) {
        attacker.registerAttackHit();
        source = 'active';
        profile = active.profile;
        chargeTier = active.chargeTier;
        damageAmount = Math.max(
          ACTIVE_DAMAGE_MIN,
          baseDamage * active.damageMul * active.appendageMassMul * active.hitQualityMul
        );
        damageAmount *= ACTIVE_DAMAGE_MUL;
        const blockReduction = victim.getIncomingBlockReduction(active.profile);
        if (blockReduction > 0) {
          blocked = true;
          damageAmount *= 1 - Math.max(0, Math.min(0.8, blockReduction));
          shake = 0.1;
          hitstop = 0.009;
        }
        if (active.profile === 'spike') {
          glancing = active.hitQualityMul < 0.9 || dot < 0.2;
        } else if (active.profile === 'shield') {
          glancing = active.hitQualityMul < 0.78 || dot < -0.05;
        } else {
          glancing = active.hitQualityMul < 0.8 || dot < -0.1;
        }
        if (glancing) damageAmount *= 0.65;

        if (blocked) splashText = 'BLOCK!';
        else if (glancing) splashText = 'GLANCE!';
        else if (active.profile === 'blunt') splashText = chargeTier === 'heavy' ? 'CRUNCH!' : 'BONK!';
        else if (active.profile === 'spike') splashText = chargeTier === 'heavy' ? 'CRUNCH!' : 'STAB!';
        else splashText = chargeTier === 'heavy' ? 'BASH!' : 'SHOVE!';

        if (chargeTier === 'quick') {
          shake = Math.max(shake, 0.12);
          hitstop = Math.max(hitstop, 0.01);
        } else if (chargeTier === 'ready') {
          shake = Math.max(shake, 0.2);
          hitstop = Math.max(hitstop, 0.014);
        } else {
          shake = Math.max(shake, 0.3);
          hitstop = Math.max(hitstop, 0.02);
        }
      }
    }

    if (source === 'passive' && chargingPassiveContext) {
      damageAmount *= PASSIVE_CHARGE_DAMAGE_MUL;
      if (damageAmount < 0.015) return;
    }

    const applied = state.applyDamage(segment, damageAmount);
    if (applied <= 0) return;
    const ev: DamageEvent = {
      victim,
      attacker,
      segment,
      amount: applied,
      point,
      impactSpeed,
      source,
      profile,
      chargeTier,
      blocked,
      glancing,
      splashText,
      hitstop,
      shake,
    };
    this.recentEvents.push(ev);
    while (this.recentEvents.length > this.MAX_RECENT) {
      this.recentEvents.shift();
    }
  }

  /**
   * Drain recent events for consumers (particle system, HUD flash, etc).
   * Each call returns everything that's happened since the last drain.
   */
  drainEvents(): DamageEvent[] {
    const out = this.recentEvents;
    this.recentEvents = [];
    return out;
  }

  private forwardDot(yaw: number, dx: number, dz: number): number {
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = dx / len;
    const nz = dz / len;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    return fx * nx + fz * nz;
  }

  private hasActiveIntentContact(
    attacker: BeastInstance,
    attackerSegment: string,
    victim: BeastInstance
  ): boolean {
    const toVictim = victim.getPosition().sub(attacker.getPosition());
    const dot = this.forwardDot(attacker.getYaw(), toVictim.x, toVictim.z);
    return (
      attacker.resolveActiveAttackForSegment(attackerSegment, dot) !== null ||
      attacker.resolveGenericActiveAttack(dot) !== null
    );
  }

  private isChargingAttack(beast: BeastInstance): boolean {
    const state = beast.getAttackTelemetry()?.state;
    return state === 'WINDUP' || state === 'HELD';
  }

  private tryResolveIntentionalHit(attacker: BeastInstance, victim: BeastInstance): void {
    const telemetry = attacker.getAttackTelemetry();
    const slot = attacker.getPrimaryAttackSlot();
    if (!telemetry || !slot || telemetry.state !== 'COMMIT') return;

    const commitSerial = attacker.getAttackCommitSerial();
    if (commitSerial <= 0) return;

    let pairMap = this.resolvedCommitHits.get(attacker);
    if (!pairMap) {
      pairMap = new WeakMap<BeastInstance, number>();
      this.resolvedCommitHits.set(attacker, pairMap);
    }
    if (pairMap.get(victim) === commitSerial) return;

    const attackerPos = attacker.getPosition();
    const victimPos = victim.getPosition();
    const dx = victimPos.x - attackerPos.x;
    const dz = victimPos.z - attackerPos.z;
    const dot = this.forwardDot(attacker.getYaw(), dx, dz);

    const active =
      attacker.resolveGenericActiveAttack(dot) ??
      slot.hitSegments
        .map((segment) => attacker.resolveActiveAttackForSegment(segment, dot))
        .find((ctx): ctx is ActiveAttackContext => ctx !== null);
    if (!active) return;

    const range =
      active.profile === 'spike' ? 0.45 :
      active.profile === 'shield' ? 1.0 :
      1.15;

    if (active.profile !== 'spike') {
      const broadHit = this.tryResolveBroadBodyHit(attacker, victim, active, dot, commitSerial);
      if (broadHit) {
        pairMap.set(victim, commitSerial);
        return;
      }
    }

    let best:
      | {
          attackerSegment: string;
          victimSegment: string;
          point: { x: number; y: number; z: number };
          distance: number;
          impactSpeed: number;
          baseDamage: number;
        }
      | null = null;

    const victimSegments = Array.from(victim.skeleton.joints.keys());
    for (const attackerSegment of slot.hitSegments) {
      const attackBody = attacker.getJointBody(attackerSegment);
      if (!attackBody) continue;
      const ap = attackBody.translation();
      const av = attackBody.linvel();

      for (const victimSegment of victimSegments) {
        const victimBody = victim.getJointBody(victimSegment);
        if (!victimBody) continue;
        const vp = victimBody.translation();
        const vv = victimBody.linvel();
        const ddx = ap.x - vp.x;
        const ddy = ap.y - vp.y;
        const ddz = ap.z - vp.z;
        const distance = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        if (distance > range) continue;

        const rvx = av.x - vv.x;
        const rvy = av.y - vv.y;
        const rvz = av.z - vv.z;
        const impactSpeed = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz);
        const baseDamage =
          DAMAGE_SCALE * Math.pow(Math.max(impactSpeed, 1.2), 2) * ((attackBody.mass() + victimBody.mass()) / 2) * 4.5;

        if (!best || distance < best.distance) {
          best = {
            attackerSegment,
            victimSegment,
            point: {
              x: (ap.x + vp.x) / 2,
              y: (ap.y + vp.y) / 2,
              z: (ap.z + vp.z) / 2,
            },
            distance,
            impactSpeed,
            baseDamage,
          };
        }
      }
    }

    if (!best) return;

    this.damageSegment(
      victim,
      best.victimSegment,
      attacker,
      best.attackerSegment,
      best.point,
      best.impactSpeed,
      best.baseDamage,
      active
    );
    pairMap.set(victim, commitSerial);

    const knock = 1.3 * active.knockbackMul;
    const fx = Math.sin(attacker.getYaw());
    const fz = Math.cos(attacker.getYaw());
    const victimPelvis = victim.skeleton.pelvis;
    const impulseMass = victimPelvis.mass();
    victimPelvis.applyImpulse(
      {
        x: fx * knock * impulseMass,
        y: 0.18 * knock * impulseMass,
        z: fz * knock * impulseMass,
      },
      true
    );
  }

  private tryResolveBroadBodyHit(
    attacker: BeastInstance,
    victim: BeastInstance,
    active: ActiveAttackContext,
    dot: number,
    commitSerial: number
  ): boolean {
    if (dot < 0.15) return false;

    const attackerAnchor =
      attacker.getJointBody(attacker.getPrimaryAttackSlot()?.appendageRoot ?? 'torso') ??
      attacker.getJointBody('torso');
    if (!attackerAnchor) return false;

    const torsoCandidates = ['torso', 'torso_rear']
      .map((name) => ({ name, body: victim.getJointBody(name) }))
      .filter((entry): entry is { name: string; body: RAPIER.RigidBody } => !!entry.body);
    if (torsoCandidates.length === 0) return false;

    const ap = attackerAnchor.translation();
    const av = attackerAnchor.linvel();
    let bestTorso:
      | {
          name: string;
          body: RAPIER.RigidBody;
          distance: number;
        }
      | null = null;

    for (const torso of torsoCandidates) {
      const vp = torso.body.translation();
      const dx = ap.x - vp.x;
      const dy = ap.y - vp.y;
      const dz = ap.z - vp.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (
        !bestTorso ||
        distance < bestTorso.distance
      ) {
        bestTorso = { ...torso, distance };
      }
    }

    if (!bestTorso) return false;
    const bodyRange = active.profile === 'shield' ? 1.05 : 1.2;
    if (bestTorso.distance > bodyRange) return false;

    const vv = bestTorso.body.linvel();
    const rvx = av.x - vv.x;
    const rvy = av.y - vv.y;
    const rvz = av.z - vv.z;
    const impactSpeed = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz);
    const baseDamage =
      DAMAGE_SCALE *
      Math.pow(Math.max(impactSpeed, active.profile === 'shield' ? 1.4 : 1.6), 2) *
      ((attackerAnchor.mass() + bestTorso.body.mass()) / 2) *
      (active.profile === 'shield' ? 4.2 : 5.0);

    this.damageSegment(
      victim,
      bestTorso.name,
      attacker,
      slotToPrimarySegment(attacker.getPrimaryAttackSlot()),
      {
        x: (ap.x + bestTorso.body.translation().x) / 2,
        y: (ap.y + bestTorso.body.translation().y) / 2,
        z: (ap.z + bestTorso.body.translation().z) / 2,
      },
      impactSpeed,
      baseDamage,
      active
    );

    const victimPelvis = victim.skeleton.pelvis;
    const impulseMass = victimPelvis.mass();
    const fx = Math.sin(attacker.getYaw());
    const fz = Math.cos(attacker.getYaw());
    const shove = active.profile === 'shield' ? 1.5 : 1.2;
    victimPelvis.applyImpulse(
      {
        x: fx * shove * impulseMass,
        y: 0.14 * shove * impulseMass,
        z: fz * shove * impulseMass,
      },
      true
    );

    return true;
  }
}

function slotToPrimarySegment(slot: BeastInstance['definition'] extends never ? never : any): string | undefined {
  if (!slot || !Array.isArray(slot.hitSegments)) return undefined;
  return slot.hitSegments[0];
}
