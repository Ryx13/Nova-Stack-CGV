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
  scene, camera, dom, sfx, pushKillFeed, updateAmmoHUD,
} from './Scene.js';
import { state } from './state.js';
import {
  makeBuilding, playerVis, Zombie, concreteTex,
} from './characters.js';
import { spawnHitSpark, spawnBlood, bootLevel, registerLevelTick, levelKeyHooks, damagePlayer } from './Actions.js';
import { buildCompoundDetails } from './Level3Environment.js';
import { spawnPickup } from './PowerUps.js';
import { createNarrative } from './Narrative.js';
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
    hold: 0, defenseTime: 0, waveRemaining: 0, waveTimer: 0, elapsed: 0,
  };
  writeObjective();
  // Unlike the Level 1 sample, a switch is a deliberate interaction:
  // reaching its exterior control box displays a prompt and E powers it.
  // It makes each of the three stops feel like an objective, rather than
  // silently completing while the player runs past it.
  levelKeyHooks.KeyE = () => {};
  state.ammoReserve = 60; updateAmmoHUD();
  lv3.details = buildCompoundDetails(scene, SWITCH_DEFS, makeLabelSprite);
  levelKeyHooks.KeyG = () => readTerminal();
  initLevel3Story();
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
      ? `Objective: <b>Turn on the tower</b> — activate ${remaining} more switch${remaining === 1 ? '' : 'es'} (generator, cooling station, satellite uplink).`
      : `Objective: <b>All switches active</b> — return to the tower.`;
    const nextSwitch = lv3.compound.switches.find((s) => !s.activated);
    state.compassOverride = nextSwitch
      ? { pos: nextSwitch.pos, label: nextSwitch.label.toUpperCase() }
      : { pos: TOWER_POS, label: 'TOWER' };
  } else if (lv3.phase === 'boss') {
    dom.objective.innerHTML = `Objective: <b>Hold the tower</b> — the noise and light brought something. Survive it.`;
    state.compassOverride = { pos: TOWER_POS, label: 'HOSTILE' };
  } else if (lv3.phase === 'broadcast-ready') {
    dom.objective.textContent = 'Array ready — return to the tower console and press E to broadcast. Optional rescue remains available.';
    state.compassOverride = {pos: lv3.story.consolePos, label:'BROADCAST'};
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
  if (!sw || lv3.hold < 3) return;
  lv3.hold = 0;
  sw.activated = true;
  lv3.lastSwitch = sw.key;
  activateSwitchMarker(sw.marker);
  sfx.pickup();
  lv3.defenseTime = 30; lv3.waveRemaining = 10; lv3.waveTimer = 0;
  lv3.details.lights[SWITCH_DEFS.findIndex(d => d.key === sw.key)].color.setHex(0x55ff99);
  pushKillFeed(`${sw.label} online — defend for 30 seconds`);
  writeObjective();

}

