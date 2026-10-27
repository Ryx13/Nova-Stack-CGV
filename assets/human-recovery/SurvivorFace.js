import * as THREE from 'three';

// Eye positions are measured from the head-bone rest transforms and front
// surface vertices in both supplied GLBs. Both faces look along local +Z.
const FACE_CONFIG = {
  runner: {
    head: 'Head',
    eyes: [
      { x: -0.0235, y: 0.0310, z: 0.0610 },
      { x:  0.0235, y: 0.0310, z: 0.0615 },
    ],
    eyeHalfWidth: 0.0082, eyeHalfHeight: 0.0026,
    lidHalfWidth: 0.0100, lidHalfHeight: 0.0024,
    facePoint: [0, 0.031, 0.075], openLift: 0.0065, openScaleY: 0.34,
  },
  walker: {
    head: 'mixamorig:Head_06',
    eyes: [
      { x: -0.0710, y: 0.2220, z: 0.3255 },
      { x:  0.0710, y: 0.2220, z: 0.3265 },
    ],
    eyeHalfWidth: 0.0340, eyeHalfHeight: 0.0125,
    lidHalfWidth: 0.0390, lidHalfHeight: 0.0160,
    facePoint: [0, 0.222, 0.385], openLift: 0.010, openScaleY: 0.34,
  },
};
const DEFAULT_LID_COLOR = 0x9f614f;
const sharedFeatures = new Map();

function findHead(model, variant) {
  const wanted = FACE_CONFIG[variant]?.head.replace(/:/g, '');
  let found = null;
  model.traverse((node) => {
    if (!found && node.isBone && node.name.replace(/:/g, '') === wanted) found = node;
  });
  return found;
}

function hideWalkerMask(model) {
  const hidden = [];
  model.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const names = [node.name, ...materials.filter(Boolean).map((material) => material.name)];
    const maskAccessory = names.some((name) => /Mask_C|Human_walker_Object_9|HumanCleanSkin_walker\.001/i.test(name));
    if (maskAccessory) {
      hidden.push(node);
    }
  });
  for(const node of hidden)node.removeFromParent();
  return hidden;
}

