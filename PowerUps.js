import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { state } from './state.js';
import {
  scene, world, dom, sfx, addStaticBox, pushKillFeed,
  DEPOT_POS, STREET_HALF_W, WEST_POCKET_Z, rowX,
  updateAmmoHUD, updateCoinHUD, updateShieldHUD, acquireEffectLight, releaseEffectLight,
} from './Scene.js';
import { createShieldMaterial, shieldUniforms } from './shaders.js';
import { updateFuelHUD, MAG_SIZE } from './Actions.js';
// Only used inside initShield(), never at this module's own top level —
// see the Scene.js header comment for why the deferred/top-level
// distinction matters for circular imports. characters.js imports
// spawnPickup/spawnCoin/registerKillstreak from this file the same way.
import { playerVis } from './characters.js';
import { spawnBlastFX, blastBlood } from './ImpactFX.js';
import { cameraShock } from './CameraShock.js';

/* ======================================================================
   PowerUps.js — SHIELD / EXPLOSIONS / COINS / PICKUPS / POWERUP DROPS
====================================================================== */

/* ---------------------------------------------------------------------
   EXPLOSIVE BARRELS + EXPLOSION VFX
--------------------------------------------------------------------- */
const BARREL_SCALE = 0.274; // measured height 3.209 units -> real ~0.88m oil drum —
// this asset didn't come through the same FBX pipeline as the other new
// models, so it needed its own scale calibration rather than the ~0.01
// factor that fit the others.
const EXPLOSION_SCALE = 0.6;
const EXPLOSION_RADIUS = 6.5;
const BLAST_BOSS_DAMAGE = 150; // at the centre, half at the edge: a boss is hurt, not erased
// Looks the part: the drum's own texture tinted red, a yellow-and-black
// hazard band round the middle, and a slow red warning glow (one shared
// material, so one value pulses every barrel)
const BARREL_TINT = 0xd0412c, BARREL_GLOW = 0xff2a12;
let barrelMaterials = null, barrelBand = null, barrelGlowTime = 0;
function hazardBand(template) {
  const box = new THREE.Box3().setFromObject(template), size = box.getSize(new THREE.Vector3());
  const c = document.createElement('canvas'); c.width = 256; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2c21a'; ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = '#141210';
  for (let x = -32; x < 256; x += 32) { ctx.beginPath(); ctx.moveTo(x, 32); ctx.lineTo(x + 16, 32); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 16, 0); ctx.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = 2;
  // In the drum's own (unscaled) units: it's a child of the barrel mesh
  const r = Math.max(size.x, size.z) / 2 * 1.02;
  const geo = new THREE.CylinderGeometry(r, r, size.y * 0.13, 28, 1, true).translate(0, box.min.y + size.y * 0.6, 0);
  return { geo, mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.3, emissive: BARREL_GLOW, emissiveIntensity: 0 }) };
}
function dressBarrel(mesh) {
  if (!barrelMaterials) {
    barrelMaterials = new Map();
    barrelBand = hazardBand(barrelTemplate);
  }
  mesh.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => {
      if (!barrelMaterials.has(m)) {
        const red = m.clone();
        red.color = new THREE.Color(BARREL_TINT);
        red.emissive = new THREE.Color(BARREL_GLOW);
        red.emissiveIntensity = 0;
        barrelMaterials.set(m, red);
      }
      return barrelMaterials.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  const band = new THREE.Mesh(barrelBand.geo, barrelBand.mat);
  band.castShadow = true;
  mesh.add(band);
}
/** Every frame (updateExplosions): the warning glow breathes. */
function pulseBarrels(dt) {
  if (!barrelMaterials) return;
  barrelGlowTime += dt;
  const glow = 0.08 + 0.22 * (0.5 + 0.5 * Math.sin(barrelGlowTime * 2.6));
  for (const m of barrelMaterials.values()) m.emissiveIntensity = glow;
  barrelBand.mat.emissiveIntensity = glow * 0.35;
}
let barrelTemplate = null;
let explosionTemplate = null;

// Keep a visible blast while the animated asset downloads or fails, including
// sunlight-only scenes where real effect lights are intentionally disabled.
// Four reusable slots bound simultaneous fallback geometry and allocations.
const explosionFallbacks = [];
let explosionFallbackGeometry = null;
function acquireExplosionFallback(pos) {
  let slot = explosionFallbacks.find((entry) => !entry.busy);
  if (!slot && explosionFallbacks.length < 4) {
    explosionFallbackGeometry ||= new THREE.IcosahedronGeometry(1, 1);
    const flash = new THREE.MeshBasicMaterial({ color: 0xffa32d, transparent: true, depthWrite: false });
    const core = new THREE.MeshBasicMaterial({ color: 0xffecad, transparent: true, depthWrite: false });
    const smoke = new THREE.MeshBasicMaterial({ color: 0x49413b, transparent: true, depthWrite: false });
    const obj = new THREE.Group();
    const parts = [flash, core, smoke, smoke, smoke].map((material) => new THREE.Mesh(explosionFallbackGeometry, material));
    obj.add(...parts);
    slot = { obj, parts, flash, core, smoke, busy: false };
    explosionFallbacks.push(slot);
  }
  if (!slot) return null;
  slot.busy = true;
  slot.obj.position.copy(pos).setY(pos.y + 0.7);
  updateExplosionFallback(slot, 0);
  scene.add(slot.obj);
  return slot;
}
function updateExplosionFallback(slot, elapsed) {
  const progress = Math.min(elapsed / 0.65, 1);
  const flashSize = progress < 0.12 ? 0.9 + progress * 12 : Math.max(0.001, 2.5 * (1 - progress / 0.55));
  slot.parts[0].scale.setScalar(flashSize);
  slot.parts[1].scale.setScalar(flashSize * 0.65);
  slot.flash.opacity = slot.core.opacity = Math.max(0, 1 - progress / 0.55);
  slot.smoke.opacity = 0.55 * Math.sin(progress * Math.PI);
  for (let i = 2; i < slot.parts.length; i++) {
    const angle = (i - 2) * Math.PI * 2 / 3;
    slot.parts[i].position.set(Math.cos(angle) * progress, progress * 2.6, Math.sin(angle) * progress);
    slot.parts[i].scale.setScalar(0.35 + progress * 1.2);
  }
}

// The original full-detail explosion VFX GLB is 19.27 MB for an effect most runs
// never trigger. Levels can defer it to the
// first actual explosion via state.lazyExplosionVFX (Level 2 does);
// the default is an eager load at boot. Either way this runs at most
// once, and the unlit fallback in spawnExplosionEffect covers the
// window before it resolves (and the failure case).
let explosionFetchStarted = false;
function fetchExplosionTemplate() {
  if (explosionFetchStarted) return;
  explosionFetchStarted = true;
  new GLTFLoader().load('assets/timeframe_explosion.glb', (gltf) => {
    explosionTemplate = gltf;
  }, undefined, () => { pushKillFeed('Explosion model unavailable — using backup blast effects'); });
}

export class Barrel {
  constructor(pos) {
    this.isBarrel = true;
    this.exploded = false;
    this.mesh = barrelTemplate.clone(true);
    dressBarrel(this.mesh);
    this.mesh.scale.setScalar(BARREL_SCALE);
    this.mesh.position.copy(pos);
    this.mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      o.userData.owner = this;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m) m.side = THREE.DoubleSide; });
    });
    scene.add(this.mesh);
    this.collisionBody = addStaticBox(0.36, 0.44, 0.36, pos.x, 0.44, pos.z);
    state.explosiveBarrels.push(this);
  }
  takeDamage() {
    if (this.exploded) return;
    this.explode();
  }
  explode() {
    this.exploded = true;
    const pos = this.mesh.position.clone();
    scene.remove(this.mesh);
    const idx = state.explosiveBarrels.indexOf(this);
    if (idx >= 0) state.explosiveBarrels.splice(idx, 1);
    if (this.collisionBody) { world.removeBody(this.collisionBody); }
    spawnExplosionEffect(pos);
    spawnBlastFX(pos, EXPLOSION_RADIUS);
    sfx.explosion();
    // The pressure wave on the view, by distance; the plain jitter on top,
    // scaled the same, so a blast down the street isn't felt like one beside you
    state.shake = Math.max(state.shake, 0.4 * cameraShock(pos));
    // AoE kill: goDown() first (this is what counts the kill toward the
    // objective, same as a gunshot knockdown), then confirmedKill()
    // immediately after to make it permanent. Protected and cured infected
    // are left alone, and a boss takes damage through its own rules
    // (armour, weak point, reinforcements) instead of being erased.
    state.zombies.forEach((z) => {
      if (!z.alive || z.recoveryProtected || z.state === 'cured') return;
      const d = z.mesh.position.distanceTo(pos);
      if (d >= EXPLOSION_RADIUS) return;
      if (z.isBoss || z.guardian) { z.takeDamage(BLAST_BOSS_DAMAGE * (1 - 0.5 * d / EXPLOSION_RADIUS), false); return; }
      blastBlood(z.mesh.position, pos);
      z.health = 0;
      z.goDown();
      z.confirmedKill(false);
    });
    // Chain reaction: any OTHER barrel caught in the blast radius also
    // goes off, on a tiny delay so it reads as a chain rather than one
    // instant flash. Routed through takeDamage() rather than calling
    // explode() directly so the `exploded` guard still applies.
    state.explosiveBarrels.slice().forEach((b) => {
      if (b !== this && b.mesh.position.distanceTo(pos) < EXPLOSION_RADIUS) {
        setTimeout(() => b.takeDamage(), 120);
      }
    });
  }
}

