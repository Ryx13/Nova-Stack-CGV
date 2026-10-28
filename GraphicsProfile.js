/* ---------------------------------------------------------------------
   GRAPHICS PROFILE — 'high' (the full look) or 'low' (for weak GPUs:
   no MSAA, and the render scale may drop further). Chosen once at page
   load, before any renderer exists, because MSAA is fixed when a WebGL
   context is created and can't be switched on or off later.

   In order, the first that applies:
     1. ?gfx=low / ?gfx=high in the URL — forced, never learned over
     2. what this browser learned last time (deadway.gfx, set by
        RenderScale.js: low that ran smooth at full resolution for a
        minute moves up; high stuck slow at the lowest resolution moves down)
     3. the GPU's name: software rendering and Intel's HD / UHD chips start
        low (Iris Xe, Arc and every dedicated card start high)
   No game imports, so any module can read it first.
--------------------------------------------------------------------- */

const STORE_KEY = 'deadway.gfx';
const WEAK_GPU = /swiftshader|basic render|llvmpipe|software|\bintel\b.*\b(u?hd) graphics\b/i;

function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // don't keep a spare context alive
    return name;
  } catch { return ''; }
}

function choose() {
  const asked = new URLSearchParams(location.search).get('gfx');
  if (asked === 'low' || asked === 'high') return { level: asked, why: 'forced (?gfx)', forced: true };
  let learned = null;
  try { learned = localStorage.getItem(STORE_KEY); } catch { /* storage blocked: detect instead */ }
  if (learned === 'low' || learned === 'high') return { level: learned, why: 'learned on this browser', forced: false };
  const name = gpuName();
  return WEAK_GPU.test(name)
    ? { level: 'low', why: 'weak GPU detected', forced: false }
    : { level: 'high', why: name ? 'GPU detected' : 'GPU unknown', forced: false };
}

export const gfx = choose();
gfx.low = gfx.level === 'low';
gfx.antialias = !gfx.low;

/** Next page load starts on this profile (unless ?gfx forces one). */
export function rememberProfile(level) {
  if (gfx.forced) return;
  try { localStorage.setItem(STORE_KEY, level); } catch { /* storage blocked: detection decides again */ }
}
