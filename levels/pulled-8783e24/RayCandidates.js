import * as THREE from 'three';
import {CircleGrid} from './SpatialGrid.js';

// Only detached, baked scenery is indexed. Any other mesh remains in every
// query, so moving objects and late-loaded models cannot get stale bounds.
export class RayCandidates {
  constructor(){this.grid=new CircleGrid(8,0);this.records=[];this.always=[];this.length=-1;this.list=null;this.result=[];this.output=[];this.seen=new Set();}
  rebuild(list){
    this.list=list;this.length=list.length;this.records.length=0;this.always.length=0;
    const box=new THREE.Box3(),size=new THREE.Vector3(),center=new THREE.Vector3();
    list.forEach((mesh,index)=>{
      if(!mesh.userData.sceneryMerged){this.always.push({mesh,index});return;}
      if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
      // Detached originals retain their final world matrix; do not update it.
      box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);box.getSize(size);box.getCenter(center);
      if(box.isEmpty()){this.always.push({mesh,index});return;}
      this.records.push({mesh,index,x:center.x,z:center.z,r:Math.hypot(size.x,size.z)*.5+.001});
    });
    this.grid.rebuild(this.records);
  }
  query(list,ray,distance){
    if(this.list!==list||this.length!==list.length)this.rebuild(list);
    const endX=ray.origin.x+ray.direction.x*distance,endZ=ray.origin.z+ray.direction.z*distance;
    const size=this.grid.size,seen=this.seen,result=this.result;seen.clear();result.length=0;
    for(const r of this.always){seen.add(r);result.push(r);}
    for(let x=Math.floor(Math.min(ray.origin.x,endX)/size);x<=Math.floor(Math.max(ray.origin.x,endX)/size);x++)
      for(let z=Math.floor(Math.min(ray.origin.z,endZ)/size);z<=Math.floor(Math.max(ray.origin.z,endZ)/size);z++)
        for(const r of this.grid.cells.get(x+','+z)||[]){if(!seen.has(r)){seen.add(r);result.push(r);}}
    result.sort((a,b)=>a.index-b.index);
    this.output.length=0;for(const r of result)this.output.push(r.mesh);return this.output;
  }
}
