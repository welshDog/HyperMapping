import { describe, it, expect } from 'vitest';
import { boxFaces, type Box } from './box';
import { dot, length, sub, type V3 } from './math';

const BOX: Box = { width: 2, height: 1, depth: 0.5, yawDeg: 0 };
const centre = (b: Box): V3 => [0, b.height / 2, 0];
const faceCentre = (corners: V3[]): V3 =>
  corners.reduce<V3>((a, c) => [a[0] + c[0] / 4, a[1] + c[1] / 4, a[2] + c[2] / 4], [0, 0, 0]);

describe('boxFaces', () => {
  it('returns six faces with the six ids', () => {
    const faces = boxFaces(BOX);
    expect(faces.map((f) => f.id).sort()).toEqual(['back', 'bottom', 'front', 'left', 'right', 'top']);
    faces.forEach((f) => expect(f.corners).toHaveLength(4));
  });

  it('normals are unit length, outward, and every face is planar', () => {
    for (const yawDeg of [0, 30, 90, 137, -45, 180, 300]) {
      const box = { ...BOX, yawDeg };
      for (const f of boxFaces(box)) {
        expect(length(f.normal)).toBeCloseTo(1, 9);
        expect(dot(f.normal, sub(faceCentre(f.corners), centre(box)))).toBeGreaterThan(0);
        const d = f.corners.map((c) => dot(f.normal, c));
        d.forEach((x) => expect(x).toBeCloseTo(d[0], 9));
      }
    }
  });

  it('sizes the faces from the box dimensions', () => {
    const front = boxFaces(BOX).find((f) => f.id === 'front')!;
    const xs = front.corners.map((c) => c[0]);
    const ys = front.corners.map((c) => c[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1, 9);
    expect(Math.min(...ys)).toBeCloseTo(0, 9); // stands on the floor
    front.corners.forEach((c) => expect(c[2]).toBeCloseTo(0.25, 9));
  });

  it('a 90 degree yaw turns the front face towards +X', () => {
    const front = boxFaces({ ...BOX, yawDeg: 90 }).find((f) => f.id === 'front')!;
    expect(front.normal[0]).toBeCloseTo(1, 9);
    expect(front.normal[2]).toBeCloseTo(0, 9);
  });

  it('all corners stay on the floor or at the top', () => {
    boxFaces({ ...BOX, yawDeg: 33 }).forEach((f) =>
      f.corners.forEach((c) => expect([0, 1].some((y) => Math.abs(c[1] - y) < 1e-9)).toBe(true)),
    );
  });
});
