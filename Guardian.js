import {styleGuardian} from './GuardianAppearance.js';
import * as THREE from 'three';
import {clone as skeletonClone} from 'three/addons/utils/SkeletonUtils.js';
import {loadGLB} from './roster.js';
import {GuardianCombat,GuardianGas,GuardianShockwave,GUARDIAN_RUPTURE_DAMAGE,GUARDIAN_SHOCKWAVE_RADIUS,GUARDIAN_SLAM_RADIUS,GUARDIAN_GAS_RADIUS} from './GuardianCombat.js';

const ASSET='assets/bosses/guardian/guardian.glb?v=20261024-quarantine-1';
export function preloadGuardian(){return loadGLB(ASSET);}
// Join the world's async preparation instead of compiling and drawing the
// entire city a second time. The caller removes the temporary rig after its
// first hidden frame; shared asset materials retain the prepared programs.
export async function warmGuardian(renderer,scene,camera){
  const gltf=await preloadGuardian(),root=skeletonClone(gltf.scene);
  root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;}});
  scene.add(root);
  return ()=>{
    scene.remove(root);
    const skeletons=new Set();root.traverse(o=>{if(o.isSkinnedMesh)skeletons.add(o.skeleton);});
    for(const skeleton of skeletons)skeleton.dispose();
  };
}


