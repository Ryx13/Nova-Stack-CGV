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
// The street is battle-damaged (broken tops, blown corners, shopfronts),
// and the two blocks flanking the collapse zone (z -120 → -165) came down:
// the east one over the zone's own rubble piles, the west one opposite —
// see RUINED CITY in characters.js. Both spill onto the pavement only.
state.ruinedCity = true;
state.collapsedBlocks = [
  { side: 'east', z0: -140, z1: -152 },
  { side: 'west', z0: -136, z1: -148 },
];
