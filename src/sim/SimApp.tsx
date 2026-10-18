import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { CHANNEL } from '../output/protocol';
import { createRenderer, type Renderer } from '../renderer';
import type { Surface } from '../surfaces/types';
import { useOutputFeed } from '../ui/useOutputFeed';
import type { Box } from './box';
import { DEFAULT_BOX, DEFAULT_PROJECTOR } from './defaults';
import { describeSolve } from './describe';
import { SimScene } from './scene';
import { SimControls } from './SimControls';
import { solveFaces, toSurfaces, type Projector } from './solve';

const OUTPUT_HEIGHT = 720;

type Mode = 'app' | 'solved';

export function SimApp() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box>(DEFAULT_BOX);
  const [projector, setProjector] = useState<Projector>(DEFAULT_PROJECTOR);
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [outCanvas, setOutCanvas] = useState<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('app');
  const [note, setNote] = useState<string | null>(null);
  const sceneRef = useRef<SimScene | null>(null);
  const pendingSend = useRef<number | null>(null);

  const solve = useMemo(() => solveFaces(box, projector), [box, projector]);
  const solvedSurfaces = useMemo(() => toSurfaces(solve), [solve]);
  const summary = useMemo(() => describeSolve(solve), [solve]);

  // The projector image: the app's own renderer drawing into a hidden canvas, exactly like an
  // Output window. Forced to WebGL2 with a preserved buffer so three.js can sample it any time.
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(OUTPUT_HEIGHT * projector.aspect);
    canvas.height = OUTPUT_HEIGHT;
    let disposed = false;
    let created: Renderer | null = null;
    createRenderer(canvas, 'webgl2', { preserveDrawingBuffer: true })
      .then((r) => {
        if (disposed) {
          r.destroy();
          return;
        }
        created = r;
        r.start();
        setOutCanvas(canvas);
        setRenderer(r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      created?.destroy();
      setRenderer(null);
      setOutCanvas(null);
    };
  }, [projector.aspect]);

  // Faces from the main app are remembered always, but only drawn while we follow the app.
  const appSurfaces = useRef<Surface[]>([]);
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const rendererRef = useRef<Renderer | null>(renderer);
  rendererRef.current = renderer;
  const onAppSurfaces = useCallback((s: Surface[]) => {
    appSurfaces.current = s;
    if (pendingSend.current !== null) {
      // The main app answered our layout message with its new faces: only now do we know the send
      // worked, so only now follow the app again (and without a frame of the old layout).
      window.clearTimeout(pendingSend.current);
      pendingSend.current = null;
      rendererRef.current?.setSurfaces(s); // modeRef is stale until the next render
      setMode('app');
      setNote('The main app now uses this layout (nudge the pins to fine-tune).');
      return;
    }
    if (modeRef.current === 'app') rendererRef.current?.setSurfaces(s);
  }, []);
  const { resumeVideo, setUniformSource } = useOutputFeed(renderer, onAppSurfaces);
  // The solved layout's face ids collide with the app's, so there every face shows one shared picture.
  useEffect(() => {
    setUniformSource(mode === 'solved');
  }, [mode, setUniformSource]);

  const cancelPendingSend = () => {
    if (pendingSend.current !== null) window.clearTimeout(pendingSend.current);
    pendingSend.current = null;
  };
  useEffect(() => cancelPendingSend, []);

  // Which layout the projector image shows: the app's, or the one we just computed.
  useEffect(() => {
    if (!renderer) return;
    if (mode === 'solved') {
      renderer.setSurfaces(solvedSurfaces); // an empty list clears to black: never leave a stale picture
    } else {
      renderer.setSurfaces(appSurfaces.current);
    }
  }, [renderer, mode, solvedSurfaces]);

  // The 3D scene, created once the projector image exists.
  useEffect(() => {
    if (!outCanvas || !hostRef.current) return;
    const texture = new THREE.CanvasTexture(outCanvas);
    texture.generateMipmaps = false; // re-uploaded every frame: skip mipmap generation
    texture.minFilter = THREE.LinearFilter;
    const scene = new SimScene(hostRef.current, texture);
    sceneRef.current = scene;
    scene.start();
    return () => {
      scene.dispose();
      texture.dispose();
      sceneRef.current = null;
    };
  }, [outCanvas]);

  useEffect(() => {
    sceneRef.current?.setLayout(box, projector);
  }, [box, projector, outCanvas]);

  const sendToApp = () => {
    if (!solvedSurfaces.length) return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ type: 'layout', surfaces: solvedSurfaces });
    ch.close();
    // Do not claim success or switch layout yet: the mode flips only when the app echoes its faces.
    setNote('Sending…');
    cancelPendingSend();
    pendingSend.current = window.setTimeout(() => {
      pendingSend.current = null;
      setNote('No main app tab answered. Open the main app and press Send again.');
    }, 1500);
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-white md:flex-row" onPointerDown={resumeVideo}>
      <div ref={hostRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden" />
      <aside className="max-h-[45%] w-full shrink-0 overflow-auto border-t border-zinc-800 p-4 md:max-h-none md:w-80 md:border-l md:border-t-0">
        <h1 className="mb-1 text-base font-semibold">Virtual projector</h1>
        <p className="mb-3 text-xs text-zinc-400">
          Open the main app in another tab and load a video: it appears on the box here.
        </p>
        {error && <p className="mb-2 text-xs text-amber-400">{error}</p>}
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-black" onClick={() => { cancelPendingSend(); setMode('solved'); setNote(null); }}>
            Solve
          </button>
          <button
            className="rounded-lg bg-zinc-700 px-3 py-2 text-sm disabled:opacity-40"
            disabled={mode !== 'solved' || solvedSurfaces.length === 0}
            onClick={sendToApp}
          >
            Send to app
          </button>
          <button className="rounded-lg bg-zinc-700 px-3 py-2 text-sm disabled:opacity-40" disabled={mode === 'app'} onClick={() => { cancelPendingSend(); setMode('app'); setNote(null); }}>
            Show app layout
          </button>
        </div>
        <p className="mb-1 text-xs text-zinc-400">
          Showing: <span className="text-white">{mode === 'solved' ? 'computed layout' : "the main app's layout"}</span>
        </p>
        <p className="mb-2 text-xs text-zinc-500">Send to app replaces the main app's faces with the computed ones.</p>
        <ul className="mb-3 list-disc pl-4 text-xs text-zinc-300">
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {note && <p className="mb-3 text-xs text-emerald-400">{note}</p>}

        <SimControls box={box} projector={projector} onBox={setBox} onProjector={setProjector} />
      </aside>
    </div>
  );
}
