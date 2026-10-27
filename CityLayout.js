/* ======================================================================
   CityLayout.js — THE DOWNTOWN STREET PLAN (Level 1)

   One plan read by CityGround.js (the roads, sidewalks and paving) and
   CityTown.js (the buildings, park, trees and lamps), so they always
   agree. The main street (x 0) and its lots stay exactly as they were;
   this adds the town around them:

     far W   W back      main      E back    far E
     x -98   x -58       x 0       x 70      x 110

   The playable area is |x| < 78, z -210..40, so both back streets, the
   blocks between them and the main street, and the park are reachable;
   the outer streets and everything north of the spawn are the town
   carrying on past the edge. All roads run the full length, so a later
   difficulty setting can open or close any of them.
====================================================================== */
export const SIDEWALK = 3;
export const BOUNDS = { x: 78, zN: 40, zS: -210 };

// North-south streets besides the main one
export const BACK_STREETS = [
  { x: -58, halfW: 6, z0: 150, z1: -232 },
  { x: 70, halfW: 6, z0: 150, z1: -232 },
  { x: -98, halfW: 5, z0: 150, z1: -232, far: true },
  { x: 110, halfW: 5, z0: 150, z1: -232, far: true },
];

// East-west links: a road from x0 to x1 at z. `main` skips the main
// street's own road and sidewalks where it crosses them.
export const CROSS_STREETS = [
  { z: 48, x0: -64, x1: 76, halfW: 5, main: true },  // the plaza in front of the annex
  { z: -55, x0: -52, x1: -41.4, halfW: 5 },          // the west pocket through to the west street
  { z: -20, x0: -92, x1: -64, halfW: 4 },            // across the west outer block
  { z: -160, x0: -92, x1: -64, halfW: 4 },
  { z: -20, x0: 76, x1: 104, halfW: 4 },             // across the east outer block
  { z: -160, x0: 76, x1: 104, halfW: 4 },
];
// Alleys through the inner blocks, from the back of the main street's
// lots out to the back street
export const ALLEYS = [
  { z: 8, x0: -49, x1: -34, halfW: 4 },
  { z: -150, x0: -49, x1: -34, halfW: 4 },
  { z: 0, x0: 34, x1: 61, halfW: 4 },
  { z: -175, x0: 34, x1: 61, halfW: 4 },
];

// Open spaces that lots keep clear of
export const PARK = { x0: 36, x1: 61, z0: -42, z1: -96 };
export const KEEP_CLEAR = [
  { x0: -42, x1: -20, z0: -44, z1: -66 },   // west pocket lot
  { x0: 28, x1: 64, z0: -99, z1: -137, opens: true }, // depot yard, open onto the east street
  { x0: -60, x1: 60, z0: 92, z1: 52 },      // the annex and its tanks
  PARK,
];

// Rows of lots: facade x, facing (+1 / -1 along x, toward the street),
// depth back from the facade, the run along z, and how much detail
export const ROWS = [
  { facade: -49, face: -1, depth: 13, z0: 150, z1: -205 },                 // W inner, facing the W street
  { facade: -67, face: 1, depth: 11.5, z0: 150, z1: -232 },                // W outer, facing the W street
  { facade: -90, face: -1, depth: 11.5, z0: 150, z1: -232, far: true },    // backing onto it, facing far W
  { facade: -106, face: 1, depth: 14, z0: 150, z1: -232, far: true },      // beyond far W
  { facade: 61, face: 1, depth: 14, z0: 150, z1: -205 },                   // E inner, facing the E street
  { facade: 79, face: -1, depth: 11.5, z0: 150, z1: -232 },                // E outer, facing the E street
  { facade: 102, face: 1, depth: 11.5, z0: 150, z1: -232, far: true },     // backing onto it, facing far E
  { facade: 118, face: -1, depth: 14, z0: 150, z1: -232, far: true },      // beyond far E
];

const overlaps = (a0, a1, b0, b1) => Math.max(a0, b0) < Math.min(a1, b1);
/** True when a lot (x0..x1 by z1..z0, z0 the north edge) would block a road or open space. */
export function lotBlocked(x0, x1, z0, z1) {
  for (const k of KEEP_CLEAR) if (overlaps(x0, x1, k.x0, k.x1) && overlaps(z1, z0, k.z1, k.z0)) return true;
  for (const c of [...CROSS_STREETS, ...ALLEYS]) {
    if (overlaps(x0, x1, Math.min(c.x0, c.x1), Math.max(c.x0, c.x1)) && overlaps(z1, z0, c.z - c.halfW - 1, c.z + c.halfW + 1)) return true;
  }
  return false;
}
