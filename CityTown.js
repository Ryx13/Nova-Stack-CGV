/* ======================================================================
   CityTown.js — THE TOWN AROUND A DISTRICT'S MAIN STREET

   Fills the district's plan (CityLayout.js layout()): kit buildings
   (CityKit.js) on lots facing every street, its parks, street trees in the
   tree pits CityGround.js laid, and lamp posts along the back streets.
   Downtown adds the city zoo; the harbour adds the waterfront (boardwalk,
   beaches, the lighthouse), sand blown onto its streets, and Harbour Walk,
   the lit glass bridge over the main street.

   Lots within the playable area get colliders and camera blockers; the
   rest of the town, past the edge, is scenery only, and its far rows use
   CityKit's lighter detail and cast no shadows. The lamps: posts stand
   everywhere, but only the ones listed in the level's config
   (state.liveStreetlights) are lit, spread across the town.
   Everything here uses its own RNG, never the shared rnd().
====================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, addStaticBox, addLight, rowX, STREET_HALF_W } from './Scene.js';
import { state } from './state.js';
import { makeStreetlight } from './characters.js';
import { buildKitBuilding, FEATURE_SPOTS, MAIN_LOTS } from './CityKit.js';
import { treePits } from './CityGround.js';
import { BOUNDS, SIDEWALK as SIDEWALK_W, layout, lotBlocked } from './CityLayout.js';

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
  finish(shadows = true, parent = scene) {
    for (const [material, geos] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), material);
      mesh.castShadow = shadows && !material.transparent;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}

/* --- Buildings ------------------------------------------------------------ */
function buildRows(rnd, L) {
  for (const row of L.rows) {
    const x0 = row.facade, x1 = row.facade - row.face * row.depth;
    const xc = (x0 + x1) / 2;
    for (let top = row.z0; top > row.z1 + 6;) {
      // A long lot that runs into a road or open space is shortened to fit
      // before giving up on this spot, so the row packs up to each obstacle
      const d = [10 + rnd() * 8, 12, 9].find((len) => !lotBlocked(L, Math.min(x0, x1), Math.max(x0, x1), top, top - len));
      if (!d) { top -= 3; continue; }
      const z1 = top - d;
      const h = row.far ? 18 + rnd() * 30 : 14 + rnd() * 26;
      const reach = inReach(x0, x1, top, z1);
      const feature = L.featureLots.find((f) => !f.used && f.row === row.id && f.z <= top && f.z >= z1);
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

/* --- Parks --------------------------------------------------------------
   Lawn and paths round a centrepiece (a fountain, or a bandstand), flower
   beds, benches, hedges on every side but the street's, trees round the
   edge. Small parks get smaller features; anything the level placed there
   for gameplay (park.avoid) is kept clear of. */
const WOOD = flat(0x7a5a3a), IRON = flat(0x2a2c2e);
function bench(batch, x, z, ry) {
  const seat = new THREE.BoxGeometry(1.8, 0.08, 0.5).translate(0, 0.45, 0), back = new THREE.BoxGeometry(1.8, 0.5, 0.06).translate(0, 0.75, -0.24);
  for (const g of [seat, back]) batch.add(WOOD, g.rotateY(ry).translate(x, 0, z));
  for (const lx of [-0.75, 0.75]) batch.add(IRON, new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(lx, 0.22, 0).rotateY(ry).translate(x, 0, z));
}
function fountain(batch, x, z, k) {
  const stone = flat(0xb0aa9c), water = flat(0x4a9ac8, { roughness: 0.15, metalness: 0.1, emissive: 0x0a2a40, emissiveIntensity: 1 });
  batch.add(stone, new THREE.CylinderGeometry(3.4 * k, 3.6 * k, 0.7, 20).translate(x, 0.35, z));
  batch.add(water, new THREE.CylinderGeometry(3.05 * k, 3.05 * k, 0.1, 20).translate(x, 0.62, z));
  batch.add(stone, new THREE.CylinderGeometry(0.35, 0.5, 2.2, 10).translate(x, 1.1, z));
  batch.add(stone, new THREE.CylinderGeometry(1.2 * k, 0.6, 0.35, 14).translate(x, 2.3, z));
  batch.add(water, new THREE.CylinderGeometry(1.0 * k, 1.0 * k, 0.08, 14).translate(x, 2.48, z));
  addStaticBox(3.4 * k, 0.6, 3.4 * k, x, 0.6, z);
}
// An octagonal bandstand: white posts, a green roof, bulbs under the eaves
function bandstand(batch, x, z, k) {
  const white = flat(0xf0ece4), green = flat(0x2f6b5a), stone = flat(0xb0aa9c);
  const bulb = flat(0xfff0c0, { emissive: 0xffc070, emissiveIntensity: state.timeOfDay === 'night' ? 1.8 : 0.1 });
  const r = 4.2 * k;
  batch.add(stone, new THREE.CylinderGeometry(r, r + 0.2, 0.7, 8).translate(x, 0.35, z));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, px = x + Math.cos(a) * (r - 0.4), pz = z + Math.sin(a) * (r - 0.4);
    batch.add(white, new THREE.CylinderGeometry(0.1, 0.12, 3, 6).translate(px, 2.2, pz));
    batch.add(bulb, new THREE.IcosahedronGeometry(0.1, 0).translate(px, 3.55, pz));
    // a low railing between the posts, open on the street side
    if (i !== 3) {
      const b = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8, qx = x + Math.cos(b) * (r - 0.4), qz = z + Math.sin(b) * (r - 0.4);
      batch.add(white, new THREE.BoxGeometry(Math.hypot(qx - px, qz - pz), 0.08, 0.08).rotateY(-Math.atan2(qz - pz, qx - px)).translate((px + qx) / 2, 1.5, (pz + qz) / 2));
    }
  }
  batch.add(white, new THREE.CylinderGeometry(r + 0.5, r + 0.5, 0.18, 8).translate(x, 3.75, z));
  batch.add(green, new THREE.ConeGeometry(r + 0.6, 1.9 * k + 0.6, 8).translate(x, 4.8, z));
  batch.add(white, new THREE.SphereGeometry(0.25, 8, 6).translate(x, 5.9, z));
  addStaticBox(r * 0.9, 0.35, r * 0.9, x, 0.35, z);
}
function buildPark(batch, rnd, park) {
  const { x0, x1, z0, z1 } = park;
  const w = x1 - x0, d = z0 - z1, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const open = park.openSide ?? 1, closedX = open > 0 ? x0 : x1; // the hedge goes on the side away from the street
  const avoid = park.avoid || [];
  const clear = (x, z, r) => avoid.every(([ax, az]) => Math.hypot(x - ax, z - az) > r);
  const k = Math.min(1, Math.min(w, d) / 25);
  const grass = flat(0x6a8f42), path = flat(0xc8c0ae), stone = flat(0xb0aa9c), hedge = flat(0x3f6a34), soil = flat(0x4a3a2c);
  batch.add(grass, new THREE.BoxGeometry(w, 0.08, d).translate(cx, 0.04, cz));
  for (const e of [-1, 1]) batch.add(stone, new THREE.BoxGeometry(w + 0.3, 0.2, 0.3).translate(cx, 0.1, cz + e * (d / 2 + 0.15)));
  batch.add(stone, new THREE.BoxGeometry(0.3, 0.2, d).translate(closedX - open * 0.15, 0.1, cz));
  // The centrepiece: in the middle, unless gameplay clutter is there, then
  // wherever on the lawn is furthest from it
  let fx = cx, fz = cz;
  const need = (park.kind === 'bandstand' ? 6 : 5) * k + 1.5;
  if (!clear(fx, fz, need)) {
    let best = -1;
    for (let gx = x0 + need; gx <= x1 - need; gx += 1.5) for (let gz = z1 + need; gz <= z0 - need; gz += 1.5) {
      const dmin = Math.min(...avoid.map(([ax, az]) => Math.hypot(gx - ax, gz - az)));
      if (dmin > best) { best = dmin; fx = gx; fz = gz; }
    }
  }
  // Paths: across from the street, along the park, a ring round the centrepiece
  batch.add(path, new THREE.BoxGeometry(w, 0.1, 2.6 * k + 0.6).translate(cx, 0.06, fz));
  batch.add(path, new THREE.BoxGeometry(2.6 * k + 0.6, 0.1, d).translate(fx, 0.061, cz));
  batch.add(path, new THREE.CylinderGeometry(6 * k + 0.6, 6 * k + 0.6, 0.1, 24).translate(fx, 0.062, fz));
  if (park.kind === 'bandstand') bandstand(batch, fx, fz, k); else fountain(batch, fx, fz, k);
  // Flower beds in the four lawns round it
  const blooms = [0xe86a9a, 0xf2c84a, 0xd8453a, 0xf0ece4, 0x8a5ab8].map((c) => flat(c));
  for (const [ex, ez] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const bx = fx + ex * 8 * k, bz = fz + ez * 9 * k;
    if (bx < x0 + 2 || bx > x1 - 2 || bz < z1 + 1.5 || bz > z0 - 1.5 || !clear(bx, bz, 3.5)) continue;
    batch.add(soil, new THREE.BoxGeometry(4 * k, 0.14, 2.4 * k).translate(bx, 0.07, bz));
    for (let i = 0; i < 14; i++) batch.add(blooms[i % blooms.length], new THREE.IcosahedronGeometry(0.22, 0).translate(bx + (rnd() - 0.5) * 3.6 * k, 0.3, bz + (rnd() - 0.5) * 2 * k));
  }
  // Hedges along the ends and the far side, the street side left open
  for (const e of [-1, 1]) {
    batch.add(hedge, new THREE.BoxGeometry(w - 4, 1.1, 0.9).translate(cx - open, 0.6, cz + e * (d / 2 - 0.8)));
    addStaticBox((w - 4) / 2, 0.55, 0.45, cx - open, 0.55, cz + e * (d / 2 - 0.8));
  }
  batch.add(hedge, new THREE.BoxGeometry(0.9, 1.1, d - 8).translate(closedX + open * 0.8, 0.6, cz));
  addStaticBox(0.45, 0.55, (d - 8) / 2, closedX + open * 0.8, 0.55, cz);
  // Benches facing the paths
  for (const [bx, bz, ry] of [[fx - 7 * k, fz + 2, 0], [fx + 7 * k, fz + 2, 0], [fx - 7 * k, fz - 2, Math.PI], [fx + 7 * k, fz - 2, Math.PI], [fx + 2, fz + 14 * k, Math.PI / 2], [fx - 2, fz - 14 * k, -Math.PI / 2]]) {
    if (bx > x0 + 1 && bx < x1 - 1 && bz > z1 + 1 && bz < z0 - 1 && clear(bx, bz, 3)) bench(batch, bx, bz, ry);
  }
  // Trees round the edge
  const count = Math.round(14 * Math.min(1.4, (w * d) / (25 * 54)));
  for (let i = 0; i < count; i++) {
    const t = i / count, onSide = i % 2;
    const tx = onSide ? closedX + open * (3 + rnd() * 2) : x0 + 4 + t * (w - 8);
    const tz = onSide ? z1 + 4 + t * (d - 8) : (i % 4 < 2 ? z0 - 3.5 : z1 + 3.5);
    if (clear(tx, tz, 3.5)) tree(batch, rnd, tx, tz, (1.1 + rnd() * 0.3) * Math.max(0.8, k));
  }
  // Seaside parks: palms at the corners
  if (park.palms) for (const [px, pz] of [[x0 + 2.5, z0 - 2.5], [x1 - 2.5, z0 - 2.5], [x0 + 2.5, z1 + 2.5], [x1 - 2.5, z1 + 2.5]]) {
    if (clear(px, pz, 3)) palm(batch, rnd, px, pz, 1.05);
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
function buildZoo(batch, rnd, zoo) {
  const { x0, x1, z0, z1, gateZ, gateW } = zoo;
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

/* --- Things that move (Level ticks call updateTown) --------------------------- */
const animators = [];
/** Every frame, from the level's tick: the lighthouse beam, and the like. */
export function updateTown(dt) { for (const a of animators) a(dt); }

/* --- The waterfront (harbour) -------------------------------------------------
   Either side of the quay: a boardwalk with palms, benches and lamps, steps
   down to a beach that slopes into the sea. The east beach is for lying in
   the sun (umbrellas, deck chairs, towels, beach huts, a lifeguard tower, a
   sandcastle); the west for playing (a volleyball net, picnic tables) with
   dune grass and driftwood. Boats moored off it, one pulled up on the sand. */
const HULLS = [0xf0ece4, 0x2e4a7a, 0xa83a32, 0x2f6b5a, 0xd8a43a];
const BRIGHT = [0xe86a9a, 0xf2c84a, 0x3a9ad8, 0xd8453a, 0x5ab87a, 0xf08a3a, 0xf0ece4];
function rowboat(batch, rnd, x, z, y = 0.2) {
  const hull = flat(HULLS[Math.floor(rnd() * HULLS.length)]), trim = flat(0xf0ece4), deck = flat(0x7a5a3a);
  const len = 4 + rnd() * 1.5, ry = (rnd() - 0.5) * 0.3;
  batch.add(hull, new THREE.BoxGeometry(len, 0.7, 1.6).rotateY(ry).translate(x, y, z));
  batch.add(hull, new THREE.ConeGeometry(0.8, 1.2, 4).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4).scale(1, 0.55, 1).rotateY(ry).translate(x + Math.cos(ry) * (len / 2 + 0.55), y + 0.05, z - Math.sin(ry) * (len / 2 + 0.55)));
  batch.add(deck, new THREE.BoxGeometry(len - 0.4, 0.05, 1.3).rotateY(ry).translate(x, y + 0.36, z));
  if (rnd() < 0.5) batch.add(trim, new THREE.BoxGeometry(1.3, 0.8, 1.2).rotateY(ry).translate(x - Math.cos(ry) * 0.4, y + 0.75, z + Math.sin(ry) * 0.4));
}
// A low-poly palm: a trunk bending in segments, a crown of drooping fronds
const PALM_TRUNK = flat(0x8a6a4a), PALM_FROND = [flat(0x4f8a3a), flat(0x5f9a40)];
function palm(batch, rnd, x, z, scale = 1) {
  const lean = (rnd() - 0.5) * 0.5, dir = rnd() * Math.PI * 2;
  let px = x, py = 0, pz = z;
  for (let i = 0; i < 5; i++) {
    const tilt = lean * (i / 5), len = 1.3 * scale;
    const nx = px + Math.cos(dir) * Math.sin(tilt) * len, nz = pz + Math.sin(dir) * Math.sin(tilt) * len, ny = py + Math.cos(tilt) * len;
    batch.add(PALM_TRUNK, new THREE.CylinderGeometry((0.16 - i * 0.015) * scale, (0.2 - i * 0.015) * scale, len, 6)
      .rotateZ(-Math.cos(dir) * tilt).rotateX(Math.sin(dir) * tilt).translate((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2));
    px = nx; py = ny; pz = nz;
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.3;
    batch.add(PALM_FROND[i % 2], new THREE.BoxGeometry(2.6 * scale, 0.05, 0.45 * scale).translate(1.3 * scale, 0, 0)
      .rotateZ(-0.45 - rnd() * 0.25).rotateY(a).translate(px, py, pz));
  }
  if (inReach(x, x, z, z)) addStaticBox(0.22 * scale, 2.5, 0.22 * scale, x, 2.5, z);
}
function deckChair(batch, x, z, ry, cloth) {
  const frame = new THREE.BoxGeometry(0.6, 0.06, 1.5).rotateX(-0.25).translate(0, 0.35, 0);
  const back = new THREE.BoxGeometry(0.6, 0.06, 0.8).rotateX(0.9).translate(0, 0.65, -0.85);
  for (const g of [frame, back]) batch.add(cloth, g.rotateY(ry).translate(x, 0.06, z));
  for (const lx of [-0.27, 0.27]) batch.add(WOOD, new THREE.BoxGeometry(0.04, 0.35, 0.04).translate(lx, 0.18, 0.55).rotateY(ry).translate(x, 0.06, z));
}
function umbrella(batch, rnd, x, z) {
  batch.add(flat(0xf0ece4), new THREE.CylinderGeometry(0.04, 0.04, 2.3, 5).rotateZ((rnd() - 0.5) * 0.2).translate(x, 1.2, z));
  batch.add(flat(BRIGHT[Math.floor(rnd() * BRIGHT.length)]), new THREE.ConeGeometry(1.4, 0.5, 8).translate(x, 2.35, z));
}
function beachHut(batch, rnd, x, z) {
  const wall = flat(BRIGHT[Math.floor(rnd() * BRIGHT.length)]), white = flat(0xf0ece4);
  batch.add(wall, new THREE.BoxGeometry(2.2, 2.2, 2.2).translate(x, 1.16, z));
  const roof = new THREE.Shape(); roof.moveTo(-1.35, 0); roof.lineTo(1.35, 0); roof.lineTo(0, 0.9); roof.lineTo(-1.35, 0);
  batch.add(white, new THREE.ExtrudeGeometry(roof, { depth: 2.6, bevelEnabled: false }).translate(x, 2.26, z - 1.3));
  batch.add(white, new THREE.BoxGeometry(0.9, 1.6, 0.05).translate(x, 0.86, z - 1.13)); // door, facing the sea
}
function lifeguardTower(batch, x, z) {
  const white = flat(0xf0ece4), red = flat(0xd8453a);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) batch.add(white, new THREE.BoxGeometry(0.15, 3, 0.15).translate(x + dx, 1.5, z + dz));
  batch.add(white, new THREE.BoxGeometry(2.6, 0.15, 2.6).translate(x, 3.05, z));
  batch.add(red, new THREE.BoxGeometry(2.2, 1.4, 2.2).translate(x, 3.8, z));
  batch.add(white, new THREE.BoxGeometry(2.6, 0.12, 2.6).translate(x, 4.55, z));
  batch.add(white, new THREE.BoxGeometry(0.6, 0.06, 2.6).rotateX(0.85).translate(x, 1.5, z + 2.1)); // ladder
  batch.add(white, new THREE.CylinderGeometry(0.03, 0.03, 2, 4).translate(x + 1.2, 5.5, z));
  batch.add(red, new THREE.BoxGeometry(0.02, 0.5, 0.8).translate(x + 1.2, 6.2, z - 0.4)); // the red flag
}
function sandcastle(batch, x, z) {
  const sand = flat(0xd0b888);
  batch.add(sand, new THREE.CylinderGeometry(0.7, 0.8, 0.5, 8).translate(x, 0.3, z));
  for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    batch.add(sand, new THREE.CylinderGeometry(0.18, 0.2, 0.5, 6).translate(x + dx, 0.75, z + dz));
    batch.add(sand, new THREE.ConeGeometry(0.2, 0.25, 6).translate(x + dx, 1.12, z + dz));
  }
  batch.add(flat(0xd8453a), new THREE.BoxGeometry(0.01, 0.12, 0.2).translate(x, 1.0, z + 0.1)); // a flag on a stick
}
function duneGrass(batch, rnd, x, z) {
  const grass = flat(0x9aa64a);
  for (let i = 0; i < 9; i++) batch.add(grass, new THREE.ConeGeometry(0.05, 0.55 + rnd() * 0.4, 3).rotateX((rnd() - 0.5) * 0.7).rotateZ((rnd() - 0.5) * 0.7).translate(x + (rnd() - 0.5) * 0.8, 0.3, z + (rnd() - 0.5) * 0.8));
}
function picnicTable(batch, x, z) {
  batch.add(WOOD, new THREE.BoxGeometry(1.9, 0.07, 0.8).translate(x, 0.78, z));
  for (const e of [-1, 1]) {
    batch.add(WOOD, new THREE.BoxGeometry(1.9, 0.06, 0.3).translate(x, 0.45, z + e * 0.6));
    batch.add(WOOD, new THREE.BoxGeometry(0.08, 0.8, 1.6).rotateX(e * 0.35).translate(x + e * 0.7, 0.4, z));
  }
}
function buildWaterfront(batch, rnd, P) {
  const plank = [flat(0x8a6a4a), flat(0x7a5a3e)], white = flat(0xe8e8e4), rope = flat(0xd8d0b8), buoy = flat(0xe8622a);
  const towels = BRIGHT.map((c) => flat(c));
  for (const strip of P.strips) {
    const x0 = Math.min(strip.x0, strip.x1), x1 = Math.max(strip.x0, strip.x1), w = x1 - x0, cx = (x0 + x1) / 2;
    // The boardwalk: planks across it, a low rope fence along the sand edge, steps down
    const bd = P.z0 - P.z1, bz = (P.z0 + P.z1) / 2;
    batch.add(plank[0], new THREE.BoxGeometry(w, 0.16, bd).translate(cx, 0.08, bz));
    for (let x = x0 + 0.15, k = 0; x < x1; x += 0.3, k++) batch.add(plank[k & 1], new THREE.BoxGeometry(0.26, 0.03, bd - 0.1).translate(x, 0.17, bz));
    const steps = [];
    for (let x = x0 + 6; x < x1 - 4; x += 12) steps.push(x);
    for (let x = x0 + 0.5; x < x1; x += 3) {
      if (steps.some((sx) => Math.abs(x - sx) < 2)) continue;
      batch.add(WOOD, new THREE.CylinderGeometry(0.07, 0.07, 0.8, 6).translate(x, 0.5, P.z1 + 0.2));
      batch.add(rope, new THREE.BoxGeometry(3, 0.04, 0.04).translate(x + 1.5, 0.75, P.z1 + 0.2));
    }
    for (const sx of steps) for (let k = 0; k < 2; k++) batch.add(plank[1], new THREE.BoxGeometry(2.6, 0.08, 0.45).translate(sx, 0.12 - k * 0.06, P.z1 - 0.25 - k * 0.45));
    for (let x = x0 + 9; x < x1 - 3; x += 18) bench(batch, x, P.z1 + 1.4, Math.PI);
    for (let x = x0 + 4; x < x1 - 2; x += 10) palm(batch, rnd, x + (rnd() - 0.5) * 2, P.z0 - 1.2, 0.95 + rnd() * 0.2);
    for (let x = x0 + 14; x < x1 - 3; x += 22) {
      batch.add(buoy, new THREE.TorusGeometry(0.35, 0.09, 6, 12).translate(x, 0.9, P.z1 + 0.25));
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) batch.add(rope, new THREE.BoxGeometry(0.06, 0.2, 0.2).rotateZ(a).translate(x + Math.cos(a) * 0.35, 0.9 + Math.sin(a) * 0.35, P.z1 + 0.27));
    }
    // The beach: dry sand by the boardwalk, wet and darker as it slopes into the sea
    const sd = P.z1 - P.beachTo, sz = (P.z1 + P.beachTo) / 2;
    const geo = new THREE.PlaneGeometry(w, sd, Math.ceil(w / 2), Math.ceil(sd / 1.5)).rotateX(-Math.PI / 2).translate(cx, 0, sz);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    const dry = new THREE.Color(0xdcc89e), wet = new THREE.Color(0xb09a72), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vz = pos.getZ(i), t = (P.z1 - vz) / sd; // 0 at the boardwalk .. 1 out in the water
      const dune = (1 - THREE.MathUtils.smoothstep(t, 0.05, 0.3)) * 0.22 * (0.5 + 0.5 * Math.sin(vx * 0.7 + vz * 1.3));
      pos.setY(i, 0.06 + dune - 0.55 * THREE.MathUtils.smoothstep(t, 0.3, 1));
      c.copy(dry).lerp(wet, THREE.MathUtils.smoothstep(t, 0.45, 0.7)).toArray(col, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    batch.add(SAND, geo);
    const onSand = (x) => x > Math.max(x0, -BOUNDS.x) + 1 && x < Math.min(x1, BOUNDS.x) - 1;
    if (strip.beach === 'east') {
      for (let x = x0 + 4; x < x1 - 6; x += 6.5) {
        const z = P.z1 - 6 - rnd() * 3;
        umbrella(batch, rnd, x, z);
        deckChair(batch, x - 0.9, z + 0.6, Math.PI + (rnd() - 0.5) * 0.4, towels[Math.floor(rnd() * towels.length)]);
        if (rnd() < 0.7) deckChair(batch, x + 0.9, z + 0.6, Math.PI + (rnd() - 0.5) * 0.4, towels[Math.floor(rnd() * towels.length)]);
        if (rnd() < 0.6) batch.add(towels[Math.floor(rnd() * towels.length)], new THREE.BoxGeometry(0.9, 0.02, 1.8).rotateY((rnd() - 0.5) * 0.6).translate(x + 1.8, 0.08, z - 1.5));
      }
      for (let x = x0 + 2; x < x0 + 14; x += 3) beachHut(batch, rnd, x, P.z1 - 2.2);
      lifeguardTower(batch, Math.min(x1, BOUNDS.x) - 7, P.z1 - 11);
      sandcastle(batch, x0 + 18, P.z1 - 13);
      batch.add(flat(0x3a9ad8), new THREE.SphereGeometry(0.25, 10, 8).translate(x0 + 20, 0.3, P.z1 - 11)); // a beach ball
      // Ice cream cart on the boardwalk
      const cartX = x0 + 22;
      batch.add(flat(0xf0d8e0), new THREE.BoxGeometry(1.6, 0.9, 0.9).translate(cartX, 0.75, P.z0 - 3.3));
      for (const e of [-1, 1]) batch.add(IRON, new THREE.CylinderGeometry(0.25, 0.25, 0.08, 10).rotateX(Math.PI / 2).translate(cartX + e * 0.55, 0.4, P.z0 - 2.8));
      umbrella(batch, rnd, cartX, P.z0 - 3.3);
    } else {
      // Volleyball: two posts and a net between them
      const vx = Math.max(x0, -BOUNDS.x) + 12, vz = P.z1 - 9;
      for (const e of [-1, 1]) batch.add(white, new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6).translate(vx, 1.3, vz + e * 4));
      batch.add(white, new THREE.BoxGeometry(0.03, 0.9, 8).translate(vx, 2.0, vz));
      batch.add(flat(0xf2c84a), new THREE.SphereGeometry(0.2, 8, 6).translate(vx + 3, 0.25, vz + 1));
      for (let i = 0; i < 3; i++) picnicTable(batch, x1 - 5 - i * 4.5, P.z1 - 3.5);
      for (let i = 0; i < 3; i++) batch.add(WOOD, new THREE.CylinderGeometry(0.18, 0.22, 2.4 + rnd(), 6).rotateZ(Math.PI / 2).rotateY(rnd() * 3).translate(x0 + 8 + rnd() * (w - 16), 0.2, P.z1 - 4 - rnd() * 6)); // driftwood
      rowboat(batch, rnd, x1 - 10, P.z1 - 7, 0.35); // pulled up on the sand
    }
    for (let x = x0 + 1; x < x1 - 1; x += 3 + rnd() * 3) if (onSand(x) || rnd() < 0.4) duneGrass(batch, rnd, x, P.z1 - 1 - rnd() * 1.5);
    for (let x = x0 + 6; x < x1 - 4; x += 11) rowboat(batch, rnd, x + (rnd() - 0.5) * 2, P.beachTo - 3 - rnd() * 3); // moored off
  }
}
const SAND = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });

