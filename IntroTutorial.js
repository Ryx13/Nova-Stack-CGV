// IntroTutorial.js — a self-contained Three.js safe-room tutorial.
// No Scene/state/Actions imports: it is intentionally not a game level.
//
// Fixes applied:
//   3. The desk is now a real barrier: movement is tested against its
//      footprint (with a small player-radius buffer) and resolved per-axis,
//      so you can no longer walk straight through it to the pistol/door.
//   4. The look-direction math was wrong (it added an unscaled vertical
//      offset to a yaw-only forward vector, which "skewed" the view instead
//      of properly combining yaw and pitch). It's replaced with a standard
//      FPS camera rotation (Euler order 'YXZ'), which is the mathematically
//      correct way to combine the two and matches this file's own
//      sin(yaw)/cos(yaw) movement convention.
import * as THREE from 'three';

let active = null;

function makePanel() {
  const el = document.createElement('div');
  el.id = 'safe-room-ui';
  el.innerHTML = `<style>
    #safe-room-ui{position:fixed;inset:0;z-index:25;pointer-events:none;color:#eee;font-family:Rajdhani,sans-serif} #safe-room-ui .tag{position:absolute;top:22px;left:22px;letter-spacing:3px;font:700 12px Oswald,sans-serif;color:#bff0ff} #safe-room-ui .objective{position:absolute;top:48px;left:22px;max-width:390px;background:rgba(3,8,10,.76);border:1px solid rgba(191,240,255,.35);padding:10px 14px;letter-spacing:1px} #safe-room-ui .sub{position:absolute;left:50%;bottom:11%;transform:translateX(-50%);width:min(720px,88vw);text-align:center;font-size:19px;line-height:1.4;text-shadow:0 2px 7px #000} #safe-room-ui .hint{position:absolute;left:50%;bottom:42px;transform:translateX(-50%);padding:9px 15px;background:rgba(3,8,10,.8);border:1px solid rgba(255,255,255,.2);letter-spacing:1px} #safe-room-ui .hint.hidden{display:none}
  </style><div class="tag">OPENING / SAFE ROOM</div><div class="objective"></div><div class="sub"></div><div class="hint">WASD — move &nbsp; • &nbsp; Mouse — look</div>`;
  document.body.appendChild(el);
  return { root: el, objective: el.querySelector('.objective'), sub: el.querySelector('.sub'), hint: el.querySelector('.hint') };
}

function box(scene, x, y, z, sx, sy, sz, color, emissive = 0) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .15, emissive: color, emissiveIntensity: emissive });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh); return mesh;
}

