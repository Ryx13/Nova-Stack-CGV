// Level2.js — LEVEL 2 "THE CHASE"
//
// The player pursues a girl carrying a critical substance through an
// abandoned town toward a distant port. She moves at the player's walk
// speed, so the edge is route choice and power-ups — catch her (occupy
// her position + E) before she reaches her boat at the pier and gets away.
//
// Design brief, zone map, and the implementation catalog live in
// level2.md. This file is everything the level owns, in order: level
// config + startLevel(), scene dressing builders (port set piece,
// street blockage, collapse zone, vending machines, coins), the girl
// NPC + route, purchases, adrenaline, the mission system (win/lose,
// getaway cinematic, zombie escalation), and the reference HUD.

import './Level2Config.js';  // MUST be first — sets skip flags before heavy modules
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene, camera, addStaticBox, pushKillFeed, dom, sfx, KILL_TARGET, STREET_HALF_W, addLight, sunlightOnly } from './Scene.js';
import { state } from './state.js';
import { makeWreck, makeBarrier, concreteTex, rustTex, dirtTex, playerVis, playerBody, spawnZombie, loadDeferredAssets, updateBlinkingLamps, updateFireLights, syncHandGun, spawnChargers } from './characters.js';
import { spawnCoin } from './PowerUps.js';
import { bootLevel, registerLevelTick, registerLevelReset, levelKeyHooks } from './Actions.js';
import { VendingMachine, makeIcon } from './VendingMachine.js';
import { finishRun } from './account.js';
import { createNarrative } from './Narrative.js';
import { setGirlOutcome } from './StoryProgress.js';
import { registerDayProgress } from './DayCycle.js';
import { updateCityKit } from './CityKit.js';
import { updateTown } from './CityTown.js';
import { instantiateCharacter, loadGLB, fitClip, clipsFor, boneByName } from './roster.js';
import { holdForIntro, playIntro, updateIntro } from './Level2Intro.js';
import { markStaticSince, mergeStaticScenery } from './mergeStatic.js';
import { buildStreetDressing } from './streetDressing.js';
import { buildSurroundings } from './Level2Surroundings.js';

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
  // logic phase — machines (purchase wiring) + escapePoint (lose).
  const sceneryStart = scene.children.length;
  const sceneHandles = buildLevel2Scene();
  markStaticSince(scene, sceneryStart);
  // Base world + this level's dressing are all fixed scenery now: merge it
  // (~1,500 meshes into a few hundred chunked ones — see mergeStatic.js)
  const mergeStats = mergeStaticScenery(scene);
  console.log(`[mergeStatic] ${mergeStats.meshesBefore} meshes -> ${mergeStats.meshesAfter}`);
  // Trees, rubble, litter, stains, cables — instanced, so added after the merge
  buildStreetDressing();
  // Scrubland, mountains and the open sea around it all (custom haze shader)
  registerLevelTick(buildSurroundings());
  // The dead grid's faulty streetlights (state.liveStreetlights)
  registerLevelTick(updateBlinkingLamps);
  // The burning wrecks' flickering firelight (state.bigFires)
  registerLevelTick(updateFireLights);
  // The harbour town: mirror glass and sliding doors, the lighthouse beam
  registerLevelTick((dt) => { updateCityKit(dt, playerVis?.group?.position); updateTown(dt); });
  lv2Scene = sceneHandles;
  // Reference-style HUD (objectives, distances, inventory panel).
  lv2HUD = buildLevel2HUD(sceneHandles.escapePoint);
  // The chase itself: the girl NPC and her per-frame tick.
  spawnGirl();
  // The fly-through briefing: gameplay holds from here until it ends
  holdForIntro();
  registerLevelTick(tickIntro);
  registerLevelTick(updateGirl);
  // Purchases: machine interaction tick + the E key.
  lv2Machines = [
    { kind: 'radar', machine: sceneHandles.machines.radar, price: RADAR_PRICE },
    { kind: 'adrenaline', machine: sceneHandles.machines.adrenaline, price: ADRENALINE_PRICE },
  ];
  lv2EscapePoint = sceneHandles.escapePoint;
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
  registerLevelReset(resetLevel2);
  // Campaign clock (DayCycle.js): how far along her route to the boat she is.
  // Holds its last value once she's gone, so the clock never rewinds.
  let chase = 0, startDistance = 0;
  registerDayProgress(() => {
    if (state.girlCaught || state.portReached) return 1;
    if (state.girlPos && lv2EscapePoint) {
      const d = state.girlPos.distanceTo(lv2EscapePoint);
      startDistance ||= d; // her head-start spot, straight-line to the boat
      chase = 1 - d / startDistance;
    }
    return chase;
  });
}

