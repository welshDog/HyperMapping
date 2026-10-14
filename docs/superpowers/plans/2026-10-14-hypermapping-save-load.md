# HyperMapping Save / Load Setups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Lyndz save the current face layout under a name in the browser, load or delete saved setups, export/import a setup as a file, and have the Editor restore the last layout on reload (with a Start fresh button).

**Architecture:** A pure `src/setups/` module (format, validation, list/save/delete, autosave, debounce) works against a tiny `KeyValueStore` interface so it is fully unit-testable with an in-memory store. The face-list parser used by the channel moves to a shared `src/surfaces/parse.ts`, so channel messages, saved setups and imported files are all checked by ONE strict parser. A thin React panel (`SetupsPanel`) and a few Editor edits wire it in.

**Tech Stack:** React 18, TypeScript 5.9 (strict), Vite 5, Vitest 2 (Node env), Tailwind 3, `localStorage`.

**Spec:** `docs/superpowers/specs/2026-10-14-save-load-design.md`

## Global Constraints

- A setup is `{ name, savedAt, surfaces }`. Limits: `MAX_SETUPS = 30`; name 1..40 characters after trimming, no control characters; setup file at most `FILE_MAX_CHARS = 200_000` characters.
- Storage keys: `hypermapping.setups.v1` (JSON array of setups) and `hypermapping.autosave.v1` (JSON `{ savedAt, surfaces }`).
- File format: `{ "app": "hypermapping", "kind": "setup", "version": 1, "name", "savedAt", "surfaces" }`.
- Every face list that enters from outside (channel, stored data, imported file) is rebuilt from validated fields by the ONE shared `parseSurfaceList`; unknown fields are dropped; nothing raw reaches the app.
- No storage or file operation may throw into the UI: a throwing/blocked store gives `[]` / `false` / a `'storage'` result and a plain message.
- Saving a name that exists replaces it; a NEW name when 30 exist is refused (`'full'`); saving replaces, never duplicates.
- The video is NOT saved. Loading a setup replaces the face list through the existing `adoptLayoutRef` path (publish, select first face, repaint). The status line tells the user to re-pick the video when none is loaded.
- Auto-restore: the Editor's initial face list is `loadAutosave(store) ?? INITIAL_SURFACES`; every `publish` schedules a debounced (400 ms) autosave; it also flushes on `pagehide`, when the page becomes hidden, and on unmount; **Start fresh** adopts `INITIAL_SURFACES` and clears the autosave.
- Existing behaviour unchanged: `protocol.ts` accepts/rejects exactly what it did (its tests stay green untouched); nothing under `src/sim/` changes.
- Every commit passes `npx tsc --noEmit`, `npm test`, `npm run build`; the test count only goes up. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `git add` anything under `.superpowers/` or the user's untracked `sim.html`.
- Working directory for every command: `h:\HYPERFOCUSZONE\HperCore\HyperMapping`. The machine is short of RAM: do not start the dev server; verify with tsc, vitest and the build only.

## Review Focus

1. **Corrupt, foreign or hostile data never crashes or reaches the app**: bad JSON, wrong shapes, `__proto__` keys, oversized text, >6 faces, duplicate ids, NaN, bad slices in stored data, autosave and imported files. Tested in Tasks 1-2.
2. **Storage failures** (quota, private window, blocked access) give messages or `false`/`[]`, never exceptions. Tested in Tasks 2-3; the panel's handling is read in review.
3. **Auto-restore is correct and safe**: a valid autosave is restored; an invalid one is ignored; Start fresh clears it; a restored layout reaches an already-open Output window. Tested in Task 2 (load/clear), wiring read in Task 4.
4. **Naming, replace and limit rules**: replace on same name, refuse the 31st new name, refuse bad names. Tested in Task 2.
5. **Debounce correctness and no leaks**: rapid edits save only the latest list after the delay; flush saves immediately exactly once; cancel drops; timers/listeners are cleaned up. Tested in Task 3; Editor cleanup read in Task 4.

---

## File Structure

