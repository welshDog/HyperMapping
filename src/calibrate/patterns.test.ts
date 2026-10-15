import { describe, it, expect } from 'vitest';
import {
  STEP_PX,
  bitValue,
  bitsFor,
  drawScanFrame,
  frameCount,
  frameSpec,
  fromGray,
  grayCode,
  parseFrameSpec,
  type FrameSpec,
  type ScanContext,
} from './patterns';

describe('gray code', () => {
  it('round trips', () => {
    for (let i = 0; i <= 65536; i++) expect(fromGray(grayCode(i))).toBe(i);
  });
  it('adjacent codes differ in exactly one bit', () => {
    for (let i = 0; i < 4096; i++) {
      const x = grayCode(i) ^ grayCode(i + 1);
      expect(x).not.toBe(0);
      expect(x & (x - 1)).toBe(0);
    }
  });
});

describe('bitsFor and frameCount', () => {
  it('counts the bits needed to address n cells', () => {
    expect([1, 2, 3, 4, 5, 256, 257, 270, 480].map(bitsFor)).toEqual([1, 1, 2, 2, 3, 8, 9, 9, 9]);
  });
  it('counts frames: white, black, then a pattern and its inverse per bit per axis', () => {
    expect(frameCount(480, 270)).toBe(38);
    expect(frameCount(16, 8)).toBe(2 + 2 * 4 + 2 * 3);
  });
});

describe('frameSpec', () => {
  it('orders white, black, x bits (pattern, inverse), then y bits', () => {
    expect(frameSpec(0, 16, 8)).toEqual({ kind: 'white' });
    expect(frameSpec(1, 16, 8)).toEqual({ kind: 'black' });
    expect(frameSpec(2, 16, 8)).toEqual({ kind: 'bit', axis: 'x', bit: 0, bits: 4, inverted: false });
    expect(frameSpec(3, 16, 8)).toEqual({ kind: 'bit', axis: 'x', bit: 0, bits: 4, inverted: true });
    expect(frameSpec(2 + 8, 16, 8)).toEqual({ kind: 'bit', axis: 'y', bit: 0, bits: 3, inverted: false });
    expect(frameSpec(frameCount(16, 8) - 1, 16, 8)).toEqual({ kind: 'bit', axis: 'y', bit: 2, bits: 3, inverted: true });
  });
  it('rejects an index outside the scan', () => {
    expect(() => frameSpec(-1, 16, 8)).toThrow(RangeError);
    expect(() => frameSpec(frameCount(16, 8), 16, 8)).toThrow(RangeError);
    expect(() => frameSpec(1.5, 16, 8)).toThrow(RangeError);
  });
  it('gives every cell of a non-power-of-two grid a distinct code', () => {
    const gw = 13;
    const gh = 5;
    const seen = new Set<string>();
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let code = '';
        for (let i = 2; i < frameCount(gw, gh); i++) code += bitValue(frameSpec(i, gw, gh), x, y);
        seen.add(code);
      }
    }
    expect(seen.size).toBe(gw * gh);
  });
  it('makes each inverse frame the exact complement of its pattern frame', () => {
    for (let i = 2; i < frameCount(13, 5); i += 2) {
      for (let c = 0; c < 13; c++) {
        expect(bitValue(frameSpec(i, 13, 5), c, c) + bitValue(frameSpec(i + 1, 13, 5), c, c)).toBe(1);
      }
    }
  });
});

/** Replays the fillRect calls onto a pixel grid so a frame can be checked cell by cell. */
class Painter implements ScanContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  pixels: boolean[][];
  constructor(
    private w: number,
    private h: number,
  ) {
    this.pixels = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const on = this.fillStyle === '#fff';
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) this.pixels[yy][xx] = on;
    }
  }
}

describe('drawScanFrame', () => {
  const pw = 70;
  const ph = 30;
  const gw = Math.ceil(pw / STEP_PX);
  const gh = Math.ceil(ph / STEP_PX);
  it('paints every cell of every frame with the colour bitValue says', () => {
    for (let i = 0; i < frameCount(gw, gh); i++) {
      const spec = frameSpec(i, gw, gh);
      const p = new Painter(pw, ph);
      drawScanFrame(p, spec, pw, ph, gw, gh);
      for (let cy = 0; cy < gh; cy++) {
        for (let cx = 0; cx < gw; cx++) {
          const px = Math.min(pw - 1, cx * STEP_PX + 1);
          const py = Math.min(ph - 1, cy * STEP_PX + 1);
          expect(p.pixels[py][px], `frame ${i} cell ${cx},${cy}`).toBe(bitValue(spec, cx, cy) === 1);
        }
      }
    }
  });
});

describe('parseFrameSpec', () => {
  it('accepts valid specs', () => {
    expect(parseFrameSpec({ kind: 'white' })).toEqual({ kind: 'white' });
    expect(parseFrameSpec({ kind: 'black', extra: 1 })).toEqual({ kind: 'black' });
    const bit: FrameSpec = { kind: 'bit', axis: 'y', bit: 2, bits: 3, inverted: true };
    expect(parseFrameSpec({ ...bit })).toEqual(bit);
  });
  it('rejects anything else', () => {
    for (const bad of [
      null,
      42,
      {},
      { kind: 'grey' },
      { kind: 'bit', axis: 'z', bit: 0, bits: 3, inverted: false },
      { kind: 'bit', axis: 'x', bit: 3, bits: 3, inverted: false },
      { kind: 'bit', axis: 'x', bit: -1, bits: 3, inverted: false },
      { kind: 'bit', axis: 'x', bit: 0.5, bits: 3, inverted: false },
      { kind: 'bit', axis: 'x', bit: 0, bits: 17, inverted: false },
      { kind: 'bit', axis: 'x', bit: 0, bits: 3, inverted: 1 },
    ]) {
      expect(parseFrameSpec(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
