import { applyHomography, computeHomography } from './homography';
import { isValidQuad } from './quad';
import { UNIT_CORNERS, cornersToArray, type Corners, type Vec2 } from './types';

export const GRID = 20;

/** Unit space (0..1, Y down) -> WebGL/WebGPU normalized device coords (-1..1, Y up). */
export const unitToNdc = ([x, y]: Vec2): Vec2 => [x * 2 - 1, 1 - y * 2];

export interface MeshTopology {
  uvs: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
}

/** Static data: uploaded to the GPU once and never changes. */
export function buildTopology(cols = GRID, rows = GRID): MeshTopology {
  const vertexCount = (cols + 1) * (rows + 1);
  const uvs = new Float32Array(vertexCount * 2);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      uvs[k++] = c / cols;
      uvs[k++] = r / rows;
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
 * Returns null (touching nothing) when the quad has no valid perspective transform.
 */
export function warpedPositions(
  corners: Corners,
  cols = GRID,
  rows = GRID,
  out?: Float32Array,
): Float32Array | null {
  if (!isValidQuad(corners)) return null;
  const dst = cornersToArray(corners).map(unitToNdc);
  const h = computeHomography(cornersToArray(UNIT_CORNERS), dst);
  if (!h) return null;
  const buf = out ?? new Float32Array((cols + 1) * (rows + 1) * 2);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const [x, y] = applyHomography(h, [c / cols, r / rows]);
      buf[k++] = x;
      buf[k++] = y;
    }
  }
  return buf;
}
