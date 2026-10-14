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
        r.onDeviceLost = () => setError('Graphics device lost — reload the page');
        let last: Quality = guard.quality;
        r.onFrameTime = (ms) => {
          const q = guard.push(ms);
          if (q.scale === last.scale && q.fpsCap === last.fpsCap) return;
          last = q;
          // Logged only on change, so a thermal run leaves a readable timeline.
          console.info('[hypermapping] quality', { t: Math.round(performance.now()), scale: q.scale, fpsCap: q.fpsCap });
          if (q.scale !== scale) {
            scale = q.scale;
            fit();
          }
          r.setFpsCap(q.fpsCap);
          setQuality(q);
        };
        r.start();
        setRenderer(r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      disposed = true;
      observer.disconnect();
      if (active) {
        active.onDeviceLost = undefined;
        active.onFrameTime = null;
        active.destroy();
      }
    };
  }, [canvasRef]);

  return { renderer, error, quality };
}
