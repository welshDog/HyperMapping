import { useRef } from 'react';
import { useOutputFeed } from './useOutputFeed';
import { useRenderer } from './useRenderer';
import { useWakeLock } from './wakeLock';

/** Projector view: nothing but the warped video. Click once to go fullscreen. */
export function Output() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { renderer, error } = useRenderer(canvasRef);
  useWakeLock(true); // a projector screen must never dim
  const { resumeVideo } = useOutputFeed(renderer);

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
