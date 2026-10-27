import assert from 'node:assert/strict';
import {stepPlayerPhysics} from '../PhysicsStep.js';
function travel(fps,inVehicle=false){let x=0,time=0,steps=0,a=0;const body={velocity:{x:3.7,y:-1,z:0}};const world={step(dt){x+=body.velocity.x*dt;body.velocity.x*=.7;body.velocity.y-=dt;time+=dt;steps++;}};for(let i=0;i<fps*4;i++){body.velocity.x=3.7;a=stepPlayerPhysics(world,body,a,1/fps,inVehicle);}return{x,time,steps,a,y:body.velocity.y};}
const reference=travel(60);for(const fps of [20,24,30,40,60,120,144]){const result=travel(fps);assert(Math.abs(result.x-reference.x)<1e-8,`${fps} FPS preserves on-foot movement`);assert.equal(result.steps,240);assert(Math.abs(result.time-4)<1e-8);assert(result.a<1/60);assert(Math.abs(result.y+5)<1e-8,'vertical physics remains untouched');}
assert(travel(20,true).x<reference.x,'vehicle velocity is left to the physics solver');
const body={velocity:{x:NaN,y:2,z:Infinity}};stepPlayerPhysics({step(){assert.equal(body.velocity.x,0);assert.equal(body.velocity.z,0);assert.equal(body.velocity.y,2);}},body,0,1/60);
console.log('PASS: equivalent walking at 20–144 FPS, fixed-step counts, accumulator, vertical physics, vehicle behavior and finite velocity guard.');
