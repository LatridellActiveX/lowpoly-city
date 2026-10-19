// OASIS-AVENUE Playwright tool: Parker's avenue save, traffic at the x=64 junction.
// Usage: node tools/pw/avenue.mjs <port> <save.json> <out.png>
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [port = "4175", savePath, out = "/tmp/avenue.png", zoom = "2.6", tx = "66", tz = "107", secs = "600"] = process.argv.slice(2);
// Optional: zoom (higher = closer), camera target tile x/z, sim seconds to run first.
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
// 10 sim-minutes of traffic, headless inside the page, then freeze and frame (64,105).
const stats = await page.evaluate((secs) => {
  const c = window.city, s = c.sim;
  for (let k = 0; k < secs * 4; k++) s.update(0.25);
  const g = s.traffic.graph, live = g.vehicles.filter((v) => !v.done);
  return { ...g.stats, live: live.length, stuck: live.filter((v) => v.wait > 5).length };
}, Number(secs));
await page.evaluate(([zm, x, z]) => { const c = window.city; c.setSpeed?.(0); c.setTimeOfDay(0.45); c.setOverlay("none"); c.cam.zoomBy(zm / c.cam.zoom); c.cam.target.set(x, 0, z); c.sim.version++; }, [Number(zoom), Number(tx), Number(tz)]);
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
console.log(JSON.stringify({ stats, errs: errs.slice(0, 3) }));
await browser.close();
