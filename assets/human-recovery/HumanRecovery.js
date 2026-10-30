import * as THREE from 'three';
import {attachSurvivorFace} from './SurvivorFace.js?v=20261023-cured-face-1';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const models = new Map();
const loadedModels = new Map();
const active = new Set();
const survivors = new WeakMap();
const registered = new WeakSet();
const warmupRoots = new Set();
let recoveryScene = null,recoveryCamera=null;
const RECOVERY_SECONDS = 1.6;
const clipData = new Map();
const breathAxis = new THREE.Vector3(1,0,0), breathRotation = new THREE.Quaternion();
function playRecovery(root,gltf){
  const mixer=new THREE.AnimationMixer(root);
  const clips=gltf.animations.filter(c=>/recover/i.test(c.name));
  if(!clips.length)throw new Error('Human recovery animation is missing');
  const actions=clips.map(clip=>{const a=mixer.clipAction(clip);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.setDuration(RECOVERY_SECONDS);a.play();return a;});
  return {mixer,actions};
}
function cacheGrounding(variant,gltf){
  if(clipData.has(variant))return;
  const root=cloneSkinned(gltf.scene),face=attachSurvivorFace(root,variant),box=skinnedBox(root),height=Math.max(.1,box.max.y-box.min.y),{mixer}=playRecovery(root,gltf),minY=[];
  // Sample expensive skinned bounds once per asset under the loading screen.
  for(let i=0;i<=12;i++){mixer.setTime(RECOVERY_SECONDS*i/12);minY.push(skinnedBox(root).min.y);}
  mixer.stopAllAction();mixer.uncacheRoot(root);face?.dispose();
  const skeletons=new Set();root.traverse(o=>{if(o.isSkinnedMesh)skeletons.add(o.skeleton);});skeletons.forEach(s=>s.dispose());
  clipData.set(variant,{height,minY});
}
function groundAt(data,t){const f=Math.min(12,Math.max(0,t/RECOVERY_SECONDS*12)),i=Math.min(11,Math.floor(f));return THREE.MathUtils.lerp(data.minY[i],data.minY[i+1],f-i);}

function loadVariant(variant) {
  if (!models.has(variant)) {
    const url = variant === 'runner'
      ? new URL('./human_runner.glb', import.meta.url)
      : new URL('./human_walker.glb', import.meta.url);
    url.searchParams.set('v','20261023-cured-face-1');
    models.set(variant, new Promise((resolve, reject) => loader.load(url.href, resolve, undefined, reject)).then((gltf) => {
      loadedModels.set(variant, gltf);
      return gltf;
    }));
  }
  return models.get(variant);
}

export async function preloadHumanRecovery() {
  await Promise.all([loadVariant('walker'), loadVariant('runner')]);
  return true;
}

// Attach temporary offscreen instances so the renderer can compile every
// skinned material/program in the initial world. The returned function owns
// only these warmup objects; gameplay recoveries have their own lifetime.
export async function prepareHumanRecovery(renderer, scene, camera) {
  recoveryScene = scene;recoveryCamera=camera;
  await preloadHumanRecovery();
  for (const variant of ['walker', 'runner']) {
    const gltf = loadedModels.get(variant);
    cacheGrounding(variant,gltf);
    const root = cloneSkinned(gltf.scene);
    attachSurvivorFace(root,variant);
    root.name = `HumanRecoveryWarmup_${variant}`;
    root.position.set(0, -10000, 0);
    root.visible = true;
    root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; } });
    scene.add(root);
    warmupRoots.add(root);
  }
  return () => {
    for (const root of warmupRoots) root.removeFromParent();
    warmupRoots.clear();
  };
}

function skinnedBox(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  return box.isEmpty() ? new THREE.Box3().setFromObject(root) : box;
}

function prepareBones(root) {
  root.traverse((o) => {
    if (o.isBone) o.userData.humanRecoveryBase = o.quaternion.clone();
    if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; }
  });
}

