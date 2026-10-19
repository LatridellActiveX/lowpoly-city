// OASIS-S5 Playwright tool: an avenue narrowing smoothly into a street.
// Usage: node tools/pw/s5.mjs <port> <save.json> <outPrefix>
//   <outPrefix>-closeup.png  close, low view of the taper (median nose, kerbs)
//   <outPrefix>-topdown.png  steep view of the same spot
// Uses an existing straight avenue→street node in the save if there is one;
// otherwise builds an avenue straight on from a street dead end (or, failing
// that, an avenue + street pair on free land) so there is one to show.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [port = "4175", savePath, prefix = "/workspace/oasis-s5"] = process.argv.slice(2);
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
await page.evaluate(() => { for (const b of document.querySelectorAll("button")) if (/Got it/.test(b.textContent)) b.click(); });
const spot = await page.evaluate(() => {
  const c = window.city, s = c.sim, g = s.world.roads; s.world.cash = Math.max(s.world.cash, 1e7);
  const W = { street: 15, oneway: 15, avenue: 29, highway: 45 };
  const dirAt = (e, n) => { const k = g.eCurve[e], A = g.eA[e] === n; const dx = A ? k[2] - k[0] : k[4] - k[6], dz = A ? k[3] - k[1] : k[5] - k[7], L = Math.hypot(dx, dz) || 1; return { x: dx / L, z: dz / L }; };
  const find = () => {
    for (const n of g.liveNodes()) {
      const es = g.nEdges[n]; if (es.length !== 2 || g.nKind[n] === "roundabout") continue;
      if (W[g.eType[es[0]]] === W[g.eType[es[1]]]) continue;
      const a = dirAt(es[0], n), b = dirAt(es[1], n);
      if (-(a.x * b.x + a.z * b.z) > Math.cos((6 * Math.PI) / 180)) { const wide = W[g.eType[es[0]]] > W[g.eType[es[1]]] ? es[0] : es[1]; const d = dirAt(wide, n); return { n, x: g.nx[n], z: g.nz[n], dx: d.x, dz: d.z }; }
    }
    return null;
  };
  let hit = find(), how = "existing";
  if (!hit) {
    how = "built from a street dead end";
    for (const n of g.liveNodes()) {
      const es = g.nEdges[n]; if (es.length !== 1 || g.eType[es[0]] !== "street") continue;
      const d = dirAt(es[0], n), p = { x: g.nx[n], z: g.nz[n] };
      for (const len of [224, 192, 160, 128]) {
        const curve = c.free.lineCubic(p, { x: p.x - d.x * len, z: p.z - d.z * len });
        if (c.free.placeFreeRoad(s, curve, "avenue", {}, false, false).ok) { c.free.placeFreeRoad(s, curve, "avenue", {}, true, true); hit = find(); break; }
      }
      if (hit) break;
    }
  }
  if (!hit) {
    how = "built on free land";
    const N = Math.round(Math.sqrt(s.world.tiles.length));
    outer: for (let z = 8; z < N - 8; z += 3) for (let x = 8; x < N - 20; x += 3) {
      const a = { x: x * 32 + 16, z: z * 32 + 16 }, m = { x: a.x + 192, z: a.z }, b = { x: a.x + 384, z: a.z };
      const ca = c.free.lineCubic(a, m), cb = c.free.lineCubic(m, b);
      if (!c.free.placeFreeRoad(s, ca, "avenue", {}, false, false).ok || !c.free.placeFreeRoad(s, cb, "street", {}, false, false).ok) continue;
      c.free.placeFreeRoad(s, ca, "avenue", {}, true, true); c.free.placeFreeRoad(s, cb, "street", {}, true, true);
      hit = find(); if (hit) break outer;
    }
  }
  c.setSpeed(1); for (let k = 0; k < 400; k++) s.update(0.25); c.setSpeed(0);
  return hit && { ...hit, how };
});
console.log(JSON.stringify(spot));
if (spot) {
  // look from the street side towards the avenue, centred a little into the taper
  const shots = [["closeup", 4, 0.5], ["topdown", 3.2, 1.13]];
  for (const [name, zoom, el] of shots) {
    await page.evaluate(([p, zoom, el]) => {
      const c = window.city; c.setTimeOfDay?.(0.45); c.setOverlay("none"); c.cam.zoomBy(zoom / c.cam.zoom); c.cam.elevation = el;
      c.cam.target.set((p.x + p.dx * 15) / 32, 0, (p.z + p.dz * 15) / 32); c.sim.version++;
    }, [spot, zoom, el]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${prefix}-${name}.png`, clip: { x: 283, y: 150, width: 800, height: 600 } });
  }
}
console.log("errs", JSON.stringify(errs));
await browser.close();
