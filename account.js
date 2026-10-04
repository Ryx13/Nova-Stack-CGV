/* ======================================================================
   account.js — ACCOUNT UI + RUN REPORTING

   Owns the screens around the game that deal with who is playing:
   sign-in / sign-up / guest, the account chip on the title screen, the
   leaderboard, per-level stats on the level-select buttons, and the
   "run saved" summary on every end screen.

   Levels call exactly one thing: finishRun(result, endScreenEl) when a
   run ends. Everything else lives here and in cloud.js.
====================================================================== */
import { state } from './state.js';
import {
  initCloud, onSessionChanged, getSession, signIn, signUp, signInWithGoogle,
  resetPassword, playAsGuest, signOut, reportRunEnd, fetchLeaderboard, formatTime,
  cloudConfigured,
} from './cloud.js';
import './credits.js'; // wires every [data-open-credits] button

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------------------------------------------------------------
   AUTH SCREEN
--------------------------------------------------------------------- */
let afterAuth = null;

export function showAuth(onDone) {
  afterAuth = onDone || null;
  $('auth-screen').classList.remove('hidden');
  setAuthTab('signin');
  const offline = !cloudConfigured;
  $('auth-offline-note').classList.toggle('hidden', !offline);
  $('auth-forms').classList.toggle('disabled', offline);
  setTimeout(() => (offline ? $('auth-guest') : $('auth-email')).focus(), 30);
}
function hideAuth() { $('auth-screen').classList.add('hidden'); }

function setAuthTab(tab) {
  document.querySelectorAll('#auth-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('auth-callsign-row').classList.toggle('hidden', tab !== 'signup');
  $('auth-submit').textContent = tab === 'signup' ? 'Create account' : 'Sign in';
  $('auth-forgot').classList.toggle('hidden', tab !== 'signin');
  $('auth-password').autocomplete = tab === 'signup' ? 'new-password' : 'current-password';
  $('auth-form').dataset.tab = tab;
  authMsg('');
}
function authMsg(text, kind = 'error') {
  const el = $('auth-msg');
  el.textContent = text;
  el.className = text ? `auth-msg ${kind}` : 'auth-msg';
}
function busy(on) {
  document.querySelectorAll('#auth-screen button, #auth-screen input').forEach((el) => { el.disabled = on; });
  $('auth-submit').classList.toggle('loading', on);
}
async function runAuth(fn) {
  busy(true); authMsg('');
  try {
    await fn();
    hideAuth();
    const cb = afterAuth; afterAuth = null;
    if (cb) cb();
  } catch (err) {
    authMsg(err.message);
  } finally { busy(false); }
}

function wireAuth() {
  document.querySelectorAll('#auth-tabs button').forEach((b) => b.addEventListener('click', () => setAuthTab(b.dataset.tab)));
  $('auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('auth-email').value;
    const pw = $('auth-password').value;
    if ($('auth-form').dataset.tab === 'signup') runAuth(() => signUp(email, pw, $('auth-callsign').value));
    else runAuth(() => signIn(email, pw));
  });
  $('auth-google').addEventListener('click', () => runAuth(() => signInWithGoogle()));
  $('auth-guest').addEventListener('click', () => runAuth(() => playAsGuest()));
  $('auth-close').addEventListener('click', () => { hideAuth(); afterAuth = null; });
  $('auth-forgot').addEventListener('click', async () => {
    const email = $('auth-email').value.trim();
    if (!email) { authMsg('Type your email above first.'); return; }
    try { await resetPassword(email); authMsg('Reset link sent — check your inbox.', 'ok'); } catch (err) { authMsg(err.message); }
  });
}

