import { defineConfig } from 'vite';

export default defineConfig({
  // relative Pfade: läuft unter / (eigener Server) und unter /<repo-name>/ (GitHub Pages)
  base: './',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
