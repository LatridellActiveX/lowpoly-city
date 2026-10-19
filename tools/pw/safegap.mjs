// OASIS-SAFEGAP Playwright tool: screenshots of the safe-gap traffic.
// Usage: node tools/pw/safegap.mjs <port> <save.json> <outPrefix>
// Loads a save, runs traffic headless in the page, then for each scene
// steps the sim until the scene shows up, freezes, frames it and shoots:
//   <outPrefix>-straight.png   a busy straight lane, ≥ 4 moving cars, evenly spaced
//   <outPrefix>-redqueue.png   a queue of ≥ 3 cars standing at a red light
//   <outPrefix>-junction.png   ≥ 2 cars crossing a junction box at once
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [port = "4175", savePath, prefix = "/workspace/oasis-safegap"] = process.argv.slice(2);
const save = readFileSync(savePath, "utf8");
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://localhost:${port}/`);
await page.evaluate((s) => { localStorage.clear(); localStorage.setItem("lowpoly-city-save", s); }, save);
await page.reload();
await page.waitForFunction(() => window.city && window.city.startGame);
await page.evaluate(() => window.city.startGame("continue"));
await page.waitForTimeout(1000);
await page.evaluate(() => { for (const b of document.querySelectorAll("button")) if (/Got it/.test(b.textContent)) b.click(); });
await page.evaluate(() => { const c = window.city; for (let k = 0; k < 1200; k++) c.sim.update(0.25); });
const out = {};
for (const scene of ["straight", "redqueue", "junction"]) {
  const r = await page.evaluate((scene) => {
    const c = window.city, s = c.sim; if (!s.traffic.graph.gt) return { err: "nogt", graphRoads: s.world.graphRoads, pop: s.world.population, stats: s.traffic.graph.stats }; const gt = s.traffic.graph.gt, g = s.world.roads;
    // Find the scene; returns a world point to frame, or null.
    const find = () => {
      if (scene === "junction") {
        for (const [n, J] of gt.junctions) { let k = 0; for (let j = 0; j < J.conns.length; j++) k += J.occupied[j]; if (k >= 2 && g.nEdges[n].length >= 3) return { x: g.nx[n], z: g.nz[n], n: k }; }
        return null;
      }
      let best = null;
      for (const [, l] of gt.onSeg) {
        if (l.length < (scene === "straight" ? 4 : 3) || l[0].seg.kind !== "lane") continue;
        const seg = l[0].seg;
        if (scene === "straight") {
          if (!l.every((v) => v.v > 3)) continue;
          const gaps = []; for (let k = 0; k + 1 < l.length; k++) gaps.push(l[k + 1].s - l[k].s);
          const spread = Math.max(...gaps) / Math.min(...gaps);
          if (spread < 1.8 && (!best || l.length > best.n || (l.length === best.n && spread < best.spread))) { const m = l[l.length >> 1]; const p = gt.position(m); best = { x: p.x, z: p.z, n: l.length, spread, gaps: gaps.map((x) => +x.toFixed(1)) }; }
        } else {
          const node = seg.dir === 0 ? g.eB[seg.edge] : g.eA[seg.edge];
          if (g.nKind[node] !== "signal" || gt.green(node, seg.edge)) continue;
          const head = l[l.length - 1]; if (head.v > 0.05 || gt.laneLen(seg.edge) - head.s > 3) continue;
          let q = 0; for (let k = l.length - 1; k >= 0 && l[k].v < 0.05; k--) q++;
          if (q >= 3 && (!best || q > best.n)) { const p = gt.position(l[Math.max(0, l.length - 2)]); best = { x: p.x, z: p.z, n: q }; }
        }
      }
      return best && (scene !== "straight" || (best.n >= 4 && best.spread < 1.8)) ? best : null;
    };
    c.setSpeed?.(1);
    let hit = null;
    for (let i = 0; i < 2400 && !(hit = find()); i++) s.update(0.25);
    if (!hit) return null;
    c.setSpeed?.(0); c.setTimeOfDay(0.45); c.setOverlay("none"); c.cam.zoomBy((scene === "straight" ? 3 : 3.6) / c.cam.zoom); c.cam.target.set(hit.x / 32, 0, hit.z / 32); s.version++;
    return hit;
  }, scene);
  out[scene] = r;
  if (!r) continue;
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${prefix}-${scene}.png`, timeout: 240000 });
}
console.log(JSON.stringify({ out, errs: errs.slice(0, 3) }));
await browser.close();
