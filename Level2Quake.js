/* ======================================================================
   Level2Quake.js — THE AFTERSHOCK UNDER HARBOUR WALK (Level 2)

   Mid-route, the first time you pass under the glass bridge, an aftershock
   hits:
     0.0 s  the ground rumbles (cameraQuake) with a low roar; the windows
            round the bridge crack and the nearest shatter; the bridge's
            deck cracks, sags and starts crumbling (THE BRIDGE BREAKS)
     1.0 s  the bridge's glass gives way and comes down on the street with
            chunks of its concrete, and a wave of dust rolls out both ways
            along the street; if you're still under it, it cuts you. Its
            middle breaks away and falls, the spans either side swing
            down to hang
     1.9 s  on Easy, Dr. James on the radio: run, the animals are coming
     2.6 s  the shaking has broken the zoo open: its infected animals are out
            (ZooAnimals.js), coming in from the west side street
   Once a run; a restart puts the glass back and the animals away.
====================================================================== */
import * as THREE from 'three';
import { scene, sfx, pushKillFeed, STREET_HALF_W } from './Scene.js';
import { state } from './state.js';
import { damagePlayer } from './Actions.js';
import { playerVis } from './characters.js';
import { FEATURE_SPOTS } from './CityKit.js';
import { cameraQuake, cameraShock } from './CameraShock.js';
import { shakeGlass, rainGlass, collapseFX, crumble } from './ImpactFX.js';
import { createZooAnimals } from './ZooAnimals.js';
import { createNarrative } from './Narrative.js';

const TRIGGER_M = 4;        // this close to the bridge's line, on the street
const QUAKE_S = 3.2;
const GLASS_AT = 1.0, WARNING_AT = 1.9, ANIMALS_AT = 2.6; // s into the quake
const GLASS_LANDS = 0.9;    // s for it to come down from the deck
const GLASS_DAMAGE = 14;
const UNDER_M = 2.6;        // either side of the bridge's line: where it lands
/* THE BRIDGE BREAKS (CityTown.js buildBridge's loose pieces) — as the
   ground starts shaking, cracks open under the deck and down its sides
   and concrete starts crumbling out of them; the spans either side of the
   middle sag on their hinges, trembling. When the glass goes, the centre
   breaks away and drops into the street, where it smashes (and hurts, if
   you're under it), and the spans swing down to hang, broken, over the
   road. They stay that way: creaking, and now and then shedding a bit
   more, for the rest of the run. */
const CRACK_IN_S = 0.6, SAG = 0.05, HANG = 0.5;   // s; rad
const SWING_K = 38, SWING_C = 4.5;                 // the spans' spring and damping
const CRUMBLE_EVERY = 0.07, AFTER_CRUMBLE_M = 40;  // s between bits while it breaks; near enough to see the rest
const CHUNK_DAMAGE = 30, CHUNK_REACH = 2.4;        // the centre landing on you; m either side of the middle
const CHUNK_UNDER = 1.1;                           // m from the centre's pivot to its lowest edge (the fascia)
const _landAt = new THREE.Vector3();
/* THE ROAD SPLITS — a crack running across the street just past the
   bridge (the way you're heading), opening from the west kerb toward the middle as the ground
   shakes (ROAD_CRACK_AT to + ROAD_CRACK_S), with a puff of grit along it.
   Stays for the run; a restart closes it. */
