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

- **Load video** picks a file from the phone. **Drag the four pins** onto the corners of your surface.
- **Play mode** hides every control (tap the invisible top-left square to come back).
- **Open output window** opens `#output` (desktop/tablet: drag it to the projector and click once for fullscreen).
- `?renderer=webgl2` or `?renderer=webgpu` forces a backend.

## Known limits (M1)

- A phone cannot use the output window as a second screen; it opens a tab. For a phone plugged into a
  projector over USB-C/HDMI, use Play mode (screen mirror). True extended display needs the native shell (later milestone).
- No saving yet (Milestone 2).

## Verification status

Automated tests, typecheck and build pass. The desktop, phone and 20-minute thermal checks
(Task 10 steps 3-5 in `docs/superpowers/plans/2026-10-14-hypermapping-m1-core.md`) have NOT yet
been run on real hardware. Add a "Device notes" heading to this README when they are.
