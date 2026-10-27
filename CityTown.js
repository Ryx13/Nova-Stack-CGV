/* ======================================================================
   CityTown.js — THE TOWN AROUND LEVEL 1'S MAIN STREET

   Fills CityLayout.js's plan: kit buildings (CityKit.js) on lots facing
   every street, a park beside the depot yard, the city zoo off the west
   street, street trees in the tree pits CityGround.js laid, and lamp
   posts along the back streets.

   Lots within the playable area get colliders and camera blockers; the
   rest of the town, past the edge, is scenery only, and its far rows use
   CityKit's lighter detail and cast no shadows. The lamps: posts stand
   everywhere, but only the twenty listed in Level 1's config
   (state.liveStreetlights) are lit, spread across the town.
   Everything here uses its own RNG, never the shared rnd().
====================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, addStaticBox } from './Scene.js';
import { makeStreetlight } from './characters.js';
import { buildKitBuilding } from './CityKit.js';
import { treePits } from './CityGround.js';
import { BOUNDS, ROWS, BACK_STREETS, PARK, ZOO, FEATURE_LOTS, lotBlocked } from './CityLayout.js';

function seeded(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra });
const inReach = (x0, x1, z0, z1) => Math.min(x0, x1) < BOUNDS.x && Math.max(x0, x1) > -BOUNDS.x && Math.min(z0, z1) < BOUNDS.zN && Math.max(z0, z1) > BOUNDS.zS;

// Geometry collected per material, merged once at the end
class Batch {
  constructor() { this.parts = new Map(); }
  add(material, geo) { if (!this.parts.has(material)) this.parts.set(material, []); this.parts.get(material).push(geo.index ? geo.toNonIndexed() : geo); }
  finish(shadows = true) {
    for (const [material, geos] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), material);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
}

/* --- Buildings ------------------------------------------------------------ */
function buildRows(rnd) {
  for (const row of ROWS) {
    const x0 = row.facade, x1 = row.facade - row.face * row.depth;
    const xc = (x0 + x1) / 2;
    for (let top = row.z0; top > row.z1 + 6;) {
      // A long lot that runs into a road or open space is shortened to fit
      // before giving up on this spot, so the row packs up to each obstacle
      const d = [10 + rnd() * 8, 12, 9].find((len) => !lotBlocked(Math.min(x0, x1), Math.max(x0, x1), top, top - len));
      if (!d) { top -= 3; continue; }
      const z1 = top - d;
      const h = row.far ? 18 + rnd() * 30 : 14 + rnd() * 26;
      const reach = inReach(x0, x1, top, z1);
      const feature = FEATURE_LOTS.find((f) => !f.used && f.row === row.id && f.z <= top && f.z >= z1);
      if (feature) feature.used = true;
      buildKitBuilding(xc, (top + z1) / 2, row.depth, h, d, { face: row.face, collider: reach, far: !!row.far, shops: feature?.shops });
      top = z1 - (rnd() < 0.3 ? 1 + rnd() * 2 : 0);
    }
  }
}

/* --- Trees ---------------------------------------------------------------- */
const TRUNK = flat(0x6a4a32), LEAVES = [flat(0x4f7a3a), flat(0x5f8a40), flat(0x3f6a34)];
function tree(batch, rnd, x, z, scale = 1) {
  const h = (2.2 + rnd() * 0.8) * scale;
  batch.add(TRUNK, new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, h, 6).translate(x, h / 2, z));
  for (let i = 0; i < 3; i++) {
    const r = (0.9 + rnd() * 0.5) * scale;
    batch.add(LEAVES[(i + Math.floor(rnd() * 3)) % 3], new THREE.IcosahedronGeometry(r, 0)
      .rotateY(rnd() * 3).translate(x + (rnd() - 0.5) * 0.9 * scale, h + 0.3 * scale + i * 0.55 * scale, z + (rnd() - 0.5) * 0.9 * scale));
  }
  if (inReach(x, x, z, z)) addStaticBox(0.22 * scale, h / 2, 0.22 * scale, x, h / 2, z);
}
function plantStreetTrees(batch, rnd) {
  for (const pit of treePits) if (rnd() < (pit.far ? 0.45 : 0.7)) tree(batch, rnd, pit.x, pit.z, 0.9 + rnd() * 0.25);
}

