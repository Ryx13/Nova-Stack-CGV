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

   Districts (DISTRICTS below) choose the building types, colours, shop
   mix and how much is lit at night: downtown (Level 1) is walk-ups,
   offices, apartments and a hotel; the harbour (Level 2) is mostly two or
   three storeys, pitched tile roofs and shutters, brick terraces with
   their gables to the street, and warehouses toward the port, full of
   seafood restaurants, pubs and sushi bars.

   Built in world space and merged per material, one mesh each per
   building; mergeStatic.js then folds the whole street into a few chunks.
   Flat shading and plain colours: the stylised low-poly look.
   Detail draws come from each lot's own RNG, never the shared rnd(), so
   the rest of the street still lands exactly where it did.
====================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, renderer, lighting, addStaticBox, rowX, STREET_HALF_W } from './Scene.js';
import { state } from './state.js';
import { SIDEWALK, layout } from './CityLayout.js';

const STOREY = 3.2;
const GROUND = 4.2; // shop storey

const PALETTE = {
  brick: [0x9a4a3a, 0x8a5a44, 0xa86a4a, 0x7a3e34, 0x94543c],
  stone: [0xb8ad98, 0xc9bfa8, 0x9c968a, 0xa8a090],
  plaster: [0xd9c9a3, 0xc98f6a, 0x9fb0a8, 0xd6b27a, 0xb7c2c8, 0xc7a8a0],
  trim: [0xe8e2d4, 0xd8d0bc],
  darkTrim: [0x3e3a36, 0x2f3a40],
  awning: [0x2f6b5a, 0xa83a32, 0x2e4a7a, 0xd8a43a, 0x6a3a5a],
  // The harbour's colours: sun-faded pastels, harbour brick, tile and slate
  pastel: [0xe8d9b8, 0x9fc4c8, 0xe0a88c, 0xd8c27a, 0xb8c8d8, 0xf0ece4, 0xc8b8d8],
  harbourBrick: [0x8a4a3a, 0x7a5a4a, 0x9a5a44],
  roofTile: [0xa8553a, 0x8a4a3a, 0x4a5058, 0x5a5e62],
  shutter: [0x2f6b5a, 0x2e4a7a, 0xa83a32, 0x3a6a8a, 0x6a8a5a],
  // The headland's works, in the quarantine compound's own greys and
  // teal-greys (Level3Quarantine.js), so they read as more of the facility
  panel: [0x6f8582, 0x7a8584, 0x5e6a72, 0x8a9494],
  sheet: [0x52686a, 0x6a7a7c, 0x5a6668, 0x7a8486],
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
      envMapIntensity: 0.5, // the sky's bounce light shouldn't wash out the sun's shadows
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
   sliding doors that slide apart as the player walks up, and now and then a
   thin ray of sunshine sweeps across it (see glint below). The glass really
   reflects: a reflection probe (a cube camera) renders the scene from just
   in front of the mirror nearest the player a few times a second, so the
   mirrors show what's actually in front of them, lit as it is (a vending
   machine's glowing screen, the streetlights, the player), and anything
   standing in front blocks what's behind it. Mirrors further off reuse the
   last capture. All the glass is one instanced mesh, built on the first
   update. */
const PROBE_EVERY = 0.3, PROBE_REACH = 45; // s between captures; only near a mirror
let mirrorMaterial = null, probe = null, probeTimer = 0;
/* A ray of sunshine across the glass: now and then a thin diagonal band of
   light travels across every pane at once, as if the sun had just caught
   it, tinted the sun's colour (a pale glint at night). It runs in each
   pane's own coordinates, on the glass's surface, so whatever stands in
   front of a mirror still covers it. At least twice a play at random,
   very different times, then every few minutes. */
const glint = { at: -9, colour: new THREE.Color(), next: [], clock: 0 };
const GLINT_TIME = 1.4; // s for the band to cross a pane
function planGlints() {
  const first = 20 + Math.random() * 60;
  glint.next = [first, first + 70 + Math.random() * 80];
  glint.clock = 0;
}
planGlints();
const glintUniforms = { uGlint: { value: -9 }, uGlintColour: { value: glint.colour } };
function mirror() {
  if (mirrorMaterial) return mirrorMaterial;
  const target = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  probe = new THREE.CubeCamera(0.3, 160, target);
  const m = new THREE.MeshStandardMaterial({ color: 0x7fb4e0, metalness: 1, roughness: 0.05, envMap: target.texture, envMapIntensity: 1.1 });
  const base = THREE.Material.prototype.onBeforeCompile; // keep the global hooks (HeightMist)
  m.onBeforeCompile = (shader, r) => {
    base.call(m, shader, r);
    Object.assign(shader.uniforms, glintUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlintLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlintLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlintLocal;\nuniform float uGlint;\nuniform vec3 uGlintColour;')
      .replace('#include <opaque_fragment>', `
        // the pane's own unit box: z along the glass, y up; a thin diagonal band
        float glintD = abs(vGlintLocal.z + vGlintLocal.y * 0.7 - uGlint);
        outgoingLight += uGlintColour * ((1.0 - smoothstep(0.0, 0.04, glintD)) + 0.3 * (1.0 - smoothstep(0.0, 0.14, glintD)));
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'citykit-mirror-glint';
  mirrorMaterial = m;
  return m;
}
// Advance the ray: count play time, start a sweep when one is due
function updateGlint(dt) {
  if (!state.readyShown || state.cinematic || state.paused) return; // only while you can see it
  glint.clock += dt;
  if (glint.at < -1.5 && glint.next.length && glint.clock >= glint.next[0]) {
    glint.next.shift();
    if (!glint.next.length) glint.next.push(glint.clock + 120 + Math.random() * 120); // then every few minutes
    glint.at = -1.1;
    const sun = lighting.sun;
    if (sun.intensity > 0.2) glint.colour.copy(sun.color).multiplyScalar(Math.min(2.2, 0.9 + sun.intensity * 0.5));
    else glint.colour.setHex(0x9fc4ff).multiplyScalar(0.9);
  }
  if (glint.at >= -1.5) {
    glint.at += dt * (2.2 / GLINT_TIME);
    if (glint.at > 1.1) glint.at = -9; // done: off until the next one
  }
  glintUniforms.uGlint.value = glint.at;
}
/** A level restart: a fresh pair of random rays for the new run. */
export function resetCityKit() { planGlints(); glint.at = -9; }
// Put the probe in front of the mirror nearest the player; false if none is near
function placeProbe(playerPos) {
  let best = null, bestD = PROBE_REACH;
  for (const m of [...mirrorPanes, ...slidingDoors]) {
    const d = Math.hypot(playerPos.x - m.x, playerPos.z - m.z);
    if (d < bestD) { bestD = d; best = m; }
  }
  if (!best) return false;
  probe.position.set(best.x + best.side * 3, 1.7, best.z);
  probe.updateMatrixWorld();
  return true;
}
// Render the scene into the probe: all six faces, or just `face` (0-5)
function renderProbe(face) {
  doorMesh.visible = false; // the glass mustn't reflect itself
  const autoShadows = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false; // reuse this frame's shadow maps
  if (face === undefined) probe.update(renderer, scene);
  else {
    // One face of what CubeCamera.update does for all six
    if (probe.coordinateSystem !== renderer.coordinateSystem) { probe.coordinateSystem = renderer.coordinateSystem; probe.updateCoordinateSystem(); }
    const target = probe.renderTarget, prev = [renderer.getRenderTarget(), renderer.getActiveCubeFace(), renderer.getActiveMipmapLevel()];
    const xr = renderer.xr.enabled, mips = target.texture.generateMipmaps;
    renderer.xr.enabled = false;
    target.texture.generateMipmaps = face === 5; // mipmaps once the whole cube is in
    renderer.setRenderTarget(target, face);
    renderer.render(scene, probe.children[face]);
    target.texture.generateMipmaps = mips;
    renderer.setRenderTarget(...prev);
    renderer.xr.enabled = xr;
    // The glass switches to the new reflection only once all six are fresh
    if (face === 5) target.texture.needsPMREMUpdate = true;
  }
  renderer.shadowMap.autoUpdate = autoShadows;
  doorMesh.visible = true;
}
let probeFace = -1; // spread captures: the next face to render, -1 between captures
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
/** Every frame (a level's tick): reflections, and doors opening for the player. */
/** spreadFaces: capture one cube face a frame (six frames a capture) instead
    of all six in one frame, so the cost never lands as a single spike. */
export function updateCityKit(dt, playerPos, { spreadFaces = false } = {}) {
  if (!mirrorPanes.length && !slidingDoors.length && !displayPanes.length) return;
  if (!doorMesh) buildMirrorMesh();
  if (probeFace >= 0) { renderProbe(probeFace); probeFace = probeFace < 5 ? probeFace + 1 : -1; }
  else if (playerPos && (probeTimer -= dt) <= 0) {
    probeTimer = PROBE_EVERY;
    if (placeProbe(playerPos)) {
      if (spreadFaces) { renderProbe(0); probeFace = 1; } else renderProbe();
    }
  }
  updateGlint(dt);
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
  // D: the district (DISTRICTS); walk: the sidewalk's width in front
  constructor(facadeX, side, zc, D, walk) { this.fx = facadeX; this.side = side; this.zc = zc; this.D = D; this.walk = walk; this.parts = new Map(); }
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
    mirrorPanes.push({ x: this.fx + this.side * out, y: v, z: this.zc + u, sx: sn, sy: sv, sz: su, side: this.side });
  }
  slidingDoor(u) {
    slidingDoors.push({ x: this.fx + this.side * 0.06, y: DOOR_H / 2, z: this.zc + u, open: 0, side: this.side });
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
  if (look.shutters) for (const e of [-1, 1]) b.face(u + e * (ww / 2 + 0.36), v, 0.08, 0.5, wh + 0.1, 0.05, look.shutters);
  b.face(u, v, 0.03, ww, wh, 0.06, look.glass());
  if (look.far) return; // past the edge of the town: frame and glass only
  b.face(u, v - wh / 2 - 0.16, 0.13, ww + 0.4, 0.12, 0.26, look.trim);
  if (look.lintel) b.face(u, v + wh / 2 + 0.2, 0.08, ww + 0.34, 0.22, 0.16, look.lintel);
}

// Sidewalk spots taken by something else: what a level lists in
// state.kitKeepOff ({ x, z, r }: its vending machines, props) and the
// bridge's stair towers. Tables, stands and posts set out by a shop skip them.
function keptOff(x, z, r = 1.2) {
  for (const k of state.kitKeepOff || []) if (Math.hypot(x - k.x, z - k.z) < k.r + r) return true;
  const br = layout().bridge;
  if (br) for (const e of [-1, 1]) if (Math.abs(x - e * (rowX - 1.5)) < 1.5 + r && Math.abs(z - br.z) < 1.5 + r) return true;
  return false;
}

// Flower buckets on tiered stands out on the sidewalk
const FLOWER_COLOURS = [0xe86a9a, 0xf2c84a, 0xd8453a, 0xf0ece4, 0x8a5ab8, 0xf08a3a];
function flowerStands(b, rnd, fw) {
  const stand = mat(0x3f6a3a), pail = mat(0x8a8e90, { roughness: 0.5, metalness: 0.4 }), leaves = mat(0x4f7a3a);
  for (const e of [-1, 1]) {
    const u0 = e * fw * 0.25;
    if (keptOff(b.fx + b.side * 0.75, b.zc + u0, 1.4)) continue;
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
   glass and sliding doors). terrace: may set tables out on the sidewalk.
   Each district weighs which are drawn at random (DISTRICTS below); the
   rest are placed on purpose (FEATURES below, CityLayout featureLots). */
const SHOPS = {
  restaurant: { front: 'display', fill: 'tables', names: ['DINER', 'PIZZA', 'NOODLES', 'CAFE', 'BISTRO', 'BURGERS', 'TACOS'] },
  clothing: { front: 'display', fill: 'mannequins', names: ['BOUTIQUE', 'SHOES', 'TAILOR', 'DENIM', 'HATS'] },
  garage: { front: 'garage', names: ['HARDWARE', 'AUTO PARTS', 'TIRES', 'TOOLS'] },
  mirror: { front: 'mirror', names: ['PHARMACY', 'BANK', 'MOBILE', 'OPTICIAN', 'ELECTRONICS'] },
  flowers: { front: 'small', names: ['FLOWERS'], sign: SIGN_COLOURS[1], awning: 0x2f6b5a, extra: flowerStands },
  plain: { front: 'small', names: ['BAKERY', 'BOOKS', 'LAUNDROMAT', 'PAWN SHOP', 'RADIO', 'GROCERY', 'DELI', 'LIQUOR', 'BARBER'] },
  // The harbour's trades
  seafood: { front: 'display', fill: 'tables', terrace: true, names: ['FISH & CHIPS', 'CRAB SHACK', 'SEAFOOD', 'LOBSTER POT', 'OYSTER BAR', 'TAPAS', 'RAMEN', 'GELATO', 'CAFE'] },
  pub: { front: 'display', fill: 'tables', terrace: true, sign: ['#2a1a10', '#e8c87a'], names: ['THE ANCHOR', 'HARBOUR TAVERN', 'SALTY SAILOR', 'THE LIGHTHOUSE', 'DOCKSIDE BAR', 'RUM & ROPE'] },
  sushi: { front: 'display', fill: 'tables', terrace: true, sign: ['#c8323a', '#ffffff'], noAwning: true, extra: sushiFront, names: ['SUSHI', 'SUSHI BAR', 'NAMI SUSHI', 'SUSHI GO'] },
  marine: { front: 'small', names: ['BAIT & TACKLE', 'CHANDLERY', 'SURF SHOP', 'ICE CREAM', 'NEWSAGENT', 'SOUVENIRS'] },
  boatyard: { front: 'garage', names: ['BOAT REPAIR', 'MARINE PARTS', 'OUTBOARDS'] },
  // The headland's works
  works: { front: 'garage', noAwning: true, sign: ['#263b40', '#cf9c45'], names: ['HEADLAND POWER', 'COOLING WORKS', 'GRID SUBSTATION', 'TURBINE HALL', 'NORTH PIER FREIGHT', 'MAINTENANCE'] },
  siteoffice: { front: 'small', noAwning: true, sign: ['#b5c0b9', '#263b40'], names: ['SITE OFFICE', 'SECURITY', 'CANTEEN', 'FIRST AID', 'STORES'] },
  vet: { front: 'small', names: ['VET CLINIC'], sign: ['#1f7a78', '#ffffff'], icon: 'paw', awning: 0x1f7a78, extra: vetExtras },
  salon: { front: 'display', fill: 'salon', names: ['GLAMOUR SALON'], sign: ['#e86a9a', '#ffffff'], awning: 0xd8648e },
  bar: { front: 'display', fill: 'tables', names: ['THE LUCKY DOG'], sign: ['#151515', '#f2c46a'], icon: 'paw', awning: 0x6a2a2a, extra: outdoorSeating },
};
function pickShop(rnd, weights) {
  let r = rnd();
  for (const [key, w] of Object.entries(weights)) if ((r -= w) < 0) return key;
  return Object.keys(weights)[0];
}

/* --- Districts --------------------------------------------------------- */
const rint = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const DISTRICTS = {
  downtown: {
    types: ['walkup', 'walkup', 'office', 'apartment', 'hotel', 'corner'],
    towers: true, // the tall lots get offices and hotels
    storeys: { walkup: (r) => rint(r, 4, 6), office: (r) => rint(r, 8, 13), apartment: (r) => rint(r, 5, 8), hotel: (r) => rint(r, 9, 12), corner: (r) => rint(r, 1, 2) },
    shops: { restaurant: 0.2, clothing: 0.13, garage: 0.13, mirror: 0.18, flowers: 0.07, plain: 0.29 },
    litWindows: 0.2, broken: 0.1, litShops: 0.45, signsLit: 1,
  },
  harbour: {
    types: ['townhouse', 'townhouse', 'terrace', 'shophouse', 'shophouse', 'townhouse', 'harbourhotel'],
    storeys: { townhouse: (r) => rint(r, 2, 3), terrace: (r) => rint(r, 2, 3), shophouse: (r) => rint(r, 1, 2), warehouse: () => 2, harbourhotel: (r) => rint(r, 3, 4) },
    shops: { seafood: 0.28, pub: 0.17, sushi: 0.12, marine: 0.15, clothing: 0.07, mirror: 0.06, flowers: 0.05, boatyard: 0.05, plain: 0.05 },
    // The grid is dead: a few windows and shops lit by candles and generators
    litWindows: 0.07, broken: 0.06, litShops: 0.25, signsLit: 0.2,
    warehousesSouthOf: -150, // toward the port the blocks are warehouses
  },
  // Level 3: the works round the quarantine compound on the headland
  industrial: {
    types: ['factory', 'factory', 'shed', 'shed', 'warehouse', 'plantoffice'],
    storeys: { factory: () => 2, shed: () => 1, warehouse: () => 2, plantoffice: (r) => rint(r, 3, 4) },
    shops: { works: 0.7, siteoffice: 0.3 },
    litWindows: 0.08, broken: 0.05, litShops: 0.2, signsLit: 0.4,
  },
};

// Main-street features: the first lot on `side` (of x = 0) whose centre lies
// between z0 and z1, or whose frontage covers `covers`, gets these shops
// along its buildings / at least minStoreys
const FEATURES = {
  downtown: [{ side: -1, z0: 2, z1: -40, shops: ['bar', 'salon'] }],
  // Harbour Walk lands on the buildings either side: they need the height
  harbour: [{ side: -1, covers: -86, minStoreys: 3 }, { side: 1, covers: -86, minStoreys: 3 }],
};
/** Named spots for later: luckyDog, the bar's terrace, where the lady in
    the red dress and her chihuahua will be; vets, each clinic's facade
    { x, z, side } (side: which way along x it faces). */
export const FEATURE_SPOTS = {};

// Restaurants and clothing: a shallow window box, its back wall the shop
// floor (warm-lit at night), something inside, clear glass in front
const DRESSES = [0xc8323a, 0x2a8a8a, 0xd8a43a, 0x1a1a1a, 0xf0ece4];
function displayCase(b, rnd, u, W, fill, night, dark) {
  b.face(u, 1.85, 0.015, W, 2.6, 0.03, night && rnd() < b.D.litShops * 1.6 ? mat(0x5a4630, { emissive: 0xffc27a, emissiveIntensity: 0.45 }) : mat(0x2e2a26));
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
  b.face(u, 1.85, 0.03, W, 1.7, 0.06, night && rnd() < b.D.litShops ? mat(GLASS, { emissive: 0xffd08a, emissiveIntensity: 0.55, roughness: 0.3 }) : mat(GLASS, { roughness: 0.25, metalness: 0.2 }));
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

// A sushi bar: red paper lanterns either side of the door, a noren curtain
function sushiFront(b, rnd, fw, night) {
  const lantern = mat(0xd8322a, { emissive: 0xff5a3a, emissiveIntensity: night ? 1.2 : 0.2 }), cord = mat(IRON);
  const at = (out) => b.fx + b.side * out;
  for (const e of [-1, 1]) {
    const z = b.zc + b.doorU + e * 1.1;
    b.add(new THREE.SphereGeometry(0.26, 10, 8).scale(1, 1.3, 1).translate(at(0.55), 2.75, z), lantern);
    b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 4).translate(at(0.55), 3.3, z), cord);
    b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10).translate(at(0.55), 3.12, z), mat(0x1a1a1a));
  }
  const cloth = mat(0x1f2d4a);
  for (let i = 0; i < 4; i++) b.face(b.doorU - 0.48 + i * 0.32, 2.15, 0.1, 0.28, 0.6, 0.02, cloth);
}

// Tables out on the sidewalk, sized to it: parasols and festoon lights to the kerb
function terrace(b, rnd, fw, night, knockedMax = 0) {
  const wood = mat(0x7a5a3a), iron = mat(IRON), at = (out) => b.fx + b.side * out;
  const parasols = [mat(0xa83a32), mat(0xf0ece4), mat(0x2e4a7a)];
  const outs = b.walk >= 5 ? [2.3, 4.6] : [Math.min(1.8, b.walk - 0.9)];
  const chair = (x, z, facing, knocked) => {
    const parts = [new THREE.BoxGeometry(0.42, 0.05, 0.42).translate(0, 0.45, 0), new THREE.BoxGeometry(0.42, 0.45, 0.05).translate(0, 0.7, -0.19),
      new THREE.BoxGeometry(0.05, 0.45, 0.05).translate(-0.18, 0.22, 0.18), new THREE.BoxGeometry(0.05, 0.45, 0.05).translate(0.18, 0.22, 0.18),
      new THREE.BoxGeometry(0.05, 0.45, 0.05).translate(-0.18, 0.22, -0.18), new THREE.BoxGeometry(0.05, 0.45, 0.05).translate(0.18, 0.22, -0.18)];
    let g = mergeGeometries(parts.map((p) => p.toNonIndexed())).rotateY(facing);
    if (knocked) g = g.rotateX(Math.PI / 2).translate(0, 0.22, 0);
    b.add(g.translate(x, 0, z), iron);
  };
  let i = 0, knockedLeft = knockedMax;
  const colour = rint(rnd, 0, parasols.length - 1);
  for (let u = -fw / 2 + 1.3; u <= fw / 2 - 1.2; u += 2.5) for (const out of outs) {
    const x = at(out), z = b.zc + u;
    if (keptOff(x, z, 1.4)) continue;
    b.add(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 12).translate(x, 0.75, z), wood);
    b.add(new THREE.CylinderGeometry(0.05, 0.08, 0.72, 6).translate(x, 0.37, z), iron);
    for (const e of [-1, 1]) {
      const knocked = knockedLeft > 0 && rnd() < 0.3;
      if (knocked) knockedLeft--;
      chair(x, z + e * 0.8, e > 0 ? Math.PI : 0, knocked);
    }
    if (i++ % 2 === 0) {
      b.add(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 5).translate(x, 1.2, z), iron);
      b.add(new THREE.ConeGeometry(1.35, 0.45, 8).translate(x, 2.35, z), parasols[(colour + (i >> 1)) % parasols.length]);
    }
  }
  // Festoon lights from two posts at the kerb back to the awning
  const bulb = mat(0xfff0c0, { emissive: 0xffc070, emissiveIntensity: night ? 1.6 : 0.15 });
  const postOut = b.walk - 0.4;
  for (const e of [-1, 1]) {
    const pu = e * (fw / 2 - 0.4);
    if (keptOff(at(postOut), b.zc + pu, 0.5)) continue;
    b.add(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 5).translate(at(postOut), 1.6, b.zc + pu), iron);
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, out = 1.6 + t * (postOut - 1.6), y = 3.15 - Math.sin(t * Math.PI) * 0.35;
      b.add(new THREE.IcosahedronGeometry(0.06, 0).translate(at(out), y, b.zc + pu), bulb);
    }
  }
}

// The Lucky Dog's terrace: a terrace, the chalkboard, and what was left
// behind when everyone ran
function outdoorSeating(b, rnd, fw, night) {
  terrace(b, rnd, fw, night, 2);
  const at = (out) => b.fx + b.side * out;
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
  b.doorU = doorU;
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
  const signLit = night && rnd() < b.D.signsLit;
  b.face(0, 3.75, 0.12, Math.min(fw - 0.6, 7), 0.85, 0.16, mat(0xffffff, { map: tex, emissive: signLit ? 0xffffff : 0, emissiveIntensity: signLit ? 0.5 : 0 }));
  shop.extra?.(b, rnd, fw, night);
  if (shop.terrace && b.walk >= 2.6 && rnd() < 0.45) terrace(b, rnd, fw, night);
  if (!shop.noAwning && (shop.awning !== undefined || rnd() < (shop.front === 'garage' ? 0.2 : 0.7))) {
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

// A tiled roof. Along the street: the ridge runs parallel to the facade.
// Otherwise the gable faces the street, its triangle filled with wall.
function pitchedRoof(b, depth, fw, H, rise, roof, wall, alongStreet) {
  const over = 0.35, tri = (hw) => { const sh = new THREE.Shape(); sh.moveTo(-hw, 0); sh.lineTo(hw, 0); sh.lineTo(0, rise); sh.lineTo(-hw, 0); return sh; };
  if (alongStreet) {
    const g = new THREE.ExtrudeGeometry(tri(depth / 2 + over), { depth: fw + over * 2, bevelEnabled: false });
    b.add(g.translate(b.fx - b.side * depth / 2, H, b.zc - fw / 2 - over), roof);
  } else {
    // Shape across the frontage, extruded back from the facade: rotateY maps
    // the extrusion (+z) onto +x and the shape's x onto -z
    const g = new THREE.ExtrudeGeometry(tri(fw / 2 + over), { depth: depth + over, bevelEnabled: false }).rotateY(Math.PI / 2);
    b.add(g.translate(b.side > 0 ? b.fx - depth : b.fx - over, H, b.zc), roof);
    const gable = new THREE.ShapeGeometry(tri(fw / 2)).rotateY(Math.PI / 2 * b.side).translate(b.fx + b.side * 0.37, H, b.zc);
    b.add(gable, wall);
  }
}
// A factory's sawtooth roof: teeth along the frontage, each with a glazed
// north light on its vertical face
function sawtoothRoof(b, depth, fw, H, roof, glass) {
  const n = Math.max(2, Math.round(fw / 4)), tw = fw / n, rise = 2.2;
  for (let i = 0; i < n; i++) {
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(tw, 0); sh.lineTo(0, rise); sh.lineTo(0, 0);
    // Shape across the frontage, extruded back from the facade (rotateY maps
    // the extrusion onto +x and the shape's x onto -z)
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }).rotateY(Math.PI / 2);
    const zFace = b.zc - fw / 2 + (i + 1) * tw;
    b.add(g.translate(b.side > 0 ? b.fx - depth : b.fx, H, zFace), roof);
    b.box(b.fx - b.side * depth / 2, H + rise / 2, zFace + 0.03, depth - 0.6, rise - 0.4, 0.05, glass);
  }
}
function chimney(b, rnd, depth, fw, H, rise) {
  const x = b.fx - b.side * depth * (0.35 + rnd() * 0.3), z = b.zc + (rnd() - 0.5) * fw * 0.6;
  b.box(x, H + rise * 0.6 + 0.6, z, 0.7, 1.6 + rise * 0.6, 0.7, mat(pick(rnd, PALETTE.harbourBrick)));
  b.box(x, H + rise * 0.9 + 1.0, z, 0.85, 0.15, 0.85, mat(0x4a4440));
}
const WAREHOUSE_NAMES = ['PIER 7', 'HARBOUR STORES', 'FISH CO.', 'ROPE WORKS', 'ICE HOUSE', 'SAIL LOFT'];
const HARBOUR_TYPES = new Set(['townhouse', 'terrace', 'shophouse', 'warehouse', 'harbourhotel']);
const INDUSTRIAL_TYPES = new Set(['factory', 'shed', 'plantoffice']);
let lastType = null;

function buildOne(b, rnd, fw, depth, lotH, night, far, shopKind, minStoreys = 0) {
  const D = b.D;
  let type = pick(rnd, D.types);
  if (type === lastType) type = pick(rnd, D.types);
  if (D.towers && lotH > 34 && rnd() < 0.5) type = rnd() < 0.7 ? 'office' : 'hotel'; // the tall lots get the towers
  if (D.warehousesSouthOf !== undefined && b.zc < D.warehousesSouthOf && rnd() < 0.6) type = 'warehouse';
  if (shopKind && type === 'office') type = 'walkup'; // a chosen shop needs a shop floor, not a lobby
  if (minStoreys && type === 'shophouse') type = 'townhouse';
  lastType = type;
  const storeys = Math.max(D.storeys[type](rnd), minStoreys);
  const storeyH = type === 'warehouse' || type === 'factory' ? 4.4 : type === 'shed' ? 5 : STOREY;
  const H = GROUND + storeys * storeyH;
  const harbour = HARBOUR_TYPES.has(type), works = INDUSTRIAL_TYPES.has(type);
  const wall = type === 'walkup' ? pick(rnd, PALETTE.brick) : type === 'office' ? pick(rnd, PALETTE.stone)
    : type === 'hotel' ? pick(rnd, [...PALETTE.brick, ...PALETTE.stone])
    : type === 'terrace' || type === 'warehouse' ? pick(rnd, PALETTE.harbourBrick)
    : type === 'harbourhotel' ? pick(rnd, [0xf0ece4, ...PALETTE.pastel])
    : type === 'shed' ? pick(rnd, PALETTE.sheet)
    : type === 'factory' ? pick(rnd, PALETTE.panel)
    : type === 'plantoffice' ? pick(rnd, PALETTE.stone)
    : harbour ? pick(rnd, PALETTE.pastel) : pick(rnd, PALETTE.plaster);
  const wallMat = mat(wall);
  const trim = mat(type === 'office' || type === 'warehouse' || works ? pick(rnd, PALETTE.darkTrim) : pick(rnd, PALETTE.trim));
  // Body: the full lot depth, so neighbours of different heights show real side walls
  b.box(b.fx - b.side * depth / 2, H / 2, b.zc, depth, H, fw, wallMat);
  // Pilasters at the edges keep neighbouring buildings visibly separate
  for (const e of [-1, 1]) b.face(e * (fw / 2 - 0.25), H / 2, 0.06, 0.5, H, 0.12, type === 'office' ? trim : wallMat);
  shopfront(b, rnd, fw, night, type === 'office' ? 'lobby' : shopKind || pickShop(rnd, D.shops), far);
  b.face(0, GROUND - 0.1, 0.08, fw, 0.25, 0.16, trim); // band over the shops

  const glass = () => {
    const r = rnd();
    if (r < D.broken) return mat(BROKEN, { roughness: 1 });  // smashed in the quake
    if (night && r < D.broken + D.litWindows) return mat(0x3a3020, { emissive: 0xffc27a, emissiveIntensity: 0.9 });
    return mat(GLASS, { roughness: 0.25, metalness: 0.2 });
  };
  if (type === 'factory') {
    // High strip windows under the eaves of each tall storey
    for (let s = 0; s < storeys; s++) {
      const v = GROUND + s * storeyH + 2.7;
      b.face(0, v, 0.03, fw - 1.2, 1.1, 0.06, glass());
      for (let m = -fw / 2 + 1.2; m < fw / 2 - 0.8; m += 1.2) b.face(m, v, 0.07, 0.08, 1.1, 0.08, trim);
    }
  } else if (type === 'shed') {
    // Corrugated sheet: vertical ribs up the wall, one small office window
    const rib = mat(wall).color.clone().multiplyScalar(0.82).getHex();
    for (let u = -fw / 2 + 0.3; u < fw / 2 - 0.2; u += 0.6) b.face(u, (GROUND + H) / 2, 0.04, 0.12, H - GROUND, 0.06, mat(rib));
  } else if (type === 'office') {
    // Ribbon windows: a glass band per storey between deep spandrels, mullions on top
    for (let s = 0; s < storeys; s++) {
      const v = GROUND + s * STOREY + 1.8;
      b.face(0, v, 0.03, fw - 1.0, 1.0, 0.06, glass());
      for (let m = -fw / 2 + 1.5; m < fw / 2 - 1; m += 1.5) b.face(m, v, 0.07, 0.1, 1.0, 0.08, trim);
      b.face(0, GROUND + s * STOREY + 0.35, 0.05, fw - 0.6, 0.12, 0.1, trim);
    }
  } else {
    // Half as many windows as a bay-per-window facade: more wall between them
    const bay = (type === 'apartment' ? 3.0 : type === 'warehouse' ? 3.4 : harbour ? 2.6 : 2.5) * 1.9;
    const cols = Math.max(1, Math.floor((fw - 1.4) / bay));
    const ww = type === 'corner' ? 1.6 : type === 'warehouse' ? 1.4 : 1.05;
    const wh = type === 'hotel' ? 1.5 : type === 'warehouse' ? 2.4 : 1.65;
    const shutters = (type === 'townhouse' || type === 'terrace') && !far ? mat(pick(rnd, PALETTE.shutter)) : null;
    const look = { trim, glass, lintel: type === 'walkup' || type === 'warehouse' ? trim : null, far, shutters };
    for (let s = 0; s < storeys; s++) {
      const v = GROUND + s * storeyH + (type === 'warehouse' ? 2.2 : 1.7);
      for (let c = 0; c < cols; c++) {
        const u = (c - (cols - 1) / 2) * bay;
        windowAt(b, u, v, ww, wh, look);
        if (type === 'apartment' || (type === 'townhouse' && s === 0 && !far && rnd() < 0.5)) {
          const deep = type === 'apartment' ? 1.1 : 0.6;
          b.face(u, v - 1.65, deep / 2, 2.3, 0.15, deep, trim);              // balcony slab
          b.face(u, v - 1.15, deep - 0.03, 2.3, 0.85, 0.05, mat(IRON));     // railing
        }
      }
    }
    if (!far && type === 'walkup' && rnd() < 0.65 && fw > 5.5) fireEscape(b, (rnd() < 0.5 ? -1 : 1) * Math.min(1.2, fw / 2 - 1.8), storeys + 1, mat(IRON));
  }
  // Top
  let pitched = 0;
  if (type === 'walkup' || type === 'hotel' || type === 'harbourhotel') {
    if (rnd() > 0.12) b.face(0, H - 0.3, 0.3, fw + 0.3, 0.55, 0.6, trim); // a few lost theirs in the quake
    b.face(0, H - 1.0, 0.12, fw, 0.22, 0.24, trim);
  } else if (type === 'townhouse' || type === 'warehouse' || type === 'terrace' || type === 'shed') {
    pitched = type === 'shed' ? 1.6 : Math.min(type === 'warehouse' ? 3.2 : 4, depth * (type === 'warehouse' ? 0.24 : 0.32));
    pitchedRoof(b, depth, fw, H, pitched, mat(type === 'shed' ? pick(rnd, PALETTE.sheet) : pick(rnd, PALETTE.roofTile)), wallMat, type !== 'terrace');
    b.face(0, H - 0.15, 0.2, fw + 0.1, 0.3, 0.4, trim); // eaves board
  } else if (type === 'factory') {
    pitched = 2.2;
    const lit = night && rnd() < 0.3;
    sawtoothRoof(b, depth, fw, H, mat(pick(rnd, PALETTE.sheet)), lit ? mat(0x3a3020, { emissive: 0xffc27a, emissiveIntensity: 0.7 }) : mat(GLASS, { roughness: 0.3, metalness: 0.2 }));
    b.box(b.fx - b.side * depth / 2, H + 0.05, b.zc, depth - 0.2, 0.1, fw - 0.2, mat(ROOF));
  } else {
    b.face(0, H + 0.4, -0.15, fw, 0.8, 0.3, type === 'office' ? trim : wallMat);
    if (type === 'shophouse' && !far) b.face(0, H + 1.25, -0.35, fw - 0.4, 0.9, 0.04, mat(IRON)); // roof terrace rail
  }
  if (!pitched) b.box(b.fx - b.side * depth / 2, H + 0.05, b.zc, depth - 0.4, 0.1, fw - 0.4, mat(ROOF));
  if (type === 'warehouse' && !far) {
    // Its name painted big across the brick
    const tex = signTexture(pick(rnd, WAREHOUSE_NAMES), ['#e8e0cc', '#5a2a20']);
    b.face(0, H - 1.4, 0.05, Math.min(fw * 0.8, 8), 1.0, 0.04, mat(0xffffff, { map: tex }));
  }
  if (type === 'harbourhotel' && !far) {
    const tex = signTexture(pick(rnd, ['SEAVIEW HOTEL', 'HARBOUR INN', 'THE MOORINGS']), ['#12304a', '#f4efe4']);
    const lit = night && rnd() < 0.5;
    b.face(0, H - 1.7, 0.1, Math.min(fw - 1, 7), 0.9, 0.12, mat(0xffffff, { map: tex, emissive: lit ? 0xffffff : 0, emissiveIntensity: lit ? 0.6 : 0 }));
  }
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
  } else if (pitched) {
    if (!far && (type === 'townhouse' || type === 'terrace')) for (let i = 0, n = rint(rnd, 1, 2); i < n; i++) chimney(b, rnd, depth, fw, H, pitched);
    if (!far && type === 'factory' && rnd() < 0.5) { // a works flue and roof plant
      b.add(new THREE.CylinderGeometry(0.45, 0.55, 7, 10).translate(b.fx - b.side * depth * 0.7, H + 3.5, b.zc + (rnd() - 0.5) * fw * 0.5), mat(pick(rnd, PALETTE.sheet)));
      roofKit(b, rnd, H + 2.2, depth, fw, type);
    }
  } else if (!far) {
    roofKit(b, rnd, H, depth, fw, type);
  }
  return H + pitched;
}

/** Merges kit buildings made after the level's static merge (scenery
    only: e.g. Level 2's view of Level 1's street) into one mesh per
    material, so they cost a few draw calls rather than hundreds. */
export function mergeKitGroups(groups) {
  const byMaterial = new Map();
  for (const g of groups) {
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
      byMaterial.get(o.material).push(geo);
      o.geometry.dispose();
    });
    g.removeFromParent();
  }
  for (const [material, geos] of byMaterial) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

/** Builds the stylised buildings on one street lot (centre x, z; w deep from
    the street, d along it, h the old box's height) and gives the lot its
    collider and camera blockers. Returns the group.
    face: which way along x the facade looks (default: toward x = 0, the
    main street). collider: false for lots out of reach. far: lighter
    detail and no shadows, for the town past the edge. shops: SHOPS keys
    for the lot's buildings, in order (the rest are drawn at random).
    district: a DISTRICTS key (default: the level's, state.cityKit).
    minStoreys: none of its buildings lower than this. */
/** Every main-street lot built, { side, z0 (north edge), z1 }: CityTown.js
    fills a gap where the bridge needs a building to land on. */
export const MAIN_LOTS = [];
export function buildKitBuilding(x, z, w, h, d, { face, collider = true, far = false, shops, district, minStoreys = 0 } = {}) {
  const rnd = seeded(Math.round(x * 73.1) ^ Math.round(z * 131.7) ^ 0xC17E);
  const night = state.timeOfDay === 'night';
  const side = face ?? (x > 0 ? -1 : 1);
  const key = district || (DISTRICTS[state.cityKit] ? state.cityKit : 'downtown'), D = DISTRICTS[key];
  const walk = face === undefined ? rowX - STREET_HALF_W : SIDEWALK; // the main street's sidewalks are wider
  if (face === undefined && !district) MAIN_LOTS.push({ side: Math.sign(x), z0: z + d / 2, z1: z - d / 2 });
  if (!shops && face === undefined && !district) { // a main-street lot: is it a feature's?
    const f = (FEATURES[key] || []).find((ft) => !ft.used && Math.sign(x) === ft.side
      && (ft.covers !== undefined ? ft.covers <= z + d / 2 && ft.covers >= z - d / 2 : z <= ft.z0 && z >= ft.z1));
    if (f) { f.used = true; shops = f.shops; minStoreys = Math.max(minStoreys, f.minStoreys || 0); }
  }
  const facadeX = x + side * w / 2;
  const group = new THREE.Group();
  let z0 = z - d / 2, n = 0;
  for (const fw of splitFrontage(rnd, d, shops?.length || 1)) {
    const zc = z0 + fw / 2;
    z0 += fw;
    const depth = w * (0.82 + rnd() * 0.18);
    const b = new Builder(facadeX, side, zc, D, walk);
    const H = buildOne(b, rnd, fw, depth, h, night, far, shops?.[n++], minStoreys);
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
