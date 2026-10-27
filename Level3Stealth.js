import * as THREE from 'three';
import {DetectionMemory} from './Level3Detection.js';
import {RayCandidates} from './RayCandidates.js';

export function createLevel3Stealth({scene,state,addStaticBox,Zombie,clampX,player,material}){
  const coverMaterial=new THREE.MeshStandardMaterial({color:0x465457,map:material,roughness:.9});
  const points=[];
  for(const z of [-35,-65,-95,-125,-146,-160,-174])for(const x of [-5.5,5.5])points.push([x,z]);
  const cover=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),coverMaterial,points.length),matrix=new THREE.Object3D();
  cover.name='stealth-maintenance-cover';cover.castShadow=cover.receiveShadow=true;
  // Individual occluders are simple boxes; the visible cover is one draw.
  const proxyGeo=new THREE.BoxGeometry(1.4,1.9,3.8),proxyMaterial=new THREE.MeshBasicMaterial({visible:false});
  for(const [i,[x,z]] of points.entries()){
    matrix.position.set(x,.95,z);matrix.scale.set(1.4,1.9,3.8);matrix.updateMatrix();cover.setMatrixAt(i,matrix.matrix);
    addStaticBox(.7,.95,1.9,x,.95,z);
    const proxy=new THREE.Mesh(proxyGeo,proxyMaterial);proxy.position.set(x,.95,z);proxy.updateMatrixWorld(true);state.occluders.push(proxy);
  }
  scene.add(cover);
  const panel=document.createElement('aside');panel.id='lv3-awareness';panel.style.cssText='position:fixed;left:22px;top:116px;max-width:300px;padding:9px 12px;background:#071317db;border:1px solid #789f9d;color:#d9eeeb;font:13px/1.4 Arial,sans-serif;z-index:18;pointer-events:none';
  panel.innerHTML='<strong data-state>UNSEEN</strong><progress max="1" value="0" aria-label="Enemy awareness" style="display:block;width:100%;height:6px;margin:5px 0;accent-color:#e4bd6d"></progress><span>C / Ctrl: crouch · fight from cover</span>';document.body.append(panel);
  const meter=panel.querySelector('progress'),label=panel.querySelector('[data-state]'),ray=new THREE.Raycaster(),origin=new THREE.Vector3(),direction=new THREE.Vector3(),candidates=new RayCandidates();
  let clock=0,lastNoise=-100,lastThreat=-100,noiseRadius=0,noiseKind='threat',noiseNumber=0,noisePos=new THREE.Vector3(),seeded=false;
  const lookRotation=new THREE.Quaternion(),lookAxis=new THREE.Vector3(0,1,0);
  const tracked=new Set();
  function sight(a,b){origin.copy(a).y+=1.25;direction.subVectors(b,a);direction.y=0;const d=direction.length();if(d<.05)return true;ray.set(origin,direction.normalize());ray.far=Math.max(.01,d-.3);return !ray.intersectObjects(candidates.query(state.occluders,ray.ray,ray.far),false).length;}
  function move(z,target,dt,speed){
    direction.subVectors(target,z.mesh.position).setY(0);const d=direction.length();if(d<.15){z.playWalk(dt,1,.04);return;}
    direction.normalize();origin.copy(z.mesh.position).y+=1;ray.set(origin,direction);ray.far=.9;
    const blocked=ray.intersectObjects(candidates.query(state.occluders,ray.ray,ray.far),false).length;
    if(!blocked){z.mesh.position.addScaledVector(direction,Math.min(d,speed*dt));z.mesh.position.x=clampX(z.mesh.position.x,z.mesh.position.z);}
    else z.stealth.patrolDirection*=-1;
    z.mesh.rotation.y=Math.atan2(direction.x,direction.z);z.playWalk(dt,3,.12);
  }
  function attach(z){
    if(z.isBoss||tracked.has(z))return;
    tracked.add(z);const original=z.update.bind(z);
    z.stealth={sense:new DetectionMemory(),home:z.mesh.position.clone(),lastKnown:z.mesh.position.clone(),patrolDirection:1,investigate:0,heard:0,noticeHold:0,wasAlert:false,cue:'patrol',head:null,headOffset:new THREE.Quaternion()};
    z.rigObj?.traverse(o=>{if(o.isBone&&!z.stealth.head&&/head(_|$)/i.test(o.name))z.stealth.head=o;});
    z.update=function(dt,pos,neighbors){
      if(!this.alive||this.state==='cured')return;
      const m=this.stealth;if(m.head){m.head.quaternion.multiply(m.headOffset.invert());m.headOffset.identity();}
      const dx=pos.x-this.mesh.position.x,dz=pos.z-this.mesh.position.z,d=Math.hypot(dx,dz),visible=d<20&&sight(this.mesh.position,pos);
      const heard=clock-lastNoise<.3&&this.mesh.position.distanceTo(noisePos)<noiseRadius;
      const loud=heard&&noiseKind==='threat';
      if(this.combatRequired){
        if(heard&&noiseKind==='bottle'&&m.heard!==noiseNumber&&d>4){m.heard=noiseNumber;m.investigate=3;m.lastKnown.copy(noisePos);}
        if(m.investigate>0&&d>4){m.investigate=Math.max(0,m.investigate-dt);this.state='idle';m.cue='investigate';move(this,m.lastKnown,dt,1.2);return;}
        m.sense.alert=true;m.sense.suspicion=1;m.sense.memory=6;m.lastKnown.copy(pos);m.cue='chase';
        if(visible)original(dt,pos,neighbors);else{this.state='idle';move(this,pos,dt,Math.min(1.4,this.speed));}return;
      }

      if(heard&&m.heard!==noiseNumber){m.heard=noiseNumber;if(noiseKind==='bottle'&&!m.sense.alert){m.investigate=7;m.lastKnown.copy(noisePos);}}
      const sensing=m.sense.update(dt,{distance:d,facing:d>.01?(dx*Math.sin(this.mesh.rotation.y)+dz*Math.cos(this.mesh.rotation.y))/d:1,visible,crouching:state.crouching,sprinting:state.isSprinting,moving:state.playerMoving,loud});
      if(sensing.sight||sensing.hearing)m.lastKnown.copy(pos);else if(loud)m.lastKnown.copy(noisePos);
      if(sensing.alert&&!m.wasAlert)m.noticeHold=.4;
      m.wasAlert=sensing.alert;m.noticeHold=Math.max(0,m.noticeHold-dt);
      if(m.noticeHold>0){m.cue='notice';look(this,m.lastKnown,dt);return;}
      if(sensing.alert&&sensing.sight){m.cue='chase';original(dt,pos,neighbors);return;}
      this.state='idle';
      if(sensing.alert){m.cue='search';if(this.mesh.position.distanceTo(m.lastKnown)<1)look(this,m.lastKnown,dt,true);else move(this,m.lastKnown,dt,.9);}
      else if(m.investigate>0){m.investigate=Math.max(0,m.investigate-dt);m.cue='investigate';if(this.mesh.position.distanceTo(m.lastKnown)<.9){m.cue='listen';look(this,m.lastKnown,dt,true);}else move(this,m.lastKnown,dt,.8);}
      else if(sensing.suspicion>.08){m.cue='notice';look(this,pos,dt);}
      else if(this.firstCureEncounter){m.cue='patrol';this.mesh.rotation.y=Math.PI;this.playWalk(dt,1,.03);}
      else {m.cue='patrol';const target=m.home.clone();target.z+=m.patrolDirection*3;if(this.mesh.position.distanceTo(target)<.3)m.patrolDirection*=-1;move(this,target,dt,.5);}
    };
  }
  function look(z,target,dt,search=false){
    z.playWalk(dt,1,.03);const dx=target.x-z.mesh.position.x,dz=target.z-z.mesh.position.z;
    const yaw=Math.hypot(dx,dz)>.3?Math.atan2(dx,dz):z.mesh.rotation.y;
    const desired=yaw+(search?Math.sin(clock*1.8)*.35:0),delta=Math.atan2(Math.sin(desired-z.mesh.rotation.y),Math.cos(desired-z.mesh.rotation.y));z.mesh.rotation.y+=delta*Math.min(1,dt*3);
    if(z.stealth.head){lookRotation.setFromAxisAngle(lookAxis,Math.sin(clock*1.9)*.12);z.stealth.head.quaternion.multiply(lookRotation);z.stealth.headOffset.copy(lookRotation);}
  }
  function noise(position,radius=30){lastNoise=lastThreat=clock;noiseKind='threat';noiseNumber++;noisePos.copy(position);noiseRadius=radius;}
  function distract(position,radius=16){lastNoise=clock;noiseKind='bottle';noiseNumber++;noisePos.copy(position);noiseRadius=radius;}
  function alertNear(pos,range=24){return [...tracked].some(z=>z.alive&&z.stealth.sense.alert&&z.mesh.position.distanceTo(pos)<range);}
  return {panel,noise,distract,alertNear,get quiet(){return clock-lastThreat>8;},get firstEncounter(){return [...tracked].find(z=>z.firstCureEncounter);},
    beforeUpdate(dt){
      clock+=dt;state.spawnTimer=60;
      if(!seeded&&state.readyShown){
        seeded=true;const initial=state.zombies.filter(z=>z.alive&&!z.isBoss);
        for(let i=initial.length;i<8;i++){const enemy=new Zombie(new THREE.Vector3());initial.push(enemy);state.zombies.push(enemy);state.spawnedTotal++;}
        initial.slice(0,8).forEach((enemy,i)=>{enemy.mesh.position.set((i%4-1.5)*2.8,0,12-Math.floor(i/4)*5);enemy.stealth?.home.copy(enemy.mesh.position);enemy.speed=.95;enemy.firstCureEncounter=i===2;enemy.mesh.rotation.y=0;});
      }
      for(const z of tracked)if(!z.alive)tracked.delete(z);
      for(const z of state.zombies)attach(z);
      let awareness=0,alert=false,searching=false,investigating=false;
      for(const z of tracked){if(!z.alive)continue;if(z.mesh.position.distanceTo(player.position)>26)continue;awareness=Math.max(awareness,z.stealth.sense.suspicion);alert ||= z.stealth.sense.alert;searching ||= z.stealth.sense.alert&&z.stealth.sense.memory<5;investigating ||= z.stealth.investigate>0;}
      meter.value=awareness;label.textContent=alert?(searching?'SEARCHING · BREAK SIGHT':'DETECTED · FIND COVER'):awareness>.05?'SUSPICIOUS · KEEP LOW':investigating?'INVESTIGATING GLASS · STAY QUIET':'AREA CLEAR';
      panel.hidden=!!(state.paused||state.isDead||state.narrativeBlocked||!state.readyShown);
    },
    hide(){panel.hidden=true;},
  };
}
