/* ======================================================================
   CityTown.js — THE TOWN AROUND LEVEL 1'S MAIN STREET

   Fills CityLayout.js's plan: kit buildings (CityKit.js) on lots facing
   every street, a park beside the depot yard, street trees in the tree
   pits CityGround.js laid, and lamp posts along the back streets.

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
import { BOUNDS, ROWS, BACK_STREETS, PARK, lotBlocked } from './CityLayout.js';

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
      const d = 10 + rnd() * 8, z1 = top - d;
      if (lotBlocked(Math.min(x0, x1), Math.max(x0, x1), top, z1)) { top -= 3; continue; }
      const h = row.far ? 18 + rnd() * 30 : 14 + rnd() * 26;
      const reach = inReach(x0, x1, top, z1);
      buildKitBuilding(xc, (top + z1) / 2, row.depth, h, d, { face: row.face, collider: reach, far: !!row.far });
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
  plantStreetTrees(greenery, rnd);
  greenery.finish();
  buildLamps();
}
