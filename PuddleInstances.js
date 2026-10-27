import * as THREE from 'three';

// One disc and shader, with the original scatter and transparent depth order.
export function createPuddleInstances(material, count, halfWidth, streetLength) {
  // A flat, double-sided sheet has no second visible surface to blend.
  material.forceSinglePass = true;
  const mesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 16), material, count);
  mesh.name = 'roadPuddles';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const records = [], transform = new THREE.Object3D(), projection = new THREE.Matrix4();
  const point = new THREE.Vector3(), lastCamera = new THREE.Matrix4(), frustum = new THREE.Frustum();
  mesh.userData.puddleRecords = records;
  let dirty = true;
  function scatter(random = Math.random) {
    records.length = 0;
    for (let i = 0; i < count; i++) {
      transform.scale.set(1.2 + random() * 2.4, 0.9 + random() * 1.8, 1);
      transform.rotation.set(-Math.PI / 2, 0, random() * Math.PI);
      transform.position.set((random() - 0.5) * (halfWidth * 2 - 2.5), 0.009, 30 - random() * (streetLength + 60));
      transform.updateMatrix();
      records.push({ matrix: transform.matrix.clone(), position: transform.position.clone(), sphere: new THREE.Sphere(transform.position.clone(), Math.max(transform.scale.x, transform.scale.y)), index: i, depth: 0 });
      mesh.setMatrixAt(i, transform.matrix);
    }
    mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere(); dirty = true;
  }
  function sort(camera) {
    camera.updateWorldMatrix(true, false); mesh.updateWorldMatrix(true, false);
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld);
    if (!dirty && lastCamera.equals(projection)) return;
    lastCamera.copy(projection); dirty = false;
    frustum.setFromProjectionMatrix(projection);
    for (const record of records) record.depth = point.copy(record.position).applyMatrix4(projection).z;
    records.sort((a, b) => b.depth - a.depth || a.index - b.index);
    let visible = 0;
    for (const record of records) if (frustum.intersectsSphere(record.sphere)) mesh.setMatrixAt(visible++, record.matrix);
    mesh.count = visible;
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, scatter, sort, records };
}
