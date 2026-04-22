interface ClipDef {
  start: number;
  duration: number;
}

interface SpriteDef {
  file: string;
  clips: ClipDef[];
  volume: number;
  pitchJitter?: number;
}

export type MusicContext = 'none' | 'menu' | 'battle' | 'lab';

export interface MusicTrackInfo {
  context: Exclude<MusicContext, 'none'>;
  file: string;
  title: string;
  artist: string;
  url: string;
  volume: number;
}

const TRAGIKOMIK_URL = 'https://youtube.com/@tragikomik';

const SOUND_SPRITES: Record<string, SpriteDef> = {
  hit_blunt: {
    file: '/sound/meaty_punch.mp3',
    clips: [{ start: 0, duration: 1.45 }],
    volume: 0.85,
    pitchJitter: 0.04,
  },
  hit_spike: {
    file: '/sound/meaty_punch.mp3',
    clips: [{ start: 0, duration: 1.3 }],
    volume: 0.82,
    pitchJitter: 0.05,
  },
  hit_shield: {
    file: '/sound/meaty_punch.mp3',
    clips: [{ start: 0, duration: 1.5 }],
    volume: 0.88,
    pitchJitter: 0.03,
  },
  hit_body: {
    file: '/sound/meaty_punch.mp3',
    clips: [{ start: 0, duration: 1.35 }],
    volume: 0.82,
    pitchJitter: 0.04,
  },
  jump: {
    file: '/sound/jump.mp3',
    clips: [
      { start: 0.0, duration: 0.15 },
      { start: 1.115, duration: 0.18 },
      { start: 2.111, duration: 0.18 },
      { start: 3.154, duration: 0.16 },
      { start: 4.153, duration: 0.16 },
    ],
    volume: 0.58,
    pitchJitter: 0.07,
  },
  land: {
    file: '/sound/land.mp3',
    clips: [{ start: 0, duration: 0.62 }],
    volume: 0.68,
    pitchJitter: 0.03,
  },
  miss: {
    file: '/sound/miss.mp3',
    clips: [
      { start: 0.063, duration: 0.379 },
      { start: 0.442, duration: 1.067 },
      { start: 1.509, duration: 0.474 },
      { start: 1.983, duration: 0.336 },
      { start: 2.319, duration: 0.375 },
      { start: 2.694, duration: 0.548 },
      { start: 3.242, duration: 0.5 },
      { start: 3.742, duration: 0.708 },
      { start: 4.45, duration: 0.625 },
      { start: 5.075, duration: 0.416 },
      { start: 5.491, duration: 0.596 },
      { start: 6.087, duration: 0.514 },
      { start: 6.601, duration: 0.294 },
      { start: 6.895, duration: 0.428 },
    ],
    volume: 0.54,
    pitchJitter: 0.06,
  },
};

const SOUND_ALIASES: Record<string, keyof typeof SOUND_SPRITES> = {
  combat_hit: 'hit_body',
};

const MUSIC_TRACKS: Record<Exclude<MusicContext, 'none'>, MusicTrackInfo[]> = {
  battle: [
    {
      context: 'battle',
      file: '/sound/battle_theme.mp3',
      title: 'Edgerunner',
      artist: 'Tragikomik',
      url: TRAGIKOMIK_URL,
      volume: 0.34,
    },
    {
      context: 'battle',
      file: '/sound/battle_theme_2.mp3',
      title: 'Catch me if you can',
      artist: 'Tragikomik',
      url: TRAGIKOMIK_URL,
      volume: 0.34,
    },
    {
      context: 'battle',
      file: '/sound/battle_theme_3.mp3',
      title: 'Octane Rumble',
      artist: 'Tragikomik',
      url: TRAGIKOMIK_URL,
      volume: 0.34,
    },
  ],
  menu: [
    {
      context: 'menu',
      file: '/sound/menu_theme.mp3',
      title: 'Endless Yellow Labyrinth',
      artist: 'Tragikomik',
      url: TRAGIKOMIK_URL,
      volume: 0.28,
    },
    {
      context: 'menu',
      file: '/sound/menu_theme_2.mp3',
      title: 'Grimey',
      artist: 'Tragikomik',
      url: TRAGIKOMIK_URL,
      volume: 0.28,
    },
    {
      context: 'menu',
      file: '/sound/menu_theme_3.mp3',
      title: 'After Infinity',
      artist: 'Tragikomik',
      url: TRAGIKOMIK_URL,
      volume: 0.28,
    },
  ],
  lab: [
    {
      context: 'lab',
      file: '/sound/lab_theme.mp3',
      title: 'CRISP(R/Y)',
      artist: 'Tragikomik',
      url: TRAGIKOMIK_URL,
      volume: 0.3,
    },
    {
      context: 'lab',
      file: '/sound/lab_theme_2.mp3',
      title: 'Splicer',
      artist: 'Tragikomik',
      url: TRAGIKOMIK_URL,
      volume: 0.3,
    },
    {
      context: 'lab',
      file: '/sound/lab_theme_3.mp3',
      title: 'The Incredible Machine',
      artist: 'Tragikomik',
      url: TRAGIKOMIK_URL,
      volume: 0.3,
    },
    {
      context: 'lab',
      file: '/sound/lab_theme_4.mp3',
      title: 'Electric Playdoh',
      artist: 'Tragikomik',
      url: TRAGIKOMIK_URL,
      volume: 0.3,
    },
  ],
};

