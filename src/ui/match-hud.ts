/**
 * Match HUD — shown while the game is on the ARENA screen.
 *
 * Contents:
 *   - Top center: match timer (MM:SS) + "ESC to leave" hint
 *   - Top-left: Player 1 meat-bar (mass) + stamina pip
 *   - Top-right: Player 2 meat-bar (mass) + stamina pip (mirrored)
 *   - Center: countdown ("3"/"2"/"1"/"FIGHT!") or result ("VICTORY"/"DEFEAT"/"DRAW")
 *   - Bottom center: "press R to restart" (only when match has ended)
 *
 * Call `setMatchState(...)` every frame from the game loop.
 * Call `setVisible(false)` when leaving the ARENA screen.
 */

import type { ScreenHandle } from './game-shell';

export type MatchStatus = 'countdown' | 'fighting' | 'ended';
export type MatchResult = 'win' | 'lose' | 'draw';

export interface MatchState {
  /** Match time remaining in seconds. */
  timer: number;
  /** Player 1 mass as a fraction 0..1 of their starting mass. */
  p1Mass: number;
  /** Player 2 mass as a fraction 0..1 of their starting mass. */
  p2Mass: number;
  /** Player 1 stamina 0..1. */
  p1Stamina: number;
  /** Player 2 stamina 0..1. */
  p2Stamina: number;
  status: MatchStatus;
  /** Seconds remaining in the pre-match countdown (only when status === 'countdown'). */
  countdownSec?: number;
  /** Final result (only when status === 'ended'). */
  result?: MatchResult;
  /** Display name for player 1 — defaults to "YOU". */
  p1Name?: string;
  /** Display name for player 2 — defaults to "BOT". */
  p2Name?: string;
  p1AttackState?: string;
  p2AttackState?: string;
}

const STYLE_ID = 'meatbash-match-hud-style';

