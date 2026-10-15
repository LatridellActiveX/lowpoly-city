import { chromium } from "playwright";
const port = process.argv[2] || "4182", out = process.argv[3] || "/tmp/edge-live.png";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://localhost:${port}/`); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.city && window.city.title);
await page.evaluate(() => window.city.startGame("new", { seed: 4242, map: "river" }));
await page.waitForTimeout(1000);
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Got it/.test(x.textContent)); b && b.click(); window.city.setSpeed?.(3); });
const R = `(x0, z0, x1, z1) => { const o = []; for (let z = Math.min(z0,z1); z <= Math.max(z0,z1); z++) for (let x = Math.min(x0,x1); x <= Math.max(x0,x1); x++) o.push([x, z]); return o; }`;
const ez = await page.evaluate(() => { const w = window.city.sim.world; w.cash = 1e9; w.regionsOwned = (1 << 30) - 1; w.peakPop = 3000; w.tier = 3; return Math.floor(w.edgeIndex / 64); });
const step = async (code) => { await page.evaluate(([code, ez, R]) => { const s = window.city.sim, rect = eval(R), c = window.city; eval(code); }, [code, ez, R]); await page.waitForTimeout(1500); };
await step(`s.apply("road", rect(30, ez, 59, ez))`);
await step(`s.apply("powerPlant", [[30, ez - 1]])`);
await step(`s.zoneOpt = { density: 0, depth: 1 }; s.apply("residential", rect(32, ez + 1, 58, ez + 1))`);
await step(`s.apply("road", rect(61, ez + 1, 61, ez + 8))`); // T ON the outside road
await step(`s.apply("road", rect(62, ez - 8, 62, ez + 8))`); // + ON the outside road
await step(`s.zoneOpt = { density: 0, depth: 1 }; s.apply("residential", rect(60, ez + 2, 60, ez + 8)); s.apply("residential", rect(63, ez - 8, 63, ez - 1)); s.apply("residential", rect(61, ez - 8, 61, ez - 1))`);
await page.waitForTimeout(4000);
const res = await page.evaluate(([ez]) => { const s = window.city.sim, w = s.world, N = 64, rows = []; for (let z = ez - 9; z <= ez + 9; z++) { let r = ""; for (let x = 44; x < 64; x++) { const i = z * N + x, t = w.tiles[i], st = s.status(i); r += t.road ? (st.powered ? (w.graphTiles.has(i) ? "#" : "T") : "x") : t.zone ? (st.powered ? "p" : "u") : t.structure !== "none" ? "S" : "."; } rows.push(String(z).padStart(2) + " " + r); } const g = w.roads; return { rows, edges: g.liveEdges().map((e) => `${g.eType[e]}:[${g.nx[g.eA[e]] / 32 - .5},${g.nz[g.eA[e]] / 32 - .5}]-[${g.nx[g.eB[e]] / 32 - .5},${g.nz[g.eB[e]] / 32 - .5}]`) }; }, [ez]);
console.log(res.rows.join("\n")); console.log(res.edges.join(" ")); console.log(errs);
await page.evaluate(([ez]) => { const c = window.city; c.setSpeed?.(0); c.setOverlay("power"); c.cam.zoomBy(2.2 / c.cam.zoom); c.cam.target.set(58, 0, ez); c.sim.version++; }, [ez]);
await page.waitForTimeout(3000); await page.screenshot({ path: out });
await browser.close();
