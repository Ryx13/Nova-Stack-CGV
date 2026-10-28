/* ======================================================================
   ZombieNav.js — THE WAYS ROUND THE WALLS (Levels 1 and 2)

   The infected used to be held to the main street; now they go wherever
   you go, so they need ways round the buildings. A street map, built once
   from the level's plan (CityLayout): points along the main street, the
   back streets and the cross streets, the side roads at the junctions,
   across a park that opens onto the main street, and through the walk-in
   buildings (Hideouts.js: street door, rooms, side door, state.navChains).
   Points on different streets are joined wherever the walk between them
   is clear of solids.

   A walker (an infected, a lion) heads straight for you while nothing
   solid is in the way; otherwise it takes the shortest way along the map
   (A*) from the nearest point it can reach to the nearest point that can
   reach you, and goes straight for you again once it can. Rechecked about
   once a second, each walker at its own moment, so the cost stays small.
   "Clear" is the caller's: setNavBlocker gives the test (characters.js,
   against the same boxes the infected collide with).
====================================================================== */
import { state } from './state.js';
import { layout, inPlay } from './CityLayout.js';
import { STREET_HALF_W } from './Scene.js';

const STREET_STEP = 15, CROSS_STEP = 8; // m between map points
const STITCH_M = 12;                    // join points on different streets this close
const REPLAN_S = 1;                     // s between a walker's rechecks
const REACHED_M = 1.6;                  // this close to a point: on to the next
const NEAREST = 8;                      // map points tried for a start or an end

var blocked = () => false; // var: set from characters.js while the modules are still loading
/** (ax, az, bx, bz) -> true when a solid stands between the two points. */
export function setNavBlocker(fn) { blocked = fn; }

/** Whether walkers here use the map (the city levels; Level 3 has its own crowd). */
export const navActive = () => !!state.cityKit && state.levelId !== 3;

let nodes = null; // [{ x, z, chain, links: [index] }]
const range = (a, b, step) => {
  const out = [], n = Math.max(1, Math.round(Math.abs(b - a) / step));
  for (let i = 0; i <= n; i++) out.push(a + (b - a) * (i / n));
  return out;
};
function build() {
  nodes = [];
  let chainId = 0;
  const chain = (all) => {
    const points = all.filter(([x, z]) => inPlay(x, z, 0.8)); // nothing past the boundary walls
    const id = chainId++, first = nodes.length;
    points.forEach(([x, z], i) => {
      nodes.push({ x, z, chain: id, links: [] });
      if (i) { nodes[first + i].links.push(first + i - 1); nodes[first + i - 1].links.push(first + i); }
    });
  };
  const L = layout(), m = L.main;
  chain(range(m.zN, m.zS, STREET_STEP).map((z) => [0, z]));
  for (const st of L.backStreets) if (!st.far) chain(range(st.z0, st.z1, STREET_STEP).map((z) => [st.x, z]));
  for (const c of L.crossStreets) chain(range(c.x0, c.x1, CROSS_STEP).map((x) => [x, c.z]));
  // The side roads at the main street's junctions, carried on to a cross
  // street at the same z if there is one (Level 2's west pocket)
  for (const j of m.junctions || []) {
    let end = j.side * (STREET_HALF_W + j.reach);
    const c = L.crossStreets.find((cs) => Math.abs(cs.z - j.z) < 1 && Math.sign(cs.x0 + cs.x1) === j.side);
    if (c) end = Math.abs(c.x0) < Math.abs(c.x1) ? c.x0 : c.x1;
    // Or on through an open yard to the back street beyond (Level 1's depot)
    else if (L.keepClear.some((k) => k.opens && j.z <= k.z0 && j.z >= k.z1)) {
      const back = L.backStreets.filter((st) => !st.far && Math.sign(st.x) === j.side).sort((a, b) => Math.abs(a.x) - Math.abs(b.x))[0];
      if (back) end = back.x;
    }
    chain(range(0, end, CROSS_STEP).map((x) => [x, j.z])); // from the main street's middle, so it joins it
  }
  // Across a park that opens onto the main street, where a cross street meets it
  for (const o of m.open || []) {
    for (const c of L.crossStreets) {
      if (c.z > o.z0 || c.z < o.z1) continue;
      const near = Math.min(Math.abs(c.x0), Math.abs(c.x1)) * o.side;
      chain(range(0, near, CROSS_STEP).map((x) => [x, c.z]));
    }
  }
  for (const points of state.navChains || []) chain(points);
  // Stitch the streets together where the walk between is clear
  for (let i = 0; i < nodes.length; i++) {
    for (let k = i + 1; k < nodes.length; k++) {
      const a = nodes[i], b = nodes[k];
      if (a.chain === b.chain || Math.hypot(a.x - b.x, a.z - b.z) > STITCH_M) continue;
      if (blocked(a.x, a.z, b.x, b.z)) continue;
      a.links.push(k); b.links.push(i);
    }
  }
}

// The nearest map point a walker at (x, z) can walk straight to
function nearestReachable(x, z) {
  const order = nodes.map((n, i) => [Math.hypot(n.x - x, n.z - z), i]).sort((a, b) => a[0] - b[0]).slice(0, NEAREST);
  for (const [, i] of order) if (!blocked(x, z, nodes[i].x, nodes[i].z)) return i;
  return order.length ? order[0][1] : -1;
}
// A*: map points from start to goal
function route(start, goal) {
  const g = new Map([[start, 0]]), came = new Map(), open = new Set([start]);
  const h = (i) => Math.hypot(nodes[i].x - nodes[goal].x, nodes[i].z - nodes[goal].z);
  const f = new Map([[start, h(start)]]);
  while (open.size) {
    let cur = -1, best = Infinity;
    for (const i of open) if (f.get(i) < best) { best = f.get(i); cur = i; }
    if (cur === goal) {
      const path = [cur];
      while (came.has(cur)) { cur = came.get(cur); path.unshift(cur); }
      return path;
    }
    open.delete(cur);
    for (const nb of nodes[cur].links) {
      const cost = g.get(cur) + Math.hypot(nodes[cur].x - nodes[nb].x, nodes[cur].z - nodes[nb].z);
      if (cost < (g.get(nb) ?? Infinity)) { came.set(nb, cur); g.set(nb, cost); f.set(nb, cost + h(nb)); open.add(nb); }
    }
  }
  return null;
}

/** A walker's own state: hand it to navGoal every frame. */
export function createNavigator() { return { route: null, t: Math.random() * REPLAN_S }; }

/** Where a walker at pos should head this frame to get to goal: goal itself
    when the way is clear, else the next point on its route round the walls. */
export function navGoal(nav, pos, goal, dt) {
  if (!navActive()) return goal;
  if (!nodes) build();
  if ((nav.t -= dt) <= 0) {
    nav.t = REPLAN_S;
    if (!blocked(pos.x, pos.z, goal.x, goal.z)) nav.route = null;
    else {
      const a = nearestReachable(pos.x, pos.z), b = nearestReachable(goal.x, goal.z);
      nav.route = a >= 0 && b >= 0 ? route(a, b) : null;
    }
  }
  while (nav.route?.length) {
    const n = nodes[nav.route[0]];
    if (Math.hypot(n.x - pos.x, n.z - pos.z) > REACHED_M) return n;
    nav.route.shift();
  }
  nav.route = null;
  return goal;
}

/** The town changed (a new level): rebuild the map on next use. */
export function resetNavMap() { nodes = null; }
