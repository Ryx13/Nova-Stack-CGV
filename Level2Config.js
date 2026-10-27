// Level2Config.js — LEVEL 2 SKIP FLAGS
//
// MUST be imported BEFORE Scene.js, characters.js, etc. so the skip
// flags are set before those modules evaluate their top-level code.
// characters.js checks state.skipCar at module load time to decide
// whether to build the vehicle system.
import { state } from './state.js';

state.skipCar = true;
state.skipDepot = true;
// Defer the 18.8 MB explosion VFX GLB to the first barrel explosion —
// fetched at boot it competes for bandwidth with the player/zombie
// models that gate the loading screen (PowerUps.js handles both paths).
state.lazyExplosionVFX = true;
// Light boot: the only GLBs fetched before the loading screen clears
// are the two it actually waits on (player + walker zombie template).
// The runner-variant zombie template and the pistol model stream in
// once gameplay is running (characters.js loadDeferredAssets, armed by
// Level2.js on state.readyShown), corpse dressing rides the walker
// template's cache entry, and the three decor GLB props
// (old_rusty_car_2.glb ×2, zombie_variant_b.glb ×1) become procedural
// wrecks / a Level2.js fallen-zombie prop. Cuts the boot-critical
// fetch set from ~62 MB of racing downloads to ~18 MB.
state.lightBoot = true;
// Day mode is a clear, sunlit afternoon here rather than the shared
// overcast drizzle: no fog bank or ground haze, no falling rain (puddles
// stay, still), and the streetlights are off — see applyTimeOfDay in
// Scene.js and makeStreetlight in characters.js.
state.clearDay = true;
// Night is moonlit: no city glow, a low moon over the port and cool
// moonlight from it (moonNight in Scene.js's time-of-day presets).
state.moonlitNight = true;
// ...and the buildings with it: along the street ~38% have collapsed,
// ~26% are wrecked dark shells with one lit window, a few stand dark with
// two, and ~28% are the original blocks with their own windows; each
// added lit window throws a shaft of light (loadBuildings / addLitWindows
// in characters.js; the back city does the same in Level2Surroundings.js).
state.deadGridNight = true;
// Night: the grid is mostly dead. Of the 21 lamp posts only these 5
// still have power (each one a SpotLight, the costliest thing in the
// night shader), spread ~48 m apart down the street and alternating
// sides, the last one by the port; the 3 with blink: true are faulty
// and stutter. Every other post
// stands dark — see makeStreetlight / updateBlinkingLamps in characters.js.
state.liveStreetlights = [
  { side: -1, z: 24 },               // the spawn
  { side: 1, z: -24, blink: true },
  { side: -1, z: -72 },
  { side: 1, z: -120, blink: true }, // edge of the collapse zone
  { side: -1, z: -192, blink: true }, // the last post, by the quay
  // The harbour town's (CityLayout.js harbour): Harbour Square, Gull Park
  // and the promenade either side of the quay
  { side: 1, z: -116 }, { side: 1, z: -152, blink: true }, { side: -1, z: -172 },
  { side: -1, z: -189 }, { side: 1, z: -189 },
];
// The street is battle-damaged (broken tops, blown corners, shopfronts),
// and the two blocks flanking the collapse zone (z -120 → -165) came down:
// the east one over the zone's own rubble piles, the west one opposite —
// see RUINED CITY in characters.js. Both spill onto the pavement only.
// The west block ahead-left of the spawn (z ~12) came down too: it stood
// between the start and the low sun. It keeps its rubble on its own lot
// (the radar machine stands on the pavement in front of it) and has its
// own seed so it doesn't reshuffle every later building's damage.
state.ruinedCity = true;
// ...but the harbour town stands whole for now (CityKit.js 'harbour', its
// plan in CityLayout.js): the street-front lots get its buildings, the
// collapse lot is Harbour Square, and the flags above only keep every
// shared rnd() draw where it was. Buildings will come down mid-level.
state.cityKit = 'harbour';
// Sidewalk spots the town's terraces and stands must leave free: the radar
// machine and the fallen-zombie prop (Level2.js buildLevel2Scene)
state.kitKeepOff = [{ x: -13.4, z: 10, r: 2 }, { x: -13.2, z: -95, r: 2 }];
state.collapsedBlocks = [
  { side: 'east', z0: -140, z1: -152 },
  { side: 'west', z0: -136, z1: -148 },
  { side: 'west', z0: 18, z1: 7, spill: false, seed: 0x5EED_5C1 },
];
// The first burning roadside wreck (10 m ahead of the spawn) is a real
// car model rather than boxes: up close the box car read as a black lump
// in the sun. Streams in with the other deferred assets (lightBoot).
// `strip`: node-name prefixes to drop — this export's 4 m ground card,
// and its glass, which wouldn't survive the fire.
// The city carries on behind the street-front rows: blocks thinning out
// toward the mountains (Level2Surroundings.js) in place of the stock
// skyline boxes.
state.backCity = true;
// Burning wrecks are fully alight: flames along the whole car and a
// strong flickering light (at night — by day the sun is the only light)
state.bigFires = true;
// The runner zombies (model-rigged.glb) are three times as fast here:
// ~13-19 m/s, beyond a sprint (8.4) and even adrenaline (12.2)
state.runnerSpeedMul = 3;
state.burningCarModel = { url: 'assets/old_rusty_car_2.glb', length: 4.4, strip: ['Plane001', 'Object002'] };
