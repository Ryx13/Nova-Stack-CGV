/* ======================================================================
   CityKit.js — STYLISED BUILDINGS ON THE STREET'S EXISTING LOTS

   makeBuilding() (characters.js) hands each street lot here when a level
   asks for a district (state.cityKit). The lot keeps its footprint and
   collider, so gameplay is unchanged; what stands on it is new:

   - The lot's street frontage is split into one to three narrow buildings
     of different types, heights and colours, so the street reads as many
     buildings sharing one wall, not one box.
   - Types (downtown): brick walk-up (fire escape, water tank, heavy
     cornice), office (ribbon windows, setback), apartments (balconies),
     hotel (vertical sign, canopy), low corner shop.
   - Windows are geometry, not paint: a frame standing proud of the wall,
     the glass set back inside it, a sill and lintel, so the sun casts
     small shadows across every facade. A few are smashed (the quake); at
     night a share of them glow.
   - Ground floors are shops, fronted by trade (SHOPS below): see-through
     display windows only for restaurants and clothing (tables and
     mannequins inside), roll-up garage doors for hardware and auto shops,
     blue mirror glass with sliding doors for pharmacies and banks, a
     small window and a door for the rest. Flower shops, vet clinics, a
     salon and a bar with outdoor seating are placed on purpose.

   Built in world space and merged per material, one mesh each per
   building; mergeStatic.js then folds the whole street into a few chunks.
   Flat shading and plain colours: the stylised low-poly look.
   Detail draws come from each lot's own RNG, never the shared rnd(), so
   the rest of the street still lands exactly where it did.
====================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, addStaticBox } from './Scene.js';
import { state } from './state.js';

const STOREY = 3.2;
const GROUND = 4.2; // shop storey

const PALETTE = {
  brick: [0x9a4a3a, 0x8a5a44, 0xa86a4a, 0x7a3e34, 0x94543c],
  stone: [0xb8ad98, 0xc9bfa8, 0x9c968a, 0xa8a090],
  plaster: [0xd9c9a3, 0xc98f6a, 0x9fb0a8, 0xd6b27a, 0xb7c2c8, 0xc7a8a0],
  trim: [0xe8e2d4, 0xd8d0bc],
  darkTrim: [0x3e3a36, 0x2f3a40],
  awning: [0x2f6b5a, 0xa83a32, 0x2e4a7a, 0xd8a43a, 0x6a3a5a],
};
const IRON = 0x2a2c2e, GLASS = 0x2a3a48, BROKEN = 0x0c0e10, TANK = 0x7a5a3a, ROOF = 0x4e4c48, METAL = 0x8a8e90;
const SIGN_COLOURS = [['#a83a32', '#f4e9d6'], ['#2f6b5a', '#f4e9d6'], ['#1f2d4a', '#f2c46a'], ['#151515', '#e8d37a'], ['#efe6d2', '#2a2a2a']];

function seeded(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* --- Materials: one per look, shared by every building ------------------ */
const materials = new Map();
function mat(hex, { emissive = 0, emissiveIntensity = 0, roughness = 0.88, metalness = 0, map = null } = {}) {
  const key = `${hex}|${emissive}|${emissiveIntensity}|${roughness}|${metalness}|${map ? map.uuid : '-'}`;
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshStandardMaterial({
      color: hex, roughness, metalness, flatShading: true, map,
      emissive, emissiveIntensity, emissiveMap: map && emissive ? map : null,
    }));
  }
  return materials.get(key);
}
const signTextures = new Map();
function paw(g, x, y, r) {
  g.beginPath(); g.ellipse(x, y + r * 0.35, r, r * 0.8, 0, 0, Math.PI * 2); g.fill();
  for (const [dx, dy] of [[-0.95, -0.55], [-0.35, -1.05], [0.35, -1.05], [0.95, -0.55]]) {
    g.beginPath(); g.arc(x + dx * r, y + dy * r, r * 0.38, 0, Math.PI * 2); g.fill();
  }
}
function signTexture(name, [bg, fg], icon = null) {
  const key = name + bg + (icon || '');
  if (!signTextures.has(key)) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 256, 64);
    g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(5, 5, 246, 54);
    g.fillStyle = fg; g.font = 'bold 34px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (icon === 'paw') { paw(g, 34, 34, 11); g.fillText(name, 142, 34, 196); } else g.fillText(name, 128, 34, 230);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    signTextures.set(key, tex);
  }
  return signTextures.get(key);
}
function verticalSignTexture(name) {
  const key = 'v:' + name;
  if (!signTextures.has(key)) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#7a1e1a'; g.fillRect(0, 0, 64, 256);
    g.fillStyle = '#ffd27a'; g.font = 'bold 40px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    [...name].forEach((ch, i, all) => g.fillText(ch, 32, ((i + 0.5) * 256) / all.length));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    signTextures.set(key, tex);
  }
  return signTextures.get(key);
}

/* --- Mirror glass and sliding doors --------------------------------------
   Some shops (and the office lobbies) have a blue mirror-glass front with
   sliding doors. The glass gets a sky-blue sheen toward glancing angles
   and a bright band that sweeps across every pane now and then; the doors
   slide apart as the player walks up. All of it is one instanced mesh
   (a draw call for the whole town), built on the first update. */
