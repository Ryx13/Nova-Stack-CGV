// Level2.js — LEVEL 2 "THE CHASE"
//
// The player pursues a girl carrying a critical substance through an
// abandoned town toward a distant port. She moves at the player's walk
// speed, so the edge is route choice and power-ups — catch her (occupy
// her position + E) before she reaches the pier and teleports away.
//
// Design brief, zone map, and the implementation catalog live in
// level2.md. This file is everything the level owns, in order: level
// config + startLevel(), scene dressing builders (port set piece,
// street blockage, collapse zone, vending machines, coins), the girl
// NPC + route, purchases, adrenaline, the mission system (win/lose,
// teleport cinematic, zombie escalation), and the reference HUD.

import './Level2Config.js';  // MUST be first — sets skip flags before heavy modules
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene, camera, addStaticBox, pushKillFeed, dom, sfx, KILL_TARGET, STREET_HALF_W } from './Scene.js';
import { state } from './state.js';
import { makeWreck, makeBarrier, concreteTex, rustTex, dirtTex, playerVis, spawnZombie, loadDeferredAssets } from './characters.js';
import { spawnCoin } from './PowerUps.js';
import { createToxicMaterial } from './shaders.js';
import { bootLevel, registerLevelTick, levelKeyHooks } from './Actions.js';
import { VendingMachine, makeIcon } from './VendingMachine.js';

const LEVEL_CONFIG = {
  id: 2,
  name: 'Level 2 — The Chase',
  skip: { car: true, depot: true, extraction: true },
};

export function startLevel(mode) {
  bootLevel({ ...LEVEL_CONFIG, mode });
  // LIGHT BOOT — the heavy non-gating fetches (runner zombie variant,
  // pistol model, corpse dressing) start only once state.readyShown
  // flips, i.e. after the loading screen's two gating models are in;
  // before that they'd only be competing with the player/walker GLBs
  // for bandwidth. Level ticks run every frame from bootLevel() on —
  // including behind the loading overlay — so this watches from frame
  // one. (The 12-second failsafe in Scene.js also sets readyShown, so a
  // failed gate still releases the deferred fetches.)
  let lightBootFetchesStarted = false;
  registerLevelTick(() => {
    if (lightBootFetchesStarted || !state.readyShown) return;
    lightBootFetchesStarted = true;
    loadDeferredAssets();
  });
  // Level 2 dressing layer on top of the loaded base world (port,
  // blockage, collapse nest, machines, coins). Handles returned for the
  // logic phase — machines (purchase wiring) + teleportPoint (lose).
  const sceneHandles = buildLevel2Scene();
  lv2Scene = sceneHandles;
  // Reference-style HUD (objectives, distances, inventory panel).
  lv2HUD = buildLevel2HUD(sceneHandles.teleportPoint);
  // The chase itself: the girl NPC and her per-frame tick.
  spawnGirl();
  registerLevelTick(updateGirl);
  // Purchases: machine interaction tick + the E key.
  lv2Machines = [
    { kind: 'radar', machine: sceneHandles.machines.radar, price: RADAR_PRICE },
    { kind: 'adrenaline', machine: sceneHandles.machines.adrenaline, price: ADRENALINE_PRICE },
  ];
  lv2TeleportPoint = sceneHandles.teleportPoint;
  adrenalineStock = ADRENALINE_START_STOCK;
  registerLevelTick(updateVendingInteraction);
  levelKeyHooks.KeyE = handleKeyE;
  // Adrenaline boost lifecycle: the G key + the per-frame timer.
  registerLevelTick(updateAdrenaline);
  levelKeyHooks.KeyG = handleKeyG;
  // Mission: catch/win + lose cinematic, zombie escalation, killfeed
  // beats. Registered LAST so its girl-catch prompt write lands after
  // updateVendingInteraction's machine prompt write (girl wins ranges
  // that somehow overlap).
  // missionStartTime is armed on the first live frame in updateMission
  // so loading-screen seconds never count.
  buildLevel2EndScreens();
  registerLevelTick(updateMission);
}

// Handles for the logic phase: { machines, teleportPoint } from the
// scene build, plus lv2HUD (live HUD setters — setGirlDistance etc.).
export let lv2HUD = null;
export let lv2Scene = null;
// Purchase-system runtime refs, filled in startLevel().
let lv2Machines = null;   // [{ kind, machine, price }]
let lv2TeleportPoint = null;
let adrenalineStock = 0;  // remaining in the adrenaline machine
// End-screen refs, created by buildLevel2EndScreens (mission section).
let lv2Win = null, lv2WinStats = null;
let lv2Lose = null, lv2LoseStats = null;


/* ---------------------------------------------------------------------
   Deterministic RNG — own seed, own sequence. Never touches the
   characters.js mulberry32 instance, so base-street geometry stays
   byte-identical across levels while this dressing is also stable.
--------------------------------------------------------------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x5EED02);

// Port palette — the eerie teal that marks the destination.
const TEAL = 0x2affd5;
const TEAL_LIGHT = 0x17d5b0;
// Machine beacon palette — lime marks the start machine (radar), pink
// the mid-level one (adrenaline). Each machine's position glows in its
// own color through the fog from far away (see placeVendingMachine).
const RADAR_GLOW = 0x7cff3a;      // the ground marker's innate lime
const ADRENALINE_GLOW = 0xff4fd8; // pinkish — adrenaline's signature

const CONTAINER_COLORS = [0x8a3423, 0x2f4a5a, 0x6b6b2f, 0x3a4048, 0x6e4a20];

/* =====================================================================
   SMALL BUILDERS
===================================================================== */

/** Shipping container — rust-tinted box with darker end caps. Stacks by
    passing y (one container height = 2.55). `tipped` rocks it for a
    spilled look. Registers physics + zombie avoidance + occluders. */
function makeContainer(x, z, ry, y = 0, tipped = false) {
  const g = new THREE.Group();
  const col = CONTAINER_COLORS[(rnd() * CONTAINER_COLORS.length) | 0];
  const mat = new THREE.MeshStandardMaterial({ map: rustTex, color: col, roughness: 0.82, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.55, 6.1), mat);
  body.position.y = 1.28;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const capMat = new THREE.MeshStandardMaterial({ map: rustTex, color: 0x26292c, roughness: 0.75, metalness: 0.4 });
  [3.06, -3.06].forEach((cz) => {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.45, 2.35, 0.1), capMat);
    cap.position.set(0, 1.28, cz);
    g.add(cap);
  });
  if (tipped) { g.rotation.z = 0.22; g.position.y = -0.22; }
  g.position.set(x, y + g.position.y, z);
  g.rotation.y = ry;
  scene.add(g);
  g.traverse((o) => { if (o.isMesh) state.occluders.push(o); });
  addStaticBox(1.3, 1.28, 3.05, x, y + 1.28, z, ry);
  return g;
}

/** Port gantry crane — four legs, cross braces, long top beam, hanging
    trolley, and the unfogged teal beacon that reads from far away. */
function makeGantryCrane(x, z) {
  const g = new THREE.Group();
  const structMat = new THREE.MeshStandardMaterial({ map: rustTex, color: 0x5a4a3a, roughness: 0.7, metalness: 0.45 });
  const legs = [[-3.4, -1.7], [3.4, -1.7], [-3.4, 1.7], [3.4, 1.7]];
  legs.forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 15, 0.55), structMat);
    leg.position.set(lx, 7.5, lz);
    leg.castShadow = true;
    g.add(leg);
  });
  [-1.7, 1.7].forEach((lz) => {
    [2.2, 8.5, 13.5].forEach((ly) => {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(7.35, 0.35, 0.3), structMat);
      brace.position.set(0, ly, lz);
      g.add(brace);
    });
  });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(24, 1.3, 1.15), structMat);
  beam.position.set(3, 15.65, 0);
  beam.castShadow = true;
  g.add(beam);
  const trolley = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.2, 1.9), structMat);
  trolley.position.set(7.5, 14.6, 0);
  g.add(trolley);
  [-0.5, 0.5].forEach((ox) => {
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.07, 7.5, 0.07), structMat);
    cable.position.set(7.5 + ox, 10.4, 0);
    g.add(cable);
  });
  // Distant-glow beacon — unfogged so it pierces the murk from the start.
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 10, 8),
    new THREE.MeshBasicMaterial({ color: TEAL, fog: false })
  );
  beacon.position.set(3, 16.6, 0);
  g.add(beacon);
  g.position.set(x, 0, z);
  scene.add(g);
  g.traverse((o) => { if (o.isMesh) state.occluders.push(o); });
  legs.forEach(([lx, lz]) => addStaticBox(0.3, 7.5, 0.3, x + lx, 7.5, z + lz));
  return g;
}

