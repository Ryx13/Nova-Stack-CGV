/* ======================================================================
   CityGround.js — THE STREET SURFACE FOR A CITYKIT DISTRICT

   Replaces the plain sidewalk strips, full-length kerb bars and lone depot
   crossing (loadStreetSurface in characters.js) when a level names a
   district (state.cityKit). The road plane, centre line and manholes stay.

   - Sidewalks of paving slabs that reach the building fronts (the old
     strips stopped 2.2 m short, leaving dirt along every facade).
   - Stone kerbs in short blocks with a gutter along the road edge.
   - Real junctions where the street already opens to the side: the depot
     yard (east) and the west pocket. The sidewalk and kerb break for the
     side road, with zebra crossings either side, stop lines, lane arrows
     and a crossing over the side street's mouth.
   - Crossings at the spawn and at extraction.
   - What the quake did hours ago: fresh cracks across the asphalt and a
     few heaved slabs. Older repair patches, and tree pits with grass.

   Opaque and merged per material. The paint, cracks and patches use a
   polygon offset so they never flicker against the road. Built from its
   own RNG, so the shared rnd() sequence is untouched.
====================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, STREET_HALF_W, STREET_LENGTH, DEPOT_POS, WEST_POCKET_Z, rowX } from './Scene.js';

const Z_NORTH = 55, Z_SOUTH = -STREET_LENGTH - 15;  // the run of the old sidewalks
const WALK_W = rowX - STREET_HALF_W;                // kerb to building front
// Side roads off the main street: side (+1 east, -1 west), centre z, width,
// and how far out from the kerb they run: up to the depot yard's slab
// (x 29) and the west pocket's lot (x -21.4), which carry on from there
const JUNCTIONS = [
  { side: 1, z: DEPOT_POS.z, width: 14, reach: 19 },
  { side: -1, z: WEST_POCKET_Z, width: 12, reach: 11.4 },
];
const CROSSINGS = [14, -182]; // plain zebra crossings: by the spawn, by extraction

function seeded(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Flat decal material: drawn a hair above whatever it lies on
const decal = (color, roughness = 0.9) => new THREE.MeshStandardMaterial({
  color, roughness, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

// Paving slabs, 1.5 m square: the canvas is 3 x 3 m (2 x 2 slabs)
function slabTexture(rnd) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const l = 158 + Math.floor(rnd() * 18);
    g.fillStyle = `rgb(${l},${l - 4},${l - 10})`;
    g.fillRect(i * 128, j * 128, 128, 128);
    for (let k = 0; k < 40; k++) { // speckle
      g.fillStyle = `rgba(${rnd() < 0.5 ? '60,55,50' : '255,250,240'},0.08)`;
      g.fillRect(i * 128 + rnd() * 128, j * 128 + rnd() * 128, 3, 3);
    }
  }
  g.fillStyle = '#6e6a62';
  g.fillRect(0, 0, 256, 3); g.fillRect(0, 127, 256, 3);
  g.fillRect(0, 0, 3, 256); g.fillRect(127, 0, 3, 256);
  // One slab cracked by the quake
  g.strokeStyle = '#3e3a36'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(140, 140); g.lineTo(170, 175); g.lineTo(165, 205); g.lineTo(200, 250); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8; // seen at a low angle all the way down the street
  return tex;
}

// Lengths along z, minus the gaps where junctions cut through
function runsOnSide(side) {
  const cuts = JUNCTIONS.filter((j) => j.side === side).map((j) => [j.z - j.width / 2, j.z + j.width / 2]);
  const runs = [];
  let top = Z_NORTH;
  for (const [lo, hi] of cuts.sort((a, b) => b[1] - a[1])) { runs.push([hi, top]); top = lo; }
  runs.push([Z_SOUTH, top]);
  return runs;
}

function flatQuad(x, y, z, sx, sz, rotY = 0) {
  return new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2).rotateY(rotY).translate(x, y, z);
}

// A painted arrow lying on the road, pointing along `dir` (+1 = +z);
// turn: 0 straight, or the world side (+1 = +x, -1 = -x) its branch turns to
function arrow(x, z, dir, turn) {
  const shape = (pts) => { const s = new THREE.Shape(); s.moveTo(...pts[0]); for (const p of pts.slice(1)) s.lineTo(...p); return new THREE.ShapeGeometry(s); };
  const parts = [shape([[-0.15, 0], [0.15, 0], [0.15, 2.0], [0.45, 2.0], [0, 2.8], [-0.45, 2.0], [-0.15, 2.0]])];
  if (turn) {
    // Drawn pointing -z (shape +y maps to -z); a northbound arrow is then
    // turned round, which swaps its sides, so mirror the branch to match.
    // Mirrored by flipping the points and their order, so it still faces up.
    const k = (dir > 0 ? -turn : turn);
    const pts = [[0, 0.9], [0.9, 1.4], [0.9, 1.1], [1.5, 1.6], [0.9, 2.1], [0.9, 1.8], [0, 1.3]].map(([px, py]) => [px * k, py]);
    parts.push(shape(k > 0 ? pts : pts.reverse()));
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))
    .rotateX(-Math.PI / 2).rotateY(dir > 0 ? Math.PI : 0).translate(x, 0.012, z);
}

// A fresh crack wandering across the road, with a branch or two
function crack(rnd, z0, emit) {
  let x = -STREET_HALF_W + 0.5, z = z0;
  const step = () => {
    const nx = x + 0.6 + rnd() * 1.1, nz = z + (rnd() - 0.5) * 1.4, w = 0.08 + rnd() * 0.12;
    const len = Math.hypot(nx - x, nz - z);
    emit(flatQuad((x + nx) / 2, 0.011, (z + nz) / 2, w, len, Math.atan2(nx - x, nz - z)));
    if (rnd() < 0.12) { // a branch
      const bz = z + (rnd() < 0.5 ? -1 : 1) * (1 + rnd() * 2);
      emit(flatQuad(x, 0.011, (z + bz) / 2, 0.06, Math.abs(bz - z), 0.2 * (rnd() - 0.5)));
    }
    x = nx; z = nz;
  };
  while (x < STREET_HALF_W - 0.8) step();
}

/** Builds the district street surface. Called from loadStreetSurface(). */
export function buildCityGround() {
  const rnd = seeded(0x6A0D);
  const slabs = new THREE.MeshStandardMaterial({ map: slabTexture(rnd), roughness: 0.92, flatShading: true });
  const kerbA = new THREE.MeshStandardMaterial({ color: 0xa8a49a, roughness: 0.85, flatShading: true });
  const kerbB = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.85, flatShading: true });
  const gutter = decal(0x3a3a3c), paint = decal(0xe6e2d6, 0.7), yellow = decal(0xd9b13a, 0.7);
  const crackMat = decal(0x121214, 1), patchMat = decal(0x2c2c2e, 0.95), soil = decal(0x4a3a2c, 1), grass = decal(0x5f7a3a, 1);
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.95, flatShading: true });
  const parts = new Map();
  const add = (material, geo) => { if (!parts.has(material)) parts.set(material, []); parts.get(material).push(geo.index ? geo.toNonIndexed() : geo); };

  // Sidewalks and kerbs, broken where the side roads cut through
  for (const side of [-1, 1]) {
    const walkX = side * (STREET_HALF_W + WALK_W / 2);
    for (const [lo, hi] of runsOnSide(side)) {
      const len = hi - lo, zc = (lo + hi) / 2;
      const walk = flatQuad(walkX, 0.03, zc, WALK_W, len);
      const uv = walk.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * WALK_W / 3, uv.getY(i) * len / 3);
      add(slabs, walk);
      for (let z = lo; z < hi - 0.05; z += 1) { // kerb blocks, a finger's gap apart
        const l = Math.min(0.96, hi - z - 0.04);
        add((Math.floor(z) & 1) ? kerbA : kerbB, new THREE.BoxGeometry(0.3, 0.16, l).translate(side * (STREET_HALF_W + 0.15), 0.08, z + l / 2));
      }
      add(gutter, flatQuad(side * (STREET_HALF_W - 0.2), 0.009, zc, 0.4, len));
      // Tree pits every so often along the outer edge
      for (let z = lo + 6; z < hi - 4; z += 14 + rnd() * 10) {
        const px = side * (STREET_HALF_W + 1.3);
        add(soil, flatQuad(px, 0.035, z, 1.3, 1.3));
        add(grass, flatQuad(px + (rnd() - 0.5) * 0.3, 0.036, z + (rnd() - 0.5) * 0.3, 0.8 + rnd() * 0.3, 0.8 + rnd() * 0.3, rnd()));
      }
    }
  }

  // Junctions: the side road surface, crossings, stop lines, arrows
  for (const j of JUNCTIONS) {
    const near = STREET_HALF_W - 0.2, far = STREET_HALF_W + j.reach;
    add(asphalt, flatQuad(j.side * (near + far) / 2, 0.012, j.z, far - near, j.width));
    for (const e of [-1, 1]) { // kerbs turning the corner into the side road
      for (let x = STREET_HALF_W; x < far - 0.5; x += 1) {
        add(kerbA, new THREE.BoxGeometry(0.96, 0.16, 0.3).translate(j.side * (x + 0.5), 0.08, j.z + e * (j.width / 2 + 0.15)));
      }
    }
    // Zebra crossings over the main road, either side of the junction
    for (const e of [-1, 1]) {
      const cz = j.z + e * (j.width / 2 + 2.2);
      for (let x = -STREET_HALF_W + 1; x < STREET_HALF_W - 0.5; x += 1.25) add(paint, flatQuad(x, 0.012, cz, 0.6, 3.2));
    }
    // ...and over the mouth of the side road, where the sidewalk crosses it
    const mx = j.side * (STREET_HALF_W + WALK_W / 2);
    for (let z = j.z - j.width / 2 + 0.8; z < j.z + j.width / 2 - 0.4; z += 1.25) add(paint, flatQuad(mx, 0.013, z, WALK_W - 0.6, 0.6));
    // Stop lines and arrows. Traffic keeps right: southbound (-z) on x > 0
    add(paint, flatQuad(STREET_HALF_W / 2, 0.012, j.z + j.width / 2 + 4.4, STREET_HALF_W - 1, 0.45));
    add(paint, flatQuad(-STREET_HALF_W / 2, 0.012, j.z - j.width / 2 - 4.4, STREET_HALF_W - 1, 0.45));
    add(paint, arrow(STREET_HALF_W / 2, j.z + j.width / 2 + 9, -1, j.side > 0 ? 1 : 0));
    add(paint, arrow(-STREET_HALF_W / 2, j.z - j.width / 2 - 9, 1, j.side < 0 ? -1 : 0));
    add(yellow, flatQuad(0, 0.0125, j.z, 0.25, j.width + 8)); // solid centre line through the junction
  }
  for (const cz of CROSSINGS) {
    for (let x = -STREET_HALF_W + 1; x < STREET_HALF_W - 0.5; x += 1.25) add(paint, flatQuad(x, 0.012, cz, 0.6, 3.2));
  }

  // The quake: fresh cracks across the road and a few heaved slabs
  for (const z of [6, -30, -78, -96, -142, -168]) crack(rnd, z + (rnd() - 0.5) * 6, (geo) => add(crackMat, geo));
  for (const z of [-34, -100, -164]) {
    const slab = new THREE.BoxGeometry(2.2 + rnd(), 0.14, 1.6 + rnd()).rotateZ((rnd() - 0.5) * 0.12).rotateX((rnd() - 0.5) * 0.1)
      .translate((rnd() - 0.5) * 12, 0.05, z + (rnd() - 0.5) * 4);
    add(asphalt, slab);
  }
  // Older repair patches
  for (let i = 0; i < 7; i++) add(patchMat, flatQuad((rnd() - 0.5) * 14, 0.0105, 40 - rnd() * 250, 1.5 + rnd() * 3, 1 + rnd() * 2.5, rnd() * 0.3));

  for (const [material, geos] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    mesh.receiveShadow = true;
    mesh.castShadow = material === kerbA || material === kerbB || material === asphalt;
    scene.add(mesh);
  }
}
