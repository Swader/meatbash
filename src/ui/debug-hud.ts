/**
 * Debug HUD overlay for Phase 1.
 * Shows controls guide and stamina bar.
 * Will be replaced by proper combat HUD in Phase 3.
 */
export class DebugHud {
  private container: HTMLDivElement;
  private staminaBar: HTMLDivElement;
  private fpsDisplay: HTMLDivElement;

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

  update(staminaPercent: number, fps: number) {
    if (this.staminaBar) {
      this.staminaBar.style.width = `${staminaPercent}%`;
      // Color shifts from blue to red as stamina drops
      if (staminaPercent > 50) {
        this.staminaBar.style.background = '#66ccff';
      } else if (staminaPercent > 20) {
        this.staminaBar.style.background = '#ffaa44';
      } else {
        this.staminaBar.style.background = '#ff4444';
      }
    }
    this.fpsDisplay.textContent = `${fps} FPS`;
  }
}
