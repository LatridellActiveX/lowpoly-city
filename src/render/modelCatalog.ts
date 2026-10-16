/**
 * render/modelCatalog.ts — every building / vehicle model in the game, with a
 * title and a category, for the Model viewer (ui/modelViewer.ts).
 *
 * Nothing is built until `buildCatalog()` is called (the first time the viewer
 * opens), and each entry's THREE object is built lazily by `item.build()`.
 * The geometry comes from the same builders the renderer uses, so what the
 * viewer shows is what is placed in the city (minus instance tinting, so
 * houses use a fixed palette here).
 */
import * as THREE from 'three';
import { MODELS, merge, nuclearPlantModel, pumpStationModel } from './models';
import { buildDesigns, RES_DESIGNS } from './buildings';
import { VEHICLES } from './vehicles';
import { serviceModels } from './serviceModels';
import { bigCoalModel } from './coalModel';
import { bigOilModel } from './oilPlantModel';
import { constructionYardModel, nacelleModel, farmModel, foodPlantModel, newIndustryModels, oilRigModel, roleModels } from './industryModels';
import { officeModels } from './officeModels';
import { commerceModels, homeModels, industryExtra, PRESKINNED, FACTORY_SKINS } from './cityModels';
import { combineHarvester, tractorPlough, tractorSeeder, tractorSprayer } from './farmVehicles';
import { HEAVY_SKINS } from './heavyIndustry';
import { ringIslandModel } from './roundaboutModel';
import { autoSkinMap, industrialMaterial, texturedHome, texturedShop } from './textures';
import { SERVICE_DEFS } from '../sim/services';

export interface CatalogItem {
  cat: string;
  title: string;
  /** Builds the displayable object (called lazily, once). */
  build: () => THREE.Object3D;
}

/** Category display order. */
export const CATEGORIES = ['Homes', 'Apartments & towers', 'Shops & offices', 'Industry', 'Resources & farms', 'Power & water', 'Services', 'Vehicles', 'Roads'] as const;