/* --- The lighthouse on the rocks off the west end -------------------------
   Red and white, its beam sweeping the bay at night. */
function buildLighthouse(batch, rnd, { x, z }) {
  const white = flat(0xf0ece4), red = flat(0xc8323a), rock = flat(0x6a6660), dark = flat(0x2a2c2e);
  for (let i = 0; i < 16; i++) batch.add(rock, new THREE.IcosahedronGeometry(1 + rnd() * 1.6, 0).translate(x + (rnd() - 0.5) * 7, 0, z + (rnd() - 0.5) * 7));
  for (let i = 0; i < 6; i++) batch.add(rock, new THREE.IcosahedronGeometry(0.8 + rnd(), 0).translate(x + 3 + i * 1.6, -0.1, z + 3 + i * 1.4)); // the breakwater back to shore
  const bands = [[0, 3.5, white], [3.5, 6, red], [6, 9.5, white], [9.5, 12, red]];
  for (const [y0, y1, m] of bands) {
    const r0 = 2.3 - y0 * 0.06, r1 = 2.3 - y1 * 0.06;
    batch.add(m, new THREE.CylinderGeometry(r1, r0, y1 - y0, 14).translate(x, 1 + (y0 + y1) / 2, z));
  }
  batch.add(dark, new THREE.CylinderGeometry(2.3, 2.3, 0.25, 14).translate(x, 13.1, z));        // gallery
  batch.add(dark, new THREE.TorusGeometry(2.2, 0.04, 4, 20).rotateX(Math.PI / 2).translate(x, 13.8, z));
  const night = state.timeOfDay === 'night';
  batch.add(flat(0xfff0b0, { emissive: 0xffd870, emissiveIntensity: night ? 2.2 : 0.3 }), new THREE.CylinderGeometry(1.1, 1.1, 1.8, 10).translate(x, 14.2, z)); // the lantern
  batch.add(red, new THREE.ConeGeometry(1.5, 1.4, 14).translate(x, 15.8, z));
  // The beam: two long, faint cones turning about the lantern, at night only
  if (!night) return;
  const beam = new THREE.Group();
  beam.position.set(x, 14.2, z);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  for (const e of [-1, 1]) beam.add(new THREE.Mesh(new THREE.ConeGeometry(3.5, 70, 16, 1, true).translate(0, 35, 0).rotateZ(e * Math.PI / 2), glowMat));
  beam.userData.dynamic = true;
  scene.add(beam);
  animators.push((dt) => { beam.rotation.y += dt * 0.6; });
}

