import type { GeneratorSource } from './source';
import type { GeneratorState } from './shuffle';

export type LookSource = Pick<
  GeneratorSource,
  'video' | 'setState' | 'setAudio' | 'setActive' | 'ensurePlaying' | 'dispose'
>;

type Audio = { bass: number; treble: number; vol: number };

export interface LookPool {
  /** True when every owner given to the last sync has a source (false if any factory call returned null). */
  readonly available: boolean;
  /** Create sources for new owners, dispose those no longer listed. Retries owners that have none. */
  sync(owners: readonly string[]): void;
  /** Exact answer for one owner: does it have a live source right now? */
  hasSource(owner: string): boolean;
  setState(owner: string, state: GeneratorState): void;
  /** Listed owners get setActive(true), every other source false. */
  setActive(owners: ReadonlySet<string>): void;
  setAudio(levels: Audio): void;
  video(owner: string): HTMLVideoElement | null;
  ensurePlaying(): void;
  dispose(): void;
}

/** One generator source per live look. The factory is injected so this runs without a browser. */
export function createLookPool(factory: () => LookSource | null): LookPool {
  const sources = new Map<string, LookSource>();
  const states = new Map<string, GeneratorState>();
  let audio: Audio | null = null;
  let activeSet: ReadonlySet<string> | null = null;
  let available = true;

  return {
    get available() {
      return available;
    },
    sync(owners) {
      const wanted = new Set(owners);
      for (const [owner, src] of [...sources]) {
        if (!wanted.has(owner)) {
          src.dispose();
          sources.delete(owner);
        }
      }
      for (const owner of [...states.keys()]) if (!wanted.has(owner)) states.delete(owner);
      available = true;
      for (const owner of wanted) {
        if (sources.has(owner)) continue;
        const src = factory();
        if (!src) {
          available = false;
          continue;
        }
        sources.set(owner, src);
        const state = states.get(owner);
        if (state) src.setState(state);
        if (audio) src.setAudio(audio);
        if (activeSet) src.setActive(activeSet.has(owner));
      }
    },
    hasSource: (owner) => sources.has(owner),
    setState(owner, state) {
      states.set(owner, state);
      sources.get(owner)?.setState(state);
    },
    setActive(owners) {
      activeSet = owners;
      for (const [owner, src] of sources) src.setActive(owners.has(owner));
    },
    setAudio(levels) {
      audio = levels;
      for (const src of sources.values()) src.setAudio(levels);
    },
    video: (owner) => sources.get(owner)?.video ?? null,
    ensurePlaying() {
      for (const src of sources.values()) src.ensurePlaying();
    },
    dispose() {
      for (const src of sources.values()) src.dispose();
      sources.clear();
      states.clear();
    },
  };
}
