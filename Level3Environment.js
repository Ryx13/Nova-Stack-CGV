import * as THREE from 'three';

// Level-owned props: all interaction radii stay inside the existing AI corridor.
export function buildCompoundDetails(scene, defs, label) {
  const metal = new THREE.MeshStandardMaterial({ color:0x3d4c4d, roughness:.8 });
  const boxGeo = new THREE.BoxGeometry(1,1,1);
  function box(x,y,z,w,h,d,material=metal) {
    const m = new THREE.Mesh(boxGeo,material); m.position.set(x,y,z); m.scale.set(w,h,d); scene.add(m); return m;
  }
  const lights = defs.map((s,i) => {
    box(s.pos.x,1.1,s.pos.z-1.5,.8,2.2,.45);
    const screen = box(s.pos.x,1.7,s.pos.z-1.24,.65,.45,.03,new THREE.MeshBasicMaterial({color:0x65c7cc}));
    const tag = label('G / RESEARCH'); tag.position.copy(screen.position).add(new THREE.Vector3(0,.9,0)); tag.scale.multiplyScalar(.55); scene.add(tag);
    const light = new THREE.PointLight(0xff3322,2,10,2); light.position.set(s.pos.x,4,s.pos.z); scene.add(light);
    box(s.pos.x,4,s.pos.z,.8,.3,.4,new THREE.MeshBasicMaterial({color:0xffba88}));
    return light;
  });
  // Side fencing leaves the street entrance and all console approaches open.
  const vertices = [], posts = [];
  for (const x of [-24,24]) {
    for(let z=-205;z<-143;z+=4) {
      posts.push([x,1.5,z]);
      for(let y=0;y<3;y+=.4) {
        vertices.push(x,y,z,x,Math.min(3,y+.8),z+4);
        vertices.push(x,Math.min(3,y+.8),z,x,y,z+4);
      }
    }
  }
  const postMesh=new THREE.InstancedMesh(boxGeo,metal,posts.length),postTransform=new THREE.Object3D();
  posts.forEach(([x,y,z],i)=>{postTransform.position.set(x,y,z);postTransform.scale.set(.1,3,.1);postTransform.updateMatrix();postMesh.setMatrixAt(i,postTransform.matrix);});scene.add(postMesh);
  for(const x of [-9,9]) vertices.push(0,39,-198,x,.2,-189);
  const wires = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)),new THREE.LineBasicMaterial({color:0x899797,transparent:true,opacity:.65})); scene.add(wires);
  const warning = label('BIOHAZARD / KEEP CLEAR'); warning.position.set(0,4,-144); scene.add(warning);
  // Equipment annex in front of the tower shell, visible through a glass front.
  box(0,.15,-191,7,.3,3); box(0,3,-191,7,.2,3);
  const equipment = new THREE.MeshStandardMaterial({color:0x17474d,emissive:0x1bdad5,emissiveIntensity:.7});
  for(let x=-2;x<=2;x+=2) { box(x,1.3,-191,1.1,2.3,.7); box(x,1.6,-190.6,.8,.6,.04,equipment); }
  box(0,1.5,-189.5,7,2.8,.04,new THREE.MeshStandardMaterial({color:0x97c7cf,transparent:true,opacity:.18,depthWrite:false}));
  const rubble = new THREE.InstancedMesh(boxGeo,new THREE.MeshStandardMaterial({color:0x655e50}),70);
  const transform = new THREE.Object3D();
  for(let i=0;i<70;i++) {
    transform.position.set((i%2?1:-1)*(13+(i%7)*.35),.15,-146-(i*7%52));
    transform.rotation.set(i*.8,i*.3,0); transform.scale.set(.2+(i%3)*.2,.2,.4); transform.updateMatrix(); rubble.setMatrixAt(i,transform.matrix);
  } scene.add(rubble);
  const hazards=[];
  for(const [x,z,type,offset] of [[-5,-185,'toxic',0],[6,-191,'toxic',0],[-7,-161,'steam',0],[7,-176,'steam',4]]) {
    const toxic = type==='toxic';
    const mesh = new THREE.Mesh(toxic ? new THREE.CircleGeometry(1.7,20) : new THREE.CylinderGeometry(.8,1.2,2.5,10),new THREE.MeshBasicMaterial({color:toxic?0x85b82c:0xc9dddd,transparent:true,opacity:.55,depthWrite:false,side:THREE.DoubleSide}));
    mesh.position.set(x,toxic?.04:1.25,z); if(toxic)mesh.rotation.x=-Math.PI/2; scene.add(mesh);
    hazards.push({mesh,type,offset,radius:toxic?1.7:1.25});
    const sign=label(toxic?'TOXIC SPILL':'STEAM / CYCLES');sign.position.set(x,3,z);sign.scale.multiplyScalar(.5);scene.add(sign);
  }
  const crates = [[-8,-148,'ammo'],[8,-165,'health'],[-8,-179,'ammo'],[8,-189,'ammo']].map(([x,z,supply])=>{
    const m=box(x,.45,z,.9,.9,.9,new THREE.MeshStandardMaterial({color:supply==='ammo'?0xa48038:0x3c8868}));m.userData.supply=supply;
    const sign=label('MELEE / SUPPLY');sign.position.set(x,1.5,z);sign.scale.multiplyScalar(.45);scene.add(sign);return m;
  });
  const progress=document.createElement('progress');progress.max=3;progress.value=0;progress.hidden=true;progress.setAttribute('aria-label','Switch activation');progress.style.cssText='position:fixed;bottom:23%;left:35%;width:30%;height:12px;accent-color:#8fe0ff;z-index:20';document.body.appendChild(progress);
  const note=document.createElement('aside');note.hidden=true;note.style.cssText='position:fixed;right:20px;top:24%;width:min(360px,80vw);padding:18px;background:#08191eed;border:1px solid #8fe0ff;color:#e5f8ff;z-index:20;font:18px/1.5 sans-serif';document.body.appendChild(note);
  return {lights,hazards,crates,progress,note};
}
