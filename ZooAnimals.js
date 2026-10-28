/* ======================================================================
   ZooAnimals.js — THE ZOO'S INFECTED LIONS (Level 2)

   Let out by the quake (Level2Quake.js), they come through the broken
   fence, down the west street and in from the west side street, and run
   at you, trailing brown air (trailHaze) behind the pack. Built in code,
   no model files: a maned male and a lioness, each body one mesh with its
   colours baked in (rounded torso, chest and haunches, head, muzzle, ears,
   a tufted tail, mange and wounds), and every lion's legs two instanced
   meshes between them (thigh, and shin with paw), bending at the knee as
   they lope. Faster than a run, slower than a sprint; two shots, or one to
   the head; they maul on contact. Solid against the street like the
   infected (pushOutOfSolids). Bullets find them via state.extraShotTargets.
====================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, sfx, pushKillFeed, STREET_HALF_W } from './Scene.js';
import { state } from './state.js';
import { damagePlayer } from './Actions.js';
import { pushOutOfSolids } from './characters.js';
import { spawnBloodSpray, placeBloodSplat, trailHaze } from './ImpactFX.js';
import { gfx } from './GraphicsProfile.js';

const PACK = gfx.low ? 4 : 6, EASY_COUNT = 3;
const SPEED = [6.0, 7.2];   // m/s; the player sprints at 8.4
const FULL_HEALTH = 2;      // shots (a head shot is one)
const BITE_M = 1.7, BITE_DAMAGE = 9, BITE_EVERY = 0.9;
const BODY_R = 0.55;        // for walls and each other
const RELEASE_GAP = 0.45;   // s between lions breaking into the street
const HAZE_EVERY = 0.32;    // s between patches of brown air behind a running lion
// Where they come into the main street from: the west side street off the
// junction, the way down from the zoo (CityLayout harbour: z -55)
const ENTRY = new THREE.Vector3(-10, 0, -55);
const FROM = [[-24, -51], [-27, -56], [-22, -59], [-30, -53], [-25, -61], [-29, -58]];

/* --- The bodies --------------------------------------------------------- */
// A part in its own colour (vertex colours: one material for the whole body)
function part(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = g.attributes.position.count, colours = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return g;
}
const ball = (r, sx, sy, sz, x, y, z, hex) => part(new THREE.SphereGeometry(r, 12, 8).scale(sx, sy, sz).translate(x, y, z), hex);
// Infected colours: the coat drained toward grey-green, mange, open wounds
const COAT = 0x9a7d55, BELLY = 0xb09670, MANE = 0x3e2a1c, MANGE = 0x6e6a5a, WOUND = 0x5a0a0a, DARK = 0x1c1612;
function lionBody(maned) {
  const w = maned ? 1 : 0.9; // a lioness is a little slighter
  const parts = [
    ball(0.5, 0.6 * w, 0.58, 1.05, 0, 0.98, 0, COAT),            // torso
    ball(0.42, 0.72 * w, 0.82, 0.78, 0, 1.0, 0.45, COAT),        // chest
    ball(0.4, 0.74 * w, 0.8, 0.78, 0, 0.98, -0.5, COAT),         // haunches
    ball(0.38, 0.5 * w, 0.35, 0.95, 0, 0.78, 0, BELLY),          // belly, paler
    part(new THREE.CylinderGeometry(0.17, 0.23, 0.44, 10).rotateX(-0.9).translate(0, 1.18, 0.72), COAT), // neck
    ball(0.26, 1, 0.92, 1.12, 0, 1.3, 0.96, COAT),               // head
    part(new THREE.CylinderGeometry(0.1, 0.13, 0.24, 10).rotateX(Math.PI / 2).translate(0, 1.22, 1.2), BELLY), // muzzle
    ball(0.05, 1.2, 0.8, 1, 0, 1.27, 1.32, DARK),                // nose
    part(new THREE.BoxGeometry(0.17, 0.05, 0.18).rotateX(0.35).translate(0, 1.09, 1.17), WOUND), // a hanging, bloodied jaw
    ball(0.035, 1, 1, 1, 0.11, 1.38, 1.18, 0xd6dc9a),            // clouded eyes
    ball(0.035, 1, 1, 1, -0.11, 1.38, 1.18, 0xd6dc9a),
    part(new THREE.ConeGeometry(0.07, 0.12, 6).translate(0.15, 1.53, 0.9), COAT), // ears
    part(new THREE.ConeGeometry(0.07, 0.12, 6).translate(-0.15, 1.53, 0.9), COAT),
    // Tail: down off the rump, then out, with a dark tuft
    part(new THREE.CylinderGeometry(0.045, 0.04, 0.5, 6).rotateX(-0.5).translate(0, 0.95, -0.98), COAT),
    part(new THREE.CylinderGeometry(0.04, 0.03, 0.45, 6).rotateX(-1.3).translate(0, 0.78, -1.35), COAT),
    ball(0.08, 1, 1, 1.4, 0, 0.72, -1.58, DARK),
    // Mange and wounds
    ball(0.16, 0.25, 1, 1.4, 0.29 * w, 1.05, -0.15, MANGE),
    ball(0.14, 0.25, 0.9, 1.2, -0.3 * w, 0.92, 0.28, WOUND),
    ball(0.12, 0.25, 1.1, 1.3, 0.3 * w, 0.85, -0.55, WOUND),
  ];
  if (maned) {
    parts.push(
      ball(0.44, 1.08, 1.12, 0.72, 0, 1.26, 0.82, MANE),         // the mane round the head
      ball(0.3, 1.0, 1.1, 0.9, 0, 1.0, 0.68, MANE),              // the ruff down the chest
    );
  }
  return mergeGeometries(parts);
}
const BODIES = [lionBody(true), lionBody(false)];
const BODY_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
// Legs: a thigh hung from the hip, a shin with its paw hung from the knee
const UPPER_LEN = 0.42, LOWER_LEN = 0.42;
const UPPER = new THREE.CylinderGeometry(0.1, 0.075, UPPER_LEN, 7).translate(0, -UPPER_LEN / 2, 0);
const LOWER = mergeGeometries([
  new THREE.CylinderGeometry(0.065, 0.055, LOWER_LEN, 7).translate(0, -LOWER_LEN / 2, 0),
  new THREE.SphereGeometry(0.085, 8, 6).scale(1, 0.55, 1.35).translate(0, -LOWER_LEN, 0.035),
]);
const HIPS = [[0.19, 0.86, 0.46], [-0.19, 0.86, 0.46], [0.19, 0.86, -0.5], [-0.19, 0.86, -0.5]];
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4(), _hip = new THREE.Matrix4(), _r = new THREE.Matrix4(), _knee = new THREE.Matrix4();
const _d = new THREE.Vector3(), _c = new THREE.Vector3(), _hit = new THREE.Vector3(), _sphere = new THREE.Sphere();