// Handles for the logic phase: { machines, escapePoint } from the
// scene build, plus lv2HUD (live HUD setters — setGirlDistance etc.).
export let lv2HUD = null;
export let lv2Scene = null;
// Purchase-system runtime refs, filled in startLevel().
let lv2Machines = null;   // [{ kind, machine, price }]
let lv2EscapePoint = null;
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

/** Vending machine + its collider, in the machine's own glow color: at
    night the cabinet's front light is thrown in that colour onto the
    pavement in front of it. Nothing is lit above or behind the cabinet —
    it's opaque, so its light only falls in front. `catalog` is
    the machine's supplies preset — Level 2 passes its own one-product
    presets (radar / adrenaline) below. */
function placeVendingMachine(x, z, ry, catalog, glow = RADAR_GLOW) {
  const machine = new VendingMachine({
    scene,
    position: new THREE.Vector3(x, 0, z),
    rotationY: ry,
    catalog,
    glowColor: glow,
    // The adrenaline cabinet glows pink inside too; radar keeps the stock green
    ...(glow === ADRENALINE_GLOW ? { innerGlow: ADRENALINE_GLOW } : {}),
    soldOutShelves: true, // one-product machines: the other shelves read looted
    frontLight: !sunlightOnly(),
  });
  addStaticBox(
    VendingMachine.WIDTH / 2, VendingMachine.HEIGHT / 2, VendingMachine.DEPTH / 2,
    x, VendingMachine.HEIGHT / 2, z, ry
  );
  // No ground marker: the light the cabinet throws on the pavement (at
  // night) and the buy prompt in range are what mark the spot
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
    silhouettes, and the pier with her getaway boat moored at its end.
    Returns the escapePoint and boat handles. */
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

  // The water itself is the open sea in Level2Surroundings.js

  // Bollards along the quay edge.
  const bollardMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.5 });
  for (let bx = -36; bx <= 36; bx += 8) {
    const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.7, 10), bollardMat);
    bollard.position.set(bx, 0.53, -207.2);
    bollard.castShadow = true;
    scene.add(bollard);
    addStaticBox(0.2, 0.35, 0.2, bx, 0.35, -207.2);
  }

  // The working port: ships, containers, warehouses, cranes. The harbour
  // town (state.cityKit) keeps only her boat at the pier.
  if (!state.cityKit) {
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
  }

  // The pier — walkway over the water to her boat. The south bound wall
  // stops the player around z ≈ -208; the pier visual extends past it so
  // the boat sits just out of reach. The girl (no physics body) walks it
  // in the logic phase — reaching the boat means she's gone.
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
  scene.add(g);

  return { escapePoint: new THREE.Vector3(0, 0, -208.6), boat: buildBoat() };
}

/** THE GETAWAY BOAT — a motorboat moored alongside the end of the pier,
    bow out to sea, bobbing. assets/boat.glb (art/models/boat.glb run
    through tools/optimize_model.py); the model's long axis is x with the
    outboard at +x, so it's turned to put the bow at -z. Loads on its own;
    the handle's group exists at once so the cinematic can always move it.
    Returns { group, wake, seat } — seat is where she stands, boat-local. */
const BOAT_LENGTH = 6.5;
const BOAT_DRAFT = 0.55;           // hull bottom below the waterline
const BOAT_MOOR = new THREE.Vector3(3.9, 0.05, -209.6);
function buildBoat() {
  const group = new THREE.Group();
  group.position.copy(BOAT_MOOR);
  scene.add(group);
  new GLTFLoader().load('assets/boat.glb', (gltf) => {
    const obj = gltf.scene;
    obj.rotation.y = -Math.PI / 2;
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    let box = new THREE.Box3().setFromObject(obj);
    obj.scale.setScalar(BOAT_LENGTH / box.getSize(new THREE.Vector3()).z);
    box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.set(-c.x, -BOAT_DRAFT - box.min.y, -c.z);
    group.add(obj);
  }, undefined, (err) => console.error('Boat model failed to load:', err));
  // Wake: a white V trailing the stern, faded in with speed by the cinematic
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(64, 0); ctx.lineTo(64 + side * 58, 256); ctx.stroke();
  }
  const foam = ctx.createRadialGradient(64, 0, 0, 64, 0, 70);
  foam.addColorStop(0, 'rgba(255,255,255,0.85)');
  foam.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = foam; ctx.fillRect(0, 0, 128, 90);
  const wakeTex = new THREE.CanvasTexture(c);
  const wake = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 16),
    new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, opacity: 0, depthWrite: false })
  );
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(0, 0.03, BOAT_LENGTH / 2 + 8); // starts at the stern, trails astern (+z)
  group.add(wake);
  return { group, wake, seat: new THREE.Vector3(0, -0.15, 0.9), departing: false };
}

