# Lowpoly City 1.6 — release notes

## New
* Big maps (128 / 192) with buyable regions.
* Freeform curved roads (tool `C`) with snapping, a zone-cell preview and undo/redo.
* Detailed road rendering: wide lanes with cars inside them, kerbs, sidewalks, crosswalks, stop lines, manholes and drains.
* Zoning along road blocks, curved ones included.
* Save v10. Older saves migrate automatically and their roads are drawn as graph roads.

## Under the hood
* Chunked, incremental, time-sliced sim; render chunk culling.
* Road graph, zone blocks, graph traffic and graph utilities, each with its own tests.
* A bridge architecture: graph roads and blocks rasterise onto the tile/cell grid the sim runs on.

## Balance
* `npm run balance` matches 1.5b exactly (pop 1,930, jobs 995, exports 369 at tick 8,000). The A4 time-slicing had moved factory-role refresh off the month phase, which raised the balance-town population to 2,330 and pegged industrial demand. It is back on phase 0.

## Known / deferred
* Live trips and utilities still run on tiles; graph traffic drives the decorative cars.
* B9 was partial: `lint:tiles` is in. Still to do: the `TerrainCell` rename, free-placed structures and chunk-raster overlays.
* New games keep tile roads until they are re-saved and loaded, or you draw free roads. Migrated saves draw every road through the graph.
* Buildings grow slowly on strongly curved blocks.
* Bench T1 / T3 are known and non-blocking (see the Performance page).