```
src/surfaces/parse.ts            shared strict face-list parser (moved from protocol.ts) (+ parse.test.ts)
src/output/protocol.ts           imports the shared parser (behaviour unchanged)
src/setups/setups.ts             Setup format, validation, list/save/delete, file, autosave (+ setups.test.ts)
src/setups/autosave.ts           createAutosaver (debounce) (+ autosave.test.ts)
src/setups/browser-store.ts      getBrowserStore() (localStorage or null)
src/setups/download.ts           downloadText() (DOM)
src/ui/SetupsPanel.tsx           the panel
src/ui/Editor.tsx                Setups button, panel, auto-restore, Start fresh, flush
README.md                        "Saving your setup" section
```

---

### Task 1: Move the face-list parser to a shared module

**Files:**
- Create: `src/surfaces/parse.ts`, `src/surfaces/parse.test.ts`
- Modify (full replacement): `src/output/protocol.ts`

**Interfaces:**
- Produces: `parseSurfaceList(raw: unknown): Surface[] | null` (returns freshly built objects; null on anything invalid, empty, >6, duplicate ids, non-array).
- `protocol.ts` keeps exactly the same exports and behaviour (`CHANNEL`, `Msg`, `parseMsg`).

- [ ] **Step 1: Write the failing test**

`src/surfaces/parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseSurfaceList } from './parse';

const corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
const rect = { u0: 0, v0: 0, u1: 1, v1: 1 };
const surface = (id = 's1', over: Record<string, unknown> = {}) => ({ id, corners, srcRect: rect, ...over });

describe('parseSurfaceList', () => {
  it('accepts a valid list and returns fresh objects (not the input references)', () => {
    const input = [surface('s1'), surface('s2')];
    const out = parseSurfaceList(input)!;
    expect(out).toEqual(input);
    expect(out[0]).not.toBe(input[0]);
    expect(out[0].srcRect).not.toBe(input[0].srcRect);
  });
  it('drops unknown fields', () => {
    expect(parseSurfaceList([surface('s1', { evil: 1 })])).toEqual([surface('s1')]);
  });
  it('rejects non-arrays, empty lists and more than 6 faces', () => {
    expect(parseSurfaceList(undefined)).toBeNull();
    expect(parseSurfaceList('nope')).toBeNull();
    expect(parseSurfaceList({})).toBeNull();
    expect(parseSurfaceList([])).toBeNull();
    expect(parseSurfaceList(Array.from({ length: 7 }, (_, i) => surface('s' + (i + 1))))).toBeNull();
  });
  it('rejects bad entries, ids, corners and slices', () => {
    expect(parseSurfaceList([null])).toBeNull();
    expect(parseSurfaceList(['x'])).toBeNull();
    expect(parseSurfaceList([surface('a'), surface('a')])).toBeNull();
    expect(parseSurfaceList([surface('a', { id: 5 })])).toBeNull();
    expect(parseSurfaceList([surface('')])).toBeNull();
    expect(parseSurfaceList([surface('x'.repeat(33))])).toBeNull();
    expect(parseSurfaceList([surface('a', { corners: { ...corners, tl: [NaN, 0] } })])).toBeNull();
    expect(parseSurfaceList([surface('a', { corners: { tl: [0, 0] } })])).toBeNull();
    expect(parseSurfaceList([surface('a', { srcRect: { u0: 0.5, v0: 0, u1: 0.5, v1: 1 } })])).toBeNull();
    expect(parseSurfaceList([surface('a', { srcRect: { u0: '0', v0: 0, u1: 1, v1: 1 } })])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/surfaces/parse.test.ts`
Expected: FAIL — `./parse` not found.

- [ ] **Step 3: Implement**

