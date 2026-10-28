/* ======================================================================
   Settings.js — THE PLAYER'S OWN SETTINGS (the pause menu's sliders)

   Mouse sensitivity (how far a mouse move turns you) and volume (music
   and effects together, under the M mute). Remembered on this browser;
   a browser that won't store them just gets the defaults each visit.
   Read by Actions.js (looking), Music.js (the soundtrack) and Scene.js
   (the effects).
====================================================================== */
const KEY = 'deadway.settings';
const DEFAULTS = { sensitivity: 1, volume: 1 };
const RANGE = { sensitivity: [0.3, 2.5], volume: [0, 1] };

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      const v = Number(saved[k]);
      if (Number.isFinite(v)) out[k] = Math.min(RANGE[k][1], Math.max(RANGE[k][0], v));
    }
    return out;
  } catch { return { ...DEFAULTS }; }
}
export const settings = load();

const listeners = new Set();
/** Called with the settings whenever one changes. */
export function onSettingsChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

function set(k, v) {
  settings[k] = Math.min(RANGE[k][1], Math.max(RANGE[k][0], v));
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* not stored: fine */ }
  for (const cb of listeners) { try { cb(settings); } catch { /* one broken listener mustn't stop the rest */ } }
}

/** The pause menu's two sliders (index.html #settings-panel). */
export function bindSettingsUI() {
  const rows = [
    ['sensitivity', 'set-sensitivity', (v) => `${v.toFixed(1)}×`],
    ['volume', 'set-volume', (v) => `${Math.round(v * 100)}%`],
  ];
  for (const [k, id, label] of rows) {
    const input = document.getElementById(id), out = document.getElementById(`${id}-value`);
    if (!input) continue;
    input.value = String(settings[k]);
    if (out) out.textContent = label(settings[k]);
    input.addEventListener('input', () => {
      set(k, Number(input.value));
      if (out) out.textContent = label(settings[k]);
    });
    // Keys on a slider move the slider, not you (or pause/unpause)
    input.addEventListener('keydown', (e) => { if (e.code.startsWith('Arrow')) e.stopPropagation(); });
  }
}
