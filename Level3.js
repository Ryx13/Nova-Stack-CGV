// Level3.js — LEVEL 3 "THE BROADCAST TOWER"
//
// Hybrid of the two ideas the team put on the table: teammate's "3
// buildings, each with a switch, then a boss" gameplay loop, delivering
// the narrative payoff — the collected concoction dispersed as a wave
// that reverts nearby infected to human — that closes out the story
// begun in Level 1's storyline and Level 2's chase for the antidote.
//
// Design brief, layout notes, and a running catalog of what's built vs.
// still open live in Level3.md — mirrors how level2.md documents
// Level 2. This file is everything Level 3 owns, in the same order
// Level2.js uses: config + startLevel(), scene dressing (tower + 3
// switch buildings), the switch/objective logic, the boss, the
// dispersion cinematic, and the custom end screen.
//
// IMPORTANT — read before moving building positions around:
// Zombie AI (characters.js's clampZombieX) only allows infected to
// wander off the main street's ~10m-wide corridor in two existing
// pockets: near DEPOT_POS and near WEST_POCKET_Z. Everywhere else,
// zombies get clamped back onto the corridor every frame — including
// the boss, which is a real Zombie instance under the hood (see below).
// Rather than edit that shared function (used by every level), this
// design keeps the tower and all 3 switch buildings within the
// existing corridor width (|x| <~ 12) so nothing needs to chase you
// somewhere it physically can't reach. If the compound gets widened
// later, that's the one shared-file change it would need — see
// Level3.md, "Known constraint" for the exact line.

import './Level3Config.js'; // MUST be first — sets skip flags before heavy modules
import * as THREE from 'three';
import {
  scene, camera, dom, sfx, pushKillFeed,
} from './Scene.js';
import { state } from './state.js';
import {
  makeBuilding, playerVis, Zombie, concreteTex,
} from './characters.js';
import { spawnHitSpark, spawnBlood, bootLevel, registerLevelTick, levelKeyHooks } from './Actions.js';
import { finishRun } from './account.js';

const LEVEL_CONFIG = {
  id: 3,
  name: 'Level 3 — The Broadcast Tower',
  skip: { car: true, depot: true },
};

export function startLevel(mode) {
  bootLevel({ ...LEVEL_CONFIG, mode });
  const compound = buildLevel3Scene();
  lv3 = {
    compound,
    phase: 'switches', // 'switches' -> 'boss' -> 'dispersion' -> 'done'
    bossZombie: null,
    dispersion: null,
  };
  writeObjective();
  // Unlike the Level 1 sample, a switch is a deliberate interaction:
  // reaching its exterior control box displays a prompt and E powers it.
  // It makes each of the three stops feel like an objective, rather than
  // silently completing while the player runs past it.
  levelKeyHooks.KeyE = activateNearbySwitch;
  registerLevelTick(updateLevel3Mission);
}

let lv3 = null;

/* ---------------------------------------------------------------------
   Deterministic RNG — own seed, own sequence (same rationale as
   Level2.js: never touch the characters.js mulberry32 instance, so the
   base-street geometry stays identical across levels).
--------------------------------------------------------------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x70932A11);

// Signature color: the cure/dispersion payload, used for switch markers
// once lit and for the final wave — ties the whole level to one palette.
const CURE_COLOR = 0xbff0ff;
const CURE_LIGHT = 0x8fe0ff;
const OFFLINE_COLOR = 0x992222;

/* ---------------------------------------------------------------------
   COMPOUND LAYOUT — tower + 3 switch buildings, staggered up the last
   stretch of the main street. Kept inside the existing zombie-AI
   corridor width on purpose (see header note).
--------------------------------------------------------------------- */
const TOWER_POS = new THREE.Vector3(0, 0, -198);
const SWITCH_DEFS = [
  // `pos` is the exterior control box, never the centre of the building.
  // The previous implementation put both at the same coordinates; because
  // makeBuilding registers a solid physics box, players could see neither
  // the marker nor enter its activation radius.
  { key: 'generator', label: 'Generator room', pos: new THREE.Vector3(10.9, 0, -155), buildingPos: new THREE.Vector3(17, 0, -160) },
  { key: 'cooling', label: 'Cooling station', pos: new THREE.Vector3(-10.9, 0, -169), buildingPos: new THREE.Vector3(-17, 0, -174) },
  { key: 'uplink', label: 'Satellite uplink', pos: new THREE.Vector3(10.9, 0, -183), buildingPos: new THREE.Vector3(17, 0, -188) },
];
const SWITCH_ACTIVATE_RANGE = 3.4;
const BOSS_SPAWN_OFFSET = new THREE.Vector3(0, 0, -8); // stays inside the level's southern world boundary

