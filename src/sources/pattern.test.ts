import { describe, it, expect } from 'vitest';
import { PATTERN_HEIGHT, PATTERN_WIDTH, drawTestPattern, wantsPattern, type PatternContext } from './pattern';

/** Records every drawing call so the pattern can be checked without a canvas. */
class Recorder implements PatternContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  lineWidth = 1;
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  /** Every point the drawing touches: [x, y]. */
  points: [number, number][] = [];
  texts: string[] = [];
  fillStyles: string[] = []; // fillStyle at each fill()
  fillRect(x: number, y: number, w: number, h: number) {
    this.points.push([x, y], [x + w, y + h]);
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.points.push([x, y], [x + w, y + h]);
  }
  beginPath() {}
  closePath() {}
  moveTo(x: number, y: number) {
    this.points.push([x, y]);
  }
  lineTo(x: number, y: number) {
    this.points.push([x, y]);
  }
  arc(x: number, y: number, r: number) {
    this.points.push([x - r, y - r], [x + r, y + r]);
  }
  stroke() {}
  fill() {
    this.fillStyles.push(String(this.fillStyle));
  }
  fillText(text: string, x: number, y: number) {
    this.texts.push(text);
    this.points.push([x, y]);
  }
}

const draw = (w = PATTERN_WIDTH, h = PATTERN_HEIGHT, tick = 0) => {
  const r = new Recorder();
  drawTestPattern(r, w, h, tick);
  return r;
};

describe('drawTestPattern', () => {
  it('keeps every mark inside the picture', () => {
    for (const [w, h] of [
      [1280, 720],
      [640, 360],
      [320, 180],
    ] as const) {
      const r = draw(w, h);
      expect(r.points.length).toBeGreaterThan(50);
      for (const [x, y] of r.points) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(w + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(h + 1e-9);
      }
    }
  });

  it('labels the corners, the top, the columns, the rows and the asymmetric word', () => {
    const { texts } = draw();
    for (const t of ['TL', 'TR', 'BL', 'BR', 'TOP', 'HYPERMAPPING']) expect(texts).toContain(t);
    for (const c of 'BCDEFGHIJKLMNO') expect(texts).toContain(c); // columns B..O (A and P are corner cells)
    for (const n of '2345678') expect(texts).toContain(n); // rows 2..8 (1 and 9 are corner cells)
  });

  it('is deterministic for the same tick', () => {
    expect(draw(1280, 720, 4).texts).toEqual(draw(1280, 720, 4).texts);
    expect(draw(1280, 720, 4).points).toEqual(draw(1280, 720, 4).points);
  });

  it('blinks the live dot with tick parity (the dot is the last thing drawn)', () => {
    const last = (tick: number) => {
      const s = draw(1280, 720, tick).fillStyles;
      return s[s.length - 1];
    };
    expect(last(0)).toBe(last(2));
    expect(last(1)).toBe(last(3));
    expect(last(0)).not.toBe(last(1));
  });
});

describe('wantsPattern', () => {
  it('shows the pattern when forced or when there is no video', () => {
    expect(wantsPattern(true, true)).toBe(true);
    expect(wantsPattern(true, false)).toBe(true);
    expect(wantsPattern(false, false)).toBe(true);
  });
  it('shows the video only when one is loaded and the button is off', () => {
    expect(wantsPattern(false, true)).toBe(false);
  });
});