// Moored: a gentle bob and roll
function updateBoatBob(boat, t) {
  if (boat.departing) return;
  boat.group.position.y = BOAT_MOOR.y + Math.sin(t * 1.3) * 0.05;
  boat.group.rotation.z = Math.sin(t * 0.9) * 0.025;
  boat.group.rotation.x = Math.sin(t * 1.1 + 1) * 0.012;
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
  // In the harbour town (state.cityKit) nothing has fallen yet: the lot is
  // Harbour Square (CityTown.js), and only its crashed cars stay
  if (!state.cityKit) buildCollapseRubble();
  // Wrecks in the lot + edging onto the street to constrict the road.
  makeWreck(20, -128, 0.9);
  makeWreck(34, -150, -0.6);
  makeWreck(24, -158, 0.3);
  makeWreck(38, -132, 1.4, true); // burning — the nest's beacon
  makeWreck(6, -126, 1.15);
  makeWreck(-6.5, -138, -1.0);
  makeWreck(5.5, -152, 0.9);
  if (!state.cityKit) scatterDebris(28, -142, 10, 30);
  // (its coin cluster is placed with the rest, in placeCoinClusters)
}
function buildCollapseRubble() {
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
  if (!state.cityKit) { // the harbour town has no containers
    makeContainer(-4.2, -168, 0.35, 0, true);
    makeContainer(3.5, -190, -0.25, 0, true);
  }
  scatterDebris(0, -175, 8, 14);
}

/* =====================================================================
   SCENE ENTRY POINT
===================================================================== */

/** Builds the full Level 2 dressing layer. Called once from startLevel(),
    after bootLevel(). Returns handles for the logic phase: the two
    machines (purchase wiring) and the escape point (lose condition
    anchor). */
function buildLevel2Scene() {
  const port = buildPort();
  buildStreetBlockage();
  buildCollapseZone();
  buildZoneDressing();
  // Same spot characters.js' light-boot branch left empty when it
  // dropped the posed-zombie GLB prop (west curb, z -95).
  makeFallenZombie(-(STREET_HALF_W + 3.2), -95, Math.PI / 2 - 0.2);

  const machines = {
    // West sidewalk, fronts facing the street (rotationY = +π/2).
    // Radar machine sits 20 m ahead of the player start (z +10) so its
    // lime beacon is visible from spawn. Adrenaline is off the main road,
    // at the back of the west side lot (z -55), facing out toward the
    // street so its pink glow shows down the opening.
    radar: placeVendingMachine(-13.4, 10, Math.PI / 2, radarCatalog, RADAR_GLOW),
    adrenaline: placeVendingMachine(-39.5, -53, Math.PI / 2, adrenalineCatalog, ADRENALINE_GLOW),
  };

  placeCoinClusters();

  return { machines, escapePoint: port.escapePoint, boat: port.boat };
}

// Persistent coin clusters along the route — the machine economy's
// second income stream besides zombie drops. Placed again on a restart.
function placeCoinClusters() {
  placeCoinCluster(2, 8, 3);       // Outskirts
  placeCoinCluster(-3, -5, 3);     // Outskirts
  placeCoinCluster(-28, -53, 3);   // west pocket detour reward
  placeCoinCluster(7.5, -62, 3);   // past the blockage squeeze
  placeCoinCluster(4, -80, 3);     // Centre
  placeCoinCluster(-5, -105, 3);   // Centre
  placeCoinCluster(27, -143, 9);   // collapse-zone nest
  placeCoinCluster(0, -172, 4);    // Final Approach
  placeCoinCluster(-2, -188, 4);   // Final Approach
  placeCoinCluster(5, -195, 3);    // Port edge
  placeCoinCluster(-5, -200, 3);   // Port edge
}



// She's the roster's zombie-schoolgirl body (assets/characters/
// detention.glb) driven by Injured Run.glb's single Mixamo run clip — a
// fleeing figure, thematically right for the chase. Both share the Mixamo
// skeleton, so the clip binds by bone name (see roster.js).
const GIRL_CHARACTER = 'detention';
const GIRL_RUN_GLB = 'assets/Injured Run.glb';
const GIRL_SPEED = 3.7;          // = player walk speed — the locked design
const GIRL_TARGET_HEIGHT = 1.65;
const GIRL_RIG_YAW_OFFSET = 0;   // flip to Math.PI if she runs backwards
// Within this range of the player the "Girl spotted" beat fires
const GIRL_SIGHT_RANGE = 25;

