import {raycastAnimatedTargets} from './AnimatedRaycast.js';
import {stepPlayerPhysics} from './PhysicsStep.js';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { state, resetRunState } from './state.js';
import { createStreetAtmosphere } from './StreetAtmosphere.js';
import { updateLocomotion } from './Movement.js';
import { RayCandidates } from './RayCandidates.js';
import { addContactShading } from './ContactShading.js';
import { placeBloodSplat, spawnBloodSpray, crackGlassAlong, updateImpactFX, clearImpactFX } from './ImpactFX.js';
import { markStaticSince, mergeStaticScenery } from './mergeStatic.js';
import { retryLevel, setRestartHandler } from './account.js';
import {levelWeapon,levelWeaponIds,nextWeapon} from './WeaponSlots.js';
import { startDayCycle, updateDayCycle } from './DayCycle.js';
import {
  scene, world, camera, renderer, dom, sfx, sky,
  pushKillFeed, doDeath, doWin, checkExtraction, updateExtractRing,
  updateAmmoHUD, updateObjectiveHUD, updateWeaponHUD, updateCoinHUD,
  updateCompass, drawRadar, createMissionTracker, loadWorldBounds, onAssetsReady,
  forwardFromYaw, rightFromYaw,
  STREET_HALF_W, ZOMBIE_SPAWN_INTERVAL,
  updateFuelHUD as updateFuelHUDBase,
  applyTimeOfDay, updateWeatherFX, addLight, showRenderFailure,
} from './Scene.js';
// Actions.js and characters.js import from each other (characters.js needs
// damagePlayer/spawnHitSpark/spawnBlood for zombie hits; Actions.js needs
// the player rig, the vehicle, and their tuning constants). This is safe
// circularity: every cross-reference below is only ever touched from
// inside a function body (called later, once the whole module graph has
// finished loading), never at either file's own top level — the same
// deferred pattern documented in PowerUps.js and Scene.js.
import {
  playerVis, playerBody, playerHeight,
  carVis, chassisBody, vehicle, carSpawn, CAR_MAX_FUEL,
  FRONT_WHEELS, REAR_WHEELS, MAX_STEER, MAX_ENGINE_FORCE, MAX_BRAKE_FORCE, HANDBRAKE_FORCE,
  viewmodelGun, knifeThirdPerson, knifeViewModel,
  syncHandGun, setPlayerAction, playPlayerGesture, groundClampRig, lerpAngle, checkVehicleRollover,
  ZOMBIE_TARGET_HEIGHT,
  loadMainCharacter, loadZombies, loadCars, loadBuildings, loadTrashCans, loadObstacles,
  loadStreetSurface, spawnDepotGuards, spawnZombie, updateZombies,
  adjustPlayerScale, renderViewmodels, warmViewmodels, resetCharacters,
} from './characters.js';
import {
  loadBarrels, initShield, resetPowerUps,
  updatePickups, updatePowerups, updateCoins, updateExplosions, updateShield,
} from './PowerUps.js';

/* ---------------------------------------------------------------------
   LEVEL EXTENSION POINTS — per-level systems (girl NPC, purchases,
   mission ticks) register themselves here instead of Actions.js
   growing level-specific code. Level 2 is the first user; Levels 1/3
   register nothing and every hook below no-ops for them.
--------------------------------------------------------------------- */
const levelTicks = [];
const levelPreTicks = [];
const levelPreparations = [];
export function registerLevelPreparation(fn) { levelPreparations.push(fn); }
export function registerLevelTick(fn) { levelTicks.push(fn); }
export function registerLevelPreTick(fn) { levelPreTicks.push(fn); }
// Called by restartLevel() after the shared reset, so a level can put
// its own mission state back (Level 2: the girl and the boat).
const levelResets = [];
export function registerLevelReset(fn) { levelResets.push(fn); }
// Key handlers a level module drops in, e.g. { KeyE: fn, KeyG: fn }.
export const levelKeyHooks = {};

/* ======================================================================
   Actions.js — PLAYER ACTIONS: MOVEMENT, CAMERA, SHOOTING, BULLETS,
   VEHICLE CONTROLS, AND THE LEVEL BOOTSTRAP/GAME LOOP

   Every tunable value below (fire rate, damage, movement speed, bullet/
   melee range, brake/engine forces) is copied verbatim from the original
   game.js — nothing here changes gameplay, only where the code lives.
====================================================================== */

/* ---------------------------------------------------------------------
   COMBAT — weapon tuning, hit VFX, gun/melee/knife logic
--------------------------------------------------------------------- */
export const MAG_SIZE = 30; // was 12 — read as an underpowered pistol, not a combat weapon
const FIRE_RATE = 0.11; // was 0.19 (~5.3rps) — now ~9rps, an actual automatic weapon
const GUN_DAMAGE = 26;
const MELEE_DAMAGE = 42;
const MELEE_RANGE = 2.15;
const KNIFE_DAMAGE = 38;
const KNIFE_RANGE = 1.9;

// The real DOM update lives in Scene.js (which can't import CAR_MAX_FUEL
// from characters.js at its own top level). Actions.js re-exposes it with
// CAR_MAX_FUEL defaulted in, so PowerUps.js can import "updateFuelHUD"
// from here and call it either with an explicit maxFuel (as it does) or
// with no argument at all (matching the original zero-arg call site).
export function updateFuelHUD(maxFuel = CAR_MAX_FUEL) {
  if (state.skipCar || !maxFuel) return;
  updateFuelHUDBase(maxFuel);
}

const raycaster = new THREE.Raycaster();
const shotBounds = new THREE.Box3();
const shotMatrix = new THREE.Matrix4();
const shotCenter = new THREE.Vector3();
const shotMin = new THREE.Vector3();
const shotMax = new THREE.Vector3();
const skinWeightsValid = new WeakMap();
const shotTargets = [];
const shotHits = [];

function canBoundSkin(geometry) {
  if (skinWeightsValid.has(geometry)) return skinWeightsValid.get(geometry);
  const weights = geometry.attributes.skinWeight;
  let valid = !!weights && weights.itemSize === 4;
  for (let i = 0; valid && i < weights.count; i++) {
    const x = weights.getX(i), y = weights.getY(i), z = weights.getZ(i), w = weights.getW(i);
    valid = Number.isFinite(x + y + z + w) && Math.min(x, y, z, w) >= 0 && Math.abs(x + y + z + w - 1) < 1e-6;
  }
  skinWeightsValid.set(geometry, valid);
  return valid;
}

function expandShotBounds(sphere, matrix) {
  shotCenter.copy(sphere.center).applyMatrix4(matrix);
  const e = matrix.elements;
  // Frobenius norm bounds stretching even when parent transforms shear.
  const stretch = Math.hypot(e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]);
  const radius = sphere.radius * stretch;
  const padding = (Math.max(Math.abs(shotCenter.x), Math.abs(shotCenter.y), Math.abs(shotCenter.z)) + radius + 1) * 1e-5;
  shotMin.copy(shotCenter).addScalar(-radius - padding);
  shotMax.copy(shotCenter).addScalar(radius + padding);
  shotBounds.expandByPoint(shotMin);
  shotBounds.expandByPoint(shotMax);
}

function mayIntersectShot(root) {
  shotBounds.makeEmpty();
  let unknown = false;
  root.updateWorldMatrix(true, true);
  root.traverse(mesh => {
    if (!mesh.isMesh || unknown) return;
    const geometry = mesh.geometry;
    if (!geometry || mesh.isInstancedMesh || mesh.morphTargetInfluences?.some(weight => weight !== 0)) { unknown = true; return; }
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (!sphere || !Number.isFinite(sphere.radius)) { unknown = true; return; }
    if (mesh.isSkinnedMesh) {
      if (!mesh.skeleton || !canBoundSkin(geometry)) { unknown = true; return; }
      // Every posed vertex is a convex blend of these bone transforms.
      // Enclosing every transformed source sphere also encloses that blend;
      // this avoids CPU skinning every vertex just to reject an off-aim rig.
      const { bones, boneInverses } = mesh.skeleton;
      if (!bones.length) { unknown = true; return; }
      for (let i = 0; i < bones.length; i++) {
        if (!bones[i] || !boneInverses[i]) { unknown = true; return; }
        shotMatrix.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse)
          .multiply(bones[i].matrixWorld).multiply(boneInverses[i]).multiply(mesh.bindMatrix);
        expandShotBounds(sphere, shotMatrix);
      }
    } else {
      expandShotBounds(sphere, mesh.matrixWorld);
    }
  });
  return unknown || shotBounds.isEmpty() || raycaster.ray.intersectsBox(shotBounds);
}

const sparkGeo = new THREE.SphereGeometry(0.05, 6, 6);
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffcc55, transparent: true });

export function spawnHitSpark(pos) {
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(sparkGeo, sparkMat.clone());
    s.position.copy(pos);
    s.userData.vel = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3);
    s.userData.life = 0.4;
    s.userData.maxLife = 0.4;
    scene.add(s);
    state.activeSparks.push(s);
  }
}

// Pooled in ImpactFX.js: no new mesh per hit; the oldest splat is reused
export function spawnBlood(pos) {
  placeBloodSplat(pos);
}

