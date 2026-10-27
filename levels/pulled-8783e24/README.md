# Levels 1 and 2: restored pull 8783e24

The root Level1.js and Level2.js entry points route to this snapshot. Game-engine modules come from the selected pull; Level 3 continues to use the current root engine.

state.js, account.js, Music.js and roster.js bridge to unchanged, source-identical host services (apart from line endings) so menu/character selection, sessions, mute settings and level state remain shared. PowerUps.js has one URL adjustment to use the pulled explosion asset stored here. All other reachable engine source files match the selected commit exactly. See manifest.json.

This deliberately restores the behavior of that pull, including its existing Level 2 merging/instancing and deferred loading. Keep this snapshot separate from future Level 3-only edits.
