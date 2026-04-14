/**
 * Bot AI — controls a second beast against the player.
 *
 * Design: the bot does NOT know about BeastInstance internals. It
 * consumes an `observe()` function that returns a small snapshot each
 * fixed step, and emits key presses via the same `InputManager`
 * interface the player keyboard uses. This keeps locomotion and input
 * completely decoupled from AI — any controller that implements the
 * InputManager shape (isDown/justPressed/beginFixedStep) plugs in.
 *
 * Behavior: a simple reactive controller
 *   1. Turn toward the player with A/D
 *   2. Walk forward with W when roughly facing them
 *   3. Occasionally jump when close
 *   4. Occasionally panic-flail when airborne
 *   5. Small random drift in attack angle so it doesn't just ram straight
 */

export interface BotObservation {
  selfX: number;
  selfZ: number;
  selfYaw: number;
  selfGrounded: boolean;
  targetX: number;
  targetZ: number;
  /** True when the bot has stamina to act. Bot idles when exhausted. */
  hasStamina: boolean;
}

/**
 * Minimal InputManager shape that locomotion consumes.
 * The real `InputManager` class already matches this; BotAI
 * implements it with synthetic key presses.
 */
export interface InputSource {
  isDown(key: string): boolean;
  justPressed(key: string): boolean;
  justReleased(key: string): boolean;
  beginFixedStep(): void;
  endFrame(): void;
  getHeldKeys(): string[];
}

export class BotAI implements InputSource {
  private keysDown = new Set<string>();
  private pressedThisStep = new Set<string>();
  private releasedThisStep = new Set<string>();

  // Per-decision timers (seconds)
  private decisionTimer = 0;
  private jumpTimer = 0;
  private wobbleAngle = 0;        // drifts so the bot doesn't always charge dead-straight
  private wobbleTimer = 0;

  // Tunable AI knobs
  private readonly decisionInterval = 0.25;
  private readonly jumpCooldown = 2.5;
  private readonly jumpRange = 4.0;
  private readonly strafeMax = 0.8;   // max random yaw offset (rad)

  constructor(private observe: () => BotObservation) {}

  /**
   * Called at the start of every fixed physics step. This is where the
   * bot looks at the world and decides which keys to "hold" for the
   * upcoming step.
   */
  beginFixedStep(): void {
    this.pressedThisStep.clear();
    this.releasedThisStep.clear();

    const dt = 1 / 60; // fixed step — matches PHYSICS_DT
    this.decisionTimer -= dt;
    this.jumpTimer -= dt;
    this.wobbleTimer -= dt;

    const obs = this.observe();

    // Out of stamina → just stand still and catch breath
    if (!obs.hasStamina) {
      this.setKey('W', false);
      this.setKey('S', false);
      this.setKey('A', false);
      this.setKey('D', false);
      this.setKey(' ', false);
      return;
    }

    // Refresh wobble angle periodically so the bot doesn't charge dead-straight
    if (this.wobbleTimer <= 0) {
      this.wobbleAngle = (Math.random() * 2 - 1) * this.strafeMax;
      this.wobbleTimer = 1.5 + Math.random() * 1.5;
    }

    // --- Compute desired direction toward the target ---
    const dx = obs.targetX - obs.selfX;
    const dz = obs.targetZ - obs.selfZ;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Desired yaw: atan2 of the world-space direction plus wobble.
    // The pelvis's forward is +Z at yaw=0 and rotates around +Y.
    // In this engine, yaw increases CCW looking down the +Y axis.
    const desiredYaw = Math.atan2(dx, dz) + this.wobbleAngle;

    // Shortest-angle yaw delta
    let yawDelta = desiredYaw - obs.selfYaw;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;

    // --- Turn toward target ---
    const yawThresh = 0.08; // rad — dead zone so the bot doesn't twitch
    if (yawDelta > yawThresh) {
      this.setKey('A', true);
      this.setKey('D', false);
    } else if (yawDelta < -yawThresh) {
      this.setKey('A', false);
      this.setKey('D', true);
    } else {
      this.setKey('A', false);
      this.setKey('D', false);
    }

    // --- Walk forward when roughly facing the target, unless very close ---
    const facingDot = Math.cos(yawDelta); // 1 = face-on
    const walk = facingDot > 0.3 && dist > 0.6;
    this.setKey('W', walk);
    this.setKey('S', false);

    // --- Jump when close and grounded + cooldown elapsed ---
    if (
      obs.selfGrounded &&
      dist < this.jumpRange &&
      this.jumpTimer <= 0 &&
      Math.random() < 0.4 // roll each tick to avoid mechanical bunny hops
    ) {
      this.triggerJump();
      this.jumpTimer = this.jumpCooldown + Math.random() * 1.5;
    }

    // --- Panic flail in the air (hold space) ---
    if (!obs.selfGrounded && Math.random() < 0.3) {
      this.setKey(' ', true);
    } else {
      // Release space after one tick so justPressed works next jump
      if (this.keysDown.has(' ')) this.setKey(' ', false);
    }
  }

  endFrame(): void {
    // Same as real InputManager — no-op, edges managed by beginFixedStep
  }

  // ---- InputManager interface ----

  isDown(key: string): boolean {
    return this.keysDown.has(key.toUpperCase());
  }

  justPressed(key: string): boolean {
    return this.pressedThisStep.has(key.toUpperCase());
  }

  justReleased(key: string): boolean {
    return this.releasedThisStep.has(key.toUpperCase());
  }

  getHeldKeys(): string[] {
    return Array.from(this.keysDown);
  }

  // ---- Internal helpers ----

  private setKey(key: string, down: boolean) {
    const k = key.toUpperCase();
    const wasDown = this.keysDown.has(k);
    if (down && !wasDown) {
      this.keysDown.add(k);
      this.pressedThisStep.add(k);
    } else if (!down && wasDown) {
      this.keysDown.delete(k);
      this.releasedThisStep.add(k);
    }
  }

  /**
   * Force a clean jump edge — release first if held, then press.
   * Used to ensure `justPressed(' ')` fires reliably.
   */
  private triggerJump() {
    if (this.keysDown.has(' ')) {
      this.keysDown.delete(' ');
      this.releasedThisStep.add(' ');
    }
    this.keysDown.add(' ');
    this.pressedThisStep.add(' ');
  }
}
