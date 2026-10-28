import * as THREE from 'three';
import { renderer, scene, camera } from './Scene.js';
import { state } from './state.js';
import { renderScaleInfo } from './RenderScale.js';

/* ---------------------------------------------------------------------
   PERF READOUT — F3 shows it, Shift+F3 copies it to the clipboard.
   What a frame costs and where: frame rate and hitches, CPU time split
   into game logic and render submission, GPU time (WebGL timer queries,
   where the browser offers them), draw calls and triangles for the whole
   frame including shadow passes, render resolution, lights and shadow
   casters, meshes by kind, infected, memory, and a one-line guess at the
   bottleneck. Off, it costs nothing: every hook returns straight away.
--------------------------------------------------------------------- */

const REFRESH = 0.5;     // s between readout updates (averages over this)
const HITCH_MS = 50;     // a frame this long is a visible hitch
const HITCH_WINDOW = 10; // s of hitches counted
const NEAR_ZOMBIE = 35;  // m: infected this close count as "near"

let on = false, el = null;
let gl = null, timer = null, openQuery = null;
const pending = [], spare = [];
let frameStart = 0, renderStart = 0, lastStart = 0, sinceRefresh = 0;
const acc = { n: 0, interval: 0, worst: 0, logic: 0, submit: 0, gpu: 0, gpuN: 0, calls: 0, tris: 0 };
const hitches = [];
const _size = new THREE.Vector2();

function resetAcc() { for (const k in acc) acc[k] = 0; }

function build() {
  el = document.createElement('pre');
  el.id = 'perf-hud';
  el.style.cssText = 'position:fixed;top:8px;right:8px;z-index:9999;margin:0;padding:8px 10px;'
    + 'background:rgba(6,8,10,.78);color:#d8e0e4;font:11px/1.45 ui-monospace,Consolas,monospace;'
    + 'border:1px solid rgba(255,255,255,.12);border-radius:4px;pointer-events:none;white-space:pre;';
  el.hidden = true;
  el.textContent = 'Perf readout: measuring…';
  document.body.appendChild(el);
  gl = renderer.getContext();
  timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
}

function setOn(v) {
  if (!el) build();
  on = v;
  el.hidden = !v;
  // Counted across every render call in a frame (shadows, viewmodels,
  // reflection probes), so the renderer mustn't zero them per call
  renderer.info.autoReset = !v;
  if (!v && openQuery) { gl.endQuery(timer.TIME_ELAPSED_EXT); spare.push(openQuery); openQuery = null; }
  lastStart = 0;
  sinceRefresh = 0;
  resetAcc();
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'F3') return;
  e.preventDefault(); // the browser's find bar
  if (e.repeat) return;
  if (e.shiftKey) {
    if (!on) setOn(true);
    try { navigator.clipboard?.writeText(el.textContent); } catch { /* not allowed here: read it off the screen */ }
    return;
  }
  setOn(!on);
});

// GPU timing: a query round the main view + viewmodels, read back a few
// frames later when the GPU has finished with it
function endGpu() {
  if (!openQuery) return;
  gl.endQuery(timer.TIME_ELAPSED_EXT);
  pending.push(openQuery);
  openQuery = null;
}
function pollGpu() {
  const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
  while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
    const q = pending.shift();
    if (!disjoint) { acc.gpu += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; acc.gpuN++; }
    spare.push(q);
  }
  while (pending.length > 8) gl.deleteQuery(pending.shift()); // never let a stall pile them up
}

/** Top of each animation frame. */
export function perfFrameStart() {
  if (!on) return;
  const now = performance.now();
  if (lastStart) {
    const interval = now - lastStart;
    acc.n++;
    acc.interval += interval;
    acc.worst = Math.max(acc.worst, interval);
    if (interval > HITCH_MS) hitches.push(now);
    sinceRefresh += interval / 1000;
  }
  lastStart = frameStart = renderStart = now;
  renderer.info.reset();
}

/** Just before the main view is drawn: logic ends, rendering begins. */
export function perfRenderStart() {
  if (!on) return;
  renderStart = performance.now();
  if (timer && !openQuery) {
    openQuery = spare.pop() || gl.createQuery();
    gl.beginQuery(timer.TIME_ELAPSED_EXT, openQuery);
  }
}

