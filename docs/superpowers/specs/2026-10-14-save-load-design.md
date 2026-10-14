# HyperMapping — Save / load setups Design Spec

Builds on the shipped M1/M3 and the virtual projector. See `2026-10-14-multi-surface-design.md` and `2026-10-14-virtual-projector-design.md`.

## Context
A box mapping takes a long time to line up. Today a reload (or a phone browser killing the tab) loses every pin and slice. Lyndz wants named setups saved in the browser, plus a file backup, so a mapping can be recalled or moved between devices.

Agreed with Lyndz:
- **Named setups in the browser + Export/Import as a file.**
- A setup holds the face list only (pins + slices). **The video is not saved**: it is re-picked after loading, which keeps saves tiny and reliable on a phone.
- Out of scope: saving the video, renaming (delete and save again), cloud sync, saving the simulator's box/projector numbers.
- **Addition (delivered because Lyndz asked for the best version; easy to drop):** the Editor remembers the current layout and restores it on reload ("auto-restore"), with a **Start fresh** button to clear it.

## Data
```ts
interface Setup { name: string; savedAt: number /* ms since epoch */; surfaces: Surface[] }
```
- Browser list: key `hypermapping.setups.v1`, value = JSON array of `Setup`.
- Auto-restore: key `hypermapping.autosave.v1`, value = JSON `{ savedAt, surfaces }`.
- File: JSON text `{ "app": "hypermapping", "kind": "setup", "version": 1, "name": string, "savedAt": number, "surfaces": Surface[] }`, at most 200 000 characters.
- Limits: `MAX_SETUPS = 30`, name 1..40 characters after trimming, no control characters.

## Pure module — `src/setups/` (no DOM, fully unit-tested with an in-memory store)
- `src/surfaces/parse.ts` (moved, not rewritten): `parseSurfaceList(raw: unknown): Surface[] | null` and its helpers (`isVec2`, `isNum`, `parseSurface`) move out of `src/output/protocol.ts` so the channel and the setup file share ONE strict parser. `protocol.ts` imports it; its behaviour and tests are unchanged.
- `src/setups/setups.ts`:
  - `interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }`
  - `normalizeName(raw: string): string | null` — trims, rejects empty, > 40 chars, or control characters.
  - `listSetups(store): Setup[]` — newest first; corrupt, non-array or invalid entries are skipped; a throwing store gives `[]`.
  - `saveSetup(store, rawName, surfaces, now): SaveResult` where `SaveResult = { ok: true; setups: Setup[] } | { ok: false; reason: 'bad-name' | 'bad-surfaces' | 'full' | 'storage' }`. Same (trimmed) name replaces the existing setup; a NEW name when 30 exist gives `'full'`; `surfaces` must pass `isValidSurfaces` (else `'bad-surfaces'`); a throwing `setItem` (quota/private mode) gives `'storage'`. Stored surfaces are deep-copied.
  - `deleteSetup(store, name): Setup[]`.
  - `setupToFile(setup): string` and `parseSetupFile(text: string): Setup | null` — rejects text over the size cap, invalid JSON, wrong `app`/`kind`/`version`, an invalid face list (via `parseSurfaceList`); a missing or invalid name becomes `'Imported setup'`; a non-finite `savedAt` becomes `0`. Unknown fields are dropped.
  - `fileNameFor(name): string` — `hypermapping-<slug>.json`, slug lower-case `[a-z0-9-]`, `setup` if empty.
  - `saveAutosave(store, surfaces, now): boolean`, `loadAutosave(store): Surface[] | null` (null for missing/corrupt/invalid), `clearAutosave(store): void`.
- `src/setups/browser-store.ts`: `getBrowserStore(): KeyValueStore | null` — returns `window.localStorage` only if a probe write/remove succeeds; `null` in private mode/blocked storage. Never throws.

## Editor — `src/ui/`
- `SetupsPanel.tsx` (new, z-40 overlay, same visual style as the slice editor): a name box + **Save**; the saved list (name, date, **Load**, two-step **Delete**: first tap turns the button into "Sure?", second tap deletes, the first tap reverts after 3 s); **Export** (downloads the current layout; uses the name box, or `layout`); **Import** (file picker, `application/json`); **Start fresh**; **Done**. A one-line status area gives plain messages: saved, replaced, loaded, deleted, "That isn't a HyperMapping setup", "Saving isn't available in this browser mode: use Export instead", "You have 30 setups: delete one first". When `getBrowserStore()` is null the list/Save are disabled with that message; Export/Import still work.
- `Editor.tsx`:
  - A **Setups** button in the toolbar opens the panel.
  - **Load / Import** call the existing `adoptLayoutRef.current(list)` (publish, select the first face, repaint, bump). After loading, the video must be re-picked: the status line says so when no video is loaded.
  - **Auto-restore:** the initial face list comes from `loadAutosave(store) ?? INITIAL_SURFACES` (computed once, in a lazy initial state), with the first face selected. Every `publish` schedules a debounced (400 ms) `saveAutosave`; it also flushes on `pagehide` and when the page becomes hidden. **Start fresh** adopts `INITIAL_SURFACES` and calls `clearAutosave`. The hello reply and creation broadcast already send `surfacesRef.current`, so a restored layout reaches an open Output window.
  - The panel never writes while closed; the debounced timer and listeners are cleaned up on unmount.
- Export implementation: `Blob` + temporary `<a download>` + `URL.revokeObjectURL`.

## Edge cases (each tested where pure)
1. Corrupt/foreign/oversized stored JSON never crashes: lists are empty, autosave is ignored.
2. A throwing store (quota, private window) gives `'storage'` / `false` / `[]`, never an exception.
3. Importing a hand-edited or hostile file (wrong shape, >6 faces, duplicate ids, NaN, bad slices, `__proto__` keys, huge text) is refused or sanitised; accepted files are rebuilt from validated fields only.
4. Saving over an existing name replaces it; saving a 31st new name is refused; names with only spaces or control characters are refused.
5. File names from awkward setup names (unicode, slashes, dots) are safe slugs.
6. Auto-restore with an invalid autosave falls back to the default single face.
7. Loading while the slice editor is open is harmless (the panel is modal and the slice editor follows the selection).

## Testing
- Unit (Vitest, Node): `parse` is covered through the existing protocol tests plus direct tests; the whole `setups` module against an in-memory store, including a throwing store and corrupt data; a file round trip (`parseSetupFile(setupToFile(s))` equals `s` for random valid setups); each edge case above.
- Panel, Editor wiring, browser store, download: `tsc` + `npm run build`, then a manual check: save, reload, load; export on one device, import on another; private-window behaviour; auto-restore after reload with an Output window open.

## Risks
- `localStorage` can be cleared by the browser or disabled; the file backup is the safety net. The panel says so in one line.
- Auto-restore changes first-load behaviour for anyone who expects the default layout: Start fresh is one tap.
- iOS Safari handles file downloads less smoothly than desktop; Export may open a preview that needs "Save to Files". Import works through the normal file picker.
