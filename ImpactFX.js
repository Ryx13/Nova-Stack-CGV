import * as THREE from 'three';
import { scene, sfx } from './Scene.js';
import { state } from './state.js';
import { glassPanes, hideDisplayPane, restoreDisplayPanes } from './CityKit.js';
import { RayCandidates } from './RayCandidates.js';
import { gfx } from './GraphicsProfile.js';

/* ---------------------------------------------------------------------
   IMPACT FX — what a bullet leaves behind: a wet spray of blood out of
   the infected it hits, a splat on the ground under them, and a crack
   (plus a few falling shards) in any window glass it passes through; the
   third crack in a pane shatters it. Other glass (wrecked cars, vending
   machine fronts, the glass bridge) registers its meshes in
   state.glassMeshes where it's built, and cracks wherever it's hit.
   Every effect is a fixed pool of instanced meshes: a burst of fire never
   creates meshes, materials or shader variants mid-fight, each pool is
   one draw call, and a full pool reuses its oldest instance.
--------------------------------------------------------------------- */

const GRAVITY = 9.8;
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _spin = new THREE.Quaternion();
const _s = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _p = new THREE.Vector3();
const FACING = new THREE.Vector3(0, 0, 1); // a PlaneGeometry's own normal
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return new THREE.CanvasTexture(c);
}

// An irregular splat: one main pool of overlapping blobs, a few drops flung out
const splatTex = canvasTexture(64, (ctx) => {
  ctx.fillStyle = 'rgba(92,6,6,0.92)';
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 7;
    ctx.beginPath(); ctx.arc(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 7 + Math.random() * 7, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2, r = 17 + Math.random() * 12;
    ctx.beginPath(); ctx.arc(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 1 + Math.random() * 2.2, 0, Math.PI * 2); ctx.fill();
  }
});

// A bullet hole in glass: jagged cracks running out, broken rings between them
const crackTex = canvasTexture(128, (ctx) => {
  const C = 64, rays = 8 + Math.floor(Math.random() * 4), angles = [];
  ctx.strokeStyle = 'rgba(232,242,248,0.9)';
  ctx.lineCap = ctx.lineJoin = 'round';
  for (let i = 0; i < rays; i++) {
    let a = (i / rays) * Math.PI * 2 + (Math.random() - 0.5) * 0.5, r = 3;
    angles.push(a);
    ctx.lineWidth = 1.2 + Math.random() * 0.8;
    ctx.beginPath(); ctx.moveTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
    while (r < 60) {
      r += 5 + Math.random() * 9;
      a += (Math.random() - 0.5) * 0.3;
      ctx.lineTo(C + Math.cos(a) * Math.min(r, 62), C + Math.sin(a) * Math.min(r, 62));
    }
    ctx.stroke();
  }
  ctx.lineWidth = 0.9;
  for (const R of [12, 25, 41]) {
    angles.forEach((a, i) => {
      if (Math.random() < 0.35) return;
      const b = angles[(i + 1) % rays] + (i + 1 === rays ? Math.PI * 2 : 0);
      const r1 = R * (0.85 + Math.random() * 0.3), r2 = R * (0.85 + Math.random() * 0.3), mid = (a + b) / 2;
      ctx.beginPath();
      ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
      ctx.lineTo(C + Math.cos(mid) * (r1 + r2) * 0.52, C + Math.sin(mid) * (r1 + r2) * 0.52);
      ctx.lineTo(C + Math.cos(b) * r2, C + Math.sin(b) * r2);
      ctx.stroke();
    });
  }
  const hole = ctx.createRadialGradient(C, C, 0, C, C, 7);
  hole.addColorStop(0, 'rgba(20,24,28,0.95)'); hole.addColorStop(0.45, 'rgba(240,248,252,0.85)'); hole.addColorStop(1, 'rgba(240,248,252,0)');
  ctx.fillStyle = hole; ctx.fillRect(C - 8, C - 8, 16, 16);
});

