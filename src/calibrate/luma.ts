/** Add one RGBA camera frame's grey levels into `acc` (one entry per pixel). */
export function accumulateLuma(rgba: Uint8ClampedArray, acc: Uint16Array): void {
  for (let p = 0; p < acc.length; p++) {
    const i = p * 4;
    acc[p] += (77 * rgba[i] + 150 * rgba[i + 1] + 29 * rgba[i + 2]) >> 8;
  }
}

/** The average grey frame of `count` accumulated frames. */
export function finishLuma(acc: Uint16Array, count: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(acc.length);
  for (let p = 0; p < acc.length; p++) out[p] = Math.round(acc[p] / count);
  return out;
}