/* --- Sand blown onto the streets, thicker toward the water ------------------
   Soft-edged patches as one instanced mesh, at whatever height the ground is
   (road, sidewalk or lawn) so none hide under it. */
function buildSandDrifts(rnd, L) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const px = 16 + rnd() * 32, py = 16 + rnd() * 32, r = 8 + rnd() * 16;
    const grad = g.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, 'rgba(216,196,150,0.55)'); grad.addColorStop(1, 'rgba(216,196,150,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const N = 260, drifts = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const z0 = L.sandFrom, z1 = L.promenade.z0;
  const onWalk = (x) => (Math.abs(x) > STREET_HALF_W && Math.abs(x) < rowX)
    || L.backStreets.some((st) => Math.abs(Math.abs(x - st.x) - st.halfW - SIDEWALK_W / 2) < SIDEWALK_W / 2);
  const onLawn = (x, z) => L.parks.some((pk) => x > pk.x0 && x < pk.x1 && z < pk.z0 && z > pk.z1);
  for (let i = 0; i < N; i++) {
    const z = z1 + (z0 - z1) * Math.pow(rnd(), 1.8); // most of them near the water
    const x = (rnd() - 0.5) * 2 * BOUNDS.x;
    p.set(x, onLawn(x, z) ? 0.095 : onWalk(x) ? 0.036 : 0.014, z);
    const k = 1 - (z - z1) / (z0 - z1);
    sc.set(1.5 + rnd() * 3.5 * (0.5 + k), 1, 0.8 + rnd() * 2 * (0.5 + k));
    drifts.setMatrixAt(i, m.compose(p, q.setFromAxisAngle(up, rnd() * Math.PI), sc));
  }
  drifts.receiveShadow = true;
  drifts.userData.dynamic = true;
  scene.add(drifts);
}

