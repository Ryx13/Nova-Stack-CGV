r"""
Build the game's character assets from the Mixamo sources in art/.

  art/characters/<name>_rigged.fbx  ->  assets/characters/<name>.glb
      mesh + Mixamo skeleton, no animation (one per playable character)
  art/animations/<clip>.fbx         ->  assets/characters/animations.glb
      every clip on one shared Mixamo skeleton, each named after its file
      (walk.fbx -> "walk"). All characters share the skeleton, so the game
      loads this once and plays any clip on any character.

Run from the repo root (PowerShell):
  & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P tools\build_characters.py
"""
import glob
import os
import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_CHARS = os.path.join(ROOT, "art", "characters")
SRC_ANIMS = os.path.join(ROOT, "art", "animations")
OUT = os.path.join(ROOT, "assets", "characters")


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def build_character(path):
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
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, f"{name}.glb"),
        export_format="GLB",
        export_animations=False,
        export_image_format="JPEG",
        export_image_quality=85,
    )
    print(f"[char] {name}")


# Clips the game moves the player through itself. Mixamo's In Place box is
# easy to miss, so these get their travel removed here regardless
IN_PLACE = {"walk", "run", "walk_back", "strafe_left", "strafe_right", "jump"}


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


def build_animations(paths):
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
        filepath=os.path.join(OUT, "animations.glb"),
        export_format="GLB",
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_skins=True,
    )


os.makedirs(OUT, exist_ok=True)
for p in sorted(glob.glob(os.path.join(SRC_CHARS, "*_rigged.fbx"))):
    build_character(p)
build_animations(sorted(glob.glob(os.path.join(SRC_ANIMS, "*.fbx"))))
