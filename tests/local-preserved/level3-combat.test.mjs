import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../Level3.js',import.meta.url),'utf8');
const body=source.match(/z\.takeDamage = function\(damage = 26, headshot = false\) \{([\s\S]*?)\n    \};/)[1];
function enemy(health=100){
 const drops=[],state={playerHealth:health,playerMaxHealth:100,kills:0};
 const z={alive:true,health:52,mesh:{position:{clone:()=>({x:0,y:0,z:0})}},confirmedKill(){this.alive=false;state.kills++;}};
 z.takeDamage=new Function('sfx','pushKillFeed','spawnPickup','state','dom',`return function(damage=26,headshot=false){${body}}`)({hit(){}},()=>{},(pos,type)=>drops.push(type),state,{killcount:{}});
 return {z,drops,state};
}
for(const damage of [26,38,42]){
 const {z,drops,state}=enemy();z.takeDamage(damage);assert.equal(z.alive,true);assert.equal(drops.length,0);
 z.takeDamage(damage);assert.equal(z.alive,false);assert.deepEqual(drops,['ammo']);
 z.takeDamage(damage);assert.equal(drops.length,1);assert.equal(state.kills,1);
}
const hurt=enemy(30);hurt.z.takeDamage(100);assert.deepEqual(hurt.drops,['health']);
console.log('PASS: two shots / knife / melee hits, permanent defeat, one reward, low-health drop');