export function spawnExplosionEffect(pos) {
  const light = acquireEffectLight(0xff8a33, 7, 16);
  if (light) light.position.copy(pos).setY(pos.y + 1.2);
  if (!explosionTemplate) {
    // Damage is immediate; the cheap unlit fallback supplies a visible blast
    // while lazy loading catches up, or if the animated asset fails to load.
    if (state.lazyExplosionVFX) fetchExplosionTemplate();
    const fallback = acquireExplosionFallback(pos);
    state.activeExplosions.push({ mixer: null, obj: fallback?.obj ?? null, fallback, light, duration: 0.65, elapsed: 0 });
    return;
  }
  const obj = explosionTemplate.scene.clone(true);
  obj.scale.setScalar(EXPLOSION_SCALE);
  obj.position.copy(pos);
  scene.add(obj);
  const mixer = new THREE.AnimationMixer(obj);
  const clip = explosionTemplate.animations[0];
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce);
  action.clampWhenFinished = true;
  action.play();
  state.activeExplosions.push({ mixer, obj, light, duration: clip.duration, elapsed: 0 });
}

export function updateExplosions(dt) {
  pulseBarrels(dt);
  for (let i = state.activeExplosions.length - 1; i >= 0; i--) {
    const e = state.activeExplosions[i];
    if (e.mixer) e.mixer.update(dt);
    e.elapsed += dt;
    if (e.fallback) updateExplosionFallback(e.fallback, e.elapsed);
    if (e.light) e.light.intensity = Math.max(0, 7 * (1 - e.elapsed / Math.max(e.duration, 0.01)));
    if (e.elapsed >= e.duration + 0.3) {
      if (e.mixer) {
        e.mixer.stopAllAction();
        e.mixer.uncacheRoot(e.obj);
      }
      if (e.obj) scene.remove(e.obj);
      if (e.fallback) e.fallback.busy = false;
      releaseEffectLight(e.light);
      state.activeExplosions.splice(i, 1);
    }
  }
}

