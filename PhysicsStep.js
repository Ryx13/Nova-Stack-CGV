const FIXED_STEP=1/60;
// Preserve the commanded walking velocity between fixed substeps. Otherwise
// floor friction is applied several times per input refresh at lower frame rates.
export function stepPlayerPhysics(world,body,accumulator,dt,inVehicle=false){
  accumulator+=dt;
  const vx=Number.isFinite(body.velocity.x)?body.velocity.x:0;
  const vz=Number.isFinite(body.velocity.z)?body.velocity.z:0;
  while(accumulator+1e-10>=FIXED_STEP){
    if(!inVehicle){body.velocity.x=vx;body.velocity.z=vz;}
    world.step(FIXED_STEP);
    accumulator-=FIXED_STEP;
  }
  return Math.max(0,accumulator);
}