/* --- Harbour Walk: the lit glass bridge over the main street ------------------
   A glass vault on steel ribs over a deck that arches up toward the middle,
   from glass stair towers on each sidewalk, against the buildings either
   side. Warm light along its ridge, a cyan line under its deck, its name
   on both faces. Its own group, kept out of the static merge, so it can
   come down mid-level later: FEATURE_SPOTS.bridge. */
function signMaterial(text, night) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#12304a'; g.fillRect(0, 0, 512, 64);
  g.strokeStyle = '#5fd8ff'; g.lineWidth = 3;
  g.beginPath(); for (let x = 0; x <= 512; x += 8) g.lineTo(x, 54 + Math.sin(x / 18) * 3); g.stroke(); // a wave under the name
  g.fillStyle = '#f4efe4'; g.font = 'bold 38px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 28, 480);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: night ? 0.9 : 0.15, roughness: 0.6 });
}
// Where a bridge end would land in a gap between main-street lots, a
// building fills the gap (at least three storeys) so it lands on one
function anchorBridgeEnds(B) {
  for (const side of [-1, 1]) {
    const lots = MAIN_LOTS.filter((l) => l.side === side);
    if (lots.some((l) => l.z1 <= B.z && l.z0 >= B.z)) continue;
    const north = Math.min(B.z + 9, ...lots.filter((l) => l.z1 > B.z).map((l) => l.z1));
    const south = Math.max(B.z - 9, ...lots.filter((l) => l.z0 < B.z).map((l) => l.z0));
    const d = north - south, w = 13;
    buildKitBuilding(side * (rowX + w / 2), (north + south) / 2, w, 16, d, { minStoreys: 3 });
  }
}
function buildBridge(B) {
  anchorBridgeEnds(B);
  const night = state.timeOfDay === 'night';
  const group = new THREE.Group();
  const parts = new Batch();
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde0, roughness: 0.35, metalness: 0.6, emissive: 0x8fd0ff, emissiveIntensity: night ? 0.25 : 0 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd0e8, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.3, side: THREE.DoubleSide, depthWrite: false, emissive: 0x3a7a9a, emissiveIntensity: night ? 0.35 : 0 });
  const deck = flat(0x5a6068), glow = flat(0x5fd8ff, { emissive: 0x5fd8ff, emissiveIntensity: night ? 2.4 : 0.4 });
  const warm = flat(0xfff0c8, { emissive: 0xffe0a0, emissiveIntensity: night ? 1.8 : 0.3 });
  const towerW = 3, half = rowX - towerW, r = B.width / 2, N = 16;
  const y = (x) => B.deckY + B.rise * (1 - (x / half) ** 2);
  for (let i = 0; i < N; i++) {
    const xa = -half + (i / N) * 2 * half, xb = -half + ((i + 1) / N) * 2 * half;
    const ya = y(xa), yb = y(xb), len = Math.hypot(xb - xa, yb - ya) + 0.02, ang = Math.atan2(yb - ya, xb - xa);
    const seg = (geo) => geo.rotateZ(ang).translate((xa + xb) / 2, (ya + yb) / 2, B.z);
    parts.add(deck, seg(new THREE.BoxGeometry(len, 0.35, B.width)));
    parts.add(glow, seg(new THREE.BoxGeometry(len, 0.06, 0.25).translate(0, -0.2, 0)));
    parts.add(glass, seg(new THREE.CylinderGeometry(r, r, len, 14, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0.18, 0)));
    parts.add(warm, seg(new THREE.BoxGeometry(len, 0.05, 0.2).translate(0, 0.18 + r - 0.08, 0)));
    for (const e of [-1, 1]) parts.add(steel, seg(new THREE.BoxGeometry(len, 0.05, 0.05).translate(0, 1.1, e * (r - 0.25))));
  }
  for (let i = 0; i <= N; i++) { // the ribs, square to the deck's slope
    const x = -half + (i / N) * 2 * half, slope = Math.atan(-2 * B.rise * x / (half * half));
    parts.add(steel, new THREE.TorusGeometry(r + 0.02, 0.07, 5, 14, Math.PI).rotateY(Math.PI / 2).rotateZ(slope).translate(x, y(x) + 0.18, B.z));
  }
  // The name on both faces, on a fascia hung under the middle of the deck
  parts.add(steel, new THREE.BoxGeometry(10, 0.9, B.width + 0.1).translate(0, y(0) - 0.62, B.z));
  const sign = signMaterial(B.name, night);
  for (const e of [-1, 1]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 0.8), sign);
    face.position.set(0, y(0) - 0.62, B.z + e * (B.width / 2 + 0.06));
    face.rotation.y = e > 0 ? 0 : Math.PI;
    group.add(face);
  }
  // Glass stair towers on each sidewalk, against the buildings
  const th = B.deckY + 3.4;
  for (const e of [-1, 1]) {
    const tx = e * (rowX - towerW / 2);
    parts.add(glass, new THREE.BoxGeometry(towerW, th, towerW).translate(tx, th / 2, B.z));
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.add(steel, new THREE.BoxGeometry(0.14, th, 0.14).translate(tx + dx * towerW / 2, th / 2, B.z + dz * towerW / 2));
    parts.add(steel, new THREE.BoxGeometry(towerW + 0.3, 0.3, towerW + 0.3).translate(tx, th + 0.15, B.z));
    for (let k = 0; k < 4; k++) { // the stairs inside, lit, zigzagging up
      const sy = 0.9 + k * (B.deckY / 4);
      parts.add(warm, new THREE.BoxGeometry(towerW - 0.6, 0.12, 0.9).rotateX((k % 2 ? 1 : -1) * 0.55).translate(tx, sy, B.z + (k % 2 ? 0.5 : -0.5)));
    }
    addStaticBox(towerW / 2, th / 2, towerW / 2, tx, th / 2, B.z);
  }
  parts.finish(true, group);
  // Light on the street below, at night (a clear day adds no lights)
  const under = new THREE.PointLight(0xbfe8ff, night ? 7 : 0, 28, 2);
  under.position.set(0, B.deckY - 1, B.z);
  addLight(group, under);
  group.userData.dynamic = true; // kept out of the static merge, so it can fall
  scene.add(group);
  FEATURE_SPOTS.bridge = { group, z: B.z, deckY: B.deckY, span: 2 * half };
}

