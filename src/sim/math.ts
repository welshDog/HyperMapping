export type V3 = [number, number, number];
/** 4x4 matrix, 16 numbers, row-major. */
export type Mat4 = number[];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: V3): V3 => {
  const l = length(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** View matrix (world -> camera). The camera looks down -Z, like OpenGL. */
export function lookAt(eye: V3, target: V3, up: V3 = [0, 1, 0]): Mat4 {
  const f = normalize(sub(target, eye));
  // Looking straight along `up` would make the right vector zero: use another up.
  const side = length(cross(f, up)) < 1e-9 ? cross(f, [0, 0, 1]) : cross(f, up);
  const s = normalize(side);
  const u = cross(s, f);
  return [
    s[0], s[1], s[2], -dot(s, eye),
    u[0], u[1], u[2], -dot(u, eye),
    -f[0], -f[1], -f[2], dot(f, eye),
    0, 0, 0, 1,
  ];
}

/**
 * OpenGL-style projection. `shiftY` is the lens shift as a fraction of the image height:
 * shiftY > 0 moves the image UP on the wall, so an on-axis point lands lower in the image
 * (ndc y = -2 * shiftY).
 */
export function perspective(fovYRad: number, aspect: number, near: number, far: number, shiftY = 0): Mat4 {
  const t = 1 / Math.tan(fovYRad / 2);
  const nf = 1 / (near - far);
  return [
    t / aspect, 0, 0, 0,
    0, t, 2 * shiftY, 0,
    0, 0, (far + near) * nf, 2 * far * near * nf,
    0, 0, -1, 0,
  ];
}

export function mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = s;
    }
  }
  return out;
}

/** m * [p, 1] -> [x, y, z, w] (no perspective divide). */
export function transformPoint(m: Mat4, p: V3): [number, number, number, number] {
  const row = (r: number) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3];
  return [row(0), row(1), row(2), row(3)];
}

/** The same matrix as column-major float32 data, the layout GPUs and three.js expect. */
export function toColumnMajor(m: Mat4): Float32Array {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = m[r * 4 + c];
  return out;
}
