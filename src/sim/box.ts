import type { V3 } from './math';

/** A box standing on the floor (y from 0 to height), centred on the origin, rotated about Y. */
export interface Box {
  width: number;
  height: number;
  depth: number;
  yawDeg: number;
}

export type FaceId = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface Face {
  id: FaceId;
  /** Four corners in world space. */
  corners: V3[];
  /** Outward unit normal in world space. */
  normal: V3;
}

export function boxFaces(box: Box): Face[] {
  const hw = box.width / 2;
  const hd = box.depth / 2;
  const h = box.height;
  const yaw = (box.yawDeg * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Rotation about +Y (same as three.js rotation.y): +Z turns towards +X.
  const rot = ([x, y, z]: V3): V3 => [c * x + s * z, y, -s * x + c * z];

  const defs: { id: FaceId; normal: V3; corners: V3[] }[] = [
    { id: 'front', normal: [0, 0, 1], corners: [[-hw, h, hd], [hw, h, hd], [hw, 0, hd], [-hw, 0, hd]] },
    { id: 'back', normal: [0, 0, -1], corners: [[hw, h, -hd], [-hw, h, -hd], [-hw, 0, -hd], [hw, 0, -hd]] },
    { id: 'right', normal: [1, 0, 0], corners: [[hw, h, hd], [hw, h, -hd], [hw, 0, -hd], [hw, 0, hd]] },
    { id: 'left', normal: [-1, 0, 0], corners: [[-hw, h, -hd], [-hw, h, hd], [-hw, 0, hd], [-hw, 0, -hd]] },
    { id: 'top', normal: [0, 1, 0], corners: [[-hw, h, -hd], [hw, h, -hd], [hw, h, hd], [-hw, h, hd]] },
    { id: 'bottom', normal: [0, -1, 0], corners: [[-hw, 0, hd], [hw, 0, hd], [hw, 0, -hd], [-hw, 0, -hd]] },
  ];
  return defs.map((d) => ({ id: d.id, normal: rot(d.normal), corners: d.corners.map(rot) }));
}
