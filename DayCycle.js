/* ======================================================================
   DayCycle.js — TIME MOVES ACROSS THE CAMPAIGN

   One clock runs through all three levels: campaign time c goes 0..3, and
   Level N covers N-1..N, so each level starts exactly where the last one
   ended. The player picks Day or Night once; the choice carries into the
   next level (account.js playNextLevel) and picks the timeline:

     Day    L1 dawn -> sun about to rise · L2 sunrise -> late morning ·
            L3 golden light through incoming cloud -> warm sea fog, the sun
            glowing through it, a light drizzle
     Night  L1 streetlit night · L2 dead grid, moon over
            the port · L3 sea fog before dawn -> the sun breaks through
            as the cure broadcasts. The moon and stars light it: the sun's
            light becomes a cool moonlight from the moon (no shadows), the
            stars add a faint fill, and the sea reflects the night sky
            (reflectNightSky)

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
import { scene, renderer, sky, stars, starUniforms, rain, lighting, setSunDirection } from './Scene.js';
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
    mist: 0x6a7080, mistA: 0.45, rain: 0, stars: 0.45, moon: 0,
    sat: 0.72, warm: -0.6, con: 1.08, bri: 0.97 },
  // Level 1, nearing extraction: first light, the sun just below the rooftops
  { c: 0.8, warm: -0.25, top: 0x3e5478, hor: 0xe8a070, bot: 0x3a3436, glow: 0xffa060, gs: 0.75,
    fog: 0x7a6c6a, fogD: 0.008, sunCol: 0xff8a50, sun: 0.35, el: -1,
    hemiSky: 0x9aa4bc, hemiGnd: 0x3a3430, hemi: 1.0, ambCol: 0x5a5a62, amb: 0.5, mist: 0x9a8c88, mistA: 0.4, stars: 0.05 },
  // Level 1 ends / Level 2 begins: sunrise
  { c: 1, sat: 0.78, warm: 0.3, con: 1.07, bri: 1, top: 0x6584ab, hor: 0xf6c08c, bot: 0x5a4c44, glow: 0xffb878, gs: 0.95,
    fog: 0xc2a088, fogD: 0.0055, sunCol: 0xffb070, sun: 1.8, el: 3, disc: 0.9,
    hemiSky: 0xc8b8a8, hemiGnd: 0x3a3028, hemi: 0.3, ambCol: 0x5a5048, amb: 0.18, exp: 0.82,
    mist: 0xd9c4a6, mistA: 0.3, stars: 0 },
  // Level 2, a little way into the chase: the sun clears the rooftops, so the
  // street is no longer one long shadow and buildings cast crisp ones
  { c: 1.15, sun: 2.6, el: 12, az: 85, hemi: 0.16, amb: 0.08 },
  // Level 2, halfway: a bright morning, the sun still a little warm
  { c: 1.5, sat: 0.8, warm: 0.25, top: 0x5f8cc0, hor: 0xead6b4, bot: 0x7a6a5a, glow: 0xffd8a8, gs: 0.55,
    fog: 0xccbca0, sunCol: 0xffd6a8, sun: 2.8, el: 35, az: 105 },
  // Level 2 ends / Level 3 begins: a clear late morning, the sun high.
  // Level 2 is lit by its own sky as well, so the fills stay low, the sun
  // keeps some warmth and the sky stays blue rather than pale, or the
  // whole street washes out white.
  { c: 2, top: 0x4f86c4, hor: 0xe0d8c4, bot: 0x7a6e60, glow: 0xffe8c8, gs: 0.45,
    fog: 0xc8c0aa, fogD: 0.0035, sunCol: 0xffe2b8, sun: 3.0, el: 50, az: 120, disc: 0.85,
    hemiSky: 0xd8ccb8, hemiGnd: 0x40362c, hemi: 0.16, ambCol: 0x5a5048, amb: 0.08, exp: 0.78,
    mist: 0xe0caa8, mistA: 0 },
  // Level 3, the first switch or so: cloud coming in off the sea, the sun
  // still breaking through it golden
  { c: 2.35, warm: 0.4, top: 0x9aa4b0, hor: 0xf0d0a8, bot: 0x8a7a6a, glow: 0xffc890, gs: 0.5,
    fog: 0xd8c0a4, fogD: 0.007, sunCol: 0xffc890, sun: 2.4, el: 50, az: 140, disc: 0.6,
    hemiSky: 0xf0dcc4, hemiGnd: 0x40362c, hemi: 0.45, ambCol: 0x5a5048, amb: 0.22, exp: 0.9,
    mist: 0xe8d4b8, mistA: 0.3, rain: 0 },
  // Level 3 ends: warm sea fog, the sun low and orange glowing through it,
  // a light drizzle. Bright weather closing in, not grey murk.
  { c: 3, warm: 0.45, top: 0xb0aca4, hor: 0xe8c8a0, bot: 0xa08a74, glow: 0xffb878, gs: 0.35,
    fog: 0xd0b898, fogD: 0.02, sunCol: 0xffb070, sun: 1.2, el: 40, az: 160, disc: 0.35,
    hemiSky: 0xf0e0cc, hemiGnd: 0x4a4038, hemi: 0.85, ambCol: 0x6a5a4a, amb: 0.4, exp: 0.95,
    mist: 0xead8c0, mistA: 0.5, rain: 0.4 },
];
const NIGHT = [
  // Night is lit by the moon and stars: the "sun" here is the moon, a cool
  // light from where it hangs in the sky (el/az), with no shadows. The
  // streetlights light the street, and a faint blue fill (with the stars'
  // share, STARLIGHT) keeps silhouettes readable.
  // Level 1: the streetlit night, the city glow amber at the horizon
  { c: 0, top: 0x514f5a, hor: 0x9d8270, bot: 0xe3c29a, glow: 0x9fb4d8, gs: 0.06,
    fog: 0x4a4440, fogD: 0.009, sunCol: 0xb4c6ea, sun: 0.35, el: 24, az: 15, disc: 0,
    hemiSky: 0x6a7a96, hemiGnd: 0x1c1a18, hemi: 0.35, ambCol: 0x3a4250, amb: 0.22, exp: 1.0,
    mist: 0x8a909a, mistA: 0.45, rain: 0, stars: 0.85, moon: 0.9,
    sat: 0.7, warm: -0.5, con: 1.1, bri: 0.96 },
  { c: 1 },
  // Level 2, leaving downtown: the grid is dead, a cool moonlit night, the
  // moon over the sea ahead (the port is south, toward -z)
  { c: 1.25, sat: 0.66, warm: -0.75, top: 0x2a354b, hor: 0x4b5a71, bot: 0x6a7992, glow: 0x9fb4d8, gs: 0.12, sun: 0.5,
    fog: 0x1f2736, fogD: 0.0085, hemiSky: 0x5d6f92, hemiGnd: 0x15171c, hemi: 0.32,
    ambCol: 0x1f2635, amb: 0.2, mist: 0x52607a, mistA: 0.35, stars: 1, moon: 0.95 },
  { c: 2 },
  // Level 3: sea fog before dawn, thickening as you work through the switches
  { c: 2.45, warm: -0.6, top: 0x1e2636, hor: 0x34415a, bot: 0x3e4b5e, glow: 0x9fb4d8, gs: 0.06,
    fog: 0x182535, fogD: 0.012, hemi: 0.4, amb: 0.25, mist: 0x35475a, mistA: 0.45, stars: 0.3, moon: 0.4, sun: 0.25 },
  { c: 2.85, warm: -0.35, top: 0x3a4452, hor: 0x4c5664, bot: 0x4a5260, glow: 0xc08a6a, gs: 0.12,
    fog: 0x2c3644, fogD: 0.022, mist: 0x4a586a, mistA: 0.6, rain: 0.25, stars: 0, moon: 0, sun: 0 },
  { c: 2.88, sunCol: 0xffb070, el: -3, az: 75 },
  // Level 3 ends: the cure broadcasts and the sun breaks through
  { c: 3, sat: 0.78, warm: 0.35, con: 1.07, bri: 1, top: 0x5a6f92, hor: 0xf4b07a, bot: 0x7a6050, glow: 0xffb070, gs: 0.95,
    fog: 0xb48c74, fogD: 0.008, sun: 2, el: 4, disc: 0.9, hemiSky: 0xc8b8a8, hemiGnd: 0x3a3028,
    hemi: 0.9, ambCol: 0x5a5048, amb: 0.45, exp: 1.0, mist: 0xd9b8a0, mistA: 0.3, rain: 0 },
];
const COLOURS = ['top', 'hor', 'bot', 'glow', 'fog', 'sunCol', 'hemiSky', 'hemiGnd', 'ambCol', 'mist'];
// Overall brightness, on top of the timelines: EXPOSURE lifts the whole
// picture, sky included; FILL lifts the shade (hemisphere + ambient light)
const EXPOSURE = 1.25;
const FILL = 1.6;
// Starlight: the hemisphere fill brightens by this much with a full sky of stars
const STARLIGHT = 0.1;

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
  gradeKey = ''; // applyTimeOfDay just set its own filter on the canvas
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
  // By day every level is lit by its sky too, relit as the sky changes
  if (state.timeOfDay === 'day') {
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
  hemiLight.color.copy(v.hemiSky); hemiLight.groundColor.copy(v.hemiGnd); hemiLight.intensity = (v.hemi + STARLIGHT * v.stars) * FILL;
  ambientLight.color.copy(v.ambCol); ambientLight.intensity = v.amb * FILL;
  renderer.toneMappingExposure = v.exp * EXPOSURE;
  fogUniforms.uColor.value.copy(v.mist);
  fogUniforms.uOpacity.value = v.mistA;
  mistEnabled.value = v.mistA > 0.01 ? 1 : 0;
  rain.visible = v.rain > 0.01;
  rainUniforms.uOpacity.value = 0.35 * v.rain;
  stars.forEach((s, i) => { s.material.opacity = starBase[i] * v.stars; });
  moonVisual.material.opacity = 0.95 * v.moon;
  applyGrade(v);
}

/* --- Colour grade -------------------------------------------------------
   One grade over the whole picture, following the timeline: colour drained
   (sat), warm amber by day (warm, 0 to 1; below 0 adds nothing, the night's
   cold comes from its blue light and fog), a touch of contrast (con) and
   brightness (bri). A plain CSS filter chain on the canvas, done by the
   compositor on the GPU: no render pass. Not an SVG colour matrix: Chrome
   can take an SVG filter on a WebGL canvas off the fast path, and that
   lagged the game badly. Rounded to 2 places and set at most every
   GRADE_EVERY_MS, since each change makes the browser rebuild the filter. */
