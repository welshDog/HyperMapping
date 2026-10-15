# HyperMapping — Camera auto-calibration Design Spec

Builds on the multi-face Editor, the Output window, save/load, glued corners and the test pattern. See `2026-10-14-multi-surface-design.md` and `2026-10-14-test-pattern-design.md`.

## Context
Placing a box's pins means dragging up to 24 of them by hand, or measuring the room for the simulator. Lyndz wants the app to find them: the projector flashes known patterns, a camera watches the box, and the app works out where each face's corners are in the projector's picture. The result replaces the pins; the user then nudges as usual.

Agreed with Lyndz:
- **The phone is the camera.** The laptop owns the Editor and the Output window (mirrored or extended to the projector); the phone opens a camera page and watches the box.
- **Scan, then you tap the corners.** A structured-light scan maps every camera pixel to a projector pixel; the user taps each face's 4 corners once on the camera picture; the app converts the taps to pins. Fully automatic corner finding and printed markers are out of scope.
- Out of scope: colour correction, edge blending, lens-distortion correction, saving the camera picture, multiple cameras.

## The flow
1. Editor toolbar **Calibrate** opens a panel with a link and a QR code (for the phone) and the connection state.
2. The phone opens the link (`/camera.html?s=<session>`), grants camera access and is pointed at the box. The panel shows "Phone connected".
3. The user opens the Output window fullscreen on the projector and presses **Start scan**. The Output window shows the scan frames; the phone captures each one and reports back. About 40 frames, roughly 10–15 seconds. The phone must be held still.
4. When the scan ends the phone shows its camera picture (the white frame). The user taps the 4 corners of face 1 in the order tl, tr, br, bl, then Next face, and so on for each face in the Editor.
5. **Apply** replaces the faces' corners with the computed pins (undoable: the previous corners are kept until Apply is pressed again or the panel closes, and **Cancel** changes nothing). Slices are untouched.

## Linking the phone and laptop — a tiny relay
The Editor and Output talk over the browser's `BroadcastChannel`, which only works inside one browser, so a phone needs another carrier. Serverless WebRTC would need a two-way code exchange between the devices (the phone cannot just scan a code and be connected), so instead the existing server (`vite dev` and `vite preview`, which the launcher already runs) gets a small plugin, `calibrationRelay`, that hosts a message mailbox. No new process, no extra RAM.
- `POST /calib/<session>/<box>` stores a message in a mailbox (`box` is `to-phone` or `to-laptop`); `GET /calib/<session>/<box>?after=<n>` long-polls up to 20 s and returns messages with sequence number greater than `n` (JSON). Bodies are capped (see limits).
- `session` is a random 128-bit token (hex) created by the Editor and embedded in the QR; a mailbox is created on first use and discarded after 15 minutes idle. At most 4 sessions are held and each mailbox keeps at most 64 messages (oldest dropped).
- Same-origin only (the page that creates the session is served by the same server); no CORS headers; nothing is written to disk; the endpoint refuses paths that do not match `/calib/<32 hex>/<to-phone|to-laptop>`.
- The relay is security-relevant only on the user's own LAN, and the token is unguessable; it carries a camera frame summary and tap data, never the video.

## Messages (JSON; defined in `src/calibrate/protocol.ts`)
Laptop → phone: `show { frame: number, of: number }` (informational, the phone also shows progress), `scan-start`, `scan-cancel`.
Phone → laptop: `hello { width, height }`, `ready` (camera running, phone steady), `frame-done { frame }`, `scan-result { width, height, stepPx, mapX: base64 Uint16, mapY: base64 Uint16, mask: base64 Uint8, preview: dataURL (JPEG) }`, `error { reason }`.
`parseCalibMsg(data: unknown): CalibMsg | null` is strict: it checks types, sizes and that the map lengths equal `width*height`; anything else is `null`.

