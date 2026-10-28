import { createPuddleInstances } from './PuddleInstances.js';
import { createStaticLampCache, installStreetLampBudget } from './StaticLampCache.js';
import * as THREE from 'three';
import { installHeightMist, mistEnabled } from './HeightMist.js';
import * as CANNON from 'cannon-es';
import { state } from './state.js';
import { gfx } from './GraphicsProfile.js';
import {levelWeapon} from './WeaponSlots.js';
import { finishRun } from './account.js';
import {
  createFogMaterial, fogUniforms, createRainMaterial, rainUniforms,
  createPuddleMaterial, puddleUniforms, fireUniforms, toxicUniforms,
} from './shaders.js';
installHeightMist(fogUniforms);
import { isMuted, onSoundChange } from './Music.js'; // master mute, shared with the music decks

/* ======================================================================
   Scene.js — RENDERER / SCENE / CAMERA / PHYSICS WORLD / HUD

   This is the reusable "base scene" every level builds on. It is
   intentionally a leaf module: it does NOT import characters.js,
   PowerUps.js, or Actions.js. Those three files already import each
   other (and import Scene.js), and characters.js in particular touches
   Scene.js's exports (world, scene, camera, addStaticBox, etc.) at its
   own module top-level (not inside a function) — e.g. it does
   `world.addBody(playerBody)` as a bare statement while the player body
   is being constructed. If Scene.js statically imported characters.js
   too, the circular import would force characters.js to start
   evaluating before Scene.js's own top-level code (this file) has run,
   and that top-level code would then crash trying to use `world`/`scene`
   before they exist. Keeping Scene.js dependency-free of the other three
   avoids that entirely — Level1/2/3.js import Scene.js, characters.js,
   PowerUps.js and Actions.js side-by-side and wire them together at
   runtime, after every module has finished loading.
====================================================================== */

export const dom = {
  loading: document.getElementById('loading'),
  loadFill: document.getElementById('load-fill'),
  loadStatus: document.getElementById('load-status'),
  start: document.getElementById('start-screen'),
  hud: document.getElementById('hud'),
  death: document.getElementById('deathscreen'),
  win: document.getElementById('winscreen'),
  enterBtn: document.getElementById('enter-btn'),
  canvas: document.getElementById('game-canvas'),
  healthFill: document.getElementById('health-fill'),
  staminaFill: document.getElementById('stamina-fill'),
  staminaStatus: document.getElementById('stamina-status'),
  ammo: document.getElementById('ammo'),
  reloadText: document.getElementById('reload-text'),
  prompt: document.getElementById('prompt'),
  promptText: document.getElementById('prompt-text'),
  killcount: document.getElementById('kills'),
  objective: document.getElementById('objective'),
  objCount: document.getElementById('obj-count'),
  compass: document.getElementById('objective-compass'),
  compassArrow: document.getElementById('compass-arrow'),
  compassLabel: document.getElementById('compass-label'),
  debugReadout: document.getElementById('debug-readout'),
  radar: document.getElementById('radar'),
  crosshair: document.getElementById('crosshair'),
  hitmarker: document.getElementById('hitmarker'),
  killfeed: document.getElementById('killfeed'),
  speedo: document.getElementById('speedo'),
  kph: document.getElementById('kph'),
  flash: document.getElementById('screen-flash'),
  deathStats: document.getElementById('death-stats'),
  winStats: document.getElementById('win-stats'),
  bloodVig: document.getElementById('blood-vignette'),
  criticalPulse: document.getElementById('critical-pulse'),
  pauseBtn: document.getElementById('pause-btn'),
  pauseOverlay: document.getElementById('pause-overlay'),
  resumeBtn: document.getElementById('resume-btn'),
};

export function addObstacle(x, z, r) { state.obstacles.push({ x, z, r }); }

/* ---------------------------------------------------------------------
   AUDIO — synthesized, no extra files (music tracks are separate, see
   Music.js)
--------------------------------------------------------------------- */
const SFX_GAIN = 0.32; // master level for the synthesized effects

export const sfx = {
  ctx: null,
  master: null,
  engineOsc: null,
  engineGain: null,
  engineFilter: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = isMuted() ? 0 : SFX_GAIN;
    this.master.connect(this.ctx.destination);
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 40;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 280;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
  },
  burst(type, freq, dur, gain = 0.2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.35), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, gain = 0.15, freq = 1800) {
    if (!this.ctx) return;
    const n = this.ctx.sampleRate * dur;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  },
  shoot() { this.noise(0.09, 0.22, 1400); this.burst('triangle', 180, 0.12, 0.12); },
  hit() { this.burst('square', 90, 0.08, 0.1); },
  hurt() { this.burst('sawtooth', 140, 0.18, 0.16); },
  pickup() { this.burst('sine', 660, 0.15, 0.1); this.burst('sine', 990, 0.18, 0.06); },
  melee() { this.noise(0.08, 0.12, 400); },
  groan() { this.burst('sawtooth', 70 + Math.random() * 40, 0.45, 0.05); },
  foot() { this.noise(0.05, 0.05, 220); },
  explosion() { this.noise(0.55, 0.4, 300); this.burst('sawtooth', 55, 0.6, 0.32); },
  // Two quick low thumps ("lub-dub") for the low-health tension cue — see
  // updateLowHealthFX in Actions.js. No new audio asset, same as every
  // other sfx.* here: synthesized from the shared oscillator/noise primitives.
  heartbeat() {
    this.burst('sine', 60, 0.11, 0.22);
    setTimeout(() => this.burst('sine', 50, 0.13, 0.16), 140);
  },
  setEngine(speed, on) {
    if (!this.engineGain) return;
    const t = this.ctx.currentTime;
    const target = on ? THREE.MathUtils.clamp(0.02 + speed * 0.012, 0.02, 0.14) : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.08);
    if (this.engineOsc) this.engineOsc.frequency.setTargetAtTime(42 + speed * 3.2, t, 0.08);
  },
};

// The sound button (main.js) drives one mute for the whole game — mirror
// it onto the sfx master gain. setTargetAtTime smooths the step so
// muting mid-firefight doesn't pop. Before init() there's nothing to
// adjust; init() itself reads isMuted() for the starting value.
onSoundChange((m) => {
  if (!sfx.ctx) return;
  sfx.master.gain.setTargetAtTime(m ? 0 : SFX_GAIN, sfx.ctx.currentTime, 0.05);
});

/* ---------------------------------------------------------------------
   1. RENDERER / SCENE / CAMERA
--------------------------------------------------------------------- */
// MSAA off on the low profile (GraphicsProfile.js): it multiplies the memory
// traffic of every pixel, which is what a weak GPU has least of
export const renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: gfx.antialias, powerPreference: 'high-performance' });
// Capped at 1.5 (MAX_PIXEL_RATIO); RenderScale.js steps it down further if frames run slow
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;

export const scene = new THREE.Scene();
// Hybrid candidate: all static lamp contributions, six live lamps.
export const staticLampCache = createStaticLampCache(renderer, scene, { gridStatic: true });
installStreetLampBudget(renderer,scene,staticLampCache);
// Reuse effect lights, expanding when needed so overlapping effects retain their lighting.
const effectLightPools = [[], []];
for (const pool of effectLightPools) {
  for (let i = 0; i < 4; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 1, 2);
    light.userData.effectInUse = false;
    pool.push(light);
    scene.add(light);
  }
}
export function acquireEffectLight(color, intensity, distance, decay = 2, persistent = false) {
  if (sunlightOnly()) return null;
  const pool = effectLightPools[persistent ? 1 : 0];
  let light = pool.find((slot) => !slot.userData.effectInUse);
  if (!light) {
    light = new THREE.PointLight(0xffffff, 0, 1, 2);
    pool.push(light);
    scene.add(light);
  }
  light.userData.effectInUse = true;
  light.color.set(color);
  light.intensity = intensity;
  light.distance = distance;
  light.decay = decay;
  return light;
}
export function releaseEffectLight(light) {
  if (!light) return;
  light.intensity = 0;
  light.userData.effectInUse = false;
}

