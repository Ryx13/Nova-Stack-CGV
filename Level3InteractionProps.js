import * as THREE from 'three';
// Physical silhouettes replace floating names; HUD interaction prompts remain.
export function buildInteractionProp(position,kind,color){
 const g=new THREE.Group();g.name=`Level 3 ${kind} equipment`;g.position.copy(position);
 const metal=new THREE.MeshStandardMaterial({color:0x43565b,metalness:.5,roughness:.65});
 const dark=new THREE.MeshStandardMaterial({color:0x17272b,roughness:.8});
 const pale=new THREE.MeshStandardMaterial({color:0xc8d2c7,roughness:.8});
 const green=new THREE.MeshStandardMaterial({color:0x368a69,roughness:.8});
 const glow=new THREE.MeshBasicMaterial({color});
 function box(x,y,z,w,h,d,m=metal){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);g.add(o);return o;}
 function cylinder(x,y,z,r,h,m=metal){const o=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,10),m);o.position.set(x,y,z);g.add(o);return o;}
 if(kind==='supplies'){
  box(0,.45,0,1.6,.9,.8,dark);box(0,.94,0,1.7,.12,.86,metal);
  for(const x of [-.58,.58])box(x,.48,.42,.12,.88,.05,pale);
  box(0,.65,.45,.34,.09,.06,metal);
  for(const x of [-.3,0,.3]){cylinder(x,1.11,0,.065,.25,pale);}
 }else if(kind==='shelter'){
  box(0,1.25,-.2,1.7,2.5,.18,metal);box(0,1.23,-.08,1.38,2.2,.08,pale);
  box(0,1.7,0,.18,.67,.04,green);box(0,1.7,0,.6,.18,.04,green);
  box(.48,1,0,.07,.28,.08,dark);box(0,2.55,-.05,2,.13,.55,metal);
 }else{
  box(0,.55,0,.95,1.1,.65,metal);
  const screen=box(0,1.22,.05,.78,.48,.09,dark);screen.rotation.x=-.3;
  box(0,1.22,.11,.6,.28,.02,glow);
  box(0,1,.38,.95,.08,.32,metal);
  for(const x of [-.28,-.1,.1,.28])box(x,1.06,.37,.07,.04,.07,pale);
  if(kind==='broadcast'){
   cylinder(-.64,1.25,-.24,.045,2.5);cylinder(-.64,2.58,-.24,.1,.17,pale);
   const dish=new THREE.Mesh(new THREE.SphereGeometry(.48,12,6,0,Math.PI*2,0,Math.PI/2),new THREE.MeshStandardMaterial({color:0xb5c6c6,side:THREE.DoubleSide,metalness:.5,roughness:.6}));
   dish.position.set(-.64,2.18,-.24);dish.rotation.x=.8;g.add(dish);
  }else{box(.55,1.12,0,.13,.5,.13,pale);box(.55,1.4,.05,.3,.1,.16,metal);}
 }
 const indicator=box(.33,.82,.46,.14,.09,.035,glow);g.userData.indicator=indicator;
 g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});return g;
}
