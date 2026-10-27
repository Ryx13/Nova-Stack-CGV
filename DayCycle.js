/* ======================================================================
   DayCycle.js — TIME MOVES ACROSS THE CAMPAIGN

   One clock runs through all three levels: campaign time c goes 0..3, and
   Level N covers N-1..N, so each level starts exactly where the last one
   ended. The player picks Day or Night once; the choice carries into the
   next level (account.js playNextLevel) and picks the timeline:

     Day    L1 dawn -> sun about to rise · L2 sunrise -> sun up ·
            L3 clouds building -> thick sea fog and drizzle
     Night  L1 streetlit night · L2 dead grid, moon over
            the port · L3 sea fog before dawn -> the sun breaks through
            as the cure broadcasts

   Time follows the mission, not the wall clock: each level registers a
   progress function (0..1, from its own objectives), so the sunrise lands
   at the same beat however fast you play. Progress only moves forward and
   eases, so a switch flipping turns the weather over a few seconds; a
   restart rewinds it.

   Only values change from frame to frame: colours, intensities, fog
   density, the sun's direction. Anything that would recompile shaders
   (fog type, lights or shadows switching on or off) is decided once at
   boot in startDayCycle().
====================================================================== */
import * as THREE from 'three';
import { scene, renderer, sky, stars, rain, lighting, setSunDirection } from './Scene.js';
import { state } from './state.js';
import { rainUniforms, fogUniforms } from './shaders.js';
import { mistEnabled } from './HeightMist.js';

/* --- The two timelines --------------------------------------------------
   Sky colours are as displayed (sRGB): top = zenith, hor = horizon, bot =
   below the horizon (seen past the street ends), glow/gs = the sun's glow
   in the sky. el/az: sun (or moon) elevation and bearing in degrees, az
   measured from the street's forward (-z) toward +x (east). A keyframe
   lists only what changes; the rest carries over from the one before. */
