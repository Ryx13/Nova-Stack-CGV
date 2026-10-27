/* ======================================================================
   Level1Intro.js — THE FLY-THROUGH BRIEFING BEFORE LEVEL 1

   Same idea as Level 2's intro (Level2Intro.js): the camera flies to a
   handful of poses, each with a caption, then lands exactly where
   gameplay takes the camera over. Level 1 has more to explain, so every
   stop also pins a label on the thing it is talking about and, where it
   matters, shows the keys to press:

     1  You          — the story: why you're out here
     2  The street   — clear the route (10 infected) · movement keys
     3  The infected — fighting keys
     4  Supply cache — the hidden pocket west of the street
     5  Your car     — F to drive
     6  The depot    — the amber glow east: collect the culture sample
     7  Extraction   — the green marker at the end of the street
     8  GO

   While it plays state.cinematic freezes the gameplay gate in Actions.js
   (no movement, zombies, spawns or run clock). Any key or click skips it;
   a click also falls through to the canvas so it captures the mouse.
====================================================================== */
import * as THREE from 'three';
import {
  camera, forwardFromYaw, rightFromYaw,
  DEPOT_POS, WEST_POCKET_Z, rowX, extractPos, extractRing, extractLight,
} from './Scene.js';
import { registerLevelTick } from './Actions.js';
import { playerVis, playerBody, syncHandGun, carSpawn } from './characters.js';
import { state } from './state.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* Shot list. Each shot flies to `pos`/`look` over `move` s, then holds for
   `hold` s with its caption up. `lift` arcs the flight up by that fraction
   of the distance travelled (keeps long flights above the rooftops).
   `tag` is the small line above the title, `keys` the key chips, and
   `mark` { at, text } a label pinned on a world point. */
function buildShots({ playerPos, playerPose, infectedPos }) {
  const fwd = forwardFromYaw(state.yaw), right = rightFromYaw(state.yaw);
  const playerEye = playerPos.clone().add(V(0, 0.45, 0)); // aimed low so the figure sits above the caption
  const playerCam = playerPos.clone().addScaledVector(fwd, 3.1).addScaledVector(right, 0.9).add(V(0, 1.2, 0));
  const cachePos = V(-(rowX + 15), 0, WEST_POCKET_Z);
  const cacheLook = cachePos.clone().add(V(0, 1.2, 0));
  const carLook = carSpawn.clone().add(V(0, 0.6, 0));
  const depotLook = DEPOT_POS.clone().add(V(0, 2.5, 0));
  const extractLook = extractPos.clone().add(V(0, 1.5, 0));
  const streetLook = V(0, 2, playerPos.z - 70);

  return [
    {
      pos: playerCam, look: playerEye, move: 1.3, hold: 4.4,
      tag: '01 · The courier',
      title: 'This is you',
      sub: "The outbreak caught you on a delivery. Dr. James can't leave the safe room, and his cure needs two things: a culture sample from this street, and the stabilizer you dropped. The sample comes first.",
      mark: { at: playerPos.clone().add(V(0, 2.25, 0)), text: 'YOU' },
    },
    {
      pos: playerPos.clone().add(V(-3.5, 9, 14)), look: streetLook, move: 1.7, hold: 3.8, lift: 0.1,
      tag: '02 · The street',
      title: 'Fight through the street',
      sub: 'Infected fill the road ahead. Take down 10 of them to clear the route.',
      keys: [['W A S D', 'Move'], ['Mouse', 'Look'], ['Shift + W', 'Sprint'], ['Space', 'Jump'], ['C', 'Crouch']],
    },
    {
      pos: infectedPos.clone().add(V(4.5, 3.2, 9)), look: infectedPos.clone().add(V(0, 1.2, 0)), move: 1.6, hold: 3.6, lift: 0.12,
      tag: '03 · The infected',
      title: 'They come at you',
      sub: 'Shoot them, or finish them with the knife. Kills can drop health, ammo and shields, so keep moving.',
      keys: [['Left click', 'Shoot'], ['Right click', 'Melee'], ['R', 'Reload'], ['Q', 'Gun / Knife']],
      mark: { at: infectedPos.clone().add(V(0, 2.4, 0)), text: 'INFECTED' },
    },
    {
      pos: V(-5, 7.5, WEST_POCKET_Z - 7), look: cacheLook, move: 1.7, hold: 3.0, lift: 0.1,
      tag: '04 · Supplies',
      title: 'Supply cache',
      sub: 'A side lot west of the street hides a health or ammo drop. Worth a detour if you are running low.',
      mark: { at: cacheLook.clone().add(V(0, 1.2, 0)), text: 'SUPPLY CACHE' },
    },
    {
      pos: carSpawn.clone().add(V(-6.5, 2.6, 6)), look: carLook, move: 1.6, hold: 3.0, lift: 0.1,
      tag: '05 · Transport',
      title: 'Your ride',
      sub: "There's a car parked just ahead. Get in to cover ground fast, get out to fight.",
      keys: [['F', 'Enter / exit car']],
      mark: { at: carLook.clone().add(V(0, 1.7, 0)), text: 'CAR' },
    },
    {
      pos: V(4, 6.5, DEPOT_POS.z + 2), look: depotLook, move: 2.0, hold: 3.8, lift: 0.14,
      tag: '06 · The goal',
      title: 'The depot',
      sub: 'Follow the amber glow east, off the main road. Infected guard the yard. Walk into the marker to take the culture sample.',
      mark: { at: DEPOT_POS.clone().add(V(0, 5, 0)), text: 'DEPOT' },
    },
    {
      pos: V(5, 8, extractPos.z + 22), look: extractLook, move: 2.2, hold: 3.6, lift: 0.14,
      tag: '07 · Extraction',
      title: 'Extraction',
      sub: 'Then run the sample to the green marker at the far end of the street. Reach it and the level is done.',
      mark: { at: extractPos.clone().add(V(0, 3.4, 0)), text: 'EXTRACTION' },
      extract: true,
    },
    { pos: playerPose.pos, look: playerPose.look, move: 2.0, hold: 0.7, lift: 0.12, title: 'GO' },
  ];
}

