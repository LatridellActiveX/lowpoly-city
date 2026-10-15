# Zone blocks (1.6)

`src/roads/blocks.ts`: every road edge side gets columns of 8 m cells, up to 16 rows deep (MAX_ROWS, to match the 1.5 4-tile zoning depth), starting at the road's setback.

* Curves become trapezoid cells. Convex sides are clamped; concave cells under 6 m or with crossed corners are dropped.
* Junction clearance per side. Overlaps are resolved deterministically on a 2 m mask (row, then road type rank, then edge age).
* `regenerate(graph)` is deterministic and carries zone codes / owners over by key or nearest centre (≤ 2 m); owners that lose every cell are reported in `lost`.
* `preview(...)` returns the cells a proposed road would add (the free-road tool's green/amber grid).
* Lots: `blockRuns` finds runs of free zoned columns. A run wider than 3 columns may not turn more than 10°. `lotFrame` faces the lot to the road.
