import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../setups/setups';
import {
  AUDIO_KEY,
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  masked,
  parseAudioSettings,
  saveAudioSettings,
} from './settings';

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
const throwing: KeyValueStore = {
  getItem() {
    throw new Error('no');
  },
  setItem() {
    throw new Error('no');
  },
  removeItem() {
    throw new Error('no');
  },
};

describe('audio settings', () => {
  it('defaults', () => {
    expect(DEFAULT_AUDIO_SETTINGS).toEqual({ sensitivity: 1, bass: true, treble: true, volume: true, beatLook: false });
  });
  it('junk gives defaults', () => {
    for (const j of [null, 42, [], {}, { sensitivity: 'x' }, undefined, 'str'])
      expect(parseAudioSettings(j)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
  it('clamps sensitivity', () => {
    expect(parseAudioSettings({ sensitivity: 99 }).sensitivity).toBe(3);
    expect(parseAudioSettings({ sensitivity: 0 }).sensitivity).toBe(0.2);
    expect(parseAudioSettings({ sensitivity: -1 }).sensitivity).toBe(0.2);
    expect(parseAudioSettings({ sensitivity: NaN }).sensitivity).toBe(1);
  });
  it('booleans only accepted as real booleans, extra keys dropped', () => {
    const s = parseAudioSettings({ bass: 'no', treble: 0, volume: false, beatLook: true, listening: true, junk: 1 });
    expect(s).toEqual({ sensitivity: 1, bass: true, treble: true, volume: false, beatLook: true });
    expect('listening' in s).toBe(false);
  });
  it('round trips and omits listening', () => {
    const st = memStore();
    const s = { sensitivity: 2, bass: false, treble: true, volume: false, beatLook: true };
    saveAudioSettings(st, s);
    expect(loadAudioSettings(st)).toEqual(s);
    expect(st.data.get(AUDIO_KEY)).not.toContain('listening');
  });
  it('load is guarded', () => {
    expect(loadAudioSettings(throwing)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(loadAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    const st = memStore();
    st.data.set(AUDIO_KEY, '{not json');
    expect(loadAudioSettings(st)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
  it('save never throws', () => {
    expect(() => saveAudioSettings(throwing, DEFAULT_AUDIO_SETTINGS)).not.toThrow();
    expect(() => saveAudioSettings(null, DEFAULT_AUDIO_SETTINGS)).not.toThrow();
  });
  it('masked zeroes turned-off reactions and keeps the rest', () => {
    const l = { bass: 0.5, mid: 0.4, treble: 0.3, volume: 0.2 };
    expect(masked(l, DEFAULT_AUDIO_SETTINGS)).toEqual({ bass: 0.5, treble: 0.3, vol: 0.2 });
    expect(masked(l, { ...DEFAULT_AUDIO_SETTINGS, bass: false })).toEqual({ bass: 0, treble: 0.3, vol: 0.2 });
    expect(masked(l, { ...DEFAULT_AUDIO_SETTINGS, treble: false })).toEqual({ bass: 0.5, treble: 0, vol: 0.2 });
    expect(masked(l, { ...DEFAULT_AUDIO_SETTINGS, volume: false })).toEqual({ bass: 0.5, treble: 0.3, vol: 0 });
  });
});
