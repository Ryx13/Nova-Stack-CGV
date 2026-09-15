// Level3Config.js — LEVEL 3 SKIP FLAGS
//
// MUST be imported BEFORE Scene.js, characters.js, etc. so the skip
// flags are set before those modules evaluate their top-level code —
// same requirement Level2Config.js documents (characters.js checks
// state.skipCar at module load time to decide whether to build the
// vehicle system).
import { state } from './state.js';

// The Broadcast Tower compound is reached on foot from the north end of
// the main street (Level 1/2's shared base scene) — no vehicle segment
// in this design, so skip the car system entirely, same as Level 2.
state.skipCar = true;
// Level 3 has no depot/ingredient objective — that already happened in
// Level 1, and Level 2 was the chase for the antidote's last component.
// This level's objective (three switches, then the boss, then the
// dispersion) is entirely owned by Level3.js's own mission tick.
state.skipDepot = true;

// NOT set here (unlike Level2Config.js): lazyExplosionVFX / lightBoot.
// Level 2 needed those because its loading-critical fetch set was
// racing the girl NPC's own assets. Level 3 doesn't add new GLBs beyond
// what Level 1 already fetches, so the eager boot path is fine as a
// first pass — worth revisiting only if the compound ends up adding new
// models later (see Level3.md, "What's omitted / next").
