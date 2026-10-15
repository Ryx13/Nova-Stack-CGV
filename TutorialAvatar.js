import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Loads only the courier, never the game's world or physics modules.
export function createTutorialAvatar(scene){
 const group=new THREE.Group();scene.add(group);
 const fallback=new THREE.Mesh(new THREE.CapsuleGeometry(.25,1.15,4,8),new THREE.MeshStandardMaterial({color:0x424a4b}));fallback.position.y=.85;group.add(fallback);
 let disposed=false,mixer=null,actions={},current=null,model=null;
 const release=root=>{const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());};
 new GLTFLoader().load('assets/player_character.glb',gltf=>{
  if(disposed){release(gltf.scene);return;}
  model=gltf.scene;
  mixer=new THREE.AnimationMixer(model);
  for(const [key,name] of Object.entries({idle:'Pistol_Idle',walk:'Walk',sprint:'Run_Anime'})){const clip=THREE.AnimationClip.findByName(gltf.animations,name);if(clip)actions[key]=mixer.clipAction(clip);}
  current=actions.idle||actions.walk;current?.play();mixer.update(0);
  model.updateWorldMatrix(true,true);
  // Measure posed vertices after updating every bone; cached bind-pose bounds
  // can misrepresent skinned models. Keep normalization outside animation tracks.
  const bounds=new THREE.Box3().setFromObject(model,true),size=bounds.getSize(new THREE.Vector3());
  const fittedRoot=new THREE.Group();fittedRoot.scale.setScalar(1.8/Math.max(.1,size.y));fittedRoot.rotation.y=Math.PI;fittedRoot.add(model);
  fittedRoot.position.y=-bounds.min.y*fittedRoot.scale.y;group.add(fittedRoot);fallback.visible=false;
 },undefined,()=>{/* The visible procedural courier remains usable offline. */});
 return {group,update(dt,moving,sprinting){const action=actions[moving?(sprinting?'sprint':'walk'):'idle']||actions.walk;if(action&&action!==current){current?.fadeOut(.2);action.reset().fadeIn(.2).play();current=action;}mixer?.update(dt);},dispose(){disposed=true;mixer?.stopAllAction();if(model)mixer?.uncacheRoot(model);scene.remove(group);release(group);}};
}