// Her route: 10 m head start at spawn (z +20, directly in front of the
// player start at (1.5, z 30) — dead-center in view when the loading
// screen clears, so the player watches her bolt, which is the point) →
// straight down the street past the first barrier chicane → through the
// blockage's east-curb gap (z -57) → weaving the collapse-zone street
// wrecks → threading the final-approach gauntlet → across the quay →
// down the pier to her boat. y values step onto the quay
// (0.18) and pier (0.47) slabs. Waypoints keep ~5 m clearance from every
// placed wreck/container so she never visibly clips through one (the
// spawn leg runs the street mid-lane at x 1.5; barrier 0 sits 3.9 m off
// it at x -2.4).
const GIRL_WAYPOINTS = [
  { x: 1.5, y: 0,    z: 20 },   // spawn — 10 m ahead of the player, dead-center in view
  { x: 1.5, y: 0,    z: -33 },
  { x: 4,   y: 0,    z: -52 },
  { x: 7.5, y: 0,    z: -57 },   // blockage east-curb gap
  { x: 6,   y: 0,    z: -64 },
  { x: 2,   y: 0,    z: -80 },
  { x: -2,  y: 0,    z: -95 },
  { x: 0,   y: 0,    z: -110 },
  { x: -3,  y: 0,    z: -125 },  // collapse-zone street weave
  { x: 1,   y: 0,    z: -140 },
  { x: -2,  y: 0,    z: -158 },
  { x: -3,  y: 0,    z: -170 },  // final-approach gauntlet
  { x: 2,   y: 0,    z: -180 },
  { x: 0,   y: 0,    z: -194 },
  { x: 0,   y: 0.18, z: -197 },  // onto the quay
  { x: 0,   y: 0.47, z: -203 },  // onto the pier
  { x: 1.6, y: 0.47, z: -209.6 },// the pier edge beside her boat — she's gone (lose)
];

let girl = null; // { group, mixer, wpIndex, mats, glint }
let girlSpotted = false;
let girlAnnounced = false; // "head start" beat — fired on the first live frame

function spawnGirl() {
  Promise.all([instantiateCharacter(GIRL_CHARACTER), loadGLB(GIRL_RUN_GLB)]).then(async ([obj, run]) => {
    const mixer = new THREE.AnimationMixer(obj);
    const runAction = run.animations.length ? mixer.clipAction(fitClip(run.animations[0], run.scene, obj)) : null;
    if (runAction) runAction.play();
    // Ground-snap + scale to target height — the loadDecorCar pattern.
    // A fresh clone has never had its world matrices computed; measuring
    // before this reads the Armature's cm->m 0.01 scale as identity.
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    obj.scale.setScalar(GIRL_TARGET_HEIGHT / Math.max(size.y, 0.2));
    const box2 = new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3(); box2.getCenter(center);
    obj.position.set(-center.x, -box2.min.y, -center.z);
    // No tint, glow or light of her own: lit like everything else, she
    // has to be spotted, not followed (the radar machine sells tracking).
    // Own material copies so the lose cinematic can fade her alone.
    obj.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
    const group = new THREE.Group();
    group.add(obj);
    const wp = GIRL_WAYPOINTS[0];
    group.position.set(wp.x, wp.y, wp.z);
    // Facing her route from the start, so the intro's close-up sees her face
    const next = GIRL_WAYPOINTS[1];
    group.rotation.y = Math.atan2(next.x - wp.x, next.z - wp.z) + GIRL_RIG_YAW_OFFSET;
    scene.add(group);
    // Standing idle through the intro; updateGirl crossfades to the run
    const idleClip = (await clipsFor(obj)).idle;
    const idle = idleClip ? mixer.clipAction(idleClip) : null;
    if (idle) { idle.play(); runAction.stop(); }
    attachAntidote(obj);
    girl = { group, mixer, wpIndex: 1, idle, run: runAction };
    state.girlPos = group.position; // live reference — see section header
    // "Head start" announcement moved to updateGirl's first LIVE frame —
    // pushed here it would fire behind the loading overlay and fade
    // before anyone can read it.
  }).catch((err) => {
    console.error('Chase girl failed to load:', err);
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

/* ANTIDOTE — the vial she runs with, in her right hand: green liquid in
   clear glass under a steel cap. Deliberately unlit (no emissive, no
   light) — it's what she carries, not a beacon. Built ~1.3x life size
   so it still reads in her hand at chase distance. */
const ANTIDOTE_GRIP = { pos: [0, 0.065, -0.024], rot: [0, 0, -Math.PI / 2] }; // in the hand bone's frame, metres: upright in the palm
function makeAntidoteVial() {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.021, 0.021, 0.095, 16),
    new THREE.MeshStandardMaterial({ color: 0xdfeee8, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false })
  );
  const liquid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0175, 0.0175, 0.068, 16),
    new THREE.MeshStandardMaterial({ color: 0x4fd65a, roughness: 0.25, metalness: 0 })
  );
  liquid.position.y = -0.011;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.023, 0.023, 0.024, 16),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.85 })
  );
  cap.position.y = 0.0595;
  liquid.renderOrder = 0; glass.renderOrder = 1; // liquid first, glass over it
  g.add(liquid, glass, cap);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function attachAntidote(charRoot) {
  const hand = boneByName(charRoot, 'RightHand');
  if (!hand) return;
  const vial = makeAntidoteVial();
  // The rig's bones carry its cm->m and fit-to-height scaling; undo it so
  // the vial's own sizes stay metres
  charRoot.updateMatrixWorld(true);
  const s = hand.getWorldScale(new THREE.Vector3()).x;
  vial.scale.setScalar(1 / s);
  vial.position.set(...ANTIDOTE_GRIP.pos).multiplyScalar(1 / s);
  vial.rotation.set(...ANTIDOTE_GRIP.rot);
  hand.add(vial);
}

