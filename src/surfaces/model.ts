import type { Corners } from '../warp/types';
import { FULL_RECT, MAX_SURFACES, MIN_SLICE, type SrcRect, type Surface } from './types';

const EPS = 1e-9;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const fin = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);

const rectsEqual = (a: SrcRect, b: SrcRect) =>
  Math.abs(a.u0 - b.u0) < EPS && Math.abs(a.v0 - b.v0) < EPS && Math.abs(a.u1 - b.u1) < EPS && Math.abs(a.v1 - b.v1) < EPS;

/** n equal vertical strips covering the full height of the video. */
export function defaultSlices(n: number): SrcRect[] {
  const count = Math.max(1, Math.floor(n));
  return Array.from({ length: count }, (_, i) => ({ u0: i / count, v0: 0, u1: (i + 1) / count, v1: 1 }));
}

/**
 * Starting pins for face `index` of `total`. A lone face is the big centred quad;
 * with several faces they start in a 3x2 grid so they do not sit on top of each other.
 */
export function defaultCorners(index: number, total = 1): Corners {
  if (total <= 1) return { tl: [0.2, 0.2], tr: [0.8, 0.2], br: [0.8, 0.8], bl: [0.2, 0.8] };
  const col = index % 3;
  const row = Math.floor(index / 3) % 2;
  const cw = 1 / 3;
  const ch = 1 / 2;
  const mx = cw * 0.12;
  const my = ch * 0.12;
  const x0 = col * cw + mx;
  const x1 = (col + 1) * cw - mx;
  const y0 = row * ch + my;
  const y1 = (row + 1) * ch - my;
  return { tl: [x0, y0], tr: [x1, y0], br: [x1, y1], bl: [x0, y1] };
}

function nextId(list: Surface[]): string {
  const used = new Set(list.map((s) => s.id));
  let n = 1;
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}

/**
 * Add a face (no-op at MAX_SURFACES). Faces still on their automatic slice are
 * re-balanced to the new count; slices the user customised are kept.
 */
export function addSurface(list: Surface[]): Surface[] {
  if (list.length >= MAX_SURFACES) return list;
  const oldN = list.length;
  const newN = oldN + 1;
  const oldDefaults = defaultSlices(oldN);
  const newDefaults = defaultSlices(newN);
  const rebalanced = list.map((s, i) => (rectsEqual(s.srcRect, oldDefaults[i]) ? { ...s, srcRect: newDefaults[i] } : s));
  return [...rebalanced, { id: nextId(list), corners: defaultCorners(oldN, newN), srcRect: newDefaults[oldN] }];
}

/** Remove a face. Never removes the last one; unknown ids are ignored. */
export function removeSurface(list: Surface[], id: string): Surface[] {
  if (list.length <= 1 || !list.some((s) => s.id === id)) return list;
  return list.filter((s) => s.id !== id);
}

/** Which face to select after `removedId` is removed from `listBefore`. */
export function selectAfterRemove(listBefore: Surface[], removedId: string): string {
  const idx = listBefore.findIndex((s) => s.id === removedId);
  const after = listBefore.filter((s) => s.id !== removedId);
  if (after.length === 0) return removedId;
  return after[Math.max(0, idx - 1)].id;
}

export function isValidSrcRect(r: SrcRect): boolean {
  const all = [r.u0, r.v0, r.u1, r.v1];
  if (!all.every(Number.isFinite)) return false;
  if (r.u0 < 0 || r.v0 < 0 || r.u1 > 1 || r.v1 > 1) return false;
  return r.u1 - r.u0 >= MIN_SLICE - EPS && r.v1 - r.v0 >= MIN_SLICE - EPS;
}

/** Slide a slice, keeping its size and staying inside the video. */
export function moveRect(r: SrcRect, du: number, dv: number): SrcRect {
  if (!isValidSrcRect(r)) return r;
  const w = r.u1 - r.u0;
  const h = r.v1 - r.v0;
  const u0 = clamp(r.u0 + fin(du, 0), 0, 1 - w);
  const v0 = clamp(r.v0 + fin(dv, 0), 0, 1 - h);
  return { u0, v0, u1: Math.min(1, u0 + w), v1: Math.min(1, v0 + h) };
}

export type RectCorner = 'tl' | 'tr' | 'br' | 'bl';

/** Drag one corner of a slice to (u, v); the opposite corner stays put. Never returns an invalid rect. */
export function resizeRect(r: SrcRect, corner: RectCorner, u: number, v: number): SrcRect {
  if (!isValidSrcRect(r)) return r;
  const movesLeft = corner === 'tl' || corner === 'bl';
  const movesTop = corner === 'tl' || corner === 'tr';
  let { u0, v0, u1, v1 } = r;
  if (movesLeft) u0 = clamp(fin(u, u0), 0, u1 - MIN_SLICE);
  else u1 = clamp(fin(u, u1), u0 + MIN_SLICE, 1);
  if (movesTop) v0 = clamp(fin(v, v0), 0, v1 - MIN_SLICE);
  else v1 = clamp(fin(v, v1), v0 + MIN_SLICE, 1);
  return { u0, v0, u1, v1 };
}

const isFiniteVec2 = (p: readonly number[]) => p.length === 2 && p.every(Number.isFinite);

/** Structural validity of a face list (does not require the quads to be convex; the renderer freezes bad quads). */
export function isValidSurfaces(list: Surface[]): boolean {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_SURFACES) return false;
  const ids = new Set<string>();
  for (const s of list) {
    if (typeof s.id !== 'string' || s.id.length < 1 || s.id.length > 32 || ids.has(s.id)) return false;
    ids.add(s.id);
    if (!isValidSrcRect(s.srcRect)) return false;
    const c = s.corners;
    if (!(isFiniteVec2(c.tl) && isFiniteVec2(c.tr) && isFiniteVec2(c.br) && isFiniteVec2(c.bl))) return false;
  }
  return true;
}

const PALETTE = ['#22d3ee', '#f472b6', '#a3e635', '#fb923c', '#a78bfa', '#facc15'];
export const surfaceColor = (index: number): string => PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];

export { FULL_RECT };
