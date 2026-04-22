import type { InputSource } from '../combat/bot-ai';
import type { InputFrameMessage } from './protocol';

function normalizeKey(key: string): string {
  return key === 'SPACE' ? ' ' : key.toUpperCase();
}

export class RemoteInputBuffer implements InputSource {
  private keysDown = new Set<string>();
  private pressedThisStep = new Set<string>();
  private releasedThisStep = new Set<string>();
  private pendingFrames: InputFrameMessage[] = [];
  private lastPacketAt = 0;

  applyFrame(frame: InputFrameMessage): void {
    this.pendingFrames.push(frame);
    if (this.pendingFrames.length > 8) {
      this.pendingFrames.splice(0, this.pendingFrames.length - 8);
    }
    this.lastPacketAt = performance.now();
  }

  beginFixedStep(): void {
    this.pressedThisStep.clear();
    this.releasedThisStep.clear();

    if (this.pendingFrames.length > 0) {
      const frame = this.pendingFrames.shift()!;
      const previousKeys = new Set(this.keysDown);
      const nextKeys = new Set(frame.keys.map(normalizeKey));
      if (frame.edges) {
        for (const key of frame.edges.pressed) {
          this.pressedThisStep.add(normalizeKey(key));
        }
        for (const key of frame.edges.released) {
          this.releasedThisStep.add(normalizeKey(key));
        }
      } else {
        for (const key of nextKeys) {
          if (!previousKeys.has(key)) this.pressedThisStep.add(key);
        }
        for (const key of previousKeys) {
          if (!nextKeys.has(key)) this.releasedThisStep.add(key);
        }
      }
      this.keysDown = nextKeys;
      return;
    }

    if (this.keysDown.size > 0 && performance.now() - this.lastPacketAt > 250) {
      for (const key of this.keysDown) {
        this.releasedThisStep.add(key);
      }
      this.keysDown.clear();
    }
  }

  endFrame(): void {}

  isDown(key: string): boolean {
    const normalized = normalizeKey(key);
    return this.keysDown.has(normalized) || this.pressedThisStep.has(normalized);
  }

  justPressed(key: string): boolean {
    return this.pressedThisStep.has(normalizeKey(key));
  }

  justReleased(key: string): boolean {
    return this.releasedThisStep.has(normalizeKey(key));
  }

  getHeldKeys(): string[] {
    return [...new Set([...this.keysDown, ...this.pressedThisStep])];
  }
}
