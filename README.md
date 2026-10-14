# Low-Poly City

A browser-based isometric low-poly city builder built with **Vite + TypeScript + Three.js**.
Zone land, lay roads, run power and water networks, balance a budget, and watch
traffic, industry and the day/night cycle bring your city to life.

![City overview](docs/city-m6-overview.png)

## Run it locally

```bash
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # type-check + production build into dist/
```

## How to play
1. Lay a **Road**. Every building needs a road on one of its four sides.
2. Build a **Power Plant** (120 power) or **Wind Turbine** (15, varies with the wind) and drag **Power Lines** past where you'll build.
3. Build a **Water Tower** (80 water, needs power to pump) and drag **Pipes** past the same blocks.
4. Paint **Homes / Shops / Industry** zones beside the road. Lots grow into buildings over time once they have road + power + water.
5. Watch your 💵 cash. Everything costs money, bulldozing refunds 25%, and each month operating buildings pay taxes while plants, turbines and towers cost upkeep. Open **💰 Budget** to see the books and set tax rates (0–20%; higher taxes slow growth).
6. Watch the ⚡ and 💧 meters. If demand passes capacity, the furthest buildings go dark (outage) and get a warning gem.
7. Industry ships **goods by truck** to shops — keep the roads flowing or shelves go empty.
8. Cars drive the roads for real: signals, parking and congestion all matter.

## Controls
| Action | Mouse / keys | Touch |
|---|---|---|
| Use tool | Left-click / drag | One finger |
| Pan | Right or middle drag, WASD / arrows | Two fingers (or one finger with Inspect) |
| Zoom | Wheel, + / − | Pinch |
| Rotate 90° | Q / E | ⟲ ⟳ buttons |
| Pause | Space | ⏸ |
| Tools | I R 1 2 3 P N L T O X | toolbar |

## Features
- **Simulation:** zone growth, power/water networks with capacity outages, traffic with signals and parking, industrial goods, pollution & desirability, variable wind, economy with taxes and upkeep, save/load.
- **Presentation:** day/night cycle with lit windows and lamp glows, seasons-ready palette, procedural low-poly models, sound effects, population graphs, demand bars, game log and notifications.
- **Rendering:** every model is procedural — primitives merged into single vertex-colored geometries, drawn as instanced meshes with flat shading. Detail comes from procedural canvas textures (surface grain, grass, icon badges, light halos). No model files, no art pipeline.

## Code layout
```
src/sim/     the city as plain data + rules (no graphics) — grid, growth, networks,
             traffic, economy & goods, environment (wind, pollution), save
src/render/  Three.js drawing (reads the sim, never changes it) — cityRenderer,
             camera, scene, models, buildings, industryModels, roads, vehicles,
             nature, powerLines, dayNight, instancing
src/ui/      HTML toolbar/panels and input — hud, tools, input, graphs, gameLog,
             notifications, menu, demandBars
src/main.ts  wires the layers together and runs the game loop
src/audio/   procedural sound effects
```
Every file starts with a comment explaining its job; see the wiki for longer explanations.

## Version 1.5

Version 1.5 is being built on the `version-1.5` branch. So far it includes:

- **1.5-a graphics polish (folded in):** a procedural grass texture on the
  ground, a fine grain texture on the shared building material, and extra
  industry props. Both textures use the game's seeded RNG with fixed seeds, so
  they look identical on every reload and for every player.
- **WASD after returning to the tab:** camera keys work right away after you
  switch back to the game; no click needed.

## Roadmap
- ✅ **Milestones 1–2:** grid, isometric camera, placement tools, utilities, zone growth, save/load, building variety, terrain & trees, money and budget.
- ✅ **Traffic:** cars on real road graphs, traffic signals, parking, congestion.
- ✅ **Environment:** day/night cycle, variable wind, pollution & desirability, parks.
- ✅ **Economy:** industrial goods shipped by truck, construction system, progression.
- **Next:** see the wiki's upcoming-features page for proposed designs.
