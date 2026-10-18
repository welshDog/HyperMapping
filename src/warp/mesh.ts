import type { FaceShape, SrcRect } from '../surfaces/types';
import { applyHomography, computeHomography } from './homography';
import { isValidQuad } from './quad';
import { shapeId } from './shape';
import { UNIT_CORNERS, cornersToArray, type Corners, type Vec2 } from './types';

export const GRID = 20;

/** Unit space (0..1, Y down) -> WebGL/WebGPU normalized device coords (-1..1, Y up). */
export const unitToNdc = ([x, y]: Vec2): Vec2 => [x * 2 - 1, 1 - y * 2];

export interface MeshTopology {
  uvs: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
}

/**
 * Frame coordinates of the grid lines along one axis: the inner 0..1 grid (n steps, exactly as a quad has it)
 * wrapped in one outer ring at -margin and 1+margin. With margin 0 the ring collapses onto 0 and 1 (zero-area
 * cells that draw nothing), so quads look exactly as they did. The shape's edge at frame 0 and 1 therefore always
 * sits ON mesh vertices; stretching the whole grid instead put it inside cells whose straight-line (non-perspective)
 * interpolation spilled light past the shape on a strongly foreshortened frame.
 */
const gridLines = (n: number, margin: number): number[] => [0 - margin, ...Array.from({ length: n + 1 }, (_, i) => i / n), 1 + margin];

/** Static data: uploaded to the GPU once and never changes. A margin puts the outer ring at -margin and 1+margin. */
export function buildTopology(cols = GRID, rows = GRID, margin = 0): MeshTopology {
  const xs = gridLines(cols, margin);
  const ys = gridLines(rows, margin);
  const stride = xs.length;
  const vertexCount = xs.length * ys.length;
  const uvs = new Float32Array(vertexCount * 2);
  let k = 0;
  for (const y of ys) {
    for (const x of xs) {
      uvs[k++] = x;
      uvs[k++] = y;
    }
  }
  const indices = new Uint16Array((xs.length - 1) * (ys.length - 1) * 6);
  let n = 0;
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      const i0 = r * stride + c;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      indices.set([i0, i2, i1, i1, i2, i3], n);
      n += 6;
    }
  }
  return { uvs, indices, vertexCount };
}

/**
 * Vertex positions in NDC for the video quad pinned to `corners` (unit space).
 * Each grid vertex goes through the homography, so straight lines stay straight.
 * With a margin an outer ring of vertices sits at -margin and 1+margin of the frame (default 0: exactly the frame).
 * Returns null (touching nothing) when the quad has no valid perspective transform.
 */
export function warpedPositions(
  corners: Corners,
  cols = GRID,
  rows = GRID,
  out?: Float32Array,
  margin = 0,
): Float32Array | null {
  if (!isValidQuad(corners)) return null;
  const dst = cornersToArray(corners).map(unitToNdc);
  const h = computeHomography(cornersToArray(UNIT_CORNERS), dst);
  if (!h) return null;
  const xs = gridLines(cols, margin);
  const ys = gridLines(rows, margin);
  const buf = out ?? new Float32Array(xs.length * ys.length * 2);
  let k = 0;
  for (const gy of ys) {
    for (const gx of xs) {
      const [x, y] = applyHomography(h, [gx, gy]);
      buf[k++] = x;
      buf[k++] = y;
    }
  }
  return buf;
}

/** Map the base 0..1 mesh UVs into a slice of the video: u = u0 + baseU*(u1-u0), same for v. */
export function scaleUvs(base: Float32Array, rect: SrcRect, out?: Float32Array): Float32Array {
  const buf = out ?? new Float32Array(base.length);
  const du = rect.u1 - rect.u0;
  const dv = rect.v1 - rect.v0;
  for (let i = 0; i < base.length; i += 2) {
    buf[i] = rect.u0 + base[i] * du;
    buf[i + 1] = rect.v0 + base[i + 1] * dv;
  }
  return buf;
}

/** Per-vertex [frameX, frameY, shapeId] on the same grid as warpedPositions(..., margin); the fragment shader's input. */
export function frameCoords(cols: number, rows: number, margin: number, shape: FaceShape, out?: Float32Array): Float32Array {
  const xs = gridLines(cols, margin);
  const ys = gridLines(rows, margin);
  const buf = out ?? new Float32Array(xs.length * ys.length * 3);
  const id = shapeId(shape);
  let k = 0;
  for (const y of ys) {
    for (const x of xs) {
      buf[k++] = x;
      buf[k++] = y;
      buf[k++] = id;
    }
  }
  return buf;
}