/** Port warehouse — blank concrete shell with a rust roof and a dark
    loading-door inset. No windows: these are docks, not street front. */
function makeWarehouse(x, z, ry) {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x9aa0a4, roughness: 0.95 });
  const roofMat = new THREE.MeshStandardMaterial({ map: rustTex, color: 0x4a4038, roughness: 0.8, metalness: 0.3 });
  const W = 16, H = 6.5, D = 13;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat);
  body.position.y = H / 2;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.35, D + 0.6), roofMat);
  roof.position.y = H + 0.17;
  roof.castShadow = true;
  g.add(roof);
  const doorMat = new THREE.MeshStandardMaterial({ map: rustTex, color: 0x20242a, roughness: 0.7, metalness: 0.5 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3.6, 0.18), doorMat);
  door.position.set(0, 1.8, D / 2 + 0.05);
  g.add(door);
  // Thin unfogged teal strip above the door — a "powered" loading dock.
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(4.8, 0.1, 0.06),
    new THREE.MeshBasicMaterial({ color: TEAL, fog: false })
  );
  strip.position.set(0, 3.85, D / 2 + 0.12);
  g.add(strip);
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
  g.traverse((o) => { if (o.isMesh) state.occluders.push(o); });
  addStaticBox(W / 2, H / 2, D / 2, x, H / 2, z, ry);
  return g;
}

/** Moored ship silhouette out on the water — hull, superstructure,
    funnel, deck cargo. No physics/occluders: it sits beyond the south
    world bound and only ever reads as a dark shape in the murk. */
function makeShip(x, z, ry, hullLen) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x131a20, roughness: 0.9 });
  const rustMat = new THREE.MeshStandardMaterial({ map: rustTex, color: 0x3a3430, roughness: 0.8, metalness: 0.3 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(10, 4, hullLen), hullMat);
  hull.position.y = 2;
  g.add(hull);
  const bow = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 4), hullMat);
  bow.position.set(0, 2, hullLen / 2 + 1.6);
  bow.rotation.y = Math.PI / 4;
  bow.scale.x = 0.72;
  g.add(bow);
  const sup = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 7), hullMat);
  sup.position.set(0, 6.4, -hullLen / 2 + 5);
  g.add(sup);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 4, 10), rustMat);
  funnel.position.set(0, 10.4, -hullLen / 2 + 3.4);
  g.add(funnel);
  for (let i = 0; i < 4; i++) {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 2.2, 5.8),
      new THREE.MeshStandardMaterial({ map: rustTex, color: CONTAINER_COLORS[(rnd() * CONTAINER_COLORS.length) | 0], roughness: 0.85 })
    );
    crate.position.set((rnd() - 0.5) * 4, 5.1, (rnd() - 0.5) * (hullLen - 16));
    g.add(crate);
  }
  g.position.set(x, 0.05, z);
  g.rotation.y = ry;
  scene.add(g);
  return g;
}

/** Rubble pile — a cluster of concrete/dirt chunks under one footprint
    collider. The collapse zone's main dressing. */
function makeRubblePile(x, z, spread) {
  const g = new THREE.Group();
  const mats = [
    new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x9a9d9f, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x6f7376, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 }),
  ];
  const n = 4 + ((rnd() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const s = 0.8 + rnd() * (spread * 0.35);
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(s, s * (0.5 + rnd() * 0.5), s * (0.7 + rnd() * 0.6)), mats[(rnd() * mats.length) | 0]);
    chunk.position.set((rnd() - 0.5) * spread, s * 0.22 + rnd() * 0.3, (rnd() - 0.5) * spread);
    chunk.rotation.set(rnd() * 0.4, rnd() * Math.PI, (rnd() - 0.5) * 0.4);
    chunk.castShadow = chunk.receiveShadow = true;
    g.add(chunk);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  addStaticBox(spread / 2, 0.7, spread / 2, x, 0.7, z);
  return g;
}

/** Fallen scaffolding — tilted columns leaning on rubble. */
function makeFallenScaffold(x, z, ry) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.6, metalness: 0.55 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 2.2), mat);
  base.position.y = 0.12;
  g.add(base);
  [-0.7, 0.5].forEach((ox, i) => {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.16, 8.5, 0.16), mat);
    col.position.set(ox, 3.6, i * 0.8 - 0.4);
    col.rotation.z = 0.28 - i * 0.55;
    col.castShadow = true;
    g.add(col);
  });
  const plank = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 1), mat);
  plank.position.set(0.4, 5.2, 0);
  plank.rotation.z = 0.45;
  g.add(plank);
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
  addStaticBox(1.1, 3.5, 1.1, x, 3.5, z);
  return g;
}

/** Small visual debris — no physics, no avoidance. Pavement litter. */
function scatterDebris(x, z, n, spread) {
  const mats = [
    new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x7a7d7f, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ map: rustTex, color: 0x4a4440, roughness: 0.8 }),
  ];
  for (let i = 0; i < n; i++) {
    const s = 0.25 + rnd() * 0.55;
    const d = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.5, s * (0.6 + rnd())), mats[(rnd() * mats.length) | 0]);
    d.position.set(x + (rnd() - 0.5) * spread, s * 0.2, z + (rnd() - 0.5) * spread);
    d.rotation.y = rnd() * Math.PI;
    d.castShadow = d.receiveShadow = true;
    scene.add(d);
  }
}

/** Fallen-zombie street prop — light-boot replacement for the posed
    zombie_variant_b.glb decoration characters.js used to fetch (12.7 MB
    for one roadside dress piece). Pure geometry, no fetch; no collider —
    a ground-level body is walk-over set dressing, same convention as the
    (deferred) corpse scatter. Deterministic — consumes no rnd(), so the
    level's own seeded dressing sequence is untouched. */
function makeFallenZombie(x, z, ry) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x6c7a62, roughness: 0.9 });
  const cloth = new THREE.MeshStandardMaterial({ map: dirtTex, color: 0x4a4440, roughness: 0.95 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.26, 0.78), cloth);
  torso.position.set(0, 0.14, 0);
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skin);
  head.position.set(0, 0.15, 0.55);
  g.add(head);
  // One arm thrown out, one pinned under the torso — reads "taken down
  // mid-run" at street-prop distance.
  const armOut = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.13, 0.16), skin);
  armOut.position.set(0.48, 0.11, 0.28);
  armOut.rotation.y = 0.5;
  g.add(armOut);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.8), cloth);
  legs.position.set(-0.04, 0.12, -0.75);
  legs.rotation.y = -0.3;
  g.add(legs);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
  return g;
}

/** Vending machine + its collider + full beacon. The beacon is how the
    player finds the machine in the fog, in the machine's own glow
    color: a ground ring marking the stand-here spot, a vertical light
    column rising from the cabinet top (crests wrecks and containers
    from afar, but tops out well below the port's taller teal spire,
    which stays THE landmark), and a point light washing the cabinet
    front so it reads up close too. Ring and beam use the same unfogged,
    pulsing toxic material as the port beacon. `catalog` is the
    machine's supplies preset — Level 2 passes its own one-product
    presets (radar / adrenaline) below. */
