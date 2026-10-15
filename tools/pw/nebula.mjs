// NEBULA Playwright tool: junction / utilities / signal screenshots.
// Usage: node tools/pw/nebula.mjs <port> <stage> [out-prefix]
//   junctions — new game (graph roads): grid town + Y, curved, 5-arm, avenue-to-road, roundabout
//   power | pipes | lights — same city, other views
import { chromium } from "playwright";
const port = process.argv[2] || "4182", stage = process.argv[3] || "junctions", pre = process.argv[4] || "/workspace/nebula";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://localhost:${port}/`); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.city && window.city.title);
await page.evaluate(() => window.city.startGame("new", { seed: 4242, map: "river" }));
await page.waitForTimeout(800);
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Got it/.test(x.textContent)); b && b.click(); });
const info = await page.evaluate(() => {
  const c = window.city, s = c.sim, w = s.world;
  const rect = (x0, z0, x1, z1) => { const o = []; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) o.push([x, z]); return o; };
  w.cash = 1e7; w.peakPop = 3000; w.tier = 2;
  for (const z of [12, 19, 26, 33]) s.apply("road", rect(10, z, 50, z));
  for (const x of [10, 30, 50]) s.apply("road", rect(x, 12, x, 33));
  s.apply("avenue", rect(10, 40, 50, 40)); s.apply("road", rect(30, 34, 30, 39)); // avenue-to-road T
  const N = Math.round(Math.sqrt(w.tiles.length)), e = w.edgeIndex, ex = e % N, ez = Math.floor(e / N);
  const R = (x0, z0, x1, z1) => rect(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
  if (e >= 0) { s.apply("road", R(50, 33, 50, ez)); s.apply("road", R(50, ez, ex, ez)); }
  s.apply("roundabout", [[19, 18], [20, 18], [19, 19], [20, 19]]);
  s.apply("powerPlant", [[9, 12]]); s.apply("powerPlant", [[4, 22]]); s.apply("powerLine", rect(5, 22, 9, 22));
  s.apply("waterTower", [[9, 13]]); s.apply("waterTower", [[51, 13]]); s.apply("waterPipe", rect(52, 13, 56, 13)); s.apply("pumpStation", [[57, 13]]);
  s.zoneOpt = { density: 0, depth: 3 };
  for (const z of [13]) { s.apply("residential", rect(11, z, 29, z)); s.apply("residential", rect(31, z, 49, z)); }
  s.zoneOpt = { density: 1, depth: 3 }; s.apply("commercial", rect(31, 20, 49, 20));
  const M = (x, z) => [(x + 0.5) * 32, (z + 0.5) * 32];
  const F = c.free;
  const res = {};
  // Y junction: two free roads leaving road z=26 at (40,26) at ±40°.
  res.y1 = F.placeFreeRoad(s, Float64Array.of(...M(40, 26), ...M(41, 27.5), ...M(42.5, 29), ...M(44, 30.5)), "street", {}, true, true).ok;
  res.y2 = F.placeFreeRoad(s, Float64Array.of(...M(40, 26), ...M(39, 27.5), ...M(37.5, 29), ...M(36, 30.5)), "street", {}, true, true).ok;
  // Curved street joining road x=10 and road z=33 corner area.
  res.curve = F.placeFreeRoad(s, F.quadCubic({ x: M(10, 29)[0], z: M(10, 29)[1] }, { x: M(16, 29)[0], z: M(16, 29)[1] }, { x: M(19, 33)[0], z: M(19, 33)[1] }), "street", {}, true, true).ok;
  // 5-arm: a diagonal through junction (30,26).
  res.five = F.placeFreeRoad(s, Float64Array.of(...M(30, 26), ...M(32, 28), ...M(34, 30), ...M(36, 32.2)), "street", {}, true, true).ok;
  for (let i = 0; i < 500; i++) { s.step(); s.traffic.update(w, 1); w.clock += 1; }
  s.version++;
  return res;
});
const shot = async (name, x, z, zm, tod = 0.45, overlay = "none", extra = null) => {
  await page.evaluate(([x, z, zm, tod, overlay]) => { const c = window.city; c.setSpeed?.(0); c.setTimeOfDay(tod); c.setOverlay(overlay); c.cam.zoomBy(zm / c.cam.zoom); c.cam.target.set(x, 0, z); c.sim.version++; }, [x, z, zm, tod, overlay]);
  if (extra) await page.evaluate(extra);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${pre}-${name}.png`, timeout: 240000 });
};
if (stage === "junctions" || stage === "all") {
  await shot("intersections-close", 30, 26, 6);
  await shot("junction-variety", 30, 26, 2.2);
  await shot("junction-roundabout", 19.5, 18.5, 6);
  await shot("junction-avenue", 30, 40, 6);
  await shot("junction-y", 40, 27.5, 6);
}
if (stage === "power" || stage === "all") await shot("power-lines", 9, 18, 3);
if (stage === "pipes" || stage === "all") await shot("pipes-view", 40, 16, 2.4, 0.45, "water");
if (stage === "lights" || stage === "all") { await shot("traffic-lights", 10.6, 19.2, 9, 0.45); await shot("traffic-lights-night", 10.6, 19.2, 9, 0.95); }
console.log(JSON.stringify({ info, errs }));
await browser.close();
