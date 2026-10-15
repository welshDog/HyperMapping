import { describe, it, expect } from 'vitest';
import { applyHomographyChecked } from '../warp/homography';
import { isValidQuad } from '../warp/quad';
import type { Surface } from '../surfaces/types';
import { parseSurfaceList } from '../surfaces/parse';
import type { Vec2 } from '../warp/types';
import { STEP_PX } from './patterns';
import { decodeScan, type ScanMap } from './decode';
import { applyCalibration, projectorPointAt, tapToCamera, tapsToCorners } from './corners';
import { synthScan } from './synth';

const rect = (w: number, h: number): Vec2[] => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h],
];

/** A hand-made map: mapX = x, mapY = 2 * y over the whole image, every pixel reliable. */
function linearMap(width: number, height: number): ScanMap {
  const n = width * height;
  const mapX = new Uint16Array(n);
  const mapY = new Uint16Array(n);
  const mask = new Uint8Array(n).fill(1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      mapX[y * width + x] = x;
      mapY[y * width + x] = 2 * y;
    }
  }
  return { width, height, gw: 1000, gh: 1000, mapX, mapY, mask };
}

describe('projectorPointAt', () => {
  it('recovers an exactly linear map', () => {
    // Pixel centres: value = (xc - 0.5) cells, so at the tap (10.5, 7.5) mapX = 10 and mapY = 14.
    const p = projectorPointAt(linearMap(40, 30), 10.5, 7.5);
    expect(p).not.toBeNull();
    expect(p![0]).toBeCloseTo((10 + 0.5) * STEP_PX, 6);
    expect(p![1]).toBeCloseTo((14 + 0.5) * STEP_PX, 6);
  });

  it('works within 1 px on a real decoded scan', () => {
    const pw = 64;
    const ph = 32;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    const map = decodeScan(frames, pw, ph, pw / STEP_PX, ph / STEP_PX);
    const p = projectorPointAt(map, 30.3, 14.7);
    expect(p).not.toBeNull();
    expect(Math.abs(p![0] - 30.3)).toBeLessThan(1);
    expect(Math.abs(p![1] - 14.7)).toBeLessThan(1);
  });

  it('refuses a tap on an unlit region', () => {
    const map = linearMap(40, 30);
    map.mask.fill(0);
    expect(projectorPointAt(map, 20, 15)).toBeNull();
  });

  it('refuses a tap where fewer than half of the disc is lit', () => {
    const map = linearMap(40, 30);
    for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) if (x > 18) map.mask[y * 40 + x] = 0;
    // The tap sits at x = 20: only the left ~40% of the disc is lit.
    expect(projectorPointAt(map, 22, 15)).toBeNull();
  });

  it('refuses when fewer than 6 reliable pixels are available', () => {
    const map = linearMap(40, 30);
    map.mask.fill(0);
    for (let i = 0; i < 4; i++) map.mask[15 * 40 + 20 + i] = 1;
    expect(projectorPointAt(map, 21, 15.5, 1.5, 0.01)).toBeNull();
  });

  it('refuses non-finite taps', () => {
    expect(projectorPointAt(linearMap(40, 30), NaN, 5)).toBeNull();
  });
});

describe('tapsToCorners', () => {
  const pw = 128;
  const ph = 72;
  const camCorners: Vec2[] = [
    [8, 6],
    [184, 12],
    [178, 102],
    [4, 98],
  ];
  const scan = synthScan({ pw, ph, camW: 192, camH: 108, projCorners: rect(pw, ph), camCorners });
  const map = decodeScan(scan.frames, 192, 108, pw / STEP_PX, ph / STEP_PX);
  const truth: Vec2[] = [
    [20, 10],
    [100, 10],
    [100, 60],
    [20, 60],
  ];
  const tapsFor = (pts: Vec2[]): Vec2[] => pts.map((q) => applyHomographyChecked(scan.projToCam, q)!);

  it('recovers known projector corners through a perspective camera within 1 px', () => {
    const r = tapsToCorners(map, tapsFor(truth) as [Vec2, Vec2, Vec2, Vec2], { w: pw, h: ph });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const got = [r.corners.tl, r.corners.tr, r.corners.br, r.corners.bl];
    got.forEach((c, i) => {
      expect(Math.abs(c[0] * pw - truth[i][0]), `corner ${i} x`).toBeLessThan(1);
      expect(Math.abs(c[1] * ph - truth[i][1]), `corner ${i} y`).toBeLessThan(1);
    });
    expect(isValidQuad(r.corners)).toBe(true);
  });

  it('refuses taps given in the wrong order (a bow-tie)', () => {
    const swapped = tapsFor([truth[0], truth[2], truth[1], truth[3]]) as [Vec2, Vec2, Vec2, Vec2];
    const r = tapsToCorners(map, swapped, { w: pw, h: ph });
    expect(r).toEqual({ ok: false, failed: [], reason: 'invalid-quad' });
  });

  it('names the taps that landed on an unlit spot', () => {
    const taps = tapsFor(truth) as [Vec2, Vec2, Vec2, Vec2];
    taps[2] = [2, 2]; // outside the projected image in the camera
    const r = tapsToCorners(map, taps, { w: pw, h: ph });
    expect(r).toEqual({ ok: false, failed: [2], reason: 'unlit' });
  });
});

describe('applyCalibration', () => {
  const list: Surface[] = [
    { id: 'a', corners: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] }, srcRect: { u0: 0, v0: 0, u1: 0.5, v1: 1 } },
    { id: 'b', corners: { tl: [0.1, 0.1], tr: [0.9, 0.1], br: [0.9, 0.9], bl: [0.1, 0.9] }, srcRect: { u0: 0.5, v0: 0, u1: 1, v1: 1 } },
  ];
  const fresh = { tl: [0.2, 0.2] as Vec2, tr: [0.8, 0.2] as Vec2, br: [0.8, 0.8] as Vec2, bl: [0.2, 0.8] as Vec2 };

  it('replaces only the corners of the faces given', () => {
    const out = applyCalibration(list, { b: fresh });
    expect(out[0]).toBe(list[0]);
    expect(out[1].corners).toEqual(fresh);
    expect(out[1].srcRect).toEqual(list[1].srcRect);
    expect(out[1].id).toBe('b');
  });
  it('copies the corner tuples so later edits to the input cannot leak in', () => {
    const out = applyCalibration(list, { b: fresh });
    expect(out[1].corners.tl).not.toBe(fresh.tl);
  });
  it('ignores unknown ids and returns a list the shared parser accepts', () => {
    const out = applyCalibration(list, { zzz: fresh, a: fresh });
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
    expect(parseSurfaceList(out)).not.toBeNull();
  });
  it('does not modify its input', () => {
    const before = JSON.stringify(list);
    applyCalibration(list, { a: fresh });
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe('tapToCamera', () => {
  const rect2 = { left: 100, top: 50, width: 320, height: 180 };
  it('maps a click inside the shown picture to camera pixels', () => {
    expect(tapToCamera(260, 140, rect2, 640, 360)).toEqual([320, 180]);
    expect(tapToCamera(100, 50, rect2, 640, 360)).toEqual([0, 0]);
  });
  it('refuses clicks outside the picture and degenerate rectangles', () => {
    expect(tapToCamera(99, 100, rect2, 640, 360)).toBeNull();
    expect(tapToCamera(200, 231, rect2, 640, 360)).toBeNull();
    expect(tapToCamera(5, 5, { left: 0, top: 0, width: 0, height: 10 }, 640, 360)).toBeNull();
  });
});
