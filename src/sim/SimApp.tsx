import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createRenderer, type Renderer } from '../renderer';
import { useOutputFeed } from '../ui/useOutputFeed';
import type { Box } from './box';
import { DEFAULT_BOX, DEFAULT_PROJECTOR } from './defaults';
import { SimScene } from './scene';
import { SimControls } from './SimControls';
import type { Projector } from './solve';

const OUTPUT_HEIGHT = 720;

export function SimApp() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box>(DEFAULT_BOX);
  const [projector, setProjector] = useState<Projector>(DEFAULT_PROJECTOR);
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [outCanvas, setOutCanvas] = useState<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sceneRef = useRef<SimScene | null>(null);

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

  useOutputFeed(renderer);

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

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-white md:flex-row">
      <div ref={hostRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden" />
      <aside className="max-h-[45%] w-full shrink-0 overflow-auto border-t border-zinc-800 p-4 md:max-h-none md:w-80 md:border-l md:border-t-0">
        <h1 className="mb-1 text-base font-semibold">Virtual projector</h1>
        <p className="mb-3 text-xs text-zinc-400">
          Open the main app in another tab and load a video: it appears on the box here.
        </p>
        {error && <p className="mb-2 text-xs text-amber-400">{error}</p>}
        <SimControls box={box} projector={projector} onBox={setBox} onProjector={setProjector} />
      </aside>
    </div>
  );
}
