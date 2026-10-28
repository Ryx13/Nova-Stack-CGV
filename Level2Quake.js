/* ======================================================================
   Level2Quake.js — THE AFTERSHOCK UNDER HARBOUR WALK (Level 2)

   Mid-route, the first time you pass under the glass bridge, an aftershock
   hits:
     0.0 s  the ground rumbles (cameraQuake) with a low roar; the windows
            round the bridge crack and the nearest shatter
     1.0 s  the bridge's glass gives way and comes down on the street with
            chunks of its concrete, and a wave of dust rolls out both ways
            along the street; if you're still under it, it cuts you
     1.9 s  on Easy, Dr. James on the radio: run, the animals are coming
     2.6 s  the shaking has broken the zoo open: its infected animals are out
            (ZooAnimals.js), coming in from the west side street
   Once a run; a restart puts the glass back and the animals away.
====================================================================== */
import * as THREE from 'three';
import { sfx, pushKillFeed, STREET_HALF_W } from './Scene.js';
import { state } from './state.js';
import { damagePlayer } from './Actions.js';
import { playerVis } from './characters.js';
import { FEATURE_SPOTS } from './CityKit.js';
import { cameraQuake } from './CameraShock.js';
import { shakeGlass, rainGlass, collapseFX } from './ImpactFX.js';
import { createZooAnimals } from './ZooAnimals.js';
import { createNarrative } from './Narrative.js';

const TRIGGER_M = 4;        // this close to the bridge's line, on the street
const QUAKE_S = 3.2;
const GLASS_AT = 1.0, WARNING_AT = 1.9, ANIMALS_AT = 2.6; // s into the quake
const GLASS_LANDS = 0.9;    // s for it to come down from the deck
const GLASS_DAMAGE = 14;
const UNDER_M = 2.6;        // either side of the bridge's line: where it lands

export function createLevel2Quake() {
  const animals = createZooAnimals();
  state.extraShotTargets = [animals];
  // Dr. James's warning comes over the radio, not a card: the game doesn't stop
  const radio = createNarrative();
  let phase = 'waiting', t = 0, cut = false, warned = false, run = 0; // run: a fresh id each time (the radio shows an id once)
  const glass = () => {
    const out = [];
    FEATURE_SPOTS.bridge?.group.traverse((o) => { if (o.isMesh && o.material?.userData?.glass) out.push(o); });
    return out;
  };
  const under = (B, p) => Math.abs(p.z - B.z) < UNDER_M && Math.abs(p.x) < B.span / 2;

  function start(B) {
    phase = 'shaking';
    t = 0;
    cameraQuake(QUAKE_S, 1);
    state.shake = Math.max(state.shake, 0.06);
    sfx.noise(QUAKE_S, 0.24, 48); // the roar of the ground
    sfx.noise(2.2, 0.1, 120);
    shakeGlass(new THREE.Vector3(0, 3, B.z), 18);
    pushKillFeed('AFTERSHOCK — get out from under the bridge!');
  }

  return {
    update(dt) {
      const p = playerVis.group.position;
      animals.update(dt, p);
      if (!state.paused) radio.update(dt);
      const B = FEATURE_SPOTS.bridge;
      if (!B || state.paused || state.isDead || state.cinematic || state.narrativeBlocked) return;
      if (phase === 'waiting') {
        if (Math.abs(p.z - B.z) < TRIGGER_M && Math.abs(p.x) < STREET_HALF_W + 3) start(B);
        return;
      }
      if (phase === 'done') return;
      t += dt;
      if (phase === 'shaking' && t >= GLASS_AT) {
        // The vault and the stair towers' glass give way
        for (const m of glass()) m.visible = false;
        rainGlass(-B.span / 2, B.span / 2, B.z, B.deckY + 1.2, 56);
        collapseFX(B.z, B.span / 2, B.deckY);
        phase = 'falling';
      }
      // Easy: Dr. James warns you what's coming
      if (!warned && t >= WARNING_AT && state.difficulty === 'easy') {
        warned = true;
        radio.show({ id: `james-animals-warning-${run}`, mode: 'radio', speaker: 'DR. JAMES / SECURE CHANNEL', title: 'Run!',
          text: "That quake broke the zoo open. The animals are loose and they're coming your way. Run!", duration: 6 });
      }
      if (phase === 'falling') {
        if (!cut && t >= GLASS_AT + GLASS_LANDS) {
          cut = true;
          if (under(B, p)) { damagePlayer(GLASS_DAMAGE); pushKillFeed('Falling glass!'); }
        }
        if (t >= ANIMALS_AT) {
          animals.release();
          sfx.noise(0.9, 0.14, 140);
          pushKillFeed('The quake broke the zoo open — the animals are in the street!');
          phase = 'done';
        }
      }
    },
    reset() {
      phase = 'waiting';
      t = 0;
      cut = false;
      warned = false;
      run++;
      for (const m of glass()) m.visible = true;
      animals.reset();
    },
  };
}
