import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { CHANNEL, parseMsg } from '../output/protocol';
import { createVideoFromBlob, type VideoHandle } from '../sources/video';
import { addSurface, defaultCorners, isValidSrcRect, removeSurface, selectAfterRemove } from '../surfaces/model';
import { FULL_RECT, type SrcRect, type Surface } from '../surfaces/types';
import { isValidQuad } from '../warp/quad';
import type { Corners } from '../warp/types';
import { PinOverlay } from './PinOverlay';
import { SliceEditor } from './SliceEditor';
import { SurfaceBar } from './SurfaceBar';
import { useRenderer } from './useRenderer';
import { useWakeLock } from './wakeLock';

const TAP_TO_START = 'Tap anywhere to start the video';

const INITIAL_SURFACES: Surface[] = [{ id: 's1', corners: defaultCorners(0, 1), srcRect: FULL_RECT }];

export function Editor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { renderer, error, quality } = useRenderer(canvasRef);
  // The face list lives in a ref: pin drags mutate it without re-rendering React.
  const surfacesRef = useRef<Surface[]>(INITIAL_SURFACES);
  const [selectedId, setSelectedId] = useState('s1');
  const [, setVersion] = useState(0); // bumps when the face list or selection changes (never during a drag)
  const [repaint, setRepaint] = useState(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const videoRef = useRef<VideoHandle | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const [mode, setMode] = useState<'edit' | 'play'>('edit');
  const [sliceMode, setSliceMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useWakeLock(mode === 'play'); // the detached video gets no playback wake lock of its own

  const bump = () => setVersion((v) => v + 1);

  /** The single place a face list change goes out: ref, renderer, and the output window. */
  const publish = useCallback(
    (list: Surface[]) => {
      surfacesRef.current = list;
      renderer?.setSurfaces(list);
      channelRef.current?.postMessage({ type: 'surfaces', surfaces: list });
    },
    [renderer],
  );

  useEffect(() => {
    renderer?.setSurfaces(surfacesRef.current);
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
      ch.postMessage({ type: 'surfaces', surfaces: surfacesRef.current });
      if (blobRef.current) ch.postMessage({ type: 'video', blob: blobRef.current });
    };
    // An output window that was already open (e.g. this editor was reloaded) never sends
    // a new hello, so push our state once now.
    ch.postMessage({ type: 'surfaces', surfaces: surfacesRef.current });
    if (blobRef.current) ch.postMessage({ type: 'video', blob: blobRef.current });
    return () => {
      ch.close();
      channelRef.current = null;
      videoRef.current?.dispose();
    };
  }, []);

  /** A pin move on one face. A bad quad is rejected for that face only. */
  const onCornersChange = useCallback(
    (id: string, next: Corners) => {
      if (!isValidQuad(next)) return false;
      publish(surfacesRef.current.map((s) => (s.id === id ? { ...s, corners: next } : s)));
      return true;
    },
    [publish],
  );

  const resetFace = () => {
    const list = surfacesRef.current;
    const index = list.findIndex((s) => s.id === selectedId);
    if (index < 0) return;
    if (onCornersChange(selectedId, defaultCorners(index, list.length))) setRepaint((n) => n + 1);
  };

  const addFace = () => {
    const next = addSurface(surfacesRef.current);
    if (next === surfacesRef.current) return;
    publish(next);
    setSelectedId(next[next.length - 1].id);
    bump();
  };

  const deleteFace = () => {
    const list = surfacesRef.current;
    const next = removeSurface(list, selectedId);
    if (next === list) return;
    const nextSelected = selectAfterRemove(list, selectedId);
    publish(next);
    setSelectedId(nextSelected);
    bump();
  };

  const onSliceChange = (id: string, rect: SrcRect) => {
    if (!isValidSrcRect(rect)) return;
    publish(surfacesRef.current.map((s) => (s.id === id ? { ...s, srcRect: rect } : s)));
    bump(); // the slice panel is a small tree; re-rendering it per move is fine
  };

  const videoAspect = (() => {
    const v = videoRef.current?.video;
    return v && v.videoWidth > 0 && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 16 / 9;
  })();

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
        <PinOverlay
          surfacesRef={surfacesRef}
          selectedId={selectedId}
          onChange={onCornersChange}
          repaintSignal={repaint}
        />
      )}

      {mode === 'edit' ? (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-2 bg-black/70 p-3 text-sm backdrop-blur">
          <SurfaceBar
            surfaces={surfacesRef.current}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              bump();
            }}
            onAdd={addFace}
            onDelete={deleteFace}
            onEditSlice={() => setSliceMode(true)}
          />
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
          <button className="rounded-lg bg-zinc-700 px-4 py-3" onClick={resetFace}>
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

      {mode === 'edit' && sliceMode && (
        <SliceEditor
          surfaces={surfacesRef.current}
          selectedId={selectedId}
          videoAspect={videoAspect}
          onChange={onSliceChange}
          onClose={() => setSliceMode(false)}
        />
      )}
    </div>
  );
}