// A smashed pane: jagged glass left round the frame, the middle gone. With
// a dark fill for glass merged into its building (you see into the dark
// room, like the windows broken in the quake); edges only for a display
// window, whose glass itself is hidden, so the shop shows through
function shatterTexture(dark) {
  return canvasTexture(128, (ctx, S) => {
    if (dark) { ctx.fillStyle = 'rgba(12,14,16,0.97)'; ctx.fillRect(0, 0, S, S); }
    ctx.fillStyle = 'rgba(196,214,222,0.6)';
    ctx.strokeStyle = 'rgba(236,246,250,0.85)';
    ctx.lineWidth = 1;
    // Along each edge, shards still stuck in the frame, pointing inward
    for (let edge = 0; edge < 4; edge++) {
      ctx.save();
      ctx.translate(S / 2, S / 2); ctx.rotate(edge * Math.PI / 2); ctx.translate(-S / 2, -S / 2);
      let x = 0;
      while (x < S) {
        const w = 8 + Math.random() * 22, depth = 5 + Math.random() * (Math.random() < 0.25 ? 34 : 14);
        ctx.beginPath();
        ctx.moveTo(x, 0); ctx.lineTo(x + w * (0.3 + Math.random() * 0.4), depth); ctx.lineTo(x + w, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        x += w;
      }
      ctx.restore();
    }
  });
}
const shatterDarkTex = shatterTexture(true), shatterRimTex = shatterTexture(false);

/* Moving particles (blood drops, glass shards). Every instance is always
   drawn; a spent one is scaled to nothing. The pool only updates while
   something in it is still in flight. */
class ParticlePool {
  constructor(name, geometry, material, size) {
    this.mesh = new THREE.InstancedMesh(geometry, material, size);
    this.mesh.name = name;
    this.mesh.frustumCulled = false; // spread over the whole level; also compiles its shader on the first frame
    for (let i = 0; i < size; i++) this.mesh.setMatrixAt(i, HIDDEN);
    this.parts = Array.from({ length: size }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), floor: 0, life: 0, max: 1, size: 1, spin: 0 }));
    this.next = 0;
    this.awake = -1;
    this.idleFrames = 0; // drawn for the first frames so its shader compiles at load
  }
  emit(pos, vel, life, size, floor) {
    this.mesh.visible = true;
    const part = this.parts[this.next];
    this.next = (this.next + 1) % this.parts.length;
    part.p.copy(pos); part.v.copy(vel);
    part.life = part.max = life; part.size = size; part.floor = floor; part.spin = Math.random() * Math.PI * 2;
    this.awake = Math.max(this.awake, life + 0.1);
  }
  update(dt) {
    if (this.awake < 0) { if (++this.idleFrames > 2) this.mesh.visible = false; return; } // nothing in flight: no draw call
    this.awake -= dt;
    this.parts.forEach((part, i) => {
      if (part.life <= 0) { this.mesh.setMatrixAt(i, HIDDEN); return; }
      part.life -= dt;
      if (part.p.y > part.floor) {
        part.v.y -= GRAVITY * dt;
        part.p.addScaledVector(part.v, dt);
        part.spin += dt * 9;
      } else part.p.y = part.floor; // landed: lies there and fades
      const k = Math.max(0, part.life / part.max), sz = part.size * (0.35 + 0.65 * k);
      _q.setFromAxisAngle(_n.set(0.6, 0.8, 0), part.spin);
      this.mesh.setMatrixAt(i, part.life > 0 ? _m4.compose(part.p, _q, _s.set(sz, sz, sz)) : HIDDEN);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() {
    this.parts.forEach((part, i) => { part.life = 0; this.mesh.setMatrixAt(i, HIDDEN); });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.awake = -1;
  }
}

// Flat marks that stay put (blood splats, cracks); the oldest is reused
class DecalPool {
  constructor(name, geometry, material, size) {
    this.mesh = new THREE.InstancedMesh(geometry, material, size);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.size = size;
    this.next = 0;
  }
  // Returns the instance used, so its owner can hide it again later
  place(matrix) {
    const at = this.next;
    this.mesh.setMatrixAt(at, matrix);
    this.next = (this.next + 1) % this.size;
    this.mesh.count = Math.min(this.size, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    return at;
  }
  hide(at) {
    this.mesh.setMatrixAt(at, HIDDEN);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.mesh.count = 0; this.next = 0; }
}

// Blood is lit and glossy (low roughness), so it reads wet under the lamps
const bloodDrops = new ParticlePool('blood-drops', new THREE.IcosahedronGeometry(1, 0),
  new THREE.MeshStandardMaterial({ color: 0x5a0505, roughness: 0.22, metalness: 0.1 }), 72);
const bloodSplats = new DecalPool('blood-splats', new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: splatTex, transparent: true, depthWrite: false, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 48);
const glassShards = new ParticlePool('glass-shards', new THREE.TetrahedronGeometry(1, 0),
  new THREE.MeshStandardMaterial({ color: 0xc4dce6, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.75 }), 64);
const glassCracks = new DecalPool('glass-cracks', new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: crackTex, color: 0xcfd9de, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 40);
const shatterMat = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
const smashedPanes = new DecalPool('smashed-panes', new THREE.PlaneGeometry(1, 1), shatterMat(shatterDarkTex), 32);
const smashedRims = new DecalPool('smashed-display-rims', new THREE.PlaneGeometry(1, 1), shatterMat(shatterRimTex), 16);
// Explosions (spawnBlastFX): drum debris, embers, a scorch on the road
const blastDebris = new ParticlePool('blast-debris', new THREE.BoxGeometry(1, 0.35, 1.4),
  new THREE.MeshStandardMaterial({ color: 0x4a2c22, roughness: 0.55, metalness: 0.6 }), 32);
const blastEmbers = new ParticlePool('blast-embers', new THREE.IcosahedronGeometry(1, 0),
  new THREE.MeshBasicMaterial({ color: 0xffa64a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 48);
const scorchTex = canvasTexture(128, (ctx, S) => {
  const g = ctx.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(8,6,5,0.95)'); g.addColorStop(0.55, 'rgba(14,11,9,0.75)'); g.addColorStop(1, 'rgba(20,16,12,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  // Ragged soot streaks thrown out from the centre
  ctx.strokeStyle = 'rgba(10,8,6,0.55)'; ctx.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2, r0 = 14 + Math.random() * 10, r1 = 34 + Math.random() * 28;
    ctx.lineWidth = 2 + Math.random() * 5;
    ctx.beginPath(); ctx.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0); ctx.lineTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1); ctx.stroke();
  }
});
const scorches = new DecalPool('blast-scorches', new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: scorchTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 8);
// Concrete coming down with a structure (collapseFX, crumble)
const rubble = new ParticlePool('collapse-rubble', new THREE.DodecahedronGeometry(1, 0),
  new THREE.MeshStandardMaterial({ color: 0x8a8680, roughness: 0.95 }), 64);
const pools = [bloodDrops, bloodSplats, glassShards, glassCracks, smashedPanes, smashedRims, blastDebris, blastEmbers, scorches, rubble];

// Brown air: big soft dark-brown patches a running pack leaves hanging
// behind it (trailHaze), swelling and thinning over a couple of seconds.
// A dozen sprites at most, no particles.
// Billowing, not a flat disc: overlapping soft blobs, darker toward the
// middle; each patch tinted and turned its own way (trailHaze)
const hazeTex = canvasTexture(128, (ctx, S) => {
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * S * 0.22;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d, r = S * (0.16 + Math.random() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.32 + Math.random() * 0.25})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  }
});
const HAZE_TONES = [0x5c4630, 0x6b543a, 0x4e3b28, 0x76603f]; // earth to dust
const HAZE_S = 2.6, HAZE_OPACITY = 0.42;
const haze = Array.from({ length: gfx.low ? 8 : 14 }, () => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: hazeTex, color: 0x5c4630, transparent: true, opacity: 0, depthWrite: false }));
  sp.name = 'brown-haze'; sp.visible = false; sp.userData.t = -1;
  return sp;
});
let hazeNext = 0;
// The dust wave a collapse pushes out along the street (collapseFX): the
// same soft clouds, paler (concrete dust), racing outward and swelling
const WAVE_S = 3.2, WAVE_OPACITY = 0.5;
const WAVE_TONES = [0x8a7a64, 0x7a6c58, 0x96887a];
const wave = Array.from({ length: gfx.low ? 10 : 16 }, () => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: hazeTex, color: 0x8a7a64, transparent: true, opacity: 0, depthWrite: false }));
  sp.name = 'collapse-dust'; sp.visible = false; sp.userData.t = -1;
  return sp;
});