function activeGunMesh() {
  return state.firstPerson ? viewmodelGun : playerVis.gunPivot;
}
// Keep the light count stable: adding/removing a light for every shot
// forces new material shader variants, often right as the player fires.
const muzzleLight = new THREE.PointLight(0xffcc66, 0, 7, 2);
let muzzleFlashTime = 0;
function spawnMuzzleFlash() {
  activeGunMesh().getWorldPosition(muzzleLight.position);
  muzzleLight.intensity = 8;
  muzzleFlashTime = 0.05;
}
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff4c2, transparent: true, opacity: 0.95 });
function spawnTracer(from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 0.05) return;
  const geo = new THREE.CylinderGeometry(0.01, 0.01, len, 5, 1, true);
  const mesh = new THREE.Mesh(geo, tracerMat.clone());
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  mesh.userData.life = 0.07;
  mesh.userData.maxLife = 0.07;
  scene.add(mesh);
  state.activeTracers.push(mesh);
}

/* -----------------------------------------------------------------
   WEAPON SWITCHING — gun vs. knife.
   The player always starts with a full magazine (state.ammoMag =
   MAG_SIZE). Once BOTH the magazine and the reserve are empty, there is
   nothing left to reload, so the gun is holstered automatically and the
   knife becomes the only option until an ammo pickup/powerup arrives.
   Otherwise the player can freely toggle with Q.
----------------------------------------------------------------- */
function hasAnyAmmo() { return state.ammoMag > 0 || state.ammoReserve > 0; }
function setWeaponVisualsVisible() {
  const showGun = state.currentWeapon === 'gun';
  if (playerVis.gun) playerVis.gun.visible = showGun;
  if (knifeThirdPerson) knifeThirdPerson.visible = state.currentWeapon === 'knife';
  if (viewmodelGun.children[0]) viewmodelGun.children[0].visible = showGun;
  viewmodelGun.visible = state.firstPerson && showGun && !state.inVehicle;
  if (knifeViewModel) knifeViewModel.visible = state.firstPerson && state.currentWeapon === 'knife' && !state.inVehicle;
}
export function switchWeapon(weapon) {
  if (state.narrativeBlocked || state.paused || state.isDead || state.dying || state.cinematic || state.inVehicle) return;
  if (weapon !== 'gun' && weapon !== 'knife' && !levelWeapon(weapon)) return;
  if (weapon === 'gun' && !hasAnyAmmo()) {
    pushKillFeed('No ammo left — knife only');
    weapon = 'knife';
  }
  if (weapon === state.currentWeapon) return;
  const previous = levelWeapon(state.currentWeapon);
  state.currentWeapon = weapon;
  state.firePressed = false;
  state.reloading = false; state.reloadTimer = 0; dom.reloadText.classList.add('hidden');
  setWeaponVisualsVisible();
  updateWeaponHUD();
  updateAmmoHUD();
  previous?.onSwitch?.();levelWeapon(weapon)?.onSwitch?.();
  pushKillFeed('Switched to '+(levelWeapon(weapon)?.label || (weapon==='gun'?'pistol':'knife')));
}
// Forces the knife if ammo has fully run out (both mag and reserve empty).
// Called after every shot and after reload attempts/failures.
function enforceAmmoWeaponRule() {
  if (!hasAnyAmmo() && state.currentWeapon === 'gun') {
    state.currentWeapon = 'knife';
    setWeaponVisualsVisible();
    updateWeaponHUD();
    updateAmmoHUD();
    pushKillFeed('Out of ammo — switched to knife');
  }
}

function requestPointerLockSafe() {
  if (!dom.canvas.isConnected || document.pointerLockElement === dom.canvas) return;
  try {
    // Loading, hidden previews, and browser gesture restrictions can reject
    // pointer lock. Keep the game running; a canvas click retries it.
    const request = dom.canvas.requestPointerLock();
    if (request && typeof request.catch === 'function') request.catch(() => {});
  } catch { /* The existing canvas click remains the retry path. */ }
}

export function togglePause() {
  if (state.narrativeBlocked) return;
  if (state.isDead) return; // don't let pause interfere with the death/win screens
  if (!dom.hud || dom.hud.classList.contains('hidden')) return; // no pausing before the level has even started
  state.paused = !state.paused;
  if (state.paused) {
    if (dom.pauseOverlay) dom.pauseOverlay.classList.remove('hidden');
    // Pointer lock has to go — otherwise the mouse stays trapped and
    // invisible, and clicking the on-screen Resume button becomes
    // impossible. Exiting it here also frees the cursor for anyone using
    // the mouse instead of Tab to resume.
    document.exitPointerLock();
    sfx.setEngine(0, false);
  } else {
    if (dom.pauseOverlay) dom.pauseOverlay.classList.add('hidden');
    // Re-lock automatically on resume so play continues immediately
    // instead of requiring an extra click just to get mouse-look back —
    // browsers allow this since the Tab press / button click that got us
    // here counts as the required direct user gesture.
    requestPointerLockSafe();
  }
}

export function showHitmarker() {
  dom.hitmarker.classList.remove('show'); void dom.hitmarker.offsetWidth;
  dom.hitmarker.classList.add('show');
}

const _capA = new THREE.Vector3(), _capB = new THREE.Vector3(), _capP = new THREE.Vector3();
// Nearest alive infected whose capsule (feet to head, ~0.6 m radius, scaled
// with the model) the current aim ray passes through, shaped like a
// raycast hit so tryShoot can treat it the same way.
function zombieCapsuleHit() {
  const ray = raycaster.ray;
  let best = null;
  for (const z of state.zombies) {
    if (!z.alive || z.state === 'downed') continue;
    const sc = Math.max(1, z.mesh.scale.y);
    const h = ZOMBIE_TARGET_HEIGHT * sc, r = 0.6 * sc;
    _capA.copy(z.mesh.position);
    _capB.copy(z.mesh.position).y += h;
    // Closest approach between the ray and the capsule's axis
    const along = ray.distanceSqToSegment(_capA, _capB, _capP);
    if (along > r * r) continue;
    const d = ray.origin.distanceTo(_capP);
    if (d > 70 || (best && d >= best.distance)) continue;
    best = { distance: d, point: _capP.clone(), object: { userData: { owner: z } } };
  }
  return best;
}

export function tryShoot() {
  if (state.narrativeBlocked || state.paused || state.isDead || state.dying || state.cinematic) return;
  const extra=levelWeapon(state.currentWeapon);
  if(extra){if(!state.inVehicle&&extra.fire())triggerShootAnimSafe();return;}
  if (state.currentWeapon !== 'gun') { tryKnife(); return; }
  if (state.inVehicle || state.isDead || state.reloading || state.fireCooldown > 0) return;
  if (state.ammoMag <= 0) { startReload(); return; }
  state.fireCooldown = FIRE_RATE;
  state.ammoMag--;
  levelKeyHooks.onGunshot?.();
  updateAmmoHUD();
  spawnMuzzleFlash();
  sfx.shoot();
  state.shake = Math.max(state.shake, 0.08);
  triggerShootAnimSafe();
  // Recoil is a separate, capped, decaying value instead of a permanent
  // addition to the actual aim pitch — sustained fire can never push the
  // view (and therefore the next shot's raycast) into broken angles.
  state.recoilPitch = Math.min(state.recoilPitch + 0.02, 0.3);
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  // Raycast against each alive zombie's actual mesh group (recursive), not
  // just the abstract hitbox capsule, so a visually-on-target shot can't
  // silently miss due to hitbox/model misalignment.
  shotTargets.length = 0;
  shotHits.length = 0;
  state.zombies.forEach((z) => { if (z.alive && mayIntersectShot(z.mesh)) shotTargets.push(z.mesh); });
  state.explosiveBarrels.forEach((b) => { if (!b.exploded) shotTargets.push(b.mesh); });
  const hits = raycastAnimatedTargets(raycaster, shotTargets, shotHits);
  // Retain the incoming capsule fallback without masking a precise weak-point hit.
  const cap = zombieCapsuleHit();
  const sameWeakPoint = hits.length && hits[0].object.userData.guardianWeakPoint && cap && hits[0].object.userData.owner === cap.object.userData.owner;
  if (cap && !sameWeakPoint && (!hits.length || cap.distance < hits[0].distance)) hits.unshift(cap);

  const muzzlePos = new THREE.Vector3();
  activeGunMesh().getWorldPosition(muzzlePos);
  const tracerEnd = hits.length
    ? hits[0].point
    : raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 70);
  spawnTracer(muzzlePos, tracerEnd);
  crackGlassAlong(raycaster.ray, hits.length ? hits[0].distance : 70);
  if (hits.length) {
    const owner = hits[0].object.userData.owner;
    if (owner && owner.isBarrel) {
      owner.takeDamage();
      showHitmarker();
    } else if (owner) {
  const headshot = hits[0].point.y > owner.mesh.position.y + 1.42 * Math.max(1, owner.mesh.scale.y);
  // The Guardian is armour plate: sparks, not blood
  if (!owner.guardian) spawnBloodSpray(hits[0].point, raycaster.ray.direction, headshot, owner.mesh.position.y);
  owner.takeDamage(headshot ? GUN_DAMAGE * 1.85 : GUN_DAMAGE, headshot, !!hits[0].object.userData.guardianWeakPoint);

      showHitmarker();
    }
  }
  if (state.ammoMag <= 0) startReload();
  enforceAmmoWeaponRule();
}
function triggerShootAnimSafe() {
  if (!playerVis.shootAction) return;
  playerVis.shootAction.reset();
  playerVis.shootAction.play();
}

