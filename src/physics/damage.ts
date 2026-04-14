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

// ---- Tuneable constants ----

/** Global damage scalar. Raise for squishier beasts, lower for durable. */
const DAMAGE_SCALE = 0.018;
/** Minimum impact speed (m/s) below which contacts are ignored. */
const IMPACT_SPEED_THRESHOLD = 1.0;
/** Max HP per body segment (so it takes multiple big hits to destroy one). */
const SEGMENT_MAX_HP = 100;
/** Cooldown (s) between damage events on the same pair, prevents rapid double-dipping. */
const PAIR_COOLDOWN = 0.08;

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

      if (impactSpeed < IMPACT_SPEED_THRESHOLD) return;

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

      // Dispatch damage to whichever side is a beast
      if (a) {
        this.damageSegment(a.beast, a.segment, baseDamage, b?.beast || null, point, impactSpeed);
      }
      if (b) {
        this.damageSegment(b.beast, b.segment, baseDamage, a?.beast || null, point, impactSpeed);
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

  private damageSegment(
    victim: BeastInstance,
    segment: string,
    amount: number,
    attacker: BeastInstance | null,
    point: { x: number; y: number; z: number },
    impactSpeed: number
  ): void {
    const state = this.states.get(victim);
    if (!state) return;
    const applied = state.applyDamage(segment, amount);
    if (applied <= 0) return;
    const ev: DamageEvent = {
      victim,
      attacker,
      segment,
      amount: applied,
      point,
      impactSpeed,
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
}
