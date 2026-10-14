import { isValidQuad } from '../warp/quad';
import type { Corners, Vec2 } from '../warp/types';
import type { Surface } from './types';

export type CornerKey = 'tl' | 'tr' | 'br' | 'bl';
export const CORNER_KEYS: readonly CornerKey[] = ['tl', 'tr', 'br', 'bl'];

/** One pin: which face, which corner. */
export interface PinRef {
  surfaceId: string;
  corner: CornerKey;
}

/** Pins closer than this (unit space, per axis) count as sitting on the same spot, i.e. glued. */
export const GLUE_EPS = 1e-6;
/** A dragged pin snaps to a pin of another face within this many screen pixels. */
export const SNAP_RADIUS_PX = 24;

const same = (a: Vec2, b: Vec2, eps: number) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
const finite2 = (p: Vec2) => Number.isFinite(p[0]) && Number.isFinite(p[1]);

function pinPosition(surfaces: Surface[], ref: PinRef): Vec2 | null {
  const s = surfaces.find((x) => x.id === ref.surfaceId);
  return s ? s.corners[ref.corner] : null;
}

/** Every pin, on any face, that sits on the same spot as `ref` (including `ref`). Empty if `ref` is unknown. */
export function gluedGroup(surfaces: Surface[], ref: PinRef, eps = GLUE_EPS): PinRef[] {
  const at = pinPosition(surfaces, ref);
  if (!at) return [];
  const out: PinRef[] = [];
  for (const s of surfaces) {
    for (const corner of CORNER_KEYS) {
      if (same(s.corners[corner], at, eps)) out.push({ surfaceId: s.id, corner });
    }
  }
  return out;
}

/**
 * The pin of ANOTHER face that the pointer `p` is close enough to snap onto, or null.
 * Distance is measured in screen pixels (so a non-square canvas is not distorted). Faces that
 * already have a pin in the dragged group (including the dragged pin's own face) are never targets.
 */
export function snapTarget(
  surfaces: Surface[],
  ref: PinRef,
  p: Vec2,
  radiusPx: number,
  size: { w: number; h: number },
): Vec2 | null {
  if (!finite2(p)) return null;
  if (!(Number.isFinite(size.w) && Number.isFinite(size.h) && size.w > 0 && size.h > 0)) return null;
  if (!(radiusPx > 0)) return null;
  const group = gluedGroup(surfaces, ref);
  if (group.length === 0) return null;
  const involved = new Set(group.map((g) => g.surfaceId));
  involved.add(ref.surfaceId);
  let best: Vec2 | null = null;
  let bestDistance = Infinity;
  for (const s of surfaces) {
    if (involved.has(s.id)) continue;
    for (const corner of CORNER_KEYS) {
      const c = s.corners[corner];
      const d = Math.hypot((c[0] - p[0]) * size.w, (c[1] - p[1]) * size.h);
      if (d <= radiusPx && d < bestDistance) {
        bestDistance = d;
        best = c;
      }
    }
  }
  return best ? [best[0], best[1]] : null;
}

/**
 * Move every pin in `pins` to `to`, all or nothing: null if `to` is not finite, `pins` is empty
 * or unknown, or ANY affected face would no longer be a valid quad. Faces that are not affected
 * come back as the same objects. The input is never mutated.
 */
export function movePins(surfaces: Surface[], pins: PinRef[], to: Vec2): Surface[] | null {
  if (!finite2(to) || pins.length === 0) return null;
  const byFace = new Map<string, CornerKey[]>();
  for (const pin of pins) {
    if (!surfaces.some((s) => s.id === pin.surfaceId)) return null;
    const list = byFace.get(pin.surfaceId) ?? [];
    if (!list.includes(pin.corner)) list.push(pin.corner);
    byFace.set(pin.surfaceId, list);
  }
  const out: Surface[] = [];
  for (const s of surfaces) {
    const moved = byFace.get(s.id);
    if (!moved) {
      out.push(s);
      continue;
    }
    const corners: Corners = { tl: s.corners.tl, tr: s.corners.tr, br: s.corners.br, bl: s.corners.bl };
    for (const corner of moved) corners[corner] = [to[0], to[1]];
    if (!isValidQuad(corners)) return null;
    out.push({ ...s, corners });
  }
  return out;
}

/**
 * The one entry point used by the Editor when a pin is dragged to `p`.
 * Glue on: the whole glued group moves, and snaps onto a nearby pin of another face.
 * Glue off: only the dragged pin moves and nothing snaps.
 */
export function moveGluedPin(
  surfaces: Surface[],
  ref: PinRef,
  p: Vec2,
  opts: { glue: boolean; radiusPx: number; size: { w: number; h: number } },
): Surface[] | null {
  if (!opts.glue) return movePins(surfaces, [ref], p);
  const group = gluedGroup(surfaces, ref);
  if (group.length === 0) return null;
  const to = snapTarget(surfaces, ref, p, opts.radiusPx, opts.size) ?? p;
  return movePins(surfaces, group, to);
}
