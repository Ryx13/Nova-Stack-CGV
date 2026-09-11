/* ======================================================================
   SAFEROOM SUPPLY — example catalog preset
   (Nova-Stack-CGV project root: saferoomSupplyCatalog.js)

   WHAT IT IS
   One concrete stock list for the vending machine: the full Saferoom
   Supply lineup (weapons, throwables, support items, backpacks) with
   procedural icon art for each product. This is level content, not
   part of the reusable machine — VendingMachine.js (which owns the
   catalog structure and card renderer internally) knows nothing about
   any of this.

   HOW TO USE
     import { VendingMachine } from './VendingMachine.js';
     import { saferoomSupplyCatalog } from './saferoomSupplyCatalog.js';

     const vending = new VendingMachine({ scene, position, rotationY,
       catalog: saferoomSupplyCatalog });

   HOW TO MAKE YOUR OWN LEVEL'S CATALOG
   Copy this file, rename it, and edit freely: reorder products, drop
   ones you don't need, change prices/stock per machine, or write new
   icons with makeIcon(). Nothing here is shared mutable state — every
   VendingMachine instance gets its own independent copy of whatever
   catalog object you pass in, so two machines (even using this same
   preset) can carry different prices or stock without colliding, as
   in level 2's two-machine setup.
   ====================================================================== */

// makeIcon (procedural product-icon canvas helper) is the one thing the
// machine exports for catalog files — see VendingMachine.js.
import { makeIcon } from './VendingMachine.js';

const weapons = [];
const throwables = [];
const support = [];
const backpacks = [];

/* ----- Stage 5: Shotgun --------------------------------------------- */
weapons.push({
  id: 'shotgun',
  itemId: 'shotgun',
  name: 'SHOTGUN',
  category: 'weapons',
  price: 3250,
  stock: 10,
  icon: makeIcon(96, 48, (ctx) => {
    ctx.fillStyle = '#99aa88';
    // barrel
    ctx.fillRect(10, 18, 62, 4);
    // receiver
    ctx.fillRect(52, 14, 18, 12);
    // stock
    ctx.fillRect(70, 16, 18, 8);
    ctx.fillRect(84, 12, 6, 18);
    // pump grip
    ctx.fillRect(28, 22, 18, 5);
    // trigger guard
    ctx.strokeStyle = '#99aa88'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(54, 28, 4, 0, Math.PI);
    ctx.stroke();
  }),
});

/* ----- Stage 6: Assault Rifle --------------------------------------- */
weapons.push({
  id: 'assault_rifle',
  itemId: 'assault_rifle',
  name: 'ASSAULT RIFLE',
  category: 'weapons',
  price: 4250,
  stock: 8,
  icon: makeIcon(96, 48, (ctx) => {
    ctx.fillStyle = '#99aa88';
    // barrel
    ctx.fillRect(6, 17, 50, 3);
    // front sight
    ctx.fillRect(8, 14, 2, 3);
    // receiver
    ctx.fillRect(40, 13, 22, 10);
    // magazine (curved)
    ctx.fillRect(48, 23, 6, 12);
    ctx.fillRect(47, 30, 4, 5);
    // stock
    ctx.fillRect(62, 15, 20, 6);
    ctx.fillRect(78, 12, 8, 14);
    // pistol grip
    ctx.fillRect(56, 23, 4, 10);
    // rear sight
    ctx.fillRect(58, 12, 2, 3);
  }),
});

/* ----- Stage 7: Crossbow ------------------------------------------ */
weapons.push({
  id: 'crossbow',
  itemId: 'crossbow',
  name: 'CROSSBOW',
  category: 'weapons',
  price: 3000,
  stock: 6,
  icon: makeIcon(96, 48, (ctx) => {
    ctx.fillStyle = '#99aa88';
    // stock
    ctx.fillRect(40, 20, 36, 5);
    ctx.fillRect(72, 17, 8, 12);
    // limbs (bow arms)
    ctx.fillRect(18, 12, 4, 24);
    ctx.fillRect(22, 14, 18, 3);
    ctx.fillRect(22, 31, 18, 3);
    // string
    ctx.strokeStyle = '#99aa88'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, 14); ctx.lineTo(38, 22);
    ctx.moveTo(20, 34); ctx.lineTo(38, 25);
    ctx.stroke();
    // bolt
    ctx.fillRect(38, 22, 30, 2);
    // bolt tip
    ctx.beginPath();
    ctx.moveTo(68, 20); ctx.lineTo(74, 23); ctx.lineTo(68, 26);
    ctx.fill();
  }),
});

