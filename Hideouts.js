/* ======================================================================
   Hideouts.js — THREE BUILDINGS YOU CAN WALK INTO (Level 2)

   Out in the harbour's back streets (CityLayout harbour.hideouts, whose
   footprints the town leaves clear): a diner, a pharmacy and an apartment
   lobby. On Impossible the girl hides in one of them each run (Level2.js),
   so finding the radar means exploring the town without stumbling on her,
   and finding her means going inside. Each stands two storeys, its ground
   floor open: a front room through the street door, a back room through a
   doorway in the partition, and a side door from the back room onto a
   cross street, the way she runs when she smells you.

   Built in code in the town's style, each building merged into a few
   meshes: the shell (walls, shopfront glass, sign, roof) casting shadows,
   the interior not (the roof shades it anyway). Interior surfaces hold a
   little light of their own (emissive) so the rooms read without adding
   real lights, which every material in the scene would pay for. Walls and
   the bigger furniture are solid (addStaticBox), with invisible camera
   blockers (state.occluders) so the third-person camera pulls in indoors.
====================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, addStaticBox } from './Scene.js';
import { state } from './state.js';
import { layout } from './CityLayout.js';

const STOREY = 3.6, HEIGHT = 8.2, WALL = 0.3, SKIN = 0.15; // m
const DOOR_W = 1.6, DOOR_H = 2.5, SIDE_DOOR_W = 1.3, INNER_DOOR_W = 1.2;
const BACK_ROOM = 5;     // m deep, at the rear
const WIN_SILL = 0.9, WIN_HEAD = 2.9;
const FLOOR_Y = 0.04;    // just above the pavement

/* --- Materials and textures ---------------------------------------------- */
const mats = new Map();
// lit: how much of its own colour (and texture) it glows with, indoors
function mat(hex, { rough = 0.85, metal = 0, lit = 0, map = null, transparent = false, opacity = 1, emissive = null, side = THREE.FrontSide } = {}) {
  const key = [hex, rough, metal, lit, map?.uuid, transparent, opacity, emissive, side].join('|');
  if (!mats.has(key)) {
    const glow = emissive ?? new THREE.Color(hex).multiplyScalar(lit);
    mats.set(key, new THREE.MeshStandardMaterial({
      color: hex, roughness: rough, metalness: metal, map, transparent, opacity, depthWrite: !transparent, side,
      emissive: glow, emissiveMap: emissive == null && lit && map ? map : null,
    }));
  }
  return mats.get(key);
}
function canvasTex(w, h, draw, repeat = null) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const speckle = (g, w, h, n, colours) => {
  for (let i = 0; i < n; i++) { g.fillStyle = colours[i % colours.length]; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
};
// Floors
const checkerTex = (a, b) => canvasTex(128, 128, (g) => {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(x * 32, y * 32, 32, 32); }
  g.globalAlpha = 0.12; speckle(g, 128, 128, 400, ['#000', '#5a4a3a']); g.globalAlpha = 1;
});
const linoTex = () => canvasTex(128, 128, (g) => {
  g.fillStyle = '#b9c2b4'; g.fillRect(0, 0, 128, 128); speckle(g, 128, 128, 700, ['#8f998c', '#d8ddd2', '#7a8576']);
  g.strokeStyle = 'rgba(60,70,60,.35)'; g.strokeRect(0.5, 0.5, 127, 127);
});
const plankTex = () => canvasTex(128, 128, (g) => {
  for (let i = 0; i < 8; i++) { g.fillStyle = ['#6e4c30', '#7a5636', '#634328', '#73502f'][i % 4]; g.fillRect(0, i * 16, 128, 16); }
  g.strokeStyle = 'rgba(30,18,8,.5)'; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(0, i * 16); g.lineTo(128, i * 16); g.stroke(); g.beginPath(); g.moveTo((i * 37) % 128, i * 16); g.lineTo((i * 37) % 128, i * 16 + 16); g.stroke(); }
  g.globalAlpha = 0.15; speckle(g, 128, 128, 300, ['#000']); g.globalAlpha = 1;
});
// Walls: paint going grubby toward the floor
const plasterTex = (top, bottom) => canvasTex(64, 128, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, top); grad.addColorStop(1, bottom);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.18; speckle(g, w, h, 260, ['#2a2018', '#000']); g.globalAlpha = 1;
});
const textTex = (lines, bg, fg, w = 512, h = 128, font = 'bold 54px Arial') => canvasTex(w, h, (g) => {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = 5; g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((t, i) => g.fillText(t, w / 2, h * (i + 1) / (lines.length + 1), w - 40));
});
const stripeTex = (a, b) => canvasTex(64, 8, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * 8, 0, 8, 8); } });
const mailboxTex = () => canvasTex(256, 128, (g) => {
  g.fillStyle = '#8a7a52'; g.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = (x * 7 + y * 3) % 5 ? '#b8a46a' : '#4a3e2a'; // a few hang open
    g.fillRect(4 + x * 31, 4 + y * 31, 27, 27);
    g.fillStyle = '#2a2418'; g.fillRect(10 + x * 31, 10 + y * 31, 14, 3);
  }
});