export function presentGuardian(boss,{scene,state,sfx,damagePlayer,clampX,obstacles,onDefeated}){
  const combat=new GuardianCombat(),gas=new GuardianGas(),shockwave=new GuardianShockwave();
  const originalKill=boss.confirmedKill.bind(boss);
  boss.mixer?.stopAllAction();if(boss.rigObj)boss.mixer?.uncacheRoot(boss.rigObj);
  // Remove the randomly chosen zombie and its invisible capsule. Hits use the new skin.
  for(const child of [...boss.mesh.children])boss.mesh.remove(child);
  let appearance,root,mixer,current,previous='',disposed=false,stagger=0,staggered=false,clock=0,shutdownTime=0,steamTime=0,ruptureSeen=false,deathImpact=false;
  const actions={},ownedMaterials=[],containmentMaterials=[],containedCoolColor=new THREE.Color(0x21cbb0);
  const panel=document.createElement('section');panel.id='guardian-hud';panel.setAttribute('aria-label','Guardian boss');
  panel.innerHTML=`<style>
  #guardian-hud{position:fixed;z-index:19;top:136px;left:50%;transform:translateX(-50%);width:min(460px,46vw);padding:10px 16px;background:#10140fea;border:1px solid #81794b;color:#e8e6d4;text-align:center;pointer-events:none;font-family:Rajdhani,Arial,sans-serif;box-sizing:border-box}
  #guardian-hud[hidden]{display:none}#guardian-hud .guardian-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}#guardian-hud strong{font-size:20px;letter-spacing:4px}#guardian-hud b{font-size:14px;font-variant-numeric:tabular-nums}
  #guardian-hud progress{display:block;width:100%;height:9px;margin:7px 0;accent-color:#a68442}#guardian-hud .guardian-stage{font-size:11px;letter-spacing:2px;color:#d3c18d;margin-top:2px}#guardian-hud[data-stage="2"] .guardian-stage{color:#ffad83}
  #guardian-hud [data-cue]{display:block;font-size:14px;min-height:18px}#guardian-hud small{display:block;font-size:12px;color:#cecabc;margin-top:4px}
  #guardian-hud .guardian-window{height:3px;margin-top:6px;background:#ffffff15;overflow:hidden}#guardian-hud .guardian-window i{display:block;height:100%;background:#dbb76b;transform-origin:left;transform:scaleX(0)}
  #guardian-hud[data-phase="recovery"]{border-color:#92d9c1}#guardian-hud[data-phase="recovery"] [data-cue]{color:#a5f1d6}#guardian-hud[data-phase="recovery"] .guardian-window i{background:#a5f1d6}
  @media(max-width:760px){#guardian-hud{top:154px;width:86vw}#guardian-hud strong{font-size:16px}}
  </style><div class="guardian-heading"><strong>GUARDIAN / Q-07</strong><b data-health></b></div><div class="guardian-stage">PHASE I · CONTAINMENT</div><progress aria-label="Guardian health"></progress><span data-cue>CONTAINMENT BREACH</span><div class="guardian-window" aria-hidden="true"><i></i></div><small>Keep clear of the pressure system.</small>`;
  document.body.append(panel);const bar=panel.querySelector('progress'),status=panel.querySelector('[data-cue]'),healthText=panel.querySelector('[data-health]'),stageText=panel.querySelector('.guardian-stage'),windowFill=panel.querySelector('.guardian-window i'),hint=panel.querySelector('small');bar.max=boss.maxHealth;bar.value=boss.health;
  const warningMat=new THREE.MeshBasicMaterial({color:0xb5ae50,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false});
  const warning=new THREE.Mesh(new THREE.RingGeometry(.91,1,64),warningMat);warning.rotation.x=-Math.PI/2;warning.visible=false;scene.add(warning);
  const warningFillMat=warningMat.clone();warningFillMat.opacity=.1;
  const warningFill=new THREE.Mesh(new THREE.CircleGeometry(1,48),warningFillMat);warningFill.rotation.x=-Math.PI/2;warningFill.visible=false;scene.add(warningFill);
  warning.name='guardian-attack-boundary';warningFill.name='guardian-attack-countdown';
  const waveMat=warningMat.clone();waveMat.color.setHex(0xffb26b);
  const wave=new THREE.Mesh(new THREE.RingGeometry(.92,1,64),waveMat);wave.rotation.x=-Math.PI/2;wave.visible=false;wave.name='guardian-shockwave';scene.add(wave);
  const limitMat=warningMat.clone();limitMat.color.setHex(0xff9c68);limitMat.opacity=.3;
  const waveLimit=new THREE.Mesh(wave.geometry,limitMat);waveLimit.rotation.x=-Math.PI/2;waveLimit.visible=false;waveLimit.name='guardian-shockwave-limit';waveLimit.scale.setScalar(GUARDIAN_SHOCKWAVE_RADIUS);scene.add(waveLimit);

  const ringGeo=new THREE.RingGeometry(GUARDIAN_GAS_RADIUS-.1,GUARDIAN_GAS_RADIUS,64);
  const rings=gas.clouds.map(()=>{const m=warningMat.clone();m.color.setHex(0x8b963f);const o=new THREE.Mesh(ringGeo,m);o.rotation.x=-Math.PI/2;o.visible=false;scene.add(o);return o;});
  // One 60-point draw; all buffers and particles are allocated once. No volumetrics/lights.
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d');
  const gradient=ctx.createRadialGradient(32,32,0,32,32,32);gradient.addColorStop(0,'rgba(168,179,81,.36)');gradient.addColorStop(.5,'rgba(140,153,64,.18)');gradient.addColorStop(1,'rgba(140,153,64,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
  const texture=new THREE.CanvasTexture(canvas),positions=new Float32Array(60*3);positions.fill(-1000);
  const particleGeo=new THREE.BufferGeometry();particleGeo.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  const particleMat=new THREE.PointsMaterial({map:texture,size:1.65,transparent:true,opacity:.65,depthWrite:false,sizeAttenuation:true});
  const particles=new THREE.Points(particleGeo,particleMat);particles.frustumCulled=false;scene.add(particles);
  // Reused cosmetic steam/spark pool: never creates a damaging gas cloud.
  const steamPositions=new Float32Array(24*3);steamPositions.fill(-1000);
  const steamGeo=new THREE.BufferGeometry();steamGeo.setAttribute('position',new THREE.BufferAttribute(steamPositions,3).setUsage(THREE.DynamicDrawUsage));
  const steamMat=particleMat.clone();steamMat.color.setHex(0xffd8a0);steamMat.size=.65;
  const steam=new THREE.Points(steamGeo,steamMat);steam.frustumCulled=false;steam.visible=false;steam.name='guardian-valve-steam';scene.add(steam);
  const valveWorld=new THREE.Vector3();
  function updateSteam(dt){
    if(steamTime<=0){steam.visible=false;return;}steamTime=Math.max(0,steamTime-dt);steam.visible=steamTime>0;
    if(visual.core?.boundingSphere){valveWorld.copy(visual.core.boundingSphere.center);visual.core.localToWorld(valveWorld);}else valveWorld.copy(boss.mesh.position).addScaledVector(THREE.Object3D.DEFAULT_UP,3);
    const dying=combat.phase==='dying';steamMat.color.setHex(dying?0xb4beb5:steamTime>2.3?0xffd48b:0xc4d1bc);steamMat.opacity=Math.min(.75,steamTime*.4);
    for(let i=0;i<24;i++){const a=i*2.39996,t=(clock*.7+i*.173)%1,k=i*3;steamPositions[k]=valveWorld.x+Math.cos(a)*t*.8;steamPositions[k+1]=valveWorld.y+t*2;steamPositions[k+2]=valveWorld.z+Math.sin(a)*t*.8;}
    steamGeo.attributes.position.needsUpdate=true;
  }

  const dir=new THREE.Vector3(),candidate=new THREE.Vector3(),ray=new THREE.Raycaster(),origin=new THREE.Vector3(),gasAim=new THREE.Vector3();
  const labels={rupture:'VALVE RUPTURED · FIRE NOW',entrance:'CONTAINMENT BREACH',chase:'Stay clear of the gas system',slam_warning:'HEAVY SLAM · LEAVE THE RING',slam:'IMPACT',vent_warning:'BRACING TO VENT · MOVE AWAY',vent:'GAS RELEASE · AVOID THE MARKED CLOUD',recovery:'PRESSURE VALVE EXPOSED · FIRE NOW',dying:'PRESSURE COLLAPSE',defeated:'GUARDIAN DEFEATED'};
  const hints={rupture:'Armour breached · five-second opening · shoot the chest.',entrance:'Armoured tank · brass valve on the chest',chase:'Keep space. Watch for the bracing tell.',slam_warning:'Leave the marked circle before impact.',slam:'Stay outside the impact zone.',vent_warning:'Gas is aimed at a fixed spot. Move out of the circle.',vent:'Gas stays on the ground. Find a clear route.',recovery:'Aim at the glowing chest valve for 2.5× damage.',dying:'Pressure falling. Stand clear.',defeated:'Return to the tower console.'};
  function play(name){const next=actions[name];if(!next||current===next)return;next.reset().play();if(current)current.crossFadeTo(next,.12,false);current=next;}
  function updateGas(dt,target){
    const damage=gas.update(dt,target);if(damage&&!state.shieldActive&&!state.inVehicle)damagePlayer(damage);
    gas.clouds.forEach((c,j)=>{
      rings[j].visible=c.active;rings[j].position.set(c.x,.07,c.z);rings[j].material.opacity=c.active?Math.min(.65,(8-c.age)*.5):0;
      for(let i=0;i<20;i++){
        const k=(j*20+i)*3,a=i*2.39996+c.age*.075,r=Math.sqrt((i+.5)/20)*3.1;
        positions[k]=c.active?c.x+Math.cos(a)*r:0;positions[k+1]=c.active?.35+((i*.173+c.age*.14)%1)*1.2+Math.max(0,1-c.age/.7)*1.4:-1000;positions[k+2]=c.active?c.z+Math.sin(a)*r:0;
      }
    });particleGeo.attributes.position.needsUpdate=true;
  }
  let cinematicPreview=null;const previewTarget=new THREE.Vector3(1e6,0,1e6);
  const visual={combat,gas,shockwave,panel,ready:false,loadError:null,core:null,shutdownProgress:0,shutdownComplete:false,
    contained:false,dormant:false,
    beginCinematicPreview(awakening=false){
      if(!visual.ready||!visual.dormant||cinematicPreview)return false;
      cinematicPreview={position:boss.mesh.position.clone(),quaternion:boss.mesh.quaternion.clone(),visible:boss.mesh.visible,time:0,released:false,awakening,stepped:false,clip:current?.getClip().name||'entrance'};
      boss.mesh.position.set(0,0,-182);boss.mesh.rotation.set(0,0,0);boss.mesh.visible=true;panel.hidden=true;
      gas.clear();particles.visible=true;play(awakening?'entrance':'vent_warning');mixer.update(0);return true;
    },
    updateCinematicPreview(dt){
      if(!cinematicPreview)return;const p=cinematicPreview;p.time+=dt;
      if(p.time>=(p.awakening?3:.8)&&!p.released){p.released=true;play('vent');gas.spawn(0,-178);gas.spawn(-1.2,-175);sfx.noise(.8,.12,180);sfx.burst('sawtooth',52,.5,.055);}
      if(p.awakening&&p.time>=6){if(!p.stepped){p.stepped=true;play('walk');}boss.mesh.position.z=-182+Math.min(2,(p.time-6)*.5);if(p.time>=10)play('idle');}
      appearance?.update(p.time>=3&&p.time<6?'vent':'entrance');mixer.update(dt);updateGas(dt,previewTarget);panel.hidden=true;
    },
    endCinematicPreview(){
      if(!cinematicPreview)return;const p=cinematicPreview;cinematicPreview=null;
      gas.clear();rings.forEach(r=>r.visible=false);particles.visible=false;panel.hidden=true;
      boss.mesh.position.copy(p.position);boss.mesh.quaternion.copy(p.quaternion);boss.mesh.visible=p.visible;
      particleGeo.attributes.position.array.fill(-1000);particleGeo.attributes.position.needsUpdate=true;
      mixer.stopAllAction();current=null;play(p.clip);mixer.update(0);
    },
    activate(){visual.dormant=false;boss.mesh.visible=true;panel.hidden=false;particles.visible=true;},
    prepareForWarmup(){
      visual.dormant=true;panel.hidden=true;
      for(const object of [warning,warningFill,wave,waveLimit,...rings]){object.position.y=-10000;object.visible=true;}
      particles.visible=true;steam.visible=true;
      return()=>{boss.mesh.visible=false;for(const object of [warning,warningFill,wave,waveLimit,...rings]){object.visible=false;object.position.set(0,0,0);}particles.visible=false;steam.visible=false;};
    },
    contain(){
      if(!visual.ready||visual.contained||!boss.alive||['dying','defeated'].includes(combat.phase))return false;
      visual.contained=true;combat.enter('contained');gas.clear();shockwave.clear();wave.visible=waveLimit.visible=false;steamTime=0;warning.visible=warningFill.visible=false;shutdownTime=0;if(mixer)mixer.timeScale=1;
      rings.forEach(r=>r.visible=false);particleGeo.attributes.position.array.fill(-1000);particleGeo.attributes.position.needsUpdate=true;
      boss.alive=false;boss.state='contained';panel.hidden=true;play('stagger');return true;
    },
    damage(amount,weak){if(!visual.ready)return 0;combat.setHealth(boss.health,boss.maxHealth);const d=combat.damage(amount,weak);
      if(combat.ruptured&&!ruptureSeen){ruptureSeen=true;shockwave.clear();wave.visible=waveLimit.visible=false;steamTime=3;play('stagger');sfx.noise(.5,.16,650);sfx.burst('triangle',220,.35,.12);}
      else if(d&&weak&&combat.phase==='recovery'&&!staggered){staggered=true;stagger=.65;play('stagger');sfx.noise(.2,.12,220);}
      return d;},
    beginDeath(){if(['dying','defeated'].includes(combat.phase))return;combat.enter('dying');boss.health=0;boss.state='guardian-dying';gas.clear();shockwave.clear();wave.visible=waveLimit.visible=false;steamTime=3;warning.visible=warningFill.visible=false;sfx.burst('sawtooth',55,.9,.15);},
    dispose(){if(disposed)return;disposed=true;panel.remove();mixer?.stopAllAction();if(root)mixer?.uncacheRoot(root);scene.remove(warning,warningFill,particles,steam,wave,waveLimit,...rings);wave.geometry.dispose();waveMat.dispose();limitMat.dispose();steamGeo.dispose();steamMat.dispose();warning.geometry.dispose();warningMat.dispose();warningFill.geometry.dispose();warningFillMat.dispose();ringGeo.dispose();rings.forEach(r=>r.material.dispose());particleGeo.dispose();particleMat.dispose();texture.dispose();appearance?.dispose();ownedMaterials.forEach(m=>{m.userData.ruptureTexture?.dispose();m.dispose();});if(root)boss.mesh.remove(root);},
  };
  boss.guardian=visual;boss.confirmedKill=()=>visual.beginDeath();
  visual.prepared=preloadGuardian().then(gltf=>{
    if(disposed)return;root=skeletonClone(gltf.scene);boss.mesh.add(root);boss.rigObj=root;
    root.traverse(o=>{if(o.isMesh){o.userData.owner=boss;o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;o.material=o.material.clone();ownedMaterials.push(o.material);o.material.emissive.setRGB(0,0,0);o.material.emissiveIntensity=0;if(/gas|tank|valve|pressure|canister/i.test(o.name))containmentMaterials.push({material:o.material,base:o.material.emissive.clone()});if(o.name==='GasValveWeakPoint'){o.userData.guardianWeakPoint=true;visual.core=o;
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const c=canvas.getContext('2d');c.fillStyle='#d8bd7a';c.fillRect(0,0,128,128);c.strokeStyle='#231b12';c.lineWidth=5;
      for(const points of [[[64,0],[52,33],[71,61],[48,85],[60,128]],[[0,55],[32,49],[71,61],[98,44],[128,59]]]){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
      o.material.userData.ruptureTexture=new THREE.CanvasTexture(canvas);
      o.material.userData.crackProgress={value:0};
      const previousValveCompile=o.material.onBeforeCompile;
      o.material.onBeforeCompile=function(shader,renderer){previousValveCompile.call(this,shader,renderer);shader.uniforms.valveCracks={value:o.material.userData.ruptureTexture};shader.uniforms.valveCrackProgress=o.material.userData.crackProgress;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vValveUv;').replace('#include <uv_vertex>','#include <uv_vertex>\nvValveUv=uv;');shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance*=mix(1.0,step(.35,texture2D(valveCracks,vValveUv).r),valveCrackProgress);').replace('#include <common>','#include <common>\nuniform sampler2D valveCracks;uniform float valveCrackProgress;varying vec2 vValveUv;').replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb*=mix(vec3(1.0),texture2D(valveCracks,vValveUv).rgb,valveCrackProgress);');};
      o.material.customProgramCacheKey=()=> 'guardian-valve-cracks-v1';
    }}});
    appearance=styleGuardian(root);
    mixer=new THREE.AnimationMixer(root);
    boss.mixer=mixer;boss.hasAnim=true;
    for(const clip of gltf.animations){const action=mixer.clipAction(clip);if(!['walk','idle'].includes(clip.name)){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}actions[clip.name]=action;}
    for(const action of Object.values(actions)){action.play();action.stop();}
    visual.ready=true;play('entrance');mixer.update(0);
  }).catch(error=>{visual.loadError=error;status.textContent='BOSS ASSET FAILED TO LOAD · RELOAD';console.error('Guardian model load failed',error);});
  boss.update=function(dt,target){
    if(disposed||visual.dormant||!visual.ready||state.narrativeBlocked||state.paused||state.isDead)return;
    if(visual.contained){
      panel.hidden=true;dt=Math.min(.1,Math.max(0,dt));shutdownTime+=dt;
      visual.shutdownProgress=Math.min(1,shutdownTime/2.5);
      // Let the hit reaction settle into the recovery bend, then return to the
      // living idle loop so the contained Guardian keeps breathing.
      if(shutdownTime>=.7&&shutdownTime<1.8&&current!==actions.recovery)play('recovery');
      if(shutdownTime>=1.8&&current!==actions.idle)play('idle');
      if(shutdownTime>=2.5)visual.shutdownComplete=true;
      if(shutdownTime>=1.8&&current===actions.idle)mixer.timeScale=.42;
      mixer?.update(dt);root?.updateMatrixWorld(true);
      const cool=visual.shutdownProgress;
      containmentMaterials.forEach(({material,base})=>{
        material.emissive.copy(base).lerp(containedCoolColor,cool);
        material.emissiveIntensity=.24+.48*cool;
      });
      if(visual.core){visual.core.skeleton.update();visual.core.computeBoundingSphere();if(visual.core.boundingBox)visual.core.computeBoundingBox();}
      return;
    }
    dt=Math.min(.1,Math.max(0,dt));clock+=dt;combat.setHealth(this.health,this.maxHealth);combat.update(dt,this.mesh.position,target);const phase=combat.phase;appearance?.update(phase);
    if(panel.dataset.stage!==String(combat.stage)){
      panel.dataset.stage=String(combat.stage);stageText.textContent=combat.stage===2?'PHASE II · CONTAINMENT FAILURE':'PHASE I · CONTAINMENT';
      if(combat.stage===2)sfx.burst('sawtooth',85,.45,.12);
    }
    if(phase!==previous){
      previous=phase;panel.dataset.phase=phase;hint.textContent=hints[phase];stagger=0;staggered=false;play(phase==='chase'?'walk':phase==='dying'?'death':phase==='rupture'?'stagger':phase);
      if(phase==='rupture')hint.textContent=hints.rupture;
      if(phase==='vent_warning'){
        gasAim.set(combat.ventTarget?.x??this.mesh.position.x,.075,combat.ventTarget?.z??this.mesh.position.z);
        // Stop a projected cloud before solid scenery, and inside the arena.
        origin.copy(this.mesh.position).setY(1.3);dir.subVectors(gasAim,this.mesh.position).setY(0);const distance=dir.length();
        if(distance>.01){dir.normalize();ray.set(origin,dir);ray.far=distance;const hit=ray.intersectObjects(state.occluders,false)[0];if(hit)gasAim.copy(this.mesh.position).addScaledVector(dir,Math.max(0,hit.distance-1));}
        gasAim.x=clampX(gasAim.x,gasAim.z);gasAim.z=THREE.MathUtils.clamp(gasAim.z,-208,35);gasAim.y=.075;
      }
      if(phase.endsWith('_warning'))sfx.burst('triangle',phase==='vent_warning'?110:165,.6,.14);
      if(phase==='vent')sfx.noise(1,.16,180);
    }
    bar.value=Math.max(0,this.health);
    healthText.textContent=`${Math.ceil(Math.max(0,this.health))} / ${this.maxHealth}`;
    const timed=phase.endsWith('_warning')||phase==='recovery'||phase==='rupture',remaining=Math.max(0,combat.duration-combat.time);
    const cue=(phase==='slam_warning'&&combat.stage===2?'SHOCKWAVE · RUN BEYOND THE OUTER RING':labels[phase])+(timed?` · ${remaining.toFixed(1)}s`:'');if(status.textContent!==cue)status.textContent=cue;
    windowFill.style.transform=`scaleX(${timed?((phase==='recovery'||phase==='rupture')?1-combat.progress:combat.progress):0})`;
    if(phase==='dying'&&combat.time>=2&&!deathImpact){deathImpact=true;sfx.noise(.45,.18,70);state.shake=Math.max(state.shake,.16);}
    if(phase==='defeated'){originalKill(false);visual.dispose();onDefeated();return;}
    if(phase==='rupture'&&combat.time>1.1)play('recovery');
    if(stagger>0){stagger-=dt;if(stagger<=0)play('recovery');}
    mixer.timeScale=phase==='chase'?combat.speed/.65:1;
    mixer.update(dt);root.updateMatrixWorld(true);
    if(visual.core){
      // Three caches skinned bounds. The small valve moves with the chest;
      // refresh its bounds so shots still hit during the recovery bend.
      visual.core.skeleton.update();visual.core.computeBoundingSphere();
      if(visual.core.boundingBox)visual.core.computeBoundingBox();
      visual.core.material.userData.crackProgress.value=combat.ruptured?1:combat.valveCharge/GUARDIAN_RUPTURE_DAMAGE*.8;
      const charge=combat.valveCharge/GUARDIAN_RUPTURE_DAMAGE,exposed=phase==='recovery'||phase==='rupture';
      visual.core.material.emissive.setHex(phase==='dying'?0:combat.ruptured?0xff8e36:0x82752d);
      visual.core.material.emissiveIntensity=exposed?.45+charge*(.25+.1*Math.sin(clock*15)):0;
      visual.core.material.color.setHex(combat.ruptured?0x67503b:0xbca455);

    }
    waveLimit.visible=phase==='slam_warning'&&combat.stage===2;
    waveLimit.position.copy(this.mesh.position);waveLimit.position.y=.08;
    if(waveLimit.visible)hint.textContent='Phase II slam sends one ring outward. Run beyond the outer boundary.';
    warning.visible=warningFill.visible=phase==='slam_warning'||phase==='vent_warning';
    const radius=phase==='slam_warning'?GUARDIAN_SLAM_RADIUS:GUARDIAN_GAS_RADIUS,color=phase==='slam_warning'?0xff936b:0xd5cf69;
    warning.position.copy(phase==='vent_warning'?gasAim:this.mesh.position);warning.position.y=.075;warning.scale.setScalar(radius);warningMat.color.setHex(color);warningMat.opacity=.55+.15*Math.sin(clock*9);
    warningFill.position.copy(warning.position);warningFill.position.y=.065;warningFill.scale.setScalar(radius*Math.sqrt(Math.max(.001,combat.progress)));warningFillMat.color.setHex(color);warningFillMat.opacity=.07+.1*combat.progress;
    if(phase==='chase'){
      dir.subVectors(target,this.mesh.position).setY(0);const distance=dir.length();dir.normalize();
      this.mesh.rotation.y=Math.atan2(dir.x,dir.z);
      if(distance>2.9){
        candidate.copy(this.mesh.position).addScaledVector(dir,combat.speed*dt);
        const wall=clampX(candidate.x,candidate.z);origin.copy(this.mesh.position).setY(1.3);ray.set(origin,dir);ray.far=1.7;
        // World-boundary boxes carry huge broad-phase circles that overlap the
        // street. Use the corridor clamp and actual geometry for those walls.
        const blocked=Math.abs(candidate.x-wall)>.05||candidate.z< -208||candidate.z>35||obstacles.some(o=>o.r<10&&Math.hypot(candidate.x-o.x,candidate.z-o.z)<(o.r||0)+1.5)||ray.intersectObjects(state.occluders,false).length>0;
        if(!blocked){this.mesh.position.copy(candidate);play('walk');}else play('idle');
      }else play('idle');
    }else if(phase==='slam_warning'||phase==='vent_warning')this.mesh.rotation.y=Math.atan2(combat.direction.x,combat.direction.z);
    if(phase==='slam'&&!combat.hit&&combat.time>=.25){
      combat.hit=true;if(combat.stage===2)shockwave.start(this.mesh.position);sfx.noise(.3,.2,80);state.shake=Math.max(state.shake,.22);
      if(Math.hypot(target.x-this.mesh.position.x,target.z-this.mesh.position.z)<GUARDIAN_SLAM_RADIUS&&!state.shieldActive&&!state.inVehicle)damagePlayer(28);
    }
    if(phase==='vent'&&!combat.vented&&combat.time>=.2){
      combat.vented=true;
      const clearExit=(x,z)=>{if(Math.abs(x-clampX(x,z))>.05||z< -208||z>35)return false;origin.copy(target).setY(1.3);dir.set(x-target.x,0,z-target.z);const distance=dir.length();dir.normalize();ray.set(origin,dir);ray.far=distance;return ray.intersectObjects(state.occluders,false).length===0;};
      if(gas.canPlace(gasAim.x,gasAim.z,target,clearExit))gas.spawn(gasAim.x,gasAim.z);
    }
    const waveDamage=shockwave.update(dt,target);if(waveDamage&&!state.shieldActive&&!state.inVehicle)damagePlayer(waveDamage);
    wave.visible=shockwave.active;wave.position.set(shockwave.x,.1,shockwave.z);wave.scale.setScalar(Math.max(.01,shockwave.radius));
    updateGas(dt,target);updateSteam(dt);
  };
  return visual;
}
