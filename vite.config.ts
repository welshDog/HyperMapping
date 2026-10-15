import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { calibrationRelay } from './tools/calibration-relay';

// HTTPS matters: WebGPU only exists in secure contexts, and a LAN IP over plain
// http is NOT one. Without this the phone silently falls back to WebGL2.
export default defineConfig({
  plugins: [react(), basicSsl(), calibrationRelay()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        simulator: fileURLToPath(new URL('./simulator.html', import.meta.url)),
        camera: fileURLToPath(new URL('./camera.html', import.meta.url)),
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
