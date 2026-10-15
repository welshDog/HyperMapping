import { useEffect, useRef } from 'react';
import { drawScanFrame } from '../calibrate/patterns';
import { CHANNEL, parseMsg } from '../output/protocol';

/**
 * The projector side of calibration: tells the Editor how big this window is, and paints scan frames
 * on an overlay canvas (which covers the picture while a frame is up; null hides it again).
 */
export function useScanDisplay() {
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL);
    const report = () =>
      ch.postMessage({ type: 'output-size', w: window.innerWidth, h: window.innerHeight, fullscreen: document.fullscreenElement !== null });
    const hide = () => {
      if (overlayRef.current) overlayRef.current.style.display = 'none';
    };
    ch.onmessage = (ev) => {
      const msg = parseMsg(ev.data);
      if (!msg) return;
      if (msg.type === 'probe') report();
      else if (msg.type === 'scan-frame') {
        const canvas = overlayRef.current;
        if (!canvas) return;
        if (msg.spec === null) return hide();
        canvas.width = msg.pw;
        canvas.height = msg.ph;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        drawScanFrame(ctx, msg.spec, msg.pw, msg.ph, msg.gw, msg.gh);
        canvas.style.display = 'block';
      }
    };
    report();
    window.addEventListener('resize', report);
    document.addEventListener('fullscreenchange', report);
    return () => {
      window.removeEventListener('resize', report);
      document.removeEventListener('fullscreenchange', report);
      hide();
      ch.close();
    };
  }, []);

  return overlayRef;
}
