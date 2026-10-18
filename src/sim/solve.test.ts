import { describe, it, expect } from 'vitest';
import { isValidQuad } from '../warp/quad';
import { isValidSurfaces } from '../surfaces/model';
import type { Vec2 } from '../warp/types';
import type { Box } from './box';
import { DEFAULT_BOX, DEFAULT_PROJECTOR } from './defaults';
import { toColumnMajor, type V3 } from './math';
import { orderClockwise, projectToUnit, projectorCamera, solveFaces, toSurfaces, type Projector } from './solve';

const CUBE: Box = { width: 1, height: 1, depth: 1, yawDeg: 0 };
// Level with the box centre, straight in front of its +Z face.
const FRONT_ON: Projector = { distance: 3, azimuthDeg: 0, height: 0.5, throwRatio: 1.2, aspect: 16 / 9, shiftY: 0 };
const CORNER_VIEW: Projector = { distance: 3, azimuthDeg: 35, height: 2, throwRatio: 0.9, aspect: 16 / 9, shiftY: 0 };

const area = (c: { tl: Vec2; tr: Vec2; br: Vec2; bl: Vec2 }) => {
  const p = [c.tl, c.tr, c.br, c.bl];
  let a = 0;
  for (let i = 0; i < 4; i++) a += p[i][0] * p[(i + 1) % 4][1] - p[(i + 1) % 4][0] * p[i][1];
  return a / 2;
};

describe('orderClockwise', () => {
  it('orders shuffled points clockwise from the top-left-most', () => {
    const c = orderClockwise([[0.7, 0.8], [0.3, 0.2], [0.8, 0.25], [0.2, 0.75]]);
    expect(c.tl).toEqual([0.3, 0.2]);
    expect(c.tr).toEqual([0.8, 0.25]);
    expect(c.br).toEqual([0.7, 0.8]);
    expect(c.bl).toEqual([0.2, 0.75]);
  });
});

describe('projectToUnit', () => {
  it('the point the projector aims at lands at the image centre', () => {
    const cam = projectorCamera(FRONT_ON, CUBE);
    const [u, v] = projectToUnit(cam.viewProj, [0, 0.5, 0])!;
    expect(u).toBeCloseTo(0.5, 9);
    expect(v).toBeCloseTo(0.5, 9);
  });
  it('lens shift moves the aim point to v = 0.5 + shift', () => {
    const cam = projectorCamera({ ...FRONT_ON, shiftY: 0.1 }, CUBE);
    expect(projectToUnit(cam.viewProj, [0, 0.5, 0])![1]).toBeCloseTo(0.6, 9);
  });
  it('returns null for a point behind the lens', () => {
    const cam = projectorCamera(FRONT_ON, CUBE);
    expect(projectToUnit(cam.viewProj, [0, 0.5, 10])).toBeNull();
  });
  it('the GPU path (column-major float32 data) agrees with projectToUnit', () => {
    const cam = projectorCamera(CORNER_VIEW, CUBE);
    const m = toColumnMajor(cam.viewProj);
    const p: V3 = [0.4, 0.7, 0.5];
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    const u = projectToUnit(cam.viewProj, p)!;
    expect((x / w) * 0.5 + 0.5).toBeCloseTo(u[0], 4);
    expect(0.5 - (y / w) * 0.5).toBeCloseTo(u[1], 4);
  });
});