const DAY = [
  { c: 0, top: 0x1d2740, hor: 0x6e5866, bot: 0x2a2630, glow: 0xe07a50, gs: 0.35,
    fog: 0x3a3d48, fogD: 0.011, sunCol: 0xff9a6a, sun: 0, el: -8, az: 75, disc: 0,
    hemiSky: 0x7a88a6, hemiGnd: 0x2a2826, hemi: 1.1, ambCol: 0x48505e, amb: 0.55, exp: 1.05,
    mist: 0x6a7080, mistA: 0.45, rain: 0, stars: 0.45, moon: 0 },
  // Level 1, nearing extraction: first light, the sun just below the rooftops
  { c: 0.8, top: 0x3e5478, hor: 0xe8a070, bot: 0x3a3436, glow: 0xffa060, gs: 0.75,
    fog: 0x7a6c6a, fogD: 0.008, sunCol: 0xff8a50, sun: 0.35, el: -1,
    hemiSky: 0x9aa4bc, hemiGnd: 0x3a3430, hemi: 1.0, ambCol: 0x5a5a62, amb: 0.5, mist: 0x9a8c88, mistA: 0.4, stars: 0.05 },
  // Level 1 ends / Level 2 begins: sunrise
  { c: 1, top: 0x6584ab, hor: 0xf6c08c, bot: 0x5a4c44, glow: 0xffb878, gs: 0.95,
    fog: 0xc2a088, fogD: 0.0055, sunCol: 0xffb070, sun: 1.8, el: 3, disc: 0.9,
    hemiSky: 0xc8b8a8, hemiGnd: 0x3a3028, hemi: 0.3, ambCol: 0x5a5048, amb: 0.18, exp: 0.82,
    mist: 0xd9c4a6, mistA: 0.3, stars: 0 },
  // Level 2, a little way into the chase: the sun clears the rooftops, so the
  // street is no longer one long shadow and buildings cast crisp ones
  { c: 1.15, sun: 2.6, el: 12, az: 85, hemi: 0.16, amb: 0.08 },
  // Level 2 ends / Level 3 begins: the sun up but still low and golden.
  // Level 2 is lit by its own sky as well, so the fills stay low and the
  // sky warm, or the whole street washes out white.
  { c: 2, top: 0x6a8cb4, hor: 0xf0cfa2, bot: 0x7a6656, glow: 0xffc890, gs: 0.7,
    fog: 0xcfb494, fogD: 0.0035, sunCol: 0xffc488, sun: 2.6, el: 24, az: 95, disc: 0.85,
    hemiSky: 0xd8c4ac, hemiGnd: 0x40362c, hemi: 0.16, ambCol: 0x5a5048, amb: 0.08, exp: 0.78,
    mist: 0xe0caa8, mistA: 0 },
  // Level 3, the first switch or so: cloud coming in off the sea
  { c: 2.35, top: 0x8e9cab, hor: 0xc4ccd2, bot: 0x7a7e80, glow: 0xf4f2ec, gs: 0.2,
    fog: 0xaab3ba, fogD: 0.008, sunCol: 0xf4f0e6, sun: 1.5, el: 36, az: 115, disc: 0.3,
    hemiSky: 0xd0d8de, hemi: 0.75, amb: 0.35, mist: 0xc8d0d6, mistA: 0.35 },
  // Level 3 ends: thick sea fog and drizzle
  { c: 3, top: 0xa4acb2, hor: 0xb4bbbf, bot: 0x9a9fa2, glow: 0xe8eaea, gs: 0.05,
    fog: 0x9aa2a8, fogD: 0.03, sunCol: 0xe6e8ea, sun: 0.45, el: 40, az: 130, disc: 0,
    hemiSky: 0xdfe7ee, hemi: 1.1, amb: 0.5, exp: 1.0, mist: 0xe8ecef, mistA: 0.65, rain: 0.8 },
];
const NIGHT = [
  // Night means night: no sun or moonlight on the scene until the finale's
  // sunrise. The moon and stars are in the sky; the streetlights light the
  // street, and a faint blue fill keeps silhouettes readable.
  // Level 1: the streetlit night, the city glow amber at the horizon
  { c: 0, top: 0x514f5a, hor: 0x9d8270, bot: 0xe3c29a, glow: 0x9fb4d8, gs: 0,
    fog: 0x4a4440, fogD: 0.009, sunCol: 0xb4c6ea, sun: 0, el: 24, az: 15, disc: 0,
    hemiSky: 0x6a7a96, hemiGnd: 0x1c1a18, hemi: 0.35, ambCol: 0x3a4250, amb: 0.22, exp: 1.0,
    mist: 0x8a909a, mistA: 0.45, rain: 0, stars: 0.85, moon: 0.9 },
  { c: 1 },
  // Level 2, leaving downtown: the grid is dead, a cool moonlit night
  { c: 1.25, top: 0x2a354b, hor: 0x4b5a71, bot: 0x6a7992, glow: 0x9fb4d8, gs: 0.12,
    fog: 0x1f2736, fogD: 0.0085, hemiSky: 0x5d6f92, hemiGnd: 0x15171c, hemi: 0.32,
    ambCol: 0x1f2635, amb: 0.2, mist: 0x52607a, mistA: 0.35, stars: 1, moon: 0.95 },
  { c: 2 },
  // Level 3: sea fog before dawn, thickening as you work through the switches
  { c: 2.45, top: 0x1e2636, hor: 0x34415a, bot: 0x3e4b5e, glow: 0x9fb4d8, gs: 0.06,
    fog: 0x182535, fogD: 0.012, hemi: 0.4, amb: 0.25, mist: 0x35475a, mistA: 0.45, stars: 0.3, moon: 0.4 },
  { c: 2.85, top: 0x3a4452, hor: 0x4c5664, bot: 0x4a5260, glow: 0xc08a6a, gs: 0.12,
    fog: 0x2c3644, fogD: 0.022, mist: 0x4a586a, mistA: 0.6, rain: 0.25, stars: 0, moon: 0 },
  { c: 2.88, sunCol: 0xffb070, el: -3, az: 75 },
  // Level 3 ends: the cure broadcasts and the sun breaks through
  { c: 3, top: 0x5a6f92, hor: 0xf4b07a, bot: 0x7a6050, glow: 0xffb070, gs: 0.95,
    fog: 0xb48c74, fogD: 0.008, sun: 2, el: 4, disc: 0.9, hemiSky: 0xc8b8a8, hemiGnd: 0x3a3028,
    hemi: 0.9, ambCol: 0x5a5048, amb: 0.45, exp: 1.0, mist: 0xd9b8a0, mistA: 0.3, rain: 0 },
];
const COLOURS = ['top', 'hor', 'bot', 'glow', 'fog', 'sunCol', 'hemiSky', 'hemiGnd', 'ambCol', 'mist'];
// Overall brightness, on top of the timelines: EXPOSURE lifts the whole
// picture, sky included; FILL lifts the shade (hemisphere + ambient light)
const EXPOSURE = 1.25;
const FILL = 1.6;

