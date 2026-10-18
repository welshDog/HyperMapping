import { useCallback, useEffect, useRef } from 'react';
import { createGeneratorSource } from '../generator/source';
import { createLookPool, type LookPool } from '../generator/pool';
import type { LookStates } from '../generator/looks';
import { sameSettings, settingsFromState, stateFromSettings } from '../generator/settings';
import type { GeneratorState } from '../generator/shuffle';
import { CHANNEL, parseMsg } from '../output/protocol';
import type { Renderer } from '../renderer';
import { createPatternSource, type PatternSource } from '../sources/pattern';
import { resolveFaceSources, visibleLookOwners } from '../sources/resolve';
import { createVideoFromBlob, type VideoHandle } from '../sources/video';
import { lookOwners } from '../surfaces/sources';
import type { Surface } from '../surfaces/types';

/**
 * Connects a renderer to the editor over the channel, exactly like the Output window always did:
 * says `hello`, applies the face lists it receives and plays the video it receives. If `onSurfaces`
 * is given it is called INSTEAD of `renderer.setSurfaces` (the simulator uses this to ignore the
 * app's faces while it shows its own layout).
 *
 * Each face picks its own source (video, test pattern or a random-visuals look). The hook keeps the
 * latest faces and `looks` states, owns the look pool, the pattern and the video, and re-resolves what
 * every face shows whenever any of them changes. The Editor's Test pattern button (a `pattern`
 * message) overrides every face.
 *
 * `setUniformSource(true)` makes every face show the same fallback picture (video, else pattern) and
 * ignore looks: the simulator uses it while it shows its own layout, whose ids collide with the app's.
 */
export function useOutputFeed(renderer: Renderer | null, onSurfaces?: (surfaces: Surface[]) => void) {
  const handleRef = useRef<VideoHandle | null>(null);
  const patternRef = useRef<PatternSource | null>(null);
  const poolRef = useRef<LookPool | null>(null);
  const uniformRef = useRef(false);
  const applyRef = useRef<(() => void) | null>(null);
  const onSurfacesRef = useRef(onSurfaces);
  onSurfacesRef.current = onSurfaces;

  // A refused autoplay or a backgrounded tab leaves the video paused on one frame.
  const resumeVideo = useCallback(() => {
    const v = handleRef.current?.video;
    if (v?.paused) v.play().catch(() => {});
    patternRef.current?.ensurePlaying();
    poolRef.current?.ensurePlaying();
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') resumeVideo();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [resumeVideo]);

  useEffect(() => {
    if (!renderer) return;
    const ch = new BroadcastChannel(CHANNEL);
    let latest = 0; // guards against out-of-order async video loads
    let force = false; // the Editor's Test pattern button
    let surfaces: Surface[] = [];
    let looks: LookStates = {};
    const pattern = createPatternSource(); // null when the browser cannot make it
    patternRef.current = pattern;
    const pool = createLookPool(createGeneratorSource);
    poolRef.current = pool;
    const sent = new Map<string, GeneratorState>(); // what the pool already holds, by owner
    const fallback = new Map<string, GeneratorState>(); // states built here for owners the Editor has not described yet

    /** The one picture every face shows in uniform mode: pattern when forced, else video, else pattern. */
    const uniformVideo = (): HTMLVideoElement | null => {
      if (force && pattern) return pattern.video;
      const video = handleRef.current;
      return video ? video.video : (pattern?.video ?? null);
    };

    /** Work out what every face shows and hand the renderer the matching videos. */
    const apply = () => {
      if (uniformRef.current) {
        pool.sync([]);
        sent.clear();
        fallback.clear();
        pool.setActive(new Set());
        renderer.setVideo(uniformVideo());
        return;
      }
      const owners = lookOwners(surfaces);
      pool.sync(owners.map((f) => f.id));
      const ownerIds = new Set(owners.map((f) => f.id));
      for (const id of [...sent.keys()]) if (!ownerIds.has(id)) sent.delete(id);
      for (const id of [...fallback.keys()]) if (!ownerIds.has(id)) fallback.delete(id);
      for (const f of owners) {
        if (!f.look) continue;
        let state = looks[f.id];
        if (!state) {
          const cached = fallback.get(f.id);
          state = cached && sameSettings(settingsFromState(cached), f.look) ? cached : stateFromSettings(f.look, Date.now());
          fallback.set(f.id, state);
        }
        if (sent.get(f.id) !== state) {
          pool.setState(f.id, state);
          sent.set(f.id, state);
        }
      }
      const video = handleRef.current;
      const resolved = resolveFaceSources(surfaces, {
        patternForce: force,
        hasVideo: video !== null,
        patternAvailable: pattern !== null,
        generatorAvailable: pool.available,
      });
      pool.setActive(visibleLookOwners(resolved));
      const videos = new Map<string, HTMLVideoElement | null>();
      for (const [id, ref] of resolved) {
        videos.set(
          id,
          ref.kind === 'video'
            ? (video?.video ?? null)
            : ref.kind === 'pattern'
              ? (pattern?.video ?? null)
              : ref.kind === 'look'
                ? pool.video(ref.owner)
                : null,
        );
      }
      renderer.setFaceVideos(videos);
    };
    applyRef.current = apply;
    apply();

    ch.onmessage = async (ev) => {
      const msg = parseMsg(ev.data);
      if (!msg) return;
      if (msg.type === 'surfaces') {
        if (onSurfacesRef.current) onSurfacesRef.current(msg.surfaces);
        else renderer.setSurfaces(msg.surfaces);
        surfaces = msg.surfaces;
        apply();
      } else if (msg.type === 'pattern') {
        force = msg.on;
        apply();
      } else if (msg.type === 'looks') {
        looks = msg.states;
        apply();
      } else if (msg.type === 'audio') {
        pool.setAudio({ bass: msg.bass, treble: msg.treble, vol: msg.vol });
      } else if (msg.type === 'video') {
        const mine = ++latest;
        try {
          const next = await createVideoFromBlob(msg.blob);
          if (mine !== latest) {
            next.dispose();
            return;
          }
          const previous = handleRef.current;
          handleRef.current = next;
          try {
            apply();
          } catch (e) {
            handleRef.current = previous;
            next.dispose(); // never leak a video the renderer refused
            throw e;
          }
          // Swap only after the renderer holds the new source, so it never draws a disposed video.
          previous?.dispose();
        } catch (e) {
          console.warn('[hypermapping] output could not load video', e);
        }
      }
    };
    ch.postMessage({ type: 'hello' });

    return () => {
      ch.close();
      latest++; // a load still in flight is now stale: it disposes itself instead of being assigned
      applyRef.current = null;
      handleRef.current?.dispose();
      handleRef.current = null;
      pool.dispose();
      poolRef.current = null;
      pattern?.dispose();
      patternRef.current = null;
      renderer.setFaceVideos(new Map());
    };
  }, [renderer]);

  /** On: every face shows the same fallback picture and looks are ignored. Off: per-face sources. */
  const setUniformSource = useCallback((on: boolean) => {
    if (uniformRef.current === on) return;
    uniformRef.current = on;
    applyRef.current?.();
  }, []);

  return { resumeVideo, setUniformSource };
}
