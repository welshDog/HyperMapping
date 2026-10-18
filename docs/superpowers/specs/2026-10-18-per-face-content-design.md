# Per-face content: each face picks its own source

Date: 2026-10-18. Status: draft for approval. Builds on `2026-10-18-face-shapes-design.md` (merged) and the random-visuals and sound-and-speed designs.

## Intent and the why

Lyndz is building a collage of triangles, circles and quads on a wall and wants different content on different shapes: for example one shape plays the test pattern while another plays a random visual look, and each look can be randomized on its own. Today the whole wall has one picture (the loaded video, or the test pattern, or one random look) and every face just shows a slice of it.

Success: Lyndz picks a face, picks what it shows, and the wall shows 3 or 4 different live looks at once from the laptop, each randomized separately, all reacting to the one microphone, with the Output window and the simulator showing exactly the same.

## Decisions made with Lyndz

- Each face gets a **Source**: **Video** (the one loaded video), **Test pattern**, or **Visual look**.
- Only **one shared video** exists. There are no per-face videos. Faces on Video each still show their own slice of it, as today.
- Faces on **Test pattern** show the pattern (one shared pattern picture; each face still has its slice).
- A face on **Visual look** has its **own look**: own Look style, Randomize, Auto-shuffle, Speed, and look code. The Visuals panel edits the **selected face's** look.
- **Sound is one microphone for the whole wall.** Listen/Stop, Sensitivity and the reaction ticks stay global; every live look reacts to the same levels.
- **Sharing:** a face on Visual look can instead be set to "same look as Face N". Faces sharing a look show one picture and cut it with their own slices (this is today's one-look-across-the-wall behaviour, per group of faces). Faces with their own look are independent.
- The toolbar **Test pattern** button stays: a wall-wide override that forces the test pattern on every face for lining up (as today). Turning it off returns each face to its own source.
- Expected load: **3 or 4 live looks at once, driven from the laptop** (8 GB machine). A phone is not the main target but must not break.
- New faces and all existing saved setups start on **Video** so nothing changes until a source is picked.

## Goals / non-goals / anti-goals

Goals: the above; Setups, Export/Import and autosave keep each face's source and its look; Output window and simulator mirror the Editor per face; switching a face's source never flashes black or other faces.

Non-goals: different videos per face; per-face microphones or per-face sound settings; saving the video itself (still re-pick after loading a setup); new look styles.

Anti-goals (a failure even if it technically works):
- The laptop overheats or stutters with 4 looks (frame rate matters more than looks count; there is a hard cap, below).
- The Output window or the simulator disagreeing with the Editor on what a face shows.
- Randomizing one face's look changing another face's look (unless they are deliberately sharing).
- Old setups or the old single-look workflow breaking.

## Constraints from the existing code

- The Renderer takes ONE video for all faces (`setVideo`), and both backends upload it as one texture per frame (WebGL2 `texImage2D`, WebGPU `importExternalTexture`). Per-face sources need each face to be drawn from its own source's texture. Faces that share a source element must share one texture upload per frame, not one per face.
- The random-visuals generator (`src/generator/source.ts`) is one WebGL2 context on a hidden 960x540 canvas turned into a video with `captureStream(30)`, driven by one `GeneratorState` (look, previous look and cross-fade, shuffle, speed, time anchor). The Editor owns the state and broadcasts a `generator` message; the Output window and simulator render the same look deterministically from it (`useOutputFeed`). Zero sound reaction must render pixel-identical to before.
- The Output window and simulator each also run their own generators, so every live look exists twice (Editor + Output) on the GPU. Count that in the budget.
- Source choice today is `pickSource` (pattern forced > generator on > video > pattern fallback). That logic becomes per face; the fallbacks stay (a Video face with no video loaded falls back to the test pattern; an unavailable generator falls back like today).
- Face lists from outside go through the one strict parser (`src/surfaces/parse.ts`); new fields must be validated there, unknown values rejected, missing means Video.
- Max faces 6. **At most 4 distinct live looks at once** (faces sharing a look count once). The "Visual look" choice for a new distinct look is disabled when 4 exist; choosing "same look as Face N" is always allowed.
- Faces on a source that is not showing must not run its shader (the existing `setActive` idea): a hidden look costs nothing.
- 8 GB machine: do not raise memory use unreasonably; keep the existing thermal guard working (it lowers render quality when frames slow down).

## Behaviour

- Face source picker next to the Shape row: Video / Test pattern / Visual look. For Visual look, a second control picks "Own look" or "Same as Face N" (only faces that own a look are offered).
- The Visuals panel (Look, Randomize, Auto-shuffle, Speed, look code) edits the selected face's look and says which face it is. When the selected face is not on a look, the panel says so and offers to switch it to Visual look. The Sound section is unchanged and global.
- Deleting a face that owns a look which others share: the sharers keep showing that look (they become its owners). Deleting or changing a face's source never alters another face's picture.
- Slices: faces sharing one source split it with their slices as today. A face that gets its own look starts with the full picture; the slice editor still works on a look face. Going back to Video returns the face to a sensible slice (builder's call how).
- The Output window and simulator receive each face's source and each live look's state and render them deterministically, exactly like today's single generator.
- Setups, Export/Import and autosave store each face's source, sharing link and its look (style, seed, speed, shuffle setting, style pick). Old files with none of these load as all-Video. A file whose sharing link points at a missing face or at a face that does not own a look is repaired to "own look" or rejected cleanly, never half-loaded.
- Sound: the one microphone's levels feed every live look.

## Left to the builder

- Architecture for several live looks, as long as the budget holds. Strong hint: prefer fewer GPU contexts and fewer video streams (for example rendering the looks into tiles of one shared canvas and giving each look face the right sub-rectangle) over one WebGL context plus one `captureStream` per look; weigh that against the existing "slice of a video" mechanism. Also consider lower render size for a look on a small face and idling looks that are not visible.
- Renderer API shape for per-face sources, and how both backends dedupe shared textures.
- Message shapes on the channel (extending or replacing `generator` and `surfaces`), as long as they pass strict validation.
- UI layout, naming, how the "same as Face N" control looks, default slices when a source changes.
- Test approach: pure logic tested as in the repo (parser, source resolution, look-sharing rules, deletion rules, cap rules); rendering needs a live pixel check in headless Chrome as the shapes work did; the real heat and frame-rate check on the laptop is Lyndz's.

## My calls (flag for Lyndz)

- Hard cap of 4 distinct live looks (from "3 or 4 at once"). Sharers do not count extra.
- The toolbar Test pattern button stays a wall-wide override.
- Deleting an owner makes sharers the owners of that look rather than dropping their picture.
- Per-face Speed and Auto-shuffle belong to the look (so shared faces share them).
- **Face identity:** sharing links refer to a face by its existing unique `id` (`s1`, `s2`, ...; the parser already enforces unique ids), never by list position, so deleting or reordering faces never rewrites links. (Answered by the code.)
- **Old state:** the Visuals "on" flag was never saved (not in setups, and `remember.ts` never stores `on`), so there is nothing to migrate: old setups and the app after reload start every face on Video, exactly as the spec says. The remembered look, shuffle, style pick and speed (`hypermapping.generator.v1`) just seed the first new look so Lyndz's last-used style carries over; later new looks start from a fresh random look.
- **More than 4 distinct looks in a file or message:** keep the first 4 (in face order) and demote the extra look-owning faces to Video; faces sharing a kept look stay shared. One shared normalising function enforces this wherever a face list comes in (parser, Setups load/import, autosave restore, channel messages), so the Editor, Output window and simulator can never disagree. A sharing link to a missing face, to itself, or to a face that does not own a look is repaired to "own look" (not rejected). Unknown source values still reject the whole list.
- **Look state is its own object per look** (style, seed, speed, shuffle, style pick) held outside the face geometry but stored with the face in saved setups. A restored look restarts cleanly: no previous look, no mid-fade. Each look has its own time anchor; determinism between Editor, Output window and simulator is per look. Cross-fades on Randomize/Auto-shuffle stay as today.
- **Visuals panel:** there is always exactly one selected face, so the panel always edits it; there is no multi-select and no hidden "default look".
- **Performance budget:** target is a steady 30 fps drawn with 4 live looks on the laptop with the thermal guard active. The builder may lower a look's render size (not below 640x360) or its capture rate (not below 24 fps) and use a global quality step in the thermal guard without asking; the 4-look cap does not move without Lyndz's say-so. If the budget still cannot be met, report it rather than shipping it.
