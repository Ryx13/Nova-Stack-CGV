/* ======================================================================
   CityLayout.js — THE STREET PLANS FOR EACH DISTRICT

   One plan per district, read by CityGround.js (roads, sidewalks, paving)
   and CityTown.js (buildings, parks, trees, lamps) through layout(), so
   they always agree. The main street (x 0) and its lots stay where the
   level always had them; a plan adds the town around them. The playable
   area is |x| < 78, z -210..40 in every level.

   downtown (Level 1)

     far W   W back      main      E back    far E
     x -98   x -58       x 0       x 70      x 110

     Both back streets, the blocks between them and the main street, and
     the park are in reach; the outer streets and everything north of the
     spawn are the town carrying on past the edge. The city zoo fills the
     west outer block, its gate on the west back street. Two vet clinics,
     one by the zoo, one by the park.

   harbour (Level 2)

     The same back streets, running down to the waterfront: either side of
     the quay a boardwalk with palms, and below it a beach sloping into
     the sea (umbrellas and deck chairs, beach huts and a lifeguard tower
     east; volleyball, picnic tables and dune grass west), a lighthouse
     on the rocks off the west end. Sand drifts thicken on the streets as
     you near it. Harbour Square, a park with a bandstand, takes the open
     lot on the east side of the main street (its wrecks and coin nest
     stay); Gull Park sits at the south end of the west block. A lit glass
     bridge, Harbour Walk, crosses the main street mid-route.

   All roads run the full length of their district, so a later
   difficulty setting can open or close any of them.
====================================================================== */
import { state } from './state.js';

export const SIDEWALK = 3;
export const BOUNDS = { x: 78, zN: 40, zS: -210 };

