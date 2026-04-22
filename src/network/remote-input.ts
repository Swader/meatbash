import type { InputSource } from '../combat/bot-ai';
import type { InputFrameMessage } from './protocol';

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
      let previousKeys = new Set(this.keysDown);
      let nextKeys = new Set(this.keysDown);
      for (const frame of this.pendingFrames) {
        nextKeys = new Set(frame.keys.map((key) => key.toUpperCase()));
        if (frame.edges) {
          for (const key of frame.edges.pressed) {
            this.pressedThisStep.add(key.toUpperCase());
          }
          for (const key of frame.edges.released) {
            this.releasedThisStep.add(key.toUpperCase());
          }
        } else {
          for (const key of nextKeys) {
            if (!previousKeys.has(key)) this.pressedThisStep.add(key);
          }
          for (const key of previousKeys) {
            if (!nextKeys.has(key)) this.releasedThisStep.add(key);
          }
        }
        previousKeys = nextKeys;
      }
      this.keysDown = nextKeys;
      this.pendingFrames.length = 0;
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
    return this.keysDown.has(key.toUpperCase());
  }

  justPressed(key: string): boolean {
    return this.pressedThisStep.has(key.toUpperCase());
  }

  justReleased(key: string): boolean {
    return this.releasedThisStep.has(key.toUpperCase());
  }

  getHeldKeys(): string[] {
    return [...this.keysDown];
  }
}
