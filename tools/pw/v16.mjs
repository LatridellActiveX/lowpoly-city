// V1.6 Playwright tool: render bench + screenshots. Usage: node v16.mjs <port> <stage>
//   cull  — A5: same frame with chunk culling on/off (pixel diff) + rebuild timings (T6)
import { chromium } from "playwright";
import { execSync } from "child_process";
const port = process.argv[2] || "4175", stage = process.argv[3] || "cull";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://localhost:${port}/`); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.city && window.city.title);
const out = {};
// Grid town (same as the bench town) at offset (ox, oz) on a fresh sim; returns pop.
const TOWN = `(s, ox, oz) => {
  const rect = (x0, z0, x1, z1) => { const o = []; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) o.push([x + ox, z + oz]); return o; };
  s.world.cash = 1e7; s.world.tiles.forEach((t) => { t.deco = t.deco; t.water = false; });
  s.world.peakPop = 6000; s.world.tier = 2;
  for (const z of [12, 19, 26, 33, 40]) s.apply("road", rect(10, z, 50, z));
  for (const x of [10, 30, 50]) s.apply("road", rect(x, 12, x, 40));
  s.apply("powerPlant", rect(9, 12, 9, 12)); s.apply("waterTower", rect(9, 13, 9, 13)); s.apply("waterTower", rect(51, 13, 51, 13)); s.apply("waterTower", rect(9, 41, 9, 41));
  s.apply("windTurbine", rect(51, 12, 51, 12)); s.apply("constructionYard", rect(29, 11, 29, 11)); s.apply("constructionYard", rect(31, 41, 31, 41));
  for (let x = 12; x < 50; x += 3) { s.apply("park", rect(x, 16, x, 16)); s.apply("park", rect(x, 30, x, 30)); }
  s.zoneOpt = { density: 0, depth: 3 };
  s.apply("residential", rect(11, 13, 29, 13)); s.apply("residential", rect(31, 13, 49, 13)); s.apply("residential", rect(11, 27, 29, 27)); s.apply("residential", rect(31, 27, 49, 27));
  s.zoneOpt = { density: 1, depth: 3 }; s.apply("commercial", rect(11, 20, 29, 20)); s.apply("commercial", rect(31, 20, 49, 20));
  s.zoneOpt = { density: 0, depth: 2 }; s.apply("industrial", rect(31, 34, 49, 34));
  { const N = Math.round(Math.sqrt(s.world.tiles.length)), e = s.world.edgeIndex, ex = e % N, ez = Math.floor(e / N);
    const R = (x0, z0, x1, z1) => { const o = []; for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) o.push([x, z]); return o; };
    if (e >= 0) { s.apply("road", R(50 + ox, 26 + oz, 50 + ox, ez)); s.apply("road", R(50 + ox, ez, ex, ez)); s.apply("road", R(ex, ez, ex, 26 + oz)); } }
  for (let i = 0; i < 1400; i++) { s.step(); s.traffic.update(s.world, 1); s.world.clock += 1; }
  return s.stats().population;
}`;
const diff = (a, b) => execSync(`python3 -c "from PIL import Image, ImageChops; a=Image.open('${a}').convert('RGB'); b=Image.open('${b}').convert('RGB'); h=ImageChops.difference(a,b).convert('L').histogram(); print(round(100*sum(h[24:])/sum(h),3))"`).toString().trim();