function makeLidGeometry(halfWidth, halfHeight) {
  const columns = 17;
  const positions = [];
  const indices = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < columns; col++) {
      const u = col / (columns - 1) * 2 - 1;
      const arc = Math.sqrt(Math.max(0, 1 - u * u));
      const x = u * halfWidth;
      const y = (row === 0 ? 1 : -1) * arc * halfHeight;
      const z = -0.004 * u * u - 0.001 * (1 - arc);
      positions.push(x, y, z + 0.0025);
    }
  }
  for (let col = 0; col < columns - 1; col++) {
    const a = col, b = col + 1, c = columns + col, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeAlmondGeometry(halfWidth, halfHeight, depth) {
  const columns = 17;
  const positions = [];
  const indices = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < columns; col++) {
      const u = col / (columns - 1) * 2 - 1;
      const arc = Math.sqrt(Math.max(0, 1 - u * u));
      positions.push(u * halfWidth, (row === 0 ? 1 : -1) * arc * halfHeight, (1 - u * u) * depth);
    }
  }
  for (let col = 0; col < columns - 1; col++) {
    const a = col, b = col + 1, c = columns + col, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeLidMaterial(model, variant, skinColor) {
  let source = null;
  const suffix = variant === 'walker' ? 'walker' : 'runner';
  model.traverse((node) => {
    if (source || !node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    source = materials.find((m) => m && new RegExp(`HumanCleanSkin.*${suffix}`, 'i').test(m.name)) || null;
  });
  const material = source?.clone() || new THREE.MeshStandardMaterial();
  material.name = `Survivor eyelid skin ${suffix}`;
  // Lids have no vertex-colour attribute; cloned skin materials must use their skin tone.
  material.vertexColors = false;
  material.map = null;
  material.normalMap = null;
  material.roughnessMap = null;
  material.metalnessMap = null;
  material.emissiveMap = null;
  material.aoMap = null;
  material.alphaMap = null;
  material.roughness = 0.88;
  material.metalness = 0;
  const tone = source?.userData?.humanSkinTone;
  if (Array.isArray(tone) || ArrayBuffer.isView(tone)) material.color.fromArray(tone);
  else if (variant === 'runner') material.color.setRGB(.24,.135,.10);
  else material.color.set(skinColor ?? DEFAULT_LID_COLOR);
  material.depthTest = true;
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  return material;
}

function getSharedFeatures(model, variant, options) {
  if (sharedFeatures.has(variant)) return sharedFeatures.get(variant);
  const config = FACE_CONFIG[variant];
  const depth = config.eyeHalfWidth * 0.02;
  const features = {
    lids: config.eyes.map(() => makeLidGeometry(config.lidHalfWidth, config.lidHalfHeight)),
    almond: makeAlmondGeometry(config.eyeHalfWidth, config.eyeHalfHeight, depth),
    irisGeometry: new THREE.SphereGeometry(1, 16, 12),
    pupilGeometry: new THREE.SphereGeometry(1, 12, 10),
    lidMaterial: makeLidMaterial(model, variant, options.skinColor),
    almondMaterial: new THREE.MeshStandardMaterial({ color: 0xe3d7c6, roughness: 0.82, metalness: 0 }),
    irisMaterial: new THREE.MeshStandardMaterial({ color: 0x754a30, roughness: 0.78, metalness: 0 }),
    pupilMaterial: new THREE.MeshStandardMaterial({ color: 0x211711, roughness: 0.72, metalness: 0 }),
  };
  sharedFeatures.set(variant, features);
  return features;
}

function makeEye(center, config, features) {
  const group = new THREE.Group();
  group.name = 'SurvivorEye';
  group.position.set(center.x, center.y, center.z + config.eyeHalfWidth * 0.04);
  const almond = new THREE.Mesh(features.almond, features.almondMaterial);
  almond.position.z = config.eyeHalfWidth * 0.055;
  almond.name = 'SurvivorSclera';
  group.add(almond);
  const iris = new THREE.Mesh(features.irisGeometry, features.irisMaterial);
  iris.position.z = config.eyeHalfWidth * 0.095;
  iris.scale.set(config.eyeHalfWidth * 0.56, config.eyeHalfHeight * 0.9, config.eyeHalfWidth * 0.018);
  iris.name = 'SurvivorIris';
  group.add(iris);
  const pupil = new THREE.Mesh(features.pupilGeometry, features.pupilMaterial);
  pupil.position.z = config.eyeHalfWidth * 0.12;
  pupil.scale.set(config.eyeHalfWidth * 0.22, config.eyeHalfHeight * 0.56, config.eyeHalfWidth * 0.012);
  pupil.name = 'SurvivorPupil';
  group.add(pupil);
  return group;
}

/**
 * Add animated eyes and lids to a runner or walker recovery model. `setAwake(t,
 * cameraPosition)` takes normalized progress; pass a world-space camera
 * position to turn the head gently toward the viewer as the eyes open.
 */
export function attachSurvivorFace(model, variant = 'runner', options = {}) {
  const config = FACE_CONFIG[variant];
  const head = model && config && findHead(model, variant);
  if (!head) return null;

  // Object_9 is the walker’s separate mask/fins accessory. Hide it only on
  // the clone this helper is attached to (the cured/warmup actor).
  const hiddenAccessories = variant === 'walker' ? hideWalkerMask(model) : [];

  const features = getSharedFeatures(model, variant, options);
  const eyes = config.eyes.map((point) => {
    const eye = makeEye(point, config, features);
    eye.traverse((node) => { if (node.isMesh) { node.frustumCulled = true; node.receiveShadow = true; } });
    head.add(eye);
    return eye;
  });
  const lids = config.eyes.map((point, index) => {
    const lid = new THREE.Mesh(features.lids[index], features.lidMaterial);
    lid.name = `SurvivorUpperEyelid_${index}`;
    lid.position.set(point.x, point.y, point.z);
    lid.userData.baseY = point.y;
    lid.renderOrder = 20;
    lid.receiveShadow = true;
    lid.frustumCulled = true;
    head.add(lid);
    return lid;
  });

  const yawAxis = new THREE.Vector3(0, 1, 0);
  const previousYaw = new THREE.Quaternion();
  const nextYaw = new THREE.Quaternion();
  const inversePreviousYaw = new THREE.Quaternion();
  const parentQuaternion = new THREE.Quaternion();
  const worldTarget = new THREE.Vector3();
  const localTarget = new THREE.Vector3();
  const headWorld = new THREE.Vector3();
  const localForward = new THREE.Vector3(0, 0, 1);
  const localUp = new THREE.Vector3(0, 1, 0);
  const facePoint = new THREE.Vector3(...config.facePoint);

  function setAwake(progress, cameraPosition) {
    const t = THREE.MathUtils.clamp(Number(progress) || 0, 0, 1);
    const eased = t * t * (3 - 2 * t);
    const lift = config.openLift * eased;
    const slim = THREE.MathUtils.lerp(1, config.openScaleY, eased);
    for (const lid of lids) {
      lid.position.y = lid.userData.baseY + lift;
      lid.scale.y = slim;
    }
    for (const eye of eyes) eye.scale.y = Math.max(0.001, eased);

    let yaw = 0.10 * eased;
    inversePreviousYaw.copy(previousYaw).invert();
    const baseQuaternion = head.quaternion.clone().multiply(inversePreviousYaw);
    if (cameraPosition?.isVector3) {
      head.updateWorldMatrix(true, false);
      head.getWorldPosition(headWorld);
      worldTarget.copy(cameraPosition).sub(headWorld);
      if (head.parent) head.parent.getWorldQuaternion(parentQuaternion).invert();
      else parentQuaternion.identity();
      localTarget.copy(worldTarget).applyQuaternion(parentQuaternion);
      const facing = localForward.clone().applyQuaternion(baseQuaternion);
      const desired = localTarget.set(localTarget.x, 0, localTarget.z).normalize();
      yaw = Math.atan2(facing.z * desired.x - facing.x * desired.z,
        facing.x * desired.x + facing.z * desired.z) * eased;
      yaw = THREE.MathUtils.clamp(yaw, -0.16, 0.16);
    }
    nextYaw.setFromAxisAngle(yawAxis, yaw);
    head.quaternion.copy(baseQuaternion).multiply(nextYaw);
    previousYaw.copy(nextYaw);
  }

  function getFaceFrame(outPosition = new THREE.Vector3(), outForward = new THREE.Vector3(), outUp = new THREE.Vector3()) {
    head.updateWorldMatrix(true, false);
    outPosition.copy(facePoint);
    head.localToWorld(outPosition);
    outForward.copy(localForward).transformDirection(head.matrixWorld);
    outUp.copy(localUp).transformDirection(head.matrixWorld);
    return { position: outPosition, forward: outForward, up: outUp };
  }

  function setVisible(visible) {
    const shown = Boolean(visible);
    for (const lid of lids) lid.visible = shown;
    for (const eye of eyes) eye.visible = shown;
  }

  function dispose() {
    for (const lid of lids) lid.removeFromParent();
    for (const eye of eyes) eye.removeFromParent();
  }

  setAwake(0);
  return { head, hiddenAccessories, setAwake, setVisible, getFaceFrame, dispose };
}
