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
import { SIDEWALK, BACK_STREETS, CROSS_STREETS, ALLEYS, KEEP_CLEAR } from './CityLayout.js';

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

// Where CityTown.js can plant street trees: { x, z, far } of every tree pit
export const treePits = [];

// Lengths along z between bottom and top, minus the cut ranges [lo, hi]
function runsBetween(bottom, top, cuts) {
  const runs = [];
  for (const [lo, hi] of [...cuts].sort((a, b) => b[1] - a[1])) {
    if (hi < top) runs.push([Math.max(hi, bottom), top]);
    top = Math.min(top, lo);
  }
  if (top > bottom) runs.push([bottom, top]);
  return runs.filter(([lo, hi]) => hi - lo > 0.5);
}
// The main street's sidewalks: cut by its junctions and the annex plaza
function mainCuts(side) {
  return [...JUNCTIONS.filter((j) => j.side === side).map((j) => [j.z - j.width / 2, j.z + j.width / 2]),
    ...CROSS_STREETS.filter((c) => c.main).map((c) => [c.z - c.halfW, c.z + c.halfW])];
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

/* --- The town around the main street (CityLayout.js) ---------------------
   Back streets with sidewalks, kerbs and centre dashes; cross streets and
   alleys between them; plaza paving under everything else. Road pieces
   never overlap: where a cross street meets a street, its sidewalk is cut
   and patched with road instead. */
const MAIN_SPAN = [-rowX, rowX]; // the main street's road and sidewalks
const streetSpan = (st) => [st.x - st.halfW - SIDEWALK, st.x + st.halfW + SIDEWALK];
// A road quad over x0..x1 by z0..z1 (z0 < z1), UVs at the main road's texture density
function roadQuad(x0, x1, z0, z1) {
  const g = flatQuad((x0 + x1) / 2, 0.005, (z0 + z1) / 2, x1 - x0, z1 - z0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / (STREET_HALF_W * 2), uv.getY(i) * (z1 - z0) / (STREET_LENGTH + 70));
  return g;
}
function kerbRun(add, m, x0, x1, z0, z1) { // 1 m kerb blocks along a straight edge
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), len = alongX ? x1 - x0 : z1 - z0;
  for (let t = 0; t < len - 0.05; t += 1) {
    const l = Math.min(0.96, len - t - 0.04), c = t + l / 2;
    const geo = alongX ? new THREE.BoxGeometry(l, 0.16, 0.3).translate(x0 + c, 0.08, z0)
      : new THREE.BoxGeometry(0.3, 0.16, l).translate(x0, 0.08, z0 + c);
    add((Math.floor(t) & 1) ? m.kerbA : m.kerbB, geo);
  }
}
function buildTownGround(rnd, add, m) {
  // Plaza paving under the whole town, below the roads and sidewalks
  const plaza = flatQuad(2.5, -0.01, -42.5, 275, 395);
  const puv = plaza.attributes.uv;
  for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * 275 / 6, puv.getY(i) * 395 / 6);
  add(m.plaza, plaza);

  const links = [...CROSS_STREETS, ...ALLEYS];
  const touches = (c, x0, x1) => Math.min(c.x0, c.x1) < x1 && Math.max(c.x0, c.x1) > x0;
  for (const st of BACK_STREETS) {
    add(m.road, roadQuad(st.x - st.halfW, st.x + st.halfW, st.z1, st.z0));
    for (let z = st.z0 - 4; z > st.z1 + 2; z -= 7) { // centre dashes, gapped at the links
      if (!links.some((c) => Math.abs(z - c.z) < c.halfW + 2 && touches(c, st.x - st.halfW, st.x + st.halfW + 0.1))) add(m.yellow, flatQuad(st.x, 0.012, z, 0.2, 3));
    }
    const zebras = new Map();
    for (const side of [-1, 1]) {
      const kerbX = st.x + side * st.halfW, walkX = kerbX + side * SIDEWALK / 2;
      const w0 = Math.min(kerbX, kerbX + side * SIDEWALK), w1 = Math.max(kerbX, kerbX + side * SIDEWALK);
      const cuts = [];
      for (const c of links) if (touches(c, w0, w1)) { cuts.push([c.z - c.halfW, c.z + c.halfW]); zebras.set(c.z, c.halfW); }
      for (const k of KEEP_CLEAR) if (k.opens && k.x0 < w1 && k.x1 > w0) cuts.push([k.z1, k.z0]);
      for (const [lo, hi] of cuts) if (Math.min(hi, st.z0) > Math.max(lo, st.z1)) add(m.road, roadQuad(w0, w1, Math.max(lo, st.z1), Math.min(hi, st.z0)));
      for (const [lo, hi] of runsBetween(st.z1, st.z0, cuts)) {
        const len = hi - lo, zc = (lo + hi) / 2;
        const walk = flatQuad(walkX, 0.03, zc, SIDEWALK, len);
        const uv = walk.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * SIDEWALK / 3, uv.getY(i) * len / 3);
        add(m.slabs, walk);
        kerbRun(add, m, kerbX + side * 0.15, kerbX + side * 0.15, lo, hi);
        add(m.gutter, flatQuad(kerbX - side * 0.2, 0.009, zc, 0.4, len));
        for (let z = lo + 5; z < hi - 4; z += 15 + rnd() * 8) {
          const px = kerbX + side * 1.1;
          treePits.push({ x: px, z, far: !!st.far });
          add(m.soil, flatQuad(px, 0.035, z, 1.2, 1.2));
        }
      }
    }
    for (const [z, halfW] of zebras) for (const e of [-1, 1]) {
      const cz = z + e * (halfW + 2.2);
      for (let x = st.x - st.halfW + 1; x < st.x + st.halfW - 0.5; x += 1.25) add(m.paint, flatQuad(x, 0.012, cz, 0.6, 3.2));
    }
  }
  // Cross streets and alleys: road only where no street already is, kerbed edges
  for (const c of links) {
    const occupied = [...(c.main ? [MAIN_SPAN] : []), ...BACK_STREETS.map(streetSpan)].sort((a, b) => a[0] - b[0]);
    let x = Math.min(c.x0, c.x1);
    const end = Math.max(c.x0, c.x1), pieces = [];
    for (const [o0, o1] of occupied) {
      if (o1 <= x || o0 >= end) continue;
      if (o0 > x) pieces.push([x, o0]);
      x = Math.max(x, o1);
    }
    if (end > x) pieces.push([x, end]);
    for (const [x0, x1] of pieces) {
      if (x1 - x0 < 0.5) continue;
      add(m.road, roadQuad(x0, x1, c.z - c.halfW, c.z + c.halfW));
      for (const e of [-1, 1]) kerbRun(add, m, x0, x1, c.z + e * (c.halfW + 0.15), c.z + e * (c.halfW + 0.15));
    }
  }
}

