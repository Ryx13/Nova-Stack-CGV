import assert from 'node:assert/strict';
import {GuardianCombat,GuardianGas,GuardianShockwave,GUARDIAN_RUPTURE_DAMAGE,GUARDIAN_SHOCKWAVE_RADIUS} from '../GuardianCombat.js';
const origin={x:0,z:0},far={x:0,z:30};
const c=new GuardianCombat();c.enter('recovery');c.damage(20,false);assert.equal(c.valveCharge,0);
c.damage(NaN,true);assert.equal(c.valveCharge,0);c.damage(999,true);assert.equal(c.ruptured,false);assert.equal(c.valveCharge,GUARDIAN_RUPTURE_DAMAGE-1);
c.setHealth(700,1400);c.enter('chase');c.damage(26,true);assert.equal(c.ruptured,false,'only recovery hits rupture');
c.enter('recovery');assert.equal(c.damage(26,true),65);assert.equal(c.phase,'rupture');assert.equal(c.duration,5);assert.equal(c.ruptured,true);
assert.equal(c.damage(26,true),65,'rupture retains weak-point damage');c.update(4.99,origin,far);assert.equal(c.phase,'rupture');c.update(.01,origin,far);assert.equal(c.phase,'chase');
c.enter('recovery');c.damage(999,true);assert.equal(c.phase,'recovery','one rupture only');assert.equal(c.duration,3.4);c.enter('dying');assert.equal(c.damage(100,true),0);c.update(3.2,origin,far);assert.equal(c.phase,'defeated');
const g=new GuardianGas();g.spawn(0,0);assert.equal(g.update(.59,origin),0);assert.equal(g.update(.01,origin),7);assert.equal(g.update(.2,far),0);assert.equal(g.update(.5,origin),7,'brief exit does not reset grace');
g.update(1,far);assert.equal(g.update(.59,origin),0,'full second clear rearms grace');assert.equal(g.update(.01,origin),7);g.clear();g.spawn(0,0);assert.equal(g.update(.1,origin),0);g.update(.1,far);assert.equal(g.update(.49,origin),0);assert.equal(g.update(.01,origin),7,'repeated quick exits cannot refresh grace');
const safety=new GuardianGas();assert.equal(safety.canPlace(0,0,origin),true,'single cloud leaves escape');assert.equal(safety.canPlace(0,0,origin,()=>false),false,'do not vent when scenery blocks all exits');for(const [x,z] of [[0,4],[4,0],[-4,0]])safety.spawn(x,z);assert.equal(safety.canPlace(0,0,origin,(x,z)=>z>0),false,'do not seal remaining exit with overlapping clouds');
const w=new GuardianShockwave();w.start(origin);let hits=0;for(let i=0;i<45;i++)hits+=w.update(.05,{x:0,z:3});assert.equal(hits,18,'one ring hits at most once');assert.equal(w.active,false);assert.equal(w.radius,GUARDIAN_SHOCKWAVE_RADIUS);
w.start(origin);hits=0;for(let i=0;i<45;i++)hits+=w.update(.05,{x:0,z:7.1});assert.equal(hits,0,'outside maximum radius safe');
// Normal movement (3.7m/s), 0.35s reaction, no sprint or jump; start only .5m from boss.
let z=.5;for(let t=0;t<2.25;t+=.05)if(t>=.35)z+=3.7*.05;w.start(origin);hits=0;for(let i=0;i<45;i++){z+=3.7*.05;hits+=w.update(.05,{x:0,z});}assert.equal(hits,0,'escape is possible at normal speed after warning');
// A gas cloud on the initial position does not prevent escaping the slam/wave.
const mixedGas=new GuardianGas();mixedGas.spawn(0,.5);let runner={x:0,z:.5},mixedDamage=0;
for(let t=0;t<2.25;t+=.05){if(t>=.35)runner.z+=3.7*.05;mixedDamage+=mixedGas.update(.05,runner);}
w.start(origin);for(let i=0;i<45;i++){runner.z+=3.7*.05;mixedDamage+=w.update(.05,runner)+mixedGas.update(.05,runner);}
assert(mixedDamage<=14,'normal running can escape overlapping gas/slam pressure without a lethal combo');
w.start(origin);assert.equal(w.update(.1,{x:0,z:.4}),18);w.clear();assert.equal(w.active,false);assert.equal(w.update(1,origin),0);
console.log('PASS: one phase-two rupture, five-second stagger, recovery bonus, lethal interruption, gas grace/re-entry, wave sweep, one hit, range, walking escape and cleanup.');
