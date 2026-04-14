/**
 * Input manager: tracks keyboard state with proper edge detection
 * for fixed-timestep physics.
 *
 * Previous bug: justPressed/justReleased were cleared once per render
 * frame, but consumed in fixed physics steps. So:
 * - Frames with 0 fixed steps → input lost
 * - Frames with multiple fixed steps → input duplicated
 *
 * Fix: queue raw key events, then atomically convert them to per-step
 * edge sets via `beginFixedStep()`. Each fixed step consumes exactly
 * one batch of edges. No loss, no duplication.
 */
export class InputManager {
  private keysDown = new Set<string>();

  // Raw event queues (filled by DOM events)
  private pressedQueue: string[] = [];
  private releasedQueue: string[] = [];

  // Per-fixed-step edge sets (rebuilt by beginFixedStep)
  private fixedPressed = new Set<string>();
  private fixedReleased = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toUpperCase();
      // Only queue first press, ignore key-repeat
      if (!this.keysDown.has(key)) {
        this.pressedQueue.push(key);
      }
      this.keysDown.add(key);
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key.toUpperCase();
      this.keysDown.delete(key);
      this.releasedQueue.push(key);
    });

    // Clear all on blur (prevent stuck keys when alt-tabbing)
    window.addEventListener('blur', () => {
      this.keysDown.clear();
    });
  }

  /**
   * Call at the start of each FIXED physics step.
   * Drains the raw event queues into the per-step edge sets.
   * Multiple events queued during the render frame are coalesced into
   * a single edge set for the next fixed step.
   */
  beginFixedStep() {
    this.fixedPressed.clear();
    this.fixedReleased.clear();
    for (const k of this.pressedQueue) this.fixedPressed.add(k);
    for (const k of this.releasedQueue) this.fixedReleased.add(k);
    this.pressedQueue.length = 0;
    this.releasedQueue.length = 0;
  }

  /** Is the key currently held down? */
  isDown(key: string): boolean {
    return this.keysDown.has(key.toUpperCase());
  }

  /** Was the key pressed during this fixed step? */
  justPressed(key: string): boolean {
    return this.fixedPressed.has(key.toUpperCase());
  }

  /** Was the key released during this fixed step? */
  justReleased(key: string): boolean {
    return this.fixedReleased.has(key.toUpperCase());
  }

  /** No-op kept for API compatibility — edges are now managed by beginFixedStep */
  endFrame() {}

  /** Get all currently held keys (for network serialization) */
  getHeldKeys(): string[] {
    return Array.from(this.keysDown);
  }
}
