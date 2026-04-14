/**
 * Game shell — top-level state machine for MEATBASH.
 *
 * Manages which "screen" the game is currently on (HOME, ARENA, LAB,
 * CERTIFICATION) and acts as a tiny event emitter so the entry point
 * (main.ts) can react to user intent (start a match, open the lab, etc.)
 * without the shell knowing anything about Three.js, physics, or combat.
 *
 * Screens own their DOM. The shell just shows/hides them via a `setVisible`
 * hook each screen registers. Screens are all mounted into `#ui-overlay`.
 */

export type GameScreen = 'HOME' | 'ARENA' | 'LAB' | 'CERTIFICATION';

export type MatchMode = 'bot' | 'join' | 'host';

export interface GameShellCallbacks {
  onStartMatch?: (beastId: string, mode: MatchMode, joinCode?: string) => void;
  onOpenLab?: () => void;
  onOpenCertification?: () => void;
  onScreenChanged?: (to: GameScreen, from: GameScreen) => void;
}

export interface ScreenHandle {
  /** Show or hide the screen's root DOM. */
  setVisible: (visible: boolean) => void;
}

export class GameShell {
  private current: GameScreen = 'HOME';
  private screens = new Map<GameScreen, ScreenHandle>();
  private callbacks: GameShellCallbacks = {};

  constructor(callbacks: GameShellCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /** Register a screen's visibility handle. Called by each screen on construction. */
  registerScreen(screen: GameScreen, handle: ScreenHandle) {
    this.screens.set(screen, handle);
    // A newly-registered screen should only be visible if it's the current one.
    handle.setVisible(screen === this.current);
  }

  /** Set callbacks after construction (useful when screens are built first). */
  setCallbacks(callbacks: GameShellCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  getCurrentScreen(): GameScreen {
    return this.current;
  }

  /**
   * Transition to another screen. Hides the previous screen's DOM,
   * shows the next, and fires onScreenChanged.
   */
  transition(to: GameScreen) {
    if (to === this.current) return;
    const from = this.current;
    const prev = this.screens.get(from);
    if (prev) prev.setVisible(false);
    this.current = to;
    const next = this.screens.get(to);
    if (next) next.setVisible(true);
    this.callbacks.onScreenChanged?.(to, from);
  }

  // ----- Event emitter surface used by screens -----

  /** Called by HomeScreen when the user wants to start a bot match. */
  emitStartMatch(beastId: string, mode: MatchMode, joinCode?: string) {
    this.callbacks.onStartMatch?.(beastId, mode, joinCode);
  }

  /** Called by HomeScreen when the user wants to open the Gene Lab. */
  emitOpenLab() {
    this.callbacks.onOpenLab?.();
  }

  /** Called by HomeScreen when the user wants to open Darwin Certification. */
  emitOpenCertification() {
    this.callbacks.onOpenCertification?.();
  }
}