/* --- A building's own merge: one mesh per material ----------------------- */
class Batch {
  constructor() { this.parts = new Map(); }
  add(material, geo) {
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(geo.index ? geo.toNonIndexed() : geo);
  }
  finish(parent, castShadow) {
    const meshes = [];
    for (const [material, geos] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), material);
      mesh.castShadow = castShadow && !material.transparent;
      mesh.receiveShadow = true;
      parent.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
}

// A wall run from r0 to r1, yTop high, with openings { r0, r1, y0, y1 }:
// the pieces round them
function wallPieces(r0, r1, yTop, openings) {
  const out = [], ops = [...openings].sort((a, b) => a.r0 - b.r0);
  let r = r0;
  for (const o of ops) {
    if (o.r0 > r) out.push({ r0: r, r1: o.r0, y0: 0, y1: yTop });
    if (o.y0 > 0) out.push({ r0: o.r0, r1: o.r1, y0: 0, y1: o.y0 });
    if (o.y1 < yTop) out.push({ r0: o.r0, r1: o.r1, y0: o.y1, y1: yTop });
    r = o.r1;
  }
  if (r < r1) out.push({ r0: r, r1, y0: 0, y1: yTop });
  return out;
}

/* --- One building ---------------------------------------------------------- */
function buildHideout(h) {
  const shell = new Batch(), inside = new Batch();
  const X = (a) => h.facadeX - h.side * a;          // a: metres in from the front
  const Z = (s) => h.zc + s;                        // s: metres along the street from its middle
  const L = h.L, D = h.D, hl = L / 2, PART = D - BACK_ROOM;
  // A box over a0..a1 (in), y0..y1 (up), s0..s1 (along)
  const geo = (a0, a1, y0, y1, s0, s1) => {
    const xa = X(a0), xb = X(a1);
    return new THREE.BoxGeometry(Math.max(0.01, Math.abs(xb - xa)), Math.max(0.01, y1 - y0), Math.max(0.01, s1 - s0)).translate((xa + xb) / 2, (y0 + y1) / 2, Z((s0 + s1) / 2));
  };
  // Any geometry, turned (ry about up, rx tipped over), placed at a, y, s
  const put = (g, a, y, s, ry = 0, rx = 0, rz = 0) => g.rotateZ(rz).rotateX(rx).rotateY(ry).translate(X(a), y, Z(s));
  const solid = (a0, a1, s0, s1, y1 = STOREY) => {
    const xa = X(a0), xb = X(a1);
    addStaticBox(Math.abs(xb - xa) / 2, y1 / 2, (s1 - s0) / 2, (xa + xb) / 2, y1 / 2, Z((s0 + s1) / 2));
  };
  const blockers = [];
  const blocker = (a0, a1, y0, y1, s0, s1) => {
    const m = new THREE.Mesh(geo(a0, a1, y0, y1, s0, s1));
    m.updateMatrixWorld(true);
    m.userData.sceneryMerged = true; // indexed by the camera's ray grid
    blockers.push(m);
  };
  const theme = THEMES[h.id];
  const ext = mat(theme.wall), trim = mat(theme.trim), dark = mat(0x1c1e20, { rough: 0.5 });
  const inWall = mat(0xffffff, { map: plasterTex(theme.paintTop, theme.paintBottom), lit: 0.32 });
  const glass = mat(0x9fb8c4, { rough: 0.05, metal: 0.2, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
  const glassBatch = new Batch();

  // Openings. Front: the door in the middle, a shop window either side
  const front = [
    { r0: -DOOR_W / 2, r1: DOOR_W / 2, y0: 0, y1: DOOR_H },
    { r0: -hl + 1, r1: -DOOR_W / 2 - 0.8, y0: WIN_SILL, y1: WIN_HEAD },
    { r0: DOOR_W / 2 + 0.8, r1: hl - 1, y0: WIN_SILL, y1: WIN_HEAD },
  ];
  // Side door into the back room, on the wall she escapes through
  const doorA = D - 3, sideSign = h.sideDoor === 'north' ? 1 : -1;
  const sideDoor = [{ r0: doorA - SIDE_DOOR_W / 2, r1: doorA + SIDE_DOOR_W / 2, y0: 0, y1: DOOR_H }];
  const partDoorS = theme.partDoorS ?? 0;
  const partition = [{ r0: partDoorS - INNER_DOOR_W / 2, r1: partDoorS + INNER_DOOR_W / 2, y0: 0, y1: 2.3 }];

  // Ground-storey walls, two skins (street face, painted room face)
  for (const [m, a0, a1] of [[ext, 0, SKIN], [inWall, SKIN, WALL]]) {
    for (const p of wallPieces(-hl, hl, STOREY, front)) shell.add(m, geo(a0, a1, p.y0, p.y1, p.r0, p.r1));
    for (const p of wallPieces(-hl, hl, STOREY, [])) shell.add(m, geo(D - a1, D - a0, p.y0, p.y1, p.r0, p.r1)); // back wall
  }
  for (const sgn of [-1, 1]) {
    const ops = sgn === sideSign ? sideDoor : [];
    const s0 = sgn * hl, s1 = sgn * (hl - SKIN), s2 = sgn * (hl - WALL);
    for (const p of wallPieces(0, D, STOREY, ops)) {
      shell.add(ext, geo(p.r0, p.r1, p.y0, p.y1, Math.min(s0, s1), Math.max(s0, s1)));
      shell.add(inWall, geo(p.r0, p.r1, p.y0, p.y1, Math.min(s1, s2), Math.max(s1, s2)));
    }
  }
  for (const p of wallPieces(-hl + WALL, hl - WALL, STOREY, partition)) inside.add(inWall, geo(PART - 0.1, PART + 0.1, p.y0, p.y1, p.r0, p.r1));
  // Door frames and the shopfront glass
  for (const o of front) {
    if (o.y0 > 0) { glassBatch.add(glass, geo(0.12, 0.16, o.y0, o.y1, o.r0, o.r1)); shell.add(trim, geo(-0.05, 0.25, o.y0 - 0.12, o.y0, o.r0 - 0.1, o.r1 + 0.1)); }
    else shell.add(trim, geo(-0.06, 0.06, o.y1, o.y1 + 0.16, o.r0 - 0.15, o.r1 + 0.15));
  }
  // Upper storey: solid, dark windows, a cornice and a parapet
  shell.add(ext, geo(0, D, STOREY, HEIGHT, -hl, hl));
  for (let i = 0; i < 4; i++) {
    const s = -hl + (i + 0.5) * (L / 4);
    shell.add(dark, geo(-0.03, 0.05, STOREY + 1.2, STOREY + 3.2, s - 0.7, s + 0.7));
    shell.add(trim, geo(-0.1, 0.1, STOREY + 1.05, STOREY + 1.2, s - 0.85, s + 0.85));
  }
  shell.add(trim, geo(-0.25, 0.1, STOREY - 0.05, STOREY + 0.25, -hl - 0.1, hl + 0.1)); // band over the shopfront
  shell.add(trim, geo(-0.3, D, HEIGHT, HEIGHT + 0.25, -hl - 0.15, hl + 0.15));        // cornice and roof
  shell.add(ext, geo(0, 0.3, HEIGHT + 0.25, HEIGHT + 1.0, -hl, hl));                   // parapet
  // The ceiling over the ground floor, and the floor
  inside.add(mat(theme.ceiling, { lit: 0.25 }), geo(WALL, D - WALL, STOREY - 0.12, STOREY, -hl + WALL, hl - WALL));
  const floorTex = theme.floor();
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set((D - 2 * WALL) / theme.floorTile, (L - 2 * WALL) / theme.floorTile);
  const floorGeo = new THREE.PlaneGeometry(D - 2 * WALL, L - 2 * WALL).rotateX(-Math.PI / 2).translate(X(D / 2), FLOOR_Y, Z(0));
  inside.add(mat(0xffffff, { map: floorTex, lit: 0.3, rough: 0.6 }), floorGeo);

  // The sign over the door
  const sign = mat(0xffffff, { map: textTex([theme.sign], theme.signBg, theme.signFg), lit: 0.4 });
  const signGeo = new THREE.PlaneGeometry(Math.min(L - 3, 7), 1.0);
  shell.add(sign, put(signGeo, -0.27, STOREY + 0.55, 0, h.side > 0 ? Math.PI / 2 : -Math.PI / 2));

  // Walls and the bigger furniture are solid; the camera stops at the walls
  for (const p of wallPieces(-hl, hl, STOREY, front.filter((o) => o.y0 === 0))) solid(0, WALL, p.r0, p.r1);
  solid(D - WALL, D, -hl, hl);
  for (const sgn of [-1, 1]) for (const p of wallPieces(0, D, STOREY, sgn === sideSign ? sideDoor : [])) solid(p.r0, p.r1, Math.min(sgn * hl, sgn * (hl - WALL)), Math.max(sgn * hl, sgn * (hl - WALL)));
  for (const p of wallPieces(-hl + WALL, hl - WALL, STOREY, partition)) solid(PART - 0.1, PART + 0.1, p.r0, p.r1);
  for (const p of wallPieces(-hl, hl, HEIGHT, front.filter((o) => o.y0 === 0))) blocker(0, WALL, p.y0, p.y1, p.r0, p.r1);
  blocker(D - WALL, D, 0, HEIGHT, -hl, hl);
  for (const sgn of [-1, 1]) for (const p of wallPieces(0, D, HEIGHT, sgn === sideSign ? sideDoor : [])) blocker(p.r0, p.r1, p.y0, p.y1, Math.min(sgn * hl, sgn * (hl - WALL)), Math.max(sgn * hl, sgn * (hl - WALL)));
  blocker(0, D, STOREY - 0.12, HEIGHT + 1, -hl, hl); // ceiling and everything above

  // The rooms themselves
  // side: which way the front faces (a plane facing the street turns by side * π/2)
  theme.furnish({ geo, put, solid, add: (m, g) => inside.add(m, g), shell: (m, g) => shell.add(m, g), mat, L, D, hl, PART, sideSign, doorA, side: h.side });

  const group = new THREE.Group();
  group.name = `hideout-${h.id}`;
  shell.finish(group, true);
  inside.finish(group, false);
  const glassMeshes = glassBatch.finish(group, false);
  scene.add(group);
  state.occluders.push(...blockers);
  (state.glassMeshes ||= []).push(...glassMeshes); // bullets crack the shopfront (ImpactFX)

  // The way through for walkers (ZombieNav.js): street door, front room,
  // the partition's doorway, the back room, the side door and out
  (state.navChains ||= []).push([
    [X(-1.5), Z(0)], [X(1.5), Z(0)], [X(PART / 2), Z(partDoorS)], [X(PART - 0.9), Z(partDoorS)], [X(PART + 0.9), Z(partDoorS)],
    [X(PART + 2.5), Z(sideSign * (hl - 2.5))], [X(doorA), Z(sideSign * (hl - 1))], [X(doorA), Z(sideSign * (hl + 1.4))],
  ]);
  // Where she hides (deep in the back room, by the side door, facing away
  // from the partition) and her way out
  const hide = theme.hide ?? [D - 1.6, sideSign * (hl - 2.6)];
  return {
    id: h.id, name: theme.name, group,
    girl: { x: X(hide[0]), z: Z(hide[1]), face: Math.atan2(-h.side, 0) },
    // Through the side door, then the layout's way to the main street
    out: [[X(doorA), Z(sideSign * (hl - 1))], [X(doorA), Z(sideSign * (hl + 1.4))], ...h.escape],
    join: h.escape && h.join,
    door: { x: X(-1), z: Z(0) },
    // Where her pack waits on Impossible (Level2.js): out in the street the
    // building fronts, and inside, either side of the partition's doorway
    guards: {
      street: [[X(-4.5), Z(-1)], [X(-7.5), Z(3)], [X(-5), Z(-5.5)]],
      inside: [[X(PART * 0.45), Z(partDoorS + 1.8)], [X(PART - 1.2), Z(partDoorS - 1.4)], [X(PART + 1.4), Z(partDoorS)]],
    },
  };
}

/* --- What's inside each ------------------------------------------------------ */
const red = 0xa8322a, cream = 0xe8dcc0, steel = 0x9aa0a4, wood = 0x6a4a30, tan = 0xb48c5a;
const cyl = (r0, r1, h, n = 10) => new THREE.CylinderGeometry(r0, r1, h, n);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const THEMES = {
  /* MARGOT'S DINER: checker floor, booths down one wall, a counter with
     stools in front of the kitchen, pendant lamps; the kitchen behind. */
  diner: {
    name: "Margot's Diner", sign: "MARGOT'S DINER", signBg: '#2a1a14', signFg: '#ff6a4a',
    wall: 0x8e5a44, trim: 0xe8dcc0, paintTop: '#d8c8a0', paintBottom: '#8a7458', ceiling: 0xd8d0bc,
    floor: () => checkerTex('#c43a30', '#efe6d0'), floorTile: 1.2, partDoorS: 4.5,
    furnish(t) {
      const vinyl = t.mat(red, { lit: 0.3, rough: 0.5 }), chrome = t.mat(steel, { metal: 0.7, rough: 0.3, lit: 0.2 }), formica = t.mat(cream, { lit: 0.3, rough: 0.4 });
      // The counter, stools in front of it (two knocked over)
      t.add(vinyl, t.geo(t.PART - 1.6, t.PART - 0.9, 0, 1.0, -5.5, 2.8));
      t.add(chrome, t.geo(t.PART - 1.75, t.PART - 0.8, 1.0, 1.06, -5.6, 2.9));
      t.solid(t.PART - 1.6, t.PART - 0.9, -5.5, 2.8, 1.06);
      for (let i = 0; i < 6; i++) {
        const s = -5 + i * 1.4, over = i === 2 || i === 4;
        t.add(chrome, t.put(cyl(0.04, 0.05, 0.7), t.PART - 2.3, over ? 0.12 : 0.35, s, 0, over ? Math.PI / 2 : 0));
        t.add(vinyl, t.put(cyl(0.2, 0.2, 0.08, 12), over ? t.PART - 2.7 : t.PART - 2.3, over ? 0.2 : 0.72, s, 0, over ? Math.PI / 2 : 0));
      }
      // Booths along the far wall, facing across the room
      const wallS = -t.sideSign * (t.hl - 0.3);
      for (const a of [1.6, 3.9, 6.2]) {
        const s0 = wallS - Math.sign(wallS) * 1.4, sc = (wallS + s0) / 2;
        t.add(formica, t.geo(a - 0.4, a + 0.4, 0.72, 0.76, Math.min(wallS, s0), Math.max(wallS, s0)));
        t.add(chrome, t.put(cyl(0.05, 0.05, 0.72), a, 0.36, sc));
        for (const e of [-1, 1]) {
          t.add(vinyl, t.geo(a + e * 0.95 - 0.27, a + e * 0.95 + 0.27, 0, 0.46, Math.min(wallS, s0), Math.max(wallS, s0)));
          t.add(vinyl, t.geo(a + e * 1.17 - 0.06, a + e * 1.17 + 0.06, 0.46, 1.15, Math.min(wallS, s0), Math.max(wallS, s0)));
        }
      }
      // A table in the middle, its chair overturned; smashed plates, blood
      t.add(formica, t.put(cyl(0.45, 0.45, 0.04, 16), 4.2, 0.74, -1.6));
      t.add(chrome, t.put(cyl(0.05, 0.05, 0.72), 4.2, 0.36, -1.6));
      t.add(vinyl, t.put(box(0.42, 0.06, 0.42), 4.9, 0.25, -2.3, 0.4, 1.3));
      for (let i = 0; i < 7; i++) t.add(t.mat(0xf4f0e8, { lit: 0.3 }), t.put(cyl(0.06 + Math.random() * 0.06, 0.06, 0.015, 7), 3 + Math.random() * 3, 0.05, -3 + Math.random() * 3, Math.random() * 3));
      t.add(t.mat(0x3a0808, { rough: 0.3 }), t.put(new THREE.PlaneGeometry(1.4, 0.7).rotateX(-Math.PI / 2), 5.4, 0.05, 0.6, 0.6));
      // The menu board over the counter, pendant lamps glowing on
      const menu = t.mat(0xffffff, { map: textTex(['MENU', 'BURGERS  4.50', 'SHAKES  2.00', 'COFFEE  1.00'], '#1a1a16', '#f2e6c0', 256, 256, 'bold 26px Arial'), lit: 0.5 });
      t.add(menu, t.put(new THREE.PlaneGeometry(2.2, 1.4), t.PART - 0.12, 2.3, -1.4, t.side * Math.PI / 2)); // facing the room
      const shade = t.mat(0x2a6a5a, { rough: 0.4, lit: 0.2 }), bulb = t.mat(0xfff2c8, { emissive: new THREE.Color(0xffe2a0) });
      for (const s of [-4, 0, 4]) {
        t.add(chrome, t.put(cyl(0.01, 0.01, 0.6, 4), 3.9, STOREY - 0.42, s));
        t.add(shade, t.put(new THREE.ConeGeometry(0.3, 0.3, 12, 1, true), 3.9, STOREY - 0.85, s));
        t.add(bulb, t.put(new THREE.SphereGeometry(0.09, 8, 6), 3.9, STOREY - 0.98, s));
      }
      // The kitchen: steel counters, a stove, a tall fridge, shelves of tins
      const steelTop = t.mat(steel, { metal: 0.6, rough: 0.35, lit: 0.25 });
      t.add(steelTop, t.geo(t.D - 1.0, t.D - 0.3, 0, 0.92, -t.hl + 0.5, t.hl - 3.5));
      t.solid(t.D - 1.0, t.D - 0.3, -t.hl + 0.5, t.hl - 3.5, 0.92);
      t.add(t.mat(0x2a2c2e, { metal: 0.5, rough: 0.4 }), t.geo(t.PART + 0.4, t.PART + 1.2, 0, 0.95, -2.5, -0.5));
      for (const [da, ds] of [[0.6, -2.1], [1.0, -2.1], [0.6, -0.9], [1.0, -0.9]]) t.add(t.mat(0x111111), t.put(cyl(0.13, 0.13, 0.02, 12), t.PART + da, 0.97, ds));
      t.solid(t.PART + 0.4, t.PART + 1.2, -2.5, -0.5, 0.95);
      t.add(t.mat(0xe8e6e0, { lit: 0.3, rough: 0.3 }), t.geo(t.PART + 0.3, t.PART + 1.1, 0, 2.1, 0.5, 1.5));
      t.solid(t.PART + 0.3, t.PART + 1.1, 0.5, 1.5, 2.1);
      for (let k = 0; k < 12; k++) t.add(t.mat([0xc0503a, 0xd8b040, 0x6a8a4a][k % 3], { lit: 0.3 }), t.put(cyl(0.05, 0.05, 0.12, 8), t.D - 0.5, 1.6 + (k % 2) * 0.35, -t.hl + 1 + (k >> 1) * 0.4));
    },
  },

  /* HARBOUR PHARMACY: lino floor, two aisles of shelves (one toppled into
     the other, its stock across the floor), the dispensary under a green
     cross, waiting chairs, strip lights; a storeroom behind. */
  pharmacy: {
    name: 'Harbour Pharmacy', sign: 'PHARMACY', signBg: '#0f3a22', signFg: '#9ff2b4',
    wall: 0xb8b4a6, trim: 0x2a6a3e, paintTop: '#e8ece4', paintBottom: '#9aa496', ceiling: 0xe8eae4,
    floor: linoTex, floorTile: 1.0, partDoorS: -4,
    furnish(t) {
      const shelf = t.mat(0xd8dcd6, { lit: 0.3, rough: 0.6 }), stock = [0xe8524a, 0x4a8ad8, 0xf2d04a, 0x5ab86a, 0xf0f0f0, 0xb86ad8].map((c) => t.mat(c, { lit: 0.35 }));
      // Two aisles running in from the shopfront, the second knocked askew
      for (const [s, lean] of [[-2.6, 0], [1.6, 0.32]]) {
        const a0 = 1.8, a1 = t.PART - 2.2, ac = (a0 + a1) / 2;
        t.add(shelf, t.put(box(Math.abs(a1 - a0), 1.9, 0.5), ac, 0.95, s, 0, lean, 0));
        for (let level = 0; level < 4; level++) {
          for (let i = 0; i < 9; i++) {
            if (lean && level > 1 && i % 3 === 0) continue; // gone: across the floor
            const a = a0 + 0.3 + i * ((a1 - a0 - 0.6) / 8);
            for (const e of [-1, 1]) t.add(stock[(i + level * 2) % stock.length], t.put(box(0.22, 0.24, 0.16), a, 0.32 + level * 0.44, s + e * 0.33, 0, lean, 0));
          }
        }
        if (!lean) t.solid(a0, a1, s - 0.25, s + 0.25, 1.9);
      }
      for (let i = 0; i < 18; i++) t.add(stock[i % stock.length], t.put(box(0.22, 0.24, 0.16), 2 + Math.random() * 4, 0.12, 2.4 + Math.random() * 1.6, Math.random() * 3, 0, Math.random() < 0.5 ? Math.PI / 2 : 0));
      // The dispensary counter across the back, the green cross over it
      t.add(t.mat(0xf2f2ee, { lit: 0.3, rough: 0.4 }), t.geo(t.PART - 1.3, t.PART - 0.7, 0, 1.05, -t.hl + 0.6, t.hl - 2.4));
      t.add(t.mat(0x2a6a3e, { lit: 0.25 }), t.geo(t.PART - 1.4, t.PART - 0.6, 1.05, 1.1, -t.hl + 0.5, t.hl - 2.3));
      t.solid(t.PART - 1.3, t.PART - 0.7, -t.hl + 0.6, t.hl - 2.3, 1.1);
      const cross = t.mat(0x3aff7a, { emissive: new THREE.Color(0x2ad860) });
      t.add(cross, t.geo(t.PART - 0.14, t.PART - 0.1, 2.2, 3.0, -0.12, 0.12));
      t.add(cross, t.geo(t.PART - 0.14, t.PART - 0.1, 2.48, 2.72, -0.4, 0.4));
      // Waiting chairs by the window, strip lights in the ceiling
      for (let i = 0; i < 4; i++) {
        const s = t.sideSign * (2.2 + i * 0.7);
        t.add(t.mat(0x3a6ab0, { lit: 0.3 }), t.geo(0.6, 1.1, 0.42, 0.48, s - 0.25, s + 0.25));
        t.add(t.mat(0x3a6ab0, { lit: 0.3 }), t.geo(1.05, 1.1, 0.48, 0.95, s - 0.25, s + 0.25));
      }
      const tube = t.mat(0xf4fbff, { emissive: new THREE.Color(0xcfe6f2) });
      for (const a of [2.5, 5.5]) for (const s of [-3, 2]) t.add(tube, t.geo(a - 0.6, a + 0.6, STOREY - 0.17, STOREY - 0.12, s - 0.12, s + 0.12));
      const poster = t.mat(0xffffff, { map: textTex(['FLU SEASON', 'GET VACCINATED'], '#f2f2ee', '#2a6a3e', 256, 256, 'bold 28px Arial'), lit: 0.4 });
      t.add(poster, t.put(new THREE.PlaneGeometry(1, 1), 4, 1.8, -t.sideSign * (t.hl - 0.32), t.sideSign > 0 ? 0 : Math.PI));
      // The storeroom: cardboard stacks, a rack, a desk and a cabinet
      const card = t.mat(tan, { lit: 0.3 });
      for (let i = 0; i < 6; i++) t.add(card, t.put(box(0.6, 0.45, 0.5), t.D - 0.8 - (i % 2) * 0.7, 0.23 + Math.floor(i / 2) * 0.46, -t.sideSign * (t.hl - 1.2), (i % 3) * 0.15));
      t.solid(t.D - 1.6, t.D - 0.4, -t.sideSign * (t.hl - 0.7) - 0.4, -t.sideSign * (t.hl - 0.7) + 0.4, 1.4);
      t.add(t.mat(0x8a8e90, { metal: 0.5, rough: 0.5, lit: 0.2 }), t.geo(t.PART + 0.3, t.PART + 0.8, 0, 1.8, 0, 2));
      t.add(t.mat(wood, { lit: 0.3 }), t.geo(t.PART + 1.6, t.PART + 2.4, 0.72, 0.76, -1.8, -0.4));
      t.add(t.mat(0x222428), t.geo(t.PART + 1.9, t.PART + 2.0, 0.76, 1.1, -1.4, -0.8));
      t.add(t.mat(0x6a6e70, { metal: 0.4, lit: 0.2 }), t.geo(t.PART + 0.3, t.PART + 0.8, 0, 1.3, -2.6, -2.0));
    },
  },

  /* HARBOUR VIEW APARTMENTS: the lobby, wood floor and a rug, the desk by
     the door, a wall of mailboxes, a sofa and armchairs round a table,
     plants, a stair climbing to a blocked landing, the lift doors; the back
     corridor to the flats. */
  lobby: {
    name: 'Harbour View Apartments', sign: 'HARBOUR VIEW', signBg: '#1c2430', signFg: '#e8c87a',
    wall: 0x9a6a52, trim: 0xd8c8a4, paintTop: '#e6dcc4', paintBottom: '#9c8a6a', ceiling: 0xe0d8c4,
    floor: plankTex, floorTile: 1.6, partDoorS: 0,
    furnish(t) {
      const desk = t.mat(0x4a3424, { lit: 0.3, rough: 0.5 }), brass = t.mat(0xc8a860, { metal: 0.7, rough: 0.35, lit: 0.2 });
      // The rug, the reception desk by the door
      t.add(t.mat(0x7a2a2a, { lit: 0.3, rough: 1 }), t.put(new THREE.PlaneGeometry(4, 3).rotateX(-Math.PI / 2), 4.6, 0.05, 0.5));
      const ds = -t.sideSign * 3.4;
      t.add(desk, t.geo(1.6, 2.3, 0, 1.05, ds - 1.4, ds + 1.4));
      t.add(brass, t.geo(1.55, 2.35, 1.05, 1.1, ds - 1.45, ds + 1.45));
      t.solid(1.6, 2.3, ds - 1.4, ds + 1.4, 1.1);
      t.add(t.mat(0xf2e8c8, { emissive: new THREE.Color(0xffd890) }), t.put(new THREE.SphereGeometry(0.12, 10, 8), 1.95, 1.3, ds + 1));
      // The mailboxes on the side wall
      t.add(t.mat(0xffffff, { map: mailboxTex(), lit: 0.35 }), t.put(new THREE.PlaneGeometry(3, 1.5), 3.4, 1.5, -t.sideSign * (t.hl - 0.32), t.sideSign > 0 ? 0 : Math.PI));
      // A sofa and two armchairs round a low table; plants
      const fabric = t.mat(0x5a6a7a, { lit: 0.3 });
      t.add(fabric, t.geo(5.6, 6.4, 0, 0.45, -0.9, 0.9));
      t.add(fabric, t.geo(6.2, 6.4, 0.45, 0.95, -0.9, 0.9));
      for (const s of [-1.6, 1.6]) { t.add(fabric, t.geo(4.4, 5.1, 0, 0.45, s - 0.4, s + 0.4)); t.add(fabric, t.geo(4.4, 5.1, 0.45, 0.9, s + Math.sign(s) * 0.3, s + Math.sign(s) * 0.4)); }
      t.add(desk, t.geo(4.4, 5.4, 0.35, 0.4, -0.6, 0.6));
      t.solid(5.6, 6.4, -0.9, 0.9, 0.95);
      for (const [a, s] of [[0.7, t.sideSign * 6.2], [0.7, -t.sideSign * 6.2], [t.PART - 0.6, t.sideSign * 6.2]]) {
        t.add(t.mat(0x8a5a3a, { lit: 0.25 }), t.put(cyl(0.25, 0.2, 0.5), a, 0.25, s));
        t.add(t.mat(0x4a7a3a, { lit: 0.3 }), t.put(new THREE.IcosahedronGeometry(0.5, 0), a, 0.95, s));
      }
      // The stair up to the landing (blocked above by the slab and rubble)
      for (let k = 0; k < 10; k++) t.add(t.mat(0x8a7a62, { lit: 0.3 }), t.geo(2.6 + k * 0.32, 2.92 + k * 0.32, 0, 0.18 + k * 0.32, t.sideSign * (t.hl - 1.5), t.sideSign * (t.hl - 0.32) * 1));
      t.solid(2.6, 5.8, Math.min(t.sideSign * (t.hl - 1.5), t.sideSign * (t.hl - 0.32)), Math.max(t.sideSign * (t.hl - 1.5), t.sideSign * (t.hl - 0.32)), 2.2);
      for (let i = 0; i < 6; i++) t.add(t.mat(0x6a6460, { lit: 0.2 }), t.put(new THREE.DodecahedronGeometry(0.2 + Math.random() * 0.2, 0), 5.6 + Math.random() * 0.6, 3.1 + Math.random() * 0.3, t.sideSign * (t.hl - 0.9)));
      // The lift doors on the partition, a chandelier
      t.add(t.mat(steel, { metal: 0.8, rough: 0.25, lit: 0.2 }), t.geo(t.PART - 0.14, t.PART - 0.1, 0, 2.3, -t.sideSign * 3.6, -t.sideSign * 2.2));
      t.add(t.mat(0x111111), t.geo(t.PART - 0.15, t.PART - 0.13, 0, 2.3, -t.sideSign * 2.92, -t.sideSign * 2.88));
      t.add(brass, t.put(cyl(0.5, 0.3, 0.3, 12), 4.6, STOREY - 0.6, 0.5));
      t.add(t.mat(0xfff2c8, { emissive: new THREE.Color(0xffe0a0) }), t.put(new THREE.SphereGeometry(0.16, 10, 8), 4.6, STOREY - 0.85, 0.5));
      // The corridor behind: doors to the flats, a laundry cart, boxes
      for (const s of [-4, -1, 2]) {
        t.add(desk, t.geo(t.D - 0.32, t.D - 0.28, 0, 2.1, s - 0.45, s + 0.45));
        t.add(brass, t.put(new THREE.SphereGeometry(0.04, 6, 4), t.D - 0.34, 1.05, s + 0.3));
      }
      t.add(t.mat(0x8a8e90, { metal: 0.4, lit: 0.2 }), t.geo(t.PART + 1, t.PART + 1.8, 0.2, 0.9, 3, 4));
      t.add(t.mat(0xd8d8d0, { lit: 0.3 }), t.put(new THREE.IcosahedronGeometry(0.35, 0), t.PART + 1.4, 1.0, 3.5));
      for (let i = 0; i < 3; i++) t.add(t.mat(tan, { lit: 0.3 }), t.put(box(0.55, 0.4, 0.5), t.PART + 3 + (i % 2) * 0.3, 0.2 + (i >> 1) * 0.4, -5));
    },
  },
};

/** Builds the harbour's walk-in buildings (Level 2); [] elsewhere. */
export function buildHideouts() {
  return (layout().hideouts || []).map(buildHideout);
}
