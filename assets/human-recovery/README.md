# Human recovery asset

The two GLBs match the game’s zombie variants: `human_walker.glb` is based on
`zombie_running_on_metel_maniac.glb` (66 bones), and `human_runner.glb` on
`model-rigged.glb` (52 bones). They retain the source meshes, face details,
UV layout and clothing. The editable Blender project keeps the original source
collections alongside the human-ready versions and authors a `recover` pose.
It opens with the two human variants separated side by side at a shared
standing scale, set to their final grounded resting poses. The source
collections start hidden in viewport and render; enable them to compare the
untouched source models. An inspection camera and ground plane are included,
and the armatures and actions remain editable.

The recovery atlases now retain the source facial detail with neutral human
skin tones, selected by the actual skin polygons' UV coverage. Clothing and
hair retain their source appearance. The walker mask/fins accessory is removed
from cured runtime clones; the infected asset remains intact. These are still
the original stylized low-polygon bodies, not photorealistic replacement people.

`SurvivorFace.js` adds measured, head-bound eyes and eyelids for both variants.
Resting people keep their eyes closed; `recognizeSurvivor` opens them for the
ending shot. Face details share geometry/materials and are hidden beyond 12 m.
The one-time shader warmup includes these features before gameplay begins.

`HumanRecovery.js` loads both GLBs with `GLTFLoader` using URLs relative to the
module. Call `await preloadHumanRecovery()` first. Then call and await
`prepareHumanRecovery(renderer, scene, camera)` before the initial world
compile. It adds visible, offscreen skinned warmup clones and returns a
synchronous cleanup function that removes only those clones. Do not use that
cleanup to dispose gameplay recoveries.

Call `beginHumanRecovery(zombie)` when a cure starts. It returns `true` when a
preloaded, rigged zombie is accepted; `zombie.runs` selects the matching human
GLB. Call `updateHumanRecovery(dt)` each frame. It returns `true` once when a
recovery completes, then the clone holds the resting pose and breathes.
`disposeHumanRecovery()` is the separate level teardown API.

The original pose generator is `art/build_human_recovery.py`. The subsequent
texture refinement recipe and audit are preserved in the Codex task workspace
under `work/level3-polish-20261022/skin`. The editable Blender source includes
the final neutral skin maps; original Source collections are retained hidden.
