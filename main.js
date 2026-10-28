import { playStoryboard, playLevelTransition } from './Intro.js';
import { chooseDifficulty, applyDifficulty, showDifficultyBadge } from './Difficulty.js';
// main.js — ENTRY POINT
//
// Runs before any of Scene/characters/Actions/PowerUps are ever loaded,
// so it's responsible for two things those files used to handle: (1)
// setting the intro screen's splash background — Scene.js used to do
// this at its own top level, but Scene.js now only loads once a level
// is picked, well after the intro screen has already been shown — and
// (2) advancing from the intro screen to the character-select screen
// (characterSelect.js), then level-select, then the mode-select screen
// (Day/Night). It also boots the background-music director (Music.js) —
// setting the 'menu' context here and the per-level context in
// launchLevel() — and the fixed sound button / M shortcut that drive
// its master mute.
// Level selection itself dynamically imports only the chosen level's
// module, rather than eagerly loading all three (and therefore all of
// Scene/characters/Actions/PowerUps/shaders) up front. It also drives
// the single reusable loading screen: shown the instant a mode is
// chosen, hidden again once that level's player+zombie assets are ready
// (Scene.js's maybeReady(), unchanged in spirit, handles the hide/reveal
// and hands off to Actions.js's onAssetsReady() callback for the rest).

import { initAccountUI, sessionReady, showAuth, takeResumeRequest } from './account.js';
import { getSession } from './cloud.js';
import { state } from './state.js';
import { showCharacterSelect, hideCharacterSelect, disposeCharacterSelect } from './characterSelect.js';
import { initMusic, setMusicContext, isMuted, handleSoundToggle, onSoundChange } from './Music.js';

const introScreen = document.getElementById('start-screen');
// The splash art lives on its own layer (#splash-bg) so it can carry the
// slow Ken Burns zoom/pan in CSS without animating the screen's other
// children along with it.
const splashBg = document.getElementById('splash-bg');
if (splashBg) splashBg.style.backgroundImage = "url('assets/splash1.jpg')";

const LEVEL_LOADERS = {
  1: () => import('./Level1.js'),
  2: () => import('./Level2.js'),
  3: () => import('./Level3.js'),
};

function initIntroScreen() {
  const enterBtn = document.getElementById('enter-btn');
  const levelSelect = document.getElementById('level-select');
  if (!enterBtn || !introScreen || !levelSelect) return;
  let entering = false;
  const goToLevelSelect = async () => {
    if (entering) return;
    entering = true;
    introScreen.classList.add('hidden');
    try {
    let seen = false;
    try { seen = localStorage.getItem('deadway.intro.v2') === 'done'; } catch {}
    if (!seen) {
      await playStoryboard();
      const { startSafeRoomTutorial } = await import('./IntroTutorial.js');
      await new Promise(resolve => startSafeRoomTutorial({ onComplete: resolve }));
      try { localStorage.setItem('deadway.intro.v2', 'done'); } catch {}
    }
    entering = false;
    introScreen.classList.add('hidden');
    goToCharacterSelect();
    } catch (error) {
      entering = false;
      console.error('Opening tutorial failed:', error);
      document.getElementById('safe-room-ui')?.remove();
      introScreen.classList.remove('hidden');
      enterBtn.textContent = 'RETRY ENTERING THE CITY';
    }
  };
  // Intro -> character select -> level select. Back walks the same path.
  const goToCharacterSelect = () => {
    introScreen.classList.add('hidden');
    levelSelect.classList.add('hidden');
    showCharacterSelect({
      onConfirm: () => {
        hideCharacterSelect();
        levelSelect.classList.remove('hidden');
      },
      onBack: () => {
        hideCharacterSelect();
        introScreen.classList.remove('hidden');
      },
    });
  };
  enterBtn.addEventListener('click', async () => {
    await sessionReady;
    // Every run is tied to a player: an account, or an explicit guest.
    if (getSession().user) goToLevelSelect();
    else showAuth(goToLevelSelect);
  });
  const replay = document.createElement('button'); replay.textContent = 'Replay story & training';
  replay.addEventListener('click', async () => {
    levelSelect.classList.add('hidden'); await playStoryboard();
    const { startSafeRoomTutorial } = await import('./IntroTutorial.js');
    startSafeRoomTutorial({ onComplete: () => levelSelect.classList.remove('hidden') });
  });
  levelSelect.appendChild(replay);
  const backBtn = document.getElementById('level-back');
  if (backBtn) backBtn.addEventListener('click', goToCharacterSelect);
}

