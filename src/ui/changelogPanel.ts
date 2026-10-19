/**
 * ui/changelogPanel.ts — the "What's new" screen (src/changelog.ts has the entries).
 *
 * `open()` shows every entry; entries newer than the last one the player saw are
 * marked NEW. `openIfUnseen()` is called once at start-up: after an update it pops
 * the screen up automatically, then remembers the latest entry in localStorage so it
 * stays quiet until the next update.
 */
import { CHANGELOG, CHANGELOG_LATEST, ChangeTag } from '../changelog';

const KEY = 'lowpoly-city-changelog-seen';
const TAG_LABEL: Record<ChangeTag, string> = { new: 'New', improved: 'Improved', balance: 'Balance', fix: 'Fix' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const lastSeen = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
const markSeen = (): void => { try { localStorage.setItem(KEY, CHANGELOG_LATEST); } catch { /* storage unavailable */ } };

export class ChangelogPanel {
  readonly el = document.createElement('div');

  constructor() {
    this.el.className = 'changelog hidden';
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen) this.close(); });
  }

  get isOpen(): boolean { return !this.el.classList.contains('hidden'); }

  /** True when the player has not yet seen the newest entry. */
  get hasUnseen(): boolean { return lastSeen() !== CHANGELOG_LATEST; }

  /**
   * `full` = the whole history (menus / title screen). Without it (the automatic
   * pop-up after an update) only the newest entry is shown, with a link to the rest.
   */
  open(full = true): void {
    const seen = lastSeen();
    // Entries before the last-seen one are old; everything above it is new (all of them on a first visit).
    const seenAt = seen ? CHANGELOG.findIndex((c) => c.id === seen) : -1;
    const isNew = (k: number) => seenAt === -1 ? true : k < seenAt;
    this.el.innerHTML = `<div class="changelog-card panel" role="dialog" aria-label="What's new">
      <button class="close" aria-label="Close">×</button>
      <h2>📰 What's new</h2>
      <div class="changelog-list">${CHANGELOG.slice(0, full ? CHANGELOG.length : 1).map((c, k) => `
        <section class="cl-entry${isNew(k) ? ' fresh' : ''}">
          <h3>${esc(c.title)} ${isNew(k) ? '<span class="cl-badge">NEW</span>' : ''}<span class="cl-date">${esc(c.date)}</span></h3>
          <ul>${c.changes.map((ch) => `<li><span class="cl-tag cl-${ch.tag}">${TAG_LABEL[ch.tag]}</span> ${esc(ch.text)}</li>`).join('')}</ul>
        </section>`).join('')}</div>
      <div class="changelog-foot"><span class="muted">v${__APP_VERSION__}</span>${full ? '' : '<button class="btn" data-a="history">Full history</button>'}<button class="btn primary" data-a="ok">Got it</button></div>
    </div>`;
    (this.el.querySelector('.close') as HTMLButtonElement).onclick = () => this.close();
    (this.el.querySelector('[data-a=ok]') as HTMLButtonElement).onclick = () => this.close();
    const hist = this.el.querySelector('[data-a=history]') as HTMLButtonElement | null;
    if (hist) hist.onclick = () => this.open(true);
    this.el.classList.remove('hidden');
    markSeen();
  }

  close(): void { this.el.classList.add('hidden'); }

  /** Start-up hook: open automatically once per update. */
  openIfUnseen(): void { if (this.hasUnseen) this.open(false); }
}