let barrelSpots = []; // kept so a restart can put blown barrels back
export function loadBarrels() {
  new GLTFLoader().load('assets/barrel.glb', (gltf) => {
    barrelTemplate = gltf.scene;
    const BARREL_SPOTS = [
      [STREET_HALF_W - 2.2, -18],
      [-(STREET_HALF_W - 2.2), -62],
      [STREET_HALF_W - 2.4, -132],
      [-(STREET_HALF_W - 2.2), -178],
      [-(rowX + 15) - 6, WEST_POCKET_Z + 5],
    ];
    // Depot-lot spots only exist when the depot does (Level 2 skips
    // the lot — its yard geometry is never built).
    if (!state.skipDepot) {
      BARREL_SPOTS.push([DEPOT_POS.x - 9, DEPOT_POS.z + 6], [DEPOT_POS.x + 7, DEPOT_POS.z - 7]);
    }
    barrelSpots = BARREL_SPOTS;
    BARREL_SPOTS.forEach(([x, z]) => new Barrel(new THREE.Vector3(x, 0, z)));
  }, undefined, () => { pushKillFeed('Barrel model failed to load'); });
  if (!state.lazyExplosionVFX) fetchExplosionTemplate();
}

/* RESTART — clears every drop, coin, blast and spark the run left lying
   around, puts every barrel back (blown or not, so none is doubled up)
   and drops the shield. Called by Actions.js restartLevel(). */
