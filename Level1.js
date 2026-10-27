// Level1.js — LEVEL 1 ENTRY POINT
//
// Level 1, Level 2, and Level 3 all currently load the exact same base
// scene (per the refactor request: "do not create three completely
// different scene systems... Level 1, Level 2, and Level 3 should all
// use the same base scene. Later, I will modify each level individually").
// This file is intentionally thin — it's the place level-specific
// settings/gameplay changes for Level 1 go, without touching the
// shared Scene/characters/Actions/PowerUps systems.
import './Scene.js';
import './characters.js';
import './PowerUps.js';
import './shaders.js';
import { bootLevel } from './Actions.js';
import { state } from './state.js';
import { startLevel1Intro } from './Level1Intro.js';
import { registerDayProgress } from './DayCycle.js';
import { KILL_TARGET } from './Scene.js';
import { playerBody } from './characters.js';

// Day mode borrows Level 2's low-sun afternoon (sky, sun shadows, warm
// grade, daylight facades, lamps off) but keeps Level 1's own drizzle,
// puddles and burning-wreck smoke — see warmDay in Scene.js.
state.warmDay = true;

// An easier street: half as many infected (cap, opening pack, spawn rate,
// depot guards) and their hits do half the damage, so reaching the depot
// is a fight you can win rather than a swarm.
state.zombieCountMul = 0.5;
state.zombieDamageMul = 0.5;

const LEVEL_CONFIG = {
  id: 1,
  name: 'Level 1',
};

// Campaign clock (DayCycle.js): the kills, the sample, and how far down the
// street toward extraction (spawn z 30, extraction z -196) you've got
registerDayProgress(() => {
  const along = Math.min(1, Math.max(0, (30 - playerBody.position.z) / 226));
  return 0.35 * Math.min(1, state.kills / KILL_TARGET) + (state.ingredientCollected ? 0.25 : 0) + 0.4 * along;
});

export function startLevel(mode) {
  bootLevel({ ...LEVEL_CONFIG, mode });
  // The fly-through briefing: gameplay holds from here until it ends
  startLevel1Intro();
}
