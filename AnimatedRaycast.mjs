// Cache posed vertices only within one raycast. Each new shot invalidates every
// entry, so moving bones, morph targets and the visible outline stay authoritative.
const caches=new WeakMap();
export function raycastAnimatedTargets(raycaster,roots,target){
 const restore=[],seen=new Set();
 try{
  for(const root of roots)root.traverse(mesh=>{
   if(!mesh.isSkinnedMesh||seen.has(mesh))return;seen.add(mesh);
   const count=mesh.geometry.attributes.position.count,original=mesh.getVertexPosition;
   let cache=caches.get(mesh);
   if(!cache||cache.count!==count){cache={count,epoch:0,stamps:new Uint32Array(count),vertices:new Float64Array(count*3)};cache.read=function(index,out){
     const k=index*3;
     if(cache.stamps[index]!==cache.epoch){cache.original.call(this,index,out);cache.vertices[k]=out.x;cache.vertices[k+1]=out.y;cache.vertices[k+2]=out.z;cache.stamps[index]=cache.epoch;}
     else out.set(cache.vertices[k],cache.vertices[k+1],cache.vertices[k+2]);return out;
    };caches.set(mesh,cache);}
   cache.original=original;cache.epoch=(cache.epoch+1)>>>0;
   if(cache.epoch===0){cache.stamps.fill(0);cache.epoch=1;}
   restore.push({mesh,original,own:Object.prototype.hasOwnProperty.call(mesh,'getVertexPosition')});mesh.getVertexPosition=cache.read;
  });
  return raycaster.intersectObjects(roots,true,target);
 }finally{for(const {mesh,original,own}of restore){if(own)mesh.getVertexPosition=original;else delete mesh.getVertexPosition;}}
}
