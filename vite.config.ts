import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// The current git commit is baked into the build so the Game Log's
// "Copy log" header says exactly which version produced it (PR 4).
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a git checkout (e.g. some CI) */
}

// Vite config. Three.js is ~500 kB minified, so raise the size warning limit.
export default defineConfig({
  build: { chunkSizeWarningLimit: 900 },
  define: { __APP_COMMIT__: JSON.stringify(commit), __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.4.0') },
});
