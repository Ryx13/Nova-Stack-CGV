/* ======================================================================
   Level3Industry.js — THE WORKS OUTSIDE THE QUARANTINE COMPOUND

   Beyond the compound's walls (x +-43) the headland is more of the same
   facility: two rows of sheds, sawtooth-roofed factories and plant
   offices each side (CityKit.js 'industrial', in the compound's own
   greys), seen over the walls. They replace the plain backdrop blocks
   Level3Quarantine.js drew there. Out of reach, so no colliders; flagged
   as static scenery so Level 3's merge folds them into a few meshes.
   Their own RNG: the level's shared rnd() is untouched.
====================================================================== */
import { buildKitBuilding } from './CityKit.js';

function seeded(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Rows each side: facade distance from the street (facing in, toward the
// compound), depth, and the far row's lighter detail
const ROWS = [{ facade: 47, depth: 15, far: false }, { facade: 66, depth: 18, far: true }];
const Z_NORTH = 38, Z_SOUTH = -236;

/** Builds the works. Call before Level 3's static merge. */
export function buildIndustrialDistrict() {
  const rnd = seeded(0x1D57);
  for (const side of [-1, 1]) {
    for (const row of ROWS) {
      const x = side * (row.facade + row.depth / 2);
      for (let top = Z_NORTH; top > Z_SOUTH + 8;) {
        const d = 12 + rnd() * 10;
        const group = buildKitBuilding(x, top - d / 2, row.depth, 14, d, { face: -side, collider: false, far: row.far, district: 'industrial' });
        group.userData.staticScenery = true;
        top -= d + (rnd() < 0.35 ? 2 + rnd() * 4 : 0); // service gaps between some
      }
    }
  }
}
