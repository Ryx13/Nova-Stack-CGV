import * as THREE from 'three';

// Owns only the opening camera and letterbox; the doctor briefing follows it.
export function createLevel3Intro({camera,state,playerVis,playerBody,syncHandGun}){
 const V=(x,y,z)=>new THREE.Vector3(x,y,z),up=V(0,1,0);
 const quat=(p,look)=>new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(p,look,up));
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 let active=true,started=false,elapsed=0,shown=-1,overlay=null,shots=[],startPose=null,finishPose=null;
 state.cinematic=true;state.keys={};state.firePressed=false;document.body.classList.add('lv3-intro');
 function build(){
  const feet=V(playerBody.position.x,0,playerBody.position.z),origin=feet.clone().add(V(0,1.52,0));
  const fwd=V(-Math.sin(state.yaw),0,-Math.cos(state.yaw)),right=V(Math.cos(state.yaw),0,-Math.sin(state.yaw));
  const cp=Math.cos(state.pitch),sp=Math.sin(state.pitch);
  const end=origin.clone().addScaledVector(fwd,-3.55*cp).addScaledVector(right,.62).add(V(0,.35+sp*1.6,0));
  const look=origin.clone().addScaledVector(fwd,10*cp).addScaledVector(right,.15).add(V(0,sp*10,0));
  finishPose={pos:end,quat:quat(end,look)};
  const initial=feet.clone().add(V(3,7.5,10));startPose={pos:initial,quat:quat(initial,feet.clone().add(V(0,1,0)))};
  shots=[
   {pos:V(2,5,-13),look:V(0,3,-25),move:1.6,hold:2, lift:.06,tag:'01 · Quarantine perimeter',title:'The last signal',sub:'The cure is ready. The city is still waiting.'},
   {pos:V(-9,3.2,-42),look:V(-18,1.8,-55),move:2,hold:2,lift:.07,tag:'02 · The field hospital',title:'There is still time',sub:'One transmission could bring the infected back.'},
   {pos:V(3.5,4.8,-140),look:V(10.9,1.5,-155),move:2.4,hold:2,lift:.08,tag:'03 · Auxiliary power',title:'Bring the facility online',sub:'Generator. Cooling. Uplink. The tower needs all three.'},
   {pos:V(2,8,-160),look:V(0,18,-198),move:1.8,hold:2,lift:.03,tag:'04 · The Broadcast Tower',title:'Reach the transmitter',sub:'Something inside the compound heard you coming.'},
   {pos:end,look,move:2.6,hold:.45,lift:.06,tag:'Deadway City · Final mission',title:'One last chance',sub:'Dr. James is on the radio.'}
  ];
  let time=0;shots=shots.map(shot=>{const item={...shot,t0:time,t1:time+shot.move,t2:time+shot.move+shot.hold,quat:quat(shot.pos,shot.look)};time=item.t2;return item;});
  if(!document.getElementById('lv3-intro-style')){
   const style=document.createElement('style');style.id='lv3-intro-style';style.textContent=`
   body.lv3-intro #hud,body.lv3-intro #coin-label,body.lv3-intro #weapon-label,body.lv3-intro #fuel-wrap,body.lv3-intro #shield-label,body.lv3-intro #lv3-cure-tools,body.lv3-intro .dw-log-button{visibility:hidden!important}
   #lv3-intro{position:fixed;inset:0;z-index:40;pointer-events:none;overflow:hidden;font-family:inherit;color:#f4ece0}
   #lv3-intro .bar{position:absolute;left:0;right:0;height:9vh;background:#000}#lv3-intro .top{top:0}#lv3-intro .bottom{bottom:0}
   #lv3-intro .caption{position:absolute;left:5%;right:5%;bottom:13vh;text-align:center;text-shadow:0 2px 12px #000;animation:lv3-caption .45s ease-out}
   #lv3-intro .tag{font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:#e0a83c;margin:0 0 8px}
   #lv3-intro h2{font-size:clamp(25px,4.4vw,46px);letter-spacing:.12em;text-transform:uppercase;margin:0}
   #lv3-intro .sub{font-size:clamp(14px,1.7vw,18px);line-height:1.45;margin:8px auto 0;max-width:760px;color:#e6dccd}
   #lv3-intro button{position:absolute;right:18px;top:calc(9vh + 12px);pointer-events:auto;cursor:pointer;background:#10171cbb;border:1px solid #e0a83c66;padding:8px 12px;color:#e6dccd;font:inherit;font-size:12px;letter-spacing:.1em}
   @keyframes lv3-caption{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
   @media(prefers-reduced-motion:reduce){#lv3-intro .caption{animation:none}}
   @media(max-height:560px){#lv3-intro .caption{bottom:11vh}#lv3-intro h2{font-size:26px}#lv3-intro .sub{font-size:13px}}
   `;document.head.appendChild(style);
  }
  overlay=document.createElement('section');overlay.id='lv3-intro';overlay.setAttribute('aria-label','Level 3 cinematic opening');
  overlay.innerHTML='<div class="bar top"></div><div class="bar bottom"></div><div class="caption"><p class="tag"></p><h2></h2><p class="sub"></p></div><button type="button">Skip cinematic · any key</button>';
  document.body.appendChild(overlay);overlay.querySelector('button').addEventListener('click',finish);
  window.addEventListener('keydown',skip,true);window.addEventListener('pointerdown',skip,true);
  camera.position.copy(startPose.pos);camera.quaternion.copy(startPose.quat);started=true;
 }
 function skip(event){
  if(!active||!started||state.paused||event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
  event.preventDefault();event.stopImmediatePropagation();finish();
 }
 function finish(){
  if(!active)return;active=false;
  window.removeEventListener('keydown',skip,true);window.removeEventListener('pointerdown',skip,true);
  overlay?.remove();document.body.classList.remove('lv3-intro');
  if(finishPose){camera.position.copy(finishPose.pos);camera.quaternion.copy(finishPose.quat);camera.updateMatrixWorld(true);}
  state.keys={};state.firePressed=false;state.isSprinting=false;state.cinematic=false;
 }
 function update(dt){
  if(!active||!state.readyShown||state.paused)return;
  playerVis.group.position.set(playerBody.position.x,0,playerBody.position.z);
  if(!started)build();
  const delta=Math.max(0,Math.min(Number(dt)||0,.05));elapsed+=delta;
  if(playerVis.mixer)playerVis.mixer.update(delta);
  for(const enemy of state.zombies||[])if(enemy.mixer)enemy.mixer.update(delta);
  syncHandGun();
  const i=shots.findIndex((shot,index)=>elapsed<shot.t2||index===shots.length-1),shot=shots[i],from=i===0?startPose:shots[i-1];
  let u=THREE.MathUtils.clamp((elapsed-shot.t0)/shot.move,0,1);u=u*u*(3-2*u);
  if(reduced){camera.position.copy(shot.pos);camera.quaternion.copy(shot.quat);}else{
   camera.position.lerpVectors(from.pos,shot.pos,u);camera.position.y+=Math.sin(Math.PI*u)*from.pos.distanceTo(shot.pos)*(shot.lift||0);camera.quaternion.slerpQuaternions(from.quat,shot.quat,u);
  }
  camera.updateMatrixWorld(true);
  if(shown!==i){shown=i;const c=overlay.querySelector('.caption');c.querySelector('.tag').textContent=shot.tag;c.querySelector('h2').textContent=shot.title;c.querySelector('.sub').textContent=shot.sub;c.style.animation='none';void c.offsetWidth;c.style.animation='';overlay.dataset.shot=String(i);}
  if(elapsed>=shots[shots.length-1].t2)finish();
 }
 return {get active(){return active;},get duration(){return shots.length?shots.at(-1).t2:18.85;},update,skip:finish,destroy:finish};
}
