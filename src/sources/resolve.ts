import { ownerOf } from '../surfaces/sources';
import { sourceOf, type Surface } from '../surfaces/types';

/** What one face actually shows right now. */
export type FaceSourceRef = { kind: 'video' } | { kind: 'pattern' } | { kind: 'look'; owner: string } | { kind: 'none' };

export interface ResolveContext {
  /** The test pattern is forced on every face. */
  patternForce: boolean;
  hasVideo: boolean;
  patternAvailable: boolean;
  /** Whether generators work: one answer for all looks, or a per-owner check (owner face id). */
  generatorAvailable: boolean | ((owner: string) => boolean);
}

const VIDEO: FaceSourceRef = { kind: 'video' };
const PATTERN: FaceSourceRef = { kind: 'pattern' };
const NONE: FaceSourceRef = { kind: 'none' };

const videoFirst = (c: ResolveContext): FaceSourceRef => (c.hasVideo ? VIDEO : c.patternAvailable ? PATTERN : NONE);
const patternFirst = (c: ResolveContext): FaceSourceRef => (c.patternAvailable ? PATTERN : c.hasVideo ? VIDEO : NONE);

/** One entry per face id: the source it shows, after fallbacks for whatever is unavailable. Pure. */
export function resolveFaceSources(list: Surface[], ctx: ResolveContext): Map<string, FaceSourceRef> {
  const out = new Map<string, FaceSourceRef>();
  const forced = ctx.patternForce && ctx.patternAvailable;
  for (const face of list) {
    if (forced) {
      out.set(face.id, PATTERN);
      continue;
    }
    switch (sourceOf(face)) {
      case 'pattern':
        out.set(face.id, patternFirst(ctx));
        break;
      case 'look': {
        const owner = ownerOf(list, face);
        const ga = ctx.generatorAvailable;
        const alive = owner !== null && (typeof ga === 'function' ? ga(owner.id) : ga);
        out.set(face.id, owner && alive ? { kind: 'look', owner: owner.id } : videoFirst(ctx));
        break;
      }
      default:
        out.set(face.id, videoFirst(ctx));
    }
  }
  return out;
}

/** The distinct look owners that at least one face is showing (sharers count once). */
export function visibleLookOwners(resolved: Map<string, FaceSourceRef>): Set<string> {
  const owners = new Set<string>();
  for (const ref of resolved.values()) if (ref.kind === 'look') owners.add(ref.owner);
  return owners;
}
