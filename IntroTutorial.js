// IntroTutorial.js — a self-contained Three.js safe-room tutorial.
// No Scene/state/Actions imports: it is intentionally not a game level.
//
// Fixes applied:
//   3. The desk is now a real barrier: movement is tested against its
//      footprint (with a small player-radius buffer) and resolved per-axis,
//      so you can no longer walk straight through it to the pistol/door.
//   4. The look-direction math was wrong (it added an unscaled vertical
//      offset to a yaw-only forward vector, which "skewed" the view instead
//      of properly combining yaw and pitch). It's replaced with a standard
//      FPS camera rotation (Euler order 'YXZ'), which is the mathematically
//      correct way to combine the two and matches this file's own
//      sin(yaw)/cos(yaw) movement convention.
import * as THREE from 'three';
import { updateLocomotion } from './Movement.js';
import { createStoryAudio } from './StoryAudio.js';
import { createNarrative } from './Narrative.js';
import { createTutorialAvatar } from './TutorialAvatar.js';

let active = null;

function makePanel() {
  const el = document.createElement('div');
  el.id = 'safe-room-ui';
  el.innerHTML = `<style>
    #safe-room-ui{position:fixed;inset:0;z-index:25;pointer-events:none;color:#eee;font-family:Rajdhani,sans-serif} #safe-room-ui .tag{position:absolute;top:22px;left:22px;letter-spacing:3px;font:700 12px Oswald,sans-serif;color:#bff0ff} #safe-room-ui .objective{position:absolute;top:48px;left:22px;max-width:390px;background:rgba(3,8,10,.76);border:1px solid rgba(191,240,255,.35);padding:10px 14px;letter-spacing:1px} #safe-room-ui .sub{position:absolute;left:50%;bottom:11%;transform:translateX(-50%);width:min(720px,88vw);text-align:center;font-size:19px;line-height:1.4;text-shadow:0 2px 7px #000} #safe-room-ui .hint{position:absolute;left:50%;bottom:42px;transform:translateX(-50%);padding:9px 15px;background:rgba(3,8,10,.8);border:1px solid rgba(255,255,255,.2);letter-spacing:1px} #safe-room-ui .hint.hidden{display:none}
  </style><div style="position:absolute;left:50%;top:50%;color:#bff0ff;transform:translate(-50%,-50%)">+</div><div class="tag">OPENING / SAFE ROOM</div><div class="objective"></div><div class="sub"></div><div class="hint">WASD — move &nbsp; • &nbsp; Mouse — look</div>`;
  document.body.appendChild(el);
  return { root: el, objective: el.querySelector('.objective'), sub: el.querySelector('.sub'), hint: el.querySelector('.hint') };
}

function box(scene, x, y, z, sx, sy, sz, color, emissive = 0) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .15, emissive: color, emissiveIntensity: emissive });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh); return mesh;
}

