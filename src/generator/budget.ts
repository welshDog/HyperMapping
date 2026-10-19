/**
 * Render budget: the more looks are live at once, the smaller each one is drawn, so four looks stay
 * smooth on the laptop. Never below 640x360 (the spec's floor); the 4-look cap does not move.
 */
const FULL = { w: 960, h: 540 } as const;
const SMALL = { w: 640, h: 360 } as const;

/** Size of each look's hidden canvas for this many visible (showing) looks. */
export function lookRenderSize(liveLooks: number): { w: number; h: number } {
  return liveLooks >= 3 ? { ...SMALL } : { ...FULL };
}

/**
 * The size to use now, given the size in use and the number of showing looks. Shrinks at 3 looks and only
 * grows back at 1 or fewer, so adding and removing a look around the 2/3 boundary does not resize (and
 * clear and re-capture) every look each time. With no current size it is the plain rule.
 */
export function chooseLookSize(current: { w: number; h: number } | null, liveLooks: number): { w: number; h: number } {
  if (current === null) return lookRenderSize(liveLooks);
  if (liveLooks >= 3) return { ...SMALL };
  if (liveLooks <= 1) return { ...FULL };
  return { w: current.w, h: current.h };
}
