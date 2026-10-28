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

// This level occupies industrial quarantine grounds, with the city in the distance.
state.quarantineFacility = true;
// Over the compound walls: the headland's works (Level3Industry.js), in
// place of the stock skyline boxes
state.industrialDistrict = true;
// By day the street lamps are off (characters.js makeStreetlight): the only
// lights left are the three switch beacons and the tower console's
state.dayLampsOff = true;
// At night, 10 of the street's 20 posts are lit, one every 24 m on
// alternating sides; five of them, picked at random each play, flicker
state.liveStreetlights = [24, 0, -24, -48, -72, -96, -120, -144, -168, -192]
  .map((z, i) => ({ side: i % 2 ? 1 : -1, z }));