/* --- downtown (Level 1) --------------------------------------------------- */
const DT_ZOO = { x0: -130, x1: -67, z0: -95, z1: -200, gateZ: -140, gateW: 8 };
const DT_PARK = { x0: 36, x1: 61, z0: -42, z1: -96, kind: 'fountain' };
const DOWNTOWN = {
  // The main street's own surface: sidewalk run, junctions where the
  // street opens to the side, plain crossings, and where the quake hit
  main: {
    zN: 55, zS: -235,
    junctions: [
      // side (+1 east), centre z, width, and how far out from the kerb the
      // side road runs: up to the depot yard's slab (x 29) and the west
      // pocket's lot (x -21.4), which carry on from there
      { side: 1, z: -118, width: 14, reach: 19 },
      { side: -1, z: -55, width: 12, reach: 11.4 },
    ],
    crossings: [14, -182], // by the spawn, by extraction
    cracks: [6, -30, -78, -96, -142, -168],
    heaves: [-34, -100, -164],
    patchZ: [40, -210],
    open: [],
  },
  plaza: { x0: -135, x1: 140, z0: 155, z1: -240 },
  backStreets: [
    { x: -58, halfW: 6, z0: 150, z1: -232 },
    { x: 70, halfW: 6, z0: 150, z1: -232 },
    { x: -98, halfW: 5, z0: 150, z1: -93, far: true },   // stops at the zoo...
    { x: -98, halfW: 5, z0: -202, z1: -232, far: true },  // ...and carries on past it
    { x: 110, halfW: 5, z0: 150, z1: -232, far: true },
  ],
  // East-west links: a road from x0 to x1 at z. `main` skips the main
  // street's own road and sidewalks where it crosses them.
  crossStreets: [
    { z: 48, x0: -64, x1: 76, halfW: 5, main: true },  // the plaza in front of the annex
    { z: -55, x0: -52, x1: -41.4, halfW: 5 },          // the west pocket through to the west street
    { z: -20, x0: -92, x1: -64, halfW: 4 },            // across the west outer block
    { z: -20, x0: 76, x1: 104, halfW: 4 },             // across the east outer block
    { z: -160, x0: 76, x1: 104, halfW: 4 },
  ],
  // Alleys through the inner blocks, from the back of the main street's
  // lots out to the back street
  alleys: [
    { z: 8, x0: -49, x1: -34, halfW: 4 },
    { z: -150, x0: -49, x1: -34, halfW: 4 },
    { z: 0, x0: 34, x1: 61, halfW: 4 },
    { z: -175, x0: 34, x1: 61, halfW: 4 },
  ],
  parks: [DT_PARK],
  zoo: DT_ZOO,
  keepClear: [
    { x0: -42, x1: -20, z0: -44, z1: -66 },   // west pocket lot
    { x0: 28, x1: 64, z0: -99, z1: -137, opens: true }, // depot yard, open onto the east street
    { x0: -60, x1: 60, z0: 92, z1: 52 },      // the annex and its tanks
    DT_PARK,
    { x0: DT_ZOO.x0 - 2, x1: DT_ZOO.x1 + 3, z0: DT_ZOO.z0, z1: DT_ZOO.z1 },
  ],
  // Lots with a particular shop on them: the first lot on that row whose
  // frontage covers z gets these shops, in order along its buildings
  featureLots: [
    { row: 'w-outer', z: -82, shops: ['vet'] },   // by the zoo gate
    { row: 'e-inner', z: -27, shops: ['vet'] },   // by the park
  ],
  // Rows of lots: facade x, facing (+1 / -1 along x, toward the street),
  // depth back from the facade, the run along z, and how much detail
  rows: [
    { id: 'w-inner', facade: -49, face: -1, depth: 13, z0: 150, z1: -205 },               // facing the W street
    { id: 'w-outer', facade: -67, face: 1, depth: 11.5, z0: 150, z1: -232 },              // facing the W street
    { id: 'w-back', facade: -90, face: -1, depth: 11.5, z0: 150, z1: -232, far: true },   // backing onto it, facing far W
    { id: 'w-far', facade: -106, face: 1, depth: 14, z0: 150, z1: -232, far: true },      // beyond far W
    { id: 'e-inner', facade: 61, face: 1, depth: 14, z0: 150, z1: -205 },                 // facing the E street
    { id: 'e-outer', facade: 79, face: -1, depth: 11.5, z0: 150, z1: -232 },              // facing the E street
    { id: 'e-back', facade: 102, face: 1, depth: 11.5, z0: 150, z1: -232, far: true },    // backing onto it, facing far E
    { id: 'e-far', facade: 118, face: -1, depth: 14, z0: 150, z1: -232, far: true },      // beyond far E
  ],
  // Back-street lamp posts (z values never match a main-street post's, so a
  // level's lit list can't confuse them) and the parks' own
  lampZ: [33, 3, -27, -57, -87, -117, -147, -177, -207],
  parkLamps: [[DT_PARK.x0 + 6, -52], [DT_PARK.x0 + 6, -86]],
};

