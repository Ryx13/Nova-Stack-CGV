import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// One geometry per material, shared by the first- and third-person copies.
// The muzzle points down -Z, matching the camera and procedural weapons.
export function buildCureProjector(){
  const materials={
    shell:new THREE.MeshStandardMaterial({color:0x27383d,metalness:.55,roughness:.42}),
    ceramic:new THREE.MeshStandardMaterial({color:0xd7e2df,metalness:.18,roughness:.45}),
    grip:new THREE.MeshStandardMaterial({color:0x10191d,roughness:.85}),
    warning:new THREE.MeshStandardMaterial({color:0xd9ae45,metalness:.2,roughness:.5}),
    cure:new THREE.MeshBasicMaterial({color:0x78efff}),
  },parts=new Map(Object.keys(materials).map(k=>[k,[]]));
  function add(key,geometry,x,y,z,rx=0,ry=0,rz=0){
    const matrix=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(1,1,1));
    geometry.applyMatrix4(matrix);parts.get(key).push(geometry);
  }
  const box=(key,w,h,d,x,y,z,rx=0)=>add(key,new THREE.BoxGeometry(w,h,d),x,y,z,rx);
  const tube=(key,r,length,x,y,z)=>add(key,new THREE.CylinderGeometry(r,r,length,12),x,y,z,Math.PI/2);
  box('shell',.105,.11,.26,0,0,-.035);
  box('ceramic',.11,.035,.18,0,.07,-.025);
  box('grip',.062,.16,.075,0,-.117,.065,-.2);
  box('grip',.07,.025,.085,0,-.19,.08);
  box('shell',.1,.07,.09,0,.005,-.2);
  tube('ceramic',.036,.14,0,.015,-.265);
  tube('shell',.044,.025,0,.015,-.338);
  tube('cure',.028,.009,0,.015,-.353);
  tube('grip',.013,.011,0,.015,-.36);
  for(const x of [-.077,.077]){
    tube('shell',.026,.16,x,.01,.012);
    tube('cure',.021,.105,x,.01,.012);
    for(const z of [-.055,.079])tube('ceramic',.029,.025,x,.01,z);
    box('shell',.04,.025,.045,x,.045,.012);
  }
  for(const z of [-.1,-.065,-.03])box('warning',.09,.006,.012,0,.09,z);
  box('shell',.025,.03,.06,0,.11,-.1);
  box('cure',.014,.009,.025,0,.13,-.1);
  const root=new THREE.Group();root.name='cure-projector';
  for(const [key,geometries] of parts){
    const geometry=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
    const mesh=new THREE.Mesh(geometry,materials[key]);mesh.castShadow=true;root.add(mesh);
    mesh.name='cure-projector-'+key;
  }
  const muzzle=new THREE.Object3D();muzzle.name='cure-muzzle';muzzle.position.set(0,.015,-.365);root.add(muzzle);
  return root;
}
