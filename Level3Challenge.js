// Level 3 pressure is bounded so difficulty does not undo the rendering budget.
const easy = Object.freeze({ activeCap: 3, spawnInterval: 1.25, speedMul: 1,
  bossMinions: 2, bossSpawnInterval: 1.7, rescueSeconds: 4 });
const impossible = Object.freeze({ activeCap: 10, spawnInterval: .65, speedMul: 1.25,
  bossMinions: 5, bossSpawnInterval: 1, rescueSeconds: 5 });
export function level3Challenge(difficulty) { return difficulty === 'impossible' ? impossible : easy; }
