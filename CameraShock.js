import * as THREE from 'three';
import { camera } from './Scene.js';

/* ---------------------------------------------------------------------
   CAMERA SHOCK — an explosion's pressure wave on the view: a shove away
   from the blast that springs back, a smooth rumble dying away, a little
   roll and pitch, and the field of view punching wider for a moment, all
   scaled by how close the blast was. And an earthquake's rumble
   (cameraQuake): building, holding and dying away over a few seconds.
   Applied only for the draw: Actions.js
   calls applyCameraShock just before rendering and restoreCameraShock
   straight after, so aiming, the camera's own easing and gameplay never
   see the offset.
--------------------------------------------------------------------- */

const DURATION = 1.1;         // s for a shock to die away
const FULL_AT = 3, NONE_AT = 30; // m: full force this close, nothing past this
const SHOVE_M = 0.28, RUMBLE_M = 0.1, ROLL = 0.06, PITCH = 0.035, FOV_PUNCH = 7;

let amp = 0, t = DURATION, applied = false, savedFov = 0;
let quakeT = -1, quakeLen = 0, quakeAmp = 0;
const away = new THREE.Vector3(), savedPos = new THREE.Vector3(), savedQuat = new THREE.Quaternion();
const _x = new THREE.Vector3(1, 0, 0), _z = new THREE.Vector3(0, 0, 1);

/** How hard a blast at `from` hits the view (0..1); starts a shock if it's
    stronger than what's still going. Returns the strength, for the caller's
    own effects (the plain jitter). */
export function cameraShock(from, strength = 1) {
  const d = camera.position.distanceTo(from);
  const k = strength * Math.pow(THREE.MathUtils.clamp(1 - (d - FULL_AT) / (NONE_AT - FULL_AT), 0, 1), 1.5);
  if (k < 0.02) return 0;
  const left = t < DURATION ? amp * (1 - t / DURATION) : 0;
  if (k > left) {
    amp = k;
    t = 0;
    away.subVectors(camera.position, from).setY(0);
    if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
    away.normalize();
  }
  return k;
}

/** An earthquake: the ground rumbling under the view for `seconds`. */
export function cameraQuake(seconds, strength = 1) {
  quakeT = 0;
  quakeLen = seconds;
  quakeAmp = strength;
}

// The quake's own sway: in from nothing, held, out again
function applyQuake(dt) {
  quakeT += dt;
  if (quakeT >= quakeLen) { quakeT = -1; return; }
  const k = quakeAmp * THREE.MathUtils.smoothstep(quakeT, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(quakeT, quakeLen * 0.7, quakeLen));
  camera.position.x += k * 0.14 * (Math.sin(quakeT * 17) + 0.7 * Math.sin(quakeT * 29 + 1.2));
  camera.position.y += k * 0.1 * (Math.sin(quakeT * 21 + 0.5) + 0.6 * Math.sin(quakeT * 33));
  camera.rotateOnAxis(_z, k * 0.035 * Math.sin(quakeT * 13));
  camera.rotateOnAxis(_x, k * 0.022 * Math.sin(quakeT * 19 + 0.8));
}

/** Just before the frame is drawn. */
export function applyCameraShock(dt) {
  const shocking = t < DURATION, quaking = quakeT >= 0;
  if (!shocking && !quaking) return;
  savedPos.copy(camera.position);
  savedQuat.copy(camera.quaternion);
  savedFov = camera.fov;
  applied = true;
  if (quaking) applyQuake(dt);
  if (!shocking) return;
  t += dt;
  const f = Math.max(0, 1 - t / DURATION);
  // The shove: out along the blast's direction, springing back past centre
  const shove = amp * SHOVE_M * Math.exp(-7 * t) * Math.cos(13 * t);
  // The rumble: a few sines out of step, smooth rather than jittery
  const fall = amp * Math.exp(-3.2 * t);
  camera.position.addScaledVector(away, shove);
  camera.position.x += fall * RUMBLE_M * (Math.sin(t * 23) + 0.6 * Math.sin(t * 37 + 1.3));
  camera.position.y += fall * RUMBLE_M * (Math.sin(t * 29 + 0.7) + 0.5 * Math.sin(t * 43 + 2.1));
  camera.rotateOnAxis(_z, fall * ROLL * Math.sin(t * 19));
  camera.rotateOnAxis(_x, fall * PITCH * Math.sin(t * 27 + 0.4) - amp * PITCH * Math.exp(-9 * t));
  camera.fov = savedFov + amp * FOV_PUNCH * Math.exp(-6 * t) * (1 - Math.exp(-40 * t)) * f;
  camera.updateProjectionMatrix();
}

/** Straight after the frame is drawn: the camera back exactly as it was. */
export function restoreCameraShock() {
  if (!applied) return;
  applied = false;
  camera.position.copy(savedPos);
  camera.quaternion.copy(savedQuat);
  camera.fov = savedFov;
  camera.updateProjectionMatrix();
}
