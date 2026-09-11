# Level 2 — "The Chase"

Design doc for Level 2. The code lives in **Level2.js** — one file carries
everything the level owns (scene dressing, HUD, girl NPC, purchases,
adrenaline, mission system). This document holds the design brief and
implementation catalog that previously lived as the header comment block in
that file, extracted so the code reads as mostly code.

## The level

The player pursues a girl carrying a critical substance through an abandoned
town toward a distant port. She moves at the player's normal walking speed
(3.7 m/s), so the advantage comes from route choice and power-ups, not from
her being slower. Danger escalates as the port gets closer — denser zombies,
tighter routes, more obstacles, more pressure.

Two ways to lose:

1. Zombies kill the player.
2. The girl reaches the port and teleports away with the antidote.

**Win:** get so close you occupy her position and press **E** to grab the
substance.

## Key controls (Level 2 specific)

| Key | Action |
| --- | --- |
| `E` | Interact with vending machines / grab the substance from the girl |
| `G` | Activate adrenaline (purchased from the mid-level vending machine) |

Everything else is the shared control scheme (index.html controls grid).

## Zone map

z runs from spawn +40 down to the port −208. The six base barriers
(z = −20, −44, −68, −92, −116, −140) are untouched — difficulty comes from
density and clutter, not new barriers.

| Zone | z range | Content |
| --- | --- | --- |
| Outskirts | +40 → −20 | as built by the base scene (safe start) |
| Entrance | −20 → −70 | radar machine (z −25), street blockage (z ≈ −57, east-curb squeeze), west pocket shortcut entrance |
| Centre | −70 → −120 | adrenaline machine (z −90), denser street clutter |
| Collapse | −120 → −165 | eastern lot rubble nest (where the Level-1 depot yard was skipped) + coin cache risk/reward |
| Final Approach | −165 → −196 | tightest wreck chokepoints, burning wrecks lighting the way |
| Port | −196 → −208 | quay, water, cranes, containers, warehouses, ship silhouettes, and the teal teleport beacon at the pier end — the girl's escape point (lose) |

The port must read from the level start as "distinctive gloom + eerie teal
glow" through ~200 m of fog: the glow elements (pier light column, crane-top
beacons, teleport ring) use unfogged materials — `createToxicMaterial()` /
`fog: false` — so they stay visible where ordinary surfaces fog out. See the
SCENE DRESSING section in Level2.js for the implementation notes.

## Not loaded (loading-time cuts)

`Level2Config.js` sets skip flags before the heavy modules evaluate, so
Level 2 never builds:

- Car / vehicle system — the level is entirely on foot
- Depot yard + depot guards — no sample-recovery objective
- Extraction point (ring/light) — win by catching the girl, not extracting
- Fuel system / fuel HUD — no car means no fuel
- Speedometer — no vehicle speed to display

One large asset is deferred rather than cut: the explosion VFX model
(18.8 MB) fetches on the first barrel explosion instead of at boot
(`state.lazyExplosionVFX` in PowerUps.js), so it never competes for
bandwidth with the player/zombie models gating the loading screen. The
first explosion is light-only; every later one gets the full VFX.

Levels 1 and 3 never set the flags, so they load everything as before.

## File layout

`Level2.js`, top to bottom: level config + `startLevel()` → scene dressing
builders (port set piece, street blockage, collapse zone, vending machines,
coin economy) → girl NPC + route → purchases → adrenaline → mission system
(win/lose, teleport cinematic, zombie escalation) → reference HUD.

Supporting modules:

- `Level2Config.js` — skip flags; imported before everything else
- `VendingMachine.js` — the reusable display-only machine (cabinet, screen,
  shelf cards, catalog browsing; no input/currency/physics by design)
- `saferoomSupplyCatalog.js` — example full-stock supplies preset
- Extension hooks in the shared modules (all no-ops for Levels 1/3):
  `Actions.js` — `registerLevelTick()` + `levelKeyHooks` (E/G dispatch) and
  the ×1.45 adrenaline multiplier in `updatePlayerMovement`; `Scene.js` —
  `compassOverride` and the teal girl dot in `drawRadar`; `state.js` — the
  mission fields (`girlPos`, `girlCaught`, `portReached`, `hasRadarUpgrade`,
  adrenaline charges/active/timer, `compassOverride`)

## Implementation catalog

The original TODO list, complete — kept as the map of what lives where in
Level2.js.

### Environment

- [x] Town layout tweaks — main-street blockage at z ≈ −57 (wreck-pile
      squeeze, east-curb gap) makes the west pocket a real shortcut —
      `buildStreetBlockage()`
- [x] Port area — quay, teal water, gantry cranes, container yard,
      warehouses, ship silhouettes, and the pier teleport beacon (unfogged
      teal glow readable from the level start through the fog) —
      `buildPort()`
- [x] Escalating obstacles — collapse-zone rubble nest in the eastern lot
      (z −120 → −165) + final-approach wreck chokepoints with burning
      wrecks; density-based, the six base barriers untouched —
      `buildCollapseZone()` / `buildZoneDressing()`
