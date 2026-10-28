/* ======================================================================
   Difficulty.js — EASY OR IMPOSSIBLE, PICKED BEFORE EVERY LEVEL

   Asked after Day / Night on the way into a level, and again when
   continuing to the next one (main.js launchLevel).

   EASY is the showcase: a real game, but one anyone (a marker, say) can
   play to the very end and see everything in it, the level's design and
   every set piece, without fighting for their life. Nothing is taken out;
   the threats are turned down: a third of the infected, every hit a
   quarter as hard, health that comes back once you're out of trouble,
   ammo that never runs dry, fewer and frailer lions, a girl you can catch,
   a weaker Guardian. IMPOSSIBLE is each level as it was built.

   The levers, on state, which the spawners, the infected and the boss read:
     zombieCountMul   how many come: the spawn rate, the alive cap, the
                      opening crowd, Level 2's escalation and start ambush,
                      Level 3's encounters
     zombieDamageMul  the infected's own hits (left at 1: harmMul covers it)
     harmMul          every hit you take, whatever it's from (damagePlayer)
     bossHealthMul    the Level 3 Guardian's health
     assist           Easy's help (Actions.js updateAssist): health back
                      after regenAfterMs out of harm, ammo topped up
   A restart keeps the choice (these aren't per-run state).
====================================================================== */
import { state } from './state.js';

// Easy's help, the same on every level
const SHOWCASE = { zombieCountMul: 0.35, zombieDamageMul: 1, harmMul: 0.25, assist: { regen: 6, regenAfterMs: 4000, ammoFloor: 30, ammoEvery: 1.2 } };
const AS_BUILT = { zombieCountMul: 1, zombieDamageMul: 1, harmMul: 1, assist: null };
export const DIFFICULTIES = {
  1: {
    easy:       { ...SHOWCASE, sub: 'See the whole level: few infected, weak hits, health and ammo come back' },
    impossible: { ...AS_BUILT, sub: 'A full street, every hit at full strength' },
  },
  2: {
    easy:       { ...SHOWCASE, sub: 'See the whole chase: few infected, weak hits, a girl you can catch' },
    impossible: { ...AS_BUILT, sub: 'The chase as it was built: find her first' },
  },
  3: {
    easy:       { ...SHOWCASE, bossHealthMul: 0.45, sub: 'See the whole mission: few infected, weak hits, a weaker Guardian' },
    impossible: { ...AS_BUILT, bossHealthMul: 1, sub: 'The final mission as it was built' },
  },
};

/** Sets a level's difficulty on state (after its config module has loaded). */
export function applyDifficulty(levelId, id) {
  const d = DIFFICULTIES[levelId]?.[id];
  if (!d) return;
  state.difficulty = id;
  state.zombieCountMul = d.zombieCountMul;
  state.zombieDamageMul = d.zombieDamageMul;
  state.harmMul = d.harmMul;
  state.bossHealthMul = d.bossHealthMul ?? 1;
  state.assist = d.assist;
}

/** A small EASY / IMPOSSIBLE chip in the HUD (so it shows only in play),
    top right under the sound button. */
export function showDifficultyBadge() {
  const hud = document.getElementById('hud');
  if (!hud) return;
  let chip = document.getElementById('difficulty-badge');
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'difficulty-badge';
    chip.style.cssText = 'position:fixed;top:58px;right:16px;padding:3px 10px;font:600 11px/1.4 Oswald,sans-serif;'
      + 'letter-spacing:2px;text-transform:uppercase;border:1px solid;border-radius:3px;background:rgba(0,0,0,.45);pointer-events:none;';
    hud.appendChild(chip);
  }
  const easy = state.difficulty === 'easy';
  chip.textContent = easy ? 'Easy' : 'Impossible';
  chip.style.color = easy ? '#9fd88a' : '#ff6b5e';
  chip.style.borderColor = easy ? 'rgba(159,216,138,.6)' : 'rgba(255,107,94,.6)';
}

/** The choice screen, styled like Day / Night (mode-card). Resolves 'easy'
    or 'impossible', or null for Back (only offered when canGoBack). */
export function chooseDifficulty(levelId, { canGoBack = true } = {}) {
  const levels = DIFFICULTIES[levelId] || DIFFICULTIES[1];
  return new Promise((resolve) => {
    const screen = document.createElement('div');
    screen.id = 'difficulty-select';
    screen.style.cssText = 'position:fixed;inset:0;z-index:56;background:#050505;display:flex;flex-direction:column;'
      + 'align-items:center;justify-content:center;gap:34px;animation:fadeUp .45s ease both;padding:0 16px;';
    screen.innerHTML = `
      ${canGoBack ? '<button type="button" class="back-arrow" aria-label="Back to Day / Night">← Back</button>' : ''}
      <h1 style="font-family:'Oswald',sans-serif;font-weight:700;letter-spacing:6px;font-size:clamp(22px,4vw,32px);color:#f2ede2;margin:0;text-transform:uppercase;text-align:center">Choose Your Difficulty</h1>
      <div style="display:flex;gap:26px;flex-wrap:wrap;justify-content:center">
        <div class="mode-card" data-difficulty="easy" style="background:linear-gradient(180deg,rgba(120,170,110,.16),rgba(120,170,110,.03))">
          <div class="mode-icon">🩹</div><div>Easy</div><div class="mode-sub">${levels.easy.sub}</div>
        </div>
        <div class="mode-card" data-difficulty="impossible" style="background:linear-gradient(180deg,rgba(178,34,34,.22),rgba(178,34,34,.04))">
          <div class="mode-icon">☠️</div><div>Impossible</div><div class="mode-sub">${levels.impossible.sub}</div>
        </div>
      </div>`;
    const done = (value) => { screen.remove(); resolve(value); };
    for (const card of screen.querySelectorAll('[data-difficulty]')) {
      card.addEventListener('click', () => done(card.dataset.difficulty), { once: true });
      card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)'; card.style.borderColor = '#f2ede2'; });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; card.style.borderColor = ''; });
    }
    screen.querySelector('.back-arrow')?.addEventListener('click', () => done(null), { once: true });
    document.body.appendChild(screen);
  });
}
