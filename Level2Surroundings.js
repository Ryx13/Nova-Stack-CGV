/* ======================================================================
   Level2Surroundings.js — THE LAND AND SEA AROUND THE CITY

   Without this the street floats in haze: its ground slab stops 45 m
   either side of the road and the sky starts there. This adds:
   - One terrain mesh: flat scrubland round the city, rising to a ring
     of mountains behind the start and down both flanks to the coast,
     dipping under the sea along a ragged shoreline south of the port.
   - The sea: one surface out to the horizon, with a scrolling ripple
     normal map so the low sun glints off it.
   - The rest of the city: blocks behind the street-front rows down both
     sides and behind the start, lower and sparser toward the foothills,
     some broken, some collapsed and smoking. Background only: merged
     into a few meshes, no interiors; the ones within walking reach get
     a collider. At night the grid is dead: most blocks are rubble and
     stumps with black windows, and the few towers still standing have
     two to four lit windows each, every one throwing a shaft of light
     down toward the street.

   The playable area (|x| < 80, z -210..70 — the world bounds) stays flat
   and just under the walking surface, so nothing pokes through the
   street and no feet sink into a hill.

   Distance: the world fog is fully opaque by ~460 m and the mountains
   sit 300-900 m out, so the terrain skips the fog and applies its own,
   gentler aerial-perspective haze in the fog's colour — distant ridges
   fade toward the sky instead of vanishing. The camera's far plane is
   pushed out to match (Level 2 only).
====================================================================== */
import * as THREE from 'three';
import { scene, camera, sky, addStaticBox, rowX, STREET_HALF_W } from './Scene.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { state } from './state.js';
import { buildKitBuilding, mergeKitGroups } from './CityKit.js';
import {
  dirtTex, concreteTex, dayFacades, windowTexVariants, planarFacadeUVs, brokenBox,
  FACADE_TILE_W, FACADE_TILE_H, spawnFireEffect, addLitWindows, addLitWindowMeshes,
} from './characters.js';

const SEA_LEVEL = 0.05;
// How far out (past the play area) the back city reaches
const CITY_OUT = 210;
const VIEW_FAR = 1600;
// Playable rectangle — terrain inside it stays flat, under the street
const PLAY = { x: 80, zN: 70, zS: -210 };
// Level 1's street, seen behind the start: Level 2 begins just past Level 1's
// extraction, so a Level 1 z maps to z + L1_SHIFT here (its extraction at
// -196 lands at 52, its spawn at 30 at 278, the lab just past that).
const L1_SHIFT = 248;
const L1_STREET = { halfX: 46, z0: 56, z1: 300 };
const L1_EXTRACT = new THREE.Vector3(0, 0, -196 + L1_SHIFT);
const L1_DEPOT = new THREE.Vector3(46, 0, -118 + L1_SHIFT);
const L1_LAB = new THREE.Vector3(0, 0, L1_STREET.z1 + 12);

