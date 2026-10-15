export const STALE_START_MS = 100;
export const STALE_END_MS = 400;
export const VOLUME_SPEEDUP = 1.5;
const MAX_DT_SEC = 0.25;

type Levels = { bass: number; treble: number; vol: number };

/** Fade stale levels out linearly between STALE_START_MS and STALE_END_MS of age. */
export function fadeLevels(l: Levels, ageMs: number): Levels {
  if (!(ageMs > STALE_START_MS)) return { ...l };
  const f = Math.max(0, 1 - (ageMs - STALE_START_MS) / (STALE_END_MS - STALE_START_MS));
  return { bass: l.bass * f, treble: l.treble * f, vol: l.vol * f };
}

/** Ease the volume and advance audio time faster when it is loud. Time never goes backwards. */
export function stepAudioTime(
  prev: { smooth: number; atime: number },
  vol: number,
  dtSec: number,
): { smooth: number; atime: number } {
  if (!Number.isFinite(dtSec) || dtSec <= 0) return { ...prev };
  const dt = Math.min(dtSec, MAX_DT_SEC);
  const v = Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0;
  const smooth = prev.smooth + (v - prev.smooth) * Math.min(1, dt * 8);
  const atime = prev.atime + dt * VOLUME_SPEEDUP * Math.max(0, smooth);
  return { smooth, atime };
}
