/**
 * ui/format.ts — shared display helpers for quantities shown in the HUD.
 *
 * Power and water demand are sums of (DEMAND × sizeUnits). sizeUnits comes from
 * residents÷5 / jobs÷4 / … so totals are often fractional, and floating-point
 * addition leaves bits like 1184.3000000000002. Printing those raw made the top
 * bar and the inspect "network #N: demand/capacity" line look broken.
 *
 * Use formatAmount() / formatRatio() everywhere a demand, capacity, supplied or
 * similar utility quantity is shown to the player (or in debug-load text). Do
 * NOT use them for money (Hud.money), percentages, or land-value decimals —
 * those have their own rules.
 */

/**
 * Format one demand / capacity / supplied / output number for the UI.
 *
 * Rules (chosen so the top bar stays readable at city scale):
 *   - non-finite → "0"
 *   - |n| < 10 and non-zero → at most one decimal (0.8, 4.5); trailing .0 dropped
 *   - otherwise → nearest whole number with thousands separators (1,184)
 *
 * Rounding a value like 9.96 up to 10 falls through to the whole-number path
 * so we never show "10.0".
 */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  // Tiny amounts stay fractional so a single water tower's pump draw (4) and
  // a half-built lot's 0.8 demand are still distinguishable.
  if (a > 0 && a < 10) {
    const one = Math.round(a * 10) / 10;
    if (one >= 10) return sign + Math.round(one).toLocaleString();
    const s = one.toFixed(1);
    return sign + (s.endsWith('.0') ? s.slice(0, -2) : s);
  }
  return sign + Math.round(a).toLocaleString();
}

/**
 * "used/capacity" pair for meters and network lines, e.g. "1,184/5,930".
 * Both sides go through formatAmount so a float on either side is cleaned up.
 */
export function formatRatio(used: number, capacity: number): string {
  return `${formatAmount(used)}/${formatAmount(capacity)}`;
}