// Register all authored lamps; the hybrid cache budgets only live illumination.
export function registerStreetLight(source) {
  scene.add(source);
}

const SKY_COLOR = 0x6e6258;
scene.background = new THREE.Color(SKY_COLOR);
scene.fog = new THREE.FogExp2(SKY_COLOR, 0.009);

export const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.12, 520);
scene.add(camera); // so a camera-attached first-person viewmodel (added later) actually renders
camera.position.set(3.4, 3.1, 38);
camera.lookAt(1.5, 1.2, 22);

const RAIN_DISTANCE = 3; // how far in front of the camera the rain card sits
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Rain plane is a flat card parented to the camera (defined further
  // down this file) — keep it exactly filling the frustum at
  // RAIN_DISTANCE so it always reads as full-screen rain rather than a
  // visible floating rectangle. onResize() isn't called until after
  // `rain` exists (see the explicit call right after it's created), and
  // browsers never dispatch a real 'resize' event during a script's own
  // synchronous top-level execution, so `rain` is always defined by the
  // time this line can actually run.
  // Size for the widest FOV the camera ever uses (the 74° sprint kick),
  // not the current one — at the stock 62° the card only just covered
  // the frustum, so sprinting (any FOV widening) revealed its edges at
  // the sides of the screen.
  const h = 2 * RAIN_DISTANCE * Math.tan(THREE.MathUtils.degToRad(75 / 2)) * 1.05;
  rain.scale.set(h * camera.aspect, h, 1);
}
window.addEventListener('resize', onResize);

function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

// NIGHT sky gradient — the game's original dusk look, with one touch-up:
// the zenith stop was deepened slightly (see below) for the star field.
const nightSkyCanvas = makeCanvas(8, 64, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  // Slightly deepened zenith (was #1c1a22) so the star field and moon
  // read against the sky instead of melting into the light-pollution wash.
  g.addColorStop(0, '#15141a');
  g.addColorStop(0.45, '#6a5346');
  g.addColorStop(0.72, '#c48a52');
  g.addColorStop(1, '#d9b07a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
});
const nightSkyTex = new THREE.CanvasTexture(nightSkyCanvas);

// MOONLIT NIGHT sky (state.moonlitNight — Level 2's dead grid): no city
// glow to paint the haze amber, so it runs deep navy at the zenith down
// to a moonlit slate-blue at the horizon
const moonNightSkyCanvas = makeCanvas(8, 64, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#060912');
  g.addColorStop(0.5, '#121a2a');
  g.addColorStop(0.8, '#253149');
  g.addColorStop(1, '#34415a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
});
const moonNightSkyTex = new THREE.CanvasTexture(moonNightSkyCanvas);
// Where the moon hangs on a moonlit night: low over the far end of the
// street, ~15 degrees right of the spawn's forward (-z), ~24 degrees up —
// in frame from the start without looking up. The moonlight comes from it.
const MOON_DIR = new THREE.Vector3(
  Math.sin(THREE.MathUtils.degToRad(15)) * Math.cos(THREE.MathUtils.degToRad(24)),
  Math.sin(THREE.MathUtils.degToRad(24)),
  -Math.cos(THREE.MathUtils.degToRad(15)) * Math.cos(THREE.MathUtils.degToRad(24)),
);

// DAY sky gradient — new, overcast/drizzly blue-grey so the Day mode
// rain and mist actually make sense with what's overhead.
const daySkyCanvas = makeCanvas(8, 64, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#7c93a8');
  g.addColorStop(0.45, '#a7bac9');
  g.addColorStop(0.75, '#c7d3dc');
  g.addColorStop(1, '#dfe6ea');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
});
const daySkyTex = new THREE.CanvasTexture(daySkyCanvas);

export const sky = new THREE.Mesh(
  new THREE.SphereGeometry(420, 24, 16),
  new THREE.MeshBasicMaterial({ map: nightSkyTex, side: THREE.BackSide, fog: false, depthWrite: false })
);
scene.add(sky);

const hemiLight = new THREE.HemisphereLight(0xe7c9a0, 0x1a1612, 0.55);
scene.add(hemiLight);
const sun = new THREE.DirectionalLight(0xffc48a, 1.15);
sun.position.set(-80, 42, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 320;
sun.shadow.bias = -0.0007;
scene.add(sun);
sun.target.position.set(0, 0, -50);
scene.add(sun.target);
const ambientLight = new THREE.AmbientLight(0x3a322c, 0.28);
scene.add(ambientLight);

/* ---------------------------------------------------------------------
   SUNLIGHT-ONLY DAYS — Level 2's clear day (state.clearDay) is lit by
   the sun and the sky's fill (hemisphere + ambient) alone: no lamps,
   glints, beacons, fire or muzzle-flash lights. Every other light in the
   game is attached through addLight(); in that mode the light is still
   built but never attached, so code that recolours, flickers or removes
   it keeps working on a detached light that renders nothing. Besides
   reading right in daylight, it keeps the per-pixel light count at the
   sun + sky, and a shot or explosion no longer adds a light (which made
   every lit material recompile its shader mid-fight).
--------------------------------------------------------------------- */
export const sunlightOnly = () => state.timeOfDay === 'day' && state.clearDay;
export function addLight(parent, light) {
  if (!sunlightOnly()) parent.add(light);
  return light;
}

/* ---------------------------------------------------------------------
   SUN DISC — a visible glowing disc placed in the sky along the exact
   direction the DirectionalLight above already shines from (its
   position IS that direction, since directional lights only care about
   direction-to-target, never their literal distance). Parented to `sky`
   so it automatically re-centers on the camera every frame the same way
   the sky sphere already does (see sky.position.copy(camera.position)
   in Actions.js's animate loop) — no extra per-frame code needed here.
   Day-only: applyTimeOfDay() below toggles its visibility, since at
   night there's no sun (see the streetlight-only night lighting further
   down in this file / characters.js).
--------------------------------------------------------------------- */
const SUN_DISTANCE = 400; // just inside the 420-radius sky sphere
const sunDir = sun.position.clone().normalize();
const sunGlowCanvas = makeCanvas(64, 64, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,250,235,1)');
  g.addColorStop(0.25, 'rgba(255,244,214,0.9)');
  g.addColorStop(0.6, 'rgba(255,220,160,0.35)');
  g.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
});
export const sunVisual = new THREE.Sprite(new THREE.SpriteMaterial({
  map: new THREE.CanvasTexture(sunGlowCanvas),
  transparent: true,
  depthWrite: false,
  depthTest: false,
  fog: false,
  blending: THREE.AdditiveBlending,
}));
sunVisual.position.copy(sunDir).multiplyScalar(SUN_DISTANCE);
sunVisual.scale.set(95, 95, 1);
sunVisual.renderOrder = -1; // draw with/just after the sky, behind everything else
sky.add(sunVisual);

