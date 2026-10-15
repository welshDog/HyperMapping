/** Test support: a fake analyser spectrum with one tone (peak bin plus a 60% neighbour each side). */
export function sineSpectrum(freqHz: number, sampleRate: number, bins: number, amplitude = 1): Uint8Array {
  const out = new Uint8Array(bins);
  const binHz = sampleRate / (2 * bins);
  const centre = Math.round(freqHz / binHz);
  const put = (i: number, f: number) => {
    if (i >= 0 && i < bins) out[i] = Math.round(Math.min(1, Math.max(0, amplitude * f)) * 255);
  };
  put(centre, 1);
  put(centre - 1, 0.6);
  put(centre + 1, 0.6);
  return out;
}
