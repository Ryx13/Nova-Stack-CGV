/* ======================================================================
   roster.js — PLAYABLE CHARACTERS

   Every character in assets/characters/ is a Mixamo rig with the same 25
   bones, and every clip lives once in animations.glb on that same
   skeleton (tools/build_characters.py builds both from art/). So any clip
   plays on any character: AnimationMixer binds tracks by bone name.

   The one thing that does NOT carry over between bodies is the Hips
   position track — it's authored for the character the clip was
   downloaded on, whose legs may be 30 cm longer or shorter, so the body
   would sink or hover. fitClip() rescales that track to each body's legs.

   Used by the character-select screen (main.js / characterSelect.js),
   the in-game player (characters.js) and Level 2's chase NPC.
====================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// showcase: the clip played when picked on the select screen (default 'dance').
// armSpread: degrees to swing the upper arms out from the body in every
//   clip — for bulky bodies whose arms otherwise sink into their chest.
export const ROSTER = [
  { id: 'viper',    name: 'Viper',    role: 'Commando',       blurb: 'Jungle-born, never misses a flank.' },
  { id: 'breacher', name: 'Breacher', role: 'SWAT Pointman',  blurb: 'First through every door.', showcase: 'shoot', armSpread: 10 },
  { id: 'cipher',   name: 'Cipher',   role: 'Netrunner',      blurb: 'Hacks the grid while it burns.' },
  { id: 'ironhand', name: 'Ironhand', role: 'Veteran',        blurb: 'Lost an arm. Kept the grudge.', showcase: 'shoot', armSpread: 10 },
  { id: 'ember',    name: 'Ember',    role: 'Gunslinger',     blurb: 'Twin holsters, short fuse.' },
];
export const DEFAULT_CHARACTER = 'viper';
const STORAGE_KEY = 'deadway.character';

export const characterFile = (id) => `assets/characters/${id}.glb`;
const ANIMATIONS_FILE = 'assets/characters/animations.glb';

export function getSelectedCharacter() {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (ROSTER.some((c) => c.id === id)) return id;
  } catch (e) { /* storage blocked — fall through to default */ }
  return DEFAULT_CHARACTER;
}
export function setSelectedCharacter(id) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* not persisted */ }
}

// One fetch per file for the whole session; the select screen warms the
// cache so the level's player load is instant.
const gltfCache = new Map();
export function loadGLB(path) {
  if (!gltfCache.has(path)) {
    gltfCache.set(path, new Promise((resolve, reject) => new GLTFLoader().load(path, resolve, undefined, reject)));
  }
  return gltfCache.get(path);
}

// Fresh, independently animatable copy of a character (the cached
// gltf.scene can only live in one parent at a time).
export async function instantiateCharacter(id) {
  const gltf = await loadGLB(characterFile(id));
  const root = skeletonClone(gltf.scene);
  root.userData.armSpread = ROSTER.find((c) => c.id === id)?.armSpread || 0;
  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
  });
  return root;
}

export async function loadAnimations() {
  const gltf = await loadGLB(ANIMATIONS_FILE);
  return { clips: gltf.animations, skeletonRoot: gltf.scene };
}

const HIPS = 'mixamorigHips'; // GLTFLoader strips the ':' from 'mixamorig:Hips'

// Rest-pose facts about a rig, in the Hips' parent (Armature) space — the
// space the Hips position track is keyed in — plus a snapshot of every
// bone so fitClip can pose the rig to measure a clip and put it back.
// Taken once, before any mixer has posed the rig, and cached on it.
function restOf(root) {
  if (root.userData.rest) return root.userData.rest;
  const hips = root.getObjectByName(HIPS);
  if (!hips) return null;
  const p = hips.position;
  const axis = ['x', 'y', 'z'].reduce((m, k) => (Math.abs(p[k]) > Math.abs(p[m]) ? k : m), 'x');
  const up = Math.sign(p[axis]); // Mixamo's Armature space has height along -z
  const feet = ['Left', 'Right'].map((s) => root.getObjectByName(`mixamorig${s}Foot`)).filter(Boolean);
  const pose = [];
  root.traverse((o) => { if (o.isBone) pose.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]); });
  const rest = { hips, axis, up, feet, pose, hipsRest: p.clone() };
  rest.ankle = lowestAnkle(root, rest);
  return (root.userData.rest = rest);
}

// Height (Armature units, up positive) of the lower ankle in the rig's
// current pose
function lowestAnkle(root, R) {
  root.updateMatrixWorld(true);
  let low = Infinity;
  for (const foot of R.feet) {
    const local = R.hips.parent.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
    low = Math.min(low, local[R.axis] * R.up);
  }
  return low;
}