function placeVendingMachine(x, z, ry, catalog, glow = RADAR_GLOW) {
  const machine = new VendingMachine({
    scene,
    position: new THREE.Vector3(x, 0, z),
    rotationY: ry,
    catalog,
  });
  addStaticBox(
    VendingMachine.WIDTH / 2, VendingMachine.HEIGHT / 2, VendingMachine.DEPTH / 2,
    x, VendingMachine.HEIGHT / 2, z, ry
  );
  // Ground ring — the stand-here spot. Offset clears the (now bigger)
  // cabinet's footprint while staying inside the 2.6 m buy range.
  const marker = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.7, 36), createToxicMaterial(glow));
  marker.rotation.x = -Math.PI / 2;
  // Local +Z is the cabinet front — drop the marker in front of it.
  marker.position.set(x + Math.sin(ry) * 2.2, 0.05, z + Math.cos(ry) * 2.2);
  scene.add(marker);
  // Vertical beam from the cabinet top — the position landmark.
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.5, 0.35), createToxicMaterial(glow));
  beam.position.set(x, VendingMachine.HEIGHT + 2.75, z);
  scene.add(beam);
  // Close-range wash so the cabinet itself reads in its glow color.
  const wash = new THREE.PointLight(glow, 1.6, 10, 2);
  wash.position.set(x + Math.sin(ry) * 0.8, 2.4, z + Math.cos(ry) * 0.8);
  scene.add(wash);
  return machine;
}

/** Persistent coin cluster. spawnCoin() gives combat drops a 24 s life;
    scene-placed loot is meant to wait for the player, so the freshly
    spawned entries get their life set to Infinity (updateCoins only
    removes on timeout or pickup — both fine with Infinity). */
function placeCoinCluster(x, z, n) {
  const before = state.coinPickups.length;
  for (let i = 0; i < n; i++) spawnCoin(new THREE.Vector3(x, 0, z));
  for (let i = before; i < state.coinPickups.length; i++) state.coinPickups[i].life = Infinity;
}

/* =====================================================================
   ZONE BUILDERS
===================================================================== */

/** THE PORT — the chase's destination and the level's signature image.
    Quay slab over the street end, dark teal water beyond the south
    world bound, gantry cranes, container yard, warehouses, ship
    silhouettes, and the pier with the teleport beacon (the girl's
    escape point). Returns the teleportPoint handle. */
function buildPort() {
  // Quay — concrete cap over the street end. No collider (18 cm step,
  // same convention as the base scene's curbs).
  const quay = new THREE.Mesh(
    new THREE.BoxGeometry(90, 0.18, 20),
    new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x8f9296, roughness: 0.95 })
  );
  quay.position.set(0, 0.09, -198); // z -188 → -208
  quay.receiveShadow = true;
  scene.add(quay);

  // Water — dark teal, faint emissive so it isn't pitch black at night.
  // Sits above the asphalt plane (which runs under everything) but below
  // the quay top. Past the south bound wall it's pure backdrop.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 58),
    new THREE.MeshStandardMaterial({
      color: 0x0c2a26, roughness: 0.38, metalness: 0.55,
      emissive: 0x04120f, emissiveIntensity: 0.4,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.05, -236); // z -207 → -265
  scene.add(water);

  // Bollards along the quay edge.
  const bollardMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.5 });
  for (let bx = -36; bx <= 36; bx += 8) {
    const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.7, 10), bollardMat);
    bollard.position.set(bx, 0.53, -207.2);
    bollard.castShadow = true;
    scene.add(bollard);
    addStaticBox(0.2, 0.35, 0.2, bx, 0.35, -207.2);
  }

  // Ships out on the water — silhouettes in the murk.
  makeShip(-40, -230, 0.35, 34);
  makeShip(30, -238, -0.5, 26);
  makeShip(5, -248, 0.1, 40);

  // Container yard — the mid-lane |x| < 4 stays clear (chase lane + pier
  // approach); stacks flank it. One pile spilled toward the quay edge.
  makeContainer(-12, -193, 0.12);
  makeContainer(-12, -193, 0.12, 2.55);
  makeContainer(-8.5, -196, -0.35);
  makeContainer(-15.5, -197.5, 0.55);
  makeContainer(12, -194, -0.15);
  makeContainer(12, -194, -0.15, 2.55);
  makeContainer(8.5, -197, 0.4);
  makeContainer(15.5, -198.5, -0.5);
  makeContainer(-26, -192, 1.5);
  makeContainer(26, -193, 1.5);
  makeContainer(-30, -196, 1.62, 0, true);
  makeContainer(30, -197, 1.62, 0, true);
  makeContainer(-36, -191, 0.35);
  makeContainer(36, -192, -0.35);

  // Warehouses flanking the yard.
  makeWarehouse(-28, -199, 0);
  makeWarehouse(28, -200, 0);

  // Gantry cranes straddling the container rows.
  makeGantryCrane(-21, -197);
  makeGantryCrane(23, -203);

  // One broad teal wash over the yard so the whole port reads "glowing
  // docks" once the player is close enough to see surfaces again.
  const wash = new THREE.PointLight(TEAL_LIGHT, 1.3, 30, 2);
  wash.position.set(0, 8, -196);
  scene.add(wash);

  // The pier — walkway over the water to the teleport beacon. The south
  // bound wall stops the player around z ≈ -208; the pier visual extends
  // past it so the beacon sits just out of reach. The girl (no physics
  // body) walks it in the logic phase — reaching it means she's gone.
  const g = new THREE.Group();
  const plankMat = new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x6a6f72, roughness: 0.9 });
  const postMat = new THREE.MeshStandardMaterial({ map: rustTex, color: 0x3a3f45, roughness: 0.7, metalness: 0.4 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.3, 9), plankMat);
  slab.position.set(0, 0.32, -207.5); // z -203 → -212
  slab.castShadow = slab.receiveShadow = true;
  g.add(slab);
  [[-1.9, -205], [1.9, -205], [-1.9, -210.5], [1.9, -210.5]].forEach(([px, pz]) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.2, 10), postMat);
    post.position.set(px, -0.4, pz);
    g.add(post);
  });
  [-2.15, 2.15].forEach((rx) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 8.6), postMat);
    rail.position.set(rx, 0.95, -207.4);
    g.add(rail);
  });
  // Teleport beacon: pulsing ring + light column, both unfogged — THE
  // landmark visible from the level start.
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.45, 40), createToxicMaterial(TEAL));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.49, -208.6);
  g.add(ring);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 11, 0.4), createToxicMaterial(TEAL));
  beam.position.set(0, 6, -208.6);
  g.add(beam);
  const beaconLight = new THREE.PointLight(TEAL_LIGHT, 2.6, 20, 2);
  beaconLight.position.set(0, 2.6, -208.4);
  g.add(beaconLight);
  scene.add(g);

  return { teleportPoint: new THREE.Vector3(0, 0, -208.6) };
}

/** MAIN-STREET BLOCKAGE (z ≈ -57) — the wreck-pile squeeze. Two wrecks
    and a barrier clog the road except for a tight gap at the east curb,
    making the west pocket (z ≈ -55) a genuine shortcut instead of a
    detour. */
function buildStreetBlockage() {
  makeWreck(-5.2, -57, 1.2);
  makeWreck(3.8, -57.5, -1.05);
  makeBarrier(0.6, -56.9, 0.12);
  scatterDebris(0, -57, 6, 6);
}

/** COLLAPSE ZONE (z -120 → -165) — the eastern lot where Level 1's
    depot yard was skipped becomes a rubble nest: cracked slab, rubble
    piles, fallen scaffolding, dense wrecks, one burning. The coin cache
    in the middle is the risk/reward bait. */
