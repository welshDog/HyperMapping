import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS matters: WebGPU only exists in secure contexts, and a LAN IP over plain
// http is NOT one. Without this the phone silently falls back to WebGL2.
export default defineConfig({
  plugins: [react(), basicSsl()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
