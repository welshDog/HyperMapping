import { describe, it, expect } from 'vitest';
import { defaultCorners } from '../surfaces/model';
import { parseSurfaceList } from '../surfaces/parse';
import type { Surface } from '../surfaces/types';
import { MAX_SETUPS, listSetups, saveSetup, type KeyValueStore } from '../setups/setups';
import { applyHomographyChecked } from '../warp/homography';
import { isValidQuad } from '../warp/quad';
import type { Vec2 } from '../warp/types';
import { applyCalibration, tapsToCorners } from './corners';
import { decodeScan } from './decode';
import { calibrationSetupName } from './names';
import { STEP_PX } from './patterns';
import { synthScan } from './synth';

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const rect = (w: number, h: number): Vec2[] => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h],
];

/** A simulated scan of two faces, then everything the panel does up to and including "Save result as setup". */
describe('saving a calibration result before applying it', () => {
  const pw = 128;
  const ph = 72;
  const scan = synthScan({
    pw,
    ph,
    camW: 192,
    camH: 108,
    projCorners: rect(pw, ph),
    camCorners: [
      [8, 6],
      [184, 12],
      [178, 102],
      [4, 98],
    ],
  });
  const map = decodeScan(scan.frames, 192, 108, pw / STEP_PX, ph / STEP_PX);
  const tapsFor = (pts: Vec2[]) => pts.map((q) => applyHomographyChecked(scan.projToCam, q)!) as [Vec2, Vec2, Vec2, Vec2];

  const truthA: Vec2[] = [
    [10, 8],
    [60, 8],
    [60, 60],
    [10, 60],
  ];
  const truthB: Vec2[] = [
    [66, 10],
    [118, 10],
    [118, 62],
    [66, 62],
  ];
  const current: Surface[] = [
    { id: 'a', corners: defaultCorners(0, 3), srcRect: { u0: 0, v0: 0, u1: 0.5, v1: 1 } },
    { id: 'b', corners: defaultCorners(1, 3), srcRect: { u0: 0.5, v0: 0, u1: 1, v1: 1 } },
    { id: 'c', corners: defaultCorners(2, 3), srcRect: { u0: 0, v0: 0, u1: 1, v1: 1 } },
  ];
  const solveFace = (truth: Vec2[]) => {
    const r = tapsToCorners(map, tapsFor(truth), { w: pw, h: ph });
    if (!r.ok) throw new Error('tap failed');
    return r.corners;
  };

  it('saves the new pins as a setup, leaves the current layout alone, and loads back identical', () => {
    const store = memoryStore();
    const before = JSON.stringify(current);
    // Only faces a and b were tapped; c was skipped.
    const solved = { a: solveFace(truthA), b: solveFace(truthB) };
    const result = applyCalibration(current, solved);

    const saved = saveSetup(store, calibrationSetupName(new Date(2026, 9, 15, 11, 30)), result, 1_000);
    expect(saved.ok).toBe(true);

    // The current layout was not touched.
    expect(JSON.stringify(current)).toBe(before);

    // It is in the Setups list under the default name and loads back exactly.
    const list = listSetups(store);
    expect(list.map((s) => s.name)).toEqual(['Calibration 11:30']);
    expect(list[0].surfaces).toEqual(result);
    expect(parseSurfaceList(list[0].surfaces)).not.toBeNull();

    // Tapped faces got the recovered pins (within 1 projector pixel), valid quads, slices intact.
    truthA.forEach((t, i) => {
      const c = [list[0].surfaces[0].corners.tl, list[0].surfaces[0].corners.tr, list[0].surfaces[0].corners.br, list[0].surfaces[0].corners.bl][i];
      expect(Math.abs(c[0] * pw - t[0])).toBeLessThan(1);
      expect(Math.abs(c[1] * ph - t[1])).toBeLessThan(1);
    });
    expect(isValidQuad(list[0].surfaces[0].corners)).toBe(true);
    expect(isValidQuad(list[0].surfaces[1].corners)).toBe(true);
    expect(list[0].surfaces[0].srcRect).toEqual(current[0].srcRect);
    expect(list[0].surfaces[1].srcRect).toEqual(current[1].srcRect);
    // The skipped face keeps its old pins.
    expect(list[0].surfaces[2]).toEqual(current[2]);
  });

  it('saving again under the same name replaces it; a new name adds another', () => {
    const store = memoryStore();
    const first = applyCalibration(current, { a: solveFace(truthA) });
    const second = applyCalibration(current, { a: solveFace(truthA), b: solveFace(truthB) });
    saveSetup(store, 'Calibration 11:30', first, 1);
    const again = saveSetup(store, 'Calibration 11:30', second, 2);
    expect(again.ok && again.replaced).toBe(true);
    expect(listSetups(store).length).toBe(1);
    expect(listSetups(store)[0].surfaces).toEqual(second);
    saveSetup(store, 'Calibration 11:45', first, 3);
    expect(listSetups(store).map((s) => s.name).sort()).toEqual(['Calibration 11:30', 'Calibration 11:45']);
  });

  it('reports the same errors the panel shows: bad name, full, unavailable storage', () => {
    const result = applyCalibration(current, { a: solveFace(truthA) });
    expect(saveSetup(memoryStore(), '   ', result, 1)).toEqual({ ok: false, reason: 'bad-name' });

    const full = memoryStore();
    for (let i = 0; i < MAX_SETUPS; i++) expect(saveSetup(full, `s${i}`, result, i).ok).toBe(true);
    expect(saveSetup(full, 'one too many', result, 99)).toEqual({ ok: false, reason: 'full' });

    const broken: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(saveSetup(broken, 'x', result, 1)).toEqual({ ok: false, reason: 'storage' });
  });
});
