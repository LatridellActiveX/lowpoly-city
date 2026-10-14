// Build-time constants injected by vite.config.ts (PR 4 Game Log header).
declare const __APP_COMMIT__: string;
declare const __APP_VERSION__: string;
/** V1.5: unique per build/deploy; compared against /version.json to detect updates. */
declare const __APP_BUILD_ID__: string;
/** V1.5: simulation compatibility number (src/sim/compat.ts) at build time. */
declare const __APP_SIM_COMPAT__: number;
