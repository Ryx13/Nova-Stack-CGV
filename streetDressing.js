/* ======================================================================
   streetDressing.js — LEVEL 2 STREET DRESSING

   The lived-in, long-abandoned layer from the title key art: dead trees
   along the pavements, rubble gathered in the gutters and against the
   shopfronts, litter, scorch and oil stains, sagging overhead cables
   between the lamp posts (a few snapped and dangling), and a couple of
   fallen lamp posts.

   Built to cost almost nothing: every kind of thing is ONE InstancedMesh
   (dozens to hundreds of copies, one draw call), and the cables are one
   merged mesh. Placement uses its own seeded RNG — the world's shared
   rnd() sequence (wrecks, props) is untouched — and keeps clear of
   everything gameplay cares about: the road (the girl's route), the
   vending machines, the collapse zone and the port. Only the trees and
   fallen posts are solid; everything else is walk-over dressing.
====================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, addStaticBox, addObstacle, STREET_HALF_W, rowX } from './Scene.js';
import { concreteTex, streetlightSpots } from './characters.js';
import { state } from './state.js';

function seeded(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = seeded(0xD3E55);
const between = (a, b) => a + rand() * (b - a);

const STREET_START = 28, STREET_END = -188;  // dressed stretch (port begins past -190)
const PAVE_IN = STREET_HALF_W + 0.6;         // pavement, road side
const PAVE_OUT = rowX - 0.4;                 // pavement, shopfront side

// Kept clear: [side (-1 west / 1 east / 0 both), zFrom, zTo]
const KEEP_CLEAR = [
  [-1, 15, 5],      // radar vending machine
  [-1, -85, -95],   // adrenaline vending machine
  [-1, -46, -64],   // west pocket
  [0, -122, -165],  // collapse zone — ruins and rubble on both sides
];
const clearOf = (x, z) => !KEEP_CLEAR.some(([s, z0, z1]) => (s === 0 || Math.sign(x) === s) && z <= z0 && z >= z1);

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
function setInstance(mesh, i, x, y, z, rx, ry, rz, sx, sy = sx, sz = sx) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  mesh.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)));
}

/* --- Dead trees: a tapered trunk splitting into bare, crooked limbs ---- */
function deadTreeGeometry(seed) {
  const r = seeded(seed);
  const parts = [];
  const limb = (from, dir, len, rad, depth) => {
    const geo = new THREE.CylinderGeometry(rad * 0.62, rad, len, 5, 1, true);
    geo.translate(0, len / 2, 0);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    geo.translate(from.x, from.y, from.z);
    parts.push(geo.toNonIndexed());
    if (depth === 0) return;
    const tip = from.clone().addScaledVector(dir, len);
    const n = depth === 3 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const d = dir.clone().add(new THREE.Vector3((r() - 0.5) * 1.6, 0.35 + r() * 0.5, (r() - 0.5) * 1.6)).normalize();
      limb(tip.clone().addScaledVector(dir, -len * r() * 0.25), d, len * (0.55 + r() * 0.2), rad * 0.6, depth - 1);
    }
  };
  limb(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3((r() - 0.5) * 0.15, 1, (r() - 0.5) * 0.15).normalize(), 3.2 + r() * 1.2, 0.2, 3);
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

function buildTrees() {
  const bark = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 1 });
  const spots = [];
  for (const side of [-1, 1]) {
    for (let z = STREET_START - 4; z > STREET_END; z -= between(13, 19)) {
      const x = side * between(PAVE_IN + 1.6, PAVE_OUT - 1.4);
      if (clearOf(x, z) && rand() < 0.8) spots.push([x, z]);
    }
  }
  const variants = [0x7ee1, 0x7ee2, 0x7ee3].map((s) => new THREE.InstancedMesh(deadTreeGeometry(s), bark, spots.length));
  const counts = [0, 0, 0];
  for (const [x, z] of spots) {
    const v = (rand() * 3) | 0;
    setInstance(variants[v], counts[v]++, x, 0, z, 0, rand() * Math.PI * 2, (rand() - 0.5) * 0.08, between(0.85, 1.3));
    addStaticBox(0.22, 1.5, 0.22, x, 1.5, z);
    addObstacle(x, z, 0.5);
  }
  variants.forEach((mesh, v) => {
    mesh.count = counts[v];
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  });
}