// Lowest the ankles get over the whole clip; leaves the rig in rest pose
function lowestAnkleOver(root, R, clip, samples = 16) {
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  let low = Infinity;
  for (let i = 0; i <= samples; i++) {
    mixer.setTime((clip.duration * i) / samples);
    low = Math.min(low, lowestAnkle(root, R));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  for (const [o, pos, q, sc] of R.pose) { o.position.copy(pos); o.quaternion.copy(q); o.scale.copy(sc); }
  return low;
}

// Returns a copy of `clip` (authored on animRoot's skeleton) fitted to
// charRoot's body. Two steps:
//  1. Hips travel scales by the ratio of rest hip heights.
//  2. Bodies differ in more than hip height — some rigs rest with bent or
//     spread legs, so the clip's straightened legs reach 10-25 cm further
//     than proportions predict. So the clip is played on the body and the
//     Hips track shifted until the lowest the feet get over the clip is
//     the body's own standing ankle height: planted, not sunk or hovering.
export function fitClip(clip, animRoot, charRoot) {
  const A = restOf(animRoot);
  const C = restOf(charRoot);
  if (!A || !C || !C.feet.length) return clip;
  const ax = A.axis;
  const k = C.hipsRest[ax] / A.hipsRest[ax];
  // Clips from fuller rigs (Injured Run.glb has finger bones) carry tracks
  // for bones this body lacks; drop them rather than log a binding error each
  const names = new Set();
  charRoot.traverse((o) => names.add(o.name));
  const fitted = clip.clone();
  fitted.tracks = fitted.tracks.filter((t) => names.has(t.name.slice(0, t.name.lastIndexOf('.'))));
  spreadArms(fitted, charRoot);
  const hipsTrack = fitted.tracks.find((t) => t.name === `${HIPS}.position`);
  if (!hipsTrack) return fitted;
  const v = hipsTrack.values;
  ['x', 'y', 'z'].forEach((c, j) => {
    for (let i = j; i < v.length; i += 3) v[i] = (v[i] - A.hipsRest[c]) * k + C.hipsRest[c];
  });
  const shift = (C.ankle - lowestAnkleOver(charRoot, C, fitted)) * C.up;
  const j = ['x', 'y', 'z'].indexOf(ax);
  for (let i = j; i < v.length; i += 3) v[i] += shift;
  return fitted;
}

// Swings each upper arm out from the body by the character's armSpread,
// in its shoulder's space so "out" follows the torso as it bends. The
// axis is the body's forward line through the shoulder at rest; its sign
// is whichever way lifts the elbow, i.e. away from the ribs.
function spreadArms(clip, charRoot) {
  const deg = charRoot.userData.armSpread;
  if (!deg) return;
  const l = charRoot.getObjectByName('mixamorigLeftArm');
  const r = charRoot.getObjectByName('mixamorigRightArm');
  if (!l || !r) return;
  charRoot.updateMatrixWorld(true);
  const lp = l.getWorldPosition(new THREE.Vector3());
  const lateral = r.getWorldPosition(new THREE.Vector3()).sub(lp);
  const forward = new THREE.Vector3().crossVectors(lateral, new THREE.Vector3(0, 1, 0)).normalize();
  for (const arm of [l, r]) {
    const track = clip.tracks.find((t) => t.name === `${arm.name}.quaternion`);
    const elbow = arm.children.find((o) => o.isBone);
    if (!track || !elbow) continue;
    const parentQ = arm.parent.getWorldQuaternion(new THREE.Quaternion());
    const axis = forward.clone().applyQuaternion(parentQ.clone().invert());
    // Try the swing on the rest pose: keep the sign that raises the elbow
    const restQ = arm.quaternion.clone();
    const y0 = elbow.getWorldPosition(new THREE.Vector3()).y;
    arm.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, 0.1));
    arm.updateMatrixWorld(true);
    const sign = elbow.getWorldPosition(new THREE.Vector3()).y > y0 ? 1 : -1;
    arm.quaternion.copy(restQ);
    arm.updateMatrixWorld(true);
    const swing = new THREE.Quaternion().setFromAxisAngle(axis, sign * THREE.MathUtils.degToRad(deg));
    const q = new THREE.Quaternion();
    const v = track.values;
    for (let i = 0; i < v.length; i += 4) {
      q.fromArray(v, i).premultiply(swing).toArray(v, i);
    }
  }
}

// All clips fitted to one character, keyed by clip name.
export async function clipsFor(charRoot) {
  const { clips, skeletonRoot } = await loadAnimations();
  const out = {};
  for (const clip of clips) out[clip.name] = fitClip(clip, skeletonRoot, charRoot);
  return out;
}

export function boneByName(root, name) {
  return root.getObjectByName(`mixamorig${name}`) || null;
}