/* --- Noise: seeded value noise + fBm + ridged fBm ---------------------- */
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = Float32Array.from({ length: 256 }, rand);
  const lerp = (a, b, t) => a + (b - a) * t;
  const fade = (t) => t * t * (3 - 2 * t);
  const v = (x, z) => vals[perm[(x & 255) + perm[z & 255]]];
  return (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z);
    const u = fade(x - xi), w = fade(z - zi);
    return lerp(lerp(v(xi, zi), v(xi + 1, zi), u), lerp(v(xi, zi + 1), v(xi + 1, zi + 1), u), w);
  };
}
const noise = makeNoise(0x5EED_A11);
function fbm(x, z, oct = 5) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * noise(x * f, z * f); norm += a; a *= 0.5; f *= 2.03; }
  return sum / norm;
}
function ridged(x, z, oct = 5) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { const n = 1 - Math.abs(noise(x * f, z * f) * 2 - 1); sum += a * n * n; norm += a; a *= 0.5; f *= 2.1; }
  return sum / norm;
}
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* --- Height field ------------------------------------------------------ */
// The coast: south of the port, wandering more the further from the quay
function coastZ(x) {
  const wander = smoothstep(80, 260, Math.abs(x));
  return PLAY.zS + 2 - wander * (10 + fbm(x * 0.006, 3.7, 3) * 70) + wander * 25;
}
function heightAt(x, z) {
  const h = landHeightAt(x, z);
  // Level 1's street behind the start stays at walking level
  const f = (1 - smoothstep(L1_STREET.halfX - 8, L1_STREET.halfX, Math.abs(x)))
    * smoothstep(PLAY.zN - 10, PLAY.zN, z) * (1 - smoothstep(L1_STREET.z1 + 20, L1_STREET.z1 + 50, z));
  return f > 0 ? THREE.MathUtils.lerp(h, -0.03, f) : h;
}
function landHeightAt(x, z) {
  const ax = Math.abs(x);
  // Inside the play area: flat, just under the walking surface — and
  // well under the city's own ground slab (|x| < 45, z < 65), rising to
  // meet the walking level at its edges
  if (ax < PLAY.x && z < PLAY.zN && z > PLAY.zS) {
    const t = Math.max(smoothstep(44, 47, ax), smoothstep(62, 66, z));
    return -0.3 + 0.27 * t;
  }
  const c = z - coastZ(x); // + inland, − seaward
  if (c < 0) return SEA_LEVEL - 0.4 - smoothstep(0, 30, -c) * 6; // seabed
  // Distance out from the play area
  const dx = Math.max(ax - PLAY.x, 0), dz = Math.max(z - PLAY.zN, 0);
  const d = Math.hypot(dx, dz);
  // Flat under the back city (out to CITY_OUT), rising beyond it
  const scrub = fbm(x * 0.02, z * 0.02, 3) * (0.4 + 2.1 * smoothstep(CITY_OUT - 40, CITY_OUT + 30, d)) * smoothstep(0, 30, d);
  const foothills = Math.pow(smoothstep(CITY_OUT - 20, 560, d), 1.6) * 40 * (0.6 + fbm(x * 0.004, z * 0.004, 3));
  const peaks = smoothstep(400, 780, d) * (60 + 130 * ridged(x * 0.0028, z * 0.0028));
  const land = scrub + foothills + peaks;
  // A beach just above the water, blending into the land behind it
  return THREE.MathUtils.lerp(SEA_LEVEL + 0.3, Math.max(land, SEA_LEVEL + 0.3), smoothstep(2, 70, c));
}

const C_SAND = new THREE.Color(0xb3a283), C_SCRUB = new THREE.Color(0x8f8063), C_ROCK = new THREE.Color(0x857d74), C_HIGH = new THREE.Color(0xa69f95);
const C_URBAN = new THREE.Color(0x77716b);
function colourAt(h, slope, out, urban) {
  out.copy(C_SCRUB).lerp(C_URBAN, urban);
  if (h < 1.2) out.lerp(C_SAND, 1 - smoothstep(-0.5, 1.2, h));
  out.lerp(C_ROCK, smoothstep(20, 90, h) * 0.8 + smoothstep(0.35, 0.8, slope) * 0.5);
  out.lerp(C_HIGH, smoothstep(140, 230, h));
  return out;
}

/* --- Haze: the fog chunk swapped for aerial perspective ---------------- */
const hazeUniforms = {
  uHazeColor: { value: new THREE.Color() },
  uHazeNear: { value: 60 },
  uHazeFar: { value: 900 },
  uHazeMax: { value: 0.9 },
};
function addHaze(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, hazeUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHazeWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvHazeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHazeWorld;\nuniform vec3 uHazeColor;\nuniform float uHazeNear, uHazeFar, uHazeMax;')
      .replace('#include <fog_fragment>', `
        float hazeD = clamp((distance(vHazeWorld, cameraPosition) - uHazeNear) / (uHazeFar - uHazeNear), 0.0, 1.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, pow(hazeD, 0.65) * uHazeMax);`);
  };
  material.customProgramCacheKey = () => 'lv2-haze';
}

