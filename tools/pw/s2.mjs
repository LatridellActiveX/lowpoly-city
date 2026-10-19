// OASIS-S2 Playwright tool: building a road onto a busy street keeps its traffic.
// Usage: node tools/pw/s2.mjs <port> <save.json> <outPrefix>
//   <outPrefix>-before.png  a busy street, the game paused
//   <outPrefix>-after.png   the same view right after a new street was built
//                           connecting into it (the cars are still there)
// Prints how many cars were live before / kept / moved / finished.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [port = "4175", savePath, prefix = "/workspace/oasis-s2"] = process.argv.slice(2);
const save = readFileSync(savePath, "utf8");
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://localhost:${port}/`);
await page.evaluate((s) => { localStorage.clear(); localStorage.setItem("lowpoly-city-save", s); }, save);
await page.reload();
await page.waitForFunction(() => window.city && window.city.startGame);
await page.evaluate(() => window.city.startGame("continue"));
await page.waitForTimeout(1200);
await page.evaluate(() => { for (const b of document.querySelectorAll("button")) if (/Got it/.test(b.textContent)) b.click(); });
const plan = await page.evaluate(() => {
  const c = window.city, s = c.sim; c.setSpeed(1);
  for (let k = 0; k < 1200; k++) s.update(0.25);
  c.setSpeed(0); // freeze for the pictures
  const lg = s.traffic.graph, gt = lg.gt, g = s.world.roads;
  // Busiest edge (cars on its lanes), then a new 5-tile street off its middle, either side.
  const per = new Map();
  for (const v of gt.vehicles) if (!v.done && v.seg.kind === "lane") per.set(v.seg.edge, (per.get(v.seg.edge) ?? 0) + 1);
  const edges = [...per.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
  for (const e of edges) {
    if (g.eLen[e] < 120) continue;
    const cv = g.eCurve[e];
    for (const f of [0.5, 0.4, 0.6]) {
      const t = f, x = (1 - t) ** 3 * cv[0] + 3 * (1 - t) ** 2 * t * cv[2] + 3 * (1 - t) * t * t * cv[4] + t ** 3 * cv[6], z = (1 - t) ** 3 * cv[1] + 3 * (1 - t) ** 2 * t * cv[3] + 3 * (1 - t) * t * t * cv[5] + t ** 3 * cv[7];
      const dx = cv[6] - cv[0], dz = cv[7] - cv[1], L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L;
      for (const side of [1, -1]) for (const len of [160, 128, 96]) {
        const curve = c.free.lineCubic({ x, z }, { x: x + side * nx * len, z: z + side * nz * len });
        const p = c.free.placeFreeRoad(s, curve, "street", {}, false, false);
        if (p.ok) return { e, cars: per.get(e), x, z, curve: [...curve], live: gt.vehicles.filter((v) => !v.done).length };
      }
    }
  }
  return null;
});
console.log("plan", JSON.stringify(plan && { ...plan, curve: undefined }));
const frame = async (name) => {
  await page.evaluate((p) => { const c = window.city; c.setTimeOfDay?.(0.45); c.setOverlay("none"); c.cam.zoomBy(2.6 / c.cam.zoom); c.cam.target.set(p.x / 32, 0, p.z / 32); c.sim.version++; }, plan);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${prefix}-${name}.png` });
};
if (plan) {
  await frame("before");
  const r = await page.evaluate((p) => {
    const c = window.city, s = c.sim, lg = s.traffic.graph, b = { ...lg.stats };
    const ids = new Set(lg.vehicles.filter((v) => !v.done).map((v) => v.id));
    const res = c.free.placeFreeRoad(s, Float64Array.from(p.curve), "street", {}, true, true);
    const oldGt = lg.gt; let why = null; const ad = oldGt.constructor.prototype.adopt; oldGt.constructor.prototype.adopt = function (o) { const r = ad.call(this, o); why = r.why; return r; };
    lg.sync(s.world); // what the next frame's traffic update does first
    oldGt.constructor.prototype.adopt = ad;
    const now = lg.vehicles.filter((v) => !v.done);
    return { built: res.ok, liveBefore: ids.size, liveAfter: now.length, sameIds: now.filter((v) => ids.has(v.id)).length, kept: lg.stats.keptOnEdit - b.keptOnEdit, moved: lg.stats.movedOnEdit - b.movedOnEdit, finished: lg.stats.finishedOnEdit - b.finishedOnEdit, why };
  }, plan);
  console.log("edit", JSON.stringify(r));
  await frame("after");
}
console.log("errs", JSON.stringify(errs));
await browser.close();
