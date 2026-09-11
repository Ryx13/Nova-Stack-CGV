/* ======================================================================
   VENDING MACHINE — reusable "SAFEROOM SUPPLY" survival vending machine
   (Nova-Stack-CGV project root: VendingMachine.js)
   
   HOW TO USE IT (from any level module — Level1.js / Level2.js / Level3.js)
     import { VendingMachine } from './VendingMachine.js';
     import { saferoomSupplyCatalog } from './saferoomSupplyCatalog.js';

     const vending = new VendingMachine({
       scene,                                     // THREE.Scene to mount into
       position: new THREE.Vector3(13.05, 0, 27), // cabinet center, floor level
       rotationY: -Math.PI / 2,                   // cabinet front faces local +Z
       catalog: saferoomSupplyCatalog,             // omit for a blank machine, no stock
     });

     vending.update(dt);   // once per frame from the host's own loop
     vending.dispose();    // on teardown — frees every geometry/material

     // Host-side collision (the machine never touches physics itself):
     addStaticBox(VendingMachine.WIDTH / 2, VendingMachine.HEIGHT / 2,
                  VendingMachine.DEPTH / 2, position.x,
                  VendingMachine.HEIGHT / 2, position.z, rotationY);

   CUSTOMIZING PER LEVEL
   The `catalog` option is the only thing that changes per level or per
   machine. Write your own catalog object (shape below — or copy
   saferoomSupplyCatalog.js as a starting point) and pass it in — the
   cabinet, shaders, and layout never need to change. Each instance
   builds its own private copy of the catalog data, so two machines can
   use the same preset at different prices (as in a level with multiple
   machines) without interfering with each other. Leaving `catalog` out
   entirely gives a fully assembled, empty machine — correct chassis
   and display, zero stock — ready to import and populate.

   CATALOG SHAPE (what a supplies file exports)
     export const myLevelCatalog = {
       weapons:    [ product, ... ],   // max 5 slots
       throwables: [ product, ... ],   // max 3 slots
       support:    [ product, ... ],   // max 4 slots
       backpacks:  [ product, ... ],   // max 4 slots
     };
   Category keys are fixed cabinet layout — they cannot be renamed,
   reordered, added, or removed. Slot caps are NOT enforced: an
   over-full category renders cards past the shelf edge, so respect
   them by hand. Omitted keys are simply left empty. Each product:
     { id, itemId, name, category, price, stock, icon }
   `icon` is an HTMLCanvasElement from makeIcon() (exported below) or
   null for a lettered placeholder card.

   FILE LAYOUT (two files by design)
   - VendingMachine.js — this file: the cabinet, display, and the
     internal catalog structure + card renderer. Exports VendingMachine
     and makeIcon only.
   - saferoomSupplyCatalog.js — the example supplies preset (the
     products shown inside the machine); copy it per level. It imports
     makeIcon from this file.

   DEPENDENCIES: `three` and `three/addons/` (RoundedBoxGeometry for the
   bevelled panels) — both resolve through the host's import map. The
   module imports nothing else, and nothing from the host game.

   BUILD-STAGE STATUS: Stage 21 — host-driven catalog browsing and
   selection complete. The display redraws only when the host changes
   selection, highlighting one configured card and showing its current
   price/stock; idle mode is restored on cancel. Proximity gating,
   purchase validation, and dispensing are introduced in later stages.
   ====================================================================== */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ----------------------------------------------------------------------
   Catalog structure + card renderer — absorbed from the former
   catalog.js so the feature is exactly two files: this machine and
   the supplies preset. CATEGORY_DEFS, buildCategories(), and
   renderCard() are internal to the machine; makeIcon() is exported
   because catalog preset files call it to draw their product icons.
------------------------------------------------------------------------ */

/** Display categories in render order. `maxSlots` reserves visual space
    on the screen even when a catalog supplies fewer products — blank
    slots fill the remaining positions. This is fixed cabinet layout,
    not level data — it doesn't change per catalog. */
const CATEGORY_DEFS = [
  { id: 'weapons',    name: 'WEAPONS',    maxSlots: 5 },
  { id: 'throwables', name: 'THROWABLES', maxSlots: 3 },
  { id: 'support',    name: 'SUPPORT',    maxSlots: 4 },
  { id: 'backpacks',  name: 'BACKPACKS',  maxSlots: 4 },
];

