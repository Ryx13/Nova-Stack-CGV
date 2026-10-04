/* ======================================================================
   credits.js — IN-GAME CREDITS SCREEN

   Everything in DEADWAY CITY that the team did NOT make itself, as the
   brief requires: what it is, where it came from, and its licence.

   HOW TO MAINTAIN THIS
   - Add an entry the moment you add a third-party file, library, shader
     snippet or tutorial — not the night before submission.
   - Any entry with `confirm: true` is one where the source could not be
     worked out from the file itself. It shows an amber "TEAM TO CONFIRM"
     tag in-game and a console warning, so it can't be forgotten. Fill in
     the real source/licence and delete the flag before you submit.
   - Only credit assets that actually ship. If you delete an unused file
     from assets/, delete its entry here too.

   Sketchfab entries below were read straight out of each .glb's own
   embedded metadata (asset.extras: author / licence / source URL), so
   they are exact.
====================================================================== */

export const CREDITS = [
  {
    section: 'Libraries & frameworks',
    items: [
      {
        name: 'three.js (r160)',
        what: 'Rendering, scene graph, materials, cameras, animation mixer.',
        author: 'Ricardo Cabello (mrdoob) and three.js contributors',
        source: 'https://threejs.org — loaded from unpkg.com',
        licence: 'MIT',
      },
      {
        name: 'three.js add-ons: GLTFLoader, SkeletonUtils, RoundedBoxGeometry',
        what: 'Loading .glb models, cloning skinned zombie rigs, vending machine body.',
        author: 'three.js contributors',
        source: 'https://github.com/mrdoob/three.js/tree/r160/examples/jsm',
        licence: 'MIT',
      },
      {
        name: 'cannon-es (0.20.0)',
        what: 'Physics: player body, collisions, RaycastVehicle for the drivable truck.',
        author: 'pmndrs, based on cannon.js by Stefan Hedman (schteppe)',
        source: 'https://github.com/pmndrs/cannon-es',
        licence: 'MIT',
      },
      {
        name: 'Firebase JavaScript SDK (Auth + Cloud Firestore)',
        what: 'Player accounts, cloud save and the online leaderboard.',
        author: 'Google',
        source: 'https://github.com/firebase/firebase-js-sdk — loaded from gstatic.com',
        licence: 'Apache-2.0',
      },
    ],
  },
  {
    section: 'Fonts',
    items: [
      {
        name: 'Oswald',
        what: 'Titles and headings.',
        author: 'Vernon Adams, Kalapi Gajjar, Cyreal',
        source: 'https://fonts.google.com/specimen/Oswald',
        licence: 'SIL Open Font License 1.1',
      },
      {
        name: 'Rajdhani',
        what: 'HUD and body text.',
        author: 'Indian Type Foundry',
        source: 'https://fonts.google.com/specimen/Rajdhani',
        licence: 'SIL Open Font License 1.1',
      },
    ],
  },
  {
    section: '3D models',
    items: [
      {
        name: 'ZOMBIE PICKUP TRUCK',
        what: 'The drivable truck (zombie_pickup_truck.glb).',
        author: 'seangorman',
        source: 'https://sketchfab.com/3d-models/zombie-pickup-truck-23708528454e43b58e02d78fd427c240',
        licence: 'CC BY 4.0',
      },
      {
        name: 'Old Rusty Car 2',
        what: 'Parked wreck decoration (old_rusty_car_2.glb).',
        author: 'Renafox',
        source: 'https://sketchfab.com/3d-models/old-rusty-car-2-544aa41de67b48cf89f8fcc2bb06e8f4',
        licence: 'CC BY-NC 4.0 (non-commercial use only)',
      },
      {
        name: 'Pistol',
        what: 'Player sidearm, first and third person (pistol.glb).',
        author: 'DJMaesen',
        source: 'https://sketchfab.com/3d-models/pistol-5f6ec54257de449cacc8c872660b40d3',
        licence: 'CC BY 4.0',
      },
      {
        name: 'Crate box',
        what: 'Depot sample crate and decorative crates (crate_box.glb).',
        author: 'KloWorks',
        source: 'https://sketchfab.com/3d-models/crate-box-e1a6856037c54d0d9019aedf61315569',
        licence: 'CC BY 4.0',
      },
      {
        name: 'Barrel',
        what: 'Explosive barrels (barrel.glb).',
        author: 'Arrangemonk',
        source: 'https://sketchfab.com/3d-models/barrel-0aaa1d37b15f419a97a3368f09f058f5',
        licence: 'CC BY 4.0',
      },
      {
        name: 'Timeframe Explosion',
        what: 'Animated barrel explosion effect (timeframe_explosion.glb).',
        author: 'Jorma Rysky (Joona Venäläinen)',
        source: 'https://sketchfab.com/3d-models/timeframe-explosion-9e73437350dc4bcab9b2f3a4a044b16e',
        licence: 'CC BY 4.0',
      },
      {
        name: 'Zombie Running on metel maniac',
        what: 'Runner zombie and decorative corpses (zombie_running_on_metel_maniac.glb).',
        author: 'cool guy (engantogs)',
        source: 'https://sketchfab.com/3d-models/zombie-running-on-metel-maniac-af62be9d89944c2eb99d6e8f9e3d344c',
        licence: 'CC BY 4.0',
      },
      {
        name: 'Player character',
        what: 'Rigged player body with its animation set (player_character.glb).',
        author: 'Exported from Mesh2Motion — base model and clip library from Mesh2Motion',
        source: 'https://mesh2motion.org',
        licence: 'Check Mesh2Motion\'s licence for the model/animations used',
        confirm: true,
      },
      {
        name: 'Walker zombie (model-rigged.glb) and zombie variant (zombie_variant_b.glb)',
        what: 'Main street zombie with walk_relaxed clip; second variant used as set dressing.',
        author: 'Unknown — exported via trimesh / THREE.GLTFExporter (looks AI-generated or auto-rigged)',
        source: 'Name the tool or site these came from (e.g. Meshy, Tripo, Mixamo auto-rigger)',
        licence: 'Per that tool\'s terms of use',
        confirm: true,
      },
    ],
  },
  {
    section: 'Animation',
    items: [
      {
        name: 'Mixamo animation clips',
        what: 'Walking, rifle run, strafes, start/stop, jumps, firing rifle, dying (14 clips in assets/), and the Level 2 runner\'s Injured Run.',
        author: 'Adobe Mixamo',
        source: 'https://www.mixamo.com',
        licence: 'Royalty-free under the Adobe/Mixamo terms of use (no attribution required, credited anyway)',
      },
    ],
  },
  {
    section: 'Images',
    items: [
      {
        name: 'Title screen key art (splash1.jpg)',
        what: 'Background of the title screen.',
        author: 'Who made it? If an AI image generator, name the tool.',
        source: '—',
        licence: '—',
        confirm: true,
      },
    ],
  },
  {
    section: 'Shader code & techniques adapted',
    items: [
      {
        name: 'Shadertoy bloom/glow pass',
        what: 'Basis for the shield bubble\'s Fresnel glow shader (shaders.js).',
        author: 'Add the Shadertoy author',
        source: 'Add the shadertoy.com/view/… URL',
        licence: 'Shadertoy default: CC BY-NC-SA 3.0 unless the author states otherwise',
        confirm: true,
      },
      {
        name: 'Shadertoy rain-sheet shader',
        what: 'Basis for the Day-mode drizzle shader (shaders.js).',
        author: 'Add the Shadertoy author',
        source: 'Add the shadertoy.com/view/… URL',
        licence: 'Shadertoy default: CC BY-NC-SA 3.0 unless the author states otherwise',
        confirm: true,
      },
      {
        name: 'Hash-based value noise and fBm',
        what: 'Noise used by the fog, fire, puddle and toxic shaders.',
        author: 'Patricio Gonzalez Vivo & Jen Lowe, The Book of Shaders (ch. 11–13)',
        source: 'https://thebookofshaders.com/11/',
        licence: 'Widely used technique; credited as reference',
      },
      {
        name: 'RaycastVehicle setup',
        what: 'Reference for the truck\'s suspension, steering and braking.',
        author: 'cannon-es examples',
        source: 'https://pmndrs.github.io/cannon-es/examples/raycast_vehicle',
        licence: 'MIT',
      },
    ],
  },
  {
    section: 'Tools & assistance',
    items: [
      {
        name: 'AI coding assistance',
        what: 'Parts of the code and documentation were written or debugged with an AI assistant. Say which tool and for what.',
        author: 'e.g. Claude (Anthropic)',
        source: 'https://claude.ai',
        licence: '—',
        confirm: true,
      },
      {
        name: 'Blender',
        what: 'Converting/retargeting FBX animation files to .glb.',
        author: 'Blender Foundation',
        source: 'https://www.blender.org',
        licence: 'GPL (tool only — output files are ours)',
      },
    ],
  },
];

