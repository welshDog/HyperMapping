export const BEAT_RATIO = 1.5;
export const BEAT_MIN_LEVEL = 0.3;
export const MIN_BEAT_GAP_MS = 250;
export const BEAT_WINDOW = 30;

export interface BeatDetector {
  update(smoothedBass: number, nowMs: number): boolean;
  reset(): void;
}

/** Fires when the bass jumps well above its recent mean. No beat until the window is full. */
export function createBeatDetector(): BeatDetector {
  const ring = new Array<number>(BEAT_WINDOW).fill(0);
  let head = 0;
  let filled = 0;
  let sum = 0;
  let lastBeat = -Infinity;
  return {
    update(bass, now) {
      const v = Number.isFinite(bass) && bass > 0 ? bass : 0;
      const mean = filled === 0 ? 0 : sum / filled;
      const warm = filled >= BEAT_WINDOW;
      const fire = warm && v > mean * BEAT_RATIO && v > BEAT_MIN_LEVEL && now - lastBeat >= MIN_BEAT_GAP_MS;
      sum += v - ring[head];
      ring[head] = v;
      head = (head + 1) % BEAT_WINDOW;
      if (filled < BEAT_WINDOW) filled++;
      if (fire) lastBeat = now;
      return fire;
    },
    reset() {
      ring.fill(0);
      head = 0;
      filled = 0;
      sum = 0;
      lastBeat = -Infinity;
    },
  };
}
