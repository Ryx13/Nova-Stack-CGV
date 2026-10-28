import bpy, os, json, math, re, mathutils, struct
import numpy as np

from pathlib import Path
import argparse,sys
_args=argparse.ArgumentParser()
_args.add_argument('--source-assets')
_options=_args.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
ROOT=str(Path(__file__).resolve().parents[1])
SRC=_options.source_assets or str(Path(ROOT)/'assets')
OUT = os.path.join(ROOT, 'assets', 'human-recovery')
# The editable .blend stays with the other sources, out of the shipped assets/
SRC_OUT = os.path.join(ROOT, 'art', 'human-recovery')
os.makedirs(SRC_OUT, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
MODELS = [('walker','zombie_running_on_metel_maniac.glb'),('runner','model-rigged.glb')]
FPS = 24
START, FINISH = 1, 30

def find_bone(armature, patterns):
    for bone in armature.data.bones:
        name = bone.name.lower()
        if any(re.search(p, name) for p in patterns):
            return armature.pose.bones.get(bone.name)
    return None

def set_pose_and_key(armature, frame, targets):
    bpy.context.scene.frame_set(frame)
    for pose in armature.pose.bones:
        pose.rotation_mode='QUATERNION'
        pose.rotation_quaternion=(1,0,0,0)
        pose.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=pose.name)
    for patterns,angles in targets:
        pose=find_bone(armature,patterns)
        if pose:
            pose.rotation_mode='QUATERNION'
            pose.rotation_quaternion=mathutils.Euler(angles,'XYZ').to_quaternion()
            pose.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=pose.name)

def aim_bone_toward(armature, pose_bone, target, anatomical_child=None):
    bpy.context.view_layer.update()
    direction=(anatomical_child.head-pose_bone.head) if anatomical_child else (pose_bone.tail-pose_bone.head)
    desired=target-pose_bone.head
    if direction.length < 1e-5 or desired.length < 1e-5: return
    correction=direction.normalized().rotation_difference(desired.normalized())
    matrix=pose_bone.matrix.copy()
    position=matrix.translation.copy()
    matrix.translation=mathutils.Vector((0,0,0))
    matrix=correction.to_matrix().to_4x4() @ matrix
    matrix.translation=position
    pose_bone.matrix=matrix
    bpy.context.view_layer.update()
    pose_bone.keyframe_insert(data_path='rotation_quaternion',frame=FINISH,group=pose_bone.name)
    pose_bone.keyframe_insert(data_path='location',frame=FINISH,group=pose_bone.name)

def align_relaxed_arms(armature):
    for side,upper_patterns,lower_patterns,hip_patterns in [
      ('left',[r'(?:^|:)leftarm(?:_|$)',r'^l_shoulder$'],[r'(?:^|:)leftforearm(?:_|$)',r'^l_elbow$'],[r'left.*(upleg|hip)',r'^l_hip$']),
      ('right',[r'(?:^|:)rightarm(?:_|$)',r'^r_shoulder$'],[r'(?:^|:)rightforearm(?:_|$)',r'^r_elbow$'],[r'right.*(upleg|hip)',r'^r_hip$'])]:
        upper=find_bone(armature,upper_patterns)
        lower=find_bone(armature,lower_patterns)
        hip=find_bone(armature,hip_patterns)
        spine=find_bone(armature,[r'spine2|spine_03|^spine3$',r'^spine2$']) or find_bone(armature,[r'spine1|spine_02|^spine1$'])
        wrist=find_bone(armature,[rf'{side}.*(wrist|hand)',rf'^{("l" if side=="left" else "r")}_(wrist|hand)$'])
        if upper and lower and hip:
            aim_bone_toward(armature,upper,hip.head.copy(),lower)
        if lower and spine:
            belly=hip.head.lerp(spine.head,.32) if hip else spine.head.copy()
            aim_bone_toward(armature,lower,belly,wrist)

