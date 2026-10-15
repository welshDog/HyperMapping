export interface Bands {
  bass: number;
  mid: number;
  treble: number;
  volume: number;
}

const BASS_LO = 20;
const BASS_HI = 150;
const MID_HI = 4000;
const TREBLE_HI = 12000;
const VOLUME_LO = 20;
const VOLUME_HI = 12000;

/** Mean of freq[i]/255 over bins whose centre (i * binHz, bin 0 excluded) lies in [lo, hi]; 0 when none. */
function bandMean(freq: Uint8Array, binHz: number, lo: number, hi: number): number {
  let sum = 0;
  let count = 0;
  for (let i = 1; i < freq.length; i++) {
    const f = i * binHz;
    if (f > hi) break;
    if (f >= lo) {
      sum += freq[i] / 255;
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/** Band levels (each 0..1) from an analyser byte spectrum. Pure; never throws. */
export function bandLevels(freq: Uint8Array, sampleRate: number): Bands {
  if (freq.length === 0 || !(sampleRate > 0)) return { bass: 0, mid: 0, treble: 0, volume: 0 };
  const binHz = sampleRate / (2 * freq.length);
  const nyquist = sampleRate / 2;
  return {
    bass: bandMean(freq, binHz, BASS_LO, BASS_HI),
    mid: bandMean(freq, binHz, BASS_HI, MID_HI),
    treble: bandMean(freq, binHz, MID_HI, Math.min(TREBLE_HI, nyquist)),
    volume: bandMean(freq, binHz, VOLUME_LO, Math.min(VOLUME_HI, nyquist)),
  };
}
