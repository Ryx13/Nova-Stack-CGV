import * as THREE from 'three';

// Street dressing stays batched: no individual prop animations or physics bodies.
export function createStreetAtmosphere(scene) {
  const dummy = new THREE.Object3D();
  function batch(geometry,color,count,place) {
    const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.95}),count);
    for(let i=0;i<count;i++){dummy.position.set(0,0,0);dummy.rotation.set(0,0,0);dummy.scale.set(1,1,1);place(dummy,i);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}scene.add(mesh);
  }
  batch(new THREE.PlaneGeometry(.25,.35),0xb2a995,160,(d,i)=>{d.position.set((i%2?1:-1)*(5+(i*17%70)/10),.035,25-(i*19%230));d.rotation.set(-Math.PI/2,0,i*1.3);});
  batch(new THREE.CylinderGeometry(.055,.055,.17,6),0x7e817a,70,(d,i)=>{d.position.set((i%2?1:-1)*(7+(i%4)),.08,20-(i*13%220));d.rotation.z=1.57;});
  batch(new THREE.BoxGeometry(.65,.45,.3),0x514a43,18,(d,i)=>{d.position.set((i%2?1:-1)*10.5,.23,20-i*12);d.rotation.y=i*.7;});
  batch(new THREE.CircleGeometry(.45,9),0x401b19,16,(d,i)=>{d.position.set((i%2?1:-1)*8,.025,9-i*14);d.rotation.x=-Math.PI/2;d.scale.set(1.2,.5,1);});
  const lines=[];
  for(let i=0;i<9;i++) {
    const z=22-i*25;
    for(const x of [-12,12]) {
      lines.push(x,0,z,x,7,z);
      if(i%3===0)lines.push(x,7,z,x-1,4,z-3,x-1,4,z-3,x-1.5,1,z-5);
      for(let n=0;n<12;n++) {const a=n/12,b=(n+1)/12;lines.push(x,7-Math.sin(a*Math.PI)*2,z-a*22,x,7-Math.sin(b*Math.PI)*2,z-b*22);}
    }
    const x=i%2?10:-10;
    for(let n=0;n<5;n++) {const k=n*.17;lines.push(x+k,.15,z,x+k,.7,z,x+k,.7,z,x+k,.7,z+1,x,.15+k,z,x+.7,.15+k,z);}
  }
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(lines,3)),new THREE.LineBasicMaterial({color:0x454a49})));
  const mistCanvas=document.createElement('canvas');mistCanvas.width=mistCanvas.height=64;
  const ctx=mistCanvas.getContext('2d'),gradient=ctx.createRadialGradient(32,32,0,32,32,32);
  gradient.addColorStop(0,'rgba(190,206,206,.3)');gradient.addColorStop(1,'rgba(190,206,206,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
  const mistMaterial=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(mistCanvas),transparent:true,opacity:.22,depthWrite:false});
  const patches=[];
  for(let i=0;i<10;i++){const p=new THREE.Sprite(mistMaterial);p.position.set((i%2?1:-1)*5,1.7,15-i*23);p.scale.set(18,4,1);scene.add(p);patches.push(p);}
  const buildings=scene.children.filter(o=>o.userData.streetBuilding);
  let elapsed=0,nextSiren=12,nextThunder=32,lodTimer=0;
  return {update(dt,state,sfx,camera) {
    if(state.paused||state.isDead||!state.readyShown)return;
    elapsed+=dt;
    for(let i=0;i<patches.length;i++) patches[i].position.x=(i%2?1:-1)*5+Math.sin(elapsed*.07+i)*3;
    if(elapsed>nextSiren){nextSiren=elapsed+28;sfx.burst('sine',420,2,.018);sfx.burst('sine',530,1.5,.012);}
    if(state.timeOfDay==='day'&&elapsed>nextThunder){nextThunder=elapsed+45;sfx.noise(1.8,.045,140);}
    lodTimer-=dt;if(lodTimer>0)return;lodTimer=.25;
    // Base buildings are already simple boxes: retain their silhouette,
    // collision and occlusion; hide decorative children in the distance.
    for(const building of buildings) {
      const distant=building.position.distanceToSquared(camera.position)>85*85;
      for(const child of building.children) {
        if(child===building.userData.shell)continue;
        child.visible=!distant;
        if(!distant&&child.userData.neonSign)child.visible=Math.sin(elapsed*11+building.position.z)>.08;
      }
    }
  }};
}
