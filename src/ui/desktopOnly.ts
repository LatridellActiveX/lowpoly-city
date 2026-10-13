/**
 * ui/desktopOnly.ts — the "please play on a computer" notice.
 *
 * Low-Poly City is a desktop game (mouse + keyboard, big screen). Rather
 * than squeeze the UI onto a phone, we detect small or touch-only screens and
 * cover the page with a friendly notice. The check is:
 *   - the window is narrower than MIN_WIDTH px, OR
 *   - the device's main pointer is "coarse" (a finger) and it has no hover
 *     (i.e. a phone/tablet without a mouse).
 * We re-check on resize, so making a desktop window very narrow shows the
 * notice and widening it again brings the game back.
 */
export const MIN_WIDTH = 900;

export function isSmallOrTouchOnly(): boolean {
  const touchOnly = window.matchMedia('(pointer: coarse) and (hover: none)').matches;
  return window.innerWidth < MIN_WIDTH || touchOnly;
}

/** Adds the notice to the page and keeps it in sync with the window size. */
export function installDesktopNotice(root: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'desktop-only';
  box.innerHTML = `
    <div class="card">
      <div class="big">🖥️</div>
      <h2>Play on a computer</h2>
      <p>Low-Poly City is built for a mouse, a keyboard and a big screen.
      Open this page on a desktop or laptop (at least ${MIN_WIDTH}px wide) to play.</p>
    </div>`;
  root.append(box);
  const sync = () => box.classList.toggle('show', isSmallOrTouchOnly());
  window.addEventListener('resize', sync);
  sync();
}
