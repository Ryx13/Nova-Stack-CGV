/* ======================================================================
   Level1Intro.js — THE BRIEFING BEFORE LEVEL 1

   Story cards, as Level 3 opens (LevelBriefing.js), once the loading
   screen clears: who you are and why you're out here, clearing the
   street, fighting, and the route (supply cache, car, depot, extraction).
   It replaced a camera fly-through that lagged.
====================================================================== */
import { registerLevelTick } from './Actions.js';
import { state } from './state.js';
import { playBriefing } from './LevelBriefing.js';

const CARDS = [
  {
    id: 'lv1-you', speaker: 'DR. JAMES / SECURE CHANNEL', title: 'This is you',
    text: "The outbreak caught you on a delivery. Dr. James can't leave the safe room, and his cure needs two things: a culture sample from this street, and the stabilizer you dropped. The sample comes first.",
  },
  {
    id: 'lv1-street', speaker: 'BRIEFING / THE STREET', title: 'Fight through the street',
    text: 'Infected fill the road ahead. Take down 10 of them to clear the route.',
    keys: [['W A S D', 'Move'], ['Mouse', 'Look'], ['Shift + W', 'Sprint'], ['Space', 'Jump'], ['C', 'Crouch']],
  },
  {
    id: 'lv1-infected', speaker: 'BRIEFING / THE INFECTED', title: 'They come at you',
    text: 'Shoot them, or finish them with the knife. Kills can drop health, ammo and shields, so keep moving.',
    keys: [['Left click', 'Shoot'], ['Right click', 'Melee'], ['R', 'Reload'], ['Q', 'Gun / Knife']],
  },
  {
    id: 'lv1-route', speaker: 'BRIEFING / YOUR ROUTE', title: 'The sample, then out',
    text: [
      'Supply cache: a side lot west of the street hides a health or ammo drop. Worth a detour if you are running low.',
      "Your ride: there's a car parked just ahead. Get in to cover ground fast, get out to fight.",
      'The depot: follow the amber glow east, off the main road. Infected guard the yard. Walk into the marker to take the culture sample.',
      'Extraction: then run the sample to the green marker at the far end of the street.',
    ].join('\n\n'),
    keys: [['F', 'Enter / exit car']],
  },
];

let started = false;
export function startLevel1Intro() {
  registerLevelTick(() => {
    if (started || !state.readyShown) return; // behind the loading screen
    started = true;
    void playBriefing(CARDS);
  });
}