function makeSwitchMarker(pos) {
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.6, 0.9, 10),
    new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 })
  );
  pedestal.position.set(pos.x, 0.45, pos.z);
  pedestal.castShadow = true; pedestal.receiveShadow = true;
  scene.add(pedestal);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 6, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: OFFLINE_COLOR, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  beam.position.set(pos.x, 3.9, pos.z);
  scene.add(beam);

  const light = new THREE.PointLight(OFFLINE_COLOR, 1.6, 14, 2);
  light.position.set(pos.x, 1.4, pos.z);
  scene.add(light);

  // A ground ring and label make the objective legible in fog/night mode;
  // the control is intentionally visible before the player is in range.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.2, 24),
    new THREE.MeshBasicMaterial({ color: OFFLINE_COLOR, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 0.06, pos.z);
  scene.add(ring);
  const label = makeLabelSprite('CONTROL');
  label.position.set(pos.x, 6.9, pos.z);
  scene.add(label);

  return { pedestal, beam, light, ring, label };
}

function activateSwitchMarker(marker) {
  marker.beam.material.color.set(CURE_COLOR);
  marker.light.color.set(CURE_LIGHT);
  marker.light.intensity = 2.6;
  marker.ring.material.color.set(CURE_COLOR);
  marker.label.material.map = makeLabelTexture('ONLINE');
  marker.label.material.needsUpdate = true;
}

function makeLabelTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 76;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(6, 12, 16, .82)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#bff0ff'; ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  ctx.fillStyle = '#effcff'; ctx.font = 'bold 31px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLabelSprite(text) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(text), transparent: true, depthTest: false }));
  sprite.scale.set(4.8, 1.14, 1);
  return sprite;
}

function buildLevel3Scene() {
  // Tower shell — reuses the shared makeBuilding() so it gets the same
  // window texture, occluder registration, and collision box as every
  // other building on the street, then gets an antenna mast on top.
  const towerShell = makeBuilding(TOWER_POS.x, TOWER_POS.z, 10, 26, 10);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.35, 14, 8),
    new THREE.MeshStandardMaterial({ color: 0x2c2c2c, metalness: 0.6, roughness: 0.4 })
  );
  mast.position.set(TOWER_POS.x, 26 + 7, TOWER_POS.z);
  mast.castShadow = true;
  scene.add(mast);
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 12, 8, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide })
  );
  dish.rotation.set(-Math.PI / 2.4, 0, 0.4);
  dish.position.set(TOWER_POS.x + 3, 26 + 3, TOWER_POS.z + 2);
  dish.castShadow = true;
  scene.add(dish);
  // The console light — dark until all 3 switches are on.
  const consoleLight = new THREE.PointLight(OFFLINE_COLOR, 0, 20, 2);
  consoleLight.position.set(TOWER_POS.x, 3, TOWER_POS.z + 5.5);
  scene.add(consoleLight);

  const switches = SWITCH_DEFS.map((def) => {
    const w = 8, d = 8, h = 7 + rnd() * 1.5;
    const shell = makeBuilding(def.buildingPos.x, def.buildingPos.z, w, h, d);
    const marker = makeSwitchMarker(def.pos);
    return { ...def, shell, marker, activated: false };
  });

  return { towerShell, mast, dish, consoleLight, switches };
}

