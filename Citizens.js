/* ======================================================================
   Citizens.js — THE INFECTED AS THE PEOPLE OF THE CITY

   Each level's infected are drawn from the city's own people: office
   workers and residents downtown, workers along the harbour, hazmat
   responders out at the quarantine. (Dr. James, built from the same kind
   of Mixamo body, is the story's: assets/story/, never infected.) Every citizen is a
   Mixamo body on the same skeleton as the playable roster (roster.js),
   built by tools/build_characters.py -- citizens:

     art/citizens/<id>_rigged.fbx        -> assets/citizens/<id>.glb
     art/zombie_animations/<clip>.fbx    -> assets/citizens/zombie_animations.glb

   so one set of zombie clips plays on all of them (fitClip fits the hip
   height to each body). A citizen whose file isn't there is skipped.

   They look infected through zombify(): one small material change that
   drains and greens the skin and clothes and lays grime and dried blood
   over them, so an ordinary citizen model needs no repainting.

   characters.js registers each loaded citizen as a zombie template
   (loadZombies), in the background once the level is playable, and picks
   templates by weight: a level's citizens, with the two original zombie
   models kept to a small share (ORIGINAL_WEIGHT).
====================================================================== */
import * as THREE from 'three';
import { loadGLB, fitClip, loadAnimations } from './roster.js';
import { gfx } from './GraphicsProfile.js';

// Everyone the game knows. from: where they come into a street, 'doors'
// (out of a shop or office doorway) or 'street' (further up the road).
// mixamo: the character's name on Mixamo, for the credits.
export const CITIZENS = {
  office_worker: { role: 'Office worker', from: 'doors', mixamo: 'Ch33' },
  resident:      { role: 'Resident', from: 'doors', mixamo: 'Ch12' },
  young_woman:   { role: 'Young woman', from: 'doors', mixamo: 'Girl' },
  jogger:        { role: 'Jogger', from: 'street', runs: true, mixamo: 'Remy' },
  construction:  { role: 'Construction worker', from: 'street', mixamo: 'Ch17' },
  hazmat:        { role: 'Hazmat responder', from: 'street', mixamo: 'Ch11' },
  peasant:       { role: 'Street performer', from: 'street', mixamo: 'Peasant Girl' }, // in costume
};

// Who you meet where, and how often (relative weights)
export const LEVEL_CITIZENS = {
  // Downtown: people at work and at home, a jogger caught on a run, a
  // crew from a building site
  1: { office_worker: 3, resident: 3, jogger: 2, young_woman: 1, construction: 1 },
  // The harbour: dock and site workers, the waterfront's residents and
  // joggers, a costumed performer from the promenade
  2: { resident: 3, construction: 3, jogger: 2, young_woman: 1, office_worker: 1, peasant: 1 },
  // The quarantine and the works around it: the responders sent in, the
  // plant's workers and its office staff
  3: { hazmat: 4, construction: 3, office_worker: 1, resident: 1 },
};
// Each of the two original zombie models, beside the citizens' weights
// (about 10% of a level's infected between them, so the streets aren't
// crowded with copies of the same two)
export const ORIGINAL_WEIGHT = 0.6;
const LOW_PROFILE_TYPES = 3; // a weak GPU loads its level's three most common
export const CRAWLER_CHANCE = 0.12; // of street citizens: dragging themselves along

// How each one moves, picked per infected (characters.js): shambling,
// dragging a leg (Injured Run, slowed), still walking like a person (the
// roster's walk), or running. speed: on their base speed. Joggers always run.
export const GAITS = [
  { id: 'shamble', clip: 'walk',   weight: 45, speed: 1 },
  { id: 'drag',    clip: 'drag',   weight: 25, speed: 0.6 },
  { id: 'stride',  clip: 'stride', weight: 20, speed: 1.1 },
  { id: 'run',     clip: 'run',    weight: 10, speed: 1.6 },
];

