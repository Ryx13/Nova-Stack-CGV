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
      id: 'lv2-girl', speaker: 'BRIEFING / THE TARGET', title: 'Find the girl with your case',
      text: "The entrance camera showed her taking your case. She has your stabilizer. She's half-turned and using it to stay human, so the infected leave her alone. She's hiding inside one of the buildings out in the far parts of town, and she won't come out for you.\n\nGet the radar first: until you have it she stays hidden, even if you walk right past her. Then go in after her, and expect a fight on the way. Get close and she'll smell you and run for her boat: catch her before she reaches it, right next to her, E.",
      keys: [['E', 'Catch her']],
    } : {
      id: 'lv2-girl', speaker: 'BRIEFING / THE TARGET', title: 'Find the girl with your case',
      text: "The entrance camera showed her taking your case. She has your stabilizer. She's half-turned and using it to stay human, so the infected leave her alone. Catch her before her boat leaves: get right next to her and press E.",
      keys: [['E', 'Catch her']],
    },
    {
      id: 'lv2-chase', speaker: 'BRIEFING / THE STREET', title: 'Chase her down',
      text: `${hunt ? 'Once she runs, she heads' : 'She runs ahead'} through the town. Keep her in sight and close the gap: past the glass bridge she starts to tire. Her boat is waiting at the pier: if she reaches it, she's gone.`,
      keys: [['W A S D', 'Move'], ['Mouse', 'Look'], ['Shift + W', 'Sprint'], ['Space', 'Jump'], ['C', 'Crouch']],
    },
    {
      id: 'lv2-infected', speaker: 'BRIEFING / THE INFECTED', title: 'Fight your way through',
      text: [
        "Most of them shamble, but the runners are much faster than you. You can't outrun those, so keep fighting. Push ahead and they'll be waiting for you. Kills drop coins, and coins buy supplies.",
        ...(hunt ? ["Off the main street they're worse: green-tinged, in packs that come at you together, and each takes three hits to put down. One in a pack carries a yellow ammo bag: drop it and it leaves ammo instead of a coin."] : []),
        'Your gun holds 8 rounds and reloads one round at a time. Fire to stop reloading early.',
      ].join('\n\n'),
      keys: [['Left click', 'Shoot'], ['Right click', 'Melee'], ['R', 'Reload'], ['Q', 'Gun / Knife']],
    },
    {
      id: 'lv2-supplies', speaker: 'BRIEFING / SUPPLIES', title: 'Two machines on the way',
      text: [
        hunt
          ? `Radar machine: somewhere off the main street, a different place every time, out in the back streets. ${state.riddleWhere === 'board' ? 'A survivor painted a riddle on a board near the start' : `Someone left a riddle written in blood across ${state.riddleShop || 'the shop window'} on your ${state.riddleWhere}, just ahead of where you start`}: work out where it means, and look for the lime glow. A radar costs ${prices.radar} coins and shows you where she is.`
          : `Radar machine: just up the road on the west side, glowing lime. A radar costs ${prices.radar} coins and tracks her on your radar and compass.`,
        `Adrenaline machine: off the main road, down the side street to the west, glowing pink. A shot costs ${prices.adrenaline} coins and gives a ${prices.adrenalineSeconds} second burst of speed. It holds ${prices.adrenalineStock}, so save them for when they count.`,
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
