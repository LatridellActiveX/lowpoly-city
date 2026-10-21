// IND Playwright tool: screenshots for the industry stages (IND-1 … IND-5).
// Usage: node tools/pw/ind.mjs <port> <save.json> <stage> <outPrefix>
// Loads the save, lets the sim settle, then per stage:
//   1  inspect a pickable factory, open its panel (recipe dropdown) → <prefix>-panel.png,
//      then pick a recipe via the dropdown → <prefix>-retool.png
//   2  supply-chain overlay → <prefix>-overlay.png
//   3  factory panel with upgrades → <prefix>-upgrades.png
//   4  budget panel policies → <prefix>-policies.png
//   5  resources view with ore → <prefix>-ore.png, a steel mill → <prefix>-steel.png
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [port = "4180", savePath, stage = "1", prefix = "/workspace/oasis-ind"] = process.argv.slice(2);
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
// Settle: run the sim a bit so roles and trucks exist; noon light; frame a tile.
const frame = async (fn, arg) => page.evaluate(fn, arg);
await frame(() => { const c = window.city, s = c.sim; for (let k = 0; k < 400; k++) s.update(0.5); c.setSpeed?.(0); c.setTimeOfDay(0.5); });
const look = (x, z, zoom = 2.2) => frame(([x, z, zoom]) => { const c = window.city; c.cam.zoomBy(zoom / c.cam.zoom); c.cam.target.set(x + 0.5, 0, z + 0.5); c.sim.version++; }, [x, z, zoom]);
const shot = async (name) => { await page.waitForTimeout(1500); await page.screenshot({ path: `${prefix}-${name}.png`, timeout: 240000 }); };
// A factory the player can pick a recipe for (the panel shows a .fc-recipe select).
const pickFactory = () => frame(() => {
  const c = window.city, w = c.sim.world, N = Math.round(Math.sqrt(w.tiles.length));
  for (let i = 0; i < w.tiles.length; i++) { const t = w.tiles[i]; if (t.zone !== "industrial" || t.level === 0) continue; c.inspect(i % N, Math.floor(i / N)); c.refresh(); if (document.querySelector(".fc-recipe")) return [i % N, Math.floor(i / N)]; }
  return null;
});
const out = {};
if (stage === "1" || stage === "3") {
  const p = await pickFactory(); out.factory = p;
  if (p) await look(p[0], p[1]);
  await frame(() => window.city.refresh());
  if (stage === "3") { // buy Second shift and Filters through the real buttons
    for (const u of ["SHIFT", "FILTER"]) { await frame((u) => document.querySelector(`[data-fc="upg"][data-u="${u}"]`).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })), u); await frame(() => window.city.refresh()); }
    out.upg = await frame(() => [...document.querySelectorAll('[data-fc="upg"]')].map((b) => b.textContent));
  }
  await shot(stage === "1" ? "panel" : "upgrades");
  if (stage === "1" && p) {
    await page.selectOption(".fc-recipe", "printer");
    await frame(() => window.city.refresh());
    out.flash = await frame(() => document.querySelector(".toast")?.textContent);
    await shot("retool");
  }
}
if (stage === "2") {
  // Frame the middle of the links (weighted by flow).
  const mid = await frame(() => { const s = window.city.sim, N = Math.round(Math.sqrt(s.world.tiles.length)); let x = 0, z = 0, n = 0; for (const l of s.shipping.flow.top(s.world.tick)) { for (const i of [l.from, l.to]) { x += (i % N) * l.rate; z += Math.floor(i / N) * l.rate; n += l.rate; } } return n ? [x / n, z / n, s.shipping.flow.links.size] : null; });
  out.mid = mid;
  await frame(() => window.city.setOverlay("chain")); if (mid) await look(mid[0], mid[1], 1.6); await shot("overlay");
}
if (stage === "4") {
  await frame(() => { for (const b of document.querySelectorAll("button")) if (/Budget/.test(b.textContent)) { b.click(); break; } });
  // Tick Night shifts through the real checkbox and scroll the section into view.
  out.pol = await frame(() => { const i = document.querySelector('input[data-policy="night"]'); if (!i) return null; i.click(); i.scrollIntoView({ block: "center" }); return window.city.sim.world.policies; });
  await shot("policies");
}
if (stage === "5") {
  const ore = await frame(() => { const c = window.city, w = c.sim.world, N = Math.round(Math.sqrt(w.tiles.length)); let sx = 0, sz = 0, n = 0; for (let i = 0; i < w.tiles.length; i++) if (w.resourceAt(i) === 5) { sx += i % N; sz += Math.floor(i / N); n++; } return n ? [Math.round(sx / n), Math.round(sz / n), n] : null; });
  out.ore = ore;
  await frame(() => window.city.setOverlay("resources")); if (ore) await look(ore[0], ore[1], 1.2); await shot("ore");
  await frame(() => window.city.setOverlay("none"));
  // The avenue save is a Village: make one pickable factory a steel mill (as the picker would) so its model shows.
  await frame(() => { const c = window.city, w = c.sim.world; w.tier = 3; const N = Math.round(Math.sqrt(w.tiles.length)); for (let i = 0; i < w.tiles.length; i++) { const t = w.tiles[i]; if (t.zone !== "industrial" || t.level === 0) continue; c.inspect(i % N, Math.floor(i / N)); c.refresh(); if (document.querySelector(".fc-recipe")) { t.recipe = "steelMill"; t.pause = 0; c.sim.version++; break; } } });
  const sm = await frame(() => { const c = window.city, w = c.sim.world, N = Math.round(Math.sqrt(w.tiles.length)); for (let i = 0; i < w.tiles.length; i++) { const t = w.tiles[i]; if (t.zone === "industrial" && t.recipe === "steelMill") { c.inspect(i % N, Math.floor(i / N)); c.refresh(); return [i % N, Math.floor(i / N)]; } } return null; });
  out.steel = sm; if (sm) await look(sm[0], sm[1], 2.6); await shot("steel");
}
if (stage === "6") {
  // IND-6: turn a free tile next to a road into a recycling center set to Plastics and open its panel.
  out.rc = await frame(() => {
    const c = window.city, w = c.sim.world, N = Math.round(Math.sqrt(w.tiles.length));
    w.peakPop = Math.max(w.peakPop, 3000);
    for (let i = N; i < w.tiles.length - N; i++) { const t = w.tiles[i]; if (t.zone || t.road || t.water || t.structure !== "none" || t.edge) continue; if (![1, -1, N, -N].some((d) => w.tiles[i + d].road)) continue;
      t.structure = "service"; t.kind = 8; t.part = 0; t.recipe = "plastics"; t.stock = 20; c.sim.version++; c.inspect(i % N, Math.floor(i / N)); c.refresh(); return [i % N, Math.floor(i / N)]; }
    return null; });
  if (out.rc) await look(out.rc[0], out.rc[1], 2.6);
  await frame(() => window.city.refresh()); await shot("recycling");
}
if (stage === "7") {
  // IND-7: a warehouse on a free road-side tile nearest the factories, with some stock, panel open.
  out.wh = await frame(() => {
    const c = window.city, w = c.sim.world, N = Math.round(Math.sqrt(w.tiles.length));
    w.peakPop = Math.max(w.peakPop, 3000);
    const fs = []; w.tiles.forEach((t, i) => { if (t.zone === "industrial" && t.level > 0) fs.push(i); });
    const man = (a, b) => Math.abs(a % N - b % N) + Math.abs(Math.floor(a / N) - Math.floor(b / N));
    let a = -1, best = 1e9;
    w.tiles.forEach((t, i) => { if (i < N || i >= w.tiles.length - N || t.zone || t.road || t.water || t.structure !== "none" || t.edge || ![1, -1, N, -N].some((d) => w.tiles[i + d].road)) return; const d = Math.min(...fs.map((f) => man(i, f))); if (d < best) { best = d; a = i; } });
    const t = w.tiles[a]; t.structure = "service"; t.kind = 9; t.part = 0; w.warehouses[a] = { lumber: 64, food: 48, plastics: 32 };
    c.sim.version++; c.inspect(a % N, Math.floor(a / N)); c.refresh(); return [a % N, Math.floor(a / N)];
  });
  await look(out.wh[0], out.wh[1], 2.4);
  for (let k = 0; k < 6; k++) await frame(() => { window.city.sim.update(0.5); window.city.refresh(); });
  await shot("warehouse");
}
if (stage === "8") {
  // IND-8: a 2×2 depot with a rail yard beside a road (bought through the real button), then the budget price ticker.
  out.dep = await frame(() => {
    const c = window.city, w = c.sim.world, N = Math.round(Math.sqrt(w.tiles.length));
    w.peakPop = Math.max(w.peakPop, 3000); w.cash = Math.max(w.cash, 200000);
    for (let i = N; i < w.tiles.length - 3 * N; i++) {
      if (i % N > N - 3) continue;
      const blk = [0, 1, N, N + 1].map((d) => w.tiles[i + d]);
      if (!blk.every((q) => !q.zone && !q.road && !q.water && q.structure === "none" && !q.edge)) continue;
      if (![i - N, i + 1 - N, i + 2 * N, i + 2 * N + 1].some((j) => w.tiles[j]?.road)) continue;
      [0, 1, N, N + 1].forEach((d) => { const q = w.tiles[i + d]; q.structure = "service"; q.kind = 7; q.part = d ? i + 1 : 0; });
      for (let m = 1; m <= 9; m++) c.sim.world.tick += 0; // (prices drift below)
      c.sim.version++; c.inspect(i % N, Math.floor(i / N)); c.refresh(); return [i % N, Math.floor(i / N)];
    }
    return null;
  });
  if (out.dep) {
    out.railBtn = await frame(() => { const b = document.querySelector("[data-rail]"); b?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); window.city.refresh(); return [!!b, window.city.sim.world.tiles.find((t) => t.kind === 7 && t.structure === "service" && !t.part)?.upg]; });
    await frame(() => { const c = window.city; c.setSpeed?.(1); for (let k = 0; k < 6; k++) c.sim.update(0.5); c.setSpeed?.(0); });
    await look(out.dep[0] + 1, out.dep[1] + 1, 2.2); await shot("railyard");
  }
  // Let a few months pass so prices have drifted, then open the budget at the ticker.
  await frame(() => { const c = window.city, s = c.sim; c.setSpeed?.(1); const t0 = s.world.tick; for (let k = 0; k < 20000 && s.world.tick < t0 + 2400; k++) s.update(0.5); c.setSpeed?.(0); });
  await frame(() => { for (const b of document.querySelectorAll("button")) if (/Budget/.test(b.textContent)) { b.click(); break; } });
  await frame(() => { const t = document.querySelector('[data-k="ticker"]'); t?.scrollIntoView({ block: "center" }); });
  await shot("prices");
}
console.log(JSON.stringify({ out, errs: errs.slice(0, 3) }));
await browser.close();
