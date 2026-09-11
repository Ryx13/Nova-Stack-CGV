// Level2.js — THE CHASE
//
// The player pursues a girl carrying a critical substance through an
// abandoned town toward a distant port. She moves at the player's normal
// walking speed, so the advantage comes from route choice and power-ups,
// not from her being slower. Danger escalates as the port gets closer —
// denser zombies, tighter routes, more obstacles, more pressure.
//
// Two ways to lose:
//   1. Zombies kill the player.
//   2. The girl reaches the port and teleports away with the antidote.
//
// Win: catch the girl (occupy her position) and press E to grab the substance.
//
// Key controls (Level 2 specific):
//   E — Interact with vending machines / Grab substance from the girl
//   G — Activate adrenaline (purchased from mid-level vending machine)
//
// =====================================================================
//  TODO — Scene & Level Implementation
// =====================================================================
//
// ENVIRONMENT
//  [ ] Town layout tweaks — adjust existing street geometry, add blocked
//      shortcuts and alternate routes leading toward the port
//  [ ] Port area — build the port destination at the far end of the map
//      with a distinctive gloom effect (heavy fog, colored lighting)
//  [ ] Escalating obstacles — place tighter barriers and more debris
//      closer to the port
//  [ ] Denser zombie spawns near the port, increasing over time as the
//      girl approaches
//
// GIRL NPC
//  [ ] Girl model — load or procedurally build a running female character
//  [ ] Waypoint path — define her route from spawn to port (after scene
//      layout is finalized)
//  [ ] Movement AI — fixed speed, simple obstacle avoidance, no stopping
//  [ ] Catch mechanic — proximity check (occupy her position) + E key
//  [ ] Teleport VFX — camera pans to girl at port, she teleports away
//      with a visual effect on loss
//
// VENDING MACHINES
//  [ ] VendingMachine.js — reusable module (procedural 3D model, coin
//      cost, cooldown, proximity prompt, E to interact)
//  [ ] Radar machine — near start area. Purchasing shows girl's position
//      on radar and her distance to the port
//  [ ] Adrenaline machine — mid-level. Purchasing stores the buff;
//      player activates with G for a temporary speed boost (full duration)
//
// MISSION / HUD
//  [ ] Radar upgrade — purchased from the start-area vending machine.
//      Until bought, the radar only shows zombies as usual. Once bought,
//      the radar also shows the girl's position (distinct color) and a
//      live readout of her distance to the port. This is a key intel
//      tool — without it the player has no way to gauge how much time
//      they have left in the chase.
//  [ ] Level2Mission.js — track girl's progress to port, check win/lose
//      conditions each frame
//  [ ] "YOU LOST THE ANTIDOTE" screen — shown when girl reaches port,
//      with camera showing her teleport
//  [ ] Compass retargeted to point at the girl instead of depot/extraction
//  [ ] Killfeed messages for key events (girl spotted, adrenaline ready,
//      port getting close, radar purchased, etc.)
//
// STATE / INTEGRATION
//  [ ] state.js additions — vendingMachines[], adrenalineActive,
//      adrenalineTimer, girlCaught, portReached, hasRadarUpgrade
//  [ ] Actions.js additions — tick callback registry for Level 2 systems,
//      E key (interact), G key (activate adrenaline)
//  [ ] Tick callbacks — updateGirl(), updateVendingMachines(),
//      checkLevel2Conditions() registered into the game loop


// NOT LOADED (cut for faster loading — not needed for this level's design):
//  - Car / vehicle system — Level 2 is entirely on foot
//  - Depot yard + depot guards — no sample-recovery objective
//  - Extraction point (ring/light) — win by catching the girl, not extracting
//  - Fuel system / fuel HUD — no car means no fuel
//  - Speedometer — no vehicle speed to display
//
// =====================================================================

import './Level2Config.js';  // MUST be first — sets skip flags before heavy modules
import './Scene.js';
import './characters.js';
import './PowerUps.js';
import './shaders.js';
import { bootLevel } from './Actions.js';

const LEVEL_CONFIG = {
  id: 2,
  name: 'Level 2 — The Chase',
  skip: { car: true, depot: true, extraction: true },
};

export function startLevel(mode) {
  bootLevel({ ...LEVEL_CONFIG, mode });
}