export class AudioManager {
  private initialized = false;
  private initPromise?: Promise<void>;
  private context?: AudioContext;
  private masterGain?: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private volume = 1;
  private muted = false;
  private recentPlays: Array<{ name: string; at: number }> = [];
  private pendingPlays: Array<{ name: string; x?: number; y?: number; z?: number; queuedAt: number }> = [];
  private desiredMusicContext: MusicContext = 'none';
  private currentMusicContext: MusicContext = 'none';
  private currentTrack: MusicTrackInfo | null = null;
  private musicSource?: AudioBufferSourceNode;
  private musicGain?: GainNode;
  private musicAnalyser?: AnalyserNode;
  private musicAnalyserData?: Uint8Array<ArrayBuffer>;
  private musicToken = 0;
  private interactionArmed = false;

  constructor() {
    this.armInteractionInit();
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initInternal();
    return this.initPromise;
  }

  private async initInternal() {
    if (this.initialized) return;
    this.context = new AudioContext();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(this.context.destination);
    await this.context.resume();

    const files = Array.from(
      new Set([
        ...Object.values(SOUND_SPRITES).map((sprite) => sprite.file),
        ...Object.values(MUSIC_TRACKS).flat().map((track) => track.file),
      ])
    );
    await Promise.all(
      files.map(async (file) => {
        const response = await fetch(file);
        if (!response.ok) throw new Error(`Failed to load sound: ${file}`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await this.context!.decodeAudioData(arrayBuffer.slice(0));
        this.buffers.set(file, buffer);
      })
    );
    this.initialized = true;
    const pending = this.pendingPlays.splice(0);
    for (const play of pending) {
      if (performance.now() - play.queuedAt < 3000) {
        this.playSfx(play.name, play.x, play.y, play.z);
      }
    }
    this.syncDesiredMusicContext();
  }

  /** Play a sound effect at a world position */
  playSfx(name: string, x?: number, y?: number, z?: number) {
    const resolved = SOUND_SPRITES[name] ? name : SOUND_ALIASES[name];
    if (!resolved) return;
    const sprite = SOUND_SPRITES[resolved];
    if (!sprite) return;
    if (!this.context || !this.masterGain || !this.initialized) {
      this.pendingPlays.push({ name: resolved, x, y, z, queuedAt: performance.now() });
      return;
    }
    if (this.context.state === 'suspended') {
      void this.context.resume();
    }

    const buffer = this.buffers.get(sprite.file);
    if (!buffer) return;
    const clip = sprite.clips[Math.floor(Math.random() * sprite.clips.length)] ?? sprite.clips[0];
    if (!clip) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = (this.muted ? 0 : 1) * sprite.volume * this.volume;
    source.playbackRate.value =
      1 + ((Math.random() * 2 - 1) * (sprite.pitchJitter ?? 0));
    source.connect(gain);
    gain.connect(this.masterGain);
    source.start(0, clip.start, Math.max(0.04, clip.duration));

    this.recentPlays.push({ name: resolved, at: performance.now() });
    this.recentPlays = this.recentPlays.slice(-12);
    void x;
    void y;
    void z;
  }

  playCombatCue(kind: 'charge' | 'hit' | 'block', x?: number, y?: number, z?: number) {
    this.playSfx(`combat_${kind}`, x, y, z);
  }

  setMusicContext(context: MusicContext) {
    this.desiredMusicContext = context;
    this.syncDesiredMusicContext();
  }

  getCurrentMusicInfo(): MusicTrackInfo | null {
    return this.currentTrack;
  }

  getMusicWaveformBars(barCount: number = 12): number[] {
    if (!this.musicAnalyser || !this.currentTrack) return [];
    if (!this.musicAnalyserData || this.musicAnalyserData.length !== this.musicAnalyser.frequencyBinCount) {
      this.musicAnalyserData = new Uint8Array(this.musicAnalyser.frequencyBinCount);
    }
    this.musicAnalyser.getByteFrequencyData(this.musicAnalyserData);
    const bars: number[] = [];
    const usable = Math.max(1, Math.min(this.musicAnalyserData.length, barCount * 2));
    const step = Math.max(1, Math.floor(usable / barCount));
    for (let i = 0; i < barCount; i++) {
      const start = i * step;
      const end = Math.min(usable, start + step);
      let sum = 0;
      for (let j = start; j < end; j++) sum += this.musicAnalyserData[j] ?? 0;
      const avg = end > start ? sum / (end - start) : 0;
      bars.push(Math.max(0.08, Math.min(1, avg / 255)));
    }
    return bars;
  }

  /** Play background music */
  playMusic(track: string) {
    const allTracks = Object.values(MUSIC_TRACKS).flat();
    const match = allTracks.find((candidate) => candidate.title === track || candidate.file === track);
    if (match) {
      this.desiredMusicContext = match.context;
      if (this.initialized) {
        this.startMusicTrack(match);
      }
    }
  }

  stopMusic() {
    this.desiredMusicContext = 'none';
    this.currentMusicContext = 'none';
    this.currentTrack = null;
    this.musicToken += 1;
    this.stopCurrentMusicSource();
  }

  /** Play announcer voice clip */
  playAnnouncer(clip: string) {
    void clip;
  }

  /** Update listener position (call each frame) */
  updateListener(x: number, y: number, z: number) {
    void x;
    void y;
    void z;
  }

  getRecentPlays(): string[] {
    const cutoff = performance.now() - 2500;
    return this.recentPlays
      .filter((entry) => entry.at >= cutoff)
      .map((entry) => entry.name);
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
    }
  }

