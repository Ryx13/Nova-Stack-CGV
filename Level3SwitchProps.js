import * as THREE from 'three';

// Compact controls with ground-level runs that point back toward their buildings.
export function buildSwitchProp(position, key, color) {
 const g = new THREE.Group();
 g.name = `Level 3 ${key} switch`;
 g.position.copy(position);

 const iron = new THREE.MeshStandardMaterial({ color: 0x455358, metalness: .65, roughness: .68 });
 const edge = new THREE.MeshStandardMaterial({ color: 0x788684, metalness: .55, roughness: .72 });
 const dark = new THREE.MeshStandardMaterial({ color: 0x1b292d, metalness: .3, roughness: .83 });
 const brass = new THREE.MeshStandardMaterial({ color: 0x947d56, metalness: .65, roughness: .67 });
 const rubber = new THREE.MeshStandardMaterial({ color: 0x202628, roughness: .92 });
 const accent = new THREE.Color(color);
 const lampMaterial = new THREE.MeshStandardMaterial({ color: 0x293a39, emissive: accent, emissiveIntensity: 0, roughness: .45 });
 const add = (geometry, material, parent = g) => {
  const mesh = new THREE.Mesh(geometry, material);
  parent.add(mesh);
  return mesh;
 };
 const box = (x, y, z, w, h, d, material = iron, parent = g) => {
  const mesh = add(new THREE.BoxGeometry(w, h, d), material, parent);
  mesh.position.set(x, y, z);
  return mesh;
 };
 const cylinder = (x, y, z, radius, height, material = iron, parent = g) => {
  const mesh = add(new THREE.CylinderGeometry(radius, radius, height, 10), material, parent);
  mesh.position.set(x, y, z);
  return mesh;
 };
 const runX = (start, end, y, z, radius, material) => {
  const mesh = cylinder((start + end) / 2, y, z, radius, Math.abs(end - start), material);
  mesh.rotation.z = Math.PI / 2;
  return mesh;
 };

 let moving;
 let bars;
 let indicator;

 if (key === 'generator') {
  box(0, .37, 0, 1.16, .74, .9, iron);
  box(0, .77, 0, 1.2, .1, .94, edge);
  for (const x of [-.34, -.17, 0, .17, .34]) box(x, .41, .465, .075, .32, .025, dark);
  for (const x of [-.46, .46]) box(x, .14, -.47, .13, .19, .13, dark);
  cylinder(-.37, .93, .31, .15, .12, brass).rotation.x = Math.PI / 2;
  moving = new THREE.Group();
  moving.position.set(-.37, .94, .43);
  g.add(moving);
  cylinder(0, .4, 0, .045, .8, edge, moving);
  const grip = cylinder(0, .82, 0, .105, .22, rubber, moving);
  grip.rotation.z = Math.PI / 2;
  indicator = box(.36, .8, .473, .17, .09, .035, lampMaterial);
  for (const z of [-.24, .24]) {
   runX(.58, 4.15, .12, z, .055, rubber);
   runX(.58, .78, .12, z, .083, brass);
  }
 } else if (key === 'cooling') {
  box(0, .23, 0, 1.12, .46, .9, iron);
  runX(-4.15, .54, .25, 0, .14, edge);
  for (const x of [-.57, .57]) {
   const flange = cylinder(x, .25, 0, .23, .09, brass);
   flange.rotation.z = Math.PI / 2;
  }
  cylinder(0, .55, 0, .21, .35, iron);
  cylinder(0, .81, 0, .055, .28, brass);
  moving = new THREE.Group();
  moving.position.set(0, .98, .16);
  g.add(moving);
  add(new THREE.TorusGeometry(.32, .043, 6, 16), brass, moving);
  cylinder(0, 0, 0, .09, .09, edge, moving).rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) {
   const angle = i * Math.PI / 2;
   const spoke = box(-Math.sin(angle) * .16, Math.cos(angle) * .16, 0, .035, .31, .035, edge, moving);
   spoke.rotation.z = angle;
  }
  indicator = box(.39, .47, .46, .16, .09, .035, lampMaterial);
 } else if (key === 'uplink') {
  box(0, .67, 0, 1.08, 1.34, .76, iron);
  box(0, 1.36, 0, 1.14, .07, .82, edge);
  box(0, .88, .4, .88, .73, .055, dark);
  bars = [];
  for (let i = 0; i < 3; i++) {
   const material = new THREE.MeshStandardMaterial({ color: 0x263635, emissive: accent, emissiveIntensity: 0, roughness: .5 });
   box(-.25 + i * .25, .87, .438, .13, .18 + i * .15, .025, material);
   bars.push(material);
  }
  box(0, .32, .405, .8, .09, .06, edge);
  cylinder(.37, 1.72, -.22, .035, .7, edge);
  const aerial = add(new THREE.ConeGeometry(.18, .3, 8), iron);
  aerial.position.set(.37, 2.08, -.22);
  aerial.rotation.z = Math.PI;
  indicator = box(.35, 1.24, .402, .13, .075, .03, lampMaterial);
  for (const z of [-.18, .18]) {
   runX(.54, 4.15, .1, z, .035, rubber);
   runX(.54, .72, .1, z, .065, brass);
  }
 } else {
  throw new Error(`Unknown Level 3 switch: ${key}`);
 }

 g.userData.indicator = indicator;
 g.userData.setProgress = value => {
  const progress = THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
  if (key === 'generator') moving.rotation.z = -2 * progress;
  if (key === 'cooling') moving.rotation.z = -Math.PI * 1.5 * progress;
  if (bars) bars.forEach((material, i) => {
   const lit = THREE.MathUtils.clamp(progress * 3 - i, 0, 1);
   material.color.setHex(0x263635).lerp(accent, lit);
   material.emissiveIntensity = lit * .7;
  });
  lampMaterial.color.setHex(0x293a39).lerp(accent, progress);
  lampMaterial.emissiveIntensity = progress * .8;
 };
 g.userData.setProgress(0);
 g.traverse(object => {
  if (object.isMesh) {
   object.castShadow = true;
   object.receiveShadow = true;
  }
 });
 return g;
}