/* --- harbour (Level 2) ---------------------------------------------------- */
const QUAY_Z = -186; // where the back streets meet the waterfront
const HB_SQUARE = {
  x0: 16.4, x1: 47, z0: -102, z1: -165, kind: 'bandstand', name: 'Harbour Square', palms: true,
  // Level 2's wrecks and coin nest stay in the square: keep clear of them
  avoid: [[20, -128], [34, -150], [24, -158], [38, -132], [27, -143], [6, -126]],
  openSide: -1, // the main street side has no hedge
};
const HB_GULL = { x0: -49, x1: -35, z0: -160, z1: -184, kind: 'fountain', name: 'Gull Park', palms: true };
const HB_PROMENADE = [{ x0: -80, x1: -45, beach: 'west' }, { x0: 45, x1: 80, beach: 'east' }]; // either side of the quay
const HARBOUR = {
  main: {
    zN: 55, zS: -188, // the sidewalks stop at the quay
    junctions: [{ side: -1, z: -55, width: 12, reach: 11.4 }],
    crossings: [14, -180],
    cracks: [10, -40, -110, -150],
    heaves: [-20, -140],
    patchZ: [40, -180],
    // Lots on the main street left open: the east side from the depot gap to
    // the end of the old collapse zone is Harbour Square
    open: [{ side: 1, z0: -100, z1: -167 }],
  },
  plaza: { x0: -120, x1: 125, z0: 52, z1: QUAY_Z },
  backStreets: [
    { x: -58, halfW: 6, z0: 52, z1: QUAY_Z },
    { x: 70, halfW: 6, z0: 52, z1: QUAY_Z },
  ],
  crossStreets: [
    { z: 46, x0: -64, x1: 76, halfW: 5, main: true },   // the north end
    { z: -55, x0: -52, x1: -41.4, halfW: 5 },           // the west pocket through to the west street
    { z: -110, x0: 47, x1: 64, halfW: 5 },              // Harbour Square through to the east street
  ],
  alleys: [
    { z: -10, x0: -49, x1: -34, halfW: 4 },
    { z: -128, x0: -49, x1: -34, halfW: 4 },
    { z: -25, x0: 34, x1: 61, halfW: 4 },
  ],
  parks: [HB_SQUARE, HB_GULL],
  // The boardwalk from the quay line to z1, then the beach down into the sea
  promenade: { strips: HB_PROMENADE, z0: QUAY_Z, z1: -192, beachTo: -213 },
  lighthouse: { x: -86, z: -218 },
  sandFrom: -120, // where sand drifts start on the streets
  // The glass bridge across the main street: centre z, deck height at its
  // ends and how much higher its middle arches
  bridge: { z: -86, deckY: 7.4, rise: 1.4, width: 3.6, name: 'HARBOUR WALK' },
  keepClear: [
    { x0: -42, x1: -20, z0: -44, z1: -66 },   // west pocket lot
    HB_SQUARE, HB_GULL,
    ...HB_PROMENADE.map((p) => ({ x0: Math.min(p.x0, p.x1) - 40, x1: Math.max(p.x0, p.x1) + 40, z0: QUAY_Z + 1, z1: -240 })),
  ],
  featureLots: [],
  rows: [
    { id: 'w-inner', facade: -49, face: -1, depth: 13, z0: 50, z1: QUAY_Z },
    { id: 'w-outer', facade: -67, face: 1, depth: 11.5, z0: 50, z1: QUAY_Z },
    { id: 'e-inner', facade: 61, face: 1, depth: 14, z0: 50, z1: QUAY_Z },
    { id: 'e-outer', facade: 79, face: -1, depth: 11.5, z0: 50, z1: QUAY_Z },
  ],
  lampZ: [33, 3, -27, -57, -87, -117, -147, -177],
  parkLamps: [[HB_SQUARE.x1 - 4, -116], [HB_SQUARE.x1 - 4, -152], [HB_GULL.x0 + 3, -172]],
  promenadeLamps: [[-62, -189], [62, -189]], // on the boardwalk
};

const LAYOUTS = { downtown: DOWNTOWN, harbour: HARBOUR };
/** The current level's plan (state.cityKit names the district). */
export function layout() { return LAYOUTS[state.cityKit] || DOWNTOWN; }

const overlaps = (a0, a1, b0, b1) => Math.max(a0, b0) < Math.min(a1, b1);
/** True when a lot (x0..x1 by z1..z0, z0 the north edge) would block a road or open space. */
export function lotBlocked(L, x0, x1, z0, z1) {
  for (const k of L.keepClear) if (overlaps(x0, x1, k.x0, k.x1) && overlaps(z1, z0, k.z1, k.z0)) return true;
  for (const c of [...L.crossStreets, ...L.alleys]) {
    if (overlaps(x0, x1, Math.min(c.x0, c.x1), Math.max(c.x0, c.x1)) && overlaps(z1, z0, c.z - c.halfW - 1, c.z + c.halfW + 1)) return true;
  }
  return false;
}
/** True when a main-street lot (centre x, z) should stay open (a square). */
export function mainLotOpen(x, z) {
  return layout().main.open.some((o) => Math.sign(x) === o.side && z <= o.z0 && z >= o.z1);
}
