import { describe, it, expect } from 'vitest';
import { shapeOutlinePoints } from './outline';
import { UNIT_CORNERS, type Corners } from '../warp/types';

describe('shapeOutlinePoints', () => {
  it('quad: the four corners in order', () => {
    expect(shapeOutlinePoints('quad', UNIT_CORNERS)).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
  });
  it('triangle: apex, base-right, base-left of the frame', () => {
    const pts = shapeOutlinePoints('triangle', UNIT_CORNERS);
    const want = [[0.5, 0], [1, 1], [0, 1]];
    expect(pts.length).toBe(3);
    pts.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(want[i][0], 9);
      expect(p[1]).toBeCloseTo(want[i][1], 9);
    });
  });
  it('circle: every point is half a frame from the centre', () => {
    const pts = shapeOutlinePoints('circle', UNIT_CORNERS, 8);
    expect(pts.length).toBe(8);
    for (const [x, y] of pts) expect(Math.hypot(x - 0.5, y - 0.5)).toBeCloseTo(0.5, 9);
  });
  it('follows the pins: a triangle in a shifted frame has its apex at the middle of the top edge', () => {
    const c: Corners = { tl: [0.2, 0.2], tr: [0.6, 0.2], br: [0.6, 0.8], bl: [0.2, 0.8] };
    const [apex] = shapeOutlinePoints('triangle', c);
    expect(apex[0]).toBeCloseTo(0.4, 9);
    expect(apex[1]).toBeCloseTo(0.2, 9);
  });
  it('a degenerate frame (all four corners equal) gives no points', () => {
    const p: [number, number] = [0.5, 0.5];
    expect(shapeOutlinePoints('circle', { tl: p, tr: p, br: p, bl: p })).toEqual([]);
    expect(shapeOutlinePoints('triangle', { tl: p, tr: p, br: p, bl: p })).toEqual([]);
  });
});