function updateSwitchInteraction(pos, t, dt) {
  const sw = nearbySwitch(pos);
  if (sw && lv3.defenseTime <= 0) {
    if (lv3.holdKey !== sw.key) lv3.hold = 0;
    lv3.holdKey = sw.key;
    lv3.hold = state.keys.KeyE ? Math.min(3, lv3.hold + dt) : 0;
    dom.prompt.classList.remove('hidden');
    dom.promptText.textContent = `Hold E — ${sw.label} · ${Math.round(lv3.hold / 3 * 100)}% | G: research terminal`;
    sw.marker.ring.scale.setScalar(1 + Math.sin(t * 6) * 0.08);
    lv3.details.progress.hidden = lv3.hold === 0;
    lv3.details.progress.max = 3;
    lv3.details.progress.value = lv3.hold;
    if (lv3.hold >= 3) activateNearbySwitch();
  } else {
    lv3.hold = 0; lv3.details.progress.hidden = true;
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
  boss.baseSpeed = boss.speed; boss.chargeClock = 0; boss.minionThreshold = .75;

  boss.takeDamage = function bossTakeDamage(dmg, headshot) {
    if (!this.alive) return;
    this.health -= (dmg || 20);
    while (this.minionThreshold > 0 && this.health / this.maxHealth <= this.minionThreshold) {
      lv3.waveRemaining += 4; this.minionThreshold -= .25;
      pushKillFeed('The guardian calls reinforcements');
    }
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
const DISPERSION_WAVE_SPEED = 11; // m/s the wave front expands at
const DISPERSION_MAX_RADIUS = 70;
const HUMAN_TINT = new THREE.Color(0xd8c3a5);

function startDispersion() {
  lv3.phase = 'dispersion';
  writeObjective();
  lv3.details.progress.hidden = true; lv3.details.note.hidden = true;
  lv3.story.logButton.hidden = true;
  lv3.story.narrative.show({id:'broadcast-live',mode:'radio',speaker:'DR. JAMES / BROADCAST LIVE',text:lv3.story.rescued?'The technician is clear. Cooling stable. Signal locked. Look at them — they are coming back.':'Cooling stable. Signal locked. The cure is reaching the streets. You did it.'});
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
  lv3.compound.switches.forEach((sw,i) => { sw.marker.light.intensity = d.t > i*.45 ? 4 : 1; });
  d.flashLight.intensity = 12 * Math.sin(Math.min(1, d.t / 1.2) * Math.PI);

  d.camGoal.set(TOWER_POS.x + Math.sin(d.t * .22 + .65) * 27, 12, TOWER_POS.z + Math.cos(d.t * .22 + .65) * 27);
  for (const z of d.caught) {
    z.cureTime = Math.min(1, z.cureTime + dt * .7);
    z.mesh.rotation.x = Math.sin(z.cureTime * Math.PI) * .28;
    z.mesh.position.y = z.cureBaseY - Math.sin(z.cureTime * Math.PI) * .45;
    for (const m of z.cureMaterials) m.color.lerp(HUMAN_TINT, dt * 1.3);
    z.cureParticles.position.y += dt * .65;
    z.cureParticles.material.opacity = 1 - z.cureTime * .7;
  }
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
    for (const z of d.caught) { scene.remove(z.cureParticles); z.cureParticles.geometry.dispose(); z.cureParticles.material.dispose(); }
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
  z.cureTime = 0; z.cureBaseY = 0; z.cureMaterials = [];
  z.mesh.rotation.x = 0; z.mesh.position.y = 0;
  z.state = 'cured';
  z.alive = false; // stops Zombie.update() and further raycasts against it
  z.mesh.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (!m.color) return;
      z.cureMaterials.push(m);
      if (m.emissive) m.emissive.setScalar(0);
    });
  });
  const points = [];
  for (let i=0;i<16;i++) points.push((rnd()-.5)*1.3,rnd()*1.8,(rnd()-.5)*1.3);
  z.cureParticles = new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3)),new THREE.PointsMaterial({color:CURE_LIGHT,size:.07,transparent:true,depthWrite:false}));
  z.cureParticles.position.copy(z.mesh.position); scene.add(z.cureParticles);
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
  dom.hud.classList.add('hidden');
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
  lv3WinStats.textContent = `Zombies defeated: ${state.kills} · Infected cured: ${lv3.curedCount || 0} · Coins: ${state.coins}`;
  lv3Win.classList.remove('hidden');
  lv3WinStats.textContent += ` · ${lv3.story.rescued ? 'Technician evacuated' : 'Rescue signal unresolved'} · ${lv3.story.power === 'safety' ? 'Safety systems restored' : 'Supply route opened'}`;
  lv3.story.narrative.dispose();
  finishRun('win', lv3Win);
}

