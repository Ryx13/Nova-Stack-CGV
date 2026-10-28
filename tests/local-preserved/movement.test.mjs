import assert from 'node:assert/strict';
import { updateLocomotion } from '../../Movement.js';
const fresh=()=>({keys:{},playerStamina:100,staminaExhausted:false,currentSpeed:3.7,crouching:false});
const tick=(s,n=1,forward=1)=>{for(let i=0;i<n;i++)updateLocomotion(s,1/60,forward);};
let s=fresh();tick(s,100);assert.equal(s.isSprinting,false);assert.equal(s.currentSpeed,3.7);
s.keys.ShiftLeft=true;tick(s,60);assert.equal(s.isSprinting,true);assert.ok(s.currentSpeed>8.3);
s.keys.ShiftLeft=false;tick(s,60);assert.equal(s.isSprinting,false);assert.ok(s.currentSpeed<3.72);
s=fresh();s.keys.ShiftRight=true;s.playerStamina=1;
let exhaustedFrames=0, transitions=0, previous=true;
for(let i=0;i<1800;i++){
 tick(s);if(previous!==s.isSprinting)transitions++;previous=s.isSprinting;
 if(s.staminaExhausted){exhaustedFrames++;assert.equal(s.isSprinting,false);}
 assert.ok(s.playerStamina>=0&&s.playerStamina<=100);assert.ok(Number.isFinite(s.currentSpeed));
}
assert.ok(exhaustedFrames>60);assert.ok(transitions<30,'no boundary flicker over 30 seconds');
s=fresh();s.keys.ShiftLeft=true;s.crouching=true;tick(s);assert.equal(s.isSprinting,false);
s.crouching=false;tick(s,1,-1);assert.equal(s.isSprinting,false);
s.playerStamina=24;s.staminaExhausted=true;tick(s);assert.equal(s.isSprinting,false);
s.playerStamina=25;tick(s);assert.equal(s.isSprinting,true);
s.currentSpeed=NaN;tick(s);assert.ok(Number.isFinite(s.currentSpeed));
console.log('PASS: walking, Shift release, both Shift keys, exhaustion/recovery, crouch, backwards, finite speed; 30-second endurance simulation.');
