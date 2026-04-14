import * as THREE from 'three';
import { CameraController } from './camera';
import { InputManager } from './input';
import { RapierWorld } from '../physics/rapier-world';
import type { BeastInstance } from '../beast/beast-instance';

export interface GameLoopConfig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  physics: RapierWorld;
  input: InputManager;
  beasts: BeastInstance[];
  /** Per-fixed-step hook fired AFTER physics.step() and BEFORE beast sync. */
  onPostPhysics?: (dt: number) => void;
  onVariableUpdate?: (dt: number) => void;
  onPostRender?: () => void;
}

const PHYSICS_DT = 1 / 60; // Fixed 60Hz physics
const MAX_SUBSTEPS = 5;     // Cap physics catchup to prevent spiral of death

/**
 * Main game loop.
 * Fixed-timestep physics, variable-rate rendering.
 * Handles the update order: input → physics → beast sync → render.
 */
export class GameLoop {
  private config: GameLoopConfig;
  private cameraController: CameraController;
  private running = false;
  private accumulator = 0;
  private lastTime = 0;
  private frameId = 0;

  // Debug
  private fpsCounter = 0;
  private fpsTime = 0;
  private currentFps = 0;

  constructor(config: GameLoopConfig) {
    this.config = config;
    this.cameraController = new CameraController(
      config.camera,
      config.renderer.domElement
    );
  }

  start() {
    this.running = true;
    this.lastTime = performance.now() / 1000;
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.frameId) cancelAnimationFrame(this.frameId);
  }

  private tick = () => {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this.tick);

    const now = performance.now() / 1000;
    let dt = now - this.lastTime;
    this.lastTime = now;

    // Clamp dt to prevent huge jumps (e.g., tab was backgrounded)
    if (dt > 0.1) dt = 0.1;

    // FPS counter
    this.fpsCounter++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.currentFps = this.fpsCounter;
      this.fpsCounter = 0;
      this.fpsTime -= 1;
    }

    // Fixed-timestep physics
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
      // Drain raw input events into per-step edge sets BEFORE the fixed step.
      // This makes justPressed/justReleased deterministic across frames with
      // varying numbers of fixed substeps.
      this.config.input.beginFixedStep();
      this.fixedUpdate(PHYSICS_DT);
      this.accumulator -= PHYSICS_DT;
      steps++;
    }

    // Variable-rate visual update
    this.variableUpdate(dt);

    // Render
    this.config.renderer.render(this.config.scene, this.config.camera);

    // Post-render callback (HUD updates, etc.)
    this.config.onPostRender?.();

    // Clean up input frame state
    this.config.input.endFrame();
  };

  /** Fixed-timestep update: physics + input processing */
  private fixedUpdate(dt: number) {
    const { input, physics, beasts } = this.config;

    // Apply beast locomotion from input
    for (const beast of beasts) {
      beast.applyInput(input, dt);
    }

    // Step physics world
    physics.step();

    // Post-physics hook (damage, particle spawn, sensor queries)
    this.config.onPostPhysics?.(dt);

    // Sync beast visual positions from physics
    for (const beast of beasts) {
      beast.syncFromPhysics();
    }
  }

  /** Variable-rate update: camera, visual effects, animations */
  private variableUpdate(dt: number) {
    const { beasts } = this.config;

    // Update camera target to follow first beast
    if (beasts.length > 0) {
      const beastPos = beasts[0].getPosition();
      this.cameraController.target.copy(beastPos);
      this.cameraController.target.y += 1.5; // Look slightly above ground
    }

    this.cameraController.update(dt);

    // Arena/effect updates
    this.config.onVariableUpdate?.(dt);
  }

  getFps(): number {
    return this.currentFps;
  }
}
