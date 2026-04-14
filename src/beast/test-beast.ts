import * as THREE from 'three';
import { RapierWorld } from '../physics/rapier-world';
import { createBipedSkeleton } from '../physics/skeleton';
import { BeastInstance } from './beast-instance';
import { buildHeightfield, sampleTerrainHeight } from '../engine/terrain';
import type { RockGeometryData } from '../engine/scene';

/**
 * Build the physics arena that matches the visual scene exactly:
 * - Heightfield ground (sampled from the same terrain function as the mesh)
 * - Convex-hull rock colliders (built from the same deformed icosahedron vertices)
 * - Wall colliders along the perimeter
 *
 * Call this once before spawning beasts.
 */
export function createPhysicsArena(
  physics: RapierWorld,
  rockData: RockGeometryData[]
): void {
  // Heightfield: 64×64 cell grid (65×65 height samples) covering the 80m visual ground plane.
  const hf = buildHeightfield(80, 64);
  physics.createHeightfieldGround(hf.subdivisionsX, hf.subdivisionsZ, hf.heights, {
    x: hf.scaleX,
    y: hf.scaleY,
    z: hf.scaleZ,
  });

  physics.createArenaWalls(35);

  // Real convex-hull colliders for each rock, matching the visual silhouette
  for (const rock of rockData) {
    physics.createConvexHullBody(rock.vertices, rock.position);
  }
}

/**
 * Create a test bipedal meatbeast.
 * The arena must already be set up via createPhysicsArena.
 */
export function createTestBeast(
  scene: THREE.Scene,
  physics: RapierWorld
): BeastInstance {
  // Spawn at center, on top of the terrain
  const spawnX = 0;
  const spawnZ = 0;
  const groundY = sampleTerrainHeight(spawnX, spawnZ);

  const skeleton = createBipedSkeleton(physics, spawnX, spawnZ, groundY);
  const beast = new BeastInstance(skeleton, physics, scene);
  return beast;
}
