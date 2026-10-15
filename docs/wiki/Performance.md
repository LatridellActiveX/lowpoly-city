# Performance (1.6)

`npm run bench:check` (SIZES=64,192). Latest (B9 run):

| Check | Target | Result |
|---|---|---|
| T2 cost scales with city size | R² ≥ 0.95, 2× city ≤ 2.2× | R² 0.994, ×1.64 — pass |
| T5 192 city mean tick | ≤ 4 ms | 2.6 ms — pass |
| T1 192/64 same-city ratio | ≤ 1.10 | 1.32 — **known, non-blocking** |
| T3 month-tick p99 | ≤ 2× p50 | ~2.2× on some runs — **known, non-blocking** |

Known issues:

* **T1:** the 192 bench town grows about 20% more population and keeps the highway-corridor chunks active, so it is not the same city as on the 64 map.
* **T3:** a noisy timing check. The R rebalance put factory-role refresh back on the month phase.

Neither blocks the build; speed is not a 1.6 goal. Free-road hover preview costs about 8 ms of JS per frame on the 192 bench town. Headless swiftshader renders the preview at about 4 fps, so judge fps on a real GPU.
