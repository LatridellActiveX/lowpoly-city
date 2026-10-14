import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Build identity (PR 4, extended in V1.5).
//
// On Vercel, the git checkout is shallow but the platform exposes the commit
// as the system env var VERCEL_GIT_COMMIT_SHA during builds of git-connected
// projects, so we prefer it. Locally we fall back to `git rev-parse`.
// ---------------------------------------------------------------------------
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a git checkout (e.g. some CI) */
}
const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
if (vercelSha) commit = vercelSha.slice(0, 7);
// The build id must change on EVERY deploy (even a redeploy of the same
// commit with a different config), so append the build time.
const builtAt = new Date().toISOString();
const buildId = `${commit}-${Date.parse(builtAt).toString(36)}`;

/** Pull `export const NAME = <int>;` out of a source file (keeps one source of truth). */
function readIntConst(file: string, name: string): number {
  const m = readFileSync(new URL(file, import.meta.url), 'utf8').match(new RegExp(`export const ${name} = (\\d+);`));
  if (!m) throw new Error(`vite.config: ${name} not found in ${file}`);
  return Number(m[1]);
}
const saveVersion = readIntConst('./src/sim/save.ts', 'SAVE_VERSION');
const simCompat = readIntConst('./src/sim/compat.ts', 'SIM_COMPAT');
const appVersion = process.env.npm_package_version ?? '0.4.0';

/**
 * V1.5: emit dist/version.json next to index.html. Running games poll it
 * (no-cache, see vercel.json) to learn that a new deploy is live.
 */
function versionJson(): Plugin {
  return {
    name: 'lowpoly-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId, commit, version: appVersion, saveVersion, simCompat, builtAt }, null, 2),
      });
    },
  };
}

// Vite config. Three.js is ~500 kB minified, so raise the size warning limit.
export default defineConfig({
  build: { chunkSizeWarningLimit: 900 },
  plugins: [versionJson()],
  define: {
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_VERSION__: JSON.stringify(appVersion),
    // V1.5: the same identity baked into the bundle, compared with version.json.
    __APP_BUILD_ID__: JSON.stringify(buildId),
    __APP_SIM_COMPAT__: JSON.stringify(simCompat),
  },
});