export function startSafeRoomTutorial({ onComplete }) {
  if (active) active.dispose();
  const canvas = document.getElementById('game-canvas');
  const ui = makePanel();
  const training=document.createElement('aside');training.className='dw-card dw-training';ui.root.append(training);
  const manual=document.createElement('button');manual.className='dw-button quiet';manual.textContent='Field guide / H';manual.style.cssText='position:absolute;right:20px;top:70px;pointer-events:auto';ui.root.append(manual);
  const view=document.createElement('button');view.className='dw-button quiet';view.style.cssText='position:absolute;right:180px;top:20px;pointer-events:auto';ui.root.append(view);
  const audio = createStoryAudio();
  const skip = document.createElement('button'); skip.textContent = 'Skip training';
  skip.style.cssText = 'position:absolute;right:20px;top:20px;pointer-events:auto';
  ui.root.appendChild(skip); skip.onclick = () => finish();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x071015); scene.fog = new THREE.Fog(0x071015, 8, 28);
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, .05, 100); camera.position.set(0, 1.65, 5.5);
  camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight(0x91c7d4, 0x101012, 1.4));
  const lamp = new THREE.PointLight(0xbff0ff, 28, 18, 2); lamp.position.set(0, 3.1, 2); lamp.castShadow = true; scene.add(lamp);
  const alarm = new THREE.PointLight(0xff4b38, 8, 9, 2); alarm.position.set(-5, 2.8, -4); scene.add(alarm);
  // Room shell; the northern wall is split around the locked blast door.
  box(scene, 0, -.15, 0, 14, .3, 14, 0x182026); box(scene, 0, 3.5, 0, 14, .2, 14, 0x11171b);
  box(scene, -7, 1.75, 0, .25, 3.5, 14, 0x1d282f); box(scene, 7, 1.75, 0, .25, 3.5, 14, 0x1d282f); box(scene, 0, 1.75, 7, 14, 3.5, .25, 0x1d282f);
  box(scene, -4.8, 1.75, -7, 4.2, 3.5, .25, 0x1d282f); box(scene, 4.8, 1.75, -7, 4.2, 3.5, .25, 0x1d282f);
  const blastDoor = box(scene, 0, 1.75, -7, 3.6, 3.5, .32, 0x3f555e); blastDoor.userData.openY = 5.6;
  // Desk and unmistakable cyan pistol pickup.
  box(scene, 0, .85, .2, 3.3, 1.5, 1.4, 0x42372e); box(scene, 0, 1.65, .2, 3.5, .15, 1.55, 0x67594b);
  const pistol = new THREE.Group(); pistol.position.set(0, 1.9, .15); pistol.add(box(pistol, 0, 0, 0, .72, .19, .28, 0xbff0ff, .55)); pistol.add(box(pistol, -.16, -.23, .02, .22, .4, .18, 0x9fcbd6, .25)); scene.add(pistol);
  // Dr. James: procedural silhouette behind reinforced glass.
  const glass = box(scene, -4.7, 1.7, -2.5, .08, 3, 3.4, 0x7fc8df); glass.material.transparent = true; glass.material.opacity = .2;
  const scientist = new THREE.Group(); scientist.position.set(-5.35, 0, -2.5); scientist.add(box(scientist, 0, 1.1, 0, .62, 1.65, .45, 0xe5e9e7)); const head = new THREE.Mesh(new THREE.SphereGeometry(.32, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd6a57e })); head.position.y = 2.05; scientist.add(head); scene.add(scientist);

  const monitorCanvas = document.createElement('canvas'); monitorCanvas.width = 512; monitorCanvas.height = 128;
  const mc = monitorCanvas.getContext('2d'); mc.fillStyle = '#071112'; mc.fillRect(0,0,512,128);
  mc.fillStyle = '#ff795c'; mc.font = 'bold 30px monospace'; mc.fillText('CONTAINMENT BREACH', 30, 57);
  mc.fillStyle = '#bff0ff'; mc.font = '19px monospace'; mc.fillText('DR. JAMES / SECURE CHANNEL', 30, 96);
  const monitor = new THREE.Mesh(new THREE.PlaneGeometry(3.8, .95), new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(monitorCanvas)}));
  monitor.position.set(-3, 2.5, -6.8); scene.add(monitor);
  const target = box(scene, 4.5, 1.6, -6.5, 1.2, 1.6, .15, 0xff875e, .25);
  const ray = new THREE.Raycaster();
  let shots = 0, practicedSprint = false, practicedReload = false;
  const movement = { keys: {}, playerStamina:100, staminaExhausted:false, currentSpeed:3.7 };
  // Desk collision footprint (the desk legs/body at (0,.85,.2) 3.3x1.5x1.4,
  // plus the slightly wider desktop at (0,1.65,.2) 3.5x.15x1.55), padded by
  // a player radius so you can't clip the corners either.
  const PLAYER_R = 0.4;
  const DESK_MIN_X = -1.75 - PLAYER_R, DESK_MAX_X = 1.75 + PLAYER_R;
  const DESK_MIN_Z = 0.2 - 0.775 - PLAYER_R, DESK_MAX_Z = 0.2 + 0.775 + PLAYER_R;
  function insideDesk(x, z) { return x > DESK_MIN_X && x < DESK_MAX_X && z > DESK_MIN_Z && z < DESK_MAX_Z; }

  const keys = movement.keys, playerPosition=new THREE.Vector3(0,0,5.5);
  let yaw=Math.PI,pitch=0,phase='bearings',raf=0,last=performance.now(),done=false,blocked=false,shot=null;
  let thirdPerson=false;try{thirdPerson=localStorage.getItem('deadway.intro.view')==='third';}catch{}
  const avatar=createTutorialAvatar(scene),cameraRay=new THREE.Raycaster(),direction=new THREE.Vector3(),desired=new THREE.Vector3(),anchor=new THREE.Vector3();
  const blockers=scene.children.filter(o=>o.isMesh&&o!==target&&o!==monitor);
  const sidearm=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.45),new THREE.MeshStandardMaterial({color:0x343f43,metalness:.65,roughness:.3}));sidearm.position.set(.28,-.24,-.5);camera.add(sidearm);scene.add(camera);
  const floorLights=new THREE.InstancedMesh(new THREE.BoxGeometry(.12,.02,.45),new THREE.MeshBasicMaterial({color:0xe0a83c}),8),lm=new THREE.Object3D();
  for(let i=0;i<8;i++){lm.position.set(3,.02,4-i*1.2);lm.updateMatrix();floorLights.setMatrixAt(i,lm.matrix);}scene.add(floorLights);floorLights.visible=false;
  const clearKeys=()=>{for(const key of Object.keys(keys))keys[key]=false;};
  const lock=()=>{if(!blocked)canvas.requestPointerLock()?.catch(()=>{});};
  const narrative=createNarrative({onBlock:value=>{blocked=value;clearKeys();},onRelease:lock,onShot:value=>{shot=value;}});
  function toggleView(){thirdPerson=!thirdPerson;try{localStorage.setItem('deadway.intro.view',thirdPerson?'third':'first');}catch{}paintView();}
  function paintView(){view.textContent=(thirdPerson?'Third-person':'First-person')+' / V';}
  view.onclick=toggleView;paintView();
  const guideText='WASD: move · Mouse: aim · Hold Shift + W: sprint · E: interact · Left click: shoot · R: reload · V: change perspective. In the campaign: C/Ctrl crouch · Space jump (handbrake in car) · Q switch gun/knife · Right click melee · F enter/exit car · Tab pause · Esc release mouse. Tutorial: H opens this guide. Walking restores stamina; exhaustion locks sprint until 25% recovery.';
  manual.onclick=()=>narrative.openLog(guideText);
  const stages={
    bearings:{tag:'01 / RECOVER YOUR BEARINGS',title:'Find Dr. James',text:'Click the scene to look around. Move to the scientist behind the glass.',keys:['W','A','S','D','V']},
    weapon:{tag:'02 / PREPARE THE SIDEARM',title:'Take the sidearm',text:'Approach the glowing weapon. Press E to collect it.',keys:['W','A','S','D','E']},
    shoot:{tag:'03 / STABILIZE',title:'Aim. Then breathe.',text:'Look at the orange training plate and fire. A hit turns it cyan.',keys:['LMB','V']},
    reload:{tag:'04 / RELOAD',title:'Make every round count',text:'Press R to reload before leaving cover.',keys:['R']},
    sprint:{tag:'05 / EMERGENCY EXIT',title:'Follow the amber lights',text:'Hold Shift while moving forward. Build two seconds of sprint practice; turn around if you reach the wall. Walk to recover stamina.',keys:['W','Shift']},
    exit:{tag:'06 / DEPLOYMENT READY',title:'The city needs you',text:'The blast door is opening. Walk through when ready.',keys:['W','V']}
  };
  let sprintTime=0,walkDistance=0,reloadTime=0,elapsed=0,lastPhase='';
  function paintTraining(){const info=stages[phase];if(!info)return;if(lastPhase!==phase){lastPhase=phase;training.innerHTML=`<div class="dw-eyebrow">${info.tag}</div><h3>${info.title}</h3><p>${info.text}</p><div>${info.keys.map(k=>`<span class="dw-key" data-key="${k}">${k}</span>`).join('')}</div><progress max="100" value="0" aria-label="Training progress"></progress><small class="dw-done"></small>`;ui.objective.textContent=info.title;}
   for(const k of training.querySelectorAll('[data-key]')){const name=k.dataset.key;k.classList.toggle('pressed',name==='Shift'?!!(keys.ShiftLeft||keys.ShiftRight):name==='LMB'?!!keys.Mouse0:!!keys['Key'+name]);}
   training.querySelector('progress').value=phase==='sprint'?sprintTime/2*100:phase==='reload'?Math.min(100,reloadTime/1.2*100):phase==='bearings'?Math.min(100,walkDistance/7*100):0;
   training.querySelector('small').textContent=phase==='sprint'?`Stamina ${Math.round(movement.playerStamina)}%${movement.staminaExhausted?' / recovering':''}`:'Open your field guide for controls and transmissions.';
  }
  async function briefing(){phase='briefing';await narrative.show({id:'james-intro',mode:'choice',speaker:'DR. JAMES / SAFE ROOM',title:'You made it.',text:'The earthquake damaged the lab. I saw you outside and opened the door. The people outside are still alive. We can bring them back.',shot:'scientist',choices:[{id:'why',label:'What happened to them?',detail:'Ask how the accident happened.'},{id:'help',label:'Tell me how to help.',detail:'Learn the route to the cure.'}]}).then(async choice=>{if(done)return;await narrative.show({id:'james-answer',mode:'cinematic',speaker:'DR. JAMES',title:choice==='why'?'They are not lost.':'Three steps. One chance.',text:choice==='why'?'The chemicals turned people into zombies. Use your weapons to stop attacks. We need the cure to save the city. Take the gun and practise here first.':'Clear the street. Recover the component before it reaches the port. Then power the tower to disperse the cure. First, let me show you how to stay alive.',shot:'scientist'});});if(done)return;phase='weapon';ui.sub.textContent='DR. JAMES: The sidearm is on the desk. We will practise before you leave.';}
  function interact(){if(phase==='weapon'&&playerPosition.distanceTo(pistol.position)<2.7){pistol.visible=false;phase='shoot';audio.cue();narrative.show({id:'pistol',mode:'radio',speaker:'DR. JAMES',text:'Aim at the orange target and click to shoot. In Level 3, normal zombies take two body shots or two knife hits.'});}}
  const keydown=e=>{if(e.code==='Tab')e.preventDefault();if(blocked)return;if(e.code==='KeyH'&&!e.repeat){manual.onclick();return;}if(e.code==='KeyV'&&!e.repeat){toggleView();return;}keys[e.code]=true;if(e.code==='KeyE'&&!e.repeat)interact();if(phase==='reload'&&e.code==='KeyR'&&!e.repeat&&reloadTime===0){reloadTime=.001;audio.cue();}};
  const keyup=e=>{keys[e.code]=false;};
  const mousemove=e=>{if(!blocked&&document.pointerLockElement===canvas){yaw-=e.movementX*.0025;pitch=THREE.MathUtils.clamp(pitch-e.movementY*.002,-1.1,1.1);}};
  const shoot=e=>{if(e.button!==0||blocked||document.pointerLockElement!==canvas||phase!=='shoot')return;keys.Mouse0=true;audio.cue();ray.setFromCamera(new THREE.Vector2(),camera);if(ray.intersectObject(target).length){shots++;target.material.color.setHex(0x8fe0ff);phase='reload';narrative.show({id:'target',mode:'radio',speaker:'DR. JAMES',text:'Good hit. Press R to reload.'});}};
  const mouseup=()=>{keys.Mouse0=false;};
  const visibility=()=>{if(document.hidden)clearKeys();};
  const pointerChange=()=>{if(document.pointerLockElement!==canvas)clearKeys();};
  addEventListener('keydown',keydown);addEventListener('keyup',keyup);addEventListener('mousemove',mousemove);addEventListener('mouseup',mouseup);addEventListener('blur',clearKeys);document.addEventListener('visibilitychange',visibility);document.addEventListener('pointerlockchange',pointerChange);canvas.addEventListener('click',lock);canvas.addEventListener('mousedown',shoot);
  function finish(){if(done)return;done=true;document.exitPointerLock();dispose();const card=document.createElement('section');card.className='dw-modal';card.innerHTML='<div class="dw-card"><div class="dw-eyebrow">FIELD GUIDE / READY</div><h2>Your delivery is not over.</h2><p>Dr. James is counting on you. Clear the street, recover the component, and bring the city home.</p><button class="dw-button primary">Choose deployment</button></div>';document.body.append(card);card.querySelector('button').focus();card.querySelector('button').onclick=()=>{card.remove();onComplete?.();};}
  function tick(now){
   const dt=Math.min(.05,(now-last)/1000);last=now;narrative.update(dt);elapsed+=dt;
   const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
   alarm.intensity=reduced?5:5+Math.sin(elapsed*3)*1.5;lamp.intensity=26;
   if(!blocked&&!document.hidden){
    movement.crouching=!!(keys.KeyC||keys.ControlLeft||keys.ControlRight);updateLocomotion(movement,dt,(keys.KeyW?1:0)-(keys.KeyS?1:0));
    const forward=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw)),left=new THREE.Vector3(forward.z,0,-forward.x),move=new THREE.Vector3();
    if(keys.KeyW)move.add(forward);if(keys.KeyS)move.sub(forward);if(keys.KeyA)move.add(left);if(keys.KeyD)move.sub(left);
    const old=playerPosition.clone();if(move.lengthSq()){move.normalize().multiplyScalar(dt*movement.currentSpeed);const nx=THREE.MathUtils.clamp(playerPosition.x+move.x,-6.35,6.35);if(!insideDesk(nx,playerPosition.z))playerPosition.x=nx;const nz=THREE.MathUtils.clamp(playerPosition.z+move.z,-6.35,6.35);if(!insideDesk(playerPosition.x,nz))playerPosition.z=nz;}
    const distance=playerPosition.distanceTo(old);walkDistance+=distance;avatar.update(dt,distance>.001,movement.isSprinting);
    if(phase==='bearings'&&walkDistance>1&&playerPosition.distanceTo(scientist.position)<3.2)briefing();
    if(phase==='reload'&&reloadTime>0){reloadTime+=dt;if(reloadTime>=1.2){practicedReload=true;phase='sprint';floorLights.visible=true;narrative.show({id:'reload-done',mode:'radio',speaker:'DR. JAMES',text:'Magazine ready. Follow the amber lights. Hold Shift with W to sprint; let go to walk and recover.'});}}
    if(phase==='sprint'&&movement.isSprinting&&distance>.001){sprintTime+=dt;if(sprintTime>=2){practicedSprint=true;phase='exit';narrative.show({id:'exit',mode:'cinematic',speaker:'DR. JAMES / FINAL CHECK',title:'Bring them home.',text:'You have the route. I will stay on the radio. The people outside are counting on us.',shot:'door',continueLabel:'Open the blast door'});}}
    if(phase==='exit'){blastDoor.position.y=THREE.MathUtils.lerp(blastDoor.position.y,blastDoor.userData.openY,dt*2);if(playerPosition.z< -6&&Math.abs(playerPosition.x)<1.6)return finish();}
   }
   pistol.rotation.y+=dt*1.3;pistol.position.y=1.9+Math.sin(elapsed*2)*.06;
   avatar.group.position.copy(playerPosition);avatar.group.rotation.y=yaw+Math.PI;
   avatar.group.visible=thirdPerson||!!shot;sidearm.visible=!thirdPerson&&!shot&&['shoot','reload','sprint','exit'].includes(phase);
   anchor.copy(playerPosition).y=movement.crouching?1.25:1.65;
   if(shot){desired.set(shot==='scientist'?-2.5:3,2.1,shot==='scientist'?0: -3);camera.position.lerp(desired,reduced?1:1-Math.exp(-4*dt));camera.lookAt(shot==='scientist'?scientist.position.clone().setY(1.65):new THREE.Vector3(0,1.8,-7));}
   else if(thirdPerson){direction.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));desired.copy(anchor).addScaledVector(direction,-2.6);desired.x+=Math.cos(yaw)*.45;desired.z-=Math.sin(yaw)*.45;const delta=desired.clone().sub(anchor),length=delta.length();cameraRay.set(anchor,delta.normalize());cameraRay.far=length;const hit=cameraRay.intersectObjects(blockers,false)[0];if(hit)desired.copy(anchor).addScaledVector(delta,Math.max(.18,hit.distance-.18));desired.x=THREE.MathUtils.clamp(desired.x,-6.7,6.7);desired.z=THREE.MathUtils.clamp(desired.z,-6.7,6.7);desired.y=THREE.MathUtils.clamp(desired.y,.3,3.2);camera.position.copy(desired);camera.lookAt(anchor.clone().addScaledVector(direction,15));}
   else{camera.position.copy(anchor);camera.rotation.set(pitch,yaw+Math.PI,0);}
   ui.hint.textContent=blocked?'Transmission paused exploration':'Click to capture mouse • V changes view • H opens your field guide';paintTraining();renderer.render(scene,camera);raf=requestAnimationFrame(tick);
  }
  function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}
  function dispose(){cancelAnimationFrame(raf);narrative.dispose();avatar.dispose();audio.dispose();removeEventListener('keydown',keydown);removeEventListener('keyup',keyup);removeEventListener('mousemove',mousemove);removeEventListener('mouseup',mouseup);removeEventListener('blur',clearKeys);removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('pointerlockchange',pointerChange);canvas.removeEventListener('click',lock);canvas.removeEventListener('mousedown',shoot);const geometries=new Set(),materials=new Set(),textures=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(m);if(m.map)textures.add(m.map);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());ui.root.remove();renderer.dispose();active=null;}
  addEventListener('resize',resize);active={dispose};raf=requestAnimationFrame(tick);return active;
}
