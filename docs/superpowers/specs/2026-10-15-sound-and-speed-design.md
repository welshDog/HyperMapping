# HyperMapping — Sound reaction and speed slider Design Spec

Builds on the random-visuals generator. See `docs/superpowers/plans/2026-10-15-hypermapping-random-visuals.md` and the code in `src/generator/`.

## Context
The generator already has a hook for sound (`u_pulse`, always 0) and every look carries its own fixed speed. Lyndz wants the visuals to react to music and a slider for how fast they move.

Agreed with Lyndz:
- **Microphone only** (no tab/system audio capture, no phone-as-mic).
- **Four reactions, each on its own tick box:** bass punch, treble sparkle, volume drives speed, and a big beat starts a new look.
- **Speed slider** 0.25x to 2x, default 1x.
- Out of scope: tab/system audio, a phone acting as the microphone through the relay, per-band beat tuning, saving sound settings with setups, a separate beat-sensitivity control.

## Principles
- **Only the Editor listens.** The microphone permission and analysis live in the Editor; the Output window and simulator receive three small numbers and never touch the microphone. Audio itself never leaves the browser.
- **Windows stay dumb.** The Editor applies the sensitivity and the tick boxes BEFORE broadcasting (a turned-off reaction is sent as 0), so every window just feeds the numbers it receives into its shader.
- **Everything numeric is pure and tested with synthetic sound.** DOM and Web Audio code is thin.

## Speed slider
- `GeneratorState` gains `speed` (0.25..2, default 1), `timeAnchor` (seconds of shader time at the moment of the last speed change, default 0) and `speedChangedAt` (ms, default = `startedAt`).
- Shader time becomes `shaderTime(state, now) = timeAnchor + max(0, now - speedChangedAt) / 1000 * speed`. At speed 1 and defaults this equals today's `(now - startedAt) / 1000`, so existing behaviour is unchanged.
- Changing the speed never makes the picture jump: `setSpeed(state, speed, now)` sets `timeAnchor = shaderTime(state, now)`, `speedChangedAt = now`, `speed`. `setOn` (which resets `startedAt`) also resets `timeAnchor = 0` and `speedChangedAt = now`, so a fresh switch-on starts at time 0.
- The slider lives in the Visuals panel (`aria` label "Speed", shows "1.0x"). The speed is remembered per browser with the look (like `shuffleSec`).
- `isValidState` validates the three new fields (finite numbers; `speed` within 0.25..2). The `generator` channel message carries them. Stored states from before this change have no speed fields: the loader fills defaults instead of discarding the stored look.

## Listening — `src/audio/`
- `createAudioListener(): AudioListener | null` (DOM): `start(): Promise<'ok' | 'denied' | 'no-mic' | 'unsupported'>` (must be called from a tap; resumes a suspended `AudioContext`), `stop()`, `onFrame(fn)`; `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`, an `AnalyserNode` (`fftSize` 2048, `smoothingTimeConstant` 0.4), read every ~33 ms with `getByteFrequencyData`. `stop()` stops the tracks and closes the context; disposing never throws. Returns `null` when `getUserMedia` or `AudioContext` is missing.
- `bandLevels(freq: Uint8Array, sampleRate: number): { bass: number; mid: number; treble: number; volume: number }` (pure): each in 0..1; the bins are chosen from `sampleRate / (2 * freq.length)` Hz per bin; bass 20 to 150 Hz, mid 150 Hz to 4 kHz, treble 4 to 12 kHz (clamped to the Nyquist limit); each band is the mean of its bins / 255; volume is the mean of all bins from 20 Hz to 12 kHz. An empty band (too few bins) yields 0.
- `createLevelTracker(opts?)` (pure, stateful): per band, an adaptive peak `peak = max(level, peak * PEAK_DECAY)` (`PEAK_DECAY` 0.995 per frame, so about a 4.6 s half-life at 30 fps) normalises to `level / max(peak, PEAK_FLOOR)` (`PEAK_FLOOR` 0.08) clamped to 0..1, with a noise gate: if the raw volume is below `NOISE_GATE` (0.04) all outputs are 0 and the peaks are not raised; an envelope follower smooths the result (`attack` 0.6, `release` 0.12 per frame, exponential), so rises are fast and falls slower; `sensitivity` (0.2..3, default 1) multiplies the normalised value before clamping. `update(levels): { bass, mid, treble, volume }` and `reset()`.
- `createBeatDetector()` (pure, stateful): fed the SMOOTHED bass each frame; keeps a running mean over about 1 s (30 frames); a beat is `bass > mean * 1.5 && bass > 0.3` with at least `MIN_BEAT_GAP_MS` (250) since the last beat; `update(bass, nowMs): boolean`.
- `AudioSettings { sensitivity: number; bass: boolean; treble: boolean; volume: boolean; beatLook: boolean }`, defaults `{ 1, true, true, true, false }`; `parseAudioSettings(raw): AudioSettings` fills defaults for anything missing or invalid (clamps `sensitivity`); stored under `hypermapping.audio.v1` in guarded storage; listening itself is NEVER remembered (a reload needs a new tap).
- `masked(levels, settings): { bass, treble, vol }` (pure): zeroes a reaction whose tick box is off; `vol` is the volume level.

## Channel
New message `{ type: 'audio'; bass: number; treble: number; vol: number }` (each finite, clamped to 0..1 by the parser). Sent by the Editor only while listening, about every 33 ms; also one `{ bass: 0, treble: 0, vol: 0 }` when listening stops. A window that has not received one for 400 ms fades its levels to zero (so a minimised or closed Editor does not freeze the visuals).