export function startSafeRoomTutorial({ onComplete }) {
  if (active) active.dispose();
  const canvas = document.getElementById('game-canvas');
  const ui = makePanel();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x071015); scene.fog = new THREE.Fog(0x071015, 8, 28);
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, .05, 100); camera.position.set(0, 1.65, 5.5);
  camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight(0x91c7d4, 0x101012, 1.4));
  const lamp = new THREE.PointLight(0xbff0ff, 28, 18, 2); lamp.position.set(0, 5.4, 0); lamp.castShadow = true; scene.add(lamp);
  const alarm = new THREE.PointLight(0xff4b38, 8, 9, 2); alarm.position.set(-5, 2.8, -4); scene.add(alarm);
  // Room shell; the northern wall is split around the locked blast door.
  box(scene, 0, -.15, 0, 14, .3, 14, 0x182026); box(scene, 0, 3.5, 0, 14, .2, 14, 0x11171b);
  box(scene, -7, 1.75, 0, .25, 3.5, 14, 0x1d282f); box(scene, 7, 1.75, 0, .25, 3.5, 14, 0x1d282f); box(scene, 0, 1.75, 7, 14, 3.5, .25, 0x1d282f);
  box(scene, -4.8, 1.75, -7, 4.2, 3.5, .25, 0x1d282f); box(scene, 4.8, 1.75, -7, 4.2, 3.5, .25, 0x1d282f);
  const blastDoor = box(scene, 0, 1.75, -7, 3.6, 3.5, .32, 0x3f555e); blastDoor.userData.openY = 5.6;
  // Desk and unmistakable cyan pistol pickup.
  box(scene, 0, .85, .2, 3.3, 1.5, 1.4, 0x42372e); box(scene, 0, 1.65, .2, 3.5, .15, 1.55, 0x67594b);
  const pistol = new THREE.Group(); pistol.position.set(0, 1.9, .15); pistol.add(box(pistol, 0, 0, 0, .72, .19, .28, 0xbff0ff, .55)); pistol.add(box(pistol, -.16, -.23, .02, .22, .4, .18, 0x9fcbd6, .25)); scene.add(pistol);
  // Dr. James: procedural silhouette behind reinforced glass.
  const glass = box(scene, -4.7, 1.7, -2.5, .08, 3, 3.4, 0x7fc8df); glass.material.transparent = true; glass.material.opacity = .2;
  const scientist = new THREE.Group(); scientist.position.set(-5.35, 0, -2.5); scientist.add(box(scientist, 0, 1.1, 0, .62, 1.65, .45, 0xe5e9e7)); const head = new THREE.Mesh(new THREE.SphereGeometry(.32, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd6a57e })); head.position.y = 2.05; scientist.add(head); scene.add(scientist);

  // Desk collision footprint (the desk legs/body at (0,.85,.2) 3.3x1.5x1.4,
  // plus the slightly wider desktop at (0,1.65,.2) 3.5x.15x1.55), padded by
  // a player radius so you can't clip the corners either.
  const PLAYER_R = 0.4;
  const DESK_MIN_X = -1.75 - PLAYER_R, DESK_MAX_X = 1.75 + PLAYER_R;
  const DESK_MIN_Z = 0.2 - 0.775 - PLAYER_R, DESK_MAX_Z = 0.2 + 0.775 + PLAYER_R;
  function insideDesk(x, z) { return x > DESK_MIN_X && x < DESK_MAX_X && z > DESK_MIN_Z && z < DESK_MAX_Z; }

  const keys = {}; let yaw = Math.PI, pitch = 0, phase = 'weapon', raf = 0, last = performance.now(), done = false;
  ui.objective.innerHTML = 'Objective: <b>Collect the sidearm</b> from the desk.';
  ui.sub.textContent = 'DR. JAMES: The city is lost without that culture sample. Learn the controls here, then choose your deployment.';
  const keydown = (e) => { keys[e.code] = true; if (e.code === 'KeyE') interact(); };
  const keyup = (e) => { keys[e.code] = false; };
  const mousemove = (e) => { if (document.pointerLockElement === canvas) { yaw -= e.movementX * .0025; pitch = THREE.MathUtils.clamp(pitch - e.movementY * .002, -1.1, 1.1); } };
  const lock = () => canvas.requestPointerLock();
  addEventListener('keydown', keydown); addEventListener('keyup', keyup); addEventListener('mousemove', mousemove); canvas.addEventListener('click', lock);
  function interact() { if (phase !== 'weapon' || camera.position.distanceTo(pistol.position) > 2.25) return; phase = 'exit'; pistol.visible = false; ui.objective.innerHTML = 'Objective: <b>Exit through the blast door.</b>'; ui.sub.textContent = 'DR. JAMES: Shoot to stabilize them. Keep moving, and find the culture sample.'; ui.hint.textContent = 'The blast door is open — walk forward to leave the safe room.'; }
  function finish() { if (done) return; done = true; document.exitPointerLock(); dispose(); const card = document.createElement('div'); card.className = 'end-screen'; card.style.zIndex = 91; card.innerHTML = '<h1 class="end-title" style="color:#bff0ff">TUTORIAL COMPLETE</h1><div class="end-sub">Safe-room controls learned. Choose a level when you are ready.</div><button>Choose a level</button>'; document.body.appendChild(card); card.querySelector('button').onclick = () => { card.remove(); onComplete?.(); }; }
  function tick(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const left = new THREE.Vector3(forward.z, 0, -forward.x);
    const move = new THREE.Vector3();
    if (keys.KeyW) move.add(forward); if (keys.KeyS) move.sub(forward);
    if (keys.KeyA) move.add(left); if (keys.KeyD) move.sub(left);
    if (move.lengthSq()) {
      move.normalize();
      const step = dt * 3.3;
      // Resolve X and Z separately against the desk + room bounds so the
      // player slides along the desk instead of stopping dead or clipping
      // through it diagonally.
      const nx = THREE.MathUtils.clamp(camera.position.x + move.x * step, -6.35, 6.35);
      if (!insideDesk(nx, camera.position.z)) camera.position.x = nx;
      const nz = THREE.MathUtils.clamp(camera.position.z + move.z * step, -6.35, 6.35);
      if (!insideDesk(camera.position.x, nz)) camera.position.z = nz;
    }
    if (phase === 'weapon') { pistol.rotation.y += dt * 2; pistol.position.y = 1.9 + Math.sin(now * .004) * .08; const near = camera.position.distanceTo(pistol.position) < 2.25; ui.hint.classList.remove('hidden'); ui.hint.textContent = near ? 'Press E — collect the sidearm' : 'WASD — move  •  Mouse — look  •  Follow the glowing sidearm'; } else { blastDoor.position.y = THREE.MathUtils.lerp(blastDoor.position.y, blastDoor.userData.openY, dt * 2); if (camera.position.z < -6.0) return finish(); }
    // Proper yaw+pitch camera orientation (Euler order 'YXZ'); +Math.PI keeps
    // this in sync with the sin(yaw)/cos(yaw) forward vector used for movement.
    camera.rotation.set(pitch, yaw + Math.PI, 0);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
  addEventListener('resize', resize); function dispose() { cancelAnimationFrame(raf); removeEventListener('keydown', keydown); removeEventListener('keyup', keyup); removeEventListener('mousemove', mousemove); removeEventListener('resize', resize); canvas.removeEventListener('click', lock); ui.root.remove(); renderer.dispose(); active = null; }
  active = { dispose }; raf = requestAnimationFrame(tick);
  return active;
}