function buildTerrain() {
  const W = 2600, D = 1500, SEG_X = 260, SEG_Z = 150;
  const geo = new THREE.PlaneGeometry(W, D, SEG_X, SEG_Z);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, (D / 2) - 420); // z from -420 (out at sea) to +1080
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.hypot(Math.max(Math.abs(x) - PLAY.x, 0), Math.max(z - PLAY.zN, 0));
    const urban = 0.7 * (1 - smoothstep(CITY_OUT - 40, CITY_OUT + 10, d)) * smoothstep(-6, 20, z - coastZ(x));
    colourAt(pos.getY(i), 1 - nrm.getY(i), c, urban).toArray(col, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // UVs in metres / 8: the dirt texture tiles every 8 m whatever the size
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 8, pos.getZ(i) / 8);
  const map = dirtTex.clone();
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1, 1);
  map.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 1, metalness: 0, flatShading: true, fog: false });
  addHaze(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'lv2-terrain';
  scene.add(mesh);
  return mesh;
}

/* --- Sea ---------------------------------------------------------------- */
// Tiling ripple normal map: a few crossing sine swells plus noise,
// differentiated into normals. Painted once on a canvas.
export function rippleNormalTexture(size = 256) {
  const h = new Float32Array(size * size);
  const n = makeNoise(0xA11CE);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    h[y * size + x] = Math.sin(TAU * (u * 3 + v * 1)) * 0.5 + Math.sin(TAU * (u * -2 + v * 4)) * 0.35
      + Math.sin(TAU * (u * 7 + v * -5)) * 0.15 + (n(u * 16, v * 16) - 0.5) * 0.6; // n() isn't tiling at the edge, kept faint
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const d = h[((y - 1 + size) % size) * size + x], u = h[((y + 1) % size) * size + x];
    const nv = new THREE.Vector3((l - r) * 2.2, (d - u) * 2.2, 1).normalize();
    const k = (y * size + x) * 4;
    img.data[k] = (nv.x * 0.5 + 0.5) * 255; img.data[k + 1] = (nv.y * 0.5 + 0.5) * 255; img.data[k + 2] = (nv.z * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildSea() {
  const normalMap = rippleNormalTexture();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2b78a8, roughness: 0.22, metalness: 0,
    normalMap, normalScale: new THREE.Vector2(0.55, 0.55),
  });
  // The open sea south of the quay line, plus strips either side of the
  // play area reaching into the bays where the coast wanders north (the
  // beach stands above them everywhere else)
  const parts = [
    [2600, 1500, 0, PLAY.zS - 750 + 4],
    [1220, 40, -(PLAY.x + 610), PLAY.zS + 24],
    [1220, 40, PLAY.x + 610, PLAY.zS + 24],
  ].map(([w, d, x, z]) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, 0, z));
  const geo = mergeGeometries(parts);
  // World-metre UVs so the ripples line up across the pieces
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 16, p.getZ(i) / 16);
  normalMap.repeat.set(1, 1);
  const sea = new THREE.Mesh(geo, mat);
  sea.position.y = SEA_LEVEL;
  sea.receiveShadow = true;
  sea.name = 'lv2-sea';
  scene.add(sea);
  return sea;
}

/* --- The back city ------------------------------------------------------- */
function seeded(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Lots the level already uses behind the street-front rows
const KEEP_OUT = [
  { x0: -60, x1: -20, z0: -40, z1: -72 },   // west pocket
  { x0: 15, x1: 66, z0: -112, z1: -170 },   // east collapse lot
];
const keptClear = (x, z, r) => KEEP_OUT.some((k) => x + r > k.x0 && x - r < k.x1 && z - r < k.z0 && z + r > k.z1);

// Splits a building shell into walls and roof by face direction, dropping
// the underside; appends to non-indexed position/uv/colour buckets
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function splitShell(geo, tint, roofTint, walls, roofs) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i); _b.fromBufferAttribute(pos, i + 1); _c.fromBufferAttribute(pos, i + 2);
    const ny = _b.sub(_a).cross(_c.sub(_a)).normalize().y;
    if (ny < -0.5) continue;
    const out = ny > 0.5 ? roofs : walls;
    const col = ny > 0.5 ? roofTint : tint;
    for (let k = 0; k < 3; k++) {
      out.pos.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      out.uv.push(uv.getX(i + k), uv.getY(i + k));
      out.col.push(col.r, col.g, col.b);
    }
  }
}
const bucket = () => ({ pos: [], uv: [], col: [] });
function bucketGeometry(bk) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(bk.col, 3));
  g.computeVertexNormals();
  return g;
}

