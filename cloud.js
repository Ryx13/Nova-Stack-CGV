/* ======================================================================
   cloud.js — ACCOUNTS, CLOUD SAVE AND LEADERBOARD

   Backend: Firebase (free "Spark" plan) — Authentication for accounts,
   Cloud Firestore for save data. Chosen because the department LAMP
   server only serves static files: there is nowhere to run our own
   server code or database, so the game talks directly from the browser
   to a hosted backend over HTTPS.

   Design:
   - The game NEVER depends on the network to be playable. If Firebase
     isn't configured, can't load, or the player picks "guest", the same
     API works against localStorage instead.
   - Every profile is also cached in localStorage, so a flaky connection
     during a demo never loses a run: the cache is pushed up the next
     time a write succeeds.
   - Firebase SDK modules are imported lazily from gstatic.com, so the
     title screen doesn't wait on them and an outage can't block boot.

   Firestore layout (enforced by firestore.rules):
     players/{uid}                       one doc per player (profile,
                                         settings, per-level stats)
     leaderboards/level{n}/entries/{uid} best winning time per player
====================================================================== */
import { firebaseConfig } from './firebase-config.js';

const FB_VERSION = '12.19.0';
const FB = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
const LEVELS = ['1', '2', '3'];

export const cloudConfigured = !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PASTE_');

