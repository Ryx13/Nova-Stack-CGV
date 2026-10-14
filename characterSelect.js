/* ======================================================================
   characterSelect.js — "CHOOSE YOUR SURVIVOR" SCREEN

   The whole roster stands in a lineup on a dark stage. Picking one (click
   them in the scene, or their card) steps them forward into a spotlight
   to do their showcase move while the others watch; Deploy confirms.

   Owns its own small renderer, separate from the level's: the level
   modules aren't even imported until a level + mode are chosen, and
   dispose() frees this one's GPU memory before that happens.
====================================================================== */
import * as THREE from 'three';
import { ROSTER, getSelectedCharacter, setSelectedCharacter, instantiateCharacter, clipsFor } from './roster.js';

const IDLE_CLIPS = ['listen', 'idle'];  // first one present wins
const SHOWCASE_CLIP = 'dance';    // unless the roster entry names its own
const SPACING = 1.15;
const STEP_FORWARD = 0.9;
const FADE = 0.35;

let ctx = null; // { renderer, scene, camera, slots, raf, ... } while built

export function showCharacterSelect({ onConfirm, onBack }) {
  const screen = document.getElementById('character-select');
  screen.classList.remove('hidden');
  if (!ctx) build(screen);
  ctx.onConfirm = onConfirm;
  ctx.onBack = onBack;
  select(getSelectedCharacter(), { showcase: false });
  resume();
}

export function hideCharacterSelect() {
  document.getElementById('character-select').classList.add('hidden');
  if (ctx) { cancelAnimationFrame(ctx.raf); ctx.raf = 0; }
}

export function disposeCharacterSelect() {
  if (!ctx) return;
  hideCharacterSelect();
  window.removeEventListener('resize', ctx.onResize);
  ctx.scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) [].concat(o.material).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
  });
  ctx.renderer.dispose();
  ctx = null;
}

function build(screen) {
  const canvas = screen.querySelector('#cs-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060606);
  scene.fog = new THREE.Fog(0x060606, 7, 16);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

  scene.add(new THREE.HemisphereLight(0x8a93a6, 0x1a120c, 0.55));
  const key = new THREE.DirectionalLight(0xffe2c0, 0.9);
  key.position.set(3, 6, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc81e1e, 1.4); // the title's blood red, from behind
  rim.position.set(-2, 3, -5);
  scene.add(rim);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const blobTex = radialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)');
  const poolTex = radialTexture('rgba(255,214,150,0.55)', 'rgba(255,214,150,0)');

  const slots = ROSTER.map((c, i) => {
    const group = new THREE.Group();
    const homeX = (i - (ROSTER.length - 1) / 2) * SPACING;
    const homeZ = -Math.abs(homeX) * 0.3; // shallow arc toward the camera
    group.position.set(homeX, 0, homeZ);
    scene.add(group);

    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.005;
    group.add(blob);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, opacity: 0 }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.01;
    group.add(pool);

    const spot = new THREE.SpotLight(0xffe0b0, 0, 9, 0.38, 0.6, 1.2);
    spot.position.set(0, 5.5, 1.5);
    spot.target = group;
    group.add(spot);

    // Clicking a 30k-triangle skinned mesh is expensive to raycast; an
    // invisible capsule-sized box per slot is what the pointer hits.
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.9, 0.6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.95;
    hit.userData.id = c.id;
    group.add(hit);

    const slot = { id: c.id, group, homeX, homeZ, spot, pool, hit, mixer: null, actions: null, current: null };
    instantiateCharacter(c.id).then(async (root) => {
      if (!ctx) return;
      const clips = await clipsFor(root);
      group.add(root);
      slot.mixer = new THREE.AnimationMixer(root);
      slot.actions = {};
      for (const [name, clip] of Object.entries(clips)) slot.actions[name] = slot.mixer.clipAction(clip);
      slot.idle = IDLE_CLIPS.map((n) => slot.actions[n]).find(Boolean) || null;
      if (slot.idle) {
        slot.idle.play();
        slot.idle.time = Math.random() * slot.idle.getClip().duration; // no synchronized nodding
        slot.current = slot.idle;
      }
      slot.mixer.addEventListener('finished', () => fadeTo(slot, slot.idle));
      if (ctx.selected === c.id && ctx.pendingShowcase) showcase(slot);
      screen.querySelector(`.cs-card[data-id="${c.id}"]`)?.classList.remove('loading');
    }).catch((err) => console.error(`Character "${c.id}" failed to load:`, err));
    return slot;
  });

  // Cards
  const cards = screen.querySelector('#cs-cards');
  cards.innerHTML = '';
  ROSTER.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cs-card loading';
    b.dataset.id = c.id;
    b.innerHTML = `<span class="cs-card-name">${c.name}</span><span class="cs-card-role">${c.role}</span>`;
    b.addEventListener('click', () => select(c.id));
    cards.appendChild(b);
  });
  screen.querySelector('#cs-confirm').onclick = () => {
    setSelectedCharacter(ctx.selected);
    ctx.onConfirm?.(ctx.selected);
  };
  screen.querySelector('#cs-back').onclick = () => ctx.onBack?.();

  // Pointer picking in the 3D lineup
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(slots.map((s) => s.hit))[0]?.object.userData.id || null;
  };
  canvas.addEventListener('pointermove', (e) => {
    ctx.hovered = pick(e);
    canvas.style.cursor = ctx.hovered ? 'pointer' : '';
  });
  canvas.addEventListener('click', (e) => { const id = pick(e); if (id) select(id); });

  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Landscape frames the whole lineup; portrait (phones) would have to
    // back off ~28 m for that, so it frames the pick and its neighbours
    // and pans along the line as the pick changes (see tick).
    ctx.portrait = camera.aspect < 1;
    const halfW = ctx.portrait ? SPACING * 1.25 : (ROSTER.length * SPACING) / 2 + 0.6;
    const hFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    ctx.dist = Math.max(7.5, halfW / Math.tan(hFov / 2));
    camera.position.set(0, 1.55, ctx.dist);
    scene.fog.near = ctx.dist - 1.5;
    scene.fog.far = ctx.dist + 9;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  ctx = { renderer, scene, camera, slots, screen, clock: new THREE.Clock(), raf: 0, selected: null, hovered: null, onResize, focusX: 0 };
  onResize();
}