function buildCollapseZone() {
  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 46),
    new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x8a8d90, roughness: 0.96 })
  );
  slab.rotation.x = -Math.PI / 2;
  slab.position.set(28, 0.035, -142);
  slab.receiveShadow = true;
  scene.add(slab);

  makeRubblePile(20, -128, 6);
  makeRubblePile(34, -134, 7);
  makeRubblePile(24, -146, 8);
  makeRubblePile(36, -150, 6);
  makeRubblePile(20, -156, 7);
  makeRubblePile(30, -160, 5);
  makeFallenScaffold(16, -138, 0.6);
  makeFallenScaffold(38, -144, -0.9);

  // Wrecks in the lot + edging onto the street to constrict the road.
  makeWreck(20, -128, 0.9);
  makeWreck(34, -150, -0.6);
  makeWreck(24, -158, 0.3);
  makeWreck(38, -132, 1.4, true); // burning — the nest's beacon
  makeWreck(6, -126, 1.15);
  makeWreck(-6.5, -138, -1.0);
  makeWreck(5.5, -152, 0.9);
  scatterDebris(28, -142, 10, 30);

  placeCoinCluster(27, -143, 9);
}

/** ZONE DRESSING — Entrance / Centre clutter and the Final Approach
    chokepoints. Difficulty is density, not new barriers: the six base
    barriers stay untouched. */
function buildZoneDressing() {
  // Town Entrance — light clutter, one off-road wreck.
  makeWreck(6.2, -31, 0.4);
  scatterDebris(-4, -36, 4, 8);

  // Town Centre — denser: wrecks bracketing the z=-92 barrier line.
  makeWreck(5.2, -96, -0.5);
  makeWreck(-6.2, -104, 0.2);
  scatterDebris(0, -92, 5, 10);

  // Final Approach — the gauntlet: alternating wreck chokepoints, two
  // burning (fire light = the only warm color this deep in), spilled
  // containers as the town-to-docks transition.
  makeWreck(4.6, -170, 1.2);
  makeWreck(5.8, -174, -0.4, true);
  makeWreck(-5, -178, -1.15);
  makeWreck(-6.2, -183, 0.5, true);
  makeWreck(3, -186, 1.05);
  makeContainer(-4.2, -168, 0.35, 0, true);
  makeContainer(3.5, -190, -0.25, 0, true);
  scatterDebris(0, -175, 8, 14);
}

/* =====================================================================
   SCENE ENTRY POINT
===================================================================== */

/** Builds the full Level 2 dressing layer. Called once from startLevel(),
    after bootLevel(). Returns handles for the logic phase: the two
    machines (purchase wiring) and the teleport point (lose condition
    anchor). */
function buildLevel2Scene() {
  const port = buildPort();
  buildStreetBlockage();
  buildCollapseZone();
  buildZoneDressing();
  // Same spot characters.js' light-boot branch left empty when it
  // dropped the posed-zombie GLB prop (west curb, opposite the adrenaline
  // machine's beacon).
  makeFallenZombie(-(STREET_HALF_W + 3.2), -95, Math.PI / 2 - 0.2);

  const machines = {
    // West sidewalk, fronts facing the street (rotationY = +π/2).
    // Radar machine sits 20 m ahead of the player start (z +10) so its
    // lime beacon is visible from spawn; adrenaline stays mid-level
    // (centre, z -90) with the pink beacon.
    radar: placeVendingMachine(-13.4, 10, Math.PI / 2, radarCatalog, RADAR_GLOW),
    adrenaline: placeVendingMachine(-13.4, -90, Math.PI / 2, adrenalineCatalog, ADRENALINE_GLOW),
  };

  // Persistent coin clusters along the route — the machine economy's
  // second income stream besides zombie drops.
  placeCoinCluster(2, 8, 3);       // Outskirts
  placeCoinCluster(-3, -5, 3);     // Outskirts
  placeCoinCluster(-28, -53, 3);   // west pocket detour reward
  placeCoinCluster(7.5, -62, 3);   // past the blockage squeeze
  placeCoinCluster(4, -80, 3);     // Centre
  placeCoinCluster(-5, -105, 3);   // Centre
  placeCoinCluster(0, -172, 4);    // Final Approach
  placeCoinCluster(-2, -188, 4);   // Final Approach
  placeCoinCluster(5, -195, 3);    // Port edge
  placeCoinCluster(-5, -200, 3);   // Port edge

  return { machines, teleportPoint: port.teleportPoint };
}



// Placeholder model: Injured Run.glb (single Mixamo run clip — a
// fleeing figure, thematically right for the chase). Any single-clip
// rigged GLB drops in here; the loader plays animations[0].
const GIRL_GLB = 'assets/Injured Run.glb';
const GIRL_SPEED = 3.7;          // = player walk speed — the locked design
const GIRL_TARGET_HEIGHT = 1.65;
const GIRL_RIG_YAW_OFFSET = 0;   // flip to Math.PI if she runs backwards

// Her route: 50 m head start at spawn (z -20, straight down the street
// from the player start at z 30 — visible from frame one, which is the
// point) → past the first barrier chicane → through the blockage's
// east-curb gap (z -57) → weaving the collapse-zone street wrecks →
// threading the final-approach gauntlet → across the quay → down the
// pier to the teleport beacon. y values step onto the quay (0.18) and
// pier (0.47) slabs. Waypoints keep ~5 m clearance from every placed
// wreck/container so she never visibly clips through one.
const GIRL_WAYPOINTS = [
  { x: 0,   y: 0,    z: -20 },   // spawn — 50 m head start, in sight
  { x: 1.5, y: 0,    z: -33 },
  { x: 4,   y: 0,    z: -52 },
  { x: 7.5, y: 0,    z: -57 },   // blockage east-curb gap
  { x: 6,   y: 0,    z: -64 },
  { x: 2,   y: 0,    z: -80 },
  { x: -2,  y: 0,    z: -95 },   // past the adrenaline machine
  { x: 0,   y: 0,    z: -110 },
  { x: -3,  y: 0,    z: -125 },  // collapse-zone street weave
  { x: 1,   y: 0,    z: -140 },
  { x: -2,  y: 0,    z: -158 },
  { x: -3,  y: 0,    z: -170 },  // final-approach gauntlet
  { x: 2,   y: 0,    z: -180 },
  { x: 0,   y: 0,    z: -194 },
  { x: 0,   y: 0.18, z: -197 },  // onto the quay
  { x: 0,   y: 0.47, z: -203 },  // onto the pier
  { x: 0,   y: 0.47, z: -208.6 },// the beacon — she's gone (lose)
];

let girl = null; // { group, mixer, wpIndex }
let girlSpotted = false;
let girlAnnounced = false; // "head start" beat — fired on the first live frame

function spawnGirl() {
  new GLTFLoader().load(GIRL_GLB, (gltf) => {
    const obj = gltf.scene;
    // Ground-snap + scale to target height — the loadDecorCar pattern.
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    obj.scale.setScalar(GIRL_TARGET_HEIGHT / Math.max(size.y, 0.2));
    const box2 = new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3(); box2.getCenter(center);
    obj.position.set(-center.x, -box2.min.y, -center.z);
    // Distinct cool tint + raised emissive: readable at the 50 m spawn
    // distance through night fog, without glowing like a beacon.
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      o.material = o.material.clone();
      o.material.color.multiply(new THREE.Color(0.75, 1.15, 1.05));
      o.material.emissive = new THREE.Color(0x1f5a4d);
    });
    const group = new THREE.Group();
    group.add(obj);
    // A faint teal glint travelling with her — catches the eye at spawn
    // distance and reads as motion while she weaves through the fog.
    const glint = new THREE.PointLight(TEAL_LIGHT, 0.9, 7, 2);
    glint.position.set(0, 1.3, 0);
    group.add(glint);
    const wp = GIRL_WAYPOINTS[0];
    group.position.set(wp.x, wp.y, wp.z);
    scene.add(group);
    // Single-clip model — play the run clip.
    let mixer = null;
    if (gltf.animations && gltf.animations.length) {
      mixer = new THREE.AnimationMixer(obj);
      mixer.clipAction(gltf.animations[0]).play();
    }
    girl = { group, mixer, wpIndex: 1 };
    state.girlPos = group.position; // live reference — see section header
    // "Head start" announcement moved to updateGirl's first LIVE frame —
    // pushed here it would fire behind the loading overlay and fade
    // before anyone can read it.
  }, undefined, () => {
    // Model failed to load — spawn an invisible marker girl instead so
    // the CHASE still fully functions (movement, radar dot, catch/lose
    // checks all key off state.girlPos): there's just no visible runner.
    // Fail soft like every other loader in the project.
    const group = new THREE.Group();
    const wp = GIRL_WAYPOINTS[0];
    group.position.set(wp.x, wp.y, wp.z);
    scene.add(group);
    girl = { group, mixer: null, wpIndex: 1 };
    state.girlPos = group.position;
  });
}

