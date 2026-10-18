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

/** A look that moves from a departed owner to the face that took it over. */
export interface LookHandover {
  from: string;
  to: string;
}

/**
 * Which looks changed owner between two face lists: for each owner in `prev` that no longer owns a look in
 * `next`, the first face (in `next` order) that SHARED it in `prev` and owns a look in `next`. Only a real
 * sharing link counts, never equal settings (a restored look must restart cleanly). Each id is used once.
 */
export function lookHandovers(prev: Surface[], next: Surface[]): LookHandover[] {
  const nextOwners = new Set(next.filter(ownsLook).map((f) => f.id));
  const used = new Set<string>();
  const out: LookHandover[] = [];
  for (const owner of prev) {
    if (!ownsLook(owner) || nextOwners.has(owner.id)) continue;
    const sharers = new Set(
      prev.filter((f) => f.id !== owner.id && sourceOf(f) === 'look' && f.look === undefined && f.lookOf === owner.id).map((f) => f.id),
    );
    const heir = next.find((f) => sharers.has(f.id) && nextOwners.has(f.id) && !used.has(f.id));
    if (!heir) continue;
    used.add(heir.id);
    out.push({ from: owner.id, to: heir.id });
  }
  return out;
}

/**
 * `reconcileLooks` alone restarts a taken-over look from fresh clocks under the heir's id; this gives the
 * heir the departed owner's state object instead, for each handover whose settings still match, so the
 * shared picture carries on. Returns `next` itself when nothing is carried.
 */
export function carryToHeirs(prev: LookStates, next: LookStates, handovers: readonly LookHandover[]): LookStates {
  let out: LookStates | null = null;
  for (const { from, to } of handovers) {
    if (!Object.hasOwn(prev, from) || !Object.hasOwn(next, to) || Object.hasOwn(prev, to)) continue;
    if (!sameSettings(settingsFromState(prev[from]), settingsFromState(next[to]))) continue;
    out ??= { ...next };
    out[to] = prev[from];
  }
  return out ?? next;
}
