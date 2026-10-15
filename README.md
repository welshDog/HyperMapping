# HyperMapping

Web-first projection mapping for phones. Milestone 1: four-corner perspective pin + local video.

## Start it with one click (Windows)

Double-click the **HyperMapping** shortcut on the Desktop (or `start-hypermapping.bat`). It builds the app only if the code changed since the last build, serves the finished files (light on memory), and opens the app and the simulator in your browser. It also prints the address to use on your phone. Close its window to stop. The shortcut was made by `create-desktop-shortcut.ps1` (run it again if you move the folder).

- Add `-Dev` (`start-hypermapping.bat -Dev`) for the heavier dev server with live reload.
- The self-signed certificate warning is expected: accept it once per browser.

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
- **Play mode** hides every control. To come back, tap or click the invisible top-left square, or press Esc (a first Esc in fullscreen only leaves fullscreen; press Esc again).
- **Open output window** opens `#output` (desktop/tablet: drag it to the projector and click once for fullscreen).
- `?renderer=webgl2` or `?renderer=webgpu` forces a backend.
- With no video loaded the app shows a built-in **test pattern** (a grid with lettered columns and numbered rows, corner labels, a TOP arrow, a circle, a word that reads wrong if mirrored, and a blinking dot that shows it is live), in the app, the Output window and the simulator, so you can line up pins and check slices without a video. **Test pattern** in the toolbar forces it on even when a video is loaded. If your browser cannot make it, the button is greyed out and the picture stays black until you load a video.

## Mapping a box (several faces)

- **+ Face** adds another grid (up to 6). Each face has its own four pins; pick a face with its tab, then drag its pins onto that face of the box. **Delete** removes the selected face, **Reset corners** resets just that face.
- All faces share one video. Each face shows its own **slice** of it, like unfolding the box: **Edit slice** opens a box that stands for the whole video (there is no picture of the video yet) where you drag the selected face's rectangle (drag the body to move it, a corner to resize it); press Done to see the result. New faces start as equal strips.
- Play mode and the output window show every face.
- **Glue** (toolbar, on by default): pins that sit on the same spot belong together. Drag one and the others move with it, so a box corner shared by three faces moves all three. Drag a pin close to a pin of another face and it snaps onto it. A small dim dot marks the corners of your other faces and a ring marks a glued pin. To pull a pin away from its neighbours, switch Glue **off**, drag it, then switch Glue back on. A move that would break any face is refused.

## Virtual projector (simulator)

- Open `/simulator.html` (for example `https://localhost:5173/simulator.html`) in another tab while the main app is open and a video is loaded. It shows a 3D box with your real output projected onto it from a virtual projector; drag to orbit.
- Set the box size and turn, and the projector's distance, side angle, lens height, throw ratio (from its spec sheet) and lens shift.
- **Solve** computes each visible face's four pins from those numbers and previews the video wrapped on the box. **Send to app** replaces the main app's faces with them, so you start from a good layout and only nudge the pins.
- Treat the result as a starting point built from measurements; tape-measure error means you will still nudge the pins. Some things decide whether the pins are physically right at all:
  - The pins are only right when the app's output fills the projector image: open the Output window fullscreen on the projector, or mirror a screen whose shape matches the projector.
  - The simulator assumes the projector image shape chosen in the Image shape dropdown (16:9 by default). A phone wider than 16:9 (for example 19.5:9) mirrored to a 16:9 projector is letterboxed, so choose that phone's shape in Image shape or every pin will be off vertically.
  - The main app's own browser window is not the projector's shape, so its pins may look stretched there while the numbers are correct.
  - Lens shift: the model aims the lens axis at the box centre. Many cheap projectors have a fixed throw offset and are tilted instead, so leave Lens shift at 0 unless the axis really points at the box.

## Camera calibration

Let a phone camera find the pins for you.

1. Press **Calibrate**, scan the QR code with the phone (accept the certificate warning, allow the camera) and point it at the box. Hold it still.
2. Open the **Output window**, drag it to the projector and click it once for fullscreen.
3. Press **Start scan**. The projector flashes stripes for about 20 to 30 seconds; the phone watches.
4. The phone's picture appears. For each face tap its four corners: top-left, top-right, bottom-right, bottom-left. **Apply** replaces those faces' pins (save a setup first if you want to keep the old ones); then nudge as usual.  **Save result as setup** stores the new pins in Setups without changing your current ones.

- The phone and the computer must be on the same Wi-Fi. The link goes through the app's own server, so use the one-click launcher (or `npm run dev` / `npm run preview`), not a static host.
- The pins are only right when the Output window fills the projector image (see the notes under Virtual projector).
- Dim the room, aim so the projected picture covers the faces, and keep the phone steady. A tap on an unlit part of a face is refused with a message.

## Saving your setup

- **Setups** (in the toolbar) opens the setups panel. Type a name and press **Save**: the layout of all your faces (pins and slices) is stored in this browser. **Load** brings one back, **Delete** removes one (tap twice). Saving under an existing name replaces it. You can keep up to 30.
- The **video is not saved**: after loading a setup, load your video again.
- **Export file** downloads the current layout as a small `.json` file, and **Import file** loads one: use these as a backup or to move a setup to another device or browser. Saved setups live in this browser only and are lost if you clear its data or use a private window.
- The Editor also **remembers your last layout** and restores it when you reload. **Start fresh** (tap twice) goes back to a single default face.
- On an iPhone, Export may open a preview that needs "Save to Files".

## Known limits (M1)

- A phone cannot use the output window as a second screen; it opens a tab. For a phone plugged into a
  projector over USB-C/HDMI, use Play mode (screen mirror). True extended display needs the native shell (later milestone).
- iPhone Safari cannot make a non-video element fullscreen, so Play mode stays inside the browser
  chrome there. Use Share > Add to Home Screen and launch from the icon instead (the manifest is fullscreen).

## Verification status

Automated tests, typecheck and build pass. The desktop, phone and 20-minute thermal checks
(Task 10 steps 3-5 in `docs/superpowers/plans/2026-10-14-hypermapping-m1-core.md`) have NOT yet
been run on real hardware. Add a "Device notes" heading to this README when they are.
