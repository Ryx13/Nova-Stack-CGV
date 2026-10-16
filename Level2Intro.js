/* ======================================================================
   Level2Intro.js — THE FLY-THROUGH BRIEFING BEFORE THE CHASE

   Same shape as Level 1's intro (Level1Intro.js): the camera flies to a
   handful of poses, each with a caption, a label pinned on the thing it
   is talking about and, where it matters, the keys to press:

     1  The girl        — the target · E to catch her
     2  The street      — movement keys
     3  Fight back      — fighting keys
     4  Radar machine   — front view · E to buy
     5  Adrenaline      — from the main road down the side street to its
                          front · E to buy, G to use
     6  The port        — where she is running to
     7  GO

   While it plays state.cinematic freezes the gameplay gate in Actions.js
   (no movement, zombies, spawns or run clock) and Level 2's own ticks
   hold the chase. Any key or click skips it; a click also falls through
   to the canvas so it captures the mouse, ready to aim.
====================================================================== */
import * as THREE from 'three';
import { camera, forwardFromYaw, rightFromYaw } from './Scene.js';
import { VendingMachine } from './VendingMachine.js';
import { state } from './state.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Straight-on view of a machine's glass front, from the street side.
// The cabinet front faces local +Z, so its world facing follows rotation.y.
function machineFront(machine) {
  const at = machine.root.position;
  const ry = machine.root.rotation.y;
  const facing = V(Math.sin(ry), 0, Math.cos(ry));
  const look = at.clone().add(V(0, VendingMachine.HEIGHT * 0.55, 0));
  return {
    pos: at.clone().addScaledVector(facing, 4.6).add(V(0, VendingMachine.HEIGHT * 0.7, 0)),
    look,
    markAt: at.clone().add(V(0, VendingMachine.HEIGHT + 0.45, 0)),
  };
}

/* Shot list. Each shot flies to `pos`/`look` over `move` s, then holds for
   `hold` s with its caption up. `lift` arcs the flight up by that fraction
   of the distance travelled (keeps long flights above the rooftops).
   `tag` is the small line above the title, `keys` the key chips, and
   `mark` { at, text } a label pinned on a world point. */