export function tryMelee() {
  if (state.narrativeBlocked) return;
  if (state.inVehicle || state.isDead || state.meleeTimer > 0) return;
  state.meleeTimer = 0.38;
  playPlayerGesture('melee', state.meleeTimer);
  sfx.melee();
  const playerPos = playerVis.group.position;
  const forward = forwardFromYaw(state.yaw);
  let hitAny = false;
  state.zombies.forEach((z) => {
    if (!z.alive) return;
    const toZ = new THREE.Vector3().subVectors(z.mesh.position, playerPos);
    const dist = toZ.length();
    if (dist < MELEE_RANGE) {
      const angle = forward.angleTo(toZ.clone().normalize());
      if (angle < Math.PI / 2.1) { z.takeDamage(MELEE_DAMAGE, false); hitAny = true; }
    }
  });
  if (hitAny) showHitmarker();
}
// The dedicated knife attack used as the PRIMARY (left-click) action
// whenever the knife is the equipped weapon (either by choice or because
// ammo ran out). Kept separate from tryMelee (which stays bound to the
// right-click quick-bash regardless of equipped weapon) so the two don't
// fight over meleeTimer in confusing ways, though they share the same
// cooldown field since only one melee action makes sense at a time.
export function tryKnife() {
  if (state.narrativeBlocked) return;
  if (state.inVehicle || state.isDead || state.meleeTimer > 0) return;
  state.meleeTimer = 0.32;
  playPlayerGesture('melee', state.meleeTimer);
  sfx.melee();
  const playerPos = playerVis.group.position;
  const forward = forwardFromYaw(state.yaw);
  let hitAny = false;
  state.zombies.forEach((z) => {
    if (!z.alive) return;
    const toZ = new THREE.Vector3().subVectors(z.mesh.position, playerPos);
    const dist = toZ.length();
    if (dist < KNIFE_RANGE) {
      const angle = forward.angleTo(toZ.clone().normalize());
      if (angle < Math.PI / 2.1) { z.takeDamage(KNIFE_DAMAGE, false); hitAny = true; }
    }
  });
  if (hitAny) showHitmarker();
}
export function startReload() {
  if (state.narrativeBlocked || state.currentWeapon !== 'gun' || state.isDead || state.paused) return;
  if (state.reloading || state.ammoMag === MAG_SIZE || state.ammoReserve <= 0 || state.inVehicle) {
    enforceAmmoWeaponRule();
    return;
  }
  state.reloading = true; state.reloadTimer = 1.55;
  playPlayerGesture('reload', state.reloadTimer);
  dom.reloadText.classList.remove('hidden');
}

/* ---------------------------------------------------------------------
   PLAYER DAMAGE / DEATH
--------------------------------------------------------------------- */
export function damagePlayer(dmg) {
  if (state.narrativeBlocked || state.isDead || state.dying) return;
  if (state.shieldActive) return; // shield blocks all attacks outright
  // Brief grace after any hit. Without it, every zombie swings on its
  // own ~0.95s cooldown, so a pack of three stacked ~30 dps into a
  // 100 HP player — dead in roughly three seconds of contact, which
  // read as a glitch ("insta-death swarm") rather than difficulty. One
  // shared 0.5s window caps the worst case at about one hit's worth of
  // damage per half-second no matter how many are swinging at once.
  if (state.hurtGrace > 0) return;
  state.hurtGrace = 0.5;
  state.playerHealth = Math.max(0, state.playerHealth - dmg);
  dom.healthFill.style.width = (state.playerHealth / state.playerMaxHealth) * 100 + '%';
  if (dom.bloodVig) dom.bloodVig.style.opacity = String(1 - state.playerHealth / state.playerMaxHealth);
  sfx.hurt();
  state.shake = Math.max(state.shake, 0.22);
  if (state.playerHealth / state.playerMaxHealth <= HEARTBEAT_THRESHOLD) monitorBite();
  // Zero health is 99.99% infection: overrun — the fall, the feeding, and
  // only then the death screen (see OVERRUN below)
  if (state.playerHealth <= 0) startDying();
}

// Low-health tension cue: pulses #critical-pulse and a synthesized
// heartbeat thump once health drops below 30%, speeding up the closer
// the player gets to death. Pure UI/audio feedback — reads playerHealth,
// touches nothing else, so it's safe to add without risk to the zombie
// AI, car physics, or anything level-specific.
const HEARTBEAT_THRESHOLD = 0.3; // fraction of max health
export function updateLowHealthFX(dt) {
  if (!dom.criticalPulse) return;
  const pct = state.playerMaxHealth > 0 ? state.playerHealth / state.playerMaxHealth : 1;
  const critical = !!state.dying || (!state.isDead && pct > 0 && pct <= HEARTBEAT_THRESHOLD);
  if (!critical) {
    dom.criticalPulse.classList.remove('active');
    state.heartbeatTimer = 0;
    return;
  }
  dom.criticalPulse.classList.add('active');
  // 1.1s between beats at the 30% threshold, tightening to ~0.45s as
  // health approaches 0 — the closer to death, the more urgent it feels.
  const interval = THREE.MathUtils.lerp(0.45, 1.1, pct / HEARTBEAT_THRESHOLD);
  dom.criticalPulse.style.setProperty('--pulse-speed', `${interval}s`);
  state.heartbeatTimer -= dt;
  if (state.heartbeatTimer <= 0) {
    state.heartbeatTimer = interval;
    sfx.heartbeat();
    monitorBeat();
  }
}

/* ---------------------------------------------------------------------
   OVERRUN — THE INFECTION MONITOR AND THE DEATH SCENE (every level)

   Once health is in the red (the critical pulse, <= 30%), an infection
   monitor shows over the health bar: a scrolling heart-monitor trace
   that beats with the heartbeat and spikes on every bite, and a reading
   that climbs as health falls — 99.99% at zero health. At 99.99% the player
   is overrun: they stop answering the controls and fall (the 'die'
   clip), the zombies near them close in, crouch over the body and feed
   (faked with posture: no eating clip exists for either zombie rig; off
   for now, see FEEDING_ENABLED), the camera pulls back to watch, and the
   death screen follows.

   state.dying ({ t, eaters }) is the stretch between: not dead (so the
   world, the zombies and the player's own animation keep running) but
   no longer playing. Actions' animate loop runs updateDying in place of
   the gameplay block while it's set.
--------------------------------------------------------------------- */
const INFECTION_FATAL = 99.99;      // the reading at zero health — overrun only when it's all but total
const DYING_SECONDS = 4.2;          // fall + feeding before the death screen
const EAT_RADIUS = 12;              // zombies this close come to feed
// Pinned: the crouch-and-hunch feeding read wrong, so it's off until it's
// replaced. Off, no zombie is sent to feed: they all keep closing in as
// usual while the camera pulls back. true brings the feeding back as it was.
const FEEDING_ENABLED = false;
const monitor = { el: null, ctx: null, pct: null, samples: null, beat: -1, bite: 0, shown: false, value: 0 };

function buildInfectionMonitor() {
  if (monitor.el) return;
  const style = document.createElement('style');
  style.textContent = `
    #infection-monitor{position:absolute;left:22px;bottom:118px;width:236px;padding:6px 10px 8px;
      background:rgba(18,4,4,0.72);border:1px solid rgba(255,60,50,0.55);border-radius:4px;
      box-shadow:0 0 18px rgba(255,30,20,0.25);opacity:0;transform:translateY(6px);
      transition:opacity .35s,transform .35s;pointer-events:none;}
    #infection-monitor.on{opacity:1;transform:none;}
    #infection-monitor .im-head{display:flex;justify-content:space-between;align-items:baseline;
      font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#ff9c90;}
    #infection-monitor .im-pct{font-size:18px;letter-spacing:.04em;color:#ff4a3a;font-weight:700;
      text-shadow:0 0 10px rgba(255,40,30,.7);}
    #infection-monitor canvas{display:block;width:100%;height:46px;margin-top:3px;}
    #infection-monitor.fatal{border-color:#ff2a1a;animation:im-fatal .5s steps(2) infinite;}
    @keyframes im-fatal{50%{border-color:rgba(255,42,26,.2);}}
  `;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'infection-monitor';
  el.innerHTML = '<div class="im-head"><span>Infection</span><span class="im-pct">0%</span></div><canvas width="216" height="46"></canvas>';
  dom.hud.appendChild(el);
  monitor.el = el;
  monitor.pct = el.querySelector('.im-pct');
  monitor.ctx = el.querySelector('canvas').getContext('2d');
  monitor.samples = new Float32Array(216);
}

// A heartbeat on the trace (called from the heartbeat timer)
function monitorBeat() { monitor.beat = 0; }
// A bite: a tall spike, and the reading jumps
export function monitorBite() { monitor.bite = 1; }

// The trace's next sample: flat line, a P-QRS-T beat when one's running,
// a jagged spike on a bite, and noise that grows with the infection
function nextSample(dt) {
  let y = (Math.random() - 0.5) * 0.06 * (1 + monitor.value / 40);
  if (monitor.beat >= 0) {
    const b = monitor.beat;
    if (b < 0.06) y += 0.12 * Math.sin((b / 0.06) * Math.PI);            // P
    else if (b < 0.09) y -= 0.18 * ((b - 0.06) / 0.03);                   // Q
    else if (b < 0.12) y += 0.95 * (1 - Math.abs((b - 0.105) / 0.015));   // R
    else if (b < 0.15) y -= 0.3 * (1 - (b - 0.12) / 0.03);                // S
    else if (b < 0.3) y += 0.2 * Math.sin(((b - 0.15) / 0.15) * Math.PI); // T
    monitor.beat += dt;
    if (monitor.beat > 0.3) monitor.beat = -1;
  }
  if (monitor.bite > 0) {
    y += (Math.random() < 0.5 ? 1 : -1) * monitor.bite * 1.1;
    monitor.bite = Math.max(0, monitor.bite - dt * 4);
  }
  return THREE.MathUtils.clamp(y, -1, 1);
}