// Animated one-offs, each its own mesh from a small reused set: the
// shockwave ring along the ground and the smoke column after the blast
const smokeTex = canvasTexture(64, (ctx, S) => {
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(46,42,40,0.9)'); g.addColorStop(0.6, 'rgba(40,37,35,0.45)'); g.addColorStop(1, 'rgba(36,33,31,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
});
const rings = Array.from({ length: 3 }, () => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.name = 'blast-shockwave'; m.visible = false; m.userData.t = -1;
  return m;
});
const SMOKE_PUFFS = gfx.low ? 4 : 8; // big soft sprites are overdraw: fewer on a weak GPU
const smoke = Array.from({ length: SMOKE_PUFFS * 2 }, () => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false }));
  sp.name = 'blast-smoke'; sp.visible = false; sp.userData.t = -1;
  return sp;
});
const RING_S = 0.35, SMOKE_S = 3.6;
const crackOwner = []; // which pane each crack instance belongs to now (the pool recycles them)

/** A splat on the ground at pos (an infected's feet). */
export function placeBloodSplat(pos) {
  const r = 0.3 + Math.random() * 0.28;
  _q.setFromAxisAngle(_n.set(0, 1, 0), Math.random() * Math.PI * 2);
  bloodSplats.place(_m4.compose(_p.set(pos.x, pos.y + 0.04, pos.z), _q, _s.set(r, 1, r)));
}

/** A bullet's exit spray at point along dir; floorY is where the drops land. */
export function spawnBloodSpray(point, dir, heavy = false, floorY = 0) {
  const n = heavy ? 18 : 11;
  for (let i = 0; i < n; i++) {
    const back = i < 3; // a little spatters back toward the shooter
    const speed = back ? 0.6 + Math.random() * 0.8 : 1.6 + Math.random() * 2.8;
    _v.set(dir.x, 0, dir.z).normalize().multiplyScalar(back ? -speed : speed);
    _v.x += (Math.random() - 0.5) * 1.6;
    _v.z += (Math.random() - 0.5) * 1.6;
    _v.y = 0.6 + Math.random() * 2.2;
    bloodDrops.emit(point, _v, 0.7 + Math.random() * 0.5, 0.025 + Math.random() * 0.04, floorY + 0.02);
  }
}

