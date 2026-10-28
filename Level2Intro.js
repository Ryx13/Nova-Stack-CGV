/* ======================================================================
   Level2Intro.js — THE BRIEFING BEFORE THE CHASE

   Story cards, as Level 3 opens (LevelBriefing.js): the girl and how to
   catch her, the chase, fighting, the two supply machines and the port.
   It replaced a camera fly-through that lagged. Level2.js holds the chase
   (holdForIntro: state.cinematic) until the last card, then onDone
   springs the start ambush.
====================================================================== */
import { state } from './state.js';
import { playBriefing } from './LevelBriefing.js';

/** From level load: the chase waits for the briefing. */
export function holdForIntro() {
  state.cinematic = true;
}

/** Once the loading screen is gone and the girl is in. */
export function playIntro({ prices, onDone }) {
  // Impossible: she hides instead of running, and the radar is round the corner
  const hunt = state.difficulty === 'impossible';
  void playBriefing([
    hunt ? {
      id: 'lv2-girl', speaker: 'BRIEFING / THE TARGET', title: 'The girl from CAM 03',
      text: "She has your stabilizer. She's half-turned and using it to stay human, so the infected leave her alone. She's gone to ground somewhere near the start of the street, and she can't be reached where she hides.\n\nGet the radar to find her. Come within 20 m and she'll smell you and run for her boat: catch her before she reaches it, right next to her, E.",
      keys: [['E', 'Catch her']],
    } : {
      id: 'lv2-girl', speaker: 'BRIEFING / THE TARGET', title: 'The girl from CAM 03',
      text: "She has your stabilizer. She's half-turned and using it to stay human, so the infected leave her alone. Catch her before her boat leaves: get right next to her and press E.",
      keys: [['E', 'Catch her']],
    },
    {
      id: 'lv2-chase', speaker: 'BRIEFING / THE STREET', title: 'Chase her down',
      text: `${hunt ? 'Once she runs, she heads' : 'She runs ahead'} through the town. Keep her in sight and close the gap. Her boat is waiting at the pier: if she reaches it, she's gone.`,
      keys: [['W A S D', 'Move'], ['Mouse', 'Look'], ['Shift + W', 'Sprint'], ['Space', 'Jump'], ['C', 'Crouch']],
    },
    {
      id: 'lv2-infected', speaker: 'BRIEFING / THE INFECTED', title: 'Fight your way through',
      text: "The small ones are much faster than you. You can't outrun them, so keep fighting. Push ahead and they'll be waiting for you. Kills drop coins, and coins buy supplies.",
      keys: [['Left click', 'Shoot'], ['Right click', 'Melee'], ['R', 'Reload'], ['Q', 'Gun / Knife']],
    },
    {
      id: 'lv2-supplies', speaker: 'BRIEFING / SUPPLIES', title: 'Two machines on the way',
      text: [
        hunt
          ? `Radar machine: somewhere off the main street, a different place every time: a side street, a back street, by Harbour Square. Look for its lime glow. A radar costs ${prices.radar} coins and shows you where she is.`
          : `Radar machine: just up the road on the west side, glowing lime. A radar costs ${prices.radar} coins and tracks her on your radar and compass.`,
        `Adrenaline machine: off the main road, down the side street to the west, glowing pink. A shot costs ${prices.adrenaline} coins and gives a 3 second burst of speed. Buy as many as you can afford.`,
      ].join('\n\n'),
      keys: [['E', 'Buy (at the machine)'], ['G', 'Use adrenaline']],
    },
  ]).then(() => {
    state.cinematic = false;
    onDone?.();
  });
}

/** Every frame while held: nothing to animate now (the cards are HTML). */
export function updateIntro() {}