// Whole percent until the last one, then hundredths: 99.41% ... 99.99%
function infectionText(v) {
  return v >= 99 ? `${(Math.floor(Math.min(v, 99.99) * 100) / 100).toFixed(2)}%` : `${Math.round(v)}%`;
}

function updateInfectionMonitor(dt) {
  if (!monitor.el) return;
  const pct = state.playerMaxHealth > 0 ? state.playerHealth / state.playerMaxHealth : 1;
  const show = !!state.dying || (!state.isDead && pct <= HEARTBEAT_THRESHOLD);
  if (show !== monitor.shown) { monitor.shown = show; monitor.el.classList.toggle('on', show); }
  if (!show) { monitor.value = 0; return; }
  // The reading: 0% at the top of the red zone, 99.99% at zero health,
  // held there while being fed on
  const target = state.dying
    ? INFECTION_FATAL
    : INFECTION_FATAL * THREE.MathUtils.clamp(1 - pct / HEARTBEAT_THRESHOLD, 0, 1);
  monitor.value += (target - monitor.value) * Math.min(1, dt * 6);
  monitor.pct.textContent = infectionText(monitor.value);
  monitor.el.classList.toggle('fatal', monitor.value >= 99);
  // Scroll the trace ~110 px/s
  const s = monitor.samples;
  const steps = Math.max(1, Math.round(dt * 110));
  for (let k = 0; k < steps; k++) {
    s.copyWithin(0, 1);
    s[s.length - 1] = nextSample(dt / steps);
  }
  const ctx = monitor.ctx, W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,70,55,0.18)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 18) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
  ctx.strokeStyle = '#ff4a3a';
  ctx.lineWidth = 1.6;
  ctx.shadowColor = 'rgba(255,40,30,0.9)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  for (let i = 0; i < W; i++) {
    const y = H / 2 - s[i] * (H / 2 - 3);
    if (i) ctx.lineTo(i, y); else ctx.moveTo(i, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// Zero health: overrun. The fall, the feeders, then the death screen.
function startDying() {
  state.firePressed = false;
  state.reloading = false;
  if (dom.reloadText) dom.reloadText.classList.add('hidden');
  if (playerVis.actions && playerVis.actions.die) {
    setPlayerAction('die');
    state.playerActionLock = Infinity;
  }
  if (playerVis.shootAction) playerVis.shootAction.stop();
  // The nearest zombies get places round the body, spread evenly
  const body = playerVis.group.position;
  const near = !FEEDING_ENABLED ? [] : state.zombies
    .filter((z) => z.alive && z.state !== 'downed' && z.mesh.position.distanceTo(body) < EAT_RADIUS)
    .sort((a, b) => a.mesh.position.distanceTo(body) - b.mesh.position.distanceTo(body))
    .slice(0, 5);
  const start = Math.random() * Math.PI * 2;
  near.forEach((z, i) => {
    const a = start + (i / near.length) * Math.PI * 2;
    z.feed = { spot: new THREE.Vector3(body.x + Math.sin(a) * 0.95, 0, body.z + Math.cos(a) * 0.95), k: 0, phase: Math.random() * 6 };
    z.mesh.rotation.order = 'YXZ'; // the hunch tips forward from wherever it faces
  });
  state.dying = { t: 0, eaters: near, camFrom: camera.position.clone(), caption: buildOverrunCaption() };
  sfx.hurt();
}

// What's happening, said on screen: OVERRUN, and the infection reading
function buildOverrunCaption() {
  if (!document.getElementById('overrun-style')) {
    const style = document.createElement('style');
    style.id = 'overrun-style';
    style.textContent = `
      #overrun-caption{position:fixed;left:0;right:0;top:30%;text-align:center;z-index:21;pointer-events:none;
        opacity:0;transform:scale(1.08);transition:opacity .6s,transform 1.2s;padding:0 16px;}
      #overrun-caption.on{opacity:1;transform:none;}
      #overrun-caption h2{margin:0;font-size:clamp(40px,8vw,88px);letter-spacing:.18em;color:#ff3b2b;
        text-shadow:0 0 24px rgba(255,30,20,.8),0 3px 0 #2a0000;}
      #overrun-caption p{margin:8px 0 0;font-size:clamp(14px,1.8vw,19px);letter-spacing:.06em;color:#ffd6cf;
        text-shadow:0 1px 8px rgba(0,0,0,.9);}
    `;
    document.head.appendChild(style);
  }
  const el = document.createElement('div');
  el.id = 'overrun-caption';
  el.innerHTML = '<h2>OVERRUN</h2><p></p>';
  document.body.appendChild(el);
  return el;
}

function updateDying(dt) {
  const d = state.dying;
  d.t += dt;
  const body = playerVis.group.position;
  // The player: the fall plays out and holds
  if (playerVis.mixer) playerVis.mixer.update(dt);
  if (playerVis.rigObj) groundClampRig(playerVis.rigObj, playerVis.footBoneL, playerVis.footBoneR, dt, 10, playerVis.ankleToSole);
  syncHandGun();
  // Feeders walk in to their places, then crouch and hunch over the body,
  // heads and shoulders jerking as they tear at it
  for (const z of d.eaters) {
    if (!z.alive) continue;
    const f = z.feed;
    const to = f.spot.clone().sub(z.mesh.position).setY(0);
    const face = Math.atan2(body.x - z.mesh.position.x, body.z - z.mesh.position.z);
    if (to.length() > 0.12 && f.k === 0) {
      z.mesh.position.addScaledVector(to.normalize(), Math.min(to.length(), Math.max(2.5, z.speed * 0.7) * dt));
      z.mesh.rotation.y = lerpAngle(z.mesh.rotation.y, face, dt * 8);
      if (z.mixer) z.mixer.update(dt);
    } else {
      f.k = Math.min(1, f.k + dt * 2.2);
      const t = d.t * 1 + f.phase;
      const jerk = Math.max(0, Math.sin(t * 7.3)) * 0.12 + Math.sin(t * 13.1) * 0.03;
      z.mesh.rotation.y = lerpAngle(z.mesh.rotation.y, face + Math.sin(t * 1.7) * 0.15, dt * 4);
      z.mesh.rotation.x = f.k * (0.62 + jerk);
      z.mesh.position.y = -f.k * (0.42 + jerk * 0.6);
      if (z.mixer) { z.mixer.timeScale = 0.35; z.mixer.update(dt); }
    }
  }
  // Everyone else keeps coming
  for (const z of state.zombies) if (!z.feed) z.update(dt, body);
  // The camera pulls back and up, circling slowly, looking down at them
  const ang = Math.atan2(d.camFrom.x - body.x, d.camFrom.z - body.z) + d.t * 0.18;
  const k = Math.min(1, d.t / 1.6);
  const goal = new THREE.Vector3(body.x + Math.sin(ang) * 4.2, 3.4, body.z + Math.cos(ang) * 4.2);
  camera.position.lerpVectors(d.camFrom, goal, k * k * (3 - 2 * k));
  camera.lookAt(body.x, 0.5, body.z);
  updateInfectionMonitor(dt);
  updateLowHealthFX(dt);
  if (d.t > 0.6) {
    d.caption.classList.add('on');
    d.caption.querySelector('p').textContent = `Infection ${infectionText(monitor.value)} — they've got you.`;
  }
  if (d.t >= DYING_SECONDS) {
    d.caption.remove();
    state.deathInfection = infectionText(INFECTION_FATAL);
    state.dying = null;
    doDeath();
  }
}


/* ---------------------------------------------------------------------
   VEHICLE ENTER / EXIT
--------------------------------------------------------------------- */
export function toggleVehicle() {
  if (state.narrativeBlocked) return;
  if (state.isDead || state.skipCar || !carVis) return;
  if (!state.inVehicle) {
    const dist = playerVis.group.position.distanceTo(carVis.group.position);
    if (dist < 3.4) {
      state.inVehicle = true;
      playerVis.group.visible = false;
      if (playerVis.gunOnHand) playerVis.gunPivot.visible = false;
      playerBody.position.set(-1000, -50, -1000);
      playerBody.velocity.set(0, 0, 0);
      const eu = new THREE.Euler().setFromQuaternion(carVis.group.quaternion, 'YXZ');
      state.yaw = eu.y + Math.PI;
      state.pitch = -0.12;
      dom.speedo.classList.remove('hidden');
    }
  } else {
    state.inVehicle = false;
    state.carSteer = 0;
    vehicle.setSteeringValue(0, 0); vehicle.setSteeringValue(0, 1);
    vehicle.applyEngineForce(0, 2); vehicle.applyEngineForce(0, 3);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(carVis.group.quaternion);
    let exitPos = carVis.group.position.clone().addScaledVector(right, 2.3);
    exitPos.x = THREE.MathUtils.clamp(exitPos.x, -STREET_HALF_W + 0.6, STREET_HALF_W - 0.6);
    playerBody.position.set(exitPos.x, 1.2, exitPos.z);
    playerBody.velocity.set(0, 0, 0);
    state.yaw = Math.atan2(right.x, right.z) + Math.PI / 2;
    dom.speedo.classList.add('hidden');
    sfx.setEngine(0, false);
  }
}

export function updateInteractionPrompt() {
  if (state.isDead || state.skipCar || !carVis) { dom.prompt.classList.add('hidden'); return; }
  if (!state.inVehicle) {
    const dist = playerVis.group.position.distanceTo(carVis.group.position);
    if (dist < 3.4) {
      dom.prompt.classList.remove('hidden');
      dom.promptText.textContent = 'Enter Vehicle';
    } else {
      dom.prompt.classList.add('hidden');
    }
  } else {
    dom.prompt.classList.remove('hidden');
    dom.promptText.textContent = 'Exit Vehicle';
  }
}

/* ---------------------------------------------------------------------
   CAMERA
--------------------------------------------------------------------- */
const camRayHelper = new THREE.Raycaster();
const cameraCandidates = new RayCandidates();
const EYE_HEIGHT = 1.62; // above playerVis.group's origin, which sits at the feet
const eyePosition = new THREE.Vector3();

export function updateCameraOnFoot(dt) {
  // Recoil recovers over time instead of permanently accumulating.
  state.recoilPitch = Math.max(0, state.recoilPitch - dt * 0.5);
  const viewPitch = THREE.MathUtils.clamp(state.pitch + state.recoilPitch, -1.05, 0.85);
  // Sprint FOV kick — a widened field of view is the classic "you are now
  // running" cue, works even if the speed increase itself is hard to judge.
  const targetFov = state.isSprinting ? 74 : 62;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, dt * 8));
    camera.updateProjectionMatrix();
  }
  if (state.firstPerson) {
    eyePosition.copy(playerVis.group.position);
    eyePosition.y += EYE_HEIGHT - (state.crouching ? 0.42 : 0);
    camera.position.copy(eyePosition);
    const horizSpeed = Math.hypot(playerBody.velocity.x, playerBody.velocity.z);
    if (horizSpeed > 0.4) state.bobPhase += dt * horizSpeed * 1.8;
    const bobAmt = Math.min(horizSpeed, 6.5) * 0.007;
    camera.position.y += Math.sin(state.bobPhase) * bobAmt;
    camera.position.x += Math.cos(state.bobPhase * 0.5) * bobAmt * 0.6;
    if (state.shake > 0.002) {
      camera.position.x += (Math.random() - 0.5) * state.shake;
      camera.position.y += (Math.random() - 0.5) * state.shake;
    }
    camera.rotation.order = 'YXZ';
    camera.rotation.set(viewPitch, state.yaw, 0);
    if (state.meleeTimer > 0) viewmodelGun.rotation.x = -Math.sin(state.meleeTimer * 14) * 0.9;
    else viewmodelGun.rotation.x = 0;
    if (knifeViewModel) knifeViewModel.rotation.x = viewmodelGun.rotation.x;
    return;
  }
  playerVis.group.rotation.y = lerpAngle(
    playerVis.group.rotation.y,
    state.playerMoving ? state.playerFacingAngle : state.yaw,
    dt * 10
  );
  const origin = playerVis.group.position.clone().add(new THREE.Vector3(0, 1.52 - (state.crouching ? 0.42 : 0), 0));
  const fwd = forwardFromYaw(state.yaw);
  const right = rightFromYaw(state.yaw);
  const cp = Math.cos(viewPitch);
  const sp = Math.sin(viewPitch);
  const dist = 3.55;
  const desired = origin.clone()
    .addScaledVector(fwd, -dist * cp)
    .addScaledVector(right, 0.62)
    .add(new THREE.Vector3(0, 0.35 + sp * 1.6, 0));
  const lookTarget = origin.clone()
    .addScaledVector(fwd, 10 * cp)
    .addScaledVector(right, 0.15)
    .add(new THREE.Vector3(0, sp * 10, 0));
  camRayHelper.set(origin, desired.clone().sub(origin).normalize());
  camRayHelper.far = origin.distanceTo(desired);
  const hits = camRayHelper.intersectObjects(cameraCandidates.query(state.occluders, camRayHelper.ray, camRayHelper.far), false);
  let finalPos = desired;
  if (hits.length && hits[0].distance > 0.9) {
    finalPos = origin.clone().add(desired.clone().sub(origin).normalize().multiplyScalar(Math.max(1.15, hits[0].distance * 0.88)));
  }
  camera.position.lerp(finalPos, 0.28);
  if (state.shake > 0.002) {
    camera.position.x += (Math.random() - 0.5) * state.shake;
    camera.position.y += (Math.random() - 0.5) * state.shake;
  }
  camera.lookAt(lookTarget);
  camera.rotation.order = 'XYZ'; // lookAt() sets the quaternion directly; restore default order after
  if (state.meleeTimer > 0) {
    playerVis.gunPivot.rotation.x = -Math.sin(state.meleeTimer * 14) * 0.9;
  }
}
export function updateCameraInCar() {
  const carPos = carVis.group.position;
  const fwd = forwardFromYaw(state.yaw);
  const right = rightFromYaw(state.yaw);
  const cp = Math.cos(state.pitch * 0.85);
  const sp = Math.sin(state.pitch * 0.85);
  const desired = carPos.clone()
    .addScaledVector(fwd, -7.2 * cp)
    .addScaledVector(right, 0.2)
    .add(new THREE.Vector3(0, 2.4 + sp * 2.2, 0));
  camera.position.lerp(desired, 0.12);
  if (state.shake > 0.002) {
    camera.position.x += (Math.random() - 0.5) * state.shake * 0.6;
    camera.position.y += (Math.random() - 0.5) * state.shake * 0.6;
  }
  camera.lookAt(carPos.clone().add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(fwd, 6));
}

