import type { KeyValueStore } from '../setups/setups';
import { initialState, isValidState, type GeneratorState } from './shuffle';

export const GENERATOR_KEY = 'hypermapping.generator.v1';

/** Remember the look, the shuffle choice and the style pick. `on` is never remembered. Never throws. */
export function saveGeneratorState(store: KeyValueStore, state: GeneratorState): void {
  try {
    store.setItem(
      GENERATOR_KEY,
      JSON.stringify({ look: state.look, shuffleSec: state.shuffleSec, stylePick: state.stylePick }),
    );
  } catch {
    // storage full or blocked: forgetting is fine
  }
}

/** The remembered state with `on` false, or a fresh one when nothing usable is stored. Never throws. */
export function loadGeneratorState(store: KeyValueStore | null, now: number, rng: () => number): GeneratorState {
  const fresh = initialState(now, rng);
  if (!store) return fresh;
  try {
    const raw = store.getItem(GENERATOR_KEY);
    if (!raw) return fresh;
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof o !== 'object' || o === null) return fresh;
    const candidate = { ...fresh, look: o.look, shuffleSec: o.shuffleSec, stylePick: o.stylePick, on: false };
    return isValidState(candidate) ? candidate : fresh;
  } catch {
    return fresh;
  }
}
