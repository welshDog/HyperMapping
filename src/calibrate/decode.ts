import { bitsFor, frameCount, fromGray } from './patterns';

/** One camera frame as grey levels (width * height). */
export type GrayFrame = Uint8ClampedArray;

/** For every camera pixel: which projector grid cell lit it. `mask` is 1 where that is reliable. */
export interface ScanMap {
  width: number;
  height: number;
  gw: number;
  gh: number;
  mapX: Uint16Array;
  mapY: Uint16Array;
  mask: Uint8Array;
}

/** A camera pixel is lit when white is at least this much brighter than black. */
export const MIN_CONTRAST = 40;
/** A stripe bit is only trusted when its pattern and inverse frames differ by at least this much. */
export const MIN_BIT_MARGIN = 12;

export function decodeScan(
  frames: GrayFrame[],
  width: number,
  height: number,
  gw: number,
  gh: number,
  minContrast = MIN_CONTRAST,
  minMargin = MIN_BIT_MARGIN,
): ScanMap {
  const total = frameCount(gw, gh);
  if (frames.length !== total) throw new Error(`expected ${total} scan frames, got ${frames.length}`);
  const size = width * height;
  for (const f of frames) if (f.length !== size) throw new Error('scan frame has the wrong size');
  const bx = bitsFor(gw);
  const by = bitsFor(gh);
  const mapX = new Uint16Array(size);
  const mapY = new Uint16Array(size);
  const mask = new Uint8Array(size);
  const white = frames[0];
  const black = frames[1];
  for (let p = 0; p < size; p++) {
    if (white[p] - black[p] < minContrast) continue;
    let ok = true;
    let gx = 0;
    for (let k = 0; k < bx && ok; k++) {
      const pat = frames[2 + 2 * k][p];
      const inv = frames[3 + 2 * k][p];
      if (Math.abs(pat - inv) < minMargin) ok = false;
      gx = (gx << 1) | (pat > inv ? 1 : 0);
    }
    let gy = 0;
    for (let k = 0; k < by && ok; k++) {
      const pat = frames[2 + 2 * bx + 2 * k][p];
      const inv = frames[3 + 2 * bx + 2 * k][p];
      if (Math.abs(pat - inv) < minMargin) ok = false;
      gy = (gy << 1) | (pat > inv ? 1 : 0);
    }
    if (!ok) continue;
    const cx = fromGray(gx);
    const cy = fromGray(gy);
    if (cx >= gw || cy >= gh) continue;
    mapX[p] = cx;
    mapY[p] = cy;
    mask[p] = 1;
  }
  return { width, height, gw, gh, mapX, mapY, mask };
}