- [x] Denser zombie spawns near the port, ramping with the girl's progress
      — `updateMission`'s own spawn timer (6 s → 1.2 s) on top of the base
      2.5 s interval

### Girl NPC

- [x] Girl model — `Injured Run.glb` placeholder (single Mixamo run clip,
      tinted + faintly emissive so she reads against the fog; any
      single-clip rigged GLB drops in via `GIRL_GLB`)
- [x] Waypoint path — spawn (0, −45), the locked 60 m head start →
      blockage east-curb gap → collapse-zone weave → final-approach
      gauntlet → quay → pier → teleport beacon — `GIRL_WAYPOINTS`
- [x] Movement AI — fixed 3.7 m/s (player walk speed, per the locked
      design), waypoint follow, faces travel direction, never stops —
      `updateGirl`
- [x] Catch mechanic — proximity check (< 2.2 m ≈ occupying her position)
      + E key → ANTIDOTE SECURED win screen — `catchGirl` / `handleKeyE`
- [x] Teleport VFX — camera lerps to frame her at the pier beacon, teal
      flash sphere + light burst, she dissolves into the beam, then the
      YOU LOST THE ANTIDOTE screen — `startLoseCinematic` /
      `updateLoseCinematic`

### Vending machines

- [x] `VendingMachine.js` — reusable display module at the project root
      (cabinet + screen + shelf cards + catalog browsing via `setSelection`;
      display-only by design — no input/currency/physics)
- [x] Host interaction wrapper — proximity check (2.6 m), E key, coin cost
      + purchase validation, live prompt via `dom.prompt`; collision via
      `addStaticBox` (auto-registers on the zombie avoidance list)
- [x] Level 2 catalog presets — radar + adrenaline products in the
      "support" category — `radarCatalog` / `adrenalineCatalog`
- [x] Machine beacons — each machine's position glows through the fog in
      its own color (lime = radar, pink = adrenaline): a ground ring at
      the stand-here spot, a pulsing light column from the cabinet top
      (tops out below the port's teal spire, which stays the main
      landmark), and a point light washing the cabinet front. Cabinet
      scale 1.6 (~3.2 m tall) so it reads at distance
- [x] Radar machine — (z ≈ −25, west sidewalk). 25 coins, one-time:
      purchasing reveals the girl on the radar (teal dot), the HUD
      girl-distance row, and retargets the compass to her
- [x] Adrenaline machine — (z ≈ −90, west sidewalk). 45 coins, stock 3:
      purchasing stores a charge (inventory slot lights up); activation
      with G is the adrenaline system

### Adrenaline

- [x] G activation — consume a stored charge for +45% speed, 10 s full
      duration (no stamina-drain change); countdown shown live in the
      inventory slot label — `handleKeyG` / `updateAdrenaline`

### Mission / HUD

- [x] HUD — reference-style Level 2 layout (`buildLevel2HUD`): top-left
      objectives list (◆ catch the girl / ☐ reach the port), port distance
      under the radar circle, icon health/stamina bars (blue stamina),
      bottom-right inventory panel (radar + adrenaline slots with live
      counts, coin total), kills mirrored in the objectives list. Scoped
      via `body.lv2-hud` — Level 1/3 unchanged
- [x] Radar upgrade — purchased from the start-area vending machine.
      Until bought, the radar only shows zombies as usual and the compass
      points at the port. Once bought, the radar also shows the girl's
      position (teal dot, rim-clamped so her direction always shows) and
      the HUD's live girl-distance row is revealed — key intel for gauging
      the time left in the chase
- [x] Mission system — inline in Level2.js (`updateMission`) rather than a
      sibling module, per the everything-in-Level2.js rule: tracks the
      girl's progress to the port, win/lose checks, extra zombie spawns,
      killfeed beats
- [x] "YOU LOST THE ANTIDOTE" screen — shown ~3.7 s into the teleport
      cinematic (2.2 s approach + 1.5 s flash), with chase stats
- [x] Compass retargeted — PORT from the start, GIRL after the radar
      purchase (instead of depot/extraction)
- [x] Killfeed messages for key events — head start, girl spotted, closing
      in, nearing port, final stretch, purchases, adrenaline
      ready/active/worn off

### State / integration

- [x] `state.js` additions — girlPos, girlCaught, portReached,
      hasRadarUpgrade, adrenalineCharges/Active/Timer, compassOverride
      (all default-off — Levels 1/3 untouched)
- [x] `Actions.js` additions — `registerLevelTick()` registry called from
      `animate()` outside the gameplay gate, `levelKeyHooks` (E/G
      dispatch), adrenaline ×1.45 in `updatePlayerMovement`
- [x] Tick callbacks — `updateGirl`, `updateVendingInteraction`,
      `updateAdrenaline`, `updateMission` all registered from
      `startLevel()` (mission last, so the girl-catch prompt wins
      overlapping machine prompts)