/* ---------------------------------------------------------------------
   MOVEMENT + VEHICLE CONTROLS
--------------------------------------------------------------------- */
// Picks which Shooter_Pack (or baked-in fallback) action name to play
// for the current input, preferring the most specific clip that's
// actually loaded and falling back a step at a time so a slow-loading
// or missing Shooter_Pack file never leaves the player animation-less.
function pickLocomotionAction(forwardInput, strafeInput, sprinting, moving) {
  const has = (k) => playerVis.actions && playerVis.actions[k];
  if (state.crouching && (has('crouchWalk') || has('crouchIdle'))) return moving && has('crouchWalk') ? 'crouchWalk' : (has('crouchIdle') ? 'crouchIdle' : 'idle');
  if (!moving) return state.currentWeapon === 'knife' && has('knifeIdle') ? 'knifeIdle' : 'idle';
  if (forwardInput > 0) {
    if (sprinting && has('sprint')) return 'sprint';
    return has('walk') ? 'walk' : 'idle';
  }
  if (forwardInput < 0) {
    if (sprinting && has('runBack')) return 'runBack';
    if (has('walkBack')) return 'walkBack';
    return has('walk') ? 'walk' : 'idle'; // no backward clip loaded yet — still communicates motion
  }
  if (strafeInput > 0) return has('strafeR') ? 'strafeR' : (has('walk') ? 'walk' : 'idle');
  if (strafeInput < 0) return has('strafeL') ? 'strafeL' : (has('walk') ? 'walk' : 'idle');
  return 'idle';
}

