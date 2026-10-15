export const MAX_ANALYSIS_WIDTH = 640;
/** Keeps a scan-result (5 bytes/pixel as base64) well under the relay's body cap, whatever the phone's orientation. */
export const MAX_ANALYSIS_PIXELS = 400_000;

/** The size the phone analyses at: at most 640 wide and 400k pixels, aspect preserved, never upscaled. Throws on a bad video size. */
export function analysisSize(vw: number, vh: number): { w: number; h: number } {
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) throw new Error('the camera gave no picture');
  const w = Math.max(1, Math.min(MAX_ANALYSIS_WIDTH, Math.floor(vw), Math.floor(Math.sqrt((MAX_ANALYSIS_PIXELS * vw) / vh))));
  const h = Math.max(1, Math.round((w * vh) / vw));
  return { w, h };
}
