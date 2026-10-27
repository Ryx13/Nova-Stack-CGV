import * as THREE from 'three';

// Conservative experiment, opt-in only. Shadow casters are never hidden.
// A target's entire projected bounds must be inside a real opaque box's
// projected convex silhouette and behind its farthest corner.
const corner=new THREE.Vector3();
function cross(a,b,c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function hull(points){
  const p=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y),lower=[],upper=[];
  for(const v of p){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),v)<=0)lower.pop();lower.push(v);}
  for(const v of p.slice().reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),v)<=0)upper.pop();upper.push(v);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
function project(box,matrix,camera){
  const points=[];let near=Infinity,far=-Infinity;
  for(let i=0;i<8;i++){
    corner.set(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(matrix).project(camera);
    if(!Number.isFinite(corner.x)||corner.z<=-1||corner.z>=1)return null;
    near=Math.min(near,corner.z);far=Math.max(far,corner.z);points.push({x:corner.x,y:corner.y});
  }
  return {points,near,far};
}
function contains(poly,p){
  // Positive inward margin avoids flickering and edge leaks.
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    if(cross(a,b,p)<.012*Math.hypot(b.x-a.x,b.y-a.y))return false;
  }
  return true;
}
export function createOcclusionTrial(scene,camera,occluders){
  const targets=[],boxes=[],world=new THREE.Matrix4();
  scene.updateMatrixWorld(true);
  scene.traverse(o=>{if(o.isMesh&&o.userData.sceneryBatch&&!o.castShadow&&!o.isInstancedMesh)targets.push(o);});
  for(const o of occluders){
    const m=o.material;
    if(!o.userData.sceneryMerged||o.geometry?.type!=='BoxGeometry'||Array.isArray(m)||m.transparent||m.alphaTest||m.map?.userData?.cutout)continue;
    if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();
    boxes.push(o);
  }
  const state={hidden:0,tested:0,milliseconds:0,boxes:boxes.length,targets:targets.length};
  return {state,update(){
    const start=performance.now();camera.updateMatrixWorld(true);state.hidden=0;state.tested=0;
    const screens=[];
    for(const o of boxes){
      const p=project(o.geometry.boundingBox,o.matrixWorld,camera);if(!p)continue;
      const poly=hull(p.points);const xs=poly.map(p=>p.x),ys=poly.map(p=>p.y);
      const area=(Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys));
      if(area>.04)screens.push({...p,poly});
    }
    screens.sort((a,b)=>a.near-b.near);
    for(const o of targets){
      o.visible=true;if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();
      const p=project(o.geometry.boundingBox,o.matrixWorld,camera);if(!p)continue;
      state.tested++;
      if(screens.some(s=>p.near>s.far+.0001&&p.points.every(v=>contains(s.poly,v)))){o.visible=false;state.hidden++;}
    }
    state.milliseconds=performance.now()-start;
  },restore(){for(const o of targets)o.visible=true;}};
}
