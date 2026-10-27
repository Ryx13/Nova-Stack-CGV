import * as THREE from 'three';
import {EnemyCrowd} from './EnemyCrowd.js';
import { buildKitBuilding } from './CityKit.js';
import { buildCityGround } from './CityGround.js';
import { buildTown } from './CityTown.js';
import { CircleGrid } from './SpatialGrid.js';
import { asphaltRoughness } from './ContactShading.js';
import { streetlightBeamMaterial } from './survivor.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as CANNON from 'cannon-es';
import { state } from './state.js';
import {
  scene, world, camera, dom, sfx, registerStreetLight, acquireEffectLight, releaseEffectLight,
  addStaticBox, addObstacle, pushKillFeed, flashDamage, markLoaded, updateObjectiveHUD,
  STREET_HALF_W, STREET_LENGTH, KILL_TARGET, ZOMBIE_MAX_ALIVE, DEPOT_POS, WEST_POCKET_Z, rowX,
  matPlayer, matChassis,
  addLight,
} from './Scene.js';
import { spawnPickup, spawnCoin, registerKillstreak } from './PowerUps.js';
import { damagePlayer, spawnHitSpark, spawnBlood } from './Actions.js';
import { createFireMaterial, createToxicMaterial } from './shaders.js';
import { getSelectedCharacter, instantiateCharacter, clipsFor, boneByName } from './roster.js';

/* ======================================================================
   characters.js — LOADING/CREATION OF CHARACTERS AND SCENE OBJECTS

   Despite the name this covers everything game.js used to build: the
   player, zombies, the drivable truck, decorative wrecked cars,
   buildings, obstacles, trash cans, and the textures they all share.
====================================================================== */

/* ---------------------------------------------------------------------
   RNG — deterministic world generation
--------------------------------------------------------------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export const rnd = mulberry32(0xDEAD01);

/* ---------------------------------------------------------------------
   TEXTURE HELPERS — shared by buildings, road, wrecks, etc.
--------------------------------------------------------------------- */
export function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

