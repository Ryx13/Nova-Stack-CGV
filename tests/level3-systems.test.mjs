import assert from 'node:assert/strict';
import {CureDevice,CURE_CHARGES,CURE_COOLDOWN,CURE_RADIUS} from '../Level3Systems.js';
const origin={x:0,y:0,z:0},enemy=(x,z=0,y=0)=>({alive:true,state:'chase',mesh:{position:{x,y,z}}});
const normal=enemy(2),edge=enemy(CURE_RADIUS),outside=enemy(CURE_RADIUS+.01),upstairs=enemy(0,0,3.01),boss={...enemy(1),isBoss:true},dead={...enemy(1),alive:false},cured={...enemy(1),state:'cured'};
const p=new CureDevice();
assert.equal(p.activate([normal],origin,{blocked:true}).reason,'blocked');assert.equal(p.charges,CURE_CHARGES);
assert.equal(p.activate([boss,dead,cured,outside,upstairs],origin).reason,'no-targets');assert.equal(p.charges,CURE_CHARGES);
assert.equal(p.activate([normal],origin,{visible:()=>false}).reason,'no-targets');assert.equal(p.charges,CURE_CHARGES,'walls must not waste a charge');
const first=p.activate([normal,normal,edge,outside,boss,dead,cured,upstairs],origin);
assert.equal(first.ok,true);assert.deepEqual(first.targets,[normal,edge]);assert.equal(p.charges,CURE_CHARGES-1);
assert.equal(p.activate([normal],origin).reason,'cooldown');p.update(NaN);p.update(-1);assert.equal(p.cooldown,CURE_COOLDOWN);
p.update(CURE_COOLDOWN-.01);assert.equal(p.activate([normal],origin).reason,'cooldown');p.update(.02);
for(let i=0;i<CURE_CHARGES-1;i++){assert.equal(p.activate([normal],origin).ok,true);p.update(CURE_COOLDOWN);}
assert.equal(p.charges,0);p.update(1000);assert.equal(p.activate([normal],origin).reason,'empty');assert.equal(p.charges,0);
normal.alive=false;assert.equal(p.canReach(normal,origin),false,'a saved enemy cannot be selected again');
assert.equal(p.canReach(edge,origin),true);assert.equal(p.canReach(outside,origin),false);
console.log('PASS: five charges, blocked input, boss/dead/cured immunity, range/height, line of sight, deduplication, cooldown and no refills.');
