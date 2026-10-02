# Accounts & cloud save — setup (about 10 minutes, free)

The department server only serves static files, so the game can't run its
own login server or database. Instead the browser talks directly to
**Firebase** (Google), whose free *Spark* plan covers accounts and a
database with no credit card. Until you do the steps below the game runs
in **offline/guest mode** — fully playable, progress saved in the browser.

## 1. Create the project
1. Go to <https://console.firebase.google.com> → **Create a project**
   (name it e.g. `deadway-city`). Google Analytics: off.
2. **Build → Authentication → Get started**. Enable:
   - **Email/Password**
   - **Google** (optional — the "Continue with Google" button)
3. **Authentication → Settings → Authorised domains** → add the domain
   of the department LAMP server (just the host, e.g. `lamp.ms.wits.ac.za`
   — check the real one on Moodle). `localhost` is already there.
   Google sign-in will fail on any domain not in this list.
4. **Build → Firestore Database → Create database** → production mode →
   pick a nearby location (e.g. `africa-south1`, Johannesburg).
5. **Firestore → Rules** → paste the contents of `firestore.rules` →
   **Publish**. This is what stops one player reading or overwriting
   another's save.

## 2. Connect the game
1. **Project settings (gear) → General → Your apps → Web (`</>`)** →
   register an app (no hosting needed).
2. Copy the `firebaseConfig` object it shows into `firebase-config.js`,
   replacing the placeholder.
3. Serve locally (`python3 -m http.server 8000`), open
   <http://localhost:8000>, click **Enter the City** → **Create account**.
   In the Firestore console you should now see `players/<your uid>`.
   Finish a level and a `leaderboards/level1/entries/<uid>` doc appears.

The config values are not secrets — every Firebase web app exposes them.
Security comes from the rules.

## What is stored
| Path | Contents | Who can read / write |
|---|---|---|
| `players/{uid}` | callsign, settings, per-level plays/wins/losses/best time/best kills, lifetime totals | that player only |
| `leaderboards/level{n}/entries/{uid}` | callsign, best winning time, kills | everyone reads; owner writes |

Every save is also cached in `localStorage`, so a dropped connection mid-
demo never loses a run; it syncs on the next successful save. Guest
progress carries over when a guest later creates an account.

## Free-tier limits (Spark plan)
Firestore: 1 GiB stored, 50k reads / 20k writes per day. Auth: tens of
thousands of monthly users. A class demo uses a tiny fraction of this.
Check the current numbers at <https://firebase.google.com/pricing>.

## Known limitation (say it in the demo before they ask)
Run times are measured in the browser, so a determined player could
submit a fake time with dev tools. The rules reject malformed entries and
times under 10 s, but true anti-cheat needs server-side validation
(Cloud Functions), which is not on the free plan.

## Files
- `firebase-config.js` — your project's config
- `cloud.js` — Firebase/localStorage persistence, auth calls, leaderboard
- `account.js` — sign-in screen, account chip, leaderboard screen, end-of-run summary
- `firestore.rules` — database security rules