function buildBackCity() {
  const rnd = seeded(0xC17E5);
  const clearDay = state.timeOfDay === 'day' && state.clearDay;
  const night = state.timeOfDay === 'night';
  // Real-proportion facades by day and at night (the night one only
  // darker); the dense lit-window grid is left to other times of day
  const real = clearDay || night;
  const tileW = real ? FACADE_TILE_W : 4, tileH = real ? FACADE_TILE_H : 4;
  const VARIANTS = real ? 4 : windowTexVariants.length;
  const lit = { windows: [], rays: [] };
  let towers = 0;
  // Buckets per band (0 near: casts shadows, 1 far: doesn't) x facade variant
  const walls = [0, 1].map(() => Array.from({ length: VARIANTS }, bucket));
  const roofs = [0, 1].map(bucket);
  const smokeSpots = [];
  const occluderGeo = new THREE.BoxGeometry(1, 1, 1);
  const tint = new THREE.Color(), roofTint = new THREE.Color();

  // One building at (x, z), `out` metres out from the main street's rows
  // `face`: the outward normal of the side facing the street
  const place = (x, z, out, face) => {
    if (z < coastZ(x) + 18 || keptClear(x, z, 14)) return;
    if (state.cityKit && Math.abs(x) < 96 && z < 52) return; // the harbour town (CityTown.js) is there
    const f = 1 - smoothstep(0, CITY_OUT, out);              // 1 by the street .. 0 at the edge
    if (rnd() > 0.35 + 0.65 * f) return;                      // sparser further out
    const w = 9 + rnd() * 14, d = 9 + rnd() * 14;
    let h = 7 + (10 + rnd() * 34) * f * f + rnd() * 5;
    const roll = rnd();
    let collapsed = roll < 0.12;
    let broken = !collapsed && roll < 0.45;
    let tower = false;
    if (night) {
      // Mostly flattened; a few near towers survive
      tower = out < 150 && towers < 14 && rnd() < 0.14;
      collapsed = !tower && roll < 0.6;
      broken = !tower && !collapsed;
      if (tower) { towers++; h = 24 + rnd() * 20; } else if (broken) h = Math.min(h, 6 + rnd() * 8);
    }
    if (state.cityKit) collapsed = broken = false; // the town stands whole, for now
    if (collapsed) h = 3 + rnd() * 5;
    // Sunk a metre below the lowest ground under it
    const base = Math.min(heightAt(x - w / 2, z - d / 2), heightAt(x + w / 2, z + d / 2), heightAt(x, z)) - 1;
    const total = h - base;
    let dropAt = () => 0;
    if (collapsed) dropAt = () => total * (0.3 + rnd() * 0.5);
    else if (broken) {
      // Storeys gone in 6 m sections, like the street's own ruins
      const cells = new Map();
      dropAt = (vx, vz) => {
        const k = `${Math.floor(vx / 6)},${Math.floor(vz / 6)}`;
        if (!cells.has(k)) cells.set(k, rnd() < 0.4 ? 0 : (1 + Math.floor(rnd() * 4)) * 3.2);
        return cells.get(k);
      };
    }
    const geo = brokenBox(w, total, d, 0, dropAt);
    const rot = (rnd() - 0.5) * 0.12;
    if (!tower) geo.rotateY(rot); // towers stay square so their lit windows sit on the facade
    geo.translate(x, base, z);
    planarFacadeUVs(geo, tileW, tileH);
    const l = 0.5 + rnd() * 0.25;
    tint.setHSL(0.06 + rnd() * 0.05, 0.1 + rnd() * 0.1, clearDay ? l : l * (night ? 0.45 : 0.7));
    if (tower) addLitWindows(lit, { cx: x, cz: z, w, d, n: face, rnd, count: 2 + ((rnd() * 3) | 0), maxY: h - 1.5 });
    roofTint.setHSL(0.07, 0.05, 0.28 + rnd() * 0.1);
    const band = out < 70 ? 0 : 1;
    splitShell(geo, tint, roofTint, walls[band][(rnd() * VARIANTS) | 0], roofs[band]);
    if (collapsed && smokeSpots.length < 6 && rnd() < 0.5) smokeSpots.push(new THREE.Vector3(x, h, z));
    // Within walking reach: solid, and the camera won't swing inside it
    if (Math.abs(x) - w / 2 < PLAY.x + 2 && z - d / 2 < PLAY.zN) {
      addStaticBox(w / 2, h / 2, d / 2, x, h / 2, z);
      const occ = new THREE.Mesh(occluderGeo);
      occ.scale.set(w, h, d);
      occ.position.set(x, h / 2, z);
      occ.updateMatrixWorld(true);
      state.occluders.push(occ);
    }
  };

  // Both flanks: a block grid from behind the street-front rows outward
  for (const side of [-1, 1]) {
    for (let z = 58; z > -200; z -= 30 + rnd() * 12) {
      for (let ax = 54; ax < PLAY.x + CITY_OUT; ax += 26 + rnd() * 12) {
        place(side * (ax + rnd() * 4), z + (rnd() - 0.5) * 6, ax - 30, new THREE.Vector3(-side, 0, 0));
      }
    }
  }
  // Behind the start: Level 1's street (L1_SHIFT), the way you came. Its two
  // rows of intact blocks in Level 1's own proportions, a gap on the east
  // side where the depot yard was. Never in reach, so no colliders. With the
  // harbour town in, they're Level 1's own kit buildings (lighter detail),
  // merged by hand: they're built after the level's static merge.
  const level1Kit = [];
  const level1Block = (x, z, w, h, d, side) => {
    if (state.cityKit && side) { level1Kit.push(buildKitBuilding(x, z, w, h, d, { collider: false, far: true, district: 'downtown' })); return; }
    const geo = brokenBox(w, h + 1, d, 0, () => 0);
    geo.translate(x, -1, z);
    planarFacadeUVs(geo, tileW, tileH);
    const l = 0.55 + rnd() * 0.25;
    tint.setHSL(0.06 + rnd() * 0.05, 0.1 + rnd() * 0.1, clearDay ? l : l * (night ? 0.5 : 0.75));
    roofTint.setHSL(0.07, 0.05, 0.28 + rnd() * 0.1);
    if (side && night && rnd() < 0.45) addLitWindows(lit, { cx: x, cz: z, w, d, n: new THREE.Vector3(-side, 0, 0), rnd, count: 2 + ((rnd() * 3) | 0), maxY: h - 1.5 });
    const band = z < 120 ? 0 : 1;
    splitShell(geo, tint, roofTint, walls[band][(rnd() * VARIANTS) | 0], roofs[band]);
  };
  for (let z = L1_STREET.z0 + 4; z < L1_STREET.z1 - 6; z += 15 + rnd() * 9) {
    const w = 11 + rnd() * 7, d = 11 + rnd() * 7, h = 16 + rnd() * 28;
    if (Math.abs(z - L1_DEPOT.z) > 16) level1Block(rowX + w / 2, z, w, h, d, 1);
    const ww = w * (0.85 + rnd() * 0.3), hh = h * (0.7 + rnd() * 0.4);
    level1Block(-rowX - ww / 2, z + 5, ww, hh, d, -1);
  }
  if (level1Kit.length) mergeKitGroups(level1Kit);
  // The research annex closes the far end of the street, where it all began
  level1Block(0, L1_LAB.z + 10, 64, 14, 18, 0);

  // Round it: the outskirts the street came in through
  const span = PLAY.x + CITY_OUT * 0.8;
  for (let z = 92; z < PLAY.zN + CITY_OUT * 0.8; z += 30 + rnd() * 12) {
    for (let x = -span; x < span; x += 26 + rnd() * 12) {
      if (Math.abs(x) < L1_STREET.halfX + 8) continue; // Level 1's street runs through here
      place(x + rnd() * 4, z, Math.max(z - 40, Math.abs(x) - 30), new THREE.Vector3(0, 0, -1));
    }
  }

  const wallMats = Array.from({ length: VARIANTS }, (_, i) => (real
    ? new THREE.MeshStandardMaterial({ map: dayFacades()[i], vertexColors: true, roughness: 0.95 })
    : new THREE.MeshStandardMaterial({
      map: windowTexVariants[i], vertexColors: true, roughness: 1,
      emissive: 0xffb066, emissiveMap: windowTexVariants[i], emissiveIntensity: night ? 0.6 : 0.12,
    })));
  const roofMat = new THREE.MeshStandardMaterial({ map: concreteTex, vertexColors: true, roughness: 1 });
  [0, 1].forEach((band) => {
    const add = (bk, mat) => {
      if (!bk.pos.length) return;
      const m = new THREE.Mesh(bucketGeometry(bk), mat);
      m.castShadow = band === 0;
      m.receiveShadow = true;
      scene.add(m);
    };
    walls[band].forEach((bk, i) => add(bk, wallMats[i]));
    add(roofs[band], roofMat);
  });
  smokeSpots.forEach((p) => spawnFireEffect(p, 2.4));
  addLitWindowMeshes(lit);
}


