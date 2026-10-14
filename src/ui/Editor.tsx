import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CHANNEL, parseMsg } from '../output/protocol';
import { createPatternSource, wantsPattern, type PatternSource } from '../sources/pattern';
import { createVideoFromBlob, type VideoHandle } from '../sources/video';
import { SNAP_RADIUS_PX, moveGluedPin, type PinRef } from '../surfaces/glue';
import { addSurface, defaultCorners, isValidSrcRect, removeSurface, selectAfterRemove } from '../surfaces/model';
import { FULL_RECT, type SrcRect, type Surface } from '../surfaces/types';
import { isValidQuad } from '../warp/quad';
import { createAutosaver } from '../setups/autosave';
import { getBrowserStore } from '../setups/browser-store';
import { clearAutosave, loadAutosave, saveAutosave } from '../setups/setups';
import type { Corners, Vec2 } from '../warp/types';
import { PinOverlay } from './PinOverlay';
import { SliceEditor } from './SliceEditor';
import { SetupsPanel } from './SetupsPanel';
import { SurfaceBar } from './SurfaceBar';
import { useRenderer } from './useRenderer';
import { useWakeLock } from './wakeLock';

const TAP_TO_START = 'Tap anywhere to start the video';

const INITIAL_SURFACES: Surface[] = [{ id: 's1', corners: defaultCorners(0, 1), srcRect: FULL_RECT }];