  mute() {
    this.muted = true;
    if (this.masterGain) this.masterGain.gain.value = 0;
  }

  unmute() {
    this.muted = false;
    if (this.masterGain) this.masterGain.gain.value = this.volume;
  }

  private armInteractionInit() {
    if (this.interactionArmed || typeof window === 'undefined') return;
    this.interactionArmed = true;
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
      void this.init().catch((err) => {
        console.warn('Audio unlock failed:', err);
      });
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  private syncDesiredMusicContext() {
    if (!this.initialized) return;
    if (this.desiredMusicContext === 'none') {
      this.stopMusic();
      return;
    }
    if (
      this.currentMusicContext === this.desiredMusicContext &&
      this.currentTrack &&
      this.musicSource
    ) {
      return;
    }
    this.playRandomTrackForContext(this.desiredMusicContext);
  }

  private playRandomTrackForContext(context: Exclude<MusicContext, 'none'>) {
    const candidates = MUSIC_TRACKS[context];
    if (!candidates || candidates.length === 0) return;
    const filtered =
      this.currentTrack && candidates.length > 1
        ? candidates.filter((track) => track.file !== this.currentTrack?.file)
        : candidates;
    const track = filtered[Math.floor(Math.random() * filtered.length)] ?? candidates[0];
    if (!track) return;
    this.startMusicTrack(track);
  }

  private startMusicTrack(track: MusicTrackInfo) {
    if (!this.context || !this.masterGain || !this.initialized) return;
    const buffer = this.buffers.get(track.file);
    if (!buffer) return;

    this.musicToken += 1;
    const token = this.musicToken;
    this.stopCurrentMusicSource();

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = (this.muted ? 0 : 1) * track.volume * this.volume;
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.85;

    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(this.masterGain);
    source.start(0);

    source.onended = () => {
      if (token !== this.musicToken) return;
      this.musicSource = undefined;
      this.musicGain = undefined;
      this.musicAnalyser = undefined;
      this.musicAnalyserData = undefined;
      if (this.desiredMusicContext === track.context) {
        this.playRandomTrackForContext(track.context);
      }
    };

    this.musicSource = source;
    this.musicGain = gain;
    this.musicAnalyser = analyser;
    this.musicAnalyserData = new Uint8Array(analyser.frequencyBinCount);
    this.currentTrack = track;
    this.currentMusicContext = track.context;
  }

  private stopCurrentMusicSource() {
    const source = this.musicSource;
    this.musicSource = undefined;
    this.musicGain = undefined;
    this.musicAnalyser = undefined;
    this.musicAnalyserData = undefined;
    if (!source) return;
    try {
      source.onended = null;
      source.stop();
    } catch {
      // Source may already be stopped.
    }
  }
}