// The stock on-foot third-person pose (updateCameraOnFoot in Actions.js),
// so the swoop lands exactly where gameplay takes the camera over
function playerCameraPose(playerPos) {
  const origin = playerPos.clone().add(V(0, 1.52, 0));
  const fwd = forwardFromYaw(state.yaw), right = rightFromYaw(state.yaw);
  const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
  return {
    pos: origin.clone().addScaledVector(fwd, -3.55 * cp).addScaledVector(right, 0.62).add(V(0, 0.35 + sp * 1.6, 0)),
    look: origin.clone().addScaledVector(fwd, 10 * cp).addScaledVector(right, 0.15).add(V(0, sp * 10, 0)),
  };
}

const poseQuat = (pos, look) =>
  new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, look, V(0, 1, 0)));
const smooth = (u) => u * u * (3 - 2 * u);

let intro = null;
let started = false;
let waited = 0;
const GAME_WAIT = 4; // s to wait for the first infected to exist, so shot 3 isn't an empty street

/** Freezes gameplay until the fly-through has run. Call right after bootLevel. */
export function startLevel1Intro() {
  state.cinematic = true;
  document.body.classList.add('lv1-intro');
  registerLevelTick(tickIntro);
}

function tickIntro(dt) {
  if (!state.cinematic) return;
  if (!state.readyShown) return; // behind the loading screen
  // Gameplay (which syncs the player model to its body) is frozen: stand
  // the model on its spawn and keep its idle breathing meanwhile
  playerVis.group.position.set(playerBody.position.x, 0, playerBody.position.z);
  if (playerVis.mixer) playerVis.mixer.update(dt);
  syncHandGun();
  // The street's infected are frozen with everything else; keep them shambling
  for (const z of state.zombies) if (z.mixer) z.mixer.update(dt);
  if (!started) {
    waited += dt;
    if (!state.zombies.length && waited < GAME_WAIT) return;
    started = true;
    startIntro();
    return;
  }
  updateIntro(dt);
}

