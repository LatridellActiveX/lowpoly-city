# Road graph (1.6)

`src/roads/graph.ts` holds roads as a graph: nodes (junctions, ends) and edges (cubic Bézier centrelines with a road type). Edges carry a length lookup table (LUT) and live in a 64 m spatial hash.

* **Placement** (`placeRoad`): snaps to nodes (8 m), edges (6 m), 15° angles and the 8 m grid. Crossings split edges. A dry run checks minimum length (16 m), junction angle (≥ 30°), curve radius, degree (≤ 6) and cut-piece lengths.
* **Cross-section:** lanes 6 m, shoulder 1.5 m, gutter 0.8 m, kerb 0.5 m, sidewalk 4 m; medians 0 / 2 / 3 m (street / avenue / highway). `roadHalf(type)` is the edge-to-property-line distance; zone setback is `max(16, roadHalf + 2)`.
* **Bridge to the sim** (`bridge.ts`): the sim still runs on 32 m tiles and 8 m cells. Graph roads are rasterised to road tiles (`rasterizeRoads`), and block zone codes are written to cells. Old saves are traced from tiles (`traceRoads`). Tile bulldozing removes the graph edges it cuts (`syncGraphToTiles`).
* **Traffic** (`gtraffic.ts`): lane connectors, conflict matrices, A* with an LRU cache, IDM following, and stop / signal / right-on-red / roundabout control. In 1.6 it drives the decorative cars on graph roads; the live trip simulation is still tile-based.
* **Utilities** (`utilities.ts`): union-find power and water on road edges plus lines and pipes. It is tested equal to the tile networks but not yet the live source.
* **Saving** (`persist.ts`): save v10 stores nodes, edges (in creation order) and the graph tiles. Blocks are regenerated on load.
