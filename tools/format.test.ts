/**
 * tools/format.test.ts — NEBULA: unit tests for ui/format.ts.
 *
 * Covers the float-cleanup rules used by the top HUD power/water meters,
 * the inspect "network #N: demand/capacity" line, the graphs hover tip and
 * debug-load text. No simulation — pure number → string checks.
 */
import { formatAmount, formatRatio } from '../src/ui/format';

let fail = 0;
const ok = (c: boolean, m: string, x?: unknown) => {
  console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${x !== undefined ? ' → ' + JSON.stringify(x) : ''}`);
  if (!c) fail++;
};

// ---- formatAmount ----
ok(formatAmount(1184.3000000000002) === '1,184', 'HUD float demand rounds cleanly', formatAmount(1184.3000000000002));
ok(formatAmount(860.8000000000002) === '861', 'water float demand rounds cleanly', formatAmount(860.8000000000002));
ok(formatAmount(5930) === '5,930', 'whole capacity keeps thousands separator', formatAmount(5930));
ok(formatAmount(2400) === '2,400', 'water capacity thousands separator', formatAmount(2400));
ok(formatAmount(0) === '0', 'zero');
ok(formatAmount(4) === '4', 'small whole number stays unpadded', formatAmount(4));
ok(formatAmount(0.8) === '0.8', 'sub-10 fractional keeps one decimal', formatAmount(0.8));
ok(formatAmount(4.5) === '4.5', 'mid-range under 10 keeps one decimal', formatAmount(4.5));
ok(formatAmount(9.96) === '10', '9.96 rounds up into the whole-number path', formatAmount(9.96));
ok(formatAmount(9.94) === '9.9', '9.94 stays one decimal under 10', formatAmount(9.94));
ok(formatAmount(-12.3) === '-12', 'negative whole path', formatAmount(-12.3));
ok(formatAmount(-0.8) === '-0.8', 'negative under 10', formatAmount(-0.8));
ok(formatAmount(Number.NaN) === '0', 'NaN → 0');
ok(formatAmount(Number.POSITIVE_INFINITY) === '0', 'Infinity → 0');
ok(formatAmount(1000) === '1,000', 'exactly 1000', formatAmount(1000));

// ---- formatRatio ----
ok(formatRatio(1184.3000000000002, 5930) === '1,184/5,930', 'HUD power pair', formatRatio(1184.3000000000002, 5930));
ok(formatRatio(860.8000000000002, 2400) === '861/2,400', 'HUD water pair', formatRatio(860.8000000000002, 2400));
ok(formatRatio(0.8, 4) === '0.8/4', 'tiny demand / small capacity', formatRatio(0.8, 4));

console.log(fail ? `${fail} FAILED` : 'all passed');
if (fail) process.exit(1);