const ROAD_CRACK_AT = 0.25, ROAD_CRACK_S = 1.4;
const ROAD_CRACK_LEN = 9, ROAD_CRACK_W = 1.6, ROAD_CRACK_DZ = 6; // m; and how far short of the bridge
function roadCrackTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const g = c.getContext('2d');
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // The main split: jagged, widest in the middle of its run, a pale broken
  // edge either side of the dark gap
  const pts = [];
  for (let x = 0, y = 64; x <= 1024; x += 16) { pts.push([x, y]); y = Math.min(100, Math.max(28, y + (r() - 0.5) * 22)); }
  const gap = (x) => 2 + 9 * Math.sin(Math.PI * x / 1024);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [colour, extra] of [['rgba(150,140,128,0.55)', 4], ['rgba(10,9,8,0.97)', 0]]) {
    for (let i = 1; i < pts.length; i++) {
      g.strokeStyle = colour; g.lineWidth = gap(pts[i][0]) + extra;
      g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke();
    }
  }
  // Hairline branches off it
  g.strokeStyle = 'rgba(14,12,10,0.85)';
  for (let i = 0; i < 14; i++) {
    let [x, y] = pts[2 + Math.floor(r() * (pts.length - 4))], a = (r() < 0.5 ? -1 : 1) * (0.5 + r());
    g.lineWidth = 1.5 + r() * 1.5; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4 + r() * 5; k++) { a += (r() - 0.5) * 0.8; x += Math.cos(a) * 10; y += Math.sin(a) * 10; g.lineTo(x, y); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeRoadCrack(B) {
  // Its origin at its west end, so growing its length opens it from there
  const geo = new THREE.PlaneGeometry(ROAD_CRACK_LEN, ROAD_CRACK_W).translate(ROAD_CRACK_LEN / 2, 0, 0).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map: roadCrackTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(-STREET_HALF_W + 0.6, 0.016, B.z - ROAD_CRACK_DZ);
  mesh.rotation.y = 0.18;
  mesh.receiveShadow = true;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

export function createLevel2Quake() {
  const animals = createZooAnimals();
  state.extraShotTargets = [animals];
  // Dr. James's warning comes over the radio, not a card: the game doesn't stop
  const radio = createNarrative();
  let phase = 'waiting', t = 0, cut = false, warned = false, run = 0; // run: a fresh id each time (the radio shows an id once)
  const glass = () => {
    const out = [];
    FEATURE_SPOTS.bridge?.group.traverse((o) => { if (o.isMesh && o.material?.userData?.glass) out.push(o); });
    return out;
  };
  const under = (B, p) => Math.abs(p.z - B.z) < UNDER_M && Math.abs(p.x) < B.span / 2;

  // The bridge breaking: the spans' angle and swing, the centre's fall
  const spans = { angle: 0, speed: 0 };
  const chunk = { falling: false, landed: false, vy: 0 };
  let crumbleIn = 0, aftershed = 0, roadCrack = null, gritDone = false;
  // Where a span's broken end is now (its inner end, swung down by the angle)
  const brokenEnd = (piece, side) => {
    const len = Math.abs(piece.inner - piece.home.x);
    return [piece.home.x - side * len * Math.cos(spans.angle), piece.home.y - len * Math.sin(spans.angle) - 0.3];
  };
  function updateBridge(B, dt, p) {
    if (B.cracks) B.cracks.opacity = 0.9 * Math.min(1, t / CRACK_IN_S);
    // The road splitting open, from the kerb: more of its length shown
    // (not stretched) as it goes
    if (roadCrack) {
      const f = THREE.MathUtils.clamp((t - ROAD_CRACK_AT) / ROAD_CRACK_S, 0, 1);
      roadCrack.visible = f > 0;
      roadCrack.scale.x = Math.max(0.001, f);
      roadCrack.material.map.repeat.x = Math.max(0.001, f);
      if (f > 0 && !gritDone) {
        gritDone = true;
        for (let k = 0; k < 5; k++) crumble(roadCrack.position.x + 1 + k * 1.6, 0.25, roadCrack.position.z + k * 0.28, 0.5, 0.6, 2);
        sfx.noise(0.7, 0.12, 200); // the crack of it
      }
    }
    if (!B.loose) return;
    const { west, east, centre } = B.loose;
    // The spans: a spring toward the sag while it shakes, then the hang,
    // with a tremble on top while the ground's moving and a creak after
    const shaking = t < QUAKE_S;
    const target = (t < GLASS_AT ? SAG : HANG) + (shaking ? (Math.random() - 0.5) * 0.03 : 0.012 * Math.sin(t * 1.3));
    spans.speed += (SWING_K * (target - spans.angle) - SWING_C * spans.speed) * dt;
    spans.angle += spans.speed * dt;
    west.pivot.rotation.z = -spans.angle;
    east.pivot.rotation.z = spans.angle;
    // The centre: trembling in place, then free and falling, then gone
    if (!chunk.falling && !chunk.landed) {
      centre.pivot.position.y = centre.home.y - spans.angle * 0.6 + (shaking ? (Math.random() - 0.5) * 0.04 : 0);
      if (t >= GLASS_AT) chunk.falling = true;
    } else if (chunk.falling) {
      chunk.vy -= 9.8 * dt;
      centre.pivot.position.y += chunk.vy * dt;
      centre.pivot.rotation.z += 0.5 * dt;
      centre.pivot.rotation.x += 0.18 * dt;
      if (centre.pivot.position.y - CHUNK_UNDER <= 0) {
        // It hits the street and breaks up
        chunk.falling = false; chunk.landed = true;
        centre.pivot.visible = false;
        collapseFX(B.z, CHUNK_REACH, 0.9);
        crumble(0, 0.8, B.z, CHUNK_REACH, 3, 16);
        cameraShock(_landAt.set(0, 0.5, B.z), 0.9); // a jolt on top of the rumble, not in place of it
        state.shake = Math.max(state.shake, 0.12);
        sfx.noise(1.1, 0.24, 70);
        if (Math.abs(p.x) < CHUNK_REACH + 0.6 && Math.abs(p.z - B.z) < UNDER_M) { damagePlayer(CHUNK_DAMAGE); pushKillFeed('The bridge came down on you!'); }
      }
    }
    // Concrete crumbling out of the cracks: steadily while it breaks, now
    // and then after, while you're near enough to see it
    if (shaking) {
      if (t > 0.2 && (crumbleIn -= dt) <= 0) {
        crumbleIn = CRUMBLE_EVERY;
        const [piece, side] = Math.random() < 0.5 ? [west, -1] : [east, 1];
        const [x, y] = Math.random() < 0.6 ? brokenEnd(piece, side) : [piece.home.x, piece.home.y - 0.3];
        crumble(x, y, B.z, 0.5, 3, 1 + (Math.random() < 0.4 ? 1 : 0));
      }
    } else if ((aftershed -= dt) <= 0) {
      aftershed = 1.5 + Math.random() * 2.5;
      if (Math.abs(p.z - B.z) < AFTER_CRUMBLE_M) {
        const [piece, side] = Math.random() < 0.5 ? [west, -1] : [east, 1];
        const [x, y] = brokenEnd(piece, side);
        crumble(x, y, B.z, 0.4, 3, 2 + Math.floor(Math.random() * 3));
      }
    }
  }
  function resetBridge() {
    const B = FEATURE_SPOTS.bridge;
    spans.angle = spans.speed = 0;
    chunk.falling = chunk.landed = false; chunk.vy = 0;
    crumbleIn = aftershed = 0;
    gritDone = false;
    if (roadCrack) { roadCrack.visible = false; roadCrack.scale.x = 1; roadCrack.material.map.repeat.x = 1; }
    if (!B?.loose) return;
    for (const piece of Object.values(B.loose)) { piece.pivot.position.copy(piece.home); piece.pivot.rotation.set(0, 0, 0); piece.pivot.visible = true; }
    if (B.cracks) B.cracks.opacity = 0;
  }

  function start(B) {
    roadCrack ||= makeRoadCrack(B);
    phase = 'shaking';
    t = 0;
    cameraQuake(QUAKE_S, 1);
    state.shake = Math.max(state.shake, 0.06);
    sfx.noise(QUAKE_S, 0.24, 48); // the roar of the ground
    sfx.noise(2.2, 0.1, 120);
    shakeGlass(new THREE.Vector3(0, 3, B.z), 18);
    pushKillFeed('AFTERSHOCK — get out from under the bridge!');
  }

  return {
    update(dt) {
      const p = playerVis.group.position;
      animals.update(dt, p);
      if (!state.paused) radio.update(dt);
      const B = FEATURE_SPOTS.bridge;
      if (!B || state.paused || state.isDead || state.cinematic || state.narrativeBlocked) return;
      if (phase === 'waiting') {
        if (Math.abs(p.z - B.z) < TRIGGER_M && Math.abs(p.x) < STREET_HALF_W + 3) start(B);
        return;
      }
      t += dt;
      updateBridge(B, dt, p);
      if (phase === 'done') return;
      if (phase === 'shaking' && t >= GLASS_AT) {
        // The vault and the stair towers' glass give way
        for (const m of glass()) m.visible = false;
        rainGlass(-B.span / 2, B.span / 2, B.z, B.deckY + 1.2, 56);
        collapseFX(B.z, B.span / 2, B.deckY);
        phase = 'falling';
      }
      // Easy: Dr. James warns you what's coming
      if (!warned && t >= WARNING_AT && state.difficulty === 'easy') {
        warned = true;
        radio.show({ id: `james-animals-warning-${run}`, mode: 'radio', speaker: 'DR. JAMES / SECURE CHANNEL', title: 'Run!',
          text: "That quake broke the zoo open. The animals are loose and they're coming your way. Run!", duration: 6 });
      }
      if (phase === 'falling') {
        if (!cut && t >= GLASS_AT + GLASS_LANDS) {
          cut = true;
          if (under(B, p)) { damagePlayer(GLASS_DAMAGE); pushKillFeed('Falling glass!'); }
        }
        if (t >= ANIMALS_AT) {
          animals.release();
          sfx.noise(0.9, 0.14, 140);
          pushKillFeed('The quake broke the zoo open — the animals are in the street!');
          phase = 'done';
        }
      }
    },
    reset() {
      phase = 'waiting';
      t = 0;
      cut = false;
      warned = false;
      run++;
      for (const m of glass()) m.visible = true;
      resetBridge();
      animals.reset();
    },
  };
}