// LEVEL SELECT — now just picks which level and hands off to the new
// mode-select screen, rather than loading the level directly.
function initLevelSelect() {
  const levelSelect = document.getElementById('level-select');
  const modeSelect = document.getElementById('mode-select');
  const buttons = document.querySelectorAll('#level-select [data-level]');
  if (!levelSelect || !modeSelect) return;

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const levelId = btn.getAttribute('data-level');
      if (!LEVEL_LOADERS[levelId]) {
        console.error(`No level module registered for id "${levelId}"`);
        return;
      }
      levelSelect.classList.add('hidden');
      modeSelect.classList.remove('hidden');
      modeSelect.dataset.pendingLevel = levelId;
      // Level 2's day is its own clear, smoky afternoon (Level2Config.js)
      const daySub = document.querySelector('#mode-day .mode-sub');
      if (daySub) daySub.textContent = levelId === '2' ? 'Low sun through the smoke' : levelId === '1' ? 'Low sun, drizzle and smoke' : 'Overcast, light drizzle';
    });
  });
}

// MODE SELECT — Day / Night, shown right after a level is chosen. Only
// once a mode is picked here does the level module actually load.
function initModeSelect() {
  const modeSelect = document.getElementById('mode-select');
  const buttons = document.querySelectorAll('#mode-select [data-mode]');
  if (!modeSelect) return;

  let modeChosen = false;

  // ← Back: one step up the menu chain (mode -> level -> character -> start)
  const modeBack = document.getElementById('mode-back');
  if (modeBack) modeBack.addEventListener('click', () => {
    modeSelect.classList.add('hidden');
    document.getElementById('level-select').classList.remove('hidden');
  });

  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (modeChosen) return; // ignore double-clicks / double-selection
      modeChosen = true;

      const levelId = modeSelect.dataset.pendingLevel;
      const mode = btn.getAttribute('data-mode');
      const loadLevel = LEVEL_LOADERS[levelId];
      if (!loadLevel) {
        console.error(`No level module registered for id "${levelId}"`);
        modeChosen = false;
        return;
      }

      modeSelect.classList.add('hidden');
      // Then Easy or Impossible; Back returns to Day / Night
      const difficulty = await chooseDifficulty(levelId);
      if (!difficulty) { modeSelect.classList.remove('hidden'); modeChosen = false; return; }
      await launchLevel(levelId, mode, difficulty);
    });
  });
}

async function launchLevel(levelId, mode, difficulty = 'impossible') {
  const loading = document.getElementById('loading');
  const loadLevel = LEVEL_LOADERS[levelId];
  if (!loadLevel) return;
  state.loadFailed = false;
  if (loading) loading.classList.remove('hidden');
  disposeCharacterSelect(); // the level brings its own renderer
  // Levels 1 and 2 share the Dark Ambience loop; Level 3 gets Demon Lord.
  setMusicContext(`level${levelId}`);
  try {
    const levelModule = await loadLevel();
    applyDifficulty(Number(levelId), difficulty); // after the level's own config, which it overrides
    levelModule.startLevel(mode);
    showDifficultyBadge();
  } catch (err) {
    state.loadFailed = true;
    console.error(`Level ${levelId} failed to load:`, err);
    if (loading) {
      const status = document.getElementById('load-status');
      if (status) status.textContent = 'Could not start the game. Refresh to try again.';
      if (String(levelId) === '3') {
        document.getElementById('level3-startup-error')?.remove();
        const details = document.createElement('details');
        details.id = 'level3-startup-error';
        details.style.cssText = 'max-width:min(640px,90vw);margin:14px auto;color:#e8d9b9;font:13px/1.5 Arial,sans-serif;letter-spacing:0;text-transform:none';
        const summary = document.createElement('summary');
        summary.textContent = 'Show startup error';
        summary.style.cursor = 'pointer';
        const cause = document.createElement('pre');
        cause.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;padding:12px;background:#111;border:1px solid #544831;max-height:160px;overflow:auto;user-select:text';
        cause.textContent = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        details.append(summary, cause);
        loading.appendChild(details);
      }
      if (!document.getElementById('render-retry')) {
        const retry = document.createElement('button');
        retry.id = 'render-retry';
        retry.type = 'button';
        retry.textContent = 'Reload game';
        retry.addEventListener('click', () => location.reload());
        loading.appendChild(retry);
      }
    }
  }
}

