import type { Bands } from './bands';
import type { AudioSettings } from './settings';

/** A beat may only start a new look this long after the previous look change. */
export const BEAT_LOOK_MIN_MS = 6000;
/** The meters are re-rendered at most this often (about 10 per second). */
export const LEVEL_PUBLISH_MS = 100;

export interface BeatLookInput {
  beat: boolean;
  settings: AudioSettings;
  generatorOn: boolean;
  listening: boolean;
  now: number;
  changedAt: number;
}

/** Should this frame's beat start a new look? Pure. */
export function shouldBeatRandomize(i: BeatLookInput): boolean {
  if (!i.beat || !i.settings.beatLook || !i.generatorOn || !i.listening) return false;
  if (!Number.isFinite(i.now) || !Number.isFinite(i.changedAt)) return false;
  return i.now - i.changedAt >= BEAT_LOOK_MIN_MS;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** The user's sensitivity applied on top of the sensitivity-1 smoothed levels. */
export function scaleBySensitivity(l: Bands, sensitivity: number): Bands {
  const s = Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1;
  return {
    bass: clamp01(l.bass * s),
    mid: clamp01(l.mid * s),
    treble: clamp01(l.treble * s),
    volume: clamp01(l.volume * s),
  };
}

export interface LevelThrottle {
  due(nowMs: number): boolean;
  reset(): void;
}

/** Says true at most once per LEVEL_PUBLISH_MS. A clock that goes backwards re-opens the gate. */
export function createLevelThrottle(): LevelThrottle {
  let last = -Infinity;
  return {
    due(now) {
      if (now < last || now - last >= LEVEL_PUBLISH_MS) {
        last = now;
        return true;
      }
      return false;
    },
    reset() {
      last = -Infinity;
    },
  };
}
