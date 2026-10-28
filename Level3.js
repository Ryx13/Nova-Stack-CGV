import {createGuardianAwakening} from './GuardianAwakening.js';
import {CombatRoute,MAX_ROUTE_ENEMIES} from './Level3CombatRoute.js';
import {createLevel3Vendor} from './Level3Vendor.js';
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
import { mergeStaticScenery } from './mergeStatic.js';
import * as THREE from 'three';
import {
  scene, world, camera, dom, sfx, pushKillFeed, updateAmmoHUD, updateCoinHUD, addStaticBox,
  acquireEffectLight, releaseEffectLight,
} from './Scene.js';
import { state } from './state.js';
import {
  makeBuilding, playerVis, playerBody, syncHandGun, Zombie, clampZombieX, viewmodelGun, knifeViewModel, registerLevelViewmodel,
  updateBlinkingLamps,
} from './characters.js';
import { updateSignFlicker } from './CityKit.js';
import { spawnHitSpark, spawnBlood, bootLevel, registerLevelTick, registerLevelPreTick, registerLevelPreparation, levelKeyHooks, damagePlayer, switchWeapon } from './Actions.js';
import { buildCompoundDetails } from './Level3Environment.js';
import {buildInteractionProp} from './Level3InteractionProps.js';
import {buildSwitchProp} from './Level3SwitchProps.js';
import {buildQuarantineFacility} from './Level3Quarantine.js';
import { spawnPickup } from './PowerUps.js';
import { createNarrative } from './Narrative.js';
import { presentGuardian, preloadGuardian } from './Guardian.js';
import { finishRun } from './account.js';
import { CureDevice, CURE_RADIUS, CURE_CHARGES, CURE_HALF_ANGLE, withinCureAim, powerRoute, POWER_ROUTES } from './Level3Systems.js';
import { RayCandidates } from './RayCandidates.js';
import {registerLevelWeapon} from './WeaponSlots.js';
import {buildCureProjector} from './CureProjector.js';
import {OPENING_CONVERSATION,endingReflection} from './Level3HumanityDialogue.js';
import {getGirlOutcome} from './StoryProgress.js';
import {buildArrivalBay} from './Level3Arrival.js';
import {buildIndustrialDistrict} from './Level3Industry.js';
import {registerDayProgress} from './DayCycle.js';
import {preloadHumanRecovery,prepareHumanRecovery,beginHumanRecovery,updateHumanRecovery,survivorFrame,recognizeSurvivor} from './assets/human-recovery/HumanRecovery.js';

const LEVEL_CONFIG = {
  id: 3,
  name: 'Level 3 — The Broadcast Tower',
  skip: { car: true, depot: true },
  // The Guardian, cure projector, stealth and quarantine systems have no
  // reset yet, so Retry reloads the page for this level.
  restartInPlace: false,
};

export function startLevel(mode) {
  registerLevelPreparation(prepareLevel3Guardian);
  registerLevelPreparation(prepareHumanRecovery);
  preloadHumanRecovery().catch(error=>console.error('Human recovery preload failed',error));
  preloadGuardian().catch(error => console.error('Guardian preload failed', error));
  bootLevel({ ...LEVEL_CONFIG, mode });
  registerLevelTick(buildArrivalBay()); // the bay you crossed, behind the start
  // Campaign clock (DayCycle.js): the switches, the boss, then the broadcast
  // itself carries it the last stretch (the night path's sunrise)
  registerDayProgress(() => {
    if (!lv3) return 0;
    if (lv3.phase === 'dispersion' && lv3.dispersion) return 0.88 + 0.12 * Math.min(1, lv3.dispersion.t / 9);
    if (lv3.phase === 'done') return 1;
    if (lv3.phase === 'broadcast-ready') return 0.87;
    if (lv3.phase === 'boss-fallen') return 0.85;
    if (lv3.phase === 'boss') return 0.75;
    return 0.2 * lv3.compound.switches.filter((s) => s.activated).length;
  });
  buildIndustrialDistrict(); // the works over the walls, merged with the compound below
  const compound = buildLevel3Scene();
  for(const object of [compound.towerShell,compound.mast,compound.dish,...compound.switches.map(s=>s.shell)]) object.userData.staticScenery=true;
  const merged=mergeStaticScenery(scene);
  if(document.body.classList.contains('debug'))console.info('[compound scenery]',merged); // debug mode only (?debug)
  lv3 = {
    compound,
    phase: 'switches', // 'switches' -> 'boss' -> 'dispersion' -> 'done'
    bossZombie: null,
    dispersion: null,
    curedCount: 0, pulseSaved: 0, broadcastCured: 0, guardianSpared:false, guardianDefeated:false, route:new CombatRoute({countMul:state.zombieCountMul}), defendingSwitch:null,
    savedInfected: new Set(), activeCures: new Set(),
    hold: 0, defenseTime: 0, waveRemaining: 0, waveTimer: 0, elapsed: 0,
  };
  writeObjective();
  // Unlike the Level 1 sample, a switch is a deliberate interaction:
  // reaching its exterior control box displays a prompt and E powers it.
  // It makes each of the three stops feel like an objective, rather than
  // silently completing while the player runs past it.
  levelKeyHooks.KeyE = () => lv3.vendor?.buy(playerVis.group.position);
  state.ammoReserve = 60; updateAmmoHUD();
  lv3.details = buildCompoundDetails(scene, SWITCH_DEFS);
  lv3.facility=buildQuarantineFacility(scene,null,addStaticBox,{night:state.timeOfDay==='night',backdrop:false}); // Level3Industry.js stands there instead
  levelKeyHooks.KeyG = () => readTerminal();
  initLevel3Story();
  initCureDevice();
  registerLevelPreTick(()=>{
    if(!lv3||lv3.phase==='done'||lv3.phase==='dispersion')return;
    // Mission encounters own spawning; keep the shared ambient spawner suppressed.
    state.spawnTimer=60;
    seedLevel3Combat();
    stabilizeInfected();
  });
  lv3.vendor=createLevel3Vendor({scene,state,addStaticBox,updateAmmoHUD,updateCoinHUD,feed:pushKillFeed,sfx});
  levelKeyHooks.KeyX = () => {
    if(!state.pointerLocked)return;
    if(state.currentWeapon==='cure')switchWeapon(lv3.pulse.previousWeapon||'gun');
    else {lv3.pulse.previousWeapon=state.currentWeapon;switchWeapon('cure');}
  };
  // No camera fly-through (it lagged): the level opens on Dr. James's story cards (playOpeningConversation)
  registerLevelTick(updateLevel3Mission);
  registerLevelTick((dt) => { updateBlinkingLamps(dt); updateSignFlicker(dt); }); // the faulty lamps, the works' flickering signs
}

let lv3 = null;

function seedLevel3Combat(){
  if(!state.readyShown||lv3.route.seeded)return;
  const initial=state.zombies.filter(z=>z.alive&&!z.isBoss);
  const routeEnemies=routeCap();
  for(let i=initial.length;i<routeEnemies;i++){
    const enemy=new Zombie(new THREE.Vector3());initial.push(enemy);state.zombies.push(enemy);state.spawnedTotal++;
  }
  initial.slice(0,routeEnemies).forEach((enemy,i)=>{
    enemy.mesh.position.set((i%4-1.5)*2.8,0,12-Math.floor(i/4)*5);
    enemy.speed=.95;enemy.mesh.rotation.y=0;
  });
  lv3.firstEncounter=initial[2];
  lv3.route.adoptOpening(initial);
}