/** Builds a fresh, independent categories array (CATEGORY_DEFS + this
    catalog's products) for one VendingMachine instance. Called once per
    instance so two machines with different catalogs — or the same
    catalog at different prices — never share mutable state.
    `catalog` is an object keyed by category id, e.g. { weapons: [...] }.
    Any key not present (or an entirely omitted `catalog` argument)
    yields an empty products array for that category, i.e. a blank
    machine. */
function buildCategories(catalog = {}) {
  return CATEGORY_DEFS.map((def) => ({
    ...def,
    products: catalog[def.id] ? catalog[def.id].slice() : [],
  }));
}

/** Product icon helper — creates an off-screen canvas for procedural
    icon art. A product's `icon` field holds the resulting canvas
    element, which renderCard() draws via drawImage(). Catalog preset
    files import this to build their own product icons. */
export function makeIcon(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

/** 2D product-card renderer — draws a single product card into the
    given CanvasRenderingContext2D rectangle (x, y, w, h), painting the
    slot background with the product's name, price, stock indicator,
    and icon. Intentionally stateless and pure: it draws into the
    provided context without modifying any catalog data. */
function renderCard(ctx, product, x, y, w, h) {
  const green  = '#a8ff70';
  const dim    = '#65ca70';
  const border = '#4fa85a';

  // Brighter card face keeps small in-world product art legible through glass.
  ctx.fillStyle = '#132617';
  ctx.fillRect(x, y, w, h);

  // Card border
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  // Icon area — use more of the card so the product reads at gameplay range.
  const iconH = h * 0.66;
  const iconCX = x + w / 2;
  const iconCY = y + iconH / 2;

  if (product.icon) {
    // Content-team-provided icon: draw centered, scaled to fit
    const maxW = w - 4;
    const maxH = iconH - 4;
    const scale = Math.min(maxW / product.icon.width, maxH / product.icon.height);
    const dw = product.icon.width * scale;
    const dh = product.icon.height * scale;
    ctx.drawImage(product.icon, iconCX - dw / 2, iconCY - dh / 2, dw, dh);
  } else {
    // Placeholder icon: dashed border + first letter of product name
    ctx.strokeStyle = dim;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x + 5, y + 5, w - 10, iconH - 10);
    ctx.setLineDash([]);
    ctx.fillStyle = dim;
    ctx.font = `bold ${Math.min(26, w * 0.35) | 0}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(product.name.charAt(0), iconCX, iconCY + 9);
  }

  // Product name
  ctx.fillStyle = green;
  const nameSize = Math.min(13, w * 0.14) | 0;
  ctx.font = `bold ${nameSize}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(product.name, x + w / 2, y + iconH + nameSize + 4, w - 4);

  // Price
  ctx.fillStyle = '#ccddcc';
  const priceSize = Math.min(15, w * 0.16) | 0;
  ctx.font = `bold ${priceSize}px "Courier New", monospace`;
  ctx.fillText('$' + product.price.toLocaleString(), x + w / 2, y + iconH + nameSize + priceSize + 10);

  // Stock indicator — green dot + count in bottom-right corner
  ctx.fillStyle = product.stock > 0 ? green : '#553333';
  ctx.beginPath();
  ctx.arc(x + w - 10, y + h - 10, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d9ffcf';
  ctx.font = '10px "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(String(product.stock), x + w - 16, y + h - 6);
}


const WIDTH  = 1.06;
const HEIGHT = 2.02;
const DEPTH  = 0.62;
// 1.6 — landmark scale: a ~3.2 m cabinet reads through fog and rain
// instead of vanishing into the street clutter. Host-side colliders
// are built from the scaled WIDTH/HEIGHT/DEPTH statics, so they grow
// with this automatically.
const SCALE = 1.6;

export class VendingMachine {
  static SCALE = SCALE;
  static WIDTH = WIDTH * SCALE;
  static HEIGHT = HEIGHT * SCALE;
  static DEPTH = DEPTH * SCALE;

  constructor({ scene, position = new THREE.Vector3(0, 0, 0), rotationY = 0, catalog } = {}) {
    if (!scene) throw new Error('VendingMachine: options.scene (THREE.Scene) is required');
    this.scene = scene;
    // Each instance owns its own categories array (built from the shared
    // CATEGORY_DEFS layout + this catalog's products). Nothing here is
    // shared module state, so sibling machines — even ones built from the
    // same catalog preset — never see each other's prices, stock, or
    // selection.
    this._categories = buildCategories(catalog);
    this._texs = [];
    this._cardMats = [];
    this._keyLabelMats = [];
    this._catalogCards = [];

    this.root = new THREE.Group();
    this.root.name = 'vendingMachine';
    this.root.position.copy(position);
    this.root.rotation.y = rotationY;
    this.root.scale.setScalar(SCALE);



    const bodyTex     = this._makeWeatheredTex('#343830', 0.8, 46);
    const frameTex    = this._makeWeatheredTex('#262a22', 0.5, 70);
    const interiorTex = this._makeWeatheredTex('#181a11', 0.25, 16);
    const doorTex     = this._makeWeatheredTex('#2e3128', 1.3, 50);
    const shelfTex    = this._makeWeatheredTex('#22251c', 0.4, 30);

    this._mats = {
      body:     new THREE.MeshStandardMaterial({ map: bodyTex,     metalness: 0.5,  roughness: 0.62 }),
      frame:    new THREE.MeshStandardMaterial({ map: frameTex,    metalness: 0.55, roughness: 0.58 }),
      interior: new THREE.MeshStandardMaterial({ map: interiorTex, metalness: 0.2,  roughness: 0.9 }),
      shelf:    new THREE.MeshStandardMaterial({ map: shelfTex,    metalness: 0.35, roughness: 0.65 }),
      door:     new THREE.MeshStandardMaterial({ map: doorTex,     metalness: 0.45, roughness: 0.6 }),
      glass:    new THREE.MeshStandardMaterial({ color: 0xaec6b4, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.14, depthWrite: false }),
      bezel:    new THREE.MeshStandardMaterial({ color: 0x14160f, metalness: 0.4,  roughness: 0.7 }),
      screen:   new THREE.MeshStandardMaterial({ color: 0x0b0d09, metalness: 0.2, roughness: 0.45 }),
      key:      new THREE.MeshStandardMaterial({ color: 0x232821, metalness: 0.2,  roughness: 0.7 }),
      bolt:     new THREE.MeshStandardMaterial({ color: 0x565b52, metalness: 0.85, roughness: 0.35 }),
      shelfTrim: new THREE.MeshStandardMaterial({ color: 0x1a3a1a, emissive: 0x33ff55, emissiveIntensity: 3.0 }),
      led:       new THREE.MeshStandardMaterial({ color: 0x115522, emissive: 0x33ff55, emissiveIntensity: 2.8 }),
      cardHighlight: new THREE.LineBasicMaterial({ color: 0xd9ff8a, toneMapped: false }),
    };

    this._buildChassis();
    this._buildFrontFrame();
    this._buildBays();
    this._buildColumnControls();
    this._buildDisplaySurface();
    this._buildCatalogCards();
    this._buildRetrievalCompartment();
    this._buildShelfLighting();
    this._buildStatusLEDs();
    this._buildMountPlate();

    scene.add(this.root);
  }


  update(dt) {}


  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((obj) => { if (obj.geometry) obj.geometry.dispose(); });
    Object.values(this._mats).forEach((m) => m.dispose());
    this._mats = {};
    this._cardMats.forEach((m) => m.dispose());
    this._cardMats = [];
    this._keyLabelMats.forEach((m) => m.dispose());
    this._keyLabelMats = [];
    this._texs.forEach((t) => t.dispose());
    this._texs = [];
    this._catalogCards = [];
    this._display = null;
  }




  _box(w, h, d, x, y, z, mat, bevel = 0) {
    const geo = bevel > 0
      ? new RoundedBoxGeometry(w, h, d, 2, bevel)
      : new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }


  _bolt(x, y, z, upFacing = false) {
    if (!this._boltGeo) this._boltGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.008, 6);
    const m = new THREE.Mesh(this._boltGeo, this._mats.bolt);
    if (!upFacing) m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    this.root.add(m);
    return m;
  }


  _makeWeatheredTex(base, rustAmount, scratches) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = `rgba(16,16,12,${(Math.random() * 0.16).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 24, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < 60 * rustAmount; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const r = 96 + Math.floor(Math.random() * 42), g = 50 + Math.floor(Math.random() * 22);
      ctx.fillStyle = `rgba(${r},${g},24,${(0.22 + Math.random() * 0.3).toFixed(3)})`;
      ctx.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 2);
      if (Math.random() < 0.3) {
        ctx.fillStyle = 'rgba(118,60,26,0.12)';
        ctx.fillRect(x, y, 2, 8 + Math.random() * 24);
      }
    }

    for (let i = 0; i < scratches; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const ang = Math.random() * Math.PI, len = 8 + Math.random() * 42;
      ctx.strokeStyle = Math.random() < 0.5
        ? `rgba(196,202,192,${(0.05 + Math.random() * 0.1).toFixed(3)})`
        : `rgba(8,8,6,${(0.1 + Math.random() * 0.16).toFixed(3)})`;
      ctx.lineWidth = 0.6 + Math.random();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    this._texs.push(tex);
    return tex;
  }




  _buildChassis() {
    const { body } = this._mats;
    this._box(1.06, 2.02, 0.04, 0, 1.01, -0.29, body, 0.012);
    this._box(0.04, 2.02, 0.56, -0.51, 1.01, -0.03, body, 0.012);
    this._box(0.04, 2.02, 0.56, 0.51, 1.01, -0.03, body, 0.012);
    this._box(1.06, 0.05, 0.56, 0, 1.995, -0.03, body, 0.012);
    this._box(1.06, 0.12, 0.56, 0, 0.06, -0.03, body, 0.015);
    this._box(0.05, 2.02, 0.56, 0.245, 1.01, -0.03, body);
  }


  _buildFrontFrame() {
    const { frame, glass } = this._mats;
    this._box(0.10, 2.02, 0.06, -0.48, 1.01, 0.28, frame, 0.012);
    this._box(0.06, 2.02, 0.06, 0.25, 1.01, 0.28, frame, 0.012);
    this._box(0.65, 0.07, 0.06, -0.105, 1.985, 0.28, frame, 0.012);
    this._box(0.65, 0.43, 0.06, -0.105, 0.335, 0.28, frame, 0.012);
    this._box(0.25, 1.30, 0.06, 0.405, 1.37, 0.28, frame, 0.012);


    this._box(0.015, 1.40, 0.016, -0.4225, 1.25, 0.258, frame);
    this._box(0.015, 1.40, 0.016, 0.2125, 1.25, 0.258, frame);
    this._box(0.65, 0.015, 0.016, -0.105, 0.5575, 0.258, frame);
    this._box(0.65, 0.015, 0.016, -0.105, 1.9425, 0.258, frame);


    const pane = this._box(0.66, 1.42, 0.006, -0.105, 1.25, 0.262, glass);
    pane.castShadow = false;
    pane.receiveShadow = false;


    [0.4, 0.9, 1.4, 1.9].forEach((y) => {
      this._bolt(-0.48, y, 0.313);
      this._bolt(0.25, y, 0.313);
    });
    [-0.35, -0.105, 0.14].forEach((x) => {
      this._bolt(x, 0.335, 0.313);
      this._bolt(x, 1.985, 0.313);
    });
    [[0.295, 0.75], [0.515, 0.75], [0.295, 1.96], [0.515, 1.96]]
      .forEach(([x, y]) => this._bolt(x, y, 0.313));
  }


  _buildBays() {
    const { shelf, interior } = this._mats;
    [0.55, 0.90, 1.25, 1.60, 1.95].forEach((y) => {
      this._box(0.71, 0.03, 0.51, -0.135, y, -0.015, shelf, 0.006);
    });
    [0.55, 0.90, 1.25, 1.60].forEach((y) => {
      this._box(0.71, 0.028, 0.012, -0.135, y + 0.014, 0.232, shelf);
    });
    this._box(0.71, 1.44, 0.02, -0.135, 1.25, -0.26, interior);
  }


  _buildCatalogCards() {
    const openingCenterX = -0.105;
    const openingWidth = 0.60;
    const rowCenters = [1.775, 1.425, 1.075, 0.725];
    const cardHeight = 0.31;
    const gap = 0.004;
    const cardZ = 0.244;

    this._categories.forEach((category, categoryIndex) => {
      const slotWidth = (openingWidth - gap * (category.maxSlots - 1)) / category.maxSlots;
      const cardWidth = slotWidth - 0.003;
      const firstX = openingCenterX - openingWidth / 2 + slotWidth / 2;

      category.products.forEach((product, productIndex) => {
        const canvas = document.createElement('canvas');
        canvas.width = 384;
        canvas.height = Math.round(canvas.width * cardHeight / cardWidth);
        renderCard(canvas.getContext('2d'), product, 0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        this._texs.push(texture);

        const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
        this._cardMats.push(material);
        const x = firstX + productIndex * (slotWidth + gap);
        const y = rowCenters[categoryIndex];
        const card = new THREE.Mesh(new THREE.PlaneGeometry(cardWidth, cardHeight), material);
        card.position.set(x, y, cardZ);
        this.root.add(card);

        const highlight = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(cardWidth + 0.012, cardHeight + 0.012)),
          this._mats.cardHighlight
        );
        highlight.position.set(x, y, cardZ + 0.002);
        highlight.visible = false;
        this.root.add(highlight);
        this._catalogCards.push({ categoryIndex, productIndex, highlight });
      });
    });
  }

  _syncCatalogCardSelection() {
    const selection = this._display?.selection;
    this._catalogCards.forEach((card) => {
      card.highlight.visible = selection?.categoryIndex === card.categoryIndex
        && selection.productIndex === card.productIndex;
    });
  }

  _addKeyLabel(label, x, y) {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#d9ff8a';
    ctx.font = `bold ${label === '✓' ? 82 : 76}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 3);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    this._texs.push(texture);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this._keyLabelMats.push(material);
    const labelPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.029, 0.047), material);
    labelPlane.position.set(x, y, 0.350);
    labelPlane.renderOrder = 1;
    this.root.add(labelPlane);
  }


  _buildDisplaySurface() {
    const W = 512, H = 1280;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._texs.push(tex);
    this._display = { W, H, ctx, tex, selection: null };

    const old = this._mats.screen;
    this._mats.screen = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: new THREE.Color(0x33ff55),
      emissiveIntensity: 1.6,
      metalness: 0.1,
      roughness: 0.5,
    });
    old.dispose();



    this.root.traverse((obj) => {
      if (obj.isMesh && obj.material === old) obj.material = this._mats.screen;
    });

    this._renderDisplay();


    const displayLight = new THREE.PointLight(0x33ff55, 1.0, 0.8, 2);
    displayLight.position.set(0.405, 1.71, 0.38);
    this.root.add(displayLight);
  }


  setSelection(categoryIndex, productIndex) {
    const category = this._categories[categoryIndex];
    const product = category?.products[productIndex];
    this._display.selection = product ? { categoryIndex, productIndex } : null;
    this._renderDisplay();
    this._syncCatalogCardSelection();
  }

  _renderDisplay() {
    const { W, H, ctx, tex, selection } = this._display;
    const g = '#33ff55';
    const dim = '#1a7a2e';
    const bg = '#080a06';
    const border = '#1a3a1a';


    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, 'rgba(20,40,20,0.2)');
    bgGrad.addColorStop(0.5, 'rgba(10,20,10,0.05)');
    bgGrad.addColorStop(1, 'rgba(20,40,20,0.15)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);


    ctx.textAlign = 'center';
    ctx.fillStyle = g;
    ctx.font = 'bold 46px "Courier New", monospace';
    ctx.fillText('SAFEROOM', W / 2, 70);
    ctx.fillText('SUPPLY', W / 2, 120);
    ctx.fillStyle = '#aaccaa';
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText('SURVIVE. ADAPT. ENDURE.', W / 2, 152);
    ctx.strokeStyle = g; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, 174); ctx.lineTo(W - 16, 174); ctx.stroke();


    const pad = 18, gap = 10;
    const catW = W - pad * 2;
    const usableH = H - 174 - 190;
    const catH = (usableH - gap * (this._categories.length - 1)) / this._categories.length;
    const slotH = catH - 44;

    this._categories.forEach((cat, ci) => {
      const cy = 188 + ci * (catH + gap);
      ctx.strokeStyle = dim; ctx.lineWidth = 1.5;
      ctx.strokeRect(pad, cy, catW, catH);
      ctx.fillStyle = dim;
      ctx.font = 'bold 15px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(cat.name, pad + 8, cy + 18);
      const slotPad = 10;
      const slotW = (catW - slotPad * 2 - (cat.maxSlots - 1) * 6) / cat.maxSlots;
      for (let si = 0; si < cat.maxSlots; si++) {
        const sx = pad + slotPad + si * (slotW + 6);
        const sy = cy + 30;
        ctx.strokeStyle = border; ctx.lineWidth = 1;
        ctx.strokeRect(sx, sy, slotW, slotH);
        ctx.fillStyle = 'rgba(14,22,14,0.6)';
        ctx.fillRect(sx, sy, slotW, slotH);
      }
    });


    this._categories.forEach((cat, ci) => {
      const cy = 188 + ci * (catH + gap);
      const slotPad = 10;
      const slotW = (catW - slotPad * 2 - (cat.maxSlots - 1) * 6) / cat.maxSlots;
      cat.products.forEach((product, si) => {
        if (si >= cat.maxSlots) return;
        const sx = pad + slotPad + si * (slotW + 6);
        const sy = cy + 30;
        renderCard(ctx, product, sx, sy, slotW, slotH);
        if (selection?.categoryIndex === ci && selection.productIndex === si) {
          ctx.fillStyle = 'rgba(217,255,138,0.13)';
          ctx.fillRect(sx + 2, sy + 2, slotW - 4, slotH - 4);
          ctx.strokeStyle = '#d9ff8a'; ctx.lineWidth = 4;
          ctx.strokeRect(sx + 2, sy + 2, slotW - 4, slotH - 4);
          ctx.fillStyle = '#d9ff8a';
          ctx.font = 'bold 10px "Courier New", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('SELECTED', sx + slotW / 2, sy + 13);
        }
      });
    });


    const crY = H - 175;
    ctx.strokeStyle = g; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, crY); ctx.lineTo(W - 16, crY); ctx.stroke();
    const selectedProduct = selection && this._categories[selection.categoryIndex]?.products[selection.productIndex];
    ctx.textAlign = 'center';
    if (selectedProduct) {
      ctx.fillStyle = '#aaccaa';
      ctx.font = 'bold 15px "Courier New", monospace';
      ctx.fillText('BROWSE MODE', W / 2, crY + 28);
      ctx.fillStyle = g;
      ctx.font = 'bold 24px "Courier New", monospace';
      ctx.fillText(selectedProduct.name, W / 2, crY + 68);
      ctx.fillStyle = '#ccddcc';
      ctx.font = 'bold 17px "Courier New", monospace';
      ctx.fillText(`PRICE $${selectedProduct.price.toLocaleString()}  •  STOCK ${selectedProduct.stock}`, W / 2, crY + 98);
      ctx.fillStyle = '#aaccaa';
      ctx.font = '11px "Courier New", monospace';
      ctx.fillText('← → ITEM   •   ↑ ↓ CATEGORY', W / 2, crY + 126);
      ctx.fillText('ESC CANCEL', W / 2, crY + 146);
    } else {
      ctx.fillStyle = '#aaccaa';
      ctx.font = '14px "Courier New", monospace';
      ctx.fillText('INSERT CREDITS', W / 2, crY + 32);
      ctx.fillStyle = g;
      ctx.font = 'bold 42px "Courier New", monospace';
      ctx.fillText('$ 0', W / 2, crY + 90);
      ctx.fillStyle = '#555';
      ctx.font = '11px "Courier New", monospace';
      ctx.fillText('NO REFUNDS  •  NO RETURNS', W / 2, crY + 122);
      ctx.fillText('PRESS E TO BROWSE', W / 2, crY + 140);
    }


    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    tex.needsUpdate = true;
  }


  _buildColumnControls() {
    const { bezel, screen, key } = this._mats;



    this._box(0.22, 0.44, 0.03, 0.405, 1.71, 0.325, bezel, 0.008);
    this._box(0.035, 0.44, 0.02, 0.3125, 1.71, 0.345, bezel);
    this._box(0.035, 0.44, 0.02, 0.4975, 1.71, 0.345, bezel);
    this._box(0.22, 0.035, 0.02, 0.405, 1.9125, 0.345, bezel);
    this._box(0.22, 0.035, 0.02, 0.405, 1.5075, 0.345, bezel);
    this._box(0.15, 0.37, 0.012, 0.405, 1.71, 0.341, screen);


    this._box(0.24, 0.006, 0.004, 0.405, 1.465, 0.312, screen);


    this._box(0.20, 0.10, 0.025, 0.405, 1.39, 0.3225, bezel, 0.006);
    this._box(0.14, 0.02, 0.014, 0.405, 1.39, 0.338, screen);
    this._bolt(0.319, 1.39, 0.339);
    this._bolt(0.491, 1.39, 0.339);


    this._box(0.15, 0.045, 0.018, 0.405, 1.285, 0.329, key, 0.004);



    this._box(0.20, 0.42, 0.025, 0.405, 1.02, 0.3225, bezel, 0.006);
    const keyGeo = new RoundedBoxGeometry(0.046, 0.068, 0.014, 1, 0.004);
    const keyXs = [0.3517, 0.405, 0.4583];
    const keyYs = [1.15125, 1.06375, 0.97625, 0.88875];
    const keyLabels = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['X', '0', '✓']];
    keyYs.forEach((y, row) => {
      keyXs.forEach((x, column) => {
        const k = new THREE.Mesh(keyGeo, key);
        k.position.set(x, y, 0.342);
        this.root.add(k);
        this._addKeyLabel(keyLabels[row][column], x, y);
      });
    });
    [[0.319, 0.828], [0.491, 0.828], [0.319, 1.212], [0.491, 1.212]]
      .forEach(([x, y]) => this._bolt(x, y, 0.339));
  }


  _buildRetrievalCompartment() {
    const { frame, door, interior, bolt } = this._mats;
    this._box(0.035, 0.44, 0.06, 0.2975, 0.50, 0.28, frame, 0.008);
    this._box(0.035, 0.44, 0.06, 0.5125, 0.50, 0.28, frame, 0.008);
    this._box(0.25, 0.04, 0.06, 0.405, 0.70, 0.28, frame, 0.008);
    this._box(0.25, 0.32, 0.06, 0.405, 0.16, 0.28, frame, 0.01);
    this._box(0.175, 0.35, 0.015, 0.405, 0.50, 0.252, door, 0.005);
    this._box(0.06, 0.016, 0.02, 0.405, 0.40, 0.268, bolt);
    this._box(0.018, 0.03, 0.012, 0.328, 0.42, 0.262, bolt);
    this._box(0.018, 0.03, 0.012, 0.328, 0.58, 0.262, bolt);

    this._box(0.24, 0.012, 0.26, 0.38, 0.336, 0.12, interior);
    this._box(0.24, 0.012, 0.26, 0.38, 0.684, 0.12, interior);
    this._box(0.24, 0.35, 0.012, 0.38, 0.51, 0.0, interior);
  }


  _buildShelfLighting() {
    const { shelfTrim } = this._mats;


    [0.725, 1.075, 1.425, 1.775].forEach((y) => {
      const light = new THREE.PointLight(0x33ff55, 2.5, 1.2, 2);
      light.position.set(-0.135, y, 0.05);
      this.root.add(light);
    });



    const trimGeo = new THREE.BoxGeometry(0.70, 0.007, 0.012);
    [0.55, 0.90, 1.25, 1.60].forEach((y) => {
      const trim = new THREE.Mesh(trimGeo, shelfTrim);
      trim.position.set(-0.135, y + 0.019, 0.228);
      this.root.add(trim);
    });
  }


  _buildStatusLEDs() {
    const { led } = this._mats;
    const ledGeo = new THREE.SphereGeometry(0.009, 8, 6);
    [[0.405, 1.935, 0.356], [0.405, 1.45, 0.342], [0.405, 1.235, 0.342]]
      .forEach(([x, y, z]) => {
        const l = new THREE.Mesh(ledGeo, led);
        l.position.set(x, y, z);
        this.root.add(l);
      });
  }


  _buildMountPlate() {
    this._box(1.0, 0.05, 0.07, 0, 2.045, -0.275, this._mats.frame, 0.01);
    this._bolt(-0.44, 2.078, -0.275, true);
    this._bolt(0.44, 2.078, -0.275, true);
  }
}
