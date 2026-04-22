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
  onBeforeFixedStep?: (dt: number, frame: number) => void;
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
  private hitstopLeft = 0;
  private fixedFrame = 0;

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

    this.processFrame(dt);
  };

  advance(dt: number) {
    this.processFrame(dt);
  }

  private processFrame(dt: number) {
    let frameDt = dt;

    // Clamp dt to prevent huge jumps (e.g., tab was backgrounded)
    if (frameDt > 0.1) frameDt = 0.1;
    if (frameDt < 0) frameDt = 0;

    // FPS counter
    this.fpsCounter++;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 1) {
      this.currentFps = this.fpsCounter;
      this.fpsCounter = 0;
      this.fpsTime -= 1;
    }

    if (this.hitstopLeft > 0) {
      this.hitstopLeft = Math.max(0, this.hitstopLeft - frameDt);
      this.config.input.beginFixedStep();
    } else {
      // Fixed-timestep physics
      this.accumulator += frameDt;
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
      this.variableUpdate(frameDt);
    }

    // Render
    this.config.renderer.render(this.config.scene, this.config.camera);

    // Post-render callback (HUD updates, etc.)
    this.config.onPostRender?.();

    // Clean up input frame state
    this.config.input.endFrame();
  }

  /** Fixed-timestep update: physics + input processing.
   *
   * EVERY stage is wrapped so a Rapier WASM panic, NaN propagation, or
   * a buggy locomotion controller cannot kill the requestAnimationFrame
   * loop. Before this guard, an uncaught exception inside physics.step()
   * would silently freeze the entire game (and tab-out wiped the canvas
   * because no more frames were rendered). Now the loop survives.
   */
  private fixedUpdate(dt: number) {
    const { input, physics, beasts } = this.config;
    this.config.onBeforeFixedStep?.(dt, this.fixedFrame);

    // Apply beast locomotion from input
    for (const beast of beasts) {
      try {
        beast.applyInput(input, dt);
      } catch (e) {
        console.error('[loop] beast.applyInput threw', e);
      }
    }

    // Step physics world — the most common crash site. A WASM trap here
    // is non-recoverable for that step, but we can keep the loop alive
    // and let the next frame try again. If the underlying issue is bad
    // body state, the next step will likely fail too — but at least we
    // get a stack trace and the canvas keeps refreshing.
    try {
      physics.step();
    } catch (e) {
      console.error('[loop] physics.step threw — keeping loop alive', e);
      // Bump a counter on window so tests can detect runaway crashes
      const w = window as any;
      w.__physicsStepErrors = (w.__physicsStepErrors || 0) + 1;
    }

    // Post-physics hook (damage, particle spawn, sensor queries)
    try {
      this.config.onPostPhysics?.(dt);
    } catch (e) {
      console.error('[loop] onPostPhysics threw', e);
    }

    // Sync beast visual positions from physics
    for (const beast of beasts) {
      try {
        beast.syncFromPhysics();
      } catch (e) {
        console.error('[loop] beast.syncFromPhysics threw', e);
      }
    }
    this.fixedFrame += 1;
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

  addCameraShake(intensity: number, duration: number, horizontalBias: number = 0.5): void {
    this.cameraController.addShake(intensity, duration, horizontalBias);
  }

  addHitstop(duration: number): void {
    this.hitstopLeft = Math.max(this.hitstopLeft, duration);
  }

  getFixedFrame(): number {
    return this.fixedFrame;
  }
}
