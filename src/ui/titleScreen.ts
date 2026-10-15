/**
 * V1.5 — TITLE SCREEN
 * ===================
 *
 * Shown on start-up over a live, slowly orbiting demo town (titleBackdrop.ts).
 * The real city is only created once the player chooses something:
 *
 *   New Game  -> optional seed + map style, then a fresh city
 *   Continue  -> the autosaved city (disabled if there is none)
 *   Load      -> one of 3 save slots, or import a .json save file
 *   Settings  -> opens the normal ☰ Settings panel
 *
 * The version label (bottom-right) shows the build; when the update checker
 * finds a newer deploy a badge appears next to it (setUpdateBadge).
 *
 * This file is pure DOM. main.ts owns the simulation and passes callbacks.
 */
import { hasSave } from '../sim/save';
import { listSlots, SLOT_COUNT } from '../sim/slots';

/** New Game options. `seed` undefined = random. */
export interface NewGameOptions {
  seed?: number;
  /** 'river' = default generator; 'dry' strips lakes/rivers for a flat build. */
  map: 'river' | 'dry';
  /** V1.6 A6: map size in tiles (64 classic; 128 / 192 have buyable regions). */
  size?: 64 | 128 | 192;
}

export interface TitleHooks {
  newGame(opts: NewGameOptions): void;
  continueGame(): void;
  loadSlot(slot: number): void;
  importSave(text: string): boolean;
  openSettings(): void;
  /** Copy the autosaved city into slot i. */
  saveSlot(slot: number): boolean;
}

export class TitleScreen {
  readonly el: HTMLDivElement;
  private badge: HTMLSpanElement;

  constructor(private hooks: TitleHooks) {
    this.el = document.createElement('div');
    this.el.className = 'title-screen';
    this.el.innerHTML = `
      <div class="title-card panel">
        <h1>Low-Poly City</h1>
        <div class="title-menu" data-view="main">
          <button class="btn primary big" data-a="new">New Game</button>
          <button class="btn big" data-a="continue">Continue</button>
          <button class="btn big" data-a="load">Load</button>
          <button class="btn big" data-a="settings">Settings</button>
        </div>
        <div class="title-menu hidden" data-view="new">
          <label>Seed <input type="text" data-k="seed" placeholder="random" maxlength="10"></label>
          <label>Map <select data-k="map"><option value="river">Rivers &amp; lakes</option><option value="dry">Dry land</option></select></label>
          <label>Size <select data-k="size"><option value="64">Classic 64×64</option><option value="128">Large 128×128 (4 regions)</option><option value="192">Huge 192×192 (9 regions)</option></select></label>
          <button class="btn primary big" data-a="start">Found city</button>
          <button class="btn" data-a="back">Back</button>
        </div>
        <div class="title-menu hidden" data-view="load">
          <div data-k="slots"></div>
          <button class="btn" data-a="import">Import save file…</button>
          <input type="file" accept=".json,application/json" data-k="file" hidden>
          <button class="btn" data-a="back">Back</button>
        </div>
      </div>
      <div class="title-version">v${__APP_VERSION__} <span class="muted">(${__APP_COMMIT__})</span> <span class="update-badge hidden" title="A new version is available">Update available</span></div>`;
    this.badge = this.el.querySelector('.update-badge')!;
    this.el.addEventListener('click', (e) => this.onClick(e));
    const file = this.q<HTMLInputElement>('[data-k=file]');
    file.onchange = async () => {
      const f = file.files?.[0];
      if (!f) return;
      if (!this.hooks.importSave(await f.text())) alert('That file is not a Low-Poly City save.');
      file.value = '';
    };
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.el.querySelector(sel) as T;
  }

  /** Switch between the main / new / load sub-menus. */
  private view(name: string): void {
    this.el.querySelectorAll<HTMLElement>('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== name));
    if (name === 'load') this.renderSlots();
  }

  private renderSlots(): void {
    const slots = listSlots();
    this.q('[data-k=slots]').innerHTML = Array.from({ length: SLOT_COUNT }, (_, i) => {
      const s = slots[i];
      return s
        ? `<button class="btn slot" data-slot="${i}">Slot ${i + 1}: ${s.pop.toLocaleString()} people <span class="muted">${new Date(s.savedAt).toLocaleString()}</span></button>`
        : `<button class="btn slot" disabled>Slot ${i + 1}: empty</button>`;
    }).join('') +
      // Copy the autosave into a slot (only when there is an autosave).
      (hasSave() ? `<div class="muted small">Copy your current city into: ${Array.from({ length: SLOT_COUNT }, (_, i) => `<button class="btn" data-saveslot="${i}">Slot ${i + 1}</button>`).join(' ')}</div>` : '');
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const slot = t.closest<HTMLElement>('[data-slot]')?.dataset.slot;
    if (slot !== undefined) return this.hooks.loadSlot(Number(slot));
    const into = t.closest<HTMLElement>('[data-saveslot]')?.dataset.saveslot;
    if (into !== undefined) {
      this.hooks.saveSlot(Number(into));
      return this.renderSlots();
    }
    switch (t.closest<HTMLElement>('[data-a]')?.dataset.a) {
      case 'new': return this.view('new');
      case 'back': return this.view('main');
      case 'load': return this.view('load');
      case 'continue': return this.hooks.continueGame();
      case 'settings': return this.hooks.openSettings();
      case 'import': return this.q<HTMLInputElement>('[data-k=file]').click();
      case 'start': {
        const raw = this.q<HTMLInputElement>('[data-k=seed]').value.trim();
        // Any text works as a seed: numbers are used directly, words hashed.
        let seed: number | undefined;
        if (raw) seed = /^\d+$/.test(raw) ? Number(raw) : [...raw].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
        return this.hooks.newGame({ seed, map: this.q<HTMLSelectElement>('[data-k=map]').value as NewGameOptions['map'], size: Number(this.q<HTMLSelectElement>('[data-k=size]').value) as NewGameOptions['size'] });
      }
    }
  }

  show(): void {
    this.view('main');
    this.q<HTMLButtonElement>('[data-a=continue]').disabled = !hasSave();
    document.body.classList.add('title-mode');
    document.body.append(this.el);
  }

  hide(): void {
    document.body.classList.remove('title-mode');
    this.el.remove();
  }

  get visible(): boolean {
    return this.el.isConnected;
  }

  /** Called by the update checker when a newer deploy is live. */
  setUpdateBadge(on: boolean): void {
    this.badge.classList.toggle('hidden', !on);
  }
}