function updateGirl(dt) {
  // Loading-screen gate: state.readyShown flips exactly when the HUD is
  // revealed (maybeReady), so nothing about the chase — her movement,
  // the announce beat, the escalation clock — runs behind the overlay.
  // Without this she burns her head start while the progress bar is up.
  if (!state.readyShown) return;
  if (!girl || state.paused || state.girlCaught) return;
  if (!girlAnnounced) {
    girlAnnounced = true;
    pushKillFeed('She has a head start — move!');
  }
  // After the lose trigger the cinematic (mission phase) owns her; while
  // the player is dead for any other reason she simply holds position.
  if (state.isDead && !state.portReached) return;
  const g = girl.group;
  if (!state.portReached) {
    const wp = GIRL_WAYPOINTS[girl.wpIndex];
    const dx = wp.x - g.position.x, dz = wp.z - g.position.z;
    const dist = Math.hypot(dx, dz);
    const step = GIRL_SPEED * dt;
    if (dist <= step) {
      g.position.set(wp.x, wp.y, wp.z);
      girl.wpIndex++;
      if (girl.wpIndex >= GIRL_WAYPOINTS.length) state.portReached = true;
    } else {
      g.position.x += (dx / dist) * step;
      g.position.z += (dz / dist) * step;
      // Height eases between waypoint y values (quay/pier steps).
      g.position.y += (wp.y - g.position.y) * Math.min(1, dt * 6);
      g.rotation.y = Math.atan2(dx, dz) + GIRL_RIG_YAW_OFFSET;
    }
  }
  if (girl.mixer) girl.mixer.update(dt);
  // First-sight killfeed — one-shot, purely an atmosphere beat.
  if (!girlSpotted && playerVis) {
    if (playerVis.group.position.distanceTo(g.position) < 25) {
      girlSpotted = true;
      pushKillFeed('Girl spotted — heading for the port!');
    }
  }
}



const RADAR_PRICE = 25;
const ADRENALINE_PRICE = 45;
const ADRENALINE_START_STOCK = 3;

