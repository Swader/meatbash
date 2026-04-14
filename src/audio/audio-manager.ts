/**
 * Audio manager stub.
 * All methods are no-ops. Wire up actual audio post-jam.
 * Architecture supports spatial audio, music, and announcer voice.
 */
export class AudioManager {
  private initialized = false;

  async init() {
    // Future: create AudioContext, load sound banks
    this.initialized = true;
  }

  /** Play a sound effect at a world position */
  playSfx(name: string, x?: number, y?: number, z?: number) {
    // Future: spatial audio for impacts, squelches, bone cracks
  }

  /** Play background music */
  playMusic(track: string) {
    // Future: silly circus/wrestling music
  }

  stopMusic() {}

  /** Play announcer voice clip */
  playAnnouncer(clip: string) {
    // Future: "ROUND ONE... FIGHT!", "DEVASTATING!", etc.
  }

  /** Update listener position (call each frame) */
  updateListener(x: number, y: number, z: number) {}

  setVolume(volume: number) {}
  mute() {}
  unmute() {}
}
