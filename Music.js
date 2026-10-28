/* ======================================================================
   Music.js — BACKGROUND MUSIC DIRECTOR

   One looping soundtrack per context:
     menu    → "GFZ Hell level" (Emma M. Andersson, Unreleased Zombie
               soundtrack) — title screen, auth, character select, level
               select, mode select, story sequences and tutorials:
               everything that is not one of the three levels.
     level1  → "Dark Ambience Loop" (Iwan 'qubodup' Gabovitch) — Level 1.
     level2  → the same loop — Level 2.
     level3  → "Demon Lord" (Scrabbit) — Level 3.

   Each context gets its own <audio> element (created lazily, attached to
   the document so the elements can be inspected from the console), and
   switching contexts fades the old track out and the new one in rather
   than hard-cutting.

   Autoplay policy: playback is attempted as soon as the page loads —
   wherever the browser allows it, the menu music starts on the title
   screen itself. When the browser refuses (the usual first visit in
   Chrome), the deck does not just sit paused: muted playback is always
   permitted, so the track pre-rolls SILENTLY from that same moment and
   the state goes "pending" — silent, waiting for the first gesture.
   While pending the chip keeps its normal look (it is not a mute —
   nothing the player did) and the first press anywhere — the chip, M,
   or any other click or key — switches the music ON, already buffered
   and mid-track, swelling in over half a second. A pending press on
   the chip is never treated as "mute": the press that starts the music
   cannot silence it. The unlock listeners stay armed until audible
   playback actually starts, so a blocked attempt is retried by the
   next gesture.

   Muting is for the current visit only — it is deliberately NOT
   persisted. A stored mute once made every reload start silent, which
   reads as the game defaulting to mute; every load now starts with
   sound available.

   All three tracks are CC-BY licensed — credits.js carries the full
   attribution.
====================================================================== */
import { settings, onSettingsChange } from './Settings.js';

export const TRACKS = {
  menu:   { src: 'assets/music/gfz-hell.mp3',           volume: 0.5 },
  level1: { src: 'assets/music/dark-ambience-loop.mp3', volume: 0.4 },
  level2: { src: 'assets/music/dark-ambience-loop.mp3', volume: 0.4 },
  level3: { src: 'assets/music/demon-lord.mp3',         volume: 0.45 },
};

const decks = new Map(); // context key -> HTMLAudioElement (created on first use)
let currentKey = null;   // the context we want playing right now
let unlockArmed = false;
let muted = false;       // master switch for music + sfx (current visit only)
let pendingUnlock = false; // silent pre-roll active, waiting for the first gesture

const LS_KEY = 'deadway.sound.muted'; // legacy key from earlier builds — cleared at boot
const listeners = new Set(); // notified whenever the mute state changes

/* Volume fades — switching a level should never hard-cut the music. One
   shared 40ms ticker services every active fade and parks itself once
   the last one finishes. */
const FADE_SECONDS = 1.2; // crossfade between contexts (e.g. a level switch)
const START_FADE_SECONDS = 0.5; // quicker swell when a track starts from silence
const fades = new Map(); // deck -> { from, to, start, dur, onDone }
let fadeTimer = null;

function fadeTo(deck, to, seconds, onDone) {
  const existing = fades.get(deck);
  if (existing && Math.abs(existing.to - to) < 0.001) return; // already heading there
  const from = deck.volume;
  if (!existing && Math.abs(from - to) < 0.001) {
    deck.volume = to;
    if (onDone) onDone();
    return;
  }
  fades.set(deck, { from, to, start: performance.now(), dur: Math.max(seconds, 0.05) * 1000, onDone });
  if (!fadeTimer) fadeTimer = setInterval(tickFades, 40);
}

function tickFades() {
  const now = performance.now();
  for (const [deck, f] of fades) {
    const t = Math.min((now - f.start) / f.dur, 1);
    deck.volume = f.from + (f.to - f.from) * t;
    if (t >= 1) {
      fades.delete(deck);
      if (f.onDone) f.onDone();
    }
  }
  if (!fades.size) { clearInterval(fadeTimer); fadeTimer = null; }
}

function deckFor(key) {
  let d = decks.get(key);
  if (!d) {
    d = new Audio(TRACKS[key].src);
    d.loop = true;
    d.preload = 'auto';
    d.volume = 0;
    d.style.display = 'none';
    document.body.appendChild(d); // attach so the element is queryable/debuggable
    decks.set(key, d);
  }
  return d;
}

let cinematicDuck=1;
export function setCinematicDuck(value=1){cinematicDuck=Math.max(0,Math.min(1,value));applyContext();}
// The pause menu's volume (Settings.js) scales every track
function targetVolume(key) { return TRACKS[key].volume*cinematicDuck*settings.volume; }
onSettingsChange(() => { if (!muted) applyContext(); });

function applyContext() {
  if (!currentKey) return;
  // Fade every other deck out (and park it once silent, so a stacked
  // context change can never leave two tracks quietly playing together).
  for (const [k, d] of decks) {
    if (k === currentKey || d.paused) continue;
    fadeTo(d, 0, FADE_SECONDS, () => d.pause());
  }
  const d = deckFor(currentKey); // exists from boot, so the track preloads early
  if (muted) return; // context remembered, but silenced until unmuted
  if (document.hidden) return; // never start audio in a background tab
  const wasPaused = d.paused;
  const p = d.play(); // resumes mid-track where it was last faded out
  // Refused (no autoplay permission yet)? Start the silent pre-roll and
  // keep the unlock listeners armed — the next gesture unmutes/retries.
  // Only an audible success disarms them.
  if (p && p.then) p.then(() => { if (!d.muted) disarmUnlock(); }).catch(() => startPreRoll(d));
  if (d.muted) return; // pre-rolling silently — volume stays at 0 for the unmute swell
  // A track starting from silence swells in faster than a level crossfade.
  fadeTo(d, targetVolume(currentKey), wasPaused ? START_FADE_SECONDS : FADE_SECONDS);
}

