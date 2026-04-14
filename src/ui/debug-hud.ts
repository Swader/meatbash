/**
 * Debug HUD overlay for Phase 1.
 * Shows controls guide, stamina bar, FPS, and a live state panel
 * with locomotion internals (mode, grounded feet, tilt, ground dist,
 * total mass, stamina regen rate).
 */

export interface DebugStateInfo {
  mode: string;
  groundedFeet: number;
  tiltDeg: number;
  groundDist: number;
  totalMass: number;
  regenPerSec: number;
}

const MODE_COLORS: Record<string, string> = {
  SUPPORTED: '#8aff8a',
  STUMBLING: '#ffcf66',
  AIRBORNE: '#66ccff',
  FALLEN: '#ff6666',
  RECOVERING: '#ff9fdf',
};

export class DebugHud {
  private container: HTMLDivElement;
  private staminaBar: HTMLDivElement;
  private fpsDisplay: HTMLDivElement;
  private statePanel: HTMLDivElement;
  private modeEl: HTMLSpanElement;
  private feetEl: HTMLSpanElement;
  private tiltEl: HTMLSpanElement;
  private distEl: HTMLSpanElement;
  private massEl: HTMLSpanElement;
  private regenEl: HTMLSpanElement;

  constructor() {
    const overlay = document.getElementById('ui-overlay')!;

    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: absolute; bottom: 20px; left: 20px;
      background: rgba(0,0,0,0.7); padding: 12px 16px;
      border-radius: 8px; font-size: 13px; line-height: 1.6;
      color: #ddd; font-family: monospace;
      border: 1px solid rgba(255,100,100,0.3);
    `;
    this.container.innerHTML = `
      <div style="color: #ff6b6b; font-weight: bold; margin-bottom: 6px;">🥩 CONTROLS</div>
      <div><span style="color:#ffaa66">W</span> = Walk forward</div>
      <div><span style="color:#ffaa66">S</span> = Walk backward</div>
      <div><span style="color:#ffaa66">A/D</span> = Turn left/right</div>
      <div><span style="color:#ffaa66">SPACE</span> = Jump / air flail</div>
      <div style="margin-top: 8px; color: #aaa; font-size: 11px;">Mouse drag = orbit camera</div>
      <div style="margin-top: 8px;">
        <span style="color:#66ccff">Stamina:</span>
        <div style="background: #333; border-radius: 4px; height: 8px; width: 120px; margin-top: 4px; overflow: hidden;">
          <div id="stamina-fill" style="background: #66ccff; height: 100%; width: 100%; transition: width 0.1s;"></div>
        </div>
      </div>
    `;
    overlay.appendChild(this.container);

    this.staminaBar = document.getElementById('stamina-fill') as HTMLDivElement;

    // ---- State debug panel (bottom-right) ----
    this.statePanel = document.createElement('div');
    this.statePanel.style.cssText = `
      position: absolute; bottom: 20px; right: 20px;
      background: rgba(0,0,0,0.78); padding: 10px 14px;
      border-radius: 8px; font-size: 12px; line-height: 1.5;
      color: #ddd; font-family: monospace;
      border: 1px solid rgba(100,200,255,0.25);
      min-width: 180px;
    `;
    this.statePanel.innerHTML = `
      <div style="color: #66ccff; font-weight: bold; margin-bottom: 6px;">🧠 STATE</div>
      <div>mode: <span id="dbg-mode" style="color:#8aff8a">?</span></div>
      <div>feet: <span id="dbg-feet">?</span></div>
      <div>tilt: <span id="dbg-tilt">?</span>°</div>
      <div>ground: <span id="dbg-dist">?</span>m</div>
      <div>mass: <span id="dbg-mass">?</span>kg</div>
      <div>regen: <span id="dbg-regen">?</span>/s</div>
    `;
    overlay.appendChild(this.statePanel);

    this.modeEl = document.getElementById('dbg-mode') as HTMLSpanElement;
    this.feetEl = document.getElementById('dbg-feet') as HTMLSpanElement;
    this.tiltEl = document.getElementById('dbg-tilt') as HTMLSpanElement;
    this.distEl = document.getElementById('dbg-dist') as HTMLSpanElement;
    this.massEl = document.getElementById('dbg-mass') as HTMLSpanElement;
    this.regenEl = document.getElementById('dbg-regen') as HTMLSpanElement;

    // FPS counter
    this.fpsDisplay = document.createElement('div');
    this.fpsDisplay.style.cssText = `
      position: absolute; top: 10px; right: 10px;
      background: rgba(0,0,0,0.5); padding: 4px 8px;
      border-radius: 4px; font-size: 12px; color: #888;
      font-family: monospace;
    `;
    overlay.appendChild(this.fpsDisplay);
  }

  update(staminaPercent: number, fps: number, state?: DebugStateInfo) {
    if (this.staminaBar) {
      this.staminaBar.style.width = `${staminaPercent}%`;
      if (staminaPercent > 50) {
        this.staminaBar.style.background = '#66ccff';
      } else if (staminaPercent > 20) {
        this.staminaBar.style.background = '#ffaa44';
      } else {
        this.staminaBar.style.background = '#ff4444';
      }
    }
    this.fpsDisplay.textContent = `${fps} FPS`;

    if (state) {
      this.modeEl.textContent = state.mode;
      this.modeEl.style.color = MODE_COLORS[state.mode] || '#ddd';

      this.feetEl.textContent = `${state.groundedFeet} / 2`;
      this.feetEl.style.color =
        state.groundedFeet === 2 ? '#8aff8a' :
        state.groundedFeet === 1 ? '#ffcf66' : '#ff6666';

      this.tiltEl.textContent = state.tiltDeg.toFixed(1);
      this.tiltEl.style.color =
        state.tiltDeg < 30 ? '#8aff8a' :
        state.tiltDeg < 60 ? '#ffcf66' : '#ff6666';

      const distStr = isFinite(state.groundDist) ? state.groundDist.toFixed(2) : '∞';
      this.distEl.textContent = distStr;

      this.massEl.textContent = state.totalMass.toFixed(1);
      this.regenEl.textContent = state.regenPerSec.toFixed(1);
    }
  }
}
