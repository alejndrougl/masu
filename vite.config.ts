/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// El aislamiento de origen deja a ONNX usar hilos (SharedArrayBuffer).
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  server: { headers },
  preview: { headers },
  // Modelos y motores pesan 300 MB: serve.mjs los toma directo de public/, sin duplicarlos.
  build: { target: 'esnext', chunkSizeWarningLimit: 4000, copyPublicDir: false },
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web', '@mediapipe/tasks-vision'] },
  // Las copias de respaldo traen sus propias pruebas: no se corren.
  test: { exclude: ['**/node_modules/**', 'respaldos/**'], setupFiles: ['src/i18n/test-setup.ts'] },
});