`src/surfaces/parse.ts` (the helpers are lifted unchanged from `protocol.ts`):
```ts
import type { Vec2 } from '../warp/types';
import { isValidSurfaces } from './model';
import { MAX_SURFACES, type Surface } from './types';

const isVec2 = (v: unknown): v is Vec2 =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Rebuild one face from validated parts only; anything unexpected rejects the whole list. */
function parseSurface(raw: unknown): Surface | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const c = s.corners as Record<string, unknown> | undefined;
  const r = s.srcRect as Record<string, unknown> | undefined;
  if (typeof s.id !== 'string' || !c || !r) return null;
  if (!(isVec2(c.tl) && isVec2(c.tr) && isVec2(c.br) && isVec2(c.bl))) return null;
  if (!(isNum(r.u0) && isNum(r.v0) && isNum(r.u1) && isNum(r.v1))) return null;
  return {
    id: s.id,
    corners: { tl: c.tl, tr: c.tr, br: c.br, bl: c.bl },
    srcRect: { u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1 },
  };
}

/**
 * A whole face list from untrusted data (channel message, stored setup, imported file).
 * Rebuilt from validated fields only; null if anything is wrong.
 */
export function parseSurfaceList(raw: unknown): Surface[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SURFACES) return null;
  const out: Surface[] = [];
  for (const item of raw) {
    const s = parseSurface(item);
    if (!s) return null;
    out.push(s);
  }
  return isValidSurfaces(out) ? out : null;
}
```
Note: `Vec2` tuples inside `corners` are the received arrays (as before); the parser's "fresh objects" guarantee in the test is for the face, `corners` and `srcRect` objects.

Replace `src/output/protocol.ts` with:
```ts
import { parseSurfaceList } from '../surfaces/parse';
import type { Surface } from '../surfaces/types';

export const CHANNEL = 'hypermapping';

export type Msg =
  | { type: 'hello' } // output window -> editor: "send me everything you have"
  | { type: 'surfaces'; surfaces: Surface[] } // editor -> output: the whole face list
  | { type: 'layout'; surfaces: Surface[] } // simulator -> editor: "use this face layout"
  | { type: 'video'; blob: Blob }; // editor -> output (structured-clone copy)

/** Validate anything that arrives on the channel; never trust the wire. */
export function parseMsg(data: unknown): Msg | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  switch (d.type) {
    case 'hello':
      return { type: 'hello' };
    case 'surfaces':
    case 'layout': {
      const surfaces = parseSurfaceList(d.surfaces);
      return surfaces ? { type: d.type, surfaces } : null;
    }
    case 'video':
      return d.blob instanceof Blob ? { type: 'video', blob: d.blob } : null;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/surfaces src/output && npx tsc --noEmit && npm test`
Expected: all pass; `src/output/protocol.test.ts` passes UNCHANGED (that is the proof that behaviour did not change); the total test count is higher by the new parse tests.

- [ ] **Step 5: Commit**

```bash
git add src/surfaces/parse.ts src/surfaces/parse.test.ts src/output/protocol.ts
git commit -m "refactor: share one strict face-list parser between the channel and saved data

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The setups module (format, list/save/delete, file, autosave)

**Files:**
- Create: `src/setups/setups.ts`
- Test: `src/setups/setups.test.ts`

**Interfaces:**
- Consumes: `parseSurfaceList`, `Surface`.
- Produces: `interface Setup`, `interface KeyValueStore`, `MAX_SETUPS`, `NAME_MAX`, `FILE_MAX_CHARS`, `SETUPS_KEY`, `AUTOSAVE_KEY`, `normalizeName`, `listSetups`, `type SaveResult`, `saveSetup`, `deleteSetup`, `setupToFile`, `parseSetupFile`, `fileNameFor`, `saveAutosave`, `loadAutosave`, `clearAutosave`.

- [ ] **Step 1: Write the failing test**

`src/setups/setups.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/setups/setups.test.ts`
Expected: FAIL — `./setups` not found.

- [ ] **Step 3: Implement**

`src/setups/setups.ts`:
```ts
import { parseSurfaceList } from '../surfaces/parse';
import type { Surface } from '../surfaces/types';

export interface Setup {
  name: string;
  /** Milliseconds since the epoch (0 when unknown, e.g. a hand-made file). */
  savedAt: number;
  surfaces: Surface[];
}

/** The tiny slice of Storage we use, so tests can pass an in-memory stand-in. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const MAX_SETUPS = 30;
export const NAME_MAX = 40;
export const FILE_MAX_CHARS = 200_000;
export const SETUPS_KEY = 'hypermapping.setups.v1';
export const AUTOSAVE_KEY = 'hypermapping.autosave.v1';

const FILE_APP = 'hypermapping';
const FILE_KIND = 'setup';
const FILE_VERSION = 1;
const FALLBACK_NAME = 'Imported setup';

/** Trimmed name, or null if empty, too long, or containing control characters. */
export function normalizeName(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name.length < 1 || name.length > NAME_MAX) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

const finiteOr = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);

