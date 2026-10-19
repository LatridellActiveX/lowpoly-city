// OASIS-S6 Playwright tool: midday traffic on a save, for before/after shots.
// Usage: node tools/pw/s6.mjs <port> <save.json> <out.png>
// Loads the save with DEFAULT settings (localStorage cleared, so the build's
// own Max cars default applies: 75 before S6, 100 after), puts the clock at
// 12:00, runs the sim 600 game-seconds headless in the page so traffic
// reaches its midday level, then frames the densest patch of road (the 8×8
// tile block holding the most cars) and shoots. Prints the car count.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [port = "4175", savePath, out = "/workspace/oasis-s6.png"] = process.argv.slice(2);
const save = readFileSync(savePath, "utf8");
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://localhost:${port}/`);
await page.evaluate((s) => { localStorage.clear(); localStorage.setItem("lowpoly-city-save", s); }, save);
await page.reload();
await page.waitForFunction(() => window.city && window.city.startGame);
await page.evaluate(() => window.city.startGame("continue"));
await page.waitForTimeout(1000);
await page.evaluate(() => { for (const b of document.querySelectorAll("button")) if (/Got it/.test(b.textContent)) b.click(); });
const r = await page.evaluate(() => {
  const c = window.city, s = c.sim;
  // DAY_SECONDS 3600, DAY_START 0.3 (sim/traffic.ts): clock for 12:00.
  s.world.clock = ((0.5 - 0.3 + 1) % 1) * 3600;
  let sum = 0, n = 0;
  for (let k = 0; k < 2400; k++) { s.update(0.25); if (k % 20 === 0) { sum += s.traffic.count("car"); n++; } }
  // Densest 8×8-tile block of graph cars.
  const gt = s.traffic.graph.gt, bins = new Map();
  if (gt) for (const [, l] of gt.onSeg) for (const v of l) { const p = gt.position(v); const key = `${Math.floor(p.x / 256)},${Math.floor(p.z / 256)}`; const b = bins.get(key) || { n: 0, x: 0, z: 0 }; b.n++; b.x += p.x; b.z += p.z; bins.set(key, b); }
  let best = null; for (const b of bins.values()) if (!best || b.n > best.n) best = b;
  c.setSpeed?.(0); c.setTimeOfDay(0.5); c.setOverlay("none");
  if (best) { c.cam.zoomBy(2.4 / c.cam.zoom); c.cam.target.set(best.x / best.n / 32, 0, best.z / best.n / 32); }
  s.version++;
  return { meanCars: +(sum / n).toFixed(1), carsNow: s.traffic.count("car"), maxCars: s.settings.maxCars, block: best && best.n };
});
await page.waitForTimeout(1500);
await page.screenshot({ path: out, timeout: 240000 });
console.log(JSON.stringify({ r, errs: errs.slice(0, 3) }));
await browser.close();