/* --- The park ------------------------------------------------------------- */
function buildPark(batch, rnd) {
  const { x0, x1, z0, z1 } = PARK;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z0 - z1;
  const grass = flat(0x6a8f42), path = flat(0xc8c0ae), stone = flat(0xb0aa9c), water = flat(0x4a9ac8, { roughness: 0.15, metalness: 0.1, emissive: 0x0a2a40, emissiveIntensity: 1 });
  const hedge = flat(0x3f6a34), wood = flat(0x7a5a3a), iron = flat(0x2a2c2e), soil = flat(0x4a3a2c);
  batch.add(grass, new THREE.BoxGeometry(w, 0.08, d).translate(cx, 0.04, cz));
  for (const e of [-1, 1]) batch.add(stone, new THREE.BoxGeometry(w + 0.3, 0.2, 0.3).translate(cx, 0.1, cz + e * (d / 2 + 0.15)));
  batch.add(stone, new THREE.BoxGeometry(0.3, 0.2, d).translate(x0 - 0.15, 0.1, cz));
  // Paths: one across from the street, one along the park, a ring round the fountain
  batch.add(path, new THREE.BoxGeometry(w, 0.1, 2.6).translate(cx, 0.06, cz));
  batch.add(path, new THREE.BoxGeometry(2.6, 0.1, d).translate(cx, 0.061, cz));
  batch.add(path, new THREE.CylinderGeometry(6, 6, 0.1, 24).translate(cx, 0.062, cz));
  // The fountain
  batch.add(stone, new THREE.CylinderGeometry(3.4, 3.6, 0.7, 20).translate(cx, 0.35, cz));
  batch.add(water, new THREE.CylinderGeometry(3.05, 3.05, 0.1, 20).translate(cx, 0.62, cz));
  batch.add(stone, new THREE.CylinderGeometry(0.35, 0.5, 2.2, 10).translate(cx, 1.1, cz));
  batch.add(stone, new THREE.CylinderGeometry(1.2, 0.6, 0.35, 14).translate(cx, 2.3, cz));
  batch.add(water, new THREE.CylinderGeometry(1.0, 1.0, 0.08, 14).translate(cx, 2.48, cz));
  addStaticBox(3.4, 0.6, 3.4, cx, 0.6, cz);
  // Flower beds in the four lawns round the fountain
  const blooms = [0xe86a9a, 0xf2c84a, 0xd8453a, 0xf0ece4, 0x8a5ab8].map((c) => flat(c));
  for (const [ex, ez] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const bx = cx + ex * 8, bz = cz + ez * 9;
    batch.add(soil, new THREE.BoxGeometry(4, 0.14, 2.4).translate(bx, 0.07, bz));
    for (let i = 0; i < 14; i++) batch.add(blooms[i % blooms.length], new THREE.IcosahedronGeometry(0.22, 0).translate(bx + (rnd() - 0.5) * 3.6, 0.3, bz + (rnd() - 0.5) * 2));
  }
  // Hedges along the back and ends, the street side left open
  for (const e of [-1, 1]) {
    batch.add(hedge, new THREE.BoxGeometry(w - 4, 1.1, 0.9).translate(cx - 1, 0.6, cz + e * (d / 2 - 0.8)));
    addStaticBox((w - 4) / 2, 0.55, 0.45, cx - 1, 0.55, cz + e * (d / 2 - 0.8));
  }
  batch.add(hedge, new THREE.BoxGeometry(0.9, 1.1, d - 8).translate(x0 + 0.8, 0.6, cz));
  addStaticBox(0.45, 0.55, (d - 8) / 2, x0 + 0.8, 0.55, cz);
  // Benches facing the paths
  for (const [bx, bz, ry] of [[cx - 7, cz + 2, 0], [cx + 7, cz + 2, 0], [cx - 7, cz - 2, Math.PI], [cx + 7, cz - 2, Math.PI], [cx + 2, cz + 14, Math.PI / 2], [cx - 2, cz - 14, -Math.PI / 2]]) {
    const seat = new THREE.BoxGeometry(1.8, 0.08, 0.5).translate(0, 0.45, 0), back = new THREE.BoxGeometry(1.8, 0.5, 0.06).translate(0, 0.75, -0.24);
    for (const g of [seat, back]) batch.add(wood, g.rotateY(ry).translate(bx, 0, bz));
    for (const lx of [-0.75, 0.75]) batch.add(iron, new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(lx, 0.22, 0).rotateY(ry).translate(bx, 0, bz));
  }
  // Trees round the edge
  for (let i = 0; i < 14; i++) {
    const t = i / 14, onSide = i % 2;
    const tx = onSide ? x0 + 3 + rnd() * 2 : x0 + 4 + t * (w - 8);
    const tz = onSide ? z1 + 4 + t * (d - 8) : (i % 4 < 2 ? z0 - 3.5 : z1 + 3.5);
    tree(batch, rnd, tx, tz, 1.1 + rnd() * 0.3);
  }
}

