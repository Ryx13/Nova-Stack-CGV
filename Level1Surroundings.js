/* ======================================================================
   Level1Surroundings.js — BEHIND THE LEVEL 1 START

   Where the story began. Behind the spawn, across the end of the street,
   stands the research annex you walked out of: its sign, the blast door
   still open, the chemical tanks the quake split, and the gas still
   venting from its roof. Behind everything, the same land Level 2
   stands on (Level2Surroundings.js buildLandscape):
   foothills rising to the mountain ridge, fading into the haze.

   The annex sits where Level 2's look-back shows it (Level 1 z ~74), so
   the two views agree. Out of reach behind the world bound (z 40), so no
   physics. A handful of draw calls; the gas is a few drifting sprites.
   The streets and blocks either side are CityTown.js's.
====================================================================== */
import * as THREE from 'three';
import { scene } from './Scene.js';
import { state } from './state.js';
import { concreteTex, rustTex } from './characters.js';
import { buildLandscape } from './Level2Surroundings.js';

const ANNEX = { x: 0, z: 74, w: 64, h: 14, d: 18 };
const FRONT_Z = ANNEX.z - ANNEX.d / 2;

function seeded(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const tiled = (tex, rx, ry) => { const t = tex.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.needsUpdate = true; return t; };

function buildAnnex(night) {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ map: tiled(concreteTex, 8, 2), color: 0x8c8a84, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(ANNEX.w, ANNEX.h, ANNEX.d), wall);
  body.position.set(ANNEX.x, ANNEX.h / 2, ANNEX.z);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  // Upper wing and roof plant
  const wing = new THREE.Mesh(new THREE.BoxGeometry(26, 6, 12), wall);
  wing.position.set(-12, ANNEX.h + 3, ANNEX.z + 2);
  wing.castShadow = true;
  g.add(wing);
  for (const [x, z] of [[14, 70], [20, 78], [8, 80]]) {
    const unit = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 3), dark);
    unit.position.set(x, ANNEX.h + 1.2, z);
    g.add(unit);
  }
  // Window bands across the front: dark glass, a few still lit (emergency power)
  const glass = new THREE.MeshStandardMaterial({
    color: 0x10161a, roughness: 0.25, metalness: 0.3, emissive: 0x7fd8e8, emissiveIntensity: night ? 0.25 : 0.04,
  });
  for (const y of [4.2, 9.2]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(ANNEX.w - 6, 1.6, 0.2), glass);
    band.position.set(0, y, FRONT_Z - 0.05);
    g.add(band);
  }
  // The blast door you came out of, still open: dark inside, amber lights
  const door = new THREE.Mesh(new THREE.BoxGeometry(4.4, 4.4, 0.4), new THREE.MeshBasicMaterial({ color: 0x06080a }));
  door.position.set(0, 2.2, FRONT_Z - 0.1);
  g.add(door);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.25, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xe0a83c, emissiveIntensity: 2 }));
  strip.position.set(0, 4.65, FRONT_Z - 0.2);
  g.add(strip);
  // The sign
  const signTex = canvasTexture(512, 96, (c, w, h) => {
    c.fillStyle = '#0d1114'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e0a83c'; c.lineWidth = 4; c.strokeRect(4, 4, w - 8, h - 8);
    c.fillStyle = '#e0a83c'; c.font = 'bold 44px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('NOVA / RESEARCH ANNEX', w / 2, h / 2 + 2);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(20, 3.75),
    new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: night ? 1.1 : 0.35 }));
  sign.position.set(0, 12, FRONT_Z - 0.12);
  sign.rotation.y = Math.PI; // facing down the street, toward the spawn
  g.add(sign);
  scene.add(g);
}

// The chemical tanks the quake split, either side of the annex
function buildTanks() {
  const steel = new THREE.MeshStandardMaterial({ map: tiled(rustTex, 2, 1), color: 0x7c8086, roughness: 0.55, metalness: 0.5 });
  const tops = [];
  for (const [x, z, tilt] of [[-42, 66, 0], [-49, 76, 0.22], [42, 68, -0.12]]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 8, 20), steel);
    tank.position.set(x, 4, z);
    tank.rotation.z = tilt;
    tank.castShadow = tank.receiveShadow = true;
    scene.add(tank);
    tops.push(new THREE.Vector3(x - Math.sin(tilt) * 4, 8, z));
  }
  return tops;
}

// Gas venting from the split tanks and the annex roof: soft sprites that
// rise, swell and fade, recycled forever
function buildGas(vents) {
  const tex = canvasTexture(64, 64, (c, w) => {
    const r = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, '#ffffffaa'); r.addColorStop(0.5, '#ffffff44'); r.addColorStop(1, '#ffffff00');
    c.fillStyle = r; c.fillRect(0, 0, w, w);
  });
  const puffs = [];
  vents.forEach((v, vi) => {
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x9ab84a, transparent: true, depthWrite: false }));
      scene.add(s);
      puffs.push({ s, v, h: (i / 6 + vi * 0.13) % 1 });
    }
  });
  return (dt, t) => {
    for (const p of puffs) {
      p.h = (p.h + dt * 0.05) % 1;
      const k = p.h;
      p.s.position.set(p.v.x + Math.sin(t * 0.3 + k * 5) * 2 + k * 6, p.v.y + k * 26, p.v.z + k * 4);
      const size = 4 + k * 18;
      p.s.scale.set(size, size, 1);
      p.s.material.opacity = Math.min(1, k * 6) * (1 - k) * 0.55;
    }
  };
}

/** Builds everything behind the Level 1 start. Returns the per-frame update. */
export function buildLevel1Surroundings() {
  const night = state.timeOfDay === 'night';
  const landscape = buildLandscape();
  buildAnnex(night);
  const tanks = buildTanks();
  const gas = buildGas([...tanks, new THREE.Vector3(14, ANNEX.h + 2.4, 70)]);
  let t = 0;
  return (dt) => {
    t += dt;
    landscape(dt);
    gas(dt, t);
  };
}
