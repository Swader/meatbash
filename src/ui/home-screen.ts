/**
 * Home screen — the first thing players see.
 *
 * Full-page HTML overlay rendered on top of the live Three.js arena
 * (the arena keeps rendering underneath so the glassmorphic panels
 * sit over a living, breathing scene).
 *
 * Layout:
 *   - Top: big pulsating MEATBASH title
 *   - Center: HOME actions or LAB workshop, depending on shell state
 *   - Right sidebar: beast list with "Your beasts" + "Defaults" sections
 *   - Bottom banner: Darwin Certification (coming soon)
 *
 * All styling is injected once into <head> via a <style> block.
 */

import type { AttackWeaponSocket, AttackWeaponType } from '../combat/attack-types';
import type {
  Archetype,
  BeastBodySize,
  BeastChargeStyle,
  BeastListing,
  BeastStatSummary,
  BeastStabilityBias,
  BeastWeaponLength,
  BeastWeaponMass,
  WeightClassHint,
} from '../beast/beast-data';
import {
  getWorkshopColorPresets,
  getWorkshopBodySizes,
  getWorkshopChargeStyles,
  getWorkshopPreview,
  getWorkshopStabilityBiases,
  getWorkshopWeaponLengths,
  getWorkshopWeaponMasses,
  getWorkshopWeaponSockets,
  getWorkshopWeaponTypes,
  getWorkshopWeightClasses,
  type WorkshopColorPreset,
  type WorkshopDraft,
} from '../beast/workshop';
import type { GameShell, ScreenHandle } from './game-shell';

export interface HomeScreenOptions {
  shell: GameShell;
  defaultBeasts: BeastListing[];
  userBeasts?: BeastListing[];
  onCreateWorkshopBeast?: (draft: WorkshopDraft) => BeastListing | null;
}

type HomeScreenMode = 'home' | 'lab';

const STYLE_ID = 'meatbash-home-style';

