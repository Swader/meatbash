import * as THREE from 'three';

/**
 * Initialize Three.js renderer with WebGPU, falling back to WebGL.
 * WebGPU gives us compute shaders for meat deformation later.
 */
export async function initRenderer(canvas: HTMLCanvasElement): Promise<THREE.WebGLRenderer> {
  // For Phase 1, start with WebGL renderer to get things running fast.
  // We'll swap to WebGPURenderer once we need GPU compute for SDF/deformation.
  // Three.js WebGPU requires `three/webgpu` import path which we'll switch to in Phase 2.

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  // Handle resize
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return renderer;
}
