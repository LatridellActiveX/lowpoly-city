// V1.6 B9 lint: no whole-map `tiles.forEach` in the per-tick sim. Whole-map
// walks are allowed only in one-off code (map generation, save migration)
// listed here with the reason; anything else must use chunks / indices.
import { readdirSync, readFileSync } from 'node:fs';
const ALLOW = {
  'save.ts': 'load-time migrations (once per load)',
  'mapgen.ts': 'new-map generation (once)',
  'terrain.ts': 'decoration scatter at new-map / v1 load (once)',
};
let bad = 0;
for (const f of readdirSync('src/sim')) {
  if (!f.endsWith('.ts') || ALLOW[f]) continue;
  readFileSync(`src/sim/${f}`, 'utf8').split('\n').forEach((l, i) => {
    if (l.includes('lint-allow')) return;
    if (/world\.tiles\.forEach|\btiles\.forEach\(\(t\b/.test(l)) { bad++; console.log(`src/sim/${f}:${i + 1}: ${l.trim()}`); }
  });
}
console.log(bad ? `lint:tiles ${bad} whole-map walks` : 'lint:tiles: all ok');
process.exit(bad ? 1 : 0);