const citizenFile = (id) => `assets/citizens/${id}.glb`;
const DRAG_CLIP_FILE = 'assets/Injured Run.glb';
const ZOMBIE_CLIPS_FILE = 'assets/citizens/zombie_animations.glb';
// Game name -> clip in zombie_animations.glb
const CLIPS = {
  walk: 'zombie_walk', run: 'zombie_run', idle: 'zombie_idle', attack: 'zombie_attack',
  crawl: 'zombie_crawl', bite: 'zombie_biting', biteMirror: 'zombie_biting_mirror',
  neckBite: 'zombie_neck_bite', standUp: 'zombie_stand_up', turn: 'zombie_turn',
};

/* --- Zombify ------------------------------------------------------------
   Colour drained toward grey and pushed sick green-grey, then two noise
   fields in the body's own space: grime and bruising darkening it, and
   blotches of dried blood. In the body's space, so the marks stay on the
   clothes as it moves. A handful of instructions a pixel. */
const ZOMBIFY_NOISE = /* glsl */`
varying vec3 vZombiePos;
uniform float uZombieScale;
float zHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float zNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(zHash(i), zHash(i + vec3(1, 0, 0)), f.x), mix(zHash(i + vec3(0, 1, 0)), zHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(zHash(i + vec3(0, 0, 1)), zHash(i + vec3(1, 0, 1)), f.x), mix(zHash(i + vec3(0, 1, 1)), zHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;
const ZOMBIFY_COLOUR = /* glsl */`
{
  float zl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 zc = mix(vec3(zl), diffuseColor.rgb, 0.42) * vec3(0.84, 0.95, 0.8);
  vec3 zp = vZombiePos * uZombieScale;
  zc *= 0.76 + 0.34 * zNoise(zp * 9.0);
  float blood = smoothstep(0.64, 0.74, zNoise(zp * 4.5 + 17.0));
  diffuseColor.rgb = mix(zc, vec3(0.22, 0.02, 0.02), blood * 0.85);
}`;
function zombifyMaterial(material, scale) {
  const m = material.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uZombieScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vZombiePos;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvZombiePos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ZOMBIFY_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ZOMBIFY_COLOUR}`);
  };
  m.customProgramCacheKey = () => 'zombify-1'; // every citizen shares one program per material kind
  return m;
}
function zombify(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    // Noise is sized to the body, whatever units its geometry came in
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const h = o.geometry.boundingBox.max.y - o.geometry.boundingBox.min.y || 1;
    const scale = 1.8 / Math.max(h, 1e-4);
    o.material = Array.isArray(o.material) ? o.material.map((m) => zombifyMaterial(m, scale)) : zombifyMaterial(o.material, scale);
  });
}

/** Loads this level's citizens and hands each to
    add({ id, scene, clips, weight, from, runs }) as it's ready; clips is
    every zombie clip fitted to that body, by game name. Skips any citizen
    whose file isn't there, and loads nothing without the clips. */
export async function loadCitizenTemplates(levelId, add) {
  const mix = LEVEL_CITIZENS[levelId] || LEVEL_CITIZENS[1];
  let ids = Object.keys(mix).sort((a, b) => mix[b] - mix[a]);
  if (gfx.low) ids = ids.slice(0, LOW_PROFILE_TYPES);
  const zombieClips = await loadGLB(ZOMBIE_CLIPS_FILE).catch(() => null);
  if (!zombieClips) return;
  // The two gaits from outside the zombie set: a limp, and a person's walk
  const injured = await loadGLB(DRAG_CLIP_FILE).catch(() => null);
  const roster = await loadAnimations().catch(() => null);
  const personWalk = roster?.clips.find((c) => c.name === 'walk');
  for (const id of ids) {
    const gltf = await loadGLB(citizenFile(id)).catch(() => null);
    if (!gltf) continue; // not added yet
    const scene = gltf.scene;
    const clips = {};
    for (const [key, name] of Object.entries(CLIPS)) {
      const clip = zombieClips.animations.find((c) => c.name === name);
      if (clip) clips[key] = fitClip(clip, zombieClips.scene, scene);
    }
    if (!clips.walk) continue;
    if (injured?.animations[0]) clips.drag = fitClip(injured.animations[0], injured.scene, scene);
    if (personWalk) clips.stride = fitClip(personWalk, roster.skeletonRoot, scene);
    zombify(scene);
    const c = CITIZENS[id] || {};
    add({ id, scene, clips, weight: mix[id], from: c.from || 'street', runs: !!c.runs });
  }
}