// "Continue to Level N" and "Main menu" reload the page with a resume
// request, so the next level (or the menu) comes up straight away (see
// account.js). Retry doesn't reload — the level restarts in place.
async function handleResume() {
  const req = takeResumeRequest();
  if (!req || !req.level || !LEVEL_LOADERS[req.level]) return;
  await sessionReady;
  if (!getSession().user) return; // signed out in between — normal flow
  introScreen.classList.add('hidden');
  if (req.transitionFrom) await playLevelTransition(req.transitionFrom);
  const difficulty = await chooseDifficulty(String(req.level), { canGoBack: false });
  await launchLevel(String(req.level), req.mode || 'night', difficulty);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    boot();
  });
} else {
  boot();
}

/* M toggles the master sound switch from anywhere — gameplay, menus, end
   screens — except while typing into an account text field. */
document.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  handleSoundToggle();
});

function boot() {
  if (new URLSearchParams(location.search).has('debug')) document.body.classList.add('debug');
  initMusic();
  setMusicContext('menu'); // everything outside the three levels shares one track
  initAccountUI();
  initIntroScreen();
  initLevelSelect();
  initModeSelect();
  initSoundButton();
  startEmberDrift();
  handleResume();
}

/* ---------------------------------------------------------------------
   SOUND BUTTON — repaints the fixed chip from Music.js's state and
   toggles the master switch on click. Lives in main.js so the chip
   exists on every screen, gameplay included.
--------------------------------------------------------------------- */
function initSoundButton() {
  const btn = document.getElementById('sound-btn');
  // The chip reflects the master mute only. The silent pre-roll keeps
  // the normal look on purpose: a slashed chip at load read as "the game
  // defaults to mute", while the first press turns the waiting music ON
  // anyway (handleSoundToggle), so the look stays truthful to the switch.
  const paint = () => {
    if (!btn) return;
    const off = isMuted();
    btn.classList.toggle('muted', off);
    btn.setAttribute('aria-pressed', String(off));
    btn.title = off ? 'Unmute (M)' : 'Mute (M)';
  };
  paint();
  onSoundChange(paint);
  if (btn) btn.addEventListener('click', () => {
    handleSoundToggle();
    // Drop focus so Space/Enter keep doing their game jobs (jump etc.)
    // instead of re-triggering this button from the keyboard.
    btn.blur();
  });
}

/* ---------------------------------------------------------------------
   Title-screen ember/ash drift — a whisper of motion on top of the
   splash art so the home page never sits perfectly still (the Ken Burns
   pan handles the background layer; this handles the foreground).
   Pure canvas 2D, ~54 particles, no assets. The loop keeps running
   while the intro screen is hidden but skips all drawing, so returning
   to the home screen from level-select resumes it for free.
--------------------------------------------------------------------- */
function startEmberDrift() {
  const intro = document.getElementById('start-screen');
  const canvas = document.getElementById('ember-canvas');
  if (!intro || !canvas) return;
  const ctx = canvas.getContext('2d');
  const fit = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
  fit();
  window.addEventListener('resize', fit);
  const R = Math.random;
  const parts = [];
  for (let i = 0; i < 54; i++) parts.push({
    x: R() * window.innerWidth, y: R() * window.innerHeight,
    r: 0.8 + R() * 2.1, v: 6 + R() * 16, // px/s upward drift
    sway: 12 + R() * 26, ph: R() * Math.PI * 2,
    a: 0.12 + R() * 0.5, ember: R() < 0.45,
  });
  let last = performance.now();
  (function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (intro.classList.contains('hidden')) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = now / 1000;
    for (const p of parts) {
      p.y -= p.v * dt;
      if (p.y < -8) { p.y = canvas.height + 8; p.x = R() * canvas.width; }
      const x = p.x + Math.sin(t * 0.7 + p.ph) * p.sway;
      const flick = p.ember ? 0.55 + 0.45 * Math.sin(t * 3 + p.ph * 2) : 1;
      ctx.globalAlpha = p.a * flick;
      ctx.fillStyle = p.ember ? '#ffb45e' : '#9a917f';
      ctx.beginPath();
      ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  })(last);
}
