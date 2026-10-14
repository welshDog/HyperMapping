import type { Corners, Vec2 } from '../warp/types';

export const CHANNEL = 'hypermapping';

export type Msg =
  | { type: 'hello' } // output window -> editor: "send me everything you have"
  | { type: 'state'; corners: Corners } // editor -> output
  | { type: 'video'; blob: Blob }; // editor -> output (structured-clone copy)

const isVec2 = (v: unknown): v is Vec2 =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Validate anything that arrives on the channel; never trust the wire. */
export function parseMsg(data: unknown): Msg | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  switch (d.type) {
    case 'hello':
      return { type: 'hello' };
    case 'state': {
      const c = d.corners as Record<string, unknown> | undefined;
      if (c && isVec2(c.tl) && isVec2(c.tr) && isVec2(c.br) && isVec2(c.bl)) {
        return { type: 'state', corners: { tl: c.tl, tr: c.tr, br: c.br, bl: c.bl } };
      }
      return null;
    }
    case 'video':
      return d.blob instanceof Blob ? { type: 'video', blob: d.blob } : null;
    default:
      return null;
  }
}