const SHATTER_HITS = 3, SHATTER_MAX_M = 4.5; // longer strips (office ribbons, factory bands) only crack

// A pane's facing: its thinnest side is its normal; the other two are its face
function paneAxes(p) {
  const ax = p.sx <= p.sy && p.sx <= p.sz ? 'x' : (p.sz <= p.sy ? 'z' : 'y');
  const [ua, va] = ax === 'x' ? ['z', 'y'] : ax === 'z' ? ['x', 'y'] : ['x', 'z'];
  return { ax, ua, va, ext: { x: p.sx, y: p.sy, z: p.sz } };
}

/** Run over: blood thrown forward with the car and up off the bumper,
    splats smeared along the road where it went under, and a thud. */
const _runDir = new THREE.Vector3(), _runFrom = new THREE.Vector3(), _runVel = new THREE.Vector3(), _runAt = new THREE.Vector3();
export function spawnRunOverSplash(pos, carVelocity) {
  // Its own vectors: placeBloodSplat below uses the shared scratch ones
  const speed = Math.hypot(carVelocity.x, carVelocity.z);
  if (speed > 0.01) _runDir.set(carVelocity.x / speed, 0, carVelocity.z / speed); else _runDir.set(0, 0, 1);
  _runFrom.copy(pos).setY(pos.y + 0.9);
  for (let i = 0; i < 30; i++) {
    _runVel.copy(_runDir).multiplyScalar(1.5 + Math.random() * (2 + speed * 0.35));
    _runVel.x += (Math.random() - 0.5) * 3.2;
    _runVel.z += (Math.random() - 0.5) * 3.2;
    _runVel.y = 1 + Math.random() * 3.2;
    bloodDrops.emit(_runFrom, _runVel, 0.8 + Math.random() * 0.6, 0.03 + Math.random() * 0.05, pos.y + 0.02);
  }
  // A trail of splats under and ahead of where it was hit
  for (let i = 0; i < 4; i++) {
    const along = i * (0.7 + speed * 0.05) + Math.random() * 0.4;
    placeBloodSplat(_runAt.set(pos.x + _runDir.x * along + (Math.random() - 0.5) * 0.8, pos.y, pos.z + _runDir.z * along + (Math.random() - 0.5) * 0.8));
  }
  sfx.noise(0.28, 0.22, 140); // the thud
  sfx.noise(0.16, 0.08, 900); // and the wet slap
}

/** A barrel going off at pos: a shockwave ring, drum debris, embers, a
    scorch, a smoke column, and the glass round it shattered (close) or
    cracked (further out). The fireball itself is PowerUps.js's. */
const _blastAt = new THREE.Vector3(), _blastVel = new THREE.Vector3(), _blastDir = new THREE.Vector3(), _blastBox = new THREE.Box3();
let glassQuiet = false; // one smash for a blast, not one per pane
export function spawnBlastFX(pos, radius) {
  const ground = pos.y;
  const ring = rings.find((r) => r.userData.t < 0) || rings[0];
  ring.position.set(pos.x, ground + 0.06, pos.z);
  ring.userData.t = 0; ring.userData.radius = radius; ring.visible = true;
  if (!ring.parent) scene.add(ring);
  _blastAt.copy(pos).setY(ground + 0.5);
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2, out = 4 + Math.random() * 7;
    _blastVel.set(Math.cos(a) * out, 3 + Math.random() * 7, Math.sin(a) * out);
    blastDebris.emit(_blastAt, _blastVel, 1.4 + Math.random() * 1.2, 0.05 + Math.random() * 0.09, ground + 0.03);
  }
  for (let i = 0; i < 36; i++) {
    const a = Math.random() * Math.PI * 2, out = 1 + Math.random() * 5;
    _blastVel.set(Math.cos(a) * out, 2 + Math.random() * 6, Math.sin(a) * out);
    blastEmbers.emit(_blastAt, _blastVel, 0.5 + Math.random() * 0.9, 0.025 + Math.random() * 0.03, ground + 0.02);
  }
  _q.setFromAxisAngle(_n.set(0, 1, 0), Math.random() * Math.PI * 2);
  const sr = 1.6 + Math.random() * 0.5;
  scorches.place(_m4.compose(_blastAt.set(pos.x, ground + 0.035, pos.z), _q, _s.set(sr, 1, sr)));
  let puffs = 0;
  for (const sp of smoke) {
    if (sp.userData.live || puffs >= SMOKE_PUFFS) continue;
    sp.userData.t = -puffs * 0.18; // staggered: the column builds
    sp.userData.x = pos.x + (Math.random() - 0.5) * 1.2; sp.userData.z = pos.z + (Math.random() - 0.5) * 1.2;
    sp.userData.y = ground + 0.8; sp.userData.drift = (Math.random() - 0.5) * 0.5;
    sp.userData.live = true;
    if (!sp.parent) scene.add(sp);
    puffs++;
  }
  blastGlass(pos, radius);
}

