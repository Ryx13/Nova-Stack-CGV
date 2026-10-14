r"""
Shrink a heavy GLB (e.g. an AI-generated model) to a game-ready one.

  art/models/<name>.glb  ->  assets/<name>.glb

Decimates every mesh down to a total triangle budget (Blender's collapse
decimator, which keeps UVs), downsizes every texture to a maximum edge
and re-encodes it as JPEG, then exports a single GLB. Scale and
orientation are left alone: the game fits models to size when it places
them.

Run from the repo root (PowerShell):
  & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P tools\optimize_model.py -- boat [triangles] [texture_px]
Defaults: 10000 triangles, 1024 px textures.
"""
import os
import sys
import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not args:
    sys.exit("usage: ... -- <name> [triangles] [texture_px]")
NAME = args[0]
TRIS = int(args[1]) if len(args) > 1 else 10000
TEX = int(args[2]) if len(args) > 2 else 1024
SRC = os.path.join(ROOT, "art", "models", f"{NAME}.glb")
OUT = os.path.join(ROOT, "assets", f"{NAME}.glb")


def tri_count(objs):
    total = 0
    for o in objs:
        mesh = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
        o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
    return total


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
before = tri_count(meshes)
ratio = min(1.0, TRIS / max(before, 1))
for o in meshes:
    mod = o.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
after = tri_count(meshes)

for img in bpy.data.images:
    if img.size[0] == 0:
        continue
    w, h = img.size
    k = min(1.0, TEX / max(w, h))
    if k < 1.0:
        img.scale(max(1, round(w * k)), max(1, round(h * k)))
    img.file_format = "JPEG"

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB",
    export_image_format="JPEG", export_jpeg_quality=85,
    export_apply=True,
)
print(f"[optimize_model] {NAME}: {before} -> {after} triangles, textures <= {TEX}px -> {OUT} ({os.path.getsize(OUT) / 1e6:.2f} MB)")
