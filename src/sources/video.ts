export interface VideoHandle {
  video: HTMLVideoElement;
  dispose(): void;
}

/**
 * Turn a picked file/blob into a looping, muted, inline <video>. Muted +
 * playsInline are what let it autoplay on phones. Rejects if the browser cannot
 * decode the file so the UI can show a message instead of a black screen.
 */
export async function createVideoFromBlob(blob: Blob): Promise<VideoHandle> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  video.src = url;

  const dispose = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('This browser could not decode that video'));
    });
    await video.play().catch(() => {
      /* autoplay refused: first tap will start it */
    });
  } catch (e) {
    dispose();
    throw e;
  }
  return { video, dispose };
}
