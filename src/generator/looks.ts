import type { Surface } from '../surfaces/types';
import { sourceOf } from '../surfaces/types';
import type { GeneratorState } from './shuffle';
import { sameSettings, settingsFromState, stateFromSettings } from './settings';

/** Runtime state of each live look, keyed by the id of the face that owns it. */
export type LookStates = Record<string, GeneratorState>;

/** A face owns a look when its source is 'look', it has settings, and it is not sharing another's. */
const ownsLook = (f: Surface): f is Surface & { look: NonNullable<Surface['look']> } =>
  sourceOf(f) === 'look' && f.lookOf === undefined && f.look !== undefined;

/** One state per look-owning face; unchanged settings keep their state object. Returns `prev` if nothing changed. */
export function reconcileLooks(prev: LookStates, list: Surface[], now: number): LookStates {
  const next: LookStates = {};
  let changed = false;
  for (const f of list) {
    if (!ownsLook(f)) continue;
    const old = prev[f.id];
    if (old && sameSettings(settingsFromState(old), f.look)) {
      next[f.id] = old;
    } else {
      next[f.id] = stateFromSettings(f.look, now);
      changed = true;
    }
  }
  if (!changed && Object.keys(prev).length === Object.keys(next).length) return prev;
  return next;
}

/** Write a state's saved part back into its owner face. Same array when nothing differs. */
export function withLookSettings(list: Surface[], ownerId: string, state: GeneratorState): Surface[] {
  const settings = settingsFromState(state);
  let changed = false;
  const out = list.map((f) => {
    if (f.id !== ownerId) return f;
    if (f.look && sameSettings(f.look, settings)) return f;
    changed = true;
    return { ...f, look: settings };
  });
  return changed ? out : list;
}
