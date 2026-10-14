/* ======================================================================
   Level2Intro.js — THE ~9 s FLY-THROUGH BEFORE THE CHASE

   Briefs the player and shows off the street in four camera moves:
   push in on the girl → arc down the street to the port → rise to a
   top-down map with a marker on everything that matters → swoop back
   down behind the player, GO.

   While it plays state.cinematic freezes the gameplay gate in Actions.js
   (no movement, zombies, spawns or run clock) and Level 2's own ticks
   hold the chase. Any key or click skips it; a click also falls through
   to the canvas so it captures the mouse, ready to aim.
====================================================================== */
import * as THREE from 'three';
import { camera, forwardFromYaw, rightFromYaw } from './Scene.js';
import { state } from './state.js';

// Shot list: each move flies to a pose over `move` s, then holds it for
// `hold` s with its caption up. `lift` arcs the flight up by that
// fraction of the distance travelled (keeps the long one above the street).
function buildShots({ girlPos, girlFacing, portPos, playerPose }) {
  const girlEye = girlPos.clone().add(new THREE.Vector3(0, 1.25, 0));
  const girlCam = girlPos.clone().addScaledVector(girlFacing, 3.1).add(new THREE.Vector3(0.9, 1.5, 0));
  const mapCentre = new THREE.Vector3(0, 0, (playerPose.pos.z + portPos.z) / 2);
  return [
    {
      pos: girlCam, look: girlEye, move: 1.2, hold: 1.5,
      title: 'This is the girl', sub: 'She has the antidote. Catch her before she escapes.',
    },
    {
      pos: portPos.clone().add(new THREE.Vector3(9, 7, 13)), look: portPos.clone().add(new THREE.Vector3(0, 1.5, 0)),
      move: 1.5, hold: 1.4, lift: 0.12,
      title: 'This is the port', sub: "She's running for it. If she reaches it, she's gone.",
    },
    {
      pos: mapCentre.clone().setY(205), look: mapCentre, up: new THREE.Vector3(0, 0, -1),
      move: 1.3, hold: 1.7, map: true,
      title: 'Vending machines', sub: 'Spend your coins: radar to track her, adrenaline to outrun her.',
    },
    { pos: playerPose.pos, look: playerPose.look, move: 1.0, hold: 0, title: 'GO' },
  ];
}

// The stock on-foot third-person pose (updateCameraOnFoot in Actions.js),
// so the swoop lands exactly where gameplay takes the camera over
function playerCameraPose(playerPos) {
  const origin = playerPos.clone().add(new THREE.Vector3(0, 1.52, 0));
  const fwd = forwardFromYaw(state.yaw), right = rightFromYaw(state.yaw);
  const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
  return {
    pos: origin.clone().addScaledVector(fwd, -3.55 * cp).addScaledVector(right, 0.62).add(new THREE.Vector3(0, 0.35 + sp * 1.6, 0)),
    look: origin.clone().addScaledVector(fwd, 10 * cp).addScaledVector(right, 0.15).add(new THREE.Vector3(0, sp * 10, 0)),
  };
}

const poseQuat = (pos, look, up = new THREE.Vector3(0, 1, 0)) =>
  new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, look, up));
const smooth = (u) => u * u * (3 - 2 * u);

let intro = null;

/** Freezes gameplay until play() runs and finishes. Call at level build. */
export function holdForIntro() {
  state.cinematic = true;
  document.body.classList.add('lv2-intro');
}

/** Starts the fly-through. `markers`: [{ pos, label, kind }] pinned on the
    map shot; `onDone` runs once, when it ends or is skipped. */
export function playIntro({ girlPos, girlFacing, portPos, playerPos, markers, onDone }) {
  const playerPose = playerCameraPose(playerPos);
  const shots = buildShots({ girlPos, girlFacing, portPos, playerPose });
  // Opening frame: wide behind and above the player, looking at her
  const start = { pos: playerPos.clone().add(new THREE.Vector3(2.5, 7, 12)), look: girlPos.clone().setY(1.2) };
  let t = 0;
  const keys = [];
  for (const s of shots) {
    keys.push({ ...s, t0: t, t1: t + s.move, t2: t + s.move + s.hold, quat: poseQuat(s.pos, s.look, s.up) });
    t += s.move + s.hold;
  }
  const el = buildOverlay(markers);
  intro = { t: 0, keys, from: { pos: start.pos, quat: poseQuat(start.pos, start.look) }, el, markers, shown: -1, onDone };
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

/** Per-frame: flies the camera along the shot list. */
export function updateIntro(dt) {
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
  }
  placeMarkers(intro, keys[i].map && u > 0.85);
  if (intro.t >= keys[keys.length - 1].t1 + 0.35) endIntro();
}

