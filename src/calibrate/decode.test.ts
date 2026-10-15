import { describe, it, expect } from 'vitest';
import { MIN_CONTRAST, decodeScan } from './decode';
import { STEP_PX, bitsFor, frameCount } from './patterns';
import { synthScan } from './synth';
import type { Vec2 } from '../warp/types';

const rect = (w: number, h: number): Vec2[] => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h],
];

describe('decodeScan', () => {
  it('reads every cell exactly when the camera sees the projector 1:1', () => {
    const pw = 64;
    const ph = 32;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    const gw = pw / STEP_PX;
    const gh = ph / STEP_PX;
    const map = decodeScan(frames, pw, ph, gw, gh);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const p = y * pw + x;
        expect(map.mask[p]).toBe(1);
        expect(map.mapX[p]).toBe(Math.floor(x / STEP_PX));
        expect(map.mapY[p]).toBe(Math.floor(y / STEP_PX));
      }
    }
  });

  it('masks the camera pixels that do not see the projector', () => {
    const pw = 64;
    const ph = 32;
    const camCorners: Vec2[] = [
      [16, 8],
      [80, 8],
      [80, 40],
      [16, 40],
    ];
    const { frames } = synthScan({ pw, ph, camW: 96, camH: 48, projCorners: rect(pw, ph), camCorners });
    const map = decodeScan(frames, 96, 48, pw / STEP_PX, ph / STEP_PX);
    let lit = 0;
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 96; x++) {
        const inside = x >= 16 && x < 80 && y >= 8 && y < 40;
        const p = y * 96 + x;
        expect(map.mask[p], `pixel ${x},${y}`).toBe(inside ? 1 : 0);
        if (inside) {
          lit++;
          expect(map.mapX[p]).toBe(Math.floor((x - 16) / STEP_PX));
          expect(map.mapY[p]).toBe(Math.floor((y - 8) / STEP_PX));
        }
      }
    }
    expect(lit).toBe(64 * 32);
  });

  it('decodes a grid that is not a power of two', () => {
    const pw = 52;
    const ph = 20;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    const map = decodeScan(frames, pw, ph, 13, 5);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        expect(map.mask[y * pw + x]).toBe(1);
        expect(map.mapX[y * pw + x]).toBe(Math.floor(x / STEP_PX));
        expect(map.mapY[y * pw + x]).toBe(Math.floor(y / STEP_PX));
      }
    }
  });

  it('masks codes that fall outside the grid instead of clamping them', () => {
    // Frames were made for a 16-cell-wide grid but decoded as if it had 13 cells.
    const pw = 64;
    const ph = 20;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    expect(bitsFor(13)).toBe(bitsFor(16));
    const map = decodeScan(frames, pw, ph, 13, 5);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        expect(map.mask[y * pw + x], `pixel ${x},${y}`).toBe(Math.floor(x / STEP_PX) < 13 ? 1 : 0);
      }
    }
  });

  it('still decodes exactly with +/-8 grey levels of noise', () => {
    const pw = 64;
    const ph = 32;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph), noise: 8, seed: 7 });
    const map = decodeScan(frames, pw, ph, pw / STEP_PX, ph / STEP_PX);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const p = y * pw + x;
        expect(map.mask[p]).toBe(1);
        expect(map.mapX[p]).toBe(Math.floor(x / STEP_PX));
        expect(map.mapY[p]).toBe(Math.floor(y / STEP_PX));
      }
    }
  });

  it('marks a pixel unreliable when a bit comparison is too close to call', () => {
    const pw = 16;
    const ph = 8;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    // Make pixel 0 read the same in an x-bit pattern frame and its inverse.
    frames[2][0] = 100;
    frames[3][0] = 100;
    const map = decodeScan(frames, pw, ph, 4, 2);
    expect(map.mask[0]).toBe(0);
    expect(map.mask[1]).toBe(1);
  });

  it('treats a pixel as unlit when white is not clearly brighter than black', () => {
    const pw = 16;
    const ph = 8;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    frames[0][5] = 100;
    frames[1][5] = 100 - (MIN_CONTRAST - 1);
    const map = decodeScan(frames, pw, ph, 4, 2);
    expect(map.mask[5]).toBe(0);
  });

  it('refuses frame lists of the wrong size', () => {
    const pw = 16;
    const ph = 8;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    expect(frames.length).toBe(frameCount(4, 2));
    expect(() => decodeScan(frames.slice(1), pw, ph, 4, 2)).toThrow();
    expect(() => decodeScan(frames, pw + 1, ph, 4, 2)).toThrow();
  });
});
