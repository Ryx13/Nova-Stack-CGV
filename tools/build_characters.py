r"""
Build the game's character assets from the Mixamo sources in art/.

  art/characters/<name>_rigged.fbx  ->  assets/characters/<name>.glb
      mesh + Mixamo skeleton, no animation (one per playable character)
  art/animations/<clip>.fbx         ->  assets/characters/animations.glb
      every clip on one shared Mixamo skeleton, each named after its file
      (walk.fbx -> "walk"). All characters share the skeleton, so the game
      loads this once and plays any clip on any character.
  art/citizens/<id>_rigged.fbx      ->  assets/citizens/<id>.glb
      the city's people, infected in-game (Citizens.js); same skeleton
  art/zombie_animations/<clip>.fbx  ->  assets/citizens/zombie_animations.glb
      the citizens' own clips (zombie_walk, ...), kept apart so the
      player's start-up download doesn't grow
  art/story/<name>_rigged.fbx       ->  assets/story/<name>.glb
      the story's people (Dr. James), lightened like the citizens but
      never infected
  art/animations/Standing Idle.fbx  ->  assets/story/standing_idle.glb
      Dr. James's pose in the safe room, its own small file (left out of
      the players' animations.glb)

Run from the repo root (PowerShell):
  & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P tools\build_characters.py
Citizens and their clips only, leaving the player's files as they are:
  & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P tools\build_characters.py -- citizens
Dr. James's standing pose only:
  & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P tools\build_characters.py -- pose
"""
import glob
import os
import re
import sys
import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_CHARS = os.path.join(ROOT, "art", "characters")
SRC_ANIMS = os.path.join(ROOT, "art", "animations")
OUT = os.path.join(ROOT, "assets", "characters")
SRC_CITIZENS = os.path.join(ROOT, "art", "citizens")
SRC_ZOMBIE_ANIMS = os.path.join(ROOT, "art", "zombie_animations")
OUT_CITIZENS = os.path.join(ROOT, "assets", "citizens")
SRC_STORY = os.path.join(ROOT, "art", "story")
OUT_STORY = os.path.join(ROOT, "assets", "story")
STORY_POSE = os.path.join(SRC_ANIMS, "Standing Idle.fbx")


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    # Mixamo numbers the namespace when one session downloads several
    # characters (mixamorig1:, mixamorig7:); every clip is keyed to plain
    # mixamorig:, so rename to that (Blender carries the skin weights along)
    for ob in new:
        if ob.type == "ARMATURE":
            for bone in ob.data.bones:
                bone.name = re.sub(r"^mixamorig\d+:", "mixamorig:", bone.name)
    return new


# Citizens are drawn many at a time, so each is cut down to a game budget:
# Mixamo's downloads run 35-58k triangles with 4096 textures
CITIZEN_TRIS = 12000
CITIZEN_TEXTURE = 1024


def lighten(name):
    """Decimate a citizen to about CITIZEN_TRIS triangles and shrink its
    textures to CITIZEN_TEXTURE. Collapse decimation keeps the skin weights;
    meshes with shape keys (faces) are left whole, as Blender can't apply a
    modifier to them."""
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    tris = {}
    for m in meshes:
        m.data.calc_loop_triangles()
        tris[m] = len(m.data.loop_triangles)
    total = sum(tris.values())
    if total > CITIZEN_TRIS:
        ratio = CITIZEN_TRIS / total
        for m in meshes:
            if m.data.shape_keys or tris[m] < 400:
                continue
            mod = m.modifiers.new("decimate", "DECIMATE")
            mod.ratio = ratio
            with bpy.context.temp_override(object=m, active_object=m):
                bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)  # before the Armature modifier
                bpy.ops.object.modifier_apply(modifier=mod.name)
    after = 0
    for m in meshes:
        m.data.calc_loop_triangles()
        after += len(m.data.loop_triangles)
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > CITIZEN_TEXTURE:
            k = CITIZEN_TEXTURE / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))
    print(f"[citizen] {name}: {total} -> {after} triangles")


def build_character(path, out=OUT, citizen=False):
    reset()
    import_fbx(path)
    # The rigged download carries a one-frame T-pose take; the clips live in
    # animations.glb instead
    for ob in bpy.data.objects:
        if ob.animation_data:
            ob.animation_data_clear()
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    name = os.path.basename(path).replace("_rigged.fbx", "")
    if citizen:
        lighten(name)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out, f"{name}.glb"),
        export_format="GLB",
        export_animations=False,
        # Citizens: WebP, which keeps transparency (hair, lashes) at a
        # fraction of PNG's size; three.js reads it (EXT_texture_webp)
        export_image_format="WEBP" if citizen else "JPEG",
        export_image_quality=80 if citizen else 85,
    )
    print(f"[char] {name}")