/* INTRO — once the loading screen clears, the Level2Intro fly-through
   briefs the player (girl, port, machines) before the chase starts. It
   waits up to INTRO_GIRL_WAIT s for her model, so the close-up isn't of
   an empty street. */
const INTRO_GIRL_WAIT = 4;
let introWait = 0;
let introStarted = false;
/* START AMBUSH — at GO, five zombies burst out between the player and
   the girl and charge: two right in front, three a little further on,
   faster than a sprint, so the chase starts by fighting through them. */
const AMBUSH_SPEED = [9.5, 11];   // m/s; the player sprints at 8.4
function spawnStartAmbush() {
  const p = playerBody.position;  // the spawn, facing -z toward her
  spawnChargers([
    [p.x - 3, p.z - 6.5], [p.x + 3, p.z - 5.5],                    // very close
    [p.x - 6.5, p.z - 14], [p.x, p.z - 16.5], [p.x + 5.5, p.z - 15], // close
  ], AMBUSH_SPEED);
}

function tickIntro(dt) {
  if (!state.readyShown || !state.cinematic) return;
  // Gameplay (which syncs the player model to its body) is frozen: stand
  // the model on its spawn and keep its idle breathing meanwhile
  playerVis.group.position.set(playerBody.position.x, 0, playerBody.position.z);
  if (playerVis.mixer) playerVis.mixer.update(dt);
  syncHandGun(); // and the gun in their hand, which gameplay normally keeps there
  if (!introStarted) {
    introWait += dt;
    if (!girl && introWait < INTRO_GIRL_WAIT) return;
    introStarted = true;
    const wp = GIRL_WAYPOINTS[0], next = GIRL_WAYPOINTS[1];
    playIntro({
      girlPos: new THREE.Vector3(wp.x, wp.y, wp.z),
      girlFacing: new THREE.Vector3(next.x - wp.x, 0, next.z - wp.z).normalize(),
      portPos: lv2EscapePoint,
      playerPos: playerVis.group.position.clone(),
      machines: lv2Scene.machines,
      prices: { radar: RADAR_PRICE, adrenaline: ADRENALINE_PRICE },
      onDone: spawnStartAmbush,
    });
    return;
  }
  updateIntro(dt);
}