function select(id, { showcase: doShowcase = true } = {}) {
  if (!ctx) return;
  ctx.selected = id;
  const c = ROSTER.find((r) => r.id === id);
  ctx.screen.querySelector('#cs-name').textContent = c.name;
  ctx.screen.querySelector('#cs-role').textContent = c.role;
  ctx.screen.querySelector('#cs-blurb').textContent = c.blurb;
  ctx.screen.querySelectorAll('.cs-card').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
  ctx.pendingShowcase = doShowcase;
  ctx.slots.forEach((s) => {
    if (s.id === id) { if (doShowcase) showcase(s); }
    else if (s.current && s.current !== s.idle) fadeTo(s, s.idle);
  });
}

function showcase(slot) {
  const name = ROSTER.find((r) => r.id === slot.id).showcase || SHOWCASE_CLIP;
  const act = slot.actions?.[name];
  if (!act) return;
  ctx.pendingShowcase = false;
  // Showcasing the clip they already idle on: restart it in the spotlight
  // and keep it looping (a finite loop would end with nothing to fade to).
  if (act === slot.idle) { act.time = 0; return; }
  act.reset();
  act.setLoop(THREE.LoopRepeat, 2);
  act.clampWhenFinished = false;
  fadeTo(slot, act);
}

function fadeTo(slot, action) {
  if (!action || slot.current === action) return;
  action.reset().setEffectiveWeight(1).play();
  if (slot.current) slot.current.crossFadeTo(action, FADE, false);
  slot.current = action;
}

function resume() {
  if (ctx.raf) return;
  ctx.clock.getDelta();
  const tick = () => {
    ctx.raf = requestAnimationFrame(tick);
    const dt = Math.min(ctx.clock.getDelta(), 0.05);
    const t = ctx.clock.elapsedTime;
    for (const s of ctx.slots) {
      const on = s.id === ctx.selected;
      const hov = s.id === ctx.hovered && !on;
      const ease = Math.min(1, dt * 6);
      s.group.position.z += ((on ? s.homeZ + STEP_FORWARD : s.homeZ) - s.group.position.z) * ease;
      s.group.position.x += ((on ? s.homeX * 0.85 : s.homeX) - s.group.position.x) * ease;
      s.spot.intensity += ((on ? 60 : hov ? 18 : 0) - s.spot.intensity) * ease;
      s.pool.material.opacity += ((on ? 1 : hov ? 0.35 : 0) - s.pool.material.opacity) * ease;
      // Watchers turn a touch toward the pick
      const sel = ctx.slots.find((o) => o.id === ctx.selected);
      const look = on || !sel ? 0 : Math.atan2(sel.group.position.x - s.group.position.x, 3) * 0.5;
      s.group.rotation.y += (look - s.group.rotation.y) * ease;
      if (s.mixer) s.mixer.update(dt);
    }
    const sel = ctx.portrait && ctx.slots.find((o) => o.id === ctx.selected);
    ctx.focusX += ((sel ? sel.group.position.x : 0) - ctx.focusX) * Math.min(1, dt * 4);
    ctx.camera.position.x = ctx.focusX + Math.sin(t * 0.15) * 0.25; // slow drift so the stage never sits dead still
    ctx.camera.lookAt(ctx.focusX, 0.82, 0);
    ctx.renderer.render(ctx.scene, ctx.camera);
  };
  tick();
}

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
