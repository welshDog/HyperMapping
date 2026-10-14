import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { CHANNEL, parseMsg } from '../output/protocol';
import { createVideoFromBlob, type VideoHandle } from '../sources/video';
import { isValidQuad } from '../warp/quad';
import type { Corners } from '../warp/types';
import { PinOverlay } from './PinOverlay';
import { useRenderer } from './useRenderer';
import { useWakeLock } from './wakeLock';

const TAP_TO_START = 'Tap anywhere to start the video';

const INITIAL: Corners = { tl: [0.2, 0.2], tr: [0.8, 0.2], br: [0.8, 0.8], bl: [0.2, 0.8] };

export function Editor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { renderer, error, quality } = useRenderer(canvasRef);
  const cornersRef = useRef<Corners>(INITIAL);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const videoRef = useRef<VideoHandle | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const [mode, setMode] = useState<'edit' | 'play'>('edit');
  const [notice, setNotice] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  useWakeLock(mode === 'play'); // the detached video gets no playback wake lock of its own

  useEffect(() => {
    renderer?.setCorners(cornersRef.current);
  }, [renderer]);

  // Autoplay can be refused, and backgrounding pauses the video: a paused video
  // would otherwise show its first frame forever. Any tap, or coming back to the
  // page, restarts it.
  const resumeVideo = useCallback(() => {
    const v = videoRef.current?.video;
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
    const ch = new BroadcastChannel(CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (ev) => {
      if (parseMsg(ev.data)?.type !== 'hello') return;
      // A new output window asked for everything we have.
      ch.postMessage({ type: 'state', corners: cornersRef.current });
      if (blobRef.current) ch.postMessage({ type: 'video', blob: blobRef.current });
    };
    return () => {
      ch.close();
      channelRef.current = null;
      videoRef.current?.dispose();
    };
  }, []);

  const onCornersChange = useCallback(
    (next: Corners) => {
      if (!isValidQuad(next)) return false;
      cornersRef.current = next;
      renderer?.setCorners(next);
      channelRef.current?.postMessage({ type: 'state', corners: next });
      return true;
    },
    [renderer],
  );

  const resetCorners = () => {
    if (onCornersChange(INITIAL)) setResetSignal((n) => n + 1);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !renderer) return;
    try {
      const handle = await createVideoFromBlob(file);
      videoRef.current?.dispose();
      videoRef.current = handle;
      blobRef.current = file;
      renderer.setVideo(handle.video);
      channelRef.current?.postMessage({ type: 'video', blob: file });
      if (handle.playing) {
        setNotice(null);
      } else {
        setNotice(TAP_TO_START);
        handle.video.addEventListener('playing', () => setNotice((n) => (n === TAP_TO_START ? null : n)), {
          once: true,
        });
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not load that video');
    }
  };

  // Called from the button's click (a user gesture), which fullscreen requires.
  const enterPlay = () => {
    setMode('play');
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // Leaving fullscreen by a system gesture keeps Play mode; only this button leaves it.
  const exitPlay = () => {
    setMode('edit');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };

  const openOutput = () => {
    window.open(`${location.pathname}#output`, 'hypermapping-output', 'popup,width=960,height=540');
  };

  return (
    // Capture phase so a tap on a pin or a toolbar button also counts as "tap anywhere".
    <div
      className="fixed inset-0 touch-none select-none overflow-hidden bg-black text-white"
      onPointerDownCapture={resumeVideo}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {mode === 'edit' && (
        <PinOverlay cornersRef={cornersRef} onChange={onCornersChange} resetSignal={resetSignal} />
      )}

      {mode === 'edit' ? (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-2 bg-black/70 p-3 text-sm backdrop-blur">
          <label
            className={`rounded-lg px-4 py-3 font-medium ${
              renderer ? 'cursor-pointer bg-cyan-500 text-black' : 'bg-zinc-700 text-zinc-400'
            }`}
          >
            Load video
            <input type="file" accept="video/*" className="hidden" disabled={!renderer} onChange={onFile} />
          </label>
          <button className="rounded-lg bg-zinc-700 px-4 py-3" onClick={enterPlay}>
            Play mode
          </button>
          <button className="rounded-lg bg-zinc-700 px-4 py-3" onClick={resetCorners}>
            Reset corners
          </button>
          <button className="rounded-lg bg-zinc-700 px-4 py-3" onClick={openOutput}>
            Open output window
          </button>
          <span className="ml-auto text-xs text-zinc-400">
            {error ?? `${renderer?.kind ?? 'starting…'} · ${Math.round(quality.scale * 100)}% · ${quality.fpsCap}fps`}
          </span>
          {notice && <span className="w-full text-xs text-amber-400">{notice}</span>}
        </div>
      ) : (
        <button
          aria-label="Exit play mode"
          className="absolute left-0 top-0 z-20 h-16 w-16 opacity-0"
          onClick={exitPlay}
        />
      )}
    </div>
  );
}
