import { chromium } from "playwright";
const port = process.argv[2] || "4182", size = +(process.argv[3] || 64);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://localhost:${port}/`); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.city && window.city.title);
await page.evaluate((size) => window.city.startGame("new", { seed: 4242, map: "river", size }), size);
await page.waitForTimeout(1000);
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Got it/.test(x.textContent)); b && b.click(); window.city.setSpeed?.(3); });
const steps = [
  ["powerPlant", "P", 0, 0], ["road", "R", 0, 0], ["road", "T", 0, 0], ["road", "X", 0, 0], ["avenue", "A", 0, 0], ["roundabout", "O", 0, 0], ["free", "F", 0, 0],
];
const info = await page.evaluate(() => { const w = window.city.sim.world, N = Math.round(Math.sqrt(w.tiles.length)); return { ex: w.edgeIndex % N, ez: Math.floor(w.edgeIndex / N), N }; });
const { ex, ez, N } = info; const o = ex - 63;
const run = async (fn, arg) => { await page.evaluate(fn, arg); await page.waitForTimeout(1500); };
const R = `(x0, z0, x1, z1) => { const o = []; for (let z = Math.min(z0,z1); z <= Math.max(z0,z1); z++) for (let x = Math.min(x0,x1); x <= Math.max(x0,x1); x++) o.push([x, z]); return o; }`;
await run(([o, ez]) => { const s = window.city.sim; s.world.cash = 1e8; s.world.regionsOwned = (1 << 30) - 1; s.world.peakPop = 3000; s.world.tier = 3; s.apply("powerPlant", [[58 + o, ez - 1]]); }, [o, ez]);
for (const [tool, x0, z0, x1, z1] of [["road", 59, 0, 14, 0], ["road", 50, -1, 50, -10], ["road", 40, -6, 40, 6], ["avenue", 30, -6, 30, 6]]) {
  await run(([tool, a, b, c, d, R]) => { const s = window.city.sim, rect = eval(R); s.apply(tool, rect(a, b, c, d)); }, [tool, x0 + o, z0 + ez, x1 + o, z1 + ez, R]);
}
await run(([o, ez]) => { window.city.sim.apply("roundabout", [[22 + o, ez - 1], [23 + o, ez - 1], [22 + o, ez], [23 + o, ez]]); }, [o, ez]);
await run(([o, ez]) => { const c = window.city, F = c.free, M = (x, z) => ({ x: (x + 0.5) * 32, z: (z + 0.5) * 32 }); window.__r = [F.placeFreeRoad(c.sim, F.lineCubic(M(45 + o, ez), M(45 + o, ez + 8)), "street", {}, true, true).ok, F.placeFreeRoad(c.sim, F.quadCubic(M(45 + o, ez + 8), M(45 + o, ez + 12), M(52 + o, ez + 12)), "street", {}, true, true).ok]; }, [o, ez]);
await run(([o, ez, R]) => { const s = window.city.sim, rect = eval(R); s.zoneOpt = { density: 0, depth: 1 }; for (const [a, b] of [[52, 57], [42, 48], [32, 38], [24, 28], [14, 20]]) s.apply("residential", rect(a + o, ez + 1, b + o, ez + 1)); s.apply("residential", rect(46 + o, ez + 2, 46 + o, ez + 7)); s.apply("residential", rect(51 + o, ez - 2, 51 + o, ez - 9)); }, [o, ez, R]);
await run(([o, ez, R]) => { const s = window.city.sim, rect = eval(R); s.apply("bulldoze", [[40 + o, ez]]); }, [o, ez, R]);
await run(([o, ez, R]) => { const s = window.city.sim; s.apply("road", [[39 + o, ez], [40 + o, ez], [41 + o, ez]]); s.apply("road", [[40 + o, ez - 1], [40 + o, ez], [40 + o, ez + 1]]); }, [o, ez, R]);
await page.waitForTimeout(4000);
const gc = await page.evaluate(() => { const g = window.city.sim.world.roads, p = new Map(); const f = (a) => { const v = p.get(a) ?? a; if (v === a) return a; const r = f(v); p.set(a, r); return r; }; for (const e of g.liveEdges()) p.set(f(g.eA[e]), f(g.eB[e])); return new Set(g.liveNodes().filter((n) => g.nEdges[n].length).map(f)).size; });
console.log("graph components after bulldoze+rebuild", gc);
const rows = await page.evaluate(([o, ez]) => { const s = window.city.sim, w = s.world, N = Math.round(Math.sqrt(w.tiles.length)); const rows = []; for (let z = ez - 11; z <= ez + 13; z++) { let r = ""; for (let x = 10 + o; x < 64 + o; x++) { const i = z * N + x, t = w.tiles[i], st = s.status(i); r += t.road ? (w.graphTiles.has(i) ? (st.powered ? "#" : "x") : (st.powered ? "T" : "t")) : t.zone ? (st.powered ? "p" : "u") : t.structure !== "none" ? "S" : "."; } rows.push(String(z).padStart(3) + " " + r); } return rows; }, [o, ez]);
console.log(size, ex, ez, await page.evaluate(() => window.__r)); console.log(rows.join("\n")); console.log(errs);
await page.evaluate(([x, z]) => { const c = window.city; c.setOverlay("power"); c.setSpeed?.(0); c.setTimeOfDay(0.45); c.cam.zoomBy(1.7 / c.cam.zoom); c.cam.target.set(x, 0, z); c.sim.version++; }, [42 + o, ez + 1]);
await page.waitForTimeout(3000); await page.screenshot({ path: process.argv[4] || `/tmp/pl-${size}.png` });
await browser.close();
