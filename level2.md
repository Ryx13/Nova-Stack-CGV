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
- Result: ~47 MB cold boot vs ~79 MB before; Levels 1/3 unchanged

## To add — faster loading

- Drop the decor car template (7.9 MB — two roadside props; replace with
  procedural `makeWreck()` equivalents)
- Drop the posed-zombie street prop (13 MB — one decoration; replace with a
  procedural corpse)
- Defer the pistol model (10 MB — fetched at boot but never gates the
  loading screen; fetch after `readyShown` like the explosion VFX)
- Together these take a cold boot from ~47 MB to ~16 MB (keep player
  10.9 MB, walker 4.3 MB, runner 14 MB — those are gameplay)

## To add — performance

- Cap device pixel ratio (~1.5) — the rain shader is fill-rate heavy
- Fewer shadow-casting streetlights / smaller shadow maps at night
- Merge or instance static geometry (containers, bollards, rocks)
- Drive the HUD via the lv2HUD setters instead of the 400 ms poll