let boatTime = 0;
function updateGirl(dt) {
  boatTime += dt;
  if (lv2Scene && lv2Scene.boat) updateBoatBob(lv2Scene.boat, boatTime);
  // Loading-screen gate: state.readyShown flips exactly when the HUD is
  // revealed (maybeReady), so nothing about the chase — her movement,
  // the announce beat, the escalation clock — runs behind the overlay.
  // Without this she burns her head start while the progress bar is up.
  if (!state.readyShown) return;
  if (!girl || state.paused || state.girlCaught) return;
  if (state.cinematic) { if (girl.mixer) girl.mixer.update(dt); return; } // idling through the intro
  if (!girlAnnounced) {
    girlAnnounced = true;
    // Off the intro's idle and away
    if (girl.idle && girl.run) { girl.run.reset().play(); girl.idle.crossFadeTo(girl.run, 0.3, false); }
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
  // First-sight killfeed beat
  if (playerVis && !girlSpotted && playerVis.group.position.distanceTo(g.position) < GIRL_SIGHT_RANGE) {
    girlSpotted = true;
    pushKillFeed('Girl spotted — heading for the port!');
  }
}



const RADAR_PRICE = 25;
const ADRENALINE_PRICE = 80;
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

// One card per shot in stock; each sale takes one off the shelf
const adrenalineCard = {
  id: 'adrenaline', itemId: 'adrenaline', name: 'ADRENALINE SHOT',
  category: 'support', price: ADRENALINE_PRICE, stock: 1,
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
};
const adrenalineCatalog = { support: Array.from({ length: ADRENALINE_START_STOCK }, () => adrenalineCard) };

/** Purchase prompt text for a machine in range. */
function machinePromptText(def) {
  if (def.kind === 'radar') {
    return state.hasRadarUpgrade ? 'Radar already installed' : `Buy RADAR (${def.price} coins)`;
  }
  if (adrenalineStock <= 0) return 'ADRENALINE — sold out';
  if (shotPicker) {
    const opts = [];
    for (let n = 1; n <= shotPicker.max; n++) opts.push(`${n} = ${n * def.price}`);
    return `How many shots? Press ${opts.join(' · ')} coins — E to cancel`;
  }
  return `Buy ADRENALINE (${def.price} coins each)`;
}

/* Adrenaline quantity picker. E at the machine opens it; a number key
   buys that many shots, E again (or walking away) closes it. While it is
   open the number keys belong to it. */
let shotPicker = null; // { def, max } while open

function openShotPicker(def) {
  if (adrenalineStock <= 0) { pushKillFeed('Adrenaline sold out'); return; }
  if (state.coins < def.price) { pushKillFeed(`Not enough coins — need ${def.price}`); return; }
  const max = Math.min(adrenalineStock, 9);
  if (max === 1) { buyShots(def, 1); return; }
  shotPicker = { def, max };
}

function closeShotPicker() { shotPicker = null; }

function onShotPickerKey(e) {
  if (!shotPicker) return;
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  if (!m) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const n = Number(m[1]);
  if (n > shotPicker.max) return;
  const def = shotPicker.def;
  closeShotPicker();
  buyShots(def, n);
}
window.addEventListener('keydown', onShotPickerKey, true);

function buyShots(def, n) {
  if (adrenalineStock < n) { pushKillFeed(`Only ${adrenalineStock} left in stock`); return; }
  const cost = def.price * n;
  if (state.coins < cost) { pushKillFeed(`Not enough coins — ${n} shots cost ${cost}`); return; }
  state.coins -= cost;
  adrenalineStock -= n;
  state.adrenalineCharges += n;
  for (let i = 0; i < n; i++) def.machine.takeCard('support');
  sfx.pickup();
  pushKillFeed(`${n} adrenaline shot${n > 1 ? 's' : ''} bought — press G to use (${adrenalineStock} left in stock)`);
  if (lv2HUD) lv2HUD.setItemCount('adrenaline', state.adrenalineCharges);
}

/** Validate + apply a purchase. All feedback through the killfeed —
    no shopping UI, matching the display-only machine design. */
function buyFromMachine(def) {
  if (def.kind === 'radar') {
    if (state.hasRadarUpgrade) { pushKillFeed('Radar already installed'); return; }
    if (state.coins < def.price) { pushKillFeed(`Not enough coins — need ${def.price}`); return; }
    state.coins -= def.price;
    state.hasRadarUpgrade = true;
    def.machine.takeCard('support');
    sfx.pickup();
    pushKillFeed('RADAR installed — girl tracked on radar & compass');
    if (lv2HUD) lv2HUD.setItemCount('radar', 1);
  } else if (shotPicker) {
    closeShotPicker(); // E again cancels
  } else {
    openShotPicker(def);
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
  if (!lv2Machines || state.isDead || state.paused || state.girlCaught || state.cinematic) { closeShotPicker(); return; }
  // Compass retarget: PORT is the visible goal from the start; GIRL only
  // after the radar purchase. girlPos is a live Vector3 reference, so the
  // override stays current as she moves without resetting it per frame.
  state.compassOverride = state.hasRadarUpgrade && state.girlPos
    ? { pos: state.girlPos, label: 'GIRL' }
    : { pos: lv2EscapePoint, label: 'PORT' };
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
  if (shotPicker && best !== shotPicker.def) closeShotPicker();
  if (best) {
    dom.prompt.classList.remove('hidden');
    dom.prompt.querySelector('b').textContent = 'E';
    dom.promptText.textContent = machinePromptText(best);
  } else {
    dom.prompt.classList.add('hidden');
  }
}


const ADRENALINE_DURATION = 3; // seconds — a short burst you have to time

/** G key — activate a stored charge. */
function handleKeyG() {
  if (state.isDead || state.paused || state.girlCaught) return;
  if (state.adrenalineActive) { pushKillFeed('Adrenaline already running'); return; }
  if (state.adrenalineCharges <= 0) {
    pushKillFeed('No adrenaline — the machine down the west side street sells it');
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
// Active lose cinematic: { phase: 'board'|'depart', t, camGoal, lookAt,
// from, speed }. Null outside the ~4.5 s sequence.
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
    <h1 class="end-title">STABILIZER RECOVERED</h1>
    <div class="end-sub" id="lv2-win-stats"></div>
    <button onclick="location.reload()">Play Again</button>`;
  document.body.appendChild(winEl);
  lv2Win = winEl;
  lv2WinStats = winEl.querySelector('#lv2-win-stats');

  const loseEl = document.createElement('div');
  loseEl.id = 'lv2-losescreen';
  loseEl.className = 'end-screen hidden';
  loseEl.innerHTML = `
    <h1 class="end-title">SHE GOT AWAY</h1>
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
    She stops and turns to face you, pleads to keep the stabilizer, and
    Dr. James has you bring her back to the safe room; then the screen. */
let catchStory = null;
async function catchGirl() {
  state.girlCaught = true;
  state.isDead = true;             // freezes the gameplay gate
  state.adrenalineActive = false; // stop the countdown label writer
  sfx.setEngine(0, false);
  sfx.pickup();
  document.exitPointerLock();
  dom.prompt.classList.add('hidden');
  setGirlOutcome('caught');
  const seconds = chaseSeconds();
  if (girl) {
    const g = girl.group, p = playerVis.group.position;
    g.rotation.y = Math.atan2(p.x - g.position.x, p.z - g.position.z) + GIRL_RIG_YAW_OFFSET;
    if (girl.idle && girl.run) { girl.run.stop(); girl.idle.reset().play(); girl.mixer?.update(0.01); }
  }
  catchStory = createNarrative({ onBlock: (value) => { state.narrativeBlocked = value; state.keys = {}; } });
  await catchStory.show({ id: 'girl-plea', mode: 'cinematic', speaker: 'THE GIRL', title: "Please don't take it.",
    text: "It's the only thing keeping me me. Every time a dose wears off, I can feel it coming back. If you take it, I turn.",
    continueLabel: 'Call Dr. James' });
  await catchStory?.show({ id: 'girl-james', mode: 'cinematic', speaker: 'DR. JAMES / SECURE CHANNEL', title: 'Bring her with you.',
    text: 'She held on this long because of it. Once the tower broadcasts the cure, nobody needs a dose. Her boat is the only way across the bay to the tower. Take it, and take her with you. One more dose will hold her until then.',
    continueLabel: 'Take her boat' });
  if (!catchStory) return; // the level restarted mid-scene
  catchStory.dispose(); catchStory = null;
  if (girl) scene.remove(girl.group); // she goes back with you
  lv2WinStats.textContent =
    `Infected eliminated: ${state.kills} · Coins: ${state.coins} · Stabilizer recovered in ${seconds} s`;
  lv2Win.classList.remove('hidden');
  finishRun('win', lv2Win);
}

/** LOSE trigger — she made her boat. Hands the next ~4.5 s to the
    cinematic: the camera swings to a quay vantage, she vaults the rail
    into the boat, and it opens up and runs for the open sea; then the
    lose screen. */
function startLoseCinematic() {
  state.isDead = true;             // freeze gameplay incl. the stock camera
  state.adrenalineActive = false;
  sfx.setEngine(0, false);
  document.exitPointerLock();
  dom.prompt.classList.add('hidden');
  pushKillFeed('She reached her boat —');
  const boat = lv2Scene.boat;
  boat.departing = true;
  loseCinematic = {
    phase: 'board',
    t: 0,
    // Over the yard's clear mid-lane (|x| < 4), above the container stacks
    camGoal: new THREE.Vector3(2.5, 5.5, -199),
    lookAt: boat.group.position.clone().setY(1),
    from: state.girlPos.clone(),
    speed: 0,
  };
  // Off the run and into a stance for the ride
  if (girl && girl.idle && girl.run) { girl.idle.reset().play(); girl.run.crossFadeTo(girl.idle, 0.3, false); }
}

/** The cinematic itself — this tick owns the camera while the gameplay
    gate is frozen. board (~0.7 s): she vaults from the pier into the
    boat. depart (~3.6 s): the boat opens up out to sea, bow lifting,
    wake building, the camera tracking it from the quay; then the screen. */
function updateLoseCinematic(dt) {
  const c = loseCinematic;
  const boat = lv2Scene.boat;
  c.t += dt;
  camera.position.lerp(c.camGoal, Math.min(1, dt * 1.8));
  c.lookAt.lerp(boat.group.position.clone().setY(1), Math.min(1, dt * 3));
  camera.lookAt(c.lookAt);

  if (c.phase === 'board') {
    const k = Math.min(1, c.t / 0.7);
    if (girl) {
      const to = boat.group.localToWorld(boat.seat.clone());
      const g = girl.group;
      g.position.lerpVectors(c.from, to, k);
      g.position.y += Math.sin(Math.PI * k) * 1.2; // up over the rail
      g.rotation.y = Math.atan2(to.x - c.from.x, to.z - c.from.z) + GIRL_RIG_YAW_OFFSET;
      if (k >= 1) {
        boat.group.attach(g);
        g.position.copy(boat.seat);
        g.rotation.set(0, Math.PI + GIRL_RIG_YAW_OFFSET, 0); // facing the bow
      }
    }
    if (k >= 1) { c.phase = 'depart'; c.t = 0; sfx.burst('sawtooth', 90, 1.4, 0.18); pushKillFeed('— and she\'s away.'); }
    return;
  }

  // Depart: throttle up to ~17 m/s, bow lifting as it gets on the plane,
  // curving west to run out between the moored ships (one lies dead
  // ahead, another east of it; heading is radians off -z, + = east)
  const k = Math.min(1, c.t / 2.2);
  c.speed = 17 * k * k;
  const heading = -Math.min(0.5, Math.max(0, c.t - 0.3) * 0.4);
  boat.group.position.x += Math.sin(heading) * c.speed * dt;
  boat.group.position.z -= Math.cos(heading) * c.speed * dt;
  boat.group.rotation.y = -heading;
  boat.group.rotation.x = 0.07 * Math.sin(Math.min(1, c.t / 1.4) * Math.PI * 0.5) - 0.03 * Math.max(0, c.t - 1.6);
  boat.group.rotation.z = Math.sin(c.t * 2.1) * 0.02;
  boat.group.position.y = BOAT_MOOR.y + Math.sin(c.t * 5) * 0.04;
  boat.wake.material.opacity = Math.min(0.85, c.speed / 10);
  boat.wake.scale.y = 0.6 + Math.min(1.4, c.speed / 12);
  boat.wake.position.z = BOAT_LENGTH / 2 + 8 * boat.wake.scale.y;
  if (girl && girl.mixer) girl.mixer.update(dt);
  if (c.t >= 3.6) {
    state.girlPos = null;
    loseCinematic = null;
    setGirlOutcome('escaped');
    lv2LoseStats.textContent =
      `Your stabilizer is heading out to sea, and without it there is no cure. · Infected eliminated: ${state.kills} · Coins: ${state.coins} · She reached the port in ${chaseSeconds()} s`;
    lv2Lose.classList.remove('hidden');
    finishRun('loss', lv2Lose);
  }
}

/** Per-frame mission tick — see the section header for the priority
    order. */
function updateMission(dt) {
  // Same loading gate as updateGirl — and the chase clock arms HERE,
  // on the first live frame, so loading-screen seconds never count
  // toward the win-screen time stat.
  if (!state.readyShown || state.cinematic) return;
  if (!missionStartTime) missionStartTime = performance.now();
  if (state.paused || state.dying) return; // overrun: the death scene has the floor
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
    dom.promptText.textContent = distToGirl <= CATCH_RANGE ? 'Stop her' : 'Get closer…';
  }

  // One-shot progress beats — the chase's tension clock.
  if (!beatClosingIn && distToGirl < 12) {
    beatClosingIn = true;
    pushKillFeed('Closing in — keep the pressure on');
  }
  const girlDist = state.girlPos.distanceTo(lv2EscapePoint);
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

/** RESTART (Actions.js restartLevel, after the shared reset) — the girl
    back on her mark with her head start, the boat moored, the machines
    restocked, the route's coins back, and the chase clock re-armed. The
    briefing doesn't replay, so the start ambush that follows it is
    sprung straight away. */
function resetLevel2() {
  if (catchStory) { catchStory.dispose(); catchStory = null; state.narrativeBlocked = false; }
  loseCinematic = null;
  missionStartTime = 0;
  escalationTimer = ESCALATE_START;
  beatClosingIn = beatNearingPort = beatFinalStretch = false;
  girlSpotted = girlAnnounced = false;
  closeShotPicker();
  adrenalineStock = ADRENALINE_START_STOCK;

  const boat = lv2Scene.boat;
  boat.departing = false;
  boat.group.position.copy(BOAT_MOOR);
  boat.group.rotation.set(0, 0, 0);
  boat.wake.material.opacity = 0;
  boat.wake.scale.y = 1;
  boat.wake.position.z = BOAT_LENGTH / 2 + 8;

  if (girl) {
    const g = girl.group;
    scene.attach(g); // out of the boat, or back after being grabbed
    const wp = GIRL_WAYPOINTS[0], next = GIRL_WAYPOINTS[1];
    g.position.set(wp.x, wp.y, wp.z);
    g.rotation.set(0, Math.atan2(next.x - wp.x, next.z - wp.z) + GIRL_RIG_YAW_OFFSET, 0);
    girl.wpIndex = 1;
    if (girl.idle && girl.run) { girl.run.stop(); girl.idle.reset().play(); }
    state.girlPos = g.position;
  }

  for (const def of lv2Machines) def.machine.restock();
  placeCoinClusters();
  lv2HUD.setGirlDistance(null);
  lv2HUD.setItemCount('radar', 0);
  lv2HUD.setItemCount('adrenaline', 0);
  spawnStartAmbush();
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
    /* #objective-panel is the wrapper those two now live in — it would
       otherwise show up as an empty styled box here. */
    body.lv2-hud #objective-panel { display: none; }
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
