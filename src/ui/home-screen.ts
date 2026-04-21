/**
 * Home screen — the first thing players see.
 *
 * Full-page HTML overlay rendered on top of the live Three.js arena
 * (the arena keeps rendering underneath so the glassmorphic panels
 * sit over a living, breathing scene).
 *
 * Layout:
 *   - Top: big pulsating MEATBASH title
 *   - Left sidebar: Join match (code input + button) + Make a match button
 *   - Center: "Make your beast" preview region (visual framing only —
 *     the real 3D preview happens in the Three.js scene behind us)
 *   - Right sidebar: beast list with "Your beasts" + "Defaults" sections
 *   - Bottom banner: Darwin Certification (coming soon)
 *
 * All styling is injected once into <head> via a <style> block.
 */

import type { AttackProfile } from '../combat/attack-types';
import type { Archetype } from '../beast/beast-data';
import {
  getWorkshopColorPresets,
  getWorkshopProfiles,
  type WorkshopChargeBias,
  type WorkshopColorPreset,
  type WorkshopDraft,
} from '../beast/workshop';
import type { GameShell, ScreenHandle } from './game-shell';

export interface BeastListing {
  id: string;
  name: string;
  archetype: string;
  attackProfile: string;
  weightClass: string;
  playstyleSummary: string;
  iconEmoji?: string;
  isDefault?: boolean;
}

export interface HomeScreenOptions {
  shell: GameShell;
  defaultBeasts: BeastListing[];
  userBeasts?: BeastListing[];
  onCreateWorkshopBeast?: (draft: WorkshopDraft) => BeastListing | null;
}

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
  grid-template-columns: 260px 1fr 280px;
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

#mb-home-left, #mb-home-right {
  overflow-y: auto;
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
  width: min(440px, 100%);
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
#mb-home-center .mb-center-selected {
  margin-top: 18px;
  font-size: 13px;
  letter-spacing: 2px;
  color: rgba(255, 200, 200, 0.8);
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

