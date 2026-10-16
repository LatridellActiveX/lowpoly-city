/**
 * ui/modelViewer.ts — the MODEL VIEWER screen.
 *
 * A full-screen gallery of every building / vehicle model in the game
 * (render/modelCatalog.ts), grouped by category, each card with its title.
 * Hover a card to watch it spin, drag it to turn it by hand, click it to open
 * a big view (drag to rotate, wheel to zoom, Esc to close).
 *
 * One shared WebGLRenderer draws every card into that card's 2D canvas, so
 * there is only a single GL context however many models are shown. Thumbnails
 * are drawn in small batches per frame; after that only the card being
 * hovered / dragged is redrawn.
 */
import * as THREE from 'three';
import { buildCatalog, CatalogItem, CATEGORIES } from '../render/modelCatalog';

interface Card { item: CatalogItem; el: HTMLElement; canvas: HTMLCanvasElement; yaw: number; pitch: number; obj?: THREE.Object3D; frame?: { r: number; cy: number } }

const THUMB_W = 260, THUMB_H = 190;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class ModelViewer {
  readonly el = document.createElement('div');
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(32, THUMB_W / THUMB_H, 0.05, 100);
  private pivot = new THREE.Group();
  private cards: Card[] = [];
  private catalog: CatalogItem[] | null = null;
  private filter = 'All';
  private query = '';
  private queue: Card[] = [];
  private raf = 0;
  private hot: Card | null = null;
  private drag: { card: Card; x: number; y: number } | null = null;
  private big: { card: Card; zoom: number } | null = null;
  private bigCanvas: HTMLCanvasElement | null = null;

  constructor() {
    this.el.className = 'model-viewer hidden';
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.isOpen) return;
      if (this.big) this.closeBig(); else this.close();
    });
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6a7080, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    this.scene.add(sun, this.pivot);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5f7d4a }));
    ground.name = 'ground';
    this.scene.add(ground);
  }

  get isOpen(): boolean { return !this.el.classList.contains('hidden'); }

  open(): void {
    if (!this.catalog) this.catalog = buildCatalog();
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setClearColor(0x000000, 0);
    }
    this.el.classList.remove('hidden');
    this.layout();
  }

  close(): void {
    this.closeBig();
    this.el.classList.add('hidden');
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.queue = [];
  }

  private layout(): void {
    const cats = ['All', ...CATEGORIES];
    this.el.innerHTML = `<div class="mv-head">
        <h2>🏛 Model viewer</h2>
        <input class="mv-search" type="search" placeholder="Search models…" value="${esc(this.query)}">
        <button class="close" aria-label="Close">×</button>
      </div>
      <div class="mv-tabs">${cats.map((c) => `<button class="btn mv-tab${c === this.filter ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="mv-grid"></div>
      <div class="mv-hint muted small">Hover a model to spin it · drag to turn it · click for a big view</div>`;
    (this.el.querySelector('.close') as HTMLButtonElement).onclick = () => this.close();
    const search = this.el.querySelector('.mv-search') as HTMLInputElement;
    search.oninput = () => { this.query = search.value; this.fill(); };
    this.el.querySelectorAll<HTMLButtonElement>('.mv-tab').forEach((b) => (b.onclick = () => {
      this.filter = b.dataset.cat!;
      this.el.querySelectorAll('.mv-tab').forEach((t) => t.classList.toggle('active', t === b));
      this.fill();
    }));
    this.fill();
  }

  /** (Re)build the cards for the current category / search. */
  private fill(): void {
    const grid = this.el.querySelector('.mv-grid') as HTMLElement;
    grid.innerHTML = '';
    this.cards = [];
    this.queue = [];
    const q = this.query.trim().toLowerCase();
    const items = this.catalog!.filter((i) => (this.filter === 'All' || i.cat === this.filter) && (!q || i.title.toLowerCase().includes(q)));
    let lastCat = '';
    for (const item of items) {
      if (this.filter === 'All' && item.cat !== lastCat) {
        lastCat = item.cat;
        const h = document.createElement('h3');
        h.className = 'mv-cat';
        h.textContent = item.cat;
        grid.append(h);
      }
      const el = document.createElement('div');
      el.className = 'mv-card';
      el.innerHTML = `<canvas width="${THUMB_W}" height="${THUMB_H}"></canvas><div class="mv-title">${esc(item.title)}</div>${this.filter === 'All' ? '' : `<div class="mv-chip">${esc(item.cat)}</div>`}`;
      const card: Card = { item, el, canvas: el.querySelector('canvas')!, yaw: 0.6, pitch: 0.5 };
      this.wire(card);
      grid.append(el);
      this.cards.push(card);
    }
    if (!items.length) grid.innerHTML = '<div class="muted">No models match.</div>';
    this.queue = [...this.cards];
    this.kick();
  }

  private wire(card: Card): void {
    const { el, canvas } = card;
    el.onpointerenter = () => { this.hot = card; this.kick(); };
    el.onpointerleave = () => { if (this.hot === card) this.hot = null; };
    canvas.onpointerdown = (e) => { canvas.setPointerCapture(e.pointerId); this.drag = { card, x: e.clientX, y: e.clientY }; (card as Card & { moved?: number }).moved = 0; };
    canvas.onpointermove = (e) => {
      if (!this.drag || this.drag.card !== card) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      card.yaw += dx * 0.012; card.pitch = Math.max(0.1, Math.min(1.3, card.pitch + dy * 0.008));
      (card as Card & { moved?: number }).moved! += Math.abs(dx) + Math.abs(dy);
      this.drawCard(card);
    };
    canvas.onpointerup = () => {
      const moved = (card as Card & { moved?: number }).moved ?? 0;
      this.drag = null;
      if (moved < 5) this.openBig(card);
    };
  }

  private kick(): void { if (!this.raf && this.isOpen) this.raf = requestAnimationFrame(() => this.tick()); }

  private tick(): void {
    this.raf = 0;
    if (!this.isOpen) return;
    // Thumbnails: a few per frame so the screen stays responsive.
    for (let n = 0; n < 4 && this.queue.length; n++) this.drawCard(this.queue.shift()!);
    const spin = this.big?.card ?? this.hot;
    if (spin && !(this.drag && this.drag.card === spin)) { spin.yaw += 0.02; this.big ? this.drawBig() : this.drawCard(spin); }
    if (this.queue.length || spin) this.raf = requestAnimationFrame(() => this.tick());
  }

  /** Put the card's model on the stage, framed to fit. */
  private stage(card: Card, w: number, h: number, zoom = 1): void {
    if (!card.obj) {
      card.obj = card.item.build();
      const box = new THREE.Box3().setFromObject(card.obj);
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      card.obj.position.set(-c.x, -box.min.y, -c.z);
      card.frame = { r: Math.max(0.15, Math.hypot(s.x, s.z) / 2), cy: s.y / 2 };
      card.frame.r = Math.max(card.frame.r, s.y * 0.6);
    }
    this.pivot.clear();
    this.pivot.add(card.obj);
    this.pivot.rotation.y = card.yaw;
    const { r, cy } = card.frame!;
    const ground = this.scene.getObjectByName('ground')!;
    ground.scale.setScalar(r * 1.25);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    const d = (r * 2.3) / zoom / Math.tan((this.cam.fov * Math.PI) / 360) / 1.7;
    this.cam.position.set(0, cy + Math.sin(card.pitch) * d, Math.cos(card.pitch) * d);
    this.cam.lookAt(0, cy * 0.8, 0);
  }

  private drawCard(card: Card): void {
    if (!this.renderer) return;
    this.stage(card, card.canvas.width, card.canvas.height);
    this.renderer.setSize(card.canvas.width, card.canvas.height, false);
    this.renderer.render(this.scene, this.cam);
    const ctx = card.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, card.canvas.width, card.canvas.height);
    ctx.drawImage(this.renderer.domElement, 0, 0);
  }

  private openBig(card: Card): void {
    this.closeBig();
    this.big = { card, zoom: 1 };
    const wrap = document.createElement('div');
    wrap.className = 'mv-big';
    wrap.innerHTML = `<div class="mv-big-card panel"><button class="close" aria-label="Close">×</button><h3>${esc(card.item.title)} <span class="muted small">${esc(card.item.cat)}</span></h3><canvas width="760" height="520"></canvas><div class="muted small">Drag to rotate · wheel to zoom · Esc to close</div></div>`;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) this.closeBig(); });
    (wrap.querySelector('.close') as HTMLButtonElement).onclick = () => this.closeBig();
    const cv = wrap.querySelector('canvas') as HTMLCanvasElement;
    this.bigCanvas = cv;
    let down: { x: number; y: number } | null = null;
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); down = { x: e.clientX, y: e.clientY }; };
    cv.onpointerup = () => { down = null; };
    cv.onpointermove = (e) => {
      if (!down) return;
      card.yaw += (e.clientX - down.x) * 0.012; card.pitch = Math.max(0.1, Math.min(1.3, card.pitch + (e.clientY - down.y) * 0.008));
      down = { x: e.clientX, y: e.clientY };
      this.drawBig();
    };
    cv.onwheel = (e) => { e.preventDefault(); this.big!.zoom = Math.max(0.5, Math.min(3, this.big!.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); this.drawBig(); };
    this.el.append(wrap);
    this.drawBig();
    this.kick();
  }

  private drawBig(): void {
    if (!this.big || !this.bigCanvas || !this.renderer) return;
    const cv = this.bigCanvas;
    this.stage(this.big.card, cv.width, cv.height, this.big.zoom);
    this.renderer.setSize(cv.width, cv.height, false);
    this.renderer.render(this.scene, this.cam);
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(this.renderer.domElement, 0, 0);
  }

  private closeBig(): void {
    this.big = null;
    this.bigCanvas = null;
    this.el.querySelector('.mv-big')?.remove();
  }
}