// Derives a tileable normal map from a painted grayscale height canvas —
// `heightDraw` should paint brightness-as-elevation (mid-grey #808080 is
// "flat", lighter is raised, darker is recessed), the same way the colour
// textures below paint diffuse detail. A simple central-difference slope
// (sampled with wraparound so it repeats cleanly) is converted straight
// into a packed (x,y,z)->(r,g,b) tangent-space normal. This is what lets
// MeshStandardMaterial actually catch light across bumps/pebbles/cracks
// instead of just showing a flat-shaded painted-on picture of them.
export function makeNormalMap(w, h, heightDraw, strength = 1.6) {
  const src = makeCanvas(w, h, heightDraw).getContext('2d').getImageData(0, 0, w, h).data;
  const heightAt = (x, y) => {
    const i = (((y + h) % h) * w + ((x + w) % w)) * 4;
    return src[i] / 255;
  };
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (heightAt(x - 1, y) - heightAt(x + 1, y)) * strength;
      const dy = (heightAt(x, y - 1) - heightAt(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1.0);
      const i = (y * w + x) * 4;
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1.0 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(out);
}

export const asphaltTex = new THREE.CanvasTexture(makeCanvas(512, 512, (ctx, w, h) => {
  ctx.fillStyle = '#2a2b2c'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 5000; i++) {
    const v = 18 + Math.random() * 28;
    ctx.fillStyle = `rgba(${v},${v},${v + 2},${Math.random() * 0.55})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  ctx.strokeStyle = 'rgba(8,8,8,0.55)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    let x = Math.random() * w, y = Math.random() * h;
    ctx.moveTo(x, y);
    for (let j = 0; j < 8; j++) {
      x += (Math.random() - 0.5) * 50; y += (Math.random() - 0.5) * 50;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 12 + Math.random() * 30;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(5,6,8,0.5)');
    grad.addColorStop(0.6, 'rgba(5,6,8,0.22)');
    grad.addColorStop(1, 'rgba(5,6,8,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 3; i++) {
    const startX = Math.random() * w, startY = Math.random() * h;
    const angle = Math.random() * Math.PI * 2;
    const len = 80 + Math.random() * 140;
    const curve = (Math.random() - 0.5) * 0.6;
    ctx.strokeStyle = 'rgba(10,10,10,0.4)';
    ctx.lineWidth = 3;
    [-4, 4].forEach((offset) => {
      ctx.beginPath();
      for (let t = 0; t <= 1; t += 0.05) {
        const a = angle + curve * t;
        const px = startX + Math.cos(a) * len * t + Math.cos(a + Math.PI / 2) * offset;
        const py = startY + Math.sin(a) * len * t + Math.sin(a + Math.PI / 2) * offset;
        t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    });
  }
  for (let i = 0; i < 4; i++) {
    const pw = 30 + Math.random() * 60, ph = 20 + Math.random() * 40;
    const px = Math.random() * w, py = Math.random() * h;
    ctx.fillStyle = `rgba(${40 + Math.random() * 15},${40 + Math.random() * 15},${42},${0.25 + Math.random() * 0.2})`;
    ctx.fillRect(px, py, pw, ph);
  }
}));
asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
asphaltTex.repeat.set(6, 40);
asphaltTex.anisotropy = 8;
const roadRoughnessTex=asphaltRoughness(asphaltTex);

// Bump detail for the road — grit specks plus a few embossed cracks,
// painted at the same relative scale/density as asphaltTex's own detail
// so the two line up when tiled together.
export const asphaltNormalTex = makeNormalMap(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2200; i++) {
    const v = 110 + Math.random() * 110;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
  ctx.strokeStyle = 'rgba(30,30,30,0.8)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    let x = Math.random() * w, y = Math.random() * h;
    ctx.moveTo(x, y);
    for (let j = 0; j < 6; j++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}, 1.4);
asphaltNormalTex.wrapS = asphaltNormalTex.wrapT = THREE.RepeatWrapping;
asphaltNormalTex.repeat.copy(asphaltTex.repeat);

export const sidewalkTex = new THREE.CanvasTexture(makeCanvas(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#6a655c'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(40,38,34,0.45)';
  for (let x = 0; x < w; x += 32) {
    for (let y = 0; y < h; y += 32) {
      ctx.strokeRect(x + 1, y + 1, 30, 30);
    }
  }
  for (let i = 0; i < 200; i++) {
    const v = 80 + Math.random() * 40;
    ctx.fillStyle = `rgba(${v},${v - 6},${v - 14},0.25)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  for (let i = 0; i < 10; i++) {
    const gx = Math.floor(Math.random() * 4) * 32 + 1, gy = Math.floor(Math.random() * 4) * 32;
    ctx.strokeStyle = `rgba(${50 + Math.random() * 20},${75 + Math.random() * 20},${30},0.55)`;
    ctx.lineWidth = 1;
    for (let b = 0; b < 3; b++) {
      ctx.beginPath();
      ctx.moveTo(gx + Math.random() * 30, gy);
      ctx.lineTo(gx + Math.random() * 30, gy - 4 - Math.random() * 5);
      ctx.stroke();
    }
  }
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 4 + Math.random() * 8;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(20,20,18,0.35)');
    grad.addColorStop(1, 'rgba(20,20,18,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}));
sidewalkTex.wrapS = sidewalkTex.wrapT = THREE.RepeatWrapping;
sidewalkTex.repeat.set(2, 40);

export const laneTex = new THREE.CanvasTexture(makeCanvas(64, 512, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(220,190,80,0.8)';
  for (let y = 0; y < h; y += 90) ctx.fillRect(w / 2 - 3, y, 6, 42);
}));
laneTex.wrapS = laneTex.wrapT = THREE.RepeatWrapping;
laneTex.repeat.set(1, 18);
laneTex.transparent = true;

// Three window-grid variants at different lit densities — buildings
// pick one at random so adjacent facades don't repeat the same pattern.
// The same canvas doubles as each building's emissiveMap (makeBuilding),
// so at night the lit windows actually glow instead of merely being
// bright texels under streetlight falloff.
function makeWindowTexture(litChance) {
  const tex = new THREE.CanvasTexture(makeCanvas(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2a2724'; ctx.fillRect(0, 0, w, h);
    const cols = 5, rows = 10;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cw = w / cols, rh = h / rows;
        const roll = Math.random();
        if (roll < litChance) {
          ctx.fillStyle = `rgba(255,${170 + Math.random() * 50},90,0.95)`;
          ctx.fillRect(c * cw + 4, r * rh + 4, cw - 8, rh - 8);
        } else if (roll < litChance + 0.06) {
          // boarded-up — a few dead windows per facade sell the abandonment
          ctx.fillStyle = '#3a2e22';
          ctx.fillRect(c * cw + 3, r * rh + 4, cw - 6, rh - 8);
          ctx.strokeStyle = 'rgba(18,13,8,0.8)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(c * cw + 3, r * rh + rh / 2 - 2); ctx.lineTo(c * cw + cw - 3, r * rh + rh / 2 - 2);
          ctx.moveTo(c * cw + 3, r * rh + rh / 2 + 2); ctx.lineTo(c * cw + cw - 3, r * rh + rh / 2 + 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(8,9,11,0.92)';
          ctx.fillRect(c * cw + 4, r * rh + 4, cw - 8, rh - 8);
        }
      }
    }
  }));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
export const windowTex = makeWindowTexture(0.18); // kept exported for compatibility
export const windowTexVariants = [makeWindowTexture(0.035), makeWindowTexture(0.07), makeWindowTexture(0.12)];

/* DAYLIGHT FACADES (clear-day levels) — nothing glows in daylight, and an
   abandoned block looks it: one tile is two storeys (6.4 m) by three bays
   (7.5 m) at real proportions, each window dark glass catching the sky,
   smashed, boarded, or burnt out with soot licking up the wall above,
   and grime streaking down from every sill. Light plaster/concrete base
   so the per-building tint and the sun do the shading. Built only when a
   clear-day level asks for one. */
export const FACADE_TILE_W = 7.5;
export const FACADE_TILE_H = 6.4;
let dayFacadeVariants = null;
export function dayFacades() {
  if (!dayFacadeVariants) dayFacadeVariants = [0, 1, 2, 3].map(() => makeDayFacadeTexture());
  return dayFacadeVariants;
}
function makeDayFacadeTexture() {
  const tex = new THREE.CanvasTexture(makeCanvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d9d0c4'; ctx.fillRect(0, 0, w, h);
    // plaster mottling
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '40,34,28' : '255,250,240'},${(Math.random() * 0.07).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 18, 0, Math.PI * 2); ctx.fill();
    }
    const storeyH = h / 2, bayW = w / 3;
    for (let r = 0; r < 2; r++) {
      // floor-line ledge
      ctx.fillStyle = 'rgba(60,52,44,0.35)'; ctx.fillRect(0, r * storeyH + storeyH - 6, w, 4);
      for (let c = 0; c < 3; c++) {
        const x = c * bayW + bayW * 0.24, y = r * storeyH + storeyH * 0.22;
        const ww = bayW * 0.52, wh = storeyH * 0.5;
        const roll = Math.random();
        // sill grime runs down the wall below every window
        for (let k = 0; k < 6; k++) {
          const sx = x + Math.random() * ww;
          const g = ctx.createLinearGradient(0, y + wh, 0, y + wh + 20 + Math.random() * 40);
          g.addColorStop(0, 'rgba(45,38,30,0.35)'); g.addColorStop(1, 'rgba(45,38,30,0)');
          ctx.fillStyle = g; ctx.fillRect(sx, y + wh, 1.5 + Math.random() * 2.5, 60);
        }
        if (roll < 0.18) {
          // burnt out: black hole, soot plume up the wall
          const g = ctx.createLinearGradient(0, y + wh, 0, y - storeyH * 0.55);
          g.addColorStop(0, 'rgba(20,16,12,0.85)'); g.addColorStop(1, 'rgba(20,16,12,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(x - 4, y + wh); ctx.lineTo(x + ww + 4, y + wh);
          ctx.lineTo(x + ww + 14, y - storeyH * 0.5); ctx.lineTo(x - 14, y - storeyH * 0.5);
          ctx.fill();
          ctx.fillStyle = '#0b0907'; ctx.fillRect(x, y, ww, wh);
        } else {
          // frame + reveal
          ctx.fillStyle = '#3b342d'; ctx.fillRect(x - 3, y - 3, ww + 6, wh + 6);
          if (roll < 0.36) {
            // boarded up
            ctx.fillStyle = '#5a4630'; ctx.fillRect(x, y, ww, wh);
            ctx.strokeStyle = 'rgba(25,18,10,0.7)'; ctx.lineWidth = 1.5;
            for (let b = 1; b < 5; b++) { ctx.beginPath(); ctx.moveTo(x, y + (wh * b) / 5); ctx.lineTo(x + ww, y + (wh * b) / 5); ctx.stroke(); }
            ctx.fillStyle = '#6b5539'; ctx.save(); ctx.translate(x + ww / 2, y + wh / 2); ctx.rotate(-0.5); ctx.fillRect(-ww * 0.65, -4, ww * 1.3, 8); ctx.restore();
          } else {
            // glass: dark interior, sky reflection brightening toward the top
            const g = ctx.createLinearGradient(0, y, 0, y + wh);
            g.addColorStop(0, '#6d6f70'); g.addColorStop(0.45, '#2b2d2f'); g.addColorStop(1, '#131415');
            ctx.fillStyle = g; ctx.fillRect(x, y, ww, wh);
            ctx.fillStyle = '#3b342d'; ctx.fillRect(x + ww / 2 - 1.5, y, 3, wh); // mullion
            if (roll < 0.62) {
              // smashed: a dark hole with jagged shards left in the frame
              ctx.fillStyle = '#0d0d0e';
              ctx.beginPath();
              const cx = x + ww * (0.3 + Math.random() * 0.4), cy = y + wh * (0.3 + Math.random() * 0.4);
              for (let a = 0; a < 9; a++) {
                const ang = (a / 9) * Math.PI * 2, rr = Math.min(ww, wh) * (0.2 + Math.random() * 0.35);
                ctx.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
              }
              ctx.fill();
            }
          }
        }
      }
    }
    // weather streaks top to bottom + darkening toward the ground
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(50,42,34,${(Math.random() * 0.08).toFixed(3)})`;
      ctx.fillRect(Math.random() * w, 0, 1 + Math.random() * 3, h);
    }
  }));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Shared radial glow sprite for streetlight heads (and any future prop
// dressing) — one texture, many sprites.
const streetGlowTex = new THREE.CanvasTexture(makeCanvas(64, 64, (ctx) => {
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,244,214,1)');
  g.addColorStop(0.35, 'rgba(255,196,112,.55)');
  g.addColorStop(1, 'rgba(255,196,112,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
}));

/* ---------------------------------------------------------------------
   NEON SIGNS — canvas-text panels on the street faces of a random
   subset of buildings. No extra scene lights: the panel is unlit
   MeshBasicMaterial (always readable) plus one soft additive sprite for
   the halo — together they read as neon without paying a PointLight
   per sign.
--------------------------------------------------------------------- */
const NEON_WORDS = ['DINER', 'MOTEL', 'BAR', 'PAWN', 'LIQUOR', '24 HR', 'CASH', 'HOTEL'];
const NEON_COLORS = ['#ff5a5a', '#37c8ff', '#ffb84a', '#7dff9a', '#ff7ad9'];
const neonTexCache = new Map();
function makeNeonTexture(word, color, vertical = false) {
  const key = word + '|' + color + '|' + (vertical ? 'v' : 'h');
  if (neonTexCache.has(key)) return neonTexCache.get(key);
  const chars = word.split('');
  const tex = new THREE.CanvasTexture(makeCanvas(vertical ? 96 : 256, vertical ? chars.length * 58 + 40 : 96, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.shadowColor = color;
    ctx.shadowBlur = vertical ? 16 : 22;
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.font = '700 44px Oswald, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const drawText = () => {
      if (vertical) chars.forEach((ch, i) => { if (ch !== ' ') ctx.fillText(ch, w / 2, 44 + i * 58); });
      else ctx.fillText(word, w / 2, h / 2 + 2);
    };
    ctx.fillStyle = '#fff';
    drawText();
    ctx.shadowBlur = 10; // second pass — hotter core on the letters
    ctx.fillStyle = color;
    drawText();
  }));
  neonTexCache.set(key, tex);
  return tex;
}
const neonGlowTex = new THREE.CanvasTexture(makeCanvas(128, 128, (ctx) => {
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
}));
function addNeonSign(g, w, d, streetSide, night, dead = false) {
  const word = NEON_WORDS[Math.floor(rnd() * NEON_WORDS.length)];
  const color = NEON_COLORS[Math.floor(rnd() * NEON_COLORS.length)];
  // ~45% mount as a "blade" sign sticking out perpendicular to the facade
  // with the word stacked vertically — the classic roadside-diner mount,
  // readable from far down the street instead of only once you're nearly
  // abreast of the building. The rest stay flat on the facade itself.
  const blade = rnd() < 0.45;
  const panel = blade
    ? new THREE.Mesh(
        new THREE.PlaneGeometry(0.95, 3.6),
        new THREE.MeshBasicMaterial({ map: makeNeonTexture(word, color, true), transparent: true, fog: false, side: THREE.DoubleSide })
      )
    : new THREE.Mesh(
        new THREE.PlaneGeometry(2.9, 1.05),
        new THREE.MeshBasicMaterial({ map: makeNeonTexture(word, color), transparent: true, fog: false })
      );
  if (blade) {
    panel.position.set(streetSide * (w / 2 + 0.85), 4.9 + rnd() * 1.4, (rnd() - 0.5) * d * 0.5);
    // no yaw: the plane already faces along the street (±z), and
    // DoubleSide covers both approach directions.
  } else {
    panel.position.set(streetSide * (w / 2 + 0.09), 4.4 + rnd() * 1.6, (rnd() - 0.5) * d * 0.55);
    panel.rotation.y = streetSide > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  panel.userData.neonSign = !dead;
  g.add(panel);
  if (dead) {
    // Daylight in a dead city: the sign hangs there switched off — tube
    // colours dulled to grey-tinted glass, no glow
    panel.material.color.setRGB(0.32, 0.3, 0.28);
    return;
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: neonGlowTex, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending, opacity: night ? 0.65 : 0.25,
  }));
  halo.material.color.set(color);
  halo.position.copy(panel.position);
  halo.scale.set(blade ? 4.2 : 6.8, blade ? 8 : 3.1, 1);
  halo.userData.neonSign = true;
  g.add(halo);
}

export const concreteTex = new THREE.CanvasTexture(makeCanvas(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#4d4a44'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) {
    const v = 60 + Math.random() * 40;
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},${Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}));
concreteTex.wrapS = concreteTex.wrapT = THREE.RepeatWrapping;

export const concreteNormalTex = makeNormalMap(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1200; i++) {
    const v = 120 + Math.random() * 100;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}, 1.2);
concreteNormalTex.wrapS = concreteNormalTex.wrapT = THREE.RepeatWrapping;

export const bloodTex = new THREE.CanvasTexture(makeCanvas(64, 64, (ctx, w, h) => {
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(120,8,8,0.85)');
  g.addColorStop(0.5, 'rgba(70,4,4,0.45)');
  g.addColorStop(1, 'rgba(40,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}));

/* ---------------------------------------------------------------------
   NEW TEXTURES — dirt ground, tar roofs, rusted metal, zombie skin.
   Previously the bare ground (dirtMat), every roof, and every zombie's
   skin were flat, untextured colours — the only surfaces in the whole
   level with no map at all. These follow the exact same
   "makeCanvas + CanvasTexture" recipe already used above.
--------------------------------------------------------------------- */
export const dirtTex = new THREE.CanvasTexture(makeCanvas(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#3a3530'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 10 + Math.random() * 26;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = 40 + Math.random() * 30;
    grad.addColorStop(0, `rgba(${v},${v - 6},${v - 12},0.35)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 3000; i++) {
    const v = 25 + Math.random() * 35;
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},${Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
  // Small pebbles, each with a tiny dark shadow so they read as raised
  // even before the normal map (below) does the real lighting work.
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 0.8 + Math.random() * 2.2;
    const v = 70 + Math.random() * 50;
    ctx.fillStyle = `rgba(10,9,8,0.4)`;
    ctx.beginPath(); ctx.arc(x + r * 0.4, y + r * 0.4, r * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(${v},${v - 6},${v - 14},0.85)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(15,13,10,0.5)'; ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    let x = Math.random() * w, y = Math.random() * h;
    ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) { x += (Math.random() - 0.5) * 30; y += (Math.random() - 0.5) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}));
dirtTex.wrapS = dirtTex.wrapT = THREE.RepeatWrapping;
dirtTex.repeat.set(24, 60);
dirtTex.anisotropy = 8;

export const dirtNormalTex = makeNormalMap(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++) {
    const v = 100 + Math.random() * 100;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 1 + Math.random() * 2.5;
    const v = 150 + Math.random() * 90;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}, 2.2);
dirtNormalTex.wrapS = dirtNormalTex.wrapT = THREE.RepeatWrapping;
dirtNormalTex.repeat.copy(dirtTex.repeat);

export const roofTex = new THREE.CanvasTexture(makeCanvas(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#232320'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const v = 35 + Math.random() * 45;
    ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},${0.3 + Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
  // Tar-paper seams
  ctx.strokeStyle = 'rgba(10,10,8,0.6)'; ctx.lineWidth = 2;
  for (let x = 16; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  // Gravel speckle
  for (let i = 0; i < 220; i++) {
    const v = 90 + Math.random() * 60;
    ctx.fillStyle = `rgba(${v},${v - 8},${v - 16},0.5)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}));
roofTex.wrapS = roofTex.wrapT = THREE.RepeatWrapping;
roofTex.repeat.set(3, 3);

export const rustTex = new THREE.CanvasTexture(makeCanvas(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#4a4640'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 8 + Math.random() * 24;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(150,70,25,0.65)');
    grad.addColorStop(0.6, 'rgba(110,50,18,0.35)');
    grad.addColorStop(1, 'rgba(110,50,18,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 700; i++) {
    const v = 40 + Math.random() * 50;
    ctx.fillStyle = `rgba(${v + 20},${v - 6},${v - 20},${Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
}));
rustTex.wrapS = rustTex.wrapT = THREE.RepeatWrapping;
rustTex.repeat.set(2, 2);

export const zombieSkinTex = new THREE.CanvasTexture(makeCanvas(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#9a9a90'; ctx.fillRect(0, 0, w, h);
  // Blotchy decay/bruising, tinted by whichever colour the material using
  // this map multiplies it with (zombieMat1/zombieMat2 below).
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 4 + Math.random() * 14;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(40,20,16,0.5)');
    grad.addColorStop(1, 'rgba(40,20,16,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 2 + Math.random() * 6;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(90,20,20,0.55)');
    grad.addColorStop(1, 'rgba(90,20,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 1400; i++) {
    const v = 60 + Math.random() * 50;
    ctx.fillStyle = `rgba(${v - 30},${v},${v - 40},${Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}));
zombieSkinTex.wrapS = zombieSkinTex.wrapT = THREE.RepeatWrapping;

const smokeTex = new THREE.CanvasTexture(makeCanvas(64, 64, (ctx, w, h) => {
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(70,68,64,0.55)'); g.addColorStop(1, 'rgba(70,68,64,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}));
export function spawnFireEffect(pos, scale = 1) {
  const group = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0.48, depthWrite: false }));
    sp.scale.setScalar((1.6 + Math.random()) * scale);
    sp.position.set(pos.x + (Math.random() - 0.5), pos.y + i * 0.55 * scale, pos.z + (Math.random() - 0.5));
    sp.userData.speed = 0.35 + Math.random() * 0.35;
    sp.userData.baseY = sp.position.y;
    group.add(sp);
  }
  scene.add(group);
  state.smokeGroups.push(group);
}

// Actual flame, drawn beneath the smoke above — previously "burning"
// wrecks had smoke and a point light but no visible fire at all. A cross
// of two perpendicular planes (cheap stand-in for a billboard when the
// camera never gets to fly around freely) is enough for the animated
// fireFragmentShader flame to read correctly from any angle you'd
// actually approach a wreck from at street level.
const flameGeo = new THREE.PlaneGeometry(1.1, 1.9);
export function spawnFlameBillboards(pos, scale = 1) {
  [0, Math.PI / 2].forEach((ry) => {
    const mesh = new THREE.Mesh(flameGeo, createFireMaterial());
    mesh.rotation.y = ry;
    mesh.position.copy(pos);
    mesh.scale.setScalar(scale);
    scene.add(mesh);
  });
}

/* ---------------------------------------------------------------------
   STREET SURFACE (ground/road/sidewalks/curbs/lane markings)

   Lives here rather than in Scene.js because it needs the asphalt/
   sidewalk/lane textures defined above, and Scene.js cannot import this
   file (see the header comment in Scene.js for why that would be a
   circular-import crash). Everything about it — geometry, position,
   materials — is unchanged from the original game.js.
--------------------------------------------------------------------- */
export function loadStreetSurface() {
  const groundGeo = new THREE.PlaneGeometry(STREET_HALF_W * 2 + 70, STREET_LENGTH + 90);
  const dirtMat = new THREE.MeshStandardMaterial({
    map: dirtTex, normalMap: dirtNormalTex, normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 1, metalness: 0,
  });
  const groundMesh = new THREE.Mesh(groundGeo, dirtMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.set(0, -0.02, -STREET_LENGTH / 2 + 20);
  groundMesh.receiveShadow = true;
  groundMesh.material.userData.staticLampHeight = groundMesh.position.y;
  scene.add(groundMesh);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(STREET_HALF_W * 2, STREET_LENGTH + 70),
    new THREE.MeshStandardMaterial({
      map: asphaltTex, roughnessMap: roadRoughnessTex, normalMap: asphaltNormalTex, normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.95, metalness: 0,
    })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.005, -STREET_LENGTH / 2 + 20);
  road.receiveShadow = true;
  road.material.userData.staticLampHeight = road.position.y;
  scene.add(road);
  // A district (state.cityKit) gets CityGround.js's slabs, kerbs and junctions
  if (state.cityKit) buildCityGround(road.material);
  else [-1, 1].forEach((side) => {
    const walk = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, STREET_LENGTH + 70),
      new THREE.MeshStandardMaterial({ map: sidewalkTex, roughness: 0.92 })
    );
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(side * (STREET_HALF_W + 2.1), 0.03, -STREET_LENGTH / 2 + 20);
    walk.receiveShadow = true;
    walk.material.userData.staticLampHeight = walk.position.y;
    scene.add(walk);
    const curbNormalTex = concreteNormalTex.clone();
    curbNormalTex.needsUpdate = true;
    curbNormalTex.wrapS = curbNormalTex.wrapT = THREE.RepeatWrapping;
    curbNormalTex.repeat.set(1, 60);
    const curb = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.16, STREET_LENGTH + 70),
      // Concrete normal map (tiled along the run) gives the curb a
      // chipped-stone read instead of a flat bar.
      new THREE.MeshStandardMaterial({
        color: 0x6e6a62, roughness: 0.9,
        normalMap: curbNormalTex, normalScale: new THREE.Vector2(0.6, 0.6),
      })
    );
    curb.position.set(side * STREET_HALF_W, 0.08, -STREET_LENGTH / 2 + 20);
    curb.castShadow = true; curb.receiveShadow = true;
    scene.add(curb);
  });
  const laneMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.45, STREET_LENGTH + 60),
    new THREE.MeshBasicMaterial({ map: laneTex, transparent: true, opacity: 0.85, depthWrite: false })
  );
  laneMesh.rotation.x = -Math.PI / 2;
  laneMesh.position.set(0, 0.02, -STREET_LENGTH / 2 + 20);
  scene.add(laneMesh);
  // Manhole covers — a few dark iron discs scattered down the lanes;
  // purely cosmetic, but they break up the asphalt's repetition.
  const manholeMat = new THREE.MeshStandardMaterial({ color: 0x232628, roughness: 0.55, metalness: 0.75 });
  for (let i = 0; i < 7; i++) {
    const mh = new THREE.Mesh(new THREE.CircleGeometry(0.55, 18), manholeMat);
    mh.rotation.x = -Math.PI / 2;
    mh.position.set((rnd() < 0.5 ? -1 : 1) * (2.2 + rnd() * 3.5), 0.011, 16 - rnd() * (STREET_LENGTH - 6));
    mh.receiveShadow = true;
    scene.add(mh);
  }
  // Road paint at the depot cross-street junction: a zebra crossing over
  // the main road plus a stop line, so the side road reads as a real
  // intersection instead of a driveway. renderOrder + depthWrite:false
  // layer the transparent paint above the lane markings without fighting.
  if (state.cityKit) return; // CityGround.js paints its own junctions
  const paintMat = new THREE.MeshBasicMaterial({ color: 0xd8d5c8, transparent: true, opacity: 0.5, depthWrite: false });
  const crossZ = DEPOT_POS.z + 6.5;
  for (let i = 0; i < 7; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 2.6), paintMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(-8.4 + i * 2.8, 0.024, crossZ);
    stripe.renderOrder = 1;
    scene.add(stripe);
  }
  const stopLine = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 0.55), paintMat);
  stopLine.rotation.x = -Math.PI / 2;
  stopLine.position.set(-5.5, 0.024, crossZ + 3.6);
  stopLine.renderOrder = 1;
  scene.add(stopLine);
}

/* ---------------------------------------------------------------------
   RUINED CITY (state.ruinedCity — Level 2) — the street after the
   outbreak: shopfront ground floors with shutters and smashed glass,
   stepped broken rooflines where whole storeys came down, blown-out
   street corners exposing floor slabs and rebar, and fully collapsed
   blocks slumped into rubble mounds (makeCollapsedBuilding).

   Facade UVs are planar in building-local metres (one texture tile =
   FACADE tile size), so windows stay aligned across every piece of a
   ruin and textures never stretch with a building's size — which also
   lets every building share the same few textures. Ruin decisions use
   their own seeded RNG so the shared world rnd() sequence — wreck and
   prop placement — is exactly what it was before.
--------------------------------------------------------------------- */
let ruinRnd = mulberry32(0x5EED_2B1);
const STOREY = 3.2;
const NIGHT_TILE = 4;           // the night window texture's old 4 m repeat
let storefrontTex = null;
let concreteRuinMat = null;
let interiorMat = null;
let rebarMat = null;

function ruinMaterials() {
  if (!concreteRuinMat) {
    concreteRuinMat = new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x9a948c, roughness: 0.96 });
    interiorMat = new THREE.MeshStandardMaterial({ color: 0x1c1915, roughness: 1 });
    rebarMat = new THREE.MeshStandardMaterial({ color: 0x3b2a20, roughness: 0.7, metalness: 0.4 });
  }
  return { concrete: concreteRuinMat, interior: interiorMat, rebar: rebarMat };
}

// World-scale planar UVs: side faces map (along-face, height) / tile,
// tops map (x, z). Works on any box — cut, jagged or translated.
export function planarFacadeUVs(geo, tileW, tileH) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    if (Math.abs(ny) > 0.5) uv.setXY(i, x / tileW, z / tileW);
    else if (Math.abs(nx) > Math.abs(nz)) uv.setXY(i, (nx > 0 ? -z : z) / tileW, y / tileH);
    else uv.setXY(i, (nz > 0 ? x : -x) / tileW, y / tileH);
  }
  uv.needsUpdate = true;
}

// A box standing on y = y0 whose top is broken: the top grid drops by
// whole storeys (plus a ragged fraction) column by column. `dropAt`
// maps a top vertex (x, z) to how much it loses; keyed by position so
// faces sharing an edge agree and the shell stays closed.
export function brokenBox(w, h, d, y0, dropAt) {
  const geo = new THREE.BoxGeometry(w, h, d, Math.max(2, Math.round(w / 2.4)), 1, Math.max(2, Math.round(d / 2.4)));
  geo.translate(0, y0 + h / 2, 0);
  const pos = geo.attributes.position;
  const drops = new Map();
  const top = y0 + h - 0.001;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < top) continue;
    const k = `${pos.getX(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`;
    if (!drops.has(k)) drops.set(k, Math.min(h - 0.5, dropAt(pos.getX(i), pos.getZ(i))));
    pos.setY(i, y0 + h - drops.get(k));
  }
  geo.computeVertexNormals();
  return geo;
}
// Damage comes off in sections, not per vertex: the top is cut into 4-8 m
// cells that each lose 0..maxStoreys whole storeys, so it reads as broken
// plateaus stepping down (one 2.4 m slope between cells) rather than spikes
// (keep: the share of cells left whole)
const raggedStoreys = (maxStoreys, keep = 0.35) => {
  const seg = 4 + ruinRnd() * 4;
  const cells = new Map();
  return (x, z) => {
    const k = `${Math.floor(x / seg)},${Math.floor(z / seg)}`;
    if (!cells.has(k)) cells.set(k, ruinRnd() < keep ? 0 : (1 + Math.floor(ruinRnd() * maxStoreys)) * STOREY);
    return cells.get(k) + ruinRnd() * 0.5;
  };
};

// Rolled-down shutters, smashed shop windows, boarded bays and graffiti —
// one 10 m x 3.2 m tile wrapping every building's ground floor
function storefrontTexture() {
  if (storefrontTex) return storefrontTex;
  storefrontTex = new THREE.CanvasTexture(makeCanvas(512, 160, (ctx, w, h) => {
    ctx.fillStyle = '#4a4540'; ctx.fillRect(0, 0, w, h);
    const bays = 3, bw = w / bays;
    for (let b = 0; b < bays; b++) {
      const x = b * bw + 10, y = 26, ww = bw - 20, hh = h - 30;
      const kind = Math.random();
      if (kind < 0.45) {
        // corrugated roller shutter, rust and dents
        ctx.fillStyle = '#6d6862'; ctx.fillRect(x, y, ww, hh);
        for (let s = y; s < y + hh; s += 5) { ctx.fillStyle = 'rgba(20,18,16,0.35)'; ctx.fillRect(x, s, ww, 1.5); }
        for (let r = 0; r < 18; r++) { ctx.fillStyle = `rgba(120,62,28,${(Math.random() * 0.35).toFixed(2)})`; ctx.fillRect(x + Math.random() * ww, y + Math.random() * hh, 4 + Math.random() * 14, 2 + Math.random() * 20); }
        if (Math.random() < 0.5) { ctx.fillStyle = '#0c0b0a'; ctx.fillRect(x, y + hh * 0.75, ww * (0.3 + Math.random() * 0.5), hh * 0.25); } // pried up
      } else if (kind < 0.8) {
        // smashed shop window: dark interior, shards in the frame
        ctx.fillStyle = '#121110'; ctx.fillRect(x, y, ww, hh);
        ctx.fillStyle = 'rgba(160,170,175,0.35)';
        for (let s = 0; s < 6; s++) {
          ctx.beginPath(); const sx = x + Math.random() * ww; ctx.moveTo(sx, y); ctx.lineTo(sx + 10 + Math.random() * 30, y); ctx.lineTo(sx + Math.random() * 20, y + 10 + Math.random() * 40); ctx.fill();
        }
        ctx.strokeStyle = '#2a2622'; ctx.lineWidth = 4; ctx.strokeRect(x, y, ww, hh);
      } else {
        // boarded
        ctx.fillStyle = '#5b4732'; ctx.fillRect(x, y, ww, hh);
        for (let p = 0; p < 7; p++) { ctx.fillStyle = `rgba(${p % 2 ? '35,26,16' : '110,86,58'},0.4)`; ctx.fillRect(x + (ww * p) / 7, y, 2, hh); }
      }
      // sign fascia above each bay, faded
      ctx.fillStyle = `hsl(${(Math.random() * 360) | 0},18%,${22 + Math.random() * 12}%)`; ctx.fillRect(x - 4, 4, ww + 8, 18);
    }
    // graffiti scrawls
    for (let gI = 0; gI < 5; gI++) {
      ctx.strokeStyle = ['#b33a2e', '#2e6fb3', '#d8d0c0', '#1d1d1d', '#3f9a4a'][gI % 5]; ctx.lineWidth = 3 + Math.random() * 3; ctx.globalAlpha = 0.6;
      ctx.beginPath(); let gx = Math.random() * w, gy = 60 + Math.random() * 80; ctx.moveTo(gx, gy);
      for (let k = 0; k < 8; k++) { gx += 8 + Math.random() * 14; gy += (Math.random() - 0.5) * 30; ctx.lineTo(gx, gy); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // grime rising from the pavement
    const g = ctx.createLinearGradient(0, h, 0, h * 0.4);
    g.addColorStop(0, 'rgba(30,25,20,0.55)'); g.addColorStop(1, 'rgba(30,25,20,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }));
  storefrontTex.wrapS = storefrontTex.wrapT = THREE.RepeatWrapping;
  storefrontTex.colorSpace = THREE.SRGBColorSpace;
  return storefrontTex;
}

// Body of a ruined building into group g. Returns 'intact' | 'broken' |
// 'corner' so the caller knows whether a roof slab / rooftop kit fits.
// forceShape ('corner' | 'broken' | 'wrecked' | 'gutted' | 'intact')
// overrides the roll, which is still drawn. 'wrecked' is broken harder: up
// to 5 storeys lost, but never below ~8 m, so a lit window low on the
// facade stays under the top. 'gutted' loses over half its height, every
// section down a further 0-2 storeys.
function addRuinedBody(g, w, h, d, mats, tileW, tileH, streetSide, forceShape) {
  const roll = { corner: 0.1, broken: 0.5, wrecked: 0.5, gutted: 0.5, intact: 0.9 }[forceShape] ?? ruinRnd();
  if (forceShape) ruinRnd();
  const add = (geo, mat, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow; m.receiveShadow = true;
    g.add(m);
    return m;
  };
  if (roll < 0.25 && h > 12) {
    // Blown-out upper corner on the street face, at one end of the block
    const { concrete, interior, rebar } = ruinMaterials();
    const cutH = Math.max(2, Math.floor(h * (0.3 + ruinRnd() * 0.25) / STOREY)) * STOREY;
    const nw = w * (0.38 + ruinRnd() * 0.15), nd = d * (0.35 + ruinRnd() * 0.15);
    const end = ruinRnd() < 0.5 ? -1 : 1;              // which z end loses its corner
    const sx = streetSide;                              // street face is at x = sx * w / 2
    const upH = h - cutH;
    const lower = new THREE.BoxGeometry(w, cutH, d); lower.translate(0, cutH / 2, 0);
    // A: the far (non-street) slice, full depth; B: the street slice, minus the notch
    const aW = w - nw, bD = d - nd;
    const geoA = brokenBox(aW, upH, d, cutH, raggedStoreys(1));
    geoA.translate(-sx * nw / 2, 0, 0);
    const geoB = brokenBox(nw, upH, bD, cutH, raggedStoreys(2));
    geoB.translate(sx * (w - nw) / 2, 0, -end * nd / 2);
    for (const geo of [lower, geoA, geoB]) { planarFacadeUVs(geo, tileW, tileH); add(geo, mats); }
    // Exposed floors in the notch: slabs at every storey, some snapped
    // short and sagging, rebar poking out of the broken edges
    const nx = sx * (w / 2 - nw / 2), nz = end * (d / 2 - nd / 2);
    for (let y = cutH; y < h - 1; y += STOREY) {
      const frac = ruinRnd() < 0.35 ? 0.35 + ruinRnd() * 0.4 : 1;
      const slab = new THREE.BoxGeometry(nw * frac, 0.28, nd * (frac < 1 ? 1 : 0.98));
      const m = add(slab, concrete);
      m.position.set(nx - sx * nw * (1 - frac) / 2, y, nz);
      if (frac < 1) m.rotation.z = sx * (0.06 + ruinRnd() * 0.1);
      for (let r = 0; r < 3; r++) {
        const bar = add(new THREE.BoxGeometry(0.05, 0.05, 0.6 + ruinRnd() * 0.8), rebar, false);
        bar.position.set(nx + sx * (nw * frac - nw / 2), y + 0.05, nz + (ruinRnd() - 0.5) * nd * 0.8);
        bar.rotation.set(ruinRnd() * 0.6 - 0.3, Math.PI / 2, ruinRnd() * 0.5 - 0.25);
      }
    }
    // Dark interior walls behind the notch (instead of facade windows facing inward)
    const back = add(new THREE.PlaneGeometry(nd, upH), interior, false);
    back.position.set(nx - sx * nw / 2 + sx * 0.02, cutH + upH / 2, nz);
    back.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    const side = add(new THREE.PlaneGeometry(nw, upH), interior, false);
    side.position.set(nx, cutH + upH / 2, nz - end * nd / 2 + end * 0.02);
    side.rotation.y = end > 0 ? 0 : Math.PI;
    return 'corner';
  }
  if (forceShape === 'gutted') {
    const base = Math.floor(h * 0.55 / STOREY);
    const cells = new Map();
    const geo = brokenBox(w, h, d, 0, (x, z) => {
      const k = `${Math.floor(x / 5)},${Math.floor(z / 5)}`;
      if (!cells.has(k)) cells.set(k, Math.min(h - 6, (base + Math.floor(ruinRnd() * 3)) * STOREY));
      return cells.get(k) + ruinRnd() * 0.5;
    });
    planarFacadeUVs(geo, tileW, tileH);
    add(geo, mats);
    return 'broken';
  }
  if (roll < 0.7) {
    const storeys = forceShape === 'wrecked'
      ? Math.max(1, Math.min(5, Math.floor((h - 8.5) / STOREY)))
      : (h > 20 ? 3 : 2);
    const geo = brokenBox(w, h, d, 0, raggedStoreys(storeys, forceShape === 'wrecked' ? 0.1 : 0.35));
    planarFacadeUVs(geo, tileW, tileH);
    add(geo, mats);
    return 'broken';
  }
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, h / 2, 0);
  planarFacadeUVs(geo, tileW, tileH);
  add(geo, mats);
  return 'intact';
}

/* LIT WINDOWS — on a dead-grid night, the few windows that still have
   power, each throwing a soft shaft of light out and down toward the
   street. Slots follow the day facade texture (FACADE_TILE_W x
   FACADE_TILE_H tiles, 3 bays x 2 storeys): window centres every 2.5 m
   along at 1.25 m and every 3.2 m up at 1.696 m, measured in the planar
   UV space of the facade — world metres for world-planar geometry, or
   from (ux, uz) for geometry UV'd in a group's local space.
   lit: { windows: [], rays: [] } collects geometry; addLitWindowMeshes
   merges it into two meshes (one draw call each). */
export function addLitWindows(lit, { cx, cz, w, d, n, rnd, count, minY = 4, maxY, ux = 0, uz = 0 }) {
  const alongX = Math.abs(n.z) > 0.5;                 // the facade runs along x
  const span = alongX ? w : d;
  const c = alongX ? cx - ux : cz - uz;               // facade centre, in UV space
  const fx = cx + n.x * w / 2, fz = cz + n.z * d / 2; // facade centre, world
  const bay = FACADE_TILE_W / 3, storey = FACADE_TILE_H / 2;
  const cols = [], rows = [];
  for (let u = Math.ceil((c - span / 2 + 1 - bay / 2) / bay) * bay + bay / 2; u < c + span / 2 - 1; u += bay) cols.push(u + (alongX ? ux : uz));
  for (let y = 1.696; y <= maxY; y += storey) if (y >= minY) rows.push(y);
  if (!cols.length || !rows.length) return;
  const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
  const taken = new Set();
  for (let i = 0; i < count; i++) {
    const s = cols[(rnd() * cols.length) | 0], y = rows[(rnd() * rows.length) | 0];
    if (taken.has(`${s},${y}`)) continue;
    taken.add(`${s},${y}`);
    const pos = new THREE.Vector3((alongX ? s : fx) + n.x * 0.06, y, (alongX ? fz : s) + n.z * 0.06);
    const win = new THREE.PlaneGeometry(1.25, 1.55);
    win.lookAt(n); // turns the plane's face toward n
    win.translate(pos.x, pos.y, pos.z);
    lit.windows.push(win);
    // The shaft: an open frustum, narrow end on the window, fanning out
    // along the facade normal and tipped down toward the ground
    const L = 9 + rnd() * 5;
    const dir = n.clone().applyAxisAngle(up, (rnd() - 0.5) * 0.3);
    dir.multiplyScalar(Math.cos(0.35 + rnd() * 0.2)).add(new THREE.Vector3(0, -Math.sin(0.45), 0)).normalize();
    const ray = new THREE.CylinderGeometry(0.7, 2.4, L, 8, 1, true);
    ray.translate(0, -L / 2, 0);                       // narrow end (top) at the origin
    ray.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(down, dir));
    ray.translate(pos.x, pos.y, pos.z);
    ray.deleteAttribute('normal');
    lit.rays.push(ray);
  }
}
let rayTex = null;
function rayTexture() {
  if (rayTex) return rayTex;
  // Bright at the window (the frustum's top, v = 1), gone by the far end
  rayTex = new THREE.CanvasTexture(makeCanvas(4, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 128);
  }));
  return rayTex;
}
export function addLitWindowMeshes(lit) {
  if (!lit.windows.length) return;
  scene.add(new THREE.Mesh(mergeGeometries(lit.windows), new THREE.MeshBasicMaterial({ color: 0xffb35e })));
  const rays = new THREE.Mesh(mergeGeometries(lit.rays), new THREE.MeshBasicMaterial({
    map: rayTexture(), color: 0xffbf7a, transparent: true, opacity: 0.26,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  rays.renderOrder = 2;
  scene.add(rays);
}

/* Rubble mound — a lumpy dome of broken concrete with chunks and slabs
   bedded in it, all merged into one mesh per material. `w` x `d`
   footprint, `peak` metres high. Visual only — callers add colliders. */
export function makeRubbleMound(w, d, peak) {
  const { concrete, rebar } = ruinMaterials();
  const g = new THREE.Group();
  const mound = new THREE.PlaneGeometry(w, d, 14, 14);
  mound.rotateX(-Math.PI / 2);
  const pos = mound.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (w / 2), z = pos.getZ(i) / (d / 2);
    const r = Math.min(1, Math.sqrt(x * x + z * z));
    const dome = Math.cos(r * Math.PI / 2);
    pos.setY(i, Math.max(0, peak * dome * dome * (0.75 + ruinRnd() * 0.5)));
  }
  mound.computeVertexNormals();
  const chunks = [];
  const n = Math.round((w * d) / 6);
  for (let i = 0; i < n; i++) {
    const s = 0.3 + ruinRnd() * 1.1;
    const c = new THREE.BoxGeometry(s, s * (0.3 + ruinRnd() * 0.5), s * (0.6 + ruinRnd() * 0.8));
    const px = (ruinRnd() - 0.5) * w * 0.9, pz = (ruinRnd() - 0.5) * d * 0.9;
    const rr = Math.min(1, Math.hypot(px / (w / 2), pz / (d / 2)));
    c.rotateX(ruinRnd() * 0.8); c.rotateY(ruinRnd() * Math.PI); c.rotateZ(ruinRnd() * 0.8);
    c.translate(px, peak * Math.cos(rr * Math.PI / 2) ** 2 * 0.9, pz);
    chunks.push(c);
  }
  // a couple of big broken floor slabs leaning out of the pile
  for (let i = 0; i < 2; i++) {
    const s = new THREE.BoxGeometry(2.5 + ruinRnd() * 2.5, 0.25, 1.8 + ruinRnd() * 1.6);
    s.rotateZ(0.3 + ruinRnd() * 0.5); s.rotateY(ruinRnd() * Math.PI);
    s.translate((ruinRnd() - 0.5) * w * 0.5, peak * 0.55, (ruinRnd() - 0.5) * d * 0.5);
    chunks.push(s);
  }
  const bars = [];
  for (let i = 0; i < 8; i++) {
    const b = new THREE.BoxGeometry(0.05, 0.05, 1 + ruinRnd() * 1.5);
    b.rotateX(ruinRnd() - 0.5); b.rotateY(ruinRnd() * Math.PI);
    b.translate((ruinRnd() - 0.5) * w * 0.6, peak * (0.4 + ruinRnd() * 0.5), (ruinRnd() - 0.5) * d * 0.6);
    bars.push(b);
  }
  const rock = new THREE.Mesh(mergeGeometries([mound, ...chunks.map((c) => c.toNonIndexed())].map((x) => (x.index ? x.toNonIndexed() : x))), concrete);
  rock.castShadow = rock.receiveShadow = true;
  g.add(rock);
  g.add(new THREE.Mesh(mergeGeometries(bars.map((b) => b.toNonIndexed())), rebar));
  return g;
}

/* Collapsed block — stub walls with ragged tops sloping down toward the
   street, floors pancaked down inside, and a rubble mound filling the
   footprint and spilling across the pavement (never the road: `spillTo`
   is the x the spill may reach). Colliders: the footprint, low; the
   spill, lower. */
export function makeCollapsedBuilding(x, z, w, d, h, streetSide, spillTo) {
  const g = new THREE.Group();
  const clearDay = state.timeOfDay === 'day' && state.clearDay;
  const tex = clearDay ? dayFacades()[(ruinRnd() * 4) | 0] : windowTexVariants[0];
  const tileW = clearDay ? FACADE_TILE_W : NIGHT_TILE, tileH = clearDay ? FACADE_TILE_H : NIGHT_TILE;
  const wallMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, color: new THREE.Color().setHSL(0.07, 0.14, clearDay ? 0.55 : 0.4) });
  const { concrete, interior } = ruinMaterials();
  const T = 0.45;
  const sx = streetSide;
  const add = (geo, mat, shadow = true) => {
    const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m;
  };
  // ragged top that falls away toward the street side
  const slope = (fromX) => (vx) => {
    const t = (sx * (vx + fromX) + w / 2) / w; // 0 far side .. 1 street side
    return h * (0.15 + 0.75 * Math.max(0, Math.min(1, t))) + ruinRnd() * 1.6;
  };
  // far wall
  const far = brokenBox(T, h, d, 0, () => h * 0.1 + ruinRnd() * STOREY * 1.5);
  far.translate(-sx * (w / 2 - T / 2), 0, 0);
  // side walls, sloping down toward the street
  const sideA = brokenBox(w, h, T, 0, slope(0)); sideA.translate(0, 0, d / 2 - T / 2);
  const sideB = brokenBox(w, h, T, 0, slope(0)); sideB.translate(0, 0, -d / 2 + T / 2);
  // street wall: knee-high stubs with gaps
  const stubs = [];
  for (let zz = -d / 2 + 1; zz < d / 2 - 1; zz += 2.2 + ruinRnd() * 2) {
    if (ruinRnd() < 0.35) continue;
    const sh = 0.8 + ruinRnd() * 2.6;
    const s = brokenBox(T, sh, 1.6 + ruinRnd() * 1.4, 0, () => ruinRnd() * sh * 0.5);
    s.translate(sx * (w / 2 - T / 2), 0, zz);
    stubs.push(s);
  }
  for (const geo of [far, sideA, sideB, ...stubs]) { planarFacadeUVs(geo, tileW, tileH); add(geo, wallMat); }
  // dark floor of the gutted interior
  const floor = add(new THREE.PlaneGeometry(w - T * 2, d - T * 2), interior, false);
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.04;
  // pancaked floors hanging from the far wall down toward the street
  for (let i = 0; i < 3; i++) {
    const y = STOREY * (1 + i) + ruinRnd();
    if (y > h * 0.8) break;
    const sl = add(new THREE.BoxGeometry(w * (0.55 + ruinRnd() * 0.3), 0.3, d * (0.5 + ruinRnd() * 0.35)), concrete);
    sl.position.set(-sx * w * 0.18, y * 0.7, (ruinRnd() - 0.5) * d * 0.3);
    sl.rotation.z = sx * -(0.35 + ruinRnd() * 0.35);
    sl.rotation.x = (ruinRnd() - 0.5) * 0.3;
  }
  // rubble filling the footprint and spilling across the pavement
  const spill = Math.max(0, Math.abs(spillTo - x) - w / 2);
  const mound = makeRubbleMound(w + spill, d * 1.05, Math.min(h * 0.35, 5));
  mound.position.set(sx * spill / 2, 0, 0);
  g.add(mound);
  g.position.set(x, 0, z);
  scene.add(g);
  g.traverse((o) => { if (o.isMesh) state.occluders.push(o); });
  addStaticBox(w / 2, h * 0.3, d / 2, x, h * 0.3, z);
  if (spill > 0.5) addStaticBox(spill / 2, 0.6, d * 0.45, x + sx * (w / 2 + spill / 2), 0.6, z);
  return g;
}

/* ---------------------------------------------------------------------
   BUILDINGS
--------------------------------------------------------------------- */
/* A level that names a district (state.cityKit, e.g. Level 1's 'downtown')
   gets CityKit.js's stylised buildings on the same lots. The old box
   builder still runs first as a ghost, built and thrown away, so the
   shared rnd() advances exactly as before and everything placed after the
   buildings (wrecks, cars, spawns) lands where it always has. */
export function makeBuilding(x, z, w, h, d, opts = {}) {
  if (!state.cityKit || opts.consumeOnly) return makeBoxBuilding(x, z, w, h, d, opts);
  makeBoxBuilding(x, z, w, h, d, { ...opts, consumeOnly: true }).traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
  });
  return buildKitBuilding(x, z, w, h, d);
}
function makeBoxBuilding(x, z, w, h, d, opts = {}) {
  const g = new THREE.Group();
  const night = state.timeOfDay === 'night';
  const clearDay = state.timeOfDay === 'day' && state.clearDay;
  // Level 1's day (state.warmDay) wears the same weathered daylight facades
  const dayLook = state.timeOfDay === 'day' && (state.clearDay || state.warmDay);
  // Same rnd() calls in every mode, so the city's layout never changes
  // with the time of day
  const variant = rnd();
  const lightness = rnd();
  let mat;
  const ruined = state.ruinedCity;
  // Dead-grid night (state.deadGridNight, Level 2): the day facades, dark,
  // with no glowing window grid — lit windows are added one by one
  // (addLitWindows) on the few buildings that still have power
  const deadNight = night && state.deadGridNight && !opts.oldLook;
  if (dayLook || deadNight) {
    const set = dayFacades();
    let tex = set[Math.floor(variant * set.length)];
    if (!ruined) {
      tex = tex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(1, Math.round(w / FACADE_TILE_W)), Math.max(1, Math.round(h / FACADE_TILE_H)));
    }
    // Varied weathered plaster/concrete/brick-ish tints
    const tint = new THREE.Color().setHSL(0.06 + variant * 0.05, 0.12 + lightness * 0.12,
      deadNight ? 0.24 + lightness * 0.08 : 0.5 + lightness * 0.18);
    mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, color: tint });
  } else {
    let tex = windowTexVariants[Math.floor(variant * windowTexVariants.length)];
    if (!ruined) {
      tex = tex.clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(2, Math.round(w / 4)), Math.max(3, Math.round(h / 4)));
    }
    const tint = new THREE.Color().setHSL(0.08, 0.08, 0.38 + lightness * 0.12);
    // Lit windows glow: the facade texture doubles as the emissive map —
    // dark walls contribute ~nothing, lit patches emit. Full strength at
    // night when the sun is off and they're the point; softened in Day
    // mode where a glowing facade reads odd under full sun.
    mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.94, color: tint,
      emissive: 0xffb066, emissiveMap: tex, emissiveIntensity: night ? 0.35 : 0.08,
    });
  }
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 1 });
  let shape = 'intact';
  if (ruined) {
    // Box faces in order +x -x +y -y +z -z: facade on the sides, broken
    // concrete roof material on top
    const mats = [mat, mat, roofMat, roofMat, mat, mat];
    const real = clearDay || deadNight;
    const tileW = real ? FACADE_TILE_W : NIGHT_TILE, tileH = real ? FACADE_TILE_H : NIGHT_TILE;
    shape = addRuinedBody(g, w, h, d, mats, tileW, tileH, x > 0 ? -1 : 1, opts.forceShape);
    const bandGeo = new THREE.BoxGeometry(w + 0.08, 3.2, d + 0.08);
    bandGeo.translate(0, 1.6, 0);
    planarFacadeUVs(bandGeo, 10, 3.2);
    const band = new THREE.Mesh(bandGeo, new THREE.MeshStandardMaterial({ map: storefrontTexture(), roughness: 0.9 }));
    band.receiveShadow = true;
    g.add(band);
  } else {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.y = h / 2;
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.08, 3.2, d + 0.08),
      new THREE.MeshStandardMaterial({ color: 0x2b2724, roughness: 0.9 })
    );
    band.position.y = 1.6;
    g.add(band);
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 2.4, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.8 })
    );
    const face = x > 0 ? -1 : 1;
    door.position.set(face * (w / 2 - 1.4) * 0.15, 1.2, (x > 0 ? -1 : 1) * (d / 2 + 0.05));
    if (x > 0) door.position.z = -d / 2 - 0.06;
    else door.position.z = d / 2 + 0.06;
    g.add(door);
  }
  // A roof slab and rooftop kit only fit an intact top
  if (shape === 'intact') {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.4, d * 0.92), roofMat);
    roof.position.y = h + 0.15;
    g.add(roof);
  }
  // Roughly a third of the street-facing facades carry a neon sign
  // (streetSide: east row faces -x, west row faces +x toward the road).
  if (rnd() < 0.35) addNeonSign(g, w, d, x > 0 ? -1 : 1, night, clearDay);
  if (rnd() > 0.4) {
    const ac = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.7, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x4a4e50, metalness: 0.4, roughness: 0.5 })
    );
    ac.position.set((rnd() - 0.5) * w * 0.4, h + 0.7, (rnd() - 0.5) * d * 0.3);
    ac.castShadow = true;
    if (shape === 'intact') g.add(ac);
  }
  if (h > 18 && rnd() > 0.45) {
    const railMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < 5; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, d * 0.55), railMat);
      step.position.set((x > 0 ? -1 : 1) * (w / 2 + 0.35), 4 + i * 2.6, 0);
      g.add(step);
    }
  }
  if (h > 22 && rnd() > 0.5) {
    const tierH = h * (0.25 + rnd() * 0.2);
    const tierW = w * (0.55 + rnd() * 0.2);
    const tierD = d * (0.55 + rnd() * 0.2);
    const tier = new THREE.Mesh(new THREE.BoxGeometry(tierW, tierH, tierD), mat);
    tier.position.set((rnd() - 0.5) * (w - tierW) * 0.5, h + tierH / 2, (rnd() - 0.5) * (d - tierD) * 0.5);
    tier.castShadow = true; tier.receiveShadow = true;
    g.add(tier);
    const tierRoof = new THREE.Mesh(
      new THREE.BoxGeometry(tierW * 0.94, 0.3, tierD * 0.94),
      new THREE.MeshStandardMaterial({ map: roofTex, roughness: 1 })
    );
    tierRoof.position.set(tier.position.x, h + tierH + 0.15, tier.position.z);
    g.add(tierRoof);
    if (shape !== 'intact') { g.remove(tier); g.remove(tierRoof); }
  }
  g.position.set(x, 0, z);
  // A collapsed ruin takes this lot: the block was only built so its
  // rnd() draws happen and everything placed after it lands where it did
  if (opts.consumeOnly) return g;
  if (!ruined) { g.userData.streetBuilding = true; g.userData.shell = g.children[0]; }
  scene.add(g);
  g.traverse((o) => { if (o.isMesh) state.occluders.push(o); });
  addStaticBox(w / 2, h / 2, d / 2, x, h / 2, z);
  return g;
}

// state.collapsedBlocks (set by a level's config): [{ side, z0, z1,
// spill?, seed? }] — the street-row building whose centre falls in a
// range is a collapsed ruin instead of a standing block. spill: false
// keeps its rubble off the pavement; seed builds it from its own RNG
// instead of ruinRnd, so adding it leaves every later ruin unchanged.
function collapsesAt(side, z) {
  return (state.collapsedBlocks || []).find((c) => c.side === side && z <= c.z0 && z >= c.z1);
}
function buildRuin(c, x, z, w, d, h, sx) {
  const spillTo = c.spill === false ? -sx * rowX : -sx * (STREET_HALF_W + 0.6);
  if (c.seed === undefined) return makeCollapsedBuilding(x, z, w, d, h, sx, spillTo);
  const shared = ruinRnd;
  ruinRnd = mulberry32(c.seed);
  try { return makeCollapsedBuilding(x, z, w, d, h, sx, spillTo); } finally { ruinRnd = shared; }
}

// Dead-grid night plan for one street-front building, from its own RNG
// so the street's layout and day look never move: collapsed (rubble kept
// off the pavement, own seed), wrecked with one lit window, a few dark
// ones standing with two, and the rest the original blocks, damaged.
const nightRnd = mulberry32(0x0D3AD);
function nightPlan() {
  const r = nightRnd();
  if (r < 0.38) return { collapse: { side: '', spill: false, seed: (nightRnd() * 0x7fffffff) | 0 } };
  if (r < 0.64) return { shape: 'wrecked', windows: 1 };
  if (r < 0.72) return { shape: 'intact', windows: 2 };
  // The original block with its own windows, but never whole on a dead night
  return { oldLook: true, shape: nightRnd() < 0.5 ? 'corner' : 'broken' };
}
// One street-front lot: the block, or the ruin that took its place, and
// on a dead-grid night its plan and lit windows. sx: street side of the
// block's facade (-1: east row, facing -x).
let guttedLeft = 3; // the first three tall original blocks from the start come down hardest
function streetBlock(x, z, w, h, d, sx, ruin, lit) {
  if(state.quarantineFacility){makeBuilding(x,z,w,h,d,{consumeOnly:true});return;}
  const plan = lit && !ruin ? nightPlan() : null;
  if (plan?.oldLook && h > 24 && guttedLeft > 0) { plan.shape = 'gutted'; guttedLeft--; }
  const fall = ruin || plan?.collapse;
  makeBuilding(x, z, w, h, d, { consumeOnly: !!fall, forceShape: plan?.shape, oldLook: plan?.oldLook });
  if (fall) { buildRuin(fall, x, z, w, d, h * 0.6, sx); return; }
  if (!plan?.windows) return;
  // Wrecked: the window stays low, under the broken top
  addLitWindows(lit, {
    cx: x, cz: z, w, d, n: new THREE.Vector3(sx, 0, 0), rnd: nightRnd, count: plan.windows,
    minY: 4, maxY: plan.shape === 'wrecked' ? Math.min(6, h - 1.5) : h - 1.5, ux: x, uz: z,
  });
}

export function loadBuildings() {
  const lit = state.timeOfDay === 'night' && state.deadGridNight ? { windows: [], rays: [] } : null;
  for (let z = 30; z > -STREET_LENGTH + 10; z -= (15 + rnd() * 9)) {
    const h = 16 + rnd() * 28;
    const w = 11 + rnd() * 7;
    const d = 11 + rnd() * 7;
    if (Math.abs(z - DEPOT_POS.z) > 16) streetBlock(rowX + w / 2, z, w, h, d, -1, collapsesAt('east', z), lit);
    if (Math.abs((z + 5) - WEST_POCKET_Z) > 14) {
      const ww = w * (0.85 + rnd() * 0.3), hh = h * (0.7 + rnd() * 0.4);
      streetBlock(-rowX - w / 2, z + 5, ww, hh, d, 1, collapsesAt('west', z + 5), lit);
    }
  }
  if (lit) addLitWindowMeshes(lit);
  if(!state.quarantineFacility)buildWestPocket();
  const night = state.timeOfDay === 'night';
  const clearDay = state.timeOfDay === 'day' && (state.clearDay || state.warmDay);
  for (let i = 0; i < 18; i++) {
    // Distant skyline: window textures instead of flat black so the far
    // blocks read as buildings — and a handful of lit windows survive
    // out there too, via the same emissive-map trick the street-facing
    // buildings use.
    const silTex = (clearDay ? dayFacades()[3] : windowTexVariants[2]).clone();
    silTex.needsUpdate = true;
    silTex.wrapS = silTex.wrapT = THREE.RepeatWrapping;
    const rx = 3 + rnd() * 3, ry = 6 + rnd() * 6;
    silTex.repeat.set(clearDay ? rx * 0.6 : rx, clearDay ? ry * 0.6 : ry);
    const sil = new THREE.Mesh(
      new THREE.BoxGeometry(18 + rnd() * 22, 28 + rnd() * 50, 16 + rnd() * 18),
      clearDay
        ? new THREE.MeshStandardMaterial({ map: silTex, color: 0x8a7e72, roughness: 1 })
        : new THREE.MeshStandardMaterial({
          map: silTex, color: 0x35302a, roughness: 1,
          emissive: 0xffb066, emissiveMap: silTex, emissiveIntensity: night ? 0.8 : 0.15,
        })
    );
    sil.position.set((rnd() < 0.5 ? -1 : 1) * (48 + rnd() * 40), sil.geometry.parameters.height / 2, -20 - rnd() * STREET_LENGTH);
    if(state.quarantineFacility)sil.position.x+=Math.sign(sil.position.x)*24;
    // A level with its own city behind the street (state.backCity — Level
    // 2) has real blocks here; the draws above still happen so nothing
    // placed after them moves
    if (!state.backCity && !state.cityKit) scene.add(sil); // a district builds a real town instead (CityTown.js)
  }
  const depotYard = state.skipDepot ? null : buildDepotYard();
  if (state.cityKit) buildTown(); // after every shared rnd() draw above
  return { depotYard };
}

/* ---------------------------------------------------------------------
   WRECKED CARS, DECOR CARS, BARRIERS, STREETLIGHTS
--------------------------------------------------------------------- */
// opts.model: { url, length, strip } — draw this wreck with a GLB instead.
// The box car is still built (same rnd() draws, so everything after it
// lands where it did) and stays as the camera's occluder, but is never
// shown; the model takes its place once loaded (see showWreckModel).
export function makeWreck(x, z, ry, burning, opts = {}) {
  const g = new THREE.Group();
  const col = burning ? 0x2a2320 : [0x4a3a32, 0x3d4550, 0x5c4030, 0x2f3340, 0x8a1f1f, 0x1f3a52][Math.floor(rnd() * 6)];
  const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.75, metalness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ map: rustTex, color: 0x2a2c30, roughness: 0.6, metalness: 0.2 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0e1216, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.55,
  });
  const crushed = rnd() < 0.4;
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.42, 4.2), bodyMat);
  chassis.position.y = 0.34;
  g.add(chassis);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.3, 1.35), bodyMat);
  hood.position.set(0, 0.62, 1.42);
  g.add(hood);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.34, 1.05), bodyMat);
  trunk.position.set(0, 0.64, -1.6);
  g.add(trunk);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.56, 1.9), bodyMat);
  cabin.position.set(0, 0.98, -0.1);
  if (crushed) { cabin.scale.y = 0.45; cabin.position.y = 0.78; }
  g.add(cabin);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.4, 1.72), glassMat);
  glass.position.copy(cabin.position); glass.position.y += crushed ? 0.06 : 0.1;
  g.add(glass);
  [1.98, -2.02].forEach((bz) => {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.22, 0.18), darkMat);
    bumper.position.set(0, 0.3, bz);
    g.add(bumper);
  });
  [-1, 1].forEach((side) => {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.22), darkMat);
    mirror.position.set(side * 0.85, 1.0, 0.65);
    g.add(mirror);
  });
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 1 });
  const rimGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.6 });
  [[-0.92, 0.36, 1.35], [0.92, 0.36, 1.35], [-0.92, 0.36, -1.35], [0.92, 0.36, -1.35]].forEach((p) => {
    const wm = new THREE.Mesh(wheelGeo, wheelMat);
    wm.rotation.z = Math.PI / 2; wm.position.set(...p); wm.castShadow = true;
    g.add(wm);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2; rim.position.set(...p); rim.castShadow = true;
    g.add(rim);
  });
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  if (crushed || rnd() > 0.6) g.rotation.z = (rnd() - 0.5) * (crushed ? 0.35 : 0.18);
  if (opts.model) {
    g.updateMatrixWorld(true); // never added, so its occluders need a world matrix now
    const spot = { ...opts.model, x, z, rotation: g.rotation.clone() };
    if (state.lightBoot) pendingWreckModels.push(spot); else showWreckModel(spot);
  } else scene.add(g);
  g.traverse((o) => { if (o.isMesh) state.occluders.push(o); });
  addStaticBox(1.05, 0.7, 2.15, x, 0.7, z, ry);
  if (burning && state.bigFires) {
    // The whole car alight: flames over the hood, cabin and trunk, a
    // heavier smoke column, and a strong flickering light that throws the
    // fire across the street (updateFireLights)
    const along = (dz) => new THREE.Vector3(x + Math.sin(ry) * dz, 0, z + Math.cos(ry) * dz);
    [[1.4, 0.55, 2.0], [-0.1, 0.75, 2.6], [-1.6, 0.6, 1.8]].forEach(([dz, y, s]) => {
      const p = along(dz); p.y = y;
      spawnFlameBillboards(p, s);
    });
    spawnFireEffect(new THREE.Vector3(x, 1.4, z), 1.6);
    const light = new THREE.PointLight(0xff7a2a, BIG_FIRE_LIGHT, 26, 1.6);
    light.position.set(x, 1.8, z);
    addLight(scene, light);
    fireLights.push({ light, seed: Math.random() * 100 });
  } else if (burning) {
    const light = new THREE.PointLight(0xff6a1a, 3.4, 11, 2);
    light.position.set(x, 1.15, z);
    addLight(scene, light);
    spawnFireEffect(new THREE.Vector3(x, 0.9, z));
    spawnFlameBillboards(new THREE.Vector3(x, 0.45, z), 1.3);
  }
  return g;
}

// Big fires' lights (state.bigFires): a flicker made of two out-of-step
// sines plus a little jitter, around BIG_FIRE_LIGHT. Only the intensity
// moves, so nothing recompiles. Lights that addLight skipped (sunlit
// days) are still listed but sit outside the scene, so this is harmless.
const BIG_FIRE_LIGHT = 9;
const fireLights = [];
let fireTime = 0;
export function updateFireLights(dt) {
  fireTime += dt;
  for (const f of fireLights) {
    const t = fireTime + f.seed;
    const flick = 0.78 + 0.14 * Math.sin(t * 9.3) + 0.1 * Math.sin(t * 23.7 + 1.3) + Math.random() * 0.06;
    f.light.intensity = BIG_FIRE_LIGHT * flick;
  }
}

const pendingWreckModels = [];
function showWreckModel({ url, length, strip = [], x, z, rotation }) {
  new GLTFLoader().load(url, (gltf) => {
    const obj = gltf.scene;
    const drop = [];
    obj.traverse((o) => { if (strip.some((n) => o.name.startsWith(n))) drop.push(o); });
    drop.forEach((o) => o.parent?.remove(o));
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // Long axis along local z like the box car's, sized to its length,
    // centred on the spot and sat on the ground
    let box = new THREE.Box3().setFromObject(obj);
    let size = box.getSize(new THREE.Vector3());
    if (size.x > size.z) { obj.rotation.y = Math.PI / 2; box = new THREE.Box3().setFromObject(obj); size = box.getSize(new THREE.Vector3()); }
    obj.scale.setScalar(length / size.z);
    box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.set(-c.x, -box.min.y, -c.z);
    const wrap = new THREE.Group();
    wrap.add(obj);
    wrap.position.set(x, 0, z);
    wrap.rotation.copy(rotation);
    scene.add(wrap);
  }, undefined, (err) => console.error(`Wreck model ${url} failed to load:`, err));
}

export function loadDecorCar(url, x, z, ry, targetLength) {
  new GLTFLoader().load(url, (gltf) => {
    const obj = gltf.scene;
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    const scale = targetLength / Math.max(size.x, size.z, 0.01);
    obj.scale.setScalar(scale);
    const box2 = new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3(); box2.getCenter(center);
    const wrap = new THREE.Group();
    obj.position.set(-center.x, -box2.min.y, -center.z);
    wrap.add(obj);
    wrap.position.set(x, 0, z);
    wrap.rotation.y = ry;
    scene.add(wrap);
    wrap.traverse((o) => { if (o.isMesh) state.occluders.push(o); });
    const finalSize = box2.getSize(new THREE.Vector3());
    addStaticBox(finalSize.x / 2, finalSize.y / 2, finalSize.z / 2, x, finalSize.y / 2, z, ry);
  }, undefined, () => { /* if it fails to load, the spot is just empty — no crash */ });
}

export function makeBarrier(x, z, ry) {
  const canvasTex = new THREE.CanvasTexture(makeCanvas(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#c8c24a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111';
    for (let i = -1; i < 3; i++) {
      ctx.save(); ctx.translate(i * 22, 0); ctx.rotate(Math.PI / 4); ctx.fillRect(-40, -6, 90, 12); ctx.restore();
    }
  }));
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.85, 0.55),
    new THREE.MeshStandardMaterial({ map: canvasTex, roughness: 0.9 })
  );
  mesh.position.set(x, 0.42, z); mesh.rotation.y = ry;
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  state.occluders.push(mesh);
  addStaticBox(1.2, 0.42, 0.28, x, 0.42, z, ry);
}

// Every lamp post placed, as [x, z] — Level 2's street dressing strings
// overhead cables between neighbours
export const streetlightSpots = [];

export function makeStreetlight(x, z) {
  streetlightSpots.push([x, z]);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.55, metalness: 0.65 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 8), poleMat);
  pole.position.set(x, 3, z); pole.castShadow = true;
  scene.add(pole);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), poleMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(x + (x > 0 ? -0.7 : 0.7), 5.9, z);
  scene.add(arm);
  // Clear-day levels (state.clearDay, Level 2) switch the lamps off in
  // daylight: an unlit bulb, and none of the light, halo or cone below —
  // which also takes ~two dozen SpotLights off every lit pixel's bill.
  // A level can also keep only a few lamps powered (state.liveStreetlights,
  // Level 2's dead grid): every post not on that list stands dark.
  const live = state.liveStreetlights?.find((l) => l.side === Math.sign(x) && l.z === z);
  const lampOn = !(state.timeOfDay === 'day' && (state.clearDay || state.warmDay)) && (!state.liveStreetlights || !!live);
  const blink = !!live?.blink;
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 8, 8),
    // A blinking bulb is flagged transparent purely to keep it out of the
    // static merge (mergeStatic.js), which would freeze its glow
    new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffc266, emissiveIntensity: lampOn ? 1.8 : 0, transparent: blink })
  );
  lamp.position.set(x + (x > 0 ? -1.35 : 1.35), 5.85, z);
  scene.add(lamp);
  if (!lampOn) {
    addObstacle(x, z, 0.35);
    return;
  }

  // SpotLight, not PointLight — this is what actually gives the light a
  // cone-shaped falloff (a PointLight radiates evenly in every
  // direction; a SpotLight only lights the area inside its angle, aimed
  // straight down at the road). Streetlights stay switched on in BOTH
  // modes: at night they're the primary light (sun is off — see
  // applyTimeOfDay in Scene.js), so intensity/distance are pushed up
  // from the original point-light numbers; in Day mode they're pushed
  // up even further, since a modest lamp easily gets lost against full
  // sunlight and needs real extra punch to still read as "on".
  const isDay = state.timeOfDay === 'day';
  const spot = new THREE.SpotLight(0xffc070, isDay ? 11 : state.quarantineFacility ? 9.1 : 6.5, isDay ? 30 : 24, Math.PI / 5.5, 0.55, 1.6);
  spot.userData.stationaryStreetLamp = true;
  spot.position.copy(lamp.position);
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(lamp.position.x, 0, lamp.position.z); // straight down to the road surface
  scene.add(spotTarget);
  spot.target = spotTarget;
  registerStreetLight(spot);

  // Soft additive halo at the lamp head — the light source itself reads
  // at a distance without paying for another real light.
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: streetGlowTex, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending, opacity: isDay ? 0.5 : 0.85, color: 0xffc070,
  }));
  glow.position.copy(lamp.position);
  glow.scale.set(2.2, 2.2, 1);
  scene.add(glow);

  // Visible cone mesh — a soft, additive-blended cone from the lamp
  // down to the ground so the beam itself reads as a radiating cone of
  // light (especially against the fog/haze), not just a lit patch of
  // road with no visible source. Given more opacity in Day mode for the
  // same reason as the SpotLight above — it needs to fight bright
  // ambient light to stay visible.
  const beamHeight = lamp.position.y;
  const beamGeo = new THREE.ConeGeometry(2.6, beamHeight, 20, 1, true);
  const beamMat = streetlightBeamMaterial(isDay);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(lamp.position.x, lamp.position.y - beamHeight / 2, lamp.position.z);
  // The quarantine street already has a real spotlight and bulb halo. Its
  // visible cone reads as a large yellow prop detached from the lamp.
  if (!state.quarantineFacility) scene.add(beam);

  if (blink) {
    blinkingLamps.push({
      spot, glow, beam, bulb: lamp.material,
      intensity: spot.intensity, glowOpacity: glow.material.opacity, beamOpacity: beamMat.opacity,
      phase: 'on', t: 0.5 + Math.random() * 4, flick: 0, k: 1, // Math.random, not rnd: keeps the seeded layout unchanged
    });
  }

  addObstacle(x, z, 0.35);
}

// Faulty lamps (a state.liveStreetlights entry with blink: true): mostly
// on, but every few seconds the supply stutters — a burst of rapid
// flicker that sometimes drops out for a second or two. Only intensity
// and opacity change; the SpotLight never leaves the scene, so blinking
// never forces a shader recompile the way toggling .visible would.
const blinkingLamps = [];
export function updateBlinkingLamps(dt) {
  for (const b of blinkingLamps) {
    b.t -= dt;
    if (b.t <= 0) {
      if (b.phase === 'on') { b.phase = 'stutter'; b.t = 0.25 + Math.random() * 0.9; }
      else if (b.phase === 'stutter' && Math.random() < 0.4) { b.phase = 'off'; b.t = 0.4 + Math.random() * 1.8; }
      else { b.phase = 'on'; b.t = 1.5 + Math.random() * 4; }
    }
    let k = b.phase === 'on' ? 1 : 0;
    if (b.phase === 'stutter') {
      b.flick -= dt;
      if (b.flick <= 0) { b.flick = 0.04 + Math.random() * 0.1; b.stutterK = Math.random() < 0.55 ? 0.08 : 1; }
      k = b.stutterK;
    }
    if (k === b.k) continue;
    b.k = k;
    b.spot.intensity = b.intensity * k;
    b.glow.material.opacity = b.glowOpacity * k;
    b.beam.material.opacity = b.beamOpacity * k;
    b.bulb.emissiveIntensity = 1.8 * k;
  }
}

export function loadObstacles() {
  let modelUsed = false;
  for (let z = 20; z > -STREET_LENGTH + 20; z -= (18 + rnd() * 16)) {
    const side = rnd() < 0.5 ? -1 : 1;
    const x = side * (STREET_HALF_W - 1.7 - rnd() * 2);
    const ry = (rnd() - 0.5) * 1.1 + (side < 0 ? Math.PI / 2 : -Math.PI / 2);
    const burning = rnd() < 0.32;
    // The level's burning-car model goes to the first burning wreck: the
    // one nearest the spawn
    const model = burning && !modelUsed ? state.burningCarModel : null;
    if (model) modelUsed = true;
    makeWreck(x, z, ry, burning, { model });
  }
  if (state.lightBoot) {
    // Light boot (Level 2): the two rusty-car decor GLB fetches (7.7 MB)
    // become procedural wrecks at the same spots — same collider +
    // occluder treatment as the street's other wrecks (makeWreck handles
    // both). The posed-zombie prop (12.7 MB) is dropped here; Level2.js
    // dresses that spot with a procedural fallen-zombie, and the deferred
    // corpse scatter covers the rest of the street.
    makeWreck(-(STREET_HALF_W + 3.5), -30, Math.PI / 2 + 0.15, false);
    makeWreck(STREET_HALF_W + 4, -150, -Math.PI / 2 - 0.1, false);
  } else {
    loadDecorCar('assets/old_rusty_car_2.glb', -(STREET_HALF_W + 3.5), -30, Math.PI / 2 + 0.15, 4.8);
    loadDecorCar('assets/old_rusty_car_2.glb', STREET_HALF_W + 4, -150, -Math.PI / 2 - 0.1, 4.8);
    loadDecorCar('assets/zombie_variant_b.glb', -(STREET_HALF_W + 3.2), -95, Math.PI / 2 - 0.2, 4.5);
    // Depot-lot prop — only when the depot exists (Level 2 skips the lot,
    // so the 13 MB model and its collision box would sit in empty space).
    if (!state.skipDepot) {
      loadDecorCar('assets/zombie_variant_b.glb', DEPOT_POS.x + 10, DEPOT_POS.z - 4, 0.3, 4.5);
    }
  }
  for (let i = 0; i < 6; i++) {
    const z = -20 - i * 24;
    makeBarrier((i % 2 === 0 ? -2.4 : 2.4), z, Math.PI / 2 + (rnd() - 0.5) * 0.28);
  }
  for (let z = 24; z > -STREET_LENGTH + 20; z -= 24) {
    makeStreetlight(-STREET_HALF_W + 0.55, z);
    makeStreetlight(STREET_HALF_W - 0.55, z);
  }
  for (let i = 0; i < 20; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const x = side * (STREET_HALF_W + 0.4 + rnd() * 2.2);
    const z = 18 - rnd() * (STREET_LENGTH + 8);
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.28 + rnd() * 0.55, 0),
      new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 1 })
    );
    rock.position.set(x, 0.22, z);
    rock.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
    rock.castShadow = true; rock.receiveShadow = true;
    scene.add(rock);
  }
  for (let i = 0; i < 6; i++) {
    spawnFireEffect(new THREE.Vector3((rnd() - 0.5) * 90, 6 + rnd() * 8, -STREET_LENGTH * (0.25 + rnd() * 0.7)), 2.2);
  }
  // Light boot (Level 2): corpse dressing is deferred with the other
  // non-gating fetches — by then the walker template (same GLB file,
  // same URL after the loader normalizes the path below) is in the
  // browser cache, so the corpse fetch costs zero extra bytes instead
  // of racing the loading gate. See loadDeferredAssets().
  if (!state.lightBoot) loadCorpses();
}

/* ---------------------------------------------------------------------
   TRASH CANS
--------------------------------------------------------------------- */
export function makeDumpster(x, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 1.15, 0.85),
    new THREE.MeshStandardMaterial({ map: rustTex, color: 0x3d5a42, roughness: 0.7, metalness: 0.25 })
  );
  mesh.position.set(x, 0.58, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  state.occluders.push(mesh);
  addStaticBox(0.7, 0.58, 0.45, x, 0.58, z);
}

export function loadTrashCans() {
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    makeDumpster(side * (STREET_HALF_W + 1.6), 8 - i * 22 - rnd() * 6);
  }
}

/* ---------------------------------------------------------------------
   WEST SUPPLY POCKET + DEPOT YARD (side-street compound)
--------------------------------------------------------------------- */
function buildWestPocket() {
  const px = -(rowX + 15), pz = WEST_POCKET_Z;
  const lot = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 18),
    new THREE.MeshStandardMaterial({ map: concreteTex, normalMap: concreteNormalTex, roughness: 1 })
  );
  lot.rotation.x = -Math.PI / 2;
  lot.position.set(px, 0.015, pz);
  lot.receiveShadow = true;
  scene.add(lot);
  makeWreck(px - 4, pz - 3, Math.PI * 0.15, false);
  makeWreck(px + 5, pz + 4, -Math.PI * 0.4, rnd() < 0.3);
  makeDumpster(px + 3, pz - 5);
  makeStreetlight(px, pz + 8);
  spawnPickup(new THREE.Vector3(px, 0, pz), rnd() < 0.5 ? 'health' : 'ammo');
  state.pickups[state.pickups.length - 1].life = Infinity; // a placed cache, doesn't despawn
}

let crateModelTemplate = null;
function buildDepotYard() {
  const cx = DEPOT_POS.x, cz = DEPOT_POS.z;
  const crossRoadTex = asphaltTex.clone();
  crossRoadTex.needsUpdate = true;
  crossRoadTex.repeat.set(Math.max(2, Math.round((cx - STREET_HALF_W + 4) / 6)), 3);
  const crossRoadNormalTex = asphaltNormalTex.clone();
  crossRoadNormalTex.needsUpdate = true;
  crossRoadNormalTex.repeat.copy(crossRoadTex.repeat);
  const crossRoad = new THREE.Mesh(
    new THREE.PlaneGeometry(cx - STREET_HALF_W + 4, 8),
    new THREE.MeshStandardMaterial({ map: crossRoadTex, normalMap: crossRoadNormalTex, roughness: 1 })
  );
  crossRoad.rotation.x = -Math.PI / 2;
  crossRoad.position.set((STREET_HALF_W + cx) / 2 - 2, 0.015, cz);
  crossRoad.receiveShadow = true;
  scene.add(crossRoad);
  const crossSidewalkTex = sidewalkTex.clone();
  crossSidewalkTex.needsUpdate = true;
  crossSidewalkTex.repeat.set(Math.max(2, Math.round((cx - STREET_HALF_W + 4) / 3)), 4);
  const crossSidewalk = new THREE.Mesh(
    new THREE.PlaneGeometry(cx - STREET_HALF_W + 4, 11),
    new THREE.MeshStandardMaterial({ map: crossSidewalkTex, roughness: 1 })
  );
  crossSidewalk.rotation.x = -Math.PI / 2;
  crossSidewalk.position.set((STREET_HALF_W + cx) / 2 - 2, 0.008, cz);
  scene.add(crossSidewalk);
  makeStreetlight(STREET_HALF_W + 6, cz + 5.5);
  makeStreetlight(cx - 10, cz - 5.5);
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 30),
    new THREE.MeshStandardMaterial({ map: concreteTex, normalMap: concreteNormalTex, roughness: 1 })
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(cx, 0.02, cz);
  yard.receiveShadow = true;
  scene.add(yard);
  makeBuilding(cx - 12, cz - 8, 12, 10, 14);
  makeBuilding(cx + 11, cz + 7, 10, 8, 12);
  addObstacle(cx - 12, cz - 8, 8);
  addObstacle(cx + 11, cz + 7, 7);
  const fencePts = [
    [cx - 16, cz + 12, 0], [cx - 8, cz + 12, 0],
    [cx + 4, cz + 12, 0], [cx + 12, cz + 12, 0],
    [cx - 16, cz - 12, 0], [cx - 8, cz - 12, 0], [cx, cz - 12, 0],
    [cx + 8, cz - 12, 0], [cx + 16, cz - 12, 0],
    [cx + 16, cz - 6, Math.PI / 2], [cx + 16, cz + 2, Math.PI / 2], [cx + 16, cz + 8, Math.PI / 2],
  ];
  fencePts.forEach((p) => makeBarrier(p[0], p[1], p[2]));
  makeDumpster(cx - 6, cz + 6);
  makeDumpster(cx + 5, cz - 9);
  for (let i = 0; i < 5; i++) {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.3 + rnd() * 0.4, 0),
      new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 1 })
    );
    rock.position.set(cx + (rnd() - 0.5) * 24, 0.2, cz + (rnd() - 0.5) * 20);
    rock.castShadow = true;
    scene.add(rock);
  }
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 1.85, 32),
    // Same anti-z-fight treatment as the extraction ring in Scene.js.
    new THREE.MeshBasicMaterial({
      color: 0xffaa22, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    })
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.set(cx, 0.1, cz);
  marker.renderOrder = 3;
  scene.add(marker);
  const markerLight = new THREE.PointLight(0xffaa22, 2.4, 14, 2);
  markerLight.position.set(cx, 2, cz);
  addLight(scene, markerLight);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 2.2, 34, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffaa22, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    })
  );
  beam.position.set(cx, 17, cz);
  scene.add(beam);
  const beamLight = { intensity: 0 };
  const crateGroup = new THREE.Group();
  crateGroup.position.set(cx, 0, cz);
  const cratePlaceholder = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.7, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xffcc55, emissive: 0xaa6600, emissiveIntensity: 0.6, roughness: 0.5 })
  );
  cratePlaceholder.position.y = 0.35;
  crateGroup.add(cratePlaceholder);
  scene.add(crateGroup);
  const CRATE_SCALE = 0.01;
  new GLTFLoader().load('assets/crate_box.glb', (gltf) => {
    crateModelTemplate = gltf.scene;
    const model = crateModelTemplate.clone(true);
    model.scale.setScalar(CRATE_SCALE);
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    crateGroup.remove(cratePlaceholder);
    crateGroup.add(model);
    [[cx - 5, cz - 9, 0.4], [cx - 4.4, cz - 9, 0.9], [cx + 8, cz + 8, -0.3]].forEach(([dx, dz, ry]) => {
      const c = crateModelTemplate.clone(true);
      c.scale.setScalar(CRATE_SCALE);
      c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      c.position.set(dx, 0, dz);
      c.rotation.y = ry;
      scene.add(c);
      c.traverse((o) => { if (o.isMesh) state.occluders.push(o); });
      addStaticBox(0.3, 0.3, 0.3, dx, 0.3, dz);
    });
  }, undefined, () => { /* keep the placeholder box if this fails to load */ });
  const signPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x333333 })
  );
  signPole.position.set(STREET_HALF_W + 3, 1.2, -70);
  scene.add(signPole);
  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.6, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xdaa520, emissive: 0x442a00, emissiveIntensity: 0.4 })
  );
  signBoard.position.set(STREET_HALF_W + 3, 2.1, -70);
  signBoard.rotation.y = Math.PI / 5;
  scene.add(signBoard);
  return { marker, markerLight, crate: crateGroup, beam, beamLight };
}

/* ---------------------------------------------------------------------
   CORPSES (decorative)
--------------------------------------------------------------------- */
let corpseTemplate = null;
function loadCorpses() {
  new GLTFLoader().load('assets/zombie_running_on_metel_maniac.glb', (gltf) => {
    const obj = gltf.scene;
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    const longest = Math.max(size.x, size.y, size.z) || 1;
    obj.scale.setScalar(1.8 / longest);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    corpseTemplate = obj;
    scatterCorpses();
  }, undefined, () => {});
}
function scatterCorpses() {
  if (!corpseTemplate) return;
  for (let i = 0; i < 8; i++) {
    // Skinned props need independent bones; a plain clone shares the template's
    // skeleton and can draw the entire scatter in one overlapping pile.
    const c = skeletonClone(corpseTemplate);
    const side = rnd() < 0.5 ? -1 : 1;
    const x = side * (STREET_HALF_W - 1 - rnd() * 3);
    const z = 10 - rnd() * (STREET_LENGTH + 10);
    c.rotation.y = rnd() * Math.PI * 2;
    c.rotation.x = Math.PI / 2 + (rnd() - 0.5) * 0.28;
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    c.position.set(x, -box.min.y, z);
    scene.add(c);
    c.updateMatrixWorld(true);
    c.userData.decorativeCorpse=true;
    // These props never animate. Cache their correct posed bounds and transforms.
    c.traverse(o=>{
      if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingSphere();o.computeBoundingBox();}
      o.matrixAutoUpdate=false;o.matrixWorldAutoUpdate=false;
    });
  }
}

/* ---------------------------------------------------------------------
   MAIN CHARACTER (player)
--------------------------------------------------------------------- */
export const playerHeight = 1.9;
export const playerBody = new CANNON.Body({
  mass: 80,
  material: matPlayer,
  fixedRotation: true,
  linearDamping: 0.9,
});
playerBody.addShape(new CANNON.Cylinder(0.32, 0.32, playerHeight, 8));
playerBody.position.set(1.5, playerHeight / 2 + 0.25, 30);
playerBody.updateMassProperties();
world.addBody(playerBody);

function buildPlayerMesh() {
  const g = new THREE.Group();
  const proceduralBody = new THREE.Group();
  g.add(proceduralBody);
  const skin = new THREE.MeshStandardMaterial({ color: 0xcbb499, roughness: 0.8 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x33383c, roughness: 0.7 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.58, 4, 8), jacket);
  torso.position.y = 1.0; torso.castShadow = true;
  proceduralBody.add(torso);
  const torsoTop = 1.0 + 0.29 + 0.23;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.09, 8), skin);
  neck.position.y = torsoTop + 0.045;
  neck.castShadow = true;
  proceduralBody.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 12), skin);
  head.position.y = torsoTop + 0.09 + 0.155;
  head.castShadow = true;
  proceduralBody.add(head);
  const hip = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.2, 4, 8), pants);
  hip.position.y = 0.6; hip.castShadow = true;
  proceduralBody.add(hip);
  function limb(mat, len, radius) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 4, 8), mat);
    m.castShadow = true;
    return m;
  }
  const legL = limb(pants, 0.7, 0.11); legL.position.set(-0.13, 0.35, 0);
  const legR = limb(pants, 0.7, 0.11); legR.position.set(0.13, 0.35, 0);
  const armL = limb(jacket, 0.55, 0.09); armL.position.set(-0.42, 1.05, 0);
  const armR = limb(jacket, 0.55, 0.09); armR.position.set(0.42, 1.05, 0);
  proceduralBody.add(legL, legR, armL, armR);
  const gunPivot = new THREE.Group();
  const gun = buildRifleMesh();
  gunPivot.add(gun);
  gunPivot.position.set(0.42, 0.95, -0.15);
  g.add(gunPivot);
  return { group: g, proceduralBody, legL, legR, armL, armR, gun, gunPivot, head, rigged: false, mixer: null };
}

export function buildRifleMesh() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, metalness: 0.65, roughness: 0.38 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x2a2622, metalness: 0.1, roughness: 0.75 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, metalness: 0.8, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.62), dark);
  body.position.z = -0.08;
  g.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.26, 8), metal);
  barrel.rotation.x = Math.PI / 2; barrel.position.z = -0.5;
  g.add(barrel);
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.06, 0.24), dark);
  handguard.position.z = -0.42;
  g.add(handguard);
  const foreSight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), metal);
  foreSight.position.set(0, 0.07, -0.62);
  g.add(foreSight);
  const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.19, 0.075), grip);
  gripMesh.position.set(0, -0.13, 0.1);
  gripMesh.rotation.x = -0.28;
  g.add(gripMesh);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.24, 0.06), dark);
  mag.position.set(0, -0.22, -0.02);
  mag.rotation.x = 0.18;
  g.add(mag);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.24), dark);
  stock.position.set(0, -0.01, 0.28);
  g.add(stock);
  const stockPad = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.03), grip);
  stockPad.position.set(0, -0.01, 0.4);
  g.add(stockPad);
  const optic = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.11), metal);
  optic.position.set(0, 0.075, -0.1);
  g.add(optic);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 10, Math.PI), metal);
  guard.rotation.x = Math.PI / 2;
  guard.position.set(0, -0.06, 0.06);
  g.add(guard);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export const playerVis = buildPlayerMesh();
scene.add(playerVis.group);

const PISTOL_SCALE = 0.00987;
let pistolTemplate = null;
let pistolLoading = false;

// The pistol GLB is Y-up with its muzzle at +Z (the two root X
// rotations cancel). A camera looks down -Z; wrist grip presets are
// deliberately separate from this fixed asset-to-camera correction.
const VIEWMODEL_LAYER = 31;
let viewmodelRevision = 0;
let warmedViewmodelRevision = -1;
let readyViewmodelRevision = -1;
let viewmodelWarmPromise = null;
let viewmodelWarmError = null;
const viewmodelWarmMaterials = new Set();

function prepareViewmodel(root) {
  viewmodelRevision++;
  const materials = new Map();
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
    object.layers.set(VIEWMODEL_LAYER);
    const prepare = (source) => {
      if (!materials.has(source)) {
        const material = source.clone();
        material.depthTest = true;
        material.depthWrite = true;
        materials.set(source, material);
      }
      return materials.get(source);
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(prepare) : prepare(object.material);
  });
}

// Only the replaced procedural models own their resources. Loaded GLB
// clones intentionally share geometry/textures with the cached template.
function disposeProceduralWeapon(root) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
function makePistolVisual() {
  const wrap = new THREE.Group();
  const inst = pistolTemplate.clone(true);
  inst.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  inst.scale.setScalar(PISTOL_SCALE);
  wrap.add(inst);
  return wrap;
}
export function applyGunOrientation() {
  const preset = GUN_GRIP_PRESETS[state.gunGripIndex];
  // The fallback rifle already points down -Z. The imported pistol
  // needs only a half-turn around Y, never a hand-bone grip rotation.
  if (viewmodelGun.children[0]) viewmodelGun.children[0].rotation.set(0, pistolTemplate ? Math.PI : 0, 0);
  if (!playerVis.gunOnHand && playerVis.gun) playerVis.gun.rotation.set(...preset.rot);
}
function applyPistolModel() {
  if (!pistolTemplate) return;
  const newThirdPerson = makePistolVisual();
  playerVis.gunPivot.remove(playerVis.gun);
  disposeProceduralWeapon(playerVis.gun);
  playerVis.gunPivot.add(newThirdPerson);
  newThirdPerson.visible = state.currentWeapon === 'gun';
  playerVis.gun = newThirdPerson;
  const newViewGun = makePistolVisual();
  newViewGun.scale.multiplyScalar(0.9);
  prepareViewmodel(newViewGun);
  if (viewmodelGun.children[0]) {
    const fallback = viewmodelGun.children[0];
    viewmodelGun.remove(fallback);
    disposeProceduralWeapon(fallback);
  }
  viewmodelGun.add(newViewGun);
  applyGunOrientation();
  pushKillFeed('Pistol model loaded');
}
export function loadPistolModel() {
  if (pistolTemplate || pistolLoading) return;
  pistolLoading = true;
  new GLTFLoader().load('assets/pistol.glb', (gltf) => {
    pistolLoading = false;
    pistolTemplate = gltf.scene;
    applyPistolModel();
  }, undefined, () => {
    pistolLoading = false;
    pushKillFeed('Pistol model failed to load — using procedural gun');
  });
}
// Light boot (Level 2): the 10 MB pistol GLB is deferred to
// loadDeferredAssets() — the procedural gun covers first- and
// third-person until the real model hot-swaps in mid-game (the swap is
// the same code path the eager fetch used whenever it resolved late).
if (!state.lightBoot) loadPistolModel();

export const viewmodelGun = new THREE.Group();
const viewmodelGunMesh = buildRifleMesh();
viewmodelGunMesh.scale.setScalar(0.5);
prepareViewmodel(viewmodelGunMesh);
viewmodelGun.add(viewmodelGunMesh);
viewmodelGun.position.set(0.22, -0.2, -0.42);
viewmodelGun.visible = false;
camera.add(viewmodelGun);

const PLAYER_TARGET_HEIGHT = 1.97; // a touch over 1.9 so they don't look small beside the truck
const PLAYER_FOOT_ADJUST = 0.05; // was 1.0 — that's a full meter of vertical
                                  // offset applied to the rig's LOCAL position
                                  // inside playerVis.group every time
                                  // applyPlayerScale() runs. This is meant to
                                  // be a tiny ground-clearance epsilon (to avoid
                                  // z-fighting with the floor), not a height
                                  // adjustment — at 1.0 the visible character
                                  // model renders a full meter above where the
                                  // camera/physics/gun all expect it to be,
                                  // which is exactly "the body disappeared,
                                  // I'm just a floating gun": the gun still
                                  // tracks the hand bone's real (now 1m-too-high)
                                  // world position correctly, while the body
                                  // itself ends up pushed out of the expected
                                  // view.
let playerRigObjRef = null;
export const ZOMBIE_TARGET_HEIGHT = 1.8;

export function applyPlayerScale() {
  if (!playerRigObjRef) return;
  const finalScale = state.playerBaseScale * state.playerScaleOverride;
  // Zero the offset BEFORE measuring, every time. Previously the box was
  // measured at whatever position.y this function last left the rig at,
  // so each [ / ] press re-derived its offset from an already-offset box
  // and stacked a new adjustment on top of the old one — a few presses
  // and the model drifts up into the air ("walking mid-air"). Resetting
  // first makes every call measure from the same neutral baseline, so
  // repeated presses adjust scale only, not accumulate vertical drift.
  playerRigObjRef.position.y = 0;
  playerRigObjRef.scale.setScalar(finalScale);
  const box = new THREE.Box3().setFromObject(playerRigObjRef);
  playerRigObjRef.position.y = -box.min.y + PLAYER_FOOT_ADJUST;
  const height = box.max.y - box.min.y;
  state.playerCurrentHeight = height;
  pushKillFeed(`Player scale ×${finalScale.toFixed(3)} — height ${height.toFixed(2)}m (zombies are ~${ZOMBIE_TARGET_HEIGHT}m)`);
}
export function adjustPlayerScale(factor) {
  if (!playerRigObjRef) return;
  state.playerScaleOverride *= factor;
  applyPlayerScale();
}

export const GUN_GRIP_PRESETS = [
  { pos: [0.04, -0.02, 0.09], rot: [-Math.PI / 2, 0, 0] },
  { pos: [0.04, -0.02, 0.09], rot: [-Math.PI / 2, 0, Math.PI / 2] },
  { pos: [0.02, 0.03, 0.06], rot: [0, Math.PI / 2, 0] },
  { pos: [0.02, 0.03, 0.06], rot: [Math.PI / 2, 0, Math.PI / 2] },
  { pos: [0, -0.05, 0.1], rot: [0, 0, 0] },
  { pos: [0.02, -0.02, 0.08], rot: [0, 0, Math.PI / 2] },
  { pos: [0.02, -0.02, 0.08], rot: [0, Math.PI, Math.PI / 2] },
  { pos: [0.02, -0.02, 0.08], rot: [Math.PI / 2, Math.PI / 2, 0] },
  { pos: [0.02, -0.02, 0.08], rot: [-Math.PI / 2, Math.PI / 2, 0] },
  { pos: [0.02, -0.02, 0.08], rot: [0, -Math.PI / 2, 0] },
];
export function cycleGunGrip() {
  state.gunGripIndex = (state.gunGripIndex + 1) % GUN_GRIP_PRESETS.length;
  applyGunOrientation();
  pushKillFeed(`Gun grip preset ${state.gunGripIndex}`);
}

function findBoneLike(root, substr) {
  let found = null;
  root.traverse((o) => {
    if (!found && o.name && o.name.includes(substr)) found = o;
  });
  return found;
}

export function setPlayerAction(name, fade = 0.16, restart = false) {
  if (!playerVis.actions || (!restart && playerVis.currentActionName === name)) return;
  const to = playerVis.actions[name];
  if (!to) return;
  const from = playerVis.actions[playerVis.currentActionName];
  Object.values(playerVis.actions).forEach((action) => {
    if (action !== from && action !== to) action.stop();
  });
  to.reset().setEffectiveWeight(1).play();
  if (from && from !== to) to.crossFadeFrom(from, fade, false);
  playerVis.currentActionName = name;
}

export function playPlayerGesture(name, seconds) {
  const action = playerVis.actions && playerVis.actions[name];
  if (!action || state.isDead || state.paused || state.playerActionLock > 0) return;
  action.setEffectiveTimeScale(action.getClip().duration / seconds);
  setPlayerAction(name, 0.1, true);
  state.playerActionLock = seconds;
}
export function triggerOneShot(action) {
  if (!action) return;
  action.reset().setEffectiveWeight(1).play();
}
export function triggerShootAnim() {
  if (!playerVis.shootAction) return;
  playerVis.shootAction.reset();
  playerVis.shootAction.play();
}

// Player action -> clip name in assets/characters/animations.glb (built
// from art/animations/<clip>.fbx). A missing clip just leaves that action
// out: pickLocomotionAction falls back (strafes/back -> walk, jumpBack ->
// jump) and death skips its animation.
const PLAYER_CLIPS = {
  idle: ['idle', 'listen'],
  walk: ['walk'],
  sprint: ['run', 'walk'],
  walkBack: ['walk_back'],
  strafeL: ['strafe_left'],
  strafeR: ['strafe_right'],
  jump: ['jump'],
  die: ['die'],
};
const PLAYER_ONE_SHOTS = new Set(['jump', 'die']);

export function loadMainCharacter() {
  const characterId = getSelectedCharacter();
  instantiateCharacter(characterId).then(async (obj) => {
    const clips = await clipsFor(obj);
    // A fresh clone has never had its world matrices computed; measuring
    // before this reads the Armature's cm->m 0.01 scale as identity.
    obj.updateMatrixWorld(true);
    const box0 = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box0.getSize(size);
    state.playerBaseScale = THREE.MathUtils.clamp(PLAYER_TARGET_HEIGHT / Math.max(size.y, 0.2), 0.05, 2.8);
    obj.rotation.y = state.PLAYER_RIG_YAW_OFFSET;
    playerVis.proceduralBody.visible = false;
    playerVis.group.add(obj);
    playerVis.rigged = true;
    playerVis.rigObj = obj;
    playerRigObjRef = obj;
    applyPlayerScale();
    playerVis.groundOffset = obj.position.y;
    playerVis.footBoneL = boneByName(obj, 'LeftFoot');
    playerVis.footBoneR = boneByName(obj, 'RightFoot');
    if (!playerVis.footBoneL && !playerVis.footBoneR) {
      // Without a foot bone, groundClampRig() silently no-ops every frame
      // and the player's height is whatever applyPlayerScale set once at
      // load — nothing corrects it afterward. Flagged loudly rather than
      // failing silently, since this is the #1 cause of "floating" reports.
      pushKillFeed('WARNING: no player foot bone found — ground clamp disabled, model may float');
    } else {
      playerVis.ankleToSole = measureAnkleToSole(obj, playerVis.footBoneL, playerVis.footBoneR);
    }
    const handBone = boneByName(obj, 'RightHand');
    if (handBone) {
      playerVis.handBone = handBone;
      playerVis.handGrip = solveHandGrip(obj, handBone);
      playerVis.gunOnHand = true;
      if (playerVis.gun) playerVis.gun.rotation.set(0, 0, 0); // the grip orients the whole pivot now
      knifeThirdPerson.rotation.set(0, Math.PI, 0); // blade along the gun's muzzle (+Z), not back up the arm
      playerVis.group.remove(playerVis.gunPivot);
      scene.add(playerVis.gunPivot);
    }

    playerVis.mixer = new THREE.AnimationMixer(obj);
    playerVis.actions = {};
    for (const [key, names] of Object.entries(PLAYER_CLIPS)) {
      const clip = names.map((n) => clips[n]).find(Boolean);
      if (!clip) continue;
      const action = playerVis.mixer.clipAction(clip);
      if (PLAYER_ONE_SHOTS.has(key)) {
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
      }
      playerVis.actions[key] = action;
    }
    if (clips.jump) playerVis.jumpDuration = clips.jump.duration;
    if (clips.die) playerVis.dieDuration = clips.die.duration;
    if (clips.shoot) {
      // Additive, so the recoil layers over whatever locomotion is playing
      const additiveShoot = THREE.AnimationUtils.makeClipAdditive(clips.shoot);
      playerVis.shootAction = playerVis.mixer.clipAction(additiveShoot);
      playerVis.shootAction.blendMode = THREE.AdditiveAnimationBlendMode;
      playerVis.shootAction.setLoop(THREE.LoopOnce);
      playerVis.shootAction.clampWhenFinished = false;
      playerVis.shootAction.setEffectiveTimeScale(clips.shoot.duration / 0.18);
      playerVis.shootAction.enabled = true;
      playerVis.shootAction.setEffectiveWeight(1);
    }
    const missing = [...Object.keys(PLAYER_CLIPS), 'shoot'].filter((k) => !playerVis.actions[k] && !(k === 'shoot' && playerVis.shootAction));
    if (missing.length) pushKillFeed(`Player anims missing: ${missing.join(', ')}`);
    if (playerVis.actions.idle) {
      playerVis.actions.idle.play();
      playerVis.currentActionName = 'idle';
    }
    state.loadFlags.player = true;
    markLoaded('player');
  }).catch((err) => {
    console.error('Player model failed to load:', err);
    pushKillFeed('Player model failed to load — using fallback body');
    markLoaded('player');
  });
}

// Pistol pose relative to the roster rig's RightHand bone, solved per
// character from its rest T-pose (right arm out along -X, palm down, thumb
// forward) because hand bones rest at slightly different angles on each
// body. pistol.glb has its slide on +Y and muzzle on +Z; it's set with the
// muzzle along the hand, slide toward the back of the hand and the grip
// (model point 0,-3,-1) in the palm. The rigs have no finger bones, so this
// is as close as the hand can get to holding it — verified on the pistol
// idle, walk and shooting clips. Must run before any clip poses the rig.
const GRIP_PALM_ALONG_HAND = 8;   // hand-bone units (cm) out from the wrist
const GRIP_PALM_BELOW = 0.02;     // metres toward the palm side
function solveHandGrip(rig, hand) {
  rig.updateMatrixWorld(true);
  const rigQ = rig.getWorldQuaternion(new THREE.Quaternion());
  const toRig = rigQ.clone().invert();
  const handQ = toRig.clone().multiply(hand.getWorldQuaternion(new THREE.Quaternion()));
  const gunQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), Math.PI / 2)
    .multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0))));
  const handPos = hand.getWorldPosition(new THREE.Vector3());
  const palm = hand.localToWorld(new THREE.Vector3(0, GRIP_PALM_ALONG_HAND, 0)).sub(handPos)
    .applyQuaternion(toRig).add(new THREE.Vector3(0, -GRIP_PALM_BELOW, 0));
  const grip = new THREE.Vector3(0, -3, -1).multiplyScalar(PISTOL_SCALE).applyQuaternion(gunQ);
  return {
    quat: handQ.invert().multiply(gunQ),
    pos: palm.sub(grip).applyQuaternion(gunQ.clone().invert()),
  };
}

const _gunSyncPos = new THREE.Vector3();
const _gunSyncQuat = new THREE.Quaternion();
const _gunGripQuat = new THREE.Quaternion();
const _gunGripEuler = new THREE.Euler();
export function syncHandGun() {
  if (!playerVis.gunOnHand || !playerVis.handBone || state.inVehicle || state.firstPerson) return;
  playerVis.handBone.getWorldPosition(_gunSyncPos);
  playerVis.handBone.getWorldQuaternion(_gunSyncQuat);
  const grip = playerVis.handGrip;
  if (grip) {
    playerVis.gunPivot.position.copy(_gunSyncPos);
    playerVis.gunPivot.quaternion.copy(_gunSyncQuat).multiply(grip.quat);
    playerVis.gunPivot.translateX(grip.pos.x);
    playerVis.gunPivot.translateY(grip.pos.y);
    playerVis.gunPivot.translateZ(grip.pos.z);
    return;
  }
  const preset = GUN_GRIP_PRESETS[state.gunGripIndex];
  playerVis.gunPivot.position.copy(_gunSyncPos);
  playerVis.gunPivot.quaternion.copy(_gunSyncQuat);
  _gunGripEuler.set(...preset.rot);
  _gunGripQuat.setFromEuler(_gunGripEuler);
  playerVis.gunPivot.quaternion.multiply(_gunGripQuat);
  playerVis.gunPivot.translateX(preset.pos[0]);
  playerVis.gunPivot.translateY(preset.pos[1]);
  playerVis.gunPivot.translateZ(preset.pos[2]);
}

export function cyclePlayerRigYaw() {
  state.PLAYER_RIG_YAW_OFFSET = cycleOffset(state.PLAYER_RIG_YAW_OFFSET);
  if (playerVis.rigObj) playerVis.rigObj.rotation.y = state.PLAYER_RIG_YAW_OFFSET;
  pushKillFeed('Player facing adjusted');
}
export function cycleZombieRigYaw() {
  state.ZOMBIE_RIG_YAW_OFFSET = cycleOffset(state.ZOMBIE_RIG_YAW_OFFSET);
  state.zombies.forEach((z) => { if (z.rigObj) z.rigObj.rotation.y = state.ZOMBIE_RIG_YAW_OFFSET; });
  pushKillFeed('Zombie facing adjusted');
}
export function cycleCarRigYaw() {
  if (state.skipCar || !carVis) return;
  state.CAR_RIG_YAW_OFFSET = cycleOffset(state.CAR_RIG_YAW_OFFSET);
  carVis.bodyRoot.rotation.y = state.CAR_RIG_YAW_OFFSET;
  pushKillFeed('Car facing adjusted');
}
function cycleOffset(cur) {
  const steps = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const i = steps.findIndex((v) => Math.abs(v - cur) < 0.01);
  return steps[(i + 1) % steps.length];
}

/* ---------------------------------------------------------------------
   KNIFE VISUALS
--------------------------------------------------------------------- */
export function buildKnifeMesh() {
  const g = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd8dde0, metalness: 0.85, roughness: 0.22 });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x2a211a, roughness: 0.8 });
  const guardMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.35 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.012, 0.19), bladeMat);
  blade.position.z = -0.13;
  g.add(blade);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.05, 4), bladeMat);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.245;
  g.add(tip);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.018, 0.014), guardMat);
  guard.position.z = -0.028;
  g.add(guard);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.11, 8), handleMat);
  handle.rotation.x = Math.PI / 2;
  handle.position.z = 0.05;
  g.add(handle);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export const knifeThirdPerson = buildKnifeMesh();
knifeThirdPerson.visible = false;
playerVis.gunPivot.add(knifeThirdPerson);
export const knifeViewModel = buildKnifeMesh();
knifeViewModel.scale.setScalar(1.4);
prepareViewmodel(knifeViewModel);
knifeViewModel.position.set(0.22, -0.18, -0.32);
knifeViewModel.visible = false;
camera.add(knifeViewModel);

// Keep the original camera parent: muzzle/tracer world positions remain
// correct immediately after mouse look, without synchronizing a proxy rig.
// These inexpensive lights are visible only in the weapon layer.
const viewmodelAmbient = new THREE.AmbientLight(0xdfe8ff, 1.5);
viewmodelAmbient.layers.set(VIEWMODEL_LAYER);
const viewmodelKey = new THREE.DirectionalLight(0xffe2bd, 2.0);
viewmodelKey.layers.set(VIEWMODEL_LAYER);
viewmodelKey.position.set(-1, 2, 3);
camera.add(viewmodelKey);
camera.add(viewmodelKey.target);
viewmodelKey.target.position.set(0, 0, -1);
scene.add(viewmodelAmbient);

const levelViewmodels = new Set();
export function registerLevelViewmodel(root){
  prepareViewmodel(root);root.visible=false;camera.add(root);levelViewmodels.add(root);
}

// Warm shared weapon materials while the player is still in third person.
// A small detached scene avoids compiling the entire city's materials.
export function warmViewmodels(renderer) {
  if (warmedViewmodelRevision === viewmodelRevision) return viewmodelWarmPromise || Promise.resolve();
  const revision = viewmodelRevision;
  warmedViewmodelRevision = revision;
  const warmScene = new THREE.Scene();
  warmScene.add(viewmodelAmbient.clone(), viewmodelKey.clone());
  const materials=new Map();
  for (const root of [viewmodelGun, knifeViewModel,...levelViewmodels]) {
    const clone = root.clone(true);
    clone.visible = true;
    clone.traverse((object) => {
      object.visible = true;
      if(object.isMesh){
        const copy=source=>{if(!materials.has(source)){const m=source.clone();materials.set(source,m);viewmodelWarmMaterials.add(m);}return materials.get(source);};
        object.material=Array.isArray(object.material)?object.material.map(copy):copy(object.material);
      }
    });
    warmScene.add(clone);
  }
  const warmCamera = camera.clone(false);
  warmCamera.layers.set(VIEWMODEL_LAYER);
  warmCamera.position.set(0,0,0);warmCamera.quaternion.identity();warmCamera.near=.01;warmCamera.far=10;warmCamera.updateProjectionMatrix();
  // Private warmup materials stay alive for this level. Deferred pistol
  // replacement cannot dispose a program while r160 polls its readiness.
  viewmodelWarmError=null;
  viewmodelWarmPromise=(async()=>{
    if(renderer.compileAsync)await renderer.compileAsync(warmScene,warmCamera);
    else renderer.compile(warmScene,warmCamera);
    if(viewmodelRevision!==revision)return warmViewmodels(renderer);
    if(!state.readyShown)renderer.render(warmScene,warmCamera);
    readyViewmodelRevision=revision;
  })().catch(error=>{if(viewmodelRevision!==revision)return warmViewmodels(renderer);viewmodelWarmError=error;throw error;});
  return viewmodelWarmPromise;
}

// Call immediately after the world render. Clearing only depth lets nearby
// walls stay behind the weapon while preserving the weapon's own occlusion.
export function renderViewmodels(renderer) {
  if(viewmodelWarmError)throw viewmodelWarmError;
  warmViewmodels(renderer).catch(()=>{}); // surfaced through the render loop on the next frame
  if (!viewmodelGun.visible && !knifeViewModel.visible) {
    let visible=false;for(const root of levelViewmodels)if(root.visible){visible=true;break;}
    if(!visible)return;
  }
  // If the view changes during warmup, defer only the weapon overlay until
  // its shaders are ready rather than blocking the game on first reveal.
  if (readyViewmodelRevision !== viewmodelRevision) return;
  const layerMask = camera.layers.mask;
  const background = scene.background;
  const fog = scene.fog;
  const autoClear = renderer.autoClear;
  const matrixAutoUpdate = scene.matrixWorldAutoUpdate;
  const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
  const shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
  try {
    camera.layers.set(VIEWMODEL_LAYER);
    scene.background = null;
    scene.fog = null;
    scene.matrixWorldAutoUpdate = false;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.clearDepth();
    renderer.render(scene, camera);
  } finally {
    camera.layers.mask = layerMask;
    scene.background = background;
    scene.fog = fog;
    scene.matrixWorldAutoUpdate = matrixAutoUpdate;
    renderer.autoClear = autoClear;
    renderer.shadowMap.autoUpdate = shadowAutoUpdate;
    renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
  }
}

/* ---------------------------------------------------------------------
   VEHICLE (drivable truck)
--------------------------------------------------------------------- */
export const carSpawn = new THREE.Vector3(-1.8, 0.85, 22);
export const CAR_MAX_FUEL = 100;
if (!state.skipCar) state.carFuel = CAR_MAX_FUEL;

function buildCarMesh() {
  const g = new THREE.Group();
  const bodyRoot = new THREE.Group();
  g.add(bodyRoot);
  const paint = new THREE.MeshStandardMaterial({ color: 0xb3151f, metalness: 0.62, roughness: 0.22 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x141a1e, metalness: 0.2, roughness: 0.08, transparent: true, opacity: 0.72 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 0.4, roughness: 0.5 });
  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.5, 4.35), paint);
  lower.position.y = 0.48; lower.castShadow = true; lower.receiveShadow = true;
  bodyRoot.add(lower);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 1.45), paint);
  hood.position.set(0, 0.72, -1.5); hood.castShadow = true;
  bodyRoot.add(hood);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.5, 1.85), glass);
  cabin.position.set(0, 0.98, 0.15); cabin.castShadow = true;
  bodyRoot.add(cabin);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.26, 0.95), paint);
  trunk.position.set(0, 0.74, 1.78);
  bodyRoot.add(trunk);
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.26, 0.22), dark);
  bumperF.position.set(0, 0.36, -2.28);
  bodyRoot.add(bumperF);
  const bumperR = bumperF.clone(); bumperR.position.z = 2.28; bodyRoot.add(bumperR);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe9a8, emissiveIntensity: 2.4 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0808, emissive: 0xff1a1a, emissiveIntensity: 1.8 });
  [-0.65, 0.65].forEach((x) => {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), headMat);
    hl.position.set(x, 0.5, -2.36); bodyRoot.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), tailMat);
    tl.position.set(x, 0.55, 2.36); bodyRoot.add(tl);
  });
  const headlightSpot1 = new THREE.SpotLight(0xfff1c8, 5.5, 46, Math.PI / 7, 0.45, 1.1);
  headlightSpot1.position.set(-0.55, 0.52, -2.2);
  const target1 = new THREE.Object3D(); target1.position.set(-0.55, 0.1, -22); g.add(target1);
  headlightSpot1.target = target1;
  g.add(headlightSpot1);
  const headlightSpot2 = new THREE.SpotLight(0xfff1c8, 5.5, 46, Math.PI / 7, 0.45, 1.1);
  headlightSpot2.position.set(0.55, 0.52, -2.2);
  const target2 = new THREE.Object3D(); target2.position.set(0.55, 0.1, -22); g.add(target2);
  headlightSpot2.target = target2;
  g.add(headlightSpot2);
  g.position.copy(carSpawn);
  scene.add(g);
  const wheelMeshes = [];
  const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.34, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.4, metalness: 0.7 });
  for (let i = 0; i < 4; i++) {
    const wm = new THREE.Mesh(wheelGeo, rimMat);
    wm.castShadow = true;
    scene.add(wm);
    wheelMeshes.push(wm);
  }
  return { group: g, bodyRoot, wheelMeshes, headlightSpot1, headlightSpot2, wheelBones: null };
}

export const carVis = state.skipCar ? null : buildCarMesh();
const TRUCK_TARGET_LENGTH = 4.8; // ~8% under 5.2: the model's roof sat ~2.4 m up, dwarfing the characters
if (!state.skipCar) new GLTFLoader().load('assets/zombie_pickup_truck.glb', (gltf) => {
  const obj = gltf.scene;
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); box.getSize(size);
  const scale = TRUCK_TARGET_LENGTH / Math.max(size.x, size.z, 0.01);
  obj.scale.setScalar(scale);
  const box2 = new THREE.Box3().setFromObject(obj);
  const center = new THREE.Vector3(); box2.getCenter(center);
  obj.position.set(-center.x, -box2.min.y - 0.02, -center.z);
  while (carVis.bodyRoot.children.length) carVis.bodyRoot.remove(carVis.bodyRoot.children[0]);
  carVis.bodyRoot.add(obj);
  carVis.bodyRoot.rotation.y = state.CAR_RIG_YAW_OFFSET;
  carVis.loadedCar = obj;
  state.loadFlags.car = true;
  markLoaded('car');
}, undefined, () => { state.loadFlags.car = true; markLoaded('car'); });

const __carPhysics = state.skipCar ? null : (() => {
  // Collision box follows the smaller truck model (4.8 m); wheels stay put for handling
  const chassisShape = new CANNON.Box(new CANNON.Vec3(0.97, 0.5, 2.4));
  const _chassisBody = new CANNON.Body({ mass: 1650, material: matChassis, linearDamping: 0.12, angularDamping: 0.35 });
  _chassisBody.addShape(chassisShape, new CANNON.Vec3(0, 0.5, 0));
  _chassisBody.position.set(carSpawn.x, 1.05, carSpawn.z);
  _chassisBody.angularVelocity.set(0, 0, 0);
  const _vehicle = new CANNON.RaycastVehicle({
    chassisBody: _chassisBody,
    indexForwardAxis: 2,
    indexRightAxis: 0,
    indexUpAxis: 1,
  });
  const wheelOptions = {
    radius: 0.46,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 46,
    suspensionRestLength: 0.32,
    frictionSlip: 3.6,
    dampingRelaxation: 2.9,
    dampingCompression: 5.2,
    maxSuspensionForce: 240000,
    rollInfluence: 0.1,
    axleLocal: new CANNON.Vec3(1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(1, 0, 1),
    maxSuspensionTravel: 0.24,
    customSlidingRotationalSpeed: -28,
    useCustomSlidingRotationalSpeed: true,
  };
  wheelOptions.chassisConnectionPointLocal.set(-1.05, 0.1, -1.95); _vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: wheelOptions.chassisConnectionPointLocal.clone() });
  wheelOptions.chassisConnectionPointLocal.set(1.05, 0.1, -1.95); _vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: wheelOptions.chassisConnectionPointLocal.clone() });
  wheelOptions.chassisConnectionPointLocal.set(-1.05, 0.1, 1.95); _vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: wheelOptions.chassisConnectionPointLocal.clone() });
  wheelOptions.chassisConnectionPointLocal.set(1.05, 0.1, 1.95); _vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: wheelOptions.chassisConnectionPointLocal.clone() });
  _vehicle.addToWorld(world);
  return {
    chassisBody: _chassisBody,
    vehicle: _vehicle,
    FRONT_WHEELS: [0, 1],
    REAR_WHEELS: [2, 3],
    MAX_STEER: 0.5,
    MAX_ENGINE_FORCE: 5600,
    MAX_BRAKE_FORCE: 65,
    HANDBRAKE_FORCE: 95,
  };
})();
export const chassisBody = __carPhysics ? __carPhysics.chassisBody : null;
export const vehicle = __carPhysics ? __carPhysics.vehicle : null;
export const FRONT_WHEELS = __carPhysics ? __carPhysics.FRONT_WHEELS : [];
export const REAR_WHEELS = __carPhysics ? __carPhysics.REAR_WHEELS : [];
export const MAX_STEER = __carPhysics ? __carPhysics.MAX_STEER : 0;
export const MAX_ENGINE_FORCE = __carPhysics ? __carPhysics.MAX_ENGINE_FORCE : 0;
export const MAX_BRAKE_FORCE = __carPhysics ? __carPhysics.MAX_BRAKE_FORCE : 0;
export const HANDBRAKE_FORCE = __carPhysics ? __carPhysics.HANDBRAKE_FORCE : 0;

export function loadCars() {
  // Drivable vehicle is already constructed above (module init); this
  // function loads the purely decorative parked/wrecked cars using real
  // GLB models, same as loadObstacles' decor cars call — kept here too
  // as the "loadCars" entry point per the requested file structure.
}

export function checkVehicleRollover(dt) {
  if (!Number.isFinite(chassisBody.velocity.x) || !Number.isFinite(chassisBody.velocity.y) || !Number.isFinite(chassisBody.velocity.z)
    || !Number.isFinite(chassisBody.position.x) || !Number.isFinite(chassisBody.position.y) || !Number.isFinite(chassisBody.position.z)) {
    chassisBody.position.set(carSpawn.x, carSpawn.y + 1, carSpawn.z);
    chassisBody.quaternion.set(0, 0, 0, 1);
    chassisBody.velocity.set(0, 0, 0);
    chassisBody.angularVelocity.set(0, 0, 0);
    state.carSteer = 0;
    state.carThrottle = 0;
    state.rolloverTimer = 0;
    return;
  }
  const worldUp = new CANNON.Vec3();
  chassisBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0), worldUp);
  const speed = chassisBody.velocity.length();
  const isUpsideDown = worldUp.y < -0.15;
  state.rolloverTimer = (isUpsideDown && speed < 1.5) ? state.rolloverTimer + dt : 0;
  if (state.rolloverTimer > 1.5) {
    const q = new THREE.Quaternion(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w);
    const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    const uprightQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, euler.y, 0, 'YXZ'));
    chassisBody.quaternion.set(uprightQ.x, uprightQ.y, uprightQ.z, uprightQ.w);
    chassisBody.position.y += 1.15;
    chassisBody.velocity.set(0, 0, 0);
    chassisBody.angularVelocity.set(0, 0, 0);
    state.rolloverTimer = 0;
    pushKillFeed('Vehicle righted itself');
  }
}

/* ---------------------------------------------------------------------
   ZOMBIES
--------------------------------------------------------------------- */
const zombieMat1 = new THREE.MeshStandardMaterial({ map: zombieSkinTex, color: 0x5c6b4c, roughness: 0.95 });
const zombieMat2 = new THREE.MeshStandardMaterial({ map: zombieSkinTex, color: 0x3f4a38, roughness: 0.95 });
function buildZombieMesh() {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.6, 4, 8), zombieMat1);
  torso.position.y = 1.0; torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), zombieMat2);
  head.position.y = 1.5; head.castShadow = true;
  g.add(head);
  // Infected wound glow — was a flat dark-red blob (createToxicMaterial,
  // see shaders.js); one fresh material per zombie so each pulse desyncs.
  const wound = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), createToxicMaterial(0x8a2f10));
  wound.position.set(0.15, 1.05, 0.18);
  g.add(wound);
  const hip = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.15, 4, 8), zombieMat1);
  hip.position.y = 0.58;
  g.add(hip);
  function limb(mat, len, r) { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat); m.castShadow = true; return m; }
  const legL = limb(zombieMat2, 0.65, 0.1); legL.position.set(-0.12, 0.33, 0);
  const legR = limb(zombieMat2, 0.65, 0.1); legR.position.set(0.12, 0.33, 0);
  const armL = limb(zombieMat1, 0.5, 0.08); armL.position.set(-0.38, 0.95, 0);
  const armR = limb(zombieMat1, 0.5, 0.08); armR.position.set(0.38, 0.95, 0);
  g.add(legL, legR, armL, armR);
  g.traverse((o) => { if (o.isMesh) o.userData.isZombiePart = true; });
  return { group: g, legL, legR, armL, armR, head };
}

const avoidanceGrid = new CircleGrid();
export function avoidObstacles(pos, move, extra = []) {
  const push = new THREE.Vector3();
  // Was: state.obstacles.concat(extra) — allocated a brand-new merged array
  // on every call (once per zombie per frame). Looping the two lists back
  // to back does the same job with zero extra allocation.
  const nearby = avoidanceGrid.query(state.obstacles, pos.x, pos.z);
  for (let i = 0; i < nearby.length; i++) {
    const o = nearby[i];
    const dx = pos.x - o.x, dz = pos.z - o.z;
    const d = Math.hypot(dx, dz) || 0.0001;
    const minD = o.r + 0.55;
    if (d < minD) {
      const str = (minD - d) / minD;
      push.x += (dx / d) * str;
      push.z += (dz / d) * str;
    }
  }
  for (let i = 0; i < extra.length; i++) {
    const o = extra[i];
    const dx = pos.x - o.x, dz = pos.z - o.z;
    const d = Math.hypot(dx, dz) || 0.0001;
    const minD = o.r + 0.55;
    if (d < minD) {
      const str = (minD - d) / minD;
      push.x += (dx / d) * str;
      push.z += (dz / d) * str;
    }
  }
  move.add(push);
  if (move.lengthSq() > 0.0001) move.normalize();
  return move;
}

export function clampZombieX(x, z) {
  if (Math.abs(z - DEPOT_POS.z) < 18) return x;
  if (Math.abs(z - WEST_POCKET_Z) < 14) return x;
  return THREE.MathUtils.clamp(x, -STREET_HALF_W - 2.5, STREET_HALF_W + 2.5);
}
export function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * Math.min(t, 1);
}
// Fallback only — used when a rig has no per-model measurement (see
// measureAnkleToSole below). This was previously the ONLY value, applied
// to every rig regardless of its actual proportions: fine for whichever
// model it was originally tuned against, wrong for any other model whose
// ankle-bone-to-sole distance differs (e.g. model-rigged.glb's feet sink
// into the ground because its real ankle bone sits higher/lower above its
// sole than 0.09 units).
const ANKLE_TO_SOLE = 0.09;
const _groundClampTmp = new THREE.Vector3();
export function groundClampRig(rigObj, boneL, boneR, dt, rate = 10, ankleToSole = ANKLE_TO_SOLE, groundY = 0) {
  if (!rigObj || (!boneL && !boneR)) return;
  let lowY = Infinity;
  if (boneL) { boneL.getWorldPosition(_groundClampTmp); lowY = Math.min(lowY, _groundClampTmp.y); }
  if (boneR) { boneR.getWorldPosition(_groundClampTmp); lowY = Math.min(lowY, _groundClampTmp.y); }
  const soleY = lowY - ankleToSole;
  const idealY = rigObj.position.y + groundY - soleY;
  rigObj.position.y = THREE.MathUtils.lerp(rigObj.position.y, idealY, Math.min(1, dt * rate));
}

// Measures the TRUE ankle-bone-to-sole distance for a specific rig
// instance, in its own bind pose, instead of assuming every model shares
// the same proportions. Call once, right after the rig is built and
// before any animation has advanced its pose.
function measureAnkleToSole(rigObj, boneL, boneR) {
  if (!boneL && !boneR) return ANKLE_TO_SOLE;
  rigObj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(rigObj);
  let lowY = Infinity;
  if (boneL) { boneL.getWorldPosition(_groundClampTmp); lowY = Math.min(lowY, _groundClampTmp.y); }
  if (boneR) { boneR.getWorldPosition(_groundClampTmp); lowY = Math.min(lowY, _groundClampTmp.y); }
  if (!isFinite(lowY) || !isFinite(box.min.y)) return ANKLE_TO_SOLE;
  // Confirmed via runtime logging (both on clones AND on the original
  // template, ruling out cloning as the cause): for model-rigged.glb this
  // computation produces a NEGATIVE value — the ankle bone measuring as
  // being below the mesh's own lowest point, which is impossible. The
  // real explanation: Box3.setFromObject() on a SkinnedMesh measures the
  // RAW, UNPOSED vertex geometry transformed only by the mesh node's own
  // transform — it has no knowledge of the skeleton/joints at all
  // (skinning happens on the GPU, invisible to this kind of CPU query).
  // For a standard Mixamo rig the mesh node and skeleton happen to align
  // well enough that this works by coincidence; model-rigged.glb's
  // differently-authored rig (it has an unusual, non-sequential joint
  // index order) apparently doesn't have that coincidental alignment, so
  // the box is meaningless relative to where the joints actually are.
  // Rather than trust a number that's already proven nonsensical for
  // this file, validate it's within a plausible human range first.
  const raw = lowY - box.min.y;
  if (raw < 0.01 || raw > 0.35) {
    console.log('[measureAnkleToSole] rejected implausible value', raw.toFixed(3), '— using default', ANKLE_TO_SOLE);
    return ANKLE_TO_SOLE;
  }
  // Small safety margin: accounts for a real gait shifting the foot's
  // actual ground-contact point between heel-strike and toe-off through
  // the stride, which a single fixed offset can't perfectly match every
  // frame of.
  return raw + 0.02;
}

/* ---------------------------------------------------------------------
   DEATH SPARKLES — replaces the old lingering corpse. A confirmed kill
   (gunshot, melee, knife, or explosion) blows the zombie apart into a
   burst of glowing sparkle particles instead of leaving a body behind;
   the coin spawned right after is the only thing left on the ground.
   Reuses state.activeSparks (already updated/faded/removed every frame
   by Actions.js's animation loop, same as the smaller gunshot hit-spark
   burst) rather than adding a second particle system.
--------------------------------------------------------------------- */
const deathSparkGeo = new THREE.IcosahedronGeometry(0.07, 0);
const DEATH_SPARK_COLORS = [0xfff4c2, 0xffe37a, 0x9ff7ff, 0xffffff];
export function spawnDeathSparkles(pos) {
  const center = pos.clone().add(new THREE.Vector3(0, 0.9, 0));
  const flash = acquireEffectLight(0xbfe9ff, 6, 6, 2);
  if (flash) {
    flash.position.copy(center);
    setTimeout(() => releaseEffectLight(flash), 120);
  }
  for (let i = 0; i < 22; i++) {
    const color = DEATH_SPARK_COLORS[Math.floor(Math.random() * DEATH_SPARK_COLORS.length)];
    const s = new THREE.Mesh(deathSparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    s.position.copy(center);
    s.scale.setScalar(0.6 + Math.random() * 0.9);
    const angle = Math.random() * Math.PI * 2;
    const outSpeed = 1.4 + Math.random() * 2.6;
    const upSpeed = 2.2 + Math.random() * 2.8;
    s.userData.vel = new THREE.Vector3(Math.cos(angle) * outSpeed, upSpeed, Math.sin(angle) * outSpeed);
    s.userData.life = 0.55 + Math.random() * 0.35;
    s.userData.maxLife = s.userData.life;
    scene.add(s);
    state.activeSparks.push(s);
  }
}

const zombieTemplates = [];
let zombieTemplateResolved = false;
function loadZombieTemplate(path, opts = {}) {
  new GLTFLoader().load(path, (gltf) => {
    const obj = gltf.scene;
    let box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    const scale = THREE.MathUtils.clamp(ZOMBIE_TARGET_HEIGHT / Math.max(size.y, 0.2), 0.15, 2.8);
    obj.scale.setScalar(scale);
    box = new THREE.Box3().setFromObject(obj);
    const footOffset = -box.min.y + 0.05;
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // Ankle-to-sole measured HERE, once, on the original template — not
    // re-measured per-instance on each skeletonClone() copy. Confirmed via
    // runtime logging that model-rigged.glb's CLONED instances produce a
    // nonsensical NEGATIVE ankle-to-sole (the ankle bone measuring as
    // being below the mesh's own lowest point, which is geometrically
    // impossible), while the original un-cloned template measures fine.
    // That specific model's skin has a scrambled, non-sequential joint
    // index order, which is the most likely reason cloning desyncs the
    // bones from the mesh's actual bounds for this rig specifically.
    // Measuring once against the trustworthy original and reusing that
    // same number for every spawned instance sidesteps the problem
    // entirely, whatever its exact cause.
    const footBoneL = findBoneLike(obj, 'LeftFoot') || findBoneLike(obj, 'L_Ankle') || findBoneLike(obj, 'Left_Ankle') || null;
    const footBoneR = findBoneLike(obj, 'RightFoot') || findBoneLike(obj, 'R_Ankle') || findBoneLike(obj, 'Right_Ankle') || null;
    const templateAnkleToSole = measureAnkleToSole(obj, footBoneL, footBoneR);
    console.log('[zombie template]', path, 'template-measured ankleToSole:', templateAnkleToSole.toFixed(3));
    zombieTemplates.push({ scene: obj, animations: gltf.animations || [], footOffset, runs: !!opts.runs, path, ankleToSole: templateAnkleToSole });
    state.loadFlags.zombie = true;
    markLoaded('zombie');
    if (!zombieTemplateResolved) {
      zombieTemplateResolved = true;
      for (let i = 0, n = Math.round(6 * state.zombieCountMul); i < n; i++) spawnZombie();
    }
  }, undefined, () => {
    state.loadFlags.zombie = true;
    markLoaded('zombie');
    if (!zombieTemplateResolved) {
      zombieTemplateResolved = true;
      for (let i = 0, n = Math.round(6 * state.zombieCountMul); i < n; i++) spawnZombie();
    }
  });
}

export function loadZombies() {
  loadZombieTemplate('assets/zombie_running_on_metel_maniac.glb');
  // model-rigged.glb is the fast "runner" variant — `runs: true` makes the
  // Zombie constructor below prefer a run-named clip (at full animation
  // speed, not the shambling 0.4x timeScale) and move noticeably faster.
  // Light boot (Level 2): the walker template alone gates the loading
  // screen; the runner joins via loadDeferredAssets() once gameplay is
  // running — templates are drawn at construction time, so zombies
  // spawned after it arrives simply start including it.
  if (!state.lightBoot) loadZombieTemplate('assets/model-rigged.glb', { runs: true });
}

/* ---------------------------------------------------------------------
   LIGHT BOOT — deferred fetches (Level 2)
   Called by Level2.js's level tick the moment state.readyShown flips:
   the two gating models are in, the loading screen is clearing, and the
   bandwidth that was racing them is free. Each fetch is a pure addition
   on top of a fully playable scene — the runner template joins the
   spawn pool, the pistol hot-swaps onto the procedural gun, and the
   corpse scatter reuses the walker's already-cached GLB.
--------------------------------------------------------------------- */
export function loadDeferredAssets() {
  if (!state.lightBoot) return;
  loadZombieTemplate('assets/model-rigged.glb', { runs: true });
  loadPistolModel();
  loadCorpses();
  pendingWreckModels.splice(0).forEach(showWreckModel);
}

export class Zombie {
  // opts.template: a specific loaded template (see zombieTemplateFor)
  constructor(pos, opts = {}) {
    this.mesh = new THREE.Group();
    const template = opts.template
      || (zombieTemplates.length ? zombieTemplates[Math.floor(Math.random() * zombieTemplates.length)] : null);
    this.rigged = !!template;
    this.hasAnim = false;
    if (this.rigged) {
      const rigInstance = skeletonClone(template.scene);
      rigInstance.position.y = template.footOffset;
      rigInstance.rotation.y = state.ZOMBIE_RIG_YAW_OFFSET;
      this.mesh.add(rigInstance);
      this.rigObj = rigInstance;
      this.footBoneL = findBoneLike(rigInstance, 'LeftFoot') || findBoneLike(rigInstance, 'L_Ankle') || findBoneLike(rigInstance, 'Left_Ankle') || null;
      this.footBoneR = findBoneLike(rigInstance, 'RightFoot') || findBoneLike(rigInstance, 'R_Ankle') || findBoneLike(rigInstance, 'Right_Ankle') || null;
      // model-rigged.glb (the one whose feet were sinking) names its foot
      // bones 'L_Ankle'/'R_Ankle' — a completely different convention from
      // zombie_running_on_metel_maniac.glb's Mixamo-style
      // 'mixamorig:LeftFoot_058'. The search above only tried the Mixamo
      // pattern, so for this specific model both bones came back null,
      // groundClampRig() silently no-ops every frame (it early-returns
      // when both bones are missing), and the zombie's Y position is
      // whatever was set once at spawn from a bind-pose bounding box —
      // never corrected once the run animation actually starts bending
      // the legs. That's the sinking.
      // Measured per-instance rather than assuming the shared ANKLE_TO_SOLE
      // constant fits this rig — model-rigged.glb's proportions differ from
      // the other zombie template, which is why its feet were sinking.
      this.ankleToSole = (template.ankleToSole !== undefined && isFinite(template.ankleToSole) && template.ankleToSole > 0)
        ? template.ankleToSole
        : measureAnkleToSole(rigInstance, this.footBoneL, this.footBoneR); // fallback, shouldn't be needed
      this.runs = !!(template && template.runs);
      // Temporary diagnostic — please open the browser console and paste
      // back what this prints for the zombie that's sinking. Static file
      // analysis (checked bind-pose bone positions, bounding boxes, and
      // animation channels by hand) didn't turn up an obvious cause, so
      // the next step is seeing the ACTUAL runtime numbers rather than
      // guessing at another margin value.
      console.log('[zombie spawn]', template.path,
        'footBoneL:', this.footBoneL ? this.footBoneL.name : 'NOT FOUND',
        'footBoneR:', this.footBoneR ? this.footBoneR.name : 'NOT FOUND',
        'footOffset:', template.footOffset.toFixed(3),
        'ankleToSole (used):', this.ankleToSole.toFixed(3),
        'rigInstance.position.y:', rigInstance.position.y.toFixed(3));
      if (template.animations.length) {
        this.hasAnim = true;
        this.mixer = new THREE.AnimationMixer(rigInstance);
        // Runner variant (model-rigged.glb, opts.runs=true): prefer a
        // clip whose name actually says "run"; play it at full speed
        // instead of the shambling 0.4x timeScale everything else uses.
        let clip = template.animations[0];
        if (template.runs) {
          const runClip = template.animations.find((c) => /run/i.test(c.name));
          if (runClip) clip = runClip;
        }
        this.action = this.mixer.clipAction(clip);
        this.action.play();
        // A level can speed runners up (state.runnerSpeedMul): the run
        // clip speeds up with them so their feet keep pace with the ground
        this.mixer.timeScale = template.runs ? 1.15 * (state.runnerSpeedMul || 1) : 0.4;
      }
    } else {
      const built = buildZombieMesh();
      this.mesh.add(built.group);
      this.limbs = built;
    }
    const hitbox = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 1.0, 4, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
    );
    hitbox.position.y = 1.0;
    hitbox.userData.owner = this;
    this.hitbox = hitbox;
    this.mesh.add(hitbox);
    this.mesh.position.copy(pos);
    this.mesh.userData.owner = this;
    this.mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.owner = this;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m) m.side = THREE.DoubleSide; });
    });
    scene.add(this.mesh);
    this.health = 50 + Math.floor(Math.random() * 20);
    this.maxHealth = this.health;
    this.state = 'idle';
    this.countedKill = false;
    // Runners (model-rigged.glb) move noticeably faster than the
    // standard shamblers — that's the whole point of a "runner" variant.
    this.speed = (template && template.runs)
      ? (4.4 + Math.random() * 1.8) * (state.runnerSpeedMul || 1)
      : 2.6 + Math.random() * 1.6;
    this.attackCooldown = 0;
    this.deathTimer = 0;
    this.idleDir = Math.random() * Math.PI * 2;
    this.idleTimer = 2 + Math.random() * 3;
    this.wobble = Math.random() * 10;
    this.groanTimer = 2 + Math.random() * 6;
    this.alive = true;
  }
  takeDamage(dmg, headshot) {
    if (!this.alive) return;
    this.health = 0;
    spawnHitSpark(this.mesh.position.clone().add(new THREE.Vector3(0, headshot ? 1.55 : 1.15, 0)));
    spawnBlood(this.mesh.position);
    sfx.hit();
    state.shake = Math.max(state.shake, headshot ? 0.18 : 0.1);
    this.confirmedKill(headshot);
  }
  goDown() {
    this.state = 'downed';
    this.downedTimer = 8 + Math.random() * 7;
    this.mesh.rotation.x = Math.PI / 2;
    this.mesh.position.y = 0.12;
    pushKillFeed('Infected down');
  }
  reanimate() {
    this.health = Math.round(this.maxHealth * 0.55);
    this.state = 'idle';
    this.mesh.rotation.x = 0;
    this.mesh.position.y = 0;
    this.idleTimer = 0;
    sfx.groan();
    pushKillFeed('An infected is back up — watch your six');
  }
  confirmedKill(headshot) {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dead';
    if (!this.countedKill) {
      this.countedKill = true;
      state.kills++;
      updateObjectiveHUD();
    }
    pushKillFeed(headshot ? 'Headshot — vaporized' : 'Vaporized');
    // Blown apart into sparkles instead of leaving a corpse behind — the
    // coin (spawned right after) is the only thing left on the ground.
    spawnDeathSparkles(this.mesh.position);
    spawnCoin(this.mesh.position);
    registerKillstreak(this.mesh.position);
    scene.remove(this.mesh);
    // Deferred to a macrotask so a kill that happens *during* the
    // state.zombies.forEach(z => z.update(...)) pass (e.g. running a
    // zombie over with the car) doesn't splice the array out from under
    // that same in-progress iteration.
    setTimeout(() => this.remove(), 0);
  }
  // neighbors: optional precomputed [{x,z,r}] snapshot of all alive zombies
  // for this frame, built once by updateZombies() instead of once per
  // zombie (see there for why). Falls back to the old per-call rebuild if
  // called directly without it, so nothing else that might call update()
  // breaks.
  update(dt, playerPos, neighbors) {
    if (!this.alive) return; // already exploded — waiting to be spliced out
    if (this.state === 'downed') {
      this.downedTimer -= dt;
      if (this.downedTimer <= 0) this.reanimate();
      return;
    }
    this.wobble += dt;
    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      this.groanTimer = 4 + Math.random() * 7;
      if (this.mesh.position.distanceTo(playerPos) < 18) sfx.groan();
    }
    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.mesh.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    // Shield up: attack range effectively becomes "wherever the shield's
    // surface is", not the normal 1.55 melee range — a zombie should
    // never even reach attack range while the shield is holding it off,
    // since it can't physically get close enough to swing.
    const attackRange = state.shieldActive ? Math.max(1.55, (state.shieldRadius || 0) + 0.4) : 1.55;
    if (dist < 26) {
      this.state = (dist < attackRange && !state.shieldActive && (!this.crowd || this.crowd.mayAttack)) ? 'attack' : 'chase';
    } else if (this.state !== 'idle') {
      this.state = 'idle';
    }
    // Was: rebuilt by filtering+mapping the *entire* zombies array here,
    // inside every single zombie's update() — O(n^2) work and allocations
    // per frame with n zombies alive. Self being present in the shared
    // snapshot is harmless: its position matches this zombie's own exactly,
    // so avoidObstacles computes a distance of ~0 and pushes nothing.
    const others = neighbors || state.zombies.filter((z) => z !== this && z.alive).map((z) => ({
      x: z.mesh.position.x, z: z.mesh.position.z, r: 0.7,
    }));
    if (this.state === 'chase') {
      const move = this.crowd?.eligible
        ? new THREE.Vector3(this.crowd.targetX-this.mesh.position.x,0,this.crowd.targetZ-this.mesh.position.z).normalize()
        : toPlayer.clone().normalize();
      if(this.crowd?.eligible&&!this.crowd.mayAttack&&dist<3.2){
        // Waiting attackers go around the inner combat space, not through it.
        const radial=toPlayer.clone().multiplyScalar(-1/Math.max(.001,dist));
        if(dist<.001)radial.set(Math.sin(this.crowd.id*2.4),0,Math.cos(this.crowd.id*2.4));
        const goalX=this.crowd.targetX-playerPos.x,goalZ=this.crowd.targetZ-playerPos.z;
        const turn=Math.sign(radial.z*goalX-radial.x*goalZ)||1;
        move.set(radial.x*Math.max(.35,3.3-dist)+radial.z*turn*.85,0,radial.z*Math.max(.35,3.3-dist)-radial.x*turn*.85).normalize();
      }
      avoidObstacles(this.mesh.position, move, others);
      const PLAYER_RADIUS = 0.32;
      const ZOMBIE_RADIUS = 0.65;
      // While the shield is up, nothing should be able to close to less
      // than the shield's own radius (plus a little for the zombie's own
      // body, so it stops at the surface rather than clipping into it) —
      // otherwise "no damage" was true, but zombies could still visually
      // walk straight through the bubble and stand on top of the player.
      const MIN_DISTANCE = state.shieldActive
        ? Math.max(PLAYER_RADIUS + ZOMBIE_RADIUS, (state.shieldRadius || 0) + ZOMBIE_RADIUS * 0.6)
        : PLAYER_RADIUS + ZOMBIE_RADIUS;
      let nextX = this.mesh.position.x + move.x * this.speed * dt;
      let nextZ = this.mesh.position.z + move.z * this.speed * dt;
      let nextDist = Math.hypot(playerPos.x - nextX, playerPos.z - nextZ);
      const blockedAt=(x,z)=>this.crowd&&others.some(other=>other.owner!==this&&Math.hypot(x-other.x,z-other.z)<(other.owner?.isBoss?3.0:1.22)&&Math.hypot(x-other.x,z-other.z)<Math.hypot(this.mesh.position.x-other.x,this.mesh.position.z-other.z)-.00001);
      let bodyBlocked=blockedAt(nextX,nextZ)||(this.crowd&&!crowdCanMove(this.mesh.position.x,this.mesh.position.z,nextX,nextZ));
      if(bodyBlocked){
        // Slide past a body instead of stopping an entire queue behind it.
        for(const side of [1,-1]){
          const x=this.mesh.position.x+move.z*side*this.speed*dt,z=this.mesh.position.z-move.x*side*this.speed*dt;
          const distance=Math.hypot(playerPos.x-x,playerPos.z-z);
          if(distance>MIN_DISTANCE&&!blockedAt(x,z)&&crowdCanMove(this.mesh.position.x,this.mesh.position.z,x,z)){nextX=x;nextZ=z;nextDist=distance;bodyBlocked=false;break;}
        }
      }
      if (nextDist > MIN_DISTANCE && !bodyBlocked) {
        this.mesh.position.x = nextX;
        this.mesh.position.z = nextZ;
      } else if (state.shieldActive && dist < MIN_DISTANCE) {
        // Already inside the shield boundary the instant it activated
        // (e.g. was mid-attack when the player picked it up) — the check
        // above only stops further approach, it wouldn't evict someone
        // already inside. Push back out to exactly the shield's surface
        // instead of leaving them frozen in place still visually "through" it.
        const pushBack = new THREE.Vector3().subVectors(this.mesh.position, playerPos).normalize();
        if (pushBack.lengthSq() < 0.0001) pushBack.set(1, 0, 0); // avoid a zero-vector edge case if exactly overlapping
        this.mesh.position.x = playerPos.x + pushBack.x * MIN_DISTANCE;
        this.mesh.position.z = playerPos.z + pushBack.z * MIN_DISTANCE;
      }
      this.mesh.position.x = clampZombieX(this.mesh.position.x, this.mesh.position.z);
      const targetAngle = this.crowd?.eligible ? Math.atan2(toPlayer.x,toPlayer.z) : Math.atan2(move.x, move.z);
      this.mesh.rotation.y = lerpAngle(this.mesh.rotation.y, targetAngle, dt * 5);
      this.playWalk(dt, 8, 0.55 + this.speed * 0.2);
    } else if (this.state === 'attack') {
      const targetAngle = Math.atan2(toPlayer.x, toPlayer.z);
      this.mesh.rotation.y = lerpAngle(this.mesh.rotation.y, targetAngle, dt * 8);
      this.attackCooldown -= dt;
      this.playWalk(dt, 3, 0.7);
      if (this.attackCooldown <= 0 && !state.inVehicle && (!this.crowd || this.crowd.mayAttack)) {
        this.attackCooldown = 0.95;
        if (!state.shieldActive) {
          damagePlayer((8 + Math.random() * 5) * state.zombieDamageMul);
          flashDamage();
          const push = toPlayer.clone().normalize().multiplyScalar(0.12);
          playerBody.position.x += push.x;
          playerBody.position.z += push.z;
        }
      }
    } else {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) { this.idleDir = Math.random() * Math.PI * 2; this.idleTimer = 2 + Math.random() * 3; }
      const move = new THREE.Vector3(Math.sin(this.idleDir), 0, Math.cos(this.idleDir));
      avoidObstacles(this.mesh.position, move, others);
      this.mesh.position.x += move.x * 0.4 * dt;
      this.mesh.position.z += move.z * 0.4 * dt;
      this.mesh.position.x = clampZombieX(this.mesh.position.x, this.mesh.position.z);
      this.mesh.rotation.y = lerpAngle(this.mesh.rotation.y, this.idleDir, dt * 2);
      this.playWalk(dt, 2, 0.35);
    }
    if (state.inVehicle) {
      const carPos = carVis.group.position;
      const d2 = carPos.distanceTo(this.mesh.position);
      if (d2 < 2.15) {
        const speed = chassisBody.velocity.length();
        if (speed > 3.8) {
          this.takeDamage(40 + speed * 12, false);
          const push = new THREE.Vector3().subVectors(this.mesh.position, carPos).normalize().multiplyScalar(0.8 + speed * 0.12);
          this.mesh.position.add(push);
          if (!this.alive) pushKillFeed('Run over');
        }
      }
    }
  }
  playWalk(dt, rate, timeScale) {
    if (this.rigged && this.hasAnim) {
      this.mixer.timeScale = THREE.MathUtils.lerp(this.mixer.timeScale, timeScale, dt * 3);
      this.mixer.update(dt);
    } else if (!this.rigged) {
      this.animateWalk(dt, rate);
    }
    // Runners (model-rigged.glb, this.runs) get a much snappier ground-clamp
    // correction rate (22 vs 10) — their animation plays at 1.15x speed with
    // a more exaggerated stride, and the default lerp-based correction rate
    // was tuned for the slower 0.4x shambling walk. If it can't keep up with
    // how fast the foot bones actually move, the correction visibly lags
    // behind the animation and reads as the feet clipping into the ground
    // even though the bones ARE being found and clamped correctly now.
    if (this.rigged) groundClampRig(this.rigObj, this.footBoneL, this.footBoneR, dt, this.runs ? 22 : 10, this.ankleToSole);
  }
  animateWalk(dt, rate) {
    this.wobble += dt * rate * 0.35;
    const swing = Math.sin(this.wobble * 4) * 0.5;
    this.limbs.legL.rotation.x = swing;
    this.limbs.legR.rotation.x = -swing;
    this.limbs.armL.rotation.x = -swing * 0.8 + 0.3;
    this.limbs.armR.rotation.x = swing * 0.8 + 0.3;
  }
  remove() {
    scene.remove(this.mesh);
    // A mixer caches an action per clip; let them go with the zombie.
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
      this.hasAnim = false;
    }
    const idx = state.zombies.indexOf(this);
    if (idx >= 0) state.zombies.splice(idx, 1);
  }
}

// Reused every frame instead of allocated fresh — its contents get
// overwritten each call, only its backing array capacity is kept.
const _zombieNeighborSnapshot = [];
const enemyCrowd=new EnemyCrowd(),crowdSolids=[],crowdSolidGrid=new CircleGrid(8,1);
let crowdBodyCount=-1;
function crowdCanMove(x,z,nx,nz){
  if(Math.abs(clampZombieX(nx,nz)-nx)>.001||nz < -201||nz>39)return false;
  // The crowd uses gameplay collision bounds, not repeated mesh triangle rays.
  // Cache static bodies once; new cover/body creation invalidates the cache.
  if(crowdBodyCount!==world.bodies.length){
    crowdBodyCount=world.bodies.length;crowdSolids.length=0;
    for(const body of world.bodies){
      if(body.mass!==0||body.collisionResponse===false||!body.shapes.some(shape=>shape.type===CANNON.Shape.types.BOX))continue;
      body.updateAABB();const a=body.aabb.lowerBound,b=body.aabb.upperBound;
      if(b.y<.35||a.y>1.8||!Number.isFinite(a.x+b.x+a.z+b.z))continue;
      crowdSolids.push({x:(a.x+b.x)/2,z:(a.z+b.z)/2,r:Math.hypot(b.x-a.x,b.z-a.z)/2+.35,minX:a.x-.35,maxX:b.x+.35,minZ:a.z-.35,maxZ:b.z+.35});
    }
    crowdSolidGrid.rebuild(crowdSolids);
  }
  const dx=nx-x,dz=nz-z;
  for(const box of crowdSolidGrid.query(crowdSolids,(x+nx)/2,(z+nz)/2)){
    if(x>box.minX&&x<box.maxX&&z>box.minZ&&z<box.maxZ){
      const oldDepth=Math.min(x-box.minX,box.maxX-x,z-box.minZ,box.maxZ-z),newDepth=Math.min(nx-box.minX,box.maxX-nx,nz-box.minZ,box.maxZ-nz);
      if(newDepth<oldDepth-.000001)continue;return false;
    }
    let enter=0,exit=1;
    if(Math.abs(dx)<.000001){if(x<box.minX||x>box.maxX)continue;}
    else {const a=(box.minX-x)/dx,b=(box.maxX-x)/dx;enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));}
    if(Math.abs(dz)<.000001){if(z<box.minZ||z>box.maxZ)continue;}
    else {const a=(box.minZ-z)/dz,b=(box.maxZ-z)/dz;enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));}
    if(enter<=exit)return false;
  }
  return true;
}

// Drives every zombie's update() for one frame. Replaces the previous
// `state.zombies.forEach(z => z.update(dt, playerPos))`, which left each
// zombie to rebuild its own neighbor list from the full array — O(n^2)
// per frame with n zombies alive (up to 14 in Level 2: ~196 filter/map
// passes and object allocations every frame, worst exactly when the
// player is being chased by a full pack). Building the snapshot once
// here and handing the same array to every zombie makes it O(n).
export function updateZombies(dt, playerPos) {
  const coordinated=state.levelId===3&&!state.isDead&&!state.paused&&!state.narrativeBlocked;
  if(coordinated)enemyCrowd.prepare(state.zombies,playerPos,dt,{shieldRadius:state.shieldActive?(state.shieldRadius||0):0,inVehicle:state.inVehicle});
  _zombieNeighborSnapshot.length = 0;
  for (let i = 0; i < state.zombies.length; i++) {
    const z = state.zombies[i];
    if (z.alive) {
      _zombieNeighborSnapshot.push({ x: z.mesh.position.x, z: z.mesh.position.z, r: 0.7, owner:z });
    }
  }
  for (let i = 0; i < state.zombies.length; i++) {
    state.zombies[i].update(dt, playerPos, _zombieNeighborSnapshot);
  }
  if(coordinated)enemyCrowd.separate(playerPos,dt,crowdCanMove,state.shieldActive?(state.shieldRadius||0):0);
}

export function spawnDepotGuards() {
  const spots = [
    [DEPOT_POS.x - 4, DEPOT_POS.z + 3], [DEPOT_POS.x + 5, DEPOT_POS.z - 2],
    [DEPOT_POS.x - 2, DEPOT_POS.z - 6], [DEPOT_POS.x + 3, DEPOT_POS.z + 6],
  ];
  spots.slice(0, Math.max(1, Math.round(spots.length * state.zombieCountMul))).forEach((p) => {
    const z = new Zombie(new THREE.Vector3(p[0], 0, p[1]));
    z.health = z.maxHealth = 95 + Math.floor(Math.random() * 25);
    z.speed *= 1.15;
    z.mesh.scale.setScalar(1.08);
    state.zombies.push(z);
    state.spawnedTotal++;
  });
}

// A loaded template by kind: the runner if wanted and in, else any
export function zombieTemplateFor(runner) {
  return zombieTemplates.find((t) => !!t.runs === runner) || zombieTemplates[0] || null;
}

// Zombies placed by hand that charge at `speed` m/s (an ambush): runner
// bodies when that template has loaded, their clip sped up to match the
// pace (the base rates are ~5.3 m/s at 1.15x for runners, ~3.4 at 0.4x
// for walkers) so feet don't skate. Past the usual caps on purpose.
export function spawnChargers(points, speed) {
  const template = zombieTemplateFor(true);
  for (const [x, z] of points) {
    const zom = new Zombie(new THREE.Vector3(x, 0, z), { template });
    zom.speed = speed[0] + Math.random() * (speed[1] - speed[0]);
    if (zom.mixer) zom.mixer.timeScale = zom.runs ? 1.15 * zom.speed / 5.3 : 0.4 * zom.speed / 3.4;
    state.zombies.push(zom);
    state.spawnedTotal++;
  }
}

export function spawnZombie() {
  if (state.zombies.length >= Math.round(ZOMBIE_MAX_ALIVE * state.zombieCountMul) || state.spawnedTotal >= KILL_TARGET + 10) return;
  const around = playerVis.group.position;
  const ang = Math.random() * Math.PI * 2;
  const dist = 16 + Math.random() * 24;
  let x = around.x + Math.sin(ang) * dist;
  let z = around.z - Math.abs(Math.cos(ang) * dist);
  x = THREE.MathUtils.clamp(x, -STREET_HALF_W + 0.8, STREET_HALF_W - 0.8);
  z = THREE.MathUtils.clamp(z, -STREET_LENGTH + 16, 28);
  if (Math.hypot(x - around.x, z - around.z) < 10) z -= 12;
  const zom = new Zombie(new THREE.Vector3(x, 0, z));
  state.zombies.push(zom);
  state.spawnedTotal++;
}

/* ---------------------------------------------------------------------
   RESTART — every infected gone, the player back on the spawn in their
   idle, the truck back at its spot. Called by Actions.js restartLevel()
   after resetRunState(), so yaw/health/etc. are already the defaults.
--------------------------------------------------------------------- */
export function resetCharacters() {
  for (const z of [...state.zombies]) z.remove();

  playerBody.position.set(1.5, playerHeight / 2 + 0.25, 30);
  playerBody.velocity.set(0, 0, 0);
  playerVis.group.position.set(playerBody.position.x, 0, playerBody.position.z);
  playerVis.group.visible = true;
  if (playerVis.actions) {
    playerVis.currentActionName = null; // force the switch even if idle was last
    setPlayerAction('idle');
  }
  if (playerVis.shootAction) playerVis.shootAction.stop();

  if (chassisBody) {
    chassisBody.position.set(carSpawn.x, 1.05, carSpawn.z);
    chassisBody.quaternion.set(0, 0, 0, 1);
    chassisBody.velocity.set(0, 0, 0);
    chassisBody.angularVelocity.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      vehicle.setSteeringValue(0, i);
      vehicle.applyEngineForce(0, i);
      vehicle.setBrake(0, i);
    }
    carVis.group.position.copy(chassisBody.position);
    carVis.group.quaternion.copy(chassisBody.quaternion);
  }

  // The street's opening pack, as at boot (loadZombieTemplate) — around
  // the spawn, so after the player is back on it
  if (zombieTemplateResolved) {
    for (let i = 0, n = Math.round(6 * state.zombieCountMul); i < n; i++) spawnZombie();
  }
}
