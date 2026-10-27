/* ======================================================================
   Level3Arrival.js — THE BAY BEHIND THE LEVEL 3 START

   You crossed the bay in her boat, the only one at the port. Looking back
   from the start: the street runs out onto a quay and a jetty, the boat is
   tied up alongside with the girl waiting in it, and across the water the
   harbour town you chased her through stands in the haze, its lighthouse flashing.

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

// The harbour town across the bay: Level 2's waterfront houses, the lighthouse
// and the town behind it, as layered silhouettes. One merged mesh per
// layer, its colour a darkened copy of the fog's that follows the fog as
// the weather turns (DayCycle.js), plus three sets of lights.
function buildFarShore(glowTex) {
  const rnd = seeded(0xBA75);
  // k: how much darker than the haze — nearer layers stand out more
  const layers = { port: { k: 0.55, parts: [] }, town: { k: 0.32, parts: [] }, ships: { k: 0.62, parts: [] } };
  const port = layers.port, town = layers.town, ships = layers.ships;
  const add = (w, h, d, x, y, z, layer) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(x, y + h / 2, z);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    layer.parts.push(g);
  };
  // A pitched roof on a silhouette: ridge along x
  const roof = (w, rise, d, x, y, z, layer) => {
    const sh = new THREE.Shape(); sh.moveTo(-d / 2, 0); sh.lineTo(d / 2, 0); sh.lineTo(0, rise); sh.lineTo(-d / 2, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }).rotateY(Math.PI / 2).translate(x - w / 2, y, z);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    layer.parts.push(g);
  };
  // The harbour town you chased her through (Level 2): its waterfront of
  // low pitched-roof houses and warehouses, the lighthouse on its rocks at
  // the west end, the town rising behind, boats moored off the beaches
  const SHORE = 340;
  add(1400, 3, 40, 0, WATER_Y, SHORE + 20, port);                     // the far waterfront
  for (let x = -180; x < 180;) {
    const w = 7 + rnd() * 6, h = 6 + rnd() * 5, d = 9 + rnd() * 4, z = SHORE + 10 + rnd() * 8;
    if (Math.abs(x) > 12) { add(w, h, d, x + w / 2, 2, z, port); roof(w, 2 + rnd() * 1.5, d + 0.6, x + w / 2, 2 + h, z, port); }
    x += w + (rnd() < 0.3 ? 3 : 0.5);
  }
  for (const lx of [-90]) {                                            // the lighthouse
    add(10, 3, 9, lx, WATER_Y, SHORE - 8, port);                       // its rocks
    add(3.6, 14, 3.6, lx, 2, SHORE - 8, port);
    add(2.4, 3, 2.4, lx, 16, SHORE - 8, port);
  }
  for (let i = 0; i < 34; i++) {                                       // the town behind, roofs and all
    const w = 10 + rnd() * 14, h = 8 + rnd() * 14, d = 12 + rnd() * 8, x = -320 + rnd() * 640, z = SHORE + 60 + rnd() * 70;
    add(w, h, d, x, 2, z, town); roof(w, 3 + rnd() * 2, d + 0.8, x, 2 + h, z, town);
  }
  for (const [bx, bz] of [[-60, SHORE - 18], [-40, SHORE - 22], [55, SHORE - 20], [75, SHORE - 16]]) add(5, 1.4, 2, bx, WATER_Y, bz, ships); // boats
  for (const layer of Object.values(layers)) {
    layer.material = new THREE.MeshBasicMaterial({ fog: false });
    scene.add(new THREE.Mesh(mergeGeometries(layer.parts), layer.material));
  }
  const black = new THREE.Color(0x05070a);
  const lights = [];
  // The shore sinks into the haze as the fog thickens, the lights last
  const shade = () => {
    if (!scene.fog) return;
    const d = scene.fog.density;
    const seen = 1 - THREE.MathUtils.smoothstep(d, 0.006, 0.018);
    for (const layer of Object.values(layers)) layer.material.color.copy(scene.fog.color).lerp(black, layer.k * seen);
    const lit = 1 - THREE.MathUtils.smoothstep(d, 0.012, 0.028);
    for (const l of lights) l.points.material.opacity = l.opacity * lit;
  };

  // Lights: the lighthouse flashing, Harbour Walk's glow, windows along the waterfront and in the town
  const night = state.timeOfDay === 'night';
  const points = (list, color, size, opacity, steady = true) => {
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(list.flat()), 3));
    const p = new THREE.Points(geo, new THREE.PointsMaterial({
      map: glowTex, color, size, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    scene.add(p);
    if (steady) lights.push({ points: p, opacity }); // the blinking ones fade in the tick
    return p;
  };
  const warnings = points([[-90, 18, SHORE - 8]], 0xfff0b0, 16, 0.95, false); // the lighthouse lamp
  const walk = [];
  for (let x = -14; x <= 14; x += 2) walk.push([x, 8 + 1.4 * (1 - (x / 14) ** 2), SHORE + 120]);
  points(walk, 0x5fd8ff, night ? 5 : 3, night ? 0.8 : 0.2);           // Harbour Walk
  const yard = [];
  for (let x = -160; x <= 160; x += 14 + rnd() * 10) yard.push([x, 4 + rnd() * 4, SHORE + 6 + rnd() * 6]);
  points(yard, 0xffb066, night ? 7 : 4, night ? 0.6 : 0.15);
  const windows = [];
  for (let i = 0; i < 70; i++) windows.push([-300 + rnd() * 600, 6 + rnd() * 26, SHORE + 70 + rnd() * 60]);
  points(windows, 0xffe2a8, 4, night ? 0.55 : 0.12);
  const warningsLit = () => 1 - THREE.MathUtils.smoothstep(scene.fog ? scene.fog.density : 0, 0.016, 0.034);
  return { warnings, shade, warningsLit };
}

/** Builds the bay. Call after bootLevel() (it reads the level's fog).
    Returns a per-frame update for the water, the boat and the lights. */
export function buildArrivalBay() {
  const glowTex = glowTexture();
  const sea = buildWater();
  buildQuayAndJetty();
  const boat = buildBoat();
  const { warnings, shade, warningsLit } = buildFarShore(glowTex);
  let t = 0;
  return (dt) => {
    t += dt;
    sea.material.normalMap.offset.set(t * 0.004, t * 0.0025);
    boat.group.position.y = BOAT_MOOR.y + Math.sin(t * 1.3) * 0.05;
    boat.group.rotation.z = Math.sin(t * 0.9) * 0.025;
    boat.group.rotation.x = Math.sin(t * 1.1 + 1) * 0.012;
    boat.mixer?.update(dt);
    warnings.material.opacity = (Math.sin(t * 3) > 0.2 ? 0.95 : 0.15) * warningsLit();
    shade();
  };
}