// Glass in reach: the nearest windows shatter, the rest crack once each
function blastGlass(pos, radius) {
  let shattered = 0, cracked = 0;
  glassQuiet = true;
  for (const p of glassPanes) {
    if (p.shattered) continue;
    _box.min.set(p.x - p.sx / 2, p.y - p.sy / 2, p.z - p.sz / 2);
    _box.max.set(p.x + p.sx / 2, p.y + p.sy / 2, p.z + p.sz / 2);
    _box.clampPoint(pos, _hit);
    const d = _hit.distanceTo(pos);
    if (d > radius) continue;
    _blastDir.subVectors(_hit, pos).normalize();
    const { ua, va, ext } = paneAxes(p);
    if (d < radius * 0.55 && shattered < 6 && !p.painted && Math.max(ext[ua], ext[va]) <= SHATTER_MAX_M) { shatterPane(p, _hit.clone(), _blastDir.clone()); shattered++; }
    else if (cracked < 10) { crackPane(p, _hit.clone(), _blastDir.clone()); cracked++; }
  }
  for (const m of liveGlassMeshes()) {
    if (cracked >= 14) break;
    _blastBox.setFromObject(m).clampPoint(pos, _hit);
    if (_hit.distanceTo(pos) > radius) continue;
    _blastDir.subVectors(_hit, pos).normalize();
    crackSurface(_hit.clone(), _blastDir.clone().negate(), _blastDir.clone());
    cracked++;
  }
  glassQuiet = false;
  if (shattered) { sfx.noise(0.5, 0.1, 2600); sfx.noise(0.3, 0.06, 4600); }
  else if (cracked) sfx.noise(0.2, 0.05, 3400);
}

/** Leaves a patch of brown haze hanging at pos (behind a runner). */
export function trailHaze(pos) {
  const sp = haze[hazeNext];
  hazeNext = (hazeNext + 1) % haze.length;
  sp.position.set(pos.x + (Math.random() - 0.5) * 0.6, 0.9, pos.z + (Math.random() - 0.5) * 0.6);
  sp.userData.t = 0;
  sp.userData.size = 2.4 + Math.random() * 1.2;
  sp.userData.turn = (Math.random() - 0.5) * 0.5; // rad/s: the cloud churns
  sp.material.rotation = Math.random() * Math.PI * 2;
  sp.material.color.setHex(HAZE_TONES[Math.floor(Math.random() * HAZE_TONES.length)]);
  sp.visible = true;
  if (!sp.parent) scene.add(sp);
}
function updateHaze(dt) {
  for (const sp of haze) {
    if (sp.userData.t < 0) continue;
    const t = (sp.userData.t += dt) / HAZE_S;
    if (t >= 1) { sp.userData.t = -1; sp.visible = false; continue; }
    sp.position.y += dt * 0.18;
    sp.material.rotation += sp.userData.turn * dt;
    sp.scale.setScalar(sp.userData.size * (1 + t * 1.3));
    sp.material.opacity = HAZE_OPACITY * Math.min(1, t * 6) * (1 - t);
  }
}

// Your scent reaching someone (scentTrail): pale wisps drifting from you
// to them low over the ground, one after another
const SCENT_S = 1.4;
const scent = Array.from({ length: 10 }, () => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: hazeTex, color: 0xd2dca0, transparent: true, opacity: 0, depthWrite: false }));
  sp.name = 'scent'; sp.visible = false; sp.userData.t = -1;
  sp.userData.from = new THREE.Vector3(); sp.userData.to = new THREE.Vector3();
  return sp;
});
/** A trail of scent from `from` to `to` (Level 2: the girl smelling you). */
export function scentTrail(from, to) {
  scent.forEach((sp, i) => {
    sp.userData.from.copy(from).setY(0.9 + Math.random() * 0.5);
    sp.userData.to.copy(to).setY(1.1 + Math.random() * 0.4);
    sp.userData.t = -i * 0.09; // one after another
    sp.userData.wobble = Math.random() * 6;
    sp.material.rotation = Math.random() * Math.PI * 2;
    sp.visible = true;
    if (!sp.parent) scene.add(sp);
  });
}
function updateScent(dt) {
  for (const sp of scent) {
    if (!sp.visible) continue;
    sp.userData.t += dt;
    const t = sp.userData.t / SCENT_S;
    if (t < 0) { sp.material.opacity = 0; continue; }
    if (t >= 1) { sp.visible = false; continue; }
    sp.position.lerpVectors(sp.userData.from, sp.userData.to, t);
    sp.position.y += Math.sin(t * 9 + sp.userData.wobble) * 0.12;
    sp.material.rotation += dt * 0.6;
    sp.scale.setScalar(0.7 + t * 1.1);
    sp.material.opacity = 0.42 * Math.min(1, t * 5) * (1 - t * t);
  }
}

