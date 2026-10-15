/**
 * tools/chunks.test.ts — V1.6 A2: chunk index unit tests.
 * add / remove / move / query on a 192 map, the small-map "all active" rule,
 * revision counters, and a 500-edit random run checked against a naive
 * full-map recount after every sync.
 */
import { setGridSize } from '../src/sim/mapsize';
import { World, emptyTile } from '../src/sim/grid';
import { ChunkIndex, CHUNK, isBare } from '../src/sim/chunks';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.log('FAIL ' + m); fail++; } else console.log('ok   ' + m); };

setGridSize(192);
const N = 192;
const tiles = Array.from({ length: N * N }, emptyTile);
const ch = new ChunkIndex(tiles, N);
ok(ch.side === 12 && ch.active.length === 0, 'empty 192 map: 12×12 chunks, none active');
// add
tiles[5 * N + 5].road = true; ch.sync(tiles); // chunk 0 is in the round-robin lap? use touch to be explicit next
tiles[100 * N + 150].zone = 'residential'; ch.touch(100 * N + 150); const r0 = ch.topoRev; ch.sync(tiles);
const cz = Math.floor(100 / CHUNK) * 12 + Math.floor(150 / CHUNK);
ok(ch.isActive(cz), 'add: touched zone tile activates its chunk');
ok(ch.topoRev > r0, 'add: topoRev bumped');
ok(ch.isActive(0), 'add: untouched road found by round-robin on the first sync (chunk 0)');
// query
const act = Array.from(ch.activeTilesSorted());
ok(act.includes(100 * N + 150) && act.every((v, k) => k === 0 || v > act[k - 1]), 'query: activeTilesSorted ascending and contains the tile');
let visited = 0; ch.forEachActive(() => visited++);
ok(visited === ch.active.length * CHUNK * CHUNK, 'query: forEachActive visits whole active chunks');
// move (remove here, add there in a neighbouring chunk — the watch ring catches it without touch)
tiles[100 * N + 150].zone = null; tiles[100 * N + 160].zone = 'commercial'; ch.sync(tiles);
ok(!ch.isActive(cz) && ch.isActive(Math.floor(100 / CHUNK) * 12 + Math.floor(160 / CHUNK)), 'move: old chunk inactive, neighbour chunk active');
// remove
tiles[100 * N + 160].zone = null; tiles[5 * N + 5].road = false; ch.touchAll(); ch.sync(tiles);
ok(ch.active.length === 0, 'remove: map empty again');
// bldg / garbage revisions
tiles[3 * N + 3].zone = 'residential'; ch.touch(3 * N + 3); ch.sync(tiles);
const b0 = ch.bldgRev, t0 = ch.topoRev, g0 = ch.garbageRev;
tiles[3 * N + 3].level = 2; ch.sync(tiles);
ok(ch.bldgRev > b0 && ch.topoRev === t0, 'level change bumps bldgRev only');
tiles[3 * N + 3].garbage = 7; ch.sync(tiles);
ok(ch.garbageRev > g0 && ch.garbageDirty.includes(3 * N + 3), 'garbage change bumps garbageRev and lists the tile');
ch.sync(tiles);
const r1 = [ch.topoRev, ch.bldgRev, ch.garbageRev].join();
ch.sync(tiles);
ok([ch.topoRev, ch.bldgRev, ch.garbageRev].join() === r1, 'no change: revisions stay put');

// random edits vs naive recount (touch every edit, like Simulation.apply does)
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
let bad = 0;
for (let k = 0; k < 500; k++) {
  const i = Math.floor(rnd() * N * N), t = tiles[i], r = rnd();
  if (r < 0.3) t.road = !t.road; else if (r < 0.5) t.zone = t.zone ? null : 'industrial'; else if (r < 0.6) t.structure = t.structure === 'none' ? 'park' : 'none';
  else if (r < 0.8) t.garbage = t.garbage ? 0 : 3; else t.farm = t.farm ? 0 : 1;
  ch.touch(i); ch.sync(tiles);
  const want = new Int32Array(ch.count.length);
  tiles.forEach((q, j) => { if (!isBare(q)) want[ch.chunkOf(j)]++; });
  if (want.some((v, c) => v !== ch.count[c])) bad++;
}
ok(bad === 0, `500 random edits: per-chunk counts match a naive recount (${bad} mismatches)`);

// small map: everything active
setGridSize(64);
const w = new World(undefined, 1);
ok(w.chunks.active.length === 16, '64 map: all 16 chunks treated as active');
if (fail) { console.log(`${fail} failures`); process.exit(1); } console.log('chunks: all ok');