if (stage === "cull") {
  await page.evaluate(() => window.city.startGame("new", { seed: 4242, map: "river" }));
  out.pop = await page.evaluate((T) => { const c = window.city; const s = new c.sim.constructor(new c.sim.world.constructor(undefined, 4242)); const p = eval(T)(s, 0, 0); c.useSim(s); s.speed = 0; c.setSpeed?.(0); return p; }, TOWN);
  for (const [name, x, z, zm] of [["close", 22, 22, 4], ["mid", 31, 26, 1.6]]) {
    for (const cull of [true, false]) {
      await page.evaluate(([x, z, zm, cull]) => { const c = window.city; c.renderer.cull = cull; c.setTimeOfDay(0.45); c.setOverlay("none"); c.cam.zoomBy(zm / c.cam.zoom); c.cam.target.set(x, 0, z); c.sim.version++; }, [x, z, zm, cull]);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `/tmp/cull-${name}-${cull}.png` });
      out[`${name}-${cull}`] = await page.evaluate(() => { const st = window.city.renderer.stats; return { chunks: `${st.chunksDrawn}/${st.chunksTotal}`, tiles: st.tilesWalked }; });
    }
    out[`${name}-diffPct`] = diff(`/tmp/cull-${name}-true.png`, `/tmp/cull-${name}-false.png`);
  }
  // T6: average rebuild cost with culling on vs off (forced rebuilds, close view).
  for (const cull of [true, false]) {
    out[`rebuildMs-${cull}`] = await page.evaluate(async (cull) => {
      const c = window.city, r = c.renderer; r.cull = cull; c.cam.zoomBy(4 / c.cam.zoom); c.cam.target.set(22, 0, 22);
      await new Promise((ok) => setTimeout(ok, 500));
      r.stats.rebuilds = 0; r.stats.rebuildMs = 0;
      for (let k = 0; k < 20; k++) { c.sim.version++; await new Promise((ok) => requestAnimationFrame(ok)); }
      return +(r.stats.rebuildMs / Math.max(1, r.stats.rebuilds)).toFixed(2);
    }, cull);
  }
}
if (stage === "big") {
  // A6: a new 192 map; town in the centre region, one bought region, whole-map view.
  await page.evaluate(() => window.city.startGame("new", { seed: 4242, map: "river", size: 192 }));
  out.town = await page.evaluate((T) => { const c = window.city, s = c.sim; const p = eval(T)(s, 64, 64); s.world.peakPop = Math.max(s.world.peakPop, 1600); s.world.cash = 1e6; const bought = s.buyRegion(5); c.setSpeed?.(1); return { pop: p, buy: bought, owned: s.world.regionsOwned, size: Math.sqrt(s.world.tiles.length) }; }, TOWN.replace("s.world.tiles.forEach((t) => { t.deco = t.deco; t.water = false; });", ""));
  for (const [name, x, z, zm] of [["big-map", 96, 96, 0.15], ["big-map-centre", 96, 92, 0.6]]) {
    await page.evaluate(([x, z, zm]) => { const c = window.city; c.setTimeOfDay(0.45); c.setOverlay("none"); c.cam.zoomBy(zm / c.cam.zoom); c.cam.target.set(x, 0, z); c.sim.version++; }, [x, z, zm]);
    await page.waitForTimeout(4000); out.fps = await page.evaluate(() => new Promise((ok) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else ok(+(n / 3).toFixed(1)); }; requestAnimationFrame(f); }));
    await page.screenshot({ path: `/workspace/city-v16-${name}.png`, timeout: 240000 });
    out[name] = await page.evaluate(() => { const st = window.city.renderer.stats; return { chunks: `${st.chunksDrawn}/${st.chunksTotal}`, zoom: window.city.cam.zoom }; });
  }
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.title?.startsWith("Regions")); b && b.click(); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/workspace/city-v16-big-map-regions.png", timeout: 240000 });
}
if (stage === "roads") {
  // B6/B7: freeform roads next to the grid town — S-curve street, curved avenue,
  // block zoning, growth; screenshots: preview grid, curved roads + zoning, road detail with cars.
  await page.evaluate(() => window.city.startGame("new", { seed: 4242, map: "river" }));
  out.pop = await page.evaluate((T) => { const c = window.city; const s = new c.sim.constructor(new c.sim.world.constructor(undefined, 4242)); const p = eval(T)(s, 0, 0); c.useSim(s); return p; }, TOWN);
  out.place = await page.evaluate(() => {
    const c = window.city, s = c.sim, F = c.free, M = (x, z) => ({ x: x * 32, z: z * 32 });
    s.world.cash = 1e7;
    const r = [];
    // S-curve street from the grid road end at (50,40) out to the east and north
    r.push(F.placeFreeRoad(s, F.quadCubic(M(50.5, 40.5), M(56, 46), M(58.5, 37)), "street", {}, true, true));
    r.push(F.placeFreeRoad(s, F.quadCubic(M(58.5, 37), M(61, 28), M(56.5, 24)), "street", {}, true, true));
    // curved avenue below the town
    r.push(F.placeFreeRoad(s, F.quadCubic(M(20.5, 40.5), M(28, 52), M(47, 52)), "avenue", {}, true, true));
    r.push(F.placeFreeRoad(s, F.lineCubic(M(47, 52), M(60, 54)), "avenue", {}, true, true));
    // zone the blocks: homes along the street, shops along the avenue
    let n = 0;
    for (const cell of [...s.world.blocks.cells]) if (cell.row < 8) n += F.paintBlocks(s, { x: cell.cx, z: cell.cz }, s.world.roads.eType[cell.edge] === "avenue" ? 5 : 1, 1, 8);
    for (let i = 0; i < 1500; i++) { s.step(); s.traffic.update(s.world, 1); s.world.clock += 1; }
    return { results: r.map((x) => x.ok ? `ok ${x.tiles.length} tiles $${x.cost}` : x.reason), zoned: n, edges: s.world.roads.edgeCount(), cells: s.world.blocks.cells.length, pop: s.stats().population, bldgs: s.world.lots.buildings.size };
  });
  const shot = async (name, x, z, zm, setup) => {
    await page.evaluate(([x, z, zm]) => { const c = window.city; c.setTimeOfDay(0.45); c.setOverlay("none"); c.cam.zoomBy(zm / c.cam.zoom); c.cam.target.set(x, 0, z); c.sim.version++; }, [x, z, zm]);
    if (setup) await setup();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `/workspace/city-v16-${name}.png`, timeout: 240000 });
  };
  // 1. curved roads with zoning overlay (Homes tool on)
  await shot("curved-roads-zoning", 52, 44, 1.3, async () => page.evaluate(() => window.city.setTool("residential")));
  // 2. preview grid while drawing a new curve: tool on, two points set, mouse over the end point
  await shot("road-preview-grid", 50, 46, 1.6, async () => {
    await page.evaluate(() => { const c = window.city; c.setTool("freeRoad"); c.freeTool.mode = "curve"; c.freeTool.pts = [{ x: 40 * 32, z: 46 * 32 }, { x: 44 * 32, z: 60 * 32 }]; });
    const xy = await page.evaluate(() => { const c = window.city, v = new c.cam.camera.position.constructor(54, 0, 47); v.project(c.cam.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
    await page.mouse.move(xy[0], xy[1]);
    await page.waitForTimeout(600);
    out.previewTip = await page.evaluate(() => window.city.freeTool.tip);
    // fps while dragging the preview around
    out.previewFps = await page.evaluate(() => new Promise((ok) => { let n = 0; const t0 = performance.now(); const f = () => { n++; window.city.freeTool.hover({ x: (54 + Math.sin(n / 10)) * 32, z: 47 * 32 }); if (performance.now() - t0 < 3000) requestAnimationFrame(f); else ok(+(n / 3).toFixed(1)); }; requestAnimationFrame(f); }));
  });
  await page.evaluate(() => { window.city.setTool("inspect"); window.city.freeTool.cancel(); });
  // 3. close-up road detail with cars in lanes (avenue + street junction)
  await page.evaluate(() => window.city.setSpeed?.(1));
  await shot("roads-detail", 47, 52, 5, async () => page.waitForTimeout(4000));
  out.cars = await page.evaluate(() => window.city.graphLayer.traffic?.vehicles.length ?? 0);
}
console.log(JSON.stringify({ stage, ...out, errs }));
await browser.close();
