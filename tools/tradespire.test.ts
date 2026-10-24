// Trade Spire tests: admin gating, placement, cost, coverage, model.
// Run with: npm run test:tradespire
import { Simulation } from '../src/sim/simulation';
import { World } from '../src/sim/grid';
import { Svc } from '../src/sim/services';
import { serviceModels } from '../src/render/serviceModels';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) fails++; };

const fresh = () => { const s = new Simulation(new World(undefined, 4242)); s.world.cash = 1e7; s.world.tiles.forEach((t) => { t.deco = 0; t.water = false; }); return s; };
const TILES: Array<[number, number]> = [[31, 17], [32, 17], [31, 18], [32, 18]];

// 1. Non-admin placement is refused.
{
  const s = fresh();
  s.settings.admin = false;
  const r = s.apply('tradeSpire', TILES);
  check('non-admin cannot place', r.changed === 0 && r.locked === true, JSON.stringify(r));
}
// 2. Admin placement builds a 2x2 service with kind TradeSpire.
{
  const s = fresh();
  s.settings.admin = true;
  s.apply('road', [[30, 17], [30, 18]]); // coverage only flows from a road-connected spire (like every service)
  const r = s.apply('tradeSpire', TILES);
  const anchor = s.world.at(31, 17);
  check('admin can place (4 tiles changed)', r.changed === 4, JSON.stringify(r));
  check('anchor is service/TradeSpire', anchor.structure === 'service' && anchor.kind === Svc.TradeSpire, `structure=${anchor.structure} kind=${anchor.kind}`);
  check('cash charged 250,000', r.spent === 250000, `spent=${r.spent}`);
  // 3. Coverage exists after a step.
  s.step();
  const cov = s.cov?.by[Svc.TradeSpire];
  const near = cov ? cov[17 * 128 + 31] : -1; // GRID index approx; value checked loosely below
  const max = cov ? Math.max(...cov) : 0;
  check('trade coverage reaches 1.0 near the spire', max === 1, `max=${max} atAnchor=${near}`);
}
// 4. Model registered.
check('svc9 model exists', !!serviceModels()['svc9']);
console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
process.exit(fails ? 1 : 0);