/* ---------------------------------------------------------------------
   HUD — reuses the existing objective/compass elements rather than
   building a new panel (Scene.js's updateObjectiveHUD() is Level 1's
   own stage text, so Level 3 writes dom.objective directly instead of
   calling it — same idea as Level 2's compassOverride, smaller scope).
--------------------------------------------------------------------- */
function writeObjective() {
  const remaining = lv3.compound.switches.filter((s) => !s.activated).length;
  if (lv3.phase === 'switches') {
    dom.objective.innerHTML = remaining > 0
      ? `Objective: <b>Power the dispersion array</b> — activate ${remaining} more switch${remaining === 1 ? '' : 'es'} (generator, cooling station, satellite uplink).`
      : `Objective: <b>All switches active</b> — return to the tower.`;
    const nextSwitch = lv3.compound.switches.find((s) => !s.activated);
    state.compassOverride = nextSwitch
      ? { pos: nextSwitch.pos, label: nextSwitch.label.toUpperCase() }
      : { pos: TOWER_POS, label: 'TOWER' };
  } else if (lv3.phase === 'boss') {
    dom.objective.innerHTML = `Objective: <b>Hold the tower</b> — the noise and light brought something. Survive it.`;
    state.compassOverride = { pos: TOWER_POS, label: 'HOSTILE' };
  } else {
    dom.objective.innerHTML = `Objective: <b>Disperse the cure.</b>`;
    state.compassOverride = null;
  }
}

/* ---------------------------------------------------------------------
   PHASE 1 — SWITCHES
--------------------------------------------------------------------- */
function nearbySwitch(pos) {
  return lv3.compound.switches.find((sw) => !sw.activated && pos.distanceTo(sw.pos) <= SWITCH_ACTIVATE_RANGE);
}

function activateNearbySwitch() {
  if (!lv3 || lv3.phase !== 'switches' || state.isDead || !playerVis) return;
  const sw = nearbySwitch(playerVis.group.position);
  if (!sw) return;
  sw.activated = true;
  activateSwitchMarker(sw.marker);
  sfx.pickup();
  pushKillFeed(`${sw.label} online`);
  writeObjective();
  if (lv3.compound.switches.every((entry) => entry.activated)) startBossPhase();
}

function updateSwitchInteraction(pos, t) {
  const sw = nearbySwitch(pos);
  if (sw) {
    dom.prompt.classList.remove('hidden');
    dom.promptText.textContent = `Press E — activate ${sw.label}`;
    sw.marker.ring.scale.setScalar(1 + Math.sin(t * 6) * 0.08);
  } else {
    dom.prompt.classList.add('hidden');
  }
}

/* ---------------------------------------------------------------------
   PHASE 2 — THE BOSS
   Reuses the real Zombie class (same model loading, same movement/
   attack state machine any infected uses) rather than a parallel enemy
   system, then overrides stats + takeDamage on that one instance —
   the same pattern characters.js's own spawnDepotGuards() already uses
   to make the depot guards tougher than street zombies.
   ---------------------------------------------------------------------
   Known limitation worth flagging in review: the base Zombie.takeDamage
   in this build sets health straight to 0 regardless of the dmg
   argument — every hit is a one-shot kill for ordinary infected. That's
   fine for them, but it would make a "boss" trivial. This override
   replaces takeDamage on the boss instance ONLY (not the shared class),
   so ordinary zombies everywhere else are completely unaffected.
--------------------------------------------------------------------- */
const BOSS_MAX_HEALTH = 1400; // ~2 full mags of sustained, accurate fire
const BOSS_SCALE = 1.75;

function startBossPhase() {
  lv3.phase = 'boss';
  writeObjective();
  pushKillFeed('Power restored — something is coming.');
  consoleGlow(true);

  const spawnPos = TOWER_POS.clone().add(BOSS_SPAWN_OFFSET);
  const boss = new Zombie(spawnPos);
  boss.health = boss.maxHealth = BOSS_MAX_HEALTH;
  boss.speed *= 0.85; // tankier and a little slower than a runner — a wall to fight around, not outrun
  boss.mesh.scale.setScalar(BOSS_SCALE);
  boss.isBoss = true;

  boss.takeDamage = function bossTakeDamage(dmg, headshot) {
    if (!this.alive) return;
    this.health -= (dmg || 20);
    spawnHitSpark(this.mesh.position.clone().add(new THREE.Vector3(0, headshot ? 2.2 : 1.6, 0)));
    spawnBlood(this.mesh.position);
    sfx.hit();
    state.shake = Math.max(state.shake, headshot ? 0.16 : 0.09);
    if (this.health <= 0) {
      this.confirmedKill(headshot);
    }
  };

  state.zombies.push(boss);
  state.spawnedTotal++;
  lv3.bossZombie = boss;
}

