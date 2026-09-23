import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Cross-origin isolation is REQUIRED: the audio ring buffer and the telemetry
 * block are SharedArrayBuffers shared between the UI thread, the media worker
 * and the AudioWorklet. Browsers only expose SharedArrayBuffer when the page is
 * served with COOP + COEP. `credentialless` (instead of `require-corp`) keeps
 * third-party CORS-enabled media URLs working without CORP headers.
 *
 * Production hosting must send the same two headers (see README).
 */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