const STYLES = `
#mb-hud {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;
  font-family: 'Courier New', Courier, monospace;
  color: #f0d0d0;
}

#mb-hud .mb-hud-top {
  position: absolute;
  top: 24px; left: 0;
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0 24px;
  gap: 24px;
}

#mb-hud-timer {
  position: absolute;
  top: 24px; left: 50%;
  transform: translateX(-50%);
  background: rgba(20, 10, 10, 0.78);
  border: 1px solid rgba(255, 80, 80, 0.35);
  border-radius: 12px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  padding: 10px 20px;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,180,180,0.08);
  min-width: 140px;
}
#mb-hud-timer .mb-timer-value {
  font-size: 26px;
  font-weight: 900;
  letter-spacing: 3px;
  color: #ffd8d8;
  text-shadow: 0 0 8px rgba(255, 80, 80, 0.6);
}
#mb-hud-timer .mb-timer-hint {
  display: block;
  font-size: 9px;
  letter-spacing: 2px;
  color: rgba(255, 160, 160, 0.55);
  margin-top: 2px;
  text-transform: uppercase;
}

.mb-player-card {
  background: rgba(20, 10, 10, 0.78);
  border: 1px solid rgba(255, 80, 80, 0.3);
  border-radius: 12px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  padding: 12px 14px;
  min-width: 220px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,180,180,0.08);
}
.mb-player-card.mb-p2 {
  text-align: right;
}
.mb-player-card .mb-player-name {
  font-size: 12px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #ff9090;
  margin-bottom: 8px;
  text-shadow: 0 0 6px rgba(255, 80, 80, 0.4);
}
.mb-player-card .mb-attack-state {
  margin-top: 6px;
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: rgba(255, 210, 140, 0.9);
}

.mb-meat-bar {
  position: relative;
  height: 14px;
  background: rgba(0,0,0,0.55);
  border: 1px solid rgba(255, 80, 80, 0.3);
  border-radius: 999px;
  overflow: hidden;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.6);
}
.mb-meat-fill {
  position: absolute;
  top: 0; left: 0; bottom: 0;
  background: linear-gradient(180deg, #ffb878 0%, #ff7a42 50%, #c23018 100%);
  box-shadow:
    inset 0 1px 0 rgba(255,220,180,0.6),
    inset 0 -2px 3px rgba(80,10,0,0.5),
    0 0 8px rgba(255, 120, 60, 0.5);
  transition: width 0.15s ease-out;
  border-radius: 999px;
}
.mb-p2 .mb-meat-fill {
  left: auto;
  right: 0;
}

.mb-stam-bar {
  position: relative;
  height: 6px;
  margin-top: 6px;
  background: rgba(0,0,0,0.55);
  border: 1px solid rgba(120, 180, 255, 0.25);
  border-radius: 999px;
  overflow: hidden;
}
.mb-stam-fill {
  position: absolute;
  top: 0; left: 0; bottom: 0;
  background: linear-gradient(180deg, #9fd8ff, #3f8ccc);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.4);
  transition: width 0.1s linear;
  border-radius: 999px;
}
.mb-p2 .mb-stam-fill { left: auto; right: 0; }

.mb-bar-label {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: rgba(255, 180, 180, 0.6);
  margin-bottom: 4px;
}

#mb-hud-center {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}
#mb-hud-countdown {
  font-size: 180px;
  font-weight: 900;
  color: #ffd0d0;
  text-shadow:
    0 0 20px rgba(255, 100, 100, 0.9),
    0 0 50px rgba(255, 60, 120, 0.7),
    0 8px 0 rgba(120, 20, 40, 0.8),
    0 14px 30px rgba(0,0,0,0.7);
  letter-spacing: 4px;
  animation: mb-count-pop 0.9s ease-out forwards;
}
#mb-hud-countdown.mb-fight-text {
  font-size: 120px;
  letter-spacing: 12px;
}
@keyframes mb-count-pop {
  0% { transform: scale(0.4); opacity: 0; }
  25% { transform: scale(1.2); opacity: 1; }
  85% { transform: scale(1.0); opacity: 1; }
  100% { transform: scale(1.6); opacity: 0; }
}

#mb-hud-result {
  font-size: 140px;
  font-weight: 900;
  letter-spacing: 10px;
  text-shadow:
    0 0 22px rgba(255, 100, 100, 0.9),
    0 0 55px rgba(255, 60, 120, 0.7),
    0 10px 0 rgba(80, 10, 20, 0.85),
    0 18px 36px rgba(0,0,0,0.75);
  animation: mb-result-pulse 1.8s ease-in-out infinite;
}
#mb-hud-result.mb-win { color: #ffe0a0; }
#mb-hud-result.mb-lose { color: #ff8080; }
#mb-hud-result.mb-draw { color: #d0d0ff; }
@keyframes mb-result-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}

#mb-hud-restart-hint {
  position: absolute;
  bottom: 40px; left: 50%;
  transform: translateX(-50%);
  background: rgba(20, 10, 10, 0.78);
  border: 1px solid rgba(255, 80, 80, 0.3);
  border-radius: 10px;
  padding: 10px 18px;
  font-size: 13px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: rgba(255, 200, 200, 0.85);
  text-shadow: 0 0 6px rgba(255, 80, 80, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.45);
}
.mb-combat-text-layer {
  position: absolute;
  left: 50%;
  bottom: 24%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.mb-combat-text {
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 2px;
  color: #ffe0c0;
  text-shadow: 0 0 10px rgba(255, 80, 80, 0.75);
  animation: mb-combat-text-pop 0.4s ease-out forwards;
}
@keyframes mb-combat-text-pop {
  0% { opacity: 0; transform: translateY(8px) scale(0.9); }
  20% { opacity: 1; transform: translateY(0) scale(1.08); }
  100% { opacity: 0; transform: translateY(-18px) scale(1); }
}
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function formatTimer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

export class MatchHud implements ScreenHandle {
  private root: HTMLDivElement;

  private timerValue!: HTMLDivElement;

  private p1NameEl!: HTMLDivElement;
  private p2NameEl!: HTMLDivElement;
  private p1MassFill!: HTMLDivElement;
  private p2MassFill!: HTMLDivElement;
  private p1StamFill!: HTMLDivElement;
  private p2StamFill!: HTMLDivElement;
  private p1AttackStateEl!: HTMLDivElement;
  private p2AttackStateEl!: HTMLDivElement;

  private centerEl!: HTMLDivElement;
  private countdownEl!: HTMLDivElement;
  private resultEl!: HTMLDivElement;

  private restartHint!: HTMLDivElement;
  private combatTextLayer!: HTMLDivElement;
  private lastCombatTextKey: string | null = null;
  private lastCombatTextAt = 0;

  private lastCountdownDisplay: string | null = null;

  constructor() {
    injectStyles();

    const overlay = document.getElementById('ui-overlay');
    if (!overlay) {
      throw new Error('MatchHud: #ui-overlay not found');
    }

    this.root = document.createElement('div');
    this.root.id = 'mb-hud';
    this.root.style.display = 'none'; // hidden until the arena activates

    // ---- Timer (top center) ----
    const timer = document.createElement('div');
    timer.id = 'mb-hud-timer';
    const timerValue = document.createElement('div');
    timerValue.className = 'mb-timer-value';
    timerValue.textContent = '03:00';
    const timerHint = document.createElement('span');
    timerHint.className = 'mb-timer-hint';
    timerHint.textContent = 'press ESC to leave';
    timer.appendChild(timerValue);
    timer.appendChild(timerHint);
    this.root.appendChild(timer);
    this.timerValue = timerValue;

    // ---- Top row (player cards flanking the timer) ----
    const topRow = document.createElement('div');
    topRow.className = 'mb-hud-top';

    const p1 = this.buildPlayerCard('p1');
    topRow.appendChild(p1.card);
    this.p1NameEl = p1.name;
    this.p1MassFill = p1.massFill;
    this.p1StamFill = p1.stamFill;
    this.p1AttackStateEl = p1.attackState;

    const p2 = this.buildPlayerCard('p2');
    topRow.appendChild(p2.card);
    this.p2NameEl = p2.name;
    this.p2MassFill = p2.massFill;
    this.p2StamFill = p2.stamFill;
    this.p2AttackStateEl = p2.attackState;

    this.root.appendChild(topRow);

    // ---- Center: countdown + result ----
    const center = document.createElement('div');
    center.id = 'mb-hud-center';
    const countdown = document.createElement('div');
    countdown.id = 'mb-hud-countdown';
    countdown.style.display = 'none';
    const result = document.createElement('div');
    result.id = 'mb-hud-result';
    result.style.display = 'none';
    center.appendChild(countdown);
    center.appendChild(result);
    this.root.appendChild(center);
    this.centerEl = center;
    this.countdownEl = countdown;
    this.resultEl = result;

    // ---- Restart hint ----
    const hint = document.createElement('div');
    hint.id = 'mb-hud-restart-hint';
    hint.textContent = 'press R to restart';
    hint.style.display = 'none';
    this.root.appendChild(hint);
    this.restartHint = hint;

    const combatTextLayer = document.createElement('div');
    combatTextLayer.className = 'mb-combat-text-layer';
    this.root.appendChild(combatTextLayer);
    this.combatTextLayer = combatTextLayer;

    overlay.appendChild(this.root);
  }

  private buildPlayerCard(side: 'p1' | 'p2') {
    const card = document.createElement('div');
    card.className = `mb-player-card mb-${side}`;

    const name = document.createElement('div');
    name.className = 'mb-player-name';
    name.textContent = side === 'p1' ? 'YOU' : 'BOT';
    card.appendChild(name);

    const label = document.createElement('div');
    label.className = 'mb-bar-label';
    if (side === 'p1') {
      label.innerHTML = '<span>MEAT</span><span>100%</span>';
    } else {
      label.innerHTML = '<span>100%</span><span>MEAT</span>';
    }
    card.appendChild(label);

    const meatBar = document.createElement('div');
    meatBar.className = 'mb-meat-bar';
    const massFill = document.createElement('div');
    massFill.className = 'mb-meat-fill';
    massFill.style.width = '100%';
    meatBar.appendChild(massFill);
    card.appendChild(meatBar);

    const stamBar = document.createElement('div');
    stamBar.className = 'mb-stam-bar';
    const stamFill = document.createElement('div');
    stamFill.className = 'mb-stam-fill';
    stamFill.style.width = '100%';
    stamBar.appendChild(stamFill);
    card.appendChild(stamBar);

    const attackState = document.createElement('div');
    attackState.className = 'mb-attack-state';
    attackState.textContent = 'PRIMARY: IDLE';
    card.appendChild(attackState);

    return { card, name, massFill, stamFill, massLabel: label, attackState };
  }

  // ---------- Public API ----------

  setMatchState(state: MatchState) {
    // Names
    if (state.p1Name) this.p1NameEl.textContent = state.p1Name;
    if (state.p2Name) this.p2NameEl.textContent = state.p2Name;

    // Timer
    this.timerValue.textContent = formatTimer(state.timer);

    // Bars — clamp to [0, 1].
    const p1m = Math.max(0, Math.min(1, state.p1Mass));
    const p2m = Math.max(0, Math.min(1, state.p2Mass));
    this.p1MassFill.style.width = `${p1m * 100}%`;
    this.p2MassFill.style.width = `${p2m * 100}%`;
    this.p1StamFill.style.width = `${Math.max(0, Math.min(1, state.p1Stamina)) * 100}%`;
    this.p2StamFill.style.width = `${Math.max(0, Math.min(1, state.p2Stamina)) * 100}%`;
    this.p1AttackStateEl.textContent = `PRIMARY: ${state.p1AttackState ?? 'IDLE'}`;
    this.p2AttackStateEl.textContent = `PRIMARY: ${state.p2AttackState ?? 'IDLE'}`;

    // Update percent labels on the cards.
    const p1Card = this.p1NameEl.parentElement;
    const p2Card = this.p2NameEl.parentElement;
    if (p1Card) {
      const lbl = p1Card.querySelector('.mb-bar-label');
      if (lbl) lbl.innerHTML = `<span>MEAT</span><span>${Math.round(p1m * 100)}%</span>`;
    }
    if (p2Card) {
      const lbl = p2Card.querySelector('.mb-bar-label');
      if (lbl) lbl.innerHTML = `<span>${Math.round(p2m * 100)}%</span><span>MEAT</span>`;
    }

    // Status-dependent center overlay
    switch (state.status) {
      case 'countdown':
        this.renderCountdown(state.countdownSec ?? 0);
        this.resultEl.style.display = 'none';
        this.restartHint.style.display = 'none';
        break;

      case 'fighting':
        this.countdownEl.style.display = 'none';
        this.resultEl.style.display = 'none';
        this.restartHint.style.display = 'none';
        this.lastCountdownDisplay = null;
        break;

      case 'ended':
        this.countdownEl.style.display = 'none';
        this.renderResult(state.result ?? 'draw');
        this.restartHint.style.display = 'block';
        break;
    }
  }

  private renderCountdown(secLeft: number) {
    // secLeft is expected to count down from ~3 to 0. When it hits 0 we show "FIGHT!"
    let display: string;
    let isFight = false;
    if (secLeft > 0.01) {
      display = String(Math.max(1, Math.ceil(secLeft)));
    } else {
      display = 'FIGHT!';
      isFight = true;
    }

    if (display !== this.lastCountdownDisplay) {
      this.countdownEl.textContent = display;
      this.countdownEl.classList.toggle('mb-fight-text', isFight);
      this.countdownEl.style.display = 'block';
      // Restart the pop animation.
      this.countdownEl.style.animation = 'none';
      // Force reflow so the animation restart takes effect.
      void this.countdownEl.offsetWidth;
      this.countdownEl.style.animation = '';
      this.lastCountdownDisplay = display;
    } else {
      this.countdownEl.style.display = 'block';
    }
  }

  private renderResult(result: MatchResult) {
    let text: string;
    let cls: string;
    switch (result) {
      case 'win':
        text = 'VICTORY';
        cls = 'mb-win';
        break;
      case 'lose':
        text = 'DEFEAT';
        cls = 'mb-lose';
        break;
      case 'draw':
      default:
        text = 'DRAW';
        cls = 'mb-draw';
        break;
    }
    if (this.resultEl.textContent !== text) {
      this.resultEl.textContent = text;
      this.resultEl.className = '';
      this.resultEl.classList.add(cls);
    }
    this.resultEl.style.display = 'block';
  }

  /** Reset the HUD to a fresh pre-match state. */
  reset() {
    this.timerValue.textContent = '03:00';
    this.p1MassFill.style.width = '100%';
    this.p2MassFill.style.width = '100%';
    this.p1StamFill.style.width = '100%';
    this.p2StamFill.style.width = '100%';
    this.countdownEl.style.display = 'none';
    this.resultEl.style.display = 'none';
    this.restartHint.style.display = 'none';
    this.p1AttackStateEl.textContent = 'PRIMARY: IDLE';
    this.p2AttackStateEl.textContent = 'PRIMARY: IDLE';
    this.combatTextLayer.innerHTML = '';
    this.lastCombatTextKey = null;
    this.lastCombatTextAt = 0;
    this.lastCountdownDisplay = null;
  }

  pushCombatText(text: string): void {
    const now = performance.now();
    if (this.lastCombatTextKey === text && now - this.lastCombatTextAt < 260) {
      return;
    }
    this.lastCombatTextKey = text;
    this.lastCombatTextAt = now;
    const node = document.createElement('div');
    node.className = 'mb-combat-text';
    node.textContent = text;
    this.combatTextLayer.appendChild(node);
    setTimeout(() => node.remove(), 420);
  }

  // ---------- ScreenHandle ----------

  setVisible(visible: boolean) {
    this.root.style.display = visible ? 'block' : 'none';
    if (!visible) this.reset();
  }
}