def author_recovery(root,armature):
    armature.animation_data_create()
    root.animation_data_create()
    action=bpy.data.actions.new(name='recover_pose')
    armature.animation_data.action=action
    root_action=bpy.data.actions.new(name='recover')
    set_pose_and_key(armature,START,[])
    root.rotation_mode='QUATERNION'
    root.rotation_quaternion=(1,0,0,0)
    root.animation_data.action=root_action
    root.keyframe_insert(data_path='rotation_quaternion',frame=START,group='RecoveryRoot')
    # Fold the knees and elbows, relax both arms, turn the torso and settle the
    # body sideways. Names support the Mixamo walker and compact L_/R_ runner.
    targets=[
      ([r'left.*(upleg|hip)',r'^l_hip$'], (math.radians(28),0,0)),
      ([r'right.*(upleg|hip)',r'^r_hip$'], (math.radians(-18),0,0)),
      ([r'(?:^|:)leftleg(?:_|$)',r'^l_knee$'], (math.radians(-48),0,0)),
      ([r'(?:^|:)rightleg(?:_|$)',r'^r_knee$'], (math.radians(-42),0,0)),
      ([r'spine1|spine_02|^spine2$'], (math.radians(9),0,0)),
      ([r'spine2|spine_03|^spine3$'], (math.radians(8),0,0)),
      ([r'neck'], (0,0,math.radians(10))),
    ]
    set_pose_and_key(armature,FINISH,targets)
    align_relaxed_arms(armature)
    root.rotation_quaternion=mathutils.Euler((0,math.radians(90),0),'XYZ').to_quaternion()
    root.keyframe_insert(data_path='rotation_quaternion',frame=FINISH,group='RecoveryRoot')
    bpy.context.scene.frame_set(FINISH)
    return [root_action,action]

def clean_skin_image(image, variant, cache):
    key=image.name
    if key in cache: return cache[key]
    # The atlas is copied and baked only onto polygons assigned to head, neck,
    # or hand groups. Preserve dark neutral pixels (hair/eyes) and 15% old color.
    source=np.asarray(image.pixels[:],dtype=np.float32).reshape((-1,4))
    pixels=source.copy()
    rgb=source[:,:3]
    luma=rgb @ np.array([.2126,.7152,.0722],dtype=np.float32)
    dark_neutral=(luma<.12)&((rgb.max(axis=1)-rgb.min(axis=1))<.07)
    bright_neutral=(luma>.82)&((rgb.max(axis=1)-rgb.min(axis=1))<.12)
    paint=~(dark_neutral|bright_neutral)
    skin=np.array([.58,.30,.21],dtype=np.float32)
    pixels[paint,:3]=source[paint,:3]*.15+skin*.85
    out=image.copy()
    out.name=f'HumanSkinWarm_{variant}_{image.name}'
    out.pixels.foreach_set(pixels.ravel())
    out.update()
    try: out.pack()
    except Exception: pass
    cache[key]=out
    return out

