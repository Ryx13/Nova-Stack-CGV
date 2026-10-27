/* ======================================================================
   state.js — SHARED GAME STATE

   The original game.js was a single script where every variable lived in
   one shared top-level scope. Splitting that into separate files while
   keeping the exact same behavior means these cross-cutting, frequently
   mutated values need one shared home that every module can read AND
   write. This file is that shared mechanism (see refactor notes, section
   15: "if a shared state/system is needed by multiple modules, create an
   appropriate shared mechanism rather than creating duplicate versions of
   the state").

   Every other module imports `state` and reads/writes its properties
   directly, e.g. `state.playerHealth -= 10`. Nothing here changes any
   gameplay value — it's purely a container.
====================================================================== */

export const state = {
  // Live-tunable facing offsets (I / O / P in-game cycle these 90°).
  ZOMBIE_RIG_YAW_OFFSET: 0,
  PLAYER_RIG_YAW_OFFSET: Math.PI,
  CAR_RIG_YAW_OFFSET: Math.PI,

  // Mission / objective state
  stage: 1, // 1 = clear the route, 2 = recover the sample, 3 = extract
  ingredientCollected: false,

  // Day / Night — chosen on the mode-select screen (main.js) right after
  // a level is picked. 'night' is the original look the game already
  // had; 'day' is the new alternative. Scene.js reads this to drive
  // lighting/sky/fog, and to decide whether rain + puddles are active.
  timeOfDay: 'night',
  // Set by a level's config (Level2Config.js) to swap Day mode's overcast
  // drizzle for a clear sunlit day — see applyTimeOfDay in Scene.js.
  clearDay: false,
  // Set by Level1.js: Day mode borrows Level 2's low-sun look (painted sky,
  // sun shadows, warm grade, daylight facades, lamps off) but keeps Level 1's
  // own drizzle, puddles and burning-wreck smoke — see warmDay in Scene.js.
  warmDay: false,
  // Set by Level1.js to ease the street: fraction of the usual infected
  // (cap, opening pack, spawn rate, depot guards) and of the damage their
  // hits deal. 1 = the stock balance, which Levels 2/3 keep.
  zombieCountMul: 1,
  zombieDamageMul: 1,
  // Set by a level's config (Level2Config.js): street-row buildings are
  // battle-damaged (broken tops, blown corners, shopfronts) and the
  // blocks named in collapsedBlocks [{ side, z0, z1 }] lie in ruins —
  // see RUINED CITY in characters.js.
  ruinedCity: false,
  collapsedBlocks: null,

  // Run tracking (account.js / cloud.js): which level is running, how
  // long it has been actively played (paused/dead time excluded), and
  // whether this run's result has already been reported.
  levelId: null,
  runTime: 0,
  runReported: false,


  // Score / progress
  kills: 0,
  coins: 0,
  killStreak: 0,
  spawnedTotal: 0,
  // 3s of calm before the first infected spawns — a fresh run used to
  // have one closing in almost immediately (see Actions.js boot note).
  spawnTimer: 3,

  // Player state
  playerHealth: 100,
  playerMaxHealth: 100,
  heartbeatTimer: 0, // counts down to next low-health heartbeat pulse; see updateLowHealthFX
  // Post-hit damage grace (seconds, see damagePlayer in Actions.js) —
  // caps how fast a whole pack can chew through health.
  hurtGrace: 0,
  playerStamina: 100,
  staminaExhausted: false, // set when stamina hits 0; cleared once it recovers past STAMINA_RECOVER
  isDead: false,
  paused: false,
  narrativeBlocked: false,
  walkCycle: 0,
  footTimer: 0,
  crouching: false,
  isSprinting: false,
  playerMoving: false,
  playerFacingAngle: 0,
  playerActionLock: 0,
  meleeTimer: 0,
  bobPhase: 0,
  currentSpeed: 3.7,
  sprintToggle: false,
  lastWTapTime: 0,
  playerScaleOverride: 1, // roster characters are measured in their true
                          // world size, so PLAYER_TARGET_HEIGHT applies as
                          // is (the old player_character.glb needed 0.5).
                          // Still live-adjustable with [ / ] against the
                          // debug readout's meters display.
  playerBaseScale: 1,
  playerCurrentHeight: 0,

  // Weapon / combat state
  currentWeapon: 'gun', // 'gun' | 'knife'
  ammoMag: 30,
  ammoReserve: 90,
  reloading: false,
  reloadTimer: 0,
  fireCooldown: 0,
  gunGripIndex: 0,

  // Input state
  keys: {},
  pointerLocked: false,
  yaw: 0,
  pitch: -0.08,
  recoilPitch: 0,
  firstPerson: false,

  // Vehicle state
  inVehicle: false,
  carSteer: 0,
  carThrottle: 0,
  rolloverTimer: 0,
  carFuel: 100, // topped up to CAR_MAX_FUEL in characters.js

  // Shield state
  shieldActive: false,
  shieldTimer: 0,
  shieldDuration: 15,
  shieldRadius: 0, // set fresh each activation (PowerUps.js) — also used by
                    // characters.js to keep zombies from walking through it

  // Misc scene feel
  shake: 0,

  // Collections shared across modules (mutated in place — push/splice —
  // never reassigned, so importing modules always see the live contents)
  zombies: [],
  obstacles: [], // {x, z, r} for zombie avoidance
  occluders: [], // meshes the third-person camera raycasts against
  pickups: [], // {mesh, type, life}
  powerups: [], // {mesh, type, life}
  coinPickups: [], // {mesh, life}
  explosiveBarrels: [],
  activeExplosions: [],
  activeSparks: [],
  activeTracers: [],
  smokeGroups: [],

  // Asset loading progress
  loadFlags: { player: false, zombie: false, car: false },
  readyShown: false,
  cinematic: false,
  dying: null,        // { t, eaters, camFrom } while overrun, before the death screen (Actions.js)   // a level intro owns the camera; gameplay holds (Level2Intro.js)

  // Skip flags — set by Level2Config.js (or similar) BEFORE heavy modules
  // like characters.js evaluate. Checked at module top level to skip
  // creating systems the level doesn't need (car, depot, extraction).
  skipCar: false,
  skipDepot: false,
  // Defer the 18.8 MB explosion VFX model to the first actual barrel
  // explosion instead of fetching it at boot (PowerUps.js). Level 2 sets
  // this via Level2Config.js; Levels 1/3 keep the eager boot-time load.
  lazyExplosionVFX: false,

  // Level 2 light boot: before the loading screen clears, fetch ONLY the
  // two models it actually waits on (player + walker zombie template).
  // The runner-variant zombie template, the pistol model, and corpse
  // dressing are deferred until gameplay is already running
  // (characters.js loadDeferredAssets, triggered by Level2.js once
  // state.readyShown flips), and the three decor GLB props (two rusty
  // cars + one posed zombie) are replaced with procedural equivalents.
  // Set by Level2Config.js before characters.js evaluates. Levels 1/3
  // keep the eager behavior unchanged.
  lightBoot: false,

  // Level 2 — "The Chase" mission state (girl NPC, purchases). All
  // default-off/inactive so Levels 1/3, which never touch them, are
  // unaffected: adrenalineActive is false so the movement multiplier
  // stays 1.0, girlPos/compassOverride are null so the compass and
  // radar keep their stock depot/extraction behavior.
  girlPos: null,           // live THREE.Vector3 of the girl NPC (Level 2 only)
  girlCaught: false,       // win condition
  portReached: false,      // lose condition — she made the pier beacon
  hasRadarUpgrade: false,  // bought from the radar machine — girl intel on
  adrenalineCharges: 0,    // stored, unactivated purchases
  adrenalineActive: false, // currently boosted
  adrenalineTimer: 0,      // seconds of boost left

  // Compass retarget — when a level module sets this, updateCompass()
  // points here instead of depot/extraction.
  // Shape: { pos: THREE.Vector3, label: string }
  compassOverride: null,
};