function consoleGlow(on) {
  lv3.compound.consoleLight.intensity = on ? 2.4 : 0;
  lv3.compound.consoleLight.color.set(on ? CURE_LIGHT : OFFLINE_COLOR);
}

/* ---------------------------------------------------------------------
   PHASE 3 — DISPERSION (the narrative payoff)
   Freezes the stock gameplay gate the same way Level 2's lose cinematic
   does (state.isDead = true stops Actions.js's per-frame gameplay, but
   registerLevelTick ticks keep running so this can still animate), then
   sweeps an expanding wave out from the tower. Any zombie it catches
   stops being hostile and its material tints toward a human skin tone
   — a first-pass version of "the light turns them back," without
   needing a second character model this team doesn't have yet (see
   Level3.md for the upgrade path).
--------------------------------------------------------------------- */
const DISPERSION_WAVE_SPEED = 22; // m/s the wave front expands at
const DISPERSION_MAX_RADIUS = 70;
const HUMAN_TINT = new THREE.Color(0xd8c3a5);

function startDispersion() {
  lv3.phase = 'dispersion';
  writeObjective();
  state.isDead = true; // freezes Actions.js's gameplay gate, not this level's own ticks
  document.exitPointerLock();
  sfx.setEngine(0, false);
  pushKillFeed('The console is live — dispersing the cure.');

  const wave = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.MeshBasicMaterial({
      color: CURE_COLOR, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    })
  );
  wave.position.copy(TOWER_POS).setY(4);
  scene.add(wave);

  const flashLight = new THREE.PointLight(CURE_LIGHT, 0, 90, 2);
  flashLight.position.copy(TOWER_POS).setY(10);
  scene.add(flashLight);

  lv3.dispersion = {
    t: 0,
    wave,
    flashLight,
    radius: 0,
    caught: new Set(), // zombies already converted, so each is only processed once
    camGoal: TOWER_POS.clone().add(new THREE.Vector3(18, 10, 24)),
  };
  lv3.curedCount = 0;
}

function updateDispersion(dt) {
  const d = lv3.dispersion;
  d.t += dt;
  d.radius = Math.min(DISPERSION_MAX_RADIUS, d.t * DISPERSION_WAVE_SPEED);
  d.wave.scale.setScalar(Math.max(0.001, d.radius));
  d.wave.material.opacity = 0.55 * Math.max(0, 1 - d.radius / DISPERSION_MAX_RADIUS);
  d.flashLight.intensity = 12 * Math.sin(Math.min(1, d.t / 1.2) * Math.PI);

  camera.position.lerp(d.camGoal, Math.min(1, dt * 1.4));
  camera.lookAt(TOWER_POS.x, 4, TOWER_POS.z);

  // Convert any living zombie the wave front has now reached.
  state.zombies.forEach((z) => {
    if (!z.alive || d.caught.has(z)) return;
    if (z.mesh.position.distanceTo(TOWER_POS) <= d.radius) {
      d.caught.add(z);
      convertZombie(z);
    }
  });

  if (d.radius >= DISPERSION_MAX_RADIUS && d.t > DISPERSION_MAX_RADIUS / DISPERSION_WAVE_SPEED + 1) {
    scene.remove(d.wave); d.wave.geometry.dispose(); d.wave.material.dispose();
    scene.remove(d.flashLight);
    lv3.dispersion = null;
    lv3.phase = 'done';
    showLevel3EndScreen();
  }
}

/** Turns one zombie human: stops its AI (state 'cured' is never read by
    Zombie.update's chase/attack/idle branches, so it just stands down),
    tints every material toward a skin tone, and plays a small settle
    animation instead of the death VFX — this is a rescue, not a kill,
    so it deliberately does NOT call confirmedKill/spawnCoin/spawnDeathSparkles. */
