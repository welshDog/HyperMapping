import { describe, it, expect } from 'vitest';
import { loadGeneratorState, saveGeneratorState, GENERATOR_KEY } from './remember';
import { initialState } from './shuffle';
import type { KeyValueStore } from '../setups/setups';

function memStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const rng = () => 0.3;

describe('remembered generator state', () => {
  it('starts from a fresh off state when nothing is stored or there is no store', () => {
    expect(loadGeneratorState(null, 1000, rng)).toEqual(initialState(1000, rng));
    expect(loadGeneratorState(memStore(), 1000, rng)).toEqual(initialState(1000, rng));
  });

  it('restores the look, shuffle and style pick, but never "on"', () => {
    const store = memStore();
    const s = {
      ...initialState(1, rng),
      on: true,
      shuffleSec: 30 as const,
      stylePick: 'neon' as const,
      look: { style: 'neon' as const, seed: 77 },
    };
    saveGeneratorState(store, s);
    expect(JSON.parse(store.data[GENERATOR_KEY]).on).toBeUndefined();
    const back = loadGeneratorState(store, 5000, rng);
    expect(back.on).toBe(false);
    expect(back.look).toEqual({ style: 'neon', seed: 77 });
    expect(back.shuffleSec).toBe(30);
    expect(back.stylePick).toBe('neon');
    expect(back.prev).toBeNull();
    expect(back.changedAt).toBe(5000);
  });

  it('drops extra keys from a stored look', () => {
    const raw = JSON.stringify({
      look: { style: 'neon', seed: 77, evil: 'x', __proto__: { y: 1 } },
      shuffleSec: 15,
      stylePick: 'auto',
    });
    const back = loadGeneratorState(memStore({ [GENERATOR_KEY]: raw }), 5, rng);
    expect(back.look).toEqual({ style: 'neon', seed: 77 });
    expect(Object.keys(back.look)).toEqual(['style', 'seed']);
  });

  it('falls back to a fresh state on junk or a throwing store', () => {
    const fresh = initialState(9, rng);
    expect(loadGeneratorState(memStore({ [GENERATOR_KEY]: 'not json' }), 9, rng)).toEqual(fresh);
    const bad = JSON.stringify({ look: { style: 'x', seed: 1 }, shuffleSec: 7, stylePick: 'auto' });
    expect(loadGeneratorState(memStore({ [GENERATOR_KEY]: bad }), 9, rng)).toEqual(fresh);
    const boom: KeyValueStore = {
      getItem: () => {
        throw new Error('no');
      },
      setItem: () => {
        throw new Error('no');
      },
      removeItem: () => {},
    };
    expect(loadGeneratorState(boom, 9, rng)).toEqual(fresh);
    expect(() => saveGeneratorState(boom, fresh)).not.toThrow();
  });

  it('remembers speed and resets the time fields on load', () => {
    const store = memStore();
    saveGeneratorState(store, { ...initialState(1, rng), speed: 1.5, timeAnchor: 99, speedChangedAt: 7 });
    expect(JSON.parse(store.data[GENERATOR_KEY]).speed).toBe(1.5);
    const back = loadGeneratorState(store, 5000, rng);
    expect(back.speed).toBe(1.5);
    expect(back.timeAnchor).toBe(0);
    expect(back.speedChangedAt).toBe(5000);
  });

  it('old format without speed loads with speed 1 and keeps the look', () => {
    const raw = JSON.stringify({ look: { style: 'neon', seed: 77 }, shuffleSec: 15, stylePick: 'auto' });
    const back = loadGeneratorState(memStore({ [GENERATOR_KEY]: raw }), 5, rng);
    expect(back.speed).toBe(1);
    expect(back.look).toEqual({ style: 'neon', seed: 77 });
    expect(back.shuffleSec).toBe(15);
  });

  it('a bad stored speed falls back to 1 while look and shuffle survive', () => {
    for (const speed of [9, 'fast']) {
      const raw = JSON.stringify({ look: { style: 'neon', seed: 77 }, shuffleSec: 30, stylePick: 'auto', speed });
      const back = loadGeneratorState(memStore({ [GENERATOR_KEY]: raw }), 5, rng);
      expect(back.speed).toBe(1);
      expect(back.look).toEqual({ style: 'neon', seed: 77 });
      expect(back.shuffleSec).toBe(30);
    }
  });
});
