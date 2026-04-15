/**
 * Beast factory — unified spawn entry for bipedal and quadrupedal beasts.
 *
 * Takes a `BeastDefinition` + scene + physics + spawn location and returns
 * a ready-to-run `BeastInstance`. Callers don't have to know which
 * archetype's skeleton/locomotion is involved.
 */

import * as THREE from 'three';
import { RapierWorld } from '../physics/rapier-world';
import { sampleTerrainHeight } from '../engine/terrain';
import { BeastInstance } from './beast-instance';
import { createBipedSkeleton } from '../physics/skeleton';
import {
  applyBipedLocomotion,
  createLocomotionState,
} from '../physics/locomotion';
import { createQuadSkeleton } from '../physics/skeleton-quad';
import {
  applyQuadLocomotion,
  createQuadLocomotionState,
} from '../physics/locomotion-quad';
import type { BeastDefinition } from './beast-data';

export interface SpawnOptions {
  x: number;
  z: number;
  /** Optional facing yaw (radians). Not yet applied — reserved for future. */
  yaw?: number;
  /**
   * 0-based beast index used to compute per-beast collision groups so
   * two beasts collide with each other but not themselves. Defaults
   * to 0 (first beast).
   */
  beastIndex?: number;
}

/**
 * Spawn a beast from its definition into the given scene + physics world.
 *
 * Returns a BeastInstance regardless of archetype. The caller's game loop
 * treats it opaquely — `applyInput`, `syncFromPhysics`, `getPosition`
 * all work the same way.
 */
export function spawnBeast(
  def: BeastDefinition,
  scene: THREE.Scene,
  physics: RapierWorld,
  opts: SpawnOptions
): BeastInstance {
  const groundY = sampleTerrainHeight(opts.x, opts.z);
  const beastIndex = opts.beastIndex ?? 0;

  // Tell the physics world which beast's collision groups to use for
  // every subsequent collider attached to this skeleton. Must happen
  // BEFORE createBipedSkeleton / createQuadSkeleton.
  physics.beginBeast(beastIndex);

  if (def.archetype === 'bipedal') {
    const skeleton = createBipedSkeleton(physics, opts.x, opts.z, groundY, {
      withArms: !!def.hasArms,
    });
    return new BeastInstance(
      skeleton,
      physics,
      scene,
      def,
      applyBipedLocomotion as any,
      createLocomotionState()
    );
  }

  if (def.archetype === 'quadruped') {
    const skeleton = createQuadSkeleton(physics, opts.x, opts.z, groundY);
    return new BeastInstance(
      skeleton as any,
      physics,
      scene,
      def,
      applyQuadLocomotion as any,
      createQuadLocomotionState()
    );
  }

  throw new Error(`Unknown archetype: ${(def as any).archetype}`);
}
