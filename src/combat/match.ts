/**
 * Match state machine.
 *
 * Phases:
 *   COUNTDOWN — "3" "2" "1" "FIGHT!" (3 seconds)
 *   FIGHTING  — full gameplay until timer hits 0 or KO
 *   ENDED     — result screen; player can restart
 *
 * The match doesn't own the beasts or the physics world — it just
 * tracks state and emits transitions via a callback. The caller
 * decides when to spawn beasts, snapshot mass, detect KOs, etc.
 */

export type MatchPhase = 'COUNTDOWN' | 'FIGHTING' | 'ENDED';
export type MatchResult = 'win' | 'lose' | 'draw';

export interface MatchSnapshot {
  phase: MatchPhase;
  timer: number;        // seconds remaining in current phase (countdown or fight)
  countdownSec?: number; // integer seconds for COUNTDOWN display / FIGHT cue
  p1Mass: number;       // 0..1 — fraction of starting mass
  p2Mass: number;       // 0..1
  result?: MatchResult; // set when phase === 'ENDED'
}

export interface MatchConfig {
  countdownDuration: number; // default 3
  fightDuration: number;     // default 180
  /** Mass fraction below which a beast is considered KO'd. */
  knockoutThreshold: number; // default 0.3
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  countdownDuration: 3.0,
  fightDuration: 180.0,
  knockoutThreshold: 0.30,
};

const FIGHT_CUE_DURATION = 0.7;

/**
 * A tiny state machine. `update(dt)` advances the timer; external code
 * calls `reportMass(p1, p2)` each frame with current mass fractions
 * so the match can detect KO / tiebreaker.
 */
export class MatchController {
  private phase: MatchPhase = 'COUNTDOWN';
  private timer: number;
  private config: MatchConfig;
  private p1Mass = 1.0;
  private p2Mass = 1.0;
  private result: MatchResult | undefined;
  private fightCueLeft = 0;
  private onPhaseChange?: (phase: MatchPhase) => void;

  constructor(
    config: Partial<MatchConfig> = {},
    onPhaseChange?: (phase: MatchPhase) => void
  ) {
    this.config = { ...DEFAULT_MATCH_CONFIG, ...config };
    this.timer = this.config.countdownDuration;
    this.onPhaseChange = onPhaseChange;
  }

  /** Advance the internal timer. Call once per variable-rate update. */
  update(dt: number): void {
    if (this.phase === 'ENDED') return;
    this.fightCueLeft = Math.max(0, this.fightCueLeft - dt);
    this.timer -= dt;

    if (this.phase === 'COUNTDOWN') {
      if (this.timer <= 0) {
        const overshoot = Math.max(0, -this.timer);
        this.transition('FIGHTING');
        this.fightCueLeft = FIGHT_CUE_DURATION;
        this.timer = Math.max(0, this.config.fightDuration - overshoot);
      }
      return;
    }

    if (this.phase === 'FIGHTING') {
      // KO detection from reported mass
      const p1KO = this.p1Mass <= this.config.knockoutThreshold;
      const p2KO = this.p2Mass <= this.config.knockoutThreshold;
      if (p1KO && p2KO) {
        if (Math.abs(this.p1Mass - this.p2Mass) < 0.02) this.end('draw');
        else this.end(this.p1Mass < this.p2Mass ? 'lose' : 'win');
        return;
      }
      if (p2KO) {
        this.end('win');
        return;
      }
      if (p1KO) {
        this.end('lose');
        return;
      }
      // Time-out: whoever has more mass wins. Equal = draw.
      if (this.timer <= 0) {
        if (Math.abs(this.p1Mass - this.p2Mass) < 0.02) this.end('draw');
        else if (this.p1Mass > this.p2Mass) this.end('win');
        else this.end('lose');
      }
    }
  }

  /** Report the current mass fractions from the physics world. */
  reportMass(p1: number, p2: number): void {
    this.p1Mass = Math.max(0, Math.min(1, p1));
    this.p2Mass = Math.max(0, Math.min(1, p2));
  }

  /** Force-end the match early (e.g. player pressed ESC). */
  end(result: MatchResult): void {
    this.result = result;
    this.transition('ENDED');
  }

  /** Get a snapshot safe to read from UI code. */
  snapshot(): MatchSnapshot {
    const countdownSec =
      this.phase === 'COUNTDOWN'
        ? Math.max(0, Math.ceil(this.timer))
        : this.phase === 'FIGHTING' && this.fightCueLeft > 0
          ? 0
          : undefined;
    return {
      phase: this.phase,
      timer: Math.max(0, this.timer),
      countdownSec,
      p1Mass: this.p1Mass,
      p2Mass: this.p2Mass,
      result: this.result,
    };
  }

  getPhase(): MatchPhase {
    return this.phase;
  }

  isFighting(): boolean {
    return this.phase === 'FIGHTING';
  }

  isCountdown(): boolean {
    return this.phase === 'COUNTDOWN';
  }

  isEnded(): boolean {
    return this.phase === 'ENDED';
  }

  private transition(to: MatchPhase): void {
    if (this.phase === to) return;
    this.phase = to;
    this.onPhaseChange?.(to);
  }
}