function convertZombie(z) {
  z.state = 'cured';
  z.alive = false; // stops Zombie.update() and further raycasts against it
  z.mesh.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (!m.color) return;
      m.color.lerp(HUMAN_TINT, 0.85);
      if (m.emissive) m.emissive.setScalar(0);
    });
  });
  spawnHitSpark(z.mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0)));
  sfx.pickup();
  lv3.curedCount = (lv3.curedCount || 0) + 1;
}

/* ---------------------------------------------------------------------
   END SCREEN — same pattern as Level2.js's buildLevel2EndScreens/
   catchGirl: a small dedicated screen instead of the stock doWin(),
   since this win has its own stat line and title.
--------------------------------------------------------------------- */
let lv3Win = null, lv3WinStats = null;
function showLevel3EndScreen() {
  if (!lv3Win) {
    const style = document.createElement('style');
    style.textContent = `#lv3-winscreen .end-title { color: #bff0ff; text-shadow: 0 0 30px rgba(143,224,255,.6); }`;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'lv3-winscreen';
    el.className = 'end-screen hidden';
    el.innerHTML = `
      <h1 class="end-title">OUTBREAK REVERSED</h1>
      <div class="end-sub" id="lv3-win-stats"></div>
      <button onclick="location.reload()">Play Again</button>`;
    document.body.appendChild(el);
    lv3Win = el;
    lv3WinStats = el.querySelector('#lv3-win-stats');
  }
  lv3WinStats.textContent = `Infected eliminated: ${state.kills} · Infected cured: ${lv3.curedCount || 0} · Coins: ${state.coins}`;
  lv3Win.classList.remove('hidden');
  finishRun('win', lv3Win);
}

/* ---------------------------------------------------------------------
   MASTER MISSION TICK
--------------------------------------------------------------------- */
function updateLevel3Mission(dt) {
  if (!state.readyShown || !lv3) return;

  // bootLevel's asset-ready callback paints the shared Level 1 objective
  // after startLevel has run. Repaint our own HUD once the gameplay HUD is
  // live so Level 3 never appears to be asking for the depot sample.
  if (!lv3.hudReady) { lv3.hudReady = true; writeObjective(); }
  // The shared boot callback can repaint Level 1's default objective a
  // fraction of a second after the HUD is revealed. Keep the Level 3
  // mission authoritative while switches are active, without updating the
  // DOM every frame.
  lv3.objectiveRefresh = (lv3.objectiveRefresh || 0) - dt;
  if (lv3.objectiveRefresh <= 0 && lv3.phase === 'switches') {
    writeObjective();
    lv3.objectiveRefresh = 0.35;
  }

  if (lv3.phase === 'dispersion') { updateDispersion(dt); return; }
  if (lv3.phase === 'done') return;
  if (state.paused) return;

  // Boss phase: hold off the ambient spawn ramp so the fight reads as
  // "the boss," not "the boss plus the usual street horde" — done by
  // continually pushing the shared spawn timer back out, entirely from
  // this level tick, rather than touching Actions.js's spawn call.
  if (lv3.phase === 'boss') {
    state.spawnTimer = Math.max(state.spawnTimer, 4);
    if (lv3.bossZombie && !lv3.bossZombie.alive) {
      lv3.bossZombie = null;
      pushKillFeed('The console is powering up.');
      startDispersion();
      return;
    }
  }

  if (state.isDead || !playerVis) return;
  const pos = playerVis.group.position;
  if (lv3.phase === 'switches') updateSwitchInteraction(pos, performance.now() / 1000);
  // This tick runs after Actions.js's generic compass paint. Paint the
  // Level 3 compass directly here so the default depot target can never
  // overwrite our mission target during the boot/HUD transition.
  paintLevel3Compass(pos);
}

function paintLevel3Compass(pos) {
  const target = state.compassOverride;
  if (!target) return;
  const dx = target.pos.x - pos.x;
  const dz = target.pos.z - pos.z;
  const dist = Math.hypot(dx, dz) || 1;
  const tx = dx / dist, tz = dz / dist;
  const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
  const angle = Math.atan2(fx * tz - fz * tx, fx * tx + fz * tz);
  dom.compass.classList.remove('hidden');
  dom.compassArrow.style.transform = `rotate(${(-angle * 180) / Math.PI}deg)`;
  dom.compassLabel.textContent = `${target.label} — ${Math.round(dist)}m`;
}
