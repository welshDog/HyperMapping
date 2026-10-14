# HyperMapping

Web-first projection mapping for phones. Milestone 1: four-corner perspective pin + local video.

## Run

    npm install
    npm run dev        # https://<your-LAN-IP>:5173  (self-signed cert: accept the warning)
    npm test
    npm run build

HTTPS is required: WebGPU only exists in secure contexts. Plain `http://<LAN-IP>`
silently falls back to WebGL2. Android alternative: `adb reverse tcp:5173 tcp:5173`
then open `https://localhost:5173`.

## Use

- **Load video** picks a file from the phone. **Drag the four pins** (for the selected face) onto the corners of your surface.
- **Play mode** hides every control (tap the invisible top-left square to come back).
- **Open output window** opens `#output` (desktop/tablet: drag it to the projector and click once for fullscreen).
- `?renderer=webgl2` or `?renderer=webgpu` forces a backend.

## Mapping a box (several faces)

- **+ Face** adds another grid (up to 6). Each face has its own four pins; pick a face with its tab, then drag its pins onto that face of the box. **Delete** removes the selected face, **Reset corners** resets just that face.
- All faces share one video. Each face shows its own **slice** of it, like unfolding the box: **Edit slice** opens a picture of the whole video where you drag the selected face's rectangle (drag the body to move it, a corner to resize it). New faces start as equal strips.
- Play mode and the output window show every face.

## Known limits (M1)

- A phone cannot use the output window as a second screen; it opens a tab. For a phone plugged into a
  projector over USB-C/HDMI, use Play mode (screen mirror). True extended display needs the native shell (later milestone).
- iPhone Safari cannot make a non-video element fullscreen, so Play mode stays inside the browser
  chrome there. Use Share > Add to Home Screen and launch from the icon instead (the manifest is fullscreen).
- No saving yet (Milestone 2).

## Verification status

Automated tests, typecheck and build pass. The desktop, phone and 20-minute thermal checks
(Task 10 steps 3-5 in `docs/superpowers/plans/2026-10-14-hypermapping-m1-core.md`) have NOT yet
been run on real hardware. Add a "Device notes" heading to this README when they are.