// Fill in what each keyframe carries over, and turn hex into Colors
function resolve(frames) {
  let prev = {};
  return frames.map((f) => {
    const full = { ...prev, ...f };
    prev = full;
    const out = { ...full };
    for (const k of COLOURS) out[k] = new THREE.Color(full[k]);
    return out;
  });
}
const TIMELINES = { day: resolve(DAY), night: resolve(NIGHT) };

// Values at campaign time c, written into `out` (reused every frame)
const out = {};
for (const k of COLOURS) out[k] = new THREE.Color();
function sample(frames, c) {
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].c <= c) i++;
  const a = frames[i], b = frames[i + 1];
  const t = THREE.MathUtils.clamp((c - a.c) / Math.max(b.c - a.c, 1e-6), 0, 1);
  for (const k in a) {
    if (k === 'c') continue;
    if (a[k] instanceof THREE.Color) out[k].copy(a[k]).lerp(b[k], t);
    else out[k] = a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

/* --- Sky ----------------------------------------------------------------
   A gradient dome whose colours and sun glow are uniforms, replacing the
   painted textures so the sky can change every frame. */
const skyUniforms = {
  uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
  uGlow: { value: new THREE.Color() }, uGlowStrength: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uRays: { value: 0 }, uTime: { value: 0 },
};
function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uTop, uHorizon, uBottom, uGlow, uSunDir;
      uniform float uGlowStrength, uRays, uTime;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 1.0, h), 0.55))
                           : mix(uHorizon, uBottom, smoothstep(0.0, 0.25, -h));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        // a broad warm wash toward the sun, a tight halo round it
        col += uGlow * uGlowStrength * (pow(s, 6.0) * 0.55 + pow(s, 64.0) * 0.6) * (1.0 - 0.5 * smoothstep(0.0, 0.6, h));
        // Sun rays: streaks fanning out from the sun, slowly turning. The sky
        // is drawn behind everything, so rooftops and trees cut into them.
        vec3 sd = normalize(uSunDir);
        vec3 t1 = normalize(cross(sd, abs(sd.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        float ang = atan(dot(d, cross(sd, t1)), dot(d, t1));
        float streak = 0.5 + 0.5 * sin(ang * 19.0 + sin(ang * 5.0 + uTime * 0.12) * 2.2) * sin(ang * 7.0 - uTime * 0.08);
        col += uGlow * uRays * pow(streak, 3.0) * pow(s, 10.0) * 0.9;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Long thin streaks out from a bright core: the dazzle of looking at the sun
let glare = null;
function starburstTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + (i % 2) * 0.07, len = i % 3 === 0 ? 126 : 70 + (i * 37 % 40);
    g.save(); g.rotate(a);
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, 'rgba(255,248,230,0.55)'); grad.addColorStop(1, 'rgba(255,248,230,0)');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(0, -2.5); g.lineTo(len, 0); g.lineTo(0, 2.5); g.fill();
    g.restore();
  }
  const core = g.createRadialGradient(0, 0, 0, 0, 0, 40);
  core.addColorStop(0, 'rgba(255,250,235,0.7)'); core.addColorStop(1, 'rgba(255,250,235,0)');
  g.fillStyle = core; g.fillRect(-40, -40, 80, 80);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* --- Progress ------------------------------------------------------------ */
let progressSource = null;
/** Each level calls this once with a function returning its progress 0..1. */
export function registerDayProgress(fn) { progressSource = fn; }

let frames = null, latched = 0, shown = 0, envTimer = 0, envScene = null;
const starBase = stars.map((s) => s.material.opacity);
const _dir = new THREE.Vector3();
const rad = THREE.MathUtils.degToRad;

/** Called from bootLevel() right after applyTimeOfDay(): picks the
    timeline and makes the one-time structural choices. */
export function startDayCycle() {
  frames = TIMELINES[state.timeOfDay === 'day' ? 'day' : 'night'];
  latched = shown = 0;
  sky.material = skyMaterial();
  const { sun, hemiLight, ambientLight, moonVisual, sunVisual } = lighting;
  // Fills always on: the timeline dims them rather than toggling them
  hemiLight.visible = ambientLight.visible = true;
  // Sun shadows by day only: at night there's no main light to cast them
  // (the finale's sunrise does without; Level 3 is the heaviest level)
  sun.castShadow = state.timeOfDay === 'day';
  moonVisual.position.set(
    Math.sin(rad(15)) * Math.cos(rad(24)), Math.sin(rad(24)), -Math.cos(rad(15)) * Math.cos(rad(24))).multiplyScalar(400);
  moonVisual.scale.set(52, 52, 1);
  sunVisual.scale.set(60, 60, 1);
  // Buildings hide the sun (its glow used to show through them)
  sunVisual.material.depthTest = true;
  sunVisual.material.needsUpdate = true;
  // The glare round the disc when you look at it: a starburst
  if (!glare) {
    glare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: starburstTexture(), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    }));
    glare.scale.set(190, 190, 1);
    glare.renderOrder = -1;
    sky.add(glare);
  }
  stars.forEach((s) => { s.visible = true; });
  moonVisual.visible = sunVisual.visible = true;
  // Sky-lit levels (Level 1 and 2 by day) relight from the sky as it changes
  if (scene.environment) {
    envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(sky.geometry, sky.material));
  }
  apply(state.levelId - 1);
}

