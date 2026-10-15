import { describe, it, expect } from 'vitest';
import { MIN_BIT_MARGIN, MIN_CONTRAST, decodeScan } from './decode';
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

  it('really adds noise to the simulated frames (so the noise tests are not vacuous)', () => {
    const pw = 64;
    const ph = 32;
    const opts = { pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) };
    const clean = synthScan(opts).frames;
    const noisy = synthScan({ ...opts, noise: 8, seed: 7 }).frames;
    let differing = 0;
    let largest = 0;
    let total = 0;
    for (let f = 0; f < clean.length; f++) {
      for (let p = 0; p < clean[f].length; p++) {
        const d = Math.abs(noisy[f][p] - clean[f][p]);
        total++;
        if (d > 0) differing++;
        largest = Math.max(largest, d);
      }
    }
    expect(differing / total).toBeGreaterThan(0.8); // noise touches nearly every sample
    expect(largest).toBeGreaterThan(4); // and is not tiny
    expect(largest).toBeLessThanOrEqual(8); // but stays within the stated +/-8
  });

  it('under heavy noise never reports a wrong cell as reliable: it masks pixels instead', () => {
    // Low contrast (50) with +/-20 noise: white-black swings by +/-40, so many pixels fall under the
    // contrast threshold and some bit comparisons get close, but a bit can never flip sign.
    const pw = 64;
    const ph = 32;
    const { frames } = synthScan({
      pw,
      ph,
      camW: pw,
      camH: ph,
      projCorners: rect(pw, ph),
      camCorners: rect(pw, ph),
      hi: 100,
      lo: 50,
      noise: 20,
      seed: 3,
    });
    const map = decodeScan(frames, pw, ph, pw / STEP_PX, ph / STEP_PX);
    let reliable = 0;
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const p = y * pw + x;
        if (!map.mask[p]) continue;
        reliable++;
        expect(map.mapX[p], `pixel ${x},${y}`).toBe(Math.floor(x / STEP_PX));
        expect(map.mapY[p], `pixel ${x},${y}`).toBe(Math.floor(y / STEP_PX));
      }
    }
    const total = pw * ph;
    expect(reliable).toBeLessThan(total); // the noise really did cost some pixels
    expect(reliable).toBeGreaterThan(total * 0.4); // but plenty are still read
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

  describe('the stripe-bit margin applies to both axes, right at the threshold', () => {
    const pw = 16;
    const ph = 8;
    const gw = 4; // 2 x bits: frames 2..5
    const gh = 2; // 1 y bit: frames 6, 7
    const make = () =>
      synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) }).frames;

    /** Set pixel 0's pattern/inverse pair to a given gap, keeping the sign the real bit had. */
    const setGap = (frames: Uint8ClampedArray[], patternFrame: number, gap: number) => {
      const patternWasBrighter = frames[patternFrame][0] > frames[patternFrame + 1][0];
      frames[patternFrame][0] = patternWasBrighter ? 100 + gap : 100;
      frames[patternFrame + 1][0] = patternWasBrighter ? 100 : 100 + gap;
    };

    it.each([
      ['an x bit', 2],
      ['the y bit', 6],
    ])('%s: a gap one under the margin is unreliable, a gap equal to it is read correctly', (_name, patternFrame) => {
      const tooClose = make();
      setGap(tooClose, patternFrame, MIN_BIT_MARGIN - 1);
      const a = decodeScan(tooClose, pw, ph, gw, gh);
      expect(a.mask[0]).toBe(0);
      expect(a.mask[1]).toBe(1); // a neighbour is untouched

      const justEnough = make();
      setGap(justEnough, patternFrame, MIN_BIT_MARGIN);
      const b = decodeScan(justEnough, pw, ph, gw, gh);
      expect(b.mask[0]).toBe(1);
      expect(b.mapX[0]).toBe(0);
      expect(b.mapY[0]).toBe(0);
    });

    it('the y-bit check is really in the y frames: poking only the y pair masks only that pixel', () => {
      const frames = make();
      setGap(frames, 6, 0);
      const map = decodeScan(frames, pw, ph, gw, gh);
      expect(map.mask[0]).toBe(0);
      let reliable = 0;
      for (let p = 0; p < pw * ph; p++) reliable += map.mask[p];
      expect(reliable).toBe(pw * ph - 1);
    });

    it('a contrast exactly at the minimum counts as lit', () => {
      const frames = make();
      frames[0][5] = 100;
      frames[1][5] = 100 - MIN_CONTRAST;
      expect(decodeScan(frames, pw, ph, gw, gh).mask[5]).toBe(1);
    });
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
