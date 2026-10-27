/* ======================================================================
   Level3Arrival.js — THE BAY BEHIND THE LEVEL 3 START

   You crossed the bay in her boat, the only one at the port. Looking back
   from the start: the street runs out onto a quay and a jetty, the boat is
   tied up alongside with the girl waiting in it, and across the water the
   port you chased her through stands in the haze, crane lights blinking.

   Out of reach (the world bound is z 40), so nothing here has physics.
   The far shore is flat silhouettes in a darkened fog colour plus point
   lights that pierce the fog, so it reads in any weather; it all sits
   inside the camera's far plane (520 m).
====================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from './Scene.js';
import { state } from './state.js';
import { concreteTex, rustTex } from './characters.js';
import { instantiateCharacter, clipsFor } from './roster.js';
import { rippleNormalTexture } from './Level2Surroundings.js';
import { getGirlOutcome } from './StoryProgress.js';

const WATER_Y = -0.9;
const QUAY_Z = 65;                 // the street's ground slab ends here
const JETTY_END = 96;
const BOAT_LENGTH = 6.5;           // as at the Level 2 pier
const BOAT_DRAFT = 0.55;
const BOAT_MOOR = new THREE.Vector3(3.7, WATER_Y + 0.05, 87);
const GIRL_HEIGHT = 1.65;

function seeded(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, '#ffffffff'); r.addColorStop(0.3, '#ffffff77'); r.addColorStop(1, '#ffffff00');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function buildWater() {
  const normalMap = rippleNormalTexture();
  normalMap.repeat.set(1, 1);
  const night = state.timeOfDay === 'night';
  const geo = new THREE.PlaneGeometry(1400, 460).rotateX(-Math.PI / 2).translate(0, 0, QUAY_Z + 230);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 16, p.getZ(i) / 16); // world-metre ripples
  const sea = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: night ? 0x1d4a66 : 0x2b6f98, roughness: 0.22, metalness: 0,
    normalMap, normalScale: new THREE.Vector2(0.55, 0.55),
  }));
  sea.position.y = WATER_Y;
  sea.receiveShadow = true;
  scene.add(sea);
  return sea;
}

function buildQuayAndJetty() {
  const concrete = new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x7a7a76, roughness: 0.95 });
  const rust = new THREE.MeshStandardMaterial({ map: rustTex, color: 0x3a3f45, roughness: 0.7, metalness: 0.4 });
  // Quay: where the street meets the water, its face dropping to the sea
  const quay = new THREE.Mesh(new THREE.BoxGeometry(160, 2.2, 10), concrete);
  quay.position.set(0, 0.04 - 1.1, QUAY_Z - 5);
  quay.receiveShadow = true;
  scene.add(quay);
  const bollards = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.22, 0.7, 10), rust, 10);
  const m = new THREE.Object3D();
  for (let i = 0; i < 10; i++) { m.position.set(-36 + i * 8, 0.39, QUAY_Z - 0.6); m.updateMatrix(); bollards.setMatrixAt(i, m.matrix); }
  bollards.castShadow = true;
  scene.add(bollards);
  // Jetty straight out from the middle of the street, the boat alongside
  const length = JETTY_END - QUAY_Z;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, length), concrete);
  deck.position.set(0, -0.085, QUAY_Z + length / 2);
  deck.castShadow = deck.receiveShadow = true;
  scene.add(deck);
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.16, 3, 8), rust, 12);
  for (let i = 0; i < 6; i++) for (const side of [-1, 1]) {
    m.position.set(side * 1.6, -1.4, QUAY_Z + 3 + i * (length - 4) / 5); m.updateMatrix();
    posts.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m.matrix);
  }
  scene.add(posts);
}

// Her boat, as moored at the Level 2 pier, and her standing in it
function buildBoat() {
  const group = new THREE.Group();
  group.position.copy(BOAT_MOOR);
  scene.add(group);
  new GLTFLoader().load('assets/boat.glb', (gltf) => {
    const obj = gltf.scene;
    obj.rotation.y = -Math.PI / 2; // bow toward the shore (-z)
    obj.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    let box = new THREE.Box3().setFromObject(obj);
    obj.scale.setScalar(BOAT_LENGTH / box.getSize(new THREE.Vector3()).z);
    box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.set(-c.x, -BOAT_DRAFT - box.min.y, -c.z);
    group.add(obj);
  }, undefined, (err) => console.error('Arrival boat failed to load:', err));
  const boat = { group, mixer: null };
  if (getGirlOutcome() !== 'escaped') {
    instantiateCharacter('detention').then(async (obj) => {
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      obj.scale.setScalar(GIRL_HEIGHT / Math.max(box.getSize(new THREE.Vector3()).y, 0.2));
      const box2 = new THREE.Box3().setFromObject(obj);
      const c = box2.getCenter(new THREE.Vector3());
      obj.position.set(-c.x, -box2.min.y, -c.z);
      obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const her = new THREE.Group();
      her.add(obj);
      her.position.set(0, -0.15, 0.9); // the seat she stood at in Level 2
      her.rotation.y = Math.PI;        // looking up the street, toward the tower
      group.add(her);
      const idle = (await clipsFor(obj)).idle;
      if (idle) { boat.mixer = new THREE.AnimationMixer(obj); boat.mixer.clipAction(idle).play(); }
    }).catch((err) => console.error('Girl in the boat failed to load:', err));
  }
  return boat;
}

// The port across the bay: Level 2's container yard, cranes, warehouses
// and the town behind it, as layered silhouettes. One merged mesh with
// per-layer vertex colours, plus three sets of lights.
function buildFarShore(glowTex) {
  const rnd = seeded(0xBA75);
  const fog = scene.fog ? scene.fog.color : new THREE.Color(0x182535);
  const shade = (k) => fog.clone().lerp(new THREE.Color(0x05070a), k); // k: how far from the haze
  const parts = [];
  const add = (w, h, d, x, y, z, color) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(x, y + h / 2, z);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) color.toArray(col, i);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    parts.push(g);
  };
  const SHORE = 340, port = shade(0.55), town = shade(0.32), ships = shade(0.62);
  add(1400, 3, 40, 0, WATER_Y, SHORE + 20, port);                     // the far quay
  for (let i = 0; i < 46; i++) {                                       // container stacks
    const x = -170 + rnd() * 340, z = SHORE + 4 + rnd() * 14, tiers = 1 + ((rnd() * 3) | 0);
    add(6 + rnd() * 6, tiers * 2.6, 2.5 + rnd() * 2, x, 2, z, port);
  }
  for (let i = 0; i < 7; i++) add(30 + rnd() * 25, 9 + rnd() * 6, 22, -240 + i * 80 + rnd() * 20, 2, SHORE + 34, port); // warehouses
  const cranes = [-110, -40, 35, 120];
  for (const cx of cranes) {                                          // gantry cranes
    for (const lx of [-6, 6]) add(1.4, 34, 1.4, cx + lx, 2, SHORE + 6, port);
    add(15, 3, 3, cx, 34, SHORE + 6, port);                            // cross beam
    add(3, 2.2, 62, cx, 36, SHORE - 14, port);                         // boom, reaching over the water
  }
  for (let i = 0; i < 34; i++) add(14 + rnd() * 20, 10 + rnd() * 32, 16 + rnd() * 10, -320 + rnd() * 640, 2, SHORE + 70 + rnd() * 70, town); // the town
  add(48, 8, 9, -150, WATER_Y, SHORE - 50, ships); add(16, 7, 8, -158, WATER_Y + 8, SHORE - 50, ships); // moored ships
  add(36, 7, 8, 160, WATER_Y, SHORE - 64, ships); add(12, 6, 7, 166, WATER_Y + 7, SHORE - 64, ships);
  const shore = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  scene.add(shore);

  // Lights: red crane-top warnings that blink, amber yard lamps, town windows
  const night = state.timeOfDay === 'night';
  const points = (list, color, size, opacity) => {
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(list.flat()), 3));
    const p = new THREE.Points(geo, new THREE.PointsMaterial({
      map: glowTex, color, size, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    scene.add(p);
    return p;
  };
  const warnings = points(cranes.flatMap((cx) => [[cx - 6, 37, SHORE + 6], [cx + 6, 37, SHORE + 6], [cx, 38.5, SHORE - 44]]), 0xff3020, 7, 0.9);
  const yard = [];
  for (let x = -160; x <= 160; x += 20 + rnd() * 10) yard.push([x, 9 + rnd() * 3, SHORE + 2 + rnd() * 10]);
  points(yard, 0xffb066, night ? 9 : 5, night ? 0.75 : 0.25);
  const windows = [];
  for (let i = 0; i < 70; i++) windows.push([-300 + rnd() * 600, 6 + rnd() * 26, SHORE + 70 + rnd() * 60]);
  points(windows, 0xffe2a8, 4, night ? 0.55 : 0.12);
  return warnings;
}

/** Builds the bay. Call after bootLevel() (it reads the level's fog).
    Returns a per-frame update for the water, the boat and the lights. */
export function buildArrivalBay() {
  const glowTex = glowTexture();
  const sea = buildWater();
  buildQuayAndJetty();
  const boat = buildBoat();
  const warnings = buildFarShore(glowTex);
  let t = 0;
  return (dt) => {
    t += dt;
    sea.material.normalMap.offset.set(t * 0.004, t * 0.0025);
    boat.group.position.y = BOAT_MOOR.y + Math.sin(t * 1.3) * 0.05;
    boat.group.rotation.z = Math.sin(t * 0.9) * 0.025;
    boat.group.rotation.x = Math.sin(t * 1.1 + 1) * 0.012;
    boat.mixer?.update(dt);
    warnings.material.opacity = Math.sin(t * 3) > 0.2 ? 0.95 : 0.15;
  };
}
