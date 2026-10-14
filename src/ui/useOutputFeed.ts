import { useCallback, useEffect, useRef } from 'react';
import { CHANNEL, parseMsg } from '../output/protocol';
import type { Renderer } from '../renderer';
import { createPatternSource, wantsPattern, type PatternSource } from '../sources/pattern';
import { createVideoFromBlob, type VideoHandle } from '../sources/video';
import type { Surface } from '../surfaces/types';

/**
 * Connects a renderer to the editor over the channel, exactly like the Output window always did:
 * says `hello`, applies the face lists it receives and plays the video it receives. If `onSurfaces`
 * is given it is called INSTEAD of `renderer.setSurfaces` (the simulator uses this to ignore the
 * app's faces while it shows its own layout).
 *
 * It also owns a built-in test pattern: shown whenever no video is loaded, or when the Editor's
 * Test pattern button is on (a `pattern` message), so the Output window and the simulator are never
 * just black.
 */
export function useOutputFeed(renderer: Renderer | null, onSurfaces?: (surfaces: Surface[]) => void) {
  const handleRef = useRef<VideoHandle | null>(null);
  const patternRef = useRef<PatternSource | null>(null);
  const onSurfacesRef = useRef(onSurfaces);
  onSurfacesRef.current = onSurfaces;

  // A refused autoplay or a backgrounded tab leaves the video paused on one frame.
  const resumeVideo = useCallback(() => {
    const v = handleRef.current?.video;
    if (v?.paused) v.play().catch(() => {});
    patternRef.current?.ensurePlaying();
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
    const pattern = createPatternSource(); // null when the browser cannot make it
    patternRef.current = pattern;

    /** Give the renderer the pattern or the video, whichever should be showing. */
    const apply = () => {
      const video = handleRef.current;
      const source = wantsPattern(force, video !== null) && pattern ? pattern.video : video ? video.video : null;
      renderer.setVideo(source);
    };
    apply();

    ch.onmessage = async (ev) => {
      const msg = parseMsg(ev.data);
      if (!msg) return;
      if (msg.type === 'surfaces') {
        if (onSurfacesRef.current) onSurfacesRef.current(msg.surfaces);
        else renderer.setSurfaces(msg.surfaces);
      } else if (msg.type === 'pattern') {
        force = msg.on;
        apply();
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
      handleRef.current?.dispose();
      handleRef.current = null;
      pattern?.dispose();
      patternRef.current = null;
      renderer.setVideo(null);
    };
  }, [renderer]);

  return { resumeVideo };
}