## Shaders
- New uniforms: `u_pulse` (existing, now = bass), `u_treble`, `u_atime` (extra shader seconds from loudness). `GLOBAL_UNIFORMS` is extended and `source.ts` sets all of them each frame. Each window integrates `atime += dtSeconds * VOLUME_SPEEDUP * vol` itself from the levels it receives (`VOLUME_SPEEDUP` 1.5, so full volume is up to 2.5x), eased by an exponential smoother on `vol`; at silence `atime` simply stops growing (time never goes backwards).
- Time in every look becomes `t = (u_time + u_atime) * speed`.
- Bass (`u_pulse`): plasma: surge the warp amplitude and brightness; kaleidoscope: breathing zoom and a ring pulse; neon: rings expand and the glow swells; particles: bigger, brighter dots.
- Treble (`u_treble`): plasma: finer grain/contrast; kaleidoscope: glints on the petals; neon: grid-line flicker and brighter edges; particles: stronger twinkle and cross flares.
- With all reaction uniforms at 0 the pictures must look exactly as they do today.

## Beat starts a new look
In the Editor only: when `beatLook` is on, the generator is on, we are listening, the beat detector fires, and at least `BEAT_LOOK_MIN_MS` (6000) have passed since the last look change (`changedAt`), the Editor calls `randomizeState` (cross-fade as usual). It coexists with auto-shuffle (whichever fires first resets the clock).

## UI — Visuals panel
A **Sound** section below the existing controls:
- **Listen** / **Stop** button (one `bg-*` class per state) with a status line: "Off", "Listening", "Microphone blocked: allow it in the browser's site settings", "No microphone found", "Not supported in this browser".
- Three live level bars (bass, treble, volume) so you can see it hear the room.
- **Sensitivity** slider (0.2 to 3, shows the value).
- Tick boxes: **Bass punch**, **Treble sparkle**, **Volume speeds motion**, **Big beat starts a new look**.
- **Speed** slider (0.25x to 2x) sits with the look controls, above Sound.
- All inputs are at least 16px text on iOS and `select-text` where they are text fields; sliders are native range inputs with labels.

## Editor wiring
`Editor.tsx` owns the audio listener, the tracker, the beat detector and the settings (state + ref); the Listen tap starts them; a ~33 ms loop computes the levels, posts the `audio` message and updates the panel's meters (meters re-render at most 10 times per second). Everything is disposed on unmount. `useOutputFeed` handles the `audio` message (store the levels with their timestamp; the draw loop fades them when stale) and passes them to the generator source (`setAudio({ bass, treble, vol })`).

## Edge cases (each tested where pure)
1. `bandLevels`: a synthetic 60 Hz tone gives high bass and about zero treble; 8 kHz the opposite; silence gives all zeros; the same tone at two different sample rates (44100, 48000) gives the same band; fewer than 4 bins does not throw.
2. `createLevelTracker`: a quiet loop and a loud loop both reach near 1.0 after the peak adapts; below the noise gate everything is 0 and the peak does not climb; the envelope rises faster than it falls; `sensitivity` scales and clamps; `reset` clears.
3. `createBeatDetector`: a steady drone gives no beats; a synthetic 120 BPM bass pulse train gives about 2 beats per second; no two beats closer than 250 ms; a quiet blip under 0.3 is ignored.
4. `masked`: a turned-off reaction is exactly 0, the others unchanged.
5. `parseAudioSettings`: junk, partial objects and out-of-range sensitivity give defaults / clamped values; never throws.
6. `shaderTime`, `setSpeed`: at defaults equals the old time; changing the speed at time T leaves the shader time continuous at T (no jump) for several speeds and times; `setOn` resets the anchor; `isValidState` accepts the new fields and rejects NaN, speed 0, speed 5; an old stored state without the fields loads with defaults.
7. Protocol: `audio` accepts finite numbers and clamps to 0..1; rejects missing, NaN, non-number, strings.
8. Stale levels: the fade to zero after 400 ms (pure helper `fadeLevels(levels, ageMs)`).
9. Shaders: with `u_pulse = u_treble = u_atime = 0` the rendered picture equals today's (headless render comparison of one frame per look); with bass 1 and treble 1 each look visibly differs (screenshots read by the implementer).

## Testing
- Unit (Vitest, Node): everything marked pure above, using synthetic spectra built in the tests (a helper that renders a sine of a given frequency into a `Uint8Array` spectrum).
- Headless Chrome: render each look at quiet versus loud uniforms and compare.
- Manual: play music near the laptop, press Listen, watch the bars and the picture; try each tick box; the speed slider; beat-starts-a-new-look; open the Output window and the simulator and confirm they pulse together; deny the microphone permission and confirm the message.

## Risks
- A weak laptop microphone or a noisy room gives weak or constant reactions; Sensitivity and the adaptive peak help, and there is no fix for speakers that are inaudible to the microphone.
- Browsers throttle timers in a hidden or minimised tab, so with the Editor hidden the levels slow down and the reactions weaken; the README says to keep the Editor visible.
- With volume driving speed, each window integrates its own time, so windows are close but no longer pixel-identical while sound plays (they stay identical with no sound).
- The microphone prompt needs a user tap, and iOS may suspend the `AudioContext` until then; `start()` resumes it from the tap.
- Browser echo cancellation / auto gain are turned off on purpose so music dynamics survive; some browsers or devices ignore the constraints.
