/* ======================================================================
   mergeStatic.js — STATIC SCENERY MERGING

   The street is built from ~1,500 small meshes (every building piece,
   kerb, lamp pole, wreck panel, rubble chunk...), and three.js issues one
   draw call per mesh — twice for anything casting a shadow. That CPU
   cost, not triangles, was what the level spent most per frame.

   markStaticSince(n) tags every scene child added after index n as
   scenery; mergeStaticScenery() then collapses the tagged meshes into one
   mesh per (material look, 40 m stretch of street, shadow flags):
   - Chunked along the street so frustum and shadow culling still skip
     what's off screen, and a chunk's bounding sphere stays small.
   - Each mesh's material colour is baked into vertex colours, so
     buildings that differ only by tint share one material — and merge.
   - Only plain lit/unlit opaque materials merge. Transparent, custom
     shader (fire, toxic, puddles), sprites, lines, points, skinned and
     instanced meshes are left exactly as they were, as is anything the
     game tracks as dynamic (coins, and anything flagged
     userData.dynamic — e.g. vending-machine shelf cards, which sales
     take away).
   - Merged originals are detached, not destroyed: the third-person
     camera raycasts state.occluders every frame, and those small meshes
     (with their last world matrix) stay far cheaper to test than one
     street-sized merged mesh.
====================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { state } from './state.js';

const CHUNK = 40; // metres of street per merged chunk

export function markStaticSince(scene, startIndex) {
  for (let i = startIndex; i < scene.children.length; i++) scene.children[i].userData.staticScenery = true;
}

function mergeableMaterial(m) {
  return (m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial)
    && !m.transparent && m.alphaTest === 0 && !m.isShaderMaterial && m.visible !== false
    && !m.displacementMap && !m.clippingPlanes && !m.polygonOffset;
}

// Everything about a material's look except its base colour (that goes
// into vertex colours)
function lookKey(m) {
  const tex = (t) => (t ? `${t.source.uuid}:${t.repeat.x},${t.repeat.y}:${t.offset.x},${t.offset.y}:${t.rotation}` : '-');
  return [
    m.userData.staticLampHeight ?? '-',
    m.type, tex(m.map), tex(m.emissiveMap), tex(m.normalMap), tex(m.roughnessMap), tex(m.metalnessMap), tex(m.aoMap), tex(m.lightMap), tex(m.alphaMap), tex(m.bumpMap), tex(m.envMap),
    m.emissive ? m.emissive.getHexString() : '', m.emissiveIntensity ?? '',
    m.roughness ?? '', m.metalness ?? '', m.side, m.flatShading, m.fog, m.toneMapped,
    m.envMapIntensity ?? '', m.opacity, m.aoMapIntensity, m.lightMapIntensity, m.bumpScale,
    m.normalScale?.toArray().join(','), m.normalMapType, m.blending, m.depthTest, m.depthWrite, m.colorWrite,
  ].join('|');
}

// One material-group slice of a mesh's geometry, in world space, with
// exactly position / normal / uv / color (mergeGeometries needs matching
// attribute sets)
function worldPart(mesh, geometry, start, count, color, useVertexColors) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = Math.min(count, src.attributes.position.count - start);
  if (n <= 0) return null;
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    if (name === 'color') continue;
    const values = new Float32Array(n * attr.itemSize);
    const getters = ['getX','getY','getZ','getW'];
    for(let i=0;i<n;i++) for(let c=0;c<attr.itemSize;c++) values[i*attr.itemSize+c]=attr[getters[c]](start+i);
    g.setAttribute(name, new THREE.BufferAttribute(values, attr.itemSize));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(n*2),2));
  const col = new Float32Array(n * 3), sourceColor=useVertexColors?src.attributes.color:null;
  for (let i=0;i<n;i++) {
    col[i*3]=color.r*(sourceColor?sourceColor.getX(start+i):1);
    col[i*3+1]=color.g*(sourceColor?sourceColor.getY(start+i):1);
    col[i*3+2]=color.b*(sourceColor?sourceColor.getZ(start+i):1);
  }
  g.setAttribute('color',new THREE.BufferAttribute(col,3));
  if(src!==geometry)src.dispose();
  g.applyMatrix4(mesh.matrixWorld);
  return g;
}

export function mergeStaticScenery(scene, { instances = state.levelId !== 2 } = {}) {
  scene.updateMatrixWorld(true);
  const dynamic = new Set((state.coinPickups || []).map((c) => c.mesh));
  const buckets = new Map(); // key -> { material, parts[], cast, receive }
  const merged = [];
  let before = 0;
  const shapes=new WeakMap();
  function shapeKey(g){
    if(!shapes.has(g)){
      // Exact attribute content, not a lossy hash: equal shapes may share one draw.
      shapes.set(g,JSON.stringify([g.index?Array.from(g.index.array):null,Object.entries(g.attributes).map(([k,v])=>[k,v.itemSize,v.normalized,Array.from(v.array||[])])]));
    }
    return shapes.get(g);
  }

  const visit = (o, inStatic, visible) => {
    const isStatic = inStatic || o.userData.staticScenery;
    const vis = visible && o.visible;
    if (dynamic.has(o) || o.userData.dynamic) return;
    for (const c of [...o.children]) visit(c, isStatic, vis);
    if (isStatic && vis && o.isMesh && o.matrixWorld.determinant() > 0 && !o.isSkinnedMesh && !o.isInstancedMesh && o.geometry && !o.morphTargetInfluences) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.every(mergeableMaterial)) {
        before++;
        const geo = o.geometry;
        const groups = Array.isArray(o.material) && geo.groups.length
          ? geo.groups
          : [{ start: 0, count: geo.index ? geo.index.count : geo.attributes.position.count, materialIndex: 0 }];
        const center = new THREE.Vector3();
        new THREE.Box3().setFromObject(o).getCenter(center);
        const chunk = Math.floor(center.z / CHUNK);
        for (const grp of groups) {
          const mat = mats[grp.materialIndex ?? 0];
          const color = mat.color ? mat.color.clone() : new THREE.Color(1, 1, 1);
          const attributeKey = Object.entries(geo.attributes).map(([k,v])=>k+v.itemSize).sort().join(',');
          const key = `${lookKey(mat)}#${chunk}#${o.castShadow}#${o.receiveShadow}#${o.layers.mask}#${o.renderOrder}#${attributeKey}`;
          let b = buckets.get(key);
          if (!b) {
            const shared = mat.clone();
            if (shared.color) shared.color.set(0xffffff);
            shared.vertexColors = true;
            b = { material: shared, parts: [], sources: [], cast: o.castShadow, receive: o.receiveShadow, layers:o.layers.mask, order:o.renderOrder };
            buckets.set(key, b);
          }
          const part = worldPart(o, geo, grp.start, grp.count, color, mat.vertexColors);
          if (part) {
            b.parts.push(part);
            b.sources.push({mesh:o, color, full:!Array.isArray(o.material)&&!geo.attributes.color&&!Object.values(geo.attributes).some(a=>a.isInterleavedBufferAttribute)});
          }
        }
        merged.push(o);
      }
    }
  };
  for (const c of [...scene.children]) visit(c, false, true);

  for (const o of merged) {
    // children that didn't merge stay where they are in the world
    for (const c of [...o.children]) o.parent.attach(c);
    o.userData.sceneryMerged=true;
    o.parent.remove(o); // keep the object itself: occluders still raycast it
  }
  const root = new THREE.Group();
  root.name = 'mergedScenery';
  for (const b of buckets.values()) {
    if (!b.parts.length) continue;
    let mesh;
    const first=b.sources[0].mesh;
    if(instances && b.sources.length>=4 && b.sources.every(s=>s.full && s.mesh.matrixWorld.determinant()>0 && shapeKey(s.mesh.geometry)===shapeKey(first.geometry))) {
      b.material.vertexColors=false;
      mesh=new THREE.InstancedMesh(first.geometry,b.material,b.sources.length);
      b.sources.forEach((s,i)=>{mesh.setMatrixAt(i,s.mesh.matrixWorld);mesh.setColorAt(i,s.color);});
      mesh.computeBoundingSphere();
    } else mesh=new THREE.Mesh(mergeGeometries(b.parts),b.material);
    mesh.layers.mask=b.layers;mesh.renderOrder=b.order;
    mesh.userData.sceneryBatch=true;
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.matrixAutoUpdate = false; // never moves
    root.add(mesh);
    b.parts.forEach((p) => p.dispose());
  }
  root.matrixAutoUpdate = false;
  scene.add(root);
  return { meshesBefore: before, meshesAfter: root.children.length };
}
