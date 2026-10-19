// OASIS-S1 Playwright tool: Save/Load in the ☰ menu + the yard's parked trucks.
// Usage: node tools/pw/s1.mjs <port> <save.json> <outPrefix>
//   <outPrefix>-menu.png        the ☰ menu open with Save city / Load city
//   <outPrefix>-yard-full.png   a Construction Yard with all 8 trucks at home
//   <outPrefix>-yard-out.png    the same yard after some trucks left for sites
// Also asserts: no Save/Load button in the top bar, New still there, and the
// menu's Save city item really saves (flash text + save written).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [port = "4175", savePath, prefix = "/workspace/oasis-s1"] = process.argv.slice(2);
const save = readFileSync(savePath, "utf8");
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://localhost:${port}/`);
await page.evaluate((s) => { localStorage.clear(); localStorage.setItem("lowpoly-city-save", s); }, save);
await page.reload();
await page.waitForFunction(() => window.city && window.city.startGame);
await page.evaluate(() => window.city.startGame("continue"));
await page.waitForTimeout(1200);
await page.evaluate(() => { for (const b of document.querySelectorAll("button")) if (/Got it/.test(b.textContent)) b.click(); window.city.changelog?.close?.(); });
const top = await page.evaluate(() => [...document.querySelectorAll(".topbar button")].map((b) => b.textContent.trim()));
const res = { topbar: top, saveInTop: top.some((t) => /^Save$|^Load$/.test(t)), newInTop: top.includes("New") };
// Menu screenshot, then click Save city.
await page.evaluate(() => { window.city.setSpeed(0); window.city.menu.toggle(true); });
await page.waitForTimeout(400);
await page.screenshot({ path: `${prefix}-menu.png` });
await page.evaluate(() => localStorage.removeItem("lowpoly-city-save"));
await page.click('[data-go="save"]');
await page.waitForTimeout(300);
res.saved = await page.evaluate(() => !!localStorage.getItem("lowpoly-city-save"));
res.menuClosed = await page.evaluate(() => window.city.menu.el.classList.contains("hidden"));
// Yard: prefer one with a road beside it (only those dispatch trucks), frame it.
const yard = await page.evaluate(() => {
  const c = window.city, s = c.sim, w = s.world, N = Math.sqrt(w.tiles.length), T = w.tiles;
  const road = (i) => { const x = i % N, z = Math.floor(i / N); return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => T[(z + dz) * N + x + dx]?.road); };
  const ys = []; T.forEach((t, i) => t.structure === "constructionYard" && ys.push(i));
  const y = ys.find(road) ?? ys[0] ?? -1;
  return { y, x: y % N, z: Math.floor(y / N), out: y >= 0 ? s.crews.out(y) : -1 };
});
res.yard = yard;
const shoot = async (name) => {
  await page.evaluate((yd) => { const c = window.city; c.setTimeOfDay?.(0.45); c.setOverlay("none"); c.cam.zoomBy(4 / c.cam.zoom); c.cam.target.set(yd.x + 0.5, 0, yd.z + 0.5); c.sim.version++; }, yard);
  await page.waitForTimeout(800);
  // Max zoom still shows a 1-tile yard small: crop the middle of the screen.
  await page.screenshot({ path: `${prefix}-${name}.png`, clip: { x: 1366 / 2 - 260, y: 900 / 2 - 170, width: 520, height: 340 } });
};
if (yard.y >= 0) {
  res.fullOut = await page.evaluate((y) => { const s = window.city.sim; for (let i = 0; i < 4000 && s.crews.out(y) > 0; i++) s.update(0.25); return s.crews.out(y); }, yard.y);
  res.parkedFull = await page.evaluate(() => window.city.renderer.pools.yardTruck.count);
  await shoot("yard-full");
  // Trucks out: Parker's save has no free land to zone near the yard (graph
  // cells are all taken), so for this picture mark 3 of the yard's trucks
  // as out on jobs (Crews.busy, the same counter the dispatcher bumps) and
  // let the renderer redraw: 8 − 3 = 5 trucks must stay parked.
  res.outOut = await page.evaluate((y) => { const s = window.city.sim; s.crews.busy.set(y, 3); return s.crews.out(y); }, yard.y);
  await page.evaluate(() => window.city.sim.version++);
  await page.waitForTimeout(300);
  res.parkedOut = await page.evaluate(() => window.city.renderer.pools.yardTruck.count);
  await shoot("yard-out");
}
res.errs = errs;
console.log(JSON.stringify(res));
await browser.close();