/** A structure across the street coming down at z (half its width, its
    height): rubble falling from it and a dust wave rolling out both ways
    along the street. */
export function collapseFX(z, halfWidth, height) {
  for (let i = 0; i < 20; i++) {
    _blastAt.set((Math.random() * 2 - 1) * halfWidth, height - Math.random() * 0.6, z + (Math.random() - 0.5) * 3);
    _blastVel.set((Math.random() - 0.5) * 2.4, -Math.random() * 1.5, (Math.random() - 0.5) * 2.4);
    rubble.emit(_blastAt, _blastVel, 3 + Math.random() * 2, 0.12 + Math.random() * 0.22, 0.1);
  }
  wave.forEach((sp, i) => {
    const way = i % 2 ? 1 : -1, across = ((i >> 1) / Math.max(1, (wave.length >> 1) - 1)) * 2 - 1;
    sp.position.set(across * halfWidth * 0.8, 1.2 + Math.random() * 0.8, z + way * (1 + Math.random()));
    sp.userData.t = -Math.random() * 0.25; // a ragged front, not a wall
    sp.userData.vz = way * (7 + Math.random() * 4); // m/s, slowing as it goes
    sp.userData.vx = across * (1 + Math.random() * 1.5);
    sp.userData.size = 3 + Math.random() * 1.5;
    sp.userData.turn = (Math.random() - 0.5) * 0.4;
    sp.material.rotation = Math.random() * Math.PI * 2;
    sp.material.color.setHex(WAVE_TONES[i % WAVE_TONES.length]);
    sp.material.opacity = 0;
    sp.visible = true;
    if (!sp.parent) scene.add(sp);
  });
  sfx.noise(1.4, 0.18, 90); // the crunch of it coming down
}
function updateWave(dt) {
  for (const sp of wave) {
    if (sp.userData.t === -1 && !sp.visible) continue;
    sp.userData.t += dt;
    const t = sp.userData.t / WAVE_S;
    if (t < 0) continue; // its moment in the front hasn't come yet
    if (t >= 1) { sp.userData.t = -1; sp.visible = false; continue; }
    const slow = Math.exp(-1.6 * sp.userData.t);
    sp.position.z += sp.userData.vz * slow * dt;
    sp.position.x += sp.userData.vx * slow * dt;
    sp.position.y += dt * 0.25;
    sp.material.rotation += sp.userData.turn * dt;
    sp.scale.setScalar(sp.userData.size * (1 + t * 2.2));
    sp.material.opacity = WAVE_OPACITY * Math.min(1, t * 8) * (1 - t) ** 1.4;
  }
}

/** Bits of concrete breaking off at x, y, z (spread m either way along x,
    and across the width w): n small chunks dropping to the street. */
export function crumble(x, y, z, spread, w, n) {
  for (let i = 0; i < n; i++) {
    _blastAt.set(x + (Math.random() * 2 - 1) * spread, y, z + (Math.random() - 0.5) * w);
    _blastVel.set((Math.random() - 0.5) * 0.8, -Math.random() * 0.6, (Math.random() - 0.5) * 0.8);
    rubble.emit(_blastAt, _blastVel, 2.4 + Math.random(), 0.05 + Math.random() * 0.1, 0.06);
  }
}

/** A quake: the glass round pos shattered (close) or cracked (further out). */
export function shakeGlass(pos, radius) { blastGlass(pos, radius); }

/** Glass giving way overhead: count pieces falling from along a span
    (x0..x1 at height y, about z), tumbling and breaking on the street. */
export function rainGlass(x0, x1, z, y, count = 48) {
  for (let i = 0; i < count; i++) {
    _blastAt.set(x0 + Math.random() * (x1 - x0), y + Math.random() * 1.6, z + (Math.random() - 0.5) * 3.4);
    _blastVel.set((Math.random() - 0.5) * 1.6, -0.5 - Math.random() * 2, (Math.random() - 0.5) * 1.6);
    glassShards.emit(_blastAt, _blastVel, 1.4 + Math.random() * 0.8, 0.06 + Math.random() * 0.16, 0.02);
  }
  sfx.noise(0.9, 0.16, 2200); // the crash as it comes down
  sfx.noise(0.5, 0.09, 4800);
}