/* --- Lamps ---------------------------------------------------------------- */
// Back-street posts sit on the kerb away from the main street, so their
// arms (which always reach toward x = 0) hang over their own road. Their z
// values (the plan's lampZ) never match a main-street post's, so the lit
// list can't confuse them.
function buildLamps(L) {
  for (const st of L.backStreets) {
    if (st.far) continue;
    const kerbX = st.x + Math.sign(st.x) * (st.halfW - 0.55);
    for (const z of L.lampZ) if (z <= st.z0 && z >= st.z1) makeStreetlight(kerbX, z);
  }
  for (const [x, z] of [...L.parkLamps, ...(L.promenadeLamps || [])]) makeStreetlight(x, z);
}

/** Builds the town. Called at the end of loadBuildings() for a CityKit level. */
export function buildTown() {
  const L = layout();
  const rnd = seeded(0x70A1);
  buildRows(rnd, L);
  const greenery = new Batch();
  for (const park of L.parks) buildPark(greenery, rnd, park);
  if (L.zoo) buildZoo(greenery, rnd, L.zoo);
  if (L.promenade) buildWaterfront(greenery, rnd, L.promenade);
  if (L.lighthouse) buildLighthouse(greenery, rnd, L.lighthouse);
  if (L.sandFrom !== undefined) buildSandDrifts(rnd, L);
  plantStreetTrees(greenery, rnd);
  greenery.finish();
  if (L.bridge) buildBridge(L.bridge);
  buildLamps(L);
}
