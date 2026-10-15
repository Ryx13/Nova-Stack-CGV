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

   Autoplay policy: browsers block audio until the first user gesture,
   so nothing plays until a pointerdown/keydown anywhere; a one-shot
   unlock listener then starts whatever context has been requested. If a
   play() call is rejected anyway, the same listener is re-armed.

   All three tracks are CC-BY licensed — credits.js carries the full
   attribution.
====================================================================== */

export const TRACKS = {
  menu:   { src: 'assets/music/gfz-hell.mp3',           volume: 0.5 },
  level1: { src: 'assets/music/dark-ambience-loop.mp3', volume: 0.4 },
  level2: { src: 'assets/music/dark-ambience-loop.mp3', volume: 0.4 },
  level3: { src: 'assets/music/demon-lord.mp3',         volume: 0.45 },
};

const decks = new Map(); // context key -> HTMLAudioElement (created on first use)
let currentKey = null;   // the context we want playing right now
let unlocked = false;    // has a user gesture let audio start yet?
let unlockArmed = false;
let muted = false;       // persisted master switch for music + sfx

const LS_KEY = 'deadway.sound.muted'; // shared with the sound button in main.js
const listeners = new Set(); // notified whenever the mute state changes

/* Volume fades — switching a level should never hard-cut the music. One
   shared 40ms ticker services every active fade and parks itself once
   the last one finishes. */
const FADE_SECONDS = 1.2;
const fades = new Map(); // deck -> { from, to, start, dur, onDone }
let fadeTimer = null;

function fadeTo(deck, to, seconds, onDone) {
  const from = deck.volume;
  if (!fades.has(deck) && Math.abs(from - to) < 0.001) {
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

function targetVolume(key) { return TRACKS[key].volume; }

function applyContext() {
  if (!unlocked || !currentKey) return;
  // Fade every other deck out (and park it once silent, so a stacked
  // context change can never leave two tracks quietly playing together).
  for (const [k, d] of decks) {
    if (k === currentKey || d.paused) continue;
    fadeTo(d, 0, FADE_SECONDS, () => d.pause());
  }
  if (muted) return; // context remembered, but silenced until unmuted
  const d = deckFor(currentKey);
  const p = d.play(); // resumes mid-track where it was last faded out
  if (p) p.catch(() => {}); // still blocked — the unlock listener retries
  fadeTo(d, targetVolume(currentKey), FADE_SECONDS);
}

function armUnlock() {
  if (unlockArmed) return;
  unlockArmed = true;
  const onFirstGesture = () => {
    document.removeEventListener('pointerdown', onFirstGesture, true);
    document.removeEventListener('keydown', onFirstGesture, true);
    unlocked = true;
    applyContext();
  };
  document.addEventListener('pointerdown', onFirstGesture, true);
  document.addEventListener('keydown', onFirstGesture, true);
}

export function initMusic() {
  try { muted = localStorage.getItem(LS_KEY) === '1'; } catch { /* private mode */ }
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
   MUTE — one switch for the whole game's audio, persisted so a muted
   player stays muted across reloads. Scene.js and StoryAudio.js read
   isMuted() so the synthesized sfx honour it as well.
--------------------------------------------------------------------- */
export function isMuted() { return muted; }

export function setMuted(v) {
  v = !!v;
  if (v === muted) return;
  muted = v;
  try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch { /* ignore */ }
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
  if (!unlocked) return;
  if (muted) {
    for (const [, d] of decks) {
      if (!d.paused) fadeTo(d, 0, 0.3, () => d.pause());
    }
  } else {
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
