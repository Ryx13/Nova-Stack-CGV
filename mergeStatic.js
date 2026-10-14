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
     game tracks as dynamic (coins).
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
    && !m.transparent && m.alphaTest === 0 && !m.isShaderMaterial && m.visible !== false;
}

// Everything about a material's look except its base colour (that goes
// into vertex colours)
function lookKey(m) {
  const tex = (t) => (t ? `${t.source.uuid}:${t.repeat.x},${t.repeat.y}:${t.offset.x},${t.offset.y}:${t.rotation}` : '-');
  return [
    m.type, tex(m.map), tex(m.emissiveMap), tex(m.normalMap), tex(m.roughnessMap),
    m.emissive ? m.emissive.getHexString() : '', m.emissiveIntensity ?? '',
    m.roughness ?? '', m.metalness ?? '', m.side, m.flatShading, m.fog, m.toneMapped,
    m.envMapIntensity ?? '', m.opacity,
  ].join('|');
}

// One material-group slice of a mesh's geometry, in world space, with
// exactly position / normal / uv / color (mergeGeometries needs matching
// attribute sets)
function worldPart(mesh, geometry, start, count, color) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = Math.min(count, src.attributes.position.count - start);
  if (n <= 0) return null;
  const g = new THREE.BufferGeometry();
  const slice = (attr, size) => new THREE.BufferAttribute(attr.array.slice(start * size, (start + n) * size), size);
  g.setAttribute('position', slice(src.attributes.position, 3));
  if (src.attributes.normal) g.setAttribute('normal', slice(src.attributes.normal, 3));
  else g.computeVertexNormals();
  g.setAttribute('uv', src.attributes.uv ? slice(src.attributes.uv, 2) : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.applyMatrix4(mesh.matrixWorld);
  return g;
}

export function mergeStaticScenery(scene) {
  scene.updateMatrixWorld(true);
  const dynamic = new Set((state.coinPickups || []).map((c) => c.mesh));
  const buckets = new Map(); // key -> { material, parts[], cast, receive }
  const merged = [];
  let before = 0;

  const visit = (o, inStatic, visible) => {
    const isStatic = inStatic || o.userData.staticScenery;
    const vis = visible && o.visible;
    if (dynamic.has(o)) return;
    for (const c of [...o.children]) visit(c, isStatic, vis);
    if (isStatic && vis && o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && o.geometry && !o.morphTargetInfluences) {
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
          const key = `${lookKey(mat)}#${chunk}#${o.castShadow}#${o.receiveShadow}`;
          let b = buckets.get(key);
          if (!b) {
            const shared = mat.clone();
            if (shared.color) shared.color.set(0xffffff);
            shared.vertexColors = true;
            b = { material: shared, parts: [], cast: o.castShadow, receive: o.receiveShadow };
            buckets.set(key, b);
          }
          const part = worldPart(o, geo, grp.start, grp.count, color);
          if (part) b.parts.push(part);
        }
        merged.push(o);
      }
    }
  };
  for (const c of [...scene.children]) visit(c, false, true);

  for (const o of merged) {
    // children that didn't merge stay where they are in the world
    for (const c of [...o.children]) o.parent.attach(c);
    o.parent.remove(o); // keep the object itself: occluders still raycast it
  }
  const root = new THREE.Group();
  root.name = 'mergedScenery';
  for (const b of buckets.values()) {
    if (!b.parts.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(b.parts), b.material);
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
