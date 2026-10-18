import { describe, it, expect } from 'vitest';
import { DEFAULT_LOOK_SETTINGS } from '../generator/settings';
import { FULL_RECT, type Surface } from '../surfaces/types';
import { resolveFaceSources, visibleLookOwners, type ResolveContext } from './resolve';

const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] as unknown as Surface['corners'];
const face = (id: string, extra: Partial<Surface> = {}): Surface => ({ id, corners, srcRect: FULL_RECT, ...extra });
const video = (id: string) => face(id);
const pattern = (id: string) => face(id, { source: 'pattern' });
const owner = (id: string) => face(id, { source: 'look', look: DEFAULT_LOOK_SETTINGS });
const sharer = (id: string, of: string) => face(id, { source: 'look', lookOf: of });

const all: ResolveContext = { patternForce: false, hasVideo: true, patternAvailable: true, generatorAvailable: true };
const ctx = (o: Partial<ResolveContext> = {}): ResolveContext => ({ ...all, ...o });

describe('resolveFaceSources', () => {
  const list = [video('v'), pattern('p'), owner('o'), sharer('s', 'o')];

  it('gives one entry per face', () => {
    expect([...resolveFaceSources(list, ctx()).keys()]).toEqual(['v', 'p', 'o', 's']);
  });

  it('uses each own source when everything is available', () => {
    const r = resolveFaceSources(list, ctx());
    expect(r.get('v')).toEqual({ kind: 'video' });
    expect(r.get('p')).toEqual({ kind: 'pattern' });
    expect(r.get('o')).toEqual({ kind: 'look', owner: 'o' });
    expect(r.get('s')).toEqual({ kind: 'look', owner: 'o' });
  });

  it('force overrides every source', () => {
    const r = resolveFaceSources(list, ctx({ patternForce: true }));
    for (const id of ['v', 'p', 'o', 's']) expect(r.get(id)).toEqual({ kind: 'pattern' });
  });

  it('force without a pattern available does not force', () => {
    const r = resolveFaceSources(list, ctx({ patternForce: true, patternAvailable: false }));
    expect(r.get('v')).toEqual({ kind: 'video' });
    expect(r.get('p')).toEqual({ kind: 'video' });
  });

  it('video face without video shows the pattern, then none', () => {
    expect(resolveFaceSources([video('v')], ctx({ hasVideo: false })).get('v')).toEqual({ kind: 'pattern' });
    expect(resolveFaceSources([video('v')], ctx({ hasVideo: false, patternAvailable: false })).get('v')).toEqual({ kind: 'none' });
  });

  it('pattern face falls back to video, then none', () => {
    expect(resolveFaceSources([pattern('p')], ctx({ patternAvailable: false })).get('p')).toEqual({ kind: 'video' });
    expect(resolveFaceSources([pattern('p')], ctx({ patternAvailable: false, hasVideo: false })).get('p')).toEqual({ kind: 'none' });
  });

  it('look faces fall back by the video rule when the generator is unavailable', () => {
    const g = ctx({ generatorAvailable: false });
    expect(resolveFaceSources(list, g).get('o')).toEqual({ kind: 'video' });
    expect(resolveFaceSources(list, g).get('s')).toEqual({ kind: 'video' });
    expect(resolveFaceSources(list, { ...g, hasVideo: false }).get('o')).toEqual({ kind: 'pattern' });
    expect(resolveFaceSources(list, { ...g, hasVideo: false, patternAvailable: false }).get('o')).toEqual({ kind: 'none' });
  });

  it('a per-owner check demotes only the owners without a source', () => {
    const l = [owner('b'), owner('c'), sharer('bs', 'b'), sharer('cs', 'c')];
    const r = resolveFaceSources(l, ctx({ generatorAvailable: (id) => id === 'c' }));
    expect(r.get('b')).toEqual({ kind: 'video' });
    expect(r.get('bs')).toEqual({ kind: 'video' });
    expect(r.get('c')).toEqual({ kind: 'look', owner: 'c' });
    expect(r.get('cs')).toEqual({ kind: 'look', owner: 'c' });
    const r2 = resolveFaceSources(l, ctx({ hasVideo: false, generatorAvailable: (id) => id === 'c' }));
    expect(r2.get('b')).toEqual({ kind: 'pattern' });
  });

  it('a look face with no owner falls back by the video rule', () => {
    const r = resolveFaceSources([sharer('s', 'gone')], ctx());
    expect(r.get('s')).toEqual({ kind: 'video' });
  });

  it('everything unavailable gives none', () => {
    const r = resolveFaceSources(list, ctx({ hasVideo: false, patternAvailable: false, generatorAvailable: false }));
    for (const id of ['v', 'p', 'o', 's']) expect(r.get(id)).toEqual({ kind: 'none' });
  });
});

describe('visibleLookOwners', () => {
  it('two sharers and their owner give one entry', () => {
    const list = [owner('o'), sharer('a', 'o'), sharer('b', 'o')];
    expect([...visibleLookOwners(resolveFaceSources(list, ctx()))]).toEqual(['o']);
  });

  it('is empty when no face resolves to a look', () => {
    const list = [owner('o'), video('v')];
    expect(visibleLookOwners(resolveFaceSources(list, ctx({ patternForce: true }))).size).toBe(0);
  });
});
