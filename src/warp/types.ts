export type Vec2 = [number, number];

/** Corner order everywhere in the app: tl, tr, br, bl (clockwise from top-left). */
export interface Corners {
  tl: Vec2;
  tr: Vec2;
  br: Vec2;
  bl: Vec2;
}

export const UNIT_CORNERS: Corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };

export const cornersToArray = (c: Corners): Vec2[] => [c.tl, c.tr, c.br, c.bl];