/* ---------------------------------------------------------------------
   Local storage helpers — every access guarded (private windows, blocked
   storage and quota errors must never crash the game).
--------------------------------------------------------------------- */
const LS_PREFIX = 'deadway.profile.';
function lsGet(key) {
  try { const v = localStorage.getItem(LS_PREFIX + key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch { /* ignore */ }
}

function blankLevelStats() {
  return { plays: 0, wins: 0, losses: 0, bestTimeSec: null, bestKills: 0, lastPlayed: null };
}
function blankProfile(callsign = 'Survivor') {
  const levels = {};
  LEVELS.forEach((l) => { levels[l] = blankLevelStats(); });
  return {
    callsign,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: { mouseSensitivity: 1, volume: 0.32, preferredMode: 'night' },
    levels,
    totals: { kills: 0, coins: 0, playSeconds: 0, runs: 0 },
  };
}
/* Fill in any fields an older save is missing, so schema additions never
   break existing players. */
function normalise(p) {
  const base = blankProfile(p && p.callsign);
  if (!p) return base;
  const out = { ...base, ...p };
  out.settings = { ...base.settings, ...(p.settings || {}) };
  out.totals = { ...base.totals, ...(p.totals || {}) };
  out.levels = {};
  LEVELS.forEach((l) => { out.levels[l] = { ...blankLevelStats(), ...((p.levels || {})[l] || {}) }; });
  return out;
}

/* ---------------------------------------------------------------------
   State
--------------------------------------------------------------------- */
let fb = null;            // { auth, db, mod: {...firebase functions} } once loaded
let fbLoading = null;
let user = null;          // { uid, callsign, email, isGuest }
let profile = null;
let syncState = 'local';  // 'local' | 'synced' | 'pending' | 'error'
const listeners = new Set();

function emit() { listeners.forEach((cb) => { try { cb(getSession()); } catch (e) { console.error(e); } }); }

export function onSessionChanged(cb) { listeners.add(cb); cb(getSession()); return () => listeners.delete(cb); }
export function getSession() { return { user, profile, syncState, cloudConfigured }; }

/* ---------------------------------------------------------------------
   Firebase loading
--------------------------------------------------------------------- */
async function loadFirebase() {
  if (!cloudConfigured) return null;
  if (fb) return fb;
  if (fbLoading) return fbLoading;
  fbLoading = (async () => {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${FB}/firebase-app.js`),
      import(`${FB}/firebase-auth.js`),
      import(`${FB}/firebase-firestore.js`),
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);
    const db = fsMod.getFirestore(app);
    fb = { auth, db, a: authMod, f: fsMod };
    return fb;
  })().catch((err) => {
    console.warn('[cloud] Firebase failed to load — continuing offline.', err);
    fbLoading = null;
    return null;
  });
  return fbLoading;
}

/* ---------------------------------------------------------------------
   Boot: restores a previous session (Firebase keeps sign-in in
   IndexedDB, so a page refresh — or a restart — stays signed in).
   Resolves once we know who the player is (or that nobody is signed in).
--------------------------------------------------------------------- */
let initPromise = null;
export function initCloud() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const lastGuest = lsGet('lastMode') === 'guest';
    const f = await loadFirebase();
    if (!f) {
      if (lastGuest || !cloudConfigured) await useGuest();
      return getSession();
    }
    await new Promise((resolve) => {
      let first = true;
      f.a.onAuthStateChanged(f.auth, async (fbUser) => {
        if (fbUser) { if (!user || user.uid !== fbUser.uid) await adoptFirebaseUser(fbUser); }
        else if (first && lastGuest) await useGuest();
        else if (!first) { user = null; profile = null; emit(); }
        if (first) { first = false; resolve(); }
      });
    });
    return getSession();
  })();
  return initPromise;
}

async function adoptFirebaseUser(fbUser, seedProfile = null) {
  user = {
    uid: fbUser.uid,
    email: fbUser.email,
    callsign: fbUser.displayName || (fbUser.email ? fbUser.email.split('@')[0] : 'Survivor'),
    isGuest: false,
  };
  lsSet('lastMode', 'account');
  const cached = lsGet(fbUser.uid);
  let remote = null;
  try {
    const snap = await fb.f.getDoc(fb.f.doc(fb.db, 'players', fbUser.uid));
    remote = snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn('[cloud] could not read profile, using local cache', err);
    syncState = 'error';
  }
  // Newest copy wins; a brand-new account can be seeded (guest carry-over).
  let chosen = remote;
  if (cached && (!remote || (cached.updatedAt || 0) > (remote.updatedAt || 0))) chosen = cached;
  if (!chosen && seedProfile) chosen = { ...seedProfile, createdAt: Date.now() };
  profile = normalise(chosen);
  profile.callsign = user.callsign;
  if (!remote || chosen !== remote) await pushProfile();
  else { lsSet(user.uid, profile); syncState = 'synced'; }
  emit();
}

async function useGuest() {
  user = { uid: 'guest', email: null, callsign: 'Guest', isGuest: true };
  profile = normalise(lsGet('guest'));
  profile.callsign = 'Guest';
  syncState = 'local';
  lsSet('lastMode', 'guest');
  emit();
}

async function pushProfile() {
  profile.updatedAt = Date.now();
  if (!user) return;
  lsSet(user.isGuest ? 'guest' : user.uid, profile);
  if (user.isGuest || !fb) { syncState = 'local'; emit(); return; }
  syncState = 'pending'; emit();
  try {
    await fb.f.setDoc(fb.f.doc(fb.db, 'players', user.uid), profile);
    syncState = 'synced';
  } catch (err) {
    console.warn('[cloud] save failed — kept locally, will retry on next save', err);
    syncState = 'error';
  }
  emit();
}

/* ---------------------------------------------------------------------
   Auth actions (used by account.js). Each throws an Error with a
   player-friendly message on failure.
--------------------------------------------------------------------- */
function friendly(err) {
  const code = (err && err.code) || '';
  const map = {
    'auth/invalid-email': 'That email address doesn\'t look right.',
    'auth/missing-password': 'Enter a password.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/email-already-in-use': 'An account with that email already exists — sign in instead.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'No account with that email.',
    'auth/too-many-requests': 'Too many attempts — wait a minute and try again.',
    'auth/network-request-failed': 'No connection to the server. You can play as a guest.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/unauthorized-domain': 'This website isn\'t on the Firebase authorised-domains list yet.',
    'auth/operation-not-allowed': 'That sign-in method isn\'t enabled in the Firebase console.',
  };
  return new Error(map[code] || (err && err.message) || 'Something went wrong.');
}
async function requireFb() {
  const f = await loadFirebase();
  if (!f) throw new Error(cloudConfigured ? 'Can\'t reach the account server right now. Play as a guest?' : 'Online accounts aren\'t set up for this build.');
  return f;
}

export async function signUp(email, password, callsign) {
  const f = await requireFb();
  const name = (callsign || '').trim().slice(0, 20);
  if (!name) throw new Error('Pick a callsign — it\'s shown on the leaderboard.');
  const guestProfile = lsGet('guest');
  try {
    const cred = await f.a.createUserWithEmailAndPassword(f.auth, email.trim(), password);
    await f.a.updateProfile(cred.user, { displayName: name });
    await adoptFirebaseUser(cred.user, guestProfile ? normalise(guestProfile) : null);
  } catch (err) { throw friendly(err); }
}
export async function signIn(email, password) {
  const f = await requireFb();
  try {
    const cred = await f.a.signInWithEmailAndPassword(f.auth, email.trim(), password);
    await adoptFirebaseUser(cred.user);
  } catch (err) { throw friendly(err); }
}
export async function signInWithGoogle() {
  const f = await requireFb();
  try {
    const cred = await f.a.signInWithPopup(f.auth, new f.a.GoogleAuthProvider());
    await adoptFirebaseUser(cred.user);
  } catch (err) { throw friendly(err); }
}
export async function resetPassword(email) {
  const f = await requireFb();
  try { await f.a.sendPasswordResetEmail(f.auth, email.trim()); } catch (err) { throw friendly(err); }
}
export async function playAsGuest() { await useGuest(); }
export async function signOut() {
  if (fb && user && !user.isGuest) await fb.a.signOut(fb.auth);
  user = null; profile = null; syncState = 'local';
  lsSet('lastMode', null);
  emit();
}

/* ---------------------------------------------------------------------
   Game hooks
--------------------------------------------------------------------- */
export async function saveSettings(partial) {
  if (!profile) return;
  profile.settings = { ...profile.settings, ...partial };
  await pushProfile();
}

/**
 * Call once when a run ends. result: 'win' | 'loss'.
 * Returns { newBest, previousBest, leaderboardSubmitted }.
 */
export async function reportRunEnd({ level, result, kills = 0, coins = 0, timeSec = 0 }) {
  if (!profile) await useGuest();
  const key = String(level);
  const L = profile.levels[key] || (profile.levels[key] = blankLevelStats());
  const previousBest = L.bestTimeSec;
  L.plays += 1;
  if (result === 'win') L.wins += 1; else L.losses += 1;
  L.bestKills = Math.max(L.bestKills, kills);
  L.lastPlayed = Date.now();
  let newBest = false;
  if (result === 'win' && timeSec > 0 && (L.bestTimeSec == null || timeSec < L.bestTimeSec)) {
    L.bestTimeSec = Math.round(timeSec * 10) / 10;
    newBest = true;
  }
  profile.totals.kills += kills;
  profile.totals.coins += coins;
  profile.totals.playSeconds += Math.round(timeSec);
  profile.totals.runs += 1;
  await pushProfile();

  let leaderboardSubmitted = false;
  if (newBest && user && !user.isGuest && fb) {
    try {
      await fb.f.setDoc(fb.f.doc(fb.db, 'leaderboards', `level${key}`, 'entries', user.uid), {
        callsign: profile.callsign,
        timeSec: L.bestTimeSec,
        kills,
        at: Date.now(),
      });
      leaderboardSubmitted = true;
    } catch (err) { console.warn('[cloud] leaderboard submit failed', err); }
  }
  return { newBest, previousBest, leaderboardSubmitted, bestTimeSec: L.bestTimeSec };
}

/** Top `n` fastest wins for a level. [] when offline/unconfigured. */
export async function fetchLeaderboard(level, n = 10) {
  const f = await loadFirebase();
  if (!f) return [];
  try {
    const q = f.f.query(
      f.f.collection(f.db, 'leaderboards', `level${level}`, 'entries'),
      f.f.orderBy('timeSec', 'asc'),
      f.f.limit(n),
    );
    const snap = await f.f.getDocs(q);
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  } catch (err) {
    console.warn('[cloud] leaderboard read failed', err);
    return [];
  }
}

export function formatTime(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}