export function beginHumanRecovery(zombie) {
  if (!recoveryScene || !zombie?.rigObj || registered.has(zombie)) return false;
  registered.add(zombie);
  const variant = zombie.runs ? 'runner' : 'walker';
  const gltf = loadedModels.get(variant);
  if (!gltf) { registered.delete(zombie); return false; }
  const source = zombie.rigObj;
  zombie.mesh?.updateWorldMatrix(true, false);
  const groundY = Math.max(0,zombie.mesh.position.y);
  const bodyScale=new THREE.Vector3();zombie.mesh.getWorldScale(bodyScale);
  const sourceHeight=1.8*bodyScale.y;
  const sourcePosition = zombie.mesh.getWorldPosition(new THREE.Vector3());
  const sourceQuaternion = new THREE.Quaternion();
  source.updateWorldMatrix(true, false);
  source.getWorldQuaternion(sourceQuaternion);
  source.visible = false;
  if (!recoveryScene) { source.visible = true; registered.delete(zombie); return false; }
    const model=cloneSkinned(gltf.scene),clone=new THREE.Group(),data=clipData.get(variant);
    if(!data){source.visible=true;registered.delete(zombie);return false;}
    clone.name=`HumanRecovery_${variant}`;clone.add(model);prepareBones(model);const face=attachSurvivorFace(model,variant);
    const scale=sourceHeight/data.height;
    clone.scale.setScalar(scale);clone.position.copy(sourcePosition);clone.quaternion.copy(sourceQuaternion);
    clone.position.y=groundY+.05-groundAt(data,0)*scale;
    recoveryScene.add(clone);
    const {mixer,actions}=playRecovery(model,gltf);
    const item = {
      zombie, source, clone, model, face, data, scale, mixer, actions, elapsed: 0, complete: false,
      groundY, baseX: clone.position.x, baseZ: clone.position.z, settledGroundOffset: null,
      baseScale: clone.scale.clone(),
      breath: Math.random() * Math.PI * 2,
      chest: findChest(clone), chestPose: null,head:null,headPose:null,recognition:0,
    };
    model.traverse(o=>{if(o.isBone&&!item.head&&/head(_|$)/i.test(o.name))item.head=o;});
    survivors.set(zombie,item);
    active.add(item);
  return true;
}

function findChest(root) {
  let found = null;
  root.traverse((o) => {
    if (!found && o.isBone) {
      const name = o.name.toLowerCase();
      if (o.isBone && /spine2|spine_03|^spine3$/.test(name)) found = o;
    }
  });
  return found;
}

export function updateHumanRecovery(dt) {
  let completedAny = false;
  const delta = Math.max(0, Math.min(Number(dt) || 0, 0.25));
  for (const item of active) {
    item.elapsed += delta;
    item.face?.setVisible?.(!recoveryCamera||recoveryCamera.position.distanceToSquared(item.clone.position)<144);
    if(!item.complete)item.mixer.update(delta);
    if (!item.complete && item.elapsed >= RECOVERY_SECONDS) {
      item.complete = true;
      for (const action of item.actions) action.paused = true;
      if (item.chest) item.chestPose = item.chest.quaternion.clone();
      if (item.head) item.headPose = item.head.quaternion.clone();
      completedAny = true;
    }
    if (item.complete) {
      const phase = Math.sin(item.elapsed * 2.1 + item.breath);
      if (item.chest && item.chestPose) {
        breathRotation.setFromAxisAngle(breathAxis,phase*.018);item.chest.quaternion.copy(item.chestPose).multiply(breathRotation);
      }
      if(item.head&&item.headPose&&!item.face){breathRotation.setFromAxisAngle(breathAxis,item.recognition*.07);item.head.quaternion.copy(item.headPose).multiply(breathRotation);}
      item.face?.setAwake(item.recognition);

    }
    item.clone.position.x = item.baseX;
    item.clone.position.z = item.baseZ;
    item.clone.position.y=item.groundY+.05-groundAt(item.data,item.elapsed)*item.scale;
    // The cached animation bounds are an estimate. Once the lying pose has
    // settled, measure this particular skinned survivor and pin its lowest
    // point to the street; keep that correction without measuring every frame.
    if(item.complete&&item.settledGroundOffset===null){
      const bounds=skinnedBox(item.clone);
      item.settledGroundOffset=item.groundY+.05-bounds.min.y;
    }
    if(item.settledGroundOffset!==null)item.clone.position.y+=item.settledGroundOffset;
  }
  return completedAny;
}

export function survivorFrame(zombie,position,forward,up){
  const item=survivors.get(zombie);if(!item?.complete||!item.head)return false;
  item.clone.updateWorldMatrix(true,true);if(item.face){item.face.getFaceFrame(position,forward,up);return true;}item.head.getWorldPosition(position);
  forward.set(0,0,1).transformDirection(item.head.matrixWorld);up.set(0,1,0).transformDirection(item.head.matrixWorld);
  return true;
}
export function recognizeSurvivor(zombie,amount){const item=survivors.get(zombie);if(!item?.complete)return false;item.recognition=THREE.MathUtils.clamp(amount,0,1);return true;}

// Explicit scene teardown for level disposal. Setup warmup cleanup must not
// call this: the game invokes that cleanup immediately after shader warmup.
export function disposeHumanRecovery({keepScene=false}={}) {
  for (const item of active) {
    item.source.visible = true;
    item.mixer.stopAllAction();item.mixer.uncacheRoot(item.model);
    const skeletons=new Set();item.model.traverse(o=>{if(o.isSkinnedMesh)skeletons.add(o.skeleton);});skeletons.forEach(s=>s.dispose());
    item.face?.dispose();item.clone.removeFromParent();
  }
  active.clear();
  if (recoveryScene) for (const root of warmupRoots) root.removeFromParent();
  warmupRoots.clear();
  if(!keepScene){recoveryScene = null;recoveryCamera=null;}
}