/* What the team made itself — shown at the top so the credits also make
   the case for Innovation, not just list other people's work. Edit freely. */
export const TEAM_MADE = [
  'All game code, level design and mission logic for Levels 1–3',
  'Custom GLSL shaders: shield, fog, rain, fire, puddles, toxic sludge',
  'Every sound effect — synthesised live with the Web Audio API, no audio files',
  'Procedural city: buildings, road and sidewalk canvas textures, street props',
  'Vending machine and supply catalogue system, procedural item icons',
];

export const TEAM_NAME = 'Nova Stack';
export const TEAM_MEMBERS = []; // e.g. ['Name Surname — role', …]

/* ---------------------------------------------------------------------
   RENDERING
--------------------------------------------------------------------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s—]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

let overlay = null;
let onCloseCb = null;

function build() {
  overlay = document.createElement('div');
  overlay.id = 'credits-screen';
  overlay.className = 'hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Credits');

  const unconfirmed = CREDITS.flatMap((s) => s.items).filter((i) => i.confirm);
  if (unconfirmed.length) {
    console.warn(`[credits] ${unconfirmed.length} entries still marked "TEAM TO CONFIRM":`,
      unconfirmed.map((i) => i.name));
  }

  const sections = CREDITS.map((s) => `
    <section class="cr-section">
      <h2>${esc(s.section)}</h2>
      ${s.items.map((i) => `
        <div class="cr-item">
          <div class="cr-name">${esc(i.name)}${i.confirm ? ' <span class="cr-confirm">TEAM TO CONFIRM</span>' : ''}</div>
          <div class="cr-what">${esc(i.what)}</div>
          <div class="cr-meta"><span>By</span> ${linkify(i.author)}</div>
          <div class="cr-meta"><span>From</span> ${linkify(i.source)}</div>
          <div class="cr-meta"><span>Licence</span> ${esc(i.licence)}</div>
        </div>`).join('')}
    </section>`).join('');

  overlay.innerHTML = `
    <div class="cr-panel">
      <header class="cr-head">
        <h1>CREDITS</h1>
        <button class="cr-close" aria-label="Close credits">✕</button>
      </header>
      <div class="cr-scroll">
        <section class="cr-section cr-team">
          <h2>Made by ${esc(TEAM_NAME)}</h2>
          ${TEAM_MEMBERS.length ? `<div class="cr-members">${TEAM_MEMBERS.map(esc).join('<br>')}</div>` : ''}
          <ul>${TEAM_MADE.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        </section>
        ${sections}
        <p class="cr-foot">COMS3006A / COMS3025A Computer Graphics &amp; Visualisation · University of the Witwatersrand.<br>
        CC BY licences require attribution, which this screen provides. No changes were made to licensed models beyond scaling, re-posing and format conversion unless noted.</p>
      </div>
      <footer class="cr-hint">Esc or ✕ to close</footer>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('.cr-close').addEventListener('click', closeCredits);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCredits(); });
  window.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('hidden') && e.code === 'Escape') { e.stopPropagation(); closeCredits(); }
  }, true);
}

export function openCredits(onClose) {
  if (!overlay) build();
  onCloseCb = onClose || null;
  if (document.pointerLockElement) document.exitPointerLock();
  overlay.classList.remove('hidden');
  overlay.querySelector('.cr-scroll').scrollTop = 0;
  overlay.querySelector('.cr-close').focus();
}

export function closeCredits() {
  if (!overlay) return;
  overlay.classList.add('hidden');
  const cb = onCloseCb; onCloseCb = null;
  if (cb) cb();
}

/* Any element with [data-open-credits] opens the screen. */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-open-credits]');
  if (t) { e.preventDefault(); openCredits(); }
});
