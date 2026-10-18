import type { Surface } from '../surfaces/types';
import { sourceOf } from '../surfaces/types';
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from '../audio/settings';
import { shouldBeatRandomize } from '../audio/reactor-logic';
import { shuffleDue, type GeneratorState } from './shuffle';
import { sameSettings, settingsFromState, stateFromSettings } from './settings';

/** Runtime state of each live look, keyed by the id of the face that owns it. */
export type LookStates = Record<string, GeneratorState>;

/** A face owns a look when its source is 'look', it has settings, and it is not sharing another's. */
export const ownsLook = (f: Surface): f is Surface & { look: NonNullable<Surface['look']> } =>
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

/** The visible looks (owner ids, in state order) that `due` says should get a new look now. Pure. */
function dueOwners(states: LookStates, visible: ReadonlySet<string>, due: (s: GeneratorState) => boolean): string[] {
  const out: string[] = [];
  for (const id of Object.keys(states)) if (visible.has(id) && due(states[id])) out.push(id);
  return out;
}

/** Visible looks whose auto-shuffle time has come. Hidden looks never shuffle. */
export const shuffleTargets = (states: LookStates, visible: ReadonlySet<string>, now: number): string[] =>
  dueOwners(states, visible, (s) => shuffleDue(s, now));

/** The reactor only reports a beat while listening with the "big beat" tick on, so that tick is on here. */
const BEAT_LOOK_ON: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS, beatLook: true };

/** On a beat: the visible looks past their own throttle (each look counts from its own `changedAt`). */
export const beatTargets = (states: LookStates, visible: ReadonlySet<string>, now: number): string[] =>
  dueOwners(states, visible, (s) =>
    shouldBeatRandomize({ beat: true, settings: BEAT_LOOK_ON, generatorOn: true, listening: true, now, changedAt: s.changedAt }),
  );

/**
 * When an owner leaves (deleted, or switched away) its first sharer becomes the owner of the same look
 * under its own id. `reconcileLooks` alone would restart that look from fresh clocks; this hands the
 * departed owner's state object to a new owner whose settings match, so the shared picture carries on.
 * Each departed state goes to at most one new owner. Returns `next` itself when nothing is carried.
 */
export function carryToHeirs(prev: LookStates, next: LookStates): LookStates {
  if (next === prev) return next;
  const departed = Object.keys(prev).filter((id) => !Object.hasOwn(next, id));
  if (departed.length === 0) return next;
  let out: LookStates | null = null;
  for (const id of Object.keys(next)) {
    if (Object.hasOwn(prev, id)) continue; // not a new owner
    const settings = settingsFromState(next[id]);
    const i = departed.findIndex((d) => sameSettings(settingsFromState(prev[d]), settings));
    if (i < 0) continue;
    out ??= { ...next };
    out[id] = prev[departed[i]];
    departed.splice(i, 1);
  }
  return out ?? next;
}
