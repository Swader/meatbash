import * as THREE from 'three';
import { RapierWorld } from '../physics/rapier-world';
import { createBipedSkeleton } from '../physics/skeleton';
import { BeastInstance } from './beast-instance';

/**
 * Create a test bipedal meatbeast for Phase 1.
 * Sets up physics world (ground, walls, rocks) and spawns the beast.
 */
export function createTestBeast(
  scene: THREE.Scene,
  physics: RapierWorld
): BeastInstance {
  // Create arena physics
  physics.createGround();
  physics.createArenaWalls(35);

  // Create rock colliders matching the visual rocks from scene.ts
  const rockPositions = [
    { x: 8, z: 5, scale: 2.5 },
    { x: -10, z: -7, scale: 3.0 },
    { x: 3, z: -12, scale: 1.8 },
    { x: -5, z: 10, scale: 2.2 },
    { x: 15, z: -3, scale: 1.5 },
  ];
  for (const rp of rockPositions) {
    physics.createRockCollider(rp.x, rp.scale * 0.3, rp.z, rp.scale);
  }

  // Create the bipedal skeleton
  const skeleton = createBipedSkeleton(physics, 0, 0);

  // Wrap in beast instance (links physics to visuals)
  const beast = new BeastInstance(skeleton, physics, scene);

  return beast;
}
