// Rasterises public/favicon.svg into PNG sizes + a PNG-embedded favicon.ico
// using headless Chromium (Playwright), so no native image libs are needed.
import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync('public/favicon.svg', 'utf8');
const out = { 16: 'favicon-16.png', 32: 'favicon-32.png', 48: null, 180: 'apple-touch-icon.png', 192: 'icon-192.png', 512: 'icon-512.png' };
const browser = await chromium.launch();
const page = await browser.newPage();
const bufs = {};
for (const size of Object.keys(out).map(Number)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  bufs[size] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  if (out[size]) fs.writeFileSync('public/' + out[size], bufs[size]);
}
await browser.close();
// ICO container: header + one directory entry per image, PNG payloads (Vista+).
const sizes = [16, 32, 48];
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i, b = bufs[s];
  head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12); off += b.length;
});
fs.writeFileSync('public/favicon.ico', Buffer.concat([head, ...sizes.map((s) => bufs[s])]));
console.log('favicons written');