export function Editor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { renderer, error, quality } = useRenderer(canvasRef);
  // Browser storage (null in a private window). The last layout is restored on reload.
  const store = useMemo(() => getBrowserStore(), []);
  const [startSurfaces] = useState<Surface[]>(() => (store ? loadAutosave(store) : null) ?? INITIAL_SURFACES);
  // The face list lives in a ref: pin drags mutate it without re-rendering React.
  const surfacesRef = useRef<Surface[]>(startSurfaces);
  const [selectedId, setSelectedId] = useState(startSurfaces[0].id);
  const [, setVersion] = useState(0); // bumps when the face list or selection changes (never during a drag)
  const [repaint, setRepaint] = useState(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const videoRef = useRef<VideoHandle | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const patternRef = useRef<PatternSource | null>(null);
  const [patternAvailable, setPatternAvailable] = useState(true); // false when the browser cannot make the pattern
  const [patternForce, setPatternForce] = useState(false); // show the pattern even when a video is loaded; not saved
  const patternForceRef = useRef(false); // read by the channel effect and applySource
  const adoptLayoutRef = useRef<(list: Surface[]) => void>(() => {});
  const [mode, setMode] = useState<'edit' | 'play'>('edit');
  const [sliceMode, setSliceMode] = useState(false);
  const [setupsOpen, setSetupsOpen] = useState(false);
  const dragBaseRef = useRef<Surface[] | null>(null);
  const [glue, setGlue] = useState(true); // pins on the same spot move together and snap; not saved
  const [notice, setNotice] = useState<string | null>(null);
  useWakeLock(mode === 'play'); // the detached video gets no playback wake lock of its own

  const bump = () => setVersion((v) => v + 1);

  // One debounced writer remembers the layout for the next reload.
  const autosaver = useMemo(
    () =>
      createAutosaver((list) => {
        if (store) saveAutosave(store, list, Date.now());
      }, 400),
    [store],
  );

  /** The single place a face list change goes out: ref, renderer, the output window, and the autosave. */
  const publish = useCallback(
    (list: Surface[]) => {
      surfacesRef.current = list;
      renderer?.setSurfaces(list);
      channelRef.current?.postMessage({ type: 'surfaces', surfaces: list });
      autosaver.schedule(list);
    },
    [renderer, autosaver],
  );

  // Save the layout right away when the page is hidden or closed, and when the Editor unmounts.
  useEffect(() => {
    const flush = () => autosaver.flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [autosaver]);

  useEffect(() => {
    renderer?.setSurfaces(surfacesRef.current);
  }, [renderer]);

  /** Give the renderer the test pattern or the video, whichever should be showing. */
  const applySource = useCallback(() => {
    if (!renderer) return;
    const pattern = patternRef.current;
    const video = videoRef.current;
    const source = wantsPattern(patternForceRef.current, video !== null) && pattern ? pattern.video : video ? video.video : null;
    renderer.setVideo(source);
  }, [renderer]);

  // The test pattern source lives as long as the renderer; it is shown while there is no video.
  useEffect(() => {
    if (!renderer) return;
    const source = createPatternSource();
    patternRef.current = source;
    setPatternAvailable(source !== null);
    if (source === null && patternForceRef.current) {
      patternForceRef.current = false;
      setPatternForce(false);
      channelRef.current?.postMessage({ type: 'pattern', on: false });
    }
    applySource();
    return () => {
      source?.dispose();
      if (patternRef.current === source) patternRef.current = null;
    };
  }, [renderer, applySource]);

  const togglePattern = () => {
    const next = !patternForceRef.current;
    patternForceRef.current = next;
    setPatternForce(next);
    channelRef.current?.postMessage({ type: 'pattern', on: next });
    applySource();
  };

  // Autoplay can be refused, and backgrounding pauses the video: a paused video
  // would otherwise show its first frame forever. Any tap, or coming back to the
  // page, restarts it.
  const resumeVideo = useCallback(() => {
    const v = videoRef.current?.video;
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
    const ch = new BroadcastChannel(CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (ev) => {
      const msg = parseMsg(ev.data);
      if (msg?.type === 'layout') {
        adoptLayoutRef.current(msg.surfaces);
        return;
      }
      if (msg?.type !== 'hello') return;
      // A new output window asked for everything we have.
      ch.postMessage({ type: 'surfaces', surfaces: surfacesRef.current });
      ch.postMessage({ type: 'pattern', on: patternForceRef.current });
      if (blobRef.current) ch.postMessage({ type: 'video', blob: blobRef.current });
    };
    // An output window that was already open (e.g. this editor was reloaded) never sends
    // a new hello, so push our state once now.
    ch.postMessage({ type: 'surfaces', surfaces: surfacesRef.current });
    ch.postMessage({ type: 'pattern', on: patternForceRef.current });
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

  /**
   * A pin of the selected face was dragged. With Glue on, pins glued to it (same spot, any face) move
   * with it and it snaps onto a nearby pin of another face; a move that would break any face is refused.
   *
   * Every move of a drag is computed from the layout as it was when the drag STARTED, not from the
   * previous move's result: the snap then holds while the pointer is inside the radius and releases
   * when it leaves, the target pin is never dragged along by a fly-by (once snapped it would count as
   * glued), and toggling Glue mid-drag returns partners to their start positions. A refused move
   * returns false, so the pin stays at its last accepted spot. Accepted rare case: a layout change
   * from elsewhere during a drag (e.g. a simulator `layout` message) is overwritten by the next move.
   */
  const onPinMove = useCallback(
    (ref: PinRef, p: Vec2, size: { w: number; h: number }) => {
      const next = moveGluedPin(dragBaseRef.current ?? surfacesRef.current, ref, p, { glue, radiusPx: SNAP_RADIUS_PX, size });
      if (!next) return false;
      publish(next);
      return true;
    },
    [glue, publish],
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

  // The simulator computed a face layout: replace the face list, select the first face.
  // Stored in a ref because the channel effect below runs once and must see the latest `publish`.
  adoptLayoutRef.current = (list: Surface[]) => {
    publish(list);
    setSelectedId(list[0].id);
    setRepaint((n) => n + 1);
    bump();
  };

  // Back to a single default face; also forgets the remembered layout.
  const startFresh = () => {
    adoptLayoutRef.current(INITIAL_SURFACES);
    autosaver.cancel();
    if (store) clearAutosave(store);
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
      applySource();
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
          onPinMove={onPinMove}
          onPinDragStart={() => {
            dragBaseRef.current = surfacesRef.current;
          }}
          onPinDragEnd={() => {
            dragBaseRef.current = null;
          }}
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
          <button
            aria-pressed={glue}
            className={`rounded-lg px-4 py-3 font-medium min-w-[7.5rem] ${glue ? 'bg-cyan-500 text-black' : 'bg-zinc-700'}`}
            onClick={() => setGlue((g) => !g)}
          >
            Glue: {glue ? 'on' : 'off'}
          </button>
          <button
            aria-pressed={patternForce}
            disabled={!patternAvailable}
            title={patternAvailable ? undefined : 'Not supported in this browser'}
            className={`rounded-lg px-4 py-3 font-medium min-w-[9rem] disabled:opacity-40 ${patternForce ? 'bg-cyan-500 text-black' : 'bg-zinc-700'}`}
            onClick={togglePattern}
          >
            Test pattern: {patternForce ? 'on' : 'off'}
          </button>
          <button className="rounded-lg bg-zinc-700 px-4 py-3" onClick={openOutput}>
            Open output window
          </button>
          <button className="rounded-lg bg-zinc-700 px-4 py-3" onClick={() => setSetupsOpen(true)}>
            Setups
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

      {mode === 'edit' && setupsOpen && (
        <SetupsPanel
          store={store}
          getSurfaces={() => surfacesRef.current}
          hasVideo={blobRef.current !== null}
          onLoad={(list) => adoptLayoutRef.current(list)}
          onStartFresh={startFresh}
          onClose={() => setSetupsOpen(false)}
        />
      )}
    </div>
  );
}