/* ----- Stage 8: Sniper Rifle --------------------------------------- */
weapons.push({
  id: 'sniper_rifle',
  itemId: 'sniper_rifle',
  name: 'SNIPER RIFLE',
  category: 'weapons',
  price: 4750,
  stock: 4,
  icon: makeIcon(96, 48, (ctx) => {
    ctx.fillStyle = '#99aa88';
    // long barrel
    ctx.fillRect(4, 19, 56, 3);
    // muzzle brake
    ctx.fillRect(2, 17, 4, 7);
    // receiver
    ctx.fillRect(46, 15, 18, 10);
    // scope
    ctx.fillRect(48, 9, 14, 5);
    ctx.fillRect(50, 7, 2, 3);
    ctx.fillRect(60, 7, 2, 3);
    // stock
    ctx.fillRect(64, 16, 18, 6);
    ctx.fillRect(78, 13, 8, 14);
    // pistol grip
    ctx.fillRect(58, 25, 4, 9);
    // bipod legs
    ctx.fillRect(20, 22, 2, 10);
    ctx.fillRect(26, 22, 2, 10);
  }),
});

/* ----- Stage 9: Petrol -------------------------------------------- */
weapons.push({
  id: 'petrol',
  itemId: 'petrol',
  name: 'PETROL',
  category: 'weapons',
  price: 450,
  stock: 20,
  icon: makeIcon(96, 48, (ctx) => {
    // red fuel canister
    ctx.fillStyle = '#cc4433';
    ctx.fillRect(30, 10, 36, 28);
    // cap / spout
    ctx.fillRect(42, 4, 12, 8);
    ctx.fillRect(46, 2, 4, 4);
    // handle
    ctx.fillRect(34, 8, 28, 3);
    // label stripe
    ctx.fillStyle = '#99aa88';
    ctx.fillRect(32, 20, 32, 6);
  }),
});