// One-product "support" presets — what each machine shows on its shelf.
const radarCatalog = {
  support: [{
    id: 'radar_upgrade', itemId: 'radar_upgrade', name: 'RADAR',
    category: 'support', price: RADAR_PRICE, stock: 1,
    icon: makeIcon(96, 48, (ctx) => {
      ctx.strokeStyle = '#99aa88'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(40, 24, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(40, 24, 9, 0, Math.PI * 2); ctx.stroke();
      // sweep beam + center dot + contact blip
      ctx.beginPath(); ctx.moveTo(40, 24); ctx.lineTo(58, 12); ctx.stroke();
      ctx.fillStyle = '#99aa88';
      ctx.beginPath(); ctx.arc(40, 24, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(53, 30, 2, 0, Math.PI * 2); ctx.fill();
    }),
  }],
};

const adrenalineCatalog = {
  support: [{
    id: 'adrenaline', itemId: 'adrenaline', name: 'ADRENALINE SHOT',
    category: 'support', price: ADRENALINE_PRICE, stock: ADRENALINE_START_STOCK,
    icon: makeIcon(96, 48, (ctx) => {
      ctx.strokeStyle = '#99aa88'; ctx.lineWidth = 2;
      // syringe, drawn diagonally: barrel, plunger, needle
      ctx.strokeRect(34, 18, 18, 8);
      ctx.beginPath(); ctx.moveTo(34, 22); ctx.lineTo(26, 22); ctx.stroke();
      ctx.strokeRect(21, 19, 5, 6);
      ctx.beginPath(); ctx.moveTo(52, 22); ctx.lineTo(64, 22); ctx.stroke();
      // dose marks on the barrel
      ctx.beginPath(); ctx.moveTo(39, 18); ctx.lineTo(39, 26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(46, 18); ctx.lineTo(46, 26); ctx.stroke();
    }),
  }],
};

/** Purchase prompt text for a machine in range. */
function machinePromptText(def) {
  if (def.kind === 'radar') {
    return state.hasRadarUpgrade ? 'Radar already installed' : `Buy RADAR (${def.price} coins)`;
  }
  if (adrenalineStock <= 0) return 'ADRENALINE — sold out';
  return `Buy ADRENALINE (${def.price} coins)`;
}

/** Validate + apply a purchase. All feedback through the killfeed —
    no shopping UI, matching the display-only machine design. */
function buyFromMachine(def) {
  if (def.kind === 'radar') {
    if (state.hasRadarUpgrade) { pushKillFeed('Radar already installed'); return; }
    if (state.coins < def.price) { pushKillFeed(`Not enough coins — need ${def.price}`); return; }
    state.coins -= def.price;
    state.hasRadarUpgrade = true;
    sfx.pickup();
    pushKillFeed('RADAR installed — girl tracked on radar & compass');
    if (lv2HUD) lv2HUD.setItemCount('radar', 1);
  } else {
    if (adrenalineStock <= 0) { pushKillFeed('Adrenaline sold out'); return; }
    if (state.coins < def.price) { pushKillFeed(`Not enough coins — need ${def.price}`); return; }
    state.coins -= def.price;
    adrenalineStock--;
    state.adrenalineCharges++;
    sfx.pickup();
    pushKillFeed(`Adrenaline acquired — press G to activate (${adrenalineStock} left in stock)`);
    if (lv2HUD) lv2HUD.setItemCount('adrenaline', state.adrenalineCharges);
  }
}

/** E key — girl catch first, then machine purchase. */
function handleKeyE() {
  if (state.isDead || state.paused || state.girlCaught) return;
  if (!playerVis) return;
  // Catch: occupy her position + press E — the locked win condition.
  if (state.girlPos && playerVis.group.position.distanceTo(state.girlPos) < CATCH_RANGE) {
    catchGirl();
    return;
  }
  if (!lv2Machines) return;
  for (const def of lv2Machines) {
    if (playerVis.group.position.distanceTo(def.machine.root.position) < 2.6) {
      buyFromMachine(def);
      return;
    }
  }
}

/** Per-frame purchase/interaction tick. Also owns two always-on Level 2
    HUD drives while the player is alive: the compass retarget (port →
    girl once the radar is bought — the locked design) and the live
    girl-distance row fed through lv2HUD.setGirlDistance. */
function updateVendingInteraction() {
  if (!lv2Machines || state.isDead || state.paused || state.girlCaught) return;
  // Compass retarget: PORT is the visible goal from the start; GIRL only
  // after the radar purchase. girlPos is a live Vector3 reference, so the
  // override stays current as she moves without resetting it per frame.
  state.compassOverride = state.hasRadarUpgrade && state.girlPos
    ? { pos: state.girlPos, label: 'GIRL' }
    : { pos: lv2TeleportPoint, label: 'PORT' };
  if (state.hasRadarUpgrade && state.girlPos && lv2HUD && playerVis) {
    lv2HUD.setGirlDistance(playerVis.group.position.distanceTo(state.girlPos));
  }
  // Machine prompt — runs after Actions' updateInteractionPrompt(), which
  // (skipCar) hides the stock prompt every frame; showing here wins.
  let best = null, bestD = Infinity;
  for (const def of lv2Machines) {
    const d = playerVis.group.position.distanceTo(def.machine.root.position);
    if (d < 2.6 && d < bestD) { bestD = d; best = def; }
  }
  if (best) {
    dom.prompt.classList.remove('hidden');
    dom.prompt.querySelector('b').textContent = 'E';
    dom.promptText.textContent = machinePromptText(best);
  } else {
    dom.prompt.classList.add('hidden');
  }
}


const ADRENALINE_DURATION = 10; // seconds — full duration per the design

/** G key — activate a stored charge. */
function handleKeyG() {
  if (state.isDead || state.paused || state.girlCaught) return;
  if (state.adrenalineActive) { pushKillFeed('Adrenaline already running'); return; }
  if (state.adrenalineCharges <= 0) {
    pushKillFeed('No adrenaline — the machine in the town centre sells it');
    return;
  }
  state.adrenalineCharges--;
  state.adrenalineActive = true;
  state.adrenalineTimer = ADRENALINE_DURATION;
  sfx.pickup();
  pushKillFeed(`ADRENALINE — +45% speed for ${ADRENALINE_DURATION}s`);
}

/** Per-frame boost timer. Owns the inventory slot label while running
    (live countdown), restoring the x<count> label on expiry — the HUD
    poll skips the adrenaline slot while active so the two writers never
    fight over it. */
function updateAdrenaline(dt) {
  if (!state.adrenalineActive) return;
  state.adrenalineTimer -= dt;
  if (state.adrenalineTimer <= 0) {
    state.adrenalineActive = false;
    state.adrenalineTimer = 0;
    pushKillFeed('Adrenaline worn off');
    if (lv2HUD) lv2HUD.setSlotText('adrenaline', `x${state.adrenalineCharges}`);
    return;
  }
  if (lv2HUD) lv2HUD.setSlotText('adrenaline', `${Math.ceil(state.adrenalineTimer)}s`);
}



const CATCH_RANGE = 2.2;   // "occupy her position" tolerance for the E grab
const ESCALATE_START = 6;  // extra-spawn interval at girl progress 0 (s)
const ESCALATE_MIN = 1.2;  // ...at progress 1 — she's at the pier
// Her full route length, measured from the waypoint list — the progress
// denominator for the escalation ramp.
const GIRL_ROUTE_LENGTH = GIRL_WAYPOINTS.reduce((acc, wp, i) => {
  if (!i) return acc;
  const prev = GIRL_WAYPOINTS[i - 1];
  return acc + Math.hypot(wp.x - prev.x, wp.z - prev.z);
}, 0);

let missionStartTime = 0;  // armed on the first live frame in updateMission
let escalationTimer = ESCALATE_START;
// One-shot killfeed progress beats (see the TODO catalog's beat list).
let beatClosingIn = false, beatNearingPort = false, beatFinalStretch = false;
// Active lose cinematic: { phase: 'approach'|'teleport', t, camGoal,
// lookAt, flash, flashLight }. Null outside the ~4 s sequence.
let loseCinematic = null;

/** The two Level 2 end screens, mirroring the stock .end-screen pattern
    (index.html owns the shared CSS). ANTIDOTE SECURED reads green like
    the stock win; YOU LOST THE ANTIDOTE reads teal — the port's color. */
function buildLevel2EndScreens() {
  if (lv2Win) return; // already built (one session = one level run)
  const style = document.createElement('style');
  style.textContent = `
    #lv2-winscreen .end-title { color: #5fe07f; text-shadow: 0 0 30px rgba(60,220,110,.6); }
    #lv2-losescreen .end-title { color: #2affd5; text-shadow: 0 0 30px rgba(42,255,213,.55); }
  `;
  document.head.appendChild(style);

  const winEl = document.createElement('div');
  winEl.id = 'lv2-winscreen';
  winEl.className = 'end-screen hidden';
  winEl.innerHTML = `
    <h1 class="end-title">ANTIDOTE SECURED</h1>
    <div class="end-sub" id="lv2-win-stats"></div>
    <button onclick="location.reload()">Play Again</button>`;
  document.body.appendChild(winEl);
  lv2Win = winEl;
  lv2WinStats = winEl.querySelector('#lv2-win-stats');

  const loseEl = document.createElement('div');
  loseEl.id = 'lv2-losescreen';
  loseEl.className = 'end-screen hidden';
  loseEl.innerHTML = `
    <h1 class="end-title">YOU LOST THE ANTIDOTE</h1>
    <div class="end-sub" id="lv2-lose-stats"></div>
    <button onclick="location.reload()">Restart Demo</button>`;
  document.body.appendChild(loseEl);
  lv2Lose = loseEl;
  lv2LoseStats = loseEl.querySelector('#lv2-lose-stats');
}

/** Chase duration for the end-screen stat lines. */
function chaseSeconds() {
  return ((performance.now() - missionStartTime) / 1000).toFixed(1);
}

/** WIN — the player occupied her position and pressed E (handleKeyE).
    Instant screen, same beat as the stock doWin. */
function catchGirl() {
  state.girlCaught = true;
  state.isDead = true;             // freezes the gameplay gate
  state.adrenalineActive = false; // stop the countdown label writer
  sfx.setEngine(0, false);
  sfx.pickup();
  document.exitPointerLock();
  dom.prompt.classList.add('hidden');
  if (girl) scene.remove(girl.group); // grabbed — she's gone
  lv2WinStats.textContent =
    `Infected eliminated: ${state.kills} · Coins: ${state.coins} · Antidote secured in ${chaseSeconds()} s`;
  lv2Win.classList.remove('hidden');
}

/** LOSE trigger — she made the pier beacon. Hands the next ~4 s to the
    cinematic: camera swings to a pier vantage framing her at the
    beacon, the teleport flash takes her, then the lose screen. */
function startLoseCinematic() {
  state.isDead = true;             // freeze gameplay incl. the stock camera
  state.adrenalineActive = false;
  sfx.setEngine(0, false);
  document.exitPointerLock();
  dom.prompt.classList.add('hidden');
  pushKillFeed('She reached the port —');
  // Vantage past the quay's container stacks, framing her on the pier
  // with the beacon beam and open water behind her.
  const gp = state.girlPos;
  loseCinematic = {
    phase: 'approach',
    t: 0,
    camGoal: new THREE.Vector3(6.5, 3.4, -196.5),
    lookAt: new THREE.Vector3(gp.x, 1.2, gp.z),
    flash: null,
    flashLight: null,
  };
}

/** The cinematic itself — this tick owns the camera while the gameplay
    gate is frozen. approach (~2.2 s): swing to the vantage, watching her
    wait at the beacon. teleport (~1.5 s): expanding teal flash + light
    spike, she fades and is drawn up into the beam, then the screen. */
function updateLoseCinematic(dt) {
  const c = loseCinematic;
  c.t += dt;
  camera.position.lerp(c.camGoal, Math.min(1, dt * 1.8));
  camera.lookAt(c.lookAt);

  if (c.phase === 'approach') {
    if (c.t >= 2.2) {
      c.phase = 'teleport';
      c.t = 0;
      // The beacon takes her: unfogged additive flash + light spike.
      const p = state.girlPos.clone();
      const flash = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 24, 16),
        new THREE.MeshBasicMaterial({
          color: TEAL, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        })
      );
      flash.position.copy(p); flash.position.y += 1;
      scene.add(flash);
      const light = new THREE.PointLight(TEAL_LIGHT, 0, 26, 2);
      light.position.copy(p); light.position.y += 1.4;
      scene.add(light);
      c.flash = flash;
      c.flashLight = light;
      sfx.burst('sawtooth', 720, 1.1, 0.3);
      pushKillFeed('— and teleported away.');
    }
    return;
  }

  // Teleport phase — flash expands & fades, girl dissolves into it.
  const k = Math.min(1, c.t / 1.5);
  if (c.flash) {
    c.flash.scale.setScalar(1 + k * 9);
    c.flash.material.opacity = 0.85 * (1 - k);
  }
  if (c.flashLight) c.flashLight.intensity = 9 * Math.sin(k * Math.PI);
  if (girl) {
    girl.group.traverse((o) => {
      if (!o.isMesh) return;
      o.material.transparent = true;
      o.material.opacity = 1 - k;
    });
    girl.group.position.y += dt * 1.6; // drawn up into the beam
  }
  if (k >= 1) {
    if (girl) { scene.remove(girl.group); girl = null; }
    if (c.flash) {
      scene.remove(c.flash);
      c.flash.geometry.dispose();
      c.flash.material.dispose();
    }
    if (c.flashLight) scene.remove(c.flashLight);
    state.girlPos = null;
    loseCinematic = null;
    lv2LoseStats.textContent =
      `Infected eliminated: ${state.kills} · Coins: ${state.coins} · She reached the port in ${chaseSeconds()} s`;
    lv2Lose.classList.remove('hidden');
  }
}

/** Per-frame mission tick — see the section header for the priority
    order. */
function updateMission(dt) {
  // Same loading gate as updateGirl — and the chase clock arms HERE,
  // on the first live frame, so loading-screen seconds never count
  // toward the win-screen time stat.
  if (!state.readyShown) return;
  if (!missionStartTime) missionStartTime = performance.now();
  if (state.paused) return;
  if (loseCinematic) { updateLoseCinematic(dt); return; }
  if (state.girlCaught || state.isDead) return; // ended either way
  if (!playerVis || !state.girlPos) return;

  // Lose trigger — updateGirl (registered earlier) already flagged her
  // arrival at the beacon this frame.
  if (state.portReached) { startLoseCinematic(); return; }

  // Catch prompt — a near-approach cue before grab range itself.
  const distToGirl = playerVis.group.position.distanceTo(state.girlPos);
  if (distToGirl < CATCH_RANGE * 1.6) {
    dom.prompt.classList.remove('hidden');
    dom.prompt.querySelector('b').textContent = 'E';
    dom.promptText.textContent = distToGirl <= CATCH_RANGE ? 'Grab the antidote' : 'Get closer…';
  }

  // One-shot progress beats — the chase's tension clock.
  if (!beatClosingIn && distToGirl < 12) {
    beatClosingIn = true;
    pushKillFeed('Closing in — keep the pressure on');
  }
  const girlDist = state.girlPos.distanceTo(lv2TeleportPoint);
  if (!beatNearingPort && girlDist < 50) {
    beatNearingPort = true;
    pushKillFeed("She's nearing the port!");
  } else if (!beatFinalStretch && girlDist < 25) {
    beatFinalStretch = true;
    pushKillFeed("Final stretch — she's almost gone!");
  }

  // Zombie escalation — the base spawner keeps its flat 2.5 s beat; this
  // adds pressure ramping with her progress to the port. The stock
  // spawner's total cap (KILL_TARGET + 10) is Level 1 pacing — kills
  // aren't this level's goal — so the counter is kept from running dry;
  // the alive cap (14) still bounds everything.
  if (state.spawnedTotal >= KILL_TARGET + 8) state.spawnedTotal = 0;
  escalationTimer -= dt;
  if (escalationTimer <= 0) {
    const progress = THREE.MathUtils.clamp(1 - girlDist / GIRL_ROUTE_LENGTH, 0, 1);
    escalationTimer = ESCALATE_START - (ESCALATE_START - ESCALATE_MIN) * progress;
    spawnZombie();
  }
}


// Compact inline icons — currentColor lets CSS own the tint.
const LV2_ICON_HEART = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 21S4.5 16.1 2.2 11.8C.4 8.6 2 5 5.5 5c2 0 3.4 1.1 4.3 2.6C10.7 6.1 12.1 5 14.1 5c3.5 0 5.1 3.6 3.3 6.8C19.5 16.1 12 21 12 21z"/></svg>';
const LV2_ICON_RUNNER = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M13 3a2 2 0 1 1-2 2 2 2 0 0 1 2-2m-1.2 6.7.9-2.3 4.6 2.1v3h-2v-1.8l-2.1-1-1.8 4.6 2.6 2.6v5.1h-2v-4l-3.2-3.2-1.6 4.5-5.4 2.5-.8-1.8 4.4-2 2.6-7.5-1.6.9v3.5h-2v-4.7l4.4-2.5a2.5 2.5 0 0 1 3 .5z"/></svg>';
const LV2_ICON_RADAR = '<svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="2.4" fill="currentColor"/><path d="M12 12 20 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M7 17a7 7 0 1 1 10 0" fill="none" stroke="currentColor" stroke-width="1.7" opacity="0.55"/><path d="M4.5 19.5a10.5 10.5 0 1 1 15 0" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3"/></svg>';
const LV2_ICON_SYRINGE = '<svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M4 20.5 6.5 18 8 19.5 5.5 22 4 20.5zM14.7 3.3l6 6-1.4 1.4-1-1-8 8-3-3 8-8-1-1 1.4-1.4zM13 8.5l2.5 2.5 2-2-2.5-2.5-2 2z"/></svg>';
const LV2_ICON_SHIP = '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M3 15h18l-2.2 4.5H5.2L3 15zm8.5-2.5V6l6 6.5h-6z"/></svg>';

/** Builds the Level 2 HUD. Call once from startLevel(). Returns live
    setters for the logic phase. */
function buildLevel2HUD(portTarget) {
  document.body.classList.add('lv2-hud');

  const style = document.createElement('style');
  style.textContent = `
    /* ---- stock HUD elements restyled for Level 2 only ---- */
    body.lv2-hud #objective, body.lv2-hud #killcount { display: none; }
    body.lv2-hud #coin-label { display: none !important; }
    body.lv2-hud #killfeed { top: 248px; }
    /* Reference-matching cuts: no center compass (the radar's target
       blip + the distance rows carry direction), no pause button (Tab
       still pauses), no weapon/ammo block (the reference's bottom-right
       is the inventory panel), and no weapon label (#weapon-label is
       built dynamically in Scene.js and floats bottom-center). */
    body.lv2-hud #objective-compass, body.lv2-hud #pause-btn,
    body.lv2-hud #bottom-right, body.lv2-hud #weapon-label { display: none; }
    body.lv2-hud #stamina-fill { background: linear-gradient(90deg, #0d3a8a, #2f7fe0); }
    body.lv2-hud .bar-label { display: none; }
    body.lv2-hud .bar-wrap { display: flex; align-items: center; gap: 8px; }
    body.lv2-hud .bar-icon { display: flex; color: #fff; width: 18px; height: 18px;
      filter: drop-shadow(0 0 3px rgba(255,255,255,.35)); flex: none; }
    body.lv2-hud .bar-bg { flex: 1; }
    /* Reference: the bars sit in their own angled translucent panel. */
    body.lv2-hud #bottom-left { width: 240px; padding: 12px 14px;
      background: rgba(8,10,14,.58); border: 1px solid rgba(255,255,255,.14);
      clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px)); }
    /* Radar restyle toward the reference compass: teal ring glow, red N. */
    body.lv2-hud #radar-wrap { border-color: rgba(42,255,213,.4);
      box-shadow: 0 0 14px rgba(42,255,213,.22), inset 0 0 18px rgba(42,255,213,.1); }
    body.lv2-hud #radar-wrap::before { content: "N"; position: absolute; top: 0; left: 50%;
      transform: translateX(-50%); font: 700 11px/12px 'Oswald', sans-serif;
      color: #ff5252; text-shadow: 0 0 6px rgba(255,80,80,.9); z-index: 2; }

    /* ---- objectives (top-left) — reference: dimmed panel, secondary
       objective grayed, no kills line ---- */
    #lv2-objectives { position: absolute; top: 18px; left: 22px; max-width: 330px;
      font-size: 14.5px; font-weight: 600; letter-spacing: 0.5px; color: #fff;
      text-shadow: 0 1px 3px rgba(0,0,0,.85);
      background: rgba(8,10,14,.58); border: 1px solid rgba(255,255,255,.14);
      border-radius: 4px; padding: 12px 16px; }
    #lv2-objectives .lv2-obj { display: flex; align-items: flex-start; gap: 9px;
      margin-bottom: 5px; line-height: 1.25; }
    #lv2-objectives .lv2-obj:last-child { margin-bottom: 0; }
    #lv2-objectives .lv2-obj.secondary { color: #b7b0a2; }
    .lv2-obj-icon { flex: none; width: 13px; height: 13px; margin-top: 3px; }
    .lv2-obj-icon.active { color: #e0a83c; text-shadow: 0 0 8px rgba(224,168,60,.8);
      font-size: 13px; line-height: 13px; }
    .lv2-obj-icon.box { border: 1.5px solid rgba(255,255,255,.5); margin-top: 4px; }

    /* ---- distances (top-right, under the radar) ---- */
    #lv2-distances { position: absolute; top: 176px; right: 22px; width: 150px;
      text-align: right; font-size: 13px; font-weight: 600; color: #fff;
      text-shadow: 0 1px 3px rgba(0,0,0,.85); }
    #lv2-distances .lv2-dist-row { display: flex; justify-content: flex-end;
      align-items: center; gap: 6px; margin-bottom: 3px; }
    #lv2-port-dist svg { color: #2affd5; filter: drop-shadow(0 0 4px rgba(42,255,213,.6)); }

    /* ---- inventory panel (bottom-right) ---- */
    #lv2-inventory { position: absolute; right: 22px; bottom: 22px; width: 216px;
      background: rgba(8,10,14,.6); border: 1px solid rgba(255,255,255,.14);
      padding: 12px 14px; backdrop-filter: blur(2px);
      clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px)); }
    #lv2-inventory .lv2-inv-slots { display: flex; justify-content: space-between; gap: 10px; }
    .lv2-inv-slot { display: flex; flex-direction: column; align-items: center; gap: 4px;
      opacity: 0.4; transition: opacity .3s; }
    .lv2-inv-slot.owned { opacity: 1; }
    #lv2-slot-radar svg { color: #37c8ff; }
    #lv2-slot-radar.owned svg { filter: drop-shadow(0 0 7px rgba(55,200,255,.9)); }
    #lv2-slot-adrenaline svg { color: #b44aff; }
    #lv2-slot-adrenaline.owned svg { filter: drop-shadow(0 0 7px rgba(180,74,255,.9)); }
    .lv2-inv-label { font-size: 10px; letter-spacing: 1.5px; color: #e8e4da;
      text-shadow: 0 1px 2px #000; }
    .lv2-inv-label b { color: #fff; font-weight: 700; }
    #lv2-inventory .lv2-inv-coins { display: flex; align-items: center; gap: 7px;
      margin-top: 11px; padding-top: 9px; border-top: 1px solid rgba(255,255,255,.12);
      font-size: 17px; font-weight: 700; color: #fff; }
    .lv2-coin { width: 15px; height: 15px; border-radius: 50%; background: #ffd94a;
      box-shadow: 0 0 6px #ffb400, inset 0 0 0 2.5px rgba(120,70,0,.55); flex: none; }
  `;
  document.head.appendChild(style);

  const hud = document.getElementById('hud');

  // Objectives — active goal marked with the amber diamond, secondary
  // with the empty checkbox, exactly as in the reference.
  const objectives = document.createElement('div');
  objectives.id = 'lv2-objectives';
  objectives.innerHTML = `
    <div class="lv2-obj"><span class="lv2-obj-icon active">◆</span>Catch the girl before she reaches the port.</div>
    <div class="lv2-obj secondary"><span class="lv2-obj-icon box"></span>Reach the port before her.</div>`;
  hud.appendChild(objectives);

  // Distances — port readout always live; girl row hidden until the
  // radar upgrade is bought (locked design decision).
  const distances = document.createElement('div');
  distances.id = 'lv2-distances';
  distances.innerHTML = `
    <div class="lv2-dist-row hidden" id="lv2-girl-dist">Girl: <span id="lv2-girl-m">—</span></div>
    <div class="lv2-dist-row" id="lv2-port-dist">${LV2_ICON_SHIP}<span>Port: </span><span id="lv2-port-m">—</span></div>`;
  hud.appendChild(distances);

  // Inventory — radar + adrenaline slots and the coin total.
  const inventory = document.createElement('div');
  inventory.id = 'lv2-inventory';
  inventory.innerHTML = `
    <div class="lv2-inv-slots">
      <div class="lv2-inv-slot" id="lv2-slot-radar">${LV2_ICON_RADAR}<div class="lv2-inv-label">RADAR <b>x0</b></div></div>
      <div class="lv2-inv-slot" id="lv2-slot-adrenaline">${LV2_ICON_SYRINGE}<div class="lv2-inv-label">ADRENALINE <b>x0</b></div></div>
    </div>
    <div class="lv2-inv-coins"><span class="lv2-coin"></span><span id="lv2-coins">0</span></div>`;
  hud.appendChild(inventory);

  // Bar icons — white glyphs injected into the existing stock bars
  // (display is CSS-gated on body.lv2-hud, so no other level sees them).
  [['health-fill', LV2_ICON_HEART], ['stamina-fill', LV2_ICON_RUNNER]].forEach(([id, icon]) => {
    const fill = document.getElementById(id);
    if (!fill) return;
    const wrap = fill.closest('.bar-wrap');
    if (!wrap || wrap.querySelector('.bar-icon')) return;
    const span = document.createElement('span');
    span.className = 'bar-icon';
    span.innerHTML = icon;
    wrap.prepend(span);
  });

  // ---- live values -------------------------------------------------
  const portM = document.getElementById('lv2-port-m');
  const girlRow = document.getElementById('lv2-girl-dist');
  const girlM = document.getElementById('lv2-girl-m');
  const coinsEl = document.getElementById('lv2-coins');
  const slots = {
    radar: document.getElementById('lv2-slot-radar'),
    adrenaline: document.getElementById('lv2-slot-adrenaline'),
  };

  function fmt(d) {
    return d < 1000 ? `${d | 0} m` : `${(d / 1000).toFixed(1)} km`;
  }

  function setSlot(which, n) {
    const el = slots[which];
    if (!el) return;
    el.querySelector('b').textContent = `x${n}`;
    el.classList.toggle('owned', n > 0);
  }

  function refresh() {
    coinsEl.textContent = state.coins;
    // Item counts — fields land with purchase logic; read defensively.
    setSlot('radar', state.hasRadarUpgrade ? 1 : 0);
    // While the boost runs, updateAdrenaline owns this slot's label
    // (countdown) — polling here too would fight it every 400 ms.
    if (!state.adrenalineActive) setSlot('adrenaline', state.adrenalineCharges || 0);
    // Port distance — live from the player rig.
    if (playerVis) {
      const p = playerVis.group.position;
      portM.textContent = fmt(Math.hypot(p.x - portTarget.x, p.z - portTarget.z));
    }
  }
  refresh();
  setInterval(refresh, 400);

  return {
    /** Reveal + update the girl distance row. Call with null to hide
        again. Only after the radar upgrade is purchased. */
    setGirlDistance(m) {
      girlRow.classList.toggle('hidden', m == null);
      if (m != null) girlM.textContent = fmt(m);
    },
    /** Owned-count setter for the inventory slots (logic phase). */
    setItemCount: setSlot,
    /** Raw label text for an inventory slot — used for the adrenaline
        countdown while the boost is running. */
    setSlotText(which, text) {
      const el = slots[which];
      if (el) el.querySelector('b').textContent = text;
    },
  };
}
