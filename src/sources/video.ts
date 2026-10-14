export interface VideoHandle {
  video: HTMLVideoElement;
  /** True if `play()` succeeded. False means autoplay was refused: a tap must start it. */
  playing: boolean;
  dispose(): void;
}

/** Off-screen but NOT display:none, so mobile browsers keep decoding frames. */
const HIDDEN_STYLE = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px';
/** How long to wait for play() to settle once the video has data. */
const PLAY_SETTLE_MS = 1000;

/**
 * Turn a picked file/blob into a looping, muted, inline <video>. Muted +
 * playsInline are what let it autoplay on phones. Rejects if the browser cannot
 * decode the file, or nothing happens within `timeoutMs`, so the UI can show a
 * message instead of a black screen.
 */
export async function createVideoFromBlob(blob: Blob, timeoutMs = 10_000): Promise<VideoHandle> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  video.style.cssText = HIDDEN_STYLE;
  document.body.appendChild(video);
  video.src = url;

  const dispose = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    video.remove();
  };

  // Start playback immediately: iOS may not fire loadeddata until play() is called.
  let playP: Promise<boolean>;
  try {
    playP = Promise.resolve(video.play()).then(
      () => true,
      () => false, // autoplay refused, or aborted by dispose
    );
  } catch {
    playP = Promise.resolve(false);
  }

  try {
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('playing', onReady);
        video.removeEventListener('error', onError);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('This browser could not decode that video'));
      };
      video.addEventListener('loadeddata', onReady);
      video.addEventListener('playing', onReady);
      video.addEventListener('error', onError);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out loading that video'));
      }, timeoutMs);
    });
  } catch (e) {
    dispose();
    throw e;
  }

  // play() usually settles right after the data arrives; don't wait forever for it.
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const playing = await Promise.race([
    playP,
    new Promise<boolean>((resolve) => {
      settleTimer = setTimeout(() => resolve(!video.paused), PLAY_SETTLE_MS);
    }),
  ]);
  clearTimeout(settleTimer);
  return { video, playing, dispose };
}