export function resetPowerUps() {
  for (const list of [state.pickups, state.powerups, state.coinPickups]) {
    list.forEach((p) => scene.remove(p.mesh));
    list.length = 0;
  }
  // Ended as they end on their own (updateExplosions): the light back to
  // its pool, not out of the scene (that lost the slot for good, and the
  // next blast's new light recompiled shaders), the animation let go
  state.activeExplosions.forEach((e) => {
    if (e.mixer) {
      e.mixer.stopAllAction();
      e.mixer.uncacheRoot(e.obj);
    }
    if (e.obj) scene.remove(e.obj);
    if (e.fallback) e.fallback.busy = false;
    releaseEffectLight(e.light);
  });
  state.activeExplosions.length = 0;
  state.explosiveBarrels.forEach((b) => {
    scene.remove(b.mesh);
    if (b.collisionBody) world.removeBody(b.collisionBody);
  });
  state.explosiveBarrels.length = 0;
  if (barrelTemplate) barrelSpots.forEach(([x, z]) => new Barrel(new THREE.Vector3(x, 0, z)));
  if (shieldMesh) shieldMesh.visible = false;
  updateShieldHUD();
}

/* ---------------------------------------------------------------------
   ITEM PICKUPS (health/ammo dropped by kills) — consumed by the player
--------------------------------------------------------------------- */
const pickupGeometry = new THREE.OctahedronGeometry(0.18);
const pickupMaterials = new Map();
function pickupMaterial(color) {
  if (!pickupMaterials.has(color)) pickupMaterials.set(color,
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.35 }));
  return pickupMaterials.get(color);
}
const powerupCoreGeometry = new THREE.IcosahedronGeometry(0.24, 0);
const powerupRingGeometry = new THREE.TorusGeometry(0.36, 0.02, 8, 24);
const powerupMaterials = new Map();
function powerupMaterialPair(color) {
  if (!powerupMaterials.has(color)) powerupMaterials.set(color, [
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.3 }),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }),
  ]);
  return powerupMaterials.get(color);
}
const coinGeometry = new THREE.CylinderGeometry(0.16, 0.16, 0.035, 18);
const coinMaterial = new THREE.MeshStandardMaterial({ color: 0xffd94a, emissive: 0x996600, emissiveIntensity: 0.6, metalness: 0.75, roughness: 0.3 });

// amount: ammo rounds it holds (default 18; an ammo carrier's bag, characters.js)
export function spawnPickup(pos, type, amount = 0) {
  const color = type === 'health' ? 0x44dd66 : 0xe0b030;
  const mesh = new THREE.Mesh(
    pickupGeometry,
    pickupMaterial(color)
  );
  mesh.position.set(pos.x, 0.45, pos.z);
  scene.add(mesh);
  state.pickups.push({ mesh, type, amount, life: 22 });
}

