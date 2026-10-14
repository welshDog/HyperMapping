import { isValidSurfaces } from '../surfaces/model';
import { MAX_SURFACES, type Surface } from '../surfaces/types';
import type { Vec2 } from '../warp/types';

export const CHANNEL = 'hypermapping';

export type Msg =
  | { type: 'hello' } // output window -> editor: "send me everything you have"
  | { type: 'surfaces'; surfaces: Surface[] } // editor -> output: the whole face list
  | { type: 'video'; blob: Blob }; // editor -> output (structured-clone copy)

const isVec2 = (v: unknown): v is Vec2 =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Rebuild one face from validated parts only; anything unexpected rejects the whole message. */
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

/** Validate anything that arrives on the channel; never trust the wire. */
export function parseMsg(data: unknown): Msg | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  switch (d.type) {
    case 'hello':
      return { type: 'hello' };
    case 'surfaces': {
      if (!Array.isArray(d.surfaces) || d.surfaces.length > MAX_SURFACES) return null;
      const out: Surface[] = [];
      for (const raw of d.surfaces) {
        const s = parseSurface(raw);
        if (!s) return null;
        out.push(s);
      }
      return isValidSurfaces(out) ? { type: 'surfaces', surfaces: out } : null;
    }
    case 'video':
      return d.blob instanceof Blob ? { type: 'video', blob: d.blob } : null;
    default:
      return null;
  }
}