function buildShots({ girlPos, girlFacing, portPos, playerPos, playerPose, machines, prices }) {
  const fwd = forwardFromYaw(state.yaw), right = rightFromYaw(state.yaw);
  const girlEye = girlPos.clone().add(V(0, 1.25, 0));
  const girlCam = girlPos.clone().addScaledVector(girlFacing, 3.1).add(V(0.9, 1.5, 0));
  const playerEye = playerPos.clone().add(V(0, 0.9, 0));
  const playerSide = playerPos.clone().addScaledVector(right, 3.2).addScaledVector(fwd, 1.6).add(V(0, 1.4, 0));
  const streetLook = playerPos.clone().addScaledVector(fwd, 70).setY(2);
  const radar = machineFront(machines.radar);
  const adren = machineFront(machines.adrenaline);
  const portLook = portPos.clone().add(V(0, 1.5, 0));
  // Main road, just past the side street's mouth, looking down it at the machine
  const adrenRoad = V(4, 4, machines.adrenaline.root.position.z + 3);
  const adrenCaption = {
    tag: '05 · Supplies',
    title: 'Adrenaline machine',
    sub: `Off the main road, down the side street to the west, glowing pink. A shot costs ${prices.adrenaline} coins and gives a 3 second burst of speed. Buy as many as you can afford.`,
    keys: [['E', 'Buy'], ['G', 'Use adrenaline']],
    mark: { at: adren.markAt, text: 'ADRENALINE' },
  };

  return [
    {
      pos: girlCam, look: girlEye, move: 1.3, hold: 3.4,
      tag: '01 · The target',
      title: 'This is the girl',
      sub: 'She has the antidote. Catch her before she escapes: get right next to her and press E.',
      keys: [['E', 'Catch her']],
      mark: { at: girlPos.clone().add(V(0, 2.3, 0)), text: 'GIRL' },
    },
    {
      pos: playerPos.clone().addScaledVector(fwd, -14).add(V(-3.5, 9, 0)), look: streetLook, move: 1.7, hold: 3.6, lift: 0.1,
      tag: '02 · The street',
      title: 'Chase her down',
      sub: 'She runs ahead through the town. Keep her in sight and close the gap.',
      keys: [['W A S D', 'Move'], ['Mouse', 'Look'], ['Shift + W', 'Sprint'], ['Space', 'Jump'], ['C', 'Crouch']],
    },
    {
      pos: playerSide, look: playerEye, move: 1.5, hold: 4.6, lift: 0.08,
      tag: '03 · The infected',
      title: 'Fight your way through',
      sub: "The small ones are much faster than you. You can't outrun them, so keep fighting. Push ahead and they'll be waiting for you. Kills drop coins, and coins buy supplies.",
      keys: [['Left click', 'Shoot'], ['Right click', 'Melee'], ['R', 'Reload'], ['Q', 'Gun / Knife']],
      mark: { at: playerPos.clone().add(V(0, 2.25, 0)), text: 'YOU' },
    },
    {
      pos: radar.pos, look: radar.look, move: 1.7, hold: 3.6, lift: 0.12,
      tag: '04 · Supplies',
      title: 'Radar machine',
      sub: `Just up the road on the west side, glowing lime. A radar costs ${prices.radar} coins and tracks her on your radar and compass.`,
      keys: [['E', 'Buy (stand at the machine)']],
      mark: { at: radar.markAt, text: 'RADAR' },
    },
    {
      // From the main road at the side street's mouth, so the player sees
      // the turn-off itself; the next shot glides down it to the machine
      pos: adrenRoad, look: adren.look, move: 2.0, hold: 1.4, lift: 0.14,
      ...adrenCaption,
    },
    {
      // Low glide down the side street (no lift: stays under the rooftops)
      pos: adren.pos, look: adren.look, move: 2.4, hold: 3.0,
      ...adrenCaption, keepCaption: true,
    },
    {
      pos: portPos.clone().add(V(9, 7, 13)), look: portLook, move: 2.0, hold: 3.4, lift: 0.14,
      tag: '06 · The port',
      title: 'Her escape',
      sub: "Her boat is waiting at the pier. If she reaches it, she's gone.",
      mark: { at: portPos.clone().add(V(0, 3.4, 0)), text: 'PORT' },
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

/** Freezes gameplay until play() runs and finishes. Call at level build. */
export function holdForIntro() {
  state.cinematic = true;
  document.body.classList.add('lv2-intro');
}

/** Starts the fly-through. `onDone` runs once, when it ends or is skipped. */
export function playIntro({ girlPos, girlFacing, portPos, playerPos, machines, prices, onDone }) {
  const playerPose = playerCameraPose(playerPos);
  const shots = buildShots({ girlPos, girlFacing, portPos, playerPos, playerPose, machines, prices });
  // Opening frame: wide behind and above the player, looking at her
  const start = { pos: playerPos.clone().add(V(2.5, 7, 12)), look: girlPos.clone().setY(1.2) };
  let t = 0;
  const keys = [];
  for (const s of shots) {
    keys.push({ ...s, t0: t, t1: t + s.move, t2: t + s.move + s.hold, quat: poseQuat(s.pos, s.look) });
    t += s.move + s.hold;
  }
  const el = buildOverlay();
  intro = { t: 0, keys, from: { pos: start.pos, quat: poseQuat(start.pos, start.look) }, el, shown: -1, onDone };
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
    if (!keys[showing].keepCaption) setCaption(intro.el, keys[showing]);
  }
  placeMark(intro.el, intro.shown >= 0 ? keys[intro.shown].mark : null);
  if (intro.t >= keys[keys.length - 1].t2) endIntro();
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
  intro.el.root.remove();
  const done = intro.onDone;
  intro = null;
  state.cinematic = false;
  document.body.classList.remove('lv2-intro');
  if (done) done();
}

/* --- Overlay: letterbox, caption, key chips, world label, skip hint ---- */
function buildOverlay() {
  if (!document.getElementById('lv2-intro-style')) {
    const style = document.createElement('style');
    style.id = 'lv2-intro-style';
    style.textContent = `
      body.lv2-intro #hud{visibility:hidden;}
      #lv2-intro{position:fixed;inset:0;z-index:40;pointer-events:none;font-family:inherit;overflow:hidden;}
      #lv2-intro .bar{position:absolute;left:0;right:0;height:9vh;background:#000;}
      #lv2-intro .bar.top{top:0;} #lv2-intro .bar.bottom{bottom:0;}
      #lv2-intro .caption{position:absolute;left:0;right:0;bottom:12vh;text-align:center;padding:0 16px;
        opacity:0;transform:translateY(8px);transition:opacity .3s,transform .3s;}
      #lv2-intro .caption.on{opacity:1;transform:none;}
      #lv2-intro .caption .tag{margin:0 0 6px;font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:#e0a83c;text-shadow:0 1px 8px rgba(0,0,0,.9);}
      #lv2-intro .caption h2{margin:0;font-size:clamp(26px,4.4vw,46px);letter-spacing:.12em;text-transform:uppercase;
        color:#f4ece0;text-shadow:0 2px 14px rgba(0,0,0,.85);}
      #lv2-intro .caption p.sub{margin:6px auto 0;max-width:min(760px,92vw);font-size:clamp(14px,1.7vw,18px);line-height:1.45;color:#e6dccd;text-shadow:0 1px 8px rgba(0,0,0,.9);}
      #lv2-intro .keys{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 10px;margin-top:12px;}
      #lv2-intro .keys:empty{display:none;}
      #lv2-intro .keys span{display:inline-flex;align-items:center;gap:8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;
        color:#e6dccd;text-shadow:0 1px 6px rgba(0,0,0,.9);}
      #lv2-intro .keys kbd{font-weight:600;font-size:12px;line-height:1;font-family:inherit;padding:7px 10px;border:1px solid #e0a83c99;border-bottom-width:3px;
        background:rgba(14,18,22,.82);color:#ffe9c2;letter-spacing:.12em;border-radius:3px;}
      #lv2-intro .caption.go h2{font-size:clamp(44px,8vw,84px);color:#ffd08a;}
      #lv2-intro .mark{position:absolute;left:0;top:0;opacity:0;transition:opacity .25s;will-change:transform;}
      #lv2-intro .mark.on{opacity:1;}
      #lv2-intro .mark:before{content:'';position:absolute;left:-7px;top:-7px;width:14px;height:14px;transform:rotate(45deg);
        border:2px solid #ffd08a;background:rgba(224,168,60,.35);box-shadow:0 0 12px rgba(255,208,138,.7);}
      #lv2-intro .mark span{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);white-space:nowrap;
        font-size:12px;letter-spacing:.22em;font-weight:600;color:#ffe9c2;padding:4px 9px;background:rgba(14,18,22,.8);
        border:1px solid #e0a83c99;}
      #lv2-intro .skip{position:absolute;right:16px;top:calc(9vh + 12px);font-size:12px;letter-spacing:.14em;
        text-transform:uppercase;color:rgba(255,255,255,.55);}
      @media(max-height:560px){#lv2-intro .caption{bottom:10.5vh}#lv2-intro .caption p.sub{font-size:13px}}
    `;
    document.head.appendChild(style);
  }
  const root = document.createElement('div');
  root.id = 'lv2-intro';
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