/* ---------------------------------------------------------------------
   MASTER MISSION TICK
--------------------------------------------------------------------- */
function updateLevel3Mission(dt) {
  if (!state.readyShown || !lv3) return;
  if (!state.paused) lv3.story.narrative.update(dt);
  if (!lv3.story.arrived && !dom.hud.classList.contains('hidden')) {
    lv3.story.arrived = true;
    writeObjective();
    lv3.story.narrative.show({id:'tower-arrival',mode:'cinematic',title:'The last broadcast',text:'Turn on the three marked switches. Hold E at each switch, then survive the attack. Normal zombies take two body shots or two knife hits. Pick up their health or ammo drops.',shot:'tower'});
  }
  if (state.narrativeBlocked) { updateStoryCamera(dt); return; }


  // bootLevel's asset-ready callback paints the shared Level 1 objective
  // after startLevel has run. Repaint our own HUD once the gameplay HUD is
  // live so Level 3 never appears to be asking for the depot sample.
  if (!lv3.hudReady) { lv3.hudReady = true; writeObjective(); }
  // The shared boot callback can repaint Level 1's default objective a
  // fraction of a second after the HUD is revealed. Keep the Level 3
  // mission authoritative while switches are active, without updating the
  // DOM every frame.
  lv3.objectiveRefresh = (lv3.objectiveRefresh || 0) - dt;
  if (lv3.objectiveRefresh <= 0 && lv3.phase !== 'done') {
    writeObjective();
    lv3.objectiveRefresh = 0.35;
  }

  if (lv3.phase === 'dispersion') { updateDispersion(dt); return; }
  if (lv3.phase === 'done') return;
  if (state.paused || state.isDead) return;

  // Boss phase retains ambient pressure and adds a telegraphed charge.
  if (lv3.phase === 'boss') {
    const boss = lv3.bossZombie;
    if (boss?.alive) {
      const previous = boss.chargeClock;
      boss.chargeClock = (boss.chargeClock + dt) % 12;
      if (previous < 8 && boss.chargeClock >= 8) pushKillFeed('Guardian preparing to charge — move aside!');
      boss.speed = boss.baseSpeed * (boss.chargeClock >= 9 ? 2 : 1);
    }
    if (lv3.bossZombie && !lv3.bossZombie.alive) {
      lv3.bossZombie = null;
      pushKillFeed('The console is powering up.');
      lv3.phase = 'broadcast-ready'; writeObjective();
      lv3.story.narrative.show({id:'guardian-down',mode:'radio',text:'The boss is defeated. Go to the tower control panel and press E to spread the cure.'});
      return;
    }
  }

  if (state.isDead || !playerVis) return;
  const pos = playerVis.group.position;
  lv3.elapsed += dt;
  updateCompoundGameplay(dt, pos);
  if (lv3.phase === 'switches') updateSwitchInteraction(pos, lv3.elapsed, dt);
  updateStoryInteractions(dt, pos);
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

const NOTES = [
  'DR. JAMES / 01: The earthquake broke the chemical tanks. Normal zombies take two body shots or two knife hits to defeat. They drop health or ammo.',
  'DR. JAMES / 02: We have the last ingredient. Turn on the cooling system to keep the cure safe.',
  'DR. JAMES / 03: Turn on all three switches. Then defeat the boss and press E at the tower control panel to spread the cure.'
];
function readTerminal() {
  if (!lv3 || state.isDead || state.paused) return;
  const i = SWITCH_DEFS.findIndex(s => s.pos.distanceTo(playerVis.group.position) < 4);
  if (i < 0) return;
  lv3.story.narrative.show({id:'research-'+i,mode:'radio',speaker:'DR. JAMES / RESEARCH '+(i+1),text:NOTES[i],duration:12});
}
function spawnReinforcement(pos) {
  if (state.zombies.length >= 64 || state.zombies.filter(z => z.alive && z.state !== 'downed').length >= 28) return false;
  const side = rnd() < .5 ? -1 : 1;
  const z = new Zombie(new THREE.Vector3(side * 6, 0, THREE.MathUtils.clamp(pos.z + (rnd() < .5 ? -14 : 14), -188, -130)));
  state.zombies.push(z); state.spawnedTotal++; return true;
}
function updateCompoundGameplay(dt, pos) {
  // Normal enemies have predictable two-hit health and never reanimate.
  for (const z of state.zombies) {
    if (z.isBoss || z.stabilizationReady) continue;
    z.stabilizationReady = true;
    z.health = z.maxHealth = 52;
    z.takeDamage = function(damage = 26, headshot = false) {
      if (!this.alive) return;
      this.health = Math.max(0, this.health - (Number.isFinite(damage) ? Math.max(0, damage) : 26));
      sfx.hit();
      if (this.health > 0) { pushKillFeed('Hit — attack again to defeat this zombie'); return; }
      const dropPosition = this.mesh.position.clone();
      this.confirmedKill(headshot);
      spawnPickup(dropPosition, state.playerHealth < state.playerMaxHealth * .6 ? 'health' : 'ammo');
      dom.killcount.textContent = state.kills;
    };
  }
  if (lv3.noteTime > 0) { lv3.noteTime -= dt; if (lv3.noteTime <= 0) lv3.details.note.hidden = true; }
  lv3.waveTimer -= dt;
  if (lv3.waveRemaining > 0 && lv3.waveTimer <= 0) {
    if (spawnReinforcement(pos)) lv3.waveRemaining--;
    lv3.waveTimer = 1.7;
  }
  if (lv3.defenseTime > 0) {
    lv3.defenseTime = Math.max(0, lv3.defenseTime - dt);
    dom.objective.textContent = `Survive — ${Math.ceil(lv3.defenseTime)}s. Keep moving; break supply crates with melee.`;
    if (lv3.defenseTime === 0) {
      void finishDefense(lv3.lastSwitch);
    }
  }
  for (const h of lv3.details.hazards) {
    if (h.type === 'steam' && lv3.story.power === 'safety') { h.mesh.visible = false; continue; }
    const cycle = (lv3.elapsed + h.offset) % 8;
    const active = h.type === 'toxic' || cycle > 4;
    h.mesh.visible = h.type === 'toxic' || cycle > 3;
    h.mesh.material.opacity = h.type === 'toxic' ? .55 : active ? .55 : .15;
    if (active && Math.hypot(pos.x - h.mesh.position.x, pos.z - h.mesh.position.z) < h.radius) damagePlayer(h.type === 'toxic' ? 5 : 8);
  }
  for (const crate of lv3.details.crates) {
    if (crate.open || state.meleeTimer <= 0 || crate.position.distanceTo(pos) > 2.4) continue;
    const dx = crate.position.x - pos.x, dz = crate.position.z - pos.z;
    if (dx * Math.sin(state.yaw) + dz * Math.cos(state.yaw) > 0) continue;
    crate.open = true; crate.visible = false;
    spawnPickup(crate.position, crate.userData.supply); sfx.pickup();
    pushKillFeed('Supply crate opened');
  }
}

function initLevel3Story() {
  const story=lv3.story={arrived:false,power:null,rescueAvailable:false,rescued:false,rescueStarted:false,rescueHold:0,cacheClaimed:false,shot:null,savedCamera:null};
  story.consolePos=new THREE.Vector3(0,0,-187);
  story.rescuePos=new THREE.Vector3(-8.5,0,-164);
  story.cachePos=new THREE.Vector3(8,0,-151);
  story.narrative=createNarrative({
    onBlock:value=>{state.narrativeBlocked=value;state.keys={};state.firePressed=false;state.isSprinting=false;},
    onRelease:()=>{if(!state.isDead&&!state.paused)dom.canvas.requestPointerLock()?.catch(()=>{});},
    onShot:value=>{if(value){story.savedCamera={position:camera.position.clone(),quaternion:camera.quaternion.clone()};story.shot=value;}else{if(story.savedCamera){camera.position.copy(story.savedCamera.position);camera.quaternion.copy(story.savedCamera.quaternion);}story.shot=null;story.savedCamera=null;}}
  });
  story.logButton=document.createElement('button');story.logButton.className='dw-button quiet dw-log-button';story.logButton.textContent='Field log';document.body.append(story.logButton);
  story.logButton.onclick=()=>{if(!state.isDead&&!state.paused)story.narrative.openLog('Tower controls: hold E to power a system. G reads research. Optional rescue: hold E at the shelter. V changes view; Tab pauses.');};
  function marker(pos,title,color){const group=new THREE.Group();group.position.copy(pos);const base=new THREE.Mesh(new THREE.BoxGeometry(1.2,1.4,.5),new THREE.MeshStandardMaterial({color:0x253237,emissive:color,emissiveIntensity:.25}));base.position.y=.7;group.add(base);const label=makeLabelSprite(title);label.position.y=2.2;label.scale.multiplyScalar(.65);group.add(label);scene.add(group);return group;}
  story.rescueMarker=marker(story.rescuePos,'SHELTER / NO SIGNAL',0xe0a83c);
  story.cache=marker(story.cachePos,'SUPPLY / LOCKED',0xe0a83c);
  story.console=marker(story.consolePos,'BROADCAST / E',0x8fe0ff);
  story.technician=new THREE.Mesh(new THREE.CapsuleGeometry(.23,.85,4,8),new THREE.MeshStandardMaterial({color:0xc8b28f}));story.technician.position.copy(story.rescuePos).add(new THREE.Vector3(-.6,.85,0));scene.add(story.technician);
}
function updateStoryCamera(dt){
 const s=lv3.story;if(!s.shot)return;
 const goal=s.shot==='guardian'?new THREE.Vector3(9,5,-207):new THREE.Vector3(15,12,-177);
 const target=s.shot==='guardian'?new THREE.Vector3(0,2,-206):TOWER_POS.clone().setY(16);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 camera.position.lerp(goal,reduced?1:1-Math.exp(-2*dt));camera.lookAt(target);
}
async function finishDefense(key){
 const s=lv3.story;
 if(key==='generator'&&!s.power){
   const choice=await s.narrative.show({id:'power-routing',mode:'choice',speaker:'DR. JAMES / AUXILIARY POWER',title:'One circuit to spare.',text:'Choose one: turn off the dangerous steam, or unlock a box with 36 extra bullets. You can finish the mission with either choice.',choices:[{id:'safety',label:'Restore safety systems',detail:'Turn off the dangerous steam for the rest of this mission.'},{id:'supplies',label:'Open the supply route',detail:'Open the marked ammo box and collect 36 bullets.'}]});
   s.power=choice==='supplies'?'supplies':'safety';
   if(s.power==='supplies'){s.cache.children[0].material.emissive.setHex(0x8fe0ff);s.cache.children[1].material.map.dispose();s.cache.children[1].material.map=makeLabelTexture('SUPPLY / E');}
 }
 if(key==='cooling'){
   s.rescueAvailable=true;s.rescueMarker.children[1].material.map.dispose();s.rescueMarker.children[1].material.map=makeLabelTexture('SURVIVOR / HOLD E');
   s.narrative.show({id:'rescue-signal',mode:'radio',speaker:'UNKNOWN / LOCAL SIGNAL',text:'Is anyone there? I am trapped by the cooling station. The shelter release is outside. Please — do not leave me here.'});
 }
 if(lv3.compound.switches.every(sw=>sw.activated)){
   startBossPhase();
   await s.narrative.show({id:'guardian-reveal',mode:'cinematic',speaker:'DR. JAMES / SIGNAL LOST',title:'Something heard us.',text:'A strong boss is coming. It needs many hits. Move sideways when it runs at you. Keep shooting and watch for other zombies.',shot:'guardian',continueLabel:'Hold the tower'});
 }else writeObjective();
}
function updateStoryInteractions(dt,pos){
 const s=lv3.story;
 if(s.rescued){s.technician.position.x=THREE.MathUtils.lerp(s.technician.position.x,-11,Math.min(1,dt));s.technician.position.z=THREE.MathUtils.lerp(s.technician.position.z,-158,Math.min(1,dt));}
 let prompt='';
 if(s.power==='supplies'&&!s.cacheClaimed&&pos.distanceTo(s.cachePos)<2.5){prompt='Press E — emergency ammunition / +36 rounds';if(state.keys.KeyE){s.cacheClaimed=true;s.cache.visible=false;state.ammoReserve+=36;updateAmmoHUD();sfx.pickup();s.narrative.show({id:'cache-open',mode:'radio',text:'Emergency ammunition recovered. Make it count.'});}}
 if(s.rescueAvailable&&!s.rescued&&pos.distanceTo(s.rescuePos)<2.5){
   prompt=`Hold E — release shelter / ${Math.round(s.rescueHold/4*100)}%`;
   if(state.keys.KeyE){if(!s.rescueStarted){s.rescueStarted=true;lv3.waveRemaining+=4;s.narrative.show({id:'rescue-start',mode:'radio',speaker:'SHELTER / RELEASE JAMMED',text:'The release is jammed. Keep holding it — the noise is drawing infected.'});}s.rescueHold=Math.min(4,s.rescueHold+dt);}else s.rescueHold=0;
   lv3.details.progress.max=4;lv3.details.progress.value=s.rescueHold;lv3.details.progress.hidden=s.rescueHold===0;
   if(s.rescueHold>=4){s.rescued=true;s.rescueMarker.visible=false;lv3.details.progress.hidden=true;s.narrative.show({id:'rescue-complete',mode:'radio',speaker:'TECHNICIAN / SAFE',text:'I am clear. Thank you. I will guide anyone who comes back toward the shelter. Get that broadcast running.'});}
 }else{if(s.rescueHold>0)lv3.details.progress.hidden=true;s.rescueHold=0;}
 if(lv3.phase==='broadcast-ready'&&pos.distanceTo(s.consolePos)<3){prompt='Press E — broadcast the cure / completes this mission';if(state.keys.KeyE)startDispersion();}
 if(prompt){dom.prompt.classList.remove('hidden');dom.promptText.textContent=prompt;}
 else if(lv3.phase==='broadcast-ready')dom.prompt.classList.add('hidden');
}
