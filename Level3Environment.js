import * as THREE from 'three';
import { state } from './state.js';

// Level-owned props: all interaction radii stay inside the existing AI corridor.
export function buildCompoundDetails(scene, defs, label) {
  const metal = new THREE.MeshStandardMaterial({ color:0x3d4c4d, roughness:.8 });
  const darkMetal = new THREE.MeshStandardMaterial({ color:0x202d30, roughness:.72, metalness:.35 });
  const steel = new THREE.MeshStandardMaterial({ color:0x89999a, roughness:.42, metalness:.55 });
  const equipment = new THREE.MeshStandardMaterial({color:0x17474d,emissive:0x1bdad5,emissiveIntensity:.7});
  const pipePaint = new THREE.MeshStandardMaterial({ color:0xb5a35d, roughness:.6 });
  const medMark = new THREE.MeshStandardMaterial({color:0xe7eee2,roughness:.55});
  const medGreen = new THREE.MeshStandardMaterial({color:0x358b53,roughness:.6});
  const dishMaterial = new THREE.MeshStandardMaterial({color:0x87999b,roughness:.45,metalness:.5,side:THREE.DoubleSide});
  const boxGeo = new THREE.BoxGeometry(1,1,1);
  function box(x,y,z,w,h,d,material=metal) {
    const m = new THREE.Mesh(boxGeo,material); m.position.set(x,y,z); m.scale.set(w,h,d); m.userData.staticScenery=true; scene.add(m); return m;
  }
  function cylinder(x,y,z,rTop,rBottom,h,material=metal,segments=12) {
    const m=new THREE.Mesh(new THREE.CylinderGeometry(rTop,rBottom,h,segments),material);
    m.position.set(x,y,z); m.userData.staticScenery=true; scene.add(m); return m;
  }
  function pipe(a,b,r=.08,material=steel) {
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);
    const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,delta.length(),8),material);
    m.position.copy(start.add(end).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());scene.add(m);return m;
  }
  const floodFixtures = [];
  const lights = defs.map((s,i) => {
    box(s.pos.x,1.1,s.pos.z-1.5,.8,2.2,.45);
    const screen = box(s.pos.x,1.7,s.pos.z-1.24,.65,.45,.03,new THREE.MeshBasicMaterial({color:0x65c7cc}));
    // Lit at night only: by day the switches keep just their beacons (Level3.js)
    const light = new THREE.PointLight(0xff3322,2,10,2); light.position.set(s.pos.x,4,s.pos.z); if (state.timeOfDay !== 'day') scene.add(light);
    floodFixtures.push(box(s.pos.x,4,s.pos.z,.8,.3,.4,new THREE.MeshBasicMaterial({color:0xffba88})));
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
  // Equipment annex in front of the tower shell, visible through a glass front.
  box(0,.15,-191,7,.3,3); box(0,3,-191,7,.2,3);
  for(let x=-2;x<=2;x+=2) { box(x,1.3,-191,1.1,2.3,.7); box(x,1.6,-190.6,.8,.6,.04,equipment); }
  box(0,1.5,-189.5,7,2.8,.04,new THREE.MeshStandardMaterial({color:0x97c7cf,transparent:true,opacity:.18,depthWrite:false}));
  const byKey=Object.fromEntries(defs.map(d=>[d.key,d]));
  // Compact exterior shells give the three objective buildings a clear
  // facility identity. Details face the street and stay on the 8x8 footprint.
  const frameMat = new THREE.MeshStandardMaterial({color:0x687779,roughness:.7,metalness:.28});
  const recessMat = new THREE.MeshStandardMaterial({color:0x111a1c,roughness:.9});
  const serviceMat = new THREE.MeshStandardMaterial({color:0x34494b,roughness:.72,metalness:.25});
  for (const def of defs) {
    const {x,z}=def.buildingPos;
    // Street-facing door surround, recessed door, and one service cabinet.
    box(x-2.45,1.55,z+4.06,.12,3.1,.16,frameMat);
    box(x-1.18,1.55,z+4.06,.12,3.1,.16,frameMat);
    box(x-1.82,1.5,z+4.12,1.15,2.85,.12,recessMat);
    box(x-1.82,.32,z+4.2,.56,.08,.035,steel);
    box(x+2.45,1.05,z+4.08,.9,1.35,.18,serviceMat);
    box(x+2.45,1.05,z+4.19,.68,.9,.04,darkMetal);
    box(x+2.45,1.05,z+4.22,.42,.12,.035,equipment);
    // Three short louvers add a readable ventilation cue at low mesh cost.
    for(let n=0;n<3;n++) box(x+2.45,.82+n*.22,z+4.24,.48,.055,.04,steel);
  }
  // Put each landmark beside its matching switch, beyond the center-facing console side.
  const gen=byKey.generator;
  if(gen) {
    const x=gen.buildingPos.x,z=gen.buildingPos.z+5.5;
    box(x,.65,z,2.2,1.3,1.5,darkMetal);box(x,.82,z+.78,1.45,.72,.08,equipment);
    cylinder(x,.82,z,.42,.48,.82,steel,16);
    for(let n=0;n<4;n++)box(x-.55+n*.36,.82,z+.84,.08,.45,.06,pipePaint);
    for(const dx of [-.62,.62]) {
      cylinder(x+dx,2.15,z-.15,.15,.17,1.25,steel,10);
      cylinder(x+dx,2.82,z-.15,.22,.22,.12,darkMetal,10);
    }
    pipe([x-.6,1.48,z],[x-.6,1.72,z-.7],.075,steel);pipe([x+.6,1.48,z],[x+.6,1.72,z-.7],.075,steel);
  }
  const cool=byKey.cooling;
  if(cool) {
    const cx=cool.buildingPos.x,cz=cool.buildingPos.z+5.5;
    for(const x of [cx-.85,cx+.85]) {
      cylinder(x,1.35,cz,.46,.48,2.25,steel,16);
      cylinder(x,2.52,cz,.38,.46,.16,darkMetal,16);
      cylinder(x,.2,cz,.55,.55,.18,darkMetal,16);
      for(let y=.65;y<2.3;y+=.45)cylinder(x,y,cz,.51,.51,.055,pipePaint,16);
      box(x,2.96,cz,.24,.2,.28,metal);
    }
    const fanZ=cz+.78,fanX=cx;
    const fan=new THREE.Mesh(new THREE.TorusGeometry(.43,.07,8,20),steel);fan.position.set(fanX,1.12,fanZ);scene.add(fan);
    cylinder(fanX,1.12,fanZ,.1,.1,.12,steel,12);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;const blade=box(fanX+Math.cos(a)*.2,1.12+Math.sin(a)*.2,fanZ,.32,.09,.07,darkMetal);blade.rotation.z=a;}
    pipe([cx-.85,2.15,cz],[cx-.4,2.15,cz-.55]);pipe([cx-.4,2.15,cz-.55],[cx+.4,2.15,cz-.55]);pipe([cx+.4,2.15,cz-.55],[cx+.85,2.15,cz],.08,steel);
  }
  const uplink=byKey.uplink;
  if(uplink) {
    const x=uplink.buildingPos.x,z=uplink.buildingPos.z+5.5;
    const dish=new THREE.Mesh(new THREE.SphereGeometry(1,20,12,0,Math.PI*2,Math.PI/2,Math.PI/2),dishMaterial);
    dish.position.set(x,3.1,z);dish.rotation.z=.55;dish.scale.set(1.25,.8,1.25);scene.add(dish);
    cylinder(x,1.9,z,.12,.18,1.9,darkMetal,10);
    pipe([x,2.65,z],[x,3.12,z],.055,pipePaint);
    box(x,.2,z,1.15,.35,.9,darkMetal);box(x,.78,z+.48,.85,.78,.08,equipment);
    for(const dx of [-.62,.62])box(x+dx,1.15,z+.48,.1,.65,.1,steel);
  }
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
    if(toxic) {
      // A leaking drum sits just off the spill edge so the existing hazard area stays clear.
      const bx=x+2.05,bz=z-.25;
      cylinder(bx,.52,bz,.34,.34,.92,pipePaint,12);
      cylinder(bx,.1,bz,.37,.37,.08,darkMetal,12);
      for(const y of [.3,.76]) {
        const hoop=new THREE.Mesh(new THREE.TorusGeometry(.345,.035,6,12),steel);hoop.position.set(bx,y,bz);hoop.rotation.x=Math.PI/2;scene.add(hoop);
      }
      cylinder(bx,.99,bz,.12,.12,.05,darkMetal,8);
    }
    if(type==='steam') {
      cylinder(x,.22,z,.42,.5,.3,darkMetal,10);
      for(let side of [-1,1]) box(x+side*.3,.58,z,.13,.5,.13,pipePaint);
    }
  }
  const crates = [[-8,-148,'ammo'],[8,-165,'health'],[-8,-179,'ammo'],[8,-189,'ammo']].map(([x,z,supply])=>{
    const m=box(x,.45,z,.9,.9,.9,new THREE.MeshStandardMaterial({color:supply==='ammo'?0xa48038:0x3c8868}));m.userData.supply=supply;
    const originalChildren=new Set(scene.children);
    box(x,.95,z,.68,.12,.68,darkMetal);
    if(supply==='health') {
      box(x,.48,z+.47,.48,.52,.035,medMark);
      box(x,.48,z+.495,.12,.38,.025,medGreen);
      box(x,.48,z+.51,.34,.12,.025,medGreen);
    } else {
      // Exposed brass rounds and a front catch make the ammunition box recognizable.
      box(x,.47,z+.48,.2,.3,.08,steel);
      for(let dx of [-.2,0,.2]) cylinder(x+dx,1.14,z,.075,.075,.36,pipePaint,10);
      for(let dx of [-.2,0,.2]) cylinder(x+dx,1.34,z,.075,.035,.08,steel,10);
    }
    scene.updateMatrixWorld(true);
    for(const child of [...scene.children]) if(!originalChildren.has(child))m.attach(child);
    return m;
  });
  const progress=document.createElement('progress');progress.max=3;progress.value=0;progress.hidden=true;progress.setAttribute('aria-label','Switch activation');progress.style.cssText='position:fixed;bottom:23%;left:35%;width:30%;height:12px;accent-color:#8fe0ff;z-index:20';document.body.appendChild(progress);
  const note=document.createElement('aside');note.hidden=true;note.style.cssText='position:fixed;right:20px;top:24%;width:min(360px,80vw);padding:18px;background:#08191eed;border:1px solid #8fe0ff;color:#e5f8ff;z-index:20;font:18px/1.5 sans-serif';document.body.appendChild(note);
  return {lights,floodFixtures,hazards,crates,progress,note};
}
