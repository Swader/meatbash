import { initRenderer } from './engine/renderer';
import { createScene } from './engine/scene';
import { createCamera } from './engine/camera';
import { InputManager } from './engine/input';
import { GameLoop } from './engine/loop';
import { RapierWorld } from './physics/rapier-world';
import { createTestBeast, createPhysicsArena } from './beast/test-beast';
import { AudioManager } from './audio/audio-manager';
import { DebugHud } from './ui/debug-hud';
import { initTuningPanel } from './physics/tuning';

async function main() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const loadingMsg = document.getElementById('loading-msg')!;

  // Init renderer (WebGPU with WebGL fallback)
  const renderer = await initRenderer(canvas);

  // Init physics
  const physics = new RapierWorld();
  await physics.init();

  // Scene setup
  const { scene, arena, updateArena } = createScene();
  const camera = createCamera(canvas);
  const input = new InputManager();
  const audio = new AudioManager();

  // Build the physics arena to match the visual scene (heightfield ground,
  // convex-hull rocks, walls). MUST happen before spawning the beast so
  // ground raycasts see the real terrain.
  createPhysicsArena(physics, arena.rockData);

  // Create a test beast for Phase 1
  const beast = createTestBeast(scene, physics);

  // Expose for debugging
  (window as any).__beast = beast;
  (window as any).__physics = physics;

  // UI
  const hud = new DebugHud();
  initTuningPanel();

  // Hide loading message
  loadingMsg.style.display = 'none';

  // Start game loop
  const loop = new GameLoop({
    renderer,
    scene,
    camera,
    physics,
    input,
    beasts: [beast],
    onVariableUpdate: (dt) => updateArena(dt),
    onPostRender: () => {
      hud.update(beast.getStaminaPercent(), loop.getFps(), beast.getDebugState());
    },
  });

  loop.start();
}

main().catch((err) => {
  console.error('MEATBASH failed to start:', err);
  const loadingMsg = document.getElementById('loading-msg');
  if (loadingMsg) {
    loadingMsg.innerHTML = `
      <div style="color: #ff4444">🥩 MEATBASH failed to load 🥩</div>
      <div style="font-size: 14px; margin-top: 8px; opacity: 0.8">${err.message}</div>
      <div style="font-size: 12px; margin-top: 4px; opacity: 0.5">Try Chrome/Edge with WebGPU enabled</div>
    `;
  }
});