/** An infected caught in a blast: blood thrown away from it. */
export function blastBlood(at, from) {
  _blastDir.subVectors(at, from).setY(0);
  if (_blastDir.lengthSq() < 1e-6) _blastDir.set(1, 0, 0);
  _blastDir.normalize();
  spawnBloodSpray(_blastAt.copy(at).setY(at.y + 1.1), _blastDir, true, at.y);
  placeBloodSplat(at);
}

function updateBlasts(dt) {
  for (const r of rings) {
    if (r.userData.t < 0) continue;
    const t = (r.userData.t += dt) / RING_S;
    if (t >= 1) { r.userData.t = -1; r.visible = false; continue; }
    r.scale.setScalar(0.4 + (r.userData.radius * 1.1 - 0.4) * (1 - (1 - t) ** 3));
    r.material.opacity = 0.9 * (1 - t);
  }
  for (const sp of smoke) {
    if (!sp.userData.live) continue;
    sp.userData.t += dt;
    const t = sp.userData.t / SMOKE_S;
    if (t < 0) continue; // waiting its turn in the column
    if (t >= 1) { sp.userData.live = false; sp.userData.t = -1; sp.visible = false; continue; }
    sp.visible = true;
    const k = sp.userData.t;
    sp.position.set(sp.userData.x + sp.userData.drift * k, sp.userData.y + k * 1.4, sp.userData.z);
    sp.scale.setScalar(1.4 + k * 1.1);
    sp.material.opacity = 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.3);
  }
}

// A crack on pane p where the bullet entered, facing the shooter, plus
// shards; the third one shatters the pane instead
function crackPane(p, point, dir) {
  p.hits = (p.hits || 0) + 1;
  const { ax, ua, va, ext } = paneAxes(p);
  if (p.hits >= SHATTER_HITS && !p.painted && Math.max(ext[ua], ext[va]) <= SHATTER_MAX_M) { shatterPane(p, point, dir); return; } // a painted pane (Level 2's riddle) only cracks
  const size = Math.min(0.9, ext[ua], ext[va]) * (0.75 + Math.random() * 0.25);
  _n.set(0, 0, 0)[ax] = dir[ax] > 0 ? -1 : 1;
  _p.copy(point).addScaledVector(_n, 0.006);
  // Keep the whole crack on the glass
  for (const a of [ua, va]) {
    const room = Math.max(0, ext[a] / 2 - size / 2);
    _p[a] = THREE.MathUtils.clamp(_p[a], p[a] - room, p[a] + room);
  }
  _q.setFromUnitVectors(FACING, _n);
  _q.premultiply(_spin.setFromAxisAngle(_n, Math.random() * Math.PI * 2));
  const at = glassCracks.place(_m4.compose(_p, _q, _s.set(size, size, 1)));
  crackOwner[at] = p;
  (p.cracks ||= []).push(at);
  crackBurst(point, dir);
}

// The shards a crack knocks out, carried on by the bullet, and the tinkle
function crackBurst(point, dir) {
  for (let i = 0; i < 7; i++) {
    _v.copy(dir).multiplyScalar(0.8 + Math.random() * 1.8);
    _v.x += (Math.random() - 0.5) * 1.2;
    _v.z += (Math.random() - 0.5) * 1.2;
    _v.y += Math.random() * 1.1;
    glassShards.emit(point, _v, 0.9 + Math.random() * 0.4, 0.02 + Math.random() * 0.03, 0.02);
  }
  if (!glassQuiet) sfx.noise(0.12, 0.05, 3400);
}

// A crack on any other glass: flat on the surface where it was hit,
// facing the shooter. Curved glass is close enough to flat at this size.
function crackSurface(point, normal, dir) {
  _n.copy(normal);
  if (_n.dot(dir) > 0) _n.negate();
  _p.copy(point).addScaledVector(_n, 0.006);
  _q.setFromUnitVectors(FACING, _n);
  _q.premultiply(_spin.setFromAxisAngle(_n, Math.random() * Math.PI * 2));
  const size = 0.38 + Math.random() * 0.2;
  crackOwner[glassCracks.place(_m4.compose(_p, _q, _s.set(size, size, 1)))] = null;
  crackBurst(point, dir);
}