/* ----- Stage 10: Grenade ------------------------------------------ */
throwables.push({
  id: 'grenade',
  itemId: 'grenade',
  name: 'GRENADE',
  category: 'throwables',
  price: 600,
  stock: 12,
  icon: makeIcon(96, 48, (ctx) => {
    ctx.fillStyle = '#667755';
    // body
    ctx.beginPath();
    ctx.ellipse(48, 28, 14, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    // pin ring
    ctx.strokeStyle = '#99aa88'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(48, 8, 5, 0, Math.PI * 2);
    ctx.stroke();
    // pin stem
    ctx.fillRect(47, 12, 2, 4);
    // lever
    ctx.fillRect(52, 10, 8, 2);
  }),
});

/* ----- Stage 11: Smoke Grenade ------------------------------------ */
throwables.push({
  id: 'smoke_grenade',
  itemId: 'smoke_grenade',
  name: 'SMOKE GRENADE',
  category: 'throwables',
  price: 800,
  stock: 8,
  icon: makeIcon(96, 48, (ctx) => {
    ctx.fillStyle = '#556655';
    // cylindrical body
    ctx.fillRect(36, 10, 24, 28);
    // top cap
    ctx.fillRect(34, 8, 28, 4);
    // bottom cap
    ctx.fillRect(34, 36, 28, 4);
    // pull ring
    ctx.strokeStyle = '#99aa88'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(48, 5, 4, 0, Math.PI * 2);
    ctx.stroke();
    // smoke wisps
    ctx.strokeStyle = '#88aa88'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(44, 40); ctx.quadraticCurveTo(40, 44, 42, 48);
    ctx.moveTo(48, 40); ctx.quadraticCurveTo(52, 44, 50, 48);
    ctx.moveTo(52, 40); ctx.quadraticCurveTo(56, 44, 54, 48);
    ctx.stroke();
  }),
});

/* ----- Stage 12: Chem Grenade ------------------------------------- */
throwables.push({
  id: 'chem_grenade',
  itemId: 'chem_grenade',
  name: 'CHEM GRENADE',
  category: 'throwables',
  price: 750,
  stock: 6,
  icon: makeIcon(96, 48, (ctx) => {
    // toxic yellow-green body
    ctx.fillStyle = '#778833';
    ctx.beginPath();
    ctx.ellipse(48, 28, 14, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    // hazard band
    ctx.fillStyle = '#aacc22';
    ctx.fillRect(34, 24, 28, 4);
    // pin ring
    ctx.strokeStyle = '#99aa88'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(48, 8, 5, 0, Math.PI * 2);
    ctx.stroke();
    // pin stem
    ctx.fillRect(47, 12, 2, 4);
    // lever
    ctx.fillRect(52, 10, 8, 2);
  }),
});

/* ----- Stage 13: Med-Kit ------------------------------------------ */
support.push({
  id: 'med_kit',
  itemId: 'med_kit',
  name: 'MED-KIT',
  category: 'support',
  price: 1200,
  stock: 15,
  icon: makeIcon(96, 48, (ctx) => {
    // white kit box
    ctx.fillStyle = '#ccccbb';
    ctx.fillRect(24, 12, 48, 28);
    // lid line
    ctx.strokeStyle = '#888877'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, 20); ctx.lineTo(72, 20);
    ctx.stroke();
    // red cross
    ctx.fillStyle = '#cc3333';
    ctx.fillRect(44, 24, 8, 14);
    ctx.fillRect(40, 28, 16, 6);
    // handle
    ctx.strokeStyle = '#ccccbb'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(48, 10, 8, Math.PI, 0);
    ctx.stroke();
  }),
});

/* ----- Stage 14: Adrenaline Shot ---------------------------------- */
support.push({
  id: 'adrenaline_shot',
  itemId: 'adrenaline_shot',
  name: 'ADRENALINE SHOT',
  category: 'support',
  price: 900,
  stock: 10,
  icon: makeIcon(96, 48, (ctx) => {
    // syringe barrel
    ctx.fillStyle = '#aabbcc';
    ctx.fillRect(20, 20, 40, 8);
    // plunger
    ctx.fillRect(60, 22, 16, 4);
    ctx.fillRect(74, 18, 4, 12);
    // needle
    ctx.fillStyle = '#ccccdd';
    ctx.fillRect(10, 23, 12, 2);
    // liquid (yellow)
    ctx.fillStyle = '#ccaa33';
    ctx.fillRect(22, 22, 20, 4);
    // cap
    ctx.fillStyle = '#cc3333';
    ctx.fillRect(8, 21, 4, 6);
  }),
});

/* ----- Stage 15: Antidote Syringe --------------------------------- */
support.push({
  id: 'antidote_syringe',
  itemId: 'antidote_syringe',
  name: 'ANTIDOTE SYRINGE',
  category: 'support',
  price: 850,
  stock: 8,
  icon: makeIcon(96, 48, (ctx) => {
    // syringe barrel
    ctx.fillStyle = '#aabbcc';
    ctx.fillRect(20, 20, 40, 8);
    // plunger
    ctx.fillRect(60, 22, 16, 4);
    ctx.fillRect(74, 18, 4, 12);
    // needle
    ctx.fillStyle = '#ccccdd';
    ctx.fillRect(10, 23, 12, 2);
    // liquid (green - antidote)
    ctx.fillStyle = '#33cc55';
    ctx.fillRect(22, 22, 20, 4);
    // cap
    ctx.fillStyle = '#33aa55';
    ctx.fillRect(8, 21, 4, 6);
  }),
});

/* ----- Stage 16: Flashlight --------------------------------------- */
support.push({
  id: 'flashlight',
  itemId: 'flashlight',
  name: 'FLASHLIGHT',
  category: 'support',
  price: 550,
  stock: 12,
  icon: makeIcon(96, 48, (ctx) => {
    // lens bezel and head
    ctx.fillStyle = '#aabbcc';
    ctx.beginPath();
    ctx.arc(26, 24, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d9f4c8';
    ctx.beginPath();
    ctx.arc(26, 24, 6, 0, Math.PI * 2);
    ctx.fill();
    // cylindrical body and tail cap
    ctx.fillStyle = '#667766';
    ctx.fillRect(34, 18, 40, 12);
    ctx.fillStyle = '#99aa88';
    ctx.fillRect(70, 16, 8, 16);
    // grip grooves
    ctx.fillStyle = '#334433';
    [42, 49, 56, 63].forEach((x) => ctx.fillRect(x, 19, 2, 10));
    // side switch
    ctx.fillStyle = '#33aa55';
    ctx.fillRect(52, 16, 8, 3);
  }),
});

/* ----- Stage 17: Small Pack --------------------------------------- */
backpacks.push({
  id: 'small_pack',
  itemId: 'small_pack',
  name: 'SMALL PACK',
  category: 'backpacks',
  price: 700,
  stock: 10,
  icon: makeIcon(96, 48, (ctx) => {
    // compact pack body
    ctx.fillStyle = '#667755';
    ctx.fillRect(34, 12, 28, 28);
    // top flap
    ctx.fillStyle = '#778866';
    ctx.fillRect(32, 10, 32, 7);
    // front pocket
    ctx.fillStyle = '#445544';
    ctx.fillRect(39, 26, 18, 10);
    // carry handle
    ctx.strokeStyle = '#99aa88'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(48, 11, 7, Math.PI, 0);
    ctx.stroke();
    // shoulder straps
    ctx.strokeStyle = '#334433'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(37, 18); ctx.lineTo(33, 36);
    ctx.moveTo(59, 18); ctx.lineTo(63, 36);
    ctx.stroke();
  }),
});

/* ----- Stage 18: Medium Pack -------------------------------------- */
backpacks.push({
  id: 'medium_pack',
  itemId: 'medium_pack',
  name: 'MEDIUM PACK',
  category: 'backpacks',
  price: 1250,
  stock: 8,
  icon: makeIcon(96, 48, (ctx) => {
    // expanded pack body
    ctx.fillStyle = '#5d7055';
    ctx.fillRect(30, 9, 36, 32);
    // top flap
    ctx.fillStyle = '#738866';
    ctx.fillRect(28, 8, 40, 8);
    // front and side pockets
    ctx.fillStyle = '#405040';
    ctx.fillRect(37, 25, 22, 12);
    ctx.fillRect(62, 19, 6, 15);
    // carry handle
    ctx.strokeStyle = '#a3b394'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(48, 10, 8, Math.PI, 0);
    ctx.stroke();
    // shoulder straps
    ctx.strokeStyle = '#304030'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(34, 17); ctx.lineTo(29, 38);
    ctx.moveTo(62, 17); ctx.lineTo(67, 38);
    ctx.stroke();
  }),
});

/* ----- Stage 19: Large Pack --------------------------------------- */
backpacks.push({
  id: 'large_pack',
  itemId: 'large_pack',
  name: 'LARGE PACK',
  category: 'backpacks',
  price: 1900,
  stock: 6,
  icon: makeIcon(96, 48, (ctx) => {
    // tall main compartment
    ctx.fillStyle = '#536a4d';
    ctx.fillRect(28, 6, 40, 36);
    // roll-top flap
    ctx.fillStyle = '#738866';
    ctx.fillRect(26, 6, 44, 8);
    // front pouch and twin side pockets
    ctx.fillStyle = '#3b4e38';
    ctx.fillRect(36, 27, 24, 12);
    ctx.fillRect(23, 19, 7, 17);
    ctx.fillRect(66, 19, 7, 17);
    // webbing straps
    ctx.fillStyle = '#9aaa84';
    ctx.fillRect(41, 15, 3, 25);
    ctx.fillRect(52, 15, 3, 25);
    // carry handle
    ctx.strokeStyle = '#b8cba6'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(48, 8, 9, Math.PI, 0);
    ctx.stroke();
  }),
});

/* ----- Stage 20: Tactical Pack ------------------------------------ */
backpacks.push({
  id: 'tactical_pack',
  itemId: 'tactical_pack',
  name: 'TACTICAL PACK',
  category: 'backpacks',
  price: 2800,
  stock: 4,
  icon: makeIcon(96, 48, (ctx) => {
    // armored main compartment
    ctx.fillStyle = '#3d5140';
    ctx.fillRect(25, 7, 46, 35);
    // reinforced lid
    ctx.fillStyle = '#5b705b';
    ctx.fillRect(23, 7, 50, 9);
    // modular front panel
    ctx.fillStyle = '#2b3c2d';
    ctx.fillRect(33, 25, 30, 14);
    // MOLLE webbing
    ctx.fillStyle = '#99aa88';
    [36, 43, 50, 57].forEach((x) => ctx.fillRect(x, 18, 3, 19));
    // side utility pouches
    ctx.fillStyle = '#4d624d';
    ctx.fillRect(20, 20, 7, 17);
    ctx.fillRect(69, 20, 7, 17);
    // radio antenna
    ctx.strokeStyle = '#99aa88'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(67, 10); ctx.lineTo(73, 3);
    ctx.stroke();
  }),
});


export const saferoomSupplyCatalog = { weapons, throwables, support, backpacks };
