import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGLB, loadAnimations, fitClip } from './roster.js';

// A small, collidable isolation booth, with its release handle facing the road.
// The worker shares cached citizen geometry/textures and two existing clips.
export function createTechnicianRescue({scene,position,addCollider,night=false}) {
  const booth = new THREE.Group();booth.name='Isolation room — trapped technician';
  booth.position.copy(position);scene.add(booth);
  const steel=new THREE.MeshStandardMaterial({color:0x495d64,metalness:.55,roughness:.65});
  const pale=new THREE.MeshStandardMaterial({color:0xb9c8be,roughness:.8,emissive:0x8eb4aa,emissiveIntensity:night?.18:0});
  const dark=new THREE.MeshStandardMaterial({color:0x172c31,roughness:.8});
  const amber=new THREE.MeshStandardMaterial({color:0xe2ac44,roughness:.6});
  const glass=new THREE.MeshStandardMaterial({color:0x8ebdc1,transparent:true,opacity:.18,depthWrite:false,roughness:.3,side:THREE.DoubleSide});
  const status=new THREE.MeshBasicMaterial({color:0xe2ac44});
  const cube=new THREE.BoxGeometry(1,1,1);
  function box(parent,x,y,z,w,h,d,material=steel){
    const mesh=new THREE.Mesh(cube,material);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);
    mesh.castShadow=material!==glass;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function solid(x,y,z,w,h,d,material){
    box(booth,x,y,z,w,h,d,material);
    return addCollider(w/2,h/2,d/2,position.x+x,y,position.z+z);
  }
  solid(-1.5,1.4,-1.7,.16,2.8,3.4,pale);
  solid(1.5,1.4,-1.7,.16,2.8,3.4,pale);
  solid(0,1.4,-3.4,3.16,2.8,.16,pale);
  box(booth,0,.025,-1.7,3,.05,3.4,dark);
  box(booth,0,2.85,-1.7,3.3,.18,3.6,steel);
  box(booth,0,2.73,-1.6,1.3,.05,.24,new THREE.MeshBasicMaterial({color:0xd7eee1}));
  // Bench, ventilation grille and an emergency kit make the space inhabited.
  box(booth,0,.48,-2.9,2.5,.12,.65,dark);
  for(const x of [-1,1])box(booth,x,.25,-2.9,.1,.5,.5,steel);
  for(let i=0;i<6;i++)box(booth,.65,2.2+i*.06,-3.29,.85,.025,.05,dark);
  box(booth,-.9,1.45,-3.25,.6,.6,.12,steel);
  box(booth,-.9,1.45,-3.17,.1,.4,.02,pale);box(booth,-.9,1.45,-3.17,.4,.1,.02,pale);
  const doors=[-1,1].map(side=>{
    const panel=new THREE.Group();panel.position.x=side*.71;booth.add(panel);
    box(panel,0,1.35,0,1.4,2.6,.05,glass);
    for(const x of [-.68,.68])box(panel,x,1.35,.03,.055,2.7,.08);
    for(const y of [.07,.65,2.65])box(panel,0,y,.03,1.4,.07,.08);
    box(panel,0,.45,.04,1.32,.38,.06,pale);
    box(panel,-side*.5,1.2,.08,.06,.3,.08,amber);
    return panel;
  });
  let removeDoor=addCollider(1.42,1.35,.07,position.x,1.35,position.z);
  let doorPresent=true;
  for(const x of [-1.55,1.55])box(booth,x,1.4,.06,.12,2.8,.16,steel);
  box(booth,0,2.68,.13,2.8,.06,.06,status);
  // Road-side handle stays outside both the wall and the sliding panel travel.
  const control=new THREE.Vector3(position.x+2.1,0,position.z+.65);
  box(booth,2.1,.7,.65,.35,1.4,.35,steel);
  box(booth,2.1,1.38,.8,.45,.35,.12,dark);
  box(booth,2.1,1.4,.88,.28,.12,.04,status);
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#13272c';ctx.fillRect(0,0,512,128);
  ctx.fillStyle='#e6cb8c';ctx.font='bold 33px sans-serif';ctx.textAlign='center';ctx.fillText('ISOLATION ROOM',256,48);
  ctx.fillStyle='#e4eeeb';ctx.font='23px sans-serif';ctx.fillText('EMERGENCY RELEASE  →',256,96);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(2.9,.72),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas)}));
  sign.position.set(0,3.14,.13);booth.add(sign);
  const worker=new THREE.Group();worker.name='Rescue technician';worker.position.copy(position).add(new THREE.Vector3(0,0,-1.9));scene.add(worker);
  // Articulated fallback keeps the rescue readable if an optional model fails.
  const fallback=new THREE.Group();worker.add(fallback);
  const skin=new THREE.MeshStandardMaterial({color:0xad7957,roughness:.9});
  box(fallback,0,1.12,0,.48,.65,.27,amber);
  box(fallback,0,1.58,0,.27,.32,.25,skin);
  for(const side of [-1,1]){box(fallback,side*.14,.43,0,.18,.8,.22,dark);box(fallback,side*.33,1.02,0,.15,.67,.17,amber);box(fallback,side*.33,.65,0,.13,.14,.15,skin);}
  let mixer=null,actions={},current=null,phase='locked',time=0,walkTime=0,waypoint=0;
  const path=[new THREE.Vector3(position.x,0,position.z+1.8),new THREE.Vector3(position.x,0,position.z+5.5)];
  const direction=new THREE.Vector3();
  function play(name){const next=actions[name];if(!next||next===current)return;current?.fadeOut(.25);next.reset().fadeIn(.25).play();current=next;}
  const ready=Promise.all([loadGLB('assets/citizens/construction.glb'),loadAnimations()]).then(([gltf,animation])=>{
    const root=cloneSkeleton(gltf.scene);
    const fitted={};
    for(const name of ['idle','walk']){
      const clip=animation.clips.find(c=>c.name===(name==='idle'?'listen':name))||animation.clips.find(c=>c.name===name);
      if(clip)fitted[name]=fitClip(clip,animation.skeletonRoot,root);
    }
    root.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(root);
    root.scale.setScalar(1.78/Math.max(.1,bounds.max.y-bounds.min.y));
    root.updateMatrixWorld(true);bounds.setFromObject(root);
    root.position.set(-(bounds.max.x+bounds.min.x)/2,-bounds.min.y,-(bounds.max.z+bounds.min.z)/2);
    // Approximate the booth's emergency fill without another per-pixel light.
    // Own the material copies so the shared citizen model stays untouched.
    const litMaterials=new Map();
    function lit(material){
      if(!night||!material.emissive)return material;
      if(!litMaterials.has(material)){
        const copy=material.clone();copy.emissive.setHex(0x8eb4aa);
        copy.emissiveMap=copy.map;copy.emissiveIntensity=.35;litMaterials.set(material,copy);
      }
      return litMaterials.get(material);
    }
    root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;o.material=Array.isArray(o.material)?o.material.map(lit):lit(o.material);}});
    worker.add(root);fallback.visible=false;mixer=new THREE.AnimationMixer(root);
    for(const [name,clip] of Object.entries(fitted))actions[name]=mixer.clipAction(clip);
    play('idle');mixer.update(0);
  }).catch(error=>console.warn('Technician uses fallback model:',error));
  // Batch fixtures by material; keep each sliding door as its own moving group.
  for(const group of [booth,...doors]){
    const batches=new Map();
    for(const mesh of [...group.children]){
      if(!mesh.isMesh||mesh.geometry!==cube)continue;
      mesh.updateMatrix();const geometry=cube.clone().applyMatrix4(mesh.matrix);
      if(!batches.has(mesh.material))batches.set(mesh.material,[]);
      batches.get(mesh.material).push(geometry);group.remove(mesh);
    }
    for(const [material,parts] of batches){
      const mesh=new THREE.Mesh(mergeGeometries(parts,false),material);
      mesh.castShadow=material!==glass;mesh.receiveShadow=true;group.add(mesh);
      parts.forEach(part=>part.dispose());
    }
  }
  return {
    booth,worker,control,ready,
    reset(){
      if(!doorPresent){removeDoor=addCollider(1.42,1.35,.07,position.x,1.35,position.z);doorPresent=true;}
      phase='locked';time=walkTime=waypoint=0;
      doors.forEach((door,i)=>door.position.x=(i?1:-1)*.71);
      worker.position.copy(position).add(new THREE.Vector3(0,0,-1.9));worker.rotation.set(0,0,0);fallback.rotation.set(0,0,0);
      status.color.setHex(0xe2ac44);mixer?.stopAllAction();current=null;play('idle');mixer?.update(0);
    },
    get phase(){return phase;},
    get safe(){return phase==='safe';},
    get released(){return phase!=='locked';},
    release(){if(phase!=='locked')return false;phase='opening';time=0;status.color.setHex(0x85ddaf);return true;},
    update(dt){
      dt=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));time+=dt;
      if(phase==='opening'){
        const t=Math.min(1,time/1.6),ease=t*t*(3-2*t);
        doors.forEach((door,i)=>door.position.x=(i?1:-1)*(.71+1.4*ease));
        if(t===1){removeDoor();doorPresent=false;phase='evacuating';time=0;play('walk');}
      }
      if(phase==='evacuating'){
        const goal=path[waypoint];direction.subVectors(goal,worker.position);const distance=direction.length(),step=Math.min(distance,dt*1.15);
        if(distance>.001){worker.rotation.y=Math.atan2(direction.x,direction.z);worker.position.addScaledVector(direction,step/distance);}
        walkTime+=dt;fallback.rotation.z=Math.sin(walkTime*8)*.035;
        if(distance<=step+.001&&++waypoint>=path.length){phase='safe';play('idle');fallback.rotation.z=0;worker.rotation.y=Math.PI/2;}
      }
      mixer?.update(dt);
    },
  };
}
