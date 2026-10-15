# Version 1.6 plan: scalable simulation + freeform roads

Status: **PLAN ONLY**. Nothing here is implemented yet.
Branch: `1.6`, cut from `version-1.5` at 47ffdd8. No PRs, ever: work is pushed straight to `1.6`.

Contents:
- Workstream A: a simulation whose cost scales with buildings, not map area
- Workstream B: Cities: Skylines-style freeform roads with road-generated zoning
- Build order, test plan, risks and effort

**Recommendation: do Workstream A (sim efficiency) first.** Freeform roads replace the tile grid as the source of truth for roads and zoning. They need these A pieces to exist already:
- a chunked spatial index
- entity lists
- event-driven (dirty-flag) recompute

If B came first, every system would be rewritten twice: once for the graph and again for scale. A also makes a bigger map possible (the 1.5b "stage D" that was skipped). B then mostly plugs new producers (the road graph and zone blocks) into A's indexes.

---

## 0. Where we are (1.5b baseline, measured from the code)

### Per-tick work
`Simulation.step()` currently recomputes several things from scratch **every tick** over the whole grid (4,096 tiles):

| Call | What it does |
|---|---|
| `computeNetworks(w)` | power and water flood fill over every tile |
| `computeCoverage(w)` | a square stamp per service × radius² |
| `envWithServices(w)` | land value, pollution and desirability over every tile, several passes |
| `computeDemand()` | full tile scan |

On top of that:
- `growLots`, `parking.tick`, `goods.tick` (plus `serviceAnchors`, which scans all tiles), `garbage.tick`, `responders.tick` and `updateTier` each scan tiles or buildings.
- Monthly work (`bookMonth`, redevelopment, profits) runs in one tick, which causes a spike.
- 25 `tiles.forEach` / full-grid loops exist across the sim.

### Hard-coded grid size
- `GRID_SIZE = 64` and `CELL_GRID = 256`.
- The literal `64` appears in 18 files (sim, render, save, UI).

### Renderer
`cityRenderer` rebuilds **all** instanced pools from all tiles whenever `sim.version` changes. It does not chunk or cull, so its cost is O(map) per change.

### Resulting cost model
Tick cost ≈ a·tiles + b·buildings + c·vehicles, and the a·tiles term dominates on an empty map. A 192×192 map has 9× the tiles, so the same city would cost roughly 9× the network, coverage and environment work.

---

## Workstream A: sim cost scales with buildings, not area

### A.1 Goals and measurable targets
- **T1 (area independence):** the *same* city on a 192×192 map (otherwise empty land) costs within **±10%** of it on 64×64. Measured as mean tick time over 2,000 ticks, and as p95 tick time.
- **T2 (linear in buildings):** tick time grows about linearly with building count. Doubling the city costs at most 2.2× (target R² ≥ 0.95 on 5 city sizes).
- **T3 (no spikes):** month-boundary ticks have p99 ≤ 2× the median tick (no `bookMonth` spike).
- **T4 (allocation):** steady-state ticks allocate less than 50 KB/tick. Checked with `--expose-gc` heap deltas, or `performance.measureUserAgentSpecificMemory` in the browser.
- **T5 (absolute budget):** 1,000 buildings plus 600 vehicles must run at ≤ 4 ms/tick on the CI box (node, single thread). That keeps 3× speed at 60 fps with headroom.
- **T6 (render):**
  - A static camera with nothing changing rebuilds 0 pools per frame.
  - Placing one building rebuilds only that building's chunk (≤ 1 chunk plus its neighbours).
  - Draw calls stay bounded by visible chunks.

### A.2 Core data structures

#### World size
`World.size` (N) is set at runtime; there are no compile-time constants. All `64`/`256` literals are replaced by `world.N` and `world.CN`, enforced by a lint rule (`no-magic-grid`: a grep check in CI).

#### Chunks
- 16×16 tiles = 64×64 cells per chunk. A 192 map has 12×12 = 144 chunks; a 64 map has 4×4.
- `ChunkIndex`:
  - `chunkOf(i)` uses a shift: `(z>>4)*CW + (x>>4)`.
  - Each chunk keeps:
    - `buildings: Int32Array` (a dense list with a swap-remove index)
    - `structures` (plants, services, depots, yards)
    - `roads` (graph edges in B)
    - `dirty` bitflags: `NET | COV | ENV | RENDER | PARK`
