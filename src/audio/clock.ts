import { fadeLevels, stepAudioTime } from './motion';

export type AudioLevels = { bass: number; treble: number; vol: number };
export interface AudioFrame {
  pulse: number;
  treble: number;
  atime: number;
}

export interface AudioClock {
  /** Store the latest levels (each cleaned to 0..1; NaN/Infinity-free) with their arrival time. */
  setAudio(levels: AudioLevels, nowMs: number): void;
  /**
   * Advance one drawn frame: stale levels fade out (fadeLevels), loudness time advances by the gap
   * since the previous frame call (clamped by stepAudioTime). Zeros before any audio arrives.
   */
  frame(nowMs: number): AudioFrame;
  /** Forget the last frame time (drawing paused): the next frame adds no time. atime is kept. */
  idle(): void;
}

const clean = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function createAudioClock(): AudioClock {
  let levels: AudioLevels = { bass: 0, treble: 0, vol: 0 };
  let levelsAt = -Infinity; // nothing heard yet: infinitely stale, fades to zeros
  let motion = { smooth: 0, atime: 0 };
  let lastFrameAt: number | null = null;
  return {
    setAudio(next, nowMs) {
      levels = { bass: clean(next.bass), treble: clean(next.treble), vol: clean(next.vol) };
      levelsAt = nowMs;
    },
    frame(nowMs) {
      const lv = fadeLevels(levels, nowMs - levelsAt);
      const dt = lastFrameAt === null ? 0 : (nowMs - lastFrameAt) / 1000;
      lastFrameAt = nowMs;
      motion = stepAudioTime(motion, lv.vol, dt);
      return { pulse: lv.bass, treble: lv.treble, atime: motion.atime };
    },
    idle() {
      lastFrameAt = null;
    },
  };
}
