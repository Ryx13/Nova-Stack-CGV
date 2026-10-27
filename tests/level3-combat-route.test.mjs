import assert from 'node:assert/strict';
import {CombatRoute,MAX_ROUTE_ENEMIES,ROAD_AMBUSHES} from '../Level3CombatRoute.js';
const enemy=()=>({alive:true,state:'chase'}),r=new CombatRoute(),all=Array.from({length:8},enemy),done=[];
r.adoptOpening(all);r.advance({z:-150});r.advance({z:-180});
assert.equal(r.queue.length,4,'crossed ambushes trigger once, including a fast sprint');
assert.equal(ROAD_AMBUSHES.reduce((n,a)=>n+a.count,0),32);
let spawned=0,max=8;
const spawn=()=>{assert(all.filter(e=>e.alive&&e.state!=='cured').length<MAX_ROUTE_ENEMIES);const e=enemy();all.push(e);spawned++;return e;};
for(let i=0;i<1000;i++)r.tick(.25,all,spawn,e=>done.push(e));
assert(r.pending);assert.equal(done.length,0,'waiting out a fight cannot complete it');assert.equal(spawned,0);
all[0].state='cured';all[0].alive=false;
for(let i=1;i<8;i++)all[i].alive=false;
for(let i=0;i<1000&&r.pending;i++){
 r.tick(.25,all,spawn,e=>done.push(e));max=Math.max(max,all.filter(e=>e.alive).length);
 for(const e of all)if(e.alive){e.alive=false;e.state=i%2?'dead':'cured';}
}
assert.equal(done.length,5);assert.equal(spawned,32);assert(max<=8);assert(!r.pending);
assert.equal(r.enqueue({id:'defense-generator',label:'Generator defence',count:10,switchKey:'generator'}),true);
assert.equal(r.enqueue({id:'defense-generator',label:'duplicate',count:10}),false);
for(let i=0;i<1000&&r.pending;i++){
 r.tick(.25,all,spawn,e=>done.push(e));for(const e of all)if(e.alive)e.alive=false;
}
assert.equal(done.at(-1).switchKey,'generator');assert.equal(spawned,42);assert(!r.pending);
console.log('PASS: mandatory resolution, cured enemies count, ambush deduplication, wave cap, deferred spawning and switch completion.');
