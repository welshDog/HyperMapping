/** HAVE_CURRENT_DATA (2) or better, with real dimensions. */
export function isVideoReady(v: Pick<HTMLVideoElement, 'readyState' | 'videoWidth' | 'videoHeight'>): boolean {
  return v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0;
}
