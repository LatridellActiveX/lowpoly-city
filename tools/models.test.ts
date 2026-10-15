// V1.6 models: template invariants, goods tables and cross-kind merging.
import { TEMPLATES, bodyRect, parkingSupply, parkingRequired } from '../src/sim/footprints';
import { CellRole } from '../src/sim/cells';
import { EXPORT_PRICE, GOOD_NAMES } from '../src/sim/goods';
import { RECIPES, ROLE_NAMES } from '../src/sim/chains';
import { mergeKind } from '../src/sim/growth';

let bad = 0;
const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('FAIL ' + m); } else console.log('ok   ' + m); };
const ids = new Set<string>();
const NEW = new Set(['hacienda', 'terrace', 'modern_house', 'garden_towers', 'sky_residence', 'supermarket', 'petrol_station', 'pharmacy', 'hotel', 'cinema', 'department_store', 'outlet_mall', 'office_tower', 'business_park', 'brewery', 'pharma_lab', 'clothing_factory', 'cold_store', 'industrial_park', 'mega_factory']);
for (const t of TEMPLATES) {
  ok(!ids.has(t.id), `unique id ${t.id}`); ids.add(t.id);
  ok(t.rects.every((r) => r.u >= 0 && r.v >= 0 && r.u + r.w <= t.w && r.v + r.d <= t.d), `${t.id}: rects inside ${t.w}x${t.d}`);
  ok(t.capacity.length === t.maxLevel && t.model.level.length === t.maxLevel, `${t.id}: per-level arrays match maxLevel`);
  if (NEW.has(t.id)) ok(t.rects.filter((r) => r.role === CellRole.Body).length === 1 && !!bodyRect(t), `${t.id}: one body`);
}
for (const id of ['hacienda', 'terrace', 'modern_house', 'garden_towers', 'sky_residence', 'supermarket', 'petrol_station', 'pharmacy', 'hotel', 'cinema', 'department_store', 'outlet_mall', 'office_tower', 'business_park', 'brewery', 'pharma_lab', 'clothing_factory', 'cold_store', 'industrial_park', 'mega_factory'])
  ok(TEMPLATES.some((t) => t.id === id), `template ${id}`);
for (const g of ['apparel', 'medicine', 'beverages'] as const) ok(!!GOOD_NAMES[g] && EXPORT_PRICE[g] > 0, `good ${g}`);
for (const r of ['tailor', 'pharma', 'brewery'] as const) ok(!!ROLE_NAMES[r] && !!RECIPES[r], `role ${r}`);
ok(mergeKind('commercial', 3) === mergeKind('commercial', 4) && mergeKind('commercial', 0) === mergeKind('commercial', 4), 'commercial kinds merge together');
ok(mergeKind('industrial', 2) === mergeKind('industrial', 0) && mergeKind('industrial', 1) !== mergeKind('industrial', 0), 'factories+food plants merge, farms do not');
void parkingSupply; void parkingRequired;
console.log(bad ? `${bad} FAILED` : 'ALL PASS');
(globalThis as any).process.exit(bad ? 1 : 0);
