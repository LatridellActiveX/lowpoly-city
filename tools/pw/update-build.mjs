// HOTFIX smoke test: "I can't build things after an update" (Parker, 2026-10-16).
// A 128 map, then the update reload (sessionStorage resume = 'continue'), then a
// real-mouse road, zone box and wind turbine must all spend money.
// Usage: node tools/pw/update-build.mjs <port>   (vite preview running)  exit 1 on failure
import { chromium } from "playwright";
const [port = "4173"] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
const ready = () => page.waitForFunction(() => window.city && window.city.sim, null, { timeout: 60000 });
await page.goto(`http://localhost:${port}/`); await ready();
await page.evaluate(() => { localStorage.clear(); window.city.startGame("new", { map: "river", size: 128 }); });
await page.waitForTimeout(1000);
await page.evaluate(() => sessionStorage.setItem("lowpoly-city-resume", "continue"));
await page.reload(); await ready(); await page.waitForTimeout(2500);
await page.evaluate(() => { for (const b of document.querySelectorAll("button")) if (/Got it/.test(b.textContent)) b.click(); }); await page.waitForTimeout(300);
const cash = () => page.evaluate(() => window.city.sim.world.cash);
const drag = async (tool, a, b) => { const key = { road: "r", residential: "1" }[tool]; if (key) await page.keyboard.press(key); else await page.evaluate((t) => window.city.setTool(t), tool); await page.waitForTimeout(100); await page.mouse.move(...a); await page.mouse.down(); await page.mouse.move(...b, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400); };
let fails = 0; const res = {};
for (const [tool, a, b] of [["road", [560, 450], [800, 450]], ["residential", [600, 475], [720, 540]], ["windTurbine", [700, 330], [700, 330]]]) {
  const c0 = await cash(); await drag(tool, a, b); const spent = c0 - (await cash()); res[tool] = spent; if (!(spent > 0)) fails++;
}
console.log(JSON.stringify({ res, errs: errs.slice(0, 3) }), fails || errs.length ? "FAIL" : "ok");
await browser.close(); process.exit(fails || errs.length ? 1 : 0);
