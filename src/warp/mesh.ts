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

/** Grid step -> frame coordinate: 0..1 across the frame, or -margin..1+margin when a margin is given. */
const spread = (i: number, n: number, margin: number) => -margin + (i / n) * (1 + 2 * margin);

/** Static data: uploaded to the GPU once and never changes. A margin spreads the UVs over -margin..1+margin. */
export function buildTopology(cols = GRID, rows = GRID, margin = 0): MeshTopology {
  const vertexCount = (cols + 1) * (rows + 1);
  const uvs = new Float32Array(vertexCount * 2);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      uvs[k++] = spread(c, cols, margin);
      uvs[k++] = spread(r, rows, margin);
    }
  }
  const indices = new Uint16Array(cols * rows * 6);
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * (cols + 1) + c;
      const i1 = i0 + 1;
      const i2 = i0 + cols + 1;
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
 * With a margin the grid covers -margin..1+margin of the frame (default 0: exactly the frame).
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
  const buf = out ?? new Float32Array((cols + 1) * (rows + 1) * 2);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const [x, y] = applyHomography(h, [spread(c, cols, margin), spread(r, rows, margin)]);
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
  const buf = out ?? new Float32Array((cols + 1) * (rows + 1) * 3);
  const id = shapeId(shape);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      buf[k++] = spread(c, cols, margin);
      buf[k++] = spread(r, rows, margin);
      buf[k++] = id;
    }
  }
  return buf;
}
