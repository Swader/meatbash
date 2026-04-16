import type { MusicTrackInfo } from '../audio/audio-manager';

const STYLE_ID = 'meatbash-music-credit-style';

const STYLES = `
#mb-music-credit {
  position: absolute;
  right: 18px;
  bottom: 178px;
  z-index: 40;
  display: none;
  pointer-events: auto;
  font-family: 'Courier New', Courier, monospace;
}

#mb-music-credit .mb-music-card {
  background: rgba(20, 10, 10, 0.84);
  border: 1px solid rgba(255, 160, 100, 0.35);
  border-radius: 12px;
  padding: 10px 12px;
  min-width: 180px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.45);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

#mb-music-credit .mb-music-wave {
  display: flex;
  align-items: end;
  gap: 3px;
  height: 26px;
  margin-bottom: 8px;
  text-decoration: none;
}

#mb-music-credit .mb-music-bar {
  width: 6px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffd18b, #ff8c52);
  box-shadow: 0 0 8px rgba(255, 140, 82, 0.35);
  height: 8px;
  transition: height 0.08s linear, opacity 0.08s linear;
  opacity: 0.9;
}

#mb-music-credit .mb-music-label {
  display: block;
  color: #ffd7b0;
  text-decoration: none;
  font-size: 11px;
  letter-spacing: 0.8px;
  line-height: 1.35;
}

#mb-music-credit .mb-music-label:hover,
#mb-music-credit .mb-music-wave:hover {
  filter: brightness(1.08);
}
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export class MusicCreditWidget {
  private root: HTMLDivElement;
  private waveLink: HTMLAnchorElement;
  private labelLink: HTMLAnchorElement;
  private bars: HTMLDivElement[] = [];

  constructor() {
    injectStyles();
    const overlay = document.getElementById('ui-overlay');
    if (!overlay) {
      throw new Error('MusicCreditWidget: #ui-overlay not found');
    }

    this.root = document.createElement('div');
    this.root.id = 'mb-music-credit';

    const card = document.createElement('div');
    card.className = 'mb-music-card';

    const wave = document.createElement('a');
    wave.className = 'mb-music-wave';
    wave.target = '_blank';
    wave.rel = 'noreferrer';
    for (let i = 0; i < 12; i++) {
      const bar = document.createElement('div');
      bar.className = 'mb-music-bar';
      wave.appendChild(bar);
      this.bars.push(bar);
    }

    const label = document.createElement('a');
    label.className = 'mb-music-label';
    label.target = '_blank';
    label.rel = 'noreferrer';

    card.appendChild(wave);
    card.appendChild(label);
    this.root.appendChild(card);
    overlay.appendChild(this.root);

    this.waveLink = wave;
    this.labelLink = label;
  }

  update(info: MusicTrackInfo | null, levels: number[]) {
    if (!info) {
      this.root.style.display = 'none';
      return;
    }

    this.root.style.display = 'block';
    this.waveLink.href = info.url;
    this.labelLink.href = info.url;
    this.labelLink.textContent = `Tragikomik: ${info.title}`;

    for (let i = 0; i < this.bars.length; i++) {
      const level = levels[i] ?? 0.12;
      const bar = this.bars[i];
      bar.style.height = `${8 + level * 18}px`;
      bar.style.opacity = `${0.55 + level * 0.45}`;
    }
  }
}
