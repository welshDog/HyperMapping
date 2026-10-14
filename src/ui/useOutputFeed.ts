import { useCallback, useEffect, useRef } from 'react';
import { CHANNEL, parseMsg } from '../output/protocol';
import type { Renderer } from '../renderer';
import { createVideoFromBlob, type VideoHandle } from '../sources/video';
import type { Surface } from '../surfaces/types';

/**
 * Connects a renderer to the editor over the channel, exactly like the Output window always did:
 * says `hello`, applies the face lists it receives and plays the video it receives. If `onSurfaces`
 * is given it is called INSTEAD of `renderer.setSurfaces` (the simulator uses this to ignore the
 * app's faces while it shows its own layout).
 */
export function useOutputFeed(renderer: Renderer | null, onSurfaces?: (surfaces: Surface[]) => void) {
  const handleRef = useRef<VideoHandle | null>(null);
  const onSurfacesRef = useRef(onSurfaces);
  onSurfacesRef.current = onSurfaces;

  // A refused autoplay or a backgrounded tab leaves the video paused on one frame.
  const resumeVideo = useCallback(() => {
    const v = handleRef.current?.video;
    if (v?.paused) v.play().catch(() => {});
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

    ch.onmessage = async (ev) => {
      const msg = parseMsg(ev.data);
      if (!msg) return;
      if (msg.type === 'surfaces') {
        if (onSurfacesRef.current) onSurfacesRef.current(msg.surfaces);
        else renderer.setSurfaces(msg.surfaces);
      } else if (msg.type === 'video') {
        const mine = ++latest;
        try {
          const next = await createVideoFromBlob(msg.blob);
          if (mine !== latest) {
            next.dispose();
            return;
          }
          try {
            renderer.setVideo(next.video);
          } catch (e) {
            next.dispose(); // never leak a video the renderer refused
            throw e;
          }
          // Swap only after the renderer holds the new video, so it never draws a disposed one.
          handleRef.current?.dispose();
          handleRef.current = next;
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
      renderer.setVideo(null);
    };
  }, [renderer]);

  return { resumeVideo };
}