function startIntro() {
  const playerPos = playerVis.group.position.clone();
  const playerPose = playerCameraPose(playerPos);
  // The infected closest to the player is the one the "fight" shot frames
  let infectedPos = V(0, 0, playerPos.z - 30);
  let best = Infinity;
  for (const z of state.zombies) {
    const p = z.mesh.position, d = p.distanceTo(playerPos);
    if (d > 12 && d < best) { best = d; infectedPos = V(p.x, 0, p.z); }
  }
  const shots = buildShots({ playerPos, playerPose, infectedPos });
  // Opening frame: wide behind and above the player, looking at them
  const start = { pos: playerPos.clone().add(V(2.5, 7, 12)), look: playerPos.clone().setY(1.2) };
  let t = 0;
  const keys = [];
  for (const s of shots) {
    keys.push({ ...s, t0: t, t1: t + s.move, t2: t + s.move + s.hold, quat: poseQuat(s.pos, s.look) });
    t += s.move + s.hold;
  }
  const el = buildOverlay();
  intro = { t: 0, keys, from: { pos: start.pos, quat: poseQuat(start.pos, start.look) }, el, shown: -1, extractShown: false };
  camera.position.copy(start.pos);
  camera.quaternion.copy(intro.from.quat);
  const skip = (e) => {
    if (e.type === 'keydown') { e.preventDefault(); e.stopImmediatePropagation(); }
    endIntro();
  };
  intro.skip = skip;
  window.addEventListener('keydown', skip, true);
  window.addEventListener('pointerdown', skip, true);
}

const _p = new THREE.Vector3();
function updateIntro(dt) {
  if (!intro) return;
  intro.t += dt;
  const { keys } = intro;
  const i = keys.findIndex((k) => intro.t < k.t2 || k === keys[keys.length - 1]);
  const k = keys[i];
  const from = i === 0 ? intro.from : keys[i - 1];
  const u = smooth(THREE.MathUtils.clamp((intro.t - k.t0) / k.move, 0, 1));
  camera.position.lerpVectors(from.pos, k.pos, u);
  if (k.lift) camera.position.y += Math.sin(Math.PI * u) * from.pos.distanceTo(k.pos) * k.lift;
  camera.quaternion.slerpQuaternions(from.quat, k.quat, u);
  camera.updateMatrixWorld();
  // Caption for the shot being flown to, once the camera is most of the way there
  const showing = u > 0.55 ? i : i - 1;
  if (showing !== intro.shown && showing >= 0) {
    intro.shown = showing;
    setCaption(intro.el, keys[showing]);
    // The extraction ring only exists once you hold the sample; light it for
    // the briefing so the player sees what they are looking for
    const wantRing = !!keys[showing].extract;
    if (wantRing !== intro.extractShown) setExtractPreview(wantRing);
  }
  placeMark(intro.el, intro.shown >= 0 ? keys[intro.shown].mark : null);
  if (intro.t >= keys[keys.length - 1].t2) endIntro();
}

function setExtractPreview(on) {
  intro.extractShown = on;
  extractRing.visible = on;
  extractLight.intensity = on ? 2.2 : 0;
}

function placeMark(el, mark) {
  const m = el.mark;
  if (!mark) { m.classList.remove('on'); return; }
  _p.copy(mark.at).project(camera);
  const onScreen = _p.z < 1 && Math.abs(_p.x) < 1.05 && Math.abs(_p.y) < 1.05;
  if (!onScreen) { m.classList.remove('on'); return; }
  if (m.dataset.text !== mark.text) { m.dataset.text = mark.text; m.querySelector('span').textContent = mark.text; }
  m.style.transform = `translate(${((_p.x + 1) / 2) * innerWidth}px, ${((1 - _p.y) / 2) * innerHeight}px)`;
  m.classList.add('on');
}

function endIntro() {
  if (!intro) return;
  window.removeEventListener('keydown', intro.skip, true);
  window.removeEventListener('pointerdown', intro.skip, true);
  if (intro.extractShown) setExtractPreview(false);
  intro.el.root.remove();
  intro = null;
  state.cinematic = false;
  document.body.classList.remove('lv1-intro');
}

