import { describe, expect, it } from 'vitest';
import { createLookPool, type LookSource } from './pool';
import type { GeneratorState } from './shuffle';

interface Fake extends LookSource {
  calls: string[];
  states: GeneratorState[];
  audio: { bass: number; treble: number; vol: number }[];
  actives: boolean[];
  disposed: number;
}

function makeFake(): Fake {
  const f: Fake = {
    calls: [],
    states: [],
    audio: [],
    actives: [],
    disposed: 0,
    video: { tag: 'video' } as unknown as HTMLVideoElement,
    setState: (s) => void f.states.push(s),
    setAudio: (l) => void f.audio.push(l),
    setActive: (a) => void f.actives.push(a),
    ensurePlaying: () => void f.calls.push('play'),
    dispose: () => void f.disposed++,
  };
  return f;
}

const st = (n: number) => ({ on: true, n }) as unknown as GeneratorState;

function setup() {
  const made: Fake[] = [];
  const pool = createLookPool(() => {
    const f = makeFake();
    made.push(f);
    return f;
  });
  return { made, pool };
}

describe('createLookPool', () => {
  it('creates and disposes sources following sync, never recreating', () => {
    const { made, pool } = setup();
    pool.sync(['a', 'b']);
    expect(made).toHaveLength(2);
    pool.sync(['a', 'b']);
    expect(made).toHaveLength(2);
    pool.sync(['a']);
    expect(made[0].disposed).toBe(0);
    expect(made[1].disposed).toBe(1);
    expect(pool.video('b')).toBeNull();
    expect(pool.video('a')).toBe(made[0].video);
  });

  it('delivers the last state and audio to a new source', () => {
    const { made, pool } = setup();
    pool.setState('a', st(1));
    pool.setState('a', st(2));
    pool.setAudio({ bass: 0.1, treble: 0.2, vol: 0.3 });
    pool.sync(['a']);
    expect(made[0].states).toEqual([st(2)]);
    expect(made[0].audio).toEqual([{ bass: 0.1, treble: 0.2, vol: 0.3 }]);
  });

  it('forwards setState to an existing source', () => {
    const { made, pool } = setup();
    pool.sync(['a']);
    pool.setState('a', st(5));
    expect(made[0].states).toEqual([st(5)]);
  });

  it('splits setActive true/false', () => {
    const { made, pool } = setup();
    pool.sync(['a', 'b']);
    pool.setActive(new Set(['a']));
    expect(made[0].actives).toEqual([true]);
    expect(made[1].actives).toEqual([false]);
  });

  it('forwards audio and ensurePlaying to all sources', () => {
    const { made, pool } = setup();
    pool.sync(['a', 'b']);
    pool.setAudio({ bass: 1, treble: 1, vol: 1 });
    pool.ensurePlaying();
    for (const f of made) {
      expect(f.audio).toHaveLength(1);
      expect(f.calls).toEqual(['play']);
    }
  });

  it('survives a null factory and recovers on a later sync', () => {
    let ok = false;
    const pool = createLookPool(() => (ok ? makeFake() : null));
    expect(() => pool.sync(['a'])).not.toThrow();
    expect(pool.available).toBe(false);
    expect(pool.video('a')).toBeNull();
    expect(() => pool.setState('a', st(1))).not.toThrow();
    ok = true;
    pool.sync(['a']);
    expect(pool.available).toBe(true);
    expect(pool.video('a')).not.toBeNull();
  });

  it('hasSource is exact per owner whichever factory call fails last', () => {
    let failB = true;
    let n = 0;
    const pool = createLookPool(() => (n++ === 0 && failB ? null : makeFake()));
    pool.sync(['b', 'c']); // b fails (first call), c succeeds (last call)
    expect(pool.hasSource('b')).toBe(false);
    expect(pool.hasSource('c')).toBe(true);
    expect(pool.available).toBe(false);
    failB = false;
    pool.sync(['b', 'c']); // b recovers, c is kept
    expect(pool.hasSource('b')).toBe(true);
    expect(pool.hasSource('c')).toBe(true);
    expect(pool.available).toBe(true);
    const last = createLookPool(() => (n++ % 2 === 0 ? makeFake() : null));
    n = 0;
    last.sync(['x', 'y']); // x ok, y (last call) fails
    expect(last.hasSource('x')).toBe(true);
    expect(last.hasSource('y')).toBe(false);
  });

  it('dispose disposes everything and is safe twice', () => {
    const { made, pool } = setup();
    pool.sync(['a', 'b']);
    pool.dispose();
    pool.dispose();
    expect(made.map((f) => f.disposed)).toEqual([1, 1]);
    expect(pool.video('a')).toBeNull();
  });
});

describe('rekey', () => {
  it('moves the same source instance to the new id; a later sync keeps it and disposes nothing', () => {
    const { made, pool } = setup();
    pool.sync(['a', 'b']);
    pool.setState('a', st(1));
    const vid = pool.video('a');
    pool.rekey('a', 's');
    expect(pool.hasSource('a')).toBe(false);
    expect(pool.hasSource('s')).toBe(true);
    expect(pool.video('s')).toBe(vid);
    pool.sync(['s', 'b']);
    expect(made).toHaveLength(2);
    expect(made.every((f) => f.disposed === 0)).toBe(true);
    pool.setActive(new Set(['s']));
    expect(made[0].actives.at(-1)).toBe(true);
    expect(made[1].actives.at(-1)).toBe(false);
  });
  it('later calls for the new id reach the moved source; the old id reaches nothing', () => {
    const { made, pool } = setup();
    pool.sync(['a']);
    pool.rekey('a', 's');
    pool.setState('s', st(7));
    pool.setState('a', st(8));
    expect(made[0].states.at(-1)).toEqual(st(7));
    expect(pool.video('a')).toBeNull();
  });
  it('is a no-op when `from` has no source or `to` already has one', () => {
    const { made, pool } = setup();
    pool.sync(['a', 'b']);
    pool.rekey('zz', 'q');
    expect(pool.hasSource('q')).toBe(false);
    pool.rekey('a', 'b');
    expect(pool.video('a')).toBe(made[0].video);
    expect(pool.video('b')).toBe(made[1].video);
    pool.rekey('a', 'a');
    expect(pool.hasSource('a')).toBe(true);
  });
});