/** Read and validate the stored list. Anything unreadable or invalid is skipped; never throws. */
function readAll(store: KeyValueStore): Setup[] {
  let raw: string | null;
  try {
    raw = store.getItem(SETUPS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const byName = new Map<string, Setup>();
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === 'string' ? normalizeName(r.name) : null;
    const surfaces = parseSurfaceList(r.surfaces);
    if (!name || !surfaces) continue;
    const setup: Setup = { name, savedAt: finiteOr(r.savedAt, 0), surfaces };
    const existing = byName.get(name);
    if (!existing || setup.savedAt >= existing.savedAt) byName.set(name, setup); // duplicate names: keep the newest
  }
  return [...byName.values()];
}

const newestFirst = (list: Setup[]) => [...list].sort((a, b) => b.savedAt - a.savedAt);

export function listSetups(store: KeyValueStore): Setup[] {
  return newestFirst(readAll(store));
}

export type SaveResult =
  | { ok: true; setups: Setup[]; replaced: boolean }
  | { ok: false; reason: 'bad-name' | 'bad-surfaces' | 'full' | 'storage' };

/** Save under a name. The same name replaces the old setup; a 31st new name is refused. */
export function saveSetup(store: KeyValueStore, rawName: string, surfaces: Surface[], now: number): SaveResult {
  const name = normalizeName(rawName);
  if (!name) return { ok: false, reason: 'bad-name' };
  const clean = parseSurfaceList(surfaces); // validates AND deep-copies
  if (!clean) return { ok: false, reason: 'bad-surfaces' };
  const existing = readAll(store);
  const replaced = existing.some((s) => s.name === name);
  if (!replaced && existing.length >= MAX_SETUPS) return { ok: false, reason: 'full' };
  const next = [{ name, savedAt: now, surfaces: clean }, ...existing.filter((s) => s.name !== name)];
  try {
    store.setItem(SETUPS_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  return { ok: true, setups: newestFirst(next), replaced };
}

export function deleteSetup(store: KeyValueStore, name: string): Setup[] {
  const existing = readAll(store);
  const next = existing.filter((s) => s.name !== name);
  if (next.length === existing.length) return newestFirst(existing);
  try {
    store.setItem(SETUPS_KEY, JSON.stringify(next));
  } catch {
    return newestFirst(existing);
  }
  return newestFirst(next);
}

export function setupToFile(setup: Setup): string {
  return JSON.stringify(
    { app: FILE_APP, kind: FILE_KIND, version: FILE_VERSION, name: setup.name, savedAt: setup.savedAt, surfaces: setup.surfaces },
    null,
    2,
  );
}

/** A setup from untrusted file text, or null if it is not a valid HyperMapping setup. */
export function parseSetupFile(text: string): Setup | null {
  if (typeof text !== 'string' || text.length > FILE_MAX_CHARS) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.app !== FILE_APP || d.kind !== FILE_KIND || d.version !== FILE_VERSION) return null;
  const surfaces = parseSurfaceList(d.surfaces);
  if (!surfaces) return null;
  const name = typeof d.name === 'string' ? normalizeName(d.name) : null;
  return { name: name ?? FALLBACK_NAME, savedAt: finiteOr(d.savedAt, 0), surfaces };
}

/** `hypermapping-<slug>.json` with a slug of lower-case letters, digits and dashes only. */
export function fileNameFor(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // drop accents (é -> e)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_MAX)
    .replace(/-+$/g, '');
  return `hypermapping-${slug || 'setup'}.json`;
}

/** Remember the current layout so a reload can restore it. Returns false if it could not be saved. */
export function saveAutosave(store: KeyValueStore, surfaces: Surface[], now: number): boolean {
  const clean = parseSurfaceList(surfaces);
  if (!clean) return false;
  try {
    store.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: now, surfaces: clean }));
    return true;
  } catch {
    return false;
  }
}

/** The remembered layout, or null if there is none or it is not valid. Never throws. */
export function loadAutosave(store: KeyValueStore): Surface[] | null {
  try {
    const raw = store.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    return parseSurfaceList((data as Record<string, unknown>).surfaces);
  } catch {
    return null;
  }
}

