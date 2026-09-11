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