/* --- Overlay: letterbox, caption, key chips, world label, skip hint ---- */
function buildOverlay() {
  if (!document.getElementById('lv1-intro-style')) {
    const style = document.createElement('style');
    style.id = 'lv1-intro-style';
    style.textContent = `
      body.lv1-intro #hud,body.lv1-intro #fuel-wrap,body.lv1-intro #coin-label,body.lv1-intro #weapon-label,body.lv1-intro #shield-label{visibility:hidden;}
      #lv1-intro{position:fixed;inset:0;z-index:40;pointer-events:none;font-family:inherit;overflow:hidden;}
      #lv1-intro .bar{position:absolute;left:0;right:0;height:9vh;background:#000;}
      #lv1-intro .bar.top{top:0;} #lv1-intro .bar.bottom{bottom:0;}
      #lv1-intro .caption{position:absolute;left:0;right:0;bottom:12vh;text-align:center;padding:0 16px;
        opacity:0;transform:translateY(8px);transition:opacity .3s,transform .3s;}
      #lv1-intro .caption.on{opacity:1;transform:none;}
      #lv1-intro .caption .tag{margin:0 0 6px;font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:#e0a83c;text-shadow:0 1px 8px rgba(0,0,0,.9);}
      #lv1-intro .caption h2{margin:0;font-size:clamp(26px,4.4vw,46px);letter-spacing:.12em;text-transform:uppercase;
        color:#f4ece0;text-shadow:0 2px 14px rgba(0,0,0,.85);}
      #lv1-intro .caption p.sub{margin:6px auto 0;max-width:min(760px,92vw);font-size:clamp(14px,1.7vw,18px);line-height:1.45;color:#e6dccd;text-shadow:0 1px 8px rgba(0,0,0,.9);}
      #lv1-intro .keys{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 10px;margin-top:12px;}
      #lv1-intro .keys:empty{display:none;}
      #lv1-intro .keys span{display:inline-flex;align-items:center;gap:8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;
        color:#e6dccd;text-shadow:0 1px 6px rgba(0,0,0,.9);}
      #lv1-intro .keys kbd{font-weight:600;font-size:12px;line-height:1;font-family:inherit;padding:7px 10px;border:1px solid #e0a83c99;border-bottom-width:3px;
        background:rgba(14,18,22,.82);color:#ffe9c2;letter-spacing:.12em;border-radius:3px;}
      #lv1-intro .caption.go h2{font-size:clamp(44px,8vw,84px);color:#ffd08a;}
      #lv1-intro .mark{position:absolute;left:0;top:0;opacity:0;transition:opacity .25s;will-change:transform;}
      #lv1-intro .mark.on{opacity:1;}
      #lv1-intro .mark:before{content:'';position:absolute;left:-7px;top:-7px;width:14px;height:14px;transform:rotate(45deg);
        border:2px solid #ffd08a;background:rgba(224,168,60,.35);box-shadow:0 0 12px rgba(255,208,138,.7);}
      #lv1-intro .mark span{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);white-space:nowrap;
        font-size:12px;letter-spacing:.22em;font-weight:600;color:#ffe9c2;padding:4px 9px;background:rgba(14,18,22,.8);
        border:1px solid #e0a83c99;}
      #lv1-intro .skip{position:absolute;right:16px;top:calc(9vh + 12px);font-size:12px;letter-spacing:.14em;
        text-transform:uppercase;color:rgba(255,255,255,.55);}
      @media(max-height:560px){#lv1-intro .caption{bottom:10.5vh}#lv1-intro .caption p.sub{font-size:13px}}
    `;
    document.head.appendChild(style);
  }
  const root = document.createElement('div');
  root.id = 'lv1-intro';
  root.innerHTML = `<div class="bar top"></div><div class="bar bottom"></div>
    <div class="mark"><span></span></div>
    <div class="caption"><div class="tag"></div><h2></h2><p class="sub"></p><div class="keys"></div></div>
    <div class="skip">Press any key to skip</div>`;
  document.body.appendChild(root);
  return { root, caption: root.querySelector('.caption'), mark: root.querySelector('.mark') };
}

function setCaption(el, shot) {
  const c = el.caption;
  c.classList.remove('on');
  c.classList.toggle('go', shot.title === 'GO');
  c.querySelector('.tag').textContent = shot.tag || '';
  c.querySelector('h2').textContent = shot.title;
  c.querySelector('.sub').textContent = shot.sub || '';
  const keys = c.querySelector('.keys');
  keys.replaceChildren();
  for (const [key, label] of shot.keys || []) {
    const item = document.createElement('span');
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    item.append(kbd, document.createTextNode(label));
    keys.append(item);
  }
  void c.offsetWidth; // restart the fade-in
  c.classList.add('on');
}
