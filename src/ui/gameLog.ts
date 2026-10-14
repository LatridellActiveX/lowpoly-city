/**
 * ui/gameLog.ts — PR 4 Game Log: a running, copyable record of a playthrough.
 *
 * WHAT GETS LOGGED (each entry: real time, game date, severity, message)
 *   - Uncaught errors (window 'error') and rejected promises nobody handled
 *     ('unhandledrejection').
 *   - console.error and console.warn: we WRAP them — our wrapper records the
 *     message and then calls the original function, so the browser console
 *     still shows everything as before.
 *   - Simulation warnings and key events, pushed by main.ts / the HUD:
 *     power/water shortages, failed routes, tier unlocks, save/load results,
 *     new city, etc.
 *
 * RING BUFFER: only the newest MAX_ENTRIES are kept. Older ones are dropped
 * so a game left running for hours can't eat memory.
 *
 * "Copy log" builds plain text with a header (game version + commit, save
 * version, browser user agent) and copies it with the Clipboard API, falling
 * back to a hidden <textarea> + document.execCommand('copy') on browsers or
 * pages where the Clipboard API isn't allowed.
 */
export type Severity = 'info' | 'event' | 'warn' | 'error';

export interface LogEntry {
  real: string;
  game: string;
  sev: Severity;
  msg: string;
}

export const MAX_ENTRIES = 1000;

class GameLog {
  entries: LogEntry[] = [];
  /** Returns the in-game date text; main.ts sets it once the sim exists. */
  gameDate: () => string = () => '—';
  /** Called after every new entry (the open log panel re-renders). */
  onChange: (() => void) | null = null;
  private installed = false;

  add(sev: Severity, msg: string): void {
    const now = new Date();
    let game = '—';
    try {
      game = this.gameDate();
    } catch {
      /* sim not ready */
    }
    this.entries.push({ real: now.toLocaleTimeString([], { hour12: false }), game, sev, msg: String(msg).slice(0, 2000) });
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.onChange?.();
  }
  info(m: string): void { this.add('info', m); }
  event(m: string): void { this.add('event', m); }
  warn(m: string): void { this.add('warn', m); }
  error(m: string): void { this.add('error', m); }

  clear(): void {
    this.entries = [];
    this.onChange?.();
  }

  /** Hook global error sources. Safe to call more than once. */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    window.addEventListener('error', (e) => this.error(`Uncaught: ${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`));
    window.addEventListener('unhandledrejection', (e) => this.error(`Unhandled promise rejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));
    const fmt = (args: unknown[]) => args.map((a) => (a instanceof Error ? a.message : typeof a === 'object' ? safeJson(a) : String(a))).join(' ');
    for (const [name, sev] of [['error', 'error'], ['warn', 'warn']] as const) {
      const original = console[name].bind(console);
      console[name] = (...args: unknown[]) => {
        this.add(sev, `console.${name}: ${fmt(args)}`);
        original(...args); // still forward to the real console
      };
    }
  }

  /** Plain-text export with a header, newest last. `filter` limits severities. */
  toText(saveVersion: number, filter?: Set<Severity>): string {
    const head = [
      `Lowpoly City game log`,
      `Game version: ${__APP_VERSION__} (commit ${__APP_COMMIT__})`,
      `Save version: ${saveVersion}`,
      `Browser: ${navigator.userAgent}`,
      `Exported: ${new Date().toString()}`,
      `Entries: ${this.entries.length} (max ${MAX_ENTRIES})`,
      '',
    ];
    const lines = this.entries.filter((e) => !filter || filter.has(e.sev)).map((e) => `[${e.real}] [${e.game}] ${e.sev.toUpperCase().padEnd(5)} ${e.msg}`);
    return head.concat(lines).join('\n');
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Copy text: Clipboard API first, hidden-textarea fallback second. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the fallback */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** The one log for the whole page. */
export const gameLog = new GameLog();