## Scan frames — pure module `src/calibrate/patterns.ts`
- Projector grid: the Output window's CSS-pixel size at scan time is reported to the Editor and used as the projector size `(pw, ph)`; the scan runs in a coarse grid `gw = ceil(pw / STEP_PX)`, `gh = ceil(ph / STEP_PX)` with `STEP_PX = 4`.
- `bitsFor(n): number` — number of Gray-code bits needed to address `n` cells (`ceil(log2 n)`, 1 for n ≤ 2).
- `frameCount(gw, gh): number` — `2 + 2*bitsX + 2*bitsY` (white, black, then each bit pattern and its inverse, X then Y). With 4-pixel steps on 1920×1080 this is `2 + 2*9 + 2*8 = 36`.
- `grayCode(i: number): number`, `fromGray(g: number): number`.
- `frameSpec(index, gw, gh): { kind: 'white' | 'black' | 'bit'; axis?: 'x' | 'y'; bit?: number; inverted?: boolean }` and `bitValue(spec, x, y): 0 | 1` — what colour the cell `(x, y)` shows in that frame.
- `drawScanFrame(ctx, spec, pw, ph, gw, gh)` paints the frame with coarse cells (a `PatternContext`-style recording stand-in tests it).
- The Output window shows the next frame only after the phone reports the previous one done, with a fixed settle time `SETTLE_MS = 200` between painting and capturing (a camera needs a few frames to see the change); the phone averages `CAPTURE_FRAMES = 3` consecutive camera frames per scan frame to cut noise.

## Decoding — pure module `src/calibrate/decode.ts`
- Input: for each scan frame the camera's grey image (luma, `Uint8ClampedArray`, `width*height`), the same size for every frame.
- `decodeScan(frames: GrayFrame[], gw: number, gh: number, minContrast: number): ScanMap` where `ScanMap = { width; height; mapX: Uint16Array; mapY: Uint16Array; mask: Uint8Array }`.
- A camera pixel is **lit** when `white - black >= minContrast` (default `MIN_CONTRAST = 40`). A bit is read by comparing the pattern frame with its inverse (`p > inv` means 1), which needs no global threshold. A pixel whose bit comparison margin is under `MIN_BIT_MARGIN = 12` for any bit is marked unreliable (mask 0). Unlit or unreliable pixels get mask 0; reliable ones get mask 1 and `mapX`, `mapY` as the coarse grid cell `(fromGray(bitsX), fromGray(bitsY))`, clamped to `gw-1`, `gh-1`.
- Cells map back to projector pixels as `(cell + 0.5) * STEP_PX`.

## Corners — pure module `src/calibrate/corners.ts`
- `projectorPointAt(map: ScanMap, cx, cy, radius = TAP_RADIUS_PX, minValid = 0.5): Vec2 | null` — takes the reliable pixels within `radius` of the camera tap `(cx, cy)` (`TAP_RADIUS_PX = 12`, a disc), fits a plane `proj = a + b*dx + c*dy` to `mapX` and `mapY` separately by least squares on the offsets from the tap, and returns the value at the tap `(a_x, a_y)` in projector pixels. `null` when fewer than `minValid` of the disc's pixels are reliable, when fewer than 6 reliable pixels exist, or when the fit is degenerate.
- `tapsToCorners(map, taps: [Vec2, Vec2, Vec2, Vec2], projector: { w: number; h: number }): { corners: Corners; failed: number[] } | null` — converts four taps (in camera pixels) into unit-space corners (`x / projector.w`, `y / projector.h`, Y down), order tl, tr, br, bl. `failed` lists the indices that could not be resolved; `null` unless all four resolve and the result passes `isValidQuad` (the same validity the Editor uses).
- `applyCalibration(surfaces, results: Record<surfaceId, Corners>): Surface[]` — replaces the corners of the faces present in `results`, leaving every other field (`id`, `srcRect`) and every other face untouched; unknown ids are ignored; the result passes the shared `parseSurfaceList`.

## Camera page — `camera.html` / `src/calibrate/CameraApp.tsx`
- A third Vite entry (`camera.html`), plain React page: requests `getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })`, shows the live picture with a "hold still, then wait" status, posts `hello`/`ready`, runs the scan on `scan-start`: for each frame it waits for the laptop's `show`, waits `SETTLE_MS`, grabs `CAPTURE_FRAMES` camera frames to a canvas, averages their luma, posts `frame-done`; then decodes with `decodeScan` locally (the heavy work stays on the phone) and posts `scan-result` with the maps and a JPEG preview of the white frame.
- Steadiness: the phone watches `devicemotion` during the scan; if rotation or acceleration exceeds `MAX_MOTION` it posts `error { reason: 'moved' }`. If the device has no motion sensor the check is skipped.
- Wake lock is requested for the scan so the screen does not sleep.

