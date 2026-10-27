import bpy, math, os, json, random, tempfile, argparse, sys, shutil
from pathlib import Path
import numpy as np
from mathutils import Vector, Matrix
parser=argparse.ArgumentParser(description='Build the Guardian in Blender, including deform rig, textures and authored actions.')
parser.add_argument('--project',default=str(Path(__file__).resolve().parents[1]))
parser.add_argument('--out',default=None)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
ROOT=str(Path(args.project).resolve());OUT=str(Path(args.out).resolve()) if args.out else str(Path(ROOT)/'art/bosses/guardian')
os.makedirs(OUT+'/textures',exist_ok=True)
os.makedirs(OUT+'/../work/temp',exist_ok=True)
tempfile.tempdir=OUT+'/../work/temp'
random.seed(37)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=ROOT+'/assets/characters/breacher.glb')
old=next(o for o in bpy.data.objects if o.type=='ARMATURE')
body=next(o for o in bpy.data.objects if o.type=='MESH' and len(o.data.vertices)>1000)
def widen(v):return Vector((v.x*1.3,v.y*1.32,v.z))
heads={p.name:widen(old.matrix_world@p.head) for p in old.pose.bones}
parents={b.name:b.parent.name if b.parent else None for b in old.data.bones}
for v in body.data.vertices:
 v.co=widen(body.matrix_world@v.co)
 # Collapse the old SWAT cap into the containment hood.
 if v.co.z>1.80:
  v.co.x=max(-.13,min(.13,v.co.x));v.co.y=max(-.045,min(.17,v.co.y));v.co.z=1.80+(v.co.z-1.80)*.45
body.parent=None;body.matrix_world=Matrix.Identity(4);body.modifiers.clear();body.name='Containment_worker_suit'
for o in list(bpy.data.objects):
 if o!=body:bpy.data.objects.remove(o,do_unlink=True)
# Rebuild sensible deform-bone lengths from the joint positions in the supplied rig.
data=bpy.data.armatures.new('Guardian_deform');rig=bpy.data.objects.new('Guardian',data);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for name,h in heads.items():
 b=data.edit_bones.new(name);b.head=h
 kids=[n for n,p in parents.items() if p==name]
 child=next((n for n in kids if any(s in n for s in ['Spine','Leg','Foot','ToeBase','ForeArm','Hand','HeadTop','Neck'])),kids[0] if kids else None)
 b.tail=heads[child] if child else h+Vector((0,-.07,0))
 if (b.tail-b.head).length<.01:b.tail=h+Vector((0,0,.05))
for n,p in parents.items():
 if p:data.edit_bones[n].parent=data.edit_bones[p]