const groundRayFrom = new CANNON.Vec3();
const groundRayTo = new CANNON.Vec3();
const groundRayResult = new CANNON.RaycastResult();
const groundRayOptions = { skipBackfaces: true, collisionFilterMask: -1 };
let movementHUDTimer = 0;
export function updatePlayerMovement(dt) {
  const forwardInput = (state.keys['KeyW'] ? 1 : 0) - (state.keys['KeyS'] ? 1 : 0);
  const strafeInput = (state.keys['KeyD'] ? 1 : 0) - (state.keys['KeyA'] ? 1 : 0);
  // Crouch: no collider change, just a slower, quieter stance — camera
  // drops to match in updateCameraOnFoot. Can't sprint while crouched.
  state.crouching = !!(state.keys['ControlLeft'] || state.keys['ControlRight'] || state.keys['KeyC']);
  updateLocomotion(state, dt, forwardInput);
  const sprinting = state.isSprinting;
  const speed = state.currentSpeed;
  const fwd = forwardFromYaw(state.yaw);
  const right = rightFromYaw(state.yaw);
  const move = new THREE.Vector3()
    .addScaledVector(fwd, forwardInput)
    .addScaledVector(right, strafeInput);
  // Facing direction while moving — previously the body's rotation was
  // tied directly to camera yaw regardless of movement, so strafing or
  // walking backward still showed the character facing straight ahead
  // instead of the direction they were actually headed. atan2(x,z)
  // matches the same forward/right convention used everywhere else
  // (forwardFromYaw, zombie facing, etc.), so a movement vector of pure
  // "strafe right" correctly resolves to facing right, "backward" to
  // facing back, and diagonals to the blended angle in between. Read
  // before normalizing below — atan2 only cares about direction, not
  // magnitude, so this doesn't need its own separate vector.
  state.playerMoving = forwardInput !== 0 || strafeInput !== 0;
  // Directional clips strafe/backpedal while the body keeps facing the aim.
  state.playerFacingAngle = state.yaw;
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
  // Direct assignment, not eased/lerped toward the previous velocity — a
  // self-referential lerp can get stuck at NaN forever if the body's
  // velocity is ever NaN even once; direct assignment can't compound that.
  playerBody.velocity.x = move.x;
  playerBody.velocity.z = move.z;
  if (!Number.isFinite(playerBody.velocity.x) || !Number.isFinite(playerBody.velocity.y) || !Number.isFinite(playerBody.velocity.z)) {
    playerBody.velocity.set(0, 0, 0);
  }
  if (!Number.isFinite(playerBody.position.x) || !Number.isFinite(playerBody.position.y) || !Number.isFinite(playerBody.position.z)) {
    playerBody.position.set(1.5, playerHeight / 2 + 0.25, 30);
    playerBody.velocity.set(0, 0, 0);
  }
  groundRayFrom.copy(playerBody.position);
  groundRayTo.set(playerBody.position.x, playerBody.position.y - playerHeight / 2 - 0.18, playerBody.position.z);
  groundRayResult.reset();
  world.raycastClosest(groundRayFrom, groundRayTo, groundRayOptions, groundRayResult);
  const grounded = playerBody.velocity.y <= 0.5 && (groundRayResult.hasHit || playerBody.position.y < playerHeight / 2 + 0.12);
  let jumping = !grounded;
  if (state.keys['Space'] && grounded && playerBody.velocity.y < 1) {
    playerBody.velocity.y = 5.6;
    jumping = true;
    // If the player is moving backward when they jump, use the
    // Shooter_Pack's backward jump clip instead of the forward one, when
    // it's loaded; otherwise fall back to the regular jump.
    const jumpKey = (forwardInput < 0 && playerVis.actions && playerVis.actions.jumpBack) ? 'jumpBack' : 'jump';
    if (playerVis.actions && playerVis.actions[jumpKey]) {
      const flightTime = 2 * 5.6 / Math.abs(world.gravity.y);
      const jumpAction = playerVis.actions[jumpKey];
      jumpAction.setEffectiveTimeScale(jumpAction.getClip().duration / flightTime);
      setPlayerAction(jumpKey, 0.1, true);
      state.playerActionLock = flightTime;
    }
  }
  movementHUDTimer -= dt;
  const refreshMovementHUD = movementHUDTimer <= 0;
  if (refreshMovementHUD) {
    movementHUDTimer = 0.1;
    dom.staminaFill.style.width = state.playerStamina + '%';
    dom.staminaFill.style.opacity = state.staminaExhausted ? '0.45' : '1';
    dom.staminaStatus?.classList.toggle('visible', state.staminaExhausted);
    dom.staminaStatus?.setAttribute('aria-hidden', String(!state.staminaExhausted));
  }
  playerVis.group.position.set(playerBody.position.x, playerBody.position.y - playerHeight / 2, playerBody.position.z);
  const moving = move.lengthSq() > 0.01;
  if (playerVis.rigged && playerVis.mixer && playerVis.actions) {
    if (state.playerActionLock > 0) {
      state.playerActionLock -= dt;
    } else {
      setPlayerAction(pickLocomotionAction(forwardInput, strafeInput, sprinting, moving));
    }
    playerVis.mixer.update(dt);
    if (!jumping) {
      // Correct relative to the physics feet, including raised platforms.
      groundClampRig(playerVis.rigObj, playerVis.footBoneL, playerVis.footBoneR, dt, 10, playerVis.ankleToSole, playerVis.group.position.y);
      playerVis.groundOffset = playerVis.rigObj.position.y;
    } else {
      // Preserve the last grounded offset so the mesh rises with its body.
      playerVis.rigObj.position.y = playerVis.groundOffset ?? playerVis.rigObj.position.y;
    }
    syncHandGun();
  } else if (moving) {
    state.walkCycle += dt * (sprinting ? 12 : 6);
    const amp = sprinting ? 0.78 : 0.5;
    const swing = Math.sin(state.walkCycle) * amp;
    playerVis.legL.rotation.x = swing; playerVis.legR.rotation.x = -swing;
    playerVis.armL.rotation.x = -swing * (sprinting ? 1.0 : 0.6);
    playerVis.armR.rotation.x = swing * (sprinting ? 1.0 : 0.6);
    playerVis.proceduralBody.rotation.x = THREE.MathUtils.lerp(
      playerVis.proceduralBody.rotation.x, sprinting ? 0.16 : 0, dt * 8
    );
  } else {
    playerVis.legL.rotation.x = THREE.MathUtils.lerp(playerVis.legL.rotation.x, 0, dt * 6);
    playerVis.legR.rotation.x = THREE.MathUtils.lerp(playerVis.legR.rotation.x, 0, dt * 6);
    playerVis.proceduralBody.rotation.x = THREE.MathUtils.lerp(playerVis.proceduralBody.rotation.x, 0, dt * 6);
  }
  if (moving && grounded) {
    state.footTimer -= dt;
    if (state.footTimer <= 0) { sfx.foot(); state.footTimer = sprinting ? 0.28 : (state.crouching ? 0.6 : 0.42); }
  }
  if (refreshMovementHUD && dom.debugReadout && document.body.classList.contains('debug')) {
    const rawShift = (state.keys['ShiftLeft'] ? 'L' : '') + (state.keys['ShiftRight'] ? 'R' : '') || 'none';
    dom.debugReadout.textContent =
      `Shift held: ${rawShift} | Sprinting: ${sprinting} | Exhausted: ${state.staminaExhausted} | Stamina: ${state.playerStamina.toFixed(0)}\n` +
      `Rigged model: ${playerVis.rigged} | Anim state: ${playerVis.currentActionName || 'n/a'}\n` +
      `Player height: ${state.playerCurrentHeight.toFixed(2)}m (zombies are ${ZOMBIE_TARGET_HEIGHT}m) [ / ] to adjust\n` +
      `Grip preset: ${state.gunGripIndex} (U to cycle) | Weapon: ${state.currentWeapon} | Coins: ${state.coins} | Fuel: ${state.carFuel != null ? state.carFuel.toFixed(0) : 'n/a'}`;
  }
  state.zombies.forEach((z) => {
    if (!z.alive) return;
    const dx = playerVis.group.position.x - z.mesh.position.x;
    const dz = playerVis.group.position.z - z.mesh.position.z;
    const d = Math.hypot(dx, dz);
    const SEP_RADIUS = 0.95;
    if (d < SEP_RADIUS) {
      let nx, nz;
      if (d > 0.001) { nx = dx / d; nz = dz / d; }
      else { const a = Math.random() * Math.PI * 2; nx = Math.cos(a); nz = Math.sin(a); }
      const n = SEP_RADIUS - d;
      z.mesh.position.x -= nx * n;
      z.mesh.position.z -= nz * n;
    }
  });
  if (playerBody.position.y < -20) {
    playerBody.position.set(1.5, 3, 30);
    playerBody.velocity.set(0, 0, 0);
  }
}

function chassisForward() {
  // Rotates the chassis's local NOSE direction (-Z, per the wheel setup —
  // front wheels sit at z=-1.55) into world space. Positive forwardSpeed
  // genuinely means "moving toward the nose."
  const q = chassisBody.quaternion;
  return new CANNON.Vec3(
    -2 * (q.x * q.z + q.w * q.y),
    -2 * (q.y * q.z - q.w * q.x),
    -(1 - 2 * (q.x * q.x + q.y * q.y))
  );
}
export function updateVehicleControls(dt) {
  const throttleInput = (state.keys['KeyW'] ? 1 : 0) - (state.keys['KeyS'] ? 1 : 0);
  const steerInput = (state.keys['KeyA'] ? 1 : 0) - (state.keys['KeyD'] ? 1 : 0);
  const speedKph = Math.abs(chassisBody.velocity.length()) * 3.6;
  const steerFalloff = THREE.MathUtils.clamp(1 - speedKph / 130, 0.32, 1);
  const targetSteer = steerInput * MAX_STEER * steerFalloff;
  state.carSteer = THREE.MathUtils.lerp(state.carSteer, targetSteer, dt * 6);
  vehicle.setSteeringValue(state.carSteer, FRONT_WHEELS[0]);
  vehicle.setSteeringValue(state.carSteer, FRONT_WHEELS[1]);
  // Out of fuel: no engine force at all — the truck coasts/brakes to a
  // stop like a real vehicle running dry.
  const hasFuel = state.carFuel > 0;
  const forwardSpeed = chassisBody.velocity.dot(chassisForward());
  const targetThrottle = (hasFuel && throttleInput > 0) ? 1 : (hasFuel && throttleInput < 0 ? -0.55 : 0);
  state.carThrottle = THREE.MathUtils.lerp(state.carThrottle, targetThrottle, dt * 4.5);
  const engineForce = state.carThrottle * MAX_ENGINE_FORCE;
  REAR_WHEELS.forEach((i) => vehicle.applyEngineForce(engineForce, i));
  FRONT_WHEELS.forEach((i) => vehicle.applyEngineForce(engineForce * 0.28, i));
  // Fuel drains only while actually under power (throttle applied and
  // moving), not just for sitting in the driver's seat.
  if (hasFuel && Math.abs(throttleInput) > 0 && Math.abs(forwardSpeed) > 0.3) {
    state.carFuel = Math.max(0, state.carFuel - dt * 1.6);
    updateFuelHUD();
    if (state.carFuel <= 0) pushKillFeed('Out of fuel — find a petrol powerup');
  }
  const handbrake = !!state.keys['Space'];
  for (let i = 0; i < 4; i++) {
    let b = 0;
    if (throttleInput === 0 || !hasFuel) b = MAX_BRAKE_FORCE * 0.4;
    if (throttleInput < 0 && forwardSpeed > 2) b = MAX_BRAKE_FORCE;
    if (handbrake && REAR_WHEELS.includes(i)) b = HANDBRAKE_FORCE;
    vehicle.setBrake(b, i);
  }
  carVis.group.position.copy(chassisBody.position);
  carVis.group.quaternion.copy(chassisBody.quaternion);
  carVis.group.position.y -= 0.08;
  for (let i = 0; i < 4; i++) {
    vehicle.updateWheelTransform(i);
    const wt = vehicle.wheelInfos[i].worldTransform;
    carVis.wheelMeshes[i].position.copy(wt.position);
    carVis.wheelMeshes[i].quaternion.copy(wt.quaternion);
    if (carVis.wheelBones && carVis.wheelBones[i]) {
      carVis.wheelBones[i].rotation.x += vehicle.wheelInfos[i].deltaRotation || 0;
    }
  }
  const kph = Math.abs(forwardSpeed) * 3.6;
  dom.kph.textContent = Math.round(kph);
  sfx.setEngine(Math.abs(forwardSpeed), true);
  if (speedKph > 40) state.shake = Math.max(state.shake, 0.015);
  if (chassisBody.position.y < -20) {
    chassisBody.position.set(carSpawn.x, carSpawn.y + 1, carSpawn.z);
    chassisBody.velocity.set(0, 0, 0);
    chassisBody.angularVelocity.set(0, 0, 0);
    chassisBody.quaternion.set(0, 0, 0, 1);
  }
}

