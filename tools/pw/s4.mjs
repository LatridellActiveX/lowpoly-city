// OASIS-S4 Playwright tool: a park's coverage now follows the roads.
// Usage: node tools/pw/s4.mjs <port> <save.json> <outPrefix>
//   <outPrefix>-overlay.png  the pollution/park overlay (green = park bonus) around
//                            a park placed next to a street in the save
//   <outPrefix>-view.png     the same spot in the normal view
// Prints how many homes the park reaches and how many of them the old 10×10
// square would also have covered.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [port = "4175", savePath, prefix = "/workspace/oasis-s4"] = process.argv.slice(2);
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
const info = await page.evaluate(() => {
  const c = window.city, s = c.sim, w = s.world, T = w.tiles, N = Math.round(Math.sqrt(T.length));
  const parks = []; T.forEach((t, i) => { if (t.structure === "park") parks.push(i); });
  // Best spot: free land beside a road with the most homes within 12 tiles (Manhattan).
  let best = -1, bestScore = -1;
  T.forEach((t, i) => {
    if (t.road || t.water || t.zone || t.structure !== "none") return;
    const x = i % N, z = (i - x) / N;
    if (![i - 1, i + 1, i - N, i + N].some((j) => T[j]?.road)) return;
    let sc = 0;
    for (let dz = -12; dz <= 12; dz += 2) for (let dx = -12; dx <= 12; dx += 2) { const j = (z + dz) * N + x + dx; if (T[j]?.zone === "residential") sc++; }
    if (sc > bestScore) { bestScore = sc; best = i; }
  });
  w.cash = Math.max(w.cash, 1e6);
  const x = best % N, z = (best - x) / N;
  if (best >= 0) s.apply("park", [[x, z]]);
  c.setSpeed(1); for (let k = 0; k < 8; k++) s.update(0.25); c.setSpeed(0);
  // homes lifted by THIS park: compare env.parks around it vs the old square rule
  let reached = 0, alsoOld = 0, outsideOld = 0;
  T.forEach((t, i) => {
    if (t.zone !== "residential") return;
    const ix = i % N, iz = (i - ix) / N, inSq = ix - x >= -5 && ix - x <= 4 && iz - z >= -5 && iz - z <= 4;
    if (Math.abs(ix - x) + Math.abs(iz - z) > 24 || s.env.parks[i] <= 0.05) return;
    reached++; if (inSq) alsoOld++; else outsideOld++;
  });
  return { existingParks: parks.length, placed: best >= 0 && T[best].structure === "park", x, z, reached, alsoOld, outsideOld };
});
console.log(JSON.stringify(info));
for (const [name, ov] of [["overlay", "pollution"], ["view", "none"]]) {
  await page.evaluate(([p, ov]) => { const c = window.city; c.setTimeOfDay?.(0.45); c.setOverlay(ov); c.cam.zoomBy(1.6 / c.cam.zoom); c.cam.target.set(p.x + 0.5, 0, p.z + 0.5); c.sim.version++; }, [info, ov]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${prefix}-${name}.png` });
}
console.log("errs", JSON.stringify(errs));
await browser.close();
