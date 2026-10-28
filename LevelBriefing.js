/* ======================================================================
   LevelBriefing.js — A LEVEL'S OPENING AS STORY CARDS

   Levels 1 and 2 open the way Level 3 does: a few story cards (the same
   panels, Narrative.js) with what's happening, what to do and the keys,
   instead of a camera fly-through. The fly-throughs lagged, flying the
   camera over a city still streaming in. While a card is up the game
   waits (state.narrativeBlocked, as for any story card); after the last
   one the mouse is captured, ready to play. A restart doesn't replay them.
====================================================================== */
import { createNarrative } from './Narrative.js';
import { state } from './state.js';
import { dom } from './Scene.js';

// [['W A S D', 'Move'], ...] as one line under the card's text
const keyLine = (keys) => keys.map(([key, what]) => `${key}  ${what}`).join('   ·   ');

/** Shows cards [{ id, speaker, title, text, keys? }] one after another. */
export async function playBriefing(cards) {
  const narrative = createNarrative({
    onBlock: (value) => { state.narrativeBlocked = value; state.keys = {}; state.firePressed = false; state.isSprinting = false; },
    onRelease: () => { if (!state.isDead && !state.paused) dom.canvas.requestPointerLock?.()?.catch?.(() => {}); },
  });
  for (const [i, card] of cards.entries()) {
    const text = card.keys ? `${card.text}\n\n${keyLine(card.keys)}` : card.text;
    const answer = await narrative.show({
      id: card.id, mode: 'cinematic', speaker: card.speaker, title: card.title, text,
      continueLabel: i === cards.length - 1 ? 'Go' : 'Next',
    });
    if (answer === null) break; // already seen (a restart)
  }
  narrative.dispose();
}
