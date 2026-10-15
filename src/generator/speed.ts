import type { GeneratorState } from './shuffle';

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 2;

/** Clamp to [SPEED_MIN, SPEED_MAX]; NaN means "normal" (1). */
export function clampSpeed(x: number): number {
  if (Number.isNaN(x)) return 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, x));
}

/** Shader clock in seconds: the anchor plus time since the last speed change, at the current speed. */
export function shaderTime(
  s: Pick<GeneratorState, 'timeAnchor' | 'speedChangedAt' | 'speed'>,
  now: number,
): number {
  return s.timeAnchor + (Math.max(0, now - s.speedChangedAt) / 1000) * s.speed;
}

/** Change speed without the picture jumping: re-anchor the shader clock at `now`. */
export function setSpeed(state: GeneratorState, speed: number, now: number): GeneratorState {
  const next = clampSpeed(speed);
  if (next === state.speed) return state;
  return { ...state, timeAnchor: shaderTime(state, now), speedChangedAt: now, speed: next };
}
