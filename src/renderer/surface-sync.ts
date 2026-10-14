import { isValidSrcRect } from '../surfaces/model';
import { FULL_RECT, type SrcRect, type Surface } from '../surfaces/types';
import { GRID, buildTopology, scaleUvs, warpedPositions } from '../warp/mesh';
import { UNIT_CORNERS, type Corners } from '../warp/types';

type F32 = Float32Array<ArrayBuffer>;

export interface SurfaceBuffers {
  positions: F32;
  uvs: F32;
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
  /** Draw order (list order). */
  order: string[];
}

interface Entry extends SurfaceBuffers {
  /** Last requested values, so an unchanged or repeatedly invalid request costs nothing. */
  wantCorners: Corners;
  wantRect: SrcRect;
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
  private baseUvs = buildTopology().uvs;
  private floats = this.baseUvs.length;

  buffers(id: string): SurfaceBuffers | undefined {
    return this.entries.get(id);
  }

  sync(surfaces: Surface[]): SyncResult {
    const result: SyncResult = {
      removed: [],
      created: [],
      changedPositions: [],
      changedUvs: [],
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
        continue;
      }
      if (!sameCorners(existing.wantCorners, s.corners)) {
        existing.wantCorners = cloneCorners(s.corners);
        if (warpedPositions(s.corners, GRID, GRID, existing.positions)) result.changedPositions.push(s.id);
      }
      if (!sameRect(existing.wantRect, s.srcRect)) {
        existing.wantRect = { ...s.srcRect };
        if (isValidSrcRect(s.srcRect)) {
          scaleUvs(this.baseUvs, s.srcRect, existing.uvs);
          result.changedUvs.push(s.id);
        }
      }
    }
    return result;
  }

  private create(s: Surface): Entry {
    const positions = new Float32Array(this.floats);
    // An invalid quad on a brand-new face falls back to the full-canvas quad, never garbage.
    if (!warpedPositions(s.corners, GRID, GRID, positions)) warpedPositions(UNIT_CORNERS, GRID, GRID, positions);
    const uvs = new Float32Array(this.floats);
    scaleUvs(this.baseUvs, isValidSrcRect(s.srcRect) ? s.srcRect : FULL_RECT, uvs);
    return { positions, uvs, wantCorners: cloneCorners(s.corners), wantRect: { ...s.srcRect } };
  }
}