- A global `activeChunks` bitset marks chunks with anything in them. All per-tick and per-month loops iterate active chunks, never tiles.

#### Entity lists (SoA, typed arrays)
- **`Buildings` store:** `id`, `host`, `tpl`, `level`, `construct`, `happy`, `health`, `res`, `jobs`, `stock`, `input` and `garbage` as parallel `Int32Array`/`Float32Array`s, growable by doubling, with a free-list. The existing `Building` objects become thin views or are kept only for save/UI during migration. Per-tile `res`/`jobs`/`stock`/`garbage` aggregates (today on `Tile`) move to the building store; tiles keep only what is truly per-tile (terrain, resource, owner).
- **`Structures` store:** plants, towers, pumps, services, depots and yards, each with kind, anchor, size, output and stock.
- **`Vehicles`:** a pooled SoA in traffic; new vehicles reuse slots (no `push`/`splice`, no closures per trip). The `onArrive` closures become `{kind, target}` records handled by a switch.

#### Spatial hash for queries
Each coverage producer registers in the chunks its radius touches. A query "which depots cover tile i" reads only the chunk's producer list: O(producers per chunk), not O(all anchors). This replaces `serviceAnchors()` (a full-grid scan every tick) and `depotOf`.

#### Rules for the tick loop
- No per-tick allocation: no `.map`, spread or closure in hot loops.
- Reuse scratch buffers (`Float32Array` pools on `Simulation`).
- Replace `sparePower = net.power.map(...)` with in-place arrays.

### A.3 Event-driven recompute (dirty flags)
An event bus on `World`:
- **Events:** `placed(i, kind)`, `removed(i)`, `levelChanged(bId)`, `zoneChanged(cellRect)`, `roadChanged(edge or tile)`, `structureChanged(i)`, `fuelStateChanged(i)`.
- **Subscribers** mark chunks dirty with the right bits.
- **Each system** keeps its last result and recomputes only on dirty input. Nothing is recomputed per tick unconditionally.

| System | Today | Plan |
|---|---|---|
| Power/water networks | flood fill all tiles every tick | **Incremental components.** Union-find over conduit adjacency, rebuilt only for affected components when a road, line or pipe changes. Additions merge components in O(α). Removals re-flood only the component that contained the removed piece, bounded by its size. Supply/demand per network is kept as running sums: building level changes add or subtract a delta, and a `wind` change updates only turbine output in O(turbines). |
| Service coverage | stamp every service every tick | Stamped **once when placed or removed**, into per-service `Float32Array` layers, chunk-local. Removal un-stamps (a subtract, clamped by recompute in that radius only). The edu layer is derived for the changed area only. |
| Land value / pollution / desirability | full passes per tick | **Producer-based kernels.** Pollution sources (industry, plants, roads with traffic) stamp a falloff kernel. Re-stamp on producer change, or every K ticks for traffic-weighted roads (time-sliced across chunks). LV is derived lazily per building when its health or growth is evaluated (`O(buildings)`), cached with a chunk version stamp. |
| Demand | full tile scan | **Running totals.** Residents, jobs by zone, educated workers and empty zoned cells (counted on `zoneChanged`) are updated by deltas. `computeDemand` becomes O(1) arithmetic. |
| Parking | per-lot per tick | Already lot-based. Index lots per chunk; `localBalance` queries neighbour chunks only. |
| Goods / shipping | scans tiles plus factories × plants (O(F·P) nearest searches) | Factory, shop and plant lists come from the building store. Nearest-X uses a chunk ring search (spiral out over chunks until found). Depot catchment comes from the spatial hash. |
| Garbage | tiles with garbage | Producers are buildings (store field). Dumps pick targets from an "over threshold" min-heap or bucketed list per chunk. |
| Crime / health | full-grid layers | Computed per building from coverage layers on read. Only buildings have crime; empty land never does. |
| Roles / chains | `tiles.forEach` every `ROLE_REFRESH` | Iterate the industrial building list. |
| Tier / stats | `stats()` scans tiles | Running totals. |