export function createZooAnimals() {
  // Easy (Difficulty.js): fewer of them, and a shot each (created after the
  // difficulty is set)
  const easy = state.difficulty === 'easy';
  const COUNT = easy ? EASY_COUNT : PACK, HEALTH = easy ? 1 : FULL_HEALTH;
  const legMat = new THREE.MeshStandardMaterial({ color: 0x8e7350, roughness: 0.9 });
  const uppers = new THREE.InstancedMesh(UPPER, legMat, COUNT * 4), lowers = new THREE.InstancedMesh(LOWER, legMat, COUNT * 4);
  for (const legs of [uppers, lowers]) {
    legs.name = 'zoo-lion-legs';
    legs.castShadow = true;
    legs.frustumCulled = false;
    scene.add(legs);
  }
  const lions = Array.from({ length: COUNT }, (_, i) => {
    const mesh = new THREE.Mesh(BODIES[i % 2], BODY_MATERIAL);
    mesh.name = 'zoo-lion';
    mesh.castShadow = true;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, p: new THREE.Vector3(), yaw: 0, speed: 6, health: HEALTH, phase: 0, bite: 0, haze: 0, alive: false, deadFor: -1 };
  });
  let queue = 0, nextIn = 0;

  function bringOut(lion, i) {
    const [x, z] = FROM[i % FROM.length];
    lion.p.set(x, 0, z);
    lion.yaw = Math.PI / 2; // facing east, toward the main street
    lion.speed = SPEED[0] + Math.random() * (SPEED[1] - SPEED[0]);
    lion.health = HEALTH;
    lion.phase = Math.random() * 6;
    lion.bite = 0;
    lion.haze = Math.random() * HAZE_EVERY;
    lion.alive = true;
    lion.deadFor = -1;
    lion.mesh.visible = true;
    sfx.noise(0.6, 0.16, 160); // a roar
  }

  function die(lion, from) {
    lion.alive = false;
    lion.deadFor = 0;
    placeBloodSplat(lion.p);
    spawnBloodSpray(_c.set(lion.p.x, 1, lion.p.z), from, true, 0);
    sfx.noise(0.3, 0.1, 220);
    pushKillFeed('Infected lion down');
  }

  // One leg: thigh at the hip swung by `swing`, shin bent at the knee by `bend`
  function poseLeg(i, k, body, hip, swing, bend) {
    _m.copy(body).multiply(_hip.makeTranslation(hip[0], hip[1], hip[2])).multiply(_r.makeRotationX(swing));
    uppers.setMatrixAt(i * 4 + k, _m);
    _m.multiply(_knee.makeTranslation(0, -UPPER_LEN, 0)).multiply(_r.makeRotationX(bend));
    lowers.setMatrixAt(i * 4 + k, _m);
  }

  return {
    /** The quake broke the fence: the lions start coming, a little apart. */
    release() { queue = COUNT; nextIn = 0; },
    get loose() { return lions.some((l) => l.alive) || queue > 0; },

    update(dt, playerPos) {
      if (queue > 0 && (nextIn -= dt) <= 0) { bringOut(lions[COUNT - queue], COUNT - queue); queue--; nextIn = RELEASE_GAP; }
      const frozen = state.paused || state.isDead || state.cinematic || state.narrativeBlocked;
      lions.forEach((lion, i) => {
        if (!lion.mesh.visible) {
          for (let k = 0; k < 4; k++) { uppers.setMatrixAt(i * 4 + k, HIDDEN); lowers.setMatrixAt(i * 4 + k, HIDDEN); }
          return;
        }
        let running = false;
        if (!frozen && lion.alive) {
          // Out of the side street first, then straight at you
          const target = lion.p.x < -STREET_HALF_W - 2 ? ENTRY : playerPos;
          _d.subVectors(target, lion.p).setY(0);
          const toPlayer = Math.hypot(playerPos.x - lion.p.x, playerPos.z - lion.p.z);
          if (toPlayer < BITE_M) {
            lion.bite -= dt;
            if (lion.bite <= 0) { lion.bite = BITE_EVERY; damagePlayer(BITE_DAMAGE * (state.zombieDamageMul || 1)); }
            _d.subVectors(playerPos, lion.p).setY(0);
            lion.phase += dt * 4;
          } else if (_d.lengthSq() > 1e-4) {
            _d.normalize();
            lion.p.addScaledVector(_d, lion.speed * dt);
            lion.phase += dt * lion.speed * 2.2;
            running = true;
          }
          pushOutOfSolids(lion.p, BODY_R);
          if (_d.lengthSq() > 1e-4) {
            const want = Math.atan2(_d.x, _d.z);
            let diff = want - lion.yaw;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            lion.yaw += diff * Math.min(1, dt * 8);
          }
          // Brown air hanging behind it as it runs
          if (running && (lion.haze -= dt) <= 0) {
            lion.haze = HAZE_EVERY;
            trailHaze(_c.set(lion.p.x - Math.sin(lion.yaw) * 1.4, 0, lion.p.z - Math.cos(lion.yaw) * 1.4));
          }
        } else if (!lion.alive && lion.deadFor >= 0 && !frozen) {
          lion.deadFor += dt;
          if (lion.deadFor > 9) lion.mesh.visible = false; // gone with the rest of the dead
        }
        // The body: a loping bob and a little pitch alive, rolled onto its side dead
        const roll = lion.alive ? 0 : Math.min(1, lion.deadFor / 0.35) * Math.PI / 2;
        const bob = lion.alive ? Math.abs(Math.sin(lion.phase)) * 0.08 : 0.05;
        lion.mesh.position.set(lion.p.x, bob, lion.p.z);
        lion.mesh.rotation.set(running ? Math.sin(lion.phase * 2) * 0.05 : 0, lion.yaw, roll, 'YXZ');
        lion.mesh.updateMatrix();
        // A bounding lope: the front pair together, the hind pair together,
        // each pair half a stride from the other; front knees fold back,
        // hind hocks fold forward, most as the leg lifts
        HIPS.forEach((hip, k) => {
          const front = k < 2, step = lion.phase + (front ? 0 : Math.PI) + (k % 2) * 0.35;
          const swing = lion.alive ? Math.sin(step) * (running ? 0.7 : 0.15) : 0.3;
          const lift = lion.alive ? Math.max(0, Math.cos(step)) * (running ? 1 : 0.3) : 0.2;
          poseLeg(i, k, lion.mesh.matrix, hip, swing, (front ? -1 : 1) * (0.15 + 0.85 * lift));
        });
      });
      uppers.instanceMatrix.needsUpdate = true;
      lowers.instanceMatrix.needsUpdate = true;
    },

    /** For tryShoot (state.extraShotTargets): the nearest lion on the ray. */
    rayHit(ray, far) {
      let best = null;
      for (const lion of lions) {
        if (!lion.alive) continue;
        const fx = Math.sin(lion.yaw), fz = Math.cos(lion.yaw);
        for (const [ox, oy, oz, r, head] of [[0, 0.98, 0, 0.62, false], [fx * 0.98, 1.3, fz * 0.98, 0.3, true]]) {
          _sphere.center.set(lion.p.x + ox, oy, lion.p.z + oz);
          _sphere.radius = r;
          if (!ray.intersectSphere(_sphere, _hit)) continue;
          const distance = ray.origin.distanceTo(_hit);
          if (distance > far || (best && distance >= best.distance)) continue;
          const point = _hit.clone(), target = lion, isHead = head;
          best = {
            distance, point,
            hit: (direction) => {
              if (!target.alive) return;
              target.health -= isHead ? HEALTH : 1;
              spawnBloodSpray(point, direction, isHead, 0);
              sfx.hit();
              if (target.health <= 0) die(target, direction);
            },
          };
        }
      }
      return best;
    },

    reset() {
      queue = 0;
      for (const lion of lions) { lion.alive = false; lion.deadFor = -1; lion.mesh.visible = false; }
    },
  };
}
