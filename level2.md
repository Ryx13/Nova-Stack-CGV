# Level 2 — "The Chase"

Pursue a girl carrying the antidote through an abandoned town to a distant
port. She runs at player walk speed (3.7 m/s); win by catching her (E within
2.2 m), lose if she reaches the pier and teleports away. Everything lives in
**Level2.js** (+ `Level2Config.js` skip flags); shared-module hooks are
no-ops for Levels 1/3.

## What's implemented

- **Chase** — girl NPC (visible 50 m head start, waypoint route to the
  pier), catch win, teleport-lose cinematic; the chase starts on the first
  live frame, never behind the loading screen
- **Economy** — two beaconed vending machines (radar @ z +10, lime;
  adrenaline @ z −90, pink), E-key purchases, coins from kills + persistent
  clusters; radar upgrade reveals her on radar/compass + live distance row,
  adrenaline (G) gives ×1.45 speed for 10 s
- **World** — port set piece with teal teleport beacon, street blockage
  squeeze, collapse zone, final-approach chokepoints, escalating zombie
  spawns (6 s → 1.2 s)
- **HUD** — reference layout scoped to `body.lv2-hud`: objectives panel,
  teal radar (N marker + target blip), angled panels, inventory slots
- **E / G keys**, killfeed beats, win/lose screens with chase stats

## What's omitted (loading-time cuts)

- Car / vehicle system, fuel HUD, speedometer — the level is on foot
- Depot yard + guards, extraction point — no sample-recovery objective
- Explosion VFX (18.8 MB) — deferred to the first barrel explosion
- Result: ~62 MB cold boot vs ~81 MB before (measured from the actual
  file sizes — the earlier "~47 MB" figure undercounted the eager
  fetches); Levels 1/3 unchanged

## Light boot (implemented)

- Decor GLB props replaced procedurally: two roadside rusty cars →
  `makeWreck()` at the same spots (8.1 MB), one posed-zombie street
  prop → Level2.js `makeFallenZombie()` (13.3 MB)
- Runner zombie variant (14.4 MB), pistol model (10.3 MB) and corpse
  dressing deferred to a level tick that fires the moment
  `state.readyShown` flips — gameplay is already running by then;
  corpses ride the walker template's cache entry (same GLB file), so
  they cost zero extra bytes
- Gate is `state.lightBoot` (set in Level2Config.js): characters.js
  checks it at module-eval and boot time; Levels 1/3 keep the eager
  path untouched
- Boot-critical fetch set drops to ~18 MB (player 11.2 + walker 4.4 +
  barrel 0.4 + girl 0.1 + engine/JS) — nothing races the gating pair
  anymore; the deferred ~25 MB streams in behind gameplay. Total bytes
  transferred are unchanged — the win is ordering, not deletion.

## To add — performance

- Cap device pixel ratio (~1.5) — the rain shader is fill-rate heavy
- Fewer shadow-casting streetlights / smaller shadow maps at night
- Merge or instance static geometry (containers, bollards, rocks)
- Drive the HUD via the lv2HUD setters instead of the 400 ms poll