### A.4 Time-slicing
- **Monthly pass:** health, redevelopment, profits, taxes and densification are split into **slices** of active chunks. Over a 30-tick month, chunk k is processed on tick `k mod 30`. The books close on the last slice, using per-building values gathered across the month. Results are identical in aggregate, and each test asserts a deterministic order.
- **Growth checks:** each building is checked every `GROW_PERIOD` ticks, staggered by `id mod period`. This is already partly the case through `(b.id + w.tick) % n`; it becomes universal and uses a bucketed scheduler: `buckets[tick % P]` is the list of building ids due this tick. Checks become O(due) instead of O(all).
- **Traffic-weighted pollution and noise:** refreshed for one chunk per tick, round-robin.

### A.5 Worker thread option (later, behind a flag)
- **Shape:** the sim already lives in plain TS with no DOM. Run `Simulation` in a Web Worker; the main thread renders from a **snapshot** in SharedArrayBuffer (SoA arrays), or from a transferable diff of dirty chunks and vehicle poses.
- **Prerequisite:** A.2's SoA (otherwise structured-clone costs kill the gain).
- **Fallback:** without cross-origin isolation (COOP/COEP headers, needed for SAB), use `postMessage` of dirty-chunk diffs plus a vehicle pose `Float32Array` (transfer).
- **Decision gate:** only do this if main-thread tick time is still above 4 ms at the A.1 T5 city.

### A.6 Render chunking and culling
- **Pools per chunk:** each 16×16 chunk owns its instanced sub-ranges per model (or per chunk `InstancedMesh` for the heaviest pools). On `RENDER` dirty, rebuild only that chunk's instances.
- **Culling and LOD:**
  - Use frustum culling on chunk AABBs and set `mesh.visible` per chunk group.
  - LOD by chunk distance: high detail inside a radius, low outside, impostor or flat roofs at far zoom.
- **Static vs dynamic split:** terrain, roads and buildings are static per chunk. Vehicles, smoke, markers and lights are dynamic, with a single pool each, culled by chunk visibility.
- **Terrain:** one mesh per chunk, built once. Water is the same.
- **Budget:** draw calls ≈ visible chunks × used models. Add a merged-geometry "far chunk" mode if needed.

### A.7 Bigger map with unlockable regions (the 1.5b stage D)
Once A.2–A.6 land, map size is just data:
- **`world.N` ∈ {64, 128, 192}.** New games choose a size.
- **Regions:** the map is split into 64×64 **regions** (3×3 on a 192 map). The centre region is owned at start. Others can be purchased at population thresholds plus a price, via a Regions panel and an overlay.
- **Unowned regions:** they cannot be built on and are not simulated (their chunks are never active).
- **Old saves:** offset by (64, 64) into the centre region of a 192 map, or loaded as a 64 map if the player prefers.
- **Save v9:** `size`, `regionsOwned` bitmask, chunk-RLE-compressed cells (empty chunks cost nothing), and the SoA building store.

### A.8 Benchmarks (`tools/bench/`)
- **`bench-tick.ts`** (node, esbuild like the test suites). Scenarios:
  1. `empty64` and `empty192`: no city.
  2. `city64`: the standard grid town from `tools/balance.ts`, grown to a fixed tick using a fixed seed and a deterministic save fixture (`fixtures/city-1500.json`).
  3. `city192`: the same fixture loaded into the centre of a 192 map.
  4. Scale series: the fixture tiled 1×, 2×, 3×, 4× and 6× on a 192 map, to get building-count scaling (T2).
  5. `month`: tick timings across 10 month boundaries (T3).
- **Metrics:**
  - mean, p50, p95 and p99 ms/tick over 2,000 ticks after a 200-tick warm-up
  - heap delta per tick (T4)
  - a per-system breakdown from a lightweight `prof.begin('networks')`/`end` around each `step()` phase, compiled out unless `BENCH=1`
- **Output:** `bench/results/<git-sha>.json`, plus a markdown table.
- **`npm run bench`** runs it locally. **`npm run bench:check`** fails if T1 > 10%, T3 > 2×, or the regression versus the stored baseline is > 15%.
- **Render bench** (Playwright): frame time and draw calls, static camera versus pan, on city192.
- **Baseline first:** record 1.5b numbers before any change (Stage A0).

---

## Workstream B: freeform roads + road-generated zoning (CS-style)