const STYLES = `
#mb-home {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-columns: 1fr;
  padding: 24px;
  gap: 20px;
  font-family: 'Courier New', Courier, monospace;
  color: #f0d0d0;
  pointer-events: none;
}
#mb-home > * { pointer-events: auto; }

#mb-home-title {
  grid-row: 1;
  text-align: center;
  font-size: 72px;
  font-weight: 900;
  letter-spacing: 6px;
  color: #ffb0b0;
  text-shadow:
    0 0 8px rgba(255, 100, 100, 0.7),
    0 0 24px rgba(255, 60, 120, 0.5),
    0 4px 0 rgba(120, 20, 40, 0.8),
    0 8px 20px rgba(0, 0, 0, 0.6);
  animation: mb-title-pulse 2.6s ease-in-out infinite;
  user-select: none;
  pointer-events: none;
}
#mb-home-title .mb-subtitle {
  display: block;
  font-size: 13px;
  letter-spacing: 4px;
  margin-top: 6px;
  color: rgba(255, 180, 180, 0.65);
  text-shadow: 0 0 6px rgba(255, 80, 80, 0.4);
  animation: none;
}

@keyframes mb-title-pulse {
  0%, 100% {
    transform: scale(1);
    text-shadow:
      0 0 8px rgba(255, 100, 100, 0.7),
      0 0 24px rgba(255, 60, 120, 0.5),
      0 4px 0 rgba(120, 20, 40, 0.8),
      0 8px 20px rgba(0, 0, 0, 0.6);
  }
  50% {
    transform: scale(1.025);
    text-shadow:
      0 0 14px rgba(255, 140, 140, 0.95),
      0 0 36px rgba(255, 80, 160, 0.75),
      0 4px 0 rgba(140, 30, 50, 0.9),
      0 10px 24px rgba(0, 0, 0, 0.6);
  }
}

#mb-home-body {
  grid-row: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  min-height: 0;
}

.mb-panel {
  background: rgba(20, 10, 10, 0.78);
  border: 1px solid rgba(255, 80, 80, 0.3);
  border-radius: 16px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.55),
    inset 0 1px 0 rgba(255, 180, 180, 0.06);
  padding: 18px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.mb-panel h2 {
  font-size: 14px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #ff9090;
  margin-bottom: 12px;
  text-shadow: 0 0 6px rgba(255, 80, 80, 0.4);
}

.mb-panel h3 {
  font-size: 11px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: rgba(255, 160, 160, 0.7);
  margin: 12px 0 8px 0;
}

.mb-input,
.mb-select {
  width: 100%;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 80, 80, 0.35);
  border-radius: 8px;
  padding: 10px 12px;
  color: #ffd0d0;
  font-family: inherit;
  font-size: 13px;
  letter-spacing: 2px;
  text-transform: uppercase;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.mb-input:focus,
.mb-select:focus {
  border-color: rgba(255, 140, 160, 0.8);
  box-shadow: 0 0 0 2px rgba(255, 80, 120, 0.25);
}
.mb-input:disabled,
.mb-select:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}
.mb-input::placeholder {
  color: rgba(255, 160, 160, 0.35);
}
.mb-select option {
  color: #201010;
}

.mb-button {
  width: 100%;
  background: linear-gradient(180deg, rgba(255, 90, 110, 0.95), rgba(180, 40, 60, 0.95));
  border: 1px solid rgba(255, 160, 160, 0.5);
  border-radius: 10px;
  padding: 12px 14px;
  color: #fff4f4;
  font-family: inherit;
  font-size: 13px;
  font-weight: bold;
  letter-spacing: 2px;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.15s, filter 0.15s;
  box-shadow:
    0 4px 12px rgba(180, 30, 50, 0.4),
    inset 0 1px 0 rgba(255, 220, 220, 0.3);
}
.mb-button:hover {
  filter: brightness(1.12);
  box-shadow:
    0 6px 18px rgba(255, 80, 110, 0.55),
    inset 0 1px 0 rgba(255, 220, 220, 0.4);
  transform: translateY(-1px);
}
.mb-button:active {
  transform: translateY(1px);
  filter: brightness(0.95);
}
.mb-button.mb-secondary {
  background: linear-gradient(180deg, rgba(60, 25, 30, 0.9), rgba(30, 12, 16, 0.9));
  border-color: rgba(255, 80, 80, 0.35);
  color: #ffb0b0;
}
.mb-button.mb-disabled {
  background: linear-gradient(180deg, rgba(50, 40, 40, 0.7), rgba(25, 20, 20, 0.7));
  border-color: rgba(120, 100, 100, 0.3);
  color: rgba(220, 200, 200, 0.45);
  cursor: not-allowed;
  box-shadow: none;
}
.mb-button.mb-disabled:hover {
  filter: none;
  transform: none;
  box-shadow: none;
}

#mb-home-center {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 10, 10, 0.35);
  border: 1px dashed rgba(255, 80, 80, 0.25);
  border-radius: 20px;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  padding: 20px;
}
#mb-home-center .mb-center-inner {
  width: min(540px, 100%);
  text-align: center;
}
#mb-home-center .mb-center-label {
  font-size: 22px;
  letter-spacing: 4px;
  color: rgba(255, 180, 180, 0.75);
  text-shadow: 0 0 10px rgba(255, 100, 100, 0.4);
  margin-bottom: 6px;
}
#mb-home-center .mb-center-soon {
  font-size: 12px;
  letter-spacing: 3px;
  color: rgba(255, 190, 190, 0.62);
  text-transform: uppercase;
}
#mb-home-center .mb-center-section {
  display: none;
}
#mb-home-center .mb-center-section.mb-active {
  display: block;
}
#mb-home-center .mb-center-selected {
  font-size: 13px;
  letter-spacing: 2px;
  color: rgba(255, 200, 200, 0.8);
}
.mb-center-meta {
  margin-top: 18px;
  min-height: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.mb-center-actions {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mb-center-primary {
  width: min(320px, 100%);
  margin: 0 auto;
}
.mb-join-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  width: min(380px, 100%);
  margin: 0 auto;
}
.mb-join-row .mb-button {
  width: auto;
  min-width: 124px;
}
.mb-home-status {
  min-height: 16px;
  font-size: 13px;
  line-height: 1.35;
  color: rgba(255, 210, 150, 0.8);
}
.mb-lab-toolbar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 16px;
}
.mb-workshop-note {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.35;
  color: rgba(255, 190, 190, 0.72);
}
.mb-workshop-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 16px;
  text-align: left;
}
.mb-workshop-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mb-workshop-field.mb-span-2 {
  grid-column: span 2;
}
.mb-workshop-field label {
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: rgba(255, 180, 180, 0.7);
}
.mb-workshop-actions {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mb-workshop-status {
  min-height: 16px;
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(255, 210, 150, 0.8);
}
.mb-workshop-preview {
  margin-top: 14px;
  padding: 12px 14px;
  background: rgba(8, 4, 4, 0.45);
  border: 1px solid rgba(255, 110, 110, 0.18);
  border-radius: 10px;
  text-align: left;
}
.mb-workshop-preview-summary {
  font-size: 11px;
  line-height: 1.4;
  color: rgba(255, 214, 180, 0.88);
}
.mb-workshop-stats {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}
.mb-workshop-stat-row {
  display: grid;
  grid-template-columns: 108px 1fr 36px;
  gap: 8px;
  align-items: center;
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: rgba(255, 190, 190, 0.75);
}
.mb-workshop-stat-bar {
  position: relative;
  height: 8px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 110, 110, 0.18);
  border-radius: 999px;
  overflow: hidden;
}
.mb-workshop-stat-fill {
  position: absolute;
  inset: 0;
  width: 0%;
  background: linear-gradient(90deg, #ff9e66, #ff5d5d);
  box-shadow: 0 0 8px rgba(255, 100, 100, 0.35);
}

.mb-beast-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mb-beast-card {
  position: relative;
  padding: 10px 12px;
  background: rgba(40, 18, 22, 0.85);
  border: 1px solid rgba(255, 80, 80, 0.25);
  border-radius: 10px;
  cursor: pointer;
  transition: transform 0.12s, border-color 0.15s, box-shadow 0.15s, background 0.15s;
  display: flex;
  align-items: center;
  gap: 10px;
}
.mb-beast-card:hover {
  background: rgba(60, 24, 30, 0.92);
  border-color: rgba(255, 140, 160, 0.55);
  box-shadow: 0 4px 14px rgba(255, 80, 110, 0.2);
}
.mb-beast-card.mb-selected {
  border-color: rgba(255, 160, 180, 0.9);
  box-shadow:
    0 0 0 2px rgba(255, 120, 150, 0.35),
    0 6px 20px rgba(255, 80, 110, 0.35);
  transform: scale(1.03);
  background: rgba(70, 28, 36, 0.92);
}
.mb-beast-card .mb-beast-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #ffb0b8, #c04058 70%, #601020);
  box-shadow: inset 0 -3px 4px rgba(0,0,0,0.4), 0 0 6px rgba(255,80,110,0.4);
  flex-shrink: 0;
}
.mb-beast-card .mb-beast-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.mb-beast-card .mb-beast-name {
  font-size: 13px;
  font-weight: bold;
  color: #ffd8d8;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.mb-beast-card .mb-beast-arche {
  font-size: 10px;
  color: rgba(255, 180, 180, 0.55);
  letter-spacing: 2px;
  text-transform: uppercase;
}
.mb-beast-card .mb-beast-profile {
  margin-top: 4px;
  font-size: 10px;
  letter-spacing: 1px;
  color: rgba(255, 210, 140, 0.9);
  text-transform: uppercase;
}
.mb-beast-card .mb-beast-summary {
  margin-top: 5px;
  font-size: 10px;
  line-height: 1.25;
  color: rgba(255, 190, 190, 0.72);
}
.mb-empty {
  font-size: 11px;
  color: rgba(255, 160, 160, 0.4);
  font-style: italic;
  padding: 8px 4px;
}

#mb-home-bottom {
  grid-row: 3;
}

.mb-stack > * + * { margin-top: 10px; }

#mb-home-right {
  overflow-y: auto;
}

/* Scrollbar for side panels */
#mb-home-right::-webkit-scrollbar { width: 6px; }
#mb-home-right::-webkit-scrollbar-thumb {
  background: rgba(255, 80, 80, 0.3);
  border-radius: 3px;
}

@media (max-width: 980px) {
  #mb-home {
    padding: 16px;
    gap: 16px;
  }

  #mb-home-title {
    font-size: 52px;
    letter-spacing: 4px;
  }

  #mb-home-body {
    grid-template-columns: 1fr;
  }

  #mb-home-right {
    max-height: 34vh;
  }

  .mb-lab-toolbar,
  .mb-join-row {
    grid-template-columns: 1fr;
  }

  .mb-join-row .mb-button {
    width: 100%;
  }
}
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export class HomeScreen implements ScreenHandle {
  private root: HTMLDivElement;
  private shell: GameShell;
  private defaults: BeastListing[];
  private userBeasts: BeastListing[];
  private onCreateWorkshopBeast?: (draft: WorkshopDraft) => BeastListing | null;
  private screenMode: HomeScreenMode = 'home';
  private selectedBeastId: string | null = null;
  private cardEls = new Map<string, HTMLDivElement>();
  private centerMetaEl!: HTMLDivElement;
  private centerSelectedLabel: HTMLDivElement;
  private homeSection!: HTMLDivElement;
  private labSection!: HTMLDivElement;
  private codeInput!: HTMLInputElement;
  private homeStatusEl!: HTMLDivElement;
  private workshopNameInput!: HTMLInputElement;
  private workshopArchetypeSelect!: HTMLSelectElement;
  private workshopWeightSelect!: HTMLSelectElement;
  private workshopBodySizeSelect!: HTMLSelectElement;
  private workshopStabilitySelect!: HTMLSelectElement;
  private workshopWeaponTypeSelect!: HTMLSelectElement;
  private workshopWeaponSocketSelect!: HTMLSelectElement;
  private workshopLengthSelect!: HTMLSelectElement;
  private workshopMassSelect!: HTMLSelectElement;
  private workshopChargeStyleSelect!: HTMLSelectElement;
  private workshopColorSelect!: HTMLSelectElement;
  private workshopStatusEl!: HTMLDivElement;
  private workshopPreviewSummaryEl!: HTMLDivElement;
  private workshopStatsEl!: HTMLDivElement;

  constructor(opts: HomeScreenOptions) {
    this.shell = opts.shell;
    this.defaults = opts.defaultBeasts;
    this.userBeasts = opts.userBeasts ?? [];
    this.onCreateWorkshopBeast = opts.onCreateWorkshopBeast;

    injectStyles();

    const overlay = document.getElementById('ui-overlay');
    if (!overlay) {
      throw new Error('HomeScreen: #ui-overlay not found');
    }

    this.root = document.createElement('div');
    this.root.id = 'mb-home';

    // ---- Title ----
    const title = document.createElement('div');
    title.id = 'mb-home-title';
    title.innerHTML = `MEATBASH<span class="mb-subtitle">ORGANIC DESTRUCTION DERBY</span>`;
    this.root.appendChild(title);

    // ---- Body: center | right ----
    const body = document.createElement('div');
    body.id = 'mb-home-body';

    body.appendChild(this.buildCenterPanel());
    const { panel: rightPanel, centerSelectedLabel } = this.buildRightAndCenterLabel();
    body.appendChild(rightPanel);
    this.centerSelectedLabel = centerSelectedLabel;

    this.root.appendChild(body);

    // ---- Bottom banner ----
    this.root.appendChild(this.buildBottomBanner());

    overlay.appendChild(this.root);

    // Pre-select the first default beast for instant "quick play" feel.
    if (this.defaults.length > 0) {
      this.selectBeast(this.defaults[0].id);
    }
    this.syncModeUi();
  }

  // ---------- Builders ----------

  private buildCenterPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'mb-home-center';

    const inner = document.createElement('div');
    inner.className = 'mb-center-inner';

    this.homeSection = document.createElement('div');
    this.homeSection.className = 'mb-center-section';

    const homeLabel = document.createElement('div');
    homeLabel.className = 'mb-center-label';
    homeLabel.textContent = 'FIGHT PIT';
    this.homeSection.appendChild(homeLabel);

    const homeSoon = document.createElement('div');
    homeSoon.className = 'mb-center-soon';
    homeSoon.textContent = 'Pick a beast, bash a bot, or head into the lab';
    this.homeSection.appendChild(homeSoon);

    const homeNote = document.createElement('div');
    homeNote.className = 'mb-workshop-note';
    homeNote.textContent =
      'The selected beast is your live roster anchor. Start a local bot fight now, or step into the Gene Lab to forge a custom variant before the match.';
    this.homeSection.appendChild(homeNote);

    const homeActions = document.createElement('div');
    homeActions.className = 'mb-center-actions';

    const makeBtn = document.createElement('button');
    makeBtn.className = 'mb-button mb-center-primary';
    makeBtn.textContent = 'BASH BOT';
    makeBtn.addEventListener('click', () => this.handleMakeMatch());
    homeActions.appendChild(makeBtn);

    const hostBtn = document.createElement('button');
    hostBtn.className = 'mb-button mb-secondary mb-center-primary';
    hostBtn.textContent = 'HOST MATCH';
    hostBtn.addEventListener('click', () => this.handleHostMatch());
    homeActions.appendChild(hostBtn);

    const joinRow = document.createElement('div');
    joinRow.className = 'mb-join-row';
    this.codeInput = document.createElement('input');
    this.codeInput.type = 'text';
    this.codeInput.className = 'mb-input';
    this.codeInput.placeholder = 'ROOM CODE';
    this.codeInput.maxLength = 9;
    joinRow.appendChild(this.codeInput);

    const joinBtn = document.createElement('button');
    joinBtn.className = 'mb-button mb-secondary';
    joinBtn.textContent = 'JOIN MATCH';
    joinBtn.addEventListener('click', () => this.handleJoin());
    joinRow.appendChild(joinBtn);
    homeActions.appendChild(joinRow);

    const labBtn = document.createElement('button');
    labBtn.className = 'mb-button mb-secondary mb-center-primary';
    labBtn.textContent = 'ENTER GENE LAB';
    labBtn.addEventListener('click', () => this.shell.emitOpenLab());
    homeActions.appendChild(labBtn);

    this.homeStatusEl = document.createElement('div');
    this.homeStatusEl.className = 'mb-home-status';
    this.homeStatusEl.textContent = 'Bot fights and match-code hosting are live. Pick a beast, host a room, or join one by code.';
    homeActions.appendChild(this.homeStatusEl);
    this.homeSection.appendChild(homeActions);

    this.labSection = document.createElement('div');
    this.labSection.className = 'mb-center-section';

    const labLabel = document.createElement('div');
    labLabel.className = 'mb-center-label';
    labLabel.textContent = 'GENE LAB';
    this.labSection.appendChild(labLabel);

    const labSoon = document.createElement('div');
    labSoon.className = 'mb-center-soon';
    labSoon.textContent = 'Quick workshop for immediate fight variants';
    this.labSection.appendChild(labSoon);

    const note = document.createElement('div');
    note.className = 'mb-workshop-note';
    note.textContent =
      'Swap archetype, shift attack profile, bias charge feel, then forge a custom beast and throw it straight into the arena.';
    this.labSection.appendChild(note);

    const toolbar = document.createElement('div');
    toolbar.className = 'mb-lab-toolbar';

    const backBtn = document.createElement('button');
    backBtn.className = 'mb-button mb-secondary';
    backBtn.textContent = 'BACK TO MENU';
    backBtn.addEventListener('click', () => this.shell.transition('HOME'));
    toolbar.appendChild(backBtn);

    const forgeShortcutBtn = document.createElement('button');
    forgeShortcutBtn.className = 'mb-button';
    forgeShortcutBtn.textContent = 'FORGE & STAY IN LAB';
    forgeShortcutBtn.addEventListener('click', () => this.handleForgeWorkshop());
    toolbar.appendChild(forgeShortcutBtn);
    this.labSection.appendChild(toolbar);

    const grid = document.createElement('div');
    grid.className = 'mb-workshop-grid';

    this.workshopNameInput = document.createElement('input');
    this.workshopNameInput.type = 'text';
    this.workshopNameInput.className = 'mb-input';
    this.workshopNameInput.maxLength = 24;
    grid.appendChild(this.createWorkshopField('Name', this.workshopNameInput, true));

    this.workshopArchetypeSelect = document.createElement('select');
    this.workshopArchetypeSelect.className = 'mb-select';
    for (const archetype of ['bipedal', 'quadruped'] as const) {
      const option = document.createElement('option');
      option.value = archetype;
      option.textContent = archetype;
      this.workshopArchetypeSelect.appendChild(option);
    }
    this.workshopArchetypeSelect.addEventListener('change', () => this.updateWorkshopSelections());
    grid.appendChild(this.createWorkshopField('Archetype', this.workshopArchetypeSelect));

    this.workshopWeightSelect = document.createElement('select');
    this.workshopWeightSelect.className = 'mb-select';
    for (const value of getWorkshopWeightClasses()) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      this.workshopWeightSelect.appendChild(option);
    }
    this.workshopWeightSelect.addEventListener('change', () => this.refreshWorkshopPreview());
    grid.appendChild(this.createWorkshopField('Weight Class', this.workshopWeightSelect));

    this.workshopBodySizeSelect = document.createElement('select');
    this.workshopBodySizeSelect.className = 'mb-select';
    for (const value of getWorkshopBodySizes()) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      this.workshopBodySizeSelect.appendChild(option);
    }
    this.workshopBodySizeSelect.addEventListener('change', () => this.refreshWorkshopPreview());
    grid.appendChild(this.createWorkshopField('Body Size', this.workshopBodySizeSelect));

    this.workshopStabilitySelect = document.createElement('select');
    this.workshopStabilitySelect.className = 'mb-select';
    for (const value of getWorkshopStabilityBiases()) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      this.workshopStabilitySelect.appendChild(option);
    }
    this.workshopStabilitySelect.addEventListener('change', () => this.refreshWorkshopPreview());
    grid.appendChild(this.createWorkshopField('Stability Bias', this.workshopStabilitySelect));

    this.workshopWeaponTypeSelect = document.createElement('select');
    this.workshopWeaponTypeSelect.className = 'mb-select';
    this.workshopWeaponTypeSelect.addEventListener('change', () => this.updateWorkshopSelections());
    grid.appendChild(this.createWorkshopField('Weapon Type', this.workshopWeaponTypeSelect));

    this.workshopWeaponSocketSelect = document.createElement('select');
    this.workshopWeaponSocketSelect.className = 'mb-select';
    this.workshopWeaponSocketSelect.addEventListener('change', () => this.refreshWorkshopPreview());
    grid.appendChild(this.createWorkshopField('Weapon Socket', this.workshopWeaponSocketSelect));

    this.workshopLengthSelect = document.createElement('select');
    this.workshopLengthSelect.className = 'mb-select';
    for (const value of getWorkshopWeaponLengths()) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      this.workshopLengthSelect.appendChild(option);
    }
    this.workshopLengthSelect.addEventListener('change', () => this.refreshWorkshopPreview());
    grid.appendChild(this.createWorkshopField('Weapon Length', this.workshopLengthSelect));

    this.workshopMassSelect = document.createElement('select');
    this.workshopMassSelect.className = 'mb-select';
    for (const value of getWorkshopWeaponMasses()) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      this.workshopMassSelect.appendChild(option);
    }
    this.workshopMassSelect.addEventListener('change', () => this.refreshWorkshopPreview());
    grid.appendChild(this.createWorkshopField('Weapon Mass', this.workshopMassSelect));

    this.workshopChargeStyleSelect = document.createElement('select');
    this.workshopChargeStyleSelect.className = 'mb-select';
    for (const value of getWorkshopChargeStyles()) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      this.workshopChargeStyleSelect.appendChild(option);
    }
    this.workshopChargeStyleSelect.addEventListener('change', () => this.refreshWorkshopPreview());
    grid.appendChild(this.createWorkshopField('Charge Style', this.workshopChargeStyleSelect));

    this.workshopColorSelect = document.createElement('select');
    this.workshopColorSelect.className = 'mb-select';
    for (const preset of getWorkshopColorPresets()) {
      const option = document.createElement('option');
      option.value = preset;
      option.textContent = preset;
      this.workshopColorSelect.appendChild(option);
    }
    this.workshopColorSelect.addEventListener('change', () => this.refreshWorkshopPreview());
    grid.appendChild(this.createWorkshopField('Color', this.workshopColorSelect));

    this.labSection.appendChild(grid);

    const preview = document.createElement('div');
    preview.className = 'mb-workshop-preview';
    this.workshopPreviewSummaryEl = document.createElement('div');
    this.workshopPreviewSummaryEl.className = 'mb-workshop-preview-summary';
    preview.appendChild(this.workshopPreviewSummaryEl);
    this.workshopStatsEl = document.createElement('div');
    this.workshopStatsEl.className = 'mb-workshop-stats';
    preview.appendChild(this.workshopStatsEl);
    this.labSection.appendChild(preview);

    const actions = document.createElement('div');
    actions.className = 'mb-workshop-actions';

    const forgeBtn = document.createElement('button');
    forgeBtn.className = 'mb-button';
    forgeBtn.textContent = 'Forge Custom Beast';
    forgeBtn.addEventListener('click', () => this.handleForgeWorkshop());
    actions.appendChild(forgeBtn);

    this.workshopStatusEl = document.createElement('div');
    this.workshopStatusEl.className = 'mb-workshop-status';
    actions.appendChild(this.workshopStatusEl);

    this.labSection.appendChild(actions);

    this.centerMetaEl = document.createElement('div');
    this.centerMetaEl.className = 'mb-center-meta';

    inner.appendChild(this.homeSection);
    inner.appendChild(this.labSection);
    inner.appendChild(this.centerMetaEl);

    panel.appendChild(inner);
    this.workshopArchetypeSelect.value = 'bipedal';
    this.workshopWeightSelect.value = 'middle';
    this.workshopBodySizeSelect.value = 'normal';
    this.workshopStabilitySelect.value = 'balanced';
    this.workshopLengthSelect.value = 'medium';
    this.workshopMassSelect.value = 'normal';
    this.workshopChargeStyleSelect.value = 'balanced';
    this.workshopColorSelect.value = 'crimson';
    this.updateWorkshopSelections();

    return panel;
  }

  private buildRightAndCenterLabel(): { panel: HTMLDivElement; centerSelectedLabel: HTMLDivElement } {
    const panel = document.createElement('div');
    panel.id = 'mb-home-right';
    panel.className = 'mb-panel';

    const yourHeader = document.createElement('h2');
    yourHeader.textContent = 'Your Beasts';
    panel.appendChild(yourHeader);

    const yourList = document.createElement('div');
    yourList.className = 'mb-beast-list';
    if (this.userBeasts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mb-empty';
      empty.textContent = 'no custom beasts yet — forge one in the quick workshop';
      yourList.appendChild(empty);
    } else {
      for (const b of this.userBeasts) {
        yourList.appendChild(this.buildBeastCard(b));
      }
    }
    panel.appendChild(yourList);

    const defaultsHeader = document.createElement('h3');
    defaultsHeader.textContent = '— Defaults —';
    panel.appendChild(defaultsHeader);

    const defaultsList = document.createElement('div');
    defaultsList.className = 'mb-beast-list';
    if (this.defaults.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mb-empty';
      empty.textContent = 'no default beasts registered';
      defaultsList.appendChild(empty);
    } else {
      for (const b of this.defaults) {
        defaultsList.appendChild(this.buildBeastCard(b));
      }
    }
    panel.appendChild(defaultsList);

    // The label in the center that reflects the selected beast — we build it
    // here so we can return it alongside the right panel.
    const centerSelectedLabel = document.createElement('div');
    centerSelectedLabel.className = 'mb-center-selected';
    centerSelectedLabel.textContent = '';
    this.centerMetaEl.replaceChildren(centerSelectedLabel);

    return { panel, centerSelectedLabel };
  }

  private buildBeastCard(b: BeastListing): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'mb-beast-card';
    card.dataset.beastId = b.id;

    const icon = document.createElement('div');
    icon.className = 'mb-beast-icon';
    if (b.iconEmoji) icon.textContent = b.iconEmoji;
    card.appendChild(icon);

    const meta = document.createElement('div');
    meta.className = 'mb-beast-meta';
    const name = document.createElement('div');
    name.className = 'mb-beast-name';
    name.textContent = b.name;
    const arche = document.createElement('div');
    arche.className = 'mb-beast-arche';
    arche.textContent = `${b.archetype} · ${b.weightClass}`;
    const profile = document.createElement('div');
    profile.className = 'mb-beast-profile';
    profile.textContent = `Primary: ${b.attackProfile}`;
    const summary = document.createElement('div');
    summary.className = 'mb-beast-summary';
    summary.textContent = b.playstyleSummary;
    meta.appendChild(name);
    meta.appendChild(arche);
    meta.appendChild(profile);
    meta.appendChild(summary);
    card.appendChild(meta);

    card.addEventListener('click', () => this.selectBeast(b.id));

    this.cardEls.set(b.id, card);
    return card;
  }

  private buildBottomBanner(): HTMLDivElement {
    const banner = document.createElement('div');
    banner.id = 'mb-home-bottom';
    banner.className = 'mb-panel';
    banner.style.cssText += 'flex-direction: row; align-items: center; justify-content: center; padding: 14px 18px;';

    const btn = document.createElement('button');
    btn.className = 'mb-button mb-disabled';
    btn.style.maxWidth = '480px';
    btn.textContent = 'DARWIN CERTIFICATION  —  COMING SOON';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      // still fire the intent so the shell/main.ts can decide what to do
      this.shell.emitOpenCertification();
    });
    banner.appendChild(btn);

    return banner;
  }

  private createWorkshopField(labelText: string, control: HTMLElement, spanTwo = false): HTMLDivElement {
    const field = document.createElement('div');
    field.className = `mb-workshop-field${spanTwo ? ' mb-span-2' : ''}`;
    const label = document.createElement('label');
    label.textContent = labelText;
    field.appendChild(label);
    field.appendChild(control);
    return field;
  }

  private updateWorkshopSelections(): void {
    if (!this.workshopArchetypeSelect || !this.workshopWeaponTypeSelect || !this.workshopWeaponSocketSelect) return;
    const archetype = this.workshopArchetypeSelect.value as Archetype;
    const currentType = this.workshopWeaponTypeSelect.value as AttackWeaponType;
    const supportedTypes = getWorkshopWeaponTypes(archetype);
    this.workshopWeaponTypeSelect.innerHTML = '';
    for (const weaponType of supportedTypes) {
      const option = document.createElement('option');
      option.value = weaponType;
      option.textContent = weaponType;
      this.workshopWeaponTypeSelect.appendChild(option);
    }
    this.workshopWeaponTypeSelect.value = supportedTypes.includes(currentType) ? currentType : supportedTypes[0]!;

    const currentSocket = this.workshopWeaponSocketSelect.value as AttackWeaponSocket;
    const supportedSockets = getWorkshopWeaponSockets(archetype, this.workshopWeaponTypeSelect.value as AttackWeaponType);
    this.workshopWeaponSocketSelect.innerHTML = '';
    for (const socket of supportedSockets) {
      const option = document.createElement('option');
      option.value = socket;
      option.textContent = socket.replace('_', ' ');
      this.workshopWeaponSocketSelect.appendChild(option);
    }
    this.workshopWeaponSocketSelect.value = supportedSockets.includes(currentSocket) ? currentSocket : supportedSockets[0]!;
    this.refreshWorkshopPreview();
  }

  private getWorkshopDraft(): WorkshopDraft {
    return {
      sourceBeastId: this.selectedBeastId,
      name: this.workshopNameInput.value,
      archetype: this.workshopArchetypeSelect.value as Archetype,
      weightClass: this.workshopWeightSelect.value as WeightClassHint,
      bodySize: this.workshopBodySizeSelect.value as BeastBodySize,
      stabilityBias: this.workshopStabilitySelect.value as BeastStabilityBias,
      weaponType: this.workshopWeaponTypeSelect.value as AttackWeaponType,
      weaponSocket: this.workshopWeaponSocketSelect.value as AttackWeaponSocket,
      weaponLength: this.workshopLengthSelect.value as BeastWeaponLength,
      weaponMass: this.workshopMassSelect.value as BeastWeaponMass,
      chargeStyle: this.workshopChargeStyleSelect.value as BeastChargeStyle,
      colorPreset: this.workshopColorSelect.value as WorkshopColorPreset,
    };
  }

  private refreshWorkshopPreview(): void {
    if (!this.workshopPreviewSummaryEl || !this.workshopStatsEl) return;
    const preview = getWorkshopPreview(this.getWorkshopDraft());
    this.workshopPreviewSummaryEl.textContent =
      `${preview.profile.toUpperCase()} PRIMARY. ${preview.playstyleSummary}`;
    this.renderWorkshopStats(preview.statSummary);
  }

  private renderWorkshopStats(stats: BeastStatSummary): void {
    const rows: Array<[label: string, value: number]> = [
      ['Speed', stats.speed],
      ['Stability', stats.stability],
      ['Reach', stats.reach],
      ['Damage', stats.damage],
      ['Stamina', stats.staminaEconomy],
      ['Control', 1 - stats.controlDifficulty],
    ];
    this.workshopStatsEl.innerHTML = '';
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'mb-workshop-stat-row';
      const valuePct = Math.round(Math.max(0, Math.min(1, value)) * 100);
      row.innerHTML = `
        <span>${label}</span>
        <span class="mb-workshop-stat-bar"><span class="mb-workshop-stat-fill" style="width:${valuePct}%"></span></span>
        <span>${valuePct}</span>
      `;
      this.workshopStatsEl.appendChild(row);
    }
  }

  private chooseDefaultColor(archetype: Archetype, weaponType: AttackWeaponType): WorkshopColorPreset {
    if (weaponType === 'spike') return 'peach';
    if (weaponType === 'shield') return 'tallow';
    if (weaponType === 'headbutt') return 'ember';
    return archetype === 'quadruped' ? 'ember' : 'crimson';
  }

  private syncWorkshopToListing(listing: BeastListing | undefined): void {
    if (!listing || !this.workshopNameInput) return;
    const inferredWeaponType =
      (listing.workshopConfig?.weaponType as AttackWeaponType | undefined) ??
      (
        listing.attackProfile === 'spike' ? 'spike' :
        listing.attackProfile === 'shield' ? 'shield' :
        listing.archetype === 'quadruped' ? 'headbutt' :
        'hammer'
      );
    const inferredSocket =
      (listing.workshopConfig?.weaponSocket as AttackWeaponSocket | undefined) ??
      (
        listing.archetype === 'bipedal'
          ? (inferredWeaponType === 'spike' ? 'left_arm' : 'right_arm')
          : (inferredWeaponType === 'shield' ? 'forebody' : 'head_front')
      );

    this.workshopNameInput.value = listing.isDefault ? `${listing.name} MkII` : listing.name;
    this.workshopArchetypeSelect.value = listing.archetype as Archetype;
    this.workshopWeightSelect.value =
      (listing.workshopConfig?.weightClass as WeightClassHint | undefined) ??
      (listing.weightClass as WeightClassHint) ??
      'middle';
    this.workshopBodySizeSelect.value =
      (listing.workshopConfig?.bodySize as BeastBodySize | undefined) ??
      (
        listing.weightClass === 'superheavy' || listing.weightClass === 'heavy'
          ? 'chonk'
          : listing.weightClass === 'light'
            ? 'small'
            : 'normal'
      );
    this.workshopStabilitySelect.value =
      (listing.workshopConfig?.stabilityBias as BeastStabilityBias | undefined) ??
      (listing.archetype === 'quadruped' ? 'stable' : 'balanced');
    this.workshopWeaponTypeSelect.value = inferredWeaponType;
    this.updateWorkshopSelections();
    this.workshopWeaponSocketSelect.value = inferredSocket;
    this.workshopLengthSelect.value =
      (listing.workshopConfig?.weaponLength as BeastWeaponLength | undefined) ?? 'medium';
    this.workshopMassSelect.value =
      (listing.workshopConfig?.weaponMass as BeastWeaponMass | undefined) ?? 'normal';
    this.workshopChargeStyleSelect.value =
      (listing.workshopConfig?.chargeStyle as BeastChargeStyle | undefined) ?? 'balanced';
    this.workshopColorSelect.value =
      (listing.workshopConfig?.colorPreset as WorkshopColorPreset | undefined) ??
      this.chooseDefaultColor(listing.archetype as Archetype, inferredWeaponType);
    this.refreshWorkshopPreview();
    this.workshopStatusEl.textContent = `loaded from ${listing.name}`;
  }

  private syncModeUi(): void {
    const inLab = this.screenMode === 'lab';
    this.homeSection.classList.toggle('mb-active', !inLab);
    this.labSection.classList.toggle('mb-active', inLab);
    this.root.dataset.mode = this.screenMode;
    this.refreshSelectedLabel();
  }

  private refreshSelectedLabel(): void {
    if (!this.centerSelectedLabel) return;
    const listing =
      this.defaults.find((b) => b.id === this.selectedBeastId) ??
      this.userBeasts.find((b) => b.id === this.selectedBeastId);
    if (!listing) {
      this.centerSelectedLabel.textContent = '';
      return;
    }

    this.centerSelectedLabel.textContent =
      this.screenMode === 'lab'
        ? `gene seed: ${listing.name.toUpperCase()}`
        : `selected beast: ${listing.name.toUpperCase()}`;
  }

  private handleForgeWorkshop(): void {
    if (!this.onCreateWorkshopBeast) {
      this.workshopStatusEl.textContent = 'workshop save unavailable';
      return;
    }
    const draft = this.getWorkshopDraft();
    const saved = this.onCreateWorkshopBeast(draft);
    if (!saved) {
      this.workshopStatusEl.textContent = 'forge failed';
      return;
    }
    this.userBeasts = [saved, ...this.userBeasts.filter((beast) => beast.id !== saved.id)];
    this.setUserBeasts(this.userBeasts);
    this.workshopStatusEl.textContent = `forged ${saved.name}`;
    this.selectBeast(saved.id);
  }

  // ---------- Behavior ----------

  private handleJoin() {
    const code = (this.codeInput.value || '').trim().toUpperCase();
    if (!code) {
      this.codeInput.focus();
      return;
    }
    if (!this.selectedBeastId) return;
    this.shell.emitStartMatch(this.selectedBeastId, 'join', code);
  }

  private handleHostMatch() {
    if (!this.selectedBeastId) return;
    this.shell.emitStartMatch(this.selectedBeastId, 'host');
  }

  private handleMakeMatch() {
    if (!this.selectedBeastId) return;
    this.shell.emitStartMatch(this.selectedBeastId, 'bot');
  }

  private selectBeast(id: string) {
    const listing =
      this.defaults.find((b) => b.id === id) ??
      this.userBeasts.find((b) => b.id === id);
    if (this.selectedBeastId === id) {
      this.syncWorkshopToListing(listing);
      return;
    }
    const prev = this.selectedBeastId ? this.cardEls.get(this.selectedBeastId) : undefined;
    if (prev) prev.classList.remove('mb-selected');
    this.selectedBeastId = id;
    const next = this.cardEls.get(id);
    if (next) next.classList.add('mb-selected');

    this.refreshSelectedLabel();
    this.syncWorkshopToListing(listing);
  }

  // ---------- Public API ----------

  /** Currently-selected beast id (or null if none). */
  getSelectedBeastId(): string | null {
    return this.selectedBeastId;
  }

  setMode(mode: HomeScreenMode) {
    this.screenMode = mode;
    this.syncModeUi();
  }

  setHomeStatus(message: string) {
    this.homeStatusEl.textContent = message;
  }

  /** Replace the list of user-created beasts and re-render the right column. */
  setUserBeasts(beasts: BeastListing[]) {
    this.userBeasts = beasts;
    // Simple re-render: wipe the right panel and rebuild it.
    const old = document.getElementById('mb-home-right');
    if (!old) return;
    this.cardEls.clear();
    const { panel, centerSelectedLabel } = this.buildRightAndCenterLabel();
    old.replaceWith(panel);
    this.centerSelectedLabel = centerSelectedLabel;
    // Re-apply selection highlight if still present.
    if (this.selectedBeastId) {
      const card = this.cardEls.get(this.selectedBeastId);
      if (card) card.classList.add('mb-selected');
      const listing =
        this.defaults.find((b) => b.id === this.selectedBeastId) ??
        this.userBeasts.find((b) => b.id === this.selectedBeastId);
      this.refreshSelectedLabel();
      this.syncWorkshopToListing(listing);
    }
  }

  // ---------- ScreenHandle ----------

  setVisible(visible: boolean) {
    this.root.style.display = visible ? 'grid' : 'none';
  }
}
