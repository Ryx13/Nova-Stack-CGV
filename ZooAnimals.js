/* ======================================================================
   ZooAnimals.js — THE ZOO'S INFECTED ANIMALS (Level 2)

   Let out by the quake (Level2Quake.js), they come through the broken
   fence, down the west street and in from the west side street, and run
   at you, trailing brown air (trailHaze) behind them. Five kinds, each
   played differently:
     lion     the pack: faster than a run, slower than a sprint
     cheetah  faster than your sprint, but only in bursts: it tires, slows,
              and goes again (outrun it in the gaps)
     zebra    a striped gallop, kicks
     ostrich  the bird: long legs, quick, pecks; one shot
     rhino    slow, takes a lot of shooting, and charges once it's lined up
              on you from a way off
   Built in code, no model files: each body one mesh with its colours baked
   in (vertex colours: spots, stripes, mange, wounds), every leg of every
   animal three instanced meshes between them (thigh, shin, foot), bending
   at the knee in each one's own gait (a lion's bound, a zebra's gallop, a
   rhino's trot, the ostrich's stride). Rich on a high graphics profile
   (finer bodies, every spot and stripe, feathers, skin folds), plainer on
   low (GraphicsProfile.js). Solid: against the infected, the girl, each
   other, you, and the walls. Bullets find them via state.extraShotTargets.
====================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, sfx, pushKillFeed, STREET_HALF_W } from './Scene.js';
import { state } from './state.js';
import { damagePlayer } from './Actions.js';
import { pushOutOfSolids, pushOutOfBodies, pushPlayerFrom } from './characters.js';
import { spawnBloodSpray, placeBloodSplat, trailHaze } from './ImpactFX.js';
import { gfx } from './GraphicsProfile.js';
import { createNavigator, navGoal } from './ZombieNav.js';

const RICH = !gfx.low;
// Who comes out, in the order they come (the quick ones first, the rhino last)
const PACK = RICH
  ? ['cheetah', 'lion', 'cheetah', 'zebra', 'lion', 'ostrich', 'zebra', 'lion', 'ostrich', 'rhino']
  : ['cheetah', 'lion', 'zebra', 'ostrich', 'lion', 'zebra', 'ostrich', 'rhino'];
const EASY_PACK = ['cheetah', 'lion', 'zebra', 'ostrich', 'rhino']; // one of each, to see them all
const RELEASE_GAP = 0.45;   // s between animals breaking into the street
// Where they come into the main street from: the west side street off the
// junction, the way down from the zoo (CityLayout harbour: z -55)
const ENTRY = new THREE.Vector3(-10, 0, -55);
const FROM = [[-24, -51], [-27, -56], [-22, -59], [-30, -53], [-25, -61], [-29, -58]];

/* --- Building the bodies ---------------------------------------------- */
const SEG = RICH ? [20, 14] : [10, 7], CYL = RICH ? 14 : 8;
// A part in its own colour: a hex, or (x, y, z) => hex for patterns
const _col = new THREE.Color();
function part(geo, colour) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, n = pos.count, colours = new Float32Array(n * 3);
  if (typeof colour !== 'function') _col.set(colour);
  for (let i = 0; i < n; i++) {
    if (typeof colour === 'function') _col.set(colour(pos.getX(i), pos.getY(i), pos.getZ(i)));
    colours.set([_col.r, _col.g, _col.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.deleteAttribute('uv'); // not needed, and every part must match to merge
  return g;
}
const sphere = (r, seg = SEG) => new THREE.SphereGeometry(r, seg[0], seg[1]);
const ball = (r, sx, sy, sz, x, y, z, colour, seg) => part(sphere(r, seg).scale(sx, sy, sz).translate(x, y, z), colour);
const tube = (r0, r1, len, rx, x, y, z, colour) => part(new THREE.CylinderGeometry(r0, r1, len, CYL).rotateX(rx).translate(x, y, z), colour);
const cone = (r, len, rx, x, y, z, colour) => part(new THREE.ConeGeometry(r, len, Math.max(6, CYL >> 1)).rotateX(rx).translate(x, y, z), colour);
// The same dots every build (spots, fur, feathers)
function seeded(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }
// Dots scattered over an ellipsoid's surface (c its centre, rad its radii)
function dotsOn(parts, n, c, rad, size, colour, rnd, upper = 0.5) {
  for (let i = 0; i < n; i++) {
    const u = (rnd() * 2 - 1) * 0.88, v = rnd() * (1 + upper) - 1 + (1 - upper) * 0.5, w = 1 - u * u - v * v;
    if (w < 0.04) continue;
    const side = rnd() < 0.5 ? -1 : 1, s = size * (0.7 + rnd() * 0.6);
    parts.push(ball(s, 1, 0.8, 1.2, side * rad[0] * Math.sqrt(w) * 0.97, c[1] + rad[1] * v * 0.97, c[2] + rad[2] * u * 0.97, colour, [8, 6]));
  }
}
// Skin a little patchy (rich only): darker and lighter in slow blotches
const mottled = (hex, amt) => {
  if (!RICH) return hex;
  const base = new THREE.Color(hex), out = new THREE.Color();
  return (x, y, z) => out.copy(base).multiplyScalar(1 + amt * Math.sin(x * 9.1 + z * 6.3) * Math.sin(y * 7.7 - z * 4.1)).getHex();
};
const WOUND = 0x5a0a0a, DARK = 0x1c1612, CLOUDED = 0xd6dc9a, BONE = 0xd8cfb4;

// LION: the maned male and the lioness, the coat drained toward grey-green
function lionBody(maned) {
  const COAT = mottled(0x9a7d55, 0.08), BELLY = 0xb09670, MANE = 0x3e2a1c, MANGE = 0x6e6a5a;
  const w = maned ? 1 : 0.9; // a lioness is a little slighter
  const parts = [
    ball(0.5, 0.6 * w, 0.58, 1.05, 0, 0.98, 0, COAT),            // torso
    ball(0.42, 0.72 * w, 0.82, 0.78, 0, 1.0, 0.45, COAT),        // chest
    ball(0.4, 0.74 * w, 0.8, 0.78, 0, 0.98, -0.5, COAT),         // haunches
    ball(0.38, 0.5 * w, 0.35, 0.95, 0, 0.78, 0, BELLY),          // belly, paler
    tube(0.17, 0.23, 0.44, -0.9, 0, 1.18, 0.72, COAT),           // neck
    ball(0.26, 1, 0.92, 1.12, 0, 1.3, 0.96, COAT),               // head
    part(new THREE.CylinderGeometry(0.1, 0.13, 0.24, CYL).rotateX(Math.PI / 2).translate(0, 1.22, 1.2), BELLY), // muzzle
    ball(0.05, 1.2, 0.8, 1, 0, 1.27, 1.32, DARK),                // nose
    part(new THREE.BoxGeometry(0.17, 0.05, 0.18).rotateX(0.35).translate(0, 1.09, 1.17), WOUND), // a hanging, bloodied jaw
    ball(0.035, 1, 1, 1, 0.11, 1.38, 1.18, CLOUDED),             // clouded eyes
    ball(0.035, 1, 1, 1, -0.11, 1.38, 1.18, CLOUDED),
    cone(0.07, 0.12, 0, 0.15, 1.53, 0.9, COAT),                  // ears
    cone(0.07, 0.12, 0, -0.15, 1.53, 0.9, COAT),
    // Tail: down off the rump, then out, with a dark tuft
    tube(0.045, 0.04, 0.5, -0.5, 0, 0.95, -0.98, COAT),
    tube(0.04, 0.03, 0.45, -1.3, 0, 0.78, -1.35, COAT),
    ball(0.08, 1, 1, 1.4, 0, 0.72, -1.58, DARK),
    // Mange and wounds
    ball(0.16, 0.25, 1, 1.4, 0.29 * w, 1.05, -0.15, MANGE),
    ball(0.14, 0.25, 0.9, 1.2, -0.3 * w, 0.92, 0.28, WOUND),
    ball(0.12, 0.25, 1.1, 1.3, 0.3 * w, 0.85, -0.55, WOUND),
  ];
  if (maned) {
    parts.push(
      ball(0.44, 1.08, 1.12, 0.72, 0, 1.26, 0.82, MANE),         // the mane round the head
      ball(0.3, 1.0, 1.1, 0.9, 0, 1.0, 0.68, MANE),              // the ruff down the chest
    );
    if (RICH) dotsOn(parts, 26, [0, 1.26, 0.82], [0.47, 0.49, 0.32], 0.09, MANE, seeded(7), 0.9); // shaggy tufts
  }
  if (RICH) parts.push(cone(0.012, 0.07, Math.PI, 0.05, 1.07, 1.27, BONE), cone(0.012, 0.07, Math.PI, -0.05, 1.07, 1.27, BONE)); // fangs
  return mergeGeometries(parts);
}

// CHEETAH: slight and deep-chested, a small head with its tear marks, a long
// ringed tail, spotted all over
function cheetahBody() {
  const COAT = 0xb8955a, BELLY = 0xd2c2a0, SPOT = 0x221a12, rnd = seeded(11);
  const parts = [
    ball(0.42, 0.55, 0.55, 1.15, 0, 0.98, 0, COAT),              // torso, the waist pulled in
    ball(0.36, 0.7, 0.85, 0.8, 0, 1.0, 0.38, COAT),              // deep chest
    ball(0.3, 0.75, 0.8, 0.8, 0, 0.98, -0.42, COAT),             // haunches
    ball(0.3, 0.5, 0.3, 1.0, 0, 0.84, 0.05, BELLY),
    tube(0.08, 0.13, 0.34, 0.9, 0, 1.17, 0.62, COAT),            // neck, reaching forward
    ball(0.15, 1, 0.88, 1.05, 0, 1.28, 0.8, COAT),               // the small head
    ball(0.08, 1, 0.8, 1, 0, 1.22, 0.92, BELLY),                 // muzzle
    ball(0.03, 1.3, 0.8, 1, 0, 1.25, 0.99, DARK),                // nose
    part(new THREE.BoxGeometry(0.1, 0.03, 0.1).rotateX(0.4).translate(0, 1.14, 0.9), WOUND),
    ball(0.025, 1, 1, 1, 0.065, 1.32, 0.92, CLOUDED),
    ball(0.025, 1, 1, 1, -0.065, 1.32, 0.92, CLOUDED),
    tube(0.012, 0.012, 0.13, 0.3, 0.06, 1.25, 0.93, SPOT),       // the tear marks, eye to mouth
    tube(0.012, 0.012, 0.13, 0.3, -0.06, 1.25, 0.93, SPOT),
    ball(0.045, 1, 1, 0.5, 0.09, 1.4, 0.74, COAT),               // round ears
    ball(0.045, 1, 1, 0.5, -0.09, 1.4, 0.74, COAT),
    tube(0.035, 0.028, 0.95, -1.15, 0, 0.82, -0.88, COAT),       // the long tail
    ball(0.032, 1, 1, 1.5, 0, 0.62, -1.32, 0xe0d6c0),            // its white tip
    ball(0.1, 0.25, 0.9, 1.2, 0.2, 1.02, 0.1, WOUND),
    ball(0.08, 0.25, 0.9, 1.1, -0.2, 0.95, -0.3, WOUND),
  ];
  dotsOn(parts, RICH ? 70 : 20, [0, 0.98, 0], [0.23, 0.23, 0.48], 0.026, SPOT, rnd);
  dotsOn(parts, RICH ? 30 : 8, [0, 1.0, 0.38], [0.25, 0.31, 0.29], 0.024, SPOT, rnd);
  dotsOn(parts, RICH ? 24 : 6, [0, 0.98, -0.42], [0.22, 0.24, 0.24], 0.024, SPOT, rnd);
  if (RICH) for (let i = 0; i < 4; i++) parts.push(part(new THREE.TorusGeometry(0.032, 0.012, 5, 10).translate(0, 0, 0).rotateX(-1.15 + Math.PI / 2).translate(0, 0.72 - i * 0.045, -1.1 - i * 0.05), SPOT)); // rings near the tail's end
  return mergeGeometries(parts);
}

// ZEBRA: a horse's build, striped (finer and crisper on rich), a stiff
// striped mane, the stripes ringing the neck and running down the flanks
function zebraBody() {
  const BLACK = 0x1a1816, WHITE = 0xd4cfc2, period = RICH ? 0.15 : 0.26;
  const stripe = (x, y, z) => {
    const onNeck = z > 0.5 && y > 1.38;
    const t = onNeck ? (y * 0.85 + z * 0.52) : (z + Math.sin(y * 5) * 0.06 + Math.abs(x) * 0.15);
    return Math.sin((t / period) * Math.PI * 2) > -0.1 ? BLACK : WHITE;
  };
  const dense = RICH ? [48, 26] : [22, 12]; // enough points to carry the stripes
  const parts = [
    ball(0.5, 0.75, 0.68, 1.2, 0, 1.22, 0, stripe, dense),       // torso
    ball(0.4, 0.85, 0.9, 0.8, 0, 1.25, 0.45, stripe, dense),     // chest
    ball(0.42, 0.88, 0.88, 0.85, 0, 1.27, -0.5, stripe, dense),  // rump
    ball(0.36, 0.6, 0.36, 1.05, 0, 1.0, 0, WHITE),               // pale belly
    part(new THREE.CylinderGeometry(0.13, 0.24, 0.8, CYL, RICH ? 16 : 6).rotateX(0.55).translate(0, 1.62, 0.78), stripe), // neck
    part(new THREE.BoxGeometry(0.05, 0.82, 0.13, 1, RICH ? 16 : 6).rotateX(0.55).translate(0, 1.71, 0.64), stripe),        // the stiff mane
    part(new THREE.CylinderGeometry(0.075, 0.14, 0.6, CYL, RICH ? 10 : 4).rotateX(2.09).translate(0, 1.85, 1.2), stripe),  // the long head
    ball(0.15, 1, 1, 1.2, 0, 2.0, 1.02, stripe),                 // brow
    ball(0.09, 1.05, 0.85, 1.1, 0, 1.67, 1.47, DARK),            // muzzle
    part(new THREE.BoxGeometry(0.1, 0.03, 0.14).rotateX(0.5).translate(0, 1.58, 1.4), WOUND),
    ball(0.03, 1, 1, 1, 0.12, 1.97, 1.1, CLOUDED),
    ball(0.03, 1, 1, 1, -0.12, 1.97, 1.1, CLOUDED),
    cone(0.05, 0.2, -0.2, 0.08, 2.17, 0.94, WHITE),              // ears
    cone(0.05, 0.2, -0.2, -0.08, 2.17, 0.94, WHITE),
    tube(0.03, 0.025, 0.55, -0.35, 0, 1.18, -1.05, WHITE),       // tail
    ball(0.06, 1, 2.2, 1, 0, 0.86, -1.18, BLACK),                // its dark switch
    ball(0.12, 0.25, 0.9, 1.3, 0.37, 1.2, 0.15, WOUND),
    ball(0.1, 0.25, 1, 1.2, -0.38, 1.3, -0.45, WOUND),
  ];
  if (RICH) parts.push(ball(0.13, 0.3, 0.6, 1.4, 0.39, 1.12, -0.05, BONE)); // ribs showing through the wound
  return mergeGeometries(parts);
}

// OSTRICH: the bird; a round black body of plumes, white wing tips and tail,
// the long bare neck and the small head, eyes too big for it
function ostrichBody() {
  const PLUME = 0x1e1b19, WHITE = 0xd6d0c4, SKIN = 0xa08478, BEAK = 0x8a7a5a, rnd = seeded(23);
  const parts = [
    ball(0.5, 1.0, 0.75, 1.2, 0, 1.3, -0.05, PLUME),             // the body
    ball(0.3, 0.3, 0.7, 1.2, 0.48, 1.32, -0.05, PLUME),          // wings, folded
    ball(0.3, 0.3, 0.7, 1.2, -0.48, 1.32, -0.05, PLUME),
    ball(0.15, 0.4, 0.7, 1, 0.5, 1.24, -0.5, WHITE),             // white wing tips
    ball(0.15, 0.4, 0.7, 1, -0.5, 1.24, -0.5, WHITE),
    ball(0.2, 1, 0.8, 1, 0, 1.42, -0.64, WHITE),                 // tail plumes
    tube(0.045, 0.085, 0.98, 0.15, 0, 1.95, 0.42, SKIN),         // the neck
    ball(0.08, 1, 0.9, 1.3, 0, 2.44, 0.54, SKIN),                // head
    part(new THREE.ConeGeometry(0.035, 0.12, 8).rotateX(Math.PI / 2).translate(0, 2.42, 0.68), BEAK), // beak
    ball(0.03, 1, 1, 1, 0.055, 2.47, 0.58, CLOUDED),             // the big clouded eyes
    ball(0.03, 1, 1, 1, -0.055, 2.47, 0.58, CLOUDED),
    ball(0.05, 0.6, 1.4, 0.7, 0.05, 1.78, 0.4, WOUND),           // torn neck
    ball(0.12, 0.4, 0.8, 1.2, 0.33, 1.1, 0.2, WOUND),
  ];
  if (RICH) {
    // Plumes standing off the body and the wings
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, y = 1.15 + rnd() * 0.4;
      parts.push(part(new THREE.ConeGeometry(0.035, 0.16, 5).rotateX(-1.2 + rnd() * 0.6).rotateY(a).translate(Math.sin(a) * 0.47, y, -0.05 + Math.cos(a) * 0.55), rnd() < 0.15 ? WHITE : PLUME));
    }
  }
  return mergeGeometries(parts);
}

// RHINO: the heavy one; a great grey barrel with folds of skin, the head
// slung low with its two horns, small ears and eyes, short thick legs
function rhinoBody() {
  const SKIN = mottled(0x6d6a64, 0.12), FOLD = 0x55524c, HORN = 0x9a8f7a;
  const head = (r, sx, sy, sz, rx, x, y, z, c) => part(sphere(r).scale(sx, sy, sz).rotateX(rx).translate(x, y, z), c);
  const parts = [
    ball(0.75, 0.9, 0.75, 1.15, 0, 1.15, 0, SKIN),               // the barrel
    ball(0.6, 1.0, 0.95, 0.8, 0, 1.25, 0.6, SKIN),               // shoulders
    ball(0.6, 1.0, 0.92, 0.85, 0, 1.2, -0.65, SKIN),             // rump
    ball(0.6, 0.85, 0.45, 1.0, 0, 0.88, 0, FOLD),                // belly
    head(0.36, 0.85, 0.8, 1.5, 0.35, 0, 1.0, 1.35, SKIN),        // the long head, slung low
    cone(0.13, 0.5, 0.35, 0, 1.12, 1.85, HORN),                  // the front horn
    cone(0.08, 0.22, 0.1, 0, 1.22, 1.58, HORN),                  // and the back one
    cone(0.07, 0.18, -0.3, 0.17, 1.42, 1.12, SKIN),              // ears
    cone(0.07, 0.18, -0.3, -0.17, 1.42, 1.12, SKIN),
    ball(0.025, 1, 1, 1, 0.22, 1.1, 1.48, CLOUDED),
    ball(0.025, 1, 1, 1, -0.22, 1.1, 1.48, CLOUDED),
    part(new THREE.BoxGeometry(0.18, 0.04, 0.16).rotateX(0.3).translate(0, 0.78, 1.72), WOUND),
    ball(0.2, 0.25, 0.9, 1.4, 0.62, 1.2, 0.1, WOUND),
    ball(0.16, 0.25, 0.9, 1.2, -0.6, 1.0, -0.5, WOUND),
    tube(0.035, 0.03, 0.4, -0.25, 0, 1.25, -1.15, SKIN),         // the little tail
  ];
  if (RICH) {
    // Folds of skin round the barrel, behind the shoulders and before the rump,
    // and round the top of each leg
    for (const [z, rx, ry] of [[0.15, 0.68, 0.56], [-0.25, 0.66, 0.55]]) {
      parts.push(part(new THREE.TorusGeometry(1, 0.035, 6, 32).scale(rx, ry, 1).translate(0, 1.15, z), FOLD));
    }
    for (const [x, z] of [[0.33, 0.6], [-0.33, 0.6], [0.33, -0.65], [-0.33, -0.65]]) {
      parts.push(part(new THREE.TorusGeometry(0.2, 0.03, 5, 16).rotateX(Math.PI / 2).translate(x, 0.8, z), FOLD));
    }
    parts.push(ball(0.05, 1, 1, 1.4, 0.12, 1.44, 1.06, 0x3a3834), ball(0.05, 1, 1, 1.4, -0.12, 1.44, 1.06, 0x3a3834)); // ear tufts
  }
  return mergeGeometries(parts);
}

/* --- What each one is ---------------------------------------------------- */
// Four legs: hips at front (xf, y, zf) and back (xh, y, zh); `off` places each
// leg in the stride (the gait), `sign` the way its knee folds
const GAITS = {
  bound: [0, 0.35, Math.PI, Math.PI + 0.35],         // front pair together, hind pair together
  gallop: [0, 0.5, Math.PI + 0.3, Math.PI + 0.8],     // one after another, round
  trot: [0, Math.PI, Math.PI, 0],                     // the diagonals together
};
const four = (xf, yf, zf, xh, yh, zh, gait) => [[xf, yf, zf], [-xf, yf, zf], [xh, yh, zh], [-xh, yh, zh]]
  .map((hip, k) => ({ hip, off: GAITS[gait][k], sign: k < 2 ? -1 : 1 }));
const SPECIES = {
  lion: {
    bodies: [lionBody(true), lionBody(false)], leg: 0x8e7350, foot: 0x7e6546,
    upper: [0.42, 0.1], lower: [0.42, 0.065], footShape: [0.085, 0.047, 0.115, 0.035],
    legs: four(0.19, 0.86, 0.46, 0.19, 0.86, -0.5, 'bound'),
    gait: { swing0: 0, amp: 0.7, bend0: 0.15, lift: 0.85, stride: 2.2 }, bob: 0.08,
    speed: [6.0, 7.2], health: 2, bite: [1.7, 9, 0.9], r: 0.55,
    hits: [[0, 0.98, 0.62, false], [0.98, 1.3, 0.3, true]], roar: [0.6, 0.16, 160], haze: 0.32,
  },
  cheetah: {
    bodies: [cheetahBody()], leg: 0xb08c52, foot: 0x9a7a48,
    upper: [0.4, 0.065], lower: [0.38, 0.045], footShape: [0.06, 0.035, 0.085, 0.03],
    legs: four(0.13, 0.78, 0.4, 0.13, 0.78, -0.44, 'bound'),
    gait: { swing0: 0, amp: 0.95, bend0: 0.15, lift: 1.0, stride: 1.7 }, bob: 0.06,
    // Faster than you sprint (8.4), for a few seconds; then it tires and slows
    speed: [8.6, 9.2], burst: { run: 3.5, rest: 2.5, slow: 0.5 },
    health: 1, bite: [1.5, 7, 0.7], r: 0.45,
    hits: [[0, 1.0, 0.45, false], [0.8, 1.28, 0.18, true]], roar: [0.35, 0.12, 520], haze: 0.28,
  },
  zebra: {
    bodies: [zebraBody()], leg: 0xb4afa4, foot: 0x1a1816,
    upper: [0.45, 0.085], lower: [0.5, 0.05], footShape: [0.065, 0.055, 0.075, 0.01],
    legs: four(0.2, 0.95, 0.5, 0.2, 0.95, -0.55, 'gallop'),
    gait: { swing0: 0, amp: 0.65, bend0: 0.12, lift: 0.9, stride: 1.9 }, bob: 0.1,
    speed: [6.4, 7.2], health: 2, bite: [1.9, 8, 0.85], r: 0.6,
    hits: [[0, 1.25, 0.6, false], [0.75, 1.62, 0.25, false], [1.2, 1.85, 0.22, true]], roar: [0.5, 0.14, 300], haze: 0.32,
  },
  ostrich: {
    bodies: [ostrichBody()], leg: 0x9a8478, foot: 0x6a5a50,
    upper: [0.55, 0.07], lower: [0.55, 0.04], footShape: [0.06, 0.035, 0.15, 0.07],
    // Two legs, the joint you see folding backward (the thigh tucked in the body)
    legs: [{ hip: [0.18, 1.04, 0.02], off: 0, sign: -1 }, { hip: [-0.18, 1.04, 0.02], off: Math.PI, sign: -1 }],
    gait: { swing0: 0.3, amp: 0.6, bend0: 0.6, lift: 0.7, stride: 2.4 }, bob: 0.06,
    speed: [7.4, 8.0], health: 1, bite: [1.6, 7, 0.7], r: 0.45,
    hits: [[0, 1.3, 0.55, false], [0.45, 1.95, 0.15, false], [0.54, 2.44, 0.14, true]], roar: [0.3, 0.12, 700], haze: 0.36,
  },
  rhino: {
    bodies: [rhinoBody()], leg: 0x67645e, foot: 0x4a4844,
    upper: [0.42, 0.2], lower: [0.35, 0.16], footShape: [0.19, 0.08, 0.21, 0.03],
    legs: four(0.33, 0.77, 0.6, 0.33, 0.77, -0.65, 'trot'),
    gait: { swing0: 0, amp: 0.45, bend0: 0.12, lift: 0.6, stride: 2.6 }, bob: 0.05,
    // Slow, until it has you lined up from a way off: then it charges
    speed: [5.0, 5.6], charge: [4, 18, 1.45],
    health: 6, easyHealth: 2, bite: [2.4, 16, 1.3], r: 0.95,
    hits: [[0, 1.15, 0.95, false], [1.4, 1.05, 0.4, true]], roar: [0.8, 0.22, 80], haze: 0.22,
  },
};

/* --- The legs: every animal's, in three instanced meshes ------------------ */
// Unit-sized and scaled per leg: a thigh and a shin hung from their tops, a foot
const UPPER = new THREE.CylinderGeometry(1, 0.75, 1, CYL).translate(0, -0.5, 0);
const LOWER = new THREE.CylinderGeometry(1, 0.85, 1, CYL).translate(0, -0.5, 0);
const FOOT = sphere(1, RICH ? [12, 8] : [8, 6]);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4(), _knee = new THREE.Matrix4(), _t = new THREE.Matrix4(), _r = new THREE.Matrix4(), _s = new THREE.Matrix4();
const _d = new THREE.Vector3(), _c = new THREE.Vector3(), _hit = new THREE.Vector3(), _sphere = new THREE.Sphere();
const BODY_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

export function createZooAnimals() {
  // Easy (Difficulty.js): one of each, and a shot or two (created after the
  // difficulty is set)
  const easy = state.difficulty === 'easy';
  const kinds = easy ? EASY_PACK : PACK;
  const legCount = kinds.reduce((n, k) => n + SPECIES[k].legs.length, 0);
  const legMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const uppers = new THREE.InstancedMesh(UPPER, legMat, legCount), lowers = new THREE.InstancedMesh(LOWER, legMat, legCount), feet = new THREE.InstancedMesh(FOOT, legMat, legCount);
  for (const legs of [uppers, lowers, feet]) {
    legs.name = 'zoo-animal-legs';
    legs.castShadow = true;
    legs.frustumCulled = false;
    scene.add(legs);
  }
  let legAt = 0;
  const counts = {};
  const animals = kinds.map((kind) => {
    const sp = SPECIES[kind], n = (counts[kind] = (counts[kind] || 0) + 1) - 1;
    const mesh = new THREE.Mesh(sp.bodies[n % sp.bodies.length], BODY_MATERIAL);
    mesh.name = `zoo-${kind}`;
    mesh.castShadow = true;
    mesh.visible = false;
    scene.add(mesh);
    const a = { kind, sp, mesh, legs: legAt, p: new THREE.Vector3(), yaw: 0, speed: 6, health: 1, phase: 0, bite: 0, haze: 0, burst: 0, tired: false, alive: false, deadFor: -1, nav: createNavigator() };
    sp.legs.forEach((_, k) => {
      _col.set(sp.leg); uppers.setColorAt(legAt + k, _col); lowers.setColorAt(legAt + k, _col);
      _col.set(sp.foot); feet.setColorAt(legAt + k, _col);
    });
    legAt += sp.legs.length;
    return a;
  });
  for (const legs of [uppers, lowers, feet]) legs.instanceColor.needsUpdate = true;
  let queue = 0, nextIn = 0;

  function bringOut(a, i) {
    const [x, z] = FROM[i % FROM.length], spread = i >= FROM.length ? 1.6 : 0; // the second round a little apart
    a.p.set(x - spread, 0, z + spread);
    a.yaw = Math.PI / 2; // facing east, toward the main street
    a.speed = a.sp.speed[0] + Math.random() * (a.sp.speed[1] - a.sp.speed[0]);
    a.health = easy ? (a.sp.easyHealth || 1) : a.sp.health;
    a.phase = Math.random() * 6;
    a.bite = 0;
    a.haze = Math.random() * a.sp.haze;
    a.burst = a.sp.burst ? a.sp.burst.run : 0;
    a.tired = false;
    a.alive = true;
    a.deadFor = -1;
    a.mesh.visible = true;
    sfx.noise(...a.sp.roar); // its cry
  }

  function die(a, from) {
    a.alive = false;
    a.deadFor = 0;
    placeBloodSplat(a.p);
    spawnBloodSpray(_c.set(a.p.x, a.sp.hits[0][1], a.p.z), from, true, 0);
    sfx.noise(0.3, 0.1, 220);
    pushKillFeed(`Infected ${a.kind} down`);
  }

  // One leg: thigh at the hip swung by `swing`, shin bent at the knee by
  // `bend`, the foot at the shin's end
  function poseLeg(i, body, leg, sp, swing, bend) {
    const [ul, ur] = sp.upper, [ll, lr] = sp.lower, [fx, fy, fz, fo] = sp.footShape;
    _knee.copy(body).multiply(_t.makeTranslation(leg.hip[0], leg.hip[1], leg.hip[2])).multiply(_r.makeRotationX(swing));
    uppers.setMatrixAt(i, _m.copy(_knee).multiply(_s.makeScale(ur, ul, ur)));
    _knee.multiply(_t.makeTranslation(0, -ul, 0)).multiply(_r.makeRotationX(bend));
    lowers.setMatrixAt(i, _m.copy(_knee).multiply(_s.makeScale(lr, ll, lr)));
    feet.setMatrixAt(i, _m.copy(_knee).multiply(_t.makeTranslation(0, -ll, fo)).multiply(_s.makeScale(fx, fy, fz)));
  }

  return {
    /** The quake broke the fence: they start coming, a little apart. */
    release() { queue = animals.length; nextIn = 0; },
    get loose() { return animals.some((a) => a.alive) || queue > 0; },

    update(dt, playerPos) {
      if (queue > 0 && (nextIn -= dt) <= 0) { const i = animals.length - queue; bringOut(animals[i], i); queue--; nextIn = RELEASE_GAP; }
      const frozen = state.paused || state.isDead || state.cinematic || state.narrativeBlocked;
      for (const a of animals) {
        const sp = a.sp;
        if (!a.mesh.visible) {
          for (let k = 0; k < sp.legs.length; k++) { uppers.setMatrixAt(a.legs + k, HIDDEN); lowers.setMatrixAt(a.legs + k, HIDDEN); feet.setMatrixAt(a.legs + k, HIDDEN); }
          continue;
        }
        let running = false;
        if (!frozen && a.alive) {
          // Out of the side street first, then straight at you
          const target = a.p.x < -STREET_HALF_W - 2 ? ENTRY : playerPos;
          const to = navGoal(a.nav, a.p, target, dt); // straight, or round the walls (ZombieNav.js)
          _d.set(to.x - a.p.x, 0, to.z - a.p.z);
          const toPlayer = Math.hypot(playerPos.x - a.p.x, playerPos.z - a.p.z);
          let speed = a.speed;
          if (sp.burst && (a.burst -= dt) <= 0) { a.tired = !a.tired; a.burst = a.tired ? sp.burst.rest : sp.burst.run; }
          if (a.tired) speed *= sp.burst.slow;                                                 // the cheetah, spent
          if (sp.charge && toPlayer > sp.charge[0] && toPlayer < sp.charge[1]) speed *= sp.charge[2]; // the rhino, charging
          const [reach, damage, every] = sp.bite;
          if (toPlayer < reach) {
            a.bite -= dt;
            if (a.bite <= 0) { a.bite = every; damagePlayer(damage * (state.zombieDamageMul || 1)); }
            _d.subVectors(playerPos, a.p).setY(0);
            a.phase += dt * 4;
          } else if (_d.lengthSq() > 1e-4) {
            _d.normalize();
            a.p.addScaledVector(_d, speed * dt);
            a.phase += dt * speed * sp.gait.stride;
            running = true;
          }
          // Solid against the infected, the girl, each other, you, and the walls last
          pushOutOfBodies(a.p, sp.r);
          for (const b of animals) {
            if (b === a || !b.alive) continue;
            const dx = a.p.x - b.p.x, dz = a.p.z - b.p.z, min = sp.r + b.sp.r, d2 = dx * dx + dz * dz;
            if (d2 < min * min) { const d = Math.sqrt(d2) || 1e-4; a.p.x += (dx / d) * (min - d) / 2; a.p.z += (dz / d) * (min - d) / 2; }
          }
          if (!state.inVehicle && !state.dying) pushPlayerFrom(a.p.x, a.p.z, sp.r);
          pushOutOfSolids(a.p, sp.r);
          if (_d.lengthSq() > 1e-4) {
            const want = Math.atan2(_d.x, _d.z);
            let diff = want - a.yaw;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            a.yaw += diff * Math.min(1, dt * 8);
          }
          // Brown air hanging behind it as it runs
          if (running && (a.haze -= dt) <= 0) {
            a.haze = sp.haze;
            const back = sp.r * 2.4;
            trailHaze(_c.set(a.p.x - Math.sin(a.yaw) * back, 0, a.p.z - Math.cos(a.yaw) * back));
          }
        } else if (!a.alive && a.deadFor >= 0 && !frozen) {
          a.deadFor += dt;
          if (a.deadFor > 9) a.mesh.visible = false; // gone with the rest of the dead
        }
        // The body: a bob and a little pitch alive, rolled onto its side dead
        const roll = a.alive ? 0 : Math.min(1, a.deadFor / 0.35) * Math.PI / 2;
        const bob = a.alive ? Math.abs(Math.sin(a.phase)) * sp.bob : 0.05;
        a.mesh.position.set(a.p.x, bob, a.p.z);
        a.mesh.rotation.set(running ? Math.sin(a.phase * 2) * 0.05 : 0, a.yaw, roll, 'YXZ');
        a.mesh.updateMatrix();
        // Each leg in its place in the stride: it swings, and folds at the
        // knee most as it lifts
        const g = sp.gait;
        sp.legs.forEach((leg, k) => {
          const step = a.phase + leg.off;
          const swing = g.swing0 + (a.alive ? Math.sin(step) * g.amp * (running ? 1 : 0.2) : 0.3);
          const lift = a.alive ? Math.max(0, Math.cos(step)) * (running ? 1 : 0.3) : 0.2;
          poseLeg(a.legs + k, a.mesh.matrix, leg, sp, swing, leg.sign * (g.bend0 + g.lift * lift));
        });
      }
      uppers.instanceMatrix.needsUpdate = true;
      lowers.instanceMatrix.needsUpdate = true;
      feet.instanceMatrix.needsUpdate = true;
    },

    /** For tryShoot (state.extraShotTargets): the nearest animal on the ray. */
    rayHit(ray, far) {
      let best = null;
      for (const a of animals) {
        if (!a.alive) continue;
        const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
        for (const [fwd, oy, r, head] of a.sp.hits) {
          _sphere.center.set(a.p.x + fx * fwd, oy, a.p.z + fz * fwd);
          _sphere.radius = r;
          if (!ray.intersectSphere(_sphere, _hit)) continue;
          const distance = ray.origin.distanceTo(_hit);
          if (distance > far || (best && distance >= best.distance)) continue;
          const point = _hit.clone(), target = a, isHead = head;
          best = {
            distance, point,
            hit: (direction) => {
              if (!target.alive) return;
              // A head shot drops most of them; the rhino takes three to the head
              target.health -= isHead ? Math.max(2, Math.ceil(target.sp.health / 3)) : 1;
              spawnBloodSpray(point, direction, isHead, 0);
              sfx.hit();
              if (target.health <= 0) die(target, direction);
            },
          };
        }
      }
      return best;
    },

    reset() {
      queue = 0;
      for (const a of animals) { a.alive = false; a.deadFor = -1; a.mesh.visible = false; }
    },
  };
}