const mirrorUniforms = { uGlintTime: { value: 0 } };
let mirrorMaterial = null;
function mirror() {
  if (mirrorMaterial) return mirrorMaterial;
  const m = new THREE.MeshStandardMaterial({ color: 0x3f86bd, metalness: 0.85, roughness: 0.08, emissive: 0x0d2740, emissiveIntensity: 1 });
  const base = THREE.Material.prototype.onBeforeCompile; // keep the global hooks (HeightMist)
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    shader.uniforms.uGlintTime = mirrorUniforms.uGlintTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlintWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 glintWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          glintWorld = instanceMatrix * glintWorld;
        #endif
        vGlintWorld = (modelMatrix * glintWorld).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlintWorld;\nuniform float uGlintTime;')
      .replace('#include <opaque_fragment>', `
        float glintFacing = abs(dot(normalize(vViewPosition), normal));
        float glintSheen = pow(1.0 - glintFacing, 3.0);
        float glintSweep = fract((vGlintWorld.x + vGlintWorld.z) * 0.08 + vGlintWorld.y * 0.05 - uGlintTime * 0.18);
        float glintBand = smoothstep(0.06, 0.0, abs(glintSweep - 0.5));
        outgoingLight += vec3(0.55, 0.8, 1.0) * (glintSheen * 0.7 + glintBand * 0.9);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'citykit-mirror';
  mirrorMaterial = m;
  return m;
}
const mirrorPanes = [];   // static mirror glass: { x, y, z, sx, sy, sz }
const displayPanes = [];  // see-through display windows, same shape
const slidingDoors = [];  // { x, y, z, alongZ: frontage axis, open }
const DOOR_W = 0.9, DOOR_H = 2.4, DOOR_REACH = 3.5;
let doorMesh = null;
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function setDoorPanels(i) {
  const d = slidingDoors[i], slide = DOOR_W * 0.95 * d.open;
  for (const e of [-1, 1]) {
    _p.set(d.x, d.y, d.z + e * (DOOR_W / 2 + slide));
    _s.set(0.06, DOOR_H, DOOR_W);
    doorMesh.setMatrixAt(mirrorPanes.length + i * 2 + (e > 0 ? 1 : 0), _m4.compose(_p, _q, _s));
  }
}
function buildMirrorMesh() {
  doorMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mirror(), mirrorPanes.length + slidingDoors.length * 2);
  mirrorPanes.forEach((p, i) => doorMesh.setMatrixAt(i, _m4.compose(_p.set(p.x, p.y, p.z), _q, _s.set(p.sx, p.sy, p.sz))));
  slidingDoors.forEach((_, i) => setDoorPanels(i));
  doorMesh.receiveShadow = true;
  doorMesh.userData.dynamic = true;
  scene.add(doorMesh);
  if (!displayPanes.length) return;
  // Display windows: clear glass, so what's in the window shows
  const clear = new THREE.MeshStandardMaterial({ color: 0xbcd8e4, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false });
  const panes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), clear, displayPanes.length);
  displayPanes.forEach((p, i) => panes.setMatrixAt(i, _m4.compose(_p.set(p.x, p.y, p.z), _q, _s.set(p.sx, p.sy, p.sz))));
  panes.userData.dynamic = true;
  scene.add(panes);
}
/** Every frame (Level 1's tick): the glint, and doors opening for the player. */
export function updateCityKit(dt, playerPos) {
  if (!mirrorPanes.length && !slidingDoors.length && !displayPanes.length) return;
  if (!doorMesh) buildMirrorMesh();
  mirrorUniforms.uGlintTime.value += dt;
  let moved = false;
  slidingDoors.forEach((d, i) => {
    const near = playerPos && Math.hypot(playerPos.x - d.x, playerPos.z - d.z) < DOOR_REACH ? 1 : 0;
    if (Math.abs(near - d.open) < 0.001) return;
    d.open += Math.sign(near - d.open) * Math.min(Math.abs(near - d.open), dt * 2.2);
    setDoorPanels(i);
    moved = true;
  });
  if (moved) doorMesh.instanceMatrix.needsUpdate = true;
}

/* --- Building assembly ---------------------------------------------------
   A Builder collects geometry per material in world space. Facade-local
   placement: u runs along the frontage (world z), v is height, out is the
   distance in front of the facade plane (toward the street). */
class Builder {
  constructor(facadeX, side, zc) { this.fx = facadeX; this.side = side; this.zc = zc; this.parts = new Map(); }
  add(geo, material) {
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(geo);
  }
  // A box on the facade: su along the frontage, sv tall, sn deep
  face(u, v, out, su, sv, sn, material) {
    this.add(new THREE.BoxGeometry(sn, sv, su).translate(this.fx + this.side * out, v, this.zc + u), material);
  }
  // Mirror glass and sliding doors on the facade (instanced, see above)
  mirrorFace(u, v, out, su, sv, sn) {
    mirrorPanes.push({ x: this.fx + this.side * out, y: v, z: this.zc + u, sx: sn, sy: sv, sz: su });
  }
  slidingDoor(u) {
    slidingDoors.push({ x: this.fx + this.side * 0.06, y: DOOR_H / 2, z: this.zc + u, open: 0 });
  }
  // A box anywhere: centre (x, y, z), sizes along world axes
  box(x, y, z, sx, sy, sz, material) {
    this.add(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), material);
  }
  finish(group, shadows = true) {
    for (const [material, geos] of this.parts) {
      // Icosahedrons come unindexed; merging needs all or none indexed
      const mixed = geos.some((g) => g.index) && geos.some((g) => !g.index);
      const mesh = new THREE.Mesh(mergeGeometries(mixed ? geos.map((g) => (g.index ? g.toNonIndexed() : g)) : geos), material);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      group.add(mesh);
      geos.forEach((g) => g.dispose());
    }
  }
}

const pick = (rnd, list) => list[Math.floor(rnd() * list.length) % list.length];

// One window: proud frame, recessed glass, sill, optional lintel
function windowAt(b, u, v, ww, wh, look) {
  b.face(u, v, 0.06, ww + 0.24, wh + 0.24, 0.12, look.trim);
  b.face(u, v, 0.03, ww, wh, 0.06, look.glass());
  if (look.far) return; // past the edge of the town: frame and glass only
  b.face(u, v - wh / 2 - 0.16, 0.13, ww + 0.4, 0.12, 0.26, look.trim);
  if (look.lintel) b.face(u, v + wh / 2 + 0.2, 0.08, ww + 0.34, 0.22, 0.16, look.lintel);
}

// Flower buckets on tiered stands out on the sidewalk
const FLOWER_COLOURS = [0xe86a9a, 0xf2c84a, 0xd8453a, 0xf0ece4, 0x8a5ab8, 0xf08a3a];
function flowerStands(b, rnd, fw) {
  const stand = mat(0x3f6a3a), pail = mat(0x8a8e90, { roughness: 0.5, metalness: 0.4 }), leaves = mat(0x4f7a3a);
  for (const e of [-1, 1]) {
    const u0 = e * fw * 0.25;
    b.face(u0, 0.35, 0.75, 2.2, 0.7, 0.8, stand);          // lower tier
    b.face(u0, 0.75, 0.45, 2.2, 0.12, 0.45, stand);        // upper tier
    for (let i = 0; i < 4; i++) for (const [out, y] of [[0.9, 0.7], [0.45, 0.81]]) {
      const u = u0 - 0.8 + i * 0.53, x = b.fx + b.side * out, z = b.zc + u;
      b.add(new THREE.CylinderGeometry(0.15, 0.12, 0.28, 8).translate(x, y + 0.14, z), pail);
      b.add(new THREE.IcosahedronGeometry(0.17, 0).translate(x, y + 0.36, z), leaves);
      b.add(new THREE.IcosahedronGeometry(0.13, 0).translate(x + (rnd() - 0.5) * 0.08, y + 0.45, z + (rnd() - 0.5) * 0.08), mat(pick(rnd, FLOWER_COLOURS)));
    }
  }
}

/* --- Shops ---------------------------------------------------------------
   front: 'display' (see-through window, something inside), 'small' (a
   window and a door), 'garage' (roll-up door) or 'mirror' (blue mirror
   glass and sliding doors). The trades with a weight are drawn at random;
   the rest are placed on purpose (FEATURES below, CityLayout FEATURE_LOTS). */
const SHOPS = {
  restaurant: { weight: 0.2, front: 'display', fill: 'tables', names: ['DINER', 'PIZZA', 'NOODLES', 'CAFE', 'BISTRO', 'BURGERS', 'TACOS'] },
  clothing: { weight: 0.13, front: 'display', fill: 'mannequins', names: ['BOUTIQUE', 'SHOES', 'TAILOR', 'DENIM', 'HATS'] },
  garage: { weight: 0.13, front: 'garage', names: ['HARDWARE', 'AUTO PARTS', 'TIRES', 'TOOLS'] },
  mirror: { weight: 0.18, front: 'mirror', names: ['PHARMACY', 'BANK', 'MOBILE', 'OPTICIAN', 'ELECTRONICS'] },
  flowers: { weight: 0.07, front: 'small', names: ['FLOWERS'], sign: SIGN_COLOURS[1], awning: 0x2f6b5a, extra: flowerStands },
  plain: { weight: 0.29, front: 'small', names: ['BAKERY', 'BOOKS', 'LAUNDROMAT', 'PAWN SHOP', 'RADIO', 'GROCERY', 'DELI', 'LIQUOR', 'BARBER'] },
  vet: { front: 'small', names: ['VET CLINIC'], sign: ['#1f7a78', '#ffffff'], icon: 'paw', awning: 0x1f7a78, extra: vetExtras },
  salon: { front: 'display', fill: 'salon', names: ['GLAMOUR SALON'], sign: ['#e86a9a', '#ffffff'], awning: 0xd8648e },
  bar: { front: 'display', fill: 'tables', names: ['THE LUCKY DOG'], sign: ['#151515', '#f2c46a'], icon: 'paw', awning: 0x6a2a2a, extra: outdoorSeating },
};
const RANDOM_SHOPS = Object.entries(SHOPS).filter(([, shop]) => shop.weight);
function pickShop(rnd) {
  let r = rnd();
  for (const [key, shop] of RANDOM_SHOPS) if ((r -= shop.weight) < 0) return key;
  return 'plain';
}

// Main-street features: the first lot on `side` (of x = 0) whose centre lies
// between z0 and z1 gets these shops along its buildings
const FEATURES = [{ side: -1, z0: 2, z1: -40, shops: ['bar', 'salon'] }];
/** Named spots for later: luckyDog, the bar's terrace, where the lady in
    the red dress and her chihuahua will be; vets, each clinic's facade
    { x, z, side } (side: which way along x it faces). */
export const FEATURE_SPOTS = {};

// Restaurants and clothing: a shallow window box, its back wall the shop
// floor (warm-lit at night), something inside, clear glass in front
const DRESSES = [0xc8323a, 0x2a8a8a, 0xd8a43a, 0x1a1a1a, 0xf0ece4];
function displayCase(b, rnd, u, W, fill, night, dark) {
  b.face(u, 1.85, 0.015, W, 2.6, 0.03, night ? mat(0x5a4630, { emissive: 0xffc27a, emissiveIntensity: 0.45 }) : mat(0x2e2a26));
  b.face(u, 0.55, 0.3, W + 0.2, 0.1, 0.6, dark);                                 // sill
  b.face(u, 3.15, 0.3, W + 0.2, 0.12, 0.6, dark);                                // head
  for (const e of [-1, 1]) b.face(u + e * (W / 2 + 0.05), 1.85, 0.3, 0.1, 2.6, 0.6, dark);
  displayPanes.push({ x: b.fx + b.side * 0.58, y: 1.85, z: b.zc + u, sx: 0.03, sy: 2.5, sz: W });
  const at = (out) => b.fx + b.side * out;
  if (fill === 'mannequins') {
    const n = Math.max(1, Math.floor(W / 1.1));
    for (let i = 0; i < n; i++) {
      const z = b.zc + u + (i - (n - 1) / 2) * (W / n);
      b.add(new THREE.ConeGeometry(0.3, 1.1, 8).translate(at(0.3), 1.2, z), mat(pick(rnd, DRESSES)));
      b.add(new THREE.IcosahedronGeometry(0.13, 0).translate(at(0.3), 1.95, z), mat(0xe8dccc));
      b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 5).translate(at(0.3), 1.8, z), mat(0xe8dccc));
    }
  } else if (fill === 'tables') {
    const n = Math.max(1, Math.floor(W / 1.6)), wood = mat(0x7a5a3a);
    for (let i = 0; i < n; i++) {
      const z = b.zc + u + (i - (n - 1) / 2) * (W / n);
      b.add(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 10).translate(at(0.3), 1.3, z), wood);
      b.add(new THREE.CylinderGeometry(0.04, 0.04, 0.68, 5).translate(at(0.3), 0.95, z), mat(IRON));
      for (const e of [-1, 1]) b.box(at(0.3), 1.0, z + e * 0.45, 0.32, 0.06, 0.32, wood);
    }
  } else if (fill === 'salon') {
    const pink = mat(0xd8648e), chrome = mat(0xc8ccd0, { roughness: 0.3, metalness: 0.7 });
    b.face(u, 2.0, 0.035, W * 0.6, 1.1, 0.02, mat(0xcfe6f0, { emissive: 0xcfe6f0, emissiveIntensity: 0.25 })); // the big mirror
    for (const e of [-0.5, 0.5]) {
      const z = b.zc + u + e * W * 0.5;
      b.box(at(0.28), 1.0, z, 0.42, 0.1, 0.42, pink);                           // seat
      b.box(at(0.1), 1.3, z, 0.08, 0.55, 0.42, pink);                           // back
      b.add(new THREE.CylinderGeometry(0.06, 0.12, 0.4, 6).translate(at(0.28), 0.75, z), chrome);
      b.add(new THREE.SphereGeometry(0.26, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(at(0.2), 1.75, z), chrome); // dryer hood
    }
  }
}
// Everyone else: a window beside the door
function smallWindow(b, rnd, u, W, night, dark) {
  b.face(u, 1.85, 0.06, W + 0.24, 1.94, 0.12, dark);
  b.face(u, 1.85, 0.03, W, 1.7, 0.06, night && rnd() < 0.45 ? mat(GLASS, { emissive: 0xffd08a, emissiveIntensity: 0.55, roughness: 0.3 }) : mat(GLASS, { roughness: 0.25, metalness: 0.2 }));
  b.face(u, 0.95, 0.13, W + 0.4, 0.12, 0.26, dark);
}
// Hardware and auto shops: a roll-up door, some stuck half open
function garageFront(b, rnd, fw, dark) {
  const W = fw - 1.4, H = 3.0, bottom = rnd() < 0.4 ? 1.3 : 0;
  const slats = rnd() < 0.3 ? [mat(0x4a6a5a), mat(0x40604f)] : [mat(0x8a9096), mat(0x7a8086)];
  for (const e of [-1, 1]) b.face(e * (W / 2 + 0.1), H / 2, 0.1, 0.2, H, 0.2, dark);
  b.face(0, H + 0.1, 0.1, W + 0.4, 0.2, 0.2, dark);
  b.face(0, H / 2, 0.02, W, H, 0.04, mat(0x0c0c0c));                              // the dark inside
  let k = 0;
  for (let v = H - 0.11; v > bottom + 0.05; v -= 0.22) b.face(0, v, 0.08, W, 0.18, 0.05, slats[k++ & 1]);
  b.face(0, bottom + 0.06, 0.1, W, 0.1, 0.08, dark);                              // bottom rail
}
function door(b, u) { b.face(u, 1.2, 0.03, 1.2, 2.4, 0.06, mat(0x1c1a18)); }

// The vet: a bench, a water bowl and a sign out front
function vetExtras(b, rnd, fw) {
  const wood = mat(0x7a5a3a), at = (out) => b.fx + b.side * out;
  b.box(at(1.0), 0.45, b.zc - fw * 0.2, 0.4, 0.06, 1.6, wood);
  b.box(at(0.82), 0.7, b.zc - fw * 0.2, 0.05, 0.4, 1.6, wood);
  b.add(new THREE.CylinderGeometry(0.16, 0.13, 0.07, 10).translate(at(1.2), 0.04, b.zc + fw * 0.15), mat(0x3a6ab0));
  aFrame(b, at(1.3), b.zc + fw * 0.3, 'PETS', 'WELCOME', '#1f7a78');
  (FEATURE_SPOTS.vets ||= []).push({ x: b.fx, z: b.zc, side: b.side });
}
// A chalkboard A-frame sign on the sidewalk
function aFrame(b, x, z, line1, line2, colour = '#1a1a1a') {
  const key = `a:${line1}${line2}${colour}`;
  if (!signTextures.has(key)) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = colour; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#c8a878'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 120);
    g.fillStyle = '#f4efe4'; g.font = 'bold 22px Arial, sans-serif'; g.textAlign = 'center';
    g.fillText(line1, 64, 50, 110); g.fillText(line2, 64, 78, 110);
    paw(g, 64, 100, 7);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    signTextures.set(key, tex);
  }
  const board = mat(0xffffff, { map: signTextures.get(key) });
  for (const e of [-1, 1]) b.add(new THREE.BoxGeometry(0.04, 0.75, 0.55).rotateZ(e * 0.2).translate(x + e * 0.08, 0.38, z), board);
}

// The Lucky Dog's terrace: tables and parasols, festoon lights, the
// chalkboard, and what was left behind when everyone ran
function outdoorSeating(b, rnd, fw, night) {
  const wood = mat(0x7a5a3a), iron = mat(IRON), at = (out) => b.fx + b.side * out;
  const parasols = [mat(0xa83a32), mat(0xf0ece4)];
  const chair = (x, z, facing, knocked) => {
    const parts = [new THREE.BoxGeometry(0.42, 0.05, 0.42).translate(0, 0.45, 0), new THREE.BoxGeometry(0.42, 0.45, 0.05).translate(0, 0.7, -0.19),
      new THREE.BoxGeometry(0.05, 0.45, 0.05).translate(-0.18, 0.22, 0.18), new THREE.BoxGeometry(0.05, 0.45, 0.05).translate(0.18, 0.22, 0.18),
      new THREE.BoxGeometry(0.05, 0.45, 0.05).translate(-0.18, 0.22, -0.18), new THREE.BoxGeometry(0.05, 0.45, 0.05).translate(0.18, 0.22, -0.18)];
    let g = mergeGeometries(parts.map((p) => p.toNonIndexed())).rotateY(facing);
    if (knocked) g = g.rotateX(Math.PI / 2).translate(0, 0.22, 0);
    b.add(g.translate(x, 0, z), iron);
  };
  let i = 0, knockedLeft = 2;
  for (let u = -fw / 2 + 1.3; u <= fw / 2 - 1.2; u += 2.5) for (const out of [2.3, 4.6]) {
    const x = at(out), z = b.zc + u;
    b.add(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 12).translate(x, 0.75, z), wood);
    b.add(new THREE.CylinderGeometry(0.05, 0.08, 0.72, 6).translate(x, 0.37, z), iron);
    for (const e of [-1, 1]) {
      const knocked = knockedLeft > 0 && rnd() < 0.3;
      if (knocked) knockedLeft--;
      chair(x, z + e * 0.8, e > 0 ? Math.PI : 0, knocked);
    }
    if (i++ % 2 === 0) {
      b.add(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 5).translate(x, 1.2, z), iron);
      b.add(new THREE.ConeGeometry(1.35, 0.45, 8).translate(x, 2.35, z), parasols[(i >> 1) & 1]);
    }
  }
  // Festoon lights from two posts at the kerb back to the awning
  const bulb = mat(0xfff0c0, { emissive: 0xffc070, emissiveIntensity: night ? 1.6 : 0.15 });
  for (const e of [-1, 1]) {
    const pu = e * (fw / 2 - 0.4);
    b.add(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 5).translate(at(6.0), 1.6, b.zc + pu), iron);
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, out = 1.6 + t * 4.4, y = 3.15 - Math.sin(t * Math.PI) * 0.35;
      b.add(new THREE.IcosahedronGeometry(0.06, 0).translate(at(out), y, b.zc + pu), bulb);
    }
  }
  aFrame(b, at(1.2), b.zc + fw / 2 - 0.6, 'DOGS', 'WELCOME');
  // Left behind: a dog bowl under the first table, a dropped red handbag
  b.add(new THREE.CylinderGeometry(0.15, 0.12, 0.07, 10).translate(at(2.65), 0.04, b.zc - fw / 2 + 1.3), mat(0x3a6ab0));
  b.box(at(3.4), 0.13, b.zc - fw / 2 + 2.2, 0.32, 0.22, 0.12, mat(0xc8323a));
  b.add(new THREE.TorusGeometry(0.09, 0.015, 4, 10, Math.PI).translate(at(3.4), 0.24, b.zc - fw / 2 + 2.2), mat(0xc8323a));
  FEATURE_SPOTS.luckyDog = { x: at(3.4), z: b.zc };
}

// kind: a SHOPS key, or 'lobby' (an office: mirror glass, no sign)
function shopfront(b, rnd, fw, night, kind, far) {
  const dark = mat(pick(rnd, PALETTE.darkTrim));
  const shop = kind === 'lobby' ? { front: 'mirror' } : SHOPS[kind];
  b.face(0, 3.25, 0.06, fw - 0.4, 0.14, 0.12, dark);                       // header
  if (shop.front !== 'garage') b.face(0, 0.25, 0.05, fw - 0.6, 0.5, 0.1, dark); // kick plate
  const doorU = (fw / 2 - 0.9) * (rnd() < 0.5 ? -1 : 1), e = Math.sign(doorU);
  // The stretch of frontage beside the door
  const from = -e * (fw / 2 - 0.35), to = doorU - e * 0.8, sideU = (from + to) / 2, sideW = Math.abs(to - from);
  if (far) {
    b.face(sideU, 1.85, 0.04, sideW, 2.6, 0.08, mat(GLASS, { roughness: 0.25, metalness: 0.2 }));
    door(b, doorU);
    return;
  }
  if (shop.front === 'mirror') {
    b.mirrorFace(sideU, 1.85, 0.04, sideW, 2.6, 0.08);
    b.face(doorU, DOOR_H / 2, 0.012, DOOR_W * 2 + 0.2, DOOR_H, 0.02, mat(0x0e1214)); // dark lobby behind the doors
    b.face(doorU, DOOR_H + 0.1, 0.07, DOOR_W * 2 + 0.3, 0.2, 0.14, dark);            // door head
    b.slidingDoor(doorU);
  } else if (shop.front === 'garage') {
    garageFront(b, rnd, fw, dark);
  } else if (shop.front === 'display') {
    displayCase(b, rnd, sideU, sideW, shop.fill, night, dark);
    door(b, doorU);
  } else {
    smallWindow(b, rnd, sideU, Math.min(sideW - 0.4, 1.8), night, dark);
    door(b, doorU);
  }
  if (kind === 'lobby') return;
  const tex = signTexture(pick(rnd, shop.names), shop.sign || pick(rnd, SIGN_COLOURS), shop.icon);
  b.face(0, 3.75, 0.12, Math.min(fw - 0.6, 7), 0.85, 0.16, mat(0xffffff, { map: tex, emissive: night ? 0xffffff : 0, emissiveIntensity: night ? 0.5 : 0 }));
  shop.extra?.(b, rnd, fw, night);
  if (shop.awning !== undefined || rnd() < (shop.front === 'garage' ? 0.2 : 0.7)) {
    // Awning, sloping down toward the street, with a valance at its edge
    const colour = mat(shop.awning ?? pick(rnd, PALETTE.awning));
    const awn = new THREE.BoxGeometry(1.7, 0.08, fw - 0.6).rotateZ(-0.38 * b.side)
      .translate(b.fx + b.side * 0.82, 3.0, b.zc);
    b.add(awn, colour);
    b.face(0, 2.62, 1.62, fw - 0.6, 0.3, 0.05, colour);
  }
}

// Fire escape zigzag over part of the facade, storey by storey
function fireEscape(b, u0, storeys, iron) {
  for (let s = 1; s < storeys; s++) {
    const v = GROUND + (s - 1) * STOREY;
    b.face(u0, v, 0.55, 3.0, 0.07, 1.0, iron);                      // landing
    b.face(u0, v + 0.5, 1.03, 3.0, 0.9, 0.04, iron);                // rail panel
    if (s < storeys - 1) {
      const dir = s % 2 ? 1 : -1, rise = STOREY, run = 2.4;
      const stair = new THREE.BoxGeometry(0.55, 0.06, Math.hypot(rise, run)).rotateX(-dir * Math.atan2(rise, run))
        .translate(b.fx + b.side * 0.55, v + rise / 2, b.zc + u0);
      b.add(stair, iron);
    }
  }
  b.face(u0, GROUND - 1.2, 0.55, 0.06, 2.2, 0.06, iron);            // drop ladder
}

function waterTank(b, x, y, z) {
  const wood = mat(TANK), iron = mat(IRON);
  for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) b.box(x + dx, y + 0.6, z + dz, 0.12, 1.2, 0.12, iron);
  b.add(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 10).translate(x, y + 2.3, z), wood);
  b.add(new THREE.ConeGeometry(1.25, 0.8, 10).translate(x, y + 3.8, z), iron);
}

function roofKit(b, rnd, top, depth, fw, type) {
  // Roof clutter sits back from the facade so it reads in silhouette
  const back = (k) => b.fx - b.side * depth * k;
  const metal = mat(METAL, { roughness: 0.6, metalness: 0.3 });
  for (let i = 0, n = 1 + Math.floor(rnd() * 3); i < n; i++) {
    b.box(back(0.3 + rnd() * 0.4), top + 0.45, b.zc + (rnd() - 0.5) * fw * 0.6, 1.6, 0.9, 1.2, metal);
  }
  if (rnd() < 0.6) b.box(back(0.55), top + 1.2, b.zc + (rnd() - 0.5) * fw * 0.3, 2.4, 2.4, 2.6, mat(pick(rnd, PALETTE.stone))); // stair bulkhead
  if ((type === 'walkup' || type === 'apartment') && rnd() < 0.6) waterTank(b, back(0.5), top, b.zc + (rnd() - 0.5) * fw * 0.4);
  if (type === 'office' && rnd() < 0.5) b.box(back(0.5), top + 3, b.zc, 0.12, 6, 0.12, mat(IRON)); // antenna
}

// Lot plan: how many buildings share the frontage, and how wide each is
function splitFrontage(rnd, d, atLeast = 1) {
  let n = d < 10 ? 1 : d < 14 ? (rnd() < 0.6 ? 2 : 1) : (rnd() < 0.55 ? 2 : 3);
  n = Math.max(n, Math.min(atLeast, Math.floor(d / 4.5)));
  const weights = Array.from({ length: n }, () => 0.7 + rnd() * 0.6);
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / sum) * d);
}

const DOWNTOWN_TYPES = ['walkup', 'walkup', 'office', 'apartment', 'hotel', 'corner'];
let lastType = null;

function buildOne(b, rnd, fw, depth, lotH, night, far, shopKind) {
  let type = pick(rnd, DOWNTOWN_TYPES);
  if (type === lastType) type = pick(rnd, DOWNTOWN_TYPES);
  if (lotH > 34 && rnd() < 0.5) type = rnd() < 0.7 ? 'office' : 'hotel'; // the tall lots get the towers
  if (shopKind && type === 'office') type = 'walkup'; // a chosen shop needs a shop floor, not a lobby
  lastType = type;
  const storeys = {
    walkup: 4 + Math.floor(rnd() * 3), office: 8 + Math.floor(rnd() * 6), apartment: 5 + Math.floor(rnd() * 4),
    hotel: 9 + Math.floor(rnd() * 4), corner: 1 + Math.floor(rnd() * 2),
  }[type];
  const H = GROUND + storeys * STOREY;
  const wall = type === 'walkup' ? pick(rnd, PALETTE.brick) : type === 'office' ? pick(rnd, PALETTE.stone)
    : type === 'hotel' ? pick(rnd, [...PALETTE.brick, ...PALETTE.stone]) : pick(rnd, PALETTE.plaster);
  const wallMat = mat(wall);
  const trim = mat(type === 'office' ? pick(rnd, PALETTE.darkTrim) : pick(rnd, PALETTE.trim));
  // Body: the full lot depth, so neighbours of different heights show real side walls
  b.box(b.fx - b.side * depth / 2, H / 2, b.zc, depth, H, fw, wallMat);
  // Pilasters at the edges keep neighbouring buildings visibly separate
  for (const e of [-1, 1]) b.face(e * (fw / 2 - 0.25), H / 2, 0.06, 0.5, H, 0.12, type === 'office' ? trim : wallMat);
  shopfront(b, rnd, fw, night, type === 'office' ? 'lobby' : shopKind || pickShop(rnd), far);
  b.face(0, GROUND - 0.1, 0.08, fw, 0.25, 0.16, trim); // band over the shops

  const glass = () => {
    const r = rnd();
    if (r < 0.1) return mat(BROKEN, { roughness: 1 });  // smashed in the quake
    if (night && r < 0.3) return mat(0x3a3020, { emissive: 0xffc27a, emissiveIntensity: 0.9 });
    return mat(GLASS, { roughness: 0.25, metalness: 0.2 });
  };
  if (type === 'office') {
    // Ribbon windows: a glass band per storey between deep spandrels, mullions on top
    for (let s = 0; s < storeys; s++) {
      const v = GROUND + s * STOREY + 1.8;
      b.face(0, v, 0.03, fw - 1.0, 1.0, 0.06, glass());
      for (let m = -fw / 2 + 1.5; m < fw / 2 - 1; m += 1.5) b.face(m, v, 0.07, 0.1, 1.0, 0.08, trim);
      b.face(0, GROUND + s * STOREY + 0.35, 0.05, fw - 0.6, 0.12, 0.1, trim);
    }
  } else {
    // Half as many windows as a bay-per-window facade: more wall between them
    const bay = (type === 'apartment' ? 3.0 : 2.5) * 1.9;
    const cols = Math.max(1, Math.floor((fw - 1.4) / bay));
    const ww = type === 'corner' ? 1.6 : 1.05, wh = type === 'hotel' ? 1.5 : 1.65;
    const look = { trim, glass, lintel: type === 'walkup' ? trim : null, far };
    for (let s = 0; s < storeys; s++) {
      const v = GROUND + s * STOREY + 1.7;
      for (let c = 0; c < cols; c++) {
        const u = (c - (cols - 1) / 2) * bay;
        windowAt(b, u, v, ww, wh, look);
        if (type === 'apartment') {
          b.face(u, v - 1.65, 0.55, 2.3, 0.15, 1.1, trim);                 // balcony slab
          b.face(u, v - 1.15, 1.07, 2.3, 0.85, 0.05, mat(IRON));           // railing
        }
      }
    }
    if (!far && type === 'walkup' && rnd() < 0.65 && fw > 5.5) fireEscape(b, (rnd() < 0.5 ? -1 : 1) * Math.min(1.2, fw / 2 - 1.8), storeys + 1, mat(IRON));
  }
  // Top: heavy cornice on the walk-ups and hotels, a parapet elsewhere
  if (type === 'walkup' || type === 'hotel') {
    if (rnd() > 0.12) b.face(0, H - 0.3, 0.3, fw + 0.3, 0.55, 0.6, trim); // a few lost theirs in the quake
    b.face(0, H - 1.0, 0.12, fw, 0.22, 0.24, trim);
  } else {
    b.face(0, H + 0.4, -0.15, fw, 0.8, 0.3, type === 'office' ? trim : wallMat);
  }
  b.box(b.fx - b.side * depth / 2, H + 0.05, b.zc, depth - 0.4, 0.1, fw - 0.4, mat(ROOF));
  if (type === 'hotel') {
    // Vertical blade sign and an entrance canopy
    const tex = verticalSignTexture('HOTEL');
    b.add(new THREE.BoxGeometry(1.3, 7, 0.35).translate(b.fx + b.side * 0.75, H - 4.5, b.zc + fw / 2 - 1),
      mat(0xffffff, { map: tex, emissive: night ? 0xffffff : 0, emissiveIntensity: night ? 0.9 : 0 }));
    b.face(0, 3.4, 1.3, Math.min(fw - 1, 4), 0.2, 2.6, trim);
  }
  if (type === 'office' && rnd() < 0.6) {
    // Setback top tier
    const th = 2 * STOREY, td = depth * 0.6, tf = fw * 0.7;
    b.box(b.fx - b.side * (depth / 2 + 0.8), H + th / 2, b.zc, td, th, tf, wallMat);
    if (!far) roofKit(b, rnd, H + th, depth, tf, type);
  } else {
    if (!far) roofKit(b, rnd, H, depth, fw, type);
  }
  return H;
}

/** Builds the stylised buildings on one street lot (centre x, z; w deep from
    the street, d along it, h the old box's height) and gives the lot its
    collider and camera blockers. Returns the group.
    face: which way along x the facade looks (default: toward x = 0, the
    main street). collider: false for lots out of reach. far: lighter
    detail and no shadows, for the town past the edge. shops: SHOPS keys
    for the lot's buildings, in order (the rest are drawn at random). */
export function buildKitBuilding(x, z, w, h, d, { face, collider = true, far = false, shops } = {}) {
  const rnd = seeded(Math.round(x * 73.1) ^ Math.round(z * 131.7) ^ 0xC17E);
  const night = state.timeOfDay === 'night';
  const side = face ?? (x > 0 ? -1 : 1);
  if (!shops && face === undefined) { // a main-street lot: is it a feature's?
    const f = FEATURES.find((ft) => !ft.used && Math.sign(x) === ft.side && z <= ft.z0 && z >= ft.z1);
    if (f) { f.used = true; shops = f.shops; }
  }
  const facadeX = x + side * w / 2;
  const group = new THREE.Group();
  let z0 = z - d / 2, n = 0;
  for (const fw of splitFrontage(rnd, d, shops?.length || 1)) {
    const zc = z0 + fw / 2;
    z0 += fw;
    const depth = w * (0.82 + rnd() * 0.18);
    const b = new Builder(facadeX, side, zc);
    const H = buildOne(b, rnd, fw, depth, h, night, far, shops?.[n++]);
    b.finish(group, !far);
    if (!collider) continue;
    // Camera blocker for this building: a plain box, indexed like baked scenery
    const occ = new THREE.Mesh(new THREE.BoxGeometry(depth, H, fw));
    occ.position.set(facadeX - side * depth / 2, H / 2, zc);
    occ.updateMatrixWorld(true);
    occ.userData.sceneryMerged = true;
    state.occluders.push(occ);
  }
  scene.add(group);
  if (collider) addStaticBox(w / 2, h / 2, d / 2, x, h / 2, z);
  return group;
}