/* --- Rubble chunks: gutters, shopfront bases, a scatter on the road --- */
function buildDebris() {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.95 });
  const N = 420;
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const col = new THREE.Color();
  let i = 0;
  while (i < N) {
    const where = rand();
    const side = rand() < 0.5 ? -1 : 1;
    let x;
    if (where < 0.45) x = side * between(STREET_HALF_W - 1.4, STREET_HALF_W + 0.2);   // gutter
    else if (where < 0.8) x = side * between(PAVE_OUT - 0.9, PAVE_OUT);              // against the shopfronts
    else x = between(-STREET_HALF_W + 1, STREET_HALF_W - 1);                         // loose on the road
    const z = between(STREET_END, STREET_START);
    if (!clearOf(x, z) && Math.abs(x) > STREET_HALF_W) continue;
    const s = where < 0.8 ? between(0.06, 0.32) : between(0.04, 0.14);
    setInstance(mesh, i, x, s * 0.35, z, rand() * 3, rand() * 3, rand() * 3, s, s * between(0.4, 0.8), s * between(0.7, 1.3));
    mesh.setColorAt(i, col.setHSL(0.08, 0.06, between(0.35, 0.62)));
    i++;
  }
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
}

/* --- Litter: paper, card, plastic scraps lying flat ------------------- */
function buildLitter() {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.01, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), 260);
  // weathered: sun-bleached then dirtied, nothing reads as fresh white
  const tints = [0x9a9284, 0x857a66, 0x6e5f48, 0x5a6670, 0x8c8470];
  const col = new THREE.Color();
  for (let i = 0; i < mesh.count; i++) {
    // mostly blown against kerbs and shopfronts, a little across the road
    const side = rand() < 0.5 ? -1 : 1;
    const x = rand() < 0.75 ? side * between(STREET_HALF_W - 1.2, PAVE_OUT - 0.3) : between(-STREET_HALF_W, STREET_HALF_W);
    const z = between(STREET_END, STREET_START);
    setInstance(mesh, i, x, 0.02 + rand() * 0.01, z, (rand() - 0.5) * 0.15, rand() * Math.PI, (rand() - 0.5) * 0.15, between(0.12, 0.32), 1, between(0.1, 0.24));
    mesh.setColorAt(i, col.setHex(tints[(rand() * tints.length) | 0]));
  }
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
}

/* --- Stains: scorch marks and oil on road and pavement ---------------- */
function buildStains() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 18 + Math.random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x3a3028, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, mat, 80);
  for (let i = 0; i < mesh.count; i++) {
    const s = between(1.2, 4.5);
    setInstance(mesh, i, between(-PAVE_OUT, PAVE_OUT), 0.018, between(STREET_END, STREET_START), 0, rand() * Math.PI, 0, s, 1, s * between(0.6, 1.4));
  }
  mesh.renderOrder = 1;
  mesh.computeBoundingSphere();
  scene.add(mesh);
}

/* --- Overhead cables between lamp posts; some snapped ----------------- */
function buildCables() {
  const parts = [];
  const cable = (a, b, sag) => {
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= sag;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    parts.push(new THREE.TubeGeometry(curve, 12, 0.025, 4, false).toNonIndexed());
  };
  for (const side of [-1, 1]) {
    // The main street's own posts only (a district has more along its back streets)
    const posts = streetlightSpots.filter(([x, z]) => Math.sign(x) === side && Math.abs(x) < STREET_HALF_W + 2 && z <= STREET_START && z >= STREET_END).sort((p, q) => q[1] - p[1]);
    for (let i = 0; i + 1 < posts.length; i++) {
      const [x0, z0] = posts[i], [x1, z1] = posts[i + 1];
      if (Math.abs(z0 - z1) > 40) continue;
      const a = new THREE.Vector3(x0, 5.75, z0), b = new THREE.Vector3(x1, 5.75, z1);
      if (rand() < 0.2) {
        // snapped: two ends hanging from their posts
        cable(a, a.clone().lerp(b, 0.3).setY(between(0.6, 2.5)), 0.6);
        cable(b, b.clone().lerp(a, 0.25).setY(between(1.2, 3)), 0.5);
      } else {
        cable(a, b, between(0.6, 1.3));
        if (rand() < 0.5) cable(a.clone().setY(5.45), b.clone().setY(5.45), between(0.8, 1.6));
      }
    }
  }
  if (!parts.length) return;
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.6 }));
  mesh.castShadow = true;
  scene.add(mesh);
}

/* --- A couple of lamp posts knocked flat across the pavement ---------- */
function buildFallenPosts() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.55, metalness: 0.65 });
  const geo = new THREE.CylinderGeometry(0.08, 0.1, 6, 8);
  geo.rotateZ(Math.PI / 2);
  const spots = [[1, -34], [-1, -112], [1, -176]];
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  spots.forEach(([side, z], i) => {
    const x = side * (PAVE_IN + 2.4);
    // lying along the pavement, kinked against the kerb
    setInstance(mesh, i, x, 0.12, z, 0, Math.PI / 2 + (rand() - 0.5) * 0.5, 0.04, 1);
    addStaticBox(0.15, 0.15, 2.8, x, 0.15, z);
  });
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
}

export function buildStreetDressing() {
  // A district (state.cityKit) plants living street trees of its own (CityTown.js)
  if (!state.cityKit) buildTrees();
  buildDebris();
  buildLitter();
  buildStains();
  buildCables();
  buildFallenPosts();
}