/* ---------------------------------------------------------------------
   NIGHT SKY — stars + a moon, parented to the sky dome exactly like
   sunVisual above so they track the camera for free. applyTimeOfDay()
   toggles them: the day sky is an overcast gradient where they'd be
   invisible noise anyway, and the sun sprite owns that sky.
--------------------------------------------------------------------- */
const starSpriteTex = new THREE.CanvasTexture(makeCanvas(32, 32, (ctx) => {
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(230,238,255,.8)');
  g.addColorStop(1, 'rgba(230,238,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
}));
// The stars twinkle: each one's brightness wavers at its own pace (aPhase),
// worked out on the GPU from one shared clock (DayCycle.js advances it)
export const starUniforms = { uTime: { value: 0 } };
function twinkle(shader, renderer) {
  THREE.Material.prototype.onBeforeCompile.call(this, shader, renderer); // keep the global hook (HeightMist.js)
  shader.uniforms.uTime = starUniforms.uTime;
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'uniform float uTime;\nattribute float aPhase;\nvarying float vTwinkle;\nvoid main() {')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvTwinkle = 0.6 + 0.4 * sin(uTime * (1.2 + aPhase * 2.5) + aPhase * 6.2832);');
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'varying float vTwinkle;\nvoid main() {')
    .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.a *= vTwinkle;');
}
function makeStarLayer(count, size, opacity) {
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    phase[i] = Math.random();
    // Spread over the upper dome, but kept above ~27° elevation: the
    // amber city-glow band near the horizon swallows anything fainter,
    // so stars concentrate where the sky is actually dark.
    const el = (0.3 + Math.random() * 0.7) * (Math.PI / 2); // elevation
    const az = Math.random() * Math.PI * 2;
    const r = 402; // just inside the 420-radius sky sphere
    pos[i * 3] = Math.cos(el) * Math.cos(az) * r;
    pos[i * 3 + 1] = Math.sin(el) * r;
    pos[i * 3 + 2] = Math.cos(el) * Math.sin(az) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.PointsMaterial({
    map: starSpriteTex, size, sizeAttenuation: false, transparent: true, opacity,
    depthWrite: false, fog: false, blending: THREE.AdditiveBlending, color: 0xdfe6ff,
  });
  mat.onBeforeCompile = twinkle;
  mat.customProgramCacheKey = () => 'stars';
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = -1; // with the sky, behind everything else
  sky.add(pts);
  return pts;
}
// Two layers (many faint + a few bright) so the field isn't uniform.
// Sizes/opacity tuned against the amber city-glow gradient — much dimmer
// and the faint layer simply disappears into the light pollution.
export const stars = [makeStarLayer(700, 2.2, 0.85), makeStarLayer(130, 3.4, 1.0)];

