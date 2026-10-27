// Level 3 story beats. Mission code owns the selected intent and its consequences.
export const OPENING_CONVERSATION = [
  {
    id: 'l3-humanity-arrival',
    speaker: 'DR. JAMES / SECURE CHANNEL',
    title: 'A chance, at last',
    text: 'The recovered compound makes a cure viable now. This quarantine broadcast facility still needs power; bring its array online to send the treatment across the district. Keep them alive where you can.',
    continueLabel: 'How?'
  },
  {
    id: 'l3-humanity-question',
    speaker: 'PLAYER',
    title: 'The question between us',
    text: 'They’re still people? I have killed them just to stay alive. Could they have come back?',
    continueLabel: 'Hear him out'
  },
  {
    id: 'l3-humanity-answer',
    speaker: 'DR. JAMES / SECURE CHANNEL',
    title: 'What changed',
    text: 'I didn’t know before. The compound we recovered changes what’s possible now. The quarantine facility still needs power; once its broadcast array is online, we can send the treatment across the district. That doesn’t make the past a choice you could have made.',
    continueLabel: 'Go on'
  },
  {
    id: 'l3-humanity-defense',
    speaker: 'DR. JAMES / SECURE CHANNEL',
    title: 'Stay alive',
    text: 'They may still attack. Protect yourself if you have to. But where you can, make room for the cure. I won’t pretend there’s an easy answer.',
    continueLabel: 'Move'
  },
  {
    id: 'l3-humanity-intent',
    speaker: 'DR. JAMES / SECURE CHANNEL',
    title: 'Secure the quarantine facility',
    text: 'The industrial controls will sound alarms. Clear the road ambushes and every generator, cooling and uplink defence before advancing. Your projector has five charges: shoot or cure regular infected. The facility\'s containment worker is beyond this treatment; you must kill the infected worker to reach the broadcast controls.',
    continueLabel: 'Fight through'

  }
];

export function endingReflection({ kills = 0, saved = 0, guardianSpared = false, intent = 'undecided' } = {}) {
  const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const killed = count(kills);
  const rescued = count(saved);
  return `You killed ${killed} infected and saved ${rescued}. The guardian was killed. You fought through the ambushes to broadcast the cure.`;
}