/* Everything a single run changes, captured with its starting value
   before any module touches it. resetRunState() puts it all back so a
   level can restart in place (Actions.js restartLevel) instead of
   reloading the page. Level config (skip flags, multipliers, time of
   day), loading flags and player preferences (view mode, scale, grip)
   are deliberately left out — they belong to the session, not the run. */
const RUN_KEYS = [
  'stage', 'ingredientCollected', 'runTime', 'runReported',
  'kills', 'coins', 'killStreak', 'spawnedTotal', 'spawnTimer',
  'playerHealth', 'heartbeatTimer', 'hurtGrace', 'playerStamina', 'staminaExhausted',
  'isDead', 'paused', 'narrativeBlocked', 'walkCycle', 'footTimer', 'crouching',
  'isSprinting', 'playerMoving', 'playerFacingAngle', 'playerActionLock', 'meleeTimer',
  'bobPhase', 'currentSpeed', 'sprintToggle', 'lastWTapTime',
  'currentWeapon', 'ammoMag', 'ammoReserve', 'reloading', 'reloadTimer', 'fireCooldown',
  'yaw', 'pitch', 'recoilPitch',
  'inVehicle', 'carSteer', 'carThrottle', 'rolloverTimer', 'carFuel',
  'shieldActive', 'shieldTimer', 'shieldDuration', 'shieldRadius', 'shake',
  'cinematic', 'dying',
  'girlPos', 'girlCaught', 'portReached', 'hasRadarUpgrade',
  'adrenalineCharges', 'adrenalineActive', 'adrenalineTimer', 'compassOverride',
];
const runDefaults = Object.fromEntries(RUN_KEYS.map((k) => [k, state[k]]));

export function resetRunState() {
  Object.assign(state, runDefaults);
  state.keys = {};
  state.firePressed = false;
  state.deathInfection = undefined;
}