/* The browser refused unmuted playback. Muted playback is always
   allowed, so keep the track running silently from here — decoded,
   buffered and mid-track — so the first gesture only has to unmute it
   instead of starting it from nothing. */
function startPreRoll(d) {
  if (d.muted) return; // already rolling silently
  d.muted = true;
  d.volume = 0;
  fades.delete(d); // cancel the fade the refused attempt registered
  pendingUnlock = true; // sound is not audible yet — the chip reads muted
  notify();
  const p = d.play();
  if (p && p.catch) p.catch(() => {}); // even muted playback refused — stay parked
}

function armUnlock() {
  if (unlockArmed) return;
  unlockArmed = true;
  document.addEventListener('pointerdown', onFirstGesture, true);
  document.addEventListener('keydown', onFirstGesture, true);
}

/* True when this gesture belongs to the sound UI itself (the chip or the
   M key). Those presses deliberately do NOT auto-unmute here: main.js's
   handler runs afterwards and routes them through handleSoundToggle(),
   which switches a pending pre-roll ON — if this listener unmuted first,
   the same press would then read as "mute" in the toggle and silence
   everything again. The M conditions mirror main.js's handler. */
function isSoundUiEvent(e) {
  const t = e && e.target;
  if (e && e.type === 'keydown') {
    const editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (!editing && e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) return true;
    // Enter/Space activating a focused chip fires a synthetic click after
    // this keydown — let that click run the toggle instead.
    if (!e.repeat && t && t.closest && t.closest('#sound-btn') &&
        (e.code === 'Enter' || e.code === 'Space')) return true;
    return false;
  }
  return !!(t && t.closest && t.closest('#sound-btn'));
}

/* The silent pre-roll is over the moment any real gesture happens: the
   deck unmutes (permitted inside the gesture) and swells in from zero.
   The chip repaints through notify() — sound is genuinely on now. */
function clearPendingUnlock() {
  if (!pendingUnlock) return false;
  pendingUnlock = false;
  const d = currentKey ? decks.get(currentKey) : null;
  if (!muted && d && d.muted) {
    d.muted = false;
    fadeTo(d, targetVolume(currentKey), START_FADE_SECONDS);
  }
  notify();
  return true;
}

function onFirstGesture(e) {
  if (!isSoundUiEvent(e)) clearPendingUnlock();
  applyContext(); // retried on every gesture until playback is audible
}

function disarmUnlock() {
  if (!unlockArmed) return;
  unlockArmed = false;
  document.removeEventListener('pointerdown', onFirstGesture, true);
  document.removeEventListener('keydown', onFirstGesture, true);
}

export function initMusic() {
  // Never boot muted: mute lives for the current visit only, and a stored
  // mute from an earlier build is cleared so it cannot linger at all.
  muted = false;
  try { localStorage.removeItem(LS_KEY); } catch { /* private mode */ }
  armUnlock();
  // Pause the music while the tab is backgrounded (the sound keeps
  // playing otherwise, which reads as a bug when the player tabs away)
  // and bring the current context back, mid-track, on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      for (const [, d] of decks) if (!d.paused) fadeTo(d, 0, 0.25, () => d.pause());
    } else {
      applyContext(); // respects the mute state on its own
    }
  });
}

/* ---------------------------------------------------------------------
   MUTE — one switch for the whole game's audio, for the current visit
   only: every load starts with sound available (see initMusic). Scene.js
   and StoryAudio.js read isMuted() so the synthesized sfx honour it as
   well.
--------------------------------------------------------------------- */
export function isMuted() { return muted; }

/* True while the music is caught in the silent pre-roll: autoplay was
   refused and the track is rolling muted until the next gesture turns it
   on. The chip keeps its normal look in this state; the first press
   (the chip included) is treated as "switch on" rather than "toggle". */
export function isSoundPending() { return pendingUnlock; }

/* The main.js entry point for the sound chip and the M key. While the
   pre-roll is pending, a press means "make the music audible" — without
   this, the very press that unmuted the pre-roll would be read as a
   toggle and flip straight back to muted. */
export function handleSoundToggle() {
  if (clearPendingUnlock()) { applyContext(); return muted; }
  return toggleMuted();
}

export function setMuted(v) {
  v = !!v;
  if (v === muted) return;
  muted = v; // current visit only — deliberately not persisted
  applyMute();
  notify();
}

export function toggleMuted() { setMuted(!muted); return muted; }

/* Subscribe to mute changes (used by main.js to repaint the sound button
   and by Scene.js to zero the sfx master gain). Returns an unsubscribe. */
export function onSoundChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) {
    try { cb(muted); } catch { /* a broken listener must not break audio */ }
  }
}

function applyMute() {
  if (muted) {
    pendingUnlock = false; // an explicit mute supersedes any pending pre-roll
    for (const [, d] of decks) {
      if (!d.paused) fadeTo(d, 0, 0.3, () => d.pause());
    }
  } else {
    // The unmuting click/keypress is itself a gesture, so it is safe to
    // clear a silent pre-roll mute here before fading back in.
    for (const [, d] of decks) if (d.muted) { d.muted = false; d.volume = 0; }
    applyContext(); // fade the current context back in
  }
}

/* Called by main.js (menu / launchLevel) to pick the soundtrack for the
   current screen or level. Re-requesting the active context is a no-op. */
export function setMusicContext(key) {
  if (!TRACKS[key] || key === currentKey) return;
  currentKey = key;
  applyContext();
}