/** Builds the district street surface. Called from loadStreetSurface()
    with the main road's material, so every road shares its asphalt. */
export function buildCityGround(roadMaterial) {
  const rnd = seeded(0x6A0D);
  const slabs = new THREE.MeshStandardMaterial({ map: slabTexture(rnd), roughness: 0.92, flatShading: true });
  const kerbA = new THREE.MeshStandardMaterial({ color: 0xa8a49a, roughness: 0.85, flatShading: true });
  const kerbB = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.85, flatShading: true });
  const gutter = decal(0x3a3a3c), paint = decal(0xe6e2d6, 0.7), yellow = decal(0xd9b13a, 0.7);
  const crackMat = decal(0x121214, 1), patchMat = decal(0x2c2c2e, 0.95), soil = decal(0x4a3a2c, 1), grass = decal(0x5f7a3a, 1);
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.95, flatShading: true });
  const plaza = new THREE.MeshStandardMaterial({ map: slabs.map, color: 0xa8a49c, roughness: 0.95, flatShading: true });
  plaza.userData.staticLampHeight = -0.01;
  slabs.userData.staticLampHeight = 0.03;
  const parts = new Map();
  const add = (material, geo) => { if (!parts.has(material)) parts.set(material, []); parts.get(material).push(geo.index ? geo.toNonIndexed() : geo); };
  treePits.length = 0;

  // Sidewalks and kerbs, broken where the side roads cut through
  for (const side of [-1, 1]) {
    const walkX = side * (STREET_HALF_W + WALK_W / 2);
    for (const [lo, hi] of runsBetween(Z_SOUTH, Z_NORTH, mainCuts(side))) {
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
        treePits.push({ x: px, z });
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
  // The annex plaza crossing the main street's sidewalks: road over the cuts
  for (const c of CROSS_STREETS.filter((cs) => cs.main)) for (const side of [-1, 1]) {
    add(roadMaterial, roadQuad(side > 0 ? STREET_HALF_W : -rowX, side > 0 ? rowX : -STREET_HALF_W, c.z - c.halfW, c.z + c.halfW));
  }

  buildTownGround(rnd, add, { road: roadMaterial, plaza, slabs, kerbA, kerbB, gutter, paint, yellow, soil });

  for (const [material, geos] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    mesh.receiveShadow = true;
    mesh.castShadow = material === kerbA || material === kerbB || material === asphalt;
    scene.add(mesh);
  }
}
