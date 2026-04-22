import type { HostSnapshotMessage, SerializedBeastState } from './protocol';

interface TimedSnapshot {
  receivedAt: number;
  snapshot: HostSnapshotMessage;
}

export class SnapshotInterpolator {
  private previous: TimedSnapshot | null = null;
  private current: TimedSnapshot | null = null;

  reset(): void {
    this.previous = null;
    this.current = null;
  }

  push(snapshot: HostSnapshotMessage): void {
    this.previous = this.current;
    this.current = {
      snapshot,
      receivedAt: performance.now(),
    };
  }

  sample(): { previous: HostSnapshotMessage | null; current: HostSnapshotMessage | null; alpha: number } {
    if (!this.current) {
      return { previous: null, current: null, alpha: 1 };
    }
    if (!this.previous) {
      return { previous: null, current: this.current.snapshot, alpha: 1 };
    }
    const span = Math.max(16, this.current.receivedAt - this.previous.receivedAt);
    const alpha = Math.max(0, Math.min(1, (performance.now() - this.current.receivedAt + 100) / span));
    return {
      previous: this.previous.snapshot,
      current: this.current.snapshot,
      alpha,
    };
  }

  isCurrentFresh(maxAgeMs: number): boolean {
    if (!this.current) return false;
    return performance.now() - this.current.receivedAt <= maxAgeMs;
  }
}

export function interpolateBeastState(
  previous: SerializedBeastState | null,
  current: SerializedBeastState,
  alpha: number
): SerializedBeastState {
  if (!previous) return current;
  const previousByName = new Map(previous.segments.map((segment) => [segment.name, segment]));
  return {
    ...current,
    stamina: lerp(previous.stamina, current.stamina, alpha),
    mass: lerp(previous.mass, current.mass, alpha),
    attack: current.attack,
    segments: current.segments.map((segment) => {
      const prev = previousByName.get(segment.name);
      if (!prev) return segment;
      return {
        ...segment,
        pos: [
          lerp(prev.pos[0], segment.pos[0], alpha),
          lerp(prev.pos[1], segment.pos[1], alpha),
          lerp(prev.pos[2], segment.pos[2], alpha),
        ],
        rot: normalizeQuat([
          lerp(prev.rot[0], segment.rot[0], alpha),
          lerp(prev.rot[1], segment.rot[1], alpha),
          lerp(prev.rot[2], segment.rot[2], alpha),
          lerp(prev.rot[3], segment.rot[3], alpha),
        ]),
      };
    }),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function normalizeQuat(value: [number, number, number, number]): [number, number, number, number] {
  const len = Math.hypot(value[0], value[1], value[2], value[3]) || 1;
  return [value[0] / len, value[1] / len, value[2] / len, value[3] / len];
}
