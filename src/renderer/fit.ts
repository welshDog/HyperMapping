const MAX_PX = 4096;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Canvas backing-store size for a CSS box, device pixel ratio, and quality scale. */
export function computeBackingSize(cssW: number, cssH: number, dpr: number, scale: number) {
  const d = clamp(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, 1, 2);
  return {
    w: clamp(Math.round(cssW * d * scale), 1, MAX_PX),
    h: clamp(Math.round(cssH * d * scale), 1, MAX_PX),
  };
}
