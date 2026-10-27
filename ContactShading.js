import * as THREE from 'three';

// A baked radial contact-shading texture, rather than an SSAO screen pass.
// These are artistic approximations for fixed props, not a full lightmap bake.
export function addContactShading(scene,obstacles){
  const spots=obstacles.filter(o=>o.r>=.5&&o.r<=3.2);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  const ctx=canvas.getContext('2d');
  const gradient=ctx.createRadialGradient(32,32,5,32,32,31);
  gradient.addColorStop(0,'rgba(0,0,0,.23)');gradient.addColorStop(.45,'rgba(0,0,0,.13)');gradient.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
  const map=new THREE.CanvasTexture(canvas);
  const material=new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),material,spots.length);
  mesh.name='bakedContactShading';const transform=new THREE.Object3D();
  spots.forEach((o,i)=>{transform.position.set(o.x,.013,o.z);transform.rotation.x=-Math.PI/2;transform.scale.setScalar(o.r*2.6);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);});
  mesh.computeBoundingSphere();scene.add(mesh);return mesh;
}

// Derive low-frequency roughness variation from the existing asphalt art.
// No new random draws: scenery placement remains unchanged.
export function asphaltRoughness(source){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d');ctx.drawImage(source.image,0,0,256,256);
  const image=ctx.getImageData(0,0,256,256);
  for(let i=0;i<image.data.length;i+=4){const value=Math.round(205+(image.data[i]+image.data[i+1]+image.data[i+2])/3*.17);image.data[i]=image.data[i+1]=image.data[i+2]=value;image.data[i+3]=255;}
  ctx.putImageData(image,0,0);const texture=new THREE.CanvasTexture(canvas);
  texture.wrapS=source.wrapS;texture.wrapT=source.wrapT;texture.repeat.copy(source.repeat);texture.anisotropy=source.anisotropy;
  return texture;
}
