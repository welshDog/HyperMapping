import type { Vec2 } from '../warp/types';
import { isValidSurfaces } from './model';
import { MAX_SURFACES, type Surface } from './types';

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
  return {
    id: s.id,
    corners: { tl: c.tl, tr: c.tr, br: c.br, bl: c.bl },
    srcRect: { u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1 },
  };
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
  return isValidSurfaces(out) ? out : null;
}