/* ---------------------------------------------------------------------
   INPUT WIRING
--------------------------------------------------------------------- */
function initInputHandlers() {
  const clearInput = () => { state.keys = {}; state.firePressed = false; state.isSprinting = false; };
  window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });

  window.addEventListener('keydown', (e) => {
    if (state.narrativeBlocked) return;
    state.keys[e.code] = true;
    // Live player-scale tuning — dropped during the Actions.js/characters.js
    // split (it used to live inline in the old game.js keydown handler);
    // adjustPlayerScale() itself survived the split fine, it just had no
    // caller left. Re-wired here so [ / ] work again as the HUD hint claims.
    // e.repeat guard: holding the key down (even briefly) would otherwise
    // fire the browser's key-repeat dozens of times per second, each one
    // compounding another 5% shrink/grow — more than enough to silently
    // drift the player down to a fraction of their intended size (this is
    // almost certainly what happened to produce a reported height of
    // 0.78m instead of ~1.8m). One press now means exactly one 5% step.
    // Dev-only tools live behind debug mode (F3, or ?debug in the URL) so
    // markers never see a debug overlay or resize the player by accident.
    if (e.code === 'F3' && !e.repeat) { e.preventDefault(); document.body.classList.toggle('debug'); }
    const debug = document.body.classList.contains('debug');
    if (debug && e.code === 'BracketLeft' && !e.repeat) adjustPlayerScale(0.95);
    if (debug && e.code === 'BracketRight' && !e.repeat) adjustPlayerScale(1.05);
  });
  window.addEventListener('keyup', (e) => { state.keys[e.code] = false; });
  dom.canvas.addEventListener('mousemove', (e) => {
    if (!state.pointerLocked || state.narrativeBlocked) return;
    state.yaw -= e.movementX * 0.002;
    state.pitch -= e.movementY * 0.002;
    state.pitch = THREE.MathUtils.clamp(state.pitch, -1.05, 0.72);
  });
  dom.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    const wasLocked = state.pointerLocked;
    state.pointerLocked = document.pointerLockElement === dom.canvas;
    if (!state.pointerLocked) clearInput();
    // Esc while the mouse is captured never reaches keydown — the browser
    // spends it releasing the pointer. So losing the lock mid-run IS the
    // Esc press: pause, the way players expect. Not when the game itself
    // let go (pausing already, end screens, a menu panel opening).
    if (wasLocked && !state.pointerLocked && !state.paused && !state.isDead && !state.narrativeBlocked && !state.cinematic
      && !document.querySelector('.end-screen:not(.hidden), .panel-screen:not(.hidden)')) {
      togglePause();
    }
  });
  dom.canvas.addEventListener('click', () => {
    const gameActive = !dom.hud.classList.contains('hidden') && dom.death.classList.contains('hidden') && dom.win.classList.contains('hidden');
    if (gameActive && !state.narrativeBlocked && !state.pointerLocked) {
      sfx.init();
      // A retry relaunches without a fresh click, so the audio context may
      // have been created suspended — this click is the gesture to wake it.
      if (sfx.ctx && sfx.ctx.state === 'suspended') sfx.ctx.resume();
      requestPointerLockSafe();
    }
  });
  window.addEventListener('mousedown', (e) => {
    if (!state.pointerLocked || state.narrativeBlocked || state.dying) return;
    if (e.button === 0) { state.firePressed = true; tryShoot(); }
    if (e.button === 2) tryMelee();
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firePressed = false;
  });
  window.addEventListener('keydown', (e) => {
    if (state.narrativeBlocked) return;
    if (state.dying && e.code !== 'Tab' && e.code !== 'KeyP' && e.code !== 'Escape') return;
    if (e.code === 'KeyR') startReload();
    if (e.code === 'KeyF') toggleVehicle();
    if (e.code === 'KeyV' && !e.repeat && !state.inVehicle && !state.paused) state.firstPerson = !state.firstPerson;
    if (e.code === 'KeyQ' && !e.repeat) switchWeapon(nextWeapon(state.currentWeapon,hasAnyAmmo()));
    if (!e.repeat && levelWeaponIds().length) {
      if(e.code==='Digit1')switchWeapon('gun');
      if(e.code==='Digit2')switchWeapon('knife');
      if(e.code==='Digit3')switchWeapon(levelWeaponIds()[0]);
    }
    // Level-owned controls; held keys must not repeat purchases or pulses.
    if (!e.repeat && e.code === 'KeyE' && levelKeyHooks.KeyE) levelKeyHooks.KeyE();
    if (!e.repeat && e.code === 'KeyG' && levelKeyHooks.KeyG) levelKeyHooks.KeyG();
    if (!e.repeat && e.code === 'KeyX' && levelKeyHooks.KeyX) levelKeyHooks.KeyX();
    if (!e.repeat && e.code === 'KeyB' && levelKeyHooks.KeyB) levelKeyHooks.KeyB();
    // Tab, P, or Esc (Esc only arrives here once the mouse is free — e.g.
    // to resume from the pause screen; see pointerlockchange above)
    if (e.code === 'Tab' || e.code === 'KeyP' || e.code === 'Escape') {
      // Esc over an open Leaderboard/Credits panel belongs to the panel
      if (e.code === 'Escape' && document.querySelector('.panel-screen:not(.hidden)')) return;
      e.preventDefault(); // Tab normally shifts browser focus — stop that
      if (!e.repeat) togglePause();
    }
  });
  if (dom.pauseBtn) dom.pauseBtn.addEventListener('click', () => togglePause());
  if (dom.resumeBtn) dom.resumeBtn.addEventListener('click', () => togglePause());
  // Quit to the title screen: a fresh page load is the clean teardown (the
  // level owns a renderer, physics world and timers). Asks twice so a
  // stray click doesn't throw away a run.
  // Restart resets the same level in place (retryLevel -> restartLevel),
  // with the same ask-twice guard.
  armTwoClick(document.getElementById('pause-menu-btn'), 'Quit this run? Click again', () => location.reload());
  armTwoClick(document.getElementById('pause-restart-btn'), 'Restart this level? Click again', retryLevel);
}

function armTwoClick(btn, confirmText, action) {
  if (!btn) return;
  const label = btn.textContent;
  let armed = null;
  btn.addEventListener('click', () => {
    if (armed) { action(); return; }
    btn.textContent = confirmText;
    btn.classList.add('armed');
    armed = setTimeout(() => {
      armed = null;
      btn.textContent = label;
      btn.classList.remove('armed');
    }, 3000);
  });
}

/* ---------------------------------------------------------------------
   LEVEL BOOTSTRAP — asset loading + world population, input wiring, and
   the main render/physics loop. Called once by each Level file. Levels
   are identical for now; `levelConfig` exists so Level1/2/3 have a place
   to diverge later without touching this shared logic.
--------------------------------------------------------------------- */
let missionTracker = null;
let streetAtmosphere = null;
let initialFrameReady = false;