/* --- The city zoo ----------------------------------------------------------
   Its gate opens onto the west street; past the first few metres it's out
   of reach, seen through the bars. The quake has broken the fence in two
   places, by the lions and the elephants: where the animals got out. */
function zooSign(text, bg = '#2f5a3a', fg = '#f4e9d6', w = 512, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = fg; g.font = `bold ${Math.round(h * 0.5)}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4, w - 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
}
function buildZoo(batch, rnd) {
  const { x0, x1, z0, z1, gateZ, gateW } = ZOO;
  const iron = flat(0x2a3a2e), stone = flat(0xb0a68e), sand = flat(0xc9b48a), grass = flat(0x6a8f42), rock = flat(0x8a8478);
  const water = flat(0x4a9ac8, { roughness: 0.15, emissive: 0x0a2a40, emissiveIntensity: 1 }), wood = flat(0x7a5a3a), path = flat(0xd8c8a4);
  // Ground: grass, with a sand path from the gate through the middle
  batch.add(grass, new THREE.BoxGeometry(x1 - x0, 0.06, z0 - z1).translate((x0 + x1) / 2, 0.02, (z0 + z1) / 2));
  batch.add(path, new THREE.BoxGeometry(x1 - x0 - 4, 0.08, 4).translate((x0 + x1) / 2 + 2, 0.04, gateZ));
  batch.add(path, new THREE.BoxGeometry(4, 0.08, z0 - z1 - 10).translate(-100, 0.041, (z0 + z1) / 2));

  // The fence: bars every half metre, top and bottom rails, two broken runs
  const broken = [{ x: -67, z: -112, len: 5 }, { x: -130, z: -172, len: 6 }]; // by the lions, by the elephants
  const bar = (x, z, lean) => batch.add(iron, new THREE.BoxGeometry(0.06, 2.6, 0.06).rotateZ(lean).rotateX(lean * 0.6).translate(x, 1.3, z));
  const run = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    for (let t = 0; t <= len; t += 0.5) {
      const x = ax + (bx - ax) * t / len, z = az + (bz - az) * t / len;
      const gap = broken.find((g) => Math.abs(x - g.x) < 0.5 && Math.abs(z - g.z) < g.len / 2);
      if (gap) { if (rnd() < 0.3) bar(x + (rnd() - 0.5), z, (rnd() - 0.5) * 1.4); continue; } // bent bars, the rest gone
      bar(x, z, 0);
    }
    for (const y of [0.25, 2.5]) batch.add(iron, new THREE.BoxGeometry(Math.abs(bx - ax) || 0.08, 0.08, Math.abs(bz - az) || 0.08).translate((ax + bx) / 2, y, (az + bz) / 2));
  };
  run(x1, z0, x1, gateZ + gateW / 2); run(x1, gateZ - gateW / 2, x1, z1);    // front, either side of the gate
  run(x0, z0, x1, z0); run(x0, z1, x1, z1); run(x0, z0, x0, z1);            // north, south, back
  // Only the front is in reach; it stops the player except at the gate and the gap
  addStaticBox(0.1, 1.3, (z0 - (gateZ + gateW / 2) - 3) / 2, x1, 1.3, (z0 + gateZ + gateW / 2) / 2 + 1.5);
  addStaticBox(0.1, 1.3, ((gateZ - gateW / 2) - z1) / 2, x1, 1.3, ((gateZ - gateW / 2) + z1) / 2);
  for (const z of [z0, z1]) addStaticBox((BOUNDS.x + x1) / 2, 1.3, 0.1, (x1 - BOUNDS.x) / 2, 1.3, z); // the strip from the fence to the world edge

  // The gate: two stone pillars, an arch beam and the sign, a ticket booth
  for (const e of [-1, 1]) {
    batch.add(stone, new THREE.BoxGeometry(1.4, 5.2, 1.4).translate(x1 - 0.2, 2.6, gateZ + e * (gateW / 2 + 0.7)));
    addStaticBox(0.7, 2.6, 0.7, x1 - 0.2, 2.6, gateZ + e * (gateW / 2 + 0.7));
  }
  batch.add(stone, new THREE.BoxGeometry(1.0, 1.2, gateW + 2.8).translate(x1 - 0.2, 5.6, gateZ));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(gateW + 1, 1.8), zooSign('CITY ZOO'));
  sign.position.set(x1 + 0.35, 5.6, gateZ);
  sign.rotation.y = Math.PI / 2; // facing the street (+x)
  scene.add(sign);
  batch.add(flat(0xd8c8a4), new THREE.BoxGeometry(2.4, 2.6, 2.4).translate(x1 - 4, 1.3, gateZ + gateW / 2 + 3));
  batch.add(flat(0x2f5a3a), new THREE.BoxGeometry(2.9, 0.3, 2.9).translate(x1 - 4, 2.75, gateZ + gateW / 2 + 3));
  batch.add(flat(0x2a3a48), new THREE.BoxGeometry(0.06, 0.9, 1.4).translate(x1 - 2.78, 1.6, gateZ + gateW / 2 + 3)); // booth window
  addStaticBox(1.2, 1.3, 1.2, x1 - 4, 1.3, gateZ + gateW / 2 + 3);
  for (let i = 0; i < 3; i++) batch.add(iron, new THREE.BoxGeometry(0.8, 1.0, 0.1).translate(x1 - 7, 0.5, gateZ - gateW / 2 + 1.5 + i * 2.5)); // turnstiles

  // Enclosures: a low wall each, what lives there, a sign on a post
  const enclosure = (ex0, ex1, ez0, ez1, ground, label) => {
    batch.add(ground, new THREE.BoxGeometry(ex1 - ex0, 0.08, ez0 - ez1).translate((ex0 + ex1) / 2, 0.05, (ez0 + ez1) / 2));
    for (const z of [ez0, ez1]) batch.add(stone, new THREE.BoxGeometry(ex1 - ex0, 1.0, 0.4).translate((ex0 + ex1) / 2, 0.5, z));
    for (const x of [ex0, ex1]) batch.add(stone, new THREE.BoxGeometry(0.4, 1.0, ez0 - ez1).translate(x, 0.5, (ez0 + ez1) / 2));
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), zooSign(label, '#5a3a1e', '#f4e9d6', 256, 80));
    board.position.set(ex1 + 0.6, 1.8, (ez0 + ez1) / 2);
    board.rotation.y = Math.PI / 2;
    scene.add(board);
    batch.add(wood, new THREE.BoxGeometry(0.12, 1.5, 0.12).translate(ex1 + 0.6, 0.75, (ez0 + ez1) / 2));
  };
  // Lions, by the broken front fence: a rock mound, a moat, a fallen tree
  enclosure(-104, -82, -100, -126, sand, 'LIONS');
  for (let i = 0; i < 7; i++) batch.add(rock, new THREE.IcosahedronGeometry(1.4 + rnd() * 1.6, 0).translate(-96 + rnd() * 8, 0.8, -116 + rnd() * 8));
  batch.add(water, new THREE.BoxGeometry(1.4, 0.1, 24).translate(-83.5, 0.08, -113));
  batch.add(wood, new THREE.CylinderGeometry(0.35, 0.45, 9, 7).rotateZ(Math.PI / 2).rotateY(0.6).translate(-90, 0.5, -105));
  // Elephants, by the broken back fence: sand, a pool, boulders
  enclosure(-128, -104, -150, -192, sand, 'ELEPHANTS');
  batch.add(water, new THREE.CylinderGeometry(5, 5, 0.12, 16).translate(-118, 0.09, -165));
  for (let i = 0; i < 5; i++) batch.add(rock, new THREE.IcosahedronGeometry(1 + rnd(), 0).translate(-124 + rnd() * 16, 0.6, -186 + rnd() * 10));
  // Giraffes: flat-topped trees and a feeding platform up at head height
  enclosure(-128, -106, -100, -138, grass, 'GIRAFFES');
  for (let i = 0; i < 4; i++) {
    const tx = -124 + rnd() * 14, tz = -132 + rnd() * 28;
    batch.add(wood, new THREE.CylinderGeometry(0.25, 0.35, 5, 6).translate(tx, 2.5, tz));
    batch.add(LEAVES[i % 3], new THREE.IcosahedronGeometry(2.4, 0).scale(1.3, 0.35, 1.3).translate(tx, 5.3, tz));
  }
  for (const [px, pz] of [[-108, -104], [-108, -108], [-112, -104], [-112, -108]]) batch.add(wood, new THREE.BoxGeometry(0.2, 4.2, 0.2).translate(px, 2.1, pz));
  batch.add(wood, new THREE.BoxGeometry(4.6, 0.25, 4.6).translate(-110, 4.3, -106));
  // Penguins, near the gate: a blue pool and white rocks
  enclosure(-90, -72, -146, -160, stone, 'PENGUINS');
  batch.add(water, new THREE.BoxGeometry(14, 0.12, 9).translate(-81, 0.09, -153));
  for (let i = 0; i < 4; i++) batch.add(flat(0xf0ece4), new THREE.IcosahedronGeometry(0.8 + rnd() * 0.5, 0).translate(-87 + rnd() * 12, 0.4, -158 + rnd() * 3));
  // The aviary: a netted dome
  const net = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(9, 1)), new THREE.LineBasicMaterial({ color: 0x2a3a2e }));
  net.position.set(-92, 3, -182);
  net.scale.y = 0.8;
  scene.add(net);
  batch.add(stone, new THREE.CylinderGeometry(8.6, 8.8, 0.6, 20).translate(-92, 0.3, -182));
  // The monkey house: a green-roofed hall and a climbing frame
  batch.add(flat(0xd8c8a4), new THREE.BoxGeometry(10, 5, 8).translate(-122, 2.5, -143));
  batch.add(flat(0x2f5a3a), new THREE.BoxGeometry(11, 0.5, 9).translate(-122, 5.25, -143));
  for (let i = 0; i < 4; i++) batch.add(wood, new THREE.BoxGeometry(0.2, 5, 0.2).translate(-115 + (i % 2) * 4, 2.5, -146 + (i >> 1) * 4));
  for (const y of [2.5, 4.5]) batch.add(wood, new THREE.BoxGeometry(4.2, 0.15, 4.2).translate(-113, y, -144));
  // A snack kiosk by the path, its cart tipped over and balloons still tied on
  batch.add(flat(0xf0ece4), new THREE.BoxGeometry(3, 2.6, 3).translate(-75, 1.3, -128));
  batch.add(flat(0xd8453a), new THREE.ConeGeometry(2.6, 1.1, 4).rotateY(Math.PI / 4).translate(-75, 3.15, -128));
  addStaticBox(1.5, 1.3, 1.5, -75, 1.3, -128);
  batch.add(flat(0xf2c84a), new THREE.BoxGeometry(1.4, 0.9, 0.8).rotateZ(1.3).translate(-73, 0.45, -134));
  for (const [c, dx, dz, hy] of [[0xd8453a, 0, 0, 3.2], [0x3a7ad8, 0.5, 0.3, 3.5], [0xf2c84a, -0.4, 0.4, 3.0]]) {
    batch.add(flat(c), new THREE.SphereGeometry(0.3, 8, 6).scale(1, 1.2, 1).translate(-73 + dx, hy, -134 + dz));
  }
  // Trees and benches along the path
  for (let i = 0; i < 10; i++) tree(batch, rnd, -76 - i * 5.2, gateZ + (i % 2 ? 4 : -4), 1 + rnd() * 0.3);
}

/* --- Lamps ---------------------------------------------------------------- */
// Back-street posts sit on the kerb away from the main street, so their
// arms (which always reach toward x = 0) hang over their own road. Their z
// values never match a main-street post's, so the lit list can't confuse them.
export const BACK_LAMP_Z = [33, 3, -27, -57, -87, -117, -147, -177, -207];
export const PARK_LAMPS = [[PARK.x0 + 6, -52], [PARK.x0 + 6, -86]];
function buildLamps() {
  for (const st of BACK_STREETS) {
    if (st.far) continue;
    const kerbX = st.x + Math.sign(st.x) * (st.halfW - 0.55);
    for (const z of BACK_LAMP_Z) makeStreetlight(kerbX, z);
  }
  for (const [x, z] of PARK_LAMPS) makeStreetlight(x, z);
}

/** Builds the town. Called at the end of loadBuildings() for a CityKit level. */
export function buildTown() {
  const rnd = seeded(0x70A1);
  buildRows(rnd);
  const greenery = new Batch();
  buildPark(greenery, rnd);
  buildZoo(greenery, rnd);
  plantStreetTrees(greenery, rnd);
  greenery.finish();
  buildLamps();
}
