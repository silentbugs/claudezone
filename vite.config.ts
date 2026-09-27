import { defineConfig } from 'vite';
// host: true listens on all interfaces so a Windows browser can reach the dev server inside WSL2.
export default defineConfig({
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
