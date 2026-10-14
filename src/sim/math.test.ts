import { describe, it, expect } from 'vitest';
import { cross, dot, length, lookAt, mul, normalize, perspective, sub, toColumnMajor, transformPoint, type Mat4, type V3 } from './math';

const I: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('vector helpers', () => {
  it('sub, dot, cross and length behave', () => {
    expect(sub([3, 2, 1], [1, 1, 1])).toEqual([2, 1, 0]);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(length([3, 4, 0])).toBe(5);
  });
  it('normalize gives a unit vector, and zero for the zero vector', () => {
    expect(length(normalize([3, 4, 12]))).toBeCloseTo(1, 12);
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('lookAt', () => {
  it('puts the target straight ahead on -Z at the right distance', () => {
    const v = lookAt([0, 0, 5], [0, 0, 0]);
    const [x, y, z, w] = transformPoint(v, [0, 0, 0]);
    expect([x, y, z, w].map((n) => +n.toFixed(9))).toEqual([0, 0, -5, 1]);
  });
  it('maps world right to camera +X and world up to camera +Y', () => {
    const v = lookAt([0, 0, 5], [0, 0, 0]);
    expect(transformPoint(v, [1, 0, 0])[0]).toBeCloseTo(1, 9);
    expect(transformPoint(v, [0, 1, 0])[1]).toBeCloseTo(1, 9);
  });
  it('is finite when looking straight down', () => {
    const v = lookAt([0, 5, 0], [0, 0, 0]);
    v.forEach((n) => expect(Number.isFinite(n)).toBe(true));
    expect(transformPoint(v, [0, 0, 0])[2]).toBeCloseTo(-5, 9);
  });
});

describe('perspective', () => {
  it('maps the right edge of a 90 degree square frustum to ndc x = 1', () => {
    const p = perspective(Math.PI / 2, 1, 0.1, 100);
    const [x, , , w] = transformPoint(p, [1, 0, -1]);
    expect(x / w).toBeCloseTo(1, 9);
  });
  it('maps the top edge to ndc y = 1 and divides x by the aspect', () => {
    const p = perspective(Math.PI / 2, 2, 0.1, 100);
    const [x, y, , w] = transformPoint(p, [1, 1, -1]);
    expect(y / w).toBeCloseTo(1, 9);
    expect(x / w).toBeCloseTo(0.5, 9);
  });
  it('w equals the distance in front of the camera', () => {
    const p = perspective(1, 1.5, 0.1, 100);
    expect(transformPoint(p, [0, 0, -4])[3]).toBeCloseTo(4, 12);
  });
  it('lens shift moves an on-axis point down in the image by 2*shift in ndc', () => {
    const p = perspective(Math.PI / 2, 1, 0.1, 100, 0.25);
    const [, y, , w] = transformPoint(p, [0, 0, -2]);
    expect(y / w).toBeCloseTo(-0.5, 9);
  });
});

describe('mul and toColumnMajor', () => {
  it('mul with identity is a no-op', () => {
    const v = lookAt([1, 2, 3], [0, 0.5, 0]);
    mul(v, I).forEach((n, i) => expect(n).toBeCloseTo(v[i], 12));
    mul(I, v).forEach((n, i) => expect(n).toBeCloseTo(v[i], 12));
  });
  it('mul(proj, view) equals applying view then proj', () => {
    const v = lookAt([1, 2, 3], [0, 0.5, 0]);
    const p = perspective(1, 1.5, 0.1, 50);
    const pt: V3 = [0.3, 0.4, -0.2];
    const direct = transformPoint(mul(p, v), pt);
    const [x, y, z] = transformPoint(v, pt);
    const step = transformPoint(p, [x, y, z]);
    direct.forEach((n, i) => expect(n).toBeCloseTo(step[i], 9));
  });
  it('toColumnMajor transposes into a Float32Array', () => {
    const m = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const out = toColumnMajor(m);
    expect(out).toBeInstanceOf(Float32Array);
    expect(Array.from(out)).toEqual([1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16]);
  });
});