export function updatePickups(dt, pos) {
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    p.life -= dt;
    p.mesh.rotation.y += dt * 2.2;
    p.mesh.position.y = 0.42 + Math.sin(performance.now() * 0.004 + i) * 0.08;
    if (p.life <= 0) { scene.remove(p.mesh); state.pickups.splice(i, 1); continue; }
    if (p.mesh.position.distanceTo(pos) < 1.4) {
      if (p.type === 'ammo') {
        const n = p.amount || 18;
        state.ammoReserve += n;
        pushKillFeed(`+${n} ammo`);
      } else {
        state.playerHealth = Math.min(state.playerMaxHealth, state.playerHealth + 28);
        dom.healthFill.style.width = (state.playerHealth / state.playerMaxHealth) * 100 + '%';
        if (dom.bloodVig) dom.bloodVig.style.opacity = String(1 - state.playerHealth / state.playerMaxHealth);
        pushKillFeed('+health');
      }
      sfx.pickup();
      updateAmmoHUD();
      scene.remove(p.mesh);
      state.pickups.splice(i, 1);
    }
  }
}

/* ---------------------------------------------------------------------
   POWERUPS — dropped every 3rd confirmed kill in a streak (reset on
   player death). Four kinds: petrol (tops up carFuel), health (heals),
   ammo (refills reserve so the player can reload), and shield (15s of
   full attack immunity with a glowing shader bubble around the player).
--------------------------------------------------------------------- */
const POWERUP_TYPES = ['petrol', 'health', 'ammo', 'shield'];
const POWERUP_COLORS = { petrol: 0xff8a1a, health: 0x44dd66, ammo: 0xe0b030, shield: 0x37c8ff };
// The very first powerup drop of the game is always the shield — gives
// the player a guaranteed early safety net before RNG takes over for
// every drop after that.
let firstPowerupGiven = false;

export function registerKillstreak(pos) {
  state.killStreak++;
  if (state.killStreak % 3 === 0) {
    let type;
    if (!firstPowerupGiven) {
      type = 'shield';
      firstPowerupGiven = true;
    } else {
      type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    }
    spawnPowerup(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), type);
    pushKillFeed(`3-kill streak — ${type.toUpperCase()} powerup dropped`);
  }
}

export function spawnPowerup(pos, type) {
  const color = POWERUP_COLORS[type];
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    powerupCoreGeometry,
    powerupMaterialPair(color)[0]
  );
  group.add(core);
  const ring = new THREE.Mesh(
    powerupRingGeometry,
    powerupMaterialPair(color)[1]
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  const light = acquireEffectLight(color, 1.6, 5, 2, true);
  if (light) light.position.set(pos.x, 0.55, pos.z);
  group.position.set(pos.x, 0.55, pos.z);
  scene.add(group);
  state.powerups.push({ mesh: group, light, type, life: 26 });
}

export function applyPowerup(type, carMaxFuel) {
  switch (type) {
    case 'petrol':
      state.carFuel = Math.min(carMaxFuel, state.carFuel + 40);
      pushKillFeed('+40 fuel');
      updateFuelHUD(carMaxFuel);
      break;
    case 'health':
      state.playerHealth = Math.min(state.playerMaxHealth, state.playerHealth + 40);
      dom.healthFill.style.width = (state.playerHealth / state.playerMaxHealth) * 100 + '%';
      if (dom.bloodVig) dom.bloodVig.style.opacity = String(1 - state.playerHealth / state.playerMaxHealth);
      pushKillFeed('+40 health');
      break;
    case 'ammo':
      state.ammoReserve += MAG_SIZE;
      pushKillFeed(`+${MAG_SIZE} reserve ammo`);
      updateAmmoHUD();
      break;
    case 'shield':
      activateShield(15);
      break;
  }
  sfx.pickup();
}

export function updatePowerups(dt, pos, carMaxFuel) {
  for (let i = state.powerups.length - 1; i >= 0; i--) {
    const p = state.powerups[i];
    p.life -= dt;
    p.mesh.rotation.y += dt * 1.6;
    p.mesh.position.y = 0.55 + Math.sin(performance.now() * 0.003 + i) * 0.08;
    if (p.life <= 0) { scene.remove(p.mesh); releaseEffectLight(p.light); state.powerups.splice(i, 1); continue; }
    if (p.mesh.position.distanceTo(pos) < 1.5) {
      applyPowerup(p.type, carMaxFuel);
      releaseEffectLight(p.light);
      scene.remove(p.mesh);
      state.powerups.splice(i, 1);
    }
  }
}