### B.1 Road graph data model
- **Node:** `{ id, pos: vec2 (metres, float), elevation, kind: plain | signal | roundabout | stop, edges: edgeId[] (sorted by angle) }`
- **Edge:** `{ id, a: nodeId, b: nodeId, curve: cubic Bezier (p0, p1, p2, p3), type: street | avenue | highway | oneway, lanes, width, length (cached), samples: Float32Array (arc-length LUT, every ~2 m), zoneBlockL, zoneBlockR }`
- **Units:** 1 old tile = 32 m (CS-ish), so a 64-tile map = 2,048 m. Zone cells are **8 m** (= ¼ tile, matching today's 4×4 cells per tile, so cell art and templates carry over unchanged).
- **Storage:**
  - SoA arrays in a `RoadGraph`: `nodePos: Float32Array`, `edgeA/B: Int32Array`, `ctrl: Float32Array(8 per edge)`, …
  - A free-list for ids.
  - Edges are registered in the A.2 chunk hash by their AABB, for queries.
- **Constraints:**
  - Minimum edge length 16 m.
  - Minimum angle between edges at a node is 30°; below that the placement is rejected or merged.
  - Maximum curvature: radius ≥ 24 m for a street, ≥ 40 m for an avenue.
  - Maximum slope from terrain.
  - At most 6 edges per node.
- **Intersections:**
  - Placing a road that crosses an existing edge **splits** it at the intersection parameter t (de Casteljau split, which preserves exact shape) and creates a node.
  - A T-junction snaps to the existing edge (split) when within 6 m.
- **Snapping order:** existing node (≤ 8 m), then a point on an edge (≤ 6 m, perpendicular foot via LUT), then a guideline (extension or perpendicular of nearby edges, ±3°), then angle snap (15° steps, toggle), then grid snap (optional, 8 m).
- **Tools:**
  - straight
  - curved: 3 clicks; the middle click is the control point → quadratic, elevated to cubic
  - freeform: a continuous drag fitted with chained cubics
  - upgrade: change type in place
  - one-way flip
  - roundabout: a ring of 4–8 Bezier arcs plus yield nodes
  - bulldoze: removes the edge, then merges degree-2 nodes when the joined edges are collinear and the same type

### B.2 Zone-cell generation off roads
**Per edge side, a zone block:**
- Walk the arc-length LUT in 8 m steps along the edge, offset by `width/2`.
- For each step, emit up to **4 cells deep** (8 m each), along the local normal.
- A cell is a quad: two frontage points and two back points from the normal offset.
- On curves, cells are trapezoids. The convex side fans out, so cells are clamped where width > 10 m. The concave side shrinks, so cells with width < 6 m are dropped and deeper cells are trimmed when back corners cross (detected via normal-line intersection).
- **Storage:** `ZoneBlock { edgeId, side, n (columns), depth[n] (0..4), cell quads Float32Array, zone codes Uint8Array, owner Int32Array }`. This replaces the global `CELL_GRID` arrays as the source of truth.

**Conflict resolution (deterministic):**
1. **Rasterise** every candidate cell quad into a fine **validity mask** of 2 m sub-cells, per chunk, as a bitset.
2. **Road clearance:** cells overlapping any road footprint (edge polygons + node discs) are removed.
3. **Overlap with another block's cell:** the cell with the **shorter frontage distance** wins (it is closer to its own road). Ties go to the older edge id, which avoids churn when a new road is added. The loser's cell and everything deeper in that column are removed (columns must stay contiguous from the road).
4. **Intersections:**
   - Within `nodeRadius + 8 m` of a node, cells are cut back to the corner bisector between adjacent edges.
   - Corner lots get cells from the block whose edge type ranks higher (avenue > street). Ties go to the longer edge.
5. **Minimum usable size:** a column whose surviving depth is 0 is dropped. Isolated runs shorter than 2 columns are dropped. A run of 1 column is kept only as a filler (garden).
6. **Rebuild scope:** a road change invalidates blocks of that edge plus edges whose AABB overlaps, via the chunk hash. Only those are regenerated.
7. **Keeping existing zoning:** zone codes and building ownership survive regeneration. A cell that still exists (matched by `(edge, side, column, row)`, or by nearest centroid within 2 m after a split) keeps its code and owner. A building whose cells vanish is demolished (with a notice), same as bulldozing today.

**Splitting an edge** remaps its blocks to the two child edges by arc length, so ids change but cell identity is preserved through the centroid match.

**Zoning tool:** the player paints cells: brush, fill-along-road, or "fill block". The paintable set is the union of block cells. Zoning density/kind codes stay as in `cells.ts ZONE_CODES`.

### B.3 Buildings and lots on zone blocks
- A **lot** is a rectangle in **block-local (column, row) space**: `w` columns along the frontage by `d` rows deep. This is exactly today's template `w`/`d` in cells, so `footprints.ts` templates are reused unchanged.
- **Placement:** pick a column run with depth ≥ `d` on every column, and all cells zoned and free. The building's model transform comes from the block frame at the run's centre: position plus the tangent angle, so the building faces the road.
- **On curves:** the model is placed at the run's mid-frame. Footprints longer than about 3 columns are allowed only when local curvature over the run is under 10°, otherwise rejected. A wedge filler (garden) fills fan gaps on the convex side.
- **Depth:** frontage is on row 0. Parking, bay and garden roles map exactly as `TplRect` does now.
- **Merging** (growth/redevelop `mergeInto`): neighbouring lots on the **same block** merge across contiguous columns. Cross-block merges (corner lots) are not allowed in v1.6, which keeps it simple and deterministic.
- **What carries over:** densification, lot options, scoring and variety all work in block space. `lots.options` iterates blocks in the candidate chunk, not the whole grid.

### B.4 Traffic and pathfinding on the graph
**Lanes:**
- Each edge has `lanes` per direction (street 1, avenue 2, highway 3).
- A **lane graph** is derived per node as **connectors**: Bezier curves from incoming lane ends to outgoing lane starts, generated by turn type (right, straight, left, U-turn off). Avenue lane selection ("pick a lane for your turn", 1.5) becomes connector eligibility: a left turn uses the inner lane, and so on.

**Pathfinding:**
- A* on the **edge graph** (nodes = road nodes), cost = length / speed × congestion factor, using a binary heap with typed arrays and reused buffers.
- Paths are cached per (origin node, destination node) with LRU invalidation on graph change (per-component version).
- Vehicles hold `edgeIds[]` plus a lane index, with t ∈ [0, 1] along the edge LUT.

**Vehicle motion:**
- Position comes from the arc-length LUT, giving constant speed on curves.
- Car-following and gap rules from `traffic.ts` are ported to distance along the lane (same IDM-ish rules).

**Junction control** (all ported):
- Signals with phases per approach.
- **Right-on-red carry-over:** the 1.5b fix (a RoR vehicle yields only to traffic sharing its exit; it checks "no car with t < 0.9" on the exit lane) is expressed with connector conflict sets instead of tile directions.
- Roundabouts: yield-at-entry on ring nodes.
- Stop signs.

**Conflicts:** each node precomputes a connector-conflict matrix (pairs whose curves intersect, via sampled segment tests at build time). The holder logic (`inJunction`) checks conflicts in O(connectors).

**Connections:** buildings attach to the nearest edge point. Their driveway is the frontage cell's centre, projected onto the edge (t).

**Network-wide rule:** no global per-tick scans; vehicles and junction holders are per node. Spawning uses A.2 entity lists.

### B.5 Utilities
- **Water:** every road edge carries a water main (as in 1.5).
- **Power:** roads carry street power as in 1.5.
- **Explicit lines/pipes:** become freeform edges in a separate **utility graph** (same graph code, different type, no zoning) for crossing open land.
- **Networks:** connected components of the (road + utility) graph via A.3's incremental union-find. Plants and towers attach at the nearest edge point within 16 m.
- **Who is served:** a building is powered/watered if its block's edge is in a network with spare capacity. That is O(1) per building via the component id.
- **Coverage-style services** (police, schools, depots) keep radius-in-metres catchments through the A.2 spatial hash, measured from the building to the service. Optional later: road-distance catchments via a bounded Dijkstra.

### B.6 Rendering
- **Road mesh:** extrude each edge along its LUT using a cross-section profile: lanes, kerbs, sidewalks and median for avenues. UV v runs along arc length, so lane-marking textures tile correctly.
- **Intersections:** a node mesh built from the edge end-caps. It is a convex polygon fan with kerb returns, using arcs of radius 6 m between adjacent edge boundaries.
- **Decals:** crosswalks, stop lines and arrows are instanced quads aligned to node approaches. Roundabout markings are on the ring edges.
- **Per chunk:** road meshes are built per chunk (A.6), merged into one geometry per chunk per material. Only touched chunks rebuild.
- **Terrain:** the road footprint flattens terrain under the road (a stored heightfield edit) with an embankment blend.
- **Zoning preview grid** (while dragging):
  - Run B.2 generation on the *proposed* edge, plus conflict checks against existing blocks only near the proposal (the chunk hash).
  - Draw one `InstancedMesh` of unit quads (≤ 2,000 instances) with per-instance matrix and colour: green for new cells, amber for cells the proposal would clip or steal from neighbours, red for invalid (too steep or water).
  - Throttled to one regeneration per animation frame, with off-thread generation if needed.
  - Existing zone cells render as a per-chunk merged quad mesh with zone colours, only in zoning overlay mode.
- **Buildings:** same instanced models. Transforms come from block frames.

### B.7 Placement UX
- Ghost road follows the cursor, with snapping indicators (node ring, edge tick, guideline dashes) and a length/angle readout.
- Live cost, and red ghost plus reason text when invalid (angle < 30°, too short, curvature, slope, crossing a building: "will demolish 2 buildings", shown with a confirm on release).
- Keys:
  - tool modes: S straight, C curve, F freeform
  - R roundabout
  - G toggle grid snap, A toggle angle snap
  - Shift to disable snapping
  - Up/Down for elevation (bridges later)
- Zoning: brush size 1–4 cells, fill-to-depth, Ctrl to erase. A hover highlight shows which block a cell belongs to.
- Undo/redo stack for road and zoning operations. A snapshot diff of the touched chunks keeps it cheap.

### B.8 Save migration (grid → graph), save v10
**1. Roads:**
- Trace tile roads into polylines: each tile whose road neighbour count ≠ 2 is a node, and 2-neighbour chains form edges.
- Each straight run becomes one edge: tile centres × 32 m, with control points on the line (a degenerate cubic).
- 1.5 roundabouts become ring nodes. Avenues keep their type, and signals/RoR flags move to nodes.
- Bridges keep elevation.

**2. Zones:**
- Generate blocks from the migrated graph.
- Each new cell copies the zone code (and owner) of the old cell whose centre is nearest, within 4 m. For straight grid roads this is an exact 1:1 match (both are 8 m cells, 4 deep), so old cities migrate cell-for-cell.

**3. Buildings:**
- Each `Building` with cell rect (x0, z0, x1, z1) maps to the block that contains its frontage row, then to column run plus depth.
- If it does not fit exactly (an odd corner case at junction clearance), keep it as **legacy-anchored**: a world-space transform with no block. It works and is drawn, but cannot merge. Flag it in Inspect.

**4. Everything else:**
- Structures (plants, services, depots, yards) keep a world position at their tile centre × 32 m and a footprint in metres.
- Parking lots, farms and fields become polygons in world space, rasterised into the 2 m validity mask so roads avoid them.

**5. Verification:** a migration test loads the 1.5b fixture saves. It asserts:
- the same building count, population, jobs and road connectivity (all pairs of buildings that were connected stay connected)
- that 50 sampled A→B trips have path lengths within 5% of the grid version

### B.9 What happens to tile-based systems
- **Terrain, resources and water bodies:** stay as rasters (tile or sub-tile heightfields) for sampling only. They are no longer the gameplay grid.
- **`Tile` stops being the world model.** It shrinks to `TerrainCell { height, water, resource, deco }`. Gameplay state lives in the graph, zone blocks, the building store and structures.
- **Tile structures** (plants, services, yards, depots, parks, towers) become **free-placed structures** with a metre footprint. They snap to road frontage like buildings (frontage = nearest edge), and keep 1×1/2×2 equivalents of 32/64 m.
- **Overlays and environment layers:** become **2 m or 8 m rasters per active chunk** (only chunks with buildings allocate). Sampled per building.
- **Parking:** lots are cell-runs on blocks, as today. Public lots and garages become structures.
- **Fields (farms):** polygons on unzoned land behind farm blocks.
- **UI tools** that are "tile" tools become point-placement with footprint preview and rotation (R).

---

## Build order (stages), tests, effort

Effort is in focused agent-days (ideal days of implementation plus testing).

| # | Stage | Contents | Tests / exit criteria | Effort |
|---|---|---|---|---|
| A0 | Baseline benches | `tools/bench/*`, a deterministic fixture save, per-phase profiler, results JSON, `npm run bench`. Record 1.5b numbers (64 vs a "192 shim" via padded empty land). | Bench runs reproducibly (±3% run-to-run). Baseline committed. | 1 |
| A1 | De-hardcode N | `world.N`/`CN` everywhere, lint check for `64`/`256` literals, save keeps size. A 192 map works (slow but correct). | All 1.5b suites green at N=64. Same suites with a 192 empty-padded fixture equal the 64 results (sim determinism). | 2 |
| A2 | Chunks + entity lists | `ChunkIndex`, active chunks, building/structure SoA stores (with object facade), vehicle pool, no-alloc tick rules. | Suites green. T4 allocation target. Unit tests for the chunk index (add, remove, move, query). | 3 |
| A3 | Event bus + incremental systems | Dirty flags; incremental power/water (union-find + per-component re-flood); coverage stamping; running demand/stats totals; per-building LV/crime/health on read; spatial-hash catchments (services, depots, parking). | Suites green. **Equivalence tests:** after random edit sequences (500 ops), incremental results equal a from-scratch recompute (networks, coverage, demand), bit-for-bit or ≤ 1e-6. T1 on empty192 vs empty64. | 5 |
| A4 | Time-slicing | Bucketed growth scheduler, sliced monthly pass, round-robin traffic pollution. | Suites green (where suites assert monthly numbers, they assert aggregates, not per-tick). T3 month spike. Deterministic replay test. | 2 |
| A5 | Render chunking | Per-chunk pools/terrain, dirty-chunk rebuild, frustum culling, LOD by chunk. | Playwright render bench: T6. Screenshot diffs of 1.5b scenes within tolerance. | 3 |
| A6 | Big map + regions | Size choice, regions (purchase, overlay, unowned = inactive), save v9 (chunk-RLE), old saves to the centre. | **T1 (city192 vs city64 ±10%), T2, T5** in `bench:check` CI. Region purchase tests. v8 → v9 migration tests. | 3 |
| A7 | (optional) Worker | Sim in a worker, snapshot/diff protocol. | Same visuals. Input latency < 1 frame. Only if T5 is not met on the main thread. | 3 |
| B1 | Road graph core | Graph SoA, Bezier + LUT, split/merge, snapping, constraints, chunk registration. Headless only. | Unit tests: split preserves shape (max deviation < 1 cm), snapping priorities, angle/length rejection, degree limits, merge of collinear degree-2 nodes. Fuzz: 10k random placements stay valid. | 3 |
| B2 | Zone blocks | Generation, curve handling, conflict resolution, minimum sizes, stable regeneration with code/owner preservation. | Golden tests: straight road gives 4×n exact cells; T and + junctions; S-curve; parallel roads 48/64/80 m apart (no overlap, nearer road wins); roundabout. Property: no two cells overlap (2 m mask), no cell overlaps a road, columns contiguous. Regeneration after an unrelated edit leaves cells and owners unchanged. | 4 |
| B3 | Lots on blocks | Template placement in block space, curved-run rule, merging within block, densification/redevelop in block space. | Port the cells/industry/v15b-res suites to block worlds (a straight-road town must reproduce 1.5b numbers within tolerance). Curve town: buildings face the road, no overlaps. | 4 |
| B4 | Traffic on graph | Lane connectors, A* with cache, LUT motion, signals, RoR (conflict sets), roundabouts, stop signs. | Port the v15 traffic tests (RoR throughput ≥ 97% check, roundabout flow, lane choice). Path-length parity vs grid within 5%. Per-node conflict unit tests. Bench: 600 vehicles ≤ 1.5 ms/tick. | 5 |
| B5 | Utilities on graph | Road mains/power on edges, utility graph for lines/pipes, structure attachment, incremental components. | Equivalence: grid town vs migrated graph town have the same powered/watered sets. Pump/tower capacities unchanged. | 2 |
| B6 | Rendering | Edge extrusion, node meshes, decals, terrain flattening, zone cell meshes, preview grid instancing. | Screenshot set: straight/curve/junction/roundabout/avenue, day and night. Preview grid updates at ≥ 55 fps while dragging on a 192 map. | 4 |
| B7 | Placement UX | Tools, snapping visuals, readouts, invalid reasons, demolish confirm, zoning brushes, undo/redo. | Playwright flows: draw curve, snap T, split, undo; zoning brush. Manual checklist. | 3 |
| B8 | Save migration v10 | Grid to graph (roads, zones, buildings, structures, parking, fields), legacy-anchored fallback. | All 1.5b fixture saves load. Counts, population, jobs and connectivity are equal. Trips within 5%. Round trip v10 → v10 is lossless. | 3 |
| B9 | Retire tile gameplay | `Tile` becomes `TerrainCell`; free-placed structures; chunk rasters for overlays; remove dead grid code. | Full suite pass; benches still meet A targets; no `tiles.forEach` in the sim (lint). | 3 |
| R | Rebalance + docs | `npm run balance` on graph towns; README/wiki pages (Road graph, Zone blocks, Performance); release notes. | Balance table within 1.5b ranges; docs reviewed. | 2 |

**Total:** A0–A6 ≈ 19 days (+3 for the optional worker). B1–B9 ≈ 31 days. Plus R. **≈ 52 agent-days.**
**Ship points:**
- **1.6a** = A0–A6: big map plus regions and a fast sim, on the existing grid roads. Usable on its own.
- **1.6b** = B1–B8: freeform roads.
- **1.6c** = B9 + R.

### Test infrastructure changes
- **Fixtures:** `tools/fixtures/*.json`, saved 1.5b cities (small, medium, large), used by benches, migration tests and suite parity checks.
- **Equivalence harness:** `assertSameAsRecompute(sim)` runs the old full-grid implementation (kept in `tools/reference/` as an oracle until B9) against the incremental state after random ops.
- **Determinism test:** two runs with the same seed and inputs give identical state hashes at ticks 1k/5k (catches slicing/order bugs).
- **CI order:** typecheck, then suites, then `bench:check` (A6 onward), then Playwright screenshots (A5, B6).

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Incremental systems drift from truth (stale caches) | Wrong power, coverage or demand; subtle bugs | Equivalence oracle tests after random op sequences. Debug flag `SIM_VERIFY=1` recomputes every N ticks and asserts. |
| Removal in the union-find network (it cannot un-merge) | Slow re-floods on big networks | Re-flood only the affected component, bounded by its size. Batch edits per tick. Acceptable because removals are player actions, not per tick. |
| Time-slicing changes outcomes / test expectations | Suite churn | Slice by chunk with a deterministic order. Assert monthly aggregates. Keep a `slice=1` mode for tests that need exact old behaviour. |
| Bezier zoning edge cases (tight curves, near-parallel roads, roundabouts) | Gaps, overlaps, flicker | Min radius/angle constraints, a 2 m validity mask, deterministic tie-breaks, golden tests and fuzzing. |
| Save migration loses buildings at irregular junctions | Player frustration | Legacy-anchored fallback (nothing deleted), a migration report notice, and a backup of the original save kept (export already exists). |
| Traffic rewrite regresses RoR/roundabout throughput | Gridlock | Port the existing v15 throughput tests first (they are the spec). Compare against grid-version numbers on the migrated fixture. |
| Render rebuild cost on big edits (bulldozing a large area) | Frame hitch | Coalesce dirty chunks per frame. Rebuild at most K chunks per frame, carrying the rest to the next frame. |
| Scope creep (bridges, tunnels, elevation, highways ramps) | Schedule | Explicitly out of scope for 1.6 except flat bridges over water; elevation fields exist but stay 0. |
| Worker/SAB needs COOP/COEP headers on hosting | Deploy friction | Worker is optional (A7) with a `postMessage` diff fallback. Hosting header changes would need Parker's go-ahead and are not part of this plan. |
| Memory on 192 maps | Mobile/low-end browsers | Chunk-allocated rasters only for active chunks. RLE saves. Typed arrays. |

## Out of scope for 1.6
- Multi-level roads (bridges beyond flat water crossings, tunnels, highway ramps)
- Road-distance service catchments (later option)
- Cross-block lot merging
- Multiplayer
- Mod API

## Immediate next step
Start **A0**: benchmark harness, fixture saves and baseline numbers. Then A1.
