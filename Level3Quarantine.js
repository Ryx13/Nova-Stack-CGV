import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static, non-colliding facility dressing. The road (roughly |x| <= 11)
// stays open; only the two gate headers cross it, above head height.
export function buildQuarantineFacility(scene, label, addStaticBox, {night=false}={}) {
  const facility = new THREE.Group();
  facility.name = 'Level 3 quarantine facility';
  facility.userData.staticScenery=true;
  scene.add(facility);

  const mats = {
    frame: new THREE.MeshStandardMaterial({ color: 0x52686a, metalness: .55, roughness: .62 }),
    pale: new THREE.MeshStandardMaterial({ color: 0xb5c0b9, metalness: .17, roughness: .88, side: THREE.DoubleSide }),
    tent: new THREE.MeshStandardMaterial({ color: 0x9baea9, roughness: .94, side: THREE.DoubleSide }),
    dark: new THREE.MeshStandardMaterial({ color: 0x263b40, metalness: .47, roughness: .7 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0xcf9c45, roughness: .88 }),
    medical: new THREE.MeshStandardMaterial({ color: 0x2b936d, roughness: .84 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x5e9da0, metalness: .35, roughness: .48, transparent: true, opacity: .68 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x6f8582, roughness: .97 }),
  };
  mats.backdrop=new THREE.MeshBasicMaterial({color:night?0x202c36:0x657079,fog:true});
  mats.backdropRoof=new THREE.MeshBasicMaterial({color:night?0x151e28:0x3e4d55,fog:true});
  mats.backdropWindows=new THREE.MeshBasicMaterial({color:night?0xb79050:0x3c515c,fog:true});
  for(const m of [mats.backdrop,mats.backdropRoof,mats.backdropWindows])m.userData.backdrop=true;
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const batches = new Map();
  const mergeParts = new Map();
  function box(material, x, y, z, w, h, d, rz = 0) {
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push({ x, y, z, w, h, d, rz });
  }
  function beam(material, ax, ay, az, bx, by, bz, width) {
    const start = new THREE.Vector3(ax, ay, az);
    const end = new THREE.Vector3(bx, by, bz);
    const mesh = new THREE.Mesh(cube, material);
    mesh.position.copy(start).add(end).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
    mesh.scale.set(width, new THREE.Vector3(bx - ax, by - ay, bz - az).length(), width);
    mesh.castShadow = true;
    if (!mergeParts.has(material)) mergeParts.set(material, []);
    mergeParts.get(material).push(mesh);
  }
  function pipe(ax, ay, az, bx, by, bz, radius = .13, material = mats.frame) {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const delta = b.clone().sub(a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 7), material);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    if (!mergeParts.has(material)) mergeParts.set(material, []);
    mergeParts.get(material).push(mesh);
  }
  function wheel(material, x, y, z, radius, tube = .055, horizontal = false) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 5, 10), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = horizontal ? 0 : Math.PI / 2;
    if (horizontal) mesh.rotation.x = Math.PI / 2;
    if (!mergeParts.has(material)) mergeParts.set(material, []);
    mergeParts.get(material).push(mesh);
  }

  // Height and repeated stripes make these read as sealed checkpoints from a distance.
  function gate(z) {
    // Seven metres of clearance lets the giant follow through the checkpoint.
    const gateBox=(m,x,y,z,w,h,d,rz=0)=>box(m,x,y*1.25,z,w,h*1.25,d,rz);
    const gatePipe=(ax,ay,az,bx,by,bz,r)=>pipe(ax,ay*1.25,az,bx,by*1.25,bz,r);
    for (const x of [-13.2, 13.2]) {
      gateBox(mats.frame, x, 2.9, z, .52, 5.8, .68);
      gateBox(mats.concrete, x, .28, z, 1.7, .56, 1.55);
      gateBox(mats.pale, x, 5.15, z + .42, 1.05, .38, .11);
      gateBox(mats.stripe, x, 1.65, z + .38, .58, .16, .08);
      gateBox(mats.stripe, x, 3.5, z + .38, .58, .16, .08);
      gatePipe(x, 5.65, z - .35, x, 6.35, z - .35, .16);
      // A raised barrier and scanner head distinguish these from ordinary arches.
      const side = Math.sign(x);
      gateBox(mats.dark, x - side * .37, 2.35, z + .65, .58, 1.2, .54);
      gateBox(mats.glass, x - side * .69, 2.47, z + .65, .07, .72, .36);
      gateBox(mats.stripe, x - side * .26, 1.22, z + 1.3, .7, .42, .74);
      beam(mats.pale, x - side * .27, 1.85, z + 1.3,
        x - side * 2.1, 4.55, z + 1.3, .16);
      beam(mats.stripe, x - side * 1.13, 3.12, z + 1.32,
        x - side * 1.35, 3.45, z + 1.32, .18);
    }
    gateBox(mats.frame, 0, 6.08, z, 26.8, .73, .75);
    gateBox(mats.pale, 0, 6.11, z + .41, 14.4, .53, .09);
    for (let x = -12; x <= 12; x += 2.4) gateBox(mats.stripe, x, 5.58, z + .4, 1.04, .13, .08);
    gateBox(mats.dark, 0, 7.03, z, 9.1, 1.12, .55);
    for (const x of [-3.3, 3.3]) gateBox(mats.medical, x, 7.03, z + .29, .5, .5, .07);
    // Painted edge lines are guidance, never obstacles.
    for (const x of [-11.25, 11.25]) gateBox(mats.stripe, x, .025, z + 4, .12, .05, 7.3);
  }
  gate(-24);
  gate(-142);

  // Each medical station has a pitched, ribbed canvas roof and open road-facing end.
  function tent(x, z, side) {
    const inner = x - side * 3.2, outer = x + side * 3.2;
    const x0 = Math.min(inner, outer), x1 = Math.max(inner, outer);
    const z0 = z - 5.5, z1 = z + 5.5;
    box(mats.concrete, x, .12, z, 6.6, .24, 11.3);
    for (const zz of [z0, z0 + 2.75, z, z + 2.75, z1]) {
      for (const xx of [x0, x1]) pipe(xx, .23, zz, xx, 3.1, zz, .085);
      beam(mats.frame, x0, 3.1, zz, x, 4.55, zz, .09);
      beam(mats.frame, x, 4.55, zz, x1, 3.1, zz, .09);
    }
    const vertices = [];
    function quad(a, b, c, d) { vertices.push(...a, ...b, ...c, ...a, ...c, ...d); }
    quad([x0, 3.12, z0], [x, 4.57, z0], [x, 4.57, z1], [x0, 3.12, z1]);
    quad([x, 4.57, z0], [x1, 3.12, z0], [x1, 3.12, z1], [x, 4.57, z1]);
    quad([outer, .23, z0], [outer, 3.12, z0], [outer, 3.12, z1], [outer, .23, z1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    const canvas = new THREE.Mesh(geo, mats.tent);
    canvas.castShadow = true;
    facility.add(canvas);
    // Front flap and awning identify the open medical entrance.
    for (const zz of [z0, z1]) {
      box(mats.pale, x, 3.2, zz, 2.0, .22, .08);
      box(mats.stripe, x, 2.95, zz + .08, 1.15, .13, .06);
    }
    const frontZ = z1 + .2;
    box(mats.pale, x, 3.73, frontZ, 1.15, 1.05, .12);
    box(mats.medical, x, 3.73, frontZ + .075, .18, .77, .07);
    box(mats.medical, x, 3.73, frontZ + .075, .77, .18, .07);
    // Hospital fixtures: wheeled gurney silhouettes, privacy screens, and raised filters.
    for (const zz of [z - 2.65, z + 1.55]) {
      box(mats.frame, x, .92, zz, 1.14, .09, 2.06);
      box(mats.pale, x, 1.01, zz, .98, .1, 1.86);
      box(mats.pale, x, 1.12, zz - .68, .82, .17, .4);
      for (const dx of [-.43, .43]) for (const dz of [-.78, .78])
      {
        box(mats.dark, x + dx, .55, zz + dz, .08, .65, .08);
        wheel(mats.dark, x + dx, .25, zz + dz, .18);
      }
      // Slender drip pole, hook, and hanging bag at the head of each bed.
      pipe(x + .64, .23, zz - .87, x + .64, 2.33, zz - .87, .035);
      pipe(x + .35, 2.3, zz - .87, x + .88, 2.3, zz - .87, .03);
      box(mats.glass, x + .81, 2.02, zz - .87, .18, .3, .11);
    }
    box(mats.frame, outer + side * .46, 1.25, z - 3.6, .65, 2.45, 1.5);
    for (let i = 0; i < 5; i++) box(mats.dark, outer + side * .46, 1.8 - i * .23, z - 2.79, .48, .055, .05);
    pipe(outer + side * .46, 2.45, z - 3.6, outer + side * .46, 3.2, z - 3.6, .12);
  }
  tent(-18, -55, -1);
  tent(18, -83, 1);
  tent(-18, -111, -1);

  // Sidewall service runs, with visibly leaking joints and catch channels.
  for (const side of [-1, 1]) {
    const x = side * 23;
    for (const [za, zb] of [[-35, -132], [-145, -202]]) {
      for (const y of [1.05, 1.62]) pipe(x, y, za, x, y, zb, .115, y > 1.5 ? mats.pale : mats.frame);
      for (let z = za - 2, support = 0; z > zb; z -= 12, support++) {
        box(mats.frame, x, 1.37, z, .52, 2.35, .24);
        pipe(x, 1.05, z, x - side * 1.1, 1.05, z, .1);
        if (support % 3 === 0) {
          pipe(x, 1.68, z, x, 1.94, z, .045);
          wheel(mats.stripe, x, 1.98, z, .27, .05, true);
          box(mats.dark, x, 1.98, z, .07, .07, .42);
        }
        box(mats.dark, x - side * .72, .12, z, 1.12, .09, 1.36);
        if (Math.abs(z) % 3 < 2) {
          box(mats.glass, x - side * .72, .055, z, .67, .04, .81);
          for (let i = 0; i < 3; i++) pipe(x - side * .7 + (i - 1) * .13, 1.1, z, x - side * .7 + (i - 1) * .13, .24, z, .018, mats.glass);
        }
      }
    }
  }

  // Low prefabricated treatment sheds replace the street's apartment silhouette.
  // Their road-facing walls start beyond |x| = 26 and stay below five metres.
  function serviceShed(side, z) {
    const x = side * 31.6;
    const roadFace = x - side * 4.7;
    addStaticBox?.(4.65,1.89,6.75,x,2.15,z);
    box(mats.concrete, x, .16, z, 10.2, .32, 14.4);
    box(mats.pale, x, 2.15, z, 9.3, 3.78, 13.5);
    box(mats.dark, x, 4.22, z, 10.5, .3, 14.1);
    // Angled weather lips, seam ribs, and one large roll-up equipment door.
    for (const zz of [z - 6.5, z - 3.25, z, z + 3.25, z + 6.5]) {
      box(mats.frame, roadFace - side * .07, 2.06, zz, .11, 3.5, .11);
      box(mats.frame, x, 4.48, zz, 10.4, .13, .1);
    }
    box(mats.frame, roadFace - side * .12, 1.87, z + 1.5, .17, 3.1, 3.2);
    for (let y = .5; y < 3.35; y += .28)
      box(mats.dark, roadFace - side * .23, y, z + 1.5, .07, .055, 3.0);
    box(mats.stripe, roadFace - side * .26, .3, z + 1.5, .07, .11, 3.4);
    box(mats.glass, roadFace - side * .2, 2.55, z - 3.6, .08, .55, 1.6);
    // A framed office window and a recessed personnel door break up the wall.
    for (const zz of [z - 4.45, z - 2.75])
      box(mats.frame, roadFace - side * .26, 2.55, zz, .09, .76, .07);
    box(mats.frame, roadFace - side * .26, 2.55, z - 3.6, .09, .07, 1.77);
    box(mats.frame, roadFace - side * .26, 2.18, z - 3.6, .09, .07, 1.77);
    box(mats.frame, roadFace - side * .26, 2.92, z - 3.6, .09, .07, 1.77);
    box(mats.pale, roadFace - side * .22, 1.64, z - 5.35, .09, 2.75, 1.18);
    box(mats.frame, roadFace - side * .29, 1.64, z - 5.35, .09, 2.83, 1.26);
    box(mats.pale, roadFace - side * .32, 1.64, z - 5.35, .05, 2.62, 1.05);
    box(mats.dark, roadFace - side * .36, 1.48, z - 4.94, .06, .12, .09);
    for (let i = 0; i < 3; i++) {
      box(mats.frame, x - 2.5 + i * 2.5, 4.64, z - 3, 1.25, .5, 1.7);
      for (let k = 0; k < 4; k++)
        box(mats.dark, x - 2.5 + i * 2.5, 4.92, z - 3.57 + k * .35, 1.09, .045, .09);
    }
    pipe(x + 3.8, 4.2, z + 4.5, x + 3.8, 4.8, z + 4.5, .25);
    box(mats.frame, x + 3.8, 4.82, z + 4.5, 1.16, .13, 1.16);
  }
  [-51, -92, -132, -174].forEach(z => {
    serviceShed(-1, z);
    serviceShed(1, z - 9);
  });
  // Modest perimeter rails and posts define the outer site without tall blocks.
  for (const side of [-1, 1]) {
    const x = side * 39;
    for (let z = -19; z >= -218; z -= 8) {
      box(mats.frame, x, 1.42, z, .21, 2.82, .22);
      box(mats.pale, x, 2.56, z - 3.98, .12, .1, 7.9);
      box(mats.pale, x, .92, z - 3.98, .12, .1, 7.9);
      box(mats.frame, x, 1.72, z - 3.98, .055, .055, 7.9);
    }
  }
  for (let x = -38; x <= 38; x += 8) {
    box(mats.frame, x, 1.42, -221, .21, 2.82, .22);
    box(mats.pale, x + 3.95, 2.56, -221, 7.9, .1, .12);
    box(mats.pale, x + 3.95, .92, -221, 7.9, .1, .12);
  }

  // Courtyard frames the tower while the centre and its boss approach remain open.
  for (const side of [-1, 1]) {
    const x = side * 13.4;
    for (const z of [-204, -210]) {
      box(mats.concrete, x, .12, z, 1.15, .24, 4.2);
      box(mats.frame, x, 2.05, z, .18, 3.8, 3.7);
      box(mats.pale, x, 3.96, z, .52, .18, 3.85);
      for (const zz of [z - 1.64, z, z + 1.64]) box(mats.stripe, x - side * .11, 1.5, zz, .1, 1.13, .17);
    }
    // Courtyard drainage and perimeter markings, beyond the main lane.
    box(mats.dark, side * 10.9, .025, -205, .28, .05, 18);
    for (let z = -199; z >= -213; z -= 2.5)
      box(mats.stripe, side * 11.48, .03, z, .68, .055, .29);
  }
  // A raised, visibly engineered rear service ring encircles the tower shell.
  for (const x of [-8.1, 8.1]) {
    pipe(x, 3.1, -194, x, 3.1, -207, .24);
    for (const z of [-194, -200, -207]) pipe(x, .15, z, x, 3.1, z, .13);
  }
  for (const z of [-194, -207]) pipe(-8.1, 3.1, z, 8.1, 3.1, z, .24);

  // Connected perimeter and a second industrial row close the horizon gaps.
  for(const side of [-1,1]){
    box(mats.concrete,side*43,2.5,-95,2,5,290);
    for(let z=-231;z<=39;z+=18)addStaticBox?.(1,2.5,9,side*43,2.5,z);
    for(let i=0;i<7;i++){
      const z=32-i*40,h=11+(i%3)*3,x=side*52,face=side*44.9;
      box(mats.backdrop,x,h/2,z,14,h,37);
      box(mats.backdropRoof,x,h+.2,z,14.6,.4,37.6);
      for(const zz of [-12,0,12]){
        box(mats.backdropRoof,face,h/2,z+zz,.12,h,.18);
        box(mats.backdropWindows,face-side*.08,h-2.4,z+zz,.08,.85,4.5);
      }
      box(mats.backdropRoof,x,h+1,z-8,3,1.5,5);
    }
    for(const z of [-35,-74,-114,-205]){
      box(mats.dark,side*24,.8,z,2.8,1.6,2.4);
      box(mats.frame,side*24,1.65,z,3,.1,2.55);
      addStaticBox?.(1.4,.8,1.2,side*24,.8,z);
      for(const dx of [-.85,.85])box(mats.stripe,side*24+dx,.9,z+1.22,.12,1.3,.05);
    }
  }
  box(mats.backdrop,0,7,-239,90,14,12);
  box(mats.backdropRoof,0,14.25,-239,92,.5,13);
  for(let x=-36;x<=36;x+=12)box(mats.backdropWindows,x,10,-232.9,5,.9,.1);

  const dummy = new THREE.Object3D();
  for (const [material, items] of batches) {
    const instances = new THREE.InstancedMesh(cube, material, items.length);
    instances.castShadow = !material.userData.backdrop;
    instances.receiveShadow = true;
    items.forEach((item, i) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(0, 0, item.rz);
      dummy.scale.set(item.w, item.h, item.d);
      dummy.updateMatrix();
      instances.setMatrixAt(i, dummy.matrix);
    });
    instances.instanceMatrix.needsUpdate = true;
    facility.add(instances);
  }
  for (const [material, meshes] of mergeParts) {
    const geometries = meshes.map(mesh => {
      mesh.updateMatrix();
      return mesh.geometry.clone().applyMatrix4(mesh.matrix);
    });
    const merged = mergeGeometries(geometries, false);
    geometries.forEach(geometry => geometry.dispose());
    meshes.forEach(mesh => { if (mesh.geometry !== cube) mesh.geometry.dispose(); });
    if (!merged) throw new Error('Could not merge quarantine facility geometry');
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    facility.add(mesh);
  }
  return facility;
}
