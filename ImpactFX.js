import * as THREE from 'three';
import { scene, sfx } from './Scene.js';
import { state } from './state.js';
import { glassPanes, hideDisplayPane, restoreDisplayPanes } from './CityKit.js';
import { RayCandidates } from './RayCandidates.js';

/* ---------------------------------------------------------------------
   IMPACT FX — what a bullet leaves behind: a wet spray of blood out of
   the infected it hits, a splat on the ground under them, and a crack
   (plus a few falling shards) in any window glass it passes through; the
   third crack in a pane shatters it.
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
  }
  emit(pos, vel, life, size, floor) {
    const part = this.parts[this.next];
    this.next = (this.next + 1) % this.parts.length;
    part.p.copy(pos); part.v.copy(vel);
    part.life = part.max = life; part.size = size; part.floor = floor; part.spin = Math.random() * Math.PI * 2;
    this.awake = Math.max(this.awake, life + 0.1);
  }
  update(dt) {
    if (this.awake < 0) return;
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
const pools = [bloodDrops, bloodSplats, glassShards, glassCracks, smashedPanes, smashedRims];
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

// A crack on pane p where the bullet entered, facing the shooter, plus
// shards; the third one shatters the pane instead
function crackPane(p, point, dir) {
  p.hits = (p.hits || 0) + 1;
  const { ax, ua, va, ext } = paneAxes(p);
  if (p.hits >= SHATTER_HITS && Math.max(ext[ua], ext[va]) <= SHATTER_MAX_M) { shatterPane(p, point, dir); return; }
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
  for (let i = 0; i < 7; i++) {
    _v.copy(dir).multiplyScalar(0.8 + Math.random() * 1.8);
    _v.x += (Math.random() - 0.5) * 1.2;
    _v.z += (Math.random() - 0.5) * 1.2;
    _v.y += Math.random() * 1.1;
    glassShards.emit(point, _v, 0.9 + Math.random() * 0.4, 0.02 + Math.random() * 0.03, 0.02);
  }
  sfx.noise(0.12, 0.05, 3400);
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
  sfx.noise(0.4, 0.12, 2600);
  sfx.noise(0.22, 0.07, 4600);
}

const _box = new THREE.Box3(), _hit = new THREE.Vector3();
const wallRay = new THREE.Raycaster();
const wallCandidates = new RayCandidates();
const paneHits = [];
/** Cracks the window glass a shot's ray passes through before maxDist, up
    to two panes (a display window's front and back). The first wall stops
    the bullet: the glass sits just proud of its building's blocker box. */
export function crackGlassAlong(ray, maxDist) {
  if (!glassPanes.length) return;
  paneHits.length = 0;
  for (const p of glassPanes) {
    _box.min.set(p.x - p.sx / 2, p.y - p.sy / 2, p.z - p.sz / 2);
    _box.max.set(p.x + p.sx / 2, p.y + p.sy / 2, p.z + p.sz / 2);
    if (p.shattered || !ray.intersectBox(_box, _hit)) continue; // a smashed pane lets bullets through
    const d = ray.origin.distanceTo(_hit);
    if (d <= maxDist) paneHits.push({ p, d, point: _hit.clone() });
  }
  if (!paneHits.length) return;
  wallRay.ray.copy(ray);
  wallRay.far = maxDist;
  const wall = wallRay.intersectObjects(wallCandidates.query(state.occluders, wallRay.ray, maxDist), false)[0];
  const limit = wall ? wall.distance + 0.12 : maxDist;
  paneHits.sort((a, b) => a.d - b.d);
  for (const h of paneHits.slice(0, 2)) if (h.d <= limit) crackPane(h.p, h.point, ray.direction);
}

/** Every frame from the main loop. */
export function updateImpactFX(dt) {
  for (const pool of pools) if (!pool.mesh.parent) scene.add(pool.mesh);
  bloodDrops.update(dt);
  glassShards.update(dt);
}

/** Restart: wipe every splat, crack and particle in flight, and glaze every pane again. */
export function clearImpactFX() {
  for (const pool of pools) pool.clear();
  crackOwner.length = 0;
  for (const p of glassPanes) { p.hits = 0; p.shattered = false; p.cracks = null; }
  restoreDisplayPanes();
}
