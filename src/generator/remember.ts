import type { KeyValueStore } from '../setups/setups';
import { SPEED_MAX, SPEED_MIN } from './speed';
import { initialState, isValidState, type GeneratorState } from './shuffle';

export const GENERATOR_KEY = 'hypermapping.generator.v1';

/** Remember the look, the shuffle choice, the style pick and the speed. `on` is never remembered. Never throws. */
export function saveGeneratorState(store: KeyValueStore, state: GeneratorState): void {
  try {
    store.setItem(
      GENERATOR_KEY,
      JSON.stringify({ look: state.look, shuffleSec: state.shuffleSec, stylePick: state.stylePick, speed: state.speed }),
    );
  } catch {
    // storage full or blocked: forgetting is fine
  }
}

/** Rebuild a stored look as exactly { style, seed } so extra keys never survive. */
function cleanLook(x: unknown): unknown {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return x;
  const o = x as Record<string, unknown>;
  return { style: o.style, seed: o.seed };
}

function isValidSpeed(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= SPEED_MIN && x <= SPEED_MAX;
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
    const candidate = { ...fresh, look: cleanLook(o.look), shuffleSec: o.shuffleSec, stylePick: o.stylePick, on: false };
    if (!isValidSpeed(o.speed)) candidate.speed = 1;
    else candidate.speed = o.speed;
    return isValidState(candidate) ? candidate : fresh;
  } catch {
    return fresh;
  }
}