/* --- Level 1, behind the start -------------------------------------------
   The road you came down, its lamps, and three glows you'll recognise: the
   extraction beam you just left, the depot yard's amber light, and the gas
   still rising over the lab. Unlit and shadowless: a handful of draw calls.
   Power-of-two canvases, so every texture here gets mipmaps. */
function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const glowTexture = () => canvasTexture(64, 64, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  r.addColorStop(0, '#ffffffff'); r.addColorStop(0.35, '#ffffff66'); r.addColorStop(1, '#ffffff00');
  g.fillStyle = r; g.fillRect(0, 0, w, w);
});

function buildLevel1Backdrop() {
  const rnd = seeded(0x1E7E1);
  const night = state.timeOfDay === 'night';
  // Picks up where Level 2's own street surface stops (z 55)
  const z0 = 55, length = L1_STREET.z1 - z0, zc = z0 + length / 2;
  // The road: asphalt with Level 1's centre dashes, one every 16 m
  const roadTex = canvasTexture(32, 128, (g, w, h) => {
    g.fillStyle = '#2c2c2e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { g.fillStyle = rnd() < 0.5 ? '#38383a' : '#232325'; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
    g.fillStyle = '#b9a35a'; g.fillRect(15, 0, 2, 56);
  });
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(1, length / 16);
  roadTex.anisotropy = 8; // the road is seen edge-on: keeps the dashes crisp
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(STREET_HALF_W * 2, length).rotateX(-Math.PI / 2).translate(0, 0.01, zc),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 }));
  road.receiveShadow = true;
  scene.add(road);
  const walkTex = concreteTex.clone();
  walkTex.wrapS = walkTex.wrapT = THREE.RepeatWrapping;
  walkTex.repeat.set(1, length / 4);
  walkTex.needsUpdate = true;
  const walkMat = new THREE.MeshStandardMaterial({ map: walkTex, color: 0x8a8780, roughness: 1 });
  for (const side of [-1, 1]) {
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(4.2, length).rotateX(-Math.PI / 2)
      .translate(side * (STREET_HALF_W + 2.1), 0.03, zc), walkMat);
    walk.receiveShadow = true;
    scene.add(walk);
  }

  // Streetlights, alternating sides every 24 m, arms over the road
  const spots = [];
  for (let z = 64, s = 1; z < L1_STREET.z1 - 4; z += 24, s = -s) spots.push([s * (STREET_HALF_W + 0.8), z, s]);
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6).translate(0, 3.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.7, metalness: 0.4 }), spots.length);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.22, 0.45).translate(-0.6, 7, 0),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc070, emissiveIntensity: night ? 2.2 : 0.2 }), spots.length);
  const m = new THREE.Object3D();
  spots.forEach(([x, z, s], i) => {
    m.position.set(x, 0, z); m.rotation.y = s > 0 ? 0 : Math.PI; m.updateMatrix();
    pole.setMatrixAt(i, m.matrix); head.setMatrixAt(i, m.matrix);
  });
  scene.add(pole, head);
  const glowTex = glowTexture();
  if (night) {
    const pts = new Float32Array(spots.flatMap(([x, z, s]) => [x - s * 1.2, 6.8, z]));
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pts, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
      map: glowTex, color: 0xffb066, size: 5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
  }

  // Light beams over the extraction point and the depot yard
  const beamTex = canvasTexture(4, 64, (g, w, h) => {
    const l = g.createLinearGradient(0, 0, 0, h);
    l.addColorStop(0, '#ffffff00'); l.addColorStop(0.7, '#ffffff55'); l.addColorStop(1, '#ffffffcc');
    g.fillStyle = l; g.fillRect(0, 0, w, h);
  });
  const beam = (pos, color, radius, height, opacity) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24, 1, true).translate(0, height / 2, 0),
      new THREE.MeshBasicMaterial({ map: beamTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    mesh.position.copy(pos);
    scene.add(mesh);
    return mesh;
  };
  const extraction = beam(L1_EXTRACT, 0x33ff77, 2.4, 36, 0.5);
  beam(L1_DEPOT, 0xffb347, 1.8, 28, 0.4);

  // The gas over the lab: three slow, overlapping green clouds
  const gas = [0, 1, 2].map((i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0x91ad42, transparent: true, opacity: night ? 0.3 : 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    s.scale.setScalar(60 + i * 25);
    s.position.set((i - 1) * 14, 22 + i * 14, L1_LAB.z + 6);
    scene.add(s);
    return s;
  });
  return (t) => {
    extraction.material.opacity = 0.42 + Math.sin(t * 2.2) * 0.1;
    gas.forEach((s, i) => {
      s.position.y = 22 + i * 14 + Math.sin(t * 0.2 + i) * 3;
      s.material.rotation = t * 0.02 * (i % 2 ? 1 : -1);
    });
  };
}