bpy.ops.object.mode_set(mode='OBJECT')
mod=body.modifiers.new('Weighted original skin','ARMATURE');mod.object=rig;body.parent=rig
# Retain the original atlas's folds and seams, but age and recolour its cloth and skin.
im=next(i for i in bpy.data.images if i.size[0]>0);p=np.array(im.pixels[:],dtype=np.float32).reshape(im.size[1],im.size[0],4)
rng=np.random.default_rng(73);noise=rng.random(p.shape[:2]);lum=p[:,:,:3].mean(2)
skin=(p[:,:,0]>p[:,:,2]*1.18)&(p[:,:,0]>.18)&(lum>.16)
p[:,:,:3]*=np.array([.80,.94,.65]);p[skin,:3]*=np.array([.80,.91,.85]);p[:,:,:3]*=(.84+.23*noise[:,:,None]);p[:,:,:3]=np.clip(p[:,:,:3],0,1)
im.pixels[:]=p.ravel();im.name='guardian_suit_albedo';im.filepath_raw=OUT+'/textures/guardian_suit_albedo.png';im.file_format='PNG';im.save()
body.data.materials[0].name='Worn charcoal and olive protective suit'
# Shared tiled painted-metal atlas with rubbed edges, rust islands and pitting.
N=1024;y,x=np.mgrid[0:N,0:N];f=rng.random((N,N));coarse=(np.sin(x*.021+np.sin(y*.017)*3)+np.cos(y*.031+np.sin(x*.014)*2))/2
rust=(coarse+.65*f+np.sin(x*.16)*np.sin(y*.13)*.24)>.71;rgb=np.zeros((N,N,4),np.float32);rgb[:,:,:3]=np.array([.105,.125,.075])*(.5+.85*f[:,:,None]);rgb[rust,:3]=np.array([.19,.085,.039])*(.55+.7*f[rust,None]);rgb[:,:,3]=1
gearim=bpy.data.images.new('guardian_corroded_metal',width=N,height=N);gearim.pixels[:]=rgb.ravel();gearim.filepath_raw=OUT+'/textures/guardian_corroded_metal.png';gearim.file_format='PNG';gearim.save()
def mat(name,color,texture=False,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=(*color,1);n.inputs['Roughness'].default_value=.86;n.inputs['Metallic'].default_value=metal
 if texture:
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=gearim;m.node_tree.links.new(t.outputs['Color'],n.inputs['Base Color'])
 return m
metal=mat('Pitted containment tank / olive paint',(.23,.26,.14),True,.35)
rubber=mat('Cracked charcoal rubber',(.026,.031,.028));skinmat=mat('Necrotic tissue',(.25,.27,.17));strap=mat('Oil stained webbing',(.10,.105,.073));valve=mat('Exposed pressure valve',(.52,.35,.11),False,.6)
clothim=bpy.data.images.new('guardian_worn_fabric',width=512,height=512)
cy,cx=np.mgrid[0:512,0:512];cf=rng.random((512,512));fabric=np.ones((512,512,4),np.float32);fabric[:,:,:3]=np.array([.125,.135,.094])*(.62+.30*cf[:,:,None]+.1*(np.sin(cx*math.pi/2)*np.sin(cy*math.pi/2))[:,:,None]);clothim.pixels[:]=fabric.ravel();clothim.filepath_raw=OUT+'/textures/guardian_worn_fabric.png';clothim.file_format='PNG';clothim.save()
tex=strap.node_tree.nodes.new('ShaderNodeTexImage');tex.image=clothim;strap.node_tree.links.new(tex.outputs['Color'],strap.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
parts=[body]
def bind(o,name,bone,material):
 bpy.ops.object.select_all(action='DESELECT')
 o.name=name;o.data.materials.clear();o.data.materials.append(material)
 bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 # Put all mesh coordinates in rig space so every accessory has an ordinary skin.
 for v in o.data.vertices:v.co=o.matrix_world@v.co
 o.matrix_world=Matrix.Identity(4)
 vg=o.vertex_groups.new(name='mixamorig:'+bone);vg.add(list(range(len(o.data.vertices))),1,'REPLACE');m=o.modifiers.new('Deform','ARMATURE');m.object=rig;o.parent=rig
 for p in o.data.polygons:p.use_smooth=True
 parts.append(o);return o
def ell(name,loc,scale,bone,material,segments=20):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=12,location=loc);o=bpy.context.object;o.scale=scale;return bind(o,name,bone,material)
def loft(name,loc,radii,bone,material,oval=1):
 verts=[];faces=[];S=24
 for j,(z,r) in enumerate(radii):
  for i in range(S):
   a=i*2*math.pi/S;rr=r*(1+.014*math.sin(a*5+j*1.7));verts.append((loc[0]+rr*math.cos(a),loc[1]+rr*math.sin(a)*oval,loc[2]+z))
 for j in range(len(radii)-1):
  for i in range(S):a=j*S+i;b=j*S+(i+1)%S;faces.append((a,b,b+S,a+S))
 faces+=[tuple(range(S-1,-1,-1)),tuple((len(radii)-1)*S+i for i in range(S))]
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o)
 # Cylindrical UVs for rust and pitting.
 uv=me.uv_layers.new()
 for poly in me.polygons:
  for li in poly.loop_indices:
   vi=me.loops[li].vertex_index;uv.data[li].uv=(vi%S/S,vi//S/max(1,len(radii)-1))
 return bind(o,name,bone,material)
def hose(name,points,radius,bone,material):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=8;cu.bevel_depth=radius;cu.bevel_resolution=2;s=cu.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
 for p,co in zip(s.bezier_points,points):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');return bind(bpy.context.object,name,bone,material)
for sign in [-1,1]:
 xx=sign*.235
 loft('Corroded pressure vessel', (xx,.31,1.05),[(0,.08),(.035,.14),(.09,.158),(.57,.158),(.66,.12),(.70,.055)],'Spine2',metal)
 for zz in [1.19,1.55]:loft('Tank retaining collar',(xx,.31,zz),[(0,.163),(.035,.163)],'Spine2',rubber)
 loft('Tank exhaust',(xx,.31,1.75),[(0,.045),(.075,.045),(.09,.065),(.11,.065)],'Spine2',metal)
 # Webbing follows the torso, leaving arms free.
 hose('Shoulder harness',[(sign*.21,.28,1.12),(sign*.29,.13,1.58),(sign*.26,-.18,1.51),(sign*.23,-.21,1.12)],.025,'Spine2',strap)
 o=ell('Heavy damaged shoulder',(sign*.325,.055,1.52),(.18,.18,.105),'LeftArm' if sign>0 else 'RightArm',metal)
 for v in o.data.vertices:
  v.co.z+=.009*math.sin(v.co.x*81)*math.cos(v.co.y*62)
# Tight hood and a broken respirator cover Breacher's cap/eyewear silhouette.
ell('Torn protective hood',(-.007,.065,1.76),(.155,.145,.174),'Head',strap)
ell('Respirator face seal',(-.007,-.104,1.715),(.12,.073,.105),'Head',rubber)
for sign in [-1,1]:
 ell('Clouded respirator lens',(sign*.061,-.152,1.775),(.045,.021,.025),'Head',rubber)
 ell('Filter canister',(sign*.115,-.135,1.69),(.057,.063,.048),'Head',metal)
hose('Severed breathing hose',[(.12,-.16,1.70),(.25,-.20,1.62),(.33,-.12,1.40),(.40,.13,1.32)],.026,'Spine2',rubber)
hose('Pressure feed',[(-.23,.29,1.72),(-.40,.03,1.55),(-.28,-.22,1.40),(.03,-.255,1.35)],.024,'Spine2',rubber)
# A small brass pressure-relief spindle, deliberately separate for precise shot raycasts.
ell('GasValveWeakPoint',(.04,-.282,1.36),(.059,.036,.059),'Spine2',valve,16)
loft('Pressure manifold',(.04,-.235,1.26),[(0,.07),(.15,.07)],'Spine2',metal,.6)
# Inflate the existing weighted sleeve itself; no detached spherical limb pieces.
for v in body.data.vertices:
 if .30<abs(v.co.x)<.70 and 1.20<v.co.z<1.48:
  factor=1+.16*math.sin((v.co.z-1.20)/.28*math.pi)
  v.co.y=.07+(v.co.y-.07)*factor
# IK controllers are authoring helpers; only deform transforms are exported.
controls=[]
def target(name,loc):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.location=loc;controls.append(o);return o
feet={};hands={}
for side in ['Left','Right']:
 foot=rig.pose.bones['mixamorig:'+side+'Foot'];leg=rig.pose.bones['mixamorig:'+side+'Leg'];fore=rig.pose.bones['mixamorig:'+side+'ForeArm']
 t=target(side+'_sole_target',foot.head);feet[side]=t;c=leg.constraints.new('IK');c.target=t;c.chain_count=2;c.use_stretch=False
 pole=target(side+'_knee_pole',(foot.head.x,-1,.55));c.pole_target=pole;c.pole_angle=-math.pi/2 if side=='Left' else -math.pi/2
 # Absolute foot rotation keeps both soles flat through every stance.
 t.rotation_euler=foot.matrix.to_euler();c=foot.constraints.new('COPY_ROTATION');c.target=t;c.target_space='WORLD';c.owner_space='WORLD'
 t=target(side+'_hand_target',rig.pose.bones['mixamorig:'+side+'Hand'].head);hands[side]=t;c=fore.constraints.new('IK');c.target=t;c.chain_count=2;c.use_stretch=False
rig.animation_data_create();s=bpy.context.scene;s.render.fps=30
actions=[]
durations={'entrance':3.5,'idle':3.0,'walk':2.8,'slam_warning':1.3,'slam':.9,'vent_warning':1.8,'vent':2.4,'recovery':3.4,'stagger':.65,'death':3.2}
hip=rig.pose.bones['mixamorig:Hips'];spine=rig.pose.bones['mixamorig:Spine'];chest=rig.pose.bones['mixamorig:Spine2']
for name,seconds in durations.items():
 for o in [rig]+controls:o.animation_data_clear()
 rig.animation_data_create();act=bpy.data.actions.new(name);rig.animation_data.action=act
 end=round(seconds*30)+1;s.frame_start=1;s.frame_end=end
 for frame in range(1,end+1):
  s.frame_set(frame);u=(frame-1)/(end-1);t=u*seconds
  for pb in rig.pose.bones:pb.rotation_mode='XYZ';pb.rotation_euler=(0,0,0);pb.location=(0,0,0)
  lean=.09;drop=0;arms=0
  if name=='walk':lean=.12;drop=.10+.014*(1-math.cos(u*math.pi*4))
  elif name=='entrance':lean=.35*(1-u)+.09;drop=.1*(1-u)
  elif name=='slam_warning':lean=.09-.26*u;arms=u
  elif name=='slam':lean=-.17+.65*min(1,u/.28);arms=max(0,1-u/.28);drop=.11*min(1,u/.28)
  elif name=='vent_warning':lean=.09+.30*u;drop=.10*u
  elif name=='vent':lean=.39+.018*math.sin(t*20);drop=.10
  elif name=='recovery':lean=.39-.30*u;drop=.1*(1-u)
  elif name=='stagger':lean=.09-.19*math.sin(u*math.pi)
  elif name=='death':lean=.09+1.15*min(1,u/.75);drop=.70*min(1,u/.8)
  else:lean=.09+.012*math.sin(u*2*math.pi)
  # Hips bone's local Y is up; translate through its rest orientation.
  hip.location=hip.bone.matrix_local.to_3x3().inverted()@Vector((0,0,-drop))
  spine.rotation_euler.x=lean*.65;chest.rotation_euler.x=lean*.35
  for side,sign in [('Left',1),('Right',-1)]:
   p=heads['mixamorig:'+side+'Foot'].copy();p.x=sign*.27
   swing=0
   if name=='walk':
    q=(u+(0 if sign==1 else .5))%1
    if q<.65:p.y=-.35+q/.65*.74
    else:
     v=(q-.65)/.35;p.y=.39-.74*v;p.z+=.075*math.sin(v*math.pi)
    swing=math.sin((u+(0 if sign==1 else .5))*math.pi*2)*.065
   feet[side].location=p;feet[side].keyframe_insert('location',frame=frame)
   hands[side].location=(sign*(.50+.05*arms),-.08-.40*arms+swing,1.02+.78*arms-drop*.65)
   if name in ['vent','vent_warning']:hands[side].location=(sign*.46,-.28,.94)
   if name=='death':hands[side].location=(sign*.48,-.56,.18+.8*(1-min(1,u/.75)))
   hands[side].keyframe_insert('location',frame=frame)
  for pb in rig.pose.bones:
   pb.keyframe_insert('location',frame=frame);pb.keyframe_insert('rotation_euler',frame=frame)
 # Bake evaluated IK matrices into a clean independent action.
 bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
 bpy.ops.object.mode_set(mode='POSE');bpy.ops.pose.select_all(action='SELECT')
 bpy.ops.nla.bake(frame_start=1,frame_end=end,step=1,only_selected=True,visual_keying=True,clear_constraints=False,use_current_action=True,bake_types={'POSE'})
 bpy.ops.object.mode_set(mode='OBJECT');act.name=name;act.use_fake_user=True;actions.append(act)
for pb in rig.pose.bones:
 for c in list(pb.constraints):pb.constraints.remove(c)
for o in controls:bpy.data.objects.remove(o,do_unlink=True)
rig.animation_data.action=None
for act in actions:
 track=rig.animation_data.nla_tracks.new();track.name=act.name;strip=track.strips.new(act.name,1,act)
 if hasattr(strip,'action_slot') and act.slots:strip.action_slot=act.slots[0]
 track.mute=True
for pb in rig.pose.bones:pb.matrix_basis=Matrix.Identity(4)
# Store a working editable scene with texture files alongside and packed as a backup.
# Join the equipment into one weighted mesh, keeping the valve separate for raycasts.
bpy.ops.object.select_all(action='DESELECT')
equipment=[o for o in parts if o!=body and o.name!='GasValveWeakPoint']
for o in equipment:o.select_set(True)
bpy.context.view_layer.objects.active=equipment[0];bpy.ops.object.join();equipment[0].name='Tank_harness_respirator_and_hood'
parts=[body,equipment[0],next(o for o in bpy.data.objects if o.name=='GasValveWeakPoint')]
for i in [im,gearim,clothim]:i.pack()
world=s.world=bpy.data.worlds.new('Neutral inspection studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.065,.075,.085,1)
for loc,power,size in [((3,-4,5),450,4),((-3,-1,3),260,3),((0,3,4),500,3)]:
 bpy.ops.object.light_add(type='AREA',location=loc);bpy.context.object.data.energy=power;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=size
bpy.ops.object.camera_add();cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=2.45;s.camera=cam
s.render.engine='CYCLES';s.cycles.samples=24;s.render.resolution_x=800;s.render.resolution_y=900;s.render.resolution_percentage=100
rig.animation_data.action=actions[1];s.frame_set(1)
for label,loc in [('front',(0,-5,1.6)),('side',(5,0,1.6)),('back',(0,5,1.6))]:
 cam.location=loc;cam.rotation_euler=(Vector((0,0,1.0))-cam.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=OUT+'/guardian-'+label+'.png';bpy.ops.render.render(write_still=True)
cam.location=(3,-5,2);cam.rotation_euler=(Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler()
rig.animation_data.action=next(a for a in actions if a.name=='slam');s.frame_set(10);s.render.filepath=OUT+'/guardian-slam-check.png';bpy.ops.render.render(write_still=True)
rig.animation_data.action=None
for track in rig.animation_data.nla_tracks:track.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for o in parts:o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/guardian.blend')
bpy.ops.export_scene.gltf(filepath=OUT+'/guardian.glb',export_format='GLB',use_selection=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_skins=True,export_image_format='JPEG',export_jpeg_quality=88)
for track in rig.animation_data.nla_tracks:track.mute=True
rig.animation_data.action=actions[1];s.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/guardian.blend')
tri=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in parts)
json.dump({'triangles':tri,'meshes':len(parts),'texture_sizes':[[1024,1024],[1024,1024],[512,512]],'clips':durations,'height_m_at_scale_1_6':3.04},open(OUT+'/asset-budget.json','w'),indent=2)
print('GUARDIAN FINISHED',tri)
if not args.out:
 dest=Path(ROOT)/'assets/bosses/guardian';dest.mkdir(parents=True,exist_ok=True)
 shutil.copy2(Path(OUT)/'guardian.glb',dest/'guardian.glb');shutil.copytree(Path(OUT)/'textures',dest/'textures',dirs_exist_ok=True)