/* ---------------------------------------------------------------------
   ACCOUNT CHIP + LEVEL-SELECT STATS
--------------------------------------------------------------------- */
function renderSession({ user, profile, syncState }) {
  const chip = $('account-chip');
  if (chip) {
    if (!user) {
      chip.innerHTML = `<span class="ac-name">Not signed in</span><button class="ac-btn" id="ac-signin">Sign in</button>`;
      $('ac-signin').onclick = () => showAuth();
    } else {
      const dot = { synced: 'ok', pending: 'busy', error: 'err', local: 'local' }[syncState] || 'local';
      const tip = { synced: 'Progress saved to the cloud', pending: 'Saving…', error: 'Offline — saved on this device, will sync later', local: 'Guest — saved on this device only' }[syncState];
      chip.innerHTML = `<span class="ac-dot ${dot}" title="${tip}"></span>
        <span class="ac-name">${esc(user.callsign)}${user.isGuest ? ' <small>(guest)</small>' : ''}</span>
        ${user.isGuest && cloudConfigured
          ? '<button class="ac-btn" id="ac-signin">Sign in to save online</button>'
          : `<button class="ac-btn" id="ac-signout">${user.isGuest ? 'Switch' : 'Sign out'}</button>`}`;
      if ($('ac-signin')) $('ac-signin').onclick = () => showAuth();
      if ($('ac-signout')) $('ac-signout').onclick = () => signOut();
    }
  }
  document.querySelectorAll('#level-buttons [data-level]').forEach((btn) => {
    let tag = btn.querySelector('.lvl-stat');
    if (!tag) { tag = document.createElement('span'); tag.className = 'lvl-stat'; btn.appendChild(tag); }
    const L = profile && profile.levels[btn.dataset.level];
    if (!L || !L.plays) { tag.textContent = 'Not played yet'; btn.classList.remove('cleared'); return; }
    btn.classList.toggle('cleared', L.wins > 0);
    tag.textContent = L.wins > 0 ? `✓ Best ${formatTime(L.bestTimeSec)}` : `${L.plays} attempt${L.plays === 1 ? '' : 's'}`;
  });
}

/* ---------------------------------------------------------------------
   LEADERBOARD SCREEN
--------------------------------------------------------------------- */
let lbLevel = '1';
async function renderLeaderboard() {
  document.querySelectorAll('#lb-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.level === lbLevel));
  const body = $('lb-body');
  const { user, profile } = getSession();
  const mine = profile && profile.levels[lbLevel];
  $('lb-mine').innerHTML = mine && mine.bestTimeSec != null
    ? `Your best: <b>${formatTime(mine.bestTimeSec)}</b> · ${mine.wins} win${mine.wins === 1 ? '' : 's'} / ${mine.plays} run${mine.plays === 1 ? '' : 's'}`
    : 'You haven\'t cleared this level yet.';
  if (!cloudConfigured) { body.innerHTML = '<p class="lb-empty">Online leaderboard isn\'t set up for this build.</p>'; return; }
  body.innerHTML = '<p class="lb-empty">Loading…</p>';
  const rows = await fetchLeaderboard(lbLevel, 10);
  if (!rows.length) { body.innerHTML = '<p class="lb-empty">No times yet — be the first.</p>'; return; }
  body.innerHTML = `<ol class="lb-list">${rows.map((r, i) => `
    <li class="${user && r.uid === user.uid ? 'me' : ''}">
      <span class="lb-rank">${i + 1}</span><span class="lb-name">${esc(r.callsign)}</span>
      <span class="lb-time">${formatTime(r.timeSec)}</span><span class="lb-kills">${r.kills ?? 0} kills</span>
    </li>`).join('')}</ol>`;
  if (user && user.isGuest) body.insertAdjacentHTML('beforeend', '<p class="lb-empty">Guests don\'t appear here — sign in to post your times.</p>');
}
export function openLeaderboard(level) {
  if (level) lbLevel = String(level);
  $('leaderboard-screen').classList.remove('hidden');
  renderLeaderboard();
}
function wireLeaderboard() {
  document.querySelectorAll('#lb-tabs button').forEach((b) => b.addEventListener('click', () => { lbLevel = b.dataset.level; renderLeaderboard(); }));
  $('lb-close').addEventListener('click', () => $('leaderboard-screen').classList.add('hidden'));
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-leaderboard]')) {
      if (document.pointerLockElement) document.exitPointerLock();
      openLeaderboard(state.levelId || null);
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (!$('leaderboard-screen').classList.contains('hidden')) $('leaderboard-screen').classList.add('hidden');
    else if (!$('auth-screen').classList.contains('hidden')) { hideAuth(); afterAuth = null; }
  });
}

