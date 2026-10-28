import * as THREE from 'three';

// Use the skin weights to give the existing rig clothing without changing
// its skeleton, animation bindings, or downloading another character.
export function dressSurvivor(root) {
  const cloth = new THREE.MeshStandardMaterial({ color: 0x59624a, roughness: 0.94 });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x383f43, roughness: 0.96 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x222727, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xb88a6b, roughness: 0.83 });
  const materials = [cloth, trousers, leather, skin];
  root.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const geometry = mesh.geometry.clone();
    const indices = geometry.index;
    const joints = geometry.getAttribute('skinIndex');
    const weights = geometry.getAttribute('skinWeight');
    if (!joints || !weights) return;
    const buckets = [[], [], [], []];
    const category = mesh.skeleton.bones.map((bone) => {
      const name = bone.name.toLowerCase();
      if (/head|neck/.test(name)) return 3;
      if (/hand|thumb|index|middle|pinky|ring|foot|ball/.test(name)) return 2;
      if (/pelvis|thigh|calf/.test(name)) return 1;
      return 0;
    });
    const count = indices ? indices.count : geometry.getAttribute('position').count;
    const components = ['getX', 'getY', 'getZ', 'getW'];
    for (let i = 0; i < count; i += 3) {
      const verts = [0, 1, 2].map((j) => indices ? indices.getX(i + j) : i + j);
      const scores = [0, 0, 0, 0];
      for (const vertex of verts) {
        for (let joint = 0; joint < 4; joint++) {
          scores[category[joints[components[joint]](vertex)] ?? 0] += weights[components[joint]](vertex);
        }
      }
      const region = scores.indexOf(Math.max(...scores));
      buckets[region].push(...verts);
    }
    geometry.setIndex(buckets.flat());
    geometry.clearGroups();
    let offset = 0;
    buckets.forEach((bucket, region) => {
      if (bucket.length) geometry.addGroup(offset, bucket.length, region);
      offset += bucket.length;
    });
    mesh.geometry = geometry;
    mesh.material = materials;
  });

  root.updateWorldMatrix(true, true);
  const torso = root.getObjectByName('spine_02');
  if (!torso) return;
  const anchor = torso.getWorldPosition(new THREE.Vector3());
  const scale = torso.getWorldScale(new THREE.Vector3());
  const orientation = torso.getWorldQuaternion(new THREE.Quaternion()).invert();
  const vest = new THREE.MeshStandardMaterial({ color: 0x333c32, roughness: 0.96 });
  const canvas = new THREE.MeshStandardMaterial({ color: 0x6e6852, roughness: 1 });
  const strap = new THREE.MeshStandardMaterial({ color: 0x282e28, roughness: 0.98 });
  function gear(size, offset, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.copy(torso.worldToLocal(anchor.clone().add(new THREE.Vector3(...offset))));
    mesh.quaternion.copy(orientation);
    mesh.scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
    mesh.castShadow = true;
    torso.add(mesh);
    return mesh;
  }
  gear([0.34, 0.34, 0.09], [0, -0.03, -0.13], vest);
  gear([0.31, 0.38, 0.18], [0, -0.04, 0.19], canvas);
  gear([0.045, 0.38, 0.04], [-0.13, 0.02, -0.18], strap);
  gear([0.045, 0.38, 0.04], [0.13, 0.02, -0.18], strap);
  gear([0.12, 0.11, 0.07], [-0.09, -0.13, -0.21], canvas);
  gear([0.12, 0.11, 0.07], [0.09, -0.13, -0.21], canvas);
}

// Fade both the rim and the base of the beam. A uniform transparent cone
// produces a hard triangle even when the actual spotlight is soft.
export function streetlightBeamMaterial(isDay) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(0xffc070) },
      opacity: { value: isDay ? 0.055 : 0.085 },
    },
    vertexShader: `
      varying vec2 beamUv;
      varying vec3 worldPos;
      varying vec3 worldNormal;
      void main() {
        beamUv = uv;
        worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        worldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0); // world space: each beam under its own lamp
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      varying vec2 beamUv;
      varying vec3 worldPos;
      varying vec3 worldNormal;
      void main() {
        float rim = pow(abs(dot(normalize(worldNormal), normalize(cameraPosition - worldPos))), 1.5);
        float base = smoothstep(0.0, 0.32, beamUv.y);
        float tip = 1.0 - smoothstep(0.88, 1.0, beamUv.y);
        gl_FragColor = vec4(color, opacity * rim * base * tip);
      }
    `,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