# Clips the game moves the player through itself. Mixamo's In Place box is
# easy to miss, so these get their travel removed here regardless
IN_PLACE = {"walk", "run", "walk_back", "strafe_left", "strafe_right", "jump", "zombie_walk", "zombie_run", "zombie_crawl"}


def action_fcurves(act):
    if hasattr(act, "fcurves"):  # pre-4.4 actions
        return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips
            for bag in strip.channelbags for fc in bag.fcurves]


def strip_travel(act):
    """Remove the Hips' start-to-end drift (what Mixamo's In Place does).

    Subtracting a straight ramp from first to last key leaves the bounce
    and sway intact; a loop's vertical channel already returns to its
    start, so only the horizontal travel actually changes."""
    for fc in action_fcurves(act):
        if fc.data_path != 'pose.bones["mixamorig:Hips"].location' or len(fc.keyframe_points) < 2:
            continue
        kps = fc.keyframe_points
        (t0, v0), (t1, v1) = kps[0].co, kps[-1].co
        for kp in kps:
            f = (kp.co.x - t0) / (t1 - t0)
            shift = (v1 - v0) * f
            kp.co.y -= shift
            kp.handle_left.y -= shift
            kp.handle_right.y -= shift
        fc.update()


def build_animations(paths, out=OUT, name="animations.glb"):
    reset()
    base = None
    for path in paths:
        clip = os.path.splitext(os.path.basename(path))[0]
        new = import_fbx(path)
        arm = next(o for o in new if o.type == "ARMATURE")
        act = arm.animation_data.action
        act.name = clip
        act.use_fake_user = True
        if clip in IN_PLACE:
            strip_travel(act)
        if base is None:
            base = arm
            arm.name = "Armature"
        else:
            for ob in new:
                bpy.data.objects.remove(ob, do_unlink=True)
        print(f"[anim] {clip}: {act.frame_range[1] - act.frame_range[0] + 1:.0f} frames")

    # One NLA track per clip on the shared armature; the exporter writes each
    # track as its own glTF animation, named after the track
    ad = base.animation_data
    ad.action = None
    for act in sorted((a for a in bpy.data.actions), key=lambda a: a.name):
        track = ad.nla_tracks.new()
        track.name = act.name
        strip = track.strips.new(act.name, int(act.frame_range[0]), act)
        if hasattr(strip, "action_slot") and act.slots:
            strip.action_slot = act.slots[0]
    for ob in [o for o in bpy.data.objects if o.type == "MESH"]:
        bpy.data.objects.remove(ob, do_unlink=True)

    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out, name),
        export_format="GLB",
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_skins=True,
    )


ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "pose" in ARGS:
    os.makedirs(OUT_STORY, exist_ok=True)
    build_animations([STORY_POSE], OUT_STORY, "standing_idle.glb")
    sys.exit(0)
if "citizens" not in ARGS:
    os.makedirs(OUT, exist_ok=True)
    for p in sorted(glob.glob(os.path.join(SRC_CHARS, "*_rigged.fbx"))):
        build_character(p)
    build_animations(sorted(p for p in glob.glob(os.path.join(SRC_ANIMS, "*.fbx")) if p != STORY_POSE))

# The city's citizens and their zombie clips, when any have been added
citizens = sorted(glob.glob(os.path.join(SRC_CITIZENS, "*_rigged.fbx")))
zombie_clips = sorted(glob.glob(os.path.join(SRC_ZOMBIE_ANIMS, "*.fbx")))
if citizens or zombie_clips:
    os.makedirs(OUT_CITIZENS, exist_ok=True)
for p in citizens:
    build_character(p, OUT_CITIZENS, citizen=True)
if zombie_clips:
    build_animations(zombie_clips, OUT_CITIZENS, "zombie_animations.glb")

# The story's people: the same browser budget, their own folder
story = sorted(glob.glob(os.path.join(SRC_STORY, "*_rigged.fbx")))
if story:
    os.makedirs(OUT_STORY, exist_ok=True)
for p in story:
    build_character(p, OUT_STORY, citizen=True)