// The whole pane goes: its cracks with it, a burst of shards falling out
// of the frame, a smash, and what's left is the jagged rim
function shatterPane(p, point, dir) {
  p.shattered = true;
  for (const at of p.cracks || []) if (crackOwner[at] === p) { glassCracks.hide(at); crackOwner[at] = null; }
  p.cracks = null;
  const { ax, ua, va, ext } = paneAxes(p);
  _n.set(0, 0, 0)[ax] = dir[ax] > 0 ? -1 : 1;
  _p.set(p.x, p.y, p.z).addScaledVector(_n, ext[ax] / 2 + 0.004);
  _q.setFromUnitVectors(FACING, _n);
  _m4.compose(_p, _q, _s.set(ext[ua], ext[va], 1));
  if (p.kind === 'display') { hideDisplayPane(p.index); smashedRims.place(_m4); }
  else smashedPanes.place(_m4);
  const area = ext[ua] * ext[va];
  for (let i = 0, n = Math.min(26, 10 + Math.round(area * 4)); i < n; i++) {
    // From anywhere on the pane, mostly carried on through by the bullet
    _p.set(p.x, p.y, p.z);
    _p[ua] += (Math.random() - 0.5) * ext[ua] * 0.9;
    _p[va] += (Math.random() - 0.5) * ext[va] * 0.9;
    _v.copy(dir).multiplyScalar(0.6 + Math.random() * 2.2);
    _v.x += (Math.random() - 0.5) * 1.4;
    _v.z += (Math.random() - 0.5) * 1.4;
    _v.y += Math.random() * 0.8;
    glassShards.emit(_p, _v, 1 + Math.random() * 0.5, 0.025 + Math.random() * 0.045, 0.02);
  }
  if (glassQuiet) return;
  sfx.noise(0.4, 0.12, 2600);
  sfx.noise(0.22, 0.07, 4600);
}

const _box = new THREE.Box3(), _hit = new THREE.Vector3();
const wallRay = new THREE.Raycaster();
const wallCandidates = new RayCandidates();
const paneHits = [];
const glassRay = new THREE.Raycaster(), liveGlass = [];
// Registered glass still in the scene and shown (a level swapped out, a
// wreck stripped for Level 2's burnt look, are skipped)
function liveGlassMeshes() {
  liveGlass.length = 0;
  for (const m of state.glassMeshes || []) {
    let o = m, shown = true;
    while (o.parent) { if (!o.visible) shown = false; o = o.parent; }
    if (shown && m.visible && o === scene) liveGlass.push(m);
  }
  return liveGlass;
}
/** Cracks the glass a shot's ray passes through before maxDist, up to two
    pieces (a display window's front and back, a car's windscreen and rear
    window). The first wall stops the bullet: window glass sits just proud
    of its building's blocker box. */
export function crackGlassAlong(ray, maxDist) {
  paneHits.length = 0;
  for (const p of glassPanes) {
    _box.min.set(p.x - p.sx / 2, p.y - p.sy / 2, p.z - p.sz / 2);
    _box.max.set(p.x + p.sx / 2, p.y + p.sy / 2, p.z + p.sz / 2);
    if (p.shattered || !ray.intersectBox(_box, _hit)) continue; // a smashed pane lets bullets through
    const d = ray.origin.distanceTo(_hit);
    if (d <= maxDist) paneHits.push({ p, d, point: _hit.clone() });
  }
  // Glass meshes: the surface itself, so curved and car glass crack where hit
  const meshes = liveGlassMeshes();
  if (meshes.length) {
    glassRay.ray.copy(ray);
    glassRay.far = maxDist;
    let last = null;
    for (const h of glassRay.intersectObjects(meshes, false)) {
      // A pane's back face a few cm behind its front is the same hole
      if (last && last.object === h.object && h.distance - last.distance < 0.15) continue;
      last = h;
      const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : ray.direction.clone().negate();
      paneHits.push({ d: h.distance, point: h.point.clone(), normal });
    }
  }
  if (!paneHits.length) return;
  wallRay.ray.copy(ray);
  wallRay.far = maxDist;
  const wall = wallRay.intersectObjects(wallCandidates.query(state.occluders, wallRay.ray, maxDist), false)[0];
  const limit = wall ? wall.distance + 0.12 : maxDist;
  paneHits.sort((a, b) => a.d - b.d);
  for (const h of paneHits.slice(0, 2)) {
    if (h.d > limit) break;
    if (h.p) crackPane(h.p, h.point, ray.direction);
    else crackSurface(h.point, h.normal, ray.direction);
  }
}

/** Every frame from the main loop. */
export function updateImpactFX(dt) {
  for (const pool of pools) if (!pool.mesh.parent) scene.add(pool.mesh);
  bloodDrops.update(dt);
  glassShards.update(dt);
  blastDebris.update(dt);
  blastEmbers.update(dt);
  rubble.update(dt);
  updateHaze(dt);
  updateWave(dt);
  updateScent(dt);
  updateBlasts(dt);
}

/** Restart: wipe every splat, crack and particle in flight, and glaze every pane again. */
export function clearImpactFX() {
  for (const pool of pools) pool.clear();
  for (const r of rings) { r.userData.t = -1; r.visible = false; }
  for (const sp of smoke) { sp.userData.live = false; sp.userData.t = -1; sp.visible = false; }
  for (const sp of haze) { sp.userData.t = -1; sp.visible = false; }
  for (const sp of wave) { sp.userData.t = -1; sp.visible = false; }
  for (const sp of scent) sp.visible = false;
  crackOwner.length = 0;
  for (const p of glassPanes) { p.hits = 0; p.shattered = false; p.cracks = null; }
  restoreDisplayPanes();
}
