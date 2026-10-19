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

/** Capture rate of each look's stream. Stays 30 (it may drop to 24 for 4 looks only if the live check says so). */
export function captureFpsFor(_liveLooks: number): 30 {
  return 30;
}
