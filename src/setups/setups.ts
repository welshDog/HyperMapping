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