export function clearAutosave(store: KeyValueStore): void {
  try {
    store.removeItem(AUTOSAVE_KEY);
  } catch {
    // nothing to clear, or storage is blocked
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/setups && npx tsc --noEmit && npm test`
Expected: PASS everywhere. If a test fails because of a real bug, fix the implementation; if a test expectation is wrong (for example the exact slug for an unusual name), fix the test minimally and report exactly what and why; never weaken a test just to pass.

- [ ] **Step 5: Commit**

```bash
git add src/setups
git commit -m "feat(setups): named setups, file format and autosave (pure, tested)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Debounced autosaver and the browser store

**Files:**
- Create: `src/setups/autosave.ts`, `src/setups/browser-store.ts`, `src/setups/download.ts`
- Test: `src/setups/autosave.test.ts`

**Interfaces:**
- Produces: `interface Autosaver { schedule(list: Surface[]): void; flush(): void; cancel(): void }`; `createAutosaver(save: (list: Surface[]) => void, delayMs: number): Autosaver`; `getBrowserStore(): KeyValueStore | null`; `downloadText(filename: string, text: string): void`.

- [ ] **Step 1: Write the failing test**

`src/setups/autosave.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCorners } from '../surfaces/model';
import { FULL_RECT, type Surface } from '../surfaces/types';
import { createAutosaver } from './autosave';

const list = (n: number): Surface[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, corners: defaultCorners(i, n), srcRect: FULL_RECT }));

describe('createAutosaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves only the latest list, once, after the delay', () => {
    const save = vi.fn();
    const a = createAutosaver(save, 400);
    a.schedule(list(1));
    vi.advanceTimersByTime(300);
    a.schedule(list(2));
    vi.advanceTimersByTime(300); // 600 ms in, but the second schedule restarted the clock
    expect(save).not.toHaveBeenCalled();
    a.schedule(list(3));
    vi.advanceTimersByTime(400);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(list(3));
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush saves the pending list immediately, exactly once', () => {
    const save = vi.fn();
    const a = createAutosaver(save, 400);
    a.schedule(list(2));
    a.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(list(2));
    a.flush();
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing pending does nothing', () => {
    const save = vi.fn();
    const a = createAutosaver(save, 400);
    a.flush();
    expect(save).not.toHaveBeenCalled();
    a.schedule(list(1));
    vi.advanceTimersByTime(400);
    a.flush(); // already saved by the timer
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('cancel drops the pending save', () => {
    const save = vi.fn();
    const a = createAutosaver(save, 400);
    a.schedule(list(1));
    a.cancel();
    vi.advanceTimersByTime(1000);
    a.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('a throwing save does not break later saves', () => {
    const save = vi.fn().mockImplementationOnce(() => {
      throw new Error('quota');
    });
    const a = createAutosaver(save, 400);
    a.schedule(list(1));
    expect(() => vi.advanceTimersByTime(400)).not.toThrow();
    a.schedule(list(2));
    vi.advanceTimersByTime(400);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(list(2));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/setups/autosave.test.ts`
Expected: FAIL — `./autosave` not found.

- [ ] **Step 3: Implement**

`src/setups/autosave.ts`:
```ts
import type { Surface } from '../surfaces/types';

export interface Autosaver {
  /** Remember `list` and save it after the delay (each call restarts the delay). */
  schedule(list: Surface[]): void;
  /** Save the pending list right now, if any. */
  flush(): void;
  /** Forget the pending list without saving. */
  cancel(): void;
}

/** Debounced saver: rapid edits cost one write; page-hide can force it out with `flush`. */
export function createAutosaver(save: (list: Surface[]) => void, delayMs: number): Autosaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Surface[] | null = null;

  const run = () => {
    timer = null;
    const list = pending;
    pending = null;
    if (!list) return;
    try {
      save(list);
    } catch {
      // storage can fail (quota, private mode): the next edit simply tries again
    }
  };

  return {
    schedule(list) {
      pending = list;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    },
    flush() {
      if (timer !== null) clearTimeout(timer);
      run();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
```

`src/setups/browser-store.ts`:
```ts
import type { KeyValueStore } from './setups';

/** `localStorage` if it really works (not blocked, not full, not private mode), else null. Never throws. */
export function getBrowserStore(): KeyValueStore | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const ls = window.localStorage;
    const probe = '__hypermapping_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
```

`src/setups/download.ts`:
```ts
/** Offer `text` to the user as a downloaded file. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/setups && npx tsc --noEmit && npm test && npm run build`
Expected: all pass. `browser-store.ts` and `download.ts` touch the DOM and have no unit tests (Node test env): say so in the report.

- [ ] **Step 5: Commit**

```bash
git add src/setups
git commit -m "feat(setups): debounced autosaver, browser store and file download helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Setups panel and the Editor wiring

**Files:**
- Create: `src/ui/SetupsPanel.tsx`
- Modify: `src/ui/Editor.tsx` (anchored edits below), `README.md`

**Interfaces:**
- Consumes: everything from `src/setups/*`, `Surface`, `INITIAL_SURFACES` (Editor), `adoptLayoutRef`.
- Produces: `<SetupsPanel store getSurfaces hasVideo onLoad onStartFresh onClose />`.

UI wiring has no unit tests (Node env, no DOM). Verification is `tsc`, the full `npm test`, `npm run build`; say so explicitly.

- [ ] **Step 1: `src/ui/SetupsPanel.tsx`**
```tsx
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { downloadText } from '../setups/download';
import {
  FILE_MAX_CHARS,
  MAX_SETUPS,
  deleteSetup,
  fileNameFor,
  listSetups,
  normalizeName,
  parseSetupFile,
  saveSetup,
  setupToFile,
  type KeyValueStore,
  type Setup,
} from '../setups/setups';
import type { Surface } from '../surfaces/types';

interface Props {
  /** Browser storage, or null when it is blocked (private window). */
  store: KeyValueStore | null;
  getSurfaces: () => Surface[];
  hasVideo: boolean;
  onLoad: (list: Surface[]) => void;
  onStartFresh: () => void;
  onClose: () => void;
}

const SAVE_ERRORS = {
  'bad-name': 'Give the setup a name (1 to 40 characters).',
  'bad-surfaces': 'The current layout cannot be saved.',
  full: `You already have ${MAX_SETUPS} setups: delete one first.`,
  storage: "Saving isn't available in this browser mode: use Export instead.",
} as const;

const NOT_A_SETUP = "That isn't a HyperMapping setup.";
const CONFIRM_MS = 3000;

/** Save, load, delete, export and import face layouts. A modal panel over the Editor. */
export function SetupsPanel({ store, getSurfaces, hasVideo, onLoad, onStartFresh, onClose }: Props) {
  const [setups, setSetups] = useState<Setup[]>(() => (store ? listSetups(store) : []));
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(
    store ? null : "Saving to this browser isn't available here: use Export and Import instead.",
  );
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    },
    [],
  );

  /** Two taps for anything destructive: the first arms the button, the second does it. */
  const twoStep = (key: string, action: () => void) => {
    if (confirming === key) {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
      setConfirming(null);
      action();
      return;
    }
    setConfirming(key);
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => {
      confirmTimer.current = null;
      setConfirming(null);
    }, CONFIRM_MS);
  };

  const save = () => {
    if (!store) return;
    const result = saveSetup(store, name, getSurfaces(), Date.now());
    if (!result.ok) {
      setStatus(SAVE_ERRORS[result.reason]);
      return;
    }
    setSetups(result.setups);
    setStatus(`${result.replaced ? 'Replaced' : 'Saved'} "${normalizeName(name)}".`);
  };

  const load = (setup: Setup) => {
    onLoad(setup.surfaces);
    setName(setup.name);
    setStatus(`Loaded "${setup.name}".${hasVideo ? '' : ' Load your video to see it on the faces.'}`);
  };

  const remove = (setupName: string) => {
    if (!store) return;
    setSetups(deleteSetup(store, setupName));
    setStatus(`Deleted "${setupName}".`);
  };

  const exportFile = () => {
    const label = normalizeName(name) ?? 'layout';
    const file = fileNameFor(label);
    downloadText(file, setupToFile({ name: label, savedAt: Date.now(), surfaces: getSurfaces() }));
    setStatus(`Exported ${file}.`);
  };

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > FILE_MAX_CHARS * 4) {
      setStatus(NOT_A_SETUP); // far bigger than any real setup: do not even read it
      return;
    }
    try {
      const setup = parseSetupFile(await file.text());
      if (!setup) {
        setStatus(NOT_A_SETUP);
        return;
      }
      onLoad(setup.surfaces);
      setName(setup.name);
      setStatus(`Imported "${setup.name}".${store ? ' Press Save to keep it in this browser.' : ''}`);
    } catch {
      setStatus('Could not read that file.');
    }
  };

  const btn = 'rounded-lg bg-zinc-700 px-3 py-2 text-sm disabled:opacity-40';

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center overflow-auto bg-black/90 p-6">
      <div className="m-auto flex w-full max-w-md flex-col gap-3">
        <h2 className="text-base font-semibold">Setups</h2>
        <p className="text-xs text-zinc-400">
          A setup is the layout of your faces (pins and slices). The video is not saved: load it again after loading a setup.
          Saved setups live in this browser only: use Export for a backup file.
        </p>

        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white"
            placeholder="Setup name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className={`${btn} bg-cyan-500 text-black`} disabled={!store} onClick={save}>
            Save
          </button>
        </div>

        {status && <p className="text-xs text-emerald-400">{status}</p>}

        <ul className="flex flex-col gap-2">
          {setups.length === 0 && <li className="text-xs text-zinc-500">{store ? 'No saved setups yet.' : ''}</li>}
          {setups.map((s) => (
            <li key={s.name} className="flex items-center gap-2 rounded-lg bg-zinc-900 p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{s.name}</div>
                <div className="text-xs text-zinc-500">
                  {s.surfaces.length} {s.surfaces.length === 1 ? 'face' : 'faces'} · {s.savedAt ? new Date(s.savedAt).toLocaleString() : 'unknown date'}
                </div>
              </div>
              <button className={btn} onClick={() => load(s)}>
                Load
              </button>
              <button className={btn} onClick={() => twoStep(`del:${s.name}`, () => remove(s.name))}>
                {confirming === `del:${s.name}` ? 'Sure?' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={exportFile}>
            Export file
          </button>
          <label className={`${btn} cursor-pointer`}>
            Import file
            <input type="file" accept="application/json,.json" className="hidden" onChange={importFile} />
          </label>
          <button className={btn} onClick={() => twoStep('fresh', onStartFresh)}>
            {confirming === 'fresh' ? 'Sure? Resets all faces' : 'Start fresh'}
          </button>
        </div>

        <button className="mt-2 self-center rounded-lg bg-cyan-500 px-6 py-3 font-medium text-black" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Editor edits (`src/ui/Editor.tsx`)** — apply these exact edits.

1. React import: change `import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';` to
```ts
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
```
2. After `import { isValidQuad } from '../warp/quad';` add (keep import order tidy):
```ts
import { createAutosaver } from '../setups/autosave';
import { getBrowserStore } from '../setups/browser-store';
import { clearAutosave, loadAutosave, saveAutosave } from '../setups/setups';
```
and after `import { SliceEditor } from './SliceEditor';` add `import { SetupsPanel } from './SetupsPanel';`.
3. Replace
```tsx
  // The face list lives in a ref: pin drags mutate it without re-rendering React.
  const surfacesRef = useRef<Surface[]>(INITIAL_SURFACES);
  const [selectedId, setSelectedId] = useState('s1');
```
with
```tsx
  // Browser storage (null in a private window). The last layout is restored on reload.
  const store = useMemo(() => getBrowserStore(), []);
  const [startSurfaces] = useState<Surface[]>(() => (store ? loadAutosave(store) : null) ?? INITIAL_SURFACES);
  // The face list lives in a ref: pin drags mutate it without re-rendering React.
  const surfacesRef = useRef<Surface[]>(startSurfaces);
  const [selectedId, setSelectedId] = useState(startSurfaces[0].id);
```
4. After `const [sliceMode, setSliceMode] = useState(false);` add `const [setupsOpen, setSetupsOpen] = useState(false);`
5. Replace the `publish` definition with
```tsx
  // One debounced writer remembers the layout for the next reload.
  const autosaver = useMemo(
    () =>
      createAutosaver((list) => {
        if (store) saveAutosave(store, list, Date.now());
      }, 400),
    [store],
  );

  /** The single place a face list change goes out: ref, renderer, the output window, and the autosave. */
  const publish = useCallback(
    (list: Surface[]) => {
      surfacesRef.current = list;
      renderer?.setSurfaces(list);
      channelRef.current?.postMessage({ type: 'surfaces', surfaces: list });
      autosaver.schedule(list);
    },
    [renderer, autosaver],
  );

  // Save the layout right away when the page is hidden or closed, and when the Editor unmounts.
  useEffect(() => {
    const flush = () => autosaver.flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [autosaver]);
```
6. After the `adoptLayoutRef.current = (list: Surface[]) => { ... };` block add:
```tsx
  // Back to a single default face; also forgets the remembered layout.
  const startFresh = () => {
    adoptLayoutRef.current(INITIAL_SURFACES);
    autosaver.cancel();
    if (store) clearAutosave(store);
  };
```
7. In the toolbar, after the `Open output window` button add:
```tsx
          <button className="rounded-lg bg-zinc-700 px-4 py-3" onClick={() => setSetupsOpen(true)}>
            Setups
          </button>
```
8. After the `{mode === 'edit' && sliceMode && ( <SliceEditor ... /> )}` block (inside the root div) add:
```tsx
      {mode === 'edit' && setupsOpen && (
        <SetupsPanel
          store={store}
          getSurfaces={() => surfacesRef.current}
          hasVideo={blobRef.current !== null}
          onLoad={(list) => adoptLayoutRef.current(list)}
          onStartFresh={startFresh}
          onClose={() => setSetupsOpen(false)}
        />
      )}
```

- [ ] **Step 3: README**

Add a section before "Known limits" (use the file's current headings; do not change other sections):
```markdown
## Saving your setup

- **Setups** (in the toolbar) opens the setups panel. Type a name and press **Save**: the layout of all your faces (pins and slices) is stored in this browser. **Load** brings one back, **Delete** removes one (tap twice). Saving under an existing name replaces it. You can keep up to 30.
- The **video is not saved**: after loading a setup, load your video again.
- **Export file** downloads the current layout as a small `.json` file, and **Import file** loads one: use these as a backup or to move a setup to another device or browser. Saved setups live in this browser only and are lost if you clear its data or use a private window.
- The Editor also **remembers your last layout** and restores it when you reload. **Start fresh** (tap twice) goes back to a single default face.
- On an iPhone, Export may open a preview that needs "Save to Files".
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all pass; no new unit tests in this task (React/DOM). In the report, include a short read-through list confirming: the lazy initial state runs once; `selectedId` starts at a face that exists; `publish` schedules an autosave; the flush effect cleans up listeners and flushes on unmount; Start fresh cancels the timer and clears storage; the panel's timers are cleaned up on unmount; no hook is conditional.
```bash
git add src/ui/SetupsPanel.tsx src/ui/Editor.tsx README.md
git commit -m "feat(ui): Setups panel with save, load, export, import and auto-restore

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** shared parser (Task 1); setup format, validation, list/save/replace/limit/delete, file round trip, safe file names, autosave load/save/clear, hostile-input handling (Task 2); debounced autosaver, browser store and download helper (Task 3); panel with Save / Load / two-step Delete / Export / Import / Start fresh / status messages / storage-unavailable mode, Editor integration with auto-restore, flush on page hide and unmount, Start fresh, README (Task 4). Spec edge cases 1-7: 1-6 are unit-tested (Tasks 1-3); 7 (loading while the slice editor is open) is by construction (the panel is modal and the slice editor is covered by it; the toolbar button is not reachable while the slice editor is open).

**Placeholder scan:** none; every code step carries full code.

**Type consistency:** `Setup`, `KeyValueStore`, `SaveResult` (`ok`, `setups`, `replaced`, `reason`), `normalizeName`, `listSetups`, `saveSetup`, `deleteSetup`, `setupToFile`, `parseSetupFile`, `fileNameFor`, `saveAutosave`, `loadAutosave`, `clearAutosave`, `Autosaver`, `createAutosaver`, `getBrowserStore`, `downloadText`, and the `SetupsPanel` props are spelled identically wherever used.

**Known risks to watch at execution time:** the exact slug for unusual names in `fileNameFor` tests; fake-timer behaviour in the autosaver tests; `useState` lazy initialiser typing in the Editor; the panel's `twoStep` closure over `confirming` (reviewer should hand-trace the double tap).
