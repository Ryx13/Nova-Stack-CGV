# Level 2 — "The Chase"

Pursue a girl carrying the antidote through an abandoned town to a distant
port. She runs at player walk speed (3.7 m/s); win by catching her (E within
2.2 m), lose if she reaches the pier and teleports away. Everything lives in
**Level2.js** (+ `Level2Config.js` skip flags); shared-module hooks are
no-ops for Levels 1/3.

## Current state (2026-09-12)

Playable end-to-end: full chase (spawn → pier), catch/lose outcomes,
economy, HUD and the spawn escalation all work. The loading-time work
is done — light boot ships, boot-critical fetches are ~18 MB, Levels 1/3
untouched.

Girl visibility was the big fix of this pass. `Injured Run.glb` turned
out to be anim-only — a Mixamo skeleton + run clip with zero meshes — so
she rendered as literally nothing (the moving pink floor tint was just
her glint light). She's now a bright procedural mannequin body attached
to her real bones, driven by the real run clip, with a per-bone
counter-scale for the file's 0.01 Armature scale; the 10 m head start
and 25 m pink sight glow ride on top of it.

Still to verify on the next play-through: her run orientation
(`GIRL_RIG_YAW_OFFSET` — flip to `Math.PI` if she runs backwards),
mannequin proportions read at street distance, and the pink glow
cutting exactly at 25 m.

## What's implemented

- **Chase** — girl NPC (visible 10 m head start — she bolts from directly
  in front of the player the moment the loading screen clears, waypoint
  route to the pier), catch win, teleport-lose cinematic; the chase starts
  on the first live frame, never behind the loading screen
- **Sight glow** — within 25 m of the player she pulses hot pink
  (emissive + her glint light): unmistakable against the dark zombies;
  beyond it she reverts to the subtle teal runner — sight is limited,
  and the radar machine sells tracking beyond it
- **Girl body (procedural)** — `Injured Run.glb` is anim-only (skeleton +
  clip, no meshes), so a bright mannequin figure — pale top, slate legs,
  skin head/hands — is attached to her real Mixamo bones and driven by
  the run clip; per-bone counter-scale handles the file's 0.01 Armature
  scale, and limbs articulate free because each capsule parents to the
  upper bone of its pair
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

## Suggestions — what to improve next

**Visuals & feel**
- Replace the mannequin with a meshed Mixamo re-export (same rig, with
  skin) — the procedural body was the fallback that became the feature
- Lose-cinematic polish: pink flash + fog burst at the teleport instead
  of the instant vanish
- Directional footstep audio while she's out of sight — sells "close"
  without radar, and gives the radar purchase a clear before/after

**Gameplay**
- Rubber-band pacing: she's a flat 3.7 m/s — let her hesitate at corners
  and surge when the player closes inside ~8 m, so the chase stays tense
  at any skill level
- Tie the spawn ramp (6 s → 1.2 s) to route checkpoints with killfeed
  warnings, so escalation feels authored rather than automatic
- Coin fly-to-HUD pickup animation — makes kills-fund-purchases readable
  at a glance

**Performance**
- Cap device pixel ratio (~1.5) — the rain shader is fill-rate heavy
- Fewer shadow-casting streetlights / smaller shadow maps at night
- Merge or instance static geometry (containers, bollards, rocks)
- Drive the HUD via the lv2HUD setters instead of the 400 ms poll
