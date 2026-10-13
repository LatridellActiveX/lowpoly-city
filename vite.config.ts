import { defineConfig } from 'vite';

// Vite config. Three.js is ~500 kB minified, so raise the size warning limit.
export default defineConfig({ build: { chunkSizeWarningLimit: 900 } });
