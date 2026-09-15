# Level 3 — "The Broadcast Tower"

Hybrid of both ideas on the table: teammate's gameplay loop (approach 3
buildings, flip a switch in each, then fight a boss) delivers the
narrative payoff from the original storyline (the collected concoction
disperses as a wave that turns nearby infected back into people). The
tower is the console that ties the two together — it's offline until
all 3 switches are on, powering it up is what draws the boss, and
beating the boss is what lets the player actually trigger the
dispersion. Everything lives in **Level3.js** (+ `Level3Config.js` skip
flags); shared-module hooks are no-ops for Levels 1/2, same as Level 2's
own hooks are no-ops here.

## The three phases

1. **Switches** — a generator room, a cooling station, and a satellite
   uplink, staggered up the last stretch of the main street. Each has a
   clearly labelled exterior control pedestal; walk within 3.4m and
   press **E** to activate it. The compass retargets to whichever is
   next; once all three are lit, it points at the tower. The controls
   deliberately sit outside the buildings' physics volumes — never at a
   building centre — so every objective is reachable and visible.
2. **Boss** — the moment the third switch goes on, the tower's console
   glows and something big spawns south of the tower. Standard combat
   (gun/melee/knife all work — it's targetable through the normal
   raycast because it's a real `Zombie` instance, see "How the boss is
   built" below) until it goes down.
3. **Dispersion** — gameplay freezes (same mechanism as Level 2's
   teleport-lose cinematic) and a wave expands out from the tower.
   Every zombie it reaches stops being hostile and its materials tint
   toward a human skin tone — first-pass version of "the light turns
   them back," see "What's simplified" below. Ends on a dedicated win
   screen, "OUTBREAK REVERSED."

## How the boss is built

`tryShoot`/`tryMelee`/`tryKnife` in Actions.js only raycast/range-check
against `state.zombies` — there's no separate enemy-type system to hook
into. So the boss is a real `new Zombie(pos)` (same model loading, same
idle/chase/attack state machine every infected uses), then tuned like a
bigger, tankier version of it — this is the exact pattern
`characters.js`'s own `spawnDepotGuards()` already uses to make the
depot guards tougher than street zombies (`z.health = z.maxHealth = …`,
`z.speed *= …`, `z.mesh.scale.setScalar(…)`), just pushed further.

**One thing worth flagging in review**: the base `Zombie.takeDamage` in
this build sets health straight to `0` regardless of the `dmg`
argument passed in — every hit is a one-shot kill for ordinary
infected (matches how the game currently plays; whether that's meant
to line up with the README's "stagger, don't delete" description is a
separate question, not something Level 3 touches). A boss needs to
actually survive multiple hits, so Level3.js replaces `takeDamage` on
**that one boss instance only** — `boss.takeDamage = function(dmg,
headshot) { this.health -= dmg; … }` — leaving the shared `Zombie`
class and every ordinary infected, in every level, completely
untouched.

Ambient zombie spawns are paused for the boss phase by continually
pushing `state.spawnTimer` back out from Level 3's own tick — no edit
to Actions.js's spawn call, just a level tick outcompeting it every
frame while the boss is alive.

## Known constraint — why the buildings are laid out the way they are

`characters.js`'s `clampZombieX(x, z)` only lets infected wander off the
~10m-wide main street corridor in two existing pockets: near
`DEPOT_POS` and near `WEST_POCKET_Z`. Anywhere else, a zombie's x
position gets clamped back onto the corridor every single frame —
**including the boss**, since it's a real `Zombie` under the hood. A
wide, circular compound with buildings far off to either side would
leave them permanently unable to path to you there.

Rather than edit that shared function (every level's zombies run
through it), Level 3's tower and all 3 switch buildings are kept inside
the existing corridor width (`|x| ≲ 12`) — a staggered zig-zag up the
final stretch instead of a wide open compound. If the team wants a
wider layout later, the one-line fix is adding a third exemption band
to `clampZombieX`, mirroring its existing two:
```js
if (Math.abs(z - TOWER_POS.z) < 24) return x; // Level 3 compound
```
placed so its z-range doesn't overlap `DEPOT_POS`'s or `WEST_POCKET_Z`'s
existing bands. Flagging this now rather than silently working around
it so it's a deliberate call, not a surprise during a later merge.

## What's simplified (first pass, playable end to end)

- **"Turn back into humans"** — converted zombies stop moving/attacking
  and their existing meshes tint toward a skin tone in place, rather
  than swapping to a distinct unarmed-human model. The team doesn't
  have a second civilian model yet; this reads clearly enough as "no
  longer hostile" for a vertical slice. Swap-in path once/if a human
  NPC model exists: replace the material-tint block in `convertZombie()`
  with a mesh swap, everything else (the wave, the catch radius, the
  win screen) stays the same.
- **Boss has no unique attack pattern** — it inherits the standard
  infected idle/chase/attack state machine at boosted health/speed/
  scale, not a scripted moveset. The "hard" comes from raw HP (tuned to
  roughly 2 full mags of sustained accurate fire) plus whatever ambient
  zombies are still alive from the switches phase when it spawns.
- **No new HUD panel** — reuses the existing objective text / compass
  arrow (`dom.objective`, `state.compassOverride`) that Level 1 already
  has on screen, written directly per-phase, rather than building a
  second reference-style panel the way Level 2 did for its distance/
  inventory display. Simpler, and this level doesn't have an economy to
  show.
- **No new assets fetched** — tower/switch buildings reuse the shared
  `makeBuilding()` (same window texture/geometry family as every other
  building on the street) plus small procedural extras (antenna mast,
  dish, pedestal markers). Nothing in `Level3Config.js` mirrors Level
  2's `lazyExplosionVFX`/`lightBoot` optimizations yet since no new GLBs
  were added — worth revisiting if that changes.

## Suggestions — what to improve next

**Feasibility check first** — none of this has run in a browser yet
(no renderer in the environment it was written in). Before anything
else: load it, confirm the switch markers/tower/boss all appear where
expected, and in particular re-check the exact x/z numbers in
`SWITCH_DEFS`/`TOWER_POS` against where the shared street's own
procedurally-placed buildings land (`characters.js`'s `loadBuildings()`
uses its own RNG seed, so its building footprints aren't something this
pass could compute by hand) — nudge positions if anything overlaps.

**Visuals & feel**
- Give the boss a distinct silhouette (recolor/rescale further, or a
  different template weighting) so it reads as "the boss" at a glance
  before the health bar even registers — right now it's the same model
  family as street zombies, just bigger.
- A boss health bar in the HUD — right now the only feedback is hit
  sparks and how long it's taking.
- Sound cue the instant the third switch goes on (distinct from the
  regular pickup chime) so the boss's arrival doesn't feel silent.

**Gameplay**
- A real boss moveset (a telegraphed lunge/slam with a longer cooldown
  than regular attacks) once the base fight feels right — deliberately
  deferred so the core 3-phase loop could ship and be tested first.
- Tune `BOSS_MAX_HEALTH`/`BOSS_SCALE` against actual playtesting — the
  numbers here are a starting estimate (~2 mags), not measured.
- Consider letting a switch's proximity range scale down slightly per
  switch (tighter on the last one) so the final approach feels more
  precise than the first.

**Integration**
- `main.js`'s `LEVEL_LOADERS` already points `3: () => import('./Level3.js')`
  at this file by convention — confirm the level-select screen's button
  for Level 3 is no longer disabled/placeholder once this is dropped in.