const moonTex = new THREE.CanvasTexture(makeCanvas(128, 128, (ctx) => {
  // Halo, bright disc, a few darker maria — reads as a moon, not a
  // second sun (additive blending would otherwise make it glare).
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(235,240,255,.95)');
  g.addColorStop(0.28, 'rgba(210,222,245,.5)');
  g.addColorStop(1, 'rgba(190,205,235,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(228,235,252,.98)';
  ctx.beginPath(); ctx.arc(64, 64, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(178,190,215,.5)';
  [[56, 58, 5], [70, 72, 4], [62, 74, 3], [74, 56, 3]].forEach(([mx, my, mr]) => {
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
  });
}));
export const moonVisual = new THREE.Sprite(new THREE.SpriteMaterial({
  // depthTest stays ON (unlike the sun sprite): the sky dome never writes
  // depth so nothing about it occludes the moon, but real geometry does —
  // a moon shining through a building silhouette would break the illusion.
  map: moonTex, transparent: true, depthWrite: false, fog: false,
  blending: THREE.AdditiveBlending, opacity: 0.95,
}));
// Elevation ~42°, ~22° right of the spawn forward (-z): high enough to
// clear the rooftops and sit on the darker upper gradient, low enough to
// enter the frame on a modest upward glance instead of only when staring
// at the zenith.
moonVisual.position.set(111, 268, -276);
moonVisual.scale.set(50, 50, 1);
moonVisual.renderOrder = -1;
sky.add(moonVisual);

/* ---------------------------------------------------------------------
   DAY / NIGHT MODE

   TIME_OF_DAY_CONFIG holds every value that differs between the two
   modes; applyTimeOfDay() below just writes that data onto the
   lights/fog/sky objects created above rather than rebuilding the
   scene. Night no longer uses this DirectionalLight at all (sunIntensity
   is 0) — visibility at night comes entirely from the streetlights in
   characters.js instead, so their number/brightness matters more than it
   used to.
--------------------------------------------------------------------- */
const TIME_OF_DAY_CONFIG = {
  night: {
    skyTex: nightSkyTex,
    bgColor: SKY_COLOR,
    fogColor: SKY_COLOR,
    fogDensity: 0.009,
    hemiSky: 0xb7c8dc, hemiGround: 0x35332d, hemiIntensity: 0.8,
    sunColor: 0xffc48a, sunIntensity: 0, sunVisible: false, // sun switched off — streetlights carry the night
    celestial: true, // stars + moon own the night sky
    ambientColor: 0x68717e, ambientIntensity: 0.42,
    hazeColor: 0xb9c4cf, hazeOpacity: 0.5, hazeCoverage: 0.35,
    rainOn: false,
    puddlesOn: false,
  },
  // Night for levels that set state.moonlitNight (Level 2): the grid is
  // dead, so no amber light pollution — a cool moonlit night instead.
  // The "sun" light becomes the moon (dim, blue-white, from MOON_DIR) and
  // the fills are tinted the same way, so shade reads as blue, not black.
  moonNight: {
    skyTex: moonNightSkyTex,
    bgColor: 0x1a2130,
    fogColor: 0x1f2736,
    fogDensity: 0.0085,
    hemiSky: 0x5d6f92, hemiGround: 0x15171c, hemiIntensity: 0.72,
    sunColor: 0xb4c6ea, sunIntensity: 1.05, sunVisible: false,
    celestial: true,
    ambientColor: 0x1f2635, ambientIntensity: 0.3,
    hazeColor: 0x52607a, hazeOpacity: 0.35, hazeCoverage: 0.35,
    rainOn: false,
    puddlesOn: false,
  },
  day: {
    skyTex: daySkyTex,
    bgColor: 0xaebccb,
    fogColor: 0xb7c4d1,
    fogDensity: 0.03, // thinner than night — daylight haze, not a wall of fog
    hemiSky: 0xdfe7ee, hemiGround: 0x4a4c46, hemiIntensity: 0.95,
    sunColor: 0xfff6e0, sunIntensity: 2.1, sunVisible: true, // strong, clearly-visible sun
    celestial: false, // overcast day — no stars, no moon
    ambientColor: 0x545c62, ambientIntensity: 0.42,
    hazeColor: 0xe8ecef, hazeOpacity: 0.65, hazeCoverage: 0.6,
    rainOn: true,
    puddlesOn: true,
  },
  // Day for levels that set state.clearDay (Level 2): a dead city's late
  // afternoon — low warm sun through smoke, see CLEAR DAY ATMOSPHERE
  // below. Lit by the sun plus the painted sky itself (environment map);
  // the flat hemisphere/ambient fills are switched off. Distance dust
  // starts far out so nothing near the player looks fogged; the low
  // ground-haze layer, rain and puddles are off.
  clearDay: {
    skyTex: null, // painted on first use: duskSkyTexture()
    bgColor: 0xb59f86,
    fogColor: 0xb8a48a, fogDensity: 0.0035, // ~linear 70..460 m: clear near the player, dust far out
    sunColor: 0xffc58a, sunIntensity: 3.4, sunVisible: true,
    sunDirection: [-0.62, 0.42, -0.66], // low in the west-southwest, slanting down the street
    celestial: false,
    hazeColor: 0xe8ecef, hazeOpacity: 0, hazeCoverage: 0, hazeVisible: false,
    rainOn: false,
    // The puddle shader is unlit (no sun, no shadow), so under a hard
    // low sun it reads as black paint — dry street on the clear day
    puddlesOn: false,
    exposure: 0.95,
    // Graded on the canvas by the compositor, not an extra render pass:
    // drained colour, a warm cast and a touch of contrast, after the key art
    grade: 'saturate(0.78) sepia(0.14) contrast(1.07)',
  },
};

// Day for levels that set state.warmDay (Level 1): Level 2's low-sun
// afternoon — same sky, sun, shadows, fog range and grade — but the drizzle
// stays: rain and puddles on, and the burning wrecks' smoke is Level 1's
// own (no extra distant smoke columns). The ground mist keeps running too,
// just tinted warm so it doesn't read as a cold white sheet under the sun.
TIME_OF_DAY_CONFIG.warmDay = {
  ...TIME_OF_DAY_CONFIG.clearDay,
  hazeColor: 0xd9c4a6, hazeOpacity: 0.4, hazeCoverage: 0.5, hazeVisible: true,
  rainOn: true,
  puddlesOn: true,
  smokeColumns: false,
};

export function applyTimeOfDay(mode) {
  state.timeOfDay = TIME_OF_DAY_CONFIG[mode] ? mode : 'night';
  const warm = state.timeOfDay === 'day' && state.warmDay && !state.clearDay;
  const clear = state.timeOfDay === 'day' && (state.clearDay || state.warmDay);
  effectLightPools.forEach(pool => pool.forEach(light => { light.visible = !clear; }));
  const moonlit = state.timeOfDay === 'night' && state.moonlitNight;
  let cfg = warm ? TIME_OF_DAY_CONFIG.warmDay
    : clear ? TIME_OF_DAY_CONFIG.clearDay
    : moonlit ? TIME_OF_DAY_CONFIG.moonNight
    : TIME_OF_DAY_CONFIG[state.timeOfDay];
  // Level 3's quarantine compound is deliberately darker; keep the change
  // scoped to its night state so the other levels retain their lighting.
  if (state.timeOfDay === 'night' && state.quarantineFacility === true) {
    cfg = { ...cfg, hemiIntensity: cfg.hemiIntensity * 0.82, ambientIntensity: cfg.ambientIntensity * 0.82, fogDensity: cfg.fogDensity * 1.12, hazeOpacity: cfg.hazeOpacity * .7, bgColor: 0x0b1421, fogColor: 0x182535, hazeColor: 0x35475a };
  }
  if (clear && !cfg.skyTex) cfg.skyTex = duskSkyTexture();

  sky.material.map = cfg.skyTex;
  sky.material.color.setHex(state.timeOfDay === 'night' && state.quarantineFacility === true ? 0x8293a8 : 0xffffff);
  sky.material.needsUpdate = true;
  scene.background = new THREE.Color(cfg.bgColor);
  // Always exponential fog: DayCycle.js changes its colour and density
  // every frame, and swapping fog types would recompile every material
  scene.fog.color.setHex(cfg.fogColor);
  scene.fog.density = cfg.fogDensity;

  // Clear days are lit by sun + sky (environment map, set up below); the
  // flat fills would only wash out the shadows, so they're left out of
  // the render entirely (an invisible light isn't uploaded to shaders)
  hemiLight.visible = !clear;
  ambientLight.visible = !clear;
  if (!clear) {
    hemiLight.color.setHex(cfg.hemiSky);
    hemiLight.groundColor.setHex(cfg.hemiGround);
    hemiLight.intensity = cfg.hemiIntensity;
    ambientLight.color.setHex(cfg.ambientColor);
    ambientLight.intensity = cfg.ambientIntensity;
  }
  sun.color.setHex(cfg.sunColor);
  sun.intensity = cfg.sunIntensity;
  // A zero-brightness sun still submits a shadow pass in Three.js.
  // Night keeps the same lighting without that unused pass.
  sun.castShadow = cfg.sunIntensity > 0;
  sunVisual.visible = cfg.sunVisible;
  stars.forEach((s) => { s.visible = cfg.celestial; });
  moonVisual.visible = cfg.celestial;
  ambientLight.color.setHex(cfg.ambientColor);
  ambientLight.intensity = cfg.ambientIntensity;
  if (moonlit) {
    // Moon low over the street's far end, and the moonlight from there
    moonVisual.position.copy(MOON_DIR).multiplyScalar(SUN_DISTANCE);
    moonVisual.scale.set(56, 56, 1);
    sun.position.copy(sun.target.position).addScaledVector(MOON_DIR, 160);
  }
  renderer.toneMappingExposure = cfg.exposure ?? 0.92;
  dom.canvas.style.filter = cfg.grade || '';
  if (clear) setupClearDay(cfg);

  fogUniforms.uColor.value.setHex(cfg.hazeColor);
  fogUniforms.uOpacity.value = cfg.hazeOpacity;
  fogUniforms.uCoverage.value = cfg.hazeCoverage;
  mistEnabled.value = cfg.hazeVisible === false ? 0 : 1;
  // extractLight is built at module load, before the mode is known. Only
  // the depot mission ever turns it up, so with no depot (state.skipDepot,
  // Level 2) it would sit at zero yet still cost every lit pixel a light
  if (sunlightOnly() || state.skipDepot) scene.remove(extractLight);
  else if (!extractLight.parent) scene.add(extractLight);
  rain.visible = cfg.rainOn;
  puddleUniforms.uRipple.value = cfg.puddleRipple ?? 1;

  createPuddles(cfg.puddlesOn);
}

/* ---------------------------------------------------------------------
   CLEAR DAY ATMOSPHERE (Level 2 day) — a dead city's late afternoon,
   after the title-screen key art: a low warm sun through smoke, smoke
   columns over the rooftops. Built only for that mode, and
   cheap by construction:
   - SKY: painted once on a canvas (warm smoky gradient, fBm cloud bank)
     and reused as the scene's environment map via PMREM, so everything
     is lit by the same sky it sits under for one texture lookup per
     pixel — no extra lights.
   - SUN SHADOWS: one 2048 map over ~90 m that follows the camera
     (snapped to whole shadow texels so edges don't shimmer as you move)
     instead of one 1024 map stretched over 240 m: ~4 cm texels, crisp.
   - SMOKE: a few billboard stacks far beyond the street, drifting.
--------------------------------------------------------------------- */
const SUN_SHADOW_HALF = 45;      // metres covered either side of the focus point
const SUN_SHADOW_MAP = 2048;
const SUN_DISTANCE_FROM_FOCUS = 220;
let clearDay = null;             // { sunDir, smoke[], time } once built

function duskSkyTexture() {
  const W = 1024, H = 512;
  const canvas = makeCanvas(W, H, (ctx) => {
    // Gradient: smoky grey-blue overhead, warm dust at the horizon, dark
    // haze below it (only seen past the street end)
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.0, '#5d6268');
    g.addColorStop(0.28, '#857d74');
    g.addColorStop(0.44, '#b49c80');
    g.addColorStop(0.5, '#c8ad8a');
    g.addColorStop(0.56, '#8a7663');
    g.addColorStop(1.0, '#3a3129');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Cloud/smoke bank over the upper half: value-noise fBm that wraps
    // horizontally, so the sphere's seam doesn't show
    const img = ctx.getImageData(0, 0, W, H / 2);
    const rnd = mulberrySky(7);
    const octaves = [];
    for (let o = 0; o < 5; o++) {
      const gw = 6 << o, gh = 3 << o;
      const cells = [];
      for (let i = 0; i < gw * gh; i++) cells.push(rnd());
      octaves.push({ gw, gh, cells });
    }
    const sample = ({ gw, gh, cells }, u, v) => {
      const x = u * gw, y = v * gh;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const at = (cx, cy) => cells[(((cy % gh) + gh) % gh) * gw + (((cx % gw) + gw) % gw)];
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
    for (let y = 0; y < H / 2; y++) {
      const v = y / (H / 2);
      // clouds thicken toward the horizon and thin overhead
      const band = Math.min(1, Math.max(0, (v - 0.15) / 0.75));
      for (let x = 0; x < W; x++) {
        const u = x / W;
        let n = 0, amp = 0.5;
        for (const oct of octaves) { n += sample(oct, u, v * 0.8) * amp; amp *= 0.5; }
        const cover = Math.min(0.85, Math.max(0, n - 0.42) * 2.4 * (0.35 + band * 0.65));
        const i = (y * W + x) * 4;
        // smoke-tinted cloud: brown-grey, lighter where the noise is high
        const shade = 70 + n * 70;
        img.data[i] += (shade + 8 - img.data[i]) * cover;
        img.data[i + 1] += (shade - img.data[i + 1]) * cover;
        img.data[i + 2] += (shade - 10 - img.data[i + 2]) * cover;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function mulberrySky(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function setupClearDay(cfg) {
  if (clearDay) return;
  const sunDir = new THREE.Vector3(...cfg.sunDirection).normalize();
  sunVisual.position.copy(sunDir).multiplyScalar(SUN_DISTANCE);
  // smaller and dimmer than the overcast day's sun: a hazy disc behind smoke
  sunVisual.scale.set(42, 42, 1);
  sunVisual.material.color.setHex(0xffd2a0);
  sunVisual.material.opacity = 0.75;

  sun.shadow.mapSize.set(SUN_SHADOW_MAP, SUN_SHADOW_MAP);
  const cam = sun.shadow.camera;
  cam.left = -SUN_SHADOW_HALF; cam.right = SUN_SHADOW_HALF;
  cam.top = SUN_SHADOW_HALF; cam.bottom = -SUN_SHADOW_HALF;
  cam.near = 1; cam.far = SUN_DISTANCE_FROM_FOCUS + 160;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;

  // Environment: the painted sky, prefiltered for every roughness level
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(sky.geometry, new THREE.MeshBasicMaterial({ map: cfg.skyTex, side: THREE.BackSide })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.04, 1, 1000).texture; // far must reach the 420 m sky
  pmrem.dispose();

  clearDay = { sunDir, smoke: cfg.smokeColumns === false ? [] : makeSmokeColumns(), time: 0 };
}

// Smoke columns rising beyond the rooftops — soft billboards stacked and
// widening with height, each slowly drifting downwind.
function makeSmokeColumns() {
  const tex = new THREE.CanvasTexture(makeCanvas(128, 128, (ctx, w, h) => {
    for (let i = 0; i < 14; i++) {
      const x = w * (0.3 + Math.random() * 0.4), y = h * (0.3 + Math.random() * 0.4), r = w * (0.18 + Math.random() * 0.2);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.32)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
  }));
  const columns = [];
  [[-75, -150, 1.0], [85, -70, 0.8], [30, -300, 1.3]].forEach(([x, z, s]) => {
    const puffs = [];
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x3a342e, transparent: true, depthWrite: false }));
      m.material.rotation = Math.random() * Math.PI * 2;
      scene.add(m);
      puffs.push({ m, h: i / 12 });
    }
    columns.push({ x, z, s, puffs });
  });
  return columns;
}

function updateClearDay(dt) {
  if (!clearDay) return;
  // Shadow frustum follows a point ahead of the camera, snapped to the
  // shadow map's texel grid in light space so edges stay put while moving
  const focus = _sunFocus.copy(camera.position);
  camera.getWorldDirection(_sunTmp);
  focus.addScaledVector(_sunTmp.setY(0).normalize(), SUN_SHADOW_HALF * 0.45);
  focus.y = 0;
  const texel = (SUN_SHADOW_HALF * 2) / SUN_SHADOW_MAP;
  _sunBasisZ.copy(clearDay.sunDir).negate();
  _sunBasisX.crossVectors(_up, _sunBasisZ).normalize();
  _sunBasisY.crossVectors(_sunBasisZ, _sunBasisX);
  const lx = Math.round(focus.dot(_sunBasisX) / texel) * texel;
  const ly = Math.round(focus.dot(_sunBasisY) / texel) * texel;
  const lz = focus.dot(_sunBasisZ);
  focus.copy(_sunBasisX).multiplyScalar(lx).addScaledVector(_sunBasisY, ly).addScaledVector(_sunBasisZ, lz);
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(clearDay.sunDir, SUN_DISTANCE_FROM_FOCUS);
  sun.target.updateMatrixWorld();

  clearDay.time += dt;
  const t = clearDay.time;
  for (const col of clearDay.smoke) {
    for (const p of col.puffs) {
      p.h = (p.h + dt * 0.012) % 1;
      const k = p.h;
      p.m.position.set(col.x + k * k * 28 * col.s + Math.sin(t * 0.2 + k * 6) * 2, 8 + k * 95 * col.s, col.z + k * 10);
      const size = (12 + k * 46) * col.s;
      p.m.scale.set(size, size, 1);
      p.m.material.opacity = Math.min(1, k * 8) * (1 - k) * 0.9;
      p.m.material.rotation += dt * 0.02;
    }
  }
}
/* Handles for DayCycle.js, which moves the time of day every frame. The sun
   direction goes through here so the clear-day shadow frustum, which
   follows the camera, keeps tracking it. */
export const lighting = { sun, hemiLight, ambientLight, sunVisual, moonVisual };
export function setSunDirection(dir) {
  sunVisual.position.copy(dir).multiplyScalar(SUN_DISTANCE);
  if (clearDay) { clearDay.sunDir.copy(dir); return; }
  sun.position.copy(sun.target.position).addScaledVector(dir, 200);
}
const _sunFocus = new THREE.Vector3(), _sunTmp = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _sunBasisX = new THREE.Vector3(), _sunBasisY = new THREE.Vector3(), _sunBasisZ = new THREE.Vector3();

/* ---------------------------------------------------------------------
   FOG — low mist is integrated along the view ray inside material fog.
   Opaque surfaces and animated characters keep their normal depth tests.
   There is no flat fog surface to intersect the player at waist height.
--------------------------------------------------------------------- */
// Compatibility anchor only: low mist is now integrated into surface fog.
// It no longer draws a horizontal plane through characters.
export const fog = new THREE.Object3D();

/* ---------------------------------------------------------------------
   RAIN — a flat card parented to the camera so it always fills the
   view. depthTest is off on its material (see shaders.js) so it draws
   as a screen-space overlay regardless of what's in front of it in the
   scene. Hidden by default; applyTimeOfDay() turns it on for Day mode.
--------------------------------------------------------------------- */
export const rain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), createRainMaterial());
rain.position.set(0, 0, -RAIN_DISTANCE);
rain.renderOrder = 999;
rain.visible = false;
camera.add(rain);
onResize(); // now that `rain` exists, size it correctly for the current viewport

/* ---------------------------------------------------------------------
   PUDDLES — Day mode only (they're there because of the drizzle).
   Plain flat discs with a low-roughness, faintly reflective material;
   there's no environment map in this scene so they won't mirror the
   buildings, but the sun/hemisphere light still catches them with a
   soft sheen, which is enough to read as "wet" at this game's scale.
   Scattered with Math.random() rather than the deterministic mulberry32
   RNG characters.js uses for world geometry — puddles are just weather
   dressing, not gameplay-relevant placement, so nothing needs them to
   be reproducible run-to-run.
--------------------------------------------------------------------- */
const puddleGroup = new THREE.Group();
scene.add(puddleGroup);
const puddleMaterial = createPuddleMaterial();
const PUDDLE_COUNT = 22;
let puddleInstances = null;
// Sort before WebGLObjects uploads instance matrices for this frame.
const renderWithPuddles = renderer.render;
renderer.render = function(renderScene, renderCamera) {
  if (renderScene === scene && puddleGroup.visible) puddleInstances?.sort(renderCamera);
  return renderWithPuddles.call(this, renderScene, renderCamera);
};
export function createPuddles(enabled) {
  puddleGroup.visible = enabled;
  if (!enabled) return;
  if (!puddleInstances) {
    puddleInstances = createPuddleInstances(puddleMaterial, PUDDLE_COUNT, STREET_HALF_W, STREET_LENGTH);
    puddleGroup.add(puddleInstances.mesh);
  }
  puddleInstances.scatter();
}

/* ---------------------------------------------------------------------
   Per-frame weather tick — called from Actions.js's animate() loop
   alongside the existing `sky.position.copy(camera.position)` line.
--------------------------------------------------------------------- */
export function updateWeatherFX(dt) {
  fogUniforms.uTime.value += dt;
  fog.position.x = camera.position.x;
  fog.position.z = camera.position.z;
  if (rain.visible) rainUniforms.uTime.value += dt;
  puddleUniforms.uTime.value += dt;
  fireUniforms.uTime.value += dt;
  toxicUniforms.uTime.value += dt;
  updateClearDay(dt);
}

/* ---------------------------------------------------------------------
   2. PHYSICS WORLD
--------------------------------------------------------------------- */
export const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 16;
world.defaultContactMaterial.friction = 0.45;
export const matGround = new CANNON.Material('ground');
export const matWheel = new CANNON.Material('wheel');
export const matPlayer = new CANNON.Material('player');
export const matChassis = new CANNON.Material('chassis');
world.addContactMaterial(new CANNON.ContactMaterial(matGround, matWheel, {
  friction: 1.4, restitution: 0, contactEquationStiffness: 1e4,
}));
world.addContactMaterial(new CANNON.ContactMaterial(matGround, matPlayer, {
  friction: 0.02, restitution: 0,
}));
world.addContactMaterial(new CANNON.ContactMaterial(matGround, matChassis, {
  friction: 0.1, restitution: 0.1, contactEquationStiffness: 1e4,
}));
const groundBody = new CANNON.Body({ mass: 0, material: matGround });
groundBody.addShape(new CANNON.Plane());
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

export function addStaticBox(hx, hy, hz, x, y, z, ry = 0) {
  const body = new CANNON.Body({ mass: 0, material: matGround });
  body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
  body.position.set(x, y, z);
  body.quaternion.setFromEuler(0, ry, 0);
  world.addBody(body);
  addObstacle(x, z, Math.max(hx, hz) + 0.4);
  return body;
}

export const WORLD_BOUND_X = 78;

/* ---------------------------------------------------------------------
   MISSION / LEVEL CONSTANTS — shared by every level
--------------------------------------------------------------------- */
export const STREET_LENGTH = 220;
export const STREET_HALF_W = 10;
export const KILL_TARGET = 10;
export const ZOMBIE_MAX_ALIVE = 14;
export const ZOMBIE_SPAWN_INTERVAL = 2.5;
export const DEPOT_POS = new THREE.Vector3(46, 0, -118);
export const WEST_POCKET_Z = -55;
export const rowX = STREET_HALF_W + 6.4;

export function loadWorldBounds() {
  addStaticBox(2, 10, STREET_LENGTH / 2 + 10, -WORLD_BOUND_X, 10, -STREET_LENGTH / 2 + 20);
  addStaticBox(2, 10, STREET_LENGTH / 2 + 10, WORLD_BOUND_X, 10, -STREET_LENGTH / 2 + 20);
  addStaticBox(WORLD_BOUND_X, 10, 2, 0, 10, 40);
  addStaticBox(WORLD_BOUND_X, 10, 2, 0, 10, -STREET_LENGTH + 10);
}

/* ---------------------------------------------------------------------
   EXTRACTION POINT — self-contained (only needs scene + STREET_LENGTH)
--------------------------------------------------------------------- */
export const extractPos = new THREE.Vector3(0, 0, -STREET_LENGTH + 24);
export const extractRing = new THREE.Mesh(
  new THREE.RingGeometry(2.2, 2.65, 40),
  // depthWrite off + a negative polygonOffset keeps this flat ring from
  // z-fighting the lane markings it overlaps (reported shimmering at
  // the extraction point, visible from hundreds of metres away).
  new THREE.MeshBasicMaterial({
    color: 0x33ff77, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  })
);
extractRing.rotation.x = -Math.PI / 2;
extractRing.position.copy(extractPos).setY(0.1);
extractRing.renderOrder = 3;
extractRing.visible = false;
scene.add(extractRing);
export const extractLight = new THREE.PointLight(0x33ff77, 0, 16, 2);
extractLight.position.copy(extractPos).setY(2);
scene.add(extractLight);

export function updateExtractRing(dt) {
  extractRing.rotation.z += dt * 0.4;
}

export function checkExtraction(pos, onWin) {
  if (!state.ingredientCollected) return;
  if (pos.distanceTo(extractPos) < 3.2) onWin();
}

/* ---------------------------------------------------------------------
   MISSION TRACKER — depot pickup / stage progression.
   Factored as a small factory instead of a top-level function because
   the depot yard object (marker/beam/crate meshes) is built inside
   characters.js's loadBuildings() and returned to the caller — Scene.js
   can't import characters.js (see header note), so the level file hands
   the depotYard reference in here once, after loadBuildings() resolves.
--------------------------------------------------------------------- */
export function createMissionTracker(depotYard) {
  function collectIngredient() {
    if (state.ingredientCollected) return;
    state.ingredientCollected = true;
    state.stage = 3;
    scene.remove(depotYard.crate);
    depotYard.marker.visible = false;
    depotYard.markerLight.intensity = 0;
    depotYard.beam.visible = false;
    depotYard.beamLight.intensity = 0;
    extractRing.visible = true;
    extractLight.intensity = 2.2;
    pushKillFeed('Culture sample secured');
    sfx.pickup();
    updateObjectiveHUD();
  }
  function checkDepotObjective(pos) {
    if (state.ingredientCollected) return;
    if (pos.distanceTo(DEPOT_POS) < 3) collectIngredient();
  }
  // Restart: the sample back in the depot, extraction dark again
  function reset() {
    scene.add(depotYard.crate);
    depotYard.marker.visible = true;
    depotYard.markerLight.intensity = 2.4;
    depotYard.beam.visible = true;
    extractRing.visible = false;
    extractLight.intensity = 0;
  }
  return { collectIngredient, checkDepotObjective, reset };
}

/* ---------------------------------------------------------------------
   SMALL SHARED MATH HELPERS
--------------------------------------------------------------------- */
export function forwardFromYaw(yawAngle) {
  return new THREE.Vector3(-Math.sin(yawAngle), 0, -Math.cos(yawAngle));
}
export function rightFromYaw(yawAngle) {
  return new THREE.Vector3(Math.cos(yawAngle), 0, -Math.sin(yawAngle));
}

/* ---------------------------------------------------------------------
   LOADING SCREEN
--------------------------------------------------------------------- */
export function setLoadUI() {
  const n = (state.loadFlags.player ? 1 : 0) + (state.loadFlags.zombie ? 1 : 0) + (state.loadFlags.car ? 1 : 0);
  if (dom.loadFill) dom.loadFill.style.width = `${20 + n * 26}%`;
  if (dom.loadStatus) dom.loadStatus.textContent = `MODELS ${n}/3`;
}
// The intro screen (title/controls/"Enter The City") and the level-select
// screen now both run BEFORE this point (wired in main.js), so by the
// time assets finish loading there's nothing left to gate behind another
// click — reveal the HUD directly. Scene.js still can't import
// characters.js (see the header comment above), so any level-specific
// setup that needs to happen exactly once assets are ready (spawning the
// depot guards, requesting pointer lock, etc.) is registered from
// Actions.js via onAssetsReady() instead of hardcoded here.
let readyCallback = null;
let readyInFlight = false;
export function onAssetsReady(cb) { readyCallback = cb; }
export function maybeReady() {
  // A module or level boot can fail after Scene.js loads. The model
  // timeout must never turn that failed launch into an empty game HUD.
  if (state.loadFailed || !readyCallback || readyInFlight || state.readyShown) return;
  setLoadUI();
  if (state.loadFlags.player && state.loadFlags.zombie) {
    readyInFlight = true;
    if (dom.loadStatus) dom.loadStatus.textContent = 'PREPARING THE SCENE…';
    if (dom.loadFill) dom.loadFill.style.width = '95%';
    Promise.resolve().then(() => readyCallback()).then(() => {
      if (state.loadFailed) return;
      requestAnimationFrame(() => {
        if (state.loadFailed) return;
        state.readyShown = true;
        if (dom.loadFill) dom.loadFill.style.width = '100%';
        dom.loading.classList.add('hidden');
        dom.hud.classList.remove('hidden');
        document.body.classList.add('in-level');
      });
    }).catch(showRenderFailure);
  }
}
export function showRenderFailure(error) {
  state.loadFailed = true;
  state.paused = true;
  console.error('[game] The scene could not render:', error);
  dom.hud.classList.add('hidden');
  dom.loading.classList.remove('hidden');
  if (dom.loadStatus) dom.loadStatus.textContent = 'The scene could not start. Reload to try again.';
  if (!document.getElementById('render-retry')) {
    const button = document.createElement('button');
    button.id = 'render-retry';
    button.type = 'button';
    button.textContent = 'Reload game';
    button.addEventListener('click', () => location.reload());
    dom.loading.appendChild(button);
  }
}
dom.canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  showRenderFailure(new Error('The graphics context was lost'));
});
export function markLoaded(which) {
  state.loadFlags[which] = true;
  maybeReady();
}
setTimeout(() => {
  state.loadFlags.player = true; state.loadFlags.zombie = true;
  maybeReady();
}, 12000);