function apply(c) {
  const v = sample(frames, c);
  const { sun, hemiLight, ambientLight, moonVisual, sunVisual } = lighting;
  skyUniforms.uTop.value.copy(v.top); skyUniforms.uHorizon.value.copy(v.hor); skyUniforms.uBottom.value.copy(v.bot);
  skyUniforms.uGlow.value.copy(v.glow); skyUniforms.uGlowStrength.value = v.gs;
  scene.background.copy(v.hor);
  scene.fog.color.copy(v.fog);
  scene.fog.density = v.fogD;
  _dir.set(Math.sin(rad(v.az)) * Math.cos(rad(v.el)), Math.sin(rad(v.el)), -Math.cos(rad(v.az)) * Math.cos(rad(v.el))).normalize();
  skyUniforms.uSunDir.value.copy(_dir);
  setSunDirection(_dir);
  sun.color.copy(v.sunCol);
  sun.intensity = v.sun;
  sunVisual.material.color.copy(v.sunCol);
  sunVisual.material.opacity = v.disc * THREE.MathUtils.smoothstep(v.el, -3, 1);
  // Rays and glare while the sun is out and not lost in fog
  const rays = v.disc * THREE.MathUtils.smoothstep(v.el, -2, 3) * (1 - THREE.MathUtils.smoothstep(v.fogD, 0.01, 0.025));
  skyUniforms.uRays.value = rays;
  if (glare) {
    glare.position.copy(sunVisual.position);
    glare.material.color.copy(v.sunCol);
    glare.material.opacity = 0.55 * rays;
  }
  hemiLight.color.copy(v.hemiSky); hemiLight.groundColor.copy(v.hemiGnd); hemiLight.intensity = v.hemi * FILL;
  ambientLight.color.copy(v.ambCol); ambientLight.intensity = v.amb * FILL;
  renderer.toneMappingExposure = v.exp * EXPOSURE;
  fogUniforms.uColor.value.copy(v.mist);
  fogUniforms.uOpacity.value = v.mistA;
  mistEnabled.value = v.mistA > 0.01 ? 1 : 0;
  rain.visible = v.rain > 0.01;
  rainUniforms.uOpacity.value = 0.35 * v.rain;
  stars.forEach((s, i) => { s.material.opacity = starBase[i] * v.stars; });
  moonVisual.material.opacity = 0.95 * v.moon;
}

/** Every frame, from the game loop. */
export function updateDayCycle(dt) {
  skyUniforms.uTime.value += dt;
  if (glare) glare.material.rotation += dt * 0.015;
  if (!frames) return;
  const raw = THREE.MathUtils.clamp(progressSource ? progressSource() : 0, 0, 1);
  if (raw < latched - 0.25) latched = shown = raw; // a restart rewinds the clock
  else latched = Math.max(latched, raw);
  shown += (latched - shown) * (1 - Math.exp(-dt * 0.8));
  apply(state.levelId - 1 + shown);
  // Re-light sky-lit levels from the current sky every few seconds
  if (envScene && (envTimer -= dt) <= 0) {
    envTimer = 4;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const previous = scene.environment;
    scene.environment = pmrem.fromScene(envScene, 0.04, 1, 1000).texture;
    pmrem.dispose();
    previous?.dispose();
  }
}
