import { useEffect, useState, type RefObject } from 'react';
import { ThermalGuard, computeBackingSize, createRenderer, type Quality, type Renderer } from '../renderer';

/** Owns the renderer's lifetime, canvas sizing, and the thermal guard. */
export function useRenderer(canvasRef: RefObject<HTMLCanvasElement>) {
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>({ scale: 1, fpsCap: 60 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let active: Renderer | null = null;
    let scale = 1;
    const guard = new ThermalGuard();

    const fit = () => {
      const { w, h } = computeBackingSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio, scale);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    fit();

    createRenderer(canvas)
      .then((r) => {
        if (disposed) {
          r.destroy();
          return;
        }
        active = r;
        r.onFrameTime = (ms) => {
          const q = guard.push(ms);
          if (q.scale !== scale) {
            scale = q.scale;
            fit();
          }
          r.setFpsCap(q.fpsCap);
          setQuality((prev) => (prev.scale === q.scale && prev.fpsCap === q.fpsCap ? prev : q));
        };
        r.start();
        setRenderer(r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      disposed = true;
      observer.disconnect();
      active?.destroy();
    };
  }, [canvasRef]);

  return { renderer, error, quality };
}