/* --- Coins: separate from powerups — every confirmed kill drops one. --- */
export function spawnCoin(pos) {
  const mesh = new THREE.Mesh(
    coinGeometry,
    coinMaterial
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(pos.x + (Math.random() - 0.5) * 0.4, 0.3, pos.z + (Math.random() - 0.5) * 0.4);
  scene.add(mesh);
  state.coinPickups.push({ mesh, life: 24 });
}

export function updateCoins(dt, pos) {
  for (let i = state.coinPickups.length - 1; i >= 0; i--) {
    const c = state.coinPickups[i];
    c.life -= dt;
    c.mesh.rotation.z += dt * 3;
    c.mesh.position.y = 0.3 + Math.sin(performance.now() * 0.005 + i) * 0.06;
    if (c.life <= 0) { scene.remove(c.mesh); state.coinPickups.splice(i, 1); continue; }
    if (c.mesh.position.distanceTo(pos) < 1.3) {
      state.coins++;
      updateCoinHUD();
      sfx.pickup();
      scene.remove(c.mesh);
      state.coinPickups.splice(i, 1);
    }
  }
}

/* ---------------------------------------------------------------------
   SHIELD — 15s of full attack immunity, with a glowing bubble shader
   around the player (see shaders.js for the material itself).
--------------------------------------------------------------------- */
let shieldMesh = null;

// Attaches the shield mesh to the player's group. Called once by the
// level, after characters.js's player has been built — kept out of this
// module's own top level (see the import comment above) even though it
// only needs `playerVis`, which is already available by then.
export function initShield() {
  if (shieldMesh) return;
  const shieldMaterial = createShieldMaterial();
  shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), shieldMaterial); // unit sphere —
                                                                                     // real size is set
                                                                                     // fresh in activateShield()
  shieldMesh.visible = false;
  playerVis.group.add(shieldMesh);
}

export function activateShield(seconds) {
  state.shieldActive = true;
  state.shieldTimer = seconds;
  state.shieldDuration = seconds;
  if (shieldMesh) {
    // Sized from the player's ACTUAL current height, recomputed fresh
    // every activation, instead of a hardcoded radius — the player's
    // scale has changed several times over this project and is still
    // live-adjustable with [ / ], so a fixed number drifts out of sync
    // with whatever the correct size currently is. This can't go stale.
    // Clamped to a plausible human range: confirmed the [ / ] keys could
    // drift state.playerCurrentHeight down to ~0.78m from unguarded
    // browser key-repeat (fixed separately), but this clamp means even
    // if scale drifts for some other reason in the future, the shield
    // won't blindly shrink to match nonsense — same defensive principle
    // as the zombie ground-clamp sanity check.
    const rawHeight = state.playerCurrentHeight || 1.8;
    const height = THREE.MathUtils.clamp(rawHeight, 1.4, 2.2);
    const radius = height * 1.4; // was 1.24 — a little bigger, per feedback
    const centerY = height * 0.5;
    state.shieldRadius = radius; // exposed so zombies can treat the shield
                                  // as a real physical barrier, not just a
                                  // damage-immunity flag — see characters.js
    shieldMesh.geometry.dispose();
    shieldMesh.geometry = new THREE.SphereGeometry(radius, 32, 24);
    shieldMesh.position.set(0, centerY, 0);
    shieldMesh.visible = true;
  }
  pushKillFeed('Shield active — 15s of full protection');
  updateShieldHUD();
}

export function updateShield(dt) {
  if (!state.shieldActive) return;
  state.shieldTimer -= dt;
  shieldUniforms.uTime.value += dt;
  if (shieldMesh) shieldMesh.scale.setScalar(1 + Math.sin(shieldUniforms.uTime.value * 3) * 0.015);
  updateShieldHUD();
  if (state.shieldTimer <= 0) {
    state.shieldActive = false;
    if (shieldMesh) shieldMesh.visible = false;
    pushKillFeed('Shield down');
    updateShieldHUD();
  }
}
