import { useCallback, useEffect, useRef } from 'react';
import { CHANNEL, parseMsg } from '../output/protocol';
import { createVideoFromBlob, type VideoHandle } from '../sources/video';
import { useRenderer } from './useRenderer';
import { useWakeLock } from './wakeLock';

/** Projector view: nothing but the warped video. Click once to go fullscreen. */
export function Output() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { renderer, error } = useRenderer(canvasRef);
  useWakeLock(true); // a projector screen must never dim
  const handleRef = useRef<VideoHandle | null>(null);

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
      if (msg.type === 'state') {
        renderer.setCorners(msg.corners);
      } else if (msg.type === 'video') {
        const mine = ++latest;
        try {
          const next = await createVideoFromBlob(msg.blob);
          if (mine !== latest) {
            next.dispose();
            return;
          }
          handleRef.current?.dispose();
          handleRef.current = next;
          renderer.setVideo(next.video);
        } catch (e) {
          console.warn('[hypermapping] output could not load video', e);
        }
      }
    };
    ch.postMessage({ type: 'hello' });

    return () => {
      ch.close();
      handleRef.current?.dispose();
      handleRef.current = null;
      renderer.setVideo(null);
    };
  }, [renderer]);

  return (
    <div
      className="fixed inset-0 cursor-none bg-black"
      onPointerDown={resumeVideo}
      onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      {error && <p className="absolute left-4 top-4 text-sm text-amber-400">{error}</p>}
    </div>
  );
}
