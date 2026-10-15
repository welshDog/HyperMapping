/** Off-screen but NOT display:none, so mobile browsers keep producing frames. */
export const HIDDEN_VIDEO_STYLE =
  'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px';

export interface StreamVideo {
  video: HTMLVideoElement;
  stream: MediaStream;
  /** Restart playback if the browser paused it (backgrounded tab). */
  ensurePlaying(): void;
  /** Stop the tracks and remove the element. Safe to call twice. */
  dispose(): void;
}

/**
 * Capture a canvas as a live, hidden, muted video. Returns null (never throws) when the browser
 * cannot do that.
 */
export function createStreamVideo(canvas: HTMLCanvasElement, fps: number): StreamVideo | null {
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  const dispose = () => {
    stream?.getTracks().forEach((track) => track.stop());
    if (video) {
      video.pause();
      video.srcObject = null;
      video.remove();
    }
  };
  try {
    if (typeof canvas.captureStream !== 'function') return null;
    stream = canvas.captureStream(fps);

    const el = document.createElement('video');
    video = el;
    el.muted = true;
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.style.cssText = HIDDEN_VIDEO_STYLE;
    el.srcObject = stream;
    document.body.appendChild(el);

    const ensurePlaying = () => {
      if (el.paused) el.play()?.catch(() => {});
    };
    ensurePlaying();

    return { video: el, stream, ensurePlaying, dispose };
  } catch {
    dispose();
    return null;
  }
}
