/**
 * Shared terrain noise + sampling.
 *
 * The visual ground mesh AND the physics heightfield collider both
 * use this single source of truth, so what you see is what you can
 * stand on. No more flat-slab collider under a lumpy mesh.
 */

/** Deterministic 2D hash noise. */
export function hashNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Multi-octave value noise with smoothstep interpolation. */
export function fbmNoise(x: number, y: number, octaves: number = 4): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    const ix = Math.floor(x * frequency);
    const iy = Math.floor(y * frequency);
    const fx = x * frequency - ix;
    const fy = y * frequency - iy;
    const a = hashNoise(ix, iy);
    const b = hashNoise(ix + 1, iy);
    const c = hashNoise(ix, iy + 1);
    const d = hashNoise(ix + 1, iy + 1);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const lerped = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    value += lerped * amplitude;
    maxAmp += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value / maxAmp;
}

/**
 * Sample the terrain height at a given world XZ coordinate.
 * x, z are world-space (meters). Returns Y elevation in meters.
 *
 * This MUST match the formula used to displace the visual ground
 * mesh, otherwise visual and physics will disagree.
 */
export function sampleTerrainHeight(x: number, z: number): number {
  // Distance from arena center (XZ plane)
  const dist = Math.sqrt(x * x + z * z);

  // Multi-octave noise
  const baseNoise = fbmNoise(x * 0.08 + 50, z * 0.08 + 50, 5);
  const detailNoise = fbmNoise(x * 0.3 + 100, z * 0.3 + 100, 3) * 0.15;
  let displacement = (baseNoise - 0.5) * 1.2 + detailNoise;

  // Center fighting area is flatter (smoothstep fade within 14m)
  const centerFade = Math.max(0, 1 - dist / 14);
  const centerSmooth = centerFade * centerFade * (3 - 2 * centerFade);
  displacement *= 1 - centerSmooth * 0.85;

  // Slight depression in the very center (worn combat pit)
  if (dist < 10) {
    displacement -= (1 - dist / 10) * 0.15;
  }

  return displacement;
}

/**
 * Build a heightfield as a column-major Float32Array suitable for
 * Rapier's `ColliderDesc.heightfield`.
 *
 * Rapier's heightfield API takes SUBDIVISION counts (nrows/ncols), and
 * expects exactly `(subdivisionsX+1) × (subdivisionsZ+1)` height samples
 * laid out in COLUMN-MAJOR order. Column index varies along the local
 * X axis, row index along the local Z axis.
 *
 * @param size           Side length of the square heightfield (m).
 * @param subdivisions   Number of cell subdivisions per side.
 *                       Sample grid is (subdivisions+1) × (subdivisions+1).
 */
export function buildHeightfield(size: number, subdivisions: number): {
  subdivisionsX: number;
  subdivisionsZ: number;
  heights: Float32Array;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
} {
  const sampleCount = subdivisions + 1;
  const heights = new Float32Array(sampleCount * sampleCount);
  const halfSize = size / 2;
  // Distance between samples — first sample lands on -halfSize, last on +halfSize
  const step = size / subdivisions;

  // Column-major: heights[col * sampleCount + row]
  for (let col = 0; col < sampleCount; col++) {
    const x = -halfSize + col * step;
    for (let row = 0; row < sampleCount; row++) {
      const z = -halfSize + row * step;
      heights[col * sampleCount + row] = sampleTerrainHeight(x, z);
    }
  }

  return {
    subdivisionsX: subdivisions,
    subdivisionsZ: subdivisions,
    heights,
    scaleX: size,
    scaleY: 1.0,
    scaleZ: size,
  };
}
