import type { Bands } from './bands';

export const PEAK_DECAY = 0.995;
export const PEAK_FLOOR = 0.08;
export const NOISE_GATE = 0.04;
export const ATTACK = 0.6;
export const RELEASE = 0.12;

export interface LevelTracker {
  update(raw: Bands, sensitivity?: number): Bands;
  reset(): void;
}

const KEYS = ['bass', 'mid', 'treble', 'volume'] as const;

function clean(x: number): number {
  return Number.isFinite(x) && x > 0 ? x : 0;
}
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Adaptive per-band gain with a noise gate and an attack/release envelope. */
export function createLevelTracker(): LevelTracker {
  const peak: Bands = { bass: 0, mid: 0, treble: 0, volume: 0 };
  const smooth: Bands = { bass: 0, mid: 0, treble: 0, volume: 0 };
  return {
    update(raw, sensitivity = 1) {
      const sens = Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1;
      const gated = clean(raw.volume) < NOISE_GATE;
      for (const k of KEYS) {
        const r = clean(raw[k]);
        let target = 0;
        if (!gated) {
          peak[k] = Math.max(r, peak[k] * PEAK_DECAY);
          target = clamp01((r / Math.max(peak[k], PEAK_FLOOR)) * sens);
        }
        smooth[k] += (target - smooth[k]) * (target > smooth[k] ? ATTACK : RELEASE);
        smooth[k] = clamp01(smooth[k]);
      }
      return { ...smooth };
    },
    reset() {
      for (const k of KEYS) {
        peak[k] = 0;
        smooth[k] = 0;
      }
    },
  };
}