/** After the last draw of the frame. */
export function perfFrameEnd() {
  if (!on) return;
  const now = performance.now();
  acc.logic += renderStart - frameStart;
  acc.submit += now - renderStart;
  acc.calls += renderer.info.render.calls;
  acc.tris += renderer.info.render.triangles;
  if (timer) { endGpu(); pollGpu(); }
  if (sinceRefresh >= REFRESH && acc.n) { el.textContent = readout(); sinceRefresh = 0; resetAcc(); }
}

// What's in the scene right now (only what's drawn: invisible lights aren't uploaded)
function census() {
  const c = { meshes: 0, instanced: 0, instances: 0, skinned: 0, point: 0, spot: 0, dir: 0, shadowLights: 0, shadowPasses: 0, casters: 0 };
  scene.traverseVisible((o) => {
    if (o.isLight) {
      if (o.isPointLight) c.point++; else if (o.isSpotLight) c.spot++; else if (o.isDirectionalLight) c.dir++;
      if (o.castShadow && o.intensity > 0) { c.shadowLights++; c.shadowPasses += o.isPointLight ? 6 : 1; }
      return;
    }
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) c.skinned++;
    else if (o.isInstancedMesh) { c.instanced++; c.instances += o.count; }
    else c.meshes++;
    if (o.castShadow) c.casters++;
  });
  return c;
}

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);

function readout() {
  const n = acc.n, now = performance.now();
  while (hitches.length && now - hitches[0] > HITCH_WINDOW * 1000) hitches.shift();
  const frame = acc.interval / n, logic = acc.logic / n, submit = acc.submit / n, cpu = logic + submit;
  const gpu = acc.gpuN ? acc.gpu / acc.gpuN : null;
  const c = census();
  renderer.getDrawingBufferSize(_size);
  const rs = renderScaleInfo();
  const alive = state.zombies.filter((z) => z.alive);
  const near = alive.filter((z) => z.mesh.position.distanceTo(camera.position) < NEAR_ZOMBIE).length;
  const mem = renderer.info.memory, heap = performance.memory?.usedJSHeapSize;

  // The guess: at the display's rate nothing's wrong; otherwise whichever
  // side, CPU or GPU, takes longer is what holds the frame back
  let verdict;
  if (frame < 17.5 && hitches.length === 0) verdict = 'Smooth: holding the display rate';
  else if (frame < 17.5) verdict = 'Smooth, but hitching: look at what happens on those moments';
  else if (gpu !== null && gpu > cpu) verdict = 'GPU-bound: pixels, shadows, overdraw';
  else if (gpu === null && cpu < frame * 0.6) verdict = 'Probably GPU-bound (no GPU timer in this browser)';
  else verdict = submit > logic ? 'CPU-bound: draw calls / scene submission' : 'CPU-bound: game logic (JS)';

  return [
    `FPS ${(1000 / frame).toFixed(0).padStart(3)}   frame ${frame.toFixed(1)} ms   worst ${acc.worst.toFixed(1)}   hitches/${HITCH_WINDOW}s ${hitches.length}`,
    `CPU ${cpu.toFixed(1)} ms   logic ${logic.toFixed(1)} · render submit ${submit.toFixed(1)}`,
    `GPU ${gpu === null ? 'n/a (no timer query)' : `${gpu.toFixed(1)} ms   main view + viewmodels`}`,
    `Draws ${Math.round(acc.calls / n)}   tris ${k(acc.tris / n)}   programs ${renderer.info.programs?.length ?? '?'}`,
    `Pixels ${_size.x}×${_size.y} @${rs.ratio.toFixed(2)} = ${(_size.x * _size.y / 1e6).toFixed(1)} MP   (cap ${rs.top.toFixed(2)}, screen ${rs.device.toFixed(2)}${rs.ratio < rs.top ? ', auto-lowered' : ''})`,
    `Lights point ${c.point} · spot ${c.spot} · dir ${c.dir}   shadowed ${c.shadowLights} (${c.shadowPasses} passes, ${k(c.casters)} casters)`,
    `Meshes ${k(c.meshes)} · instanced ${c.instanced} (${k(c.instances)}) · skinned ${c.skinned}`,
    `Infected alive ${alive.length} · near ${near}   pose every frame ${alive.filter((z) => (z.animEvery || 1) === 1).length} · thinned ${alive.filter((z) => z.animEvery > 1).length} · shadows ${alive.filter((z) => z.shadowOn !== false).length}`,
    `Memory geo ${mem.geometries} · tex ${mem.textures}${heap ? ` · heap ${Math.round(heap / 1048576)} MB` : ''}`,
    `→ ${verdict}`,
  ].join('\n');
}
