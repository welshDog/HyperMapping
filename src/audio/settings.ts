import type { KeyValueStore } from '../setups/setups';
import type { Bands } from './bands';

export interface AudioSettings {
  sensitivity: number;
  bass: boolean;
  treble: boolean;
  volume: boolean;
  beatLook: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { sensitivity: 1, bass: true, treble: true, volume: true, beatLook: false };
export const AUDIO_KEY = 'hypermapping.audio.v1';

const SENS_MIN = 0.2;
const SENS_MAX = 3;

/** Whatever was stored (or passed), as a complete valid AudioSettings with only the known keys. Never throws. */
export function parseAudioSettings(raw: unknown): AudioSettings {
  const d = DEFAULT_AUDIO_SETTINGS;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...d };
  const o = raw as Record<string, unknown>;
  const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
  const sens =
    typeof o.sensitivity === 'number' && Number.isFinite(o.sensitivity)
      ? Math.min(SENS_MAX, Math.max(SENS_MIN, o.sensitivity))
      : d.sensitivity;
  return {
    sensitivity: sens,
    bass: bool(o.bass, d.bass),
    treble: bool(o.treble, d.treble),
    volume: bool(o.volume, d.volume),
    beatLook: bool(o.beatLook, d.beatLook),
  };
}

/** Apply the on/off toggles: a turned-off reaction is exactly 0. */
export function masked(levels: Bands, s: AudioSettings): { bass: number; treble: number; vol: number } {
  return {
    bass: s.bass ? levels.bass : 0,
    treble: s.treble ? levels.treble : 0,
    vol: s.volume ? levels.volume : 0,
  };
}

export function loadAudioSettings(store: KeyValueStore | null): AudioSettings {
  if (!store) return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const raw = store.getItem(AUDIO_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
    return parseAudioSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(store: KeyValueStore | null, s: AudioSettings): void {
  if (!store) return;
  try {
    store.setItem(AUDIO_KEY, JSON.stringify(parseAudioSettings(s)));
  } catch {
    // storage full or blocked: forgetting is fine
  }
}
