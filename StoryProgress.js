// Story choices that outlive a level. Levels switch by reloading the page,
// so they live in localStorage; the story still reads fine without it.
const GIRL_KEY = 'deadway.story.girl';

// 'caught' — the player stopped her in Level 2 and she came back to the
// safe room; 'escaped' — she made her boat. null — no Level 2 run yet.
export function setGirlOutcome(outcome) {
  try { localStorage.setItem(GIRL_KEY, outcome); } catch { /* storage blocked */ }
}
export function getGirlOutcome() {
  try { return localStorage.getItem(GIRL_KEY); } catch { return null; }
}