const GRADE_EVERY_MS = 500;
let gradeKey = '', gradeAt = 0;
function applyGrade(v) {
  const now = performance.now();
  if (gradeKey && now - gradeAt < GRADE_EVERY_MS) return;
  const key = `saturate(${v.sat.toFixed(2)}) sepia(${(Math.max(0, v.warm) * 0.3).toFixed(2)}) contrast(${v.con.toFixed(2)}) brightness(${v.bri.toFixed(2)})`;
  gradeAt = now;
  if (key === gradeKey) return;
  gradeKey = key;
  renderer.domElement.style.filter = key;
}

/** Every frame, from the game loop. */
export function updateDayCycle(dt) {
  skyUniforms.uTime.value += dt;
  starUniforms.uTime.value += dt;
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
  if (nightSeas.length && (nightEnvTimer -= dt) <= 0) captureNightSky();
}

/* --- The night sea ------------------------------------------------------
   By day the sea reflects the sky through scene.environment. At night there
   is none (lighting every surface from the night sky would wash the street
   out), so the sea gets its own: the night sky with the moon and stars,
   captured into a reflection map and re-captured every few seconds as the
   night changes. Smooth water plus the ripple normals stretch the moon's
   reflection and the moonlight's highlight into a path across the water. */
const nightSeas = [];
let nightEnvScene = null, nightEnv = null, nightEnvTimer = 0;
function captureNightSky() {
  nightEnvTimer = 4;
  if (!nightEnvScene) {
    nightEnvScene = new THREE.Scene();
    nightEnvScene.add(new THREE.Mesh(sky.geometry, sky.material));
    // The moon and the star layers, sharing their materials, so they fade with the night
    const moon = new THREE.Sprite(lighting.moonVisual.material);
    moon.position.copy(lighting.moonVisual.position);
    moon.scale.copy(lighting.moonVisual.scale);
    nightEnvScene.add(moon, ...stars.map((s) => new THREE.Points(s.geometry, s.material)));
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const previous = nightEnv;
  nightEnv = pmrem.fromScene(nightEnvScene, 0, 1, 1000).texture;
  pmrem.dispose();
  for (const m of nightSeas) m.envMap = nightEnv;
  previous?.dispose();
}
/** A sea's material: at night, it reflects the night sky (smoother water,
    the moon's path across it). By day it does nothing: scene.environment
    already gives the sea the day sky. Call after bootLevel(). */
export function reflectNightSky(material) {
  if (state.timeOfDay === 'day') return;
  material.roughness = 0.1;
  material.envMapIntensity = 1;
  nightSeas.push(material);
  if (!nightEnv) captureNightSky();
  material.envMap = nightEnv;
  material.needsUpdate = true;
}