function endIntro() {
  if (!intro) return;
  window.removeEventListener('keydown', intro.skip, true);
  window.removeEventListener('pointerdown', intro.skip, true);
  intro.el.root.remove();
  const done = intro.onDone;
  intro = null;
  state.cinematic = false;
  document.body.classList.remove('lv2-intro');
  if (done) done();
}

/* --- Overlay: letterbox, caption, skip hint, map markers -------------- */
function buildOverlay(markers) {
  if (!document.getElementById('lv2-intro-style')) {
    const style = document.createElement('style');
    style.id = 'lv2-intro-style';
    style.textContent = `
      body.lv2-intro #hud{visibility:hidden;}
      #lv2-intro{position:fixed;inset:0;z-index:40;pointer-events:none;font-family:inherit;}
      #lv2-intro .bar{position:absolute;left:0;right:0;height:9vh;background:#000;}
      #lv2-intro .bar.top{top:0;} #lv2-intro .bar.bottom{bottom:0;}
      #lv2-intro .caption{position:absolute;left:0;right:0;bottom:13vh;text-align:center;padding:0 16px;
        opacity:0;transform:translateY(8px);transition:opacity .3s,transform .3s;}
      #lv2-intro .caption.on{opacity:1;transform:none;}
      #lv2-intro .caption h2{margin:0;font-size:clamp(26px,4.4vw,46px);letter-spacing:.12em;text-transform:uppercase;
        color:#f4ece0;text-shadow:0 2px 14px rgba(0,0,0,.85);}
      #lv2-intro .caption p{margin:6px 0 0;font-size:clamp(14px,1.7vw,18px);color:#e6dccd;text-shadow:0 1px 8px rgba(0,0,0,.9);}
      #lv2-intro .caption.go h2{font-size:clamp(44px,8vw,84px);color:#ffd08a;}
      #lv2-intro .skip{position:absolute;right:16px;bottom:calc(9vh + 12px);font-size:12px;letter-spacing:.14em;
        text-transform:uppercase;color:rgba(255,255,255,.55);}
      #lv2-intro .mark{position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;
        opacity:0;transition:opacity .25s;white-space:nowrap;}
      #lv2-intro .mark.on{opacity:1;}
      #lv2-intro .mark span{padding:3px 8px;border-radius:3px;background:rgba(10,10,10,.78);color:#fff;font-size:13px;
        letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--c);}
      #lv2-intro .mark i{width:2px;height:18px;background:var(--c);}
      #lv2-intro .mark b{width:10px;height:10px;border-radius:50%;background:var(--c);box-shadow:0 0 10px var(--c);}
    `;
    document.head.appendChild(style);
  }
  const root = document.createElement('div');
  root.id = 'lv2-intro';
  root.innerHTML = `<div class="bar top"></div><div class="bar bottom"></div>
    <div class="caption"><h2></h2><p></p></div>
    <div class="skip">Press any key to skip</div>`;
  const marks = markers.map((m) => {
    const d = document.createElement('div');
    d.className = 'mark';
    d.style.setProperty('--c', m.color);
    d.innerHTML = `<span>${m.label}</span><i></i><b></b>`;
    root.appendChild(d);
    return d;
  });
  document.body.appendChild(root);
  return { root, caption: root.querySelector('.caption'), marks };
}

function setCaption(el, shot) {
  const c = el.caption;
  c.classList.remove('on');
  c.classList.toggle('go', shot.title === 'GO');
  c.querySelector('h2').textContent = shot.title;
  c.querySelector('p').textContent = shot.sub || '';
  void c.offsetWidth; // restart the fade-in
  c.classList.add('on');
}

const _v = new THREE.Vector3();
function placeMarkers({ el, markers }, on) {
  markers.forEach((m, i) => {
    const d = el.marks[i];
    d.classList.toggle('on', on);
    if (!on) return;
    _v.copy(m.pos).project(camera);
    d.style.left = `${(_v.x * 0.5 + 0.5) * 100}%`;
    d.style.top = `${(-_v.y * 0.5 + 0.5) * 100}%`;
  });
}
