import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RayCandidates} from './RayCandidates.js';

export function createBottleDistraction({scene,camera,state,player,onImpact,sfx,feed}){
  const body=new THREE.CylinderGeometry(.043,.048,.17,8),neck=new THREE.CylinderGeometry(.018,.022,.07,8);neck.translate(0,.115,0);
  const geometry=mergeGeometries([body,neck]);body.dispose();neck.dispose();
  const material=new THREE.MeshStandardMaterial({color:0x759083,roughness:.3,metalness:.12});
  const bottle=new THREE.Mesh(geometry,material);bottle.name='distraction-bottle';bottle.castShadow=true;bottle.visible=false;scene.add(bottle);
  const shards=new THREE.InstancedMesh(new THREE.TetrahedronGeometry(.022,0),material,16);shards.name='bottle-impact-shards';shards.frustumCulled=false;shards.visible=false;scene.add(shards);
  const panel=document.createElement('aside');panel.id='lv3-bottles';panel.style.cssText='position:fixed;left:22px;top:195px;padding:7px 12px;color:#d9eeeb;background:#071317db;border:1px solid #789f9d;font:13px Arial,sans-serif;z-index:18;pointer-events:none';panel.textContent='B · Throw bottle · 3 / 3';panel.hidden=true;document.body.append(panel);
  const from=new THREE.Vector3(),to=new THREE.Vector3(),aim=new THREE.Vector3(),ray=new THREE.Raycaster(),candidates=new RayCandidates(),transform=new THREE.Object3D();
  let charges=3,cooldown=0,flight=-1,impactTime=-1;
  function blocked(){return !state.readyShown||state.paused||state.narrativeBlocked||state.isDead||state.dying||state.cinematic||state.inVehicle;}
  function throwBottle(){
    if(blocked()||!state.pointerLocked||cooldown>0)return false;
    if(!charges){feed('No bottles left');return false;}
    camera.getWorldDirection(aim);aim.y=0;if(aim.lengthSq()<.01)return false;aim.normalize();
    from.copy(player.position).setY(player.position.y+1.35);ray.set(from,aim);ray.near=.2;ray.far=14;
    const hit=ray.intersectObjects(candidates.query(state.occluders,ray.ray,14),false)[0];
    to.copy(from).addScaledVector(aim,hit?Math.max(.7,hit.distance-.3):14);to.x=THREE.MathUtils.clamp(to.x,-10,10);to.z=THREE.MathUtils.clamp(to.z,-191,32);to.y=.06;
    charges--;cooldown=1.3;flight=0;impactTime=-1;bottle.visible=true;shards.visible=false;bottle.position.copy(from);panel.textContent=`B · Throw bottle · ${charges} / 3`;
    return true;
  }
  return {panel,throwBottle,get charges(){return charges;},get landingPoint(){return to;},get inFlight(){return flight>=0;},
    prepare(){bottle.position.set(0,-10000,0);shards.position.set(0,-10000,0);bottle.visible=shards.visible=true;return()=>{bottle.visible=shards.visible=false;shards.position.set(0,0,0);};},
    update(dt){
      panel.hidden=blocked();if(blocked())return;
      cooldown=Math.max(0,cooldown-dt);
      if(flight>=0){flight+=dt;const t=Math.min(1,flight/.85);bottle.position.lerpVectors(from,to,t);bottle.position.y+=Math.sin(t*Math.PI)*2.1;bottle.rotation.set(t*8,0,t*5);
        if(t===1){flight=-1;impactTime=0;bottle.visible=false;shards.visible=true;onImpact(to);sfx.noise(.18,.07,2600);feed('Glass breaks — nearby infected investigate');}
      }
      if(impactTime>=0){impactTime+=dt;for(let i=0;i<16;i++){const a=i*2.39996,r=Math.min(.65,impactTime*1.2)*(i%3+1)/3;transform.position.set(to.x+Math.cos(a)*r,.04+Math.max(0,.2-impactTime)*Math.sin(i),to.z+Math.sin(a)*r);transform.rotation.set(i,impactTime*4,i);transform.scale.setScalar(Math.max(.001,1-impactTime));transform.updateMatrix();shards.setMatrixAt(i,transform.matrix);}shards.instanceMatrix.needsUpdate=true;if(impactTime>=1){shards.visible=false;impactTime=-1;}}
    },
    hide(){panel.hidden=true;bottle.visible=shards.visible=false;flight=-1;},
  };
}
