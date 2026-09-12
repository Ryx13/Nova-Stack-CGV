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