/* Scrollbar for side panels */
#mb-home-left::-webkit-scrollbar,
#mb-home-right::-webkit-scrollbar { width: 6px; }
#mb-home-left::-webkit-scrollbar-thumb,
#mb-home-right::-webkit-scrollbar-thumb {
  background: rgba(255, 80, 80, 0.3);
  border-radius: 3px;
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
  private selectedBeastId: string | null = null;
  private cardEls = new Map<string, HTMLDivElement>();
  private centerSelectedLabel: HTMLDivElement;
  private codeInput!: HTMLInputElement;
  private workshopNameInput!: HTMLInputElement;
  private workshopArchetypeSelect!: HTMLSelectElement;
  private workshopProfileSelect!: HTMLSelectElement;
  private workshopChargeSelect!: HTMLSelectElement;
  private workshopColorSelect!: HTMLSelectElement;
  private workshopStatusEl!: HTMLDivElement;

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

    // ---- Body: left | center | right ----
    const body = document.createElement('div');
    body.id = 'mb-home-body';

    body.appendChild(this.buildLeftPanel());
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

    // Register with the shell.
    this.shell.registerScreen('HOME', this);
  }

  // ---------- Builders ----------

  private buildLeftPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'mb-home-left';
    panel.className = 'mb-panel mb-stack';

    const joinHeader = document.createElement('h2');
    joinHeader.textContent = 'Join Match';
    panel.appendChild(joinHeader);

    this.codeInput = document.createElement('input');
    this.codeInput.type = 'text';
    this.codeInput.className = 'mb-input';
    this.codeInput.placeholder = 'MEAT-XXXX';
    this.codeInput.maxLength = 9;
    panel.appendChild(this.codeInput);

    const joinBtn = document.createElement('button');
    joinBtn.className = 'mb-button mb-secondary';
    joinBtn.textContent = 'Join';
    joinBtn.addEventListener('click', () => this.handleJoin());
    panel.appendChild(joinBtn);

    const separator = document.createElement('div');
    separator.style.cssText = 'height: 1px; background: rgba(255,80,80,0.2); margin: 16px 0;';
    panel.appendChild(separator);

    const makeHeader = document.createElement('h2');
    makeHeader.textContent = 'Make a Match';
    panel.appendChild(makeHeader);

    const makeBtn = document.createElement('button');
    makeBtn.className = 'mb-button';
    makeBtn.textContent = 'BASH!';
    makeBtn.addEventListener('click', () => this.handleMakeMatch());
    panel.appendChild(makeBtn);

    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top: 10px; font-size: 10px; letter-spacing: 1px; color: rgba(255,160,160,0.5); text-align: center;';
    hint.textContent = 'vs bot for now';
    panel.appendChild(hint);

    return panel;
  }

  private buildCenterPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'mb-home-center';

    const inner = document.createElement('div');
    inner.className = 'mb-center-inner';

    const label = document.createElement('div');
    label.className = 'mb-center-label';
    label.textContent = 'QUICK WORKSHOP';
    inner.appendChild(label);

    const soon = document.createElement('div');
    soon.className = 'mb-center-soon';
    soon.textContent = 'Fork the selected beast into a playable custom variant';
    inner.appendChild(soon);

    const note = document.createElement('div');
    note.className = 'mb-workshop-note';
    note.textContent =
      'Swap archetype, shift attack profile, bias charge feel, then forge a custom beast and throw it straight into the arena.';
    inner.appendChild(note);

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
    this.workshopArchetypeSelect.addEventListener('change', () => this.updateWorkshopProfileOptions());
    grid.appendChild(this.createWorkshopField('Archetype', this.workshopArchetypeSelect));

    this.workshopProfileSelect = document.createElement('select');
    this.workshopProfileSelect.className = 'mb-select';
    grid.appendChild(this.createWorkshopField('Primary Attack', this.workshopProfileSelect));

    this.workshopChargeSelect = document.createElement('select');
    this.workshopChargeSelect.className = 'mb-select';
    for (const bias of ['quick', 'balanced', 'heavy'] as const) {
      const option = document.createElement('option');
      option.value = bias;
      option.textContent = bias;
      this.workshopChargeSelect.appendChild(option);
    }
    grid.appendChild(this.createWorkshopField('Charge Bias', this.workshopChargeSelect));

    this.workshopColorSelect = document.createElement('select');
    this.workshopColorSelect.className = 'mb-select';
    for (const preset of getWorkshopColorPresets()) {
      const option = document.createElement('option');
      option.value = preset;
      option.textContent = preset;
      this.workshopColorSelect.appendChild(option);
    }
    grid.appendChild(this.createWorkshopField('Color', this.workshopColorSelect));

    inner.appendChild(grid);

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

    inner.appendChild(actions);

    panel.appendChild(inner);
    this.workshopArchetypeSelect.value = 'bipedal';
    this.workshopChargeSelect.value = 'balanced';
    this.workshopColorSelect.value = 'crimson';
    this.updateWorkshopProfileOptions();

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
      empty.textContent = 'no custom beasts yet — make some in the Gene Lab';
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
    // here so we can return it alongside the right panel; it will be appended
    // to the center panel later. Actually easier: append it into the center
    // panel directly via DOM traversal at the end.
    const centerSelectedLabel = document.createElement('div');
    centerSelectedLabel.className = 'mb-center-selected';
    centerSelectedLabel.textContent = '';
    // Defer attachment to center panel until construction finishes.
    queueMicrotask(() => {
      const centerInner = document.querySelector('#mb-home-center .mb-center-inner');
      if (centerInner) centerInner.appendChild(centerSelectedLabel);
    });

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

  private updateWorkshopProfileOptions(): void {
    if (!this.workshopArchetypeSelect || !this.workshopProfileSelect) return;
    const archetype = this.workshopArchetypeSelect.value as Archetype;
    const current = this.workshopProfileSelect.value as AttackProfile;
    const supported = getWorkshopProfiles(archetype);
    this.workshopProfileSelect.innerHTML = '';
    for (const profile of supported) {
      const option = document.createElement('option');
      option.value = profile;
      option.textContent = profile;
      this.workshopProfileSelect.appendChild(option);
    }
    this.workshopProfileSelect.value = supported.includes(current) ? current : supported[0]!;
  }

  private chooseDefaultColor(archetype: Archetype, attackProfile: string): WorkshopColorPreset {
    if (attackProfile === 'spike') return 'peach';
    if (attackProfile === 'shield') return 'tallow';
    return archetype === 'quadruped' ? 'ember' : 'crimson';
  }

  private syncWorkshopToListing(listing: BeastListing | undefined): void {
    if (!listing || !this.workshopNameInput) return;
    this.workshopNameInput.value = listing.isDefault ? `${listing.name} MkII` : listing.name;
    this.workshopArchetypeSelect.value = listing.archetype as Archetype;
    this.updateWorkshopProfileOptions();
    this.workshopProfileSelect.value = getWorkshopProfiles(listing.archetype as Archetype).includes(listing.attackProfile as AttackProfile)
      ? listing.attackProfile
      : getWorkshopProfiles(listing.archetype as Archetype)[0]!;
    this.workshopChargeSelect.value = 'balanced';
    this.workshopColorSelect.value = this.chooseDefaultColor(listing.archetype as Archetype, listing.attackProfile);
    this.workshopStatusEl.textContent = `loaded from ${listing.name}`;
  }

  private handleForgeWorkshop(): void {
    if (!this.onCreateWorkshopBeast) {
      this.workshopStatusEl.textContent = 'workshop save unavailable';
      return;
    }
    const draft: WorkshopDraft = {
      sourceBeastId: this.selectedBeastId,
      name: this.workshopNameInput.value,
      archetype: this.workshopArchetypeSelect.value as Archetype,
      attackProfile: this.workshopProfileSelect.value as AttackProfile,
      chargeBias: this.workshopChargeSelect.value as WorkshopChargeBias,
      colorPreset: this.workshopColorSelect.value as WorkshopColorPreset,
    };
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

  private handleMakeMatch() {
    if (!this.selectedBeastId) return;
    // Block 1 scope: always vs bot. Multiplayer host flow comes later.
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

    if (this.centerSelectedLabel) {
      this.centerSelectedLabel.textContent = listing
        ? `selected: ${listing.name.toUpperCase()}`
        : '';
    }
    this.syncWorkshopToListing(listing);
  }

  // ---------- Public API ----------

  /** Currently-selected beast id (or null if none). */
  getSelectedBeastId(): string | null {
    return this.selectedBeastId;
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
      this.syncWorkshopToListing(listing);
    }
  }

  // ---------- ScreenHandle ----------

  setVisible(visible: boolean) {
    this.root.style.display = visible ? 'grid' : 'none';
  }
}