## Editor — `src/ui/CalibratePanel.tsx` and `Editor.tsx`
- Toolbar button **Calibrate** (disabled with a short title when `getUserMedia`-capable phone pairing is not possible, i.e. `fetch` is missing — effectively never — or the Output cannot be opened). A panel (like Setups) shows: link + QR, connection state, **Start scan** (enabled when the phone is connected and an Output window has reported its size), scan progress, then the tapping step with the phone's preview picture, **Apply** and **Cancel**.
- QR code: a small self-contained generator (no network, no new dependency beyond a vetted tiny QR library pinned to an exact version).
- The Output window listens for a new `calibrate` channel message `{ type: 'calibrate'; frame: ScanFrameSpec | null; gw; gh }` on the existing BroadcastChannel: `frame` paints the scan frame instead of the picture; `null` returns to normal. Opening the Output window and reporting its size use a new `output-size { w, h }` message (also on the channel). While a scan frame is shown the Output window ignores `surfaces` redraws.
- The Editor drives the scan: for each frame it tells the Output window to paint it, waits `SETTLE_MS`, then asks the phone (`show`) and waits for `frame-done`; the order is Output paints → settle → phone captures → done → next.
- Tapping UI: the preview image is shown full-width; the user taps the corners; a marker shows each tap and a faint polygon shows the face as it is built; **Undo tap** removes the last tap. Face tabs of the Editor are reused for "which face am I tapping".

## Edge cases (each tested where pure)
1. `grayCode`/`fromGray` are inverses for `0..2^16`; adjacent codes differ in exactly one bit.
2. `frameCount` for 1920×1080 at `STEP_PX = 4` is 36; `bitsFor` handles 1, 2, 3, non-powers of two.
3. Decoding a synthetic perfect scan (camera = identity warp of the projector) reproduces every cell exactly; a camera that sees only part of the projector masks the rest as 0.
4. A synthetic scan through a known homography (camera sees the projector in perspective) decodes so that `tapsToCorners` for the four known camera positions of a rectangle returns the known projector corners within 0.5 px.
5. Noise: with ±8 grey-level noise the lit rate stays above 99% and decoded cells stay within one cell of the truth for lit pixels; with `MIN_BIT_MARGIN` guarding, no wildly wrong cells appear.
6. `projectorPointAt` returns `null` on a mostly unlit disc and on fewer than 6 reliable pixels; recovers a known plane to under 0.05 px.
7. `tapsToCorners` returns `null` for a bow-tie (taps in the wrong order) and lists unresolved taps in `failed`.
8. `applyCalibration` leaves unspecified faces and all non-corner fields untouched, ignores unknown ids and returns a list that `parseSurfaceList` accepts.
9. `parseCalibMsg` accepts every valid message and rejects wrong types, wrong map sizes, oversize bodies and unknown `type`.
10. A relay path that does not match the allowed pattern is refused; a mailbox returns messages after a sequence number in order; the 64-message and 4-session caps hold; idle sessions expire (relay logic is a pure `createMailbox(clock)` unit, the Vite plugin is a thin adapter).

## Testing
- Unit (Vitest, Node): `patterns`, `decode`, `corners`, `protocol`, `mailbox` (pure) with synthetic cameras built in the tests (an `ImageSynth` helper that renders the projector's frames through a known homography with optional noise).
- Interface (camera page, panel, Output window handling, Vite plugin adapter, QR): `tsc` + `npm run build`, then a manual check: Calibrate → scan the QR with the phone → Start scan on a box → tap the corners → Apply → compare to the real box; also Cancel, a phone that moves during the scan, and an unlit face.

## Risks
- **Camera and projector may disagree on exposure:** auto-exposure can drift mid-scan. The bit comparison (pattern vs its inverse) is robust to a steady drift; the phone also asks the browser to lock exposure when `applyConstraints` supports it and otherwise carries on.
- **Real-world accuracy is unknown until tried**: expect a few pixels of error from lens distortion and the camera's pixel footprint; the nudge step remains.
- **Projector size is a guess if the Output window is not fullscreen on the projector** — the scan then maps to the window's size, not the projector's. The panel warns when the Output window is not fullscreen.
- **The relay is new surface area on the dev/preview server**; it is LAN-only, token-gated, capped and in memory, and is only active while the app is served by Vite.
- **Phone motion sensors** need a permission on iOS; if declined the steadiness check is skipped and a note is shown.
- **Screen glare and dark boxes** limit the lit area; faces that cannot be tapped are reported and the old pins stay.
