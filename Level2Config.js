// Level2Config.js — LEVEL 2 SKIP FLAGS
//
// MUST be imported BEFORE Scene.js, characters.js, etc. so the skip
// flags are set before those modules evaluate their top-level code.
// characters.js checks state.skipCar at module load time to decide
// whether to build the vehicle system.
import { state } from './state.js';

state.skipCar = true;
state.skipDepot = true;
