import { isValidSrcRect } from '../surfaces/model';
import { FULL_RECT, shapeOf, type FaceShape, type SrcRect, type Surface } from '../surfaces/types';
import { GRID, buildTopology, frameCoords, scaleUvs, warpedPositions } from '../warp/mesh';
import { meshMargin } from '../warp/shape';
import { UNIT_CORNERS, type Corners } from '../warp/types';

type F32 = Float32Array<ArrayBuffer>;

export interface SurfaceBuffers {
  positions: F32;
  uvs: F32;
  /** Per vertex [frameX, frameY, shapeId]: what the fragment shader cuts the shape out of. */
  frame: F32;
}

export interface SyncResult {
  /** Faces that no longer exist: free their GPU buffers now. */
  removed: string[];
  /** Faces seen for the first time: allocate GPU buffers (they also appear in both changed lists). */
  created: string[];
  /** Faces whose position buffer must be re-uploaded. */
  changedPositions: string[];
  /** Faces whose UV buffer must be re-uploaded. */
  changedUvs: string[];
  /** Faces whose frame-coordinate buffer must be re-uploaded (always includes every created face). */
  changedFrames: string[];
  /** Draw order (list order). */
  order: string[];
}

interface Entry extends SurfaceBuffers {
  /** Last requested values, so an unchanged or repeatedly invalid request costs nothing. */
  wantCorners: Corners;
  wantRect: SrcRect;
  wantShape: FaceShape;
  /** The shape the buffers were last built for (its margin shapes positions and UVs). */
  builtShape: FaceShape;
}

const same = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];
const sameCorners = (a: Corners, b: Corners) => same(a.tl, b.tl) && same(a.tr, b.tr) && same(a.br, b.br) && same(a.bl, b.bl);
const sameRect = (a: SrcRect, b: SrcRect) => a.u0 === b.u0 && a.v0 === b.v0 && a.u1 === b.u1 && a.v1 === b.v1;
const cloneCorners = (c: Corners): Corners => ({
  tl: [c.tl[0], c.tl[1]],
  tr: [c.tr[0], c.tr[1]],
  br: [c.br[0], c.br[1]],
  bl: [c.bl[0], c.bl[1]],
});

/**
 * Pure bookkeeping shared by both GPU backends: turns a face list into per-face vertex
 * and UV arrays and says exactly which GPU buffers to allocate, upload or free.
 * A face with an invalid quad keeps its previous positions; an invalid slice keeps its
 * previous UVs; neither affects any other face.
 */
export class SurfaceSync {
  private entries = new Map<string, Entry>();
  /** Base UV grids by margin: quads use the plain 0..1 grid, shaped faces the one that reaches past the frame. */
  private baseUvs = new Map<number, Float32Array>();
  private floats = buildTopology().uvs.length;

  private base(shape: FaceShape): Float32Array {
    const margin = meshMargin(shape);
    let b = this.baseUvs.get(margin);
    if (!b) {
      b = buildTopology(GRID, GRID, margin).uvs;
      this.baseUvs.set(margin, b);
    }
    return b;
  }

  buffers(id: string): SurfaceBuffers | undefined {
    return this.entries.get(id);
  }

  sync(surfaces: Surface[]): SyncResult {
    const result: SyncResult = {
      removed: [],
      created: [],
      changedPositions: [],
      changedUvs: [],
      changedFrames: [],
      order: surfaces.map((s) => s.id),
    };
    const present = new Set(result.order);
    for (const id of [...this.entries.keys()]) {
      if (!present.has(id)) {
        this.entries.delete(id);
        result.removed.push(id);
      }
    }
    for (const s of surfaces) {
      const existing = this.entries.get(s.id);
      if (!existing) {
        this.entries.set(s.id, this.create(s));
        result.created.push(s.id);
        result.changedPositions.push(s.id);
        result.changedUvs.push(s.id);
        result.changedFrames.push(s.id);
        continue;
      }
      const shape = shapeOf(s);
      const cornersChanged = !sameCorners(existing.wantCorners, s.corners);
      const shapeChanged = existing.wantShape !== shape;
      if (cornersChanged || shapeChanged) {
        existing.wantCorners = cloneCorners(s.corners);
        existing.wantShape = shape;
        // A frame with no valid warp freezes the whole face (positions, UVs and frame stay consistent).
        if (warpedPositions(s.corners, GRID, GRID, existing.positions, meshMargin(shape))) {
          result.changedPositions.push(s.id);
          if (shape !== existing.builtShape) {
            existing.builtShape = shape;
            frameCoords(GRID, GRID, meshMargin(shape), shape, existing.frame);
            result.changedFrames.push(s.id);
            if (isValidSrcRect(s.srcRect)) {
              scaleUvs(this.base(shape), s.srcRect, existing.uvs);
              existing.wantRect = { ...s.srcRect };
              result.changedUvs.push(s.id);
            }
          }
        }
      }
      if (!sameRect(existing.wantRect, s.srcRect)) {
        existing.wantRect = { ...s.srcRect };
        if (isValidSrcRect(s.srcRect)) {
          scaleUvs(this.base(existing.builtShape), s.srcRect, existing.uvs);
          if (!result.changedUvs.includes(s.id)) result.changedUvs.push(s.id);
        }
      }
    }
    return result;
  }

  private create(s: Surface): Entry {
    const shape = shapeOf(s);
    const margin = meshMargin(shape);
    const positions = new Float32Array(this.floats);
    // An invalid quad on a brand-new face falls back to the full-canvas quad, never garbage.
    if (!warpedPositions(s.corners, GRID, GRID, positions, margin)) warpedPositions(UNIT_CORNERS, GRID, GRID, positions, margin);
    const uvs = new Float32Array(this.floats);
    scaleUvs(this.base(shape), isValidSrcRect(s.srcRect) ? s.srcRect : FULL_RECT, uvs);
    const frame = frameCoords(GRID, GRID, margin, shape) as F32;
    return { positions, uvs, frame, wantCorners: cloneCorners(s.corners), wantRect: { ...s.srcRect }, wantShape: shape, builtShape: shape };
  }
}
