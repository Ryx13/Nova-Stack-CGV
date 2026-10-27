import * as THREE from 'three';
import {setCinematicDuck} from './Music.js';

// A visual-only entrance: no damage, AI or new particle/light allocations.
export function createGuardianAwakening({camera,state,scene,boss,sfx}){
 const home=camera.position.clone(),rotation=camera.quaternion.clone();
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const lamps=[];scene.traverse(o=>{if(o.isPointLight&&lamps.length<8)lamps.push({o,color:o.color.clone(),intensity:o.intensity});});
 let active=true,time=0,hissed=false,roared=false;
 const target=new THREE.Vector3(0,3,-181),returnFrom=new THREE.Vector3(3,3.1,-172),up=new THREE.Vector3(0,1,0);
 const returnRotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(returnFrom,target,up));
 const guardian=boss.guardian;guardian.beginCinematicPreview(true);
 document.body.classList.add('lv3-intro');
 state.cinematic=true;state.keys={};state.firePressed=false;
 const overlay=document.createElement('section');overlay.id='guardian-awakening';
 overlay.style.cssText='position:fixed;inset:0;z-index:45;pointer-events:none;border-top:9vh solid #000;border-bottom:9vh solid #000;box-sizing:border-box;color:#eee;text-align:center';
 overlay.innerHTML='<div style="position:absolute;bottom:5%;width:100%;text-shadow:0 2px 8px #000"><h2 style="letter-spacing:.2em">THE GUARDIAN AWAKENS</h2><p>Something is breathing in the dark.</p></div><button style="position:absolute;right:18px;top:12px;pointer-events:auto">Skip entrance</button>';
 document.body.append(overlay);const caption=overlay.querySelector('p');
 overlay.querySelector('button').onclick=finish;
 window.addEventListener('keydown',skip,true);window.addEventListener('pointerdown',skip,true);
 setCinematicDuck(.3);sfx.burst('sawtooth',38,2,.035);
 function skip(e){if(!active||state.paused||e.ctrlKey||e.metaKey||e.altKey)return;e.preventDefault();e.stopImmediatePropagation();finish();}
 function finish(){
  if(!active)return;active=false;
  guardian.endCinematicPreview();boss.mesh.position.z=-180;
  guardian.combat.enter('entrance');guardian.activate();
  lamps.forEach(({o,color,intensity})=>{o.color.copy(color);o.intensity=intensity;});
  camera.position.copy(home);camera.quaternion.copy(rotation);camera.updateMatrixWorld(true);
  overlay.remove();document.body.classList.remove('lv3-intro');window.removeEventListener('keydown',skip,true);window.removeEventListener('pointerdown',skip,true);
  state.keys={};state.firePressed=false;state.cinematic=false;setCinematicDuck(1);
 }
 function update(dt){
  if(!active||state.paused)return;dt=Math.max(0,Math.min(.05,Number(dt)||0));time+=dt;
  guardian.updateCinematicPreview(dt);
  overlay.style.background=time<3?'radial-gradient(ellipse at center,transparent 5%,rgba(0,0,0,.82) 100%)':time<6?'rgba(0,0,0,.22)':time<10?'rgba(110,0,0,.09)':'transparent';
  if(time>=3&&!hissed){hissed=true;caption.textContent='Containment has failed.';}
  if(time>=7&&!roared){roared=true;setCinematicDuck(0);sfx.noise(.9,.15,95);sfx.burst('sawtooth',46,1.4,.1);caption.textContent='Move when it braces. Strike when it recovers.';}
  lamps.forEach(({o,color,intensity},i)=>{if(time<6){o.color.copy(color);o.intensity=intensity*(.15+.35*Math.abs(Math.sin(time*17+i)));}else{o.color.setHex(0xff3020);o.intensity=intensity*(.65+.2*Math.sin(time*8+i));}});
  if(time<10){camera.position.set(5-time*.2,2.4+time*.07,-169-time*.3);camera.lookAt(target);}
  else{const u=THREE.MathUtils.smoothstep(time,10,13.5);camera.position.lerpVectors(returnFrom,home,u);camera.quaternion.slerpQuaternions(returnRotation,rotation,u);}
  if(!reduced&&time>=3&&time<8)camera.position.x+=Math.sin(time*71)*.025;
  camera.updateMatrixWorld(true);if(time>=14)finish();
 }
 return {get active(){return active;},update,skip:finish,destroy:finish};
}
