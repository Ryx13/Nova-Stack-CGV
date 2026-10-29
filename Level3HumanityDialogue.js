// Level 3 story beats. Mission code owns the selected intent and its consequences.
export const OPENING_CONVERSATION = [
  {
    id: 'l3-humanity-arrival', speaker: 'DR. JAMES / 1 OF 2',
    title: 'Get the cure to the city.',
    text: 'You recovered the sample and stabilizer. Together, they make a cure. The broadcast tower can spread it across the district.\n\nRestore three systems: generator, cooling, then uplink. Follow the compass to your next task.',
    continueLabel: 'How do I help?'
  },
  {
    id: 'l3-humanity-tools', speaker: 'DR. JAMES / 2 OF 2',
    title: 'They can still be saved.',
    text: 'Shoot or cure the infected blocking your way. Your cure projector has five charges: equip it with 3 or X, aim within 6 metres, then left-click.\n\nProtect yourself. The cure only became possible with what you brought back. Clear each fight to move on.',
    continueLabel: 'Begin mission'
  }
];

export function endingReflection({ kills = 0, saved = 0, guardianSpared = false, intent = 'undecided', girlRescued = false } = {}) {
  const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const killed = count(kills);
  const rescued = count(saved);
  const girl = girlRescued ? ' Down at the jetty, the girl you found at the harbour takes her first breath of clean air without a dose.' : '';
  return `You killed ${killed} infected and saved ${rescued}. The guardian was killed. You fought through the ambushes to broadcast the cure.${girl}`;
}