export function bootLevel(levelConfig = {}) {
  // Day/Night was picked on the mode-select screen (main.js), right after
  // the level itself — apply it before anything else so lighting, fog,
  // mist tint, rain visibility and puddles are all correct from frame one.
  applyTimeOfDay(levelConfig.mode);
  state.levelId = levelConfig.id || 1;
  startDayCycle(); // the campaign clock: picks the Day/Night timeline
  state.runTime = 0;
  state.runReported = false;

  // The intro screen and level-select screen (main.js) already ran before
  // this function was even called, so there's no further click to gate
  // gameplay-start behind — as soon as assets are ready, jump straight
  // into the HUD/game. Registered up front, before any of the loaders
  // below fire, in case something somehow resolved synchronously.
  onAssetsReady(async () => {
    sfx.init();
    if (sfx.ctx && sfx.ctx.state === 'suspended') sfx.ctx.resume();
    // Pointer lock requires a direct user gesture in most browsers, and
    // by the time assets finish loading that gesture (the level-select
    // click) is long stale, so this attempt may be silently ignored —
    // that's fine, the canvas click handler wired below is the fallback
    // the player uses to lock in.
    requestPointerLockSafe();
    if (!state.skipCar) spawnDepotGuards();
    updateObjectiveHUD();
    updateWeaponHUD();
    updateCoinHUD();
    if (!state.skipCar) updateFuelHUD();
    // Prepare the actual loaded rigs and lighting while the loading
    // screen is still covering the canvas, then draw the first world frame.
    // Level 2 already has instanced scorch/oil/contact dressing.
    if (state.levelId !== 2) addContactShading(scene, state.obstacles);
    updateWeatherFX(0);
    const releasePrepared = [];
    try {
      for (const prepare of levelPreparations) {
        const release = await prepare(renderer,scene,camera);
        if (typeof release === 'function') releasePrepared.push(release);
      }
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
      else renderer.compile(scene, camera);
      await warmViewmodels(renderer);
      if (renderer.getContext().isContextLost()) throw new Error('WebGL context lost during startup');
      // Upload the world and temporary preparation rigs in one hidden frame.
      renderer.render(scene, camera);
    } finally {
      for (const release of releasePrepared.reverse()) release();
    }
    initialFrameReady = true;
  });

  // World population — mirrors the exact order the original monolithic
  // game.js ran this in at module load time.
  // Everything built from here to the trash cans is fixed scenery — a
  // level may merge it into a few big meshes (mergeStatic.js)
  const sceneryStart = scene.children.length;
  loadWorldBounds();
  loadStreetSurface();
  const { depotYard } = loadBuildings();
  loadObstacles();
  loadTrashCans();
  markStaticSince(scene, sceneryStart);
  if (state.levelId !== 2) console.info('[scenery]', mergeStaticScenery(scene));
  if (state.levelId !== 2) streetAtmosphere = createStreetAtmosphere(scene);
  if (!state.skipCar) loadCars();
  loadMainCharacter();
  loadZombies();
  loadBarrels();
  initShield();
  if (!state.skipDepot) missionTracker = createMissionTracker(depotYard);

  initInputHandlers();
  buildInfectionMonitor();

  // Initial HUD paint, matching the bottom of the original game.js.
  updateAmmoHUD();
  updateObjectiveHUD();
  updateWeaponHUD();
  updateCoinHUD();
  if (!state.skipCar) updateFuelHUD();

  addLight(scene, muzzleLight);
  startAnimationLoop();
  // A level whose mission can't be put back in place (restartInPlace:
  // false) leaves no handler, so Retry reloads the page instead.
  if (levelConfig.restartInPlace !== false) setRestartHandler(restartLevel);

  if (levelConfig.name) pushKillFeed(`${levelConfig.name} loaded`);
}

/* ---------------------------------------------------------------------
   RESTART IN PLACE — the world (scene, physics, buildings, loaded
   models) is built once per page and stays; everything a run changes is
   put back: run state, the player, every infected, drops, barrels, the
   mission, the HUD, then each level's own reset hook. The level intro
   doesn't replay — a restart drops straight back into play.
--------------------------------------------------------------------- */
export function restartLevel() {
  document.getElementById('overrun-caption')?.remove();
  resetRunState();
  resetCharacters();
  resetPowerUps();
  if (missionTracker) missionTracker.reset();
  state.activeSparks.forEach((s) => scene.remove(s));
  state.activeSparks.length = 0;
  state.activeTracers.forEach((tr) => { scene.remove(tr); tr.geometry.dispose(); tr.material.dispose(); });
  state.activeTracers.length = 0;
  clearImpactFX();
  stepAccumulator = 0;
  clock.getDelta(); // don't let the time spent on the end screen land in one frame

  if (dom.pauseOverlay) dom.pauseOverlay.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  dom.reloadText.classList.add('hidden');
  dom.prompt.classList.add('hidden');
  if (dom.speedo) dom.speedo.classList.add('hidden');
  dom.healthFill.style.width = '100%';
  if (dom.bloodVig) dom.bloodVig.style.opacity = '0';
  if (dom.criticalPulse) dom.criticalPulse.classList.remove('active');
  if (monitor.el) {
    monitor.value = 0;
    monitor.shown = false;
    monitor.el.classList.remove('on', 'fatal');
  }
  setWeaponVisualsVisible();

  if (!state.skipCar) spawnDepotGuards();
  for (const reset of levelResets) reset();

  updateAmmoHUD();
  updateObjectiveHUD();
  updateWeaponHUD();
  updateCoinHUD();
  if (!state.skipCar) updateFuelHUD();
  sfx.setEngine(0, false);
  dom.canvas.requestPointerLock()?.catch(() => {});
  pushKillFeed('Level restarted');
}

const clock = new THREE.Clock();
let stepAccumulator = 0;

function startAnimationLoop() {
  function animate() {
    if (state.loadFailed) return;
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!initialFrameReady) return;
    try {
    if (muzzleFlashTime > 0) {
      muzzleFlashTime = Math.max(0, muzzleFlashTime - dt);
      if (muzzleFlashTime === 0) muzzleLight.intensity = 0;
    }
    if (!state.narrativeBlocked) {
    state.shake = Math.max(0, state.shake - dt * 1.8);
    state.meleeTimer = Math.max(0, state.meleeTimer - dt);
    state.hurtGrace = Math.max(0, state.hurtGrace - dt);
    }
    sky.position.copy(camera.position);
    updateWeatherFX(dt);
    updateDayCycle(dt);
    streetAtmosphere?.update(dt, state, sfx, camera);
    // state.cinematic: a level's intro owns the camera (Level2Intro.js)
    if (state.dying && !state.paused && !state.narrativeBlocked) {
      updateDying(dt);
    } else if (!state.isDead && !state.paused && !state.cinematic && !state.narrativeBlocked && dom.hud && !dom.hud.classList.contains('hidden')) {
      state.runTime += dt;
      stepAccumulator=stepPlayerPhysics(world,playerBody,stepAccumulator,dt,state.inVehicle);
      if (!state.skipCar) checkVehicleRollover(dt);
      if (state.fireCooldown > 0) state.fireCooldown -= dt;
      if (state.firePressed && !state.inVehicle && state.currentWeapon === 'gun') tryShoot();
      if (state.reloading) {
        state.reloadTimer -= dt;
        if (state.reloadTimer <= 0) {
          const need = MAG_SIZE - state.ammoMag;
          const take = Math.min(need, state.ammoReserve);
          state.ammoMag += take; state.ammoReserve -= take;
          state.reloading = false;
          dom.reloadText.classList.add('hidden');
          updateAmmoHUD();
        }
      }
      if (state.inVehicle) {
        updateVehicleControls(dt);
        updateCameraInCar();
        playerVis.group.visible = false;
        viewmodelGun.visible = false;
        if (knifeViewModel) knifeViewModel.visible = false;
        if (playerVis.gunOnHand) playerVis.gunPivot.visible = false;
 
 
 
 
      } else {
        updatePlayerMovement(dt);
        updateCameraOnFoot(dt);
        playerVis.group.visible = !state.firstPerson;
        viewmodelGun.visible = state.firstPerson && state.currentWeapon === 'gun';
        if (knifeViewModel) knifeViewModel.visible = state.firstPerson && state.currentWeapon === 'knife';
        if (playerVis.gunOnHand) playerVis.gunPivot.visible = !state.firstPerson;
        sfx.setEngine(0, false);
      }
      const activePos = state.inVehicle ? carVis.group.position : playerVis.group.position;
      for (const tick of levelPreTicks) tick(dt);
      updateZombies(dt, activePos);
      updateLowHealthFX(dt);
      updateInfectionMonitor(dt);
      updateExplosions(dt);
      updateShield(dt);
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) { state.spawnTimer = ZOMBIE_SPAWN_INTERVAL / state.zombieCountMul; spawnZombie(); }
      updateImpactFX(dt);
      for (let i = state.activeSparks.length - 1; i >= 0; i--) {
        const s = state.activeSparks[i];
        s.userData.vel.y -= 9 * dt;
        s.position.addScaledVector(s.userData.vel, dt);
        s.userData.life -= dt;
        s.material.opacity = Math.max(0, s.userData.life / (s.userData.maxLife || 0.4));
        if (s.userData.life <= 0) { scene.remove(s); s.material.dispose(); state.activeSparks.splice(i, 1); }
      }
      for (let i = state.activeTracers.length - 1; i >= 0; i--) {
        const tr = state.activeTracers[i];
        tr.userData.life -= dt;
        tr.material.opacity = Math.max(0, tr.userData.life / tr.userData.maxLife) * 0.95;
        if (tr.userData.life <= 0) { scene.remove(tr); tr.geometry.dispose(); tr.material.dispose(); state.activeTracers.splice(i, 1); }
      }
      state.smokeGroups.forEach((group) => {
        group.children.forEach((sp) => {
          sp.position.y += sp.userData.speed * dt * 0.32;
          sp.material.rotation += dt * 0.12;
          if (sp.position.y - sp.userData.baseY > 5) sp.position.y = sp.userData.baseY;
        });
      });
      updateExtractRing(dt);
      updatePickups(dt, activePos);
      updatePowerups(dt, activePos, CAR_MAX_FUEL);
      updateCoins(dt, activePos);
      updateInteractionPrompt();
      if (missionTracker) missionTracker.checkDepotObjective(activePos);
      updateCompass(activePos, forwardFromYaw(state.yaw));
      checkExtraction(activePos, doWin);
      drawRadar(activePos, state.inVehicle ? new THREE.Euler().setFromQuaternion(carVis.group.quaternion, 'YXZ').y : state.yaw);
    }

    // Per-level ticks (Level 2: girl NPC, purchases, mission logic).
    // Deliberately OUTSIDE the gameplay gate above — a level's lose
    // cinematic must keep animating after state.isDead freezes the gated
    // gameplay code. Each tick guards itself on paused/dead as needed.
    for (const tick of levelTicks) tick(dt);

    renderer.render(scene, camera);
    renderViewmodels(renderer);
    } catch (error) {
      showRenderFailure(error);
    }
  }
  animate();
}
