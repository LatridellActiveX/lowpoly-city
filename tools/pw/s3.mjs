// OASIS-S3 Playwright tool: demand-actuated traffic lights in a real save.
// Usage: node tools/pw/s3.mjs <port> <save.json> <outPrefix>
//   <outPrefix>-resting.png  a quiet signal junction resting on green, with the
//                            inspector saying "stays green until a car waits…"
//   <outPrefix>-lone-car.png a junction that just turned green for a lone car
//                            that pulled up with nobody on the other roads
//   <outPrefix>-busy.png     the busiest signal junction switching (amber / all-red)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [port = "4175", savePath, prefix = "/workspace/oasis-s3"] = process.argv.slice(2);
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
await page.evaluate(() => { const c = window.city; c.setSpeed(1); for (let k = 0; k < 800; k++) c.sim.update(0.25); });
// Step until `want` finds a signal node; freeze; frame it with the inspector open.
const shoot = async (name, want) => {
  const hit = await page.evaluate((want) => {
    const c = window.city, s = c.sim; c.setSpeed(1);
    const test = new Function("gt", "g", "n", want);
    for (let k = 0; k < 4000; k++) {
      s.update(0.1);
      const gt = s.traffic.graph.gt, g = s.world.roads; if (!gt) continue;
      for (const n of gt.junctions.keys()) if (g.nKind[n] === "signal" && test(gt, g, n)) {
        c.setSpeed(0); return { n, x: g.nx[n], z: g.nz[n], st: { ...gt.signalState(n) }, k };
      }
    }
    c.setSpeed(0); return null;
  }, want);
  console.log(name, JSON.stringify(hit));
  if (!hit) return;
  await page.evaluate((h) => { const c = window.city; c.setTimeOfDay?.(0.45); c.setOverlay("none"); c.cam.zoomBy(3.2 / c.cam.zoom); c.cam.target.set(h.x / 32, 0, h.z / 32); c.inspectGraph("node", h.n); c.sim.version++; }, hit);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${prefix}-${name}.png` });
};
// Resting: green for > 20 s and no other phase has a car within detection range.
await shoot("resting", `const st = gt.signalState(n), J = gt.junctions.get(n);
  if (st.mode !== 'green' || st.t < 25 || J.phases.length < 2) return false;
  for (let p = 0; p < J.phases.length; p++) if (p !== st.ph && gt.phaseDemand(n, p)) return false;
  return gt.vehicles.some((v) => !v.done && v.seg.kind === 'lane' && J.phases[st.ph].includes(v.seg.edge) && gt.laneLen(v.seg.edge) - v.s < 80);`);
// Lone car: the light just went green (< 0.3 s) for a phase after a short all-red, nobody else waiting.
await shoot("lone-car", `const st = gt.signalState(n), J = gt.junctions.get(n);
  if (st.mode !== 'green' || st.t > 0.15 || J.phases.length < 2) return false;
  for (let p = 0; p < J.phases.length; p++) if (p !== st.ph && gt.phaseDemand(n, p)) return false;
  return gt.phaseDemand(n, st.ph);`);
// Busy: amber with cars waiting on the next phase.
await shoot("busy", `const st = gt.signalState(n);
  return st.mode === 'amber' && st.t > 0.8 && gt.phaseDemand(n, st.next) && gt.vehicles.filter((v) => !v.done && v.seg.kind === 'lane' && Math.hypot(gt.position(v).x - g.nx[n], gt.position(v).z - g.nz[n]) < 90).length >= 4;`);
console.log("errs", JSON.stringify(errs));
await browser.close();