let solidMat: THREE.MeshLambertMaterial | null = null;
const solid = () => (solidMat ??= new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
const mesh = (g: THREE.BufferGeometry, m: THREE.Material = solid()) => new THREE.Mesh(g, m);
const plain = (g: THREE.BufferGeometry) => mesh(g);
const textured = (g: THREE.BufferGeometry) => mesh(autoSkinMap(g, HEAVY_SKINS), industrialMaterial());
const WALLS = [0xe9dfc9, 0xd9b99b, 0xc9d3dc, 0xe8c6c0, 0xd8dcb8, 0xcdb8a0, 0xbfc8d6, 0xe4d6b0];
const ACCENTS = [0xb5543c, 0x4b6d8c, 0x6b7f4a, 0x8a4f6a, 0x3f7f8a, 0x9a6a3a, 0x5a5f8a, 0x7a4a3a];
const pretty = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const LABEL: Record<string, string> = {
  law: 'Law firm', cable: 'Cable company', isp: 'Internet company', data: 'Data center', cell: 'Cell tower', radio: 'Radio station',
  chemical: 'Chemical plant', steel: 'Steel mill', textile: 'Textile mill', bottling: 'Bottling plant', assembly: 'Assembly plant', warehouse: 'Warehouse / distribution centre',
  villa: 'Hacienda', terrace: 'Terraced townhouses', modern: 'Modern house', gardentowers: 'Garden towers', skyresidence: 'Sky residence',
  supermarket: 'Supermarket', petrol: 'Petrol station', pharmacy: 'Pharmacy & clinic', hotel: 'Hotel', cinema: 'Multiplex cinema', department: 'Department store',
  outlet: 'Outlet mall', officetower: 'Office tower', bizpark: 'Business park',
  brewery: 'Brewery', pharma: 'Pharmaceutical lab', clothing: 'Clothing factory', coldstore: 'Cold storage', indpark: 'Industrial park', megafactory: 'Mega-factory',
  bakery: 'Bakery', bookstore: 'Bookstore', toystore: 'Toy store', gardencentre: 'Garden centre', restaurant: 'Restaurant', bank: 'Bank', cardealer: 'Car dealership', gym: 'Gym & pool', laundromat: 'Laundromat', vetclinic: 'Vet clinic', printworks: 'Print works', toyfactory: 'Toy factory',
  logging: 'Logging camp', oilRig: 'Oil rig', quarry: 'Quarry', lumberMill: 'Lumber mill', refinery: 'Refinery', materials: 'Building-materials plant', furniture: 'Furniture factory', electronics: 'Electronics plant',
};

export function buildCatalog(): CatalogItem[] {
  const out: CatalogItem[] = [];
  const add = (cat: string, title: string, build: () => THREE.Object3D) => out.push({ cat, title, build });

  // ---- Zone designs (the generic houses / shops / factories, by level) ----
  const designs = buildDesigns('high');
  const stack = (zone: 'residential' | 'commercial' | 'industrial', k: number, lv: number) => () => {
    const p = designs[zone][k][lv];
    const g = new THREE.Group();
    if (zone === 'industrial') {
      for (const w of ['walls', 'accent', 'fixed'] as const) g.add(textured(p[w].clone()));
    } else if (zone === 'commercial') {
      const q = { walls: p.walls.clone(), accent: p.accent.clone(), fixed: p.fixed.clone() };
      texturedShop(q, k);
      for (const w of ['walls', 'accent', 'fixed'] as const) g.add(mesh(q[w], w === 'fixed' ? industrialMaterial() : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: industrialMaterial().map, color: WALLS[k % WALLS.length] })));
    } else if (zone === 'residential' && lv < 3) {
      const q = { walls: p.walls.clone(), accent: p.accent.clone(), fixed: p.fixed.clone() };
      texturedHome(q, k);
      for (const w of ['walls', 'accent', 'fixed'] as const) g.add(mesh(q[w], w === 'fixed' ? industrialMaterial() : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: industrialMaterial().map, color: w === 'walls' ? WALLS[k % WALLS.length] : ACCENTS[k % ACCENTS.length] })));
    } else {
      g.add(mesh(p.walls, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: WALLS[k % WALLS.length] })));
      g.add(mesh(p.accent, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: ACCENTS[k % ACCENTS.length] })));
      g.add(plain(p.fixed));
    }
    return g;
  };
  for (let k = 0; k < RES_DESIGNS; k++) for (const lv of [0, 1, 2]) add('Homes', `House ${String.fromCharCode(65 + k)} · level ${lv + 1}`, stack('residential', k, lv));
  const homes = homeModels();
  for (const [key, g] of Object.entries(homes)) if (key !== 'gardentowers' && key !== 'skyresidence') add('Homes', LABEL[key] ?? pretty(key), () => (key === 'terrace' ? mesh(g, industrialMaterial()) : plain(g)));
  for (let k = 0; k < RES_DESIGNS; k++) for (const lv of [3, 4, 5, 6]) add('Apartments & towers', `Block ${String.fromCharCode(65 + k)} · level ${lv + 1}`, stack('residential', k, lv));
  for (const key of ['gardentowers', 'skyresidence']) add('Apartments & towers', LABEL[key], () => plain(homes[key]));
  for (let k = 0; k < designs.commercial.length; k++) for (const lv of [0, 1, 2]) add('Shops & offices', `Shop ${String.fromCharCode(65 + k)} · level ${lv + 1}`, stack('commercial', k, lv));
  for (const [key, g] of Object.entries(commerceModels())) add('Shops & offices', LABEL[key] ?? pretty(key), () => mesh(g, industrialMaterial()));
  for (const [key, g] of Object.entries(officeModels())) add('Shops & offices', LABEL[key] ?? pretty(key), () => plain(g));
  for (let k = 0; k < designs.industrial.length; k++) for (const lv of [0, 1, 2, 3, 4]) add('Industry', `Factory ${String.fromCharCode(65 + k)} · level ${lv + 1}`, stack('industrial', k, lv));
  for (const [key, g] of Object.entries(newIndustryModels())) add('Industry', LABEL[key] ?? pretty(key), () => textured(g));
  for (const [key, g] of Object.entries(industryExtra())) add('Industry', LABEL[key] ?? pretty(key), () => (PRESKINNED.has(key) ? mesh(g, industrialMaterial()) : mesh(autoSkinMap(g, FACTORY_SKINS), industrialMaterial())));

  // ---- Resources, farms, processors ----
  add('Resources & farms', 'Farm', () => textured(farmModel()));
  for (let k = 0; k < 3; k++) add('Resources & farms', `Food processing plant ${String.fromCharCode(65 + k)}`, () => textured(foodPlantModel(k)));
  add('Resources & farms', 'Tractor with plough', () => plain(tractorPlough()));
  add('Resources & farms', 'Tractor with seed drill', () => plain(tractorSeeder()));
  add('Resources & farms', 'Tractor with crop sprayer', () => plain(tractorSprayer()));
  add('Resources & farms', 'Combine harvester', () => plain(combineHarvester()));
  add('Resources & farms', 'Construction yard', () => textured(constructionYardModel()));
  add('Resources & farms', 'Oil rig', () => textured(oilRigModel()));
  for (const [key, g] of Object.entries(roleModels())) if (key !== 'oilRig') add('Resources & farms', LABEL[key] ?? pretty(key), () => textured(g));

  // ---- Power & water ----
  add('Power & water', 'Coal power plant', () => { const m = bigCoalModel(true); const g = new THREE.Group(); g.add(textured(m.solid)); return g; });
  add('Power & water', 'Oil power plant', () => { const m = bigOilModel(true); const g = new THREE.Group(); g.add(textured(m.solid)); return g; });
  add('Power & water', 'Small power plant', () => plain(MODELS.powerPlant()));
  add('Power & water', 'Small oil plant', () => plain(MODELS.oilPlant()));
  add('Power & water', 'Nuclear plant', () => plain(nuclearPlantModel()));
  add('Power & water', 'Wind turbine', () => {
    const g = new THREE.Group();
    g.add(plain(MODELS.windTower()));
    const nac = plain(nacelleModel()); nac.position.set(0, 1.26, 0); g.add(nac);
    const bl = plain(MODELS.windBlades()); bl.position.set(0, 1.26, -0.12); g.add(bl);
    return g;
  });
  add('Power & water', 'Water tower', () => plain(MODELS.waterTower()));
  add('Power & water', 'Large water tower', () => plain(MODELS.bigWaterTower()));
  add('Power & water', 'Pump station', () => plain(pumpStationModel()));

  // ---- Services ----
  const svc = serviceModels();
  const svcName = (i: number) => SERVICE_DEFS[i]?.label.replace(/ \(2×2\)/, '') ?? `Service ${i}`;
  for (const [key, g] of Object.entries(svc)) {
    let m = /^svc(\d)(s?)$/.exec(key);
    if (m) { add('Services', svcName(Number(m[1])) + (m[2] ? ' (variant)' : ''), () => plain(g)); continue; }
    m = /^svc0_(\d)$/.exec(key);
    if (m) { const st = Number(m[1]); if (st === 0 || st === 3 || st === 5) add('Services', `Landfill · ${st === 0 ? 'empty' : st === 3 ? 'half full' : 'full'}`, () => plain(g)); }
  }
  add('Services', 'Garbage truck body', () => plain(svc.garbageBody));
  add('Services', 'Ambulance body', () => plain(svc.ambulanceBody));

  // ---- Vehicles (tinted white bodies get a colour here) ----
  const tint = (g: THREE.BufferGeometry, c: number) => mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: c }));
  add('Vehicles', 'Car', () => { const g = new THREE.Group(); g.add(tint(VEHICLES.car(), 0xd9432f)); return g; });
  add('Vehicles', 'Truck cab', () => tint(VEHICLES.truckCab(), 0x2f6fb0));
  add('Vehicles', 'Box trailer', () => plain(VEHICLES.truckBox()));
  add('Vehicles', 'Tanker', () => plain(VEHICLES.tankerBody()));
  add('Vehicles', 'Dump truck body', () => plain(VEHICLES.dumpBody()));

  // ---- Roads ----
  add('Roads', 'Roundabout island', () => plain(ringIslandModel()));
  add('Roads', 'Road tile', () => plain(MODELS.road()));
  void merge;
  return out;
}
