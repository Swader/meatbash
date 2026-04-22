/**
 * Limb severance.
 *
 * When a body segment's HP drops to zero, remove the joint attaching
 * it to its parent, turning it into a free physics prop. The
 * remaining beast loses that limb's locomotion contribution.
 *
 * For Phase 2 Block 2 this is simple: we call `processSeverance` once
 * per fixed step, check each segment's HP, and break joints that have
 * just crossed zero. We mark the body as "severed" on the damage state
 * so locomotion queries can filter it out (e.g. foot ground checks
 * should ignore a foot that's no longer attached).
 *
 * A severed body stays in the physics world — it bounces and rolls
 * around as gib debris. It keeps its creature-vs-arena collision groups
 * so it doesn't clip through the ground or walls.
 */

import type { BeastInstance } from '../beast/beast-instance';
import type { RapierWorld } from './rapier-world';
import type { DamageResolver } from './damage';

const DETACH_CASCADE: Record<string, string[]> = {
  shoulder_l: ['elbow_l'],
  shoulder_r: ['elbow_r'],
  hip_l: ['knee_l', 'ankle_l'],
  knee_l: ['ankle_l'],
  hip_r: ['knee_r', 'ankle_r'],
  knee_r: ['ankle_r'],
  hip_fl: ['knee_fl', 'ankle_fl'],
  knee_fl: ['ankle_fl'],
  hip_fr: ['knee_fr', 'ankle_fr'],
  knee_fr: ['ankle_fr'],
  hip_bl: ['knee_bl', 'ankle_bl'],
  knee_bl: ['ankle_bl'],
  hip_br: ['knee_br', 'ankle_br'],
  knee_br: ['ankle_br'],
};

/** Result of a severance pass. Used for particle/audio hooks. */
export interface SeveranceEvent {
  beast: BeastInstance;
  segment: string;
  position: { x: number; y: number; z: number };
}

/**
 * Walk each tracked beast's segment HP and break joints that just
 * dropped to zero. Returns the list of newly-severed segments so
 * callers can spawn particles / play sounds.
 */
export function processSeverance(
  beasts: BeastInstance[],
  damageResolver: DamageResolver,
  physics: RapierWorld
): SeveranceEvent[] {
  const events: SeveranceEvent[] = [];

  for (const beast of beasts) {
    const state = damageResolver.getState(beast);
    if (!state) continue;

    for (const [segmentName, attached] of state.segmentAttached) {
      if (!attached) continue;
      if (!state.isSegmentDead(segmentName)) continue;

      // Don't sever the root torso — that would be instant death with no
      // payoff. Torso HP still counts toward total mass though.
      if (segmentName === 'torso' || segmentName === 'torso_rear') continue;

      const joint = beast.skeleton.joints.get(segmentName);
      if (!joint || !joint.joint) continue;

      // Remove the joint from the world. Body stays dynamic and keeps
      // its collider + velocity, so it tumbles off naturally.
      try {
        physics.world.removeImpulseJoint(joint.joint as any, true);
      } catch (e) {
        void e;
      }

      // CRITICAL: clear the joint reference. Locomotion still walks the
      // joint map every step and calls `setMotor(joint.joint, ...)`. A
      // freed Rapier joint handle hands back NaN at best and a WASM
      // trap at worst. setMotor's `if (!joint) return` guard then makes
      // the call a no-op, so the severed body just floats free.
      joint.joint = undefined;

      for (const detachedName of expandDetachedSegments(segmentName)) {
        state.segmentAttached.set(detachedName, false);
      }
      beast.markSegmentDetached(segmentName);

      const pos = joint.body.translation();
      events.push({
        beast,
        segment: segmentName,
        position: { x: pos.x, y: pos.y, z: pos.z },
      });
    }
  }

  return events;
}

function expandDetachedSegments(root: string): string[] {
  const out = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (out.has(next)) continue;
    out.add(next);
    for (const child of DETACH_CASCADE[next] ?? []) {
      queue.push(child);
    }
  }
  return [...out];
}
