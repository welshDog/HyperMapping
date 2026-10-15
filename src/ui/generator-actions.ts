import { lookFromCode } from '../generator/look';
import type { StylePick } from '../generator/look';
import { FADE_MS, randomizeState, type GeneratorState } from '../generator/shuffle';

/**
 * Switch the generator on or off. Switching ON starts both clocks at `now`: a remembered state's
 * changedAt is its load time, so without this an idle editor with auto-shuffle would shuffle at once.
 * Already on (or already off) returns the same object.
 */
export function setOn(state: GeneratorState, on: boolean, now: number): GeneratorState {
  if (state.on === on) return state;
  if (!on) return { ...state, on: false };
  return { ...state, on: true, startedAt: now, changedAt: now, prev: null };
}

/** Randomize: turns the generator on (fresh clocks if it was off) and cross-fades to a new look. */
export function randomizeOn(state: GeneratorState, now: number, rng: () => number): GeneratorState {
  return randomizeState(setOn(state, true, now), now, rng);
}

export type ApplyCodeResult = { ok: true; state: GeneratorState } | { ok: false };

/** Use a typed look code: cross-fades from the old look and turns the generator on. Never throws. */
export function applyCode(state: GeneratorState, text: string, now: number): ApplyCodeResult {
  let look = null;
  try {
    look = lookFromCode(text);
  } catch {
    look = null;
  }
  if (!look) return { ok: false };
  const on = setOn(state, true, now);
  return { ok: true, state: { ...on, prev: state.look, look, changedAt: now } };
}

/**
 * Pick a style. A fixed style that differs from the current look, with the generator on, cross-fades
 * to a random look of that style at once; otherwise only `stylePick` changes (Auto, same style, off).
 */
export function pickStyle(state: GeneratorState, pick: StylePick, now: number, rng: () => number): GeneratorState {
  const next = { ...state, stylePick: pick };
  if (pick === 'auto' || !state.on || pick === state.look.style) return next;
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