/* ---------------------------------------------------------------------
   DYNAMIC HUD ELEMENTS — coins, fuel, weapon and shield readouts didn't
   exist in the original page markup, so they're created here at
   runtime instead of requiring an HTML edit.
--------------------------------------------------------------------- */
export function makeHudEl(id, styles) {
  let el = document.getElementById(id);
  if (el) return el;
  el = document.createElement('div');
  el.id = id;
  Object.assign(el.style, {
    position: 'fixed',
    fontFamily: 'inherit, sans-serif',
    color: '#fff',
    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
    zIndex: 20,
    pointerEvents: 'none',
    userSelect: 'none',
  }, styles);
  document.body.appendChild(el);
  return el;
}
dom.coinLabel = makeHudEl('coin-label', {
  top: '14px', left: '50%', transform: 'translateX(-50%)',
  fontSize: '20px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px',
});
dom.fuelWrap = makeHudEl('fuel-wrap', {
  bottom: '86px', right: '18px', width: '150px',
});
dom.fuelWrap.innerHTML = `
  <div style="font-size:12px;letter-spacing:1px;margin-bottom:3px;">FUEL</div>
  <div style="width:100%;height:10px;border:1px solid rgba(255,255,255,0.5);border-radius:4px;overflow:hidden;background:rgba(0,0,0,0.35);">
    <div id="fuel-fill" style="height:100%;width:100%;background:linear-gradient(90deg,#ff8a1a,#ffd27a);"></div>
  </div>`;
