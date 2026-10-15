import { isMuted } from './Music.js';

// Small, disposable audio layer. Browsers may keep it silent until a gesture.
export function createStoryAudio() {
  let ctx;
  const voices = new Set();
  function cue(kind = 'radio') {
    try {
      if (isMuted()) return; // the sound button silences story cues too
      ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      const t = ctx.currentTime, duration = kind === 'rumble' ? 2.4 : 0.35;
      osc.type = kind === 'rumble' ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(kind === 'rumble' ? 45 : 620, t);
      osc.frequency.exponentialRampToValueAtTime(kind === 'rumble' ? 22 : 190, t + duration);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(kind === 'rumble' ? 0.09 : 0.025, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain); gain.connect(ctx.destination); voices.add(osc);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); voices.delete(osc); };
      osc.start(); osc.stop(t + duration);
    } catch { /* Audio is optional; the story remains readable. */ }
  }
  return { cue, dispose() { for (const v of voices) { try { v.stop(); } catch {} } voices.clear(); if (ctx) void ctx.close().catch(() => {}); } };
}