/** Level 1's view of the same land: the terrain and sea built exactly as
    here, moved 248 m north (L1_SHIFT), since Level 1 is that much further
    up the road. Sunk a little so the flattened street corridor sits under
    Level 1's own ground slab. Returns the per-frame update. */
export function buildLandscape({ sinkY = 0.25 } = {}) {
  camera.far = VIEW_FAR;
  camera.updateProjectionMatrix();
  sky.renderOrder = -2; // sky first: it writes no depth, so the far ridges draw over it
  const terrain = buildTerrain(), sea = buildSea();
  terrain.position.set(0, -sinkY, -L1_SHIFT);
  sea.position.z = -L1_SHIFT;
  let t = 0;
  return (dt) => {
    t += dt;
    if (scene.fog) hazeUniforms.uHazeColor.value.copy(scene.fog.color);
    sea.material.normalMap.offset.set(t * 0.004, t * 0.0025);
  };
}

/** Builds the terrain, the sea and the back city. Call after the static merge (custom
    shader — not mergeable). Returns the per-frame tick. */
export function buildSurroundings() {
  camera.far = VIEW_FAR;
  camera.updateProjectionMatrix();
  sky.renderOrder = -2; // sky first: it writes no depth, so the far ridges draw over it
  buildTerrain();
  const sea = buildSea();
  buildBackCity();
  const level1 = buildLevel1Backdrop();
  let t = 0;
  return (dt) => {
    t += dt;
    level1(t);
    if (scene.fog) hazeUniforms.uHazeColor.value.copy(scene.fog.color);
    const off = sea.material.normalMap.offset;
    off.set(t * 0.004, t * 0.0025);
  };
}
