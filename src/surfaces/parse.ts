import type { Vec2 } from '../warp/types';
import { isValidSurfaces } from './model';
import { parseLookSettings } from '../generator/settings';
import { normalizeSources } from './sources';
import { FACE_SHAPES, FACE_SOURCES, MAX_SURFACES, type FaceShape, type FaceSource, type Surface } from './types';

const isVec2 = (v: unknown): v is Vec2 =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Rebuild one face from validated parts only; anything unexpected rejects the whole list. */
function parseSurface(raw: unknown): Surface | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const c = s.corners as Record<string, unknown> | undefined;
  const r = s.srcRect as Record<string, unknown> | undefined;
  if (typeof s.id !== 'string' || !c || !r) return null;
  if (!(isVec2(c.tl) && isVec2(c.tr) && isVec2(c.br) && isVec2(c.bl))) return null;
  if (!(isNum(r.u0) && isNum(r.v0) && isNum(r.u1) && isNum(r.v1))) return null;
  if (s.shape !== undefined && !FACE_SHAPES.includes(s.shape as FaceShape)) return null;
  if (s.source !== undefined && !FACE_SOURCES.includes(s.source as FaceSource)) return null;
  if (s.lookOf !== undefined && (typeof s.lookOf !== 'string' || s.lookOf.length < 1 || s.lookOf.length > 32)) return null;
  const look = s.look === undefined ? undefined : parseLookSettings(s.look);
  if (s.look !== undefined && !look) return null;
  const face: Surface = {
    id: s.id,
    corners: { tl: [c.tl[0], c.tl[1]], tr: [c.tr[0], c.tr[1]], br: [c.br[0], c.br[1]], bl: [c.bl[0], c.bl[1]] },
    srcRect: { u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1 },
  };
  if (s.shape !== undefined && s.shape !== 'quad') face.shape = s.shape as FaceShape;
  if (s.source !== undefined && s.source !== 'video') face.source = s.source as FaceSource;
  if (look) face.look = look;
  if (typeof s.lookOf === 'string') face.lookOf = s.lookOf;
  return face;
}

/**
 * A whole face list from untrusted data (channel message, stored setup, imported file).
 * Rebuilt from validated fields only; null if anything is wrong.
 */
export function parseSurfaceList(raw: unknown): Surface[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SURFACES) return null;
  const out: Surface[] = [];
  for (const item of raw) {
    const s = parseSurface(item);
    if (!s) return null;
    out.push(s);
  }
  return isValidSurfaces(out) ? normalizeSources(out) : null;
}
