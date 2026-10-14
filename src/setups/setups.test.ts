import { describe, it, expect } from 'vitest';
import { defaultCorners } from '../surfaces/model';
import { FULL_RECT, type Surface } from '../surfaces/types';
import {
  AUTOSAVE_KEY,
  FILE_MAX_CHARS,
  MAX_SETUPS,
  SETUPS_KEY,
  clearAutosave,
  deleteSetup,
  fileNameFor,
  listSetups,
  loadAutosave,
  normalizeName,
  parseSetupFile,
  saveAutosave,
  saveSetup,
  setupToFile,
  type KeyValueStore,
} from './setups';

class MemStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}
const throwing: KeyValueStore = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('quota');
  },
  removeItem() {
    throw new Error('blocked');
  },
};
const faces = (n = 1): Surface[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, corners: defaultCorners(i, n), srcRect: FULL_RECT }));

describe('normalizeName', () => {
  it('trims and accepts normal names, including unicode and exactly 40 characters', () => {
    expect(normalizeName('  My box  ')).toBe('My box');
    expect(normalizeName('Café ünï')).toBe('Café ünï');
    expect(normalizeName('x'.repeat(40))).toBe('x'.repeat(40));
  });
  it('rejects empty, blank, too long and control characters', () => {
    expect(normalizeName('')).toBeNull();
    expect(normalizeName('   ')).toBeNull();
    expect(normalizeName('x'.repeat(41))).toBeNull();
    expect(normalizeName('bad\u0007name')).toBeNull();
    expect(normalizeName('line\nbreak')).toBeNull();
  });
});

describe('saveSetup / listSetups / deleteSetup', () => {
  it('saves, lists newest first, and reports replace', () => {
    const store = new MemStore();
    const a = saveSetup(store, 'A', faces(1), 1000);
    expect(a).toMatchObject({ ok: true, replaced: false });
    const b = saveSetup(store, 'B', faces(2), 2000);
    expect(b.ok && b.setups.map((s) => s.name)).toEqual(['B', 'A']);
    expect(listSetups(store).map((s) => s.name)).toEqual(['B', 'A']);
    const again = saveSetup(store, ' A ', faces(3), 3000);
    expect(again).toMatchObject({ ok: true, replaced: true });
    expect(listSetups(store).map((s) => s.name)).toEqual(['A', 'B']);
    expect(listSetups(store)[0].surfaces).toHaveLength(3);
    expect(listSetups(store)).toHaveLength(2);
  });

  it('stores a deep copy: changing the original afterwards does not change the save', () => {
    const store = new MemStore();
    const live = faces(1);
    saveSetup(store, 'A', live, 1);
    live[0].corners.tl[0] = 0.9;
    live[0].srcRect.u1 = 0.2;
    expect(listSetups(store)[0].surfaces[0].corners.tl[0]).not.toBe(0.9);
    expect(listSetups(store)[0].surfaces[0].srcRect.u1).toBe(1);
  });

  it('refuses a 31st new name but still allows replacing at the limit', () => {
    const store = new MemStore();
    for (let i = 0; i < MAX_SETUPS; i++) expect(saveSetup(store, `n${i}`, faces(1), i).ok).toBe(true);
    expect(saveSetup(store, 'one-too-many', faces(1), 99)).toEqual({ ok: false, reason: 'full' });
    expect(saveSetup(store, 'n3', faces(2), 100)).toMatchObject({ ok: true, replaced: true });
    expect(listSetups(store)).toHaveLength(MAX_SETUPS);
  });

  it('refuses bad names and bad face lists', () => {
    const store = new MemStore();
    expect(saveSetup(store, '   ', faces(1), 1)).toEqual({ ok: false, reason: 'bad-name' });
    expect(saveSetup(store, 'A', [], 1)).toEqual({ ok: false, reason: 'bad-surfaces' });
    const bad = faces(1);
    bad[0].srcRect = { u0: 0.5, v0: 0, u1: 0.5, v1: 1 };
    expect(saveSetup(store, 'A', bad, 1)).toEqual({ ok: false, reason: 'bad-surfaces' });
    expect(listSetups(store)).toEqual([]);
  });

  it('reports storage problems instead of throwing', () => {
    expect(saveSetup(throwing, 'A', faces(1), 1)).toEqual({ ok: false, reason: 'storage' });
    expect(listSetups(throwing)).toEqual([]);
    expect(deleteSetup(throwing, 'A')).toEqual([]);
  });

  it('ignores corrupt or foreign stored data', () => {
    const store = new MemStore();
    store.setItem(SETUPS_KEY, '{not json');
    expect(listSetups(store)).toEqual([]);
    store.setItem(SETUPS_KEY, JSON.stringify({ not: 'an array' }));
    expect(listSetups(store)).toEqual([]);
    store.setItem(
      SETUPS_KEY,
      JSON.stringify([
        { name: 'good', savedAt: 5, surfaces: faces(1) },
        { name: '', savedAt: 5, surfaces: faces(1) },
        { name: 'no faces', savedAt: 5, surfaces: [] },
        { name: 'bad faces', savedAt: 5, surfaces: [{ id: 'x' }] },
        'junk',
        null,
        { name: 'good', savedAt: 9, surfaces: faces(2) },
      ]),
    );
    const list = listSetups(store);
    expect(list.map((s) => s.name)).toEqual(['good']); // invalid skipped, duplicate name keeps the newest
    expect(list[0].savedAt).toBe(9);
    expect(list[0].surfaces).toHaveLength(2);
  });

  it('deletes by name and ignores unknown names', () => {
    const store = new MemStore();
    saveSetup(store, 'A', faces(1), 1);
    saveSetup(store, 'B', faces(1), 2);
    expect(deleteSetup(store, 'A').map((s) => s.name)).toEqual(['B']);
    expect(deleteSetup(store, 'nope').map((s) => s.name)).toEqual(['B']);
    expect(listSetups(store).map((s) => s.name)).toEqual(['B']);
  });
});

