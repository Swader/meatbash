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
  /** Optional facing yaw (radians). 0 = +Z, PI/2 = +X. */
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
    applyInitialYaw(skeleton, opts.x, opts.z, opts.yaw ?? 0);
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
    applyInitialYaw(skeleton, opts.x, opts.z, opts.yaw ?? 0);
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

function applyInitialYaw(
  skeleton: { allBodies: Array<{ translation(): { x: number; y: number; z: number }; setTranslation(v: { x: number; y: number; z: number }, wakeUp: boolean): void; setRotation(v: { x: number; y: number; z: number; w: number }, wakeUp: boolean): void; setLinvel(v: { x: number; y: number; z: number }, wakeUp: boolean): void; setAngvel(v: { x: number; y: number; z: number }, wakeUp: boolean): void }> },
  originX: number,
  originZ: number,
  yaw: number
): void {
  if (Math.abs(yaw) < 0.0001) return;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const half = yaw * 0.5;
  const q = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };

  for (const body of skeleton.allBodies) {
    const p = body.translation();
    const dx = p.x - originX;
    const dz = p.z - originZ;
    body.setTranslation(
      {
        x: originX + dx * c + dz * s,
        y: p.y,
        z: originZ - dx * s + dz * c,
      },
      true
    );
    body.setRotation(q, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
