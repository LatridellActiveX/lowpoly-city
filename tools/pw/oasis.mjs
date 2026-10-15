// OASIS Playwright tool: screenshot of REAL city traffic on a curved free road.
// Usage: node tools/pw/oasis.mjs <port>. A new game (a graph world), the bench
// town built with the tile tools (absorbed into the graph), a curved shortcut
// across a block, then the sim runs and we frame the curve with live trips on it.
import { chromium } from "playwright";
const port = process.argv[2] || "4175";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://localhost:${port}/`); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.city && window.city.title);
await page.evaluate(() => window.city.startGame("new", { seed: 4242, map: "river" }));
await page.waitForTimeout(800);
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Got it/.test(x.textContent)); b && b.click(); }); // close "What's new"
const info = await page.evaluate(() => {
  const c = window.city, s = c.sim, w = s.world;
  const rect = (x0, z0, x1, z1) => { const o = []; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) o.push([x, z]); return o; };
  w.cash = 1e7; w.peakPop = 3000; w.tier = 2;
  for (const z of [12, 19, 26, 33, 40]) s.apply("road", rect(10, z, 50, z));
  for (const x of [10, 30, 50]) s.apply("road", rect(x, 12, x, 40));
  const N = Math.round(Math.sqrt(w.tiles.length)), e = w.edgeIndex, ex = e % N, ez = Math.floor(e / N);
  const R = (x0, z0, x1, z1) => rect(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
  if (e >= 0) { s.apply("road", R(50, 26, 50, ez)); s.apply("road", R(50, ez, ex, ez)); }
  s.apply("powerPlant", [[9, 12]]); s.apply("powerPlant", [[51, 12]]);
  s.apply("waterTower", [[9, 13]]); s.apply("waterTower", [[51, 13]]); s.apply("waterTower", [[9, 41]]);
  s.apply("constructionYard", [[29, 11]]); s.apply("constructionYard", [[31, 41]]);
  s.zoneOpt = { density: 0, depth: 3 };
  for (const z of [13, 27]) { s.apply("residential", rect(11, z, 29, z)); s.apply("residential", rect(31, z, 49, z)); }
  s.zoneOpt = { density: 1, depth: 3 }; s.apply("commercial", rect(11, 20, 29, 20)); s.apply("commercial", rect(31, 20, 49, 20)); s.apply("commercial", rect(31, 25, 49, 25));
  s.zoneOpt = { density: 0, depth: 2 }; s.apply("industrial", rect(31, 34, 49, 34)); s.apply("industrial", rect(11, 34, 29, 34));
  for (let i = 0; i < 700; i++) { s.step(); s.traffic.update(w, 1); w.clock += 1; }
  // The curved shortcut (same as tools/oasis.test.ts): clear its block, place it.
  s.apply("bulldoze", rect(11, 27, 18, 31)); s.apply("bulldoze", rect(16, 34, 26, 36));
  const M = (x, z) => [(x + 0.5) * 32, (z + 0.5) * 32];
  const cv = Float64Array.of(...M(10, 26), ...M(16, 32), ...M(22, 34), ...M(30, 40));
  const plan = c.free.placeFreeRoad(s, cv, "street", {}, true, true);
  for (let i = 0; i < 600; i++) { s.step(); s.traffic.update(w, 1); w.clock += 1; }
  s.version++;
  return { plan: plan.ok, reason: plan.reason, graph: s.traffic.graph.stats, live: s.traffic.graph.vehicles.length, tile: s.traffic.vehicles.length, graphRoads: w.graphRoads };
});
// Run in real time for a bit so cars are mid-drive, then pause and frame the curve.
await page.evaluate(() => { const c = window.city; c.setSpeed?.(3); c.setTimeOfDay(0.45); c.setOverlay("none"); c.cam.zoomBy(3.4 / c.cam.zoom); c.cam.target.set(19, 0, 32); });
// Step the sim (paused in real time) until several LIVE trips are on the curve;
// the renderer then draws exactly those vehicles where the sim has them.
await page.evaluate(() => window.city.setSpeed?.(0));
const onCurve = await page.evaluate(() => {
  const s = window.city.sim, w = s.world, g = w.roads;
  const curved = (e) => { const c = g.eCurve[e]; return Math.abs((c[6] - c[0]) * (c[3] - c[1]) - (c[7] - c[1]) * (c[2] - c[0])) > 1; };
  const count = () => { let n = 0; for (const v of s.traffic.graph.vehicles) if (v.trip && v.seg.kind === "lane" && curved(v.seg.edge)) n++; return n; };
  let best = 0;
  for (let i = 0; i < 4000; i++) {
    s.step(); for (let k = 0; k < 4; k++) s.traffic.update(w, 0.25); w.clock += 1;
    best = count(); if (best >= 5) break;
  }
  s.version++;
  return best;
});
await page.evaluate(() => window.city.setSpeed?.(0));
await page.waitForTimeout(1500);
await page.screenshot({ path: "/workspace/oasis-free-roads-traffic.png", timeout: 240000 });
console.log(JSON.stringify({ ...info, onCurve, errs }));
await browser.close();