def material_image(material):
    if not material or not material.use_nodes: return None
    principled=next((n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if not principled: return None
    socket=principled.inputs.get('Base Color')
    if not socket: return None
    for link in socket.links:
        node=link.from_node
        if node.type=='TEX_IMAGE' and node.image: return node.image
    return next((n.image for n in material.node_tree.nodes if n.type=='TEX_IMAGE' and n.image),None)

def assign_clean_skin(obj, variant, image_cache):
    skin_ids={g.index for g in obj.vertex_groups if re.search(r'(head|neck|hand|thumb|index|middle|ring|pinky|finger)',g.name.lower())}
    if not skin_ids: return 0
    chosen=[]
    for poly in obj.data.polygons:
        total=0.0
        for vi in poly.vertices:
            weights=sum(g.weight for g in obj.data.vertices[vi].groups if g.group in skin_ids)
            total+=min(1.0,weights)
        if total/len(poly.vertices) >= .35: chosen.append(poly)
    if not chosen: return 0
    old=next((m for m in obj.data.materials if m),None)
    image=material_image(old)
    if not image: return 0
    baked=clean_skin_image(image,variant,image_cache)
    skinmat=bpy.data.materials.new(name=f'HumanCleanSkin_{variant}')
    skinmat.use_nodes=True
    nodes=skinmat.node_tree.nodes; nodes.clear()
    tex=nodes.new('ShaderNodeTexImage'); tex.image=baked
    shader=nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Roughness'].default_value=.82
    output=nodes.new('ShaderNodeOutputMaterial')
    skinmat.node_tree.links.new(tex.outputs['Color'],shader.inputs['Base Color'])
    skinmat.node_tree.links.new(shader.outputs['BSDF'],output.inputs['Surface'])
    obj.data.materials.append(skinmat)
    index=len(obj.data.materials)-1
    for poly in chosen: poly.material_index=index
    return len(chosen)

def name_glb_recovery_clips(path):
    data=open(path,'rb').read()
    magic,version,total=struct.unpack_from('<III',data,0)
    offset=12; chunks=[]
    while offset < len(data):
        length,kind=struct.unpack_from('<II',data,offset); offset+=8
        chunk=data[offset:offset+length]; offset+=length
        if kind==0x4E4F534A:
            doc=json.loads(chunk.decode('utf-8'))
            for clip in doc.get('animations',[]): clip['name']='recover'
            # The glTF exporter can re-include detached source helper nodes
            # during selection-based export. Strip their mesh bindings from
            # the human runtime GLB; source collections stay intact in .blend.
            for node in doc.get('nodes',[]):
                if 'icosphere' in node.get('name','').lower():
                    node.pop('mesh',None)
            chunk=json.dumps(doc,separators=(',',':')).encode('utf-8')
            chunk+=b' ' * ((4-len(chunk)%4)%4)
        chunks.append((kind,chunk))
    out=bytearray(struct.pack('<III',magic,version,0))
    for kind,chunk in chunks:
        out.extend(struct.pack('<II',len(chunk),kind)); out.extend(chunk)
    struct.pack_into('<I',out,8,len(out))
    with open(path,'wb') as f: f.write(out)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
manifest=[]
for variant,filename in MODELS:
    before=set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC,filename))
    imported=[o for o in bpy.context.scene.objects if o not in before]
    source=bpy.data.collections.new('Source_'+variant)
    bpy.context.scene.collection.children.link(source)
    for obj in imported:
        for c in list(obj.users_collection): c.objects.unlink(obj)
        source.objects.link(obj)
    human=bpy.data.collections.new('Human_'+variant+'_recovery')
    bpy.context.scene.collection.children.link(human)
    remap={}
    for obj in imported:
        # Both source files carry a stray low-poly Icosphere node detached
        # from the character rig. It is a modeling helper, not a body part.
        if obj.type=='MESH' and obj.name.lower().startswith('icosphere'):
            continue
        dup=obj.copy()
        dup.name='Human_'+variant+'_'+obj.name
        if obj.data: dup.data=obj.data.copy() if obj.type in {'ARMATURE','MESH'} else obj.data
        human.objects.link(dup)
        remap[obj]=dup
    for obj,dup in remap.items():
        if obj.parent in remap: dup.parent=remap[obj.parent]
        if dup.animation_data: dup.animation_data_clear()
        if dup.type=='ARMATURE':
            for pose in dup.pose.bones: pose.matrix_basis.identity()
        if dup.type=='MESH':
            for mod in dup.modifiers:
                if mod.type=='ARMATURE' and mod.object in remap: mod.object=remap[mod.object]
    skin_cache={}
    skin_poly_count=0
    for obj in human.objects:
        if obj.type=='MESH': skin_poly_count+=assign_clean_skin(obj,variant,skin_cache)
    armature=next((o for o in human.objects if o.type=='ARMATURE'),None)
    if not armature: raise RuntimeError('No armature in '+filename)
    top_level=[o for o in human.objects if o.parent is None]
    root=bpy.data.objects.new('HumanRecoveryRoot_'+variant,None)
    human.objects.link(root)
    for obj in top_level:
        world=obj.matrix_world.copy()
        obj.parent=root
        obj.matrix_world=world
    action=author_recovery(root,armature)
    bpy.context.scene.frame_start=START
    bpy.context.scene.frame_end=FINISH
    bpy.context.scene.render.fps=FPS
    bpy.context.scene.frame_set(START)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in human.objects: obj.select_set(True)
    bpy.context.view_layer.objects.active=armature
    glb=os.path.join(OUT,'human_'+variant+'.glb')
    bpy.ops.export_scene.gltf(filepath=glb,export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIVE_ACTIONS',export_nla_strips=False,export_frame_range=True)
    name_glb_recovery_clips(glb)
    manifest.append({'variant':variant,'source':filename,'export':os.path.basename(glb),'bones':len(armature.data.bones),'blender_actions':['recover','recover_pose'],'gltf_animation_names':['recover','recover'],'clean_skin_polygons':skin_poly_count,'clean_skin_atlases':len(skin_cache)})
bpy.context.scene.frame_set(START)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SRC_OUT,'human_recovery_source.blend'))
with open(os.path.join(OUT,'manifest.json'),'w') as f:
    json.dump({'assets':manifest,'skin_treatment':'Head, neck and hand polygons are selected from vertex weights and receive a baked warm human skin atlas: 85% natural skin color blended with 15% original pixel detail. Very dark neutral pixels (hair/eyes) and bright neutral eye pixels are preserved. Body/clothing pixels keep source materials. Upper arms aim using elbow joints and forearms using wrist/hand joints toward the hips and abdomen; the recover pose bends knees and side-rolls the root.'},f,indent=2)
print('HUMAN_RECOVERY_ASSETS',manifest)