describe('setup files', () => {
  const setup = { name: 'Box 1', savedAt: 1234, surfaces: faces(3) };

  it('round-trips', () => {
    expect(parseSetupFile(setupToFile(setup))).toEqual(setup);
  });

  it('rejects text that is not a HyperMapping setup', () => {
    expect(parseSetupFile('')).toBeNull();
    expect(parseSetupFile('{not json')).toBeNull();
    expect(parseSetupFile('[]')).toBeNull();
    expect(parseSetupFile('null')).toBeNull();
    const ok = JSON.parse(setupToFile(setup));
    expect(parseSetupFile(JSON.stringify({ ...ok, app: 'other' }))).toBeNull();
    expect(parseSetupFile(JSON.stringify({ ...ok, kind: 'scene' }))).toBeNull();
    expect(parseSetupFile(JSON.stringify({ ...ok, version: 2 }))).toBeNull();
    expect(parseSetupFile(JSON.stringify({ ...ok, surfaces: [] }))).toBeNull();
    expect(parseSetupFile(JSON.stringify({ ...ok, surfaces: faces(7) }))).toBeNull();
    expect(parseSetupFile(JSON.stringify({ ...ok, surfaces: [{ id: 'a' }] }))).toBeNull();
  });

  it('rejects oversized text', () => {
    expect(parseSetupFile(' '.repeat(FILE_MAX_CHARS + 1))).toBeNull();
  });

  it('repairs a missing name and time, and drops unknown fields', () => {
    const ok = JSON.parse(setupToFile(setup));
    const r = parseSetupFile(JSON.stringify({ ...ok, name: 42, savedAt: 'yesterday', evil: true }))!;
    expect(r).toEqual({ name: 'Imported setup', savedAt: 0, surfaces: setup.surfaces });
    expect(Object.keys(r).sort()).toEqual(['name', 'savedAt', 'surfaces']);
    expect(parseSetupFile(JSON.stringify({ ...ok, name: 'x'.repeat(100) }))!.name).toBe('Imported setup');
  });

  it('is not fooled by __proto__ keys', () => {
    const text = `{"app":"hypermapping","kind":"setup","version":1,"name":"x","savedAt":1,"__proto__":{"polluted":true},"surfaces":${JSON.stringify(faces(1))}}`;
    const r = parseSetupFile(text)!;
    expect(r.name).toBe('x');
    expect((r as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('fileNameFor', () => {
  it('makes a safe slug', () => {
    expect(fileNameFor('My Box!')).toBe('hypermapping-my-box.json');
    expect(fileNameFor('../../etc/passwd')).toBe('hypermapping-etc-passwd.json');
    expect(fileNameFor('Café Ünï')).toBe('hypermapping-cafe-uni.json');
    expect(fileNameFor('')).toBe('hypermapping-setup.json');
    expect(fileNameFor('!!!')).toBe('hypermapping-setup.json');
    expect(fileNameFor('x'.repeat(100)).length).toBeLessThanOrEqual('hypermapping-.json'.length + 40);
  });
});

describe('autosave', () => {
  it('round-trips and clears', () => {
    const store = new MemStore();
    expect(loadAutosave(store)).toBeNull();
    expect(saveAutosave(store, faces(3), 5)).toBe(true);
    expect(loadAutosave(store)).toEqual(faces(3));
    clearAutosave(store);
    expect(loadAutosave(store)).toBeNull();
  });
  it('ignores corrupt or invalid autosave data', () => {
    const store = new MemStore();
    store.setItem(AUTOSAVE_KEY, '{nope');
    expect(loadAutosave(store)).toBeNull();
    store.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: 1, surfaces: [] }));
    expect(loadAutosave(store)).toBeNull();
    store.setItem(AUTOSAVE_KEY, JSON.stringify('text'));
    expect(loadAutosave(store)).toBeNull();
    store.setItem(AUTOSAVE_KEY, 'null');
    expect(loadAutosave(store)).toBeNull();
  });
  it('refuses to save an invalid layout and never throws on a bad store', () => {
    const store = new MemStore();
    expect(saveAutosave(store, [], 1)).toBe(false);
    expect(store.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(saveAutosave(throwing, faces(1), 1)).toBe(false);
    expect(loadAutosave(throwing)).toBeNull();
    expect(() => clearAutosave(throwing)).not.toThrow();
  });
});