/* ---------------------------------------------------------------------
   END-OF-RUN REPORTING — called by every level's win/lose screen.
--------------------------------------------------------------------- */
export async function finishRun(result, endScreenEl) {
  if (state.runReported) return;
  state.runReported = true;
  const level = state.levelId || 1;
  const timeSec = state.runTime || 0;

  let box = null;
  if (endScreenEl) {
    box = endScreenEl.querySelector('.run-summary');
    if (!box) {
      box = document.createElement('div');
      box.className = 'run-summary';
      const firstBtn = endScreenEl.querySelector('button');
      endScreenEl.insertBefore(box, firstBtn || null);
    }
    box.innerHTML = `<div class="rs-line">Time ${formatTime(timeSec)} · saving…</div>`;
    addEndScreenButtons(endScreenEl);
  }

  let res;
  try {
    res = await reportRunEnd({ level, result, kills: state.kills, coins: state.coins, timeSec });
  } catch (err) {
    console.error('[account] run report failed', err);
  }
  if (!box) return;
  const { user, syncState } = getSession();
  const where = user && !user.isGuest
    ? (syncState === 'synced' ? 'Saved to your account ✓' : 'Saved on this device — will sync when online')
    : 'Saved on this device (guest)';
  let record = '';
  if (res && result === 'win') {
    record = res.newBest
      ? `<div class="rs-record">${res.previousBest == null ? 'FIRST CLEAR' : 'NEW PERSONAL BEST'} — ${formatTime(res.bestTimeSec)}</div>`
      : `<div class="rs-line">Personal best ${formatTime(res.bestTimeSec)}</div>`;
  }
  box.innerHTML = `${record}<div class="rs-line">Time ${formatTime(timeSec)} · ${where}</div>`;
}

/* Every end screen gets the same menu: retry, main menu, leaderboard,
   credits. Existing "Play Again"/"Restart" buttons are re-pointed at
   retry (same level + mode) instead of dumping the player at the title. */
function addEndScreenButtons(el) {
  if (el.querySelector('.end-actions')) return;
  el.querySelectorAll('button[onclick*="location.reload"]').forEach((b) => {
    b.removeAttribute('onclick');
    b.addEventListener('click', retryLevel);
  });
  const row = document.createElement('div');
  row.className = 'end-actions';
  row.innerHTML = `
    <button type="button" data-act="menu">Main menu</button>
    <button type="button" data-open-leaderboard>Leaderboard</button>
    <button type="button" data-open-credits>Credits</button>`;
  row.querySelector('[data-act="menu"]').addEventListener('click', toMainMenu);
  el.appendChild(row);
}

/* Restarting still reloads the page (each level builds its world at
   module load time), but it no longer sends the player back through
   title → level → mode: main.js reads this and relaunches immediately,
   and the sign-in session survives the reload. */
const RESUME_KEY = 'deadway.resume';
export function retryLevel() {
  try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ level: state.levelId || 1, mode: state.timeOfDay || 'night' })); } catch { /* ignore */ }
  location.reload();
}
export function toMainMenu() {
  try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ menu: true })); } catch { /* ignore */ }
  location.reload();
}
export function takeResumeRequest() {
  try {
    const v = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

/* ---------------------------------------------------------------------
   BOOT
--------------------------------------------------------------------- */
export const sessionReady = initCloud();

export function initAccountUI() {
  wireAuth();
  wireLeaderboard();
  onSessionChanged(renderSession);
}
