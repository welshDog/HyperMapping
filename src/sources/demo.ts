/** The bundled demo video: lives in `public/demo/`, so dev, preview and the build all serve it. */
export const DEMO_VIDEO_PATH = 'demo/hypermapping-demo.mp4';
export const DEMO_FILE_NAME = 'hypermapping-demo.mp4';

/** The address of the demo video under the app's base path (Vite's BASE_URL), with exactly one slash between them. */
export function demoVideoUrl(baseUrl: string): string {
  const base = baseUrl === '' ? '/' : baseUrl;
  return `${base.endsWith('/') ? base : `${base}/`}${DEMO_VIDEO_PATH}`;
}