dom.fuelFill = document.getElementById('fuel-fill');
// Level 2 (The Chase) has no vehicle — hide the fuel HUD entirely.
// state.skipCar is set by Level2Config.js, which is imported before this
// module when Level 2 loads (import order in Level2.js guarantees it).
if (state.skipCar) dom.fuelWrap.style.display = 'none';
dom.weaponLabel = makeHudEl('weapon-label', {
  bottom: '18px', left: '50%', transform: 'translateX(-50%)',
  fontSize: '15px', letterSpacing: '2px', fontWeight: 'bold',
});
dom.shieldLabel = makeHudEl('shield-label', {
  top: '46px', left: '50%', transform: 'translateX(-50%)',
  fontSize: '14px', color: '#37c8ff', display: 'none',
});

export function updateCoinHUD() {
  dom.coinLabel.innerHTML = `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#ffd94a;box-shadow:0 0 4px #ffb400;"></span>${state.coins}`;
}
// maxFuel is passed in (rather than imported) because the fuel cap
// (CAR_MAX_FUEL) is defined in characters.js alongside the vehicle, and
// Scene.js cannot import characters.js — see the header note.
export function updateFuelHUD(maxFuel) {
  if (dom.fuelFill) dom.fuelFill.style.width = `${Math.max(0, (state.carFuel / maxFuel) * 100)}%`;
}
export function updateShieldHUD() {
  if (!dom.shieldLabel) return;
  if (state.shieldActive) {
    dom.shieldLabel.style.display = 'block';
    dom.shieldLabel.textContent = `SHIELD ${state.shieldTimer.toFixed(1)}s`;
  } else {
    dom.shieldLabel.style.display = 'none';
  }
}
export function updateWeaponHUD() {
  if (!dom.weaponLabel) return;
  const extra=levelWeapon(state.currentWeapon);
  dom.weaponLabel.textContent = extra?.label?.toUpperCase() || (state.currentWeapon === 'gun' ? 'PISTOL' : 'KNIFE');
  dom.weaponLabel.style.color = extra?.color || (state.currentWeapon === 'gun' ? '#fff4c2' : '#ffd8a8');
  const name=document.getElementById('weapon-name');if(name)name.textContent=extra?.label || (state.currentWeapon==='gun'?'9mm Sidearm':'Combat knife');
}
export function updateAmmoHUD() {
  const extra=levelWeapon(state.currentWeapon);
  if(extra){dom.ammo.innerHTML=`<span>${extra.charges()}</span><small> / ${extra.capacity}</small>`;return;}
  if(state.currentWeapon==='knife'){dom.ammo.textContent='MELEE';return;}
  const low = state.ammoMag <= 3 ? ' id="low-ammo"' : '';
  dom.ammo.innerHTML = `<span${low}>${state.ammoMag}</span><small> / ${state.ammoReserve}</small>`;
}
export function updateObjectiveHUD() {
  dom.killcount.textContent = state.kills;
  if (state.kills >= KILL_TARGET && state.stage === 1) state.stage = 2;
  if (state.stage === 1) {
    dom.objective.innerHTML = `Objective: <b>Fight through to the depot</b> — neutralize <span id="obj-count">${Math.min(state.kills, KILL_TARGET)}/${KILL_TARGET}</span> infected. <i>(Look east for an amber glow above the rooftops — that's the depot, off the main road. A supply cache is hidden west too.)</i>`;
  } else if (state.stage === 2) {
    dom.objective.innerHTML = `Objective: <b>Recover the culture sample</b> — follow the amber marker east into the depot yard.`;
  } else {
    dom.objective.innerHTML = `Objective: <b>Get the sample to extraction</b> — head to the green marker.`;
  }
}
export function updateCompass(pos, forward) {
  // A level module can retarget the compass by setting state.compassOverride
  // (Level 2: points at the port until the radar is bought, then the girl).
  // Levels 1/3 never set it, so they keep the depot/extraction behavior.
  const target = state.compassOverride ? state.compassOverride.pos
    : state.ingredientCollected ? extractPos : DEPOT_POS;
  const label = state.compassOverride ? state.compassOverride.label
    : state.ingredientCollected ? 'EXTRACTION' : 'DEPOT';
  dom.compass.classList.remove('hidden');
  const dx = target.x - pos.x, dz = target.z - pos.z;
  const dist = Math.hypot(dx, dz);
  const tx = dx / (dist || 1), tz = dz / (dist || 1);
  const cross = forward.x * tz - forward.z * tx;
  const dot = forward.x * tx + forward.z * tz;
  const angle = Math.atan2(cross, dot);
  dom.compassArrow.style.transform = `rotate(${(-angle * 180) / Math.PI}deg)`;
  dom.compassLabel.textContent = `${label} — ${Math.round(dist)}m`;
}
export function pushKillFeed(text) {
  const el = document.createElement('div');
  el.className = 'kf-item';
  el.textContent = text;
  dom.killfeed.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
export function flashDamage() {
  dom.flash.style.background = 'rgba(200,0,0,0.32)';
  setTimeout(() => { dom.flash.style.background = 'rgba(200,0,0,0)'; }, 140);
}
export function doDeath() {
  state.isDead = true;
  sfx.setEngine(0, false);
  document.exitPointerLock();
  state.killStreak = 0;
  // Say what happened: overrun, how far the infection got, how long they lasted
  const title = dom.death.querySelector('.end-title');
  if (title) title.textContent = 'OVERRUN';
  const secs = Math.round(state.runTime || 0);
  dom.deathStats.innerHTML = `Bitten past saving: the infection hit ${state.deathInfection ?? '99.99%'} and the horde dragged you down.`
    + `<br>Infected eliminated: ${state.kills} · Coins: ${state.coins} · Survived ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  dom.death.classList.remove('hidden');
  finishRun('loss', dom.death);
}
export function doWin() {
  state.isDead = true;
  sfx.setEngine(0, false);
  document.exitPointerLock();
  dom.winStats.textContent = `Infected eliminated: ${state.kills} · Coins: ${state.coins} · Extraction successful.`;
  dom.win.classList.remove('hidden');
  finishRun('win', dom.win);
}

/* ---------------------------------------------------------------------
   RADAR
--------------------------------------------------------------------- */
const radarCtx = dom.radar.getContext('2d');
const RADAR_RANGE = 42;
export function drawRadar(selfPos, selfYaw) {
  const w = dom.radar.width, h = dom.radar.height, cx = w / 2, cy = h / 2;
  radarCtx.clearRect(0, 0, w, h);
  // Level 2 (compassOverride set) paints the radar in the port's teal with
  // a second range ring; Levels 1/3 keep the stock green-on-black look.
  const lv2 = !!state.compassOverride;
  radarCtx.fillStyle = lv2 ? 'rgba(6,18,16,0.62)' : 'rgba(20,28,18,0.55)';
  radarCtx.beginPath(); radarCtx.arc(cx, cy, w / 2, 0, Math.PI * 2); radarCtx.fill();
  radarCtx.strokeStyle = lv2 ? 'rgba(42,255,213,0.3)' : 'rgba(80,120,70,0.35)';
  radarCtx.beginPath(); radarCtx.arc(cx, cy, w * 0.25, 0, Math.PI * 2); radarCtx.stroke();
  if (lv2) {
    radarCtx.beginPath(); radarCtx.arc(cx, cy, w * 0.375, 0, Math.PI * 2); radarCtx.stroke();
  }
  radarCtx.save();
  radarCtx.translate(cx, cy);
  radarCtx.rotate(-selfYaw);
  state.zombies.forEach((z) => {
    if (!z.alive) return;
    const rx = (z.mesh.position.x - selfPos.x);
    const rz = (z.mesh.position.z - selfPos.z);
    const d = Math.sqrt(rx * rx + rz * rz);
    if (d > RADAR_RANGE) return;
    const px = (rx / RADAR_RANGE) * (w / 2);
    const py = (rz / RADAR_RANGE) * (h / 2);
    radarCtx.fillStyle = '#ff3b3b';
    radarCtx.beginPath(); radarCtx.arc(px, py, 3.5, 0, Math.PI * 2); radarCtx.fill();
  });
  if (extractRing.visible) {
    const rx = extractPos.x - selfPos.x, rz = extractPos.z - selfPos.z;
    if (Math.hypot(rx, rz) < RADAR_RANGE * 1.4) {
      const px = (rx / RADAR_RANGE) * (w / 2), py = (rz / RADAR_RANGE) * (h / 2);
      radarCtx.fillStyle = '#33ff77';
      radarCtx.beginPath(); radarCtx.arc(px, py, 4, 0, Math.PI * 2); radarCtx.fill();
    }
  }
  // compassOverride guard: Level 2 never draws the stock depot marker —
  // its own target blip below replaces it (and the depot lot is skipped).
  if (state.stage === 2 && !state.ingredientCollected && !state.compassOverride) {
    const rx = DEPOT_POS.x - selfPos.x, rz = DEPOT_POS.z - selfPos.z;
    const d = Math.hypot(rx, rz);
    const clampedD = Math.min(d, RADAR_RANGE * 0.9);
    const scale = clampedD / (d || 1);
    const px = (rx * scale / RADAR_RANGE) * (w / 2), py = (rz * scale / RADAR_RANGE) * (h / 2);
    radarCtx.fillStyle = '#ffaa22';
    radarCtx.beginPath(); radarCtx.arc(px, py, 4, 0, Math.PI * 2); radarCtx.fill();
  }
  // Level 2 target marker — state.compassOverride is this level's live
  // objective (PORT until the radar upgrade is bought, then the GIRL —
  // girl intel stays a machine product per the locked design). Rim-
  // clamped like the depot marker so the target's direction always reads
  // even beyond radar range, with a halo ring so it reads as the radar's
  // primary blip. Levels 1/3 never set compassOverride.
  if (state.compassOverride && state.compassOverride.pos) {
    const t = state.compassOverride.pos;
    const rx = t.x - selfPos.x, rz = t.z - selfPos.z;
    const d = Math.hypot(rx, rz);
    const clampedD = Math.min(d, RADAR_RANGE * 0.9);
    const scale = clampedD / (d || 1);
    const px = (rx * scale / RADAR_RANGE) * (w / 2), py = (rz * scale / RADAR_RANGE) * (h / 2);
    radarCtx.fillStyle = '#2affd5';
    radarCtx.beginPath();
    radarCtx.arc(px, py, 4.5, 0, Math.PI * 2);
    radarCtx.fill();
    radarCtx.strokeStyle = 'rgba(42,255,213,0.55)';
    radarCtx.lineWidth = 1;
    radarCtx.beginPath();
    radarCtx.arc(px, py, 6.5, 0, Math.PI * 2);
    radarCtx.stroke();
  }
  radarCtx.restore();
  radarCtx.fillStyle = '#fff';
  radarCtx.beginPath();
  radarCtx.moveTo(cx, cy - 6); radarCtx.lineTo(cx - 5, cy + 5); radarCtx.lineTo(cx + 5, cy + 5);
  radarCtx.closePath(); radarCtx.fill();
}