describe('solveFaces', () => {
  it('front-on: only the front face is visible, symmetric about the image centre', () => {
    const r = solveFaces(CUBE, FRONT_ON);
    expect(r.faces.map((f) => f.face)).toEqual(['front']);
    expect(r.skipped).toHaveLength(5);
    expect(r.skipped.every((s) => s.reason === 'facing-away')).toBe(true);
    const c = r.faces[0].corners;
    expect(c.tl[0] + c.tr[0]).toBeCloseTo(1, 9);
    expect(c.tl[1] + c.bl[1]).toBeCloseTo(1, 9);
    expect(c.tl[0]).toBeCloseTo(c.bl[0], 9);
    expect(c.tl[0]).toBeCloseTo(0.26, 2); // analytic: 0.5 - 0.5 * 0.5 / (2.5 * tan(fov/2) * aspect)
    expect(c.tl[1]).toBeCloseTo(0.0733, 3);
    expect(r.faces[0].partlyOutside).toBe(false);
  });

  it('from an elevated corner it sees three faces', () => {
    const r = solveFaces(CUBE, CORNER_VIEW);
    expect(r.faces.map((f) => f.face).sort()).toEqual(['front', 'right', 'top']);
    expect(r.skipped).toHaveLength(3);
    r.faces.forEach((f) => expect(isValidQuad(f.corners)).toBe(true));
  });

  it('the default setup is a good starting point: three faces, nothing off-image', () => {
    const r = solveFaces(DEFAULT_BOX, DEFAULT_PROJECTOR);
    expect(r.faces).toHaveLength(3);
    expect(r.faces.every((f) => !f.partlyOutside)).toBe(true);
    expect(r.skipped.every((s) => s.reason === 'facing-away')).toBe(true);
  });

  it('a projector inside the box sees no faces and produces no garbage', () => {
    const r = solveFaces(CUBE, { ...FRONT_ON, distance: 0 });
    expect(r.faces).toEqual([]);
    expect(r.skipped).toHaveLength(6);
  });

  it('a face passing beside the projector is skipped as behind-projector', () => {
    const box: Box = { width: 1, height: 0.4, depth: 10, yawDeg: 0 };
    const r = solveFaces(box, { ...FRONT_ON, height: 1, distance: 3 });
    expect(r.skipped).toContainEqual({ face: 'top', reason: 'behind-projector' });
  });

  it('a zoomed-in projector skips faces that fall far outside the image', () => {
    const r = solveFaces(CUBE, { ...FRONT_ON, throwRatio: 4 });
    expect(r.faces).toEqual([]);
    expect(r.skipped).toContainEqual({ face: 'front', reason: 'off-image' });
  });

  it('a face slightly outside the image is kept and flagged partlyOutside', () => {
    const r = solveFaces(CUBE, { ...FRONT_ON, throwRatio: 1.875 });
    expect(r.faces).toHaveLength(1);
    expect(r.faces[0].partlyOutside).toBe(true);
    expect(r.faces[0].corners.tl[1]).toBeLessThan(0);
    expect(r.faces[0].corners.tl[1]).toBeGreaterThan(-0.5);
  });

  it('lens shift moves every corner down by exactly the shift', () => {
    const a = solveFaces(CUBE, FRONT_ON).faces[0].corners;
    const b = solveFaces(CUBE, { ...FRONT_ON, shiftY: 0.1 }).faces[0].corners;
    for (const k of ['tl', 'tr', 'br', 'bl'] as const) {
      expect(b[k][1] - a[k][1]).toBeCloseTo(0.1, 9);
      expect(b[k][0]).toBeCloseTo(a[k][0], 9);
    }
  });

  it('non-finite inputs never produce non-finite pins', () => {
    const r = solveFaces(CUBE, { ...FRONT_ON, distance: NaN });
    expect(r.faces).toEqual([]);
    const r2 = solveFaces({ ...CUBE, yawDeg: NaN }, FRONT_ON);
    expect(r2.faces).toEqual([]);
    expect(r2.skipped).toHaveLength(6);
  });

  it('an edge-on face is skipped as degenerate', () => {
    const r = solveFaces(CUBE, { ...FRONT_ON, height: 1.00001 });
    expect(r.skipped).toContainEqual({ face: 'top', reason: 'degenerate' });
    expect(r.faces.map((f) => f.face)).not.toContain('top');
    r.faces.forEach((f) => expect(isValidQuad(f.corners)).toBe(true));
  });

  it('a face too small to map is skipped as degenerate', () => {
    const r = solveFaces(CUBE, { ...FRONT_ON, distance: 200 });
    expect(r.faces).toEqual([]);
    expect(r.skipped).toContainEqual({ face: 'front', reason: 'degenerate' });
  });

  it('every quad is valid, clockwise, starts top-left, for any box yaw', () => {
    for (let yawDeg = 0; yawDeg < 360; yawDeg += 20) {
      const r = solveFaces({ ...CUBE, yawDeg }, CORNER_VIEW);
      expect(r.faces.length + r.skipped.length).toBe(6);
      expect(r.faces.length).toBeGreaterThanOrEqual(2);
      for (const f of r.faces) {
        const pts = [f.corners.tl, f.corners.tr, f.corners.br, f.corners.bl];
        expect(isValidQuad(f.corners)).toBe(true);
        expect(area(f.corners)).toBeGreaterThan(0);
        const sums = pts.map((p) => p[0] + p[1]);
        expect(sums[0]).toBeCloseTo(Math.min(...sums), 12);
        pts.forEach((p) => p.forEach((n) => expect(Number.isFinite(n)).toBe(true)));
      }
    }
  });
});

describe('toSurfaces', () => {
  it('turns the faces into app surfaces ordered left to right with equal slices', () => {
    const s = toSurfaces(solveFaces(CUBE, CORNER_VIEW));
    expect(s.map((x) => x.id)).toEqual(['s1', 's2', 's3']);
    expect(isValidSurfaces(s)).toBe(true);
    for (let i = 0; i < 3; i++) {
      expect(s[i].srcRect.u0).toBeCloseTo(i / 3, 12);
      expect(s[i].srcRect.u1).toBeCloseTo((i + 1) / 3, 12);
    }
    const cx = s.map((x) => (x.corners.tl[0] + x.corners.tr[0] + x.corners.br[0] + x.corners.bl[0]) / 4);
    expect(cx[0]).toBeLessThanOrEqual(cx[1]);
    expect(cx[1]).toBeLessThanOrEqual(cx[2]);
  });
  it('an empty result gives an empty list', () => {
    expect(toSurfaces({ faces: [], skipped: [] })).toEqual([]);
  });
});

describe('toSurfaces and shapes', () => {
  it('box faces are always plain quads (no shape key)', () => {
    for (const s of toSurfaces(solveFaces(CUBE, CORNER_VIEW))) expect('shape' in s).toBe(false);
  });
});