async function playOpeningConversation(){
  const story=lv3.story;
  for(const event of OPENING_CONVERSATION){
    const answer=await story.narrative.show({...event,mode:event.choices?'choice':'cinematic',shot:null});
    if(answer===null)return;
    if(event.choices)story.intent=answer;
  }
  story.narrative.show({id:'humanity-field-brief',mode:'radio',speaker:'DR. JAMES / FIELD BRIEF',duration:12,text:'Fight through the road ambushes. Hold E at each switch and clear its attackers to secure it. Shoot or cure regular infected; the projector has five charges and six-metre range. The west-side vending machine sells 24 pistol rounds for 3 coins. The infected containment worker is immune to the cure and must be killed before you can broadcast.'});
}

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
const BOSS_SPAWN_OFFSET = new THREE.Vector3(0, 0, 16); // clear of the solid tower shell, inside the street corridor

function makeSwitchMarker(pos,key) {
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

  // A ground ring and physical control panel mark the objective in fog/night mode;
  // the control is intentionally visible before the player is in range.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.2, 24),
    new THREE.MeshBasicMaterial({ color: OFFLINE_COLOR, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 0.06, pos.z);
  scene.add(ring);
  const control = buildSwitchProp(pos,key,OFFLINE_COLOR);
  scene.add(control);

  return { beam, light, ring, control };
}

function activateSwitchMarker(marker) {
  marker.beam.material.color.set(CURE_COLOR);
  marker.light.color.set(CURE_LIGHT);
  marker.light.intensity = 2.6;
  marker.ring.material.color.set(CURE_COLOR);
  marker.control.userData.setProgress(1);
  marker.control.userData.indicator.material.color.set(CURE_COLOR);
  marker.control.userData.indicator.material.emissive.set(CURE_COLOR);
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
    // Utility buildings have concrete walls, not glowing apartment windows.
    const wall = new THREE.MeshStandardMaterial({color:0x737e7d,roughness:.94});
    const base = new THREE.MeshStandardMaterial({color:0x35484b,roughness:.9});
    shell.children[0].material=wall;
    shell.children[1].material=base;
    for(const child of [...shell.children])if(child.isGroup||child.isSprite||child.userData.neonSign)shell.remove(child);
    const accent=new THREE.MeshStandardMaterial({color:def.key==='generator'?0xaa8747:def.key==='cooling'?0x467a91:0x568273,roughness:.8});
    for(const y of [3.35,h-.35]){
      const band=new THREE.Mesh(new THREE.BoxGeometry(w+.12,.18,d+.12),accent);
      band.position.y=y;shell.add(band);
    }

    const marker = makeSwitchMarker(def.pos,def.key);
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
  if (lv3.phase === 'switches' && lv3.route.pending) {
    const encounter=lv3.route.active||lv3.route.queue[0];
    const living=[...(encounter?.targets||[])].filter(z=>z.alive&&z.state!=='cured');
    const target=living[0]||state.zombies.find(z=>z.alive&&!z.isBoss);
    dom.objective.textContent=`${encounter?.label||'Clear the route'} — ${lv3.route.outstanding||encounter?.remaining||0} remaining. Shoot or cure the attackers.`;
    state.compassOverride={pos:target?.mesh.position||playerVis.group.position,label:'CLEAR HOSTILES'};
  } else if (lv3.phase === 'switches') {
    dom.objective.innerHTML = remaining > 0
      ? `Objective: <b>Turn on the tower</b> — activate ${remaining} more switch${remaining === 1 ? '' : 'es'} (generator, cooling station, satellite uplink).`
      : `Objective: <b>All switches active</b> — return to the tower.`;
    const nextSwitch = lv3.compound.switches.find((s) => !s.activated);
    state.compassOverride = nextSwitch
      ? { pos: nextSwitch.pos, label: nextSwitch.label.toUpperCase() }
      : { pos: TOWER_POS, label: 'TOWER' };
  } else if (lv3.phase === 'boss') {
    dom.objective.innerHTML = `Objective: <b>Kill the Guardian</b> — evade its attacks and shoot the exposed brass chest valve.`;
    state.compassOverride = { pos: lv3.bossZombie?.mesh.position || TOWER_POS, label: 'GUARDIAN' };
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
  if (!sw || lv3.hold < 3 || lv3.route.pending || lv3.story.powerChoosing) return;
  lv3.hold = 0;
  sw.activated = true;
  lv3.lastSwitch = sw.key;
  activateSwitchMarker(sw.marker);
  sfx.burst(sw.key==='generator'?'triangle':'sine',sw.key==='generator'?165:sw.key==='cooling'?280:660,.22,.08);
  lv3.defendingSwitch=sw.key;
  lv3.route.enqueue({id:`defense-${sw.key}`,label:`Secure ${sw.label}`,count:10+(powerRoute(lv3.story.power)?.extraWave||0),switchKey:sw.key});
  if(lv3.story.power!=='floodlights')lv3.details.lights[SWITCH_DEFS.findIndex(d => d.key === sw.key)].color.setHex(0x55ff99);
  pushKillFeed(`${sw.label} alarm — clear the attackers to secure the switch`);
  writeObjective();

}

function updateSwitchInteraction(pos, t, dt) {
  const sw = nearbySwitch(pos);
  if (sw && !lv3.route.pending && !lv3.story.powerChoosing) {
    if (lv3.holdKey !== sw.key) { const previous=lv3.compound.switches.find(item=>item.key===lv3.holdKey); if(previous&&!previous.activated)previous.marker.control.userData.setProgress(0); lv3.hold = 0; }
    lv3.holdKey = sw.key;
    lv3.hold = state.keys.KeyE ? Math.min(3, lv3.hold + dt) : 0;
    sw.marker.control.userData.setProgress(lv3.hold / 3);
    dom.prompt.classList.remove('hidden');
    dom.promptText.textContent = `Hold E — ${sw.label} · ${Math.round(lv3.hold / 3 * 100)}% | G: research terminal`;
    sw.marker.ring.scale.setScalar(1 + Math.sin(t * 6) * 0.08);
    lv3.details.progress.hidden = lv3.hold === 0;
    lv3.details.progress.max = 3;
    lv3.details.progress.value = lv3.hold;
    if (lv3.hold >= 3) activateNearbySwitch();
  } else {
    if(lv3.holdKey){const interrupted=lv3.compound.switches.find(item=>item.key===lv3.holdKey);if(interrupted&&!interrupted.activated)interrupted.marker.control.userData.setProgress(0);}
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
const BOSS_SCALE = 3.2;

function startBossPhase() {
  if(lv3.phase!=='switches'||lv3.route.pending||!lv3.compound.switches.every(sw=>sw.activated))return false;
  lv3.phase = 'boss';
  lv3.waveRemaining = powerRoute(lv3.story.power)?.extraWave || 0;
  state.spawnTimer = 4;
  lv3.story.console.userData.indicator.visible = false;
  writeObjective();
  pushKillFeed('Power restored — something is coming.');
  consoleGlow(true);

  const boss=lv3.preparedBoss||createBossActor();
  lv3.preparedBoss=null;
  boss.mesh.position.copy(TOWER_POS).add(BOSS_SPAWN_OFFSET);
  boss.guardian.dormant=true;boss.guardian.panel.hidden=true;boss.mesh.visible=false;

  state.zombies.push(boss);
  state.spawnedTotal++;
  lv3.bossZombie = boss;
}

// Build the exact actor, animation bindings, effects and HUD under loading.
// The fight reveals this same instance, retaining its uploaded GPU resources.
async function prepareLevel3Guardian(){
  const boss=createBossActor();boss.guardian.dormant=true;boss.guardian.panel.hidden=true;
  boss.mesh.position.y=-10000;
  await boss.guardian.prepared;
  if(!boss.guardian.ready)throw boss.guardian.loadError||new Error('Guardian preparation failed');
  lv3.preparedBoss=boss;
  return boss.guardian.prepareForWarmup();
}
function createBossActor(){
  const spawnPos = TOWER_POS.clone().add(BOSS_SPAWN_OFFSET);
  const boss = new Zombie(spawnPos);
  boss.health = boss.maxHealth = Math.round(BOSS_MAX_HEALTH * (state.bossHealthMul ?? 1)); // Easy: a weaker Guardian
  boss.speed = .65; // Metres per second; matches the authored heavy walk cycle.
  boss.mesh.scale.setScalar(BOSS_SCALE);
  boss.isBoss = true;
  boss.baseSpeed = boss.speed; boss.minionThreshold = .75;
  presentGuardian(boss, {scene,state,sfx,damagePlayer,clampX:clampZombieX,obstacles:state.obstacles,
    onDefeated:()=>{lv3.guardianDefeated=true;lv3.phase='boss-fallen';lv3.fallenTime=1.5;lv3.waveRemaining=0;state.spawnTimer=4;}
  });

  boss.takeDamage = function bossTakeDamage(dmg, headshot, weakPoint = false) {
    if (!this.alive) return;
    const amount = this.guardian.damage(dmg ?? 20, weakPoint);
    if (!amount) return;
    this.health = Math.max(0, this.health - amount);
    while (this.health > 0 && this.minionThreshold > 0 && this.health / this.maxHealth <= this.minionThreshold) {
      lv3.waveRemaining = Math.min(6, lv3.waveRemaining + 4); this.minionThreshold -= .25;
      pushKillFeed('The guardian calls reinforcements');
    }
    spawnHitSpark(this.mesh.position.clone().add(new THREE.Vector3(0, headshot ? 2.2 : 1.6, 0)));
    spawnBlood(this.mesh.position);
    sfx.hit();
    state.shake = Math.max(state.shake, headshot ? 0.16 : 0.09);
    if (this.health <= 0) {
      lv3.waveRemaining = 0;
      this.confirmedKill(headshot);
    }
  };

  return boss;
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

function initCureDevice() {
  const panel = document.createElement('section'); panel.id = 'lv3-cure-tools';
  panel.innerHTML = `<style>
    #lv3-cure-tools{position:absolute;left:22px;bottom:126px;width:232px;padding:10px 12px;background:#07181ddd;border:1px solid #74b6c1;color:#e5f7fa;font:13px/1.4 Rajdhani,Arial,sans-serif;box-sizing:border-box;pointer-events:auto}
    #lv3-cure-tools[hidden]{display:none}#lv3-cure-tools button{width:100%;display:flex;justify-content:space-between;gap:12px;padding:0;border:0;background:transparent;color:#bff0ff;cursor:pointer;font:700 14px Rajdhani,Arial,sans-serif;letter-spacing:1px}#lv3-cure-tools button:disabled{cursor:default;color:#91a5aa}#lv3-cure-tools button:focus-visible{outline:2px solid #bff0ff;outline-offset:4px}
    #lv3-cure-tools small{display:block;margin-top:5px;color:#d6e6e9}#lv3-cure-tools [data-grid]{color:#9bb4ba;font-size:11px;border-top:1px solid #ffffff20;padding-top:5px;margin-top:7px}
    @media(max-width:700px){#lv3-cure-tools{left:12px;bottom:116px;width:210px;padding:8px 10px}}
  </style><button type="button" aria-label="Equip cure gun, 3 or X"><span>3 · CURE GUN</span><b data-charges></b></button><small data-status role="status"></small><small data-grid></small>`;
  dom.hud.append(panel);
  const material = new THREE.MeshBasicMaterial({color:CURE_LIGHT,transparent:true,opacity:.6,side:THREE.DoubleSide,depthWrite:false,fog:false});
  const ring = new THREE.Mesh(new THREE.RingGeometry(.93,1,48,1,Math.PI/2-CURE_HALF_ANGLE,2*CURE_HALF_ANGLE),material);ring.rotation.x=-Math.PI/2;ring.position.y=.07;
  const shell = new THREE.Mesh(new THREE.CircleGeometry(1,48,Math.PI/2-CURE_HALF_ANGLE,2*CURE_HALF_ANGLE),material.clone());shell.material.opacity=.08;shell.rotation.x=-Math.PI/2;shell.position.y=.065;
  const effect = new THREE.Group();effect.add(ring,shell);effect.visible=false;scene.add(effect);
  const points=[];for(let i=0;i<16;i++)points.push((rnd()-.5)*1.3,rnd()*1.8,(rnd()-.5)*1.3);
  const particleGeometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  const particleMaterial=new THREE.PointsMaterial({color:CURE_LIGHT,size:.07,transparent:true,depthWrite:false});
  const probe=new THREE.Points(particleGeometry,particleMaterial);effect.add(probe);
  for(const object of [ring,shell,probe])object.frustumCulled=false;
  registerLevelPreparation(()=>{
    effect.position.set(0,-1000,0);effect.visible=true;
    const gun=lv3.pulse.third,pivotVisible=playerVis.gunPivot.visible,culling=[];
    gun.visible=true;playerVis.gunPivot.visible=true;gun.traverse(o=>{if(o.isMesh){culling.push([o,o.frustumCulled]);o.frustumCulled=false;}});
    return()=>{effect.visible=false;effect.remove(probe);gun.visible=false;playerVis.gunPivot.visible=pivotVisible;for(const [o,value] of culling)o.frustumCulled=value;};
  });
  lv3.pulse={device:new CureDevice(),panel,button:panel.querySelector('button'),counter:panel.querySelector('[data-charges]'),status:panel.querySelector('[data-status]'),grid:panel.querySelector('[data-grid]'),effect,ring,shell,particleGeometry,particleMaterial,active:null,feedback:'',feedbackTime:0,ray:new THREE.Raycaster(),candidates:new RayCandidates(),origin:new THREE.Vector3(),target:new THREE.Vector3(),direction:new THREE.Vector3()};
  const third=buildCureProjector();third.visible=false;playerVis.gunPivot.add(third);
  const viewmodel=third.clone(true);viewmodel.position.set(.22,-.18,-.45);viewmodel.scale.setScalar(.75);registerLevelViewmodel(viewmodel);
  lv3.pulse.third=third;lv3.pulse.viewmodel=viewmodel;lv3.pulse.kick=0;
  registerLevelWeapon('cure',{label:'Cure projector',color:'#bff0ff',capacity:CURE_CHARGES,charges:()=>lv3.pulse.device.charges,fire:activateCurePulse,onSwitch:()=>updateCureDevice(0)});
  lv3.pulse.button.onclick=()=>switchWeapon('cure');
  updateCureDevice(0);
}

function pulseHasSight(enemy,centre) {
  const p=lv3.pulse;p.origin.copy(centre).y+=1.1;p.target.copy(enemy.mesh.position).y+=1.1;
  p.direction.subVectors(p.target,p.origin);const distance=p.direction.length();if(distance<.1)return true;
  p.ray.set(p.origin,p.direction.normalize());p.ray.near=.05;p.ray.far=Math.max(.05,distance-.1);
  return !p.ray.intersectObjects(p.candidates.query(state.occluders,p.ray.ray,p.ray.far),false).length;
}

function activateCurePulse() {
  if(!lv3?.pulse)return false;
  const p=lv3.pulse,blocked=state.currentWeapon!=='cure'||!state.readyShown||state.paused||state.isDead||state.dying||state.narrativeBlocked||state.cinematic||dom.hud.classList.contains('hidden')||!['switches','boss','boss-fallen','broadcast-ready'].includes(lv3.phase);
  const centre=playerVis.group.position.clone();
  const direction=camera.getWorldDirection(new THREE.Vector3());direction.y=0;direction.normalize();
  const visible=(z,pos)=>withinCureAim(z,pos,direction)&&pulseHasSight(z,pos);
  const result=p.device.activate(state.zombies,centre,{blocked,visible});
  if(!result.ok){
    if(result.reason!=='blocked'){p.feedback={empty:'No cure charges left.',cooldown:'Projector recharging.', 'no-targets':'Aim at exposed regular infected within 6 m.'}[result.reason];p.feedbackTime=2;}
    updateCureDevice(0);return false;
  }
  p.active={centre,direction,targets:new Set(result.targets),t:0,saved:0};p.effect.position.copy(centre);p.effect.rotation.y=Math.atan2(-direction.x,-direction.z);p.ring.scale.setScalar(.001);p.shell.scale.setScalar(.001);p.effect.visible=true;p.kick=1;
  p.feedback='Cure pulse released.';p.feedbackTime=2;
  sfx.burst('sine',330,.35,.08);updateCureDevice(0);return true;
}

function updateCureDevice(dt) {
  const p=lv3.pulse;if(!p)return;
  const blocked=state.paused||state.isDead||state.dying||state.narrativeBlocked||!state.readyShown;
  p.panel.hidden=!!blocked;
  if(!blocked){
    p.device.update(dt);p.feedbackTime=Math.max(0,p.feedbackTime-dt);
    const a=p.active;
    if(a){
      a.t+=dt;const fraction=Math.min(1,a.t/.8),radius=CURE_RADIUS*fraction;
      p.ring.scale.setScalar(Math.max(.001,radius));p.shell.scale.setScalar(Math.max(.001,radius));p.ring.material.opacity=.75*(1-fraction);p.shell.material.opacity=.1*(1-fraction);
      for(const z of a.targets){
        if(!z.alive){a.targets.delete(z);continue;}
        if(Math.hypot(z.mesh.position.x-a.centre.x,z.mesh.position.z-a.centre.z)<=radius&&withinCureAim(z,a.centre,a.direction)&&p.device.canReach(z,a.centre,pulseHasSight)){
          if(convertZombie(z,'pulse')){a.saved++;p.feedback=`Saved ${a.saved} infected · ${lv3.pulseSaved} before broadcast`;p.feedbackTime=2.5;}
          a.targets.delete(z);
        }
      }
      if(fraction===1){p.active=null;p.effect.visible=false;}
    }
  }
  const charges=`${p.device.charges} / ${CURE_CHARGES}`;if(p.counter.textContent!==charges)p.counter.textContent=charges;
  const equipped=state.currentWeapon==='cure';
  const status=p.feedbackTime>0?p.feedback:p.device.charges===0?'Empty · Q switches weapons':p.device.cooldown>0?`Recharging · ${Math.ceil(p.device.cooldown)}s`:equipped?'Aim + left-click · 6 m cure burst':'Q cycles · 3 or X equips';
  if(p.status.textContent!==status)p.status.textContent=status;
  const grid=powerRoute(lv3.story?.power);const gridText=grid?`GRID / ${grid.label.toUpperCase()}`:'GRID / CHOOSE AFTER GENERATOR';if(p.grid.textContent!==gridText)p.grid.textContent=gridText;
  p.button.disabled=!!blocked;
  p.kick=Math.max(0,p.kick-(blocked?0:dt*6));
  p.viewmodel.visible=!!(!blocked&&equipped&&state.firstPerson&&!state.cinematic);
  p.third.visible=!!(!blocked&&equipped&&!state.firstPerson&&!state.cinematic);
  p.viewmodel.position.z=-.45+p.kick*.04;p.viewmodel.rotation.x=p.kick*.05;
  p.third.rotation.y=playerVis.gunOnHand?Math.PI:0;p.third.position.set(0,playerVis.gunOnHand?.1:0,playerVis.gunOnHand?.05:0);
  for(const model of [p.viewmodel,p.third])model.getObjectByName('cure-projector-cure').material.color.setHex(p.kick>.65?0xd7ffff:0x78efff);
  if(equipped){const ammo=`${p.device.charges} / ${CURE_CHARGES}`;if(dom.ammo.textContent.replace(/\s+/g,' ').trim()!==ammo)updateAmmoHUD();}
}

function disposeCureParticles(z) {
  if(!z.cureParticles)return;
  scene.remove(z.cureParticles);z.cureParticles.material.dispose();z.cureParticles=null;
}

function updateCuredPeople(dt) {
  const settled=updateHumanRecovery(dt);
  for(const z of lv3.activeCures){
    z.cureTime=Math.min(1,z.cureTime+dt*.7);
    if(z.cureParticles){z.cureParticles.position.y+=dt*.65;z.cureParticles.material.opacity=1-z.cureTime;}
    if(z.cureTime>=1){disposeCureParticles(z);lv3.activeCures.delete(z);}
  }
  for(let i=state.zombies.length-1;i>=0;i--)if(state.zombies[i].state==='cured')state.zombies.splice(i,1);
  if(settled&&!lv3.story.firstRecovery&&!['dispersion','done'].includes(lv3.phase)){
    lv3.story.firstRecovery=true;lv3.story.narrative.show({id:'first-human-recovery',mode:'radio',speaker:'RECOVERING SURVIVOR',text:'Where am I? I can breathe again… thank you.',duration:5});
    lv3.story.narrative.show({id:'medical-collection',mode:'radio',speaker:'DR. JAMES',text:'They are breathing. Leave them somewhere safe; the infected will not target the recovering people. Our medical team will collect them once the broadcast is secure. Keep going.',duration:8});
  }
}

function startDispersion() {
  if (lv3.phase !== 'broadcast-ready' || !lv3.guardianDefeated) return;
  lv3.phase = 'dispersion';
  writeObjective();
  lv3.details.progress.hidden = true; lv3.details.note.hidden = true;
  lv3.story.logButton.hidden = true;
  lv3.story.encounterPanel.hidden=true;
  lv3.pulse.effect.visible=false;lv3.pulse.active=null;
  lv3.pulse.viewmodel.visible=false;lv3.pulse.third.visible=false;
  lv3.story.narrative.dispose();
  state.isDead = true; // freezes Actions.js's gameplay gate, not this level's own ticks
  state.firePressed = false; state.keys = {};
  viewmodelGun.visible = false; knifeViewModel.visible = false;
  playerVis.group.visible = false;
  dom.hud.classList.add('hidden'); dom.prompt.classList.add('hidden');
  for (const el of [dom.coinLabel,dom.weaponLabel,dom.shieldLabel,dom.bloodVig,dom.criticalPulse]) if (el) el.style.display = 'none';
  scene.traverse(o => { if (o.userData.level3Label) o.visible = false; });
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

  // Reuse a registered slot: changing the light count recompiles the city
  // during the cure and again when the victory screen opens.
  const flashLight = acquireEffectLight(CURE_LIGHT, 0, 90, 2);
  if (flashLight) flashLight.position.copy(TOWER_POS).setY(10);

  const finale = document.createElement('section');
  finale.id = 'lv3-finale';
  finale.innerHTML = `<style>
    #lv3-finale{position:fixed;inset:0;z-index:25;pointer-events:none;color:#ecf9fb;font-family:Rajdhani,Arial,sans-serif;background:linear-gradient(#030c124d,transparent 22%,transparent 64%,#030c12e8)}
    #lv3-finale .finale-signal{position:absolute;top:6%;left:7%;font-size:12px;letter-spacing:4px;color:#a9dce7;border-left:2px solid #a9dce7;padding-left:12px}
    #lv3-finale .finale-caption{position:absolute;bottom:8%;left:7%;right:7%;max-width:680px}#lv3-finale h2{font-family:Oswald,Arial,sans-serif;font-size:clamp(24px,4vw,44px);letter-spacing:4px;margin:0 0 8px}
    #lv3-finale p{font-size:clamp(15px,2vw,20px);line-height:1.5;margin:0;color:#dce8eb}#lv3-finale [data-cured]{display:block;margin-top:14px;font-size:12px;letter-spacing:3px;color:#a9dce7}
  </style><div class="finale-signal">DEADWAY CITY / BROADCAST LIVE</div><div class="finale-caption"><h2></h2><p></p><span data-cured></span></div>`;
  document.body.append(finale);
  const focus = [...lv3.savedInfected,...state.zombies.filter(z=>z.alive&&!z.isBoss)].filter(z => Math.abs(z.mesh.position.x) < 9 && z.mesh.position.distanceTo(TOWER_POS) < 55)
    .sort((a,b) => a.mesh.position.distanceToSquared(TOWER_POS)-b.mesh.position.distanceToSquared(TOWER_POS))[0];

  lv3.dispersion = {
    t: 0,
    wave,
    flashLight,
    radius: 0,
    caught: new Set(), // zombies already converted, so each is only processed once
    camGoal: TOWER_POS.clone().add(new THREE.Vector3(18, 10, 24)),
    lookTarget: camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(12).add(camera.position),
    lookGoal: new THREE.Vector3(),
    focus: focus ? focus.mesh.position.clone() : TOWER_POS.clone().add(new THREE.Vector3(0,0,16)),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    hero:null,heroCut:false,heroStart:0,heroPosition:new THREE.Vector3(),heroForward:new THREE.Vector3(),heroUp:new THREE.Vector3(),originalFov:camera.fov,
    finale, title: finale.querySelector('h2'), caption: finale.querySelector('p'), counter: finale.querySelector('[data-cured]'), beat: -1,
  };
}

function updateDispersion(dt) {
  const d = lv3.dispersion;
  d.t += dt;
  d.radius = Math.min(DISPERSION_MAX_RADIUS, d.t * DISPERSION_WAVE_SPEED);
  d.wave.scale.setScalar(Math.max(0.001, d.radius));
  d.wave.material.opacity = 0.55 * Math.max(0, 1 - d.radius / DISPERSION_MAX_RADIUS);
  lv3.compound.switches.forEach((sw,i) => { sw.marker.light.intensity = d.t > i*.45 ? 4 : 1; });
  if (d.flashLight) d.flashLight.intensity = 12 * Math.sin(Math.min(1, d.t / 1.2) * Math.PI);

  const beat = d.t < 2.3 ? 0 : d.t < 6.5 ? 1 : d.t < 10.5 ? 2 : 3;
  if (beat !== d.beat) {
    d.beat = beat;
    if(beat===3&&d.heroCut){camera.position.set(7,11,-172);d.lookTarget.set(0,5,-193);}
    // The floor wave is local; the completed transmission also reaches the
    // infected the player slipped past farther along the approach street.
    if(beat===2)for(const z of state.zombies)if(z.alive&&!z.isBoss)convertZombie(z);
    d.title.textContent = ['THE LAST BROADCAST', 'THE CURE IS SPREADING', 'SOMEONE COMES BACK', 'SIGNAL SECURE'][beat];
    d.caption.textContent = [
      'Cooling stable. Signal locked. The cure is on the air.',
      'The wave reaches the street. A way back from the infection.',
      lv3.savedInfected.size?'Breathing returns. The medical team is on its way.':'No one remains on this street. The broadcast keeps travelling.',
      `${powerRoute(lv3.story.power)?.ending || 'The cure is spreading.'} ${lv3.story.rescued ? 'The technician is guiding survivors to the shelter.' : 'The shelter signal remains unanswered.'}`
    ][beat];
    if (beat > 0) sfx.burst('sine', beat === 1 ? 392 : 523.25, .6, .045);
  }
  const counterText = `INFECTED CURED / ${lv3.curedCount || 0} · SAVED BEFORE BROADCAST / ${lv3.pulseSaved}`; if (d.counter.textContent !== counterText) d.counter.textContent = counterText;
  const lookGoal = d.lookGoal;
  if (beat === 3) { d.camGoal.set(7, 11, -172); lookGoal.set(0, 5, -193);camera.fov=d.originalFov;camera.updateProjectionMatrix(); }
  else if (beat === 0) { d.camGoal.set(7, 6, -179); lookGoal.copy(TOWER_POS).setY(12); }
  else { d.camGoal.set(THREE.MathUtils.clamp(d.focus.x + 5, -7, 7), 3.5, d.focus.z + 7); lookGoal.copy(d.focus).setY(1.1); }
  if(beat===2){
    if(!d.hero){
      const people=[...lv3.savedInfected].sort((a,b)=>(b.curedBy==='pulse')-(a.curedBy==='pulse'));
      d.hero=people.find(z=>survivorFrame(z,d.heroPosition,d.heroForward,d.heroUp))||null;
    }
    if(d.hero&&survivorFrame(d.hero,d.heroPosition,d.heroForward,d.heroUp)){
      d.camGoal.copy(d.heroPosition).addScaledVector(d.heroForward,.75);d.camGoal.y=Math.max(.8,d.camGoal.y+.7);lookGoal.copy(d.heroPosition);
      if(!d.heroCut){d.heroCut=true;d.heroStart=d.t;camera.position.copy(d.camGoal);d.lookTarget.copy(lookGoal);camera.fov=44;camera.updateProjectionMatrix();}
      // Reuse the broadcast's prepared light slot for a soft face fill at
      // night. This keeps recognition readable without changing light count.
      if(d.flashLight){d.flashLight.position.copy(d.camGoal);d.flashLight.position.y+=.2;d.flashLight.color.setHex(0xffe2c8);d.flashLight.distance=7;d.flashLight.intensity=1.2;}
      const waking=THREE.MathUtils.clamp((d.t-d.heroStart)/1.25,0,1);recognizeSurvivor(d.hero,waking);
      if(waking>.75)d.caption.textContent=d.hero.curedBy==='pulse'?'SURVIVOR: I remember you… Thank you. DR. JAMES: You are safe. Help is coming.':'SURVIVOR: I can think again… Thank you. DR. JAMES: Stay where you are. Help is coming.';
    }
  }
  if (d.reducedMotion) { camera.position.copy(d.camGoal); d.lookTarget.copy(lookGoal); }
  else { const blend = 1 - Math.exp(-dt * 1.8); camera.position.lerp(d.camGoal, blend); d.lookTarget.lerp(lookGoal, blend); }
  camera.lookAt(d.lookTarget);

  // Convert any living zombie the wave front has now reached.
  state.zombies.forEach((z) => {
    if (!z.alive || d.caught.has(z)) return;
    if (z.mesh.position.distanceTo(TOWER_POS) <= d.radius) {
      d.caught.add(z);
      convertZombie(z);
    }
  });

  if (d.radius >= DISPERSION_MAX_RADIUS && d.t + 1e-8 >= 12) {
    camera.fov=d.originalFov;camera.updateProjectionMatrix();
    scene.remove(d.wave); d.wave.geometry.dispose(); d.wave.material.dispose();
    releaseEffectLight(d.flashLight);
    d.finale.remove();
    for(const z of lv3.activeCures){disposeCureParticles(z);}lv3.activeCures.clear();
    lv3.dispersion = null;
    lv3.phase = 'done';
    showLevel3EndScreen();
  }
}

/** Replace the hostile rig with its matching human recovery asset.
    Saved people leave combat accounting without awarding kills or coins. */
function convertZombie(z,source='broadcast') {
  if(!z?.alive||z.isBoss||z.state==='cured')return false;
  z.cureTime = 0; z.cureBaseY = z.state === 'downed' ? 0 : z.mesh.position.y; z.cureMaterials = [];
  z.mesh.rotation.x = 0; z.mesh.position.y = z.cureBaseY;
  if(!beginHumanRecovery(z))return false;
  z.state = 'cured';
  z.curedBy=source;
  z.alive = false; // stops Zombie.update() and further raycasts against it
  z.recoveryProtected=true;z.takeDamage=()=>false;z.update=()=>{};z.mesh.visible=false;
  z.cureParticles = new THREE.Points(lv3.pulse.particleGeometry,lv3.pulse.particleMaterial.clone());
  z.cureParticles.position.copy(z.mesh.position); scene.add(z.cureParticles);
  sfx.pickup();
  lv3.curedCount = (lv3.curedCount || 0) + 1;
  if(source==='pulse')lv3.pulseSaved++;else lv3.broadcastCured++;
  lv3.savedInfected.add(z);lv3.activeCures.add(z);return true;
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
    style.textContent = `#lv3-winscreen{background:radial-gradient(ellipse at 50% 30%,#163039e8,#03090bf5 75%);padding:24px;box-sizing:border-box;overflow-y:auto}#lv3-winscreen .end-title{color:#bff0ff;text-shadow:0 0 30px #8fe0ff55;font-size:clamp(28px,5vw,56px);text-align:center}#lv3-winscreen .finale-eyebrow{font-size:12px;letter-spacing:5px;color:#93bfcb;margin-bottom:14px}#lv3-winscreen .finale-outcome{max-width:560px;text-align:center;color:#d3e5e9;line-height:1.6;margin:16px 0 8px}#lv3-winscreen .end-sub{max-width:700px;text-align:center;line-height:1.9;font-size:13px}#lv3-winscreen .run-summary{text-align:center}`;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'lv3-winscreen';
    el.className = 'end-screen hidden';
    el.innerHTML = `
      <div class="finale-eyebrow">TRANSMISSION COMPLETE / DEADWAY CITY</div>
      <h1 class="end-title">OUTBREAK REVERSED</h1>
      <p class="finale-outcome"></p>
      <div class="end-sub" id="lv3-win-stats"></div>
      <button onclick="location.reload()">Play Again</button>`;
    document.body.appendChild(el);
    lv3Win = el;
    lv3WinStats = el.querySelector('#lv3-win-stats');
  }
  lv3WinStats.textContent = `Zombies defeated: ${state.kills} · Infected cured: ${lv3.curedCount || 0} (pulse ${lv3.pulseSaved} / broadcast ${lv3.broadcastCured}) · Coins: ${state.coins}`;
  const route=powerRoute(lv3.story.power);
  lv3Win.querySelector('.finale-outcome').textContent = `The Guardian has fallen. The broadcast is live. ${route?.ending || ''} ${lv3.story.rescued ? 'The technician is waiting at the shelter for the people you brought back.' : 'The shelter signal remains unanswered.'}${lv3.pulseSaved ? ` You saved ${lv3.pulseSaved} infected before the tower came online.` : ''}`;
  lv3Win.querySelector('.finale-outcome').textContent += ' '+endingReflection({kills:state.kills,saved:lv3.curedCount,intent:lv3.story.intent,girlRescued:getGirlOutcome()==='caught'});
  lv3Win.classList.remove('hidden');
  lv3WinStats.textContent += ` · ${lv3.story.rescued ? 'Technician evacuated' : 'Rescue signal unresolved'} · ${lv3.story.power === 'floodlights' ? 'Floodlights restored' : lv3.story.power === 'safety' ? 'Safety systems restored' : 'Supply route opened'}`;
  lv3.story.narrative.dispose();
  finishRun('win', lv3Win);
}

/* ---------------------------------------------------------------------
   MASTER MISSION TICK
--------------------------------------------------------------------- */
function updateLevel3Mission(dt) {
  if (!state.readyShown || !lv3) return;
  if(lv3.awakening?.active){if(!state.paused)lv3.awakening.update(dt);return;}
  // Weapon switching is handled by the shared input listener even after
  // gameplay ends. Keep both overlays hidden throughout the finale.
  if (lv3.phase === 'dispersion' || lv3.phase === 'done') { viewmodelGun.visible = false; knifeViewModel.visible = false; }
  // The boss owns this encounter's pressure; ambient waves must not stack
  // on top of its threshold reinforcements or the broadcast handoff.
  if (['boss','boss-fallen','broadcast-ready'].includes(lv3.phase)) state.spawnTimer = 4;
  if (!state.paused) lv3.story.narrative.update(dt);
  if (!lv3.story.arrived && !dom.hud.classList.contains('hidden')) {
    lv3.story.arrived = true;
    writeObjective();
    void playOpeningConversation();
  }
  if(lv3.bossZombie?.guardian) lv3.bossZombie.guardian.panel.hidden = lv3.bossZombie.guardian.contained || state.isDead || state.paused || state.narrativeBlocked;
  updateCureDevice(dt);
  if(!state.paused&&!state.narrativeBlocked)updateCuredPeople(dt);
  if(state.paused||state.isDead||state.narrativeBlocked)lv3.story.encounterPanel.hidden=true;
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

  if (lv3.phase === 'boss-fallen') {
    state.spawnTimer = 4;
    lv3.fallenTime -= dt;
    if (lv3.fallenTime <= 0 && lv3.guardianDefeated) {
      lv3.bossZombie = null;
      lv3.story.console.userData.indicator.visible = true;
      lv3.phase = 'broadcast-ready'; writeObjective();
      lv3.story.narrative.show({id:'guardian-down',mode:'radio',speaker:'DR. JAMES',text:'The containment worker is dead. The broadcast controls are clear. Go to the facility console and press E to broadcast the cure.'});
    }
    return;
  }

  if (state.isDead || !playerVis) return;
  const pos = playerVis.group.position;
  const first=lv3.firstEncounter;
  lv3.story.encounterPanel.hidden=!first?.alive||pos.distanceTo(first.mesh.position)>13||lv3.phase!=='switches';
  lv3.elapsed += dt;
  updateCompoundGameplay(dt, pos);
  if (lv3.phase === 'switches') updateSwitchInteraction(pos, lv3.elapsed, dt);
  updateStoryInteractions(dt, pos);
  lv3.vendor.update(dt);
  if(lv3.vendor.nearby(pos)){dom.prompt.classList.remove('hidden');dom.promptText.textContent=lv3.vendor.product.stock?lv3.vendor.prompt:'Ammunition machine sold out';}
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
  'DR. JAMES / 01: One circuit remains after the tower is supplied. Floodlights brighten the compound but attract extra infected. Safety shuts down steam hazards. Supplies unlocks 36 emergency rounds. Choose one.',
  'DR. JAMES / 02: Press 3 or X to equip the cure projector; Q cycles weapons. Aim at regular infected and left-click to fire. Five charges, six-metre range. Walls block it. People you save stay cured. The Guardian is immune.',
  'DR. JAMES / 03: Turn on all three switches. Then kill the Guardian and press E at the tower control panel to spread the cure.'
];
function readTerminal() {
  if (!lv3 || state.isDead || state.paused) return;
  const i = SWITCH_DEFS.findIndex(s => s.pos.distanceTo(playerVis.group.position) < 4);
  if (i < 0) return;
  lv3.story.narrative.show({id:'research-'+i,mode:'radio',speaker:'DR. JAMES / RESEARCH '+(i+1),text:NOTES[i],duration:12});
}
// The most regular infected out at once: the route's eight, fewer on Easy (Difficulty.js)
function routeCap(){return Math.max(2,Math.round(MAX_ROUTE_ENEMIES*state.zombieCountMul));}
function spawnReinforcement(pos) {
  if (lv3.phase === 'boss' && state.zombies.filter(z => z.alive && !z.isBoss && z.state !== 'downed' && z.mesh.position.distanceTo(pos) < 24).length >= 4) return false;
  if (state.zombies.length >= 64 || state.zombies.filter(z => z.alive && !z.isBoss && z.state !== 'cured').length >= routeCap()) return false;
  // Retry clear street positions; never place an ambush on the player or inside cover.
  for(let attempt=0;attempt<16;attempt++){
    const side=rnd()<.5?-1:1;
    const spawn=new THREE.Vector3(side*(2.5+rnd()*1.5),0,THREE.MathUtils.clamp(pos.z+(rnd()<.5?-1:1)*(10+rnd()*5),-188,20));
    if(!lv3.spawnBoxes||lv3.spawnBodyCount!==world.bodies.length){
      lv3.spawnBodyCount=world.bodies.length;
      lv3.spawnBoxes=world.bodies.filter(b=>b.mass===0&&b.shapes.some(s=>s.type===4)).map(b=>{b.updateAABB();return b.aabb;});
    }
    if(spawn.distanceTo(pos)<7||lv3.spawnBoxes.some(b=>b.lowerBound.y<1.8&&b.upperBound.y>.1&&spawn.x>b.lowerBound.x-.65&&spawn.x<b.upperBound.x+.65&&spawn.z>b.lowerBound.z-.65&&spawn.z<b.upperBound.z+.65))continue;
    const enemy=new Zombie(spawn);enemy.combatRequired=true;state.zombies.push(enemy);state.spawnedTotal++;return enemy;
  }
  return false;
}
function stabilizeInfected() {
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
}
function updateCompoundGameplay(dt, pos) {
  stabilizeInfected();
  if (lv3.noteTime > 0) { lv3.noteTime -= dt; if (lv3.noteTime <= 0) lv3.details.note.hidden = true; }
  lv3.waveTimer -= dt;
  if (lv3.phase!=='switches' && lv3.waveRemaining > 0 && lv3.waveTimer <= 0) {
    if (spawnReinforcement(pos)) lv3.waveRemaining--;
    lv3.waveTimer = 1.7;
  }
  if(lv3.phase==='switches'){
    lv3.route.advance(pos);
    lv3.route.tick(dt,state.zombies,()=>spawnReinforcement(pos),encounter=>{
      pushKillFeed(`${encounter.label} cleared`);
      if(encounter.switchKey){lv3.defendingSwitch=null;void finishDefense(encounter.switchKey);}
      else if(!lv3.route.pending&&lv3.compound.switches.every(sw=>sw.activated))void finishDefense(lv3.lastSwitch);
      writeObjective();
    });
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
  const story=lv3.story={intent:'force',arrived:false,power:null,rescueAvailable:false,rescued:false,rescueStarted:false,rescueHold:0,cacheClaimed:false,shot:null,savedCamera:null};
  story.encounterPanel=document.createElement('aside');story.encounterPanel.id='first-cure-encounter';story.encounterPanel.hidden=true;story.encounterPanel.style.cssText='position:fixed;left:50%;bottom:18%;transform:translateX(-50%);max-width:440px;padding:12px 16px;background:#071317df;border:1px solid #789f9d;color:#d9eeeb;font:14px/1.5 Arial,sans-serif;text-align:center;z-index:18;pointer-events:none';story.encounterPanel.textContent='Clear the infected ahead. Shoot, melee, or use the cure gun: 3 / X, then left-click within 6 m. Five cure charges.';document.body.append(story.encounterPanel);
  story.consolePos=new THREE.Vector3(0,0,-187);
  story.rescuePos=new THREE.Vector3(-8.5,0,-164);
  story.cachePos=new THREE.Vector3(8,0,-151);
  story.narrative=createNarrative({
    onBlock:value=>{state.narrativeBlocked=value;state.keys={};state.firePressed=false;state.isSprinting=false;},
    onRelease:()=>{if(!state.isDead&&!state.paused)dom.canvas.requestPointerLock()?.catch(()=>{});},
    onShot:value=>{if(value){story.savedCamera={position:camera.position.clone(),quaternion:camera.quaternion.clone()};story.shot=value;}else{if(story.savedCamera){camera.position.copy(story.savedCamera.position);camera.quaternion.copy(story.savedCamera.quaternion);}story.shot=null;story.savedCamera=null;}}
  });
  story.logButton=document.createElement('button');story.logButton.className='dw-button quiet dw-log-button';story.logButton.textContent='Field log';document.body.append(story.logButton);
  story.logButton.onclick=()=>{if(!state.isDead&&!state.paused)story.narrative.openLog('Tower controls: hold E. G: research. Q: cycle weapons. 1: pistol / 2: knife / 3 or X: equip cure projector. Left-click: fire equipped weapon. Cure gun: five charges, 6 m, aim at regular infected. Road ambushes and switch defences must be cleared. Kill the Guardian to unlock the broadcast. The west-side vending machine sells 24 rounds for 3 coins. Optional rescue: hold E at the shelter. V changes view; Tab pauses.');};
  story.rescueMarker=buildInteractionProp(story.rescuePos,'shelter',0xe0a83c);
  story.cache=buildInteractionProp(story.cachePos,'supplies',0xe0a83c);
  story.console=buildInteractionProp(story.consolePos,'broadcast',0x8fe0ff);
  scene.add(story.rescueMarker,story.cache,story.console);
  story.technician=new THREE.Mesh(new THREE.CapsuleGeometry(.23,.85,4,8),new THREE.MeshStandardMaterial({color:0xc8b28f}));story.technician.position.copy(story.rescuePos).add(new THREE.Vector3(-.6,.85,0));scene.add(story.technician);
}
function updateStoryCamera(dt){
 const s=lv3.story;if(!s.shot)return;
 const goal=s.shot==='guardian'?new THREE.Vector3(9,5,-169):new THREE.Vector3(15,12,-177);
 const target=s.shot==='guardian'?new THREE.Vector3(0,2,-182):TOWER_POS.clone().setY(16);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 camera.position.lerp(goal,reduced?1:1-Math.exp(-2*dt));camera.lookAt(target);
}
function applyPowerRoute(id){
 const s=lv3.story,route=powerRoute(id);if(s.power||!route)return false;
 s.power=id;
 if(id==='supplies'){
   s.cache.userData.indicator.material.color.setHex(0x8fe0ff);
 }
 if(id==='floodlights'){
   // Reuse the control lamps so routing power does not change shader light counts.
   lv3.details.lights.forEach(light=>{light.color.setHex(0xe7f5ff);light.intensity=60;light.distance=28;});
   lv3.details.floodFixtures.forEach(fixture=>fixture.material.color.setHex(0xe7f5ff));
   lv3.route.enqueue({id:'floodlight-response',label:'Floodlight response',count:route.extraWave});
 }
 if(id==='safety')lv3.details.hazards.filter(h=>h.type==='steam').forEach(h=>h.mesh.visible=false);
 s.narrative.show({id:'power-online',mode:'radio',speaker:'TOWER / AUXILIARY CIRCUIT',text:route.summary+'. The broadcast circuit remains supplied.'});
 updateCureDevice(0);return true;
}

async function finishDefense(key){
 const s=lv3.story;
 if(s.powerChoosing)return;
 if(key==='generator'&&!s.power&&!s.powerChoosing){
   s.powerChoosing=true;
   const choice=await s.narrative.show({id:'power-routing',mode:'choice',speaker:'DR. JAMES / AUXILIARY POWER',title:'One circuit to spare.',text:'The tower has its power. Route the last spare circuit to one system. Floodlights improve visibility but attract stronger waves. Steam stays dangerous unless you choose safety.',choices:[{id:'floodlights',label:'Power the floodlights',detail:POWER_ROUTES.floodlights.summary},{id:'safety',label:'Restore safety systems',detail:POWER_ROUTES.safety.summary},{id:'supplies',label:'Open the supply route',detail:POWER_ROUTES.supplies.summary}]});
   s.powerChoosing=false;if(!powerRoute(choice))return;applyPowerRoute(choice);
 }
 if(key==='cooling'){
   s.rescueAvailable=true;s.rescueMarker.userData.indicator.material.color.setHex(0x8fe0ff);
   s.narrative.show({id:'rescue-signal',mode:'radio',speaker:'UNKNOWN / LOCAL SIGNAL',text:'Is anyone there? I am trapped by the cooling station. The shelter release is outside. Please — do not leave me here.'});
 }
 if(!lv3.route.pending&&lv3.phase==='switches'&&lv3.compound.switches.every(sw=>sw.activated)){
   startBossPhase();
   await s.narrative.show({id:'guardian-reveal',mode:'cinematic',speaker:'DR. JAMES / SIGNAL LOST',title:'Something heard us.',text:'The quarantine facility\'s containment worker is infected, and ruptured gas tanks are strapped across its back. Leave the marked circle when it braces; at range it sprays gas toward your position, so move before the burst lands. Shoot the glowing brass chest valve while it recovers. Below half health, it closes in faster.',shot:'guardian',continueLabel:'Fight the Guardian'});
   lv3.awakening=createGuardianAwakening({camera,state,scene,boss:lv3.bossZombie,sfx});
 }else writeObjective();
}
function updateStoryInteractions(dt,pos){
 const s=lv3.story;
 if(s.rescued){s.technician.position.x=THREE.MathUtils.lerp(s.technician.position.x,-11,Math.min(1,dt));s.technician.position.z=THREE.MathUtils.lerp(s.technician.position.z,-158,Math.min(1,dt));}
 let prompt='';
 if(s.power==='supplies'&&!s.cacheClaimed&&pos.distanceTo(s.cachePos)<2.5){prompt='Press E — emergency ammunition / +36 rounds';if(state.keys.KeyE){s.cacheClaimed=true;s.cache.visible=false;state.ammoReserve+=powerRoute(s.power).ammo;updateAmmoHUD();sfx.pickup();s.narrative.show({id:'cache-open',mode:'radio',text:'Emergency ammunition recovered. Make it count.'});}}
 if(s.rescueAvailable&&!s.rescued&&pos.distanceTo(s.rescuePos)<2.5){
   prompt=`Hold E — release shelter / ${Math.round(s.rescueHold/4*100)}%`;
   if(state.keys.KeyE){if(!s.rescueStarted){s.rescueStarted=true;if(lv3.phase==='switches')lv3.route.enqueue({id:'shelter-response',label:'Shelter defence',count:4});else lv3.waveRemaining=Math.min(6,lv3.waveRemaining+4);s.narrative.show({id:'rescue-start',mode:'radio',speaker:'SHELTER / RELEASE JAMMED',text:'The release is jammed. Keep holding it — the noise is drawing infected.'});}s.rescueHold=Math.min(4,s.rescueHold+dt);}else s.rescueHold=0;
   lv3.details.progress.max=4;lv3.details.progress.value=s.rescueHold;lv3.details.progress.hidden=s.rescueHold===0;
   if(s.rescueHold>=4){s.rescued=true;s.rescueMarker.visible=false;lv3.details.progress.hidden=true;s.narrative.show({id:'rescue-complete',mode:'radio',speaker:'TECHNICIAN / SAFE',text:'I am clear. Thank you. I will guide anyone who comes back toward the shelter. Get that broadcast running.'});}
 }else{if(s.rescueHold>0)lv3.details.progress.hidden=true;s.rescueHold=0;}
 if(lv3.phase==='broadcast-ready'&&pos.distanceTo(s.consolePos)<3){prompt='Press E — broadcast the cure / completes this mission';if(state.keys.KeyE)startDispersion();}
 if(prompt){dom.prompt.classList.remove('hidden');dom.promptText.textContent=prompt;}
 else if(lv3.phase==='broadcast-ready')dom.prompt.classList.add('hidden');
}
