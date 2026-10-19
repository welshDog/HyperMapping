import { lookFromCode } from '../generator/look';
import type { StylePick } from '../generator/look';
import { FADE_MS, randomizeState, type GeneratorState } from '../generator/shuffle';

/** Randomize: cross-fades to a new look. A look is always on, so the clocks and time fields are kept. */
export function randomizeLook(state: GeneratorState, now: number, rng: () => number): GeneratorState {
  return randomizeState(state, now, rng);
}

export type ApplyCodeResult = { ok: true; state: GeneratorState } | { ok: false };

/** Use a typed look code: cross-fades from the old look. Never throws. */
export function applyCode(state: GeneratorState, text: string, now: number): ApplyCodeResult {
  let look = null;
  try {
    look = lookFromCode(text);
  } catch {
    look = null;
  }
  if (!look) return { ok: false };
  return { ok: true, state: { ...state, prev: state.look, look, changedAt: now } };
}

/**
 * Pick a style. A fixed style that differs from the current look cross-fades
 * to a random look of that style at once; otherwise only `stylePick` changes (Auto, same style).
 */
export function pickStyle(state: GeneratorState, pick: StylePick, now: number, rng: () => number): GeneratorState {
  const next = { ...state, stylePick: pick };
  if (pick === 'auto' || pick === state.look.style) return next;
  return randomizeState(next, now, rng);
}

/**
 * Change the auto-shuffle time. The shuffle clock restarts now (so it never fires at once), unless a
 * cross-fade is in progress, which keeps its `prev` and `changedAt`.
 */
export function setShuffle(state: GeneratorState, sec: GeneratorState['shuffleSec'], now: number): GeneratorState {
  if (sec === state.shuffleSec) return state;
  const fading = state.prev !== null && now - state.changedAt < FADE_MS;
  return fading ? { ...state, shuffleSec: sec } : { ...state, shuffleSec: sec, prev: null, changedAt: now };
}
