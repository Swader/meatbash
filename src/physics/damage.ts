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
import type { ActiveAttackContext, AttackProfile, AttackSlotDefinition, ChargeTier } from '../combat/attack-types';

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
const BLOCK_BODY_POINT_RADIUS = 0.5;
const BLOCK_FRONT_ARC_DOT = 0.1;
const SPIKE_TIP_RANGE = 0.38;
const CONTACT_MEMORY_TIME = 0.16;
const CONTACT_MEMORY_LIMIT = 18;
const LAUNCH_WINDOW_TIME = 0.45;
const ENVIRONMENT_SPLAT_SPEED = 1.5;

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
  feedbackMul: number;
  knockbackScale: number;
  locationTag: 'core' | 'mid' | 'edge';
  impactClass: DamageImpactClass;
}

export type DamageImpactClass =
  | 'passive'
  | 'quick'
  | 'ready'
  | 'heavy'
  | 'heavy-clean'
  | 'blocked'
  | 'glancing';

interface ResolvedIntentionalHit {
  attackerSegment: string;
  victimSegment: string;
  point: { x: number; y: number; z: number };
  impactSpeed: number;
  baseDamage: number;
  facingDot?: number;
  qualityMul?: number;
}

interface ContactMemory {
  ownSegment: string;
  otherSegment: string;
  point: { x: number; y: number; z: number };
  impactSpeed: number;
  timeLeft: number;
}

interface StrikeSample {
  segment: string;
  point: { x: number; y: number; z: number };
  radius: number;
  bodyMass: number;
  vel: { x: number; y: number; z: number };
}

interface LaunchWindow {
  timeLeft: number;
  intensity: number;
}

interface SegmentImpactProfile {
  damageMul: number;
  feedbackMul: number;
  knockbackMul: number;
  locationTag: 'core' | 'mid' | 'edge';
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
  private contactHistory = new Map<BeastInstance, Map<BeastInstance, ContactMemory[]>>();
  private launchWindows = new Map<BeastInstance, LaunchWindow>();

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
    this.contactHistory.delete(beast);
    for (const others of this.contactHistory.values()) {
      others.delete(beast);
    }
    this.launchWindows.delete(beast);
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
    this.tickContactHistory(dt);
    this.tickLaunchWindows(dt);
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

