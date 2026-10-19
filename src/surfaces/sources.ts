import { DEFAULT_LOOK_SETTINGS, sameSettings, type LookSettings } from '../generator/settings';
import { ownsLook } from '../generator/looks';
import { sourceOf, type FaceSource, type Surface } from './types';

/** At most this many distinct live looks; faces sharing a look count once. */
export const MAX_LOOKS = 4;

/** Faces that own a look (source 'look', own settings, not sharing), in list order. */
export const lookOwners = (list: Surface[]): Surface[] => list.filter((f) => ownsLook(f));

/** The face itself if it owns a look, else the owner its `lookOf` points at, else null. */
export function ownerOf(list: Surface[], face: Surface): Surface | null {
  if (ownsLook(face)) return face;
  if (sourceOf(face) !== 'look' || face.lookOf === undefined) return null;
  const target = list.find((f) => f.id === face.lookOf);
  return target && target.id !== face.id && ownsLook(target) ? target : null;
}

export const canStartLook = (list: Surface[]): boolean => lookOwners(list).length < MAX_LOOKS;

/** Same face without any source/look keys (a plain Video face). */
function toVideo(f: Surface): Surface {
  const { source: _s, look: _l, lookOf: _o, ...rest } = f;
  return rest;
}

function toPattern(f: Surface): Surface {
  const { look: _l, lookOf: _o, ...rest } = f;
  return { ...rest, source: 'pattern' };
}

function toOwner(f: Surface, look: LookSettings): Surface {
  const { lookOf: _o, ...rest } = f;
  return { ...rest, source: 'look', look };
}

/** True when the face already has exactly the keys its source allows. */
function isClean(f: Surface): boolean {
  switch (f.source) {
    case undefined:
      return f.look === undefined && f.lookOf === undefined;
    case 'video':
      return false; // a Video face never carries a source key
    case 'pattern':
      return f.look === undefined && f.lookOf === undefined;
    default:
      return (f.look !== undefined) !== (f.lookOf !== undefined);
  }
}

/**
 * The one repair function for every face list that comes in. Rules: Video/Pattern faces carry no look
 * fields (Video no `source` key either); a face with both `look` and `lookOf` keeps `look`; only the first
 * MAX_LOOKS owners (list order) keep their look, later ones become Video; a sharer whose link is missing,
 * to itself, or to a non-owner (including a demoted owner) is repaired to an own DEFAULT_LOOK_SETTINGS look
 * while a look slot is free, otherwise to Video. Idempotent; the same array comes back when nothing changed.
 */
export function normalizeSources(list: Surface[]): Surface[] {
  // Pass 1: strip fields a face's source does not allow; a 'look' face with neither field is a repaired sharer.
  const kept = new Set<string>();
  let owners = 0;
  const pass1 = list.map((f) => {
    if (sourceOf(f) === 'video') return isClean(f) ? f : toVideo(f);
    if (f.source === 'pattern') return isClean(f) ? f : toPattern(f);
    if (f.look !== undefined) {
      if (owners >= MAX_LOOKS) return toVideo(f);
      owners++;
      kept.add(f.id);
      return f.lookOf === undefined ? f : toOwner(f, f.look);
    }
    return f; // sharer (or broken): decided in pass 2
  });
  // Pass 2: sharers must point at a kept owner; otherwise own default look if a slot is free.
  let changed = pass1.some((f, i) => f !== list[i]);
  const out = pass1.map((f) => {
    if (f.source !== 'look' || f.look !== undefined) return f;
    if (f.lookOf !== undefined && f.lookOf !== f.id && kept.has(f.lookOf)) return f;
    changed = true;
    if (owners >= MAX_LOOKS) return toVideo(f);
    owners++;
    return toOwner(f, DEFAULT_LOOK_SETTINGS);
  });
  return changed || out.some((f, i) => f !== list[i]) ? out : list;
}

/**
 * If `ownerId` owns a look others share, the first sharer (list order) becomes the owner with that same
 * look and the other sharers re-point to it. Returns the list unchanged when there is nothing to promote.
 */
function promoteSharers(list: Surface[], ownerId: string): Surface[] {
  const owner = list.find((f) => f.id === ownerId);
  if (!owner || !ownsLook(owner)) return list;
  const sharers = list.filter((f) => f.id !== ownerId && sourceOf(f) === 'look' && f.lookOf === ownerId && f.look === undefined);
  if (sharers.length === 0) return list;
  const heir = sharers[0].id;
  return list.map((f) => {
    if (f.id === heir) return toOwner(f, owner.look);
    if (sharers.includes(f)) return { ...f, lookOf: heir };
    return f;
  });
}

/** Give a removed owner's look to its first sharer (see promoteSharers). Used by removeSurface. */
export const promoteBeforeRemove = promoteSharers;

/** Switch one face's source. See the module rules; refusals return the very same list. */
export function setFaceSource(list: Surface[], id: string, source: FaceSource, makeLook: () => LookSettings): Surface[] {
  const face = list.find((f) => f.id === id);
  if (!face) return list;
  if (source === 'look') {
    if (ownsLook(face)) return list;
    if (!canStartLook(list)) return list;
    return list.map((f) => (f.id === id ? toOwner(f, makeLook()) : f));
  }
  if (source === 'video' && face.source === undefined && face.look === undefined && face.lookOf === undefined) return list;
  if (source === 'pattern' && isClean(face) && face.source === 'pattern') return list;
  const promoted = promoteSharers(list, id);
  return promoted.map((f) => (f.id === id ? (source === 'video' ? toVideo(f) : toPattern(f)) : f));
}

/** Make a face show another face's look. Only a different look owner is a valid target. */
export function shareLook(list: Surface[], id: string, ownerId: string): Surface[] {
  const face = list.find((f) => f.id === id);
  const target = list.find((f) => f.id === ownerId);
  if (!face || !target || id === ownerId || !ownsLook(target)) return list;
  if (sourceOf(face) === 'look' && face.lookOf === ownerId) return list;
  const promoted = promoteSharers(list, id);
  return promoted.map((f) => {
    if (f.id !== id) return f;
    const { look: _l, ...rest } = f;
    return { ...rest, source: 'look', lookOf: ownerId };
  });
}

/** Write settings into an owner face's own look. Non-owners and unchanged settings return the same list. */
export function setOwnLook(list: Surface[], id: string, settings: LookSettings): Surface[] {
  const face = list.find((f) => f.id === id);
  if (!face || !ownsLook(face) || sameSettings(face.look, settings)) return list;
  return list.map((f) => (f.id === id ? { ...f, look: settings } : f));
}
