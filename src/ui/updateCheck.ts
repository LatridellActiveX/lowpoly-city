/**
 * V1.5 — IN-GAME UPDATE PROMPT
 * ============================
 *
 * The game is a static Vite build on Vercel. Every deploy writes
 * `/version.json` (see vite.config.ts) and the same identity is baked into
 * this bundle as __APP_BUILD_ID__ / __APP_SIM_COMPAT__.
 *
 * While you play we fetch /version.json with `cache: 'no-store'` (and a
 * cache-busting query; vercel.json also serves it with no-cache headers):
 *   - every 5 minutes, and
 *   - whenever the window regains focus / the tab becomes visible again
 *     (rate-limited to once per 30 s so alt-tabbing doesn't spam requests).
 *
 * If the live buildId differs from ours, a new deploy is out:
 *   - SAME simCompat  -> "Update available": [Update now] autosaves the city,
 *                        marks the session to resume straight into the game,
 *                        and reloads. [Later] keeps playing the old version.
 *   - OTHER simCompat -> "This update needs a new city": [Export save] downloads
 *                        the save JSON, [Start new city] clears it and reloads,
 *                        [Later] keeps playing the old version.
 *
 * Chunk-load failures: an old tab that lazily imports a file that the new
 * deploy no longer serves (Vite's hashed chunk names change) fires Vite's
 * `vite:preloadError`, or rejects with "Failed to fetch dynamically imported
 * module". We catch both and show the prompt instead of crashing. (Vercel's
 * Skew Protection would also let old tabs keep fetching their own files.)
 */

/** Shape of /version.json (kept loose: older deploys may lack fields). */
export interface RemoteVersion {
  buildId: string;
  commit?: string;
  version?: string;
  saveVersion?: number;
  simCompat?: number;
  builtAt?: string;
}

/** sessionStorage flag: after an update reload, skip the title screen. */
export const RESUME_KEY = 'lowpoly-city-resume';

const POLL_MS = 5 * 60 * 1000;
const FOCUS_MIN_GAP_MS = 30 * 1000;

export interface UpdateHooks {
  /** Persist the current city (called right before a compatible reload). */
  save(): void;
  /** Download the save JSON (incompatible update). Returns false if none. */
  exportSave(): boolean;
  /** Delete the save (incompatible update, "Start new city"). */
  clearSave(): void;
  /** Optional: told whenever an update is found (title screen badge). */
  onAvailable?(v: RemoteVersion, compatible: boolean): void;
}

export class UpdateChecker {
  /** Latest known remote version (null until one differs from ours). */
  available: RemoteVersion | null = null;
  /** True once the player chose "Later" for this buildId (don't nag again). */
  private dismissed = new Set<string>();
  private lastCheck = 0;
  private el: HTMLDivElement | null = null;

  constructor(private hooks: UpdateHooks, private url = '/version.json') {}

  /** Our own identity, baked in at build time. */
  readonly local = { buildId: __APP_BUILD_ID__, simCompat: __APP_SIM_COMPAT__ };

  /** Begin polling and listening for focus + chunk errors. */
  start(): void {
    setInterval(() => void this.check(), POLL_MS);
    const onReturn = () => {
      if (document.hidden) return;
      if (Date.now() - this.lastCheck > FOCUS_MIN_GAP_MS) void this.check();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    // Old bundle asked for a chunk the new deploy removed.
    window.addEventListener('vite:preloadError', (e) => {
      e.preventDefault();
      void this.check(true);
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = String((e.reason as Error)?.message ?? e.reason ?? '');
      if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(msg)) void this.check(true);
    });
    // First check shortly after start-up (not immediately: let the game load).
    setTimeout(() => void this.check(), 10_000);
  }

  /**
   * Fetch version.json and react. `forced` (chunk failure) shows the prompt
   * even if "Later" was chosen, because the old version is now broken.
   */
  async check(forced = false): Promise<RemoteVersion | null> {
    this.lastCheck = Date.now();
    let remote: RemoteVersion;
    try {
      const res = await fetch(`${this.url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return null; // e.g. local `vite dev` has no version.json
      remote = await res.json();
    } catch {
      return null; // offline: try again later
    }
    if (!remote?.buildId || remote.buildId === this.local.buildId) return null;
    this.available = remote;
    const compatible = this.isCompatible(remote);
    this.hooks.onAvailable?.(remote, compatible);
    if (forced || !this.dismissed.has(remote.buildId)) this.show(remote, compatible, forced);
    return remote;
  }

  /** Same simulation compat number = the new code can continue this save. */
  isCompatible(r: RemoteVersion): boolean {
    return (r.simCompat ?? this.local.simCompat) === this.local.simCompat;
  }

  /** Build (or rebuild) the prompt card. Exposed for tests/screenshots. */
  show(r: RemoteVersion, compatible: boolean, forced = false): void {
    this.el?.remove();
    const el = document.createElement('div');
    el.className = 'panel update-prompt';
    el.setAttribute('role', 'dialog');
    const ver = r.version ? `v${r.version}` : 'A new version';
    const commit = r.commit ? ` <span class="muted">(${r.commit})</span>` : '';
    el.innerHTML = compatible
      ? `<h3>🔄 Update available</h3>
         <p>${ver}${commit} is out. Your city will be saved and the game reloads right where you are.</p>
         ${forced ? '<p class="warn">Part of the game failed to load because a new version replaced it.</p>' : ''}
         <div class="row"><button class="btn primary" data-a="update">Update now</button>
         <button class="btn" data-a="later">Later</button></div>`
      : `<h3>⚠️ This update needs a new city</h3>
         <p>${ver}${commit} changes the simulation so your current city can't be carried over.
         Export your save first if you'd like to keep it.</p>
         <div class="row"><button class="btn" data-a="export">Export save</button>
         <button class="btn primary" data-a="new">Start new city</button>
         <button class="btn" data-a="later">Later</button></div>`;
    el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'update') {
        this.hooks.save();
        sessionStorage.setItem(RESUME_KEY, 'continue');
        location.reload();
      } else if (a === 'export') {
        if (!this.hooks.exportSave()) alert('There is no saved city to export yet.');
      } else if (a === 'new') {
        if (!confirm('Start a new city with the update? Your current city will be erased (export it first to keep it).')) return;
        this.hooks.clearSave();
        sessionStorage.setItem(RESUME_KEY, 'new');
        location.reload();
      } else if (a === 'later') {
        this.dismissed.add(r.buildId);
        this.hide();
      }
    });
    document.body.append(el);
    this.el = el;
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
  }
}