      if (a && b && a.beast !== b.beast) {
        this.rememberContact(a.beast, a.segment, b.beast, b.segment, point, impactSpeed);
        this.rememberContact(b.beast, b.segment, a.beast, a.segment, point, impactSpeed);
      }

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
    forcedActive: ActiveAttackContext | undefined,
    forcedDot?: number,
    forcedQualityMul: number = 1
  ): DamageEvent | null {
    const state = this.states.get(victim);
    if (!state) return null;
    if (!victim.isSegmentAttached(segment)) return null;
    let damageAmount = baseDamage * PASSIVE_DAMAGE_MUL;
    let source: 'passive' | 'active' = 'passive';
    let profile: AttackProfile | undefined;
    let chargeTier: ChargeTier | undefined;
    let blocked = false;
    let glancing = false;
    let impactClass: DamageImpactClass = 'passive';
    let splashText = 'GLANCE!';
    let hitstop = 0.006;
    let shake = 0.08;
    const segmentProfile = this.getVictimSegmentProfile(segment);
    let feedbackMul = segmentProfile.feedbackMul;
    let knockbackScale = segmentProfile.knockbackMul;
    let locationTag = segmentProfile.locationTag;
    const chargingPassiveContext =
      (attacker && this.isChargingAttack(attacker)) || this.isChargingAttack(victim);

    if (attacker && attackerSegment) {
      if (!attacker.isSegmentAttached(attackerSegment)) return null;
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
        const activeDot = forcedDot ?? dot;
        const activeQuality = Math.max(0.35, active.hitQualityMul * forcedQualityMul);
        damageAmount = Math.max(
          ACTIVE_DAMAGE_MIN * Math.min(1.18, segmentProfile.damageMul),
          baseDamage * active.damageMul * active.appendageMassMul * activeQuality * segmentProfile.damageMul
        );
        damageAmount *= ACTIVE_DAMAGE_MUL;
        const blockReduction = this.getBlockReductionForHit(
          victim,
          segment,
          point,
          attacker,
          active.profile
        );
        if (blockReduction > 0) {
          blocked = true;
          damageAmount *= 1 - Math.max(0, Math.min(0.8, blockReduction));
          shake = 0.1;
          hitstop = 0.009;
        }
        if (active.profile === 'spike') {
          glancing = activeQuality < 0.9 || activeDot < 0.2;
        } else if (active.profile === 'shield') {
          glancing = activeQuality < 0.78 || activeDot < -0.05;
        } else {
          glancing = activeQuality < 0.8 || activeDot < -0.1;
        }
        if (glancing) damageAmount *= 0.65;

        if (blocked) {
          impactClass = 'blocked';
          splashText = 'BLOCK!';
        } else if (glancing) {
          impactClass = 'glancing';
          splashText = 'GLANCE!';
        } else if (chargeTier === 'heavy') {
          impactClass = 'heavy-clean';
          if (active.profile === 'shield') splashText = 'BOOM!';
          else if (active.profile === 'spike') splashText = 'SKEWER!';
          else splashText = locationTag === 'core' ? 'MEATSHOT!' : 'KRAK!';
          damageAmount *= locationTag === 'core' ? 1.45 : 1.3;
        } else if (active.profile === 'blunt') {
          impactClass = chargeTier === 'ready' ? 'ready' : 'quick';
          splashText =
            locationTag === 'core'
              ? 'CRUNCH!'
              : 'BONK!';
        } else if (active.profile === 'spike') {
          impactClass = chargeTier === 'ready' ? 'ready' : 'quick';
          splashText =
            locationTag === 'core'
              ? 'CRUNCH!'
              : 'STAB!';
        } else {
          impactClass = chargeTier === 'ready' ? 'ready' : 'quick';
          splashText = 'SHOVE!';
        }

        if (chargeTier === 'quick') {
          shake = Math.max(shake, 0.12);
          hitstop = Math.max(hitstop, 0.01);
        } else if (chargeTier === 'ready') {
          shake = Math.max(shake, 0.2);
          hitstop = Math.max(hitstop, 0.014);
        } else {
          impactClass = blocked ? 'blocked' : glancing ? 'glancing' : impactClass;
          shake = Math.max(shake, impactClass === 'heavy-clean' ? 0.68 : 0.38);
          hitstop = Math.max(hitstop, impactClass === 'heavy-clean' ? 0.055 : 0.022);
          if (impactClass === 'heavy-clean') {
            feedbackMul *= 1.45;
            knockbackScale *= 1.4;
          }
        }
      }
    }

    if (source === 'passive' && chargingPassiveContext) {
      damageAmount *= PASSIVE_CHARGE_DAMAGE_MUL;
      if (damageAmount < 0.015) return null;
    }

    if (source === 'passive') {
      damageAmount *= segmentProfile.damageMul;
      const launchWindow = this.launchWindows.get(victim);
      if (!attacker && launchWindow) {
        const splatMul = 1 + launchWindow.intensity * 0.55;
        damageAmount *= splatMul;
        feedbackMul *= 1 + launchWindow.intensity * 0.4;
        knockbackScale *= 1 + launchWindow.intensity * 0.18;
        if (impactSpeed >= ENVIRONMENT_SPLAT_SPEED) {
          splashText = 'CRUNCH!';
        }
      }
    }

    hitstop *= feedbackMul;
    shake *= feedbackMul;

    const applied = state.applyDamage(segment, damageAmount);
    if (applied <= 0) return null;
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
      feedbackMul,
      knockbackScale,
      locationTag,
      impactClass,
    };
    this.recentEvents.push(ev);
    while (this.recentEvents.length > this.MAX_RECENT) {
      this.recentEvents.shift();
    }
    return ev;
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

  private tickContactHistory(dt: number): void {
    for (const [self, others] of this.contactHistory) {
      for (const [other, contacts] of others) {
        for (let i = contacts.length - 1; i >= 0; i--) {
          contacts[i]!.timeLeft -= dt;
          if (contacts[i]!.timeLeft <= 0) {
            contacts.splice(i, 1);
          }
        }
        if (contacts.length === 0) {
          others.delete(other);
        }
      }
      if (others.size === 0) {
        this.contactHistory.delete(self);
      }
    }
  }

  private tickLaunchWindows(dt: number): void {
    for (const [beast, state] of this.launchWindows) {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        this.launchWindows.delete(beast);
      }
    }
  }

  private rememberContact(
    self: BeastInstance,
    ownSegment: string,
    other: BeastInstance,
    otherSegment: string,
    point: { x: number; y: number; z: number },
    impactSpeed: number
  ): void {
    let others = this.contactHistory.get(self);
    if (!others) {
      others = new Map<BeastInstance, ContactMemory[]>();
      this.contactHistory.set(self, others);
    }
    let contacts = others.get(other);
    if (!contacts) {
      contacts = [];
      others.set(other, contacts);
    }

    const existing = contacts.find((entry) => {
      if (entry.ownSegment !== ownSegment || entry.otherSegment !== otherSegment) return false;
      const dx = entry.point.x - point.x;
      const dy = entry.point.y - point.y;
      const dz = entry.point.z - point.z;
      return dx * dx + dy * dy + dz * dz < 0.06;
    });
    if (existing) {
      existing.point = point;
      existing.impactSpeed = Math.max(existing.impactSpeed, impactSpeed);
      existing.timeLeft = CONTACT_MEMORY_TIME;
      return;
    }

    contacts.unshift({
      ownSegment,
      otherSegment,
      point,
      impactSpeed,
      timeLeft: CONTACT_MEMORY_TIME,
    });
    if (contacts.length > CONTACT_MEMORY_LIMIT) {
      contacts.length = CONTACT_MEMORY_LIMIT;
    }
  }

  private getRecentContacts(self: BeastInstance, other: BeastInstance): ContactMemory[] {
    return this.contactHistory.get(self)?.get(other) ?? [];
  }

  private noteLaunchWindow(beast: BeastInstance, intensity: number): void {
    const clamped = Math.max(0.25, Math.min(2.4, intensity));
    const prev = this.launchWindows.get(beast);
    if (!prev) {
      this.launchWindows.set(beast, {
        timeLeft: LAUNCH_WINDOW_TIME,
        intensity: clamped,
      });
      return;
    }
    prev.timeLeft = Math.max(prev.timeLeft, LAUNCH_WINDOW_TIME);
    prev.intensity = Math.max(prev.intensity, clamped);
  }

  private getVictimSegmentProfile(segment: string): SegmentImpactProfile {
    if (segment === 'torso') {
      return { damageMul: 1.32, feedbackMul: 1.35, knockbackMul: 1.26, locationTag: 'core' };
    }
    if (segment === 'torso_rear') {
      return { damageMul: 1.12, feedbackMul: 1.14, knockbackMul: 1.08, locationTag: 'mid' };
    }
    if (segment.startsWith('shoulder')) {
      return { damageMul: 1.05, feedbackMul: 1.08, knockbackMul: 1.02, locationTag: 'mid' };
    }
    if (segment.startsWith('elbow')) {
      return { damageMul: 1.0, feedbackMul: 1.02, knockbackMul: 1.0, locationTag: 'mid' };
    }
    if (segment === 'hip_fl' || segment === 'hip_fr') {
      return { damageMul: 1.0, feedbackMul: 1.0, knockbackMul: 1.02, locationTag: 'mid' };
    }
    if (segment === 'hip_bl' || segment === 'hip_br') {
      return { damageMul: 0.9, feedbackMul: 0.9, knockbackMul: 0.9, locationTag: 'edge' };
    }
    if (segment.startsWith('hip_')) {
      return { damageMul: 0.94, feedbackMul: 0.94, knockbackMul: 0.94, locationTag: 'edge' };
    }
    if (segment.startsWith('knee_')) {
      return { damageMul: 0.88, feedbackMul: 0.9, knockbackMul: 0.88, locationTag: 'edge' };
    }
    if (segment.startsWith('ankle_')) {
      return { damageMul: 0.72, feedbackMul: 0.78, knockbackMul: 0.76, locationTag: 'edge' };
    }
    return { damageMul: 1, feedbackMul: 1, knockbackMul: 1, locationTag: 'mid' };
  }

  private applyIntentionalKnockback(
    attacker: BeastInstance,
    victim: BeastInstance,
    active: ActiveAttackContext,
    event: DamageEvent
  ): void {
    const chargeLaunch =
      event.impactClass === 'heavy-clean' ? 2.65 :
      event.chargeTier === 'heavy' ? 1.85 :
      event.chargeTier === 'ready' ? 1.22 :
      0.9;
    const contactMul =
      event.blocked ? 0.55 :
      event.glancing ? 0.76 :
      1;
    const profileHorizontal =
      active.profile === 'shield' ? 1.28 :
      active.profile === 'spike' ? 0.96 :
      1.12;
    const profileUpward =
      active.profile === 'shield' ? 0.06 :
      active.profile === 'spike' ? 0.1 :
      0.16;
    const launchStrength =
      1.75 *
      active.knockbackMul *
      event.knockbackScale *
      chargeLaunch *
      contactMul /
      Math.max(0.65, victim.getKnockbackResistance());

    const fx = Math.sin(attacker.getYaw());
    const fz = Math.cos(attacker.getYaw());
    const victimPelvis = victim.skeleton.pelvis;
    const impulseMass = victimPelvis.mass();
    victimPelvis.applyImpulse(
      {
        x: fx * launchStrength * impulseMass * profileHorizontal,
        y: profileUpward * launchStrength * impulseMass,
        z: fz * launchStrength * impulseMass * profileHorizontal,
      },
      true
    );
    this.noteLaunchWindow(victim, launchStrength);
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

  private getBlockReductionForHit(
    victim: BeastInstance,
    segment: string,
    point: { x: number; y: number; z: number },
    attacker: BeastInstance | null,
    attackerProfile: AttackProfile
  ): number {
    const slot = victim.getPrimaryAttackSlot();
    const telemetry = victim.getAttackTelemetry();
    if (!slot?.blockBodies?.length || !telemetry?.isBlocking) return 0;

    const victimPos = victim.getPosition();
    const attackOrigin = attacker?.getPosition();
    const frontDx = attackOrigin ? attackOrigin.x - victimPos.x : point.x - victimPos.x;
    const frontDz = attackOrigin ? attackOrigin.z - victimPos.z : point.z - victimPos.z;
    if (this.forwardDot(victim.getYaw(), frontDx, frontDz) < BLOCK_FRONT_ARC_DOT) {
      return 0;
    }

    if (slot.blockBodies.includes(segment) && victim.isSegmentAttached(segment)) {
      return victim.getIncomingBlockReduction(attackerProfile);
    }

    const nearBlockBody = slot.blockBodies.some((name) => {
      if (!victim.isSegmentAttached(name)) return false;
      const body = victim.getJointBody(name);
      if (!body) return false;
      const bp = body.translation();
      const dx = bp.x - point.x;
      const dy = bp.y - point.y;
      const dz = bp.z - point.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) <= BLOCK_BODY_POINT_RADIUS;
    });
    if (!nearBlockBody) return 0;
    return victim.getIncomingBlockReduction(attackerProfile);
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
    const activeBodies = getSlotActiveBodies(slot).filter((name) => attacker.isSegmentAttached(name));
    const recentContacts = this.getRecentContacts(attacker, victim);

    const active =
      attacker.resolveGenericActiveAttack(dot) ??
      activeBodies
        .map((segment) => attacker.resolveActiveAttackForSegment(segment, dot))
        .find((ctx): ctx is ActiveAttackContext => ctx !== null);
    if (!active) return;

    const reachMul = slot.reachMultiplier ?? 1;
    const range =
      (active.profile === 'spike' ? 0.56 :
      active.profile === 'shield' ? 1.14 :
      1.28) * reachMul;

    if (active.profile !== 'spike') {
      const broadHit = this.tryResolveBroadBodyHit(attacker, victim, slot, active, dot, recentContacts);
      if (broadHit) {
        pairMap.set(victim, commitSerial);
        return;
      }
    }

    if (active.profile === 'spike') {
      const tipHit = this.tryResolveSpikeTipHit(attacker, victim, slot, active, dot, recentContacts);
      if (tipHit) {
        const ev = this.damageSegment(
          victim,
          tipHit.victimSegment,
          attacker,
          tipHit.attackerSegment,
          tipHit.point,
          tipHit.impactSpeed,
          tipHit.baseDamage,
          active,
          tipHit.facingDot,
          tipHit.qualityMul
        );
        if (!ev) return;
        pairMap.set(victim, commitSerial);
        this.applyIntentionalKnockback(attacker, victim, active, ev);
        return;
      }
    }

    const proximityHit = this.tryResolveProximityHit(attacker, victim, slot, active, dot, range);
    if (proximityHit) {
      const ev = this.damageSegment(
        victim,
        proximityHit.victimSegment,
        attacker,
        proximityHit.attackerSegment,
        proximityHit.point,
        proximityHit.impactSpeed,
        proximityHit.baseDamage,
        active,
        proximityHit.facingDot,
        proximityHit.qualityMul
      );
      if (!ev) return;
      pairMap.set(victim, commitSerial);
      this.applyIntentionalKnockback(attacker, victim, active, ev);
      return;
    }

    let best:
      | (ResolvedIntentionalHit & {
          distance: number;
          score: number;
        })
      | null = null;

    const relevantContacts = recentContacts.filter((contact) => {
      const contactFrontDot = this.forwardDot(
        attacker.getYaw(),
        contact.point.x - attackerPos.x,
        contact.point.z - attackerPos.z
      );
      if (contactFrontDot < 0.12) return false;
      if (!attacker.isSegmentAttached(contact.ownSegment)) return false;
      if (!victim.isSegmentAttached(contact.otherSegment)) return false;
      return (
        activeBodies.includes(contact.ownSegment) ||
        contact.ownSegment === slot.appendageRoot ||
        active.profile !== 'spike'
      );
    });
    for (const contact of relevantContacts) {
      const attackBody = attacker.getJointBody(contact.ownSegment);
      const victimBody = victim.getJointBody(contact.otherSegment);
      if (!attackBody || !victimBody) continue;
      const ap = attackBody.translation();
      const vp = victimBody.translation();
      const ddx = ap.x - vp.x;
      const ddy = ap.y - vp.y;
      const ddz = ap.z - vp.z;
      const distance = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      if (distance > range * 1.05) continue;

      const av = attackBody.linvel();
      const vv = victimBody.linvel();
      const rvx = av.x - vv.x;
      const rvy = av.y - vv.y;
      const rvz = av.z - vv.z;
      const impactSpeed = Math.max(
        contact.impactSpeed,
        Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz)
      );
      const baseDamage =
        DAMAGE_SCALE *
        Math.pow(Math.max(impactSpeed, 1.2), 2) *
        ((attackBody.mass() + victimBody.mass()) / 2) *
        4.5;

      const bodyBias =
        activeBodies.includes(contact.ownSegment) ? 0.35 :
        contact.ownSegment === slot.appendageRoot ? 0.2 :
        0;
      const victimBias =
        contact.otherSegment === 'torso' ? 0.3 :
        contact.otherSegment === 'torso_rear' ? 0.15 :
        0;
      const score = impactSpeed + bodyBias + victimBias - distance * 0.45;

      if (!best || score > best.score) {
        best = {
          attackerSegment: contact.ownSegment,
          victimSegment: contact.otherSegment,
          point: contact.point,
          distance,
          score,
          impactSpeed,
          baseDamage,
        };
      }
    }

    if (!best) return;

    const ev = this.damageSegment(
      victim,
      best.victimSegment,
      attacker,
      best.attackerSegment,
      best.point,
      best.impactSpeed,
      best.baseDamage,
      active,
      best.facingDot,
      best.qualityMul
    );
    if (!ev) return;
    pairMap.set(victim, commitSerial);
    this.applyIntentionalKnockback(attacker, victim, active, ev);
  }

  private tryResolveSpikeTipHit(
    attacker: BeastInstance,
    victim: BeastInstance,
    slot: AttackSlotDefinition,
    active: ActiveAttackContext,
    dot: number,
    recentContacts: ContactMemory[]
  ): ResolvedIntentionalHit | null {
    const tipSegment = slot.tipSegment ?? getSlotActiveBodies(slot)[0];
    if (!tipSegment) return null;
    if (!attacker.isSegmentAttached(tipSegment)) return null;
    const tipBody = attacker.getJointBody(tipSegment);
    if (!tipBody) return null;
    const tipPoint = attacker.getSegmentWorldPoint(tipSegment, slot.tipLocalOffset);
    if (!tipPoint) return null;

    const tipVel = tipBody.linvel();
    let best:
      | {
          hit: ResolvedIntentionalHit;
          score: number;
        }
      | null = null;

    const relevantContacts = recentContacts.filter((contact) =>
      (contact.ownSegment === tipSegment || getSlotActiveBodies(slot).includes(contact.ownSegment)) &&
      attacker.isSegmentAttached(contact.ownSegment) &&
      victim.isSegmentAttached(contact.otherSegment)
    );

    for (const contact of relevantContacts) {
      const victimBody = victim.getJointBody(contact.otherSegment);
      if (!victimBody) continue;
      const dx = contact.point.x - tipPoint.x;
      const dy = contact.point.y - tipPoint.y;
      const dz = contact.point.z - tipPoint.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance > SPIKE_TIP_RANGE * (slot.reachMultiplier ?? 1)) continue;

      const vv = victimBody.linvel();
      const rvx = tipVel.x - vv.x;
      const rvy = tipVel.y - vv.y;
      const rvz = tipVel.z - vv.z;
      const impactSpeed = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz);
      if (impactSpeed < 0.4) continue;

      const toVictimLen = distance || 1;
      const nx = dx / toVictimLen;
      const ny = dy / toVictimLen;
      const nz = dz / toVictimLen;
      const travelDot =
        impactSpeed > 0.001
          ? Math.max(0, (rvx * nx + rvy * ny + rvz * nz) / impactSpeed)
          : 0;
      if (travelDot < 0.08 && distance > SPIKE_TIP_RANGE * 0.5) continue;

      const proximity = 1 - Math.min(1, distance / SPIKE_TIP_RANGE);
      const facingDot = Math.max(0, dot * 0.4 + travelDot * 0.6);
      const desiredQuality = Math.max(
        0.72,
        Math.min(1.3, 0.74 + proximity * 0.22 + travelDot * 0.34)
      );
      const qualityMul = desiredQuality / Math.max(0.001, active.hitQualityMul);
      const baseDamage =
        DAMAGE_SCALE *
        Math.pow(Math.max(impactSpeed, 1.15), 2) *
        ((tipBody.mass() + victimBody.mass()) / 2) *
        4.8;
      const score = desiredQuality * 2 + Math.min(impactSpeed, 4) * 0.08 - distance * 3;

      if (!best || score > best.score) {
        best = {
          score,
          hit: {
            attackerSegment: tipSegment,
            victimSegment: contact.otherSegment,
            point: {
              x: (tipPoint.x + contact.point.x) / 2,
              y: (tipPoint.y + contact.point.y) / 2,
              z: (tipPoint.z + contact.point.z) / 2,
            },
            impactSpeed,
            baseDamage,
            facingDot,
            qualityMul,
          },
        };
      }
    }

    return best?.hit ?? null;
  }

  private tryResolveProximityHit(
    attacker: BeastInstance,
    victim: BeastInstance,
    slot: AttackSlotDefinition,
    active: ActiveAttackContext,
    dot: number,
    range: number
  ): ResolvedIntentionalHit | null {
    const minFrontDot =
      active.profile === 'shield' ? -0.18 :
      active.profile === 'spike' ? 0.02 :
      -0.08;
    if (dot < minFrontDot) return null;

    const attackerPos = attacker.getPosition();
    const samples = this.buildStrikeSamples(attacker, slot, active.profile);
    if (samples.length === 0) return null;

    let best:
      | {
          hit: ResolvedIntentionalHit;
          score: number;
        }
      | null = null;

    for (const sample of samples) {
      for (const [victimSegment, victimJoint] of victim.skeleton.joints) {
        if (!victim.isSegmentAttached(victimSegment)) continue;
        const victimBody = victimJoint.body;
        const victimPos = victimBody.translation();
        const dx = victimPos.x - sample.point.x;
        const dy = victimPos.y - sample.point.y;
        const dz = victimPos.z - sample.point.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const victimRadius = this.getVictimSegmentRadius(victimSegment);
        const allowed =
          sample.radius +
          victimRadius +
          range * (active.profile === 'spike' ? 0.1 : active.profile === 'shield' ? 0.14 : 0.18);
        if (distance > allowed) continue;

        const victimFrontDot = this.forwardDot(
          attacker.getYaw(),
          victimPos.x - attackerPos.x,
          victimPos.z - attackerPos.z
        );
        if (victimFrontDot < minFrontDot) continue;

        const vv = victimBody.linvel();
        const rvx = sample.vel.x - vv.x;
        const rvy = sample.vel.y - vv.y;
        const rvz = sample.vel.z - vv.z;
        const relSpeed = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz);
        const impactSpeed = Math.max(
          relSpeed,
          active.profile === 'spike' ? 0.95 : active.profile === 'shield' ? 1.05 : 1.15
        );
        const dirLen = distance || 1;
        const nx = dx / dirLen;
        const ny = dy / dirLen;
        const nz = dz / dirLen;
        const travelDot = Math.max(0, (rvx * nx + rvy * ny + rvz * nz) / Math.max(0.001, impactSpeed));
        const closeness = 1 - Math.min(1, distance / Math.max(0.001, allowed));
        const desiredQuality = Math.max(
          active.profile === 'spike' ? 0.78 : 0.74,
          Math.min(
            active.profile === 'spike' ? 1.28 : 1.22,
            0.72 + closeness * 0.32 + Math.max(0, victimFrontDot) * 0.2 + travelDot * 0.18
          )
        );
        const qualityMul = desiredQuality / Math.max(0.001, active.hitQualityMul);
        const baseDamage =
          DAMAGE_SCALE *
          Math.pow(impactSpeed, 2) *
          ((sample.bodyMass + victimBody.mass()) / 2) *
          (active.profile === 'shield' ? 4.2 : active.profile === 'spike' ? 4.8 : 4.6);
        const victimBias =
          victimSegment === 'torso' ? 0.32 :
          victimSegment === 'torso_rear' ? 0.18 :
          victimSegment.startsWith('hip_') ? 0.1 :
          0;
        const score =
          closeness * 2.4 +
          Math.min(impactSpeed, 4.2) * 0.14 +
          victimBias +
          travelDot * 0.55;

        if (!best || score > best.score) {
          best = {
            score,
            hit: {
              attackerSegment: sample.segment,
              victimSegment,
              point: {
                x: (sample.point.x + victimPos.x) / 2,
                y: (sample.point.y + victimPos.y) / 2,
                z: (sample.point.z + victimPos.z) / 2,
              },
              impactSpeed,
              baseDamage,
              facingDot: victimFrontDot,
              qualityMul,
            },
          };
        }
      }
    }

    return best?.hit ?? null;
  }

  private tryResolveBroadBodyHit(
    attacker: BeastInstance,
    victim: BeastInstance,
    slot: AttackSlotDefinition,
    active: ActiveAttackContext,
    dot: number,
    recentContacts: ContactMemory[]
  ): boolean {
    if (dot < 0.15) return false;
    const relevantSegments = new Set<string>([slot.appendageRoot, ...getSlotActiveBodies(slot)]);
    const torsoContacts = recentContacts
      .filter(
        (contact) =>
          relevantSegments.has(contact.ownSegment) &&
          attacker.isSegmentAttached(contact.ownSegment) &&
          victim.isSegmentAttached(contact.otherSegment) &&
          (contact.otherSegment === 'torso' || contact.otherSegment === 'torso_rear')
      )
      .sort((a, b) => b.impactSpeed - a.impactSpeed);
    const contact = torsoContacts[0];
    if (!contact) return false;

    const attackerBody = attacker.getJointBody(contact.ownSegment);
    const victimBody = victim.getJointBody(contact.otherSegment);
    if (!attackerBody || !victimBody) return false;

    const av = attackerBody.linvel();
    const vv = victimBody.linvel();
    const rvx = av.x - vv.x;
    const rvy = av.y - vv.y;
    const rvz = av.z - vv.z;
    const impactSpeed = Math.max(
      contact.impactSpeed,
      Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz)
    );
    const baseDamage =
      DAMAGE_SCALE *
      Math.pow(Math.max(impactSpeed, active.profile === 'shield' ? 1.4 : 1.6), 2) *
      ((attackerBody.mass() + victimBody.mass()) / 2) *
      (active.profile === 'shield' ? 4.2 : 5.0);

    const ev = this.damageSegment(
      victim,
      contact.otherSegment,
      attacker,
      contact.ownSegment,
      contact.point,
      impactSpeed,
      baseDamage,
      active,
      dot
    );
    if (!ev) return false;
    this.applyIntentionalKnockback(attacker, victim, active, ev);
    return true;
  }

  private buildStrikeSamples(
    attacker: BeastInstance,
    slot: AttackSlotDefinition,
    profile: AttackProfile
  ): StrikeSample[] {
    const segments = new Set<string>([slot.appendageRoot, ...getSlotActiveBodies(slot)]);
    if (slot.tipSegment) segments.add(slot.tipSegment);
    const samples: StrikeSample[] = [];
    for (const segment of segments) {
      if (!attacker.isSegmentAttached(segment)) continue;
      const body = attacker.getJointBody(segment);
      if (!body) continue;
      const localOffset = this.getStrikeLocalOffset(slot, segment, profile);
      const point = attacker.getSegmentWorldPoint(segment, localOffset);
      if (!point) continue;
      samples.push({
        segment,
        point,
        radius: this.getStrikeSampleRadius(slot, segment, profile),
        bodyMass: body.mass(),
        vel: body.linvel(),
      });
      const extendedOffset = this.getExtendedStrikeLocalOffset(slot, segment, profile);
      if (extendedOffset) {
        const extendedPoint = attacker.getSegmentWorldPoint(segment, extendedOffset);
        if (extendedPoint) {
          samples.push({
            segment,
            point: extendedPoint,
            radius: this.getStrikeSampleRadius(slot, segment, profile) * 1.08,
            bodyMass: body.mass(),
            vel: body.linvel(),
          });
        }
      }
    }
    return samples;
  }

  private getStrikeLocalOffset(
    slot: AttackSlotDefinition,
    segment: string,
    profile: AttackProfile
  ): { x: number; y: number; z: number } | undefined {
    const reachMul = slot.reachMultiplier ?? 1;
    if (slot.tipSegment === segment && slot.tipLocalOffset) {
      return {
        x: slot.tipLocalOffset.x,
        y: slot.tipLocalOffset.y,
        z: slot.tipLocalOffset.z * reachMul,
      };
    }
    if (segment === 'torso') {
      return {
        x: 0,
        y: profile === 'shield' ? 0.04 : 0.02,
        z: (profile === 'shield' ? 0.3 : 0.34) * reachMul,
      };
    }
    if (segment.startsWith('shoulder')) {
      return { x: 0, y: -0.18, z: 0.14 * reachMul };
    }
    if (segment.startsWith('elbow')) {
      return { x: 0, y: -0.17, z: 0.18 * reachMul };
    }
    if (segment === 'hip_fl' || segment === 'hip_fr') {
      return { x: 0, y: -0.06, z: 0.16 * reachMul };
    }
    if (segment === 'knee_fl' || segment === 'knee_fr') {
      return { x: 0, y: -0.09, z: 0.12 * reachMul };
    }
    return undefined;
  }

  private getExtendedStrikeLocalOffset(
    slot: AttackSlotDefinition,
    segment: string,
    profile: AttackProfile
  ): { x: number; y: number; z: number } | undefined {
    if (profile === 'spike' && slot.tipSegment === segment) return undefined;
    const reachMul = slot.reachMultiplier ?? 1;
    if (segment === 'torso') {
      return {
        x: 0,
        y: profile === 'shield' ? 0.04 : 0.02,
        z: (profile === 'shield' ? 0.46 : 0.5) * reachMul,
      };
    }
    if (segment.startsWith('shoulder')) {
      return { x: 0, y: -0.2, z: 0.28 * reachMul };
    }
    if (segment.startsWith('elbow')) {
      return { x: 0, y: -0.18, z: 0.3 * reachMul };
    }
    if (segment === 'hip_fl' || segment === 'hip_fr') {
      return { x: 0, y: -0.06, z: 0.24 * reachMul };
    }
    if (segment === 'knee_fl' || segment === 'knee_fr') {
      return { x: 0, y: -0.1, z: 0.2 * reachMul };
    }
    return undefined;
  }

  private getStrikeSampleRadius(
    slot: AttackSlotDefinition,
    segment: string,
    profile: AttackProfile
  ): number {
    const reachMul = slot.reachMultiplier ?? 1;
    if (slot.tipSegment === segment) {
      return (profile === 'spike' ? 0.14 : 0.18) * reachMul;
    }
    if (segment === 'torso') {
      return (profile === 'shield' ? 0.38 : 0.32) * reachMul;
    }
    if (segment.startsWith('shoulder') || segment.startsWith('hip_')) {
      return (profile === 'shield' ? 0.32 : 0.28) * reachMul;
    }
    if (segment.startsWith('elbow') || segment.startsWith('knee_')) {
      return (profile === 'spike' ? 0.18 : 0.26) * reachMul;
    }
    return 0.2 * reachMul;
  }

  private getVictimSegmentRadius(segment: string): number {
    if (segment === 'torso') return 0.44;
    if (segment === 'torso_rear') return 0.34;
    if (segment.startsWith('shoulder')) return 0.24;
    if (segment.startsWith('elbow')) return 0.2;
    if (segment === 'hip_fl' || segment === 'hip_fr') return 0.24;
    if (segment.startsWith('hip_')) return 0.22;
    if (segment.startsWith('knee_')) return 0.18;
    if (segment.startsWith('ankle_')) return 0.14;
    return 0.2;
  }
}

function getSlotActiveBodies(slot: AttackSlotDefinition): string[] {
  return slot.activeBodies ?? slot.hitSegments;
}
