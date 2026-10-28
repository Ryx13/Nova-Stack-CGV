import { renderer } from './Scene.js';
import { gfx, rememberProfile } from './GraphicsProfile.js';

/* ---------------------------------------------------------------------
   RENDER SCALE — how many pixels a frame draws. The pixel ratio is
   capped at MAX_PIXEL_RATIO: on a 2x screen that's 44% fewer pixels to
   shade, at a sharpness the MSAA edges barely show. If frames are still
   slow, it steps down toward MIN_PIXEL_RATIO, then back up once there's
   room. Decisions use the median frame of a window, so one hitch (a
   shader compiling, a level loading) never changes the resolution.
--------------------------------------------------------------------- */

export const MAX_PIXEL_RATIO = 1.5;
const MIN_PIXEL_RATIO = gfx.low ? 0.6 : 0.8; // a weak GPU may go further down
const STEP = 0.1;
const SLOW_MS = 20;        // median frame above this (under 50 fps): step down
const SMOOTH_MS = 17.5;    // ...below this (at a 60 Hz display's rate): room to step up
const WINDOW_S = 2;        // s of frames per decision
const UP_AFTER_S = 6;      // smooth this long before trying a step up
const HOLD_AFTER_FAIL_S = 30; // a step up that turned slow isn't retried for this long
// Learning the profile for next time (GraphicsProfile.js): low that runs
// smooth at full resolution this long moves up; high stuck slow at the
// lowest resolution this long moves down
const LEARN_UP_S = 60, LEARN_DOWN_S = 20;

export const nativePixelRatio = () => Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

let ratio = 0, last = 0, windowTime = 0, smoothTime = 0, holdTime = 0, raisedTo = 0, learnTime = 0, learned = '';
const frames = [];

function setRatio(r) {
  ratio = Math.round(r * 100) / 100;
  renderer.setPixelRatio(ratio);
}

/** Every animation frame. */
export function updateRenderScale() {
  const now = performance.now();
  if (!ratio) setRatio(nativePixelRatio());
  const top = nativePixelRatio(); // the window may have moved to another screen
  if (ratio > top) setRatio(top);
  const interval = last ? now - last : 0;
  last = now;
  // A hidden tab or a long stall (loading, alt-tab) says nothing about the scene
  if (document.hidden || !interval || interval > 250) return;
  frames.push(interval);
  windowTime += interval / 1000;
  holdTime = Math.max(0, holdTime - interval / 1000);
  if (windowTime < WINDOW_S) return;
  frames.sort((a, b) => a - b);
  const median = frames[frames.length >> 1];
  frames.length = 0;
  windowTime = 0;
  const floor = Math.min(MIN_PIXEL_RATIO, top);
  learnProfile(median, top, floor);
  if (median > SLOW_MS) {
    smoothTime = 0;
    if (raisedTo && ratio === raisedTo) holdTime = HOLD_AFTER_FAIL_S; // the last step up didn't fit
    raisedTo = 0;
    if (ratio > floor) setRatio(Math.max(floor, ratio - STEP));
  } else if (median < SMOOTH_MS) {
    smoothTime += WINDOW_S;
    if (ratio < top && smoothTime >= UP_AFTER_S && holdTime === 0) {
      setRatio(Math.min(top, ratio + STEP));
      raisedTo = ratio;
      smoothTime = 0;
    }
  } else smoothTime = 0;
}

function learnProfile(median, top, floor) {
  if (gfx.forced || learned) return;
  const roomy = gfx.low && ratio >= top && median < SMOOTH_MS;
  const stuck = !gfx.low && ratio <= floor && median > SLOW_MS;
  learnTime = roomy || stuck ? learnTime + WINDOW_S : 0;
  if (roomy && learnTime >= LEARN_UP_S) { learned = 'high'; rememberProfile('high'); }
  else if (stuck && learnTime >= LEARN_DOWN_S) { learned = 'low'; rememberProfile('low'); }
}

/** For the perf readout. */
export function renderScaleInfo() {
  return { ratio: ratio || renderer.getPixelRatio(), top: nativePixelRatio(), device: window.devicePixelRatio || 1, learned };
}